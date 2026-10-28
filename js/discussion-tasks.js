let discussionTaskFilter = 'open';
function taskStatusLabel(status) { return ({open:'В работе',completed:'Завершена',trashed:'В корзине'})[status] || 'В работе'; }
function taskToday() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function taskOverdue(task, today=taskToday()) { return task?.status === 'open' && !!task.dueDate && task.dueDate < today; }
function taskDateLabel(value) { return value ? value.split('-').reverse().join('.') : 'Без срока'; }
function sortTaskItems(items,sort='activity') {
  const activity=i=>i.task?.updatedAt && i.task.updatedAt > (i.updatedAt || '') ? i.task.updatedAt : i.updatedAt || '';
  return [...items].sort((a,b)=>{
    let comparison=0;
    if(sort==='due') comparison=(a.task?.dueDate || '9999').localeCompare(b.task?.dueDate || '9999');
    if(sort==='title') comparison=a.title.localeCompare(b.title,'ru');
    if(sort==='created') comparison=(b.createdAt || '').localeCompare(a.createdAt || '');
    return comparison || activity(b).localeCompare(activity(a)) || b.id-a.id || a.kind.localeCompare(b.kind);
  });
}
function setTaskFilter(status) {
  if(!['open','completed','trashed'].includes(status)) return;
  discussionTaskFilter=status; renderDiscussionList();
}
function updateTaskFilterTabs() {
  document.querySelectorAll('[data-task-filter]').forEach(b=>{const active=b.dataset.taskFilter===discussionTaskFilter;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
}
function taskControls(state) {
  const task=state.chat.task; if(!task) return '';
  return `<div class="task-controls"><span class="task-state task-state-${task.status}">${taskStatusLabel(task.status)}</span>
    ${task.canManage ? (task.status==='trashed' ? '<button type="button" class="contract-primary" onclick="changeDiscussionTask(\'restore\',this)">Восстановить</button><button type="button" class="task-menu-button" onclick="showTaskPurge()" aria-label="Удалить навсегда" title="Удалить навсегда"><i class="far fa-trash-can" aria-hidden="true"></i></button>' : `<button type="button" class="contract-secondary" onclick="changeDiscussionTask('${task.status==='completed'?'reopen':'complete'}',this)" ${task.reviewActive ? 'disabled' : ''} title="${escapeHtml(task.closeBlockedReason || '')}"><i class="fas ${task.status==='completed'?'fa-rotate-left':'fa-check'}" aria-hidden="true"></i> ${task.status==='completed'?'В работу':'Завершить'}</button><button type="button" class="task-menu-button" onclick="showTaskDelete()" aria-label="Удалить задачу" title="Переместить в корзину" ${task.reviewActive?'disabled':''}><i class="far fa-trash-can" aria-hidden="true"></i></button>`) : ''}</div>
    ${task.closeBlockedReason ? `<p class="task-lifecycle-note">${escapeHtml(task.closeBlockedReason)}</p>` : task.status!=='open' ? `<p class="task-lifecycle-note">${task.status==='trashed'?'Задача в корзине. Переписка, вложения и связи сохранены.':'Задача завершена. Чтобы продолжить переписку, верните её в работу.'}</p>` : ''}`;
}
function showTaskRename() {
  const state=contractApprovalUI,task=state?.chat?.task;
  if(!contractConversationOpen(state)||!task?.canManage||task.status==='trashed'||state.busy||state.titleEdit)return;
  const title=task.title||state.data.room?.title||'';
  const heading=document.querySelector('#discussionContext h2');if(!heading)return;
  state.titleEdit={original:title,version:task.version,saving:false};
  heading.innerHTML=`<input id="taskRenameTitle" class="discussion-title-input" type="text" maxlength="160" aria-label="Название задачи" aria-describedby="taskRenameStatus" value="${escapeHtml(title)}" onblur="renameDiscussionTask(this)" onkeydown="taskRenameKey(event,this)" /><span id="taskRenameStatus" class="discussion-title-status" role="status"></span>`;
  const input=document.getElementById('taskRenameTitle');input.focus();input.select();
}
function taskRenameKey(event,input) {
  if(event.isComposing)return;
  if(event.key==='Enter'){event.preventDefault();renameDiscussionTask(input);}
  if(event.key==='Escape'){
    event.preventDefault();const state=contractApprovalUI;
    if(!state?.titleEdit||state.titleEdit.saving)return;
    delete state.titleEdit;renderDiscussionContext(state);
    document.querySelector('#discussionContext .discussion-title-edit')?.focus();
  }
}
async function renameDiscussionTask(input) {
  const state=contractApprovalUI,edit=state?.titleEdit;
  if(!contractConversationOpen(state)||!edit||edit.saving)return;
  const title=input.value.trim(),status=document.getElementById('taskRenameStatus');
  if(!title){if(status)status.textContent='Название не может быть пустым.';return;}
  if(title===edit.original){delete state.titleEdit;renderDiscussionContext(state);return;}
  const payload={action:'rename',title,expectedVersion:edit.version};
  const fingerprint=JSON.stringify(payload);state.taskKeys ||= {};
  state.taskKeys[fingerprint] ||= contractTemplateRequestKey();
  edit.saving=true;input.readOnly=true;if(status)status.textContent='Сохраняется…';
  try{
    const result=await apiFetch(`/api/discussions/${state.kind||'contract'}/${state.engagementId}/state`,{method:'POST',body:JSON.stringify({...payload,requestKey:state.taskKeys[fingerprint]})});
    if(contractConversationOpen(state)){
      state.chat.task=result.task;
      if(state.data.room)state.data.room.title=result.task.title;
      delete state.titleEdit;renderDiscussionContext(state);
    }
    await refreshDiscussionList();
  }catch(err){
    if(contractConversationOpen(state)&&state.titleEdit===edit){
      if(status)status.textContent=err.message;
      if(err.status===409){
        await loadContractConversation(state.engagementId);
        edit.version=state.chat.task.version;
        if(status)status.textContent=`Задача изменилась. Сейчас: «${state.chat.task.title}». Ваш текст сохранён здесь; Enter — повторить.`;
      }
    }
  }finally{edit.saving=false;input.readOnly=false;}
}
function showTaskDueDate() {
  const state=contractApprovalUI,task=state?.chat?.task;if(!contractConversationOpen(state)||!task?.canManage||task.status==='trashed')return;
  const tools=document.getElementById('discussionTools');tools.hidden=false;
  tools.innerHTML=`<form class="task-due-form" onsubmit="event.preventDefault();changeDiscussionTask('due',this.querySelector('button[type=submit]'),{dueDate:this.querySelector('input').value,expectedVersion:${task.version}})"><label for="taskDueDate">Срок задачи</label><input id="taskDueDate" type="date" min="2000-01-01" max="2199-12-31" value="${task.dueDate||''}" /><button class="contract-primary" type="submit">Сохранить</button><button class="contract-secondary" type="button" onclick="document.getElementById('taskDueDate').value=''">Без срока</button><button class="contract-secondary" type="button" onclick="closeDiscussionTools()">Отмена</button><p class="task-action-status" role="status"></p></form>`;
  document.getElementById('taskDueDate').focus();
}
function showTaskDelete() {
  const state=contractApprovalUI,task=state?.chat?.task;if(!contractConversationOpen(state)||!task?.canManage||task.reviewActive||task.status==='trashed')return;
  const links=state.kind==='room'?state.data.room.links:state.chat.related || [];
  const tools=document.getElementById('discussionTools');tools.hidden=false;
  tools.innerHTML=`<div class="task-delete-confirm"><strong>Переместить задачу в корзину?</strong><p>Её можно будет восстановить вместе с перепиской и файлами. Связанные процессы и подзадачи сохранятся.</p>
    ${state.kind!=='room'?'<p>Договор и история его согласований сохранятся.</p>':''}
    ${links.length?`<ul>${links.map(l=>`<li>${escapeHtml(l.label)} · ${escapeHtml(l.title)}</li>`).join('')}</ul>`:''}
    <button type="button" class="task-delete-button" onclick="changeDiscussionTask('trash',this,{expectedVersion:${task.version}})">В корзину</button><button type="button" class="contract-secondary" onclick="closeDiscussionTools()">Отмена</button><p class="task-action-status" role="status"></p></div>`;
}
function showTaskPurge(){
  const state=contractApprovalUI,task=state?.chat?.task;
  if(!contractConversationOpen(state)||!task?.canManage||task.status!=='trashed'||state.purging)return;
  const tools=document.getElementById('discussionTools');tools.hidden=false;
  tools.innerHTML=`<div class="task-delete-confirm"><strong>Удалить «${escapeHtml(task.title)}» навсегда?</strong><p>Переписка и вложения этой задачи будут удалены без возможности восстановления. Связанные задачи и записи CRM сохранятся.</p>${state.kind!=='room'?'<p>Договор, его редакции и история согласования сохранятся.</p>':''}<button type="button" class="task-delete-button" onclick="purgeDiscussionTask(this,${task.version})">Удалить навсегда</button><button type="button" class="contract-secondary" onclick="closeDiscussionTools()">Отмена</button><p class="task-action-status" role="status"></p></div>`;
}
async function purgeDiscussionTask(button,version){
  const state=contractApprovalUI;
  if(!contractConversationOpen(state)||!state.chat.task?.canManage||state.chat.task.status!=='trashed'||state.purging)return;
  const payload={expectedVersion:version};state.taskKeys ||= {};
  const fingerprint='purge:'+version;state.taskKeys[fingerprint] ||= contractTemplateRequestKey();
  state.purging=true;button.disabled=true;
  try{
    await apiFetch(`/api/discussions/${state.kind||'contract'}/${state.engagementId}`,{method:'DELETE',body:JSON.stringify({...payload,requestKey:state.taskKeys[fingerprint]})});
    if(contractConversationOpen(state)){
      stopContractConversation();forgetDiscussionDraft(state);
      const main=state.panel.dataset.surface==='hub'?document.getElementById('discussionMain'):state.panel;
      main.innerHTML='<p class="contract-empty" role="status">Задача удалена навсегда.</p>';
      const url=new URL(window.location.href);url.searchParams.delete('discussion');url.searchParams.delete('contract');history.replaceState(null,'',url);
    }else forgetDiscussionDraft(state);
    await refreshDiscussionList();
  }catch(err){
    if(contractConversationOpen(state)){
      const status=document.querySelector('#discussionTools .task-action-status');if(status)status.textContent=err.message;
      if(err.status===409)await loadContractConversation(state.engagementId);
    }
  }finally{state.purging=false;button.disabled=false;}
}
async function changeDiscussionTask(action,button,extra={}) {
  const state=contractApprovalUI;if(!contractConversationOpen(state)||!state.chat.task?.canManage||state.busy)return;
  const payload={action,expectedVersion:state.chat.task.version,...extra};
  const fingerprint=JSON.stringify(payload);state.taskKeys ||= {};
  state.taskKeys[fingerprint] ||= contractTemplateRequestKey();
  button.disabled=true;
  try {
    const result=await apiFetch(`/api/discussions/${state.kind||'contract'}/${state.engagementId}/state`,{method:'POST',body:JSON.stringify({...payload,requestKey:state.taskKeys[fingerprint]})});
    if(contractConversationOpen(state)){discussionTaskFilter=result.task.status;closeDiscussionTools();await loadContractConversation(state.engagementId);}
    await refreshDiscussionList();
    return true;
  } catch(err) {
    if(contractConversationOpen(state)) { const status=document.querySelector('#discussionTools .task-action-status');if(status)status.textContent=err.message;else contractDiscussionStatus(err.message,true);if(err.status===409)await loadContractConversation(state.engagementId); }
    return false;
  } finally {button.disabled=false;}
}
async function markDiscussionRead() {
  const state=contractApprovalUI,feed=document.getElementById('contractChatFeed');
  if(!contractConversationOpen(state)||state.jumpingReply||document.visibilityState==='hidden'||!feed||feed.scrollHeight-feed.scrollTop-feed.clientHeight>60||!state.chat.after||state.readPending||state.readThrough>=state.chat.after)return;
  const through=state.chat.after;state.readPending=true;
  try {
    const result=await apiFetch(`/api/discussions/${state.kind||'contract'}/${state.engagementId}/read`,{method:'POST',body:JSON.stringify({lastMessageId:through})});
    state.readThrough=Math.max(state.readThrough||0,through);
    if(contractConversationOpen(state)){const item=discussionItems.find(i=>i.id===state.engagementId&&i.kind===(state.kind||'contract'));if(item){item.unread=result.unread;renderDiscussionList();}}
  } catch { /* A later visible poll retries; receipt failure never interrupts the message composer. */ }
  finally {state.readPending=false;}
}
