const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function ui(){
  const elements=new Map(Object.entries({discussionList:{innerHTML:''},discussionSearch:{value:''},discussionChatFilter:{value:''},discussionTaskSort:{value:'activity'},contractChatFeed:{scrollHeight:800,scrollTop:600,clientHeight:200}}));
  const tabs=['open','completed','trashed'].map(status=>({dataset:{taskFilter:status},classList:{toggle(){}},setAttribute(){}}));
  const ctx=vm.createContext({Intl,Date,document:{visibilityState:'visible',getElementById:id=>elements.get(id),querySelectorAll:()=>tabs},contractApprovalUI:null,
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),
    contractConversationOpen:state=>state===ctx.contractApprovalUI&&!state?.closed,apiFetch:async()=>({unread:0})});
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
