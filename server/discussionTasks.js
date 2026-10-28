const crypto = require('crypto');
const { db } = require('./db');
const { getSource } = require('./discussionSources');
const { ContractError, latestCycle } = require('./contractApprovalState');
const { transaction } = require('./contractDocuments');
const { recordAudit } = require('./auditLog');
const { rowToPermissions } = require('./rolesMapping');
const fail = (message, status = 400) => { throw new ContractError(status, message); };
function taskColumn(kind) { if (!['room','contract'].includes(kind)) fail('Задача не найдена',404); return kind === 'room' ? 'room_id' : 'engagement_id'; }
function taskAccess(req, kind, id) {
  taskColumn(kind);
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) fail('Задача не найдена',404);
  if(taskState(req.tenantId,kind,Number(id)).purgedAt)fail('Задача удалена навсегда',404);
  if (kind === 'contract') return getSource(req, 'contract', id).row;
  const row = db.prepare(`SELECT r.* FROM discussion_rooms r JOIN discussion_members m ON m.room_id = r.id AND m.tenant_id = r.tenant_id
    WHERE r.tenant_id = ? AND r.id = ? AND m.user_id = ?`).get(req.tenantId, Number(id), req.user.id);
  if (!row) fail('Задача не найдена',404);
  for (const link of db.prepare('SELECT kind,entity_id FROM discussion_links WHERE tenant_id = ? AND room_id = ?').all(req.tenantId,row.id)) getSource(req,link.kind,link.entity_id);
  return row;
}
function taskState(tenantId, kind, id) {
  const row = db.prepare(`SELECT * FROM discussion_task_state WHERE tenant_id = ? AND ${taskColumn(kind)} = ?`).get(tenantId,id);
  const assignee=row?.assignee_id?db.prepare('SELECT id,name,active FROM users WHERE tenant_id=? AND id=?').get(tenantId,row.assignee_id):null;
  return { status: row?.status || 'open', purgedAt:row?.purged_at||null, title: row?.title || null, dueDate: row?.due_date || null, version: row?.version || 0, assignee:assignee||null,
    updatedAt: row?.updated_at || null, completedAt: row?.completed_at || null, deletedAt: row?.deleted_at || null, previousStatus: row?.previous_status || null,
    result: row?.completion_result || null };
}
function taskView(req,kind,id,row) {
  const state = taskState(req.tenantId,kind,id);
  const canManage = !req.user.permissions.readOnly && (kind === 'room' ? row.created_by === req.user.id : !!req.user.permissions.manageContracts);
  const reviewActive = kind === 'contract' && latestCycle(req.tenantId,id)?.status === 'active';
  return {...state, title:kind==='room'?row.title:state.title||getSource(req,'contract',id).title, canManage, reviewActive, closeBlockedReason: reviewActive ? 'Сначала завершите или отзовите согласование договора.' : ''};
}
function assertTaskOpen(tenantId,kind,id) {
  const state = taskState(tenantId,kind,id);
  if(state.purgedAt)fail('Задача удалена навсегда',404);
  if (state.status !== 'open') fail(state.status === 'trashed' ? 'Задача в корзине. Сначала восстановите её.' : 'Задача завершена. Сначала верните её в работу.',409);
}
function dueDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2199-12-31') fail('Укажите срок в формате ГГГГ-ММ-ДД');
  const date = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value) fail('Укажите существующую дату');
  return value;
}
function taskAssignees(req,kind,id) {
  const row=taskAccess(req,kind,id);
  if(!taskView(req,kind,id,row).canManage)fail('Нет права назначать ответственного',403);
  return db.prepare('SELECT * FROM users WHERE tenant_id=? AND active=1 ORDER BY name,id').all(req.tenantId).flatMap(user=>{
    const role=db.prepare('SELECT * FROM roles WHERE tenant_id=? AND code=?').get(req.tenantId,user.role);
    if(!role)return [];
    const permissions=rowToPermissions(role);if(!permissions.internal||permissions.readOnly)return [];
    try{taskAccess({tenantId:req.tenantId,user:{...user,permissions}},kind,id);return [{id:user.id,name:user.name||user.email}];}
    catch(err){if(err instanceof ContractError)return [];throw err;}
  });
}
function initializeDueDate(req,kind,id,date) {
  if (date) db.prepare(`INSERT INTO discussion_task_state (tenant_id,${taskColumn(kind)},due_date,updated_at,updated_by) VALUES (?,?,?,?,?)`).run(req.tenantId,id,date,new Date().toISOString(),req.user.id);
}
function changeTask(req,kind,id,body) {
  const row = taskAccess(req,kind,id), view = taskView(req,kind,id,row);
  if (!view.canManage) fail('Изменять задачу может её создатель, а задачу договора — сотрудник с правом вести договоры.',403);
  if (!body || !['rename','due','assign','complete','reopen','trash','restore'].includes(body.action) || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 || typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(body.requestKey)) fail('Обновите задачу и повторите действие');
  const input = {kind,id:Number(id),action:body.action,version:body.expectedVersion};
  if (body.action === 'due') input.dueDate = dueDate(body.dueDate);
  if(body.action==='complete'){
    if(typeof body.result!=='string'||!body.result.trim()||body.result.trim().length>2000)fail('Опишите результат задачи: до 2000 символов');
    input.result=body.result.trim();
  }
  if(body.action==='rename'){
    if(typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>160)fail('Укажите название задачи: до 160 символов');
    input.title=body.title.trim();
  }
  if(body.action==='assign'){
    if(body.assigneeId!==null&&(!Number.isSafeInteger(body.assigneeId)||body.assigneeId<1))fail('Выберите ответственного');
    input.assigneeId=body.assigneeId;
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(() => {
    const currentRow = taskAccess(req,kind,id);
    const old = db.prepare('SELECT * FROM discussion_task_commands WHERE tenant_id = ? AND request_key = ?').get(req.tenantId,body.requestKey);
    if (old) { if (old.actor_id !== req.user.id || old.payload_hash !== hash) fail('Ключ действия уже использован',409); return JSON.parse(old.result_json); }
    const current = taskView(req,kind,id,currentRow);
    if (current.version !== body.expectedVersion) fail('Задача изменилась. Обновите её и повторите действие.',409);
    if (['complete','trash'].includes(body.action) && current.reviewActive) fail(current.closeBlockedReason,409);
    const next = {...current}; const now = new Date().toISOString();
    if(body.action==='rename'&&current.status==='trashed')fail('Сначала восстановите задачу из корзины',409);
    if(body.action==='assign'){
      assertTaskOpen(req.tenantId,kind,id);
      next.assignee=input.assigneeId?taskAssignees(req,kind,id).find(p=>p.id===input.assigneeId):null;
      if(input.assigneeId&&!next.assignee)fail('Выбранный сотрудник недоступен для назначения',403);
      if(kind==='contract'&&next.assignee){
        const members=db.prepare('SELECT user_id FROM contract_discussion_members WHERE tenant_id=? AND engagement_id=?').all(req.tenantId,id);
        if(members.length>=50&&!members.some(m=>m.user_id===next.assignee.id))fail('В задаче может быть до 50 приглашённых сотрудников');
        db.prepare('INSERT OR IGNORE INTO contract_discussion_members (tenant_id,engagement_id,user_id,added_by,created_at) VALUES (?,?,?,?,?)').run(req.tenantId,id,next.assignee.id,req.user.id,now);
      }
    }
    if (body.action === 'due') { if (current.status === 'trashed') fail('Сначала восстановите задачу',409); next.dueDate = input.dueDate; }
    if (body.action === 'complete') { if (current.status !== 'open') fail('Задача уже не в работе',409); next.status='completed'; next.completedAt=now; next.result=input.result; }
    if (body.action === 'reopen') { if (current.status !== 'completed') fail('Вернуть в работу можно завершённую задачу',409); next.status='open'; next.completedAt=null; next.result=null; }
    if (body.action === 'trash') { if (current.status === 'trashed') fail('Задача уже в корзине',409); next.previousStatus=current.status; next.status='trashed'; next.deletedAt=now; }
    if (body.action === 'restore') { if (current.status !== 'trashed') fail('Задача не находится в корзине',409); next.status=current.previousStatus || 'open'; next.deletedAt=null; next.previousStatus=null; }
    db.prepare(`INSERT INTO discussion_task_state (tenant_id,${taskColumn(kind)},status,previous_status,due_date,version,updated_at,updated_by,completed_at,deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,${taskColumn(kind)}) DO UPDATE SET status=excluded.status,previous_status=excluded.previous_status,due_date=excluded.due_date,
      version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,completed_at=excluded.completed_at,deleted_at=excluded.deleted_at`)
      .run(req.tenantId,id,next.status,next.previousStatus,next.dueDate,current.version+1,now,req.user.id,next.completedAt,next.deletedAt);
    if(body.action==='assign')db.prepare(`UPDATE discussion_task_state SET assignee_id=? WHERE tenant_id=? AND ${taskColumn(kind)}=?`).run(next.assignee?.id||null,req.tenantId,id);
    if(['complete','reopen'].includes(body.action))db.prepare(`UPDATE discussion_task_state SET completion_result=? WHERE tenant_id=? AND ${taskColumn(kind)}=?`).run(next.result,req.tenantId,id);
    if(body.action==='rename'){
      if(kind==='room'){
        db.prepare('UPDATE discussion_rooms SET title=? WHERE tenant_id=? AND id=?').run(input.title,req.tenantId,id);
        currentRow.title=input.title;
      }else db.prepare('UPDATE discussion_task_state SET title=? WHERE tenant_id=? AND engagement_id=?').run(input.title,req.tenantId,id);
    }
    const labels={due:'Изменён срок задачи',complete:'Задача завершена',reopen:'Задача возвращена в работу',trash:'Задача перемещена в корзину; связанные записи сохранены',restore:'Задача восстановлена из корзины'};
    recordAudit(db,{tenantId:req.tenantId,entityType:kind === 'room' ? 'discussion_rooms':'engagements',entityId:Number(id),action:'discussion',actorEmail:req.user.email,summary:body.action==='rename'?`Задача переименована: «${current.title}» → «${input.title}»`:body.action==='assign'?'Ответственный: '+(next.assignee?.name||'не назначен'):labels[body.action]+(body.action === 'due' ? ': '+(next.dueDate || 'без срока'):body.action==='complete'?'. Результат: '+input.result:'')});
    const result={task:taskView(req,kind,id,currentRow)};
    db.prepare('INSERT INTO discussion_task_commands (tenant_id,request_key,actor_id,payload_hash,result_json) VALUES (?,?,?,?,?)').run(req.tenantId,body.requestKey,req.user.id,hash,JSON.stringify(result));
    return result;
  });
}
function messageTable(kind) { taskColumn(kind); return kind === 'room' ? 'discussion_messages':'contract_discussion_messages'; }
function taskUnread(req,kind,id) {
  const last = db.prepare('SELECT last_message_id FROM discussion_task_reads WHERE tenant_id=? AND user_id=? AND kind=? AND entity_id=?').get(req.tenantId,req.user.id,kind,id)?.last_message_id || 0;
  return db.prepare(`SELECT COUNT(*) n FROM ${messageTable(kind)} WHERE tenant_id=? AND ${taskColumn(kind)}=? AND id>? AND author_id!=?`).get(req.tenantId,id,last,req.user.id).n;
}
function markTaskRead(req,kind,id,lastId) {
  taskAccess(req,kind,id);
  if (!Number.isSafeInteger(lastId) || lastId < 0) fail('Некорректное сообщение');
  if (lastId && !db.prepare(`SELECT id FROM ${messageTable(kind)} WHERE tenant_id=? AND ${taskColumn(kind)}=? AND id=?`).get(req.tenantId,id,lastId)) fail('Сообщение не найдено',404);
  db.prepare(`INSERT INTO discussion_task_reads (tenant_id,user_id,kind,entity_id,last_message_id) VALUES (?,?,?,?,?)
    ON CONFLICT(tenant_id,user_id,kind,entity_id) DO UPDATE SET last_message_id=MAX(last_message_id,excluded.last_message_id)`).run(req.tenantId,req.user.id,kind,id,lastId);
  return {unread:taskUnread(req,kind,id)};
}
module.exports={taskAccess,taskState,taskView,taskAssignees,assertTaskOpen,dueDate,initializeDueDate,changeTask,taskUnread,markTaskRead};
