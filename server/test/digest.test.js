// Coverage for server/notifications/digestChecks.js (Stage 2) — one
// fixture per check, run through the real POST /api/notifications/run-digest
// route (the same entry point ops would use) rather than importing the
// check functions directly, so this exercises the actual wiring in
// scheduler.js's DIGEST_CHECKS array too, not just the check logic in
// isolation. Also verifies the 'daily' scope: unlike Stage 1's 'once'
// scope, a still-true condition (e.g. still-overdue payment) is allowed
// to re-fire once per calendar day, but a second run on the SAME day must
// not duplicate it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server;
let roDb;
let fundId, coEmail;

function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

before(async () => {
  server = await createTestServer({ port: 4101, extraEnv: { SMTP_HOST: '' } });
  roDb = new DatabaseSync(server.dbPath, { readOnly: true });

  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_DIGEST_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  })).json();
  fundId = fund.id;

  // COMPLIANCE_OFFICER has amlClear + afsaSubmit + decideConflicts —
  // covers the KYC-renewal, AFSA-deadline, conflict-pending and
  // document-expiry checks. The Capital Call overdue check uses
  // ccApprove, which only CEO/CFO hold — the seeded admin (CEO) covers
  // that one instead.
  coEmail = 'co-digest-test@example.com';
  await server.apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: coEmail, password: 'DigestTest2026!', role: 'COMPLIANCE_OFFICER', name: 'TEST_CO_DIGEST' }),
  });
});

after(async () => {
  roDb.close();
  await server.stop();
});

function notificationRows(eventType, entityId) {
  return roDb.prepare('SELECT * FROM notification_log WHERE event_type = ? AND entity_id = ?').all(eventType, entityId);
}

test('Digest: all 5 checks fire for their respective fixtures, and a same-day re-run does not duplicate them', async () => {
  // 1. KYC renewal due
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_KYC_DUE', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 500, status: 'Active', registerId: 'T-DIGEST-1', kycNextReview: today() }),
  })).json();

  // 2. Capital Call payment overdue — cc.status must be 'Pending' (sent),
  // matching the frontend's own isOverdue definition, so approve it.
  const lp2 = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_CC_OVERDUE', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 500, status: 'Active', registerId: 'T-DIGEST-2' }),
  })).json();
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST',
    body: JSON.stringify({ fundId, purpose: 'digest overdue test', lineItems: [{ lpId: lp2.id, commitment: 500, pct: 100, called: 500, paymentDate: '2020-01-01' }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  // rowToLineItem() (server/index.js) never exposes the line item's own
  // row id over the API (only lpId/lpName/...), so the id the digest check
  // actually keys notification_log on has to come from the DB directly.
  const overdueItem = roDb.prepare('SELECT id FROM capital_call_line_items WHERE call_id = ? AND lp_id = ?').get(cc.id, lp2.id);

  // 3. AFSA regulator deadline approaching
  const afsa = await (await server.apiFetch('/api/afsa-reports', {
    method: 'POST',
    body: JSON.stringify({ reportType: 'TEST_AFSA_REPORT', period: 'Q1 2026', deadline: today() }),
  })).json();

  // 4. Conflict decision pending (Low risk stays 'Pending', doesn't escalate)
  const conflict = await (await server.apiFetch('/api/conflict-approvals', {
    method: 'POST',
    body: JSON.stringify({ decisionType: 'Routine Conflict', riskLevel: 'Low', description: 'digest test' }),
  })).json();

  // 5. Document expiry approaching
  const client = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_OBCLIENT_DOC_EXPIRY', direction: 'FM' }),
  })).json();
  await server.apiFetch(`/api/ob-clients/${client.id}`, { method: 'PUT', body: JSON.stringify({ idDocumentExpiry: today() }) });

  const run1 = await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(run1.status, 200);

  // amlClear (KYC renewal, document expiry): CO/MLRO only, not CEO.
  assert.deepEqual(notificationRows('kyc_renewal_due', lp.id).map((r) => r.recipient_email), [coEmail]);
  assert.deepEqual(notificationRows('document_expiry_approaching', client.id).map((r) => r.recipient_email), [coEmail]);
  // ccApprove (Capital Call overdue): CEO/CFO only, not CO.
  assert.deepEqual(notificationRows('capital_call_payment_overdue', overdueItem.id).map((r) => r.recipient_email), [SEED_EMAIL]);
  // afsaSubmit / decideConflicts: both CEO and CO hold these (rolesSeed.js).
  assert.deepEqual(notificationRows('afsa_deadline_approaching', afsa.id).map((r) => r.recipient_email).sort(), [SEED_EMAIL, coEmail].sort());
  assert.deepEqual(notificationRows('conflict_decision_pending', conflict.id).map((r) => r.recipient_email).sort(), [SEED_EMAIL, coEmail].sort());

  // Same-day re-run: the underlying conditions are all still true (none of
  // this fixture data was resolved), but scope:'daily' must not duplicate
  // today's rows — this is the actual dedup guarantee, not just "no error".
  const run2 = await server.apiFetch('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(run2.status, 200);
  assert.equal(notificationRows('kyc_renewal_due', lp.id).length, 1);
  assert.equal(notificationRows('capital_call_payment_overdue', overdueItem.id).length, 1);
  assert.equal(notificationRows('afsa_deadline_approaching', afsa.id).length, 2);
  assert.equal(notificationRows('conflict_decision_pending', conflict.id).length, 2);
  assert.equal(notificationRows('document_expiry_approaching', client.id).length, 1);
});

test('Digest: run-digest is gated behind manageUsers (CEO), not open to every internal user', async () => {
  const rmEmail = 'rm-digest-test@example.com';
  const tempPassword = 'DigestTest2026!';
  await server.apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: rmEmail, password: tempPassword, role: 'RELATIONSHIP_MANAGER', name: 'TEST_RM_DIGEST' }),
  });
  let login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rmEmail, password: tempPassword }),
  })).json();
  const asRm = (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) },
  });

  // Clear mustChangePassword first — a fresh account is 403'd for THAT
  // reason on every route (see must-change-password.test.js), which would
  // otherwise mask whether the manageUsers permission gate itself works.
  await asRm('/api/users/me/password', {
    method: 'PUT', body: JSON.stringify({ currentPassword: tempPassword, newPassword: 'MyOwnPassword789!' }),
  });
  login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rmEmail, password: 'MyOwnPassword789!' }),
  })).json();

  const res = await asRm('/api/notifications/run-digest', { method: 'POST' });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.notEqual(body.code, 'MUST_CHANGE_PASSWORD', 'must be rejected by the permission gate, not the password-change gate');
});
