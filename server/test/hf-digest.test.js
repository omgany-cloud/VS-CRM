// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 4 — the three
// digest checks (checkHfLockupEnding, checkHfRedemptionNoticeExpiring,
// checkHfFeeCrystallizationDue), run through the real
// POST /api/notifications/run-digest route, same style as digest.test.js
// (exercises scheduler.js's DIGEST_CHECKS wiring, not just the check
// functions in isolation).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server;
let roDb;
let cfoToken;

function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function monthsAgo(months, extraDays = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(d.getDate() + extraDays);
  return d.toISOString().slice(0, 10);
}

before(async () => {
  server = await createTestServer({ port: 4114, extraEnv: { SMTP_HOST: '' } });
  roDb = new DatabaseSync(server.dbPath, { readOnly: true });

  // CFO has paymentConfirm — the gate every hedge fund digest check in
  // this file resolves recipients from; the seeded admin (CEO) also has
  // it, so both should receive each of these.
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-hfdigest-test@example.com', password: 'HfDigest2026!', role: 'CFO', name: 'TEST_CFO_HFDIGEST' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-hfdigest-test@example.com', password: 'HfDigest2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'HfDigest2026!', newPassword: 'HfDigest2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));
  // The password change invalidated the token used to make it (session-
  // invalidation fix, server/auth.js's token_version) — swap in the
  // fresh one the response returns, or every later cfoFetch() call in
  // this file would 401 instead of testing what it's meant to.
  cfoToken = (await pwRes.json()).token;
});

after(async () => {
  roDb.close();
  await server.stop();
});

function cfoFetch(pathname, opts = {}) {
  return fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken, ...(opts.headers || {}) } });
}

function notificationRows(eventType, entityId) {
  return roDb.prepare('SELECT * FROM notification_log WHERE event_type = ? AND entity_id = ?').all(eventType, entityId);
}

async function runDigest() {
  const res = await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(res.status, 200);
}

async function publishNav(navId) {
  const wf = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'nav_publish', entityId: navId, entityName: 'NAV ' + navId, entityType: 'HfNav' }),
  })).json();
  await cfoFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  await server.apiFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  return (await server.apiFetch(`/api/hf/nav/${navId}/publish`, { method: 'PUT' })).json();
}

test('Lock-up ending soon: notifies payment_confirm officers once, not a lock-up already in the past or far in the future', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_DIGEST_LOCKUP', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_DIGEST_LOCKUP_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFDL-1' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: today(-10), grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);

  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  // lockupMonths:0 -> lockup_until equals whatever effectiveDate this
  // processing call uses. today(5) lands inside the 14-day lookahead
  // window and still in the future — exactly the case that should fire.
  const processed = await (await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: today(5) }) })).json();
  assert.equal(processed.lockupUntil, today(5));

  await runDigest();
  const rows = await new Promise((resolve) => setTimeout(() => resolve(notificationRows('hf_lockup_ending', sub.id)), 300));
  const recipients = rows.map((r) => r.recipient_email).sort();
  assert.deepEqual(recipients, [SEED_EMAIL, 'cfo-hfdigest-test@example.com'].sort());

  // Same-day re-run must not duplicate (scope: 'daily').
  await runDigest();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(notificationRows('hf_lockup_ending', sub.id).length, 2, 'still exactly one row per officer after a same-day re-run');
});

test('A lock-up that already ended does not fire — nothing left to "approach"', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_DIGEST_LOCKUP_PAST', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_DIGEST_LOCKUP_PAST_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFDL-2' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: today(-30), grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: today(-5) }) });

  await runDigest();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(notificationRows('hf_lockup_ending', sub.id).length, 0);
});

test('Redemption notice period expiring (including already past) notifies officers', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_DIGEST_NOTICE', assetClass: 'hedge_fund', lockupMonths: 0, redemptionNoticeDays: 5 }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_DIGEST_NOTICE_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFDN-1' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: today(-10), grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: today(-9) }) });

  // redemptionNoticeDays:5, requestDate defaults to today -> notice_expires ~ today+5, inside the lookahead window.
  const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, unitsRequested: 10 }) })).json();
  assert.equal(red.noticeExpires, today(5));

  await runDigest();
  const rows = await new Promise((resolve) => setTimeout(() => resolve(notificationRows('hf_redemption_notice_expiring', red.id)), 300));
  const recipients = rows.map((r) => r.recipient_email).sort();
  assert.deepEqual(recipients, [SEED_EMAIL, 'cfo-hfdigest-test@example.com'].sort());
});

test('Fee crystallization due soon: notifies officers once per fund, keyed on the earliest position due date', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_DIGEST_FEE', assetClass: 'hedge_fund', lockupMonths: 0, feeCrystallizationFrequency: 'quarterly' }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_DIGEST_FEE_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFDF-1' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: today(-100), grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  // Never crystallized yet -> baseline = this subscription's own
  // effective_date. quarterly = 3 months. Entry 3 months minus 5 days ago
  // -> next due = today+5, inside the 14-day lookahead.
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: monthsAgo(3, 5) }) });

  await runDigest();
  const rows = await new Promise((resolve) => setTimeout(() => resolve(notificationRows('hf_fee_crystallization_due', fund.id)), 300));
  const recipients = rows.map((r) => r.recipient_email).sort();
  assert.deepEqual(recipients, [SEED_EMAIL, 'cfo-hfdigest-test@example.com'].sort());
});

test('Fee crystallization NOT due soon (recently crystallized) does not fire', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_DIGEST_FEE_FAR', assetClass: 'hedge_fund', lockupMonths: 0, feeCrystallizationFrequency: 'annual' }) })).json();
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_DIGEST_FEE_FAR_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFDF-2' }) })).json();
  const nav = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: today(-10), grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  // Entered 9 days ago, annual frequency -> next due is ~356 days out, well outside the lookahead window.
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: today(-9) }) });

  await runDigest();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(notificationRows('hf_fee_crystallization_due', fund.id).length, 0);
});
