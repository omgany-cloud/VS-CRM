const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const IDS = ['contractSigningMessage', 'contractSigningStatus', 'contractSigningForm', 'contractSigningFile', 'contractSigningDate',
  'contractSigningHint', 'contractSigningSubmit', 'contractSigningVoid', 'contractSigningVoidReason', 'contractSigningConditions', 'contractSigningHistory',
  'contractCounterparty', 'contractCounterpartyTitle', 'contractCounterpartyCurrent', 'contractCounterpartyForm', 'contractCounterpartyResult',
  'contractCounterpartyNoteLabel', 'contractCounterpartyNote', 'contractCounterpartySubmit', 'contractCounterpartyHistory'];
function ui() {
  const elements = new Map(IDS.map(id => [id, { innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, files: [], dataset: {} }]));
  const panel = { dataset: { engagementId: '7' }, querySelector: s => elements.get(s.slice(1)),
    querySelectorAll: () => ['contractSigningFile', 'contractSigningDate', 'contractSigningSubmit'].map(id => elements.get(id)) };
  const calls = [], toasts = [];
  const engagements = [{ id: 7, status: 'Draft', signedDate: null }];
  const ctx = vm.createContext({
    document: { getElementById: id => id === 'contractSigningPanel' ? ctx.panel : elements.get(id) }, panel,
    engagements, activeEngId: null, engEditMode: false, openEngagementModal() {}, renderEngagementsPage() {},
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    statusLabel: s => s, currentUserPermission: key => key === 'manageContracts', showToast: (m, c) => toasts.push([m, c]), confirm: () => true,
    contractVersionSize: () => '1 КиБ', contractVersionDate: v => v, contractTemplateRequestKey: () => 'key-' + calls.length,
    FormData: class { constructor() { this.parts = []; } append(k, v) { this.parts.push([k, v]); } },
    apiFetch: async () => { throw new Error('unexpected'); }, contractDocumentFetch: async () => { throw new Error('unexpected'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/contract-signing.js'), 'utf8'), ctx);
  return { ctx, elements, calls, toasts, engagements };
}
function state(overrides = {}) {
  return { engagementId: 7, serviceStatus: 'Draft', approvalStatus: 'approved', today: '2026-10-28',
    approvedVersion: { id: 3, version: 2, name: 'v2.pdf', cycleId: 11 }, signature: null, voided: [], activation: null,
    readiness: { ready: false, conditions: [
      { key: 'signature', label: 'Подписанный договор', state: 'pending', detail: 'Подписанный PDF не зарегистрирован' },
      { key: 'kyc', label: 'KYC / AML одобрен (задача 2.2)', state: 'done', detail: 'Заключение: одобрить' },
      { key: 'conflict', label: 'Проверка конфликта интересов (задача 1.1)', state: 'rejected', detail: '<No-Go>' }] },
    canRegister: true, canVoid: false, canActivate: false, ...overrides };
}

test('panel shows the next step, escapes server text and offers only allowed actions', async () => {
  const { ctx, elements, engagements } = ui();
  ctx.apiFetch = async () => state();
  await ctx.loadContractSigning(7);
  assert.match(elements.get('contractSigningStatus').innerHTML, /ожидает подписания \(редакция 2\)/);
  assert.equal(elements.get('contractSigningForm').hidden, false); assert.equal(elements.get('contractSigningVoid').hidden, true);
  assert.equal(elements.get('contractSigningDate').max, '2026-10-28');
  const conditions = elements.get('contractSigningConditions').innerHTML;
  assert.match(conditions, /&lt;No-Go&gt;/); assert.ok(!conditions.includes('<No-Go>'));
  assert.match(conditions, /станет доступно/); assert.ok(!conditions.includes('activateContractWork'));
  assert.equal(elements.get('contractCounterparty').hidden, true, 'a client contract has no counterparty decision');

  const signed = { id: 5, version: 2, signedDate: '2026-10-20', name: '<signed>.pdf', size: 10, recordedBy: 'RM', recordedAt: 'now' };
  ctx.apiFetch = async () => state({ signature: signed, canRegister: false, canVoid: true, canActivate: true,
    voided: [{ ...signed, id: 4, voidedBy: 'RM', voidedAt: 'then', voidReason: '<wrong file>' }] });
  await ctx.loadContractSigning(7);
  assert.equal(elements.get('contractSigningForm').hidden, true); assert.equal(elements.get('contractSigningVoid').hidden, false);
  assert.match(elements.get('contractSigningStatus').innerHTML, /&lt;signed&gt;\.pdf/);
  assert.match(elements.get('contractSigningConditions').innerHTML, /activateContractWork\(7\)/);
  assert.match(elements.get('contractSigningHistory').innerHTML, /&lt;wrong file&gt;/);
  assert.equal(engagements[0].signedDate, '2026-10-20');
});

test('registration validates locally and a retried upload reuses its request key', async () => {
  const { ctx, elements, calls, toasts } = ui();
  ctx.apiFetch = async () => state();
  await ctx.loadContractSigning(7);
  const file = { name: 'signed.pdf', size: 100, lastModified: 1 };
  elements.get('contractSigningFile').files = [file];
  elements.get('contractSigningDate').value = '2026-10-29';
  ctx.registerContractSignature(7);
  assert.match(elements.get('contractSigningMessage').textContent, /позже сегодняшнего/);

  elements.get('contractSigningDate').value = '2026-10-20';
  ctx.contractDocumentFetch = async (url, options) => { calls.push([url, options.body.parts]); throw new Error('Сеть недоступна'); };
  await ctx.registerContractSignature(7);
  assert.equal(elements.get('contractSigningMessage').textContent, 'Сеть недоступна');
  assert.equal(elements.get('contractSigningMessage').className, 'contract-message-error');
  ctx.contractDocumentFetch = async (url, options) => { calls.push([url, options.body.parts]); return { json: async () => state({ canRegister: false }) }; };
  await ctx.registerContractSignature(7);
  assert.equal(calls.length, 2);
  const [first, second] = calls.map(([, parts]) => Object.fromEntries(parts.filter(([k]) => k !== 'file')));
  assert.equal(calls[0][0], '/api/engagements/7/signatures');
  assert.deepEqual(first, { signedDate: '2026-10-20', expectedCycleId: '11', requestKey: first.requestKey });
  assert.equal(second.requestKey, first.requestKey);
  assert.ok(toasts.some(([m]) => /зарегистрировано/.test(m)));
});

test('a late response for a closed panel is ignored', async () => {
  const { ctx, elements } = ui();
  let finish; ctx.apiFetch = () => new Promise(resolve => { finish = resolve; });
  const pending = ctx.loadContractSigning(7);
  ctx.panel = { dataset: { engagementId: '8' } };
  finish(state()); await pending;
  assert.equal(elements.get('contractSigningStatus').innerHTML, '');
});

test('a supplier contract shows its ADATA check; the decider records it and a retry reuses the request key', async () => {
  const { ctx, elements, toasts } = ui();
  const party = { kind: 'supplier', check: 'screening', label: 'Проверка поставщика (ADATA)', who: 'COO или Legal', current: null, history: [], canDecide: true,
    results: [{ value: 'approved', label: 'Проверен в ADATA' }, { value: 'not_required', label: 'Проверка не требуется' }, { value: 'rejected', label: 'Отказ' }] };
  ctx.apiFetch = async () => state({ counterparty: party });
  await ctx.loadContractSigning(7);
  assert.equal(elements.get('contractCounterparty').hidden, false);
  assert.equal(elements.get('contractCounterpartyTitle').textContent, 'Проверка поставщика (ADATA)');
  assert.match(elements.get('contractCounterpartyCurrent').innerHTML, /Проверка ещё не записана\. Проверяют: COO или Legal/);
  assert.equal(elements.get('contractCounterpartyForm').hidden, false);
  assert.match(elements.get('contractCounterpartyResult').innerHTML, /value="not_required"/);

  elements.get('contractCounterpartyResult').value = 'not_required';
  ctx.recordCounterpartyDecision(7);
  assert.match(elements.get('contractSigningMessage').textContent, /опишите проверку/);
  elements.get('contractCounterpartyNote').value = '<Разовая закупка>';
  const posts = [];
  const decided = { ...party, current: { id: 3, resultLabel: 'Проверка не требуется', note: '<Разовая закупка>', decidedBy: 'Legal', decidedAt: 'now' } };
  ctx.apiFetch = async (url, options) => { if (!options) return state({ counterparty: party }); posts.push([url, JSON.parse(options.body)]); throw new Error('Сеть недоступна'); };
  await ctx.recordCounterpartyDecision(7);
  assert.equal(elements.get('contractSigningMessage').textContent, 'Сеть недоступна');
  ctx.apiFetch = async (url, options) => { if (!options) return state({ counterparty: decided }); posts.push([url, JSON.parse(options.body)]); return { created: true }; };
  await ctx.recordCounterpartyDecision(7);
  assert.equal(posts[0][0], '/api/engagements/7/counterparty-decisions');
  assert.deepEqual(posts[0][1], { result: 'not_required', note: '<Разовая закупка>', expectedDecisionId: 0, requestKey: posts[0][1].requestKey });
  assert.equal(posts[1][1].requestKey, posts[0][1].requestKey);
  assert.ok(toasts.some(([m]) => m === 'Решение записано'));
  assert.match(elements.get('contractCounterpartyCurrent').innerHTML, /&lt;Разовая закупка&gt;/);
  assert.equal(elements.get('contractCounterpartySubmit').textContent, 'Изменить решение');
});
