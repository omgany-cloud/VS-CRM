// Regression coverage for account-level lockout (QA Security audit,
// 2026-08-21): the existing authRateLimit middleware only throttles by
// IP across ALL accounts — it does nothing to stop repeated password
// guesses against ONE specific account. Covers: the account locks after
// MAX_FAILED_LOGIN_ATTEMPTS wrong passwords (even with the correct one
// on the locking attempt), unlocks after the lockout window elapses, and
// a successful login resets the counter so occasional typos never
// accumulate toward a lockout.
//
// Each test gets its OWN dedicated server (same pattern as auth.test.js's
// rate-limiter test) — authRateLimit's IP-keyed 10-request/window budget
// is shared across every request to this route from this process, and
// each test here makes more login attempts than that budget allows, so
// sharing one server across tests would trip IT instead of exercising
// the account-lockout logic under test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let nextPort = 4124;

async function login(server, email, password) {
  return fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('account locks after 5 wrong-password attempts, even if the 5th attempt would have been correct', async () => {
  const server = await createTestServer({ port: nextPort++, authRateLimitWindowMs: 1500 });
  try {
    await server.apiFetch('/api/users', {
      method: 'POST', body: JSON.stringify({ email: 'lockout-test@example.com', password: 'CorrectPass123!', role: 'ANALYST', name: 'Lockout Test' }),
    });

    for (let i = 0; i < 4; i++) {
      const res = await login(server, 'lockout-test@example.com', 'wrong-password');
      assert.equal(res.status, 401);
    }
    // The 5th attempt trips the lock.
    const fifth = await login(server, 'lockout-test@example.com', 'wrong-password');
    assert.equal(fifth.status, 401);

    // Using the CORRECT password proves the lock takes effect independent
    // of whether this particular attempt would otherwise have succeeded.
    const withCorrectPassword = await login(server, 'lockout-test@example.com', 'CorrectPass123!');
    assert.equal(withCorrectPassword.status, 401);
    const body = await withCorrectPassword.json();
    assert.match(body.error, /locked/i, 'must report the lockout, not "invalid email or password", once locked');
  } finally {
    await server.stop();
  }
});

test('the account unlocks once the lockout window elapses', async () => {
  const server = await createTestServer({ port: nextPort++, authRateLimitWindowMs: 1500 });
  try {
    await server.apiFetch('/api/users', {
      method: 'POST', body: JSON.stringify({ email: 'lockout-expiry@example.com', password: 'CorrectPass456!', role: 'ANALYST', name: 'Lockout Expiry' }),
    });
    for (let i = 0; i < 5; i++) await login(server, 'lockout-expiry@example.com', 'wrong-password');
    const stillLocked = await login(server, 'lockout-expiry@example.com', 'CorrectPass456!');
    assert.equal(stillLocked.status, 401);

    await new Promise(r => setTimeout(r, 1700)); // window is 1500ms for this test server
    const afterWindow = await login(server, 'lockout-expiry@example.com', 'CorrectPass456!');
    assert.equal(afterWindow.status, 200, 'the correct password must work again once the lockout window has elapsed');
  } finally {
    await server.stop();
  }
});

test('a successful login resets the failed-attempt counter', async () => {
  const server = await createTestServer({ port: nextPort++, authRateLimitWindowMs: 1500 });
  try {
    await server.apiFetch('/api/users', {
      method: 'POST', body: JSON.stringify({ email: 'lockout-reset@example.com', password: 'CorrectPass789!', role: 'ANALYST', name: 'Lockout Reset' }),
    });
    // 3 wrong attempts (below the 5-attempt threshold), then a real login —
    // the counter must not silently carry over and combine with a LATER
    // batch of wrong attempts to trip the lock prematurely.
    for (let i = 0; i < 3; i++) await login(server, 'lockout-reset@example.com', 'wrong-password');
    const goodLogin = await login(server, 'lockout-reset@example.com', 'CorrectPass789!');
    assert.equal(goodLogin.status, 200);
  } finally {
    await server.stop();
  }
});

test('an unknown email never locks (nothing to lock) and always reports the generic message', async () => {
  const server = await createTestServer({ port: nextPort++, authRateLimitWindowMs: 1500 });
  try {
    const res = await login(server, 'definitely-not-a-real-user@example.com', 'whatever');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.doesNotMatch(body.error, /locked/i);
  } finally {
    await server.stop();
  }
});
