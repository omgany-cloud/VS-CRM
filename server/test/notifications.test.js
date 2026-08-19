// Coverage for server/notifications/* against the TZ's own acceptance
// criteria: (1) the same event never notifies the same recipient twice —
// verified via notification_log itself, not just "no error was thrown";
// (2) SMTP left unset never crashes the server or blocks the triggering
// request — it just logs to the console and still records the attempt.
//
// notification_log is server-side DB state with no read API of its own
// (by design — it's an internal dedup ledger, not a feature), so this file
// opens a second, read-only node:sqlite connection straight at the test
// server's SQLite file (WAL mode already lets db.js's own connection and
// this one coexist) rather than adding a test-only endpoint just to peek
// at it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server;
let roDb;
let fundId, lpId, lpEmail, coEmail;

before(async () => {
  // SMTP_HOST explicitly cleared (not just "unset in this shell") so the
  // console-fallback path in mailer.js is deterministic regardless of
  // whatever a developer's own .env happens to have.
  server = await createTestServer({ port: 4100, extraEnv: { SMTP_HOST: '' } });
  roDb = new DatabaseSync(server.dbPath, { readOnly: true });

  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_NOTIFY_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  })).json();
  fundId = fund.id;

  lpEmail = 'lp-notify-test@example.com';
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_NOTIFY', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-NOTIFY-1', email: lpEmail }),
  })).json();
  lpId = lp.id;

  // A real COMPLIANCE_OFFICER user so the kyc_lp workflow's step-0
  // assignment notification has someone to actually resolve to — the
  // seeded admin is CEO, which only sits at step 2 of that chain.
  coEmail = 'co-notify-test@example.com';
  await server.apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: coEmail, password: 'NotifyTest2026!', role: 'COMPLIANCE_OFFICER', name: 'TEST_CO_NOTIFY' }),
  });
});

after(async () => {
  roDb.close();
  await server.stop();
});

function notificationRows(eventType, entityId) {
  return roDb.prepare('SELECT * FROM notification_log WHERE event_type = ? AND entity_id = ?').all(eventType, entityId);
}

// The route fires notifyCapitalCallCreated/notifyWorkflowStepAssigned
// fire-and-forget, after its own response is already sent — poll briefly
// rather than assuming any fixed delay is enough on a loaded machine.
// minLength matters, not just "any row yet": notifyCapitalCallCreated()
// writes the LP's row and the officer's row via two sequential awaits in
// the same call, so under enough contention the first row alone can be
// visible for a while before the second one lands — stopping at length
// >= 1 would then race a genuine second write, not a real absence of one.
async function waitFor(fn, { timeoutMs = 8000, minLength = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = fn();
    if (result && result.length >= minLength) return result;
    if (Date.now() >= deadline) return result || [];
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('Capital Call: Draft->Pending notifies the LP and cc_approve officers exactly once each, logged in notification_log', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST',
    body: JSON.stringify({ fundId, purpose: 'notify test', lineItems: [{ lpId, commitment: 1000, pct: 100, called: 1000 }] }),
  })).json();
  assert.equal(cc.status, 'Draft');

  const putRes = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  assert.equal(putRes.status, 200);

  const rows = await waitFor(() => notificationRows('capital_call_created', cc.id), { minLength: 2 });
  const recipients = rows.map((r) => r.recipient_email).sort();
  // The LP (real email set above) + the seeded CEO admin (has ccApprove) —
  // the COMPLIANCE_OFFICER test user created in before() does NOT have
  // ccApprove, so it must not appear here.
  assert.deepEqual(recipients, [lpEmail, SEED_EMAIL].sort());

  // Re-sending the same status is a no-op at the application layer (the
  // Draft->Pending guard only fires once, on the actual transition) — this
  // is the real-world shape of "same event, don't double-notify."
  const putAgain = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  assert.equal(putAgain.status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(notificationRows('capital_call_created', cc.id).length, 2, 'no duplicate rows after a repeat PUT');

  // SMTP was left unset for this whole test run — the fact that these rows
  // exist at all (not just that no error was thrown) proves the
  // console-fallback path in mailer.js still completes the full
  // notifyOnce() flow (dedup-check, "send", log) instead of silently
  // skipping it.
});

test('Capital Call: server stays healthy after firing notifications with SMTP unset', async () => {
  const res = await server.apiFetch('/api/capital-calls');
  assert.equal(res.status, 200);
});

test('Workflow: step-0 assignment notifies once; a duplicate POST for the same entity does not re-notify', async () => {
  const first = await (await server.apiFetch('/api/workflow', {
    method: 'POST',
    body: JSON.stringify({ type: 'kyc_lp', entityId: lpId, entityName: 'TEST_LP_NOTIFY', entityType: 'lp' }),
  })).json();
  assert.equal(first.status, 'active');
  assert.equal(first.currentStep, 0);

  const rows = await waitFor(() => notificationRows('workflow_step_assigned:0', first.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient_email, coEmail);

  // Same type+entityId again — POST /api/workflow's own dedup returns the
  // existing active instance (200, not 201) without creating a new one, so
  // notifyWorkflowStepAssigned never runs a second time for it.
  const secondRes = await server.apiFetch('/api/workflow', {
    method: 'POST',
    body: JSON.stringify({ type: 'kyc_lp', entityId: lpId, entityName: 'TEST_LP_NOTIFY', entityType: 'lp' }),
  });
  assert.equal(secondRes.status, 200);
  const second = await secondRes.json();
  assert.equal(second.id, first.id);

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(notificationRows('workflow_step_assigned:0', first.id).length, 1, 'no duplicate rows after a repeat POST');
});
