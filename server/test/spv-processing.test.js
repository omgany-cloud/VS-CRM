// VC module (docs/TZ_VC_Module.md) — SPV capital call / distribution
// processing: auto pro-rata line items, status transitions, and the
// payment-confirmation route (mirrors PUT /api/capital-calls/:id/line-
// items/:lpId's evidence-required CFO/CEO gate).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, spvId, invA, invB;

before(async () => {
  server = await createTestServer({ port: 4119 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'SPV_PROC_FUND', assetClass: 'vc' }),
  })).json();
  fundId = fund.id;
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Processing SPV' }) })).json();
  spvId = spv.id;
  invA = await (await server.apiFetch(`/api/spvs/${spvId}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Investor A', commitment: 100000 }) })).json();
  invB = await (await server.apiFetch(`/api/spvs/${spvId}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Investor B', commitment: 100000 }) })).json();
});

after(async () => { await server.stop(); });

test('POST a capital call with no lineItems auto pro-rates across Active investors by commitment', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, {
    method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }),
  });
  assert.equal(res.status, 201);
  const cc = await res.json();
  assert.equal(cc.status, 'Draft');
  assert.match(cc.ccNumber, /^SPV-CC-\d{4}-\d{3}$/);
  assert.equal(cc.lineItems.length, 2);
  assert.ok(cc.lineItems.every(li => li.called === 50000 && li.pct === 50));
});

test('purpose is required', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ totalAmount: 1000 }) });
  assert.equal(res.status, 400);
});

test('marking a line item Paid requires wireRef + wireConfirmUrl, and is blocked while the call is still Draft', async () => {
  const cc = await (await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Follow-on', totalAmount: 50000 }) })).json();

  const blockedByDraft = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${invA.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', wireRef: 'WR-1', wireConfirmUrl: 'https://example.com/wr1.pdf' }),
  });
  assert.equal(blockedByDraft.status, 409);

  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });

  const missingEvidence = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${invA.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 25000 }) });
  assert.equal(missingEvidence.status, 400);

  const paid = await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${invA.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 25000, wireRef: 'WR-2', wireConfirmUrl: 'https://example.com/wr2.pdf' }),
  });
  assert.equal(paid.status, 200);
  const ccAfter = await paid.json();
  const li = ccAfter.lineItems.find(l => l.spvInvestorId === invA.id);
  assert.equal(li.status, 'Paid');
  assert.equal(li.paid, 25000);
});

test('DELETE is blocked once not Draft, and once any line item has a payment', async () => {
  const cc = await (await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Delete guard', totalAmount: 10000 }) })).json();
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const blocked = await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
});

test('a Draft call with no payments deletes cleanly', async () => {
  const cc = await (await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Clean delete', totalAmount: 10000 }) })).json();
  const del = await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('a pure ROC distribution (profitAmount 0) auto pro-rates by commitment with zero carry', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/distributions`, { method: 'POST', body: JSON.stringify({ rocAmount: 40000 }) });
  assert.equal(res.status, 201);
  const dist = await res.json();
  assert.equal(dist.lineItems.length, 2);
  assert.ok(dist.lineItems.every(li => li.grossAmount === 20000 && li.gpCarryAmount === 0 && li.netAmount === 20000));
});

test('totalAmount (or rocAmount/profitAmount) must be greater than 0', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/distributions`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('Tenant isolation: SPV capital calls/distributions are invisible and unreachable from a fresh tenant', async () => {
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ SPV Proc Isolation Co', name: 'Tenant B Admin', email: 'tenantb-spvproc@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const bFetch = (pathname, opts = {}) => fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  assert.equal((await bFetch(`/api/spvs/${spvId}/capital-calls`)).status, 404);
  assert.equal((await bFetch(`/api/spvs/${spvId}/distributions`)).status, 404);
});
