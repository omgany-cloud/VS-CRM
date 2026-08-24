// Regression coverage for 2 real RBAC gaps found in the QA audit
// (2026-08-24):
//  1. GET /api/uploads/meta had no requirePermission at all — any internal
//     user, including RM (the only internal role without accessFM — the
//     CF&A-side role), could query file metadata for FM-only documents
//     (deals/portfolio/capital calls) in bypass of the Chinese Wall.
//  2. POST /api/workflow/:id/withdraw had no ownership check — any
//     internal user could withdraw ANY workflow instance, not just their
//     own submitted requests.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4133 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'RBACGAP_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

// Creates an internal user with the given role, logs in, clears the
// mandatory temp-password gate, and returns a ready-to-use apiFetch.
async function loginAsRole(role, email, tempPassword, newPassword) {
  const createRes = await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ name: 'RBACGAP_' + role, email, role, password: tempPassword }),
  });
  assert.equal(createRes.status, 201);

  const loginRes = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: tempPassword }),
  });
  assert.equal(loginRes.status, 200);
  const tempToken = (await loginRes.json()).token;

  const changeRes = await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tempToken },
    body: JSON.stringify({ currentPassword: tempPassword, newPassword }),
  });
  assert.equal(changeRes.status, 200);
  const token = (await changeRes.json()).token;

  return (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
}

test('GET /api/uploads/meta: RM (no accessFM) is rejected (403)', async () => {
  const rmFetch = await loginAsRole('RELATIONSHIP_MANAGER', 'rbacgap-rm@example.com', 'TempPass123!', 'RmOwnPassword456!');
  const res = await rmFetch('/api/uploads/meta?ids=1,2,3');
  assert.equal(res.status, 403);
});

test('GET /api/uploads/meta: a role WITH accessFM (CFO) succeeds', async () => {
  const cfoFetch = await loginAsRole('CFO', 'rbacgap-cfo@example.com', 'TempPass123!', 'CfoOwnPassword456!');
  const res = await cfoFetch('/api/uploads/meta?ids=1,2,3');
  assert.equal(res.status, 200);
});

test('workflow withdraw: only the creator can withdraw their own request', async () => {
  const created = await (await server.apiFetch('/api/workflow', {
    method: 'POST', body: JSON.stringify({ type: 'kyc_lp', entityId: 1, entityName: 'RBACGAP kyc', entityType: 'test' }),
  })).json();

  const otherFetch = await loginAsRole('CFO', 'rbacgap-withdraw-other@example.com', 'TempPass123!', 'OtherOwnPassword456!');
  const blocked = await otherFetch(`/api/workflow/${created.id}/withdraw`, { method: 'POST' });
  assert.equal(blocked.status, 403);

  const check = await (await server.apiFetch(`/api/workflow`)).json();
  const stillActive = check.workflowInstances.find(w => w.id === created.id);
  assert.equal(stillActive.status, 'active', 'a blocked withdraw attempt must not change the workflow status');

  const ownWithdraw = await server.apiFetch(`/api/workflow/${created.id}/withdraw`, { method: 'POST' });
  assert.equal(ownWithdraw.status, 200);
  const body = await ownWithdraw.json();
  assert.equal(body.status, 'withdrawn');
});
