// M2.2: manual registration of the both-party signed PDF for the exact approved
// revision, and the server-checked start of work. This is not an electronic
// signature: the PDF text is never compared with the approved revision.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { recordAudit } = require('./auditLog');
const { assertContractAccess, originalFilename, transaction } = require('./contractDocuments');
const { ContractError, latestCycle, approvalMatches, approvalSummary } = require('./contractApprovalState');
const { kycValidUntil } = require('./kycPolicy');

const MAX_BYTES = 20 * 1024 * 1024;
const SIGNATURE_COLUMNS = `id, engagement_id, cycle_id, document_version_id, signed_date, original_name, size_bytes, sha256,
  recorded_by_name, recorded_at, status, voided_at, voided_by_name, void_reason`;
// Conflict decisions that no longer hold up the start of work.
const SETTLED_CONFLICT = ['Approved', 'Approved with conditions'];

function fail(message, status = 400) { throw new ContractError(status, message); }
function localDate(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function respond(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) {
      if (!(err instanceof ContractError)) return next(err);
      res.status(err.status).json({ error: err.message, ...(err.conditions ? { conditions: err.conditions } : {}) });
    }
  };
}
function contractFor(req) {
  return assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id));
}
function positive(value, label) {
  const number = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 1) fail(`${label}: обновите карточку договора`);
  return number;
}
function requestKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(value)) fail('Обновите форму действия');
  return value;
}
function requireSigner(req) {
  if (!req.user.permissions.recordContractSignature || req.user.permissions.readOnly) {
    fail('Регистрировать подписание может сотрудник с правом «Регистрация подписания договоров»', 403);
  }
}

// The approved, still-current cycle a signature may refer to.
function approvedCycle(contract) {
  const cycle = latestCycle(contract.tenant_id, contract.id);
  return cycle?.status === 'approved' && approvalMatches(cycle, contract) ? cycle : null;
}
function activeSignature(tenantId, engagementId) {
  return db.prepare(`SELECT ${SIGNATURE_COLUMNS} FROM contract_signatures WHERE tenant_id = ? AND engagement_id = ? AND status = 'active'`).get(tenantId, engagementId);
}
function onboardingTask(contract, number) {
  const row = db.prepare('SELECT status, form_data_json, completed_at FROM ob_tasks WHERE tenant_id = ? AND client_id = ? AND task_num = ?')
    .get(contract.tenant_id, contract.client_id, number);
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.form_data_json || '{}'); } catch (_) { /* unreadable form -> nothing confirmed */ }
  return { status: row.status, data, completedAt: row.completed_at };
}

function signatureCondition(contract) {
  const base = { key: 'signature', label: 'Подписанный договор' };
  const cycle = approvedCycle(contract);
  const signature = activeSignature(contract.tenant_id, contract.id);
  if (cycle && signature?.cycle_id === cycle.id) return { ...base, state: 'done', detail: `Подписан ${signature.signed_date}` };
  // Each pending state says what to do next and where (owner's request 28.10.2026).
  if (cycle) return { ...base, state: 'pending', detail: 'Подписанный PDF не зарегистрирован — загрузите его выше в этом блоке' };
  if (!contract.document_version) return { ...base, state: 'pending', detail: 'Файл договора не загружен — загрузите его в блоке «Версии документа» внизу карточки' };
  const last = latestCycle(contract.tenant_id, contract.id), status = approvalSummary(contract).status;
  const current = db.prepare('SELECT id FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
    .get(contract.tenant_id, contract.id, contract.document_version);
  const detail = status === 'active' ? 'Договор на согласовании — ждём решений согласующих в задаче договора'
    : ['returned', 'rejected'].includes(status) && last?.document_version_id === current?.id ? 'Договор вернули с замечанием — загрузите исправленную редакцию и отправьте на согласование снова'
    : 'Текущая редакция не согласована — отправьте её на согласование в задаче договора';
  return { ...base, state: 'pending', detail };
}
// Escalation and EDD mean "waiting for a decision", never permission to proceed.
function kycCondition(contract) {
  const base = { key: 'kyc', label: 'KYC / AML одобрен (этап 2.2 онбординга)' };
  if (contract.client_id == null) return { ...base, state: 'unknown', detail: 'Договор не связан с карточкой клиента — укажите клиента в реквизитах договора' };
  const task = onboardingTask(contract, '2.2');
  if (!task) return { ...base, state: 'unknown', detail: 'У клиента нет этапа 2.2 — откройте онбординг клиента' };
  const conclusion = String(task.data.f_conclusion || task.data.conclusion || '');
  if (task.status === 'completed' && conclusion.startsWith('Одобрить')) {
    // Valid for two years from the conclusion (server/kycPolicy.js).
    const decided = task.completedAt || task.data.f_ddDate || null, until = kycValidUntil(decided);
    const shown = value => value.slice(0, 10).split('-').reverse().join('.');
    if (until && until < localDate()) return { ...base, state: 'expired', detail: `Заключение от ${shown(decided)} действовало до ${shown(until)} — нужна повторная проверка` };
    return { ...base, state: 'done', detail: until ? `Заключение: одобрить, действует до ${shown(until)}` : 'Заключение: одобрить' };
  }
  if (task.status === 'rejected' || (task.status === 'completed' && conclusion.startsWith('Отказать'))) return { ...base, state: 'rejected', detail: 'Заключение: отказать' };
  if (task.status === 'completed' && conclusion.includes('EDD')) return { ...base, state: 'pending', detail: 'Назначена расширенная проверка (EDD) — после неё сохраните итоговое заключение в этапе 2.2 онбординга' };
  return { ...base, state: 'pending', detail: 'Этап 2.2 онбординга не завершён — проверку клиента завершают CEO, Compliance Officer или MLRO' };
}
// A decision tied to another contract of the same client does not apply here.
function conflictCondition(contract) {
  const base = { key: 'conflict', label: 'Проверка конфликта интересов (этап 1.1 онбординга)' };
  if (contract.client_id == null) return { ...base, state: 'unknown', detail: 'Договор не связан с карточкой клиента — укажите клиента в реквизитах договора' };
  const decisions = db.prepare(`SELECT decision_type, status FROM conflict_approvals WHERE tenant_id = ?
    AND (engagement_id = ? OR (engagement_id IS NULL AND client_id = ?)) ORDER BY id`).all(contract.tenant_id, contract.id, contract.client_id);
  const rejected = decisions.find(d => d.status === 'Rejected');
  if (rejected) return { ...base, state: 'rejected', detail: `Отклонено решение по конфликту: ${rejected.decision_type}` };
  const task = onboardingTask(contract, '1.1');
  if (!task) return { ...base, state: 'unknown', detail: 'У клиента нет этапа 1.1 — откройте онбординг клиента' };
  const decision = String(task.data.f_decision || task.data.decision || '').trim();
  if (task.status === 'rejected' || (task.status === 'completed' && decision === 'No-Go')) return { ...base, state: 'rejected', detail: 'Решение 1.1: No-Go' };
  if (task.status === 'escalated' || decision === 'Требует эскалации') return { ...base, state: 'pending', detail: 'Эскалация: ожидается решение CO по этапу 1.1 онбординга' };
  if (task.status !== 'completed' || decision !== 'Go') return { ...base, state: 'pending', detail: 'Этап 1.1 онбординга (проверка конфликтов) не завершён — откройте онбординг клиента' };
  const open = decisions.find(d => !SETTLED_CONFLICT.includes(d.status));
  if (open) return { ...base, state: 'pending', detail: `Ожидается решение по конфликту: ${open.decision_type} — раздел «Конфликты / Одобрения»` };
  return { ...base, state: 'done', detail: 'Решение 1.1: Go' };
}
function readiness(contract) {
  const conditions = [signatureCondition(contract), kycCondition(contract), conflictCondition(contract)];
  return { ready: conditions.every(c => c.state === 'done'), conditions };
}

function signatureView(row) {
  if (!row) return null;
  const version = db.prepare('SELECT version_number FROM engagement_document_versions WHERE id = ?').get(row.document_version_id);
  return { id: row.id, cycleId: row.cycle_id, version: version?.version_number ?? null, signedDate: row.signed_date,
    name: row.original_name, size: row.size_bytes, sha256: row.sha256, recordedBy: row.recorded_by_name, recordedAt: row.recorded_at,
    status: row.status, voidedAt: row.voided_at, voidedBy: row.voided_by_name, voidReason: row.void_reason };
}
function signingState(req, contract) {
  const p = req.user.permissions, writer = !p.readOnly;
  const cycle = approvedCycle(contract);
  const version = cycle && db.prepare('SELECT id, version_number, original_name FROM engagement_document_versions WHERE tenant_id = ? AND id = ?')
    .get(req.tenantId, cycle.document_version_id);
  const rows = db.prepare(`SELECT ${SIGNATURE_COLUMNS} FROM contract_signatures WHERE tenant_id = ? AND engagement_id = ? ORDER BY id DESC`).all(req.tenantId, contract.id);
  const active = rows.find(r => r.status === 'active') || null;
  const started = !!active && !!db.prepare('SELECT 1 FROM contract_activations WHERE tenant_id = ? AND signature_id = ?').get(req.tenantId, active.id);
  const activation = db.prepare(`SELECT activation_date, activated_by_name, activated_at, conditions_json FROM contract_activations
    WHERE tenant_id = ? AND engagement_id = ? ORDER BY id DESC LIMIT 1`).get(req.tenantId, contract.id);
  const check = readiness(contract);
  return {
    engagementId: contract.id, serviceStatus: contract.status, approvalStatus: approvalSummary(contract).status,
    approvedVersion: version ? { id: version.id, version: version.version_number, name: version.original_name, cycleId: cycle.id } : null,
    signature: signatureView(active), voided: rows.filter(r => r.status === 'voided').map(signatureView),
    activation: activation ? { date: activation.activation_date, by: activation.activated_by_name, at: activation.activated_at,
      conditions: JSON.parse(activation.conditions_json) } : null,
    readiness: check, today: localDate(),
    canRegister: writer && !!p.recordContractSignature && !!cycle && !active,
    canVoid: writer && !!p.recordContractSignature && !!active && !started && contract.status !== 'Active',
    canActivate: writer && !!p.manageContracts && contract.status === 'Draft' && check.ready,
  };
}

// Repeating a request key returns the recorded outcome; reusing it for a
// different action or file is refused instead of silently applied.
function command(req, key, input, execute) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(() => {
    const old = db.prepare('SELECT actor_id, payload_hash, result_json FROM contract_signing_commands WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) {
      if (old.actor_id !== req.user.id || old.payload_hash !== hash) fail('Этот запрос уже использован с другими данными. Обновите карточку.', 409);
      return { ...JSON.parse(old.result_json), reused: true };
    }
    const result = execute();
    db.prepare('INSERT INTO contract_signing_commands (tenant_id, request_key, actor_id, payload_hash, result_json) VALUES (?, ?, ?, ?, ?)')
      .run(req.tenantId, key, req.user.id, hash, JSON.stringify(result));
    return { ...result, reused: false };
  });
}
function audit(req, contract, action, summary) {
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: contract.id, action, actorEmail: req.user.email,
    summary: `Договор «${contract.contract_num || contract.client_name}»: ${summary}` });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 3, fieldSize: 1024, parts: 5 },
}).single('file');

const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/:id/signing', respond((req, res) => {
  const contract = contractFor(req);
  res.set('Cache-Control', 'no-store');
  res.json(signingState(req, contract));
}));

// Reject an inaccessible contract or missing right before reading the body.
router.post('/:id/signatures', respond((req, res, next) => { requireSigner(req); contractFor(req); next(); }), (req, res, next) => {
  upload(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 20 МиБ' : 'Загрузите один PDF и укажите дату подписания',
    });
    next();
  });
}, respond((req, res) => {
  requireSigner(req);
  const contract = contractFor(req);
  const signedDate = req.body?.signedDate;
  const parsed = typeof signedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(signedDate) ? new Date(signedDate + 'T00:00:00Z') : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== signedDate || signedDate < '2000-01-01') {
    fail('Укажите дату подписания');
  }
  if (signedDate > localDate()) fail('Дата подписания не может быть позже сегодняшнего дня');
  const cycleId = positive(req.body?.expectedCycleId, 'Согласование');
  const key = requestKey(req.body?.requestKey);
  const name = originalFilename(req.file?.originalname);
  const bytes = req.file?.buffer;
  if (!bytes?.length || path.extname(name).toLowerCase() !== '.pdf' || bytes.subarray(0, 5).toString() !== '%PDF-') {
    fail('Загрузите подписанный обеими сторонами договор в формате PDF');
  }
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const result = command(req, key, { action: 'sign', engagementId: contract.id, cycleId, signedDate, sha256 }, () => {
    const current = contractFor(req);
    const cycle = approvedCycle(current);
    if (!cycle || cycle.id !== cycleId) fail('Согласование договора изменилось. Обновите карточку.', 409);
    if (activeSignature(req.tenantId, current.id)) fail('Подписание уже зарегистрировано. Обновите карточку.', 409);
    const info = db.prepare(`INSERT INTO contract_signatures (tenant_id, engagement_id, cycle_id, document_version_id, signed_date,
      original_name, size_bytes, sha256, file_bytes, recorded_by, recorded_by_name, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.tenantId, current.id, cycle.id, cycle.document_version_id, signedDate, name, bytes.length, sha256, bytes,
        req.user.id, req.user.name || req.user.email, new Date().toISOString());
    db.prepare('UPDATE engagements SET signed_date = ? WHERE tenant_id = ? AND id = ?').run(signedDate, req.tenantId, current.id);
    const version = db.prepare('SELECT version_number FROM engagement_document_versions WHERE id = ?').get(cycle.document_version_id);
    audit(req, current, 'contract_signed', `зарегистрировано подписание редакции ${version.version_number} от ${signedDate}`);
    return { signatureId: info.lastInsertRowid };
  });
  res.status(result.reused ? 200 : 201).json({ ...signingState(req, contractFor(req)), reused: result.reused });
}));

router.post('/:id/signatures/:signatureId/void', respond((req, res) => {
  requireSigner(req);
  const contract = contractFor(req);
  const signatureId = positive(req.params.signatureId, 'Подписание');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 1000) fail('Укажите причину аннулирования: до 1000 символов');
  const key = requestKey(req.body?.requestKey);
  const result = command(req, key, { action: 'void', engagementId: contract.id, signatureId, reason }, () => {
    const current = contractFor(req);
    const row = db.prepare('SELECT id, status, signed_date FROM contract_signatures WHERE tenant_id = ? AND engagement_id = ? AND id = ?').get(req.tenantId, current.id, signatureId);
    if (!row) fail('Регистрация подписания не найдена', 404);
    if (row.status !== 'active') fail('Регистрация уже аннулирована. Обновите карточку.', 409);
    if (current.status === 'Active' || db.prepare('SELECT 1 FROM contract_activations WHERE tenant_id = ? AND signature_id = ?').get(req.tenantId, row.id)) {
      fail('Работа по этому подписанию уже начата. Изменения оформляются дополнительным соглашением.', 409);
    }
    db.prepare(`UPDATE contract_signatures SET status = 'voided', voided_at = ?, voided_by = ?, voided_by_name = ?, void_reason = ?
      WHERE tenant_id = ? AND id = ?`).run(new Date().toISOString(), req.user.id, req.user.name || req.user.email, reason, req.tenantId, row.id);
    db.prepare('UPDATE engagements SET signed_date = NULL WHERE tenant_id = ? AND id = ?').run(req.tenantId, current.id);
    audit(req, current, 'contract_signature_voided', `регистрация подписания от ${row.signed_date} аннулирована — ${reason}`);
    return { signatureId: row.id };
  });
  res.json({ ...signingState(req, contractFor(req)), reused: result.reused });
}));

router.get('/:id/signatures/:signatureId/file', respond((req, res) => {
  const contract = contractFor(req);
  const row = db.prepare('SELECT original_name, file_bytes FROM contract_signatures WHERE tenant_id = ? AND engagement_id = ? AND id = ?')
    .get(req.tenantId, contract.id, positive(req.params.signatureId, 'Подписание'));
  if (!row) fail('Подписанный файл не найден', 404);
  res.set('Cache-Control', 'no-store');
  res.attachment(row.original_name);
  res.type('application/pdf');
  res.send(Buffer.from(row.file_bytes));
}));

// The only way a contract becomes Active: ordinary create/update routes refuse it.
router.post('/:id/activation', respond((req, res) => {
  if (!req.user.permissions.manageContracts || req.user.permissions.readOnly) fail('Начать работу может сотрудник с правом ведения договоров', 403);
  const contract = contractFor(req);
  const signatureId = positive(req.body?.expectedSignatureId, 'Подписание');
  const key = requestKey(req.body?.requestKey);
  const result = command(req, key, { action: 'activate', engagementId: contract.id, signatureId }, () => {
    const current = contractFor(req);
    if (current.status === 'Active') fail('Работа по договору уже начата', 409);
    if (current.status !== 'Draft') fail('Начать работу можно только по договору в статусе «Черновик»', 409);
    const check = readiness(current);
    if (!check.ready) {
      const err = new ContractError(409, 'Не выполнены условия начала работы: ' +
        check.conditions.filter(c => c.state !== 'done').map(c => `${c.label} — ${c.detail}`).join('; '));
      err.conditions = check.conditions;
      throw err;
    }
    const signature = activeSignature(req.tenantId, current.id);
    if (signature.id !== signatureId) fail('Регистрация подписания изменилась. Обновите карточку.', 409);
    const today = localDate(), name = req.user.name || req.user.email;
    db.prepare("UPDATE engagements SET status = 'Active', activation_date = ?, activated_by = ? WHERE tenant_id = ? AND id = ? AND status = 'Draft'")
      .run(today, name, req.tenantId, current.id);
    const info = db.prepare(`INSERT INTO contract_activations (tenant_id, engagement_id, signature_id, conditions_json, activation_date,
      activated_by, activated_by_name, activated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.tenantId, current.id, signature.id, JSON.stringify(check.conditions), today, req.user.id, name, new Date().toISOString());
    audit(req, current, 'contract_activated', `работа начата; ${check.conditions.map(c => `${c.label}: ${c.detail}`).join('; ')}`);
    return { activationId: info.lastInsertRowid };
  });
  res.json({ ...signingState(req, contractFor(req)), reused: result.reused });
}));

module.exports = { router, readiness, activeSignature };
