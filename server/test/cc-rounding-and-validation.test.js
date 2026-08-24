// Regression coverage for two QA Data Integrity audit findings
// (2026-08-24), fund-level and SPV mirror:
//  1. Auto pro-rated Capital Call line items left the sum of per-LP
//     `called` off `totalAmount` by a rounding remainder — the last line
//     item now absorbs the difference so the row sum reconciles exactly.
//  2. Draft -> Pending had almost no validation. Deliberately loose: only
//     rejects a totalAmount/date that is PRESENT and actually invalid
//     (negative, unparseable, or paymentDate before noticeDate) — an
//     established, widely-used pattern in this codebase creates Capital
//     Calls with no top-level totalAmount/dates at all (the real amount
//     lives in each line item's own `called`), so requiring those fields
//     outright would break that legitimate flow.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4136 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'CCROUND_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('auto pro-rata across 3 LPs with an uneven split sums exactly to totalAmount', async () => {
  const lps = [];
  for (const commitment of [333333, 333333, 333334]) {
    const lp = await (await server.apiFetch('/api/lp', {
      method: 'POST', body: JSON.stringify({ fundId, name: 'CCROUND_LP_' + commitment, type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment, status: 'Active', registerId: 'CCR-' + commitment }),
    })).json();
    lps.push(lp);
  }

  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'Rounding test', totalAmount: 100000 }),
  })).json();

  const sum = cc.lineItems.reduce((s, li) => s + li.called, 0);
  assert.equal(sum, 100000, 'the sum of per-LP called amounts must exactly equal totalAmount, not be off by a rounding remainder');
});

test('Draft -> Pending: an explicitly negative totalAmount is rejected (400)', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'Negative amount test', totalAmount: 1000 }),
  })).json();
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending', totalAmount: -500 }) });
  assert.equal(res.status, 400);
});

test('Draft -> Pending: an unparseable noticeDate is rejected (400)', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'Bad date test', totalAmount: 1000 }),
  })).json();
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending', noticeDate: 'not-a-date' }) });
  assert.equal(res.status, 400);
});

test('Draft -> Pending: paymentDate before noticeDate is rejected (400)', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'Date order test', totalAmount: 1000 }),
  })).json();
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Pending', noticeDate: '2026-06-01', paymentDate: '2026-05-01' }),
  });
  assert.equal(res.status, 400);
});

test('Draft -> Pending: the established no-totalAmount/no-dates pattern still works (backward compatible)', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'CCROUND_LP_LEGACY', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'CCR-LEGACY' }),
  })).json();
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'legacy pattern', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 5, called: 50 }] }),
  })).json();
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  assert.equal(res.status, 200, 'omitting totalAmount/dates entirely must still be accepted — this is an established pattern, not the bug being fixed');
});
