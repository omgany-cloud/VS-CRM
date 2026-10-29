// Conditions of a conflict decision «Одобрено с условиями» (TZ 13.1, раздел 44):
// each names what to do, the executor and the deadline; the executor (or a
// conflict decider) confirms it with what was done, a decider may cancel it
// with a reason. An open condition marked "before start" holds the contract's
// start of work (contractSigning.js), and so does a conditional decision with
// no condition recorded: a missing record is not a fulfilment.
const express = require('express');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { recordAudit } = require('./auditLog');
const { transaction } = require('./contractDocuments');
const { ContractError } = require('./contractApprovalState');
const { rowToPermissions } = require('./rolesMapping');
const { conflictVisible } = require('./conflictAccess');
const { notifyConflictCondition } = require('./notifications/triggers');

const CONDITIONAL = 'Approved with conditions';
const MAX_CONDITIONS = 20;

function fail(message, status = 400) { throw new ContractError(status, message); }
function respond(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) { if (!(err instanceof ContractError)) return next(err); res.status(err.status).json({ error: err.message }); }
  };
}
function localDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function text(value, max, message) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > max) fail(message);
  return s;
}

// Executors: active internal employees who can open this decision and may write.
function conditionAssignees(req, approval) {
  return db.prepare('SELECT * FROM users WHERE tenant_id = ? AND active = 1 ORDER BY name, id').all(req.tenantId).flatMap(user => {
    const role = db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(req.tenantId, user.role);
    if (!role) return [];
    const permissions = rowToPermissions(role);
    if (!permissions.internal || permissions.readOnly) return [];
    return conflictVisible({ tenantId: req.tenantId, user: { ...user, permissions } }, approval) ? [{ id: user.id, name: user.name || user.email }] : [];
  });
}

function normalizeConditions(req, approval, list) {
  if (!Array.isArray(list) || !list.length) fail('Укажите хотя бы одно условие: что сделать, исполнителя и срок');
  if (list.length > MAX_CONDITIONS) fail(`Не больше ${MAX_CONDITIONS} условий за один раз`);
  const people = new Map(conditionAssignees(req, approval).map(p => [p.id, p]));
  const today = localDate();
  return list.map((c, i) => {
    const n = list.length > 1 ? ` (условие ${i + 1})` : '';
    const what = text(c?.text, 1000, 'Опишите, что нужно сделать: до 1000 символов' + n);
    const assignee = people.get(Number(c?.assigneeId));
    if (!assignee) fail('Выберите исполнителя из сотрудников, которым доступно это решение' + n);
    const due = typeof c?.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.dueDate) ? c.dueDate : '';
    const parsed = due && new Date(due + 'T00:00:00Z');
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due || due > '2199-12-31') fail('Укажите срок выполнения' + n);
    if (due < today) fail('Срок выполнения не может быть в прошлом' + n);
    return { text: what, assignee, dueDate: due, beforeStart: c.beforeStart !== false };
  });
}

// Caller owns the transaction (the decision and its conditions are one write).
function insertConditions(req, approval, conditions) {
  const now = new Date().toISOString(), name = req.user.name || req.user.email;
  const ids = conditions.map(c => Number(db.prepare(`INSERT INTO conflict_conditions (tenant_id, approval_id, text, assignee_id, due_date,
    before_start, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.tenantId, approval.id, c.text, c.assignee.id, c.dueDate, c.beforeStart ? 1 : 0, req.user.id, name, now).lastInsertRowid));
  audit(req, approval, 'conditions_added', conditions.map(c => `условие «${c.text}» — ${c.assignee.name}, срок ${c.dueDate}${c.beforeStart ? ', до начала работы' : ''}`).join('; '));
  return ids;
}
function notifyAssigned(req, ids) {
  for (const id of ids) notifyConflictCondition(req.tenantId, id, req.user.id).catch(err => console.error('[conflict conditions] notification failed:', err.message));
}
function audit(req, approval, action, summary) {
  recordAudit(db, { tenantId: req.tenantId, entityType: 'conflict_approvals', entityId: approval.id, action, actorEmail: req.user.email,
    summary: `Конфликт интересов «${approval.decision_type}»: ${summary}` });
}

function canClose(req, row) {
  return row.status === 'open' && !req.user.permissions.readOnly && (row.assignee_id === req.user.id || !!req.user.permissions.decideConflicts);
}
function conditionView(req, row) {
  return {
    id: row.id, approvalId: row.approval_id, text: row.text, assigneeId: row.assignee_id, assigneeName: row.assignee_name || '',
    dueDate: row.due_date, beforeStart: !!row.before_start, status: row.status,
    createdByName: row.created_by_name, createdAt: row.created_at,
    closedByName: row.closed_by_name, closedAt: row.closed_at, closeNote: row.close_note,
    canComplete: canClose(req, row), canCancel: row.status === 'open' && !!req.user.permissions.decideConflicts && !req.user.permissions.readOnly,
  };
}
function conditionsByApproval(req, approvalIds) {
  const out = new Map(approvalIds.map(id => [id, []]));
  if (!approvalIds.length) return out;
  const rows = db.prepare(`SELECT c.*, COALESCE(u.name, u.email) AS assignee_name FROM conflict_conditions c
    LEFT JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.assignee_id
    WHERE c.tenant_id = ? AND c.approval_id IN (${approvalIds.map(() => '?').join(',')}) ORDER BY c.id`).all(req.tenantId, ...approvalIds);
  for (const row of rows) out.get(row.approval_id)?.push(conditionView(req, row));
  return out;
}

function approvalFor(req) {
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE tenant_id = ? AND id = ?').get(req.tenantId, Number(req.params.id));
  if (!row || !conflictVisible(req, row)) fail('Решение по конфликту не найдено', 404);
  return row;
}
function requireDecider(req, message) {
  if (!req.user.permissions.decideConflicts || req.user.permissions.readOnly) fail(message, 403);
}
function conditionsState(req, approval) {
  return { approvalId: approval.id, conditions: conditionsByApproval(req, [approval.id]).get(approval.id) };
}

const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/:id/condition-assignees', respond((req, res) => {
  requireDecider(req, 'Условия задают сотрудники, принимающие решения по конфликтам');
  res.json({ people: conditionAssignees(req, approvalFor(req)) });
}));

router.post('/:id/conditions', respond((req, res) => {
  requireDecider(req, 'Условия задают сотрудники, принимающие решения по конфликтам');
  let approval, ids;
  transaction(() => {
    approval = approvalFor(req);
    if (approval.status !== CONDITIONAL) fail('Условия добавляются к решению «Одобрено с условиями»', 409);
    ids = insertConditions(req, approval, normalizeConditions(req, approval, req.body?.conditions));
  });
  notifyAssigned(req, ids);
  res.status(201).json(conditionsState(req, approval));
}));

function closeCondition(req, status) {
  const done = status === 'done';
  const note = done ? text(req.body?.note, 2000, 'Опишите, что сделано: до 2000 символов') : text(req.body?.reason, 1000, 'Укажите причину отмены: до 1000 символов');
  let approval;
  transaction(() => {
    approval = approvalFor(req);
    const row = db.prepare('SELECT * FROM conflict_conditions WHERE tenant_id = ? AND approval_id = ? AND id = ?').get(req.tenantId, approval.id, Number(req.params.conditionId));
    if (!row) fail('Условие не найдено', 404);
    if (row.status !== 'open') fail('Условие уже закрыто. Обновите страницу.', 409);
    if (done && !canClose(req, row)) fail('Отметить выполнение может исполнитель или сотрудник, принимающий решения по конфликтам', 403);
    if (!done) requireDecider(req, 'Отменить условие может сотрудник, принимающий решения по конфликтам');
    db.prepare(`UPDATE conflict_conditions SET status = ?, closed_by = ?, closed_by_name = ?, closed_at = ?, close_note = ?
      WHERE tenant_id = ? AND id = ? AND status = 'open'`).run(status, req.user.id, req.user.name || req.user.email, new Date().toISOString(), note, req.tenantId, row.id);
    audit(req, approval, done ? 'condition_done' : 'condition_cancelled', `условие «${row.text}» ${done ? 'выполнено' : 'отменено'} — ${note}`);
  });
  return conditionsState(req, approval);
}
router.post('/:id/conditions/:conditionId/complete', respond((req, res) => res.json(closeCondition(req, 'done'))));
router.post('/:id/conditions/:conditionId/cancel', respond((req, res) => res.json(closeCondition(req, 'cancelled'))));

module.exports = { router, CONDITIONAL, normalizeConditions, insertConditions, notifyAssigned, conditionsByApproval };
