let contractApprovalUI = null;
const CONTRACT_APPROVAL_LABELS = {
  draft: 'Черновик', active: 'На согласовании', approved: 'Согласован', returned: 'На доработке',
  rejected: 'Отклонён', withdrawn: 'Отозван', needs_revision: 'Требуется новое согласование',
  waiting: 'Очередь не наступила', pending: 'Ожидает решения', cancelled: 'Шаг закрыт',
};
function contractApprovalLabel(status) { return CONTRACT_APPROVAL_LABELS[status] || status; }
function contractApprovalPanel(engagementId) {
  return `<section class="contract-versions"><div class="contract-versions-heading"><div><h3>Задача по согласованию</h3><p>Переписка, участники и решения — в разделе «Задачи».</p></div>
    <button type="button" class="contract-primary" onclick="closeEngagementModal();openDiscussion('contract',${engagementId})"><i class="fas fa-comments" aria-hidden="true"></i> Открыть задачу</button></div></section>`;
}
function contractConversationPanel(engagementId, kind = 'contract') {
  return `<section id="contractApprovalPanel" class="contract-versions discussion-conversation" data-engagement-id="${engagementId}" data-kind="${kind}" data-surface="hub">
    <div class="discussion-task-layout"><div class="discussion-thread"><div id="discussionNextStep" class="discussion-next-step" hidden></div><div id="discussionTools" class="discussion-tools" hidden></div>${contractDiscussionPanel(kind)}<footer id="discussionTaskActions"></footer></div>
    <aside id="discussionProperties" class="discussion-properties" aria-label="Свойства задачи"><div id="discussionPropertyBody"></div>${discussionFilesPanel()}
    ${kind === 'contract' ? '<details class="discussion-approval-details"><summary>Настройка и история согласования</summary>' : '<div hidden>'}
    <p id="contractApprovalMessage" class="contract-message" role="status" aria-live="polite">Загрузка согласования…</p>
    <div id="contractApprovalBody"></div>
    ${kind === 'contract' ? '</details>' : '</div>'}
    </aside></div>
  </section>`;
}
function contractApprovalMessage(text, error = false) {
  const el = document.getElementById('contractApprovalMessage');
  if (el) { el.textContent = text; el.className = error ? 'contract-message-error' : 'contract-message'; }
}
async function loadContractApprovals(engagementId) {
  return loadContractConversation(engagementId);
}
function renderContractApprovalCycle(cycle, current, state) {
  return `<article class="contract-version${current ? ' contract-version-current' : ''}">
    <div class="contract-version-top"><strong>Цикл ${cycle.number} · ${escapeHtml(contractApprovalLabel(cycle.status))}</strong>
      <button class="contract-secondary" onclick="downloadContractVersion(${state.engagementId},${cycle.versionId},this)">Редакция ${cycle.version} ↓</button></div>
    <p class="contract-version-meta">${escapeHtml(cycle.initiator)} · ${escapeHtml(contractVersionDate(cycle.createdAt))}</p>
    <p class="contract-message">Согласовали ${cycle.steps.filter(s => s.status === 'approved').length} из ${cycle.steps.length} · ${cycle.mode === 'parallel' ? 'Договор отправлен всем одновременно' : 'Ранее запущенное согласование по очереди'}</p>
    ${cycle.invalidatedAt ? '<p class="contract-metadata-warning">Решения сохранены в истории. Эта редакция возвращена в доработку и больше не даёт текущего одобрения.</p>' : ''}
    ${cycle.route.allowSelfApproval ? `<p class="contract-version-meta">Маршрут допускает самосогласование: ${escapeHtml(cycle.route.selfApprovalReason)}</p>` : ''}
    ${cycle.steps.map((step, i) => `<div class="contract-approval-step">
      <div class="contract-version-top"><strong>${cycle.mode === 'parallel' ? '' : (i + 1) + '. '}${escapeHtml(step.name)}</strong><span>${escapeHtml(contractApprovalLabel(step.status))}</span></div>
      <p class="contract-version-meta">${step.dueAt ? 'Срок: ' + escapeHtml(contractVersionDate(step.dueAt)) + (step.status === 'pending' && Date.parse(step.dueAt) < Date.now() ? ' · просрочено' : '') : step.dueDays + ' дн. с начала шага'}${step.decidedAt ? ' · Решение: ' + escapeHtml(contractVersionDate(step.decidedAt)) : ''}</p>
      ${step.status === 'pending' && !step.available ? '<p class="contract-message-error">Сотрудник недоступен. Отзовите согласование, выберите доступных сотрудников и отправьте договор повторно.</p>' : ''}
      </div>`).join('')}
    <details><summary>Реквизиты, переданные на согласование</summary><dl class="contract-approval-metadata">${Object.entries(cycle.metadata).filter(([,v]) => v != null && v !== '').map(([k,v]) => `<dt>${escapeHtml(CONTRACT_METADATA_LABELS[k] || k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl></details>
  </article>`;
}
function renderContractApproval() {
  const state = contractApprovalUI, data = state.data, cycle = data.cycles[0];
  const people = data.people || [];
  const previousPeople = new Set(cycle?.steps.map(s => s.userId) || []);
  // Background updates must preserve an in-progress participant selection.
  const oldForm = state.panel.querySelector('#contractApprovalSelection');
  const selected = oldForm ? new Set([...oldForm.querySelectorAll('input[name="contractApprover"]:checked')].map(input => Number(input.value))) : previousPeople;
  const days = state.panel.querySelector('#contractApprovalDueDays')?.value ?? '3';
  state.panel.querySelector('#contractApprovalBody').innerHTML = `
    <p><strong>${escapeHtml(contractApprovalLabel(data.summary.status))}</strong> · текущая редакция ${data.currentVersion || 'не загружена'}</p>
    ${cycle ? renderContractApprovalCycle(cycle, true, state) : '<p class="contract-empty">Договор ещё не отправляли на согласование.</p>'}
    ${!data.currentVersion ? '<p class="contract-metadata-warning">Сначала загрузите файл договора в блоке «Версии документа».</p>' : !data.metadataMatches ? '<p class="contract-metadata-warning">Снимок редакции неполон или отличается от текущих реквизитов. Проверьте текст и сохраните новую редакцию перед подачей.</p>' : ''}
    ${!data.hasClient ? '<p class="contract-metadata-warning">Для подачи нужна связь договора с карточкой клиента.</p>' : ''}
    ${data.canSubmit && (!state.chat?.task || state.chat.task.status === 'open') ? people.length ? `<form id="contractApprovalSelection" onsubmit="event.preventDefault();submitContractApproval()">
      <fieldset class="contract-approval-people"><legend>Кто согласует договор</legend>
        ${people.map(person => `<label class="contract-approval-person"><input type="checkbox" name="contractApprover" value="${person.id}"${selected.has(person.id) ? ' checked' : ''} /><span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.role)}</small></span></label>`).join('')}
      </fieldset>
      <p class="contract-empty">Все выбранные сотрудники получат договор одновременно. Для согласования нужны ответы всех участников.</p>
      <label for="contractApprovalDueDays">Срок ответа, календарных дней</label><input id="contractApprovalDueDays" type="number" min="1" max="30" value="${escapeHtml(days)}" required />
      <button class="contract-primary" type="submit">Отправить на согласование</button>
    </form>` : '<p class="contract-metadata-warning">Нет доступных согласующих. Администратор может добавить сотрудника в разделе «Команда / Пользователи». Инициатор и автор файла не согласуют собственную редакцию.</p>' : ''}
    ${data.cycles.length > 1 ? `<details class="contract-version-history"><summary>Предыдущие циклы (${data.cycles.length - 1})</summary>${data.cycles.slice(1).map(c => renderContractApprovalCycle(c, false, state)).join('')}</details>` : ''}`;
}
async function contractApprovalAction(path, body, method = 'POST', idempotent = true) {
  const state = contractApprovalUI;
  if (!state?.data || state.busy) return;
  const isMessage = path.endsWith('/chat') || path.endsWith('/messages');
  const fileBatch = isMessage ? (state.attachments || []) : [];
  const fingerprint = JSON.stringify([body, isMessage ? state.attachmentKey : null]);
  if (idempotent) {
    if (state.keys[path]?.fingerprint !== fingerprint) state.keys[path] = { fingerprint, key: contractTemplateRequestKey() };
    body = { ...body, requestKey: state.keys[path].key };
  }
  const controls = [...state.panel.querySelectorAll('button, input, select, textarea')];
  const before = controls.map(c => c.disabled);
  state.busy = true; ++state.request; controls.forEach(c => { c.disabled = true; });
  let success = false;
  let actionError = '';
  try {
    if (fileBatch.length) {
      const form = new FormData(); form.append('payload', JSON.stringify(body));
      fileBatch.forEach(file => form.append('files', file));
      await contractDocumentFetch(path, { method, body: form });
    } else await apiFetch(path, { method, body: JSON.stringify(body) });
    success = true;
  }
  catch (err) { actionError = err.message; }
  finally { state.busy = false; controls.forEach((c,i) => { c.disabled = before[i]; }); }
  if (contractConversationOpen(state)) {
    if (success) {
      const sent = body.text ?? body.comment ?? body.reason ?? body.note ?? '';
      const composer = document.getElementById('contractChatText');
      if (composer?.value.trim() === sent) { composer.value = ''; clearDiscussionMentions(state); }
      if (isMessage && state.attachments === fileBatch) { state.attachments = []; state.attachmentKey = null; renderDiscussionAttachments(state); }
      if (isMessage && typeof forgetDiscussionDraft === 'function') forgetDiscussionDraft(state);
      if (isMessage) {state.replyTo=null;renderDiscussionReply(state);}
      state.scrollToLatest = true;
    }
    await Promise.all([loadContractApprovals(state.engagementId), loadContractDocuments(state.engagementId), loadContractProcess(state.engagementId)]);
    if (contractConversationOpen(state)) contractDiscussionStatus(actionError || (isMessage ? '' : 'Действие сохранено'), !success);
    if (success && typeof refreshDiscussionList === 'function') refreshDiscussionList();
  }
  return success;
}
function submitContractApproval() {
  const state = contractApprovalUI, data = state?.data;
  if (!data?.canSubmit) return;
  const participants = [...state.panel.querySelectorAll('input[name="contractApprover"]:checked')].map(input => Number(input.value));
  if (!participants.length || participants.length > 20) return contractApprovalMessage('Выберите от 1 до 20 согласующих', true);
  return contractApprovalAction(`/api/engagements/${state.engagementId}/approvals`, {
    expectedVersion: data.currentVersion, expectedCycleId: data.cycles[0]?.id || null, participants,
    dueDays: Number(document.getElementById('contractApprovalDueDays').value),
  });
}
function actContractApproval(action) {
  const state = contractApprovalUI, cycle = state?.data?.cycles[0];
  if (!cycle) return;
  if (state.mentions?.length) return contractDiscussionStatus('Отправьте сообщение с выбранным сотрудником, затем зафиксируйте решение.', true);
  if (state.attachments?.length) return contractDiscussionStatus('Сначала отправьте выбранные вложения скрепкой, затем зафиксируйте решение.', true);
  const comment = document.getElementById('contractChatText').value.trim();
  if (action !== 'approved' && !comment) return contractDiscussionStatus('Напишите причину в поле сообщения, затем нажмите нужное решение.', true);
  if (comment.length > 2000) return contractDiscussionStatus('Комментарий к решению — до 2000 символов. Более длинный текст отправьте обычным сообщением.', true);
  const control = ['withdraw', 'rework'].includes(action);
  if (control ? !(action === 'withdraw' ? cycle.canWithdraw : cycle.canRework) : !cycle.canDecide) return;
  return contractApprovalAction(`/api/engagements/${state.engagementId}/approvals/${cycle.id}/${control ? action : 'decision'}`,
    control ? { expectedRevision: cycle.revision, reason: comment } : { expectedRevision: cycle.revision,
      stepId: cycle.decisionStepId, decision: action, comment });
}

async function renderContractApprovalInbox() {
  const root = document.getElementById('contractApprovalInbox');
  if (!root) return;
  const request = root._request = (root._request || 0) + 1;
  root.innerHTML = '<p class="contract-empty">Загрузка договоров…</p>';
  try {
    const { items } = await apiFetch('/api/contract-approval-inbox');
    if (root._request !== request) return;
    root.innerHTML = items.length ? items.sort((a,b) => Number(b.mine) - Number(a.mine)).map(item => `<div class="contract-version">
      <div class="contract-version-top"><strong>${escapeHtml(item.contractNumber || 'Договор')} · ${escapeHtml(item.clientName)}</strong><button class="contract-secondary" onclick="openContractApprovalItem(${item.engagementId})">Открыть</button></div>
      <p>${escapeHtml(contractApprovalLabel(item.status))} · редакция ${item.version}${item.mode === 'parallel' ? ' · Согласовали ' + item.approvedCount + ' из ' + item.totalCount : ''}${item.mine ? ' · Требуется ваше действие' : ''}</p>
      <p class="contract-version-meta">${escapeHtml(item.assignee)}${item.dueAt ? ' · срок ' + escapeHtml(contractVersionDate(item.dueAt)) + (Date.parse(item.dueAt) < Date.now() ? ' · просрочено' : '') : ''}${!item.assigneeAvailable ? ' · сотрудник недоступен' : ''}</p>
    </div>`).join('') : '<p class="contract-empty">Нет договоров, ожидающих решения или повторной подачи.</p>';
  } catch (err) { if (root._request === request) root.textContent = 'Не удалось загрузить согласования договоров: ' + err.message; }
}
async function openContractRecord(id) {
  try {
    const data = await apiFetch('/api/onboarding');
    const contract = data.engagements.find(e => e.id === id);
    if (!contract) throw new Error('Договор недоступен');
    const old = engagements.find(e => e.id === id);
    if (old) Object.assign(old, contract); else engagements.push(contract);
    engEditMode = false; openEngagementModal(id);
    // From a task the next step after approval is signing, shown in the card.
    document.getElementById('contractSigningPanel')?.scrollIntoView({ block: 'start' });
  } catch (err) { showToast(err.message, 'red'); }
}
function openContractApprovalItem(id) { return openDiscussion('contract', id); }

// Links keep the regular login and server-side contract access checks.
async function openContractApprovalLink() {
  if (new URLSearchParams(window.location.search).get('workspace') === 'discussions') return showDiscussionProcesses();
  const discussion = new URLSearchParams(window.location.search).get('discussion');
  if (discussion && /^[1-9]\d*$/.test(discussion) && Number.isSafeInteger(Number(discussion))) return openDiscussion('room', Number(discussion));
  const value = new URLSearchParams(window.location.search).get('contract');
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return;
  await openContractApprovalItem(Number(value));
}
