const { db } = require('./db');
const { ContractError } = require('./contractDocuments');
const { getSource } = require('./discussionSources');
const {taskState} = require('./discussionTasks');
function accessibleRoom(req, id) {
  const row = db.prepare(`SELECT r.* FROM discussion_rooms r JOIN discussion_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.id = ? AND m.user_id = ?`).get(req.tenantId, id, req.user.id);
  if (!row) throw new ContractError(404, 'Задача не найдена');
  for (const link of db.prepare('SELECT kind, entity_id FROM discussion_links WHERE tenant_id = ? AND room_id = ?').all(req.tenantId, id)) getSource(req, link.kind, link.entity_id);
  return row;
}
function roomLink(req, id) {
  const room = accessibleRoom(req, id);
  return { kind: 'discussion', id: room.id, label: 'Подзадача', title: room.title, status: taskState(req.tenantId,'room',room.id).status };
}
function relatedDiscussions(req, { roomId, engagementId }) {
  const rows = roomId ? db.prepare('SELECT * FROM discussion_relations WHERE tenant_id = ? AND (room_id = ? OR other_room_id = ?) ORDER BY id').all(req.tenantId, roomId, roomId)
    : db.prepare('SELECT * FROM discussion_relations WHERE tenant_id = ? AND engagement_id = ? ORDER BY id').all(req.tenantId, engagementId);
  return rows.flatMap(row => {
    try {
      if (roomId && row.engagement_id) {
        const source = getSource(req, 'contract', row.engagement_id);
        const task=taskState(req.tenantId,'contract',source.id);
        return [{ kind: 'contract-chat', id: source.id, label: 'Подзадача по договору', title:task.title||source.title, status: task.status }];
      }
      return [roomLink(req, row.room_id === roomId ? row.other_room_id : row.room_id)];
    } catch (err) { if (err instanceof ContractError) return []; throw err; }
  });
}
function relationSources(req) {
  return db.prepare('SELECT room_id FROM discussion_members WHERE tenant_id = ? AND user_id = ?').all(req.tenantId, req.user.id).flatMap(row => {
    try { const link=roomLink(req,row.room_id); return link.status === 'trashed' ? [] : [link]; } catch (err) { if (err instanceof ContractError) return []; throw err; }
  });
}
function addRelation(req, roomId, kind, targetId) {
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new ContractError(400, 'Выберите подзадачу');
  let first = roomId, other = null, engagement = null;
  if (kind === 'discussion') {
    if (roomId === targetId) throw new ContractError(400, 'Нельзя добавить задачу в её собственные подзадачи');
    accessibleRoom(req, targetId); first = Math.min(roomId, targetId); other = Math.max(roomId, targetId);
  } else { getSource(req, 'contract', targetId); engagement = targetId; }
  if (taskState(req.tenantId,kind === 'discussion' ? 'room':'contract',targetId).status === 'trashed') throw new ContractError(409,'Выбранная подзадача находится в корзине');
  const count = db.prepare('SELECT COUNT(*) AS n FROM discussion_relations WHERE tenant_id = ? AND (room_id = ? OR other_room_id = ?)').get(req.tenantId, roomId, roomId).n;
  const existing = db.prepare('SELECT id FROM discussion_relations WHERE tenant_id = ? AND room_id = ? AND other_room_id IS ? AND engagement_id IS ?').get(req.tenantId, first, other, engagement);
  if (count >= 20 && !existing) throw new ContractError(400, 'Можно добавить до 20 подзадач');
  db.prepare(`INSERT OR IGNORE INTO discussion_relations (tenant_id, room_id, other_room_id, engagement_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.tenantId, first, other, engagement, req.user.id, new Date().toISOString());
}
module.exports = { relatedDiscussions, relationSources, addRelation };
