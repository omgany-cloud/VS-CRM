// Regression coverage for the payment-reversal gate fix (QA Data
// Integrity audit, 2026-08-21): PUT .../line-items/:id used to let
// ANY accessFM user silently revert an already-Paid line item back to
// Pending with no evidence and no trace, since the paymentConfirm +
// wireRef/wireConfirmUrl gate only ever fired on the transition INTO
// Paid, never out of it. Covers both the fund-level capital-calls route
// and the SPV-level mirror.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, lpId, analystToken;

before(async () => {
  server = await createTestServer({ port: 4122 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'PAYREV_FUND' }) })).json();
  fundId = fund.id;
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'PAYREV_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 100000, status: 'Active', registerId: 'PR-1' }),
  })).json();
  lpId = lp.id;

  // A low-permission user (ANALYST: paymentConfirm=false) to prove the
  // reversal gate actually rejects someone without the right.
  await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email: 'payrev-analyst@example.com', password: 'TempPass123!', role: 'ANALYST', name: 'Payrev Analyst' }) });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'payrev-analyst@example.com', password: 'TempPass123!' }),
  });
  analystToken = (await loginRes.json()).token;
  // Clear the mustChangePassword gate so this token can actually call
  // the routes under test (it's exempt on GET /api/auth/me and the
  // self password-change route only).
  await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ currentPassword: 'TempPass123!', newPassword: 'AnalystPass456!' }),
  });
});

after(async () => { await server.stop(); });

async function createPaidLineItem() {
  const cc = await (await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId, purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const paid = await server.apiFetch(`/api/capital-calls/${cc.id}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, wireRef: 'WR-PAYREV-1', wireConfirmUrl: 'https://example.com/wr.pdf' }),
  });
  assert.equal(paid.status, 200);
  return cc.id;
}

test('reversing a Paid line item without paymentConfirm is rejected (403)', async () => {
  const ccId = await createPaidLineItem();
  const res = await fetch(server.baseUrl + `/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ status: 'Pending', reason: 'test' }),
  });
  assert.equal(res.status, 403);
});

test('reversing a Paid line item with paymentConfirm but no reason is rejected (400)', async () => {
  const ccId = await createPaidLineItem();
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Pending' }),
  });
  assert.equal(res.status, 400);
});

test('reversing with paymentConfirm + reason succeeds and is recorded in the audit log', async () => {
  const ccId = await createPaidLineItem();
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Pending', reason: 'Wire bounced, funds never actually arrived' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const li = body.lineItems.find(l => l.lpId === lpId);
  assert.equal(li.status, 'Pending');

  const log = await (await server.apiFetch(`/api/audit-log?entityType=capital_calls&entityId=${ccId}`)).json();
  const reversal = log.entries.find(e => e.action === 'payment_reversed');
  assert.ok(reversal, 'expected a payment_reversed audit entry');
  assert.match(reversal.summary, /Wire bounced/);
});

test('confirming a payment still works and is also recorded in the audit log', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId, purpose: 'Investment', totalAmount: 50000 }) })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 50000, wireRef: 'WR-PAYREV-2', wireConfirmUrl: 'https://example.com/wr2.pdf' }),
  });
  assert.equal(res.status, 200);
  const log = await (await server.apiFetch(`/api/audit-log?entityType=capital_calls&entityId=${cc.id}`)).json();
  assert.ok(log.entries.some(e => e.action === 'payment_confirmed'));
});

test('SPV capital call: reversing a Paid line item without paymentConfirm is rejected (403)', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Payrev SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Payrev Investor', commitment: 100000 }) })).json();
  const cc = await (await server.apiFetch(`/api/spvs/${spv.id}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, wireRef: 'WR-SPV-1', wireConfirmUrl: 'https://example.com/spv.pdf' }),
  });

  const forbidden = await fetch(server.baseUrl + `/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ status: 'Pending', reason: 'test' }),
  });
  assert.equal(forbidden.status, 403);

  const missingReason = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Pending' }),
  });
  assert.equal(missingReason.status, 400);

  const ok = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Pending', reason: 'Duplicate confirmation, correcting' }),
  });
  assert.equal(ok.status, 200);
});
