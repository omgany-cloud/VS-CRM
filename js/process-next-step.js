// "Следующий шаг": one line above a process task's chat saying what to do now
// and offering the single button that does it (server/processNextStep.js).
const NEXT_STEP_ICONS = { action: 'fa-circle-arrow-right', wait: 'fa-hourglass-half', done: 'fa-circle-check', stop: 'fa-circle-xmark' };
const NEXT_STEP_KICKERS = { action: 'Следующий шаг', wait: 'Сейчас', done: 'Готово', stop: 'Остановлено' };
const NEXT_STEP_STATUSES = { completed: 'Выполнен', open: 'Текущий', in_progress: 'В работе', locked: 'Ещё закрыт', escalated: 'На эскалации', rejected: 'Отклонён' };

// A contract task follows its contract; a free task follows the first linked
// process that has steps, in the server's order (processNextStep.js STEP_KINDS).
const NEXT_STEP_KINDS = ['client', 'contract', 'conflict', 'sandbox'];
const NEXT_STEP_PROCESS_LABELS = { client: 'онбординг', contract: 'договор', conflict: 'конфликт интересов', sandbox: 'песочница' };
function discussionNextStepTarget(state) {
  if (state.kind !== 'room') return { kind: 'contract', id: state.engagementId };
  const links = state.data?.room?.links || [];
  for (const kind of NEXT_STEP_KINDS) { const link = links.find(l => l.kind === kind); if (link) return { kind, id: link.id }; }
  return null;
}

async function refreshDiscussionNextStep(state, force = false) {
  if (!state || !contractConversationOpen(state)) return;
  const box = document.getElementById('discussionNextStep'); if (!box) return;
  const target = discussionNextStepTarget(state);
  if (!target || state.chat.task?.status === 'trashed') { box.hidden = true; box.innerHTML = ''; state.nextStep = null; return; }
  const key = `${target.kind}:${target.id}`;
  // Process records change outside the chat, so re-check now and then.
  if (!force && state.nextStep?.key === key && Date.now() - state.nextStep.at < 10000) return;
  const request = state.nextStepRequest = (state.nextStepRequest || 0) + 1;
  state.nextStep = { ...(state.nextStep?.key === key ? state.nextStep : {}), key, at: Date.now() };
  try {
    const step = await apiFetch(`/api/process-steps/${target.kind}/${target.id}`);
    if (!contractConversationOpen(state) || state.nextStepRequest !== request) return;
    state.nextStep.data = step;
    renderDiscussionNextStep(state);
  } catch (err) {
    if (contractConversationOpen(state) && state.nextStepRequest === request && !state.nextStep.data) box.hidden = true;
  }
}

// Shared by the task strip and the contract card; `onclick` runs the step's one action.
function nextStepHtml(step, onclick, expanded) {
  const overdue = step.dueDate && step.tone === 'action' && step.dueDate < taskToday();
  const details = [step.who && `Выполняет: ${step.who}`, step.dueDate && `срок ${contractSigningDay(step.dueDate)}${overdue ? ' · просрочен' : ''}`, step.text].filter(Boolean).join(' · ');
  return `<i class="fas ${NEXT_STEP_ICONS[step.tone] || NEXT_STEP_ICONS.wait} discussion-next-step-icon" aria-hidden="true"></i>
    <div class="discussion-next-step-body">
      <small>${NEXT_STEP_KICKERS[step.tone] || ''} · ${NEXT_STEP_PROCESS_LABELS[step.process] || ''}${step.mine ? ' · ваш ход' : ''}</small>
      <strong>${escapeHtml(step.title)}</strong>
      ${details ? `<span class="${overdue ? 'overdue' : ''}">${escapeHtml(details)}</span>` : ''}
      ${step.note ? `<span>${escapeHtml(step.note)}</span>` : ''}
    </div>
    ${step.action ? `<button type="button" class="contract-primary" onclick="${onclick}">${escapeHtml(step.action.label)}</button>` : ''}
    ${step.steps?.length ? `<details${expanded ? ' open' : ''}><summary>Этапы: ${step.done} из ${step.steps.length}</summary><ol>${step.steps.map(s =>
      `<li class="step-${s.status}"><span>${escapeHtml(s.number)} ${escapeHtml(s.title)}</span><small>${NEXT_STEP_STATUSES[s.status] || escapeHtml(s.status)}</small></li>`).join('')}</ol></details>` : ''}`;
}

function renderDiscussionNextStep(state) {
  const box = document.getElementById('discussionNextStep'), step = state.nextStep?.data;
  if (!box || !step) return;
  box.className = `discussion-next-step tone-${step.tone}`;
  box.innerHTML = nextStepHtml(step, 'runDiscussionNextStep(this)', !!box.querySelector('details')?.open);
  box.hidden = false;
}

// "Что сделать сейчас" at the top of the contract card: the same server-computed
// step, with a button that goes to the right place from the card itself.
const CONTRACT_CARD_STEP_LABELS = { versions: 'Перейти к загрузке файла', signing: 'Перейти к подписанию', details: 'Изменить реквизиты',
  'contract-approval': 'Открыть задачу и выбрать согласующих', 'contract-decide': 'Открыть задачу договора', 'onboarding-client': 'Открыть онбординг клиента',
  'conflict-approval': 'Открыть решение по конфликту' };
let contractCardStep = null;
async function loadContractCardNextStep(engagementId) {
  const box = document.getElementById('contractNextStep');
  if (!box || Number(box.dataset.engagementId) !== engagementId) return;
  try {
    const step = await apiFetch(`/api/process-steps/contract/${engagementId}`);
    if (document.getElementById('contractNextStep') !== box) return;
    const kind = step.action?.kind === 'contract-card' ? step.action.section : step.action?.kind;
    contractCardStep = { engagementId, step };
    box.className = `discussion-next-step contract-card-next-step tone-${step.tone}`;
    box.innerHTML = nextStepHtml({ ...step, action: step.action && { ...step.action, label: CONTRACT_CARD_STEP_LABELS[kind] || step.action.label } },
      `runContractCardNextStep(${engagementId},this)`, !!box.querySelector('details')?.open);
    box.hidden = false;
  } catch { if (document.getElementById('contractNextStep') === box) box.hidden = true; }
}

async function runContractCardNextStep(engagementId, button) {
  const action = contractCardStep?.engagementId === engagementId ? contractCardStep.step.action : null;
  if (!action || button.disabled) return;
  if (action.kind === 'contract-card') {
    if (action.section === 'details') { engEditMode = true; openEngagementModal(engagementId); return; }
    document.getElementById(action.section === 'versions' ? 'contractVersionsPanel' : 'contractSigningPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (action.section === 'versions') document.getElementById('contractVersionFile')?.focus({ preventScroll: true });
    return;
  }
  button.disabled = true;
  try {
    closeEngagementModal();
    if (action.kind === 'onboarding-client') { await loadOnboardingFromApi(); openObClientModal(action.clientId); return; }
    if (action.kind === 'conflict-approval') { await openConflictApprovalPage(action.approvalId); return; }
    await openDiscussion('contract', engagementId);
    const state = contractApprovalUI;
    if (action.kind === 'contract-approval' && contractConversationOpen(state)) {
      state.propertiesOpen = true; applyDiscussionPropertiesVisibility(state);
      const settings = state.panel.querySelector('.discussion-approval-details');
      if (settings) { settings.open = true; settings.scrollIntoView({ block: 'nearest' }); }
    }
  } catch (err) { showToast('Не удалось открыть: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}

async function runDiscussionNextStep(button) {
  const state = contractApprovalUI, step = state?.nextStep?.data, action = step?.action;
  if (!contractConversationOpen(state) || !action || button.disabled) return;
  button.disabled = true;
  try {
    if (action.kind === 'onboarding-step' || action.kind === 'onboarding-client') {
      await loadOnboardingFromApi();
      if (action.kind === 'onboarding-step' && obTasks.some(t => t.id === action.taskId && t.status !== 'locked')) openObTaskForm(action.taskId);
      else openObClientModal(action.clientId || step.processId);
    } else if (action.kind === 'contract-card') {
      await openContractRecord(step.processId);
      if (action.section !== 'details') document.getElementById(action.section === 'versions' ? 'contractVersionsPanel' : 'contractSigningPanel')?.scrollIntoView({ block: 'start' });
    } else if (action.kind === 'contract-approval') {
      state.propertiesOpen = true; applyDiscussionPropertiesVisibility(state);
      const settings = state.panel.querySelector('.discussion-approval-details');
      if (settings) { settings.open = true; settings.scrollIntoView({ block: 'nearest' }); }
    } else if (action.kind === 'contract-decide') {
      document.getElementById('contractChatDecisions')?.scrollIntoView({ block: 'nearest' });
      document.getElementById('contractChatText')?.focus();
    } else if (action.kind === 'conflict-approval') {
      await openConflictApprovalPage(action.approvalId);
    } else if (action.kind === 'open-record') {
      await openDiscussionSource(action.record, action.id);
    }
  } catch (err) { showToast('Не удалось открыть шаг: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}
