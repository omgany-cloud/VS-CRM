const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function ui(){
  const elements=new Map(['discussionFileList','discussionFileCount','discussionFileSearch','discussionFilesStatus'].map(id=>[id,{innerHTML:'',textContent:'',hidden:false,value:''}]));
  const state={kind:'room',engagementId:7,chat:{documents:[],messages:new Map()},fileCatalogLoaded:true,fileCatalog:[]};
  const downloads=[];
  const ctx=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:()=>({click(){downloads.push(this.download);},remove(){}}),body:{appendChild(){}}},
    contractApprovalUI:state,contractConversationOpen:s=>s===ctx.contractApprovalUI&&!s.closed,
    escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),
    URL:{createObjectURL:()=> 'blob:example',revokeObjectURL(){}},setTimeout(){},contractDiscussionStatus(){},
    apiFetch:async()=>({files:[]}),contractDocumentFetch:async()=>({blob:async()=>({})})});
  for(const file of ['discussion-files.js','contract-discussion.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js',file),'utf8'),ctx);
  ctx.contractConversationOpen=s=>s===ctx.contractApprovalUI&&!s.closed;
  return{ctx,state,elements,downloads};
}
test('file search covers the complete catalogue, escapes filenames and retains identical names as separate downloads',()=>{
  const{ctx,state,elements}=ui();state.fileCatalog=[
    {id:1,name:'<Report>.pdf',size:1536,createdAt:'2026-10-20',author:'<Author>'},
    {id:2,name:'<Report>.pdf',size:5,createdAt:'2026-10-21',author:'Someone'},
    {id:3,name:'Other.txt',size:4,createdAt:'2026-10-22'}];
  elements.get('discussionFileSearch').value='REPORT';ctx.filterDiscussionFiles('REPORT');
  const html=elements.get('discussionFileList').innerHTML;
  assert.match(html,/&lt;Report&gt;\.pdf/);assert.ok(!html.includes('<Report>'));assert.ok(!html.includes('Other.txt'));
  assert.match(html,/downloadDiscussionAttachment\(1,this\)/);assert.match(html,/downloadDiscussionAttachment\(2,this\)/);
  assert.equal(elements.get('discussionFileCount').textContent,'3');
  state.fileCatalog.push({id:4,name:'Report New.pdf',size:9,createdAt:'2026-10-23'});ctx.renderDiscussionFiles(state);
  assert.equal(elements.get('discussionFileSearch').value,'REPORT');assert.match(elements.get('discussionFileList').innerHTML,/Report New/);
});
test('older attachment downloads without its message loaded; contract revisions use their own IDs and download route',async()=>{
  const{ctx,state,elements,downloads}=ui();state.fileCatalog=[{id:8,name:'Older.txt',size:3,createdAt:'2026-10-01'}];
  let requested;ctx.contractDocumentFetch=async url=>{requested=url;return{blob:async()=>({})};};
  const button={disabled:false};await ctx.downloadDiscussionAttachment(8,button);
  assert.equal(requested,'/api/discussions/7/files/8');assert.deepEqual(downloads,['Older.txt']);assert.equal(button.disabled,false);
  state.kind='contract';state.chat.documents=[{id:8,filename:'Contract.docx',version:2,createdAt:'2026-10-22'}];
  ctx.renderDiscussionFiles(state);const html=elements.get('discussionFileList').innerHTML;
  assert.match(html,/downloadContractVersion\(7,8,this\)/);assert.match(html,/downloadDiscussionAttachment\(8,this\)/);assert.match(html,/редакция 2/);
});
test('file list reveals more results locally and rejects late responses after switching tasks',async()=>{
  const{ctx,state,elements}=ui();state.fileCatalog=Array.from({length:70},(_,i)=>({id:i+1,name:'File '+i+'.txt',size:1,createdAt:'2026-10-28'}));
  ctx.renderDiscussionFiles(state);assert.equal((elements.get('discussionFileList').innerHTML.match(/downloadDiscussionAttachment\(/g)||[]).length,50);
  ctx.showMoreDiscussionFiles();assert.equal((elements.get('discussionFileList').innerHTML.match(/downloadDiscussionAttachment\(/g)||[]).length,70);
  let finish;ctx.apiFetch=()=>new Promise(resolve=>{finish=resolve;});const pending=ctx.loadDiscussionFiles(state);
  ctx.contractApprovalUI={kind:'room',engagementId:9};finish({files:[{id:999,name:'Wrong task.txt'}]});await pending;
  assert.equal(state.fileCatalog.length,70);assert.ok(!elements.get('discussionFileList').innerHTML.includes('Wrong task'));
});
test('access revocation clears cached filenames and file errors do not replace the composer',async()=>{
  const{ctx,state,elements}=ui();state.fileCatalog=[{id:1,name:'Private.txt'}];
  ctx.apiFetch=async()=>{const err=Error('Forbidden');err.status=403;throw err;};await ctx.loadDiscussionFiles(state);
  assert.equal(state.fileCatalog.length,0);assert.equal(state.fileCatalogLoaded,false);
  assert.ok(!elements.get('discussionFileList').innerHTML.includes('Private.txt'));assert.match(elements.get('discussionFilesStatus').textContent,/Forbidden/);
});
