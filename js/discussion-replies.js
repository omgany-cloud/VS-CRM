function discussionQuoteText(message) {
  return message.text || (message.files || message.attachments?.map(f=>f.name) || []).join(', ') || 'Вложение';
}
function replyToDiscussionMessage(id) {
  const state=contractApprovalUI,message=state?.chat.messages.get(id);
  if(!contractConversationOpen(state)||!state.chat.canPost||state.busy||!message)return;
  state.replyTo={id:message.id,author:message.author,text:message.text.slice(0,280),files:(message.attachments||[]).map(f=>f.name)};
  renderDiscussionReply(state);document.getElementById('contractChatText').focus();
}
function cancelDiscussionReply() {
  const state=contractApprovalUI;if(!state||state.busy)return;
  state.replyTo=null;renderDiscussionReply(state);
}
function renderDiscussionReply(state) {
  const el=document.getElementById('discussionReplyPreview');if(!el)return;
  const reply=state.replyTo;el.hidden=!reply;
  el.innerHTML=reply?`<span><small>В ответ ${escapeHtml(reply.author)}</small><span>${escapeHtml(discussionQuoteText(reply))}</span></span><button type="button" class="discussion-reply-cancel" onclick="cancelDiscussionReply()" aria-label="Отменить ответ" title="Отменить ответ">×</button>`:'';
}
async function jumpToDiscussionMessage(id) {
  const state=contractApprovalUI;if(!contractConversationOpen(state)||state.jumpingReply||state.busy)return;
  state.jumpingReply=true;
  try {
    // Load contiguous history, rather than inserting an isolated old message
    // that would hide the gap between it and the currently displayed page.
    while(!state.chat.messages.has(id)&&state.chat.before&&contractConversationOpen(state)){
      const before=state.chat.before;await loadOlderContractMessages();
      if(state.chat.before===before)break;
    }
    if(!contractConversationOpen(state))return;
    const el=document.getElementById('discussion-message-'+id);
    if(el){el.scrollIntoView({block:'center',behavior:'smooth'});el.focus({preventScroll:true});}
    else contractDiscussionStatus('Исходное сообщение пока не загружено. Повторите переход.',true);
  }finally{state.jumpingReply=false;}
}
function discussionDay(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function discussionDayLabel(value) {
  const date=new Date(value);if(Number.isNaN(date.getTime()))return '';
  if(discussionDay(value)===discussionDay(new Date()))return 'Сегодня';
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Qyzylorda',day:'numeric',month:'long',year:'numeric'}).format(date);
}
function renderDiscussionTimeline(entries,state) {
  let previousDay='';
  return entries.map(entry=>{
    const day=discussionDay(entry.at),divider=day&&day!==previousDay?`<div class="discussion-day"><span>${escapeHtml(discussionDayLabel(entry.at))}</span></div>`:'';previousDay=day;
    const isMessage=entry.kind==='message',id=isMessage?Number(entry.key.slice(8)):null;
    const date=new Date(entry.at),time=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Qyzylorda',hour:'2-digit',minute:'2-digit'}).format(date);
    const author=escapeHtml(entry.author||'Договор');
    return divider+`<article ${isMessage?`id="discussion-message-${id}" tabindex="-1"`:''} class="contract-chat-entry${isMessage?'':' contract-chat-event'}">
      ${isMessage?discussionAvatar(entry.author,entry.authorId):'<span class="discussion-event-icon"><i class="far fa-file-lines" aria-hidden="true"></i></span>'}<div class="discussion-message-content">
      <div class="contract-chat-meta">${isMessage&&state.chat.canPost&&entry.authorId!==state.data.userId?`<button type="button" class="discussion-author" onclick="mentionDiscussionPerson(${entry.authorId})" title="Упомянуть ${author}">${author}</button>`:`<strong>${author}</strong>`}<time title="${escapeHtml(contractVersionDate(entry.at))}">${time}</time>${state.kind==='room'?'':`<span>${entry.version?'Редакция '+entry.version:'Черновик'}</span>`}
      ${isMessage&&state.chat.canPost?`<button type="button" class="discussion-reply-button" onclick="replyToDiscussionMessage(${id})" title="Ответить" aria-label="Ответить на сообщение ${author}"><i class="fas fa-reply" aria-hidden="true"></i></button>`:''}</div>
      ${entry.replyTo?`<button type="button" class="discussion-message-quote" onclick="jumpToDiscussionMessage(${entry.replyTo.id})" title="Перейти к исходному сообщению"><strong>${escapeHtml(entry.replyTo.author)}</strong><span>${escapeHtml(discussionQuoteText(entry.replyTo))}</span></button>`:''}
      ${entry.label?`<strong class="contract-chat-event-title">${escapeHtml(entry.label)}</strong>`:''}
      ${entry.text?`<p>${renderMentionedText(entry.text,entry.mentions)}</p>`:''}
      ${entry.fileId?`<button type="button" class="contract-secondary" onclick="downloadContractVersion(${state.engagementId},${entry.fileId},this)">${escapeHtml(entry.filename)} ↓</button>`:''}
      ${(entry.attachments||[]).map(file=>`<button type="button" class="contract-secondary discussion-file" onclick="downloadDiscussionAttachment(${file.id},this)"><i class="fas fa-paperclip" aria-hidden="true"></i> ${escapeHtml(file.name)} <small>${Math.ceil(file.size/1024)} КБ</small><i class="fas fa-download" aria-hidden="true"></i></button>`).join('')}
      </div></article>`;
  }).join('');
}
