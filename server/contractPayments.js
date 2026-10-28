// Contract payments (owner's decision 28.10.2026): an employee who manages
// contracts, or one with payment confirmation rights, attaches the payment
// order and enters its amount, date and number by hand. "Оплачено" is the
// server's sum of active payments plus what was typed in before; a mistaken
// entry is voided with a reason and stays in history. CF&A contracts only:
// LP money goes through Capital Calls.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { recordAudit } = require('./auditLog');
const { assertContractAccess, originalFilename, transaction } = require('./contractDocuments');
const { ContractError } = require('./contractApprovalState');

const MAX_BYTES = 20 * 1024 * 1024;
const FILE_TYPES = [
  { ext: ['.pdf'], mime: 'application/pdf', magic: b => b.subarray(0, 5).toString() === '%PDF-' },
  { ext: ['.jpg', '.jpeg'], mime: 'image/jpeg', magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ['.png'], mime: 'image/png', magic: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];
const COLUMNS = `id, amount, currency, paid_date, payment_number, payer, note, original_name, mime_type, size_bytes,
  recorded_by_name, recorded_at, status, voided_at, voided_by_name, void_reason`;

function fail(message, status = 400) { throw new ContractError(status, message); }
function localDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function respond(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) { if (!(err instanceof ContractError)) return next(err); res.status(err.status).json({ error: err.message }); }
  };
}
function contractFor(req) {
  return assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id));
}
const fmContract = c => c.direction === 'FM' || c.service_type === 'LP Investment (FM)';
const canRecord = req => !req.user.permissions.readOnly && (!!req.user.permissions.manageContracts || !!req.user.permissions.paymentConfirm);
function requireRecorder(req, contract) {
  if (!canRecord(req)) fail('Вносить оплаты могут сотрудники, ведущие договоры, и сотрудники с правом «Подтверждение платежей»', 403);
  if (contract && fmContract(contract)) fail('Оплаты LP учитываются в Capital Calls', 409);
}
function requestKey(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(value)) fail('Обновите форму оплаты');
  return value;
}
const round = value => Math.round(value * 100) / 100;
// "1 500 000,50" → 1500000.5; at most two decimals.
function amountOf(value) {
  const text = typeof value === 'string' ? value.replace(/[\s ]/g, '').replace(',', '.') : '';
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) fail('Укажите сумму оплаты больше нуля, не более двух знаков после запятой');
  return Number(text);
}
function dateOf(value) {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '2000-01-01') fail('Укажите дату оплаты');
  if (value > localDate()) fail('Дата оплаты не может быть позже сегодняшнего дня');
  return value;
}
function text(value, label, max, required = false) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if ((required && !clean) || clean.length > max) fail(`${label}: ${required ? 'заполните поле, ' : ''}до ${max} символов`);
  return clean;
}

function paymentView(row) {
  return { id: row.id, amount: row.amount, currency: row.currency, paidDate: row.paid_date, paymentNumber: row.payment_number, payer: row.payer,
    note: row.note, name: row.original_name, size: row.size_bytes, recordedBy: row.recorded_by_name, recordedAt: row.recorded_at,
    status: row.status, voidedAt: row.voided_at, voidedBy: row.voided_by_name, voidReason: row.void_reason };
}
// Recomputes the contract's "paid" from its payments; returns the new total.
function refreshPaid(tenantId, contract) {
  const sum = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM contract_payments WHERE tenant_id = ? AND engagement_id = ? AND status = 'active'").get(tenantId, contract.id).total;
  const paid = round((contract.paid_before_payments || 0) + sum);
  db.prepare('UPDATE engagements SET paid = ? WHERE tenant_id = ? AND id = ?').run(paid, tenantId, contract.id);
  return paid;
}
function paymentState(req, contract) {
  const fm = fmContract(contract);
  const rows = db.prepare(`SELECT ${COLUMNS} FROM contract_payments WHERE tenant_id = ? AND engagement_id = ? ORDER BY paid_date DESC, id DESC`).all(req.tenantId, contract.id);
  const paid = round(contract.paid || 0), fee = round(contract.fee_amount || 0);
  return { engagementId: contract.id, fm, currency: contract.currency || 'USD', feeAmount: fee, paidBefore: round(contract.paid_before_payments || 0),
    paid, balance: fm ? null : round(fee - paid), payments: rows.map(paymentView), canRecord: !fm && canRecord(req), today: localDate() };
}
function command(req, key, input, execute) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(() => {
    const old = db.prepare('SELECT actor_id, payload_hash, result_json FROM contract_payment_commands WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) {
      if (old.actor_id !== req.user.id || old.payload_hash !== hash) fail('Этот запрос уже использован с другими данными. Обновите карточку.', 409);
      return { ...JSON.parse(old.result_json), reused: true };
    }
    const result = execute();
    db.prepare('INSERT INTO contract_payment_commands (tenant_id, request_key, actor_id, payload_hash, result_json) VALUES (?, ?, ?, ?, ?)')
      .run(req.tenantId, key, req.user.id, hash, JSON.stringify(result));
    return { ...result, reused: false };
  });
}
function audit(req, contract, action, summary) {
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: contract.id, action, actorEmail: req.user.email,
    summary: `Договор «${contract.contract_num || contract.client_name}»: ${summary}` });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 6, fieldSize: 2048, parts: 8 } }).single('file');
const router = express.Router();
router.use(requireAuth, requireInternal);

router.get('/:id/payments', respond((req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(paymentState(req, contractFor(req)));
}));

// Rights and access are checked before the body is read.
router.post('/:id/payments', respond((req, res, next) => { requireRecorder(req, contractFor(req)); next(); }), (req, res, next) => {
  upload(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 20 МиБ' : 'Приложите одну платёжку и заполните сумму, дату и номер',
    });
    next();
  });
}, respond((req, res) => {
  const contract = contractFor(req);
  requireRecorder(req, contract);
  const b = req.body || {};
  const input = { action: 'record', engagementId: contract.id, amount: amountOf(b.amount), paidDate: dateOf(b.paidDate),
    paymentNumber: text(b.paymentNumber, 'Номер платёжки', 64, true), payer: text(b.payer, 'Плательщик', 200), note: text(b.note, 'Комментарий', 1000) };
  const key = requestKey(b.requestKey);
  const name = originalFilename(req.file?.originalname), bytes = req.file?.buffer;
  const type = bytes?.length && FILE_TYPES.find(t => t.ext.includes(path.extname(name).toLowerCase()) && t.magic(bytes));
  if (!type) fail('Приложите платёжку: PDF, JPG или PNG до 20 МиБ');
  input.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const result = command(req, key, input, () => {
    const current = contractFor(req);
    const same = db.prepare("SELECT payment_number, paid_date FROM contract_payments WHERE tenant_id = ? AND engagement_id = ? AND status = 'active' AND (sha256 = ? OR (payment_number = ? AND paid_date = ? AND amount = ?))")
      .get(req.tenantId, current.id, input.sha256, input.paymentNumber, input.paidDate, input.amount);
    if (same) fail(`Эта платёжка уже внесена: № ${same.payment_number} от ${same.paid_date.split('-').reverse().join('.')}`, 409);
    const info = db.prepare(`INSERT INTO contract_payments (tenant_id, engagement_id, amount, currency, paid_date, payment_number, payer, note,
      original_name, mime_type, size_bytes, sha256, file_bytes, recorded_by, recorded_by_name, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.tenantId, current.id, input.amount, current.currency || 'USD', input.paidDate, input.paymentNumber, input.payer, input.note,
        name, type.mime, bytes.length, input.sha256, bytes, req.user.id, req.user.name || req.user.email, new Date().toISOString());
    const paid = refreshPaid(req.tenantId, current);
    audit(req, current, 'contract_payment', `оплата ${input.amount} ${current.currency || 'USD'} по платёжке № ${input.paymentNumber} от ${input.paidDate}; оплачено всего ${paid}`);
    return { paymentId: Number(info.lastInsertRowid) };
  });
  res.status(result.reused ? 200 : 201).json({ ...paymentState(req, contractFor(req)), reused: result.reused });
}));

router.post('/:id/payments/:paymentId/void', respond((req, res) => {
  const contract = contractFor(req);
  requireRecorder(req, contract);
  const paymentId = Number(req.params.paymentId);
  if (!Number.isSafeInteger(paymentId) || paymentId < 1) fail('Оплата не найдена', 404);
  const input = { action: 'void', engagementId: contract.id, paymentId, reason: text(req.body?.reason, 'Причина аннулирования', 1000, true) };
  const result = command(req, requestKey(req.body?.requestKey), input, () => {
    const current = contractFor(req);
    const row = db.prepare('SELECT id, status, amount, payment_number FROM contract_payments WHERE tenant_id = ? AND engagement_id = ? AND id = ?').get(req.tenantId, current.id, paymentId);
    if (!row) fail('Оплата не найдена', 404);
    if (row.status !== 'active') fail('Оплата уже аннулирована. Обновите карточку.', 409);
    db.prepare(`UPDATE contract_payments SET status = 'voided', voided_at = ?, voided_by = ?, voided_by_name = ?, void_reason = ? WHERE tenant_id = ? AND id = ?`)
      .run(new Date().toISOString(), req.user.id, req.user.name || req.user.email, input.reason, req.tenantId, row.id);
    const paid = refreshPaid(req.tenantId, current);
    audit(req, current, 'contract_payment_voided', `оплата по платёжке № ${row.payment_number} (${row.amount}) аннулирована — ${input.reason}; оплачено всего ${paid}`);
    return { paymentId: row.id };
  });
  res.json({ ...paymentState(req, contractFor(req)), reused: result.reused });
}));

router.get('/:id/payments/:paymentId/file', respond((req, res) => {
  const contract = contractFor(req);
  const row = db.prepare('SELECT original_name, mime_type, file_bytes FROM contract_payments WHERE tenant_id = ? AND engagement_id = ? AND id = ?')
    .get(req.tenantId, contract.id, Number(req.params.paymentId));
  if (!row) fail('Платёжка не найдена', 404);
  res.set('Cache-Control', 'no-store');
  res.attachment(row.original_name);
  res.type(row.mime_type);
  res.send(Buffer.from(row.file_bytes));
}));

module.exports = { router };
