// Covers the "admin sets a temporary password, user must pick their own on
// first login" flow: server/db.js's must_change_password column,
// server/auth.js's requireAuth gate, and the create/reset/self-change
// routes in server/index.js that set or clear it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer, SEED_PASSWORD } = require('./helpers');

let server;

before(async () => { server = await createTestServer({ port: 4099 }); });
after(async () => { await server.stop(); });

async function loginAs(email, password) {
  const res = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('creating a user sets mustChangePassword and the login response reports it', async () => {
  const createRes = await server.apiFetch('/api/users', {
    method: 'POST',
    body: JSON.stringify({ email: 'newbie@turancapital.kz', password: 'TempPass123!', role: 'ANALYST', name: 'Иванов Иван' }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.equal(created.mustChangePassword, true);

  const login = await loginAs('newbie@turancapital.kz', 'TempPass123!');
  assert.equal(login.user.mustChangePassword, true);
});

test('a mustChangePassword account is blocked from every route except the exempt two', async () => {
  const login = await loginAs('newbie@turancapital.kz', 'TempPass123!');
  const asNewbie = (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) },
  });

  const blocked = await asNewbie('/api/lp');
  assert.equal(blocked.status, 403);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, 'MUST_CHANGE_PASSWORD');

  const me = await asNewbie('/api/auth/me');
  assert.equal(me.status, 200, 'GET /api/auth/me must stay reachable so the frontend can identify the account');

  const wrongCurrent = await asNewbie('/api/users/me/password', {
    method: 'PUT', body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'BrandNew123!' }),
  });
  assert.equal(wrongCurrent.status, 401, 'the exempt route still enforces its own currentPassword check');
});

test('changing the temporary password clears the flag and unblocks other routes', async () => {
  const login = await loginAs('newbie@turancapital.kz', 'TempPass123!');
  const asNewbie = (pathname, opts = {}) => fetch(server.baseUrl + pathname, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) },
  });

  const changeRes = await asNewbie('/api/users/me/password', {
    method: 'PUT', body: JSON.stringify({ currentPassword: 'TempPass123!', newPassword: 'MyOwnPassword456!' }),
  });
  assert.equal(changeRes.status, 200);

  const oldPwLogin = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newbie@turancapital.kz', password: 'TempPass123!' }),
  });
  assert.equal(oldPwLogin.status, 401, 'the temporary password must stop working once replaced');

  const relogin = await loginAs('newbie@turancapital.kz', 'MyOwnPassword456!');
  assert.equal(relogin.user.mustChangePassword, false);

  const nowAllowed = await asNewbie('/api/lp');
  assert.equal(nowAllowed.status, 200, 'once the flag is cleared, previously-blocked routes work again');
});

test('an admin-triggered password reset re-sets mustChangePassword', async () => {
  const usersRes = await server.apiFetch('/api/users');
  const { users } = await usersRes.json();
  const newbie = users.find(u => u.email === 'newbie@turancapital.kz');
  assert.ok(newbie, 'seeded from the earlier test in this file');
  assert.equal(newbie.mustChangePassword, false, 'cleared by the previous test');

  const resetRes = await server.apiFetch(`/api/users/${newbie.id}/password`, {
    method: 'PUT', body: JSON.stringify({ password: 'AdminResetPass789!' }),
  });
  assert.equal(resetRes.status, 200);

  const login = await loginAs('newbie@turancapital.kz', 'AdminResetPass789!');
  assert.equal(login.user.mustChangePassword, true, 'an admin-set password is a temporary one again, same as account creation');
});

test('the seeded admin account itself is unaffected (must_change_password defaults to 0)', async () => {
  const res = await server.apiFetch('/api/auth/me');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.mustChangePassword, false);
});
