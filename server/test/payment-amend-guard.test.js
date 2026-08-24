// Regression coverage for the "amend a confirmed payment while staying
// Paid" gap (QA Data Integrity audit, 2026-08-24): PUT .../line-items/:id
// only gated evidence (paymentConfirm permission + reason) on a status
// CHANGE — confirming (-> Paid) or reversing (Paid ->). Silently editing
// the paid amount/wireRef/wireConfirmUrl/paymentDate of an ALREADY-Paid
// line item (status left as Paid, or omitted) fell through both gates
// untouched. Covers both the fund-level route and the SPV mirror.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, lpId, analystToken;

before(async () => {
  server = await createTestServer({ port: 4135 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'AMENDGUARD_FUND' }) })).json();
  fundId = fund.id;
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'AMENDGUARD_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 100000, status: 'Active', registerId: 'AG-1' }),
  })).json();
  lpId = lp.id;

  await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email: 'amendguard-analyst@example.com', password: 'TempPass123!', role: 'ANALYST', name: 'Amendguard Analyst' }) });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'amendguard-analyst@example.com', password: 'TempPass123!' }),
  });
  analystToken = (await loginRes.json()).token;
  const pwChangeRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ currentPassword: 'TempPass123!', newPassword: 'AnalystPass456!' }),
  });
  analystToken = (await pwChangeRes.json()).token;
});

after(async () => { await server.stop(); });

async function createPaidLineItem() {
  const cc = await (await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId, purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const paid = await server.apiFetch(`/api/capital-calls/${cc.id}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, wireRef: 'WR-AMEND-1', wireConfirmUrl: 'https://example.com/wr.pdf' }),
  });
  assert.equal(paid.status, 200);
  return cc.id;
}

test('changing paid amount while staying Paid is rejected without paymentConfirm (403)', async () => {
  const ccId = await createPaidLineItem();
  const res = await fetch(server.baseUrl + `/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ paid: 999, reason: 'sneaky' }),
  });
  assert.equal(res.status, 403);
});

test('changing wireRef while staying Paid, with paymentConfirm but no reason, is rejected (400)', async () => {
  const ccId = await createPaidLineItem();
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ wireRef: 'WR-CHANGED' }),
  });
  assert.equal(res.status, 400);
});

test('amending a confirmed payment with paymentConfirm + reason succeeds and is audited', async () => {
  const ccId = await createPaidLineItem();
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ paid: 95000, reason: 'partial refund, correcting the reconciled amount' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  const li = body.lineItems.find(l => l.lpId === lpId);
  assert.equal(li.paid, 95000);

  const log = await (await server.apiFetch(`/api/audit-log?entityType=capital_calls&entityId=${ccId}`)).json();
  const amend = log.entries.find(e => e.action === 'payment_amended');
  assert.ok(amend, 'expected a payment_amended audit entry');
  assert.match(amend.summary, /partial refund/);
});

test('sending the same paid value again (no real change) does not require evidence', async () => {
  const ccId = await createPaidLineItem();
  const res = await server.apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
    method: 'PUT', body: JSON.stringify({ paid: 100000 }),
  });
  assert.equal(res.status, 200, 'resending the identical value must not be treated as an amendment');
});

test('SPV: amending a confirmed payment without evidence is rejected (403)', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Amendguard SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Amendguard Investor', commitment: 100000 }) })).json();
  const cc = await (await server.apiFetch(`/api/spvs/${spv.id}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, wireRef: 'WR-SPV-AMEND', wireConfirmUrl: 'https://example.com/spv.pdf' }),
  });

  const forbidden = await fetch(server.baseUrl + `/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + analystToken },
    body: JSON.stringify({ paid: 1, reason: 'sneaky' }),
  });
  assert.equal(forbidden.status, 403);

  const ok = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ paid: 90000, reason: 'correction' }),
  });
  assert.equal(ok.status, 200);
});
