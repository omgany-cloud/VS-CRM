const express = require('express');
const crypto = require('crypto');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { rowToPermissions } = require('./rolesMapping');
const { handle, transaction, ContractError } = require('./contractDocuments');
const { getSource, sourceView, listSources, sourceCategories, SOURCES } = require('./discussionSources');
const { messageUpload, validatedAttachments, attachmentFingerprint, saveAttachments, messageAttachments, conversationAttachments, sendAttachment } = require('./discussionFiles');
const { recordAudit } = require('./auditLog');
const { mentionRefs, resolveMentions, mentionPeople } = require('./discussionMentions');
const { relatedDiscussions, relationSources, addRelation } = require('./discussionRelations');
const {replyId,replyTarget}=require('./discussionReplies');
const {purgeTask}=require('./discussionPurge');
const {taskState,taskView,taskAssignees,assertTaskOpen,dueDate,initializeDueDate,changeTask,taskUnread,markTaskRead} = require('./discussionTasks');
const router = express.Router();
router.use(requireAuth, requireInternal, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const fail = (text, status = 400) => { throw new ContractError(status, text); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requestKey(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(value)) fail('Обновите форму и повторите'); return value; }
function members(req, roomId) {
  return db.prepare(`SELECT u.id, u.name, u.active FROM discussion_members m JOIN users u ON u.id = m.user_id AND u.tenant_id = m.tenant_id
    WHERE m.tenant_id = ? AND m.room_id = ? ORDER BY u.name, u.id`).all(req.tenantId, roomId);
}
function links(req, roomId) {
  return db.prepare('SELECT kind, entity_id FROM discussion_links WHERE tenant_id = ? AND room_id = ? ORDER BY kind, entity_id').all(req.tenantId, roomId)
    .map(l => sourceView(getSource(req, l.kind, l.entity_id)));
}
function roomFor(req, owner = false) {
  const room = db.prepare(`SELECT r.* FROM discussion_rooms r JOIN discussion_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.id = ? AND m.user_id = ?`).get(req.tenantId, req.params.id, req.user.id);
  if (!room) fail('Задача не найдена', 404);
  const linked = links(req, room.id); // Live permissions, including every linked object.
  if (owner && room.created_by !== req.user.id) fail('Участников и связи меняет создатель задачи', 403);
  return { ...room, links: linked };
}
function people(req) {
  return db.prepare(`SELECT u.id, u.name, r.label AS role FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = u.role
    WHERE u.tenant_id = ? AND u.active = 1 AND r.internal = 1 ORDER BY u.name, u.id`).all(req.tenantId);
}
function staffRequest(req, id) {
  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ?').get(req.tenantId, id);
  const role = user && db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(req.tenantId, user.role);
  if (!user?.active || !role?.internal) fail('Выберите действующих сотрудников своей компании');
  return { tenantId: req.tenantId, user: { ...user, permissions: rowToPermissions(role) } };
}
function participantIds(req, value) {
  if (!Array.isArray(value) || value.length > 50 || value.some(id => !Number.isSafeInteger(id) || id < 1)) fail('Выберите до 50 участников');
  const ids = [...new Set([req.user.id, ...value])].sort((a,b) => a-b);
  if (ids.length > 50) fail('В задаче может быть до 50 участников');
  ids.forEach(id => staffRequest(req, id));
  return ids;
}
function checkSharing(req, ids, linked) {
  for (const id of ids) {
    const person = staffRequest(req, id);
    for (const link of linked) {
      try { getSource(person, link.kind, link.id); }
      catch (err) { if (err instanceof ContractError) fail('Не у всех выбранных участников есть доступ к связанному процессу', 403); throw err; }
    }
  }
}
function viewMessage(row) {
  return { id: row.id, authorId: row.author_id, author: row.author_name, text: row.body, createdAt: row.created_at,
    mentions: JSON.parse(row.mentions_json), replyTo: replyTarget(row.tenant_id,row.room_id,row.reply_to_id),
    attachments: messageAttachments(row.tenant_id, row.id) };
}
function audit(req, id, summary) { recordAudit(db, { tenantId: req.tenantId, entityType: 'discussion_rooms', entityId: id, action: 'discussion', actorEmail: req.user.email, summary }); }

router.get('/people', handle((req, res) => res.json({ people: people(req) })));
router.post('/:kind/:id/state', handle((req,res) => res.json(changeTask(req,req.params.kind,Number(req.params.id),req.body))));
router.delete('/:kind/:id',handle((req,res)=>res.json(purgeTask(req,req.params.kind,Number(req.params.id),req.body))));
router.post('/:kind/:id/read', handle((req,res) => res.json(markTaskRead(req,req.params.kind,Number(req.params.id),req.body?.lastMessageId))));
router.get('/:kind/:id/assignees', handle((req,res)=>res.json({people:taskAssignees(req,req.params.kind,Number(req.params.id))})));
router.get('/sources', handle((req, res) => {
  const sources = listSources(req);
  res.json({ categories: sourceCategories(req, sources), items: [...relationSources(req), ...sources.filter(s => s.kind === 'contract' && taskState(req.tenantId,'contract',s.id).status !== 'trashed').map(s => ({ ...s, title:taskState(req.tenantId,'contract',s.id).title||s.title, kind: 'contract-chat', label: 'Подзадача по договору' })), ...sources] });
}));
router.get('/source/:kind/:entityId', handle((req, res) => {
  const source = sourceView(getSource(req, req.params.kind, req.params.entityId));
  const items = [];
  for (const row of db.prepare(`SELECT r.* FROM discussion_rooms r JOIN discussion_links l ON l.room_id = r.id AND l.tenant_id = r.tenant_id
    JOIN discussion_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND l.kind = ? AND l.entity_id = ? AND m.user_id = ? ORDER BY r.id DESC`).all(req.tenantId, source.kind, source.id, req.user.id)) {
    try { links(req, row.id); } catch (err) { if (err instanceof ContractError) continue; throw err; }
    const task = taskState(req.tenantId,'room',row.id);
    if (task.status !== 'trashed') items.push({ kind: 'room', id: row.id, title: row.title, task });
  }
  if (source.kind === 'contract') {const task=taskState(req.tenantId,'contract',source.id);if(!task.purgedAt)items.unshift({ kind: 'contract', id: source.id, title:task.title||'Задача по договору · '+source.title, task });}
  res.json({ source, items, canCreate: !req.user.permissions.readOnly });
}));
router.get('/', handle((req, res) => {
  const rooms = db.prepare(`SELECT r.* FROM discussion_rooms r JOIN discussion_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND m.user_id = ?`).all(req.tenantId, req.user.id);
  const items = [];
  for (const r of rooms) {
    let sources; try { sources = links(req, r.id); } catch (err) { if (err instanceof ContractError) continue; throw err; }
    const latest = db.prepare('SELECT body, created_at, author_name FROM discussion_messages WHERE tenant_id = ? AND room_id = ? ORDER BY id DESC LIMIT 1').get(req.tenantId, r.id);
    items.push({ kind: 'room', id: r.id, title: r.title, label: 'Задача', sources, task: taskView(req,'room',r.id,r), unread: taskUnread(req,'room',r.id), lastAuthor: latest?.author_name || '', createdAt: r.created_at, preview: latest?.body || (latest ? 'Вложение' : 'Пока нет сообщений'), updatedAt: latest?.created_at || r.created_at });
  }
  for (const row of db.prepare('SELECT id FROM engagements WHERE tenant_id = ?').all(req.tenantId)) {
    if(taskState(req.tenantId,'contract',row.id).purgedAt)continue;
    let source; try { source = getSource(req, 'contract', row.id); } catch (err) { if (err instanceof ContractError) continue; throw err; }
    const latest = db.prepare('SELECT body, created_at, author_name FROM contract_discussion_messages WHERE tenant_id = ? AND engagement_id = ? ORDER BY id DESC LIMIT 1').get(req.tenantId, row.id);
    const task=taskView(req,'contract',row.id,source.row);
    items.push({ ...sourceView(source), title:task.title, sources: [sourceView(source)], task, unread: taskUnread(req,'contract',row.id), lastAuthor: latest?.author_name || '', createdAt: source.row.created_at, preview: latest?.body || (latest ? 'Вложение' : 'Задача по договору'), updatedAt: latest?.created_at || source.row.created_at || '' });
  }
  items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id-a.id);
  res.json({ items, categories: sourceCategories(req, []).map(({count, ...category}) => category), canCreate: !req.user.permissions.readOnly });
}));
router.post('/', handle((req, res) => {
  const b = req.body || {}, key = requestKey(b.requestKey);
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 160) fail('Укажите название задачи: до 160 символов');
  const ids = participantIds(req, b.participants ?? []), title = b.title.trim();
  const deadline = dueDate(b.dueDate);
  const source = b.source == null ? null : getSource(req, b.source.kind, b.source.id);
  if (source) checkSharing(req, ids, [source]);
  const payload = { title, ids }; if (source) payload.source = { kind: source.kind, id: source.id };
  if (deadline) payload.dueDate = deadline;
  const hash = digest(payload);
  const result = transaction(() => {
    const old = db.prepare('SELECT * FROM discussion_rooms WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) { if (old.created_by !== req.user.id || old.payload_hash !== hash) fail('Ключ уже использован', 409); return { id: old.id, reused: true }; }
    const id = Number(db.prepare('INSERT INTO discussion_rooms (tenant_id, title, created_by, created_at, request_key, payload_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.tenantId, title, req.user.id, new Date().toISOString(), key, hash).lastInsertRowid);
    for (const uid of ids) db.prepare('INSERT INTO discussion_members (tenant_id, room_id, user_id) VALUES (?, ?, ?)').run(req.tenantId, id, uid);
    initializeDueDate(req,'room',id,deadline);
    if (source) db.prepare('INSERT INTO discussion_links (tenant_id, room_id, kind, entity_id) VALUES (?, ?, ?, ?)').run(req.tenantId, id, source.kind, source.id);
    audit(req, id, 'Создана задача'); return { id, reused: false };
  });
  res.status(result.reused ? 200 : 201).json(result);
}));
router.get('/:id/people', handle((req, res) => {
  const room = roomFor(req), ids = new Set(members(req, room.id).map(m => m.id));
  res.json({ people: mentionPeople(req, person => { for (const link of room.links) getSource(person, link.kind, link.id); }, person => ids.has(person.user.id)) });
}));
router.get('/:id', handle((req, res) => {
  const room = roomFor(req);
  const cursor = name => {
    if (req.query[name] == null) return null;
    if (typeof req.query[name] !== 'string' || !/^(0|[1-9]\d*)$/.test(req.query[name]) || !Number.isSafeInteger(Number(req.query[name]))) fail('Некорректный указатель сообщений');
    return Number(req.query[name]);
  };
  const after = cursor('after'), before = cursor('before');
  if (after !== null && before !== null) fail('Укажите один указатель сообщений');
  const rows = db.prepare(`SELECT * FROM discussion_messages WHERE tenant_id = ? AND room_id = ?
    ${after !== null ? 'AND id > ?' : before !== null ? 'AND id < ?' : ''} ORDER BY id ${after !== null ? 'ASC' : 'DESC'} LIMIT 101`)
    .all(req.tenantId, room.id, ...(after !== null ? [after] : before !== null ? [before] : []));
  const hasMore = rows.length > 100; if (hasMore) rows.pop(); if (after === null) rows.reverse();
  const task = taskView(req,'room',room.id,room);
  res.json({ task, room: { id: room.id, title: room.title, createdBy: room.created_by, createdAt: room.created_at, members: members(req, room.id), links: [...room.links, ...relatedDiscussions(req, { roomId: room.id })], canManage: task.canManage && task.status === 'open' },
    messages: rows.map(viewMessage), hasMore, nextAfter: rows.at(-1)?.id || after || 0, nextBefore: after === null && hasMore ? rows[0].id : null,
    canPost: !req.user.permissions.readOnly && task.status === 'open', userId: req.user.id, documents: [], context: {} });
}));
router.post('/:id/members', handle((req, res) => {
  transaction(() => {
    const room = roomFor(req, true), old = members(req, room.id), ids = participantIds(req, req.body?.participants);
    assertTaskOpen(req.tenantId,'room',room.id);
    const combined = [...new Set([...old.filter(m => m.active).map(m => m.id), ...ids])];
    if (combined.length > 50) fail('В задаче может быть до 50 участников');
    checkSharing(req, combined, room.links);
    for (const uid of ids) db.prepare('INSERT OR IGNORE INTO discussion_members (tenant_id, room_id, user_id) VALUES (?, ?, ?)').run(req.tenantId, room.id, uid);
    audit(req, room.id, 'Добавлены участники задачи');
  }); res.json({ ok: true });
}));
router.post('/:id/links', handle((req, res) => {
  transaction(() => {
    const room = roomFor(req, true);
    assertTaskOpen(req.tenantId,'room',room.id);
    if (['discussion', 'contract-chat'].includes(req.body?.kind)) {
      addRelation(req, room.id, req.body.kind, req.body.id); audit(req, room.id, 'Добавлена подзадача'); return;
    }
    const source = getSource(req, req.body?.kind, req.body?.id);
    if (room.links.length >= 20 && !room.links.some(l => l.kind === source.kind && l.id === source.id)) fail('В задаче может быть до 20 связанных процессов');
    checkSharing(req, members(req, room.id).filter(m => m.active).map(m => m.id), [source]);
    db.prepare('INSERT OR IGNORE INTO discussion_links (tenant_id, room_id, kind, entity_id) VALUES (?, ?, ?, ?)').run(req.tenantId, room.id, source.kind, source.id);
    audit(req, room.id, 'Добавлена связь с процессом');
  }); res.json({ ok: true });
}));
router.post('/:id/messages', handle((req, res, next) => { roomFor(req); next(); }), messageUpload, handle((req, res) => {
  const b = req.body || {}, key = requestKey(b.requestKey), files = validatedAttachments(req);
  if (typeof b.text !== 'string' || b.text.trim().length > 4000 || (!b.text.trim() && !files.length)) fail('Напишите сообщение до 4000 символов или приложите файл');
  const refs = mentionRefs(b.mentions, b.text);
  const replyToId=replyId(b.replyToId);
  const result = transaction(() => {
    const room = roomFor(req), input = { room: room.id, text: b.text.trim(), files: attachmentFingerprint(files) };
    if (refs.length) input.mentions = refs;
    if(replyToId)input.replyToId=replyToId;
    const hash = digest(input);
    const old = db.prepare('SELECT * FROM discussion_messages WHERE tenant_id = ? AND request_key = ?').get(req.tenantId, key);
    if (old) { if (old.author_id !== req.user.id || old.payload_hash !== hash) fail('Ключ сообщения уже использован', 409); return { message: viewMessage(old), reused: true }; }
    assertTaskOpen(req.tenantId,'room',room.id);
    replyTarget(req.tenantId,room.id,replyToId);
    const mentions = resolveMentions(req, refs, input.text, person => { for (const link of room.links) getSource(person, link.kind, link.id); });
    const combined = new Set([...members(req, room.id).filter(m => m.active).map(m => m.id), ...mentions.map(m => m.userId)]);
    if (combined.size > 50) fail('В задаче может быть до 50 участников');
    for (const uid of new Set(mentions.map(m => m.userId))) db.prepare('INSERT OR IGNORE INTO discussion_members (tenant_id, room_id, user_id) VALUES (?, ?, ?)').run(req.tenantId, room.id, uid);
    const id = Number(db.prepare(`INSERT INTO discussion_messages (tenant_id, room_id, author_id, author_name, body, created_at, request_key, payload_hash, mentions_json, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.tenantId, room.id, req.user.id, req.user.name || req.user.email, input.text, new Date().toISOString(), key, hash, JSON.stringify(mentions),replyToId).lastInsertRowid);
    saveAttachments(req.tenantId, id, files); audit(req, room.id, 'Сообщение в задаче');
    return { message: viewMessage(db.prepare('SELECT * FROM discussion_messages WHERE tenant_id = ? AND id = ?').get(req.tenantId, id)), reused: false };
  }); res.status(result.reused ? 200 : 201).json(result);
}));
router.get('/:id/files', handle((req,res)=>{
  const room=roomFor(req);
  res.json({files:conversationAttachments(req.tenantId,room.id)});
}));
router.get('/:id/files/:fileId', handle((req, res) => {
  const room = roomFor(req);
  sendAttachment(res, db.prepare(`SELECT f.* FROM discussion_files f JOIN discussion_messages m ON m.id = f.message_id AND m.tenant_id = f.tenant_id
    WHERE f.tenant_id = ? AND m.room_id = ? AND f.id = ?`).get(req.tenantId, room.id, req.params.fileId));
}));

// Preserve linked process identities without changing their decision handlers.
const guard = express.Router();
for (const [kind, def] of Object.entries(SOURCES)) guard.delete('/' + def.path + '/:id', requireAuth, requireInternal, handle((req, res, next) => {
  getSource(req, kind, req.params.id);
  if (kind === 'contract' && db.prepare('SELECT id FROM discussion_task_state WHERE tenant_id=? AND engagement_id=?').get(req.tenantId,req.params.id)) fail('У задачи договора есть история. Используйте корзину задач, чтобы сохранить договор.',409);
  if (kind === 'contract' && db.prepare('SELECT id FROM discussion_relations WHERE tenant_id = ? AND engagement_id = ? LIMIT 1').get(req.tenantId, req.params.id)) fail('Договор связан с задачей и должен остаться в истории', 409);
  if (db.prepare('SELECT 1 FROM discussion_links WHERE tenant_id = ? AND kind = ? AND entity_id = ? LIMIT 1').get(req.tenantId, kind, req.params.id)) fail('Процесс связан с задачей и должен остаться в истории', 409);
  next();
}));
module.exports = { router, guard };
