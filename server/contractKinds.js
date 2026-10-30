// Contract kinds (owner's decision 30.10.2026). A client contract follows the
// client's onboarding (KYC 2.2 and the conflict check 1.1). A client ordering a
// service outside the licence needs no onboarding: the CEO, COO or Legal
// records that decision instead. A supplier is checked in ADATA by the COO or
// Legal, who may also record that no check is needed. Either decision is a
// condition of starting work; the latest one is in force, earlier ones stay.
const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { recordAudit } = require('./auditLog');
const { assertContractAccess, transaction } = require('./contractDocuments');
const { ContractError } = require('./contractApprovalState');

const CONTRACT_KINDS = ['client', 'unlicensed', 'supplier'];
const CHECKS = {
  unlicensed: { kind: 'exemption', permission: 'approveNoOnboarding', who: 'CEO, COO или Legal',
    label: 'Решение: онбординг не требуется (услуга вне лицензии)',
    results: { approved: 'Онбординг не требуется', rejected: 'Нужен онбординг' } },
  supplier: { kind: 'screening', permission: 'checkCounterparties', who: 'COO или Legal',
    label: 'Проверка поставщика (ADATA)',
    results: { approved: 'Проверен в ADATA — можно работать', not_required: 'Проверка не требуется', rejected: 'Отказ по итогам проверки' } },
};
const COLUMNS = 'id, check_kind, result, note, decided_by, decided_by_name, decided_at';

function fail(message, status = 400) { throw new ContractError(status, message); }
function respond(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) { if (!(err instanceof ContractError)) return next(err); res.status(err.status).json({ error: err.message }); }
  };
}
function contractFor(req) {
  return assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id));
}
function contractKind(row) { return CONTRACT_KINDS.includes(row?.contract_kind) ? row.contract_kind : 'client'; }
function shownDay(value) { return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Qyzylorda' }).format(new Date(value)); }
function text(value, label, max, required) {
  const clean = typeof value === 'string' ? value.trim() : value == null ? '' : null;
  if (clean === null || (required && !clean) || clean.length > max) fail(`${label}: ${required ? 'заполните поле, ' : ''}до ${max} символов`);
  return clean || null;
}

// The counterparty named on a contract that has no client card.
function counterpartyFields(b, kind) {
  if (b.clientId != null && b.clientId !== '') fail('У договора без онбординга и договора с поставщиком нет карточки клиента');
  const supplier = kind === 'supplier';
  const clientName = text(b.clientName, supplier ? 'Наименование поставщика' : 'Наименование клиента', 300, true);
  const serviceType = text(b.serviceType, supplier ? 'Предмет договора' : 'Услуга', 200, true);
  if (serviceType === 'LP Investment (FM)') fail('Договоры FM создаются в онбординге LP');
  const bin = text(b.counterpartyBin, 'БИН/ИИН', 12, false);
  if (bin && !/^\d{12}$/.test(bin)) fail('БИН/ИИН — 12 цифр');
  return { contractKind: kind, clientId: null, clientName, serviceType, direction: null,
    counterpartyBin: bin, counterpartyCountry: text(b.counterpartyCountry, 'Страна', 100, false) };
}

function decisionRows(tenantId, engagementId) {
  return db.prepare(`SELECT ${COLUMNS} FROM contract_counterparty_decisions WHERE tenant_id = ? AND engagement_id = ? ORDER BY id DESC`).all(tenantId, engagementId);
}
function decisionView(row, check) {
  return row ? { id: row.id, result: row.result, resultLabel: check.results[row.result] || row.result, note: row.note,
    decidedBy: row.decided_by_name, decidedAt: row.decided_at } : null;
}
// The start-of-work condition that replaces KYC and the conflict check.
function counterpartyCondition(contract) {
  const check = CHECKS[contractKind(contract)];
  const base = { key: check.kind, label: check.label, who: check.who };
  const [row] = decisionRows(contract.tenant_id, contract.id);
  if (!row) {
    return { ...base, state: 'pending', detail: check.kind === 'exemption'
      ? 'Решение не записано — его принимают CEO, COO или Legal в блоке «Подписание и начало работы»'
      : 'Проверка не записана — COO или Legal проверяют поставщика в ADATA и записывают результат в блоке «Подписание и начало работы»' };
  }
  return { ...base, state: row.result === 'rejected' ? 'rejected' : 'done',
    detail: `${check.results[row.result]}: ${row.note} — ${row.decided_by_name}, ${shownDay(row.decided_at)}` };
}
function canDecide(req, contract) {
  const check = CHECKS[contractKind(contract)], p = req.user.permissions;
  return !!check && !p.readOnly && !!p[check.permission] && contract.status === 'Draft';
}
function counterpartyState(req, contract) {
  const kind = contractKind(contract);
  if (kind === 'client') return null;
  const check = CHECKS[kind], rows = decisionRows(req.tenantId, contract.id);
  return { kind, check: check.kind, label: check.label, who: check.who,
    results: Object.entries(check.results).map(([value, label]) => ({ value, label })),
    current: decisionView(rows[0], check), history: rows.slice(1).map(r => decisionView(r, check)), canDecide: canDecide(req, contract) };
}

const router = express.Router();
router.use(requireAuth, requireInternal);

router.post('/:id/counterparty-decisions', respond((req, res) => {
  const contract = contractFor(req), kind = contractKind(contract);
  if (kind === 'client') fail('Клиентский договор проходит KYC и проверку конфликтов в онбординге', 409);
  const check = CHECKS[kind], p = req.user.permissions;
  if (p.readOnly || !p[check.permission]) {
    fail(check.kind === 'exemption' ? 'Решение о договоре без онбординга принимают CEO, COO или Legal' : 'Проверку поставщика записывают COO или Legal', 403);
  }
  const b = req.body || {};
  if (!Object.hasOwn(check.results, b.result)) fail('Выберите результат');
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (!note || note.length > 2000) fail(check.kind === 'exemption' ? 'Укажите обоснование: до 2000 символов' : 'Опишите результат проверки или причину: до 2000 символов');
  const expected = Number.isSafeInteger(b.expectedDecisionId) && b.expectedDecisionId >= 0 ? b.expectedDecisionId : fail('Обновите карточку договора');
  const key = typeof b.requestKey === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(b.requestKey) ? b.requestKey : fail('Обновите форму решения');
  const hash = crypto.createHash('sha256').update(JSON.stringify([contract.id, b.result, note, expected])).digest('hex');
  // Repeating a request key returns the recorded outcome; reusing it for another decision is refused.
  const reused = transaction(() => {
    const old = db.prepare('SELECT decided_by, payload_hash FROM contract_counterparty_decisions WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) {
      if (old.decided_by !== req.user.id || old.payload_hash !== hash) fail('Этот запрос уже использован с другими данными. Обновите карточку.', 409);
      return true;
    }
    const current = contractFor(req);
    if (current.status !== 'Draft') fail('Работа по договору уже начата или договор закрыт — решение не меняется', 409);
    if ((decisionRows(req.tenantId, current.id)[0]?.id || 0) !== expected) fail('Решение уже изменили. Обновите карточку договора.', 409);
    db.prepare(`INSERT INTO contract_counterparty_decisions (tenant_id, engagement_id, check_kind, result, note, decided_by, decided_by_name,
      decided_at, request_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.tenantId, current.id, check.kind, b.result, note, req.user.id, req.user.name || req.user.email, new Date().toISOString(), key, hash);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: current.id, action: 'counterparty_decision', actorEmail: req.user.email,
      summary: `Договор «${current.contract_num || current.client_name}»: ${check.label} — ${check.results[b.result]}` });
    return false;
  });
  res.status(reused ? 200 : 201).json({ ...counterpartyState(req, contractFor(req)), reused });
}));

module.exports = { router, CONTRACT_KINDS, CHECKS, contractKind, counterpartyFields, counterpartyCondition, counterpartyState, canDecide };
