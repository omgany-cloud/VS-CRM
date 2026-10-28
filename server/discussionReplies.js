const {db}=require('./db');
const {ContractError}=require('./contractDocuments');
function replyId(value){
  if(value==null)return null;
  if(!Number.isSafeInteger(value)||value<1)throw new ContractError(400,'Выберите сообщение для ответа');
  return value;
}
// The caller first checks access to this conversation. A reference never opens
// another task, even when its message ID is known.
function replyTarget(tenantId,parentId,id,contract=false){
  if(id==null)return null;
  const table=contract?'contract_discussion_messages':'discussion_messages',column=contract?'engagement_id':'room_id';
  const row=db.prepare(`SELECT id,author_id,author_name,body,created_at FROM ${table} WHERE tenant_id=? AND ${column}=? AND id=?`).get(tenantId,parentId,id);
  if(!row)throw new ContractError(404,'Исходное сообщение не найдено в этой задаче');
  const fileColumn=contract?'contract_message_id':'message_id';
  const files=db.prepare(`SELECT original_name FROM discussion_files WHERE tenant_id=? AND ${fileColumn}=? ORDER BY id`).all(tenantId,id);
  return {id:row.id,authorId:row.author_id,author:row.author_name,text:row.body.slice(0,280),createdAt:row.created_at,files:files.map(f=>f.original_name)};
}
module.exports={replyId,replyTarget};
