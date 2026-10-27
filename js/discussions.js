// One workspace for free topics and existing contract conversations.
let discussionItems = [], discussionSources = [], discussionCategories = [];
let discussionListRequest = 0, discussionViewRequest = 0, discussionCreateKey = null;
let discussionListTimer = null;
const discussionDrafts = new Map();
function discussionDraftKey(state) {
  const auth = getAuth();
  return `${auth?.tenant?.id || auth?.tenant?.slug}:${auth?.user?.id}:${state.kind || 'contract'}:${state.engagementId}`;
}
function saveDiscussionDraft(state) {
  if (document.getElementById('contractApprovalPanel') !== state.panel) return;
  const text = document.getElementById('contractChatText')?.value || '';
  if (text || state.attachments?.length) discussionDrafts.set(discussionDraftKey(state), { text, files: state.attachments || [], attachmentKey: state.attachmentKey, keys: state.keys, mentions: state.mentions || [] });
  else discussionDrafts.delete(discussionDraftKey(state));
}
function restoreDiscussionDraft(state) {
  const draft = discussionDrafts.get(discussionDraftKey(state)); if (!draft) return;
  document.getElementById('contractChatText').value = draft.text;
  state.attachments = draft.files; state.attachmentKey = draft.attachmentKey; state.keys = draft.keys;
  state.mentions = draft.mentions || []; state.mentionText = draft.text;
  renderDiscussionAttachments(state);
}
function forgetDiscussionDraft(state) { discussionDrafts.delete(discussionDraftKey(state)); }
function discussionsActive() { return document.getElementById('page-discussions')?.classList.contains('active'); }
async function renderDiscussionsPage() {
  await refreshDiscussionList();
  const state = contractApprovalUI;
  if (state?.closed && document.getElementById('contractApprovalPanel') === state.panel) await loadContractConversation(state.engagementId);
  if (document.getElementById('discussionWelcome')) showDiscussionProcesses();
}
async function refreshDiscussionList() {
  clearTimeout(discussionListTimer);
  const list = document.getElementById('discussionList'); if (!list) return;
  const request = ++discussionListRequest;
  try {
    const data = await apiFetch('/api/discussions');
    if (request !== discussionListRequest) return;
    discussionItems = data.items; if (!discussionCategories.length) discussionCategories = data.categories || [];
    document.getElementById('discussionNew').disabled = !data.canCreate;
    renderDiscussionList();
  } catch (err) { if (request === discussionListRequest) list.textContent = 'Не удалось загрузить задачи: ' + err.message; }
  finally {
    if (discussionsActive() && getAuth()) discussionListTimer = setTimeout(() => {
      if (discussionsActive()) refreshDiscussionList();
    }, 10000);
  }
}
function resetDiscussions() {
  stopContractConversation(); clearTimeout(discussionListTimer); ++discussionListRequest; ++discussionViewRequest;
  discussionDrafts.clear(); discussionItems = []; discussionSources = []; discussionCategories = []; discussionCreateKey = null; contractApprovalUI = null;
  const list = document.getElementById('discussionList'), main = document.getElementById('discussionMain');
  if (list) list.innerHTML = ''; if (main) main.innerHTML = '<div id="discussionWelcome"></div>';
}
function renderDiscussionList() {
  const q = document.getElementById('discussionSearch').value.trim().toLocaleLowerCase();
  const state = contractApprovalUI;
  const category = document.getElementById('discussionChatFilter')?.value || '';
  const items = discussionItems.filter(i => `${i.title} ${i.label} ${i.preview} ${(i.sources || []).map(s => s.label + ' ' + s.title).join(' ')}`.toLocaleLowerCase().includes(q)
    && (!category || (category === 'free' ? !i.sources?.length : i.sources?.some(s => s.kind === category))));
  document.getElementById('discussionList').innerHTML = items.length ? items.map(item => `<button type="button" class="discussion-list-item${state?.engagementId === item.id && (state.kind || 'contract') === item.kind ? ' selected' : ''}" onclick="openDiscussion('${item.kind}',${item.id})">
    <span class="discussion-avatar"><i class="fas ${item.kind === 'contract' ? 'fa-file-signature' : 'fa-comments'}" aria-hidden="true"></i></span>
    <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.sources?.length ? [...new Set(item.sources.map(s => s.label))].join(' · ') : 'Задача без процесса CRM')}</small><p>${escapeHtml(item.preview || '')}</p></span></button>`).join('') : '<p class="discussion-empty">Здесь пока нет задач.</p>';
  updateDiscussionChatFilter();
}
async function openDiscussion(kind, id) {
  if (!['contract', 'room'].includes(kind) || !Number.isSafeInteger(id) || id < 1) return;
  const request = ++discussionViewRequest;
  stopContractConversation();
  if (!discussionsActive()) navigateTo('discussions');
  const item = discussionItems.find(i => i.id === id && i.kind === kind);
  document.getElementById('discussionMain').innerHTML = `<header id="discussionContext" class="discussion-context"><h2>${escapeHtml(item?.title || 'Задача')}</h2></header>
    <div id="discussionTools" class="discussion-tools" hidden></div>${contractConversationPanel(id, kind)}`;
  await loadContractConversation(id);
  if (request !== discussionViewRequest) return;
  renderDiscussionList();
  const url = new URL(window.location.href); url.searchParams.delete('contract'); url.searchParams.delete('discussion'); url.searchParams.delete('workspace');
  url.searchParams.set(kind === 'contract' ? 'contract' : 'discussion', id); history.replaceState(null, '', url);
}
function renderDiscussionContext(state) {
  const header = document.getElementById('discussionContext'); if (!header || !contractConversationOpen(state)) return;
  if (state.kind === 'room') {
    const room = state.data.room;
    header.innerHTML = `<div class="discussion-context-top"><div><h2>${escapeHtml(room.title)}</h2><p>${room.members.map(m => escapeHtml(m.name) + (m.active ? '' : ' (неактивен)')).join(' · ')}</p></div>
      ${room.canManage ? `<div class="discussion-context-actions"><button type="button" class="contract-secondary" onclick="showDiscussionLinks()" title="Добавить подзадачу или связать с процессом"><i class="fas fa-link" aria-hidden="true"></i><span>Связать</span></button></div>` : ''}</div>
      ${room.links.length ? `<div class="discussion-context-label">В этой задаче</div><div class="discussion-links">${room.links.map(l => `<button type="button" class="contract-secondary" title="${escapeHtml(l.title)}" onclick="openDiscussionSource('${l.kind}',${l.id})"><span><i class="fas ${discussionSourceIcon(l.kind)}" aria-hidden="true"></i> ${escapeHtml(l.label)}</span><strong>${escapeHtml(l.title)}</strong><small>${escapeHtml(discussionStatus(l.status))}${l.fundName ? ' · ' + escapeHtml(l.fundName) : ''} · Открыть ↗</small></button>`).join('')}</div>` : '<p class="discussion-free-hint">Задача без процесса CRM. Через «Связать» можно добавить подзадачу или процесс CRM.</p>'}`;
  } else {
    const item = discussionItems.find(i => i.kind === 'contract' && i.id === state.engagementId);
    const cycle = state.data.cycles[0];
    const names = [...new Set([...(cycle?.steps.map(s => s.name) || []), ...(state.chat.participants || []).map(p => p.name)])];
    header.innerHTML = `<div class="discussion-context-top"><div><h2>${escapeHtml(item?.title || cycle?.metadata?.contractNum || 'Договор')}</h2><p>${escapeHtml(contractApprovalLabel(state.data.summary.status))}${names.length ? ' · ' + names.map(escapeHtml).join(' · ') : ''}</p></div>
      <button type="button" class="contract-secondary" onclick="openContractRecord(${state.engagementId})"><i class="fas fa-file-alt" aria-hidden="true"></i> Карточка договора ↗</button></div>
      ${(state.chat.related || []).length ? `<div class="discussion-links">${state.chat.related.map(l => `<button type="button" class="contract-secondary" onclick="openDiscussionSource('${l.kind}',${l.id})"><span><i class="fas fa-comments" aria-hidden="true"></i> ${escapeHtml(l.label)}</span><strong>${escapeHtml(l.title)}</strong><small>Открыть ↗</small></button>`).join('')}</div>` : ''}`;
    // The first submission remains visible; later cycles stay compact until asked for.
    if (!state.data.cycles.length) state.panel.querySelector('.discussion-approval-details').open = true;
  }
}
function discussionStatus(value) {
  return ({ Draft: 'Черновик', Pending: 'Ожидает решения', pending: 'Ожидает решения', active: 'В работе', approved: 'Согласован', rejected: 'Отклонён', Published: 'Опубликован', Escalated: 'На рассмотрении CEO', Active: 'Активен' })[value] || value;
}
function newDiscussion(source = null) {
  ++discussionViewRequest; stopContractConversation();
  document.getElementById('discussionMain').innerHTML = `<form class="discussion-new-form contract-versions" onsubmit="event.preventDefault();createDiscussion(this)">
      <h2>Новая задача</h2>
      ${source ? `<p class="discussion-seed"><i class="fas ${discussionSourceIcon(source.kind)}" aria-hidden="true"></i> ${escapeHtml(source.label)} · ${escapeHtml(source.title)}</p>` : ''}
      <label for="discussionTitle">Название задачи</label><input id="discussionTitle" maxlength="160" required placeholder="Например: согласовать условия работы с клиентом" value="${source ? escapeHtml(('Задача: ' + source.title).slice(0,160)) : ''}" />
      <p class="contract-empty">Коллег можно добавить прямо в сообщении — начните печатать имя и выберите подсказку.</p>
      <button type="submit" class="contract-primary">Создать задачу</button><p id="discussionFormStatus" role="status"></p></form>`;
  document.querySelector('.discussion-new-form').discussionSource = source ? { kind: source.kind, id: source.id } : null;
  document.getElementById('discussionTitle').focus();
}
async function createDiscussion(form) {
  const title = form.querySelector('#discussionTitle').value.trim();
  const source = form.discussionSource;
  const fingerprint = JSON.stringify({ title, source });
  if (discussionCreateKey?.fingerprint !== fingerprint) discussionCreateKey = { fingerprint, key: contractTemplateRequestKey() };
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const result = await apiFetch('/api/discussions', { method: 'POST', body: JSON.stringify({ title, ...(source ? { source } : {}), requestKey: discussionCreateKey.key }) });
    discussionCreateKey = null; await refreshDiscussionList();
    if (document.getElementById('discussionMain').contains(form)) await openDiscussion('room', result.id);
  } catch (err) { form.querySelector('#discussionFormStatus').textContent = err.message; }
  finally { button.disabled = false; }
}
async function showDiscussionLinks() {
  const state = contractApprovalUI; if (state?.kind !== 'room' || !state.data.room.canManage) return;
  try {
    const data = await apiFetch('/api/discussions/sources'); if (!contractConversationOpen(state)) return;
    discussionSources = data.items; discussionCategories = data.categories || []; updateDiscussionChatFilter();
    const tools = document.getElementById('discussionTools'); tools.hidden = false;
    tools.innerHTML = `<div class="discussion-source-picker"><strong>Добавить подзадачу или связать с процессом</strong>
      <div class="discussion-link-filters" role="group" aria-label="Тип связи"><button type="button" class="contract-secondary selected" data-kind="processes" onclick="switchDiscussionLinkFilter(this)">Процессы CRM</button><button type="button" class="contract-secondary" data-kind="chats" onclick="switchDiscussionLinkFilter(this)">Подзадачи</button></div>
      <input id="discussionSourceSearch" type="search" aria-label="Найти подзадачу или процесс" placeholder="Найти по названию…" oninput="filterDiscussionSources(this.value)" /><div id="discussionSourceList"></div><p class="contract-empty">У каждой подзадачи свои участники и переписка.</p><button type="button" class="contract-secondary" onclick="closeDiscussionTools()">Закрыть</button><p id="discussionLinkStatus" role="status"></p></div>`;
    state.linkFilter = 'processes'; state.linkCategory = '';
    filterDiscussionSources('');
  } catch (err) { contractDiscussionStatus(err.message, true); }
}
function filterDiscussionSources(query) {
  if (contractApprovalUI.linkFilter === 'processes') return renderDiscussionProcessPicker('link', query, contractApprovalUI.linkCategory);
  const q = query.trim().toLocaleLowerCase(), room = contractApprovalUI.data.room;
  document.getElementById('discussionSourceList').innerHTML = discussionSources.map((source, index) => ({ source, index })).filter(({source:s}) =>
    (['discussion','contract-chat'].includes(s.kind) === (contractApprovalUI.linkFilter === 'chats')) && !(s.kind === 'discussion' && s.id === room.id) &&
    `${s.label} ${s.title}`.toLocaleLowerCase().includes(q) && !room.links.some(l => l.kind === s.kind && l.id === s.id)).map(({source:s,index}) =>
      `<button type="button" class="contract-secondary" onclick="linkDiscussionSource(${index},this)"><span>${escapeHtml(s.label)} · ${escapeHtml(s.title)}</span><small>${escapeHtml(discussionStatus(s.status))}</small></button>`).join('') || '<p class="contract-empty">Нет доступных связей</p>';
}
function switchDiscussionLinkFilter(button) {
  contractApprovalUI.linkFilter = button.dataset.kind;
  contractApprovalUI.linkCategory = '';
  button.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('selected', b === button));
  filterDiscussionSources(document.getElementById('discussionSourceSearch').value);
}
async function linkDiscussionSource(index, button) {
  const state = contractApprovalUI, source = discussionSources[index]; if (!source || state?.kind !== 'room') return;
  button.disabled = true;
  try {
    await apiFetch(`/api/discussions/${state.engagementId}/links`, { method: 'POST', body: JSON.stringify({ kind: source.kind, id: source.id }) });
    if (contractConversationOpen(state)) { closeDiscussionTools(); await loadContractConversation(state.engagementId); }
  } catch (err) { if (contractConversationOpen(state)) document.getElementById('discussionLinkStatus').textContent = err.message; }
  finally { button.disabled = false; }
}
function closeDiscussionTools() { const el = document.getElementById('discussionTools'); if (el) { el.hidden = true; el.innerHTML = ''; } }
async function openDiscussionSource(kind, id) {
  // Re-load authoritative domain data before opening an existing domain action.
  try {
    if (kind === 'discussion') return openDiscussion('room', id);
    if (kind === 'contract-chat') return openDiscussion('contract', id);
    const { source: linked } = await apiFetch(`/api/discussions/source/${kind}/${id}`);
    if (linked.fundId && typeof switchFund === 'function' && linked.fundId !== activeFundId) { await loadFundsFromApi(); switchFund(linked.fundId); }
    if (kind === 'contract') return openContractRecord(id);
    if (kind === 'client' || kind === 'conflict') {
      await loadOnboardingFromApi();
      if (kind === 'client') return openObClientModal(id);
      await loadConflictApprovalsFromApi(); return openConflictApprovalDetail(id);
    }
    if (kind === 'workflow') { await loadWorkflowFromApi(); return openWfModal(id); }
    if (kind === 'deal') { await loadDealsFromApi(); return openDealDetailModal(id); }
    if (kind === 'lp') { await Promise.all([loadLpRegisterFromApi(), loadCapitalCallsFromApi()]); return openLPDetail(id); }
    if (kind === 'portfolio') { await loadPortfolioFromApi(); return openPortfolioModal(id); }
    if (kind === 'spv') { await loadSpvsFromApi(); return openSpvDetailModal(id); }
    if (kind === 'ic') { await loadIcMemosFromApi(); return openICModal(id); }
    if (kind === 'capital-call') { await loadCapitalCallsFromApi(); return openCCDetail(id); }
    if (kind === 'sandbox') return openSandboxProject(id);
    if (kind === 'distribution') { await loadDistributionsFromApi(); return openDistDetail(id); }
    if (kind === 'nav') await loadHfNavFromApi();
    if (kind === 'report') await loadAfsaReportsFromApi();
    if (['restricted','coi'].includes(kind)) await loadOnboardingFromApi();
    if (['subscription','redemption'].includes(kind)) await Promise.all([loadLpRegisterFromApi(),loadHfSubscriptionsFromApi(),loadHfRedemptionsFromApi()]);
    if (kind === 'closing') await loadFirstClosingFromApi();
    if (kind === 'fund') await loadFundsFromApi();
    const pages = { nav:'hf-nav', report:'calendar', restricted:'ob-restricted', coi:'ob-restricted', subscription:'hf-subscriptions', redemption:'hf-subscriptions', closing:'closing', fund:'fund-compare' };
    if (pages[kind]) {
      const origin = contractApprovalUI ? { kind: contractApprovalUI.kind || 'contract', id: contractApprovalUI.engagementId } : null;
      navigateTo(pages[kind]); if (kind === 'closing') renderClosing();
      document.querySelectorAll('.discussion-process-return').forEach(el => el.remove());
      const banner = document.createElement('div'); banner.className = 'discussion-process-return';
      banner.innerHTML = `<span>Из задачи: <strong>${escapeHtml(linked.label)} · ${escapeHtml(linked.title)}</strong></span>${origin ? `<button type="button" class="contract-secondary" onclick="openDiscussion('${origin.kind}',${origin.id})">← Вернуться к задаче</button>` : ''}`;
      document.getElementById('page-' + pages[kind]).prepend(banner);
    }
  } catch (err) { showToast('Не удалось открыть процесс: ' + err.message, 'red'); }
}
