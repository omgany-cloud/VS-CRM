function discussionTitleHeader(title,state) {
  const canRename=state?.chat?.task?.canManage&&state.chat.task.status!=='trashed';
  return `<div class="discussion-context-top"><h2>${canRename?`<button type="button" class="discussion-title-edit" onclick="showTaskRename()" aria-label="Переименовать задачу" title="Переименовать задачу">${escapeHtml(title||'Задача')} <i class="fas fa-pen" aria-hidden="true"></i></button>`:escapeHtml(title||'Задача')}</h2><button id="discussionPropertiesToggle" type="button" class="discussion-quiet-button" onclick="toggleDiscussionProperties()" aria-label="Свойства задачи" aria-controls="discussionProperties" title="Свойства задачи"><i class="fas fa-sliders" aria-hidden="true"></i></button></div>`;
}
function toggleDiscussionProperties() {
  const state=contractApprovalUI;if(!contractConversationOpen(state))return;
  state.propertiesOpen=!state.propertiesOpen;applyDiscussionPropertiesVisibility(state);
  // Below 1100px the rail covers the chat, so only a choice made on a wide screen is remembered.
  if(window.innerWidth>1100)rememberTasksLayout('propertiesOpen',state.propertiesOpen);
}
function applyDiscussionPropertiesVisibility(state) {
  if(state.propertiesOpen==null)state.propertiesOpen=window.innerWidth>1100&&tasksLayoutState().propertiesOpen!==false;
  state.panel.classList.toggle('properties-closed',!state.propertiesOpen);
  const button=document.getElementById('discussionPropertiesToggle');
  if(button)button.setAttribute('aria-expanded',String(state.propertiesOpen));
  const aside=document.getElementById('discussionProperties');if(aside)aside.hidden=!state.propertiesOpen;
}
function discussionParticipants(state) {
  if(state.kind==='room')return state.data.room.members;
  const cycle=state.data.cycles[0],people=[...(state.chat.participants||[])];
  if(cycle)people.push({id:cycle.initiatorId,name:cycle.initiator},...cycle.steps.map(s=>({id:s.userId,name:s.name,active:s.available})));
  const latest=state.chat.documents?.at(-1);if(latest)people.push({id:latest.authorId,name:latest.author});
  return [...new Map(people.filter(p=>p.id&&p.name).map(p=>[p.id,p])).values()];
}
function discussionPersonRow(person, state, note='') {
  return `<div class="discussion-person-row">${discussionAvatar(person.name,person.id)}<span class="discussion-person-name">${state.chat.canPost&&person.active!==0&&person.id!==state.data.userId?`<button type="button" class="discussion-person-link" onclick="mentionDiscussionPerson(${person.id})" title="Упомянуть в сообщении">${escapeHtml(person.name)}</button>`:`<strong>${escapeHtml(person.name)}</strong>`}${note?`<small>${escapeHtml(note)}</small>`:''}</span></div>`;
}
function renderDiscussionProperties(state) {
  const root=document.getElementById('discussionPropertyBody');if(!root)return;
  const room=state.data.room,cycle=state.data.cycles[0],task=state.chat.task;
  const people=discussionParticipants(state),author=room?room.members.find(p=>p.id===room.createdBy):cycle?{id:cycle.initiatorId,name:cycle.initiator}:null;
  const links=room?room.links:state.chat.related||[];
  root.innerHTML=`<div class="discussion-properties-heading"><strong>О задаче</strong><button type="button" class="discussion-quiet-button" onclick="toggleDiscussionProperties()" aria-label="Свернуть свойства задачи" title="Свернуть">×</button></div>
    ${author?`<section class="discussion-property"><h3>${room?'Автор':'Инициатор согласования'}</h3>${discussionPersonRow(author,state)}</section>`:''}
    <section class="discussion-property"><h3>Ответственный</h3>${task?.assignee?discussionPersonRow(task.assignee,state):'<p class="discussion-property-empty">Не назначен</p>'}${task?.canManage&&task.status==='open'?'<button type="button" class="discussion-text-action" onclick="showTaskAssignee()">Назначить</button>':''}</section>
    <section class="discussion-property"><h3>Срок</h3>${task?.canManage&&task.status!=='trashed'?`<button type="button" class="task-deadline${taskOverdue(task)?' overdue':''}" onclick="showTaskDueDate()"><i class="far fa-calendar" aria-hidden="true"></i> ${taskDateLabel(task.dueDate)}</button>`:`<span class="${taskOverdue(task)?'overdue':''}">${taskDateLabel(task?.dueDate)}</span>`}</section>
    <section class="discussion-property"><h3>Участники <span>${people.length}</span>${state.chat.canPost?'<button type="button" class="discussion-quiet-button" onclick="suggestDiscussionPeople()" aria-label="Добавить участника по имени" title="Добавить по имени"><i class="fas fa-plus" aria-hidden="true"></i></button>':''}</h3>${people.map(p=>discussionPersonRow(p,state,p.active===0?'Неактивен':'')).join('')||'<p class="discussion-property-empty">Добавьте коллегу по имени в сообщении.</p>'}</section>
    ${cycle?`<section class="discussion-property"><h3>Согласующие</h3>${cycle.steps.map(s=>discussionPersonRow({id:s.userId,name:s.name,active:s.available},state,contractApprovalLabel(s.status))).join('')}</section>`:''}
    <section class="discussion-property"><h3>Связанные${room?.canManage?'<button type="button" class="discussion-quiet-button" onclick="showDiscussionLinks()" aria-label="Связать процесс или подзадачу" title="Добавить связь"><i class="fas fa-plus" aria-hidden="true"></i></button>':!room&&task?.status==='open'&&!currentUserPermission('readOnly')?'<button type="button" class="discussion-quiet-button" onclick="newContractSubtask()" aria-label="Новая подзадача по договору" title="Новая подзадача"><i class="fas fa-plus" aria-hidden="true"></i></button>':''}</h3>
      ${state.kind!=='room'?`<button type="button" class="discussion-property-link" onclick="openContractRecord(${state.engagementId})"><i class="far fa-file-lines" aria-hidden="true"></i> Карточка договора ↗</button>`:''}
      ${links.map(l=>`<button type="button" class="discussion-property-link" onclick="openDiscussionSource('${l.kind}',${l.id})"><small>${escapeHtml(l.label)}</small><strong>${escapeHtml(l.title)}</strong><small>${escapeHtml(discussionStatus(l.status))}</small></button>`).join('')|| (room?'<p class="discussion-property-empty">Нет связей</p>':'')}
    </section>`;
  const footer=document.getElementById('discussionTaskActions');if(footer)footer.innerHTML=taskControls(state);
  applyDiscussionPropertiesVisibility(state);
}
async function suggestDiscussionPeople() {
  const state=contractApprovalUI,input=document.getElementById('contractChatText');
  if(!contractConversationOpen(state)||!state.chat.canPost||state.busy)return;
  input.focus();
  try {
    const people=await discussionMentionPeople(state);if(!contractConversationOpen(state))return;
    reconcileDiscussionMentions(state,input.value);
    const at=input.selectionStart;
    // Put the name after the current word, not into its middle.
    if(at&&/\S/.test(input.value[at-1])){input.setSelectionRange(input.value.length,input.value.length);return contractDiscussionStatus('Начните печатать имя в сообщении — появятся подсказки.');}
    state.mentionOptions=people.slice(0,8).map(p=>({...p,start:at,end:input.selectionEnd,prefix:''}));state.mentionIndex=0;
    renderDiscussionMentions(state);
  }catch(err){if(contractConversationOpen(state))contractDiscussionStatus(err.message,true);}
}
async function showTaskAssignee() {
  const state=contractApprovalUI;if(!contractConversationOpen(state)||!state.chat.task?.canManage)return;
  try {
    const data=await apiFetch(`/api/discussions/${state.kind||'contract'}/${state.engagementId}/assignees`);
    if(!contractConversationOpen(state))return;
    const tools=document.getElementById('discussionTools');tools.hidden=false;
    tools.innerHTML=`<form class="task-due-form" onsubmit="event.preventDefault();changeDiscussionTask('assign',this.querySelector('button[type=submit]'),{assigneeId:Number(this.querySelector('select').value)||null,expectedVersion:${state.chat.task.version}})"><label for="taskAssignee">Ответственный</label><select id="taskAssignee"><option value="">Не назначен</option>${data.people.map(p=>`<option value="${p.id}"${p.id===state.chat.task.assignee?.id?' selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select><button type="submit" class="contract-primary">Сохранить</button><button type="button" class="contract-secondary" onclick="closeDiscussionTools()">Отмена</button>${state.kind!=='room'?'<p class="discussion-property-empty">Ответственный будет добавлен в участники задачи.</p>':''}<p class="task-action-status" role="status"></p></form>`;
  }catch(err){if(contractConversationOpen(state))contractDiscussionStatus(err.message,true);}
}
// Wide mode, a collapsed task list and the properties rail are per-browser conveniences:
// the choice lives in localStorage and still works for the visit when storage is unavailable.
const TASKS_LAYOUT_KEY='crm.tasksLayout';
let tasksLayout=null;
function tasksLayoutState() {
  if(tasksLayout)return tasksLayout;
  try{tasksLayout=JSON.parse(localStorage.getItem(TASKS_LAYOUT_KEY)||'{}');}catch(e){tasksLayout=null;}
  if(!tasksLayout||typeof tasksLayout!=='object')tasksLayout={};
  return tasksLayout;
}
function rememberTasksLayout(name,value) {
  tasksLayoutState()[name]=value;
  try{localStorage.setItem(TASKS_LAYOUT_KEY,JSON.stringify(tasksLayout));}catch(e){/* private window or storage disabled */}
}
function applyTasksLayout() {
  const layout=tasksLayoutState(),wide=!!layout.wide,collapsed=!!layout.listCollapsed;
  document.body.classList.toggle('tasks-wide',wide);
  const wideButton=document.getElementById('tasksWideToggle');
  if(wideButton){
    wideButton.setAttribute('aria-pressed',String(wide));
    wideButton.title=wide?'Вернуть меню CRM слева':'Скрыть меню CRM и отдать экран задачам';
    wideButton.innerHTML=`<i class="fas fa-${wide?'compress':'expand'}" aria-hidden="true"></i> <span>${wide?'Обычный режим':'Широкий режим'}</span>`;
  }
  document.getElementById('discussionWorkspace')?.classList.toggle('list-collapsed',collapsed);
  const listButton=document.getElementById('taskListToggle');
  if(listButton){
    const label=collapsed?'Показать список задач':'Свернуть список задач';
    listButton.setAttribute('aria-expanded',String(!collapsed));listButton.setAttribute('aria-label',label);listButton.title=label;
    listButton.innerHTML=`<i class="fas fa-angles-${collapsed?'right':'left'}" aria-hidden="true"></i>`;
  }
}
function toggleTasksWide() {
  rememberTasksLayout('wide',!tasksLayoutState().wide);
  document.getElementById('sidebar')?.classList.remove('open');
  applyTasksLayout();
}
function toggleTaskList() {
  rememberTasksLayout('listCollapsed',!tasksLayoutState().listCollapsed);
  applyTasksLayout();
}
// In wide mode the CRM menu opens over the page with ☰; a click anywhere else closes it.
function closeWideMenu(event) {
  if(!document.body.classList.contains('tasks-wide')||event.target.closest?.('#menuToggle'))return;
  document.getElementById('sidebar')?.classList.remove('open');
}
if(typeof document!=='undefined'&&document.body){
  applyTasksLayout();
  document.getElementById('mainContent')?.addEventListener('click',closeWideMenu);
}
