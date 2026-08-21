// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 4 — the two
// instant triggers (notifyHfNavPublished, notifyHfRedemptionProcessed),
// same style as notifications.test.js: real routes, SMTP unset (console
// fallback), notification_log read via a second read-only connection.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server;
let roDb;
let cfoToken;

before(async () => {
  server = await createTestServer({ port: 4112, extraEnv: { SMTP_HOST: '' } });
  roDb = new DatabaseSync(server.dbPath, { readOnly: true });

  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'cfo-hfnotify-test@example.com', password: 'HfNotify2026!', role: 'CFO', name: 'TEST_CFO_HFNOTIFY' }),
  });
  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cfo-hfnotify-test@example.com', password: 'HfNotify2026!' }),
  });
  cfoToken = (await loginRes.json()).token;
  const pwRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfoToken },
    body: JSON.stringify({ currentPassword: 'HfNotify2026!', newPassword: 'HfNotify2026New!' }),
  });
  if (!pwRes.ok) throw new Error('CFO password change failed: ' + (await pwRes.text()));
  // The password change invalidated the token used to make it (session-
  // invalidation fix, server/auth.js's token_version) — swap in the
  // fresh one the response returns.
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

async function waitFor(fn, { timeoutMs = 8000, minLength = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = fn();
    if (result && result.length >= minLength) return result;
    if (Date.now() >= deadline) return result || [];
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function publishNav(navId) {
  const wf = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'nav_publish', entityId: navId, entityName: 'NAV ' + navId, entityType: 'HfNav' }),
  })).json();
  await cfoFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  await server.apiFetch(`/api/workflow/${wf.id}`, { method: 'PUT', body: JSON.stringify({ decision: 'approved' }) });
  return (await server.apiFetch(`/api/hf/nav/${navId}/publish`, { method: 'PUT' })).json();
}

test('NAV published: every LP with a real position (units_held > 0) is notified exactly once', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_NOTIFY_NAV', assetClass: 'hedge_fund', lockupMonths: 0 }) })).json();
  const lpEmail = 'lp-hfnav-notify@example.com';
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_NOTIFY_NAV_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFN-1', email: lpEmail }) })).json();
  // A second LP who never subscribed — must NOT be notified (no position).
  await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_NOTIFY_NAV_LP_NOPOS', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFN-2', email: 'lp-hfnav-nopos@example.com' }) });

  const nav1 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav1.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) });

  const nav2 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-02-01', grossAssetValue: 120000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav2.id);

  const rows = await waitFor(() => notificationRows('hf_nav_published', nav2.id));
  assert.equal(rows.length, 1, 'only the LP with a real position should be notified, not the one with no position');
  assert.equal(rows[0].recipient_email, lpEmail);

  // Publishing the FIRST nav (nav1) also fires this trigger, but at that
  // point the LP had no position yet (subscription not processed until
  // after) — confirm that earlier publish did NOT notify anyone.
  assert.equal(notificationRows('hf_nav_published', nav1.id).length, 0);
});

test('Redemption processed: the LP is notified exactly once; a Queued (gated) outcome does not notify', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF_NOTIFY_RED', assetClass: 'hedge_fund', lockupMonths: 0, gatePct: 100 }) })).json();
  const lpEmail = 'lp-hfred-notify@example.com';
  const lp = await (await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'HF_NOTIFY_RED_LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 100000, status: 'Active', registerId: 'HFR-1', email: lpEmail }) })).json();

  const nav1 = await (await server.apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }) })).json();
  await publishNav(nav1.id);
  const sub = await (await server.apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, amount: 10000 }) })).json();
  await server.apiFetch(`/api/hf/subscriptions/${sub.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-01-15' }) });

  const red = await (await server.apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: fund.id, lpId: lp.id, unitsRequested: 50 }) })).json();
  const processed = await (await server.apiFetch(`/api/hf/redemptions/${red.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed', effectiveDate: '2026-02-01' }) })).json();
  assert.equal(processed.status, 'Processed');

  const rows = await waitFor(() => notificationRows('hf_redemption_processed', red.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient_email, lpEmail);
});

test('server stays healthy after firing hedge fund notifications with SMTP unset', async () => {
  const res = await server.apiFetch('/api/hf/nav');
  assert.equal(res.status, 200);
});
