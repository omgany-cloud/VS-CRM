// Regression coverage for the session-invalidation fix (QA Security
// audit, 2026-08-21): logout and password change/reset previously never
// invalidated an already-issued JWT — it just kept working until its own
// 12h expiry regardless of either event. Covers: POST /api/auth/logout
// actually kills the token used to call it; an admin-triggered password
// reset kills the TARGET user's session, not the admin's own; and
// backward compatibility — a token signed before this fix existed (no
// tokenVersion claim) still authenticates against a fresh
// token_version=0 user.
const jwt = require('jsonwebtoken');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

const JWT_SECRET = 'test-only-secret-not-for-real-use'; // matches helpers.js's createTestServer default

let server;

before(async () => { server = await createTestServer({ port: 4123 }); });
after(async () => { await server.stop(); });

async function loginAs(email, password) {
  const res = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('POST /api/auth/logout invalidates the token used to call it', async () => {
  const userRes = await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'logout-test@example.com', password: 'TempPass123!', role: 'ANALYST', name: 'Logout Test' }),
  });
  assert.equal(userRes.status, 201);
  const login = await loginAs('logout-test@example.com', 'TempPass123!');
  const asUser = (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) },
  });

  // Sanity: works before logout (exempt route, mustChangePassword still set).
  const beforeLogout = await asUser('/api/auth/me');
  assert.equal(beforeLogout.status, 200);

  const logoutRes = await asUser('/api/auth/logout', { method: 'POST' });
  assert.equal(logoutRes.status, 200);

  const afterLogout = await asUser('/api/auth/me');
  assert.equal(afterLogout.status, 401, 'the token used to log out must be rejected on its very next use');
});

test('an admin-triggered password reset kills the TARGET user\'s session, not the admin\'s own', async () => {
  const userRes = await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'reset-target@example.com', password: 'TempPass123!', role: 'ANALYST', name: 'Reset Target' }),
  });
  const created = await userRes.json();
  const targetLogin = await loginAs('reset-target@example.com', 'TempPass123!');
  const asTarget = (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + targetLogin.token, ...(opts.headers || {}) },
  });
  assert.equal((await asTarget('/api/auth/me')).status, 200);

  // Admin resets the target's password using the ADMIN's own session.
  const resetRes = await server.apiFetch(`/api/users/${created.id}/password`, {
    method: 'PUT', body: JSON.stringify({ password: 'AdminResetPass789!' }),
  });
  assert.equal(resetRes.status, 200);

  // Target's pre-reset token is now dead.
  assert.equal((await asTarget('/api/auth/me')).status, 401, 'the target user\'s pre-reset token must be invalidated');

  // The ADMIN's own session (server.apiFetch, unrelated to the target
  // user's token_version) must be completely unaffected.
  const adminStillWorks = await server.apiFetch('/api/auth/me');
  assert.equal(adminStillWorks.status, 200, 'resetting a DIFFERENT user\'s password must not touch the admin\'s own session');
});

test('backward compatible: a pre-fix token with no tokenVersion claim still authenticates against a fresh (token_version=0) user', async () => {
  const userRes = await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: 'legacy-token@example.com', password: 'TempPass123!', role: 'ANALYST', name: 'Legacy Token' }),
  });
  const created = await userRes.json();
  // Decode (not verify — just reading claims) the admin's own already-
  // valid token to get tenantId/tenantSlug, rather than relying on an
  // API route that returns them (GET /api/auth/me doesn't).
  const { tenantId, tenantSlug } = jwt.decode(server.token);

  // Hand-signed exactly like the pre-fix signToken() did — no tokenVersion
  // claim at all, simulating a token issued before this migration existed.
  const legacyToken = jwt.sign(
    { sub: created.id, tenantId, tenantSlug, email: 'legacy-token@example.com', role: 'ANALYST' },
    JWT_SECRET, { expiresIn: '12h' },
  );
  const res = await fetch(server.baseUrl + '/api/auth/me', { headers: { Authorization: 'Bearer ' + legacyToken } });
  assert.equal(res.status, 200, 'a legacy token (no tokenVersion claim) must still work against a freshly-created, never-invalidated user');
});
