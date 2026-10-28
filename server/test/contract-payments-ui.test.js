const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const IDS = ['contractPaymentsMessage', 'contractPaymentsSummary', 'contractPaymentsAdd', 'contractPaymentFile', 'contractPaymentCurrency',
  'contractPaymentAmount', 'contractPaymentDate', 'contractPaymentNumber', 'contractPaymentPayer', 'contractPaymentNote', 'contractPaymentsList'];
function ui() {
  const elements = new Map(IDS.map(id => [id, { innerHTML: '', textContent: '', hidden: false, value: '', disabled: false, files: [] }]));
  const form = { reset() { for (const id of IDS) elements.get(id).value = ''; } };
  const panel = { dataset: { engagementId: '7' }, querySelector: s => s === '.contract-payment-form' ? form : elements.get(s.slice(1)), querySelectorAll: () => [] };
  const toasts = [], engagements = [{ id: 7, paid: 0 }];
  const ctx = vm.createContext({
    document: { getElementById: id => id === 'contractPaymentsPanel' ? panel : elements.get(id) },
    engagements, renderEngagementsPage() {}, contractSigningDay: d => d.split('-').reverse().join('.'),
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    fmtCurrency: (v, c) => `${v} ${c}`, showToast: (m, c) => toasts.push([m, c]), prompt: () => '',
    contractVersionSize: () => '1 КиБ', contractVersionDate: v => v, contractTemplateRequestKey: () => 'payment-key',
    FormData: class { constructor() { this.parts = []; } append(k, v) { this.parts.push([k, v]); } },
    apiFetch: async () => { throw new Error('unexpected'); }, contractDocumentFetch: async () => { throw new Error('unexpected'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/contract-payments.js'), 'utf8'), ctx);
  return { ctx, elements, toasts, engagements };
}
const payment = (over = {}) => ({ id: 1, amount: 400.5, currency: 'KZT', paidDate: '2026-10-01', paymentNumber: '<17>', payer: 'ТОО', note: '', name: 'p.pdf', size: 10,
  recordedBy: 'RM', recordedAt: '2026-10-01', status: 'active', ...over });
const state = (over = {}) => ({ engagementId: 7, fm: false, currency: 'KZT', feeAmount: 1000, paidBefore: 0, paid: 400.5, balance: 599.5,
  payments: [payment(), payment({ id: 2, status: 'voided', voidedBy: 'CFO', voidReason: '<дубль>' })], canRecord: true, today: '2026-10-28', ...over });

test('totals, escaped payments and actions follow the server state; LP contracts point to Capital Calls', async () => {
  const { ctx, elements, engagements } = ui();
  ctx.apiFetch = async () => state();
  await ctx.loadContractPayments(7);
  assert.match(elements.get('contractPaymentsSummary').innerHTML, /Оплачено<\/small><strong class="paid">400\.5 KZT/);
  assert.match(elements.get('contractPaymentsSummary').innerHTML, /Остаток<\/small><strong class="due">599\.5 KZT/);
  const list = elements.get('contractPaymentsList').innerHTML;
  assert.match(list, /№ &lt;17&gt;/); assert.match(list, /Аннулированные \(1\)/); assert.match(list, /&lt;дубль&gt;/);
  assert.equal((list.match(/voidContractPayment/g) || []).length, 1, 'only an active payment can be voided');
  assert.equal(elements.get('contractPaymentsAdd').hidden, false); assert.equal(elements.get('contractPaymentDate').max, '2026-10-28');
  assert.equal(engagements[0].paid, 400.5);

  ctx.apiFetch = async () => state({ canRecord: false });
  await ctx.loadContractPayments(7);
  assert.equal(elements.get('contractPaymentsAdd').hidden, true); assert.ok(!elements.get('contractPaymentsList').innerHTML.includes('voidContractPayment'));
  ctx.apiFetch = async () => state({ fm: true, balance: null, payments: [], canRecord: false });
  await ctx.loadContractPayments(7);
  assert.match(elements.get('contractPaymentsSummary').innerHTML, /Capital Calls/);
});

test('the form checks amount, date and number before sending and keeps one key for a retry', async () => {
  const { ctx, elements, toasts } = ui();
  ctx.apiFetch = async () => state({ payments: [] });
  await ctx.loadContractPayments(7);
  const set = values => { for (const [id, value] of Object.entries(values)) elements.get(id).value = value; };
  elements.get('contractPaymentFile').files = [{ name: 'order.pdf', size: 100, lastModified: 1 }];
  for (const [values, message] of [[{ contractPaymentAmount: '0', contractPaymentDate: '2026-10-01', contractPaymentNumber: '1' }, /больше нуля/],
    [{ contractPaymentAmount: '1,234' }, /больше нуля/], [{ contractPaymentAmount: '1 500,5', contractPaymentDate: '2026-12-01' }, /не позже/],
    [{ contractPaymentDate: '2026-10-01', contractPaymentNumber: '' }, /номер платёжки/]]) {
    set(values); await ctx.recordContractPayment(7);
    assert.match(elements.get('contractPaymentsMessage').textContent, message);
  }
  set({ contractPaymentNumber: '17' });
  const sent = [];
  ctx.contractDocumentFetch = async (url, options) => { sent.push(options.body.parts); throw new Error('Сеть недоступна'); };
  await ctx.recordContractPayment(7); await ctx.recordContractPayment(7);
  assert.equal(sent.length, 2); assert.deepEqual(sent[0].find(p => p[0] === 'requestKey'), sent[1].find(p => p[0] === 'requestKey'));
  assert.equal(sent[0].find(p => p[0] === 'amount')[1], '1 500,5');
  assert.match(elements.get('contractPaymentsMessage').textContent, /Сеть недоступна/);
  assert.equal(elements.get('contractPaymentAmount').value, '1 500,5', 'a failed save keeps what was typed');
  ctx.contractDocumentFetch = async () => ({ json: async () => state({ paid: 1500.5, balance: -500.5 }) });
  await ctx.recordContractPayment(7);
  assert.match(toasts.at(-1)[0], /Оплата 1500\.5 KZT внесена\. Оплачено всего: 1500\.5 KZT/);
  assert.equal(elements.get('contractPaymentAmount').value, '', 'a saved payment clears the form');
});
