const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const selectStub=()=>({value:'',innerHTML:'',get options(){return [...this.innerHTML.matchAll(/value="([^"]*)"/g)].map(m=>({value:m[1]}));}});
function ui(){
  const elements=new Map(Object.entries({discussionList:{innerHTML:''},discussionBulk:{innerHTML:'',hidden:true},discussionQuickFilter:{innerHTML:'',hidden:true},discussionAssigneeFilter:selectStub(),discussionClientFilter:selectStub(),'badge-discussions':{textContent:'',title:'',style:{display:'none'}},discussionSearch:{value:''},discussionChatFilter:{value:''},discussionTaskSort:{value:'activity'},contractChatFeed:{scrollHeight:800,scrollTop:600,clientHeight:200}}));
  const tabs=['open','completed','trashed'].map(status=>({dataset:{taskFilter:status},classList:{toggle(){}},setAttribute(){}}));
  const ctx=vm.createContext({Intl,Date,document:{visibilityState:'visible',getElementById:id=>elements.get(id),querySelectorAll:()=>tabs},contractApprovalUI:null,
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),
    contractConversationOpen:state=>!!state&&state===ctx.contractApprovalUI&&!state.closed,apiFetch:async()=>({unread:0})});
  for(const file of ['discussions.js','discussion-tasks.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js',file),'utf8'),ctx);
  ctx.updateDiscussionChatFilter=()=>{};
  return{ctx,elements};
}
function renameUi(){
  const {ctx,elements}=ui();
  const input={value:'Original',readOnly:false,focus(){},select(){}},heading={innerHTML:'',focus(){}},status={textContent:''};
  elements.set('taskRenameTitle',input);elements.set('taskRenameStatus',status);
  elements.set('discussionContext',{innerHTML:'Original header'});
  ctx.document.querySelector=()=>heading;
  ctx.contractApprovalUI={kind:'room',engagementId:9,chat:{task:{title:'Original',version:2,status:'open',canManage:true}},data:{room:{title:'Original'},cycles:[]}};
  ctx.contractTemplateRequestKey=()=> 'rename-request-key';
  ctx.discussionTitleHeader=title=>title;
  ctx.renderDiscussionProperties=()=>{};
  ctx.refreshDiscussionList=async()=>{};
  return {ctx,elements,input,heading,status,state:ctx.contractApprovalUI};
}
test('permanent delete is exposed only in trash and asks once before making any request',()=>{
  const {ctx,elements,state}=renameUi();
  const tools={hidden:true,innerHTML:''};elements.set('discussionTools',tools);
  let requests=0;ctx.apiFetch=async()=>{requests++;};
  assert.ok(!ctx.taskControls(state).includes('showTaskPurge'));
  state.chat.task.status='trashed';assert.match(ctx.taskControls(state),/showTaskPurge/);
  ctx.showTaskPurge();assert.equal(requests,0);assert.equal(tools.hidden,false);
  assert.match(tools.innerHTML,/Удалить «Original» навсегда/);assert.match(tools.innerHTML,/purgeDiscussionTask\(this,2\)/);assert.match(tools.innerHTML,/Отмена/);
  state.chat.task.canManage=false;assert.ok(!ctx.taskControls(state).includes('showTaskPurge'));
});
test('purge closes the deleted task, clears its draft and refreshes the list; failed requests retain the task',async()=>{
  const {ctx,elements,state,status}=renameUi();state.chat.task.status='trashed';state.panel={dataset:{surface:'hub'}};
  elements.set('discussionMain',{innerHTML:'Task'});ctx.document.querySelector=()=>status;
  ctx.URL=URL;ctx.window={location:{href:'http://localhost:4000/index.html?discussion=9'}};ctx.history={replaceState(){}};
  let forgotten=0,refreshes=0;ctx.forgetDiscussionDraft=()=>{forgotten++;};ctx.stopContractConversation=()=>{state.closed=true;};ctx.refreshDiscussionList=async()=>{refreshes++;};
  ctx.apiFetch=async()=>{throw new Error('Offline');};const button={disabled:false};
  await ctx.purgeDiscussionTask(button,2);assert.equal(state.closed,undefined);assert.equal(forgotten,0);assert.equal(button.disabled,false);assert.equal(status.textContent,'Offline');
  ctx.apiFetch=async(url,options)=>{assert.equal(url,'/api/discussions/room/9');assert.equal(options.method,'DELETE');assert.equal(JSON.parse(options.body).expectedVersion,2);return {deleted:true};};
  await ctx.purgeDiscussionTask(button,2);assert.equal(state.closed,true);assert.equal(forgotten,1);assert.equal(refreshes,1);assert.match(elements.get('discussionMain').innerHTML,/удалена навсегда/);
});
test('rename is inline, survives polling, cancels with Escape and rejects an empty title',async()=>{
  const {ctx,elements,input,heading,status,state}=renameUi();
  let calls=0;ctx.apiFetch=async()=>{calls++;};
  ctx.showTaskRename();assert.match(heading.innerHTML,/onblur="renameDiscussionTask/);assert.ok(!heading.innerHTML.includes('<form'));
  input.value='Draft';ctx.renderDiscussionContext(state);
  assert.equal(elements.get('discussionContext').innerHTML,'Original header');assert.equal(input.value,'Draft');
  input.value='   ';await ctx.renameDiscussionTask(input);assert.equal(calls,0);assert.match(status.textContent,/пустым/);
  ctx.taskRenameKey({key:'Escape',preventDefault(){}},input);
  await ctx.renameDiscussionTask(input);assert.equal(calls,0);assert.equal(state.titleEdit,undefined);
  assert.equal(elements.get('discussionContext').innerHTML,'Original');
});
test('Enter plus blur sends once; successful rename updates the header and room',async()=>{
  const {ctx,input,elements,state}=renameUi();let finish,calls=0;
  ctx.apiFetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.title,'New title');assert.equal(body.expectedVersion,2);await new Promise(resolve=>finish=resolve);return {task:{...state.chat.task,title:body.title,version:3}};};
  ctx.showTaskRename();input.value=' New title ';
  const pending=ctx.renameDiscussionTask(input);await ctx.renameDiscussionTask(input);assert.equal(calls,1);assert.equal(input.readOnly,true);
  finish();await pending;
  assert.equal(state.titleEdit,undefined);assert.equal(state.data.room.title,'New title');assert.equal(elements.get('discussionContext').innerHTML,'New title');
});
test('failed rename keeps typed text and reuses request key; conflict refresh preserves the draft',async()=>{
  const {ctx,input,status,state}=renameUi();const bodies=[];
  ctx.apiFetch=async(url,options)=>{bodies.push(JSON.parse(options.body));throw Object.assign(new Error('Conflict'),{status:409});};
  ctx.loadContractConversation=async()=>{state.chat.task={...state.chat.task,title:'Changed elsewhere',version:3};ctx.renderDiscussionContext(state);};
  ctx.showTaskRename();input.value='My draft';await ctx.renameDiscussionTask(input);
  assert.equal(input.value,'My draft');assert.equal(state.titleEdit.version,3);assert.match(status.textContent,/Changed elsewhere/);assert.equal(input.readOnly,false);
  ctx.apiFetch=async(url,options)=>{bodies.push(JSON.parse(options.body));throw new Error('Offline');};
  await ctx.renameDiscussionTask(input);await ctx.renameDiscussionTask(input);
  assert.equal(bodies[1].expectedVersion,3);assert.equal(bodies[1].requestKey,bodies[2].requestKey);assert.equal(input.value,'My draft');
});
test('task sorting is deterministic, does not mutate input, puts no deadline last and uses lifecycle activity',()=>{
  const{ctx}=ui();const items=[
    {kind:'room',id:1,title:'Бета',createdAt:'2026-01-01',updatedAt:'2026-10-01',task:{status:'open',dueDate:null,updatedAt:'2026-10-30'}},
    {kind:'room',id:2,title:'Альфа',createdAt:'2026-02-01',updatedAt:'2026-10-20',task:{status:'open',dueDate:'2026-11-01'}},
    {kind:'contract',id:3,title:'Январь',createdAt:'2026-03-01',updatedAt:'2026-10-10',task:{status:'completed',dueDate:'2026-10-15'}}];
  const ids=(sort)=>Array.from(ctx.sortTaskItems(items,sort),i=>i.id);
  assert.deepEqual(ids('activity'),[1,2,3]);assert.deepEqual(ids('due'),[3,2,1]);assert.deepEqual(ids('created'),[3,2,1]);assert.deepEqual(ids('title'),[2,1,3]);assert.deepEqual(items.map(i=>i.id),[1,2,3]);
  assert.equal(ctx.taskOverdue({status:'open',dueDate:'2026-10-27'},'2026-10-28'),true);
  assert.equal(ctx.taskOverdue({status:'open',dueDate:'2026-10-28'},'2026-10-28'),false);
  assert.equal(ctx.taskOverdue({status:'completed',dueDate:'2026-10-27'},'2026-10-28'),false);
});
test('list filters lifecycle, process and text together and escapes author/message/title',()=>{
  const{ctx,elements}=ui();vm.runInContext(`discussionItems=[
    {kind:'room',id:1,title:'<Open>',label:'Task',preview:'<message>',lastAuthor:'<author>',unread:2,sources:[{kind:'client',label:'Client',title:'Acme'}],task:{status:'open',dueDate:'2026-11-10'}},
    {kind:'room',id:2,title:'Completed',preview:'',unread:0,sources:[],task:{status:'completed'}},
    {kind:'room',id:3,title:'Trashed',preview:'',unread:0,sources:[],task:{status:'trashed'}}];`,ctx);
  ctx.renderDiscussionList();let html=elements.get('discussionList').innerHTML;
  assert.match(html,/&lt;Open&gt;/);assert.match(html,/&lt;author&gt;: &lt;message&gt;/);assert.match(html,/Непрочитанных: 2/);assert.ok(!html.includes('Completed')&&!html.includes('Trashed'));
  elements.get('discussionChatFilter').value='free';ctx.renderDiscussionList();assert.ok(!elements.get('discussionList').innerHTML.includes('&lt;Open&gt;'));
  elements.get('discussionChatFilter').value='';ctx.setTaskFilter('completed');assert.match(elements.get('discussionList').innerHTML,/Completed/);
  ctx.setTaskFilter('trashed');assert.match(elements.get('discussionList').innerHTML,/Trashed/);
  elements.get('discussionSearch').value='unknown';ctx.renderDiscussionList();assert.ok(!elements.get('discussionList').innerHTML.includes('Trashed'));
});
function bulkUi(items){
  const {ctx,elements}=ui();let keys=0;ctx.contractTemplateRequestKey=()=>'bulk-key-'+(++keys);
  ctx.refreshDiscussionList=async()=>ctx.renderDiscussionList();
  vm.runInContext(`discussionItems=${JSON.stringify(items)};`,ctx);ctx.renderDiscussionList();
  const row=(kind,id)=>elements.get('discussionList').innerHTML.split('<div class="discussion-list-row">').find(r=>r.includes(`openDiscussion('${kind}',${id})`));
  return {ctx,bar:elements.get('discussionBulk'),row};
}
const bulkTask=(kind,id,title,task)=>({kind,id,title,preview:'',sources:[],task:{status:'open',version:1,canManage:true,...task}});
test('bulk selection offers checkboxes only for tasks the user may change, none in the trash; a tab switch clears it',()=>{
  const {ctx,bar,row}=bulkUi([bulkTask('room',1,'Mine'),bulkTask('room',2,'Theirs',{canManage:false}),bulkTask('contract',3,'Under review',{reviewActive:true,closeBlockedReason:'Сначала завершите согласование'}),
    bulkTask('room',4,'Done',{status:'completed'}),bulkTask('room',5,'Bin',{status:'trashed'})]);
  assert.match(row('room',1),/class="task-select"/);assert.ok(!row('room',1).includes('disabled'));
  assert.match(row('room',2),/disabled title="Изменять задачу может её создатель/);assert.match(row('contract',3),/disabled title="Сначала завершите согласование"/);
  assert.equal(bar.hidden,false);assert.match(bar.innerHTML,/Выбрать все/);assert.ok(!bar.innerHTML.includes('runTaskBulk'));
  ctx.toggleTaskSelection('room',2,true);ctx.toggleTaskSelection('contract',3,true);assert.ok(!bar.innerHTML.includes('Выбрано'));
  ctx.selectAllTasks(true);assert.match(bar.innerHTML,/Выбрано: 1/);assert.match(row('room',1),/ checked/);
  assert.match(bar.innerHTML,/runTaskBulk\('complete'\)/);assert.match(bar.innerHTML,/runTaskBulk\('trash'\)/);
  ctx.setTaskFilter('completed');assert.ok(!row('room',4).includes(' checked'));
  ctx.toggleTaskSelection('room',4,true);assert.match(bar.innerHTML,/Выбрано: 1/);assert.ok(!bar.innerHTML.includes("'complete'"));
  ctx.setTaskFilter('trashed');assert.ok(!row('room',5).includes('task-select'));assert.equal(bar.hidden,true);
});
test('bulk complete sends each task its own lifecycle command, reloads the open task and keeps failures selected for retry',async()=>{
  const {ctx,bar,row}=bulkUi([{...bulkTask('room',1,'One'),updatedAt:'2026-10-28'},bulkTask('contract',2,'<Two>',{version:5})]);
  const state={kind:'room',engagementId:1},reloaded=[],calls=[];ctx.contractApprovalUI=state;ctx.loadContractConversation=async id=>{reloaded.push(id);};
  let release;ctx.apiFetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});
    if(url.includes('contract'))throw Object.assign(new Error('Задача изменилась'),{status:409});await new Promise(r=>release=r);return {task:{}};};
  ctx.selectAllTasks(true);await ctx.runTaskBulk('complete');
  assert.match(bar.innerHTML,/Результат для выбранных задач \(2\)/);assert.equal(calls.length,0);
  await ctx.runTaskBulk('complete',true);assert.equal(calls.length,0,'no result, no request');assert.match(bar.innerHTML,/Опишите результат/);
  vm.runInContext("discussionBulk.result='  Готово  '",ctx);const pending=ctx.runTaskBulk('complete',true);
  assert.match(row('room',1),/disabled/);await ctx.runTaskBulk('complete',true);ctx.toggleTaskSelection('room',1,false);assert.equal(calls.length,1,'busy run ignores repeats and selection changes');
  release();await pending;
  assert.equal(JSON.stringify(calls),JSON.stringify([{url:'/api/discussions/room/1/state',body:{action:'complete',expectedVersion:1,result:'Готово',requestKey:'bulk-key-1'}},
    {url:'/api/discussions/contract/2/state',body:{action:'complete',expectedVersion:5,result:'Готово',requestKey:'bulk-key-2'}}]));
  assert.deepEqual(reloaded,[1]);assert.match(bar.innerHTML,/Завершено задач: 1\./);assert.match(bar.innerHTML,/task-bulk-status error/);
  assert.match(bar.innerHTML,/«&lt;Two&gt;» — Задача изменилась/);assert.match(bar.innerHTML,/Выбрано: 1/);assert.match(row('contract',2),/ checked/);assert.ok(!row('room',1).includes(' checked'));
  await ctx.runTaskBulk('complete');await ctx.runTaskBulk('complete',true);assert.equal(calls[2].body.requestKey,'bulk-key-2','the unanswered command keeps its key and result');
});
test('bulk trash asks once before any request; cancel keeps the selection',async()=>{
  const {ctx,bar}=bulkUi([bulkTask('room',1,'One'),bulkTask('contract',2,'Two')]);
  let calls=0;ctx.apiFetch=async()=>{calls++;return {task:{}};};
  ctx.selectAllTasks(true);await ctx.runTaskBulk('trash');assert.equal(calls,0);
  assert.match(bar.innerHTML,/Переместить в корзину выбранные задачи \(2\)/);assert.match(bar.innerHTML,/Договоры и история согласований не меняются/);assert.match(bar.innerHTML,/runTaskBulk\('trash',true\)/);
  ctx.cancelTaskBulk();assert.ok(!bar.innerHTML.includes('Переместить'));assert.match(bar.innerHTML,/Выбрано: 2/);
  await ctx.runTaskBulk('trash');await ctx.runTaskBulk('trash',true);assert.equal(calls,2);assert.match(bar.innerHTML,/В корзину перемещено задач: 2\./);assert.ok(!bar.innerHTML.includes('error'));
});
test('deadline chips filter the open list, today is labelled and the overdue count drives the menu badge',()=>{
  const {ctx,elements}=ui();
  const day=o=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+o*86400000));
  vm.runInContext(`discussionItems=${JSON.stringify([bulkTask('room',1,'Late',{dueDate:day(-1)}),bulkTask('room',2,'Now',{dueDate:day(0)}),
    bulkTask('room',3,'Upcoming',{dueDate:day(3)}),bulkTask('room',4,'Old done',{status:'completed',dueDate:day(-5)})])};`,ctx);
  ctx.renderDiscussionList();
  const list=()=>elements.get('discussionList').innerHTML,chips=elements.get('discussionQuickFilter'),badge=elements.get('badge-discussions');
  assert.equal(chips.hidden,false);assert.match(chips.innerHTML,/Просрочено · 1/);assert.match(chips.innerHTML,/Срок сегодня · 1/);
  assert.equal(badge.textContent,1);assert.equal(badge.style.display,'');assert.match(badge.title,/Просроченных задач: 1/);
  assert.match(list(),/class="overdue"[^>]*>Просрочена · /);assert.match(list(),/class="due-today"[^>]*>Срок сегодня</);
  ctx.setTaskQuickFilter('overdue');assert.match(list(),/Late/);assert.ok(!list().includes('Now')&&!list().includes('Upcoming'));assert.match(chips.innerHTML,/selected" aria-pressed="true"/);
  ctx.setTaskQuickFilter('today');assert.match(list(),/Now/);assert.ok(!list().includes('Late'));
  ctx.setTaskQuickFilter('today');assert.match(list(),/Upcoming/,'a second press shows the whole list again');
  ctx.setTaskQuickFilter('overdue');ctx.setTaskFilter('completed');assert.equal(chips.hidden,true);assert.match(list(),/Old done/);
  ctx.setTaskFilter('open');assert.match(list(),/Upcoming/,'switching tabs clears the deadline filter');
  ctx.setTaskQuickFilter('overdue');vm.runInContext(`discussionItems[0].task.status='completed';`,ctx);ctx.renderDiscussionList();
  assert.match(list(),/Upcoming/,'the filter lets go once nothing is overdue');assert.equal(badge.style.display,'none');assert.ok(!chips.innerHTML.includes('Просрочено'));
});
test('read receipts wait for visible latest messages; repeat render and scrolling history do not mark newer messages read',async()=>{
  const{ctx,elements}=ui();const calls=[];ctx.renderDiscussionList=()=>{};
  const state={kind:'room',engagementId:9,chat:{after:12}};ctx.contractApprovalUI=state;
  ctx.apiFetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{unread:0};};
  ctx.document.visibilityState='hidden';await ctx.markDiscussionRead();assert.equal(calls.length,0);
  ctx.document.visibilityState='visible';elements.get('contractChatFeed').scrollTop=100;await ctx.markDiscussionRead();assert.equal(calls.length,0);
  elements.get('contractChatFeed').scrollTop=600;await ctx.markDiscussionRead();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/discussions/room/9/read');assert.equal(calls[0].body.lastMessageId,12);
  await ctx.markDiscussionRead();assert.equal(calls.length,1);
  state.chat.after=13;elements.get('contractChatFeed').scrollTop=100;await ctx.markDiscussionRead();assert.equal(calls.length,1);
  elements.get('contractChatFeed').scrollTop=600;await ctx.markDiscussionRead();assert.equal(calls.length,2);
});
test('decision and rework filters, responsible person and client filters narrow the open list; waiting decisions count on the menu',()=>{
  const {ctx,elements}=ui();ctx.getAuth=()=>({user:{id:7}});
  vm.runInContext(`discussionItems=${JSON.stringify([{...bulkTask('contract',1,'Decide me',{review:'decide',assignee:{id:7,name:'Анна'}}),clients:[{id:50,name:'Acme'}]},
    {...bulkTask('contract',2,'Rework me',{review:'rework'}),clients:[{id:51,name:'Beta'}]},{...bulkTask('room',3,'Plain',{assignee:{id:8,name:'Борис'}}),clients:[]}])};`,ctx);
  ctx.renderDiscussionList();
  const list=()=>elements.get('discussionList').innerHTML,chips=elements.get('discussionQuickFilter'),badge=elements.get('badge-discussions');
  const shown=()=>['Decide me','Rework me','Plain'].filter(t=>list().includes(t));
  assert.match(chips.innerHTML,/Жду моего решения · 1/);assert.match(chips.innerHTML,/На доработке · 1/);
  assert.equal(badge.textContent,1);assert.match(badge.title,/Ждут вашего решения: 1/);
  ctx.setTaskQuickFilter('decide');assert.deepEqual(shown(),['Decide me']);
  ctx.setTaskQuickFilter('rework');assert.deepEqual(shown(),['Rework me']);
  ctx.setTaskQuickFilter('rework');assert.equal(shown().length,3);
  const assignee=elements.get('discussionAssigneeFilter'),client=elements.get('discussionClientFilter');
  assert.match(assignee.innerHTML,/value="8">Борис/);assert.match(client.innerHTML,/value="50">Acme/);
  for(const [value,expected] of [['me',['Decide me']],['none',['Rework me']],['8',['Plain']]]){assignee.value=value;ctx.renderDiscussionList();assert.deepEqual(shown(),expected,value);}
  assignee.value='';client.value='51';ctx.renderDiscussionList();assert.deepEqual(shown(),['Rework me']);
});
test('completing a task asks for its result first and shows it on the completed task',async()=>{
  const {ctx,elements,state}=renameUi();const tools={hidden:true,innerHTML:''};
  elements.set('discussionTools',tools);elements.set('taskCompleteResult',{focus(){}});
  const bodies=[];ctx.apiFetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return {task:{...state.chat.task,status:'completed',result:'Готово',version:3}};};
  ctx.closeDiscussionTools=()=>{};ctx.loadContractConversation=async()=>{};
  assert.match(ctx.taskControls(state),/onclick="showTaskComplete\(\)"/);
  ctx.showTaskComplete();assert.equal(tools.hidden,false);assert.match(tools.innerHTML,/Результат задачи/);
  const status={textContent:''},button={disabled:false},area={value:'  '};
  const form={querySelector:s=>s==='textarea'?area:s==='.task-action-status'?status:button};
  await ctx.completeDiscussionTask(form);assert.equal(bodies.length,0);assert.match(status.textContent,/Опишите результат/);
  area.value=' Готово ';await ctx.completeDiscussionTask(form);
  assert.equal(bodies[0].action,'complete');assert.equal(bodies[0].result,'Готово');assert.equal(bodies[0].expectedVersion,2);
  state.chat.task={...state.chat.task,status:'completed',result:'<Готово>'};
  assert.match(ctx.taskControls(state),/Результат:<\/strong> &lt;Готово&gt;/);assert.match(ctx.taskControls(state),/changeDiscussionTask\('reopen',this\)/);
});
