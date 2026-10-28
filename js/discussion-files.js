function discussionFilesPanel() {
  return `<section class="discussion-property discussion-files-section" aria-label="Файлы задачи"><h3><i class="far fa-file-lines" aria-hidden="true"></i> Файлы <span id="discussionFileCount"></span></h3>
    <input id="discussionFileSearch" class="discussion-file-search" type="search" aria-label="Найти файл в задаче" placeholder="Найти файл…" oninput="filterDiscussionFiles(this.value)" hidden />
    <div id="discussionFileList"><p class="discussion-property-empty">Загрузка файлов…</p></div><p id="discussionFilesStatus" class="discussion-files-status" role="status"></p></section>`;
}
async function loadDiscussionFiles(state) {
  if(!contractConversationOpen(state)||state.filesLoading)return;
  state.filesLoading=true;
  try {
    const base=state.kind==='room'?`/api/discussions/${state.engagementId}`:`/api/engagements/${state.engagementId}/approvals/chat`;
    const result=await apiFetch(base+'/files');
    if(!contractConversationOpen(state))return;
    state.fileCatalog=result.files;state.fileCatalogLoaded=true;state.filesError='';
  }catch(err){
    if(!contractConversationOpen(state))return;
    state.filesError='Не удалось обновить файлы: '+err.message;
    state.fileCatalogLoaded=false;
    if([401,403,404].includes(err.status))state.fileCatalog=[];
  }finally{
    state.filesLoading=false;
    if(contractConversationOpen(state))renderDiscussionFiles(state);
  }
}
function taskFileItems(state) {
  const files=(state.fileCatalog||[]).map(f=>({...f,kind:'attachment'}));
  if(state.kind!=='room')for(const doc of state.chat.documents||[])files.push({id:doc.id,kind:'version',name:doc.filename,createdAt:doc.createdAt,author:doc.author,version:doc.version});
  return files.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'') || b.id-a.id || a.kind.localeCompare(b.kind));
}
function taskFileIcon(name) {
  const ext=String(name).split('.').at(-1).toLowerCase();
  return ({pdf:'fa-file-pdf',docx:'fa-file-word',xlsx:'fa-file-excel',csv:'fa-file-csv',png:'fa-file-image',jpg:'fa-file-image',jpeg:'fa-file-image'})[ext]||'fa-file-lines';
}
function taskFileSize(size) {
  if(!Number.isFinite(size))return '';
  return size>=1024*1024 ? (size/(1024*1024)).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ' : Math.max(1,Math.ceil(size/1024))+' КБ';
}
function filterDiscussionFiles(query) {
  const state=contractApprovalUI;if(!contractConversationOpen(state))return;
  state.fileQuery=query;state.fileDisplayLimit=50;renderDiscussionFiles(state);
}
function showMoreDiscussionFiles() {
  const state=contractApprovalUI;if(!contractConversationOpen(state))return;
  state.fileDisplayLimit=(state.fileDisplayLimit||50)+50;renderDiscussionFiles(state);
}
function renderDiscussionFiles(state) {
  const list=document.getElementById('discussionFileList');if(!list||!contractConversationOpen(state))return;
  const files=taskFileItems(state),query=(state.fileQuery||'').normalize('NFKC').toLocaleLowerCase().trim();
  const filtered=files.filter(f=>f.name.normalize('NFKC').toLocaleLowerCase().includes(query)),limit=state.fileDisplayLimit||50;
  document.getElementById('discussionFileCount').textContent=files.length?String(files.length):'';
  const search=document.getElementById('discussionFileSearch');search.hidden=!files.length&&!query;
  const status=document.getElementById('discussionFilesStatus');status.textContent=state.filesError||'';
  const signature=JSON.stringify([files,query,limit,state.fileCatalogLoaded,state.filesError]);
  if(signature===state.fileListSignature)return;
  state.fileListSignature=signature;
  list.innerHTML=filtered.length?filtered.slice(0,limit).map(file=>{
    const date=file.createdAt?new Date(file.createdAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Qyzylorda'}):'';
    const detail=[file.kind==='version'?'Договор · редакция '+file.version:taskFileSize(file.size),date].filter(Boolean).join(' · ');
    return `<button type="button" class="discussion-catalog-file" onclick="${file.kind==='version'?`downloadContractVersion(${state.engagementId},${file.id},this)`:`downloadDiscussionAttachment(${file.id},this)`}" aria-label="Скачать ${escapeHtml(file.name)}" title="${escapeHtml(file.name)}${file.author?' · '+escapeHtml(file.author):''}"><i class="fas ${taskFileIcon(file.name)}" aria-hidden="true"></i><span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(detail)}</small></span><i class="fas fa-download" aria-hidden="true"></i></button>`;
  }).join('')+(filtered.length>limit?`<button type="button" class="discussion-text-action discussion-files-more" onclick="showMoreDiscussionFiles()">Показать ещё (${filtered.length-limit})</button>`:''):
    `<p class="discussion-property-empty">${query?'Файлы не найдены':state.fileCatalogLoaded?'Вложений пока нет':state.filesError?'Список файлов недоступен':'Загрузка файлов…'}</p>`;
}
