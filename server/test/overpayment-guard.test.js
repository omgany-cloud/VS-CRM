// Regression coverage for the overpayment-guard fix (QA Data Integrity
// audit, 2026-08-21): PUT .../line-items/:id never validated `paid`
// against the line item's own `called` amount — a negative, non-numeric,
// or simply too-large value would be written as-is, silently corrupting
// the reconciliation the table exists for. Covers both the fund-level
// capital-calls route and the SPV-level mirror.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, lpId;

before(async () => {
  server = await createTestServer({ port: 4128 }); // 4124-4127 are dynamically claimed by account-lockout.test.js
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'OVERPAY_FUND' }) })).json();
  fundId = fund.id;
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'OVERPAY_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 100000, status: 'Active', registerId: 'OP-1' }),
  })).json();
  lpId = lp.id;
});

after(async () => { await server.stop(); });

async function createPendingCall(totalAmount) {
  const cc = await (await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId, purpose: 'Investment', totalAmount }) })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  return cc.id;
}

test('paid exceeding the called amount is rejected (400)', async () => {
  const ccId = await createPendingCall(100000);
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 150000, wireRef: 'WR-OP-1', wireConfirmUrl: 'https://example.com/op1.pdf' }),
  });
  assert.equal(res.status, 400);
});

test('a negative paid amount is rejected (400)', async () => {
  const ccId = await createPendingCall(100000);
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ paid: -100 }),
  });
  assert.equal(res.status, 400);
});

test('a non-numeric paid value is rejected (400)', async () => {
  const ccId = await createPendingCall(100000);
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ paid: 'not-a-number' }),
  });
  assert.equal(res.status, 400);
});

test('paid exactly equal to the called amount is accepted (boundary case)', async () => {
  const ccId = await createPendingCall(100000);
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, wireRef: 'WR-OP-2', wireConfirmUrl: 'https://example.com/op2.pdf' }),
  });
  assert.equal(res.status, 200);
});

test('SPV: paid exceeding the called amount is rejected (400)', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Overpay SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Overpay Investor', commitment: 100000 }) })).json();
  const cc = await (await server.apiFetch(`/api/spvs/${spv.id}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });

  const res = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 999999, wireRef: 'WR-SPV-OP', wireConfirmUrl: 'https://example.com/spvop.pdf' }),
  });
  assert.equal(res.status, 400);
});
