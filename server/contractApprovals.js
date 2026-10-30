const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { requireAuth, requireInternal, requirePermission } = require('./auth');
const { recordAudit } = require('./auditLog');
const { assertContractAccess, handle, transaction } = require('./contractDocuments');
const { ContractError, contractMetadata, latestCycle, approvalMatches, documentFrozen, approvalSummary } = require('./contractApprovalState');
const {assertTaskOpen} = require('./discussionTasks');
const { rowToPermissions } = require('./rolesMapping');
const { contractKind } = require('./contractKinds');
const { notifyContractReturned, notifyContractReview } = require('./notifications/triggers');

const router = express.Router();
// Mounted at /api: protect only this module's paths, leaving external/API-key
// and other modules' authentication contracts untouched.
router.use(['/contract-approval-routes', '/contract-approval-inbox', '/engagements/:id/approvals'],
  requireAuth, requireInternal, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use('/engagements/:id/approvals/chat', require('./contractDiscussion'));

function fail(message, status = 400) { throw new ContractError(status, message); }
function integer(value, label, zero = false) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) fail(`${label}: неверное значение`);
  return value;
}
function text(value, label, required = true, max = 2000) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(`${label}: ${required ? 'заполните поле, ' : ''}до ${max} символов`);
  return value.trim();
}
function contractFor(req) {
  return assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id));
}
// Only a client contract needs its client card; the other kinds name the counterparty.
function hasParty(contract) { return !!contract.client_id || contractKind(contract) !== 'client'; }
function directionFor(contract) { return contract.direction === 'FM' || contract.service_type === 'LP Investment (FM)' ? 'FM' : 'CF&A'; }
function checkDirection(req, direction) {
  if (!['CF&A', 'FM'].includes(direction)) fail('Выберите направление');
  if (direction === 'FM' && !req.user.permissions.accessFM) fail('Нет доступа к направлению FM', 403);
}
function staff(tenantId, userId) {
  return db.prepare(`SELECT u.id, u.name, u.email, u.active, r.label, r.internal, r.read_only, r.access_fm
    FROM users u LEFT JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = u.role
    WHERE u.tenant_id = ? AND u.id = ?`).get(tenantId, userId);
}
function eligible(person, direction) { return !!person && !!person.active && !!person.internal && !person.read_only && (direction !== 'FM' || !!person.access_fm); }
function eligiblePeople(tenantId, direction) {
  return db.prepare('SELECT id FROM users WHERE tenant_id = ? ORDER BY name, id').all(tenantId)
    .map(u => staff(tenantId, u.id)).filter(u => eligible(u, direction));
}
function routeView(row) {
  return { id: row.id, name: row.name, direction: row.direction, revision: row.revision,
    mode: row.approval_mode, active: !!row.active, allowSelfApproval: !!row.allow_self, selfApprovalReason: row.self_reason, steps: JSON.parse(row.steps_json) };
}
function cycleMode(cycle) { return JSON.parse(cycle.route_json).mode === 'parallel' ? 'parallel' : 'sequential'; }
function routeInput(req, allowUnavailable = false) {
  const b = req.body || {};
  const name = text(b.name, 'Название маршрута', true, 160);
  checkDirection(req, b.direction);
  if (typeof b.allowSelfApproval !== 'boolean') fail('Укажите правило самосогласования');
  const selfReason = text(b.selfApprovalReason, 'Основание самосогласования', b.allowSelfApproval, 500);
  if (!Array.isArray(b.steps) || b.steps.length < 1 || b.steps.length > 5) fail('В маршруте должно быть от 1 до 5 сотрудников');
  const seen = new Set();
  const steps = b.steps.map(s => {
    if (!s || typeof s !== 'object') fail('Проверьте шаг маршрута');
    const userId = integer(s.userId, 'Согласующий'), dueDays = integer(s.dueDays, 'Срок');
    if (dueDays > 30 || seen.has(userId)) fail('Срок шага — 1–30 дней; сотрудники не должны повторяться');
    seen.add(userId);
    const person = staff(req.tenantId, userId);
    if (!person || (!allowUnavailable && !eligible(person, b.direction))) fail('Согласующий недоступен или не имеет права работать с этим направлением');
    return { userId, name: person.name || person.email, dueDays };
  });
  return { name, direction: b.direction, steps, allowSelf: b.allowSelfApproval, selfReason };
}
function audit(req, engagementId, action, summary) {
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: engagementId, action, actorEmail: req.user.email, summary });
}
// A returned or rejected contract goes back to its author (TZ M3): if the
// contract's open task has nobody responsible, the author becomes responsible,
// so it lands in their "На доработке" list and deadline reminders.
function assignAuthor(req, contract, cycle, now) {
  const state = db.prepare('SELECT * FROM discussion_task_state WHERE tenant_id = ? AND engagement_id = ?').get(req.tenantId, contract.id);
  if (state && (state.assignee_id || state.status !== 'open' || state.purged_at)) return;
  const author = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ? AND active = 1').get(req.tenantId, cycle.initiator_id);
  const role = author && db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(req.tenantId, author.role);
  if (!role) return;
  const permissions = rowToPermissions(role);
  if (!permissions.internal || permissions.readOnly) return;
  try { assertContractAccess({ tenantId: req.tenantId, user: { ...author, permissions } }, contract); }
  catch (err) { if (err instanceof ContractError) return; throw err; }
  if (state) db.prepare('UPDATE discussion_task_state SET assignee_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').run(author.id, now, req.user.id, state.id);
  else db.prepare("INSERT INTO discussion_task_state (tenant_id, engagement_id, status, version, updated_at, updated_by, assignee_id) VALUES (?, ?, 'open', 1, ?, ?, ?)")
    .run(req.tenantId, contract.id, now, req.user.id, author.id);
  db.prepare('INSERT OR IGNORE INTO contract_discussion_members (tenant_id, engagement_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?, ?)').run(req.tenantId, contract.id, author.id, req.user.id, now);
  audit(req, contract.id, 'discussion', `Ответственный: ${author.name || author.email} — договор возвращён автору на доработку`);
}
function canControl(req, cycle) {
  return !req.user.permissions.readOnly && (req.user.permissions.manageContractRoutes || (cycle.initiator_id === req.user.id && req.user.permissions.manageContracts));
}
// A registered signature pins the approved revision until it is voided.
function signed(tenantId, engagementId) {
  return !!db.prepare("SELECT 1 FROM contract_signatures WHERE tenant_id = ? AND engagement_id = ? AND status = 'active'").get(tenantId, engagementId);
}
function cycleView(req, cycle, contract) {
  const rawSteps = db.prepare('SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? ORDER BY position').all(req.tenantId, cycle.id);
  const matches = approvalMatches(cycle, contract);
  const version = db.prepare('SELECT version_number, original_name FROM engagement_document_versions WHERE tenant_id = ? AND id = ?').get(req.tenantId, cycle.document_version_id);
  const mode = cycleMode(cycle);
  const ownStep = rawSteps.find(s => s.assignee_id === req.user.id && s.status === 'pending' && (mode === 'parallel' || s.position === cycle.current_step));
  const latest = latestCycle(req.tenantId, contract.id)?.id === cycle.id;
  const actionable = latest && matches && cycle.status === 'active';
  return { id: cycle.id, number: cycle.cycle_number, status: cycle.status, revision: cycle.revision,
    versionId: cycle.document_version_id, version: version.version_number, filename: version.original_name,
    route: JSON.parse(cycle.route_json), metadata: JSON.parse(cycle.metadata_json), note: cycle.note,
    initiator: cycle.initiator_name, initiatorId: cycle.initiator_id,
    mode, currentStep: cycle.current_step, current: latest && matches,
    createdAt: cycle.created_at, resolvedAt: cycle.resolved_at, invalidatedAt: cycle.invalidated_at, closeReason: cycle.close_reason, closeActor: cycle.closed_by_name,
    canDecide: actionable && !req.user.permissions.readOnly && !!ownStep,
    decisionStepId: actionable && !req.user.permissions.readOnly ? ownStep?.id || null : null,
    canWithdraw: latest && cycle.status === 'active' && canControl(req, cycle),
    canRework: latest && !cycle.invalidated_at && ['active', 'approved'].includes(cycle.status) && canControl(req, cycle) && !signed(req.tenantId, contract.id),
    steps: rawSteps.map(s => ({ id: s.id, position: s.position, userId: s.assignee_id, name: s.assignee_name,
      available: eligible(staff(req.tenantId, s.assignee_id), directionFor(contract)), dueDays: s.due_days, dueAt: s.due_at,
      status: s.status, comment: s.comment, decidedAt: s.decided_at })) };
}
function command(req, contract, input, execute) {
  const key = text(req.body?.requestKey, 'Ключ запроса', true, 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(key)) fail('Обновите форму действия');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ engagementId: contract.id, ...input })).digest('hex');
  const result = transaction(() => {
    const old = db.prepare('SELECT * FROM contract_approval_commands WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) {
      if (old.actor_id !== req.user.id || old.payload_hash !== hash) fail('Этот запрос уже использован с другими данными. Обновите карточку.', 409);
      return { cycleId: old.cycle_id, reused: true };
    }
    const cycleId = execute();
    db.prepare('INSERT INTO contract_approval_commands (tenant_id, request_key, actor_id, payload_hash, cycle_id) VALUES (?, ?, ?, ?, ?)')
      .run(req.tenantId, key, req.user.id, hash, cycleId);
    return { cycleId, reused: false };
  });
  const cycle = db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND id = ?').get(req.tenantId, result.cycleId);
  return { cycle: cycleView(req, cycle, contract), reused: result.reused };
}
function getCycle(req, contract) {
  const cycle = db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND engagement_id = ? AND id = ?').get(req.tenantId, contract.id, req.params.cycleId);
  if (!cycle) fail('Цикл согласования не найден', 404);
  return cycle;
}
function checkRevision(cycle, expected) {
  if (cycle.revision !== expected) fail('Решение или состояние уже изменилось. Обновите согласование.', 409);
}
function dueAt(now, days) { return new Date(Date.parse(now) + days * 86400000).toISOString(); }

router.get('/contract-approval-routes', handle((req, res) => {
  const direction = req.query.direction || 'CF&A'; checkDirection(req, direction);
  const rows = db.prepare('SELECT * FROM contract_approval_routes WHERE tenant_id = ? AND direction = ? ORDER BY name, id').all(req.tenantId, direction);
  const canManage = !!req.user.permissions.manageContractRoutes && !req.user.permissions.readOnly;
  const people = canManage ? db.prepare(`SELECT u.id FROM users u WHERE u.tenant_id = ? ORDER BY u.name, u.id`).all(req.tenantId)
    .map(u => staff(req.tenantId, u.id)).filter(u => eligible(u, direction)).map(u => ({ id: u.id, name: u.name || u.email, role: u.label })) : [];
  res.json({ routes: rows.filter(r => canManage || r.active).map(routeView), people, canManage });
}));
router.post('/contract-approval-routes', requirePermission('manageContractRoutes'), handle((req, res) => {
  const r = routeInput(req), now = new Date().toISOString();
  if (req.body.active != null && typeof req.body.active !== 'boolean') fail('Укажите активность маршрута');
  const row = transaction(() => {
    const info = db.prepare(`INSERT INTO contract_approval_routes (tenant_id, name, direction, allow_self, self_reason, steps_json, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.tenantId, r.name, r.direction, r.allowSelf ? 1 : 0, r.selfReason, JSON.stringify(r.steps), req.user.id, req.user.id, now, now);
    if (req.body.active === false) db.prepare('UPDATE contract_approval_routes SET active = 0 WHERE tenant_id = ? AND id = ?').run(req.tenantId, info.lastInsertRowid);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'contract_approval_routes', entityId: info.lastInsertRowid, action: 'created', actorEmail: req.user.email,
      summary: `Маршрут «${r.name}» создан. Самосогласование: ${r.allowSelf ? 'разрешено — ' + r.selfReason : 'запрещено'}` });
    return db.prepare('SELECT * FROM contract_approval_routes WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  });
  res.status(201).json({ route: routeView(row) });
}));
router.put('/contract-approval-routes/:routeId', requirePermission('manageContractRoutes'), handle((req, res) => {
  const existing = db.prepare('SELECT * FROM contract_approval_routes WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.routeId);
  if (!existing) fail('Маршрут не найден', 404);
  checkDirection(req, existing.direction);
  const r = routeInput(req, req.body.active === false), expected = integer(req.body.expectedRevision, 'Версия маршрута');
  if (r.direction !== existing.direction) fail('Направление маршрута нельзя менять');
  if (typeof req.body.active !== 'boolean') fail('Укажите активность маршрута');
  transaction(() => {
    const updated = db.prepare(`UPDATE contract_approval_routes SET name = ?, allow_self = ?, self_reason = ?, steps_json = ?, active = ?,
      revision = revision + 1, updated_by = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND revision = ?`)
      .run(r.name, r.allowSelf ? 1 : 0, r.selfReason, JSON.stringify(r.steps), req.body.active ? 1 : 0, req.user.id, new Date().toISOString(), req.tenantId, existing.id, expected);
    if (!updated.changes) fail('Маршрут изменился. Обновите список.', 409);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'contract_approval_routes', entityId: existing.id, action: 'updated', actorEmail: req.user.email,
      summary: `Маршрут «${r.name}»: редакция ${expected + 1}, ${req.body.active ? 'активен' : 'в архиве'}. Самосогласование: ${r.allowSelf ? r.selfReason : 'запрещено'}` });
  });
  res.json({ route: routeView(db.prepare('SELECT * FROM contract_approval_routes WHERE tenant_id = ? AND id = ?').get(req.tenantId, existing.id)) });
}));

router.get('/engagements/:id/approvals', handle((req, res) => {
  const contract = contractFor(req);
  const cycles = db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND engagement_id = ? ORDER BY cycle_number DESC').all(req.tenantId, contract.id);
  const version = db.prepare('SELECT id, metadata_json, created_by FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
    .get(req.tenantId, contract.id, contract.document_version);
  const metadataMatches = !!version && version.metadata_json === JSON.stringify(contractMetadata(contract));
  const hasClient = hasParty(contract);
  res.json({ engagementId: contract.id, direction: directionFor(contract), currentVersion: contract.document_version,
    metadataMatches, summary: approvalSummary(contract), cycles: cycles.map(c => cycleView(req, c, contract)),
    canSubmit: !!req.user.permissions.manageContracts && !req.user.permissions.readOnly && hasClient && metadataMatches && !documentFrozen(contract),
    canManageRoutes: !!req.user.permissions.manageContractRoutes && !req.user.permissions.readOnly,
    userId: req.user.id, hasClient,
    people: req.user.permissions.manageContracts && !req.user.permissions.readOnly
      ? eligiblePeople(req.tenantId, directionFor(contract)).filter(p => p.id !== req.user.id && p.id !== version?.created_by)
        .map(p => ({ id: p.id, name: p.name || p.email, role: p.label })) : [] });
}));
router.post('/engagements/:id/approvals', requirePermission('manageContracts'), handle((req, res) => {
  const contract = contractFor(req), b = req.body || {};
  const direct = b.routeId == null;
  let selection;
  if (direct) {
    if (!Array.isArray(b.participants) || !b.participants.length || b.participants.length > 20) fail('Выберите от 1 до 20 согласующих');
    const participants = b.participants.map(id => integer(id, 'Согласующий')).sort((a, b) => a - b);
    if (new Set(participants).size !== participants.length) fail('Сотрудники не должны повторяться');
    const days = integer(b.dueDays ?? 3, 'Срок ответа');
    if (days > 30) fail('Срок ответа — от 1 до 30 дней');
    selection = { participants, dueDays: days };
  } else selection = { routeId: integer(b.routeId, 'Маршрут'), expectedRouteRevision: integer(b.expectedRouteRevision, 'Версия маршрута') };
  const input = { action: 'submit', expectedVersion: integer(b.expectedVersion, 'Редакция документа'),
    ...selection,
    expectedCycleId: b.expectedCycleId == null ? null : integer(b.expectedCycleId, 'Цикл'), note: text(b.note, 'Комментарий', false) };
  const result = command(req, contract, input, () => {
    if (!hasParty(contract)) fail('Сначала свяжите договор с клиентом');
    // A new approval creates an empty task; it never restores purged messages.
    db.prepare(`UPDATE discussion_task_state SET purged_at=NULL,status='open',completed_at=NULL,deleted_at=NULL,version=version+1 WHERE tenant_id=? AND engagement_id=? AND purged_at IS NOT NULL`).run(req.tenantId,contract.id);
    assertTaskOpen(req.tenantId,'contract',contract.id);
    if ((latestCycle(req.tenantId, contract.id)?.id || null) !== input.expectedCycleId || documentFrozen(contract)) fail('Состояние согласования изменилось. Обновите карточку.', 409);
    if (contract.document_version !== input.expectedVersion) fail('Редакция документа изменилась', 409);
    const version = db.prepare('SELECT id, metadata_json, created_by FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
      .get(req.tenantId, contract.id, input.expectedVersion);
    if (!version || version.metadata_json !== JSON.stringify(contractMetadata(contract))) fail('Сохраните редакцию с актуальными реквизитами перед согласованием', 409);
    let route;
    if (direct) {
      const direction = directionFor(contract);
      const steps = input.participants.map(userId => {
        const person = staff(req.tenantId, userId);
        if (!eligible(person, direction)) fail('Согласующий недоступен или не имеет доступа к договору', 409);
        if (person.id === req.user.id || person.id === version.created_by) fail('Инициатор и автор редакции не могут согласовать собственный договор', 409);
        return { userId, name: person.name || person.email, dueDays: input.dueDays };
      });
      // Keep the existing route FK/history model. This private, inactive route
      // belongs to this submission; selecting people never edits a shared route.
      const now = new Date().toISOString();
      const created = db.prepare(`INSERT INTO contract_approval_routes
        (tenant_id, name, direction, active, approval_mode, steps_json, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'parallel', ?, ?, ?, ?, ?)`).run(req.tenantId, 'Согласующие договора', direction,
          JSON.stringify(steps), req.user.id, req.user.id, now, now);
      route = db.prepare('SELECT * FROM contract_approval_routes WHERE tenant_id = ? AND id = ?').get(req.tenantId, created.lastInsertRowid);
    } else {
      route = db.prepare('SELECT * FROM contract_approval_routes WHERE tenant_id = ? AND id = ?').get(req.tenantId, input.routeId);
      if (!route) fail('Маршрут не найден', 404);
      if (!route.active || route.revision !== input.expectedRouteRevision || route.direction !== directionFor(contract)) fail('Маршрут изменился, архивирован или относится к другому направлению', 409);
    }
    const snapshot = routeView(route);
    snapshot.steps = snapshot.steps.map(s => {
      const person = staff(req.tenantId, s.userId);
      if (!eligible(person, route.direction)) fail('В маршруте есть недоступный согласующий. Обновите маршрут.', 409);
      if (!route.allow_self && (person.id === req.user.id || person.id === version.created_by)) fail('Маршрут запрещает согласование инициатором или автором редакции', 409);
      return { ...s, name: person.name || person.email };
    });
    const number = (latestCycle(req.tenantId, contract.id)?.cycle_number || 0) + 1;
    const now = new Date().toISOString();
    const created = db.prepare(`INSERT INTO contract_approval_cycles (tenant_id, engagement_id, document_version_id, cycle_number, route_id,
      route_revision, route_json, metadata_json, initiator_id, initiator_name, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(req.tenantId, contract.id, version.id, number, route.id,
        route.revision, JSON.stringify(snapshot), version.metadata_json, req.user.id, req.user.name || req.user.email, input.note, now);
    snapshot.steps.forEach((s, i) => db.prepare(`INSERT INTO contract_approval_steps (tenant_id, cycle_id, position, assignee_id, assignee_name, due_days, due_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.tenantId, created.lastInsertRowid, i, s.userId, s.name, s.dueDays,
        snapshot.mode === 'parallel' || i === 0 ? dueAt(now, s.dueDays) : null,
        snapshot.mode === 'parallel' || i === 0 ? 'pending' : 'waiting'));
    audit(req, contract.id, 'contract_submitted', `Цикл ${number}: редакция ${input.expectedVersion} отправлена по маршруту «${route.name}»`);
    return created.lastInsertRowid;
  });
  res.status(result.reused ? 200 : 201).json(result);
  // Each reviewer whose turn it is gets an email (one per review step).
  notifyContractReview(req.tenantId, result.cycle.id).catch(err => console.error('[notify] contract_review_assigned failed:', err.message));
}));

router.post('/engagements/:id/approvals/:cycleId/decision', handle((req, res) => {
  const contract = contractFor(req), cycle = getCycle(req, contract), b = req.body || {};
  if (!['approved', 'returned', 'rejected'].includes(b.decision)) fail('Выберите решение');
  const input = { action: 'decision', cycleId: cycle.id, stepId: integer(b.stepId, 'Шаг'), expectedRevision: integer(b.expectedRevision, 'Состояние'),
    decision: b.decision, comment: text(b.comment, 'Комментарий', b.decision !== 'approved') };
  const assigned = db.prepare('SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND id = ?').get(req.tenantId, cycle.id, input.stepId);
  if (!assigned || assigned.assignee_id !== req.user.id) fail('Этот шаг назначен другому сотруднику', 403);
  const result = command(req, contract, input, () => {
    // Re-read under the write transaction. In parallel reviews another person's
    // decision may advance the cycle revision without invalidating this vote.
    const current = getCycle(req, contract);
    const step = db.prepare('SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND id = ?').get(req.tenantId, current.id, assigned.id);
    const parallel = cycleMode(current) === 'parallel';
    if (!parallel) checkRevision(current, input.expectedRevision);
    else if (input.expectedRevision > current.revision) fail('Состояние согласования изменилось. Обновите карточку.', 409);
    if (current.status !== 'active' || (!parallel && current.current_step !== step.position) || step.status !== 'pending' ||
        latestCycle(req.tenantId, contract.id)?.id !== current.id || !approvalMatches(current, contractFor(req))) {
      fail('Этот шаг уже закрыт или редакция изменилась', 409);
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE contract_approval_steps SET status = ?, comment = ?, decided_at = ?, decided_by = ? WHERE tenant_id = ? AND id = ?')
      .run(input.decision, input.comment, now, req.user.id, req.tenantId, assigned.id);
    const next = parallel
      ? db.prepare("SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND status IN ('pending','waiting') ORDER BY position LIMIT 1").get(req.tenantId, cycle.id)
      : db.prepare('SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND position = ?').get(req.tenantId, cycle.id, assigned.position + 1);
    const status = input.decision === 'approved' ? (next ? 'active' : 'approved') : input.decision;
    if (status === 'active') {
      if (!parallel) db.prepare("UPDATE contract_approval_steps SET status = 'pending', due_at = ? WHERE tenant_id = ? AND id = ?").run(dueAt(now, next.due_days), req.tenantId, next.id);
    } else db.prepare("UPDATE contract_approval_steps SET status = 'cancelled' WHERE tenant_id = ? AND cycle_id = ? AND status IN ('pending','waiting')").run(req.tenantId, cycle.id);
    db.prepare('UPDATE contract_approval_cycles SET status = ?, current_step = ?, revision = revision + 1, resolved_at = ? WHERE tenant_id = ? AND id = ?')
      .run(status, status === 'active' ? next.position : assigned.position + (input.decision === 'approved' ? 1 : 0), status === 'active' ? null : now, req.tenantId, cycle.id);
    audit(req, contract.id, 'contract_decided', `Цикл ${cycle.cycle_number}, шаг ${assigned.position + 1}: ${input.decision}${input.comment ? ' — ' + input.comment : ''}`);
    if (['returned', 'rejected'].includes(status)) assignAuthor(req, contract, current, now);
    return cycle.id;
  });
  res.json(result);
  if (['returned', 'rejected'].includes(input.decision)) {
    notifyContractReturned(req.tenantId, cycle.id).catch(err => console.error('[notify] contract_returned failed:', err.message));
  } else {
    // In a sequential route the next reviewer's turn starts now.
    notifyContractReview(req.tenantId, cycle.id).catch(err => console.error('[notify] contract_review_assigned failed:', err.message));
  }
}));

for (const action of ['withdraw', 'rework']) router.post(`/engagements/:id/approvals/:cycleId/${action}`, handle((req, res) => {
  const contract = contractFor(req), cycle = getCycle(req, contract);
  if (!canControl(req, cycle)) fail('Отзыв и доработка доступны инициатору с правом ведения договоров или администратору маршрутов', 403);
  const input = { action, cycleId: cycle.id, expectedRevision: integer(req.body?.expectedRevision, 'Состояние'), reason: text(req.body?.reason, 'Причина') };
  const result = command(req, contract, input, () => {
    checkRevision(cycle, input.expectedRevision);
    if (latestCycle(req.tenantId, contract.id)?.id !== cycle.id || cycle.invalidated_at || (action === 'withdraw' ? cycle.status !== 'active' : !['active', 'approved'].includes(cycle.status))) fail('Этот цикл уже закрыт или заменён новым', 409);
    if (action === 'rework' && signed(req.tenantId, contract.id)) fail('Договор подписан. Сначала аннулируйте регистрацию подписания или оформите изменения дополнительным соглашением.', 409);
    const now = new Date().toISOString();
    db.prepare(`UPDATE contract_approval_cycles SET status = ?, resolved_at = COALESCE(resolved_at, ?), invalidated_at = ?, invalidated_by = ?,
      close_reason = ?, closed_by = ?, closed_by_name = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ?`)
      .run(cycle.status === 'approved' ? 'approved' : 'withdrawn', now, action === 'rework' ? now : null, action === 'rework' ? req.user.id : null,
        input.reason, req.user.id, req.user.name || req.user.email, req.tenantId, cycle.id);
    db.prepare("UPDATE contract_approval_steps SET status = 'cancelled' WHERE tenant_id = ? AND cycle_id = ? AND status IN ('pending','waiting')").run(req.tenantId, cycle.id);
    audit(req, contract.id, action === 'rework' ? 'contract_rework' : 'contract_withdrawn', `Цикл ${cycle.cycle_number}: ${input.reason}`);
    return cycle.id;
  });
  res.json(result);
}));

router.get('/contract-approval-inbox', handle((req, res) => {
  const rows = db.prepare(`SELECT c.* FROM contract_approval_cycles c WHERE c.tenant_id = ? AND NOT EXISTS
    (SELECT 1 FROM contract_approval_cycles newer WHERE newer.tenant_id = c.tenant_id AND newer.engagement_id = c.engagement_id AND newer.cycle_number > c.cycle_number)
    ORDER BY c.created_at DESC`).all(req.tenantId);
  const items = [];
  for (const cycle of rows) {
    const contract = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, cycle.engagement_id);
    try { assertContractAccess(req, contract); } catch (err) { if (err instanceof ContractError) continue; throw err; }
    const summary = approvalSummary(contract);
    if (summary.status === 'approved') continue;
    const view = cycleView(req, cycle, contract);
    const pending = view.steps.filter(s => s.status === 'pending');
    const ownStep = pending.find(s => s.userId === req.user.id);
    const earliest = pending.map(s => s.dueAt).filter(Boolean).sort()[0] || null;
    items.push({ engagementId: contract.id, contractNumber: contract.contract_num, clientName: contract.client_name,
      cycleId: cycle.id, status: summary.status, version: view.version, mode: view.mode,
      approvedCount: view.steps.filter(s => s.status === 'approved').length, totalCount: view.steps.length,
      assignee: pending.length ? pending.map(s => s.name).join(', ') : cycle.initiator_name,
      dueAt: ownStep?.dueAt || earliest, assigneeAvailable: pending.every(s => s.available),
      mine: view.canDecide || (summary.status !== 'active' && cycle.initiator_id === req.user.id && !!req.user.permissions.manageContracts && !req.user.permissions.readOnly),
      canDecide: view.canDecide });
  }
  res.json({ items });
}));

module.exports = router;
