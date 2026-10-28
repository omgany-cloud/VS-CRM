const crypto=require('crypto');
const {db}=require('./db');
const {transaction,ContractError}=require('./contractDocuments');
const {taskAccess,taskView}=require('./discussionTasks');
const {recordAudit}=require('./auditLog');
const fail=(text,status=400)=>{throw new ContractError(status,text);};

function purgeTask(req,kind,id,body){
  if(req.user.permissions.readOnly)fail('Нет права удалять задачи',403);
  if(!['room','contract'].includes(kind)||!Number.isSafeInteger(id)||id<1)fail('Задача не найдена',404);
  if(!body||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<0||typeof body.requestKey!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(body.requestKey))fail('Обновите задачу и повторите действие');
  const hash=crypto.createHash('sha256').update(JSON.stringify({action:'purge',kind,id,version:body.expectedVersion})).digest('hex');
  return transaction(()=>{
    // A receipt permits safe retry after the task itself has been removed.
    const old=db.prepare('SELECT * FROM discussion_task_commands WHERE tenant_id=? AND request_key=?').get(req.tenantId,body.requestKey);
    if(old){if(old.actor_id!==req.user.id||old.payload_hash!==hash)fail('Ключ действия уже использован',409);return JSON.parse(old.result_json);}
    const row=taskAccess(req,kind,id),task=taskView(req,kind,id,row);
    if(!task.canManage)fail('Нет права удалять эту задачу',403);
    if(task.version!==body.expectedVersion)fail('Задача изменилась. Обновите её и повторите действие.',409);
    if(task.status!=='trashed')fail('Удалить навсегда можно только задачу из корзины',409);
    if(task.reviewActive)fail(task.closeBlockedReason,409);
    const contract=kind==='contract',table=contract?'contract_discussion_messages':'discussion_messages',column=contract?'engagement_id':'room_id',fileColumn=contract?'contract_message_id':'message_id';
    db.prepare(`DELETE FROM discussion_files WHERE tenant_id=? AND ${fileColumn} IN (SELECT id FROM ${table} WHERE tenant_id=? AND ${column}=?)`).run(req.tenantId,req.tenantId,id);
    db.prepare(`UPDATE ${table} SET reply_to_id=NULL WHERE tenant_id=? AND ${column}=?`).run(req.tenantId,id);
    db.prepare(`DELETE FROM ${table} WHERE tenant_id=? AND ${column}=?`).run(req.tenantId,id);
    db.prepare('DELETE FROM discussion_task_reads WHERE tenant_id=? AND kind=? AND entity_id=?').run(req.tenantId,kind,id);
    if(contract){
      db.prepare('DELETE FROM discussion_relations WHERE tenant_id=? AND engagement_id=?').run(req.tenantId,id);
      db.prepare('DELETE FROM contract_discussion_members WHERE tenant_id=? AND engagement_id=?').run(req.tenantId,id);
      // Keep a minimal marker so a derived contract task cannot reappear on refresh.
      db.prepare(`UPDATE discussion_task_state SET purged_at=?,title=NULL,assignee_id=NULL,due_date=NULL,previous_status=NULL,version=version+1 WHERE tenant_id=? AND engagement_id=?`).run(new Date().toISOString(),req.tenantId,id);
    }else{
      db.prepare('DELETE FROM discussion_relations WHERE tenant_id=? AND (room_id=? OR other_room_id=?)').run(req.tenantId,id,id);
      for(const name of ['discussion_links','discussion_members','discussion_task_state'])db.prepare(`DELETE FROM ${name} WHERE tenant_id=? AND room_id=?`).run(req.tenantId,id);
      db.prepare('DELETE FROM discussion_rooms WHERE tenant_id=? AND id=?').run(req.tenantId,id);
    }
    recordAudit(db,{tenantId:req.tenantId,entityType:contract?'engagements':'discussion_rooms',entityId:id,action:'discussion',actorEmail:req.user.email,summary:`Задача «${task.title}» удалена навсегда вместе с перепиской и вложениями; связанные записи сохранены`});
    const result={deleted:true};
    db.prepare('INSERT INTO discussion_task_commands (tenant_id,request_key,actor_id,payload_hash,result_json) VALUES (?,?,?,?,?)').run(req.tenantId,body.requestKey,req.user.id,hash,JSON.stringify(result));
    return result;
  });
}
module.exports={purgeTask};
