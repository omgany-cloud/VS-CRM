// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 5 read views:
// GET /api/funds/:id/hf-metrics (dashboard KPIs) and
// GET /api/lp/:id/hf-position (LP position summary, shared logic with
// the LP-portal equivalent — see hf-lp-portal.test.js for that one).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let cfoToken;

before(async () => {
  server = await createTestServer({ port: 4115 });
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-hfmetrics-test@example.com', password: 'HfMetrics2026!', role: 'CFO', name: 'TEST_CFO_HFMETRICS' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-hfmetrics-test@example.com', password: 'HfMetrics2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'HfMetrics2026!', newPassword: 'HfMetrics2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));
});

after(async () => { await server.stop(); });

function cfoFetch(pathname, opts = {}) {
  return fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken, ...(opts.headers || {}) } });
}

async function publishNav(navId) {
  const wf = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'nav_publish', entityId: navId, entityName: 'NAV ' + navId, entityType: 'HfNav' }),
  })).json();
  await cfoFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  await server.apiFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  return (await server.apiFetch(`/api/hf/nav/${navId}/publish`, { method: 'PUT' })).json();
}

test('hf-metrics: no Published NAV yet returns all-null, not a 500 or fabricated 0', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_METRICS_EMPTY', assetClass: 'hedge_fund' }) })).json();
  const res = await server.apiFetch(`/api/funds/${fund.id}/hf-metrics`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.aum, null);
  assert.equal(body.navPerUnit, null);
  assert.equal(body.sinceInceptionReturn, null);
});

test('hf-metrics: sinceInceptionReturn compares the latest NAV against the very first Published NAV', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_METRICS_INCEPTION', assetClass: 'hedge_fund' }) })).json();
  const nav1 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2025-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav1.id); // navPerUnit = 100 (inception)
  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 121000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id); // navPerUnit = 121 -> since-inception +21%

  const body = await (await server.apiFetch(`/api/funds/${fund.id}/hf-metrics`)).json();
  assert.equal(body.aum, 121000);
  assert.equal(body.navPerUnit, 121);
  assert.ok(Math.abs(body.sinceInceptionReturn - 0.21) < 0.0001);
});

test('hf-position: an LP with no position returns null, not a 404 or crash', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_POS_NONE', assetClass: 'hedge_fund' }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_POS_NONE_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-NONE' }) })).json();
  const res = await server.apiFetch(`/api/lp/${lp.id}/hf-position`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.position, null);
});

test('hf-position: real position reports units/currentValue/hwm/feesPaidToDate/unrealizedGain from an honest weighted-average cost basis', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_POS_REAL', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_POS_REAL_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-REAL' }) })).json();
  const nav1 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav1.id); // navPerUnit = 100
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) });
  // 100 units at avg cost 100/unit.

  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-02-01', grossAssetValue: 130000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id); // navPerUnit = 130

  const body = await (await server.apiFetch(`/api/lp/${lp.id}/hf-position`)).json();
  assert.equal(body.position.unitsHeld, 100);
  assert.equal(body.position.navPerUnit, 130);
  assert.equal(body.position.currentValue, 13000); // 100 * 130
  assert.equal(body.position.hwm, 100); // never crystallized yet -> still the entry price
  assert.equal(body.position.feesPaidToDate, 0);
  assert.equal(body.position.unrealizedGain, 3000); // 13000 current - 10000 cost basis (100 units @ avg cost 100)
});
