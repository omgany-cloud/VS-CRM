const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function classes(){
  const set=new Set();
  return {set,contains:n=>set.has(n),add:n=>set.add(n),remove:n=>set.delete(n),toggle(n,force){const on=force===undefined?!set.has(n):!!force;on?set.add(n):set.delete(n);return on;}};
}
function element(){const attrs={};return {classList:classes(),attrs,innerHTML:'',title:'',hidden:false,setAttribute:(k,v)=>{attrs[k]=v;},addEventListener(type,fn){this.listener=fn;}};}
function layout({stored,width=1400,storage}={}){
  const saved=new Map(stored===undefined?[]:[['crm.tasksLayout',stored]]);
  const localStorage=storage||{getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,String(v))};
  const elements=new Map(['tasksWideToggle','taskListToggle','discussionWorkspace','sidebar','mainContent','discussionPropertiesToggle','discussionProperties'].map(id=>[id,element()]));
  const body={classList:classes()};
  const ctx=vm.createContext({localStorage,window:{innerWidth:width},document:{body,getElementById:id=>elements.get(id)},contractApprovalUI:null,contractConversationOpen:s=>!!s&&!s.closed});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/discussion-layout.js'),'utf8'),ctx);
  return {ctx,elements,body,saved};
}
test('wide mode hides the CRM menu, is remembered and restored on the next load',()=>{
  const {ctx,elements,body,saved}=layout();
  const button=elements.get('tasksWideToggle');
  assert.equal(body.classList.contains('tasks-wide'),false);assert.equal(button.attrs['aria-pressed'],'false');assert.match(button.innerHTML,/Широкий режим/);
  elements.get('sidebar').classList.add('open');
  ctx.toggleTasksWide();
  assert.equal(body.classList.contains('tasks-wide'),true);assert.equal(button.attrs['aria-pressed'],'true');
  assert.match(button.innerHTML,/fa-compress/);assert.match(button.innerHTML,/Обычный режим/);
  assert.equal(elements.get('sidebar').classList.contains('open'),false);
  assert.deepEqual(JSON.parse(saved.get('crm.tasksLayout')),{wide:true});
  const next=layout({stored:saved.get('crm.tasksLayout')});
  assert.equal(next.body.classList.contains('tasks-wide'),true);assert.match(next.elements.get('tasksWideToggle').innerHTML,/Обычный режим/);
  next.ctx.toggleTasksWide();assert.equal(next.body.classList.contains('tasks-wide'),false);
});
test('the task list collapses to a rail with an accessible label and keeps other preferences',()=>{
  const {ctx,elements,saved}=layout({stored:JSON.stringify({wide:true})});
  const workspace=elements.get('discussionWorkspace'),button=elements.get('taskListToggle');
  assert.equal(button.attrs['aria-expanded'],'true');
  ctx.toggleTaskList();
  assert.equal(workspace.classList.contains('list-collapsed'),true);
  assert.equal(button.attrs['aria-expanded'],'false');assert.equal(button.attrs['aria-label'],'Показать список задач');assert.match(button.innerHTML,/fa-angles-right/);
  assert.deepEqual(JSON.parse(saved.get('crm.tasksLayout')),{wide:true,listCollapsed:true});
  ctx.toggleTaskList();
  assert.equal(workspace.classList.contains('list-collapsed'),false);assert.equal(button.attrs['aria-label'],'Свернуть список задач');assert.match(button.innerHTML,/fa-angles-left/);
});
test('task properties remember a choice made on a wide screen and stay closed by default on narrow ones',()=>{
  const wide=layout();
  const panel={classList:classes()},state={panel};wide.ctx.contractApprovalUI=state;
  wide.ctx.applyDiscussionPropertiesVisibility(state);assert.equal(state.propertiesOpen,true);
  wide.ctx.toggleDiscussionProperties();
  assert.equal(state.propertiesOpen,false);assert.equal(panel.classList.contains('properties-closed'),true);assert.equal(wide.elements.get('discussionProperties').hidden,true);
  assert.deepEqual(JSON.parse(wide.saved.get('crm.tasksLayout')),{propertiesOpen:false});
  const reopened=layout({stored:wide.saved.get('crm.tasksLayout')}),next={panel:{classList:classes()}};
  reopened.ctx.applyDiscussionPropertiesVisibility(next);assert.equal(next.propertiesOpen,false);
  const narrow=layout({width:900}),small={panel:{classList:classes()}};narrow.ctx.contractApprovalUI=small;
  narrow.ctx.applyDiscussionPropertiesVisibility(small);assert.equal(small.propertiesOpen,false);
  narrow.ctx.toggleDiscussionProperties();assert.equal(small.propertiesOpen,true);
  assert.equal(narrow.saved.has('crm.tasksLayout'),false,'an overlay opened on a narrow screen is not a remembered preference');
});
test('layout toggles still work for the visit when browser storage is unavailable',()=>{
  const broken={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  const {ctx,elements,body}=layout({storage:broken});
  ctx.toggleTasksWide();ctx.toggleTaskList();
  assert.equal(body.classList.contains('tasks-wide'),true);assert.equal(elements.get('discussionWorkspace').classList.contains('list-collapsed'),true);
  const corrupt=layout({stored:'not json'});assert.equal(corrupt.body.classList.contains('tasks-wide'),false);
  const scalar=layout({stored:'5'});scalar.ctx.toggleTaskList();assert.equal(scalar.elements.get('discussionWorkspace').classList.contains('list-collapsed'),true);
});
test('in wide mode a click outside the menu closes it, the ☰ button does not',()=>{
  const {ctx,elements}=layout();
  const sidebar=elements.get('sidebar'),click=elements.get('mainContent').listener;
  const outside={target:{closest:()=>null}},toggle={target:{closest:s=>s==='#menuToggle'?{}:null}};
  sidebar.classList.add('open');click(outside);assert.equal(sidebar.classList.contains('open'),true,'normal mode keeps the existing menu behaviour');
  ctx.toggleTasksWide();sidebar.classList.add('open');
  click(toggle);assert.equal(sidebar.classList.contains('open'),true);
  click(outside);assert.equal(sidebar.classList.contains('open'),false);
});
