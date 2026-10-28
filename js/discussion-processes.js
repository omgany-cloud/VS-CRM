// The same process catalogue serves a new conversation and links in an existing one.
let discussionProcessCategory = '';
let discussionSelectedSource = null;
function discussionRecordCount(n) {
  const rest = n % 100, last = n % 10;
  return `${n} ${rest >= 11 && rest <= 14 ? 'записей' : last === 1 ? 'запись' : last >= 2 && last <= 4 ? 'записи' : 'записей'}`;
}
function discussionSourceIcon(kind) {
  return discussionCategories.find(c => c.kind === kind)?.icon || (['discussion','contract-chat'].includes(kind) ? 'fa-comments' : 'fa-link');
}
function updateDiscussionChatFilter() {
  const select = document.getElementById('discussionChatFilter'); if (!select) return;
  const current = select.value;
  const kinds = new Map(discussionCategories.map(c => [c.kind, c.title]));
  for (const item of discussionItems) for (const source of item.sources || []) if (!kinds.has(source.kind)) kinds.set(source.kind, source.label);
  select.innerHTML = '<option value="">Все мои задачи</option><option value="free">Без процесса CRM</option>' + [...kinds].map(([kind,title]) => `<option value="${kind}">${escapeHtml(title)}</option>`).join('');
  select.value = [...select.options].some(o => o.value === current) ? current : '';
}
function discussionCategoryCards(mode) {
  return [...new Set(discussionCategories.map(c => c.group))].map(group => `<section class="discussion-category-group"><h3>${escapeHtml(group)}</h3><div class="discussion-category-grid">${discussionCategories.filter(c => c.group === group).map(c => `<button type="button" class="discussion-category" onclick="selectDiscussionProcessCategory('${mode}','${c.kind}')"><i class="fas ${c.icon}" aria-hidden="true"></i><span><strong>${escapeHtml(c.title)}</strong><small>${c.count ? discussionRecordCount(c.count) : 'Пока нет записей'}</small></span><i class="fas fa-chevron-right" aria-hidden="true"></i></button>`).join('')}</div></section>`).join('');
}
function renderDiscussionProcessPicker(mode, query = '', kind = '') {
  const list = document.getElementById('discussionSourceList'); if (!list) return;
  const q = query.trim().toLocaleLowerCase();
  if (!q && !kind) { list.innerHTML = discussionCategoryCards(mode); list.classList.add('catalogue'); return; }
  list.classList.remove('catalogue');
  const category = discussionCategories.find(c => c.kind === kind);
  const linked = mode === 'link' ? contractApprovalUI?.data?.room?.links || [] : [];
  const rows = discussionSources.map((source,index) => ({ source,index })).filter(({source:s}) =>
    !['discussion','contract-chat'].includes(s.kind) && (!kind || s.kind === kind) &&
    `${s.label} ${s.title} ${s.fundName || ''}`.toLocaleLowerCase().includes(q) && !linked.some(l => l.kind === s.kind && l.id === s.id));
  // A new contract or client is a new process, so it can be started right here.
  const start = mode === 'start' && { contract: ['newContractFromTasks', 'Новый договор'], client: ['newClientFromTasks', 'Новый клиент'] }[kind] || null;
  list.innerHTML = `${category ? `<div class="discussion-category-heading"><button type="button" class="contract-secondary" onclick="selectDiscussionProcessCategory('${mode}','')">← Все разделы</button><strong>${escapeHtml(category.title)}</strong>${start && !currentUserPermission('readOnly') ? `<button type="button" class="contract-primary" onclick="${start[0]}(this)"><i class="fas fa-plus" aria-hidden="true"></i> ${start[1]}</button>` : ''}<button type="button" class="contract-secondary" onclick="openDiscussionProcessSection('${category.kind}')">Открыть раздел ↗</button></div>` : ''}` +
    (rows.length ? rows.map(({source:s,index}) => `<button type="button" class="contract-secondary discussion-process-row" onclick="${mode === 'link' ? 'linkDiscussionSource' : 'chooseDiscussionProcess'}(${index},this)"><i class="fas ${discussionSourceIcon(s.kind)}" aria-hidden="true"></i><span><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.label)}${s.fundName ? ' · ' + escapeHtml(s.fundName) : ''}</small></span><small>${escapeHtml(discussionStatus(s.status))}</small></button>`).join('') : `<div class="discussion-catalogue-empty"><i class="fas ${category?.icon || 'fa-search'}" aria-hidden="true"></i><p>${q ? 'По вашему запросу ничего не найдено.' : category?.count ? 'Все доступные записи этого раздела уже связаны с задачей.' : 'В этом разделе пока нет доступных записей.'}</p></div>`);
}
function selectDiscussionProcessCategory(mode, kind) {
  const input = document.getElementById('discussionSourceSearch'); if (input) input.value = '';
  if (mode === 'link') contractApprovalUI.linkCategory = kind; else discussionProcessCategory = kind;
  renderDiscussionProcessPicker(mode, '', kind);
}
async function showDiscussionProcesses(kind = '') {
  stopContractConversation();
  const request = ++discussionViewRequest;
  // Install the loading view before navigating so page rendering cannot reopen a previous chat.
  const main = document.getElementById('discussionMain');
  main.innerHTML = '<div class="discussion-catalogue"><p class="discussion-empty">Загрузка процессов…</p></div>';
  if (!discussionsActive()) navigateTo('discussions');
  try {
    const data = await apiFetch('/api/discussions/sources');
    if (request !== discussionViewRequest || !discussionsActive()) return;
    discussionSources = data.items; discussionCategories = data.categories || []; discussionProcessCategory = kind; updateDiscussionChatFilter();
    main.innerHTML = `<div class="discussion-catalogue"><div class="discussion-catalogue-heading"><i class="fas fa-comments" aria-hidden="true"></i><div><h2>По какому процессу задача?</h2><p>Выберите процесс — откройте его задачи или создайте новую.</p></div></div><input id="discussionSourceSearch" type="search" aria-label="Найти процесс CRM" placeholder="Название, номер или фонд…" oninput="renderDiscussionProcessPicker('start',this.value,discussionProcessCategory)" /><div id="discussionSourceList"></div></div>`;
    renderDiscussionProcessPicker('start', '', kind);
    const url = new URL(window.location.href); url.searchParams.delete('discussion'); url.searchParams.delete('contract'); url.searchParams.set('workspace','discussions'); history.replaceState(null, '', url);
  } catch (err) { if (request === discussionViewRequest) { main.innerHTML = '<p class="discussion-empty" role="alert"></p>'; main.firstChild.textContent = 'Не удалось загрузить процессы: ' + err.message; } }
}
async function chooseDiscussionProcess(index, button) {
  const source = discussionSources[index]; if (!source) return;
  const request = ++discussionViewRequest; button.disabled = true;
  try {
    const data = await apiFetch(`/api/discussions/source/${source.kind}/${source.id}`);
    if (request !== discussionViewRequest || !discussionsActive()) return;
    // A contract has one main task: open it; subtasks are added inside it.
    const mainTask = source.kind === 'contract' && data.items.find(i => i.kind === 'contract');
    if (mainTask) return openDiscussion('contract', mainTask.id);
    discussionSelectedSource = data.source;
    document.getElementById('discussionMain').innerHTML = `<div class="discussion-catalogue"><button type="button" class="contract-secondary" onclick="showDiscussionProcesses('${source.kind}')">← ${escapeHtml(source.label)}</button><div class="discussion-process-heading"><i class="fas ${discussionSourceIcon(source.kind)}" aria-hidden="true"></i><h2>${escapeHtml(source.title)}</h2><p>${escapeHtml(discussionStatus(source.status))}${source.fundName ? ' · ' + escapeHtml(source.fundName) : ''}</p></div><h3>Задачи процесса</h3><div class="discussion-process-chats">${data.items.length ? data.items.map(i => `<button type="button" class="contract-secondary" onclick="openDiscussion('${i.kind}',${i.id})"><i class="fas fa-comments" aria-hidden="true"></i> ${escapeHtml(i.title)} <span>${escapeHtml(discussionStatus(i.task?.status || 'open'))} · Открыть →</span></button>`).join('') : '<p class="contract-empty">У вас пока нет задач по этому процессу.</p>'}</div>${data.canCreate ? `<button type="button" class="contract-primary" onclick="newDiscussion(discussionSelectedSource)"><i class="fas fa-plus" aria-hidden="true"></i> ${({ contract: 'Новая подзадача по договору', client: 'Новая задача по клиенту' })[source.kind] || 'Новая задача по этому процессу'}</button>` : ''}<p class="contract-empty">В новой задаче процесс будет связан сразу. Добавьте коллег по имени в сообщении.</p></div>`;
  } catch (err) { if (request === discussionViewRequest) showToast(err.message, 'red'); }
  finally { button.disabled = false; }
}
// The forms are the registries' own; after saving, the new process's task opens.
async function openProcessFormFromTasks(button, open, what) {
  button.disabled = true;
  try {
    const data = await apiFetch('/api/onboarding');
    obClients.length = 0; obClients.push(...data.obClients);
    obTasks.length = 0; obTasks.push(...data.obTasks);
    engagements.length = 0; engagements.push(...data.engagements);
    open();
  } catch (err) { showToast(`Не удалось открыть форму ${what}: ` + err.message, 'red'); }
  finally { button.disabled = false; }
}
function newContractFromTasks(button) { return openProcessFormFromTasks(button, () => openNewEngagementModal(null, null, true), 'договора'); }
function newClientFromTasks(button) { return openProcessFormFromTasks(button, () => openNewObClientModal(null, true), 'клиента'); }
// A client has no built-in task: its onboarding task is created with the
// client, linked to it and due on the onboarding target date.
async function startClientOnboardingTask(client) {
  try {
    const result = await apiFetch('/api/discussions', { method: 'POST', body: JSON.stringify({
      title: ('Онбординг: ' + client.name).slice(0, 160), participants: [], dueDate: client.targetDate || null,
      source: { kind: 'client', id: client.id }, requestKey: contractTemplateRequestKey() }) });
    discussionTaskFilter = 'open';
    await refreshDiscussionList();
    return openDiscussion('room', result.id);
  } catch (err) {
    showToast('Клиент создан, но задачу онбординга создать не удалось: ' + err.message, 'red');
    return showDiscussionProcesses('client');
  }
}
function openDiscussionProcessSection(kind) {
  const category = discussionCategories.find(c => c.kind === kind); if (category) navigateTo(category.page);
}
function updateDiscussionEntryPoint(page) {
  const button = document.getElementById('discussionPageEntry'); if (!button) return;
  const map = { 'ob-clients':'client', engagements:'contract', 'conflict-approvals':'conflict', sandbox:'sandbox', deals:'deal', ic:'ic', portfolio:'portfolio', spvs:'spv', 'lp-register':'lp', 'lp-capital-calls':'capital-call', 'lp-distributions':'distribution', closing:'closing', 'fund-compare':'fund', 'hf-subscriptions':'subscription', 'hf-nav':'nav', workflow:'workflow', 'ob-restricted':'coi', calendar:'report', kycrenewal:'client' };
  button.hidden = !map[page] || !getAuth()?.permissions?.internal;
  button.dataset.kind = map[page] || '';
}
// A small, uniform entry on entity cards makes the conversation reachable in both directions.
function addDiscussionRecordButton(container, kind, id, close) {
  if (!container || !getAuth()?.permissions?.internal) return;
  container.querySelector('.discussion-record-entry')?.remove();
  const button = document.createElement('button'); button.type = 'button'; button.className = 'contract-secondary discussion-record-entry';
  button.innerHTML = '<i class="fas fa-comments" aria-hidden="true"></i> Задачи';
  button.onclick = async () => {
    close(); await showDiscussionProcesses(kind);
    const index = discussionSources.findIndex(s => s.kind === kind && s.id === id);
    if (index >= 0 && discussionsActive()) await chooseDiscussionProcess(index, button);
  };
  container.prepend(button);
}
