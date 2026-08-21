// VC module (docs/TZ_VC_Module.md) — plain CRUD coverage for spvs/
// spv_investors. No capital-call/distribution processing here (that's
// spv-processing.test.js) — this file only proves the CRUD shell and
// delete guards.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4118 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'SPV_TEST_FUND', assetClass: 'vc' }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('POST creates an SPV defaulting to status Forming', async () => {
  const res = await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Falcon SPV' }) });
  assert.equal(res.status, 201);
  const spv = await res.json();
  assert.equal(spv.status, 'Forming');
  assert.equal(spv.carriedInterestPct, 20); // schema default
});

test('name and fundId are required', async () => {
  assert.equal((await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId }) })).status, 400);
  assert.equal((await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ name: 'No Fund SPV' }) })).status, 400);
});

test('GET list includes investorCount/totalCommitment; GET :id nests investors/capitalCalls/distributions', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Nested SPV' }) })).json();
  await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'External Angel', investorType: 'External', commitment: 100000 }) });

  const list = await (await server.apiFetch('/api/spvs')).json();
  const row = list.spvs.find(s => s.id === spv.id);
  assert.equal(row.investorCount, 1);
  assert.equal(row.totalCommitment, 100000);

  const detail = await (await server.apiFetch(`/api/spvs/${spv.id}`)).json();
  assert.equal(detail.investors.length, 1);
  assert.deepEqual(detail.capitalCalls, []);
  assert.deepEqual(detail.distributions, []);
});

test('PUT updates SPV fields', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project PUT SPV' }) })).json();
  const updated = await (await server.apiFetch(`/api/spvs/${spv.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Open', carriedInterestPct: 15 }) })).json();
  assert.equal(updated.status, 'Open');
  assert.equal(updated.carriedInterestPct, 15);
});

test('investors: an external co-investor needs no lpId; PUT updates fields; DELETE succeeds when clean', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Investor SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, {
    method: 'POST', body: JSON.stringify({ name: 'Founder Co-invest', investorType: 'Founder', commitment: 50000 }),
  })).json();
  assert.equal(inv.lpId, null);

  const updated = await (await server.apiFetch(`/api/spv-investors/${inv.id}`, { method: 'PUT', body: JSON.stringify({ commitment: 75000, kycStatus: 'Cleared' }) })).json();
  assert.equal(updated.commitment, 75000);
  assert.equal(updated.kycStatus, 'Cleared');

  const del = await server.apiFetch(`/api/spv-investors/${inv.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('investor name is required', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Validation SPV' }) })).json();
  const res = await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ commitment: 1000 }) });
  assert.equal(res.status, 400);
});

test('delete guards: an investor with a capital call line item cannot be deleted; an SPV with any capital call cannot be deleted', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Guard SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, {
    method: 'POST', body: JSON.stringify({ name: 'Guard Investor', commitment: 100000 }),
  })).json();
  const call = await (await server.apiFetch(`/api/spvs/${spv.id}/capital-calls`, {
    method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }),
  })).json();
  assert.equal(call.lineItems.length, 1);

  const delInv = await server.apiFetch(`/api/spv-investors/${inv.id}`, { method: 'DELETE' });
  assert.equal(delInv.status, 409);
  const delSpv = await server.apiFetch(`/api/spvs/${spv.id}`, { method: 'DELETE' });
  assert.equal(delSpv.status, 409);
});

test('a clean SPV (no capital calls) deletes successfully, along with its investors', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Project Clean SPV' }) })).json();
  await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Clean Investor', commitment: 1000 }) });
  const del = await server.apiFetch(`/api/spvs/${spv.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await server.apiFetch(`/api/spvs/${spv.id}`)).status, 404);
});

test('Tenant isolation: SPVs and investors are invisible and unreachable from a fresh tenant', async () => {
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ SPV Isolation Co', name: 'Tenant B Admin', email: 'tenantb-spv@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const bFetch = (pathname, opts = {}) => fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'Isolation SPV' }) })).json();
  const inv = await (await server.apiFetch(`/api/spvs/${spv.id}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Isolation Investor', commitment: 1000 }) })).json();

  const bList = await (await bFetch('/api/spvs')).json();
  assert.ok(!bList.spvs.some(s => s.id === spv.id));
  assert.equal((await bFetch(`/api/spvs/${spv.id}`)).status, 404);
  assert.equal((await bFetch(`/api/spv-investors/${inv.id}`, { method: 'DELETE' })).status, 404);
});
