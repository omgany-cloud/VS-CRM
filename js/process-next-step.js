// "Следующий шаг": one line above a process task's chat saying what to do now
// and offering the single button that does it (server/processNextStep.js).
const NEXT_STEP_ICONS = { action: 'fa-circle-arrow-right', wait: 'fa-hourglass-half', done: 'fa-circle-check', stop: 'fa-circle-xmark' };
const NEXT_STEP_KICKERS = { action: 'Следующий шаг', wait: 'Сейчас', done: 'Готово', stop: 'Остановлено' };
const NEXT_STEP_STATUSES = { completed: 'Выполнен', open: 'Текущий', in_progress: 'В работе', locked: 'Ещё закрыт', escalated: 'На эскалации', rejected: 'Отклонён' };

// A contract task follows its contract; a free task follows the client it is linked to.
function discussionNextStepTarget(state) {
  if (state.kind !== 'room') return { kind: 'contract', id: state.engagementId };
  const client = state.data?.room?.links?.find(l => l.kind === 'client');
  return client ? { kind: 'client', id: client.id } : null;
}

async function refreshDiscussionNextStep(state, force = false) {
  if (!state || !contractConversationOpen(state)) return;
  const box = document.getElementById('discussionNextStep'); if (!box) return;
  const target = discussionNextStepTarget(state);
  if (!target || state.chat.task?.status === 'trashed') { box.hidden = true; box.innerHTML = ''; state.nextStep = null; return; }
  const key = `${target.kind}:${target.id}`;
  // Onboarding and contract records change outside the chat, so re-check now and then.
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

function renderDiscussionNextStep(state) {
  const box = document.getElementById('discussionNextStep'), step = state.nextStep?.data;
  if (!box || !step) return;
  const expanded = !!box.querySelector('details')?.open;
  const overdue = step.dueDate && step.tone === 'action' && step.dueDate < taskToday();
  const details = [step.who && `Выполняет: ${step.who}`, step.dueDate && `срок ${contractSigningDay(step.dueDate)}${overdue ? ' · просрочен' : ''}`, step.text].filter(Boolean).join(' · ');
  box.className = `discussion-next-step tone-${step.tone}`;
  box.innerHTML = `<i class="fas ${NEXT_STEP_ICONS[step.tone] || NEXT_STEP_ICONS.wait} discussion-next-step-icon" aria-hidden="true"></i>
    <div class="discussion-next-step-body">
      <small>${NEXT_STEP_KICKERS[step.tone] || ''} · ${step.process === 'client' ? 'онбординг' : 'договор'}</small>
      <strong>${escapeHtml(step.title)}</strong>
      ${details ? `<span class="${overdue ? 'overdue' : ''}">${escapeHtml(details)}</span>` : ''}
      ${step.note ? `<span>${escapeHtml(step.note)}</span>` : ''}
    </div>
    ${step.action ? `<button type="button" class="contract-primary" onclick="runDiscussionNextStep(this)">${escapeHtml(step.action.label)}</button>` : ''}
    ${step.steps?.length ? `<details${expanded ? ' open' : ''}><summary>Этапы: ${step.done} из ${step.steps.length}</summary><ol>${step.steps.map(s =>
      `<li class="step-${s.status}"><span>${escapeHtml(s.number)} ${escapeHtml(s.title)}</span><small>${NEXT_STEP_STATUSES[s.status] || escapeHtml(s.status)}</small></li>`).join('')}</ol></details>` : ''}`;
  box.hidden = false;
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
      document.getElementById(action.section === 'versions' ? 'contractVersionsPanel' : 'contractSigningPanel')?.scrollIntoView({ block: 'start' });
    } else if (action.kind === 'contract-approval') {
      state.propertiesOpen = true; applyDiscussionPropertiesVisibility(state);
      const settings = state.panel.querySelector('.discussion-approval-details');
      if (settings) { settings.open = true; settings.scrollIntoView({ block: 'nearest' }); }
    } else if (action.kind === 'contract-decide') {
      document.getElementById('contractChatDecisions')?.scrollIntoView({ block: 'nearest' });
      document.getElementById('contractChatText')?.focus();
    }
  } catch (err) { showToast('Не удалось открыть шаг: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}
