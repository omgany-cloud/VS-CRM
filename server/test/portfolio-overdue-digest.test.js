// Regression coverage for checkPortfolioOverdue (QA Portfolio Monitoring
// audit, 2026-08-24): portAutoStatus() (js/app.js) derives a "Problem"/
// "Monitoring" badge from financials.overdueAmount/paymentSchedule
// purely client-side — nobody who hasn't personally opened that one
// company's page ever found out. This surfaces the same fact as a real
// digest notification. Deliberately does NOT touch portfolio.status
// itself (confirmed with the user) — this test only covers the new
// notification, not any status-sync behavior (there isn't any).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server;
let roDb;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4138, extraEnv: { SMTP_HOST: '' } });
  roDb = new DatabaseSync(server.dbPath, { readOnly: true });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'PORTOVERDUE_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

function notificationRows(eventType, entityId) {
  return roDb.prepare('SELECT * FROM notification_log WHERE event_type = ? AND entity_id = ?').all(eventType, entityId);
}

test('a portfolio company with an overdue payment notifies accessFM staff, once per day', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'PORTOVERDUE_CO', sector: 'Test', invested: 100, value: 100,
      financials: {
        overdueAmount: 5000,
        paymentSchedule: [{ date: '2020-01-01', status: 'Просрочен' }],
      },
    }),
  })).json();

  const run1 = await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(run1.status, 200);

  const rows1 = notificationRows('portfolio_payment_overdue', co.id);
  assert.deepEqual(rows1.map(r => r.recipient_email), [SEED_EMAIL], 'the seeded admin (CEO, accessFM=true) should be notified');

  // Same-day re-run: still overdue, but scope:'daily' must not duplicate.
  const run2 = await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(run2.status, 200);
  assert.equal(notificationRows('portfolio_payment_overdue', co.id).length, 1);
});

test('a portfolio company with no overdue amount does not notify', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'PORTOVERDUE_CLEAN_CO', sector: 'Test', invested: 100, value: 100 }),
  })).json();
  await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(notificationRows('portfolio_payment_overdue', co.id).length, 0);
});

test('an archived portfolio company with an overdue amount does not notify', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'PORTOVERDUE_ARCHIVED_CO', sector: 'Test', invested: 100, value: 100,
      financials: { overdueAmount: 999, paymentSchedule: [{ date: '2020-01-01', status: 'Просрочен' }] },
    }),
  })).json();
  await server.apiFetch(`/api/portfolio/${co.id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) });
  await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(notificationRows('portfolio_payment_overdue', co.id).length, 0);
});

test('the underlying portfolio.status field is never touched by the digest run', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'PORTOVERDUE_STATUS_CO', sector: 'Test', invested: 100, value: 100, status: 'Active',
      financials: { overdueAmount: 1234, paymentSchedule: [{ date: '2020-01-01', status: 'Просрочен' }] },
    }),
  })).json();
  await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  const fresh = await (await server.apiFetch('/api/portfolio')).json();
  const updated = fresh.portfolio.find(p => p.id === co.id);
  assert.equal(updated.status, 'Active', 'the digest check must be read-only with respect to portfolio.status');
});
