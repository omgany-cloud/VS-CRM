// One immutable conversation per contract, spanning file revisions and review
// cycles. Mounted below the approvals router's live auth/internal middleware.
const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { assertContractAccess, handle, transaction } = require('./contractDocuments');
const { ContractError, latestCycle } = require('./contractApprovalState');
const { recordAudit } = require('./auditLog');
const { mentionRefs, resolveMentions, mentionPeople } = require('./discussionMentions');
const { relatedDiscussions } = require('./discussionRelations');
const { messageUpload, validatedAttachments, attachmentFingerprint, saveAttachments, messageAttachments, sendAttachment } = require('./discussionFiles');
const router = express.Router({ mergeParams: true });
const PAGE_SIZE = 100;

function fail(message, status = 400) { throw new ContractError(status, message); }
function contractFor(req) {
  return assertContractAccess(req, db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(req.tenantId, req.params.id));
}
function canPost(req, cycle, contract) {
  if (req.user.permissions.readOnly) return false;
  if (req.user.permissions.manageContracts || req.user.permissions.manageContractRoutes) return true;
  if (db.prepare('SELECT id FROM contract_discussion_members WHERE tenant_id = ? AND engagement_id = ? AND user_id = ?').get(req.tenantId, contract.id, req.user.id)) return true;
  if (db.prepare('SELECT id FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ? AND created_by = ?')
    .get(req.tenantId, contract.id, contract.document_version, req.user.id)) return true;
  if (!cycle) return false;
  return cycle.initiator_id === req.user.id || !!db.prepare('SELECT id FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND assignee_id = ?')
    .get(req.tenantId, cycle.id, req.user.id);
}
function messageView(row) {
  return { id: row.id, authorId: row.author_id, author: row.author_name, text: row.body, createdAt: row.created_at,
    cycleId: row.cycle_id, versionId: row.document_version_id, version: row.document_version,
    mentions: JSON.parse(row.mentions_json),
    attachments: messageAttachments(row.tenant_id, row.id, true) };
}
function cursor(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail('Некорректный указатель сообщений');
  return Number(value);
}

router.get('/people', handle((req, res) => {
  const contract = contractFor(req), cycle = latestCycle(req.tenantId, contract.id);
  res.json({ people: mentionPeople(req, person => assertContractAccess(person, contract), person => canPost(person, cycle, contract)) });
}));
router.get('/', handle((req, res) => {
  const contract = contractFor(req), cycle = latestCycle(req.tenantId, contract.id);
  const after = cursor(req.query.after), before = cursor(req.query.before);
  if (after != null && before != null) fail('Укажите только один указатель сообщений');
  const ascending = after != null;
  const rows = db.prepare(`SELECT * FROM contract_discussion_messages WHERE tenant_id = ? AND engagement_id = ?
    ${ascending ? 'AND id > ?' : before != null ? 'AND id < ?' : ''} ORDER BY id ${ascending ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(req.tenantId, contract.id, ...(ascending ? [after] : before != null ? [before] : []), PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  if (hasMore) rows.pop();
  if (!ascending) rows.reverse();
  const documents = db.prepare(`SELECT id, version_number, original_name, created_by, author_name, created_at, change_note
    FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? ORDER BY version_number`).all(req.tenantId, contract.id)
    .map(v => ({ id: v.id, version: v.version_number, filename: v.original_name, authorId: v.created_by,
      author: v.author_name, createdAt: v.created_at, note: v.change_note }));
  res.json({ messages: rows.map(messageView), hasMore, nextBefore: !ascending && hasMore ? rows[0].id : null,
    nextAfter: rows.at(-1)?.id || after || 0, documents, canPost: canPost(req, cycle, contract),
    related: relatedDiscussions(req, { engagementId: contract.id }),
    participants: db.prepare(`SELECT u.id, u.name FROM contract_discussion_members m JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
      WHERE m.tenant_id = ? AND m.engagement_id = ? AND u.active = 1 ORDER BY u.name`).all(req.tenantId, contract.id),
    context: { cycleId: cycle?.id || null, version: contract.document_version } });
}));

router.get('/files/:fileId', handle((req, res) => {
  const contract = contractFor(req);
  const file = db.prepare(`SELECT f.* FROM discussion_files f JOIN contract_discussion_messages m ON m.id = f.contract_message_id AND m.tenant_id = f.tenant_id
    WHERE f.tenant_id = ? AND m.engagement_id = ? AND f.id = ?`).get(req.tenantId, contract.id, req.params.fileId);
  sendAttachment(res, file);
}));
router.post('/', handle((req, res, next) => {
  const contract = contractFor(req);
  if (!canPost(req, latestCycle(req.tenantId, contract.id), contract)) fail('Нет права отправлять сообщения в этот договор', 403);
  next();
}), messageUpload, handle((req, res) => {
  const contract = contractFor(req), b = req.body || {};
  const files = validatedAttachments(req);
  if (typeof b.text !== 'string' || (!b.text.trim() && !files.length) || b.text.trim().length > 4000) fail('Напишите сообщение до 4000 символов или приложите файл');
  if (typeof b.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(b.requestKey)) fail('Обновите форму сообщения');
  if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion < 0 ||
      (b.expectedCycleId != null && (!Number.isSafeInteger(b.expectedCycleId) || b.expectedCycleId < 1))) fail('Обновите состояние договора');
  const input = { engagementId: contract.id, text: b.text.trim(), expectedVersion: b.expectedVersion, expectedCycleId: b.expectedCycleId ?? null };
  if (files.length) input.attachments = attachmentFingerprint(files);
  const refs = mentionRefs(b.mentions, b.text);
  if (refs.length) input.mentions = refs;
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const result = transaction(() => {
    const current = contractFor(req), cycle = latestCycle(req.tenantId, current.id);
    if (!canPost(req, cycle, current)) fail('Писать могут участники текущего согласования, автор редакции и сотрудники, ведущие договор', 403);
    const old = db.prepare('SELECT * FROM contract_discussion_messages WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, b.requestKey);
    if (old) {
      if (old.author_id !== req.user.id || old.payload_hash !== hash) fail('Ключ сообщения уже использован. Обновите карточку.', 409);
      return { message: messageView(old), reused: true };
    }
    if (current.document_version !== input.expectedVersion || (cycle?.id || null) !== input.expectedCycleId) {
      fail('Редакция или согласование изменились. Сообщение не отправлено; проверьте новое состояние и отправьте снова.', 409);
    }
    const mentions = resolveMentions(req, refs, input.text, person => assertContractAccess(person, current));
    const invited = db.prepare('SELECT user_id FROM contract_discussion_members WHERE tenant_id = ? AND engagement_id = ?').all(req.tenantId, current.id);
    if (new Set([...invited.map(m => m.user_id), ...mentions.map(m => m.userId)]).size > 50) fail('В задаче может быть до 50 приглашённых сотрудников');
    for (const uid of new Set(mentions.map(m => m.userId))) db.prepare(`INSERT OR IGNORE INTO contract_discussion_members
      (tenant_id, engagement_id, user_id, added_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(req.tenantId, current.id, uid, req.user.id, new Date().toISOString());
    const version = db.prepare('SELECT id FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
      .get(req.tenantId, current.id, current.document_version);
    const created = db.prepare(`INSERT INTO contract_discussion_messages
      (tenant_id, engagement_id, cycle_id, document_version_id, document_version, author_id, author_name, body, created_at, request_key, payload_hash, mentions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.tenantId, current.id, cycle?.id || null, version?.id || null,
        current.document_version, req.user.id, req.user.name || req.user.email, input.text, new Date().toISOString(), b.requestKey, hash, JSON.stringify(mentions));
    saveAttachments(req.tenantId, created.lastInsertRowid, files, true);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: current.id, action: 'contract_message',
      actorEmail: req.user.email, summary: `Сообщение в задаче по договору «${current.contract_num || current.client_name}»` });
    return { message: messageView(db.prepare('SELECT * FROM contract_discussion_messages WHERE tenant_id = ? AND id = ?').get(req.tenantId, created.lastInsertRowid)), reused: false };
  });
  res.status(result.reused ? 200 : 201).json(result);
}));

module.exports = router;
