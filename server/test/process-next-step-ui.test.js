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
