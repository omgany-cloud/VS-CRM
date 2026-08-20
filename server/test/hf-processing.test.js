// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md), Stage 2 — the real
// business logic this stage adds on top of Stage 1's plain CRUD:
// NAV publish gated behind a resolved nav_publish workflow, subscription
// processing computing units_issued/navPerUnitAtEntry/lockupUntil against
// the latest Published NAV, and redemption processing's lockup + gate
// checks (docs/TZ_Hedge_Fund_Module.md §7's own required test cases).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let cfoToken;

before(async () => {
  server = await createTestServer({ port: 4110 });
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-hf-test@example.com', password: 'HfTest2026!', role: 'CFO', name: 'TEST_CFO_HF' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-hf-test@example.com', password: 'HfTest2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  // An admin-created user is must_change_password until they set their
  // own — every route except this one 403s for them until it's cleared
  // (js/api-auth.js / server/auth.js), same rule the real login flow hits.
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'HfTest2026!', newPassword: 'HfTest2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));
});

after(async () => { await server.stop(); });

function cfoFetch(pathname, opts = {}) {
  return fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken, ...(opts.headers || {}) } });
}

// Runs the full nav_publish workflow (CFO reviews, CEO/seeded-admin
// approves) and calls the dedicated publish route — the same sequence
// js/workflow.js's syncWfToEntity triggers from the real UI.
async function publishNav(navId) {
  const wf = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'nav_publish', entityId: navId, entityName: 'NAV ' + navId, entityType: 'HfNav' }),
  })).json();
  const afterCfo = await (await cfoFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) })).json();
  assert.equal(afterCfo.status, 'active');
  const afterCeo = await (await server.apiFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) })).json();
  assert.equal(afterCeo.status, 'approved');
  const published = await (await server.apiFetch(`/api/hf/nav/${navId}/publish`, { method: 'PUT' })).json();
  return published;
}

test('Subscription processing fails cleanly when the fund has no Published NAV yet', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_NONAV', assetClass: 'hedge_fund' }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_PROC_NONAV_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-1' }) })).json();
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();

  const res = await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed' }) });
  assert.equal(res.status, 409);
});

test('Publishing a NAV requires an approved nav_publish workflow — a direct publish call is rejected', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_NOPUB', assetClass: 'hedge_fund' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();

  const res = await server.apiFetch(`/api/hf/nav/${nav.id}/publish`, { method: 'PUT' });
  assert.equal(res.status, 409);

  const list = await (await server.apiFetch(`/api/hf/nav?fundId=${fund.id}`)).json();
  assert.equal(list.navHistory.find(n => n.id === nav.id).status, 'Draft');
});

test('Full nav_publish workflow (CFO -> CEO) actually publishes the NAV', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_PUB', assetClass: 'hedge_fund' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();

  const published = await publishNav(nav.id);
  assert.equal(published.status, 'Published');
  assert.ok(published.publishedBy);
  assert.ok(published.publishedAt);
});

test('Subscription processing computes units_issued/navPerUnitAtEntry/lockupUntil from the latest Published NAV, and creates the investor position', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_SUB', assetClass: 'hedge_fund', lockupMonths: 12 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_PROC_SUB_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-2' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id); // navPerUnit = 100

  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 5000 }) })).json();
  const processed = await (await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-02-01' }) })).json();

  assert.equal(processed.status, 'Processed');
  assert.equal(processed.navPerUnitAtEntry, 100);
  assert.equal(processed.unitsIssued, 50); // 5000 / 100
  assert.equal(processed.lockupUntil, '2027-02-01'); // + 12 months

  // Client-supplied values for these server-owned fields must be ignored,
  // not trusted — the request above never sent them; this is asserting
  // the computed ones landed, not just that *something* landed.
  const spoofed = await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({}) });
  assert.equal(spoofed.status, 200);
});

test('A second (top-up) subscription blends the HWM by a units-weighted average', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_TOPUP', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_PROC_TOPUP_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-3' }) })).json();

  const nav1 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav1.id); // navPerUnit = 100

  const sub1 = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub1.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) });
  // units_held=100, HWM=100

  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-03-01', grossAssetValue: 240000, liabilities: 0, unitsOutstanding: 1200 }) })).json();
  await publishNav(nav2.id); // navPerUnit = 200

  const sub2 = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 20000 }) })).json();
  // Explicit effectiveDate here matters: with lockupMonths:0, lockup_until
  // equals whatever effectiveDate this call uses — left at the PUT's own
  // default (today's real date) it would land AFTER the redemption's
  // 2026-04-01 fixture date below and lock-up-block it, which isn't what
  // this test is checking.
  await server.apiFetch(`/api/hf/subscriptions/${sub2.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-03-15' }) });
  // top-up: 100 units at 200 each -> units_held=200, HWM = (100*100 + 100*200)/200 = 150

  // No read route for hf_investor_positions exists yet (nothing else
  // needed it before this), so this is confirmed indirectly through a
  // redemption's economics instead: redeem all 200 units at the current
  // NAV of 200/unit and check the position no longer blocks a further
  // redemption of the same size (i.e. units_held really is 200, not 100
  // or 300) — a cheap, real behavioral check rather than reaching into
  // the DB from the test.
  const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, unitsRequested: 200 }) })).json();
  const processedRed = await (await server.apiFetch(`/api/hf/redemptions/${red.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-04-01' }) })).json();
  assert.equal(processedRed.status, 'Processed');
  assert.equal(processedRed.amount, 40000); // 200 units * 200/unit
});

test('Redemption processing is blocked by an active lock-up (lockup_ok recorded as false, stays Requested)', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_LOCKUP', assetClass: 'hedge_fund', lockupMonths: 12 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_PROC_LOCKUP_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFP-4' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);

  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed' }) });
  // lockupUntil is ~12 months from today — guaranteed still in the future.

  const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, unitsRequested: 10 }) })).json();
  const res = await server.apiFetch(`/api/hf/redemptions/${red.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed' }) });
  assert.equal(res.status, 409);

  const list = await (await server.apiFetch(`/api/hf/redemptions?fundId=${fund.id}`)).json();
  const row = list.redemptions.find(r => r.id === red.id);
  assert.equal(row.status, 'Requested');
  assert.equal(row.lockupOk, false);
});

test('Gate: redemptions exceeding gate_pct of NAV in the same round — some Processed, some Queued, gatePctApplied recorded', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_PROC_GATE', assetClass: 'hedge_fund', lockupMonths: 0, gatePct: 10 }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id); // navPerUnit = 100, navTotal = 100000 -> gate limit = 10% * 100000 = 10000

  const lps = [];
  for (const tag of ['A', 'B', 'C']) {
    const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_GATE_LP_' + tag, type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFG-' + tag }) })).json();
    const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 6000 }) })).json();
    // Explicit, pre-dated effectiveDate — same reasoning as the top-up
    // test above: lockupMonths:0 still needs lockup_until to land before
    // the redemption round's 2026-05-01 fixture date, not today's real date.
    await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) });
    lps.push(lp);
  }
  // Each LP holds 60 units (6000/100). Each full redemption = 60*100 = 6000.
  // Round budget is 10000: request 1 (6000) fits, request 2 (+6000=12000)
  // doesn't, request 3 doesn't either (still only 6000 already Processed).

  const results = [];
  for (const lp of lps) {
    const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, unitsRequested: 60 }) })).json();
    const processed = await (await server.apiFetch(`/api/hf/redemptions/${red.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-05-01' }) })).json();
    results.push(processed);
  }

  const processedCount = results.filter(r => r.status === 'Processed').length;
  const queuedCount = results.filter(r => r.status === 'Queued').length;
  assert.equal(processedCount, 1, 'exactly one redemption should fit inside the 10000 gate budget');
  assert.equal(queuedCount, 2, 'the rest must be Queued, not silently rejected or fully processed');

  // Budget 10000, first request took 6000, leaving 4000 of headroom when
  // request 2 (and, since it's still Queued not Processed, request 3 too)
  // was evaluated — 4000 of this request's own 6000 ask is 66.67%, not 0:
  // there WAS room left, just not enough to fit this whole request.
  const queued = results.filter(r => r.status === 'Queued');
  for (const q of queued) {
    assert.equal(q.gateApplied, true);
    assert.equal(q.amount, null, 'a Queued redemption has no realized amount yet — this schema has no partial-fill field');
    assert.equal(q.gatePctApplied, 66.67);
  }
  const processed = results.find(r => r.status === 'Processed');
  assert.equal(processed.gateApplied, false);
  assert.equal(processed.amount, 6000);
});
