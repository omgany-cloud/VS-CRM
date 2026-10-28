// One conversation and composer inside the contract card. Polling only updates
// the feed/status areas; it never replaces the user's message textarea.
function contractDiscussionPanel(kind = 'contract') {
  return `<section class="contract-chat" aria-label="Переписка">
    <div class="contract-version-top discussion-connection"><span id="contractChatConnection" class="contract-version-meta">Подключение…</span></div>
    <button id="contractChatOlder" class="contract-secondary" type="button" hidden onclick="loadOlderContractMessages()">Показать ранние сообщения</button>
    <div id="contractChatFeed" class="contract-chat-feed" role="log" aria-label="Сообщения и решения" aria-live="polite" aria-relevant="additions" tabindex="0" onscroll="markDiscussionRead()"></div>
    <div id="discussionAttachments" class="discussion-attachments"></div>
    <div id="discussionReplyPreview" class="discussion-reply-preview" hidden></div>
    <div class="discussion-compose-area">
    <div id="discussionMentionList" class="discussion-mention-list" role="listbox" aria-label="Сотрудники" hidden></div>
    <div class="discussion-composer">
      <input id="discussionFileInput" type="file" multiple accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.txt,.csv" hidden onchange="chooseDiscussionFiles(this)" />
      <button id="discussionAttach" type="button" class="discussion-icon-button contract-secondary" aria-label="Прикрепить файл" title="Прикрепить файл" onclick="document.getElementById('discussionFileInput').click()"><i class="fas fa-paperclip" aria-hidden="true"></i></button>
      <div class="discussion-text-input"><div id="discussionMentionMirror" class="discussion-text-mirror" aria-hidden="true"></div>
      <textarea id="contractChatText" rows="2" maxlength="4000" aria-label="Сообщение всем участникам" aria-autocomplete="list" aria-controls="discussionMentionList" aria-expanded="false" placeholder="Сообщение… Начните печатать имя, чтобы добавить коллегу" oninput="discussionInputChanged(this)" onclick="discussionInputChanged(this)" onkeydown="discussionComposerKey(event,this)" onkeyup="if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))discussionInputChanged(this)" onblur="hideDiscussionMentions()" onscroll="syncDiscussionMentionMirror()"></textarea></div>
      <button id="contractChatSend" type="button" class="discussion-icon-button contract-primary" aria-label="Отправить сообщение" title="Отправить · Enter" onclick="sendContractDiscussion()"><i class="fas fa-paper-plane" aria-hidden="true"></i></button>
    </div>
    </div>
    <p id="discussionMentionHint" class="contract-empty" hidden></p>
    <span id="contractChatAccess" class="contract-empty"></span>
    <div id="contractChatDecisions" class="contract-chat-decisions"></div>
    <p id="contractChatStatus" class="contract-message" role="status" aria-live="polite"></p>
  </section>`;
}
function contractDiscussionStatus(message, error = false) {
  const el = document.getElementById('contractChatStatus');
  if (el) { el.textContent = message; el.className = error ? 'contract-message-error' : 'contract-message'; }
}
function contractConversationOpen(state) {
  return !!state && !state.closed && contractApprovalUI === state &&
    document.getElementById('contractApprovalPanel') === state.panel &&
    (state.panel.dataset.surface === 'hub' ? document.getElementById('page-discussions')?.classList.contains('active') :
      document.getElementById('modal-engagement')?.style.display !== 'none');
}
function stopContractConversation() {
  const state = contractApprovalUI;
  if (!state) return;
  if (typeof saveDiscussionDraft === 'function') saveDiscussionDraft(state);
  if (typeof hideDiscussionMentions === 'function') hideDiscussionMentions(state);
  state.mentionObserver?.disconnect();
  clearTimeout(state.timer); state.closed = true; ++state.request;
}
function scheduleContractConversation(state, delay = 3000) {
  clearTimeout(state.timer);
  if (!contractConversationOpen(state)) return;
  state.timer = setTimeout(() => {
    if (!contractConversationOpen(state)) return;
    if (document.visibilityState === 'hidden' || state.busy) return scheduleContractConversation(state);
    loadContractConversation(state.engagementId);
  }, delay);
}
function mergeContractMessages(chat, page, mode) {
  for (const message of page.messages) chat.messages.set(message.id, message);
  chat.after = Math.max(chat.after, page.nextAfter);
  if (mode !== 'after') chat.before = page.nextBefore;
  chat.documents = page.documents; chat.canPost = page.canPost; chat.context = page.context;
  chat.participants = page.participants || [];
  chat.related = page.related || [];
  chat.task = page.task;
  chat.loaded = true;
}
async function loadContractConversation(engagementId) {
  const panel = document.getElementById('contractApprovalPanel');
  if (!panel || Number(panel.dataset.engagementId) !== engagementId) return;
  if (!contractApprovalUI || contractApprovalUI.panel !== panel || contractApprovalUI.closed) {
    stopContractConversation();
    contractApprovalUI = { panel, engagementId, kind: panel.dataset.kind || 'contract', request: 0, busy: false, keys: {}, attachments: [],
      chat: { loaded: false, after: 0, before: null, messages: new Map(), documents: [], canPost: false } };
    if (typeof restoreDiscussionDraft === 'function') restoreDiscussionDraft(contractApprovalUI);
    initDiscussionMentions(contractApprovalUI);
  }
  const state = contractApprovalUI;
  if (state.busy || !contractConversationOpen(state)) return;
  if (state.loading) {
    await state.loading;
    if (!contractConversationOpen(state)) return;
    return loadContractConversation(engagementId);
  }
  clearTimeout(state.timer);
  const request = ++state.request;
  const mode = state.chat.loaded ? 'after' : 'initial';
  let nextDelay = 3000;
  const refresh = (async () => {
    try {
      let data, page;
      if (state.kind === 'room') {
        page = await apiFetch(`/api/discussions/${engagementId}${mode === 'after' ? '?after=' + state.chat.after : ''}`);
        data = { userId: page.userId, cycles: [], summary: {}, room: page.room };
      } else [data, page] = await Promise.all([
          apiFetch(`/api/engagements/${engagementId}/approvals`),
          apiFetch(`/api/engagements/${engagementId}/approvals/chat${mode === 'after' ? '?after=' + state.chat.after : ''}`),
        ]);
      if (!contractConversationOpen(state) || request !== state.request || state.busy) return;
      const changed = JSON.stringify(state.data) !== JSON.stringify(data) || JSON.stringify(state.chat.task) !== JSON.stringify(page.task) || JSON.stringify(state.chat.participants) !== JSON.stringify(page.participants || []) || JSON.stringify(state.chat.related) !== JSON.stringify(page.related || []);
      state.data = data; mergeContractMessages(state.chat, page, mode);
      if (changed) {
        if (state.kind !== 'room') renderContractApproval();
        if (typeof renderDiscussionContext === 'function') renderDiscussionContext(state);
        contractApprovalMessage(data.summary.frozen ? 'Редакция зафиксирована на время согласования. Переписка доступна в задаче.' :
          'Переписка и согласование не заменяют подписание договора и проверки клиента.');
      }
      renderContractDiscussion(state);
      if (typeof refreshDiscussionNextStep === 'function') refreshDiscussionNextStep(state);
      if(typeof loadDiscussionFiles==='function') {
        if(!state.fileCatalogLoaded || page.messages.some(m=>m.attachments?.length)) await loadDiscussionFiles(state);
        else renderDiscussionFiles(state);
      }
      if(!contractConversationOpen(state)||request!==state.request)return;
      document.getElementById('contractChatConnection').textContent = 'Обновляется автоматически';
      if (mode === 'after' && page.hasMore) nextDelay = 50;
    } catch (err) {
      nextDelay = 10000;
      if (contractConversationOpen(state) && request === state.request) {
        if ([403,404].includes(err.status)) {
          document.getElementById('contractChatFeed').innerHTML = '';
          state.chat.canPost = false;
          document.getElementById('contractChatText').disabled = true;
          document.getElementById('contractChatSend').disabled = true;
          const attach = document.getElementById('discussionAttach'); if (attach) attach.disabled = true;
          document.getElementById('contractChatDecisions').innerHTML = '';
          const context = document.getElementById('discussionContext'); if (context) context.textContent = 'Задача недоступна';
          const properties=document.getElementById('discussionProperties');if(properties)properties.innerHTML='';
          const actions=document.getElementById('discussionTaskActions');if(actions)actions.innerHTML='';
          state.replyTo=null;renderDiscussionReply(state);
          stopContractConversation();
          contractDiscussionStatus(err.message, true); return;
        }
        document.getElementById('contractChatConnection').textContent = 'Не удалось обновить. Повторяем подключение…';
        if (!state.data) contractApprovalMessage('Не удалось загрузить: ' + err.message, true);
        if (typeof getAuth === 'function' && !getAuth()) stopContractConversation();
      }
    }
  })();
  state.loading = refresh;
  try { await refresh; }
  finally {
    if (state.loading === refresh) state.loading = null;
    scheduleContractConversation(state, nextDelay);
  }
}
function contractDiscussionEntries(data, chat) {
  const entries = [...chat.messages.values()].map(m => ({ key: 'message-' + m.id, at: m.createdAt, authorId: m.authorId,
    author: m.author, text: m.text, mentions: m.mentions || [], attachments: m.attachments || [], replyTo: m.replyTo, version: m.version, label: '', kind: 'message' }));
  for (const file of chat.documents) entries.push({ key: 'file-' + file.id, at: file.createdAt, author: file.author,
    label: 'Сохранена редакция ' + file.version, text: file.note, version: file.version, fileId: file.id, filename: file.filename, kind: 'event' });
  for (const cycle of data.cycles) {
    entries.push({ key: 'submitted-' + cycle.id, at: cycle.createdAt, author: cycle.initiator,
      label: 'Отправлено на согласование · цикл ' + cycle.number, text: cycle.note,
      version: cycle.version, kind: 'event' });
    for (const step of cycle.steps) if (step.decidedAt) entries.push({ key: 'decision-' + step.id, at: step.decidedAt,
      author: step.name, label: ({ approved: 'Согласовано', returned: 'Возвращено на доработку', rejected: 'Отклонено' })[step.status] || contractApprovalLabel(step.status),
      text: step.comment, version: cycle.version, kind: 'decision' });
    if (cycle.closeReason) entries.push({ key: 'closed-' + cycle.id, at: cycle.invalidatedAt || cycle.resolvedAt,
      author: cycle.closeActor || '', label: cycle.invalidatedAt ? 'Редакция возвращена в доработку' : 'Согласование отозвано',
      text: cycle.closeReason, version: cycle.version, kind: 'event' });
  }
  const order = { file: 0, submitted: 1, message: 2, decision: 3, closed: 4 };
  return entries.sort((a, b) => String(a.at).localeCompare(String(b.at)) ||
    order[a.key.split('-')[0]] - order[b.key.split('-')[0]] || a.key.localeCompare(b.key, undefined, { numeric: true }));
}
function renderContractDiscussion(state, prepend = false) {
  if (!contractConversationOpen(state) || !state.data) return;
  const feed = document.getElementById('contractChatFeed');
  const entries = contractDiscussionEntries(state.data, state.chat);
  const signature = JSON.stringify([entries,state.chat.canPost,state.data.userId]);
  let followLatest = false;
  if (signature !== state.feedSignature) {
    const oldHeight = feed.scrollHeight, oldTop = feed.scrollTop;
    const follow = !state.feedSignature || state.scrollToLatest || oldHeight - oldTop - feed.clientHeight < 60;
    feed.innerHTML = entries.length ? renderDiscussionTimeline(entries,state): `<p class="contract-empty">${state.kind === 'room' ? 'Напишите сообщение по задаче или приложите файл.' : 'Здесь можно обсудить договор с участниками согласования.'}</p>`;
    feed.scrollTop = prepend ? oldTop + feed.scrollHeight - oldHeight : follow ? feed.scrollHeight : oldTop;
    state.feedSignature = signature; state.scrollToLatest = false;
    followLatest = !prepend && follow;
  }
  const older = document.getElementById('contractChatOlder');
  older.hidden = !state.chat.before; older.disabled = !!state.olderLoading || state.busy;
  document.getElementById('contractChatText').disabled = !state.chat.canPost || state.busy;
  document.getElementById('contractChatSend').disabled = !state.chat.canPost || state.busy;
  const attach = document.getElementById('discussionAttach'); if (attach) attach.disabled = !state.chat.canPost || state.busy;
  document.getElementById('contractChatAccess').textContent = state.chat.canPost ? 'Enter — отправить · Shift+Enter — новая строка' : 'Задача доступна для просмотра';
  renderDiscussionMentionHint(state);
  const cycle = state.data.cycles[0];
  document.getElementById('contractChatDecisions').innerHTML = (!state.chat.task || state.chat.task.status === 'open') && cycle && (cycle.canDecide || cycle.canWithdraw || cycle.canRework)
    ? `<p class="contract-empty">Чтобы зафиксировать решение, нажмите кнопку ниже. Для возврата, отклонения или отзыва напишите причину в поле сообщения.</p><div class="contract-versions-actions">
      ${cycle.canDecide ? `<button class="contract-primary" onclick="actContractApproval('approved')">Согласовать</button><button class="contract-secondary" onclick="actContractApproval('returned')">Вернуть с замечанием</button><button class="contract-secondary" onclick="actContractApproval('rejected')">Отклонить</button>` : ''}
      ${cycle.canWithdraw ? '<button class="contract-secondary" onclick="actContractApproval(\'withdraw\')">Отозвать согласование</button>' : cycle.canRework ? '<button class="contract-secondary" onclick="actContractApproval(\'rework\')">Вернуть в доработку</button>' : ''}
    </div>` : '';
  if (followLatest && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => {
    if (contractConversationOpen(state) && state.feedSignature === signature) { feed.scrollTop = feed.scrollHeight; if (typeof markDiscussionRead === 'function') markDiscussionRead(); }
  });
  if (typeof markDiscussionRead === 'function') markDiscussionRead();
}
function sendContractDiscussion() {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state) || !state.chat.canPost || state.busy) return;
  const raw = document.getElementById('contractChatText').value, text = raw.trim();
  const mentions = discussionMessageMentions(state, raw), personData = {...(mentions.length ? { mentions } : {}),...(state.replyTo ? {replyToId:state.replyTo.id} : {})};
  if ((!text && !state.attachments?.length) || text.length > 4000) return contractDiscussionStatus('Напишите сообщение или приложите файл.', true);
  hideDiscussionMentions(state);
  if (state.kind === 'room') return contractApprovalAction(`/api/discussions/${state.engagementId}/messages`, { text, ...personData });
  return contractApprovalAction(`/api/engagements/${state.engagementId}/approvals/chat`, {
    text, expectedVersion: state.chat.context.version, expectedCycleId: state.chat.context.cycleId, ...personData,
  });
}
async function loadOlderContractMessages() {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state) || !state.chat.before || state.olderLoading || state.busy) return;
  state.olderLoading = true;
  try {
    const page = await apiFetch(`${state.kind === 'room' ? '/api/discussions/' + state.engagementId : '/api/engagements/' + state.engagementId + '/approvals/chat'}?before=${state.chat.before}`);
    if (!contractConversationOpen(state)) return;
    // Older pages cannot roll back the live permissions/context or documents.
    for (const message of page.messages) state.chat.messages.set(message.id, message);
    state.chat.before = page.nextBefore;
    renderContractDiscussion(state, true);
  } catch (err) { if (contractConversationOpen(state)) contractDiscussionStatus('Не удалось загрузить историю: ' + err.message, true); }
  finally { state.olderLoading = false; if (contractConversationOpen(state)) document.getElementById('contractChatOlder').disabled = state.busy; }
}

function chooseDiscussionFiles(input) {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state) || !state.chat.canPost || state.busy) return;
  const files = [...(state.attachments || []), ...input.files]; input.value = '';
  if (files.length > 5 || files.some(f => !f.size || f.size > 10 * 1024 * 1024 || !/\.(pdf|docx|xlsx|png|jpe?g|txt|csv)$/i.test(f.name)) || files.reduce((s,f) => s+f.size,0) > 25 * 1024 * 1024) {
    return contractDiscussionStatus('До 5 файлов: PDF, DOCX, XLSX, PNG, JPG, TXT, CSV. Каждый до 10 МиБ, всего до 25 МиБ.', true);
  }
  state.attachments = files; state.attachmentKey = contractTemplateRequestKey();
  renderDiscussionAttachments(state); contractDiscussionStatus('');
}
function removeDiscussionAttachment(index) {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state) || state.busy) return;
  state.attachments = state.attachments.filter((_,i) => i !== index); state.attachmentKey = contractTemplateRequestKey(); renderDiscussionAttachments(state);
}
function renderDiscussionAttachments(state) {
  const el = document.getElementById('discussionAttachments'); if (!el) return;
  el.innerHTML = (state.attachments || []).map((f,i) => `<span><i class="fas fa-paperclip" aria-hidden="true"></i> ${escapeHtml(f.name)} <button type="button" class="discussion-remove" aria-label="Убрать вложение ${escapeHtml(f.name)}" onclick="removeDiscussionAttachment(${i})">×</button></span>`).join('');
}
async function downloadDiscussionAttachment(id, button) {
  const state = contractApprovalUI;
  if (!contractConversationOpen(state) || button.disabled) return;
  const file = (state.fileCatalog || []).find(f=>f.id===id) || [...state.chat.messages.values()].flatMap(m => m.attachments || []).find(f => f.id === id);
  if (!file) return;
  button.disabled = true;
  try {
    const base = state.kind === 'room' ? `/api/discussions/${state.engagementId}` : `/api/engagements/${state.engagementId}/approvals/chat`;
    const response = await contractDocumentFetch(`${base}/files/${id}`);
    const url = URL.createObjectURL(await response.blob()), a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { if (contractConversationOpen(state)) contractDiscussionStatus(err.message, true); }
  finally { button.disabled = false; }
}
