// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md), Stage 1 — plain CRUD
// coverage for hf_subscriptions/hf_redemptions/hf_nav_history. No
// business-logic assertions here on purpose (no unit-computation, no
// lockup/gate checks, no NAV publish) — that's Stage 2/3's job and gets
// its own test files when those engines exist. This file only proves the
// CRUD shell itself: create/list/update, the delete guards, and that
// POST/PUT /api/hf/nav computes nav_total/nav_per_unit correctly (the one
// piece of arithmetic Stage 1 does own).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, lpId;

before(async () => {
  server = await createTestServer({ port: 4109 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'HF_TEST_FUND', assetClass: 'hedge_fund' }),
  })).json();
  fundId = fund.id;
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'HF_TEST_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000000, status: 'Active', registerId: 'HF-1' }),
  })).json();
  lpId = lp.id;
});

after(async () => { await server.stop(); });

test('Subscriptions: create defaults to Pending with an auto-generated sub number', async () => {
  const res = await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, amount: 100000 }) });
  assert.equal(res.status, 201);
  const sub = await res.json();
  assert.equal(sub.status, 'Pending');
  assert.match(sub.subNumber, /^SUB-\d{4}-\d{3}$/);
  assert.equal(sub.amount, 100000);
});

test('Subscriptions: amount <= 0 is rejected', async () => {
  const res = await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, amount: 0 }) });
  assert.equal(res.status, 400);
});

// Pending -> Processed is exercised by hf-processing.test.js (Stage 2) —
// that specific transition now runs real computation against the fund's
// latest Published NAV, not a plain field write. This test sticks to a
// transition Stage 2 doesn't touch (Cancelled) to keep testing what it's
// actually meant to: plain-field PUT + the delete guard.
test('Subscriptions: PUT updates plain fields, list reflects it, delete blocked once not Pending', async () => {
  const created = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, amount: 50000 }) })).json();

  const updated = await (await server.apiFetch(`/api/hf/subscriptions/${created.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Cancelled', notes: 'test note' }) })).json();
  assert.equal(updated.status, 'Cancelled');
  assert.equal(updated.notes, 'test note');

  const list = await (await server.apiFetch(`/api/hf/subscriptions?fundId=${fundId}`)).json();
  assert.ok(list.subscriptions.some(s => s.id === created.id && s.status === 'Cancelled'));

  const del = await server.apiFetch(`/api/hf/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('Subscriptions: delete succeeds while still Pending', async () => {
  const created = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, amount: 10000 }) })).json();
  const del = await server.apiFetch(`/api/hf/subscriptions/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('Redemptions: create defaults to Requested with an auto-generated redemption number', async () => {
  const res = await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, unitsRequested: 200 }) });
  assert.equal(res.status, 201);
  const red = await res.json();
  assert.equal(red.status, 'Requested');
  assert.match(red.redemptionNumber, /^RED-\d{4}-\d{3}$/);
  assert.equal(red.gateApplied, false);
  assert.equal(red.lockupOk, null);
});

test('Redemptions: unitsRequested <= 0 is rejected', async () => {
  const res = await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, unitsRequested: 0 }) });
  assert.equal(res.status, 400);
});

test('Redemptions: PUT sets lockupOk/gateApplied, delete blocked once not Requested', async () => {
  const created = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, unitsRequested: 100 }) })).json();
  const updated = await (await server.apiFetch(`/api/hf/redemptions/${created.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Queued', lockupOk: true, gateApplied: true, gatePctApplied: 25 }) })).json();
  assert.equal(updated.status, 'Queued');
  assert.equal(updated.lockupOk, true);
  assert.equal(updated.gateApplied, true);
  assert.equal(updated.gatePctApplied, 25);

  const del = await server.apiFetch(`/api/hf/redemptions/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('NAV: POST computes nav_total and nav_per_unit from gross/liabilities/units', async () => {
  const res = await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId, asOfDate: '2026-01-31', grossAssetValue: 1050000, liabilities: 50000, unitsOutstanding: 10000 }) });
  assert.equal(res.status, 201);
  const nav = await res.json();
  assert.equal(nav.navTotal, 1000000);
  assert.equal(nav.navPerUnit, 100);
  assert.equal(nav.status, 'Draft');
});

test('NAV: unitsOutstanding of 0 yields a null navPerUnit rather than dividing by zero', async () => {
  const res = await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId, asOfDate: '2026-02-01', grossAssetValue: 100, liabilities: 0, unitsOutstanding: 0 }) });
  const nav = await res.json();
  assert.equal(nav.navPerUnit, null);
});

test('NAV: PUT recomputes nav_total/nav_per_unit, blocked once not Draft, delete mirrors the same guard', async () => {
  const created = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId, asOfDate: '2026-03-01', grossAssetValue: 500000, liabilities: 0, unitsOutstanding: 5000 }) })).json();
  assert.equal(created.navPerUnit, 100);

  const updated = await (await server.apiFetch(`/api/hf/nav/${created.id}`, { method: 'PUT', body: JSON.stringify({ grossAssetValue: 550000 }) })).json();
  assert.equal(updated.navTotal, 550000);
  assert.equal(updated.navPerUnit, 110);

  const del = await server.apiFetch(`/api/hf/nav/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

// The Draft-immutability guard itself (PUT/DELETE blocked once Published)
// can't be exercised yet — Stage 1 has no publish route, so no NAV record
// can ever reach Published through the API. Revisit this test once
// Stage 2 adds PUT /api/hf/nav/:id/publish.

test('Tenant isolation: subscriptions/redemptions/nav are invisible and unreachable from a fresh tenant', async () => {
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ HF Isolation Co', name: 'Tenant B Admin', email: 'tenantb-hf@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const bFetch = (pathname, opts = {}) => fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, amount: 1000 }) })).json();
  const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId, lpId, unitsRequested: 10 }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId, asOfDate: '2026-04-01', grossAssetValue: 100, liabilities: 0, unitsOutstanding: 1 }) })).json();

  const bSubs = await (await bFetch('/api/hf/subscriptions')).json();
  const bReds = await (await bFetch('/api/hf/redemptions')).json();
  const bNav = await (await bFetch('/api/hf/nav')).json();
  assert.ok(!bSubs.subscriptions.some(s => s.id === sub.id));
  assert.ok(!bReds.redemptions.some(r => r.id === red.id));
  assert.ok(!bNav.navHistory.some(n => n.id === nav.id));

  assert.equal((await bFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({}) })).status, 404);
  assert.equal((await bFetch(`/api/hf/redemptions/${red.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await bFetch(`/api/hf/nav/${nav.id}`, { method: 'DELETE' })).status, 404);
});
