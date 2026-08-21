// Integration coverage for POST /api/hf/fee-crystallization/run and
// GET /api/hf/fee-crystallizations — the route wrapper around
// server/performanceFeeEngine.js (whose own pure-function correctness,
// including the mandatory drawdown/recovery case from
// docs/TZ_Hedge_Fund_Module.md §3, is covered by
// performance-fee-engine.test.js). This file checks the parts that only
// exist once real DB state is involved: reading the latest Published NAV,
// applying the result back to hf_investor_positions, the double-
// crystallization guard, and tenant isolation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let cfoToken;

before(async () => {
  server = await createTestServer({ port: 4111 });
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-fee-test@example.com', password: 'FeeTest2026!', role: 'CFO', name: 'TEST_CFO_FEE' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-fee-test@example.com', password: 'FeeTest2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'FeeTest2026!', newPassword: 'FeeTest2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));
  // The password change invalidated the token used to make it (session-
  // invalidation fix, server/auth.js's token_version) — swap in the
  // fresh one the response returns.
  cfoToken = (await pwRes.json()).token;
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

async function makeFundLpAndProcessedSubscription(fundName, lpName, { amount, navGross, navUnits, effectiveDate, asOfDate }) {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: fundName, assetClass: 'hedge_fund', lockupMonths: 0, performanceFeePct: 20 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: lpName, type: 'x', lpType: 'Institution', country: 'x', commitment: 1000000, status: 'Active', registerId: fundName + '-LP' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate, grossAssetValue: navGross, liabilities: 0, unitsOutstanding: navUnits }) })).json();
  await publishNav(nav.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate }) });
  return { fund, lp };
}

test('Running crystallization with no Published NAV for the fund fails cleanly', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_FEE_NONAV', assetClass: 'hedge_fund' }) })).json();
  const res = await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) });
  assert.equal(res.status, 409);
});

test('A position with real gain above its HWM gets charged fee, and its units_held/HWM update for next time', async () => {
  // Entry NAV 100 (unitsOutstanding 1000, gross 100000) -> 100 units for
  // a 10000 subscription. Publish a second NAV at 120 and crystallize.
  const { fund, lp } = await makeFundLpAndProcessedSubscription('HF_FEE_GAIN', 'HF_FEE_GAIN_LP', {
    amount: 10000, navGross: 100000, navUnits: 1000, effectiveDate: '2026-01-15', asOfDate: '2026-01-01',
  });
  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-06-01', grossAssetValue: 132000, liabilities: 0, unitsOutstanding: 1100 }) })).json();
  await publishNav(nav2.id); // navPerUnit = 132000/1100 = 120

  const run = await (await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) })).json();
  assert.equal(run.crystallizations.length, 1);
  const c = run.crystallizations[0];
  assert.equal(c.lpId, lp.id);
  assert.equal(c.hwmBefore, 100);
  assert.equal(c.hwmAfter, 120);
  assert.equal(c.gainPerUnit, 20);
  // 20% * 20/unit * 100 units = 400
  assert.equal(c.feeAmount, 400);
  assert.equal(c.unitsDeductedForFee, 400 / 120);

  const list = await (await server.apiFetch(`/api/hf/fee-crystallizations?fundId=${fund.id}`)).json();
  assert.equal(list.feeCrystallizations.length, 1);
});

test('Running crystallization again against the SAME Published NAV is a safe no-op (double-crystallization guard)', async () => {
  const { fund } = await makeFundLpAndProcessedSubscription('HF_FEE_NOOP', 'HF_FEE_NOOP_LP', {
    amount: 10000, navGross: 100000, navUnits: 1000, effectiveDate: '2026-01-15', asOfDate: '2026-01-01',
  });
  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-06-01', grossAssetValue: 120000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id);

  const run1 = await (await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) })).json();
  assert.equal(run1.crystallizations.length, 1);

  const run2 = await (await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) })).json();
  assert.equal(run2.crystallizations.length, 0, 're-running against the same NAV date must not charge a second fee');

  const list = await (await server.apiFetch(`/api/hf/fee-crystallizations?fundId=${fund.id}`)).json();
  assert.equal(list.feeCrystallizations.length, 1, 'still exactly one record after the no-op re-run');
});

test('A position still in drawdown (NAV below its HWM) is recorded with zero fee, not skipped silently', async () => {
  const { fund, lp } = await makeFundLpAndProcessedSubscription('HF_FEE_DRAW', 'HF_FEE_DRAW_LP', {
    amount: 10000, navGross: 100000, navUnits: 1000, effectiveDate: '2026-01-15', asOfDate: '2026-01-01',
  });
  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-06-01', grossAssetValue: 90000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id); // navPerUnit = 90, below the 100 entry HWM

  const run = await (await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) })).json();
  assert.equal(run.crystallizations.length, 1);
  const c = run.crystallizations[0];
  assert.equal(c.lpId, lp.id);
  assert.equal(c.feeAmount, 0);
  assert.equal(c.hwmAfter, 100, 'a drawdown must never lower the recorded HWM');
});

test('Tenant isolation: fee crystallizations are invisible and the run route unreachable from a fresh tenant', async () => {
  const { fund } = await makeFundLpAndProcessedSubscription('HF_FEE_ISO', 'HF_FEE_ISO_LP', {
    amount: 10000, navGross: 100000, navUnits: 1000, effectiveDate: '2026-01-15', asOfDate: '2026-01-01',
  });
  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-06-01', grossAssetValue: 120000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id);
  await cfoFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) });

  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ HF Fee Isolation Co', name: 'Tenant B Admin', email: 'tenantb-fee@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const bFetch = (pathname, opts = {}) => fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  const bList = await (await bFetch('/api/hf/fee-crystallizations')).json();
  assert.equal(bList.feeCrystallizations.length, 0);

  // Tenant B has no such fund at all — the route must 404, not leak
  // tenant A's fund/positions to a numeric id guess.
  const bRun = await bFetch('/api/hf/fee-crystallization/run', { method: 'POST', body: JSON.stringify({ fundId: fund.id }) });
  assert.equal(bRun.status, 404);
});
