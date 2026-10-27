const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { db, at } = require('./db');
const { requireAuth, requireInternal, requirePermission } = require('./auth');
const { recordAudit } = require('./auditLog');
const { engagementToParams, rowToEngagement, ENGAGEMENT_INSERT_SQL } = require('./onboardingMapping');
const { assertContractAccess, ContractError, handle, originalFilename, validateFile, transaction, insertContractVersion } = require('./contractDocuments');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VERSION_META = 'id, version_number, original_name, size_bytes, sha256, change_note, author_name, author_email, created_at';
const router = express.Router();
router.use(requireAuth, requireInternal);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

function field(value, label, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new ContractError(400, `${label}: ${required ? 'обязательное поле, ' : ''}до ${max} символов`);
  }
  return value.trim();
}
function integer(value, label, zero = false) {
  if (!['number', 'string'].includes(typeof value) || !/^(0|[1-9]\d*)$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < (zero ? 0 : 1)) {
    throw new ContractError(400, `${label}: неверное значение`);
  }
  return Number(value);
}
function templateView(row) {
  return { id: row.id, name: row.name, contractType: row.contract_type, direction: row.direction,
    archived: !!row.archived, latestVersion: row.latest_version, revision: row.revision, createdAt: row.created_at };
}
function versionView(row) {
  return { id: row.id, version: row.version_number, name: row.original_name, size: row.size_bytes,
    sha256: row.sha256, changeNote: row.change_note, author: row.author_name, authorEmail: row.author_email, createdAt: row.created_at };
}
function getTemplate(req) {
  const row = db.prepare('SELECT * FROM contract_templates WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id);
  if (!row) throw new ContractError(404, 'Шаблон не найден');
  if (row.direction === 'FM' && !req.user.permissions.accessFM) throw new ContractError(403, 'Нет доступа к шаблонам FM');
  return row;
}
function getVersion(req, template, withBytes = false) {
  const row = db.prepare(`SELECT ${VERSION_META}${withBytes ? ', file_bytes' : ''} FROM contract_template_versions
    WHERE tenant_id = ? AND template_id = ? AND id = ?`).get(req.tenantId, template.id, req.params.versionId);
  if (!row) throw new ContractError(404, 'Редакция шаблона не найдена');
  return row;
}
function activeTemplate(row) {
  if (row.archived) throw new ContractError(409, 'Шаблон в архиве. Восстановите его перед использованием');
}
function fileData(file) {
  const name = originalFilename(file?.originalname);
  if (validateFile(file, name) !== DOCX) throw new ContractError(400, 'Для шаблона нужен файл Word в формате DOCX');
  return { name, bytes: file.buffer, hash: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}
function receiveFile(fields) {
  const parse = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: 20 * 1024 * 1024, files: 1, fields, fieldSize: 12 * 1024, parts: fields + 2,
  } }).single('file');
  return (req, res, next) => parse(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер DOCX — 20 МиБ' : 'Проверьте поля формы и выберите один DOCX',
    });
    next();
  });
}
function audit(req, id, action, summary) {
  recordAudit(db, { tenantId: req.tenantId, entityType: 'contract_templates', entityId: id, action, actorEmail: req.user.email, summary });
}
function insertTemplateVersion(req, templateId, version, file, note) {
  const result = db.prepare(`INSERT INTO contract_template_versions
    (tenant_id, template_id, version_number, original_name, size_bytes, sha256, file_bytes, change_note, created_by, author_name, author_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.tenantId, templateId, version, file.name, file.bytes.length,
    file.hash, file.bytes, note, req.user.id, req.user.name || req.user.email, req.user.email, new Date().toISOString());
  return versionView(db.prepare(`SELECT ${VERSION_META} FROM contract_template_versions WHERE tenant_id = ? AND id = ?`).get(req.tenantId, result.lastInsertRowid));
}
function sourceOf(template, version) {
  return { id: version.id, templateId: template.id, name: template.name, contractType: template.contract_type, version: version.version_number };
}
function copyVersion(req, contract, template, version) {
  return insertContractVersion(req, contract, { expected: 0, buffer: Buffer.from(version.file_bytes),
    name: version.original_name, mime: DOCX, changeNote: `Создано по шаблону «${template.name}», редакция ${version.version_number}`,
    templateSource: sourceOf(template, version) });
}

router.get('/', handle((req, res) => {
  const templates = db.prepare(`SELECT * FROM contract_templates WHERE tenant_id = ?
    AND (? = 1 OR direction <> 'FM') ORDER BY archived, name, id`).all(req.tenantId, req.user.permissions.accessFM ? 1 : 0);
  res.json({ templates: templates.map(templateView), canManage: !!req.user.permissions.manageContractTemplates && !req.user.permissions.readOnly,
    canUse: !req.user.permissions.readOnly });
}));
router.post('/', requirePermission('manageContractTemplates'), receiveFile(4), handle((req, res) => {
  const name = field(req.body.name, 'Название', 160);
  const type = field(req.body.contractType, 'Тип договора', 120);
  const note = field(req.body.changeNote, 'Описание редакции', 2000);
  const direction = req.body.direction;
  if (!['CF&A', 'FM'].includes(direction)) throw new ContractError(400, 'Выберите направление CF&A или FM');
  if (direction === 'FM' && !req.user.permissions.accessFM) throw new ContractError(403, 'Нет доступа к шаблонам FM');
  const file = fileData(req.file);
  const result = transaction(() => {
    const created = db.prepare('INSERT INTO contract_templates (tenant_id, name, contract_type, direction, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(req.tenantId, name, type, direction, new Date().toISOString());
    const version = insertTemplateVersion(req, created.lastInsertRowid, 1, file, note);
    audit(req, created.lastInsertRowid, 'created', `Шаблон «${name}» создан`);
    return { template: templateView(db.prepare('SELECT * FROM contract_templates WHERE tenant_id = ? AND id = ?').get(req.tenantId, created.lastInsertRowid)), version };
  });
  res.status(201).json(result);
}));
router.get('/:id', handle((req, res) => {
  const template = getTemplate(req);
  const versions = db.prepare(`SELECT ${VERSION_META} FROM contract_template_versions
    WHERE tenant_id = ? AND template_id = ? ORDER BY version_number DESC`).all(req.tenantId, template.id);
  res.json({ template: templateView(template), versions: versions.map(versionView) });
}));
router.post('/:id/versions', requirePermission('manageContractTemplates'), handle((req, res, next) => { activeTemplate(getTemplate(req)); next(); }),
  receiveFile(2), handle((req, res) => {
    const template = getTemplate(req); activeTemplate(template);
    const expected = integer(req.body.expectedVersion, 'Номер редакции');
    if (expected !== template.latest_version) throw new ContractError(409, 'У шаблона появилась новая редакция. Обновите историю');
    const note = field(req.body.changeNote, 'Описание редакции', 2000);
    const file = fileData(req.file);
    const last = db.prepare('SELECT sha256 FROM contract_template_versions WHERE tenant_id = ? AND template_id = ? AND version_number = ?')
      .get(req.tenantId, template.id, expected);
    if (last.sha256 === file.hash) throw new ContractError(409, 'Этот файл уже является текущей редакцией шаблона');
    const version = transaction(() => {
      const updated = db.prepare(`UPDATE contract_templates SET latest_version = latest_version + 1, revision = revision + 1
        WHERE tenant_id = ? AND id = ? AND latest_version = ? AND archived = 0`).run(req.tenantId, template.id, expected);
      if (!updated.changes) throw new ContractError(409, 'Шаблон изменился. Обновите историю');
      const created = insertTemplateVersion(req, template.id, expected + 1, file, note);
      audit(req, template.id, 'version_added', `Шаблон «${template.name}»: редакция ${expected + 1}`);
      return created;
    });
    res.status(201).json({ version });
  }));
router.post('/:id/archive', requirePermission('manageContractTemplates'), handle((req, res) => {
  const template = getTemplate(req);
  if (typeof req.body?.archived !== 'boolean') throw new ContractError(400, 'Укажите состояние архива');
  const expected = integer(req.body.expectedRevision, 'Состояние шаблона');
  const updated = db.prepare(`UPDATE contract_templates SET archived = ?, revision = revision + 1
    WHERE tenant_id = ? AND id = ? AND revision = ?`).run(req.body.archived ? 1 : 0, req.tenantId, template.id, expected);
  if (!updated.changes) throw new ContractError(409, 'Шаблон изменился. Обновите список');
  audit(req, template.id, req.body.archived ? 'archived' : 'restored', `Шаблон «${template.name}»: ${req.body.archived ? 'в архиве' : 'восстановлен'}`);
  res.json({ template: templateView(getTemplate(req)) });
}));
router.get('/:id/versions/:versionId/file', handle((req, res) => {
  const template = getTemplate(req), version = getVersion(req, template, true);
  res.attachment(version.original_name).type(DOCX).send(Buffer.from(version.file_bytes));
}));

router.post('/:id/versions/:versionId/apply', handle((req, res) => {
  const template = getTemplate(req); activeTemplate(template);
  const engagementId = integer(req.body?.engagementId, 'Договор');
  if (integer(req.body.expectedVersion, 'Версия документа', true) !== 0) throw new ContractError(409, 'Шаблон применяется только к пустому черновику');
  const contract = assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, engagementId));
  if (contract.document_version || contract.status !== 'Draft' || contract.contract_url || contract.lpa_url || contract.signed_date || contract.lp_signed_date) {
    throw new ContractError(409, 'Выберите черновик без документа и даты подписания');
  }
  const direction = contract.direction === 'FM' || contract.service_type === 'LP Investment (FM)' ? 'FM' : 'CF&A';
  const client = contract.client_id == null ? null : db.prepare('SELECT direction FROM ob_clients WHERE tenant_id = ? AND id = ?').get(req.tenantId, contract.client_id);
  if (template.direction !== direction || (client && (client.direction === 'FM' ? 'FM' : 'CF&A') !== template.direction)) {
    throw new ContractError(400, 'Направление шаблона не совпадает с направлением договора и клиента');
  }
  const version = getVersion(req, template, true);
  const copied = transaction(() => copyVersion(req, contract, template, version));
  res.status(201).json({ version: copied, currentVersion: 1 });
}));

router.post('/:id/versions/:versionId/create-contract', handle((req, res) => {
  const template = getTemplate(req), source = getVersion(req, template, true), b = req.body || {};
  if (template.direction !== 'CF&A') throw new ContractError(400, 'Договоры FM создаются в онбординге. Примените шаблон к существующему пустому черновику');
  const clientId = integer(b.clientId, 'Клиент');
  const client = db.prepare('SELECT * FROM ob_clients WHERE tenant_id = ? AND id = ?').get(req.tenantId, clientId);
  if (!client) throw new ContractError(404, 'Клиент не найден');
  assertContractAccess(req, { client_id: client.id, direction: client.direction });
  if (client.direction === 'FM') throw new ContractError(400, 'Выберите клиента CF&A');
  if (!['Advising', 'Arranging', 'Both'].includes(b.serviceType)) throw new ContractError(400, 'Выберите тип услуги');
  if (!['Fixed Fee', 'Success Fee', 'Retainer', 'Комбинированный'].includes(b.feeType)) throw new ContractError(400, 'Выберите тип вознаграждения');
  if (typeof b.feeAmount !== 'number' || !Number.isFinite(b.feeAmount) || b.feeAmount < 0 || b.feeAmount > 1e12) throw new ContractError(400, 'Сумма должна быть неотрицательным конечным числом');
  if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) throw new ContractError(400, 'Укажите трёхбуквенный код валюты');
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0, 10) !== b.date) throw new ContractError(400, 'Укажите корректную дату договора');
  const requestKey = field(b.requestKey, 'Ключ запроса', 64);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(requestKey)) throw new ContractError(400, 'Обновите форму создания договора');
  const input = { clientId, serviceType: b.serviceType, feeType: b.feeType, feeAmount: b.feeAmount, currency: b.currency,
    date: b.date, notes: field(b.notes, 'Примечание', 5000, false), dealRef: field(b.dealRef, 'Deal Ref', 120, false), templateVersionId: source.id };
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const result = transaction(() => {
    const previous = db.prepare('SELECT * FROM contract_template_uses WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, requestKey);
    if (previous) {
      if (previous.created_by !== req.user.id || previous.payload_hash !== hash) throw new ContractError(409, 'Этот запрос уже использован с другими данными. Откройте новую форму');
      const existing = assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, previous.engagement_id));
      return { contract: rowToEngagement(existing), reused: true };
    }
    activeTemplate(template);
    const params = engagementToParams({ ...input, clientName: client.name, direction: 'CF&A', status: 'Draft',
      rm: req.user.name || req.user.email, startDate: input.date, paid: 0, invoiced: 0, payTerms: 'При подписании' });
    const info = db.prepare(ENGAGEMENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
    const suffix = String(info.lastInsertRowid).padStart(3, '0');
    const year = new Date().getUTCFullYear();
    db.prepare('UPDATE engagements SET eng_id = ?, contract_num = ? WHERE tenant_id = ? AND id = ?')
      .run(`ENG-${year}-${suffix}`, `GL-${year}-${suffix}`, req.tenantId, info.lastInsertRowid);
    const contract = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, info.lastInsertRowid);
    copyVersion(req, contract, template, source);
    db.prepare(`INSERT INTO contract_template_uses (tenant_id, request_key, created_by, payload_hash, engagement_id, template_version_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(req.tenantId, requestKey, req.user.id, hash, contract.id, source.id);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: contract.id, action: 'created', actorEmail: req.user.email,
      summary: `Договор с «${client.name}» создан по шаблону «${template.name}», редакция ${source.version_number}` });
    return { contract: rowToEngagement(db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, contract.id)), reused: false };
  });
  res.status(result.reused ? 200 : 201).json(result);
}));

module.exports = router;
