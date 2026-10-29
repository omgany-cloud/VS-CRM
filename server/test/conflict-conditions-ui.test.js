const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ui({ permissions = { decideConflicts: true }, userId = 7 } = {}) {
  const content = { innerHTML: '' }, calls = [];
  const ctx = vm.createContext({
    Intl, Date, calls, conflictApprovals: [],
    document: { getElementById: id => (id === 'obNewModalContent' ? content : null) },
    getAuth: () => ({ user: { id: userId } }),
    currentUserPermission: key => !!permissions[key],
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    apiFetch: async (url, options) => { calls.push([url, options && JSON.parse(options.body || 'null'), options?.method]); return url.endsWith('condition-assignees') ? { people: [{ id: 7, name: 'Executor' }] } : {}; },
    loadConflictApprovalsFromApi: async () => calls.push(['reload']),
    openConflictApprovalDetail: id => calls.push(['detail', id]),
    showToast: () => {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/conflict-conditions.js'), 'utf8'), ctx);
  return { ctx, content, calls };
}
const condition = (over = {}) => ({ id: 1, text: 'Барьер <b>', assigneeId: 7, assigneeName: 'Executor', dueDate: '2999-01-01', beforeStart: true, status: 'open', canComplete: true, canCancel: false, ...over });

test('the registry cell shows progress, overdue conditions and a decision without recorded conditions', () => {
  const { ctx } = ui();
  assert.match(ctx.conflictConditionsCell({ status: 'Approved with conditions', conditions: [] }), /не внесены/);
  assert.equal(ctx.conflictConditionsCell({ status: 'Approved', conditions: [] }), '—');
  const cell = ctx.conflictConditionsCell({ status: 'Approved with conditions', conditions: [
    condition({ status: 'done' }), condition({ id: 2, dueDate: '2000-01-01' }), condition({ id: 3, status: 'cancelled' })] });
  assert.match(cell, /1 из 2/); assert.match(cell, /просрочено 1/);
  assert.equal(ctx.myOpenConflictConditions([{ conditions: [condition(), condition({ id: 2, assigneeId: 8 }), condition({ id: 3, status: 'done' })] }]), 1);
});

test('the decision card lists conditions with the actions this user may take', () => {
  const executor = ui({ permissions: {} });
  const html = executor.ctx.conflictConditionsPanel({ id: 5, status: 'Approved with conditions', conditions: [condition(), condition({ id: 2, status: 'done', closedAt: '2026-10-29T10:00:00Z', closedByName: 'Executor', closeNote: 'Сделано' })] });
  assert.match(html, /Барьер &lt;b&gt;/); assert.doesNotMatch(html, /Барьер <b>/);
  assert.match(html, /showConflictConditionClose\(5,1,'done'\)/); assert.doesNotMatch(html, /'cancel'/);
  assert.match(html, /Выполнено 29\.10\.2026 · Executor: Сделано/);
  assert.doesNotMatch(html, /Добавить условие/, 'only a decider adds conditions');
  const decider = ui();
  assert.match(decider.ctx.conflictConditionsPanel({ id: 5, status: 'Approved with conditions', conditions: [] }), /Условия не внесены[\s\S]*Добавить условие/);
  assert.equal(decider.ctx.conflictConditionsPanel({ id: 6, status: 'Approved', conditions: [] }), '');
});

test('the decision form refuses incomplete conditions and sends the decision together with them', async () => {
  const { ctx, content, calls } = ui();
  const rows = () => vm.runInContext('conflictConditionsForm.rows', ctx);
  await ctx.showConflictConditionsForm(5, 'decide');
  assert.match(content.innerHTML, /Зафиксировать решение с условиями/); assert.match(content.innerHTML, /Executor/);
  const status = { textContent: '' }, button = { disabled: false };
  const form = { querySelector: s => (s.includes('status') ? status : button) };
  rows()[0].text = 'Раскрыть конфликт';
  await ctx.submitConflictConditions(form);
  assert.match(status.textContent, /Условие 1: укажите/); assert.equal(calls.length, 1, 'nothing is sent');
  Object.assign(rows()[0], { assigneeId: '7', dueDate: '2999-01-01' });
  await ctx.submitConflictConditions(form);
  const [url, body, method] = calls[1];
  assert.deepEqual([url, method, body.status], ['/api/conflict-approvals/5', 'PUT', 'Approved with conditions']);
  assert.deepEqual(JSON.parse(JSON.stringify(body.conditions)), [{ text: 'Раскрыть конфликт', assigneeId: 7, dueDate: '2999-01-01', beforeStart: true }]);
  assert.deepEqual(calls.slice(2).map(c => c[0]), ['reload', 'detail']);

  await ctx.showConflictConditionsForm(5, 'add');
  Object.assign(rows()[0], { text: 'Ещё одно', assigneeId: '7', dueDate: '2999-02-01', beforeStart: false });
  button.disabled = false;
  await ctx.submitConflictConditions(form);
  assert.deepEqual(calls.at(-3).slice(0, 1).concat(calls.at(-3)[2]), ['/api/conflict-approvals/5/conditions', 'POST']);
});
