const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const AdmZip = require('adm-zip');
const { db } = require('./db');
const { originalFilename, validateFile, ContractError } = require('./contractDocuments');
const MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 5, fields: 1, fieldSize: 20000, parts: 7 } }).array('files', 5);

function messageUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  upload(req, res, err => {
    if (err) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'До 5 файлов, каждый до 10 МиБ, всего до 25 МиБ' });
    try { req.body = JSON.parse(req.body.payload); }
    catch (_) { return res.status(400).json({ error: 'Некорректное сообщение' }); }
    next();
  });
}
function validatedAttachments(req) {
  const files = req.files || [];
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL) throw new ContractError(413, 'Общий размер вложений — до 25 МиБ');
  return files.map(file => {
    const name = originalFilename(file.originalname), ext = path.extname(name).toLowerCase(), bytes = file.buffer;
    if (!bytes?.length) throw new ContractError(400, 'Нельзя приложить пустой файл');
    let mime;
    if (['.pdf', '.docx'].includes(ext)) mime = validateFile(file, name);
    else if (ext === '.xlsx') {
      try {
        const zip = new AdmZip(bytes);
        if (zip.getEntry('[Content_Types].xml') && zip.getEntry('xl/workbook.xml') && !zip.getEntries().some(e => /vbaProject\.bin$/i.test(e.entryName))) mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } catch (_) { /* validation below */ }
    } else if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
    else if (['.txt', '.csv'].includes(ext) && !bytes.includes(0) && !bytes.toString('utf8').includes('\uFFFD')) mime = 'text/plain; charset=utf-8';
    if (!mime) throw new ContractError(400, 'Поддерживаются PDF, DOCX, XLSX, PNG, JPG, TXT и CSV без макросов');
    return { name, mime, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes };
  });
}
function attachmentFingerprint(files) { return files.map(({ name, size, sha256 }) => ({ name, size, sha256 })); }
function saveAttachments(tenantId, messageId, files, contract = false) {
  const stmt = db.prepare(`INSERT INTO discussion_files (tenant_id, ${contract ? 'contract_message_id' : 'message_id'}, original_name, mime_type, size_bytes, sha256, file_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const f of files) stmt.run(tenantId, messageId, f.name, f.mime, f.size, f.sha256, f.bytes);
}
function messageAttachments(tenantId, messageId, contract = false) {
  return db.prepare(`SELECT id, original_name AS name, mime_type AS mime, size_bytes AS size FROM discussion_files WHERE tenant_id = ? AND ${contract ? 'contract_message_id' : 'message_id'} = ? ORDER BY id`).all(tenantId, messageId);
}
function sendAttachment(res, row) {
  if (!row) throw new ContractError(404, 'Вложение не найдено');
  res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
  res.attachment(row.original_name); res.type(row.mime_type); res.send(Buffer.from(row.file_bytes));
}
module.exports = { messageUpload, validatedAttachments, attachmentFingerprint, saveAttachments, messageAttachments, sendAttachment };
