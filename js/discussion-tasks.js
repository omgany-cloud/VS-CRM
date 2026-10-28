let discussionTaskFilter = 'open';
function taskStatusLabel(status) { return ({open:'В работе',completed:'Завершена',trashed:'В корзине'})[status] || 'В работе'; }
function taskToday() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function taskOverdue(task, today=taskToday()) { return task?.status === 'open' && !!task.dueDate && task.dueDate < today; }
function taskDueToday(task, today=taskToday()) { return task?.status === 'open' && task.dueDate === today; }
// Quick filters of the open list (TZ M3 "Моя работа"): deadlines, my pending
// contract decisions and my contracts sent back for rework. Overdue tasks and
// waiting decisions also show on the menu item.
let discussionQuickFilter='';
const TASK_QUICK_FILTERS=[
  ['decide','Жду моего решения',(task)=>task?.review==='decide'],
  ['rework','На доработке',(task)=>task?.review==='rework'],
  ['overdue','Просрочено',(task,today)=>taskOverdue(task,today)],
  ['today','Срок сегодня',(task,today)=>taskDueToday(task,today)],
];
function taskQuickMatches(task,today) { const filter=TASK_QUICK_FILTERS.find(f=>f[0]===discussionQuickFilter); return !filter||filter[2](task,today); }
function setTaskQuickFilter(value) { if(TASK_QUICK_FILTERS.some(f=>f[0]===value)){discussionQuickFilter=discussionQuickFilter===value?'':value;renderDiscussionList();} }
function renderTaskQuickFilters(today=taskToday()) {
  const open=discussionItems.filter(i=>(i.task?.status||'open')==='open');
  const counts=Object.fromEntries(TASK_QUICK_FILTERS.map(([value,,match])=>[value,open.filter(i=>match(i.task,today)).length]));
  if(discussionTaskFilter!=='open'||discussionQuickFilter&&!counts[discussionQuickFilter])discussionQuickFilter='';
  updateTaskBadge(counts.overdue,counts.decide);
  const box=document.getElementById('discussionQuickFilter');if(!box)return;
  const chips=discussionTaskFilter==='open'?TASK_QUICK_FILTERS.filter(([value])=>counts[value]):[];
  box.hidden=!chips.length;
  box.innerHTML=chips.map(([value,label])=>`<button type="button" class="task-due-chip task-due-${value}${discussionQuickFilter===value?' selected':''}" aria-pressed="${discussionQuickFilter===value}" onclick="setTaskQuickFilter('${value}')">${label} · ${counts[value]}</button>`).join('');
}
function updateTaskBadge(overdue,decide=0) {
  const badge=document.getElementById('badge-discussions');if(!badge)return;
  const count=overdue+decide;badge.textContent=count;badge.style.display=count?'':'none';
  badge.title=[overdue&&`Просроченных задач: ${overdue}`,decide&&`Ждут вашего решения: ${decide}`].filter(Boolean).join(' · ');
}
// Responsible person and client filters; options come from the tasks in the list.
function taskPeopleMatch(item) {
  const assignee=document.getElementById('discussionAssigneeFilter')?.value||'',client=document.getElementById('discussionClientFilter')?.value||'';
  const me=typeof getAuth==='function'?getAuth()?.user?.id:null,owner=item.task?.assignee?.id;
  const byAssignee=!assignee||(assignee==='me'?owner===me:assignee==='none'?!owner:owner===Number(assignee));
  return byAssignee&&(!client||(item.clients||[]).some(c=>c.id===Number(client)));
}
function updateTaskPeopleFilters() {
  const fill=(id,first,entries)=>{
    const select=document.getElementById(id);if(!select)return;
    const current=select.value;
    select.innerHTML=first+entries.sort((a,b)=>a[1].localeCompare(b[1],'ru')).map(([value,label])=>`<option value="${value}">${escapeHtml(label)}</option>`).join('');
    select.value=[...(select.options||[])].some(o=>o.value===current)?current:'';
  };
  const people=new Map(),clients=new Map();
  for(const item of discussionItems){
    if(item.task?.assignee)people.set(String(item.task.assignee.id),item.task.assignee.name);
    for(const client of item.clients||[])clients.set(String(client.id),client.name);
  }
  fill('discussionAssigneeFilter','<option value="">Любой ответственный</option><option value="me">Я ответственный</option><option value="none">Без ответственного</option>',[...people]);
  fill('discussionClientFilter','<option value="">Все клиенты</option>',[...clients]);
}
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
  if(status!==discussionTaskFilter&&!discussionBulk.busy){discussionTaskSelection.clear();discussionBulk={confirm:null,busy:false,status:'',error:false,result:''};discussionQuickFilter='';}
  discussionTaskFilter=status; renderDiscussionList();
}
function updateTaskFilterTabs() {
  document.querySelectorAll('[data-task-filter]').forEach(b=>{const active=b.dataset.taskFilter===discussionTaskFilter;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
}
// Bulk complete / trash: ticked tasks go one by one through the same lifecycle command as a single task.
const discussionTaskSelection=new Set(),discussionBulkKeys=new Map();
// confirm: the action waiting for the second step — 'trash' asks to confirm, 'complete' asks for the result.
let discussionBulk={confirm:null,busy:false,status:'',error:false,result:''},discussionShownTasks=[],discussionBulkHtml=null;
const resetTaskBulk=()=>{discussionBulk={confirm:null,busy:false,status:'',error:false,result:''};};
const taskKey=item=>`${item.kind}:${item.id}`;
function taskBulkActions() { return ({open:['complete','trash'],completed:['trash']})[discussionTaskFilter] || []; }
function taskSelectable(item) { return !!item.task?.canManage&&!item.task.reviewActive; }
// Keeps only visible tasks the user may change; returns whether the list shows checkboxes.
function syncTaskSelection(items) {
  discussionShownTasks=taskBulkActions().length?items.filter(taskSelectable):[];
  const keys=new Set(discussionShownTasks.map(taskKey));
  for(const key of discussionTaskSelection)if(!keys.has(key))discussionTaskSelection.delete(key);
  return discussionShownTasks.length>0;
}
function taskSelectBox(item) {
  const reason=!item.task?.canManage?'Изменять задачу может её создатель, а задачу договора — сотрудник с правом вести договоры.':item.task.reviewActive?item.task.closeBlockedReason:'';
  return `<input type="checkbox" class="task-select" aria-label="Выбрать задачу «${escapeHtml(item.title)}»"${discussionTaskSelection.has(taskKey(item))?' checked':''}${reason||discussionBulk.busy?' disabled':''}${reason?` title="${escapeHtml(reason)}"`:''} onchange="toggleTaskSelection('${item.kind}',${item.id},this.checked)" />`;
}
function renderTaskBulk() {
  const bar=document.getElementById('discussionBulk');if(!bar)return;
  const count=discussionTaskSelection.size,all=count>0&&count===discussionShownTasks.length,busy=discussionBulk.busy?' disabled':'';
  const contracts=discussionShownTasks.some(i=>i.kind==='contract'&&discussionTaskSelection.has(taskKey(i)));
  const status=discussionBulk.status?`<p class="task-bulk-status${discussionBulk.error?' error':''}" role="status">${escapeHtml(discussionBulk.status)}</p>`:'';
  bar.hidden=!discussionShownTasks.length&&!status;
  // The list polls every 10 s; rewriting identical markup would drop keyboard focus from these buttons.
  const html=!discussionShownTasks.length?status:`<label class="task-bulk-all"><input type="checkbox" aria-label="Выбрать все задачи в списке"${all?' checked':''}${busy} onchange="selectAllTasks(this.checked)" /><span>${count?`Выбрано: ${count}`:'Выбрать все'}</span></label>
    ${count&&discussionBulk.confirm==='trash'?`<p class="task-bulk-confirm">Переместить в корзину выбранные задачи (${count})? Переписка, файлы и связи сохранятся, задачи можно будет восстановить.${contracts?' Договоры и история согласований не меняются.':''}</p><button type="button" class="task-delete-button" onclick="runTaskBulk('trash',true)"${busy}>В корзину</button><button type="button" class="contract-secondary" onclick="cancelTaskBulk()"${busy}>Отмена</button>`
    :count&&discussionBulk.confirm==='complete'?`<label class="task-bulk-confirm" for="taskBulkResult">Результат для выбранных задач (${count})</label><textarea id="taskBulkResult" class="task-result-input" maxlength="2000" rows="2" placeholder="Что сделано" oninput="discussionBulk.result=this.value"${busy}></textarea><button type="button" class="contract-primary" onclick="runTaskBulk('complete',true)"${busy}><i class="fas fa-check" aria-hidden="true"></i> Завершить</button><button type="button" class="contract-secondary" onclick="cancelTaskBulk()"${busy}>Отмена</button>`
    :count?`${taskBulkActions().includes('complete')?`<button type="button" class="contract-secondary" onclick="runTaskBulk('complete')"${busy}><i class="fas fa-check" aria-hidden="true"></i> Завершить</button>`:''}<button type="button" class="task-menu-button" onclick="runTaskBulk('trash')"${busy}><i class="far fa-trash-can" aria-hidden="true"></i> В корзину</button><button type="button" class="task-menu-button" onclick="selectAllTasks(false)" aria-label="Снять выбор" title="Снять выбор"${busy}><i class="fas fa-xmark" aria-hidden="true"></i></button>`:''}${status}`;
  // Typed text lives in discussionBulk.result, not in the markup, so typing never triggers a rewrite.
  if(html!==discussionBulkHtml){bar.innerHTML=html;discussionBulkHtml=html;const input=bar.querySelector?.('#taskBulkResult');if(input)input.value=discussionBulk.result;}
  const box=bar.querySelector?.('.task-bulk-all input');if(box)box.indeterminate=count>0&&!all;
}
function toggleTaskSelection(kind,id,checked) {
  const key=`${kind}:${id}`;if(discussionBulk.busy)return;
  if(checked&&discussionShownTasks.some(i=>taskKey(i)===key))discussionTaskSelection.add(key);else discussionTaskSelection.delete(key);
  resetTaskBulk();renderTaskBulk();
}
function selectAllTasks(checked) {
  if(discussionBulk.busy)return;
  discussionTaskSelection.clear();if(checked)discussionShownTasks.forEach(i=>discussionTaskSelection.add(taskKey(i)));
  resetTaskBulk();renderDiscussionList();
}
function cancelTaskBulk() { if(!discussionBulk.busy){discussionBulk.confirm=null;discussionBulk.status='';renderTaskBulk();} }
async function runTaskBulk(action,confirmed=false) {
  if(discussionBulk.busy||!taskBulkActions().includes(action))return;
  const items=discussionShownTasks.filter(i=>discussionTaskSelection.has(taskKey(i)));if(!items.length)return;
  if(!confirmed){discussionBulk={...discussionBulk,confirm:action,status:'',error:false};renderTaskBulk();document.getElementById('taskBulkResult')?.focus?.();return;}
  const result=action==='complete'?discussionBulk.result.trim():'';
  if(action==='complete'&&!result){discussionBulk={...discussionBulk,status:'Опишите результат: он сохранится в каждой выбранной задаче.',error:true};renderTaskBulk();return;}
  const verb=action==='trash'?'Перемещение в корзину':'Завершение',failed=[];let done=0;
  discussionBulk={confirm:null,busy:true,status:`${verb}: 0 из ${items.length}…`,error:false,result:discussionBulk.result};renderDiscussionList();
  for(const item of items){
    const payload={action,expectedVersion:item.task.version,...(result?{result}:{})},fingerprint=`${taskKey(item)}:${JSON.stringify(payload)}`;
    if(!discussionBulkKeys.has(fingerprint))discussionBulkKeys.set(fingerprint,contractTemplateRequestKey());
    try{
      await apiFetch(`/api/discussions/${item.kind}/${item.id}/state`,{method:'POST',body:JSON.stringify({...payload,requestKey:discussionBulkKeys.get(fingerprint)})});
      discussionBulkKeys.delete(fingerprint);discussionTaskSelection.delete(taskKey(item));done++;
    }catch(err){failed.push(`«${item.title}» — ${err.message}`);}
    discussionBulk.status=`${verb}: ${done+failed.length} из ${items.length}…`;renderTaskBulk();
  }
  discussionBulk={confirm:null,busy:false,error:failed.length>0,result:failed.length?discussionBulk.result:'',status:[done?`${action==='trash'?'В корзину перемещено':'Завершено'} задач: ${done}.`:'',failed.length?`Не удалось (${failed.length}): ${failed.join('; ')}. Отметки с этих задач не сняты.`:''].filter(Boolean).join(' ')};
  const state=contractApprovalUI;
  if(contractConversationOpen(state)&&items.some(i=>i.kind===(state.kind||'contract')&&i.id===state.engagementId))await loadContractConversation(state.engagementId);
  await refreshDiscussionList();
}
function taskControls(state) {
  const task=state.chat.task; if(!task) return '';
  return `<div class="task-controls"><span class="task-state task-state-${task.status}">${taskStatusLabel(task.status)}</span>
    ${task.canManage ? (task.status==='trashed' ? '<button type="button" class="contract-primary" onclick="changeDiscussionTask(\'restore\',this)">Восстановить</button><button type="button" class="task-menu-button" onclick="showTaskPurge()" aria-label="Удалить навсегда" title="Удалить навсегда"><i class="far fa-trash-can" aria-hidden="true"></i></button>' : `<button type="button" class="contract-secondary" onclick="${task.status==='completed'?"changeDiscussionTask('reopen',this)":'showTaskComplete()'}" ${task.reviewActive ? 'disabled' : ''} title="${escapeHtml(task.closeBlockedReason || '')}"><i class="fas ${task.status==='completed'?'fa-rotate-left':'fa-check'}" aria-hidden="true"></i> ${task.status==='completed'?'В работу':'Завершить'}</button><button type="button" class="task-menu-button" onclick="showTaskDelete()" aria-label="Удалить задачу" title="Переместить в корзину" ${task.reviewActive?'disabled':''}><i class="far fa-trash-can" aria-hidden="true"></i></button>`) : ''}</div>
    ${task.closeBlockedReason ? `<p class="task-lifecycle-note">${escapeHtml(task.closeBlockedReason)}</p>` : task.status!=='open' ? `<p class="task-lifecycle-note">${task.status==='trashed'?'Задача в корзине. Переписка, вложения и связи сохранены.':'Задача завершена. Чтобы продолжить переписку, верните её в работу.'}</p>` : ''}
    ${task.status==='completed'&&task.result?`<p class="task-result"><strong>Результат:</strong> ${escapeHtml(task.result)}</p>`:''}`;
}
function showTaskComplete() {
  const state=contractApprovalUI,task=state?.chat?.task;if(!contractConversationOpen(state)||!task?.canManage||task.status!=='open'||task.reviewActive)return;
  const tools=document.getElementById('discussionTools');tools.hidden=false;
  tools.innerHTML=`<form class="task-due-form" onsubmit="event.preventDefault();completeDiscussionTask(this)"><label for="taskCompleteResult">Результат задачи</label><textarea id="taskCompleteResult" class="task-result-input" maxlength="2000" rows="3" placeholder="Что сделано — сохранится в задаче и журнале"></textarea><button class="contract-primary" type="submit"><i class="fas fa-check" aria-hidden="true"></i> Завершить</button><button class="contract-secondary" type="button" onclick="closeDiscussionTools()">Отмена</button><p class="task-action-status" role="status"></p></form>`;
  document.getElementById('taskCompleteResult').focus();
}
async function completeDiscussionTask(form) {
  const result=form.querySelector('textarea').value.trim();
  if(!result){form.querySelector('.task-action-status').textContent='Опишите результат: что сделано.';return;}
  await changeDiscussionTask('complete',form.querySelector('button[type=submit]'),{result});
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
