const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function ui() {
  const elements = new Map();
  for (const id of ['discussionSourceList','discussionSourceSearch','discussionMain','discussionTitle','discussionPageEntry']) elements.set(id, { innerHTML:'', value:'', hidden:false, dataset:{}, classList:{ add(){}, remove(){} }, focus(){} });
  const ctx = vm.createContext({ document:{ getElementById:id=>elements.get(id), querySelector:()=>elements.get('discussionMain') },
    getAuth:()=>({permissions:{internal:true}}), stopContractConversation(){}, contractConversationOpen:()=>false,
    contractApprovalUI:{ kind:'room', data:{ room:{ links:[{kind:'lp',id:1}] } } },
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),
    showToast(){}, apiFetch:async()=>({}), window:{location:{href:'http://localhost/index.html'}}, history:{replaceState(){}}, URL,
  });
  for (const file of ['discussions.js','discussion-processes.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js',file),'utf8'),ctx);
  vm.runInContext(`discussionCategories = [
    {kind:'lp',title:'LP Register',icon:'fa-address-book',page:'lp-register',group:'Фонды',count:2},
    {kind:'spv',title:'SPV',icon:'fa-sitemap',page:'spvs',group:'Инвестиции',count:0}];
    discussionSources = [{kind:'lp',id:1,label:'LP Register',title:'Investor One',fundId:4,fundName:'Fund A'},
      {kind:'lp',id:2,label:'LP Register',title:'<Investor Two>',fundId:7,fundName:'Fund B'}];`,ctx);
  ctx.discussionsActive=()=>true;
  return {ctx,elements};
}
test('catalogue shows empty sections; a selected section explains zero records and offers its real CRM page',()=>{
  const {ctx,elements}=ui(); ctx.renderDiscussionProcessPicker('start');
  let html=elements.get('discussionSourceList').innerHTML;
  assert.match(html,/LP Register/); assert.match(html,/SPV/); assert.match(html,/Пока нет записей/);
  assert.match(html,/2 записи/);
  ctx.selectDiscussionProcessCategory('start','spv'); html=elements.get('discussionSourceList').innerHTML;
  assert.match(html,/пока нет доступных записей/); assert.match(html,/Открыть раздел/);
  let opened;ctx.navigateTo=page=>opened=page;ctx.openDiscussionProcessSection('spv');assert.equal(opened,'spvs');
});
test('search finds process by fund, escapes titles and linking excludes an already linked object',()=>{
  const {ctx,elements}=ui();ctx.renderDiscussionProcessPicker('start','Fund B');
  let html=elements.get('discussionSourceList').innerHTML;
  assert.match(html,/&lt;Investor Two&gt;/);assert.ok(!html.includes('Investor One'));assert.match(html,/chooseDiscussionProcess\(1,this\)/);
  ctx.renderDiscussionProcessPicker('link','','lp');html=elements.get('discussionSourceList').innerHTML;
  assert.ok(!html.includes('Investor One'));assert.match(html,/linkDiscussionSource\(1,this\)/);
});
test('process choice shows only server-authorized conversations and prepares a new topic with its source',async()=>{
  const {ctx,elements}=ui();let requested;
  ctx.apiFetch=async url=>{requested=url;return {source:{kind:'lp',id:2,label:'LP Register',title:'Investor Two'},items:[{kind:'room',id:8,title:'Existing topic'}],canCreate:true};};
  await ctx.chooseDiscussionProcess(1,{disabled:false});
  assert.equal(requested,'/api/discussions/source/lp/2');assert.match(elements.get('discussionMain').innerHTML,/Existing topic/);
  assert.match(elements.get('discussionMain').innerHTML,/openDiscussion\('room',8\)/);
  vm.runInContext('newDiscussion(discussionSelectedSource)',ctx);
  assert.equal(elements.get('discussionMain').discussionSource.id,2);assert.equal(elements.get('discussionMain').discussionSource.kind,'lp');
  assert.match(elements.get('discussionMain').innerHTML,/Задача: Investor Two/);
});
test('a delayed process lookup cannot replace a newly opened topic',async()=>{
  const {ctx,elements}=ui();let release;ctx.apiFetch=()=>new Promise(resolve=>{release=resolve;});
  const pending=ctx.chooseDiscussionProcess(0,{disabled:false});ctx.newDiscussion();
  const html=elements.get('discussionMain').innerHTML;
  release({source:{kind:'lp',id:1},items:[],canCreate:true});await pending;
  assert.equal(elements.get('discussionMain').innerHTML,html);
});
test('a linked LP opens its actual fund and detail card; major module entry points select their process category',async()=>{
  const {ctx,elements}=ui();const actions=[];
  ctx.activeFundId=4;ctx.apiFetch=async()=>({source:{kind:'lp',id:2,fundId:7}});
  ctx.loadFundsFromApi=async()=>actions.push('funds');ctx.switchFund=id=>actions.push(['fund',id]);
  ctx.loadLpRegisterFromApi=async()=>actions.push('lp');ctx.loadCapitalCallsFromApi=async()=>actions.push('calls');ctx.openLPDetail=id=>actions.push(['detail',id]);
  await ctx.openDiscussionSource('lp',2);assert.deepEqual(actions,['funds',['fund',7],'lp','calls',['detail',2]]);
  for (const [page,kind] of [['conflict-approvals','conflict'],['deals','deal'],['portfolio','portfolio'],['spvs','spv'],['lp-register','lp'],['lp-capital-calls','capital-call']]) {
    ctx.updateDiscussionEntryPoint(page);assert.equal(elements.get('discussionPageEntry').dataset.kind,kind);assert.equal(elements.get('discussionPageEntry').hidden,false);
  }
  ctx.updateDiscussionEntryPoint('users');assert.equal(elements.get('discussionPageEntry').hidden,true);
  ctx.URLSearchParams=URLSearchParams;ctx.window.location.search='?workspace=discussions';
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/contract-approvals.js'),'utf8'),ctx);
  let catalogueOpened=false;ctx.showDiscussionProcesses=async()=>{catalogueOpened=true;};
  await ctx.openContractApprovalLink();assert.equal(catalogueOpened,true);
});
test('contracts: writers can start a new contract here, a contract opens its main task, and without it a subtask is offered',async()=>{
  const {ctx,elements}=ui();
  vm.runInContext(`discussionCategories.push({kind:'contract',title:'Договоры',icon:'fa-file-signature',page:'engagements',group:'Клиенты',count:1});
    discussionSources.push({kind:'contract',id:5,label:'Договор',title:'GL-1 · Client'});`,ctx);
  let readOnly=false;ctx.currentUserPermission=key=>key==='readOnly'&&readOnly;
  ctx.selectDiscussionProcessCategory('start','contract');
  assert.match(elements.get('discussionSourceList').innerHTML,/newContractFromTasks\(this\)/);
  readOnly=true;ctx.selectDiscussionProcessCategory('start','contract');
  assert.ok(!elements.get('discussionSourceList').innerHTML.includes('newContractFromTasks'));
  ctx.renderDiscussionProcessPicker('link','','contract');
  assert.ok(!elements.get('discussionSourceList').innerHTML.includes('newContractFromTasks'));

  const opened=[];ctx.openDiscussion=(kind,id)=>opened.push([kind,id]);
  ctx.apiFetch=async()=>({source:{kind:'contract',id:5,label:'Договор',title:'GL-1 · Client'},items:[{kind:'contract',id:5,title:'Задача по договору'},{kind:'room',id:9,title:'Sub'}],canCreate:true});
  await ctx.chooseDiscussionProcess(2,{disabled:false});
  assert.deepEqual(opened,[['contract',5]]);
  ctx.apiFetch=async()=>({source:{kind:'contract',id:5,label:'Договор',title:'GL-1 · Client'},items:[{kind:'room',id:9,title:'Sub'}],canCreate:true});
  await ctx.chooseDiscussionProcess(2,{disabled:false});
  assert.equal(opened.length,1);assert.match(elements.get('discussionMain').innerHTML,/Новая подзадача по договору/);
});
test('new contract from tasks reloads onboarding data and asks the form to open the task after saving',async()=>{
  const {ctx}=ui();let modal;
  vm.runInContext('var obClients=[{id:1}], obTasks=[], engagements=[{id:3}];',ctx);
  ctx.openNewEngagementModal=(...args)=>{modal=args;};
  ctx.apiFetch=async url=>{assert.equal(url,'/api/onboarding');return {obClients:[{id:2,name:'Fresh'}],obTasks:[],engagements:[]};};
  const button={disabled:false};await ctx.newContractFromTasks(button);
  assert.deepEqual(modal,[null,null,true]);assert.equal(button.disabled,false);
  assert.equal(vm.runInContext('obClients.map(c=>c.id).join()',ctx),'2');assert.equal(vm.runInContext('engagements.length',ctx),0);
});
test('onboarding: a new client can be started here and gets a linked onboarding task due on its target date',async()=>{
  const {ctx,elements}=ui();
  vm.runInContext(`discussionCategories.push({kind:'client',title:'Онбординг',icon:'fa-user-plus',page:'ob-clients',group:'Клиенты',count:0});`,ctx);
  ctx.currentUserPermission=()=>false;
  ctx.selectDiscussionProcessCategory('start','client');
  assert.match(elements.get('discussionSourceList').innerHTML,/newClientFromTasks\(this\)/);
  assert.ok(!elements.get('discussionSourceList').innerHTML.includes('newContractFromTasks'));

  let form;ctx.openNewObClientModal=(...args)=>{form=args;};
  vm.runInContext('var obClients=[], obTasks=[], engagements=[];',ctx);
  ctx.apiFetch=async()=>({obClients:[],obTasks:[],engagements:[]});
  await ctx.newClientFromTasks({disabled:false});assert.deepEqual(form,[null,true]);

  const posted=[],opened=[];ctx.contractTemplateRequestKey=()=>'k'.repeat(32);
  ctx.apiFetch=async(url,options)=>{posted.push([url,JSON.parse(options.body)]);return {id:44};};
  ctx.refreshDiscussionList=async()=>{};ctx.openDiscussion=(kind,id)=>opened.push([kind,id]);
  await ctx.startClientOnboardingTask({id:3,name:'<ACME>',targetDate:'2026-11-18'});
  assert.equal(posted[0][0],'/api/discussions');
  assert.equal(JSON.stringify(posted[0][1]),JSON.stringify({title:'Онбординг: <ACME>',participants:[],dueDate:'2026-11-18',source:{kind:'client',id:3},requestKey:'k'.repeat(32)}));
  assert.deepEqual(opened,[['room',44]]);
});
