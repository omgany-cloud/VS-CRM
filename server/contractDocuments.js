// Immutable contract revisions. Every download rechecks the contract/client
// barrier and live authentication; files are never exposed through /api/uploads.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const AdmZip = require('adm-zip');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { recordAudit } = require('./auditLog');
const { ContractError, contractMetadata, documentFrozen, assertApprovalEditable, approvalSummary } = require('./contractApprovalState');

const MAX_BYTES = 20 * 1024 * 1024;
const META_COLUMNS = `id, version_number, original_name, mime_type, size_bytes,
  sha256, change_note, metadata_json, created_by, author_name, author_email, created_at, template_source_json`;

function assertContractAccess(req, row) {
  if (!row) throw new ContractError(404, 'Договор не найден');
  const client = row.client_id == null ? null : db.prepare(
    'SELECT direction FROM ob_clients WHERE tenant_id = ? AND id = ?'
  ).get(req.tenantId, row.client_id);
  // Fail closed for an invalid legacy client reference, including another tenant.
  if (row.client_id != null && !client) throw new ContractError(404, 'Клиент договора не найден');
  if (!req.user.permissions.accessFM &&
      (row.direction === 'FM' || row.service_type === 'LP Investment (FM)' || client?.direction === 'FM')) {
    throw new ContractError(403, 'Нет доступа к договорам направления FM');
  }
  return row;
}

function getContract(req) {
  return assertContractAccess(req, db.prepare(
    'SELECT * FROM engagements WHERE tenant_id = ? AND id = ?'
  ).get(req.tenantId, req.params.id));
}

function versionView(row) {
  return {
    id: row.id, version: row.version_number, name: row.original_name,
    mimeType: row.mime_type, size: row.size_bytes, sha256: row.sha256,
    changeNote: row.change_note, metadata: JSON.parse(row.metadata_json),
    author: row.author_name, authorEmail: row.author_email, createdAt: row.created_at,
    templateSource: row.template_source_json ? JSON.parse(row.template_source_json) : null,
  };
}

function handle(fn) {
  return (req, res, next) => {
    try { fn(req, res, next); }
    catch (err) {
      if (err instanceof ContractError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

function originalFilename(value) {
  // Multipart filenames from browsers arrive as UTF-8 bytes decoded as latin1.
  let name = String(value || '');
  if ([...name].every(c => c.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) name = decoded;
  }
  return path.posix.basename(name.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 240);
}

function validateFile(file, filename) {
  if (!file?.buffer?.length) throw new ContractError(400, 'Выберите непустой файл DOCX или PDF');
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (extension === '.docx') {
    try {
      const zip = new AdmZip(file.buffer);
      if (zip.getEntry('[Content_Types].xml') && zip.getEntry('word/document.xml') && !zip.getEntry('word/vbaProject.bin')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
    } catch (_) { /* malformed package -> ordinary validation error */ }
  }
  throw new ContractError(400, 'Файл должен быть документом DOCX без макросов или PDF');
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

// Caller owns the transaction, so template copy + contract creation + revision
// are atomic together. The same invariants also apply to ordinary file uploads.
function insertContractVersion(req, contract, { expected, buffer, name, mime, changeNote, templateSource = null }) {
  assertApprovalEditable(contract);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const metadata = JSON.stringify(contractMetadata(contract));
  const previous = db.prepare(`SELECT sha256, metadata_json FROM engagement_document_versions
    WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?`).get(req.tenantId, contract.id, expected);
  if (previous?.sha256 === sha256 && previous.metadata_json === metadata) {
    throw new ContractError(409, 'Этот файл уже является текущей версией; реквизиты также не изменились');
  }
  const updated = db.prepare(`UPDATE engagements SET document_version = document_version + 1
    WHERE tenant_id = ? AND id = ? AND document_version = ?`).run(req.tenantId, contract.id, expected);
  if (!updated.changes) throw new ContractError(409, 'Версия изменилась. Обновите историю');
  const result = db.prepare(`INSERT INTO engagement_document_versions
    (tenant_id, engagement_id, version_number, original_name, mime_type, size_bytes, sha256, file_bytes,
     change_note, metadata_json, created_by, author_name, author_email, created_at, source_template_version_id, template_source_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.tenantId, contract.id, expected + 1, name, mime, buffer.length, sha256, buffer,
    changeNote, metadata, req.user.id, req.user.name || req.user.email, req.user.email, new Date().toISOString(),
    templateSource?.id || null, templateSource ? JSON.stringify(templateSource) : null);
  const row = db.prepare(`SELECT ${META_COLUMNS} FROM engagement_document_versions WHERE tenant_id = ? AND id = ?`)
    .get(req.tenantId, result.lastInsertRowid);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: contract.id,
    action: 'document_version_added', actorEmail: req.user.email,
    summary: `Договор «${contract.contract_num || contract.client_name}»: загружена версия ${expected + 1}` });
  return versionView(row);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 2, fieldSize: 12 * 1024, parts: 4 },
}).single('file');

const router = express.Router();
router.use(requireAuth, requireInternal);
// A live projection of onboarding, not a second editable approval status.
// Completion of a task or client activation never implies document approval.
router.get('/:id/process', handle((req, res) => {
  const contract = getContract(req);
  const client = contract.client_id == null ? null : db.prepare(
    'SELECT id, name, direction, phase, activated FROM ob_clients WHERE tenant_id = ? AND id = ?'
  ).get(req.tenantId, contract.client_id);
  const tasks = client ? db.prepare(`SELECT id, task_num, title, status, due_date FROM ob_tasks
    WHERE tenant_id = ? AND client_id = ? ORDER BY task_num, id`).all(req.tenantId, client.id) : [];
  res.set('Cache-Control', 'no-store');
  res.json({
    engagementId: contract.id, contractKind: contract.contract_kind || 'client',
    client: client ? { id: client.id, name: client.name, direction: client.direction, phase: client.phase, activated: !!client.activated } : null,
    tasks: tasks.map(t => ({ id: t.id, number: t.task_num, title: t.title, status: t.status, dueDate: t.due_date })),
    documentVersion: contract.document_version,
    serviceStatus: contract.status,
    recordedSignatureDate: contract.signed_date || contract.lp_signed_date || null,
    approval: approvalSummary(contract),
  });
}));
router.get('/:id/versions', handle((req, res) => {
  const contract = getContract(req);
  const rows = db.prepare(`SELECT ${META_COLUMNS} FROM engagement_document_versions
    WHERE tenant_id = ? AND engagement_id = ? ORDER BY version_number DESC`).all(req.tenantId, contract.id);
  res.set('Cache-Control', 'no-store');
  res.json({ versions: rows.map(versionView), currentVersion: contract.document_version,
    canUpload: !req.user.permissions.readOnly && !documentFrozen(contract),
    frozen: documentFrozen(contract),
    metadataChanged: !!rows.length && rows[0].metadata_json !== JSON.stringify(contractMetadata(contract)),
  });
}));

// Reject inaccessible parents before accepting a multipart body. Check again
// after receiving it: another request may have changed the parent meanwhile.
router.post('/:id/versions', handle((req, res, next) => { getContract(req); next(); }), (req, res, next) => {
  upload(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 20 МиБ' : 'Загрузите один файл и заполните причину изменения',
    });
    next();
  });
}, handle((req, res) => {
  const contract = getContract(req);
  const changeNote = typeof req.body?.changeNote === 'string' ? req.body.changeNote.trim() : '';
  if (!changeNote || changeNote.length > 2000) throw new ContractError(400, 'Укажите причину изменения: от 1 до 2000 символов');
  const expectedText = req.body?.expectedVersion;
  if (typeof expectedText !== 'string' || !/^(0|[1-9]\d*)$/.test(expectedText) || !Number.isSafeInteger(Number(expectedText))) {
    throw new ContractError(400, 'Обновите историю версий перед загрузкой');
  }
  const expected = Number(expectedText);
  if (expected !== contract.document_version) throw new ContractError(409, 'У договора уже появилась новая версия. Обновите историю и проверьте документ');
  const name = originalFilename(req.file?.originalname);
  const mime = validateFile(req.file, name);
  const version = transaction(() => insertContractVersion(req, contract, {
    expected, buffer: req.file.buffer, name, mime, changeNote,
  }));
  res.status(201).json({ version, currentVersion: expected + 1 });
}));

// Owner's request 30.10.2026: a DOCX or PDF attached in the contract's task
// becomes a revision only by this explicit command, with its own reason;
// approval and signing always use the revisions, never chat attachments.
router.post('/:id/versions/from-attachment', handle((req, res) => {
  const contract = getContract(req), b = req.body || {};
  const changeNote = typeof b.changeNote === 'string' ? b.changeNote.trim() : '';
  if (!changeNote || changeNote.length > 2000) throw new ContractError(400, 'Укажите причину изменения: от 1 до 2000 символов');
  if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0) throw new ContractError(400, 'Обновите историю версий');
  if (b.expectedVersion !== contract.document_version) throw new ContractError(409, 'У договора уже появилась новая версия. Обновите историю и проверьте документ');
  const file = Number.isSafeInteger(b.fileId) && db.prepare(`SELECT f.original_name, f.file_bytes FROM discussion_files f
    JOIN contract_discussion_messages m ON m.id = f.contract_message_id AND m.tenant_id = f.tenant_id
    WHERE f.tenant_id = ? AND m.engagement_id = ? AND f.id = ?`).get(req.tenantId, contract.id, b.fileId);
  if (!file) throw new ContractError(404, 'Вложение не найдено в задаче этого договора');
  const buffer = Buffer.from(file.file_bytes), mime = validateFile({ buffer }, file.original_name);
  const version = transaction(() => insertContractVersion(req, contract, {
    expected: b.expectedVersion, buffer, name: file.original_name, mime, changeNote,
  }));
  res.status(201).json({ version, currentVersion: b.expectedVersion + 1 });
}));

router.get('/:id/versions/:versionId/file', handle((req, res) => {
  const contract = getContract(req);
  const row = db.prepare(`SELECT original_name, mime_type, file_bytes FROM engagement_document_versions
    WHERE tenant_id = ? AND engagement_id = ? AND id = ?`).get(req.tenantId, contract.id, req.params.versionId);
  if (!row) throw new ContractError(404, 'Версия документа не найдена');
  res.set('Cache-Control', 'no-store');
  res.attachment(row.original_name);
  res.type(row.mime_type);
  res.send(Buffer.from(row.file_bytes));
}));

module.exports = { router, assertContractAccess, ContractError, handle, originalFilename, validateFile, transaction, insertContractVersion };
