// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 5 — LP-portal
// (lp-portal.html) hedge fund routes: position/subscription/redemption
// reads, and the two request-submission writes. Same identity-space
// isolation rules as the rest of the LP portal (lp-portal.test.js):
// everything scoped to req.portalLp, never a client-supplied id.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let cfoToken;
let fund, lp, lpToken;

before(async () => {
  server = await createTestServer({ port: 4116 });
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-hflpportal-test@example.com', password: 'HfLpPortal2026!', role: 'CFO', name: 'TEST_CFO_HFLPPORTAL' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-hflpportal-test@example.com', password: 'HfLpPortal2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'HfLpPortal2026!', newPassword: 'HfLpPortal2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));

  fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_LPPORTAL_FUND', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_LPPORTAL_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFLPP-1', email: 'hflpportal@example.com' }) })).json();

  const { password } = await (await server.apiFetch(`/api/lp/${lp.id}/portal-password`, { method: 'PUT' })).json();
  const lpLogin = await (await fetch(server.baseUrl + '/api/portal/lp/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hflpportal@example.com', password }),
  })).json();
  lpToken = lpLogin.token;
});

after(async () => { await server.stop(); });

function lpFetch(pathname, opts = {}) {
  return fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lpToken, ...(opts.headers || {}) } });
}

async function publishNav(navId) {
  const wf = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'nav_publish', entityId: navId, entityName: 'NAV ' + navId, entityType: 'HfNav' }),
  })).json();
  const cfoFetch = (p, o = {}) => fetch(server.baseUrl + p, { ...o, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken, ...(o.headers || {}) } });
  await cfoFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  await server.apiFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  return (await server.apiFetch(`/api/hf/nav/${navId}/publish`, { method: 'PUT' })).json();
}

test('LP portal: an LP with no position sees position: null', async () => {
  const res = await lpFetch('/api/portal/lp/hf-position');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.position, null);
});

test('LP portal: submitting a subscription request creates a real Pending row under the LP\'s own identity, visible in both the internal and portal views', async () => {
  const res = await lpFetch('/api/portal/lp/hf-subscription-request', { method: 'POST', body: JSON.stringify({ amount: 15000, notes: 'test note' }) });
  assert.equal(res.status, 201);
  const sub = await res.json();
  assert.equal(sub.status, 'Pending');
  assert.equal(sub.amount, 15000);
  assert.match(sub.subNumber, /^SUB-\d{4}-\d{3}$/);

  // Visible via the internal staff view...
  const internalList = await (await server.apiFetch(`/api/hf/subscriptions?fundId=${fund.id}`)).json();
  assert.ok(internalList.subscriptions.some((s) => s.id === sub.id && s.lpId === lp.id));

  // ...and via the LP's own portal history.
  const portalList = await (await lpFetch('/api/portal/lp/hf-subscriptions')).json();
  assert.ok(portalList.subscriptions.some((s) => s.id === sub.id));

  // Staff processes it through the existing internal Stage 2 machinery,
  // completely unchanged by this portal request existing.
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);
  const processed = await (await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) })).json();
  assert.equal(processed.status, 'Processed');
  assert.equal(processed.unitsIssued, 150); // 15000 / 100
});

test('LP portal: submitting a redemption request creates a real Requested row with a computed noticeExpires', async () => {
  const res = await lpFetch('/api/portal/lp/hf-redemption-request', { method: 'POST', body: JSON.stringify({ unitsRequested: 50 }) });
  assert.equal(res.status, 201);
  const red = await res.json();
  assert.equal(red.status, 'Requested');
  assert.equal(red.unitsRequested, 50);
  assert.ok(red.noticeExpires);

  const portalList = await (await lpFetch('/api/portal/lp/hf-redemptions')).json();
  assert.ok(portalList.redemptions.some((r) => r.id === red.id));
});

test('LP portal: an amount/unitsRequested of 0 or missing is rejected, same validation as the internal routes', async () => {
  const badSub = await lpFetch('/api/portal/lp/hf-subscription-request', { method: 'POST', body: JSON.stringify({ amount: 0 }) });
  assert.equal(badSub.status, 400);
  const badRed = await lpFetch('/api/portal/lp/hf-redemption-request', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(badRed.status, 400);
});

test('LP portal: an LP cannot see another LP\'s position or subscription history', async () => {
  const lp2 = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_LPPORTAL_LP2', type: 'x', lpType: 'Institution', country: 'x', commitment: 50000, status: 'Active', registerId: 'HFLPP-2', email: 'hflpportal2@example.com' }) })).json();
  const sub2 = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp2.id, amount: 5000 }) })).json();

  const portalList = await (await lpFetch('/api/portal/lp/hf-subscriptions')).json();
  assert.ok(!portalList.subscriptions.some((s) => s.id === sub2.id), 'LP1\'s portal token must not see LP2\'s subscription');
});

test('LP portal: a subscription request cannot be forged onto another LP or fund via the request body', async () => {
  const lp2 = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_LPPORTAL_LP3', type: 'x', lpType: 'Institution', country: 'x', commitment: 50000, status: 'Active', registerId: 'HFLPP-3' }) })).json();
  const res = await lpFetch('/api/portal/lp/hf-subscription-request', { method: 'POST', body: JSON.stringify({ amount: 1000, lpId: lp2.id, fundId: 999999 }) });
  assert.equal(res.status, 201);
  const sub = await res.json();
  assert.equal(sub.lpId, lp.id, 'lpId is always the authenticated portal LP, never trusted from the body');
  assert.equal(sub.fundId, fund.id, 'fundId is always the authenticated LP\'s own fund, never trusted from the body');
});

test('An internal user token cannot authenticate against the LP portal identity space', async () => {
  const res = await fetch(server.baseUrl + '/api/portal/lp/hf-position', {
    headers: { Authorization: 'Bearer ' + cfoToken },
  });
  assert.equal(res.status, 401);
});
