const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function ui(state) {
  const box = { hidden: true, innerHTML: '', className: '', querySelector: () => box.details };
  const calls = [];
  const ctx = vm.createContext({
    document: { getElementById: id => id === 'discussionNextStep' ? box : null },
    contractApprovalUI: state, contractConversationOpen: s => s === ctx.contractApprovalUI && !s.closed,
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    taskToday: () => '2026-10-28', contractSigningDay: d => d.split('-').reverse().join('.'), showToast() {},
    apiFetch: async url => { calls.push(url); return ctx.next; },
    loadOnboardingFromApi: async () => calls.push('onboarding'), obTasks: [{ id: 5, status: 'open' }],
    openObTaskForm: id => calls.push(['form', id]), openObClientModal: id => calls.push(['client', id]),
    openContractRecord: async id => calls.push(['card', id]), applyDiscussionPropertiesVisibility() {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/process-next-step.js'), 'utf8'), ctx);
  return { ctx, box, calls };
}
const room = links => ({ kind: 'room', engagementId: 3, data: { room: { links } }, chat: { task: { status: 'open' } } });

test('a client-linked task shows the next onboarding step with its button, deadline and stages', async () => {
  const { ctx, box, calls } = ui(room([{ kind: 'deal', id: 1 }, { kind: 'client', id: 7 }]));
  ctx.next = { process: 'client', processId: 7, tone: 'action', title: '1.1 <Проверка>', who: 'RM', dueDate: '2026-10-27', done: 1,
    action: { kind: 'onboarding-step', taskId: 5, label: 'Открыть шаг 1.1' },
    steps: [{ number: '1.1', title: 'A', status: 'open' }, { number: '2.1', title: 'B', status: 'locked' }] };
  await ctx.refreshDiscussionNextStep(ctx.contractApprovalUI);
  assert.deepEqual(calls, ['/api/process-steps/client/7']);
  assert.equal(box.hidden, false); assert.match(box.className, /tone-action/);
  assert.match(box.innerHTML, /1\.1 &lt;Проверка&gt;/); assert.match(box.innerHTML, /срок 27\.10\.2026 · просрочен/);
  assert.match(box.innerHTML, /Открыть шаг 1\.1/); assert.match(box.innerHTML, /Этапы: 1 из 2/); assert.match(box.innerHTML, /Ещё закрыт/);

  await ctx.refreshDiscussionNextStep(ctx.contractApprovalUI);
  assert.equal(calls.length, 1, 'recent result is reused');
  box.details = { open: true };
  await ctx.refreshDiscussionNextStep(ctx.contractApprovalUI, true);
  assert.equal(calls.length, 2); assert.match(box.innerHTML, /<details open>/);

  await ctx.runDiscussionNextStep({ disabled: false });
  assert.deepEqual(calls.slice(2), ['onboarding', ['form', 5]]);
});

test('contract tasks follow their contract; unrelated or trashed tasks show nothing', async () => {
  const contract = { kind: 'contract', engagementId: 9, data: {}, chat: { task: { status: 'open' } } };
  const { ctx, box, calls } = ui(contract);
  ctx.next = { process: 'contract', processId: 9, tone: 'wait', title: 'На согласовании', steps: [], done: 0 };
  await ctx.refreshDiscussionNextStep(contract);
  assert.deepEqual(calls, ['/api/process-steps/contract/9']); assert.ok(!box.innerHTML.includes('<button'));

  const free = room([{ kind: 'deal', id: 1 }]);
  ctx.contractApprovalUI = free; await ctx.refreshDiscussionNextStep(free);
  assert.equal(box.hidden, true); assert.equal(calls.length, 1);
  const trashed = room([{ kind: 'client', id: 2 }]); trashed.chat.task.status = 'trashed';
  ctx.contractApprovalUI = trashed; await ctx.refreshDiscussionNextStep(trashed);
  assert.equal(box.hidden, true); assert.equal(calls.length, 1);
});

test('a late answer for a task that was left is ignored', async () => {
  const state = room([{ kind: 'client', id: 7 }]);
  const { ctx, box } = ui(state);
  let release; ctx.apiFetch = () => new Promise(resolve => { release = resolve; });
  const pending = ctx.refreshDiscussionNextStep(state);
  state.closed = true;
  release({ tone: 'action', title: 'Old', process: 'client' }); await pending;
  assert.equal(box.innerHTML, '');
});

function cardUi(step) {
  const box = { hidden: true, innerHTML: '', className: '', dataset: { engagementId: '9' }, querySelector: () => null };
  const calls = [], scrolled = [], focused = [], settings = { open: false, scrollIntoView() {} };
  const target = id => ({ scrollIntoView: () => scrolled.push(id), focus: () => focused.push(id) });
  const ctx = vm.createContext({
    document: { getElementById: id => id === 'contractNextStep' ? box : target(id) },
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    taskToday: () => '2026-10-28', contractSigningDay: d => d, showToast() {}, engEditMode: false,
    apiFetch: async url => { calls.push(url); return step; },
    closeEngagementModal: () => calls.push('close'), openEngagementModal: id => calls.push(['card', id, ctx.engEditMode]),
    openDiscussion: async (kind, id) => { calls.push(['task', kind, id]); ctx.contractApprovalUI = { panel: { querySelector: () => settings } }; },
    contractConversationOpen: s => !!s, applyDiscussionPropertiesVisibility: s => calls.push(['properties', s.propertiesOpen]),
    loadOnboardingFromApi: async () => calls.push('onboarding'), openObClientModal: id => calls.push(['client', id]),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/process-next-step.js'), 'utf8'), ctx);
  return { ctx, box, calls, scrolled, focused, settings };
}

test('the contract card says what to do now and its button goes to the right place', async () => {
  let ui = cardUi({ process: 'contract', tone: 'action', title: 'Загрузите файл договора', text: 'DOCX или PDF', steps: [], done: 0,
    action: { kind: 'contract-card', section: 'versions', label: 'Открыть карточку договора' } });
  await ui.ctx.loadContractCardNextStep(9);
  assert.equal(ui.box.hidden, false); assert.match(ui.box.className, /contract-card-next-step tone-action/);
  assert.match(ui.box.innerHTML, /Загрузите файл договора/); assert.match(ui.box.innerHTML, /Перейти к загрузке файла/);
  assert.ok(!ui.box.innerHTML.includes('Открыть карточку договора'), 'inside the card the button does not offer to open the card');
  await ui.ctx.runContractCardNextStep(9, { disabled: false });
  assert.deepEqual(ui.scrolled, ['contractVersionsPanel']); assert.deepEqual(ui.focused, ['contractVersionFile']);

  ui = cardUi({ process: 'contract', tone: 'action', title: 'Отправьте договор на согласование', steps: [], done: 1, action: { kind: 'contract-approval', label: 'Выбрать согласующих' } });
  await ui.ctx.loadContractCardNextStep(9);
  assert.match(ui.box.innerHTML, /Открыть задачу и выбрать согласующих/);
  await ui.ctx.runContractCardNextStep(9, { disabled: false });
  assert.equal(JSON.stringify(ui.calls.slice(1)), JSON.stringify(['close', ['task', 'contract', 9], ['properties', true]])); assert.equal(ui.settings.open, true);

  ui = cardUi({ process: 'contract', tone: 'action', title: 'Свяжите договор с карточкой клиента', steps: [], done: 0, action: { kind: 'contract-card', section: 'details', label: 'x' } });
  await ui.ctx.loadContractCardNextStep(9);
  await ui.ctx.runContractCardNextStep(9, { disabled: false });
  assert.equal(JSON.stringify(ui.calls.at(-1)), JSON.stringify(['card', 9, true]));

  ui = cardUi({ process: 'contract', tone: 'wait', title: 'Для начала работы не хватает проверок клиента', steps: [], done: 3, action: { kind: 'onboarding-client', clientId: 4, label: 'x' } });
  await ui.ctx.loadContractCardNextStep(9);
  await ui.ctx.runContractCardNextStep(9, { disabled: false });
  assert.equal(JSON.stringify(ui.calls.slice(1)), JSON.stringify(['close', 'onboarding', ['client', 4]]));
});
