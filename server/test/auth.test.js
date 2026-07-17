const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer, SEED_EMAIL, SEED_PASSWORD } = require('./helpers');

let server;

// Short window (from createTestServer's default) so this test doesn't
// have to wait out the real 15-minute production window.
before(async () => { server = await createTestServer({ port: 4092, authRateLimitWindowMs: 1500 }); });
after(async () => { await server.stop(); });

test('login succeeds with correct credentials', async () => {
  const res = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.token);
});

test('login fails with wrong password', async () => {
  const res = await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: 'wrong-password' }),
  });
  assert.equal(res.status, 401);
});

test('a tampered token is rejected', async () => {
  const res = await fetch(server.baseUrl + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + server.token.slice(0, -3) + 'xxx' },
  });
  assert.equal(res.status, 401);
});

test('rate limiter trips after 10 failed attempts, then resets after the window', async () => {
  // Dedicated server, distinct from the shared one above — the limiter is
  // shared across every request to this process for its whole lifetime,
  // so counting attempts precisely requires starting from a clean slate
  // rather than reusing a server other tests have already made login
  // attempts against.
  const rl = await createTestServer({ port: 4094, authRateLimitWindowMs: 1500 });
  try {
    const attempt = () => fetch(rl.baseUrl + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SEED_EMAIL, password: 'wrong' }),
    });
    // createTestServer() already made one successful login as part of its
    // own setup — express-rate-limit counts every request against the
    // limited route by default, success or failure, so that's 1 of the
    // 10-request budget already spent before this test's own attempts.
    let last;
    for (let i = 0; i < 9; i++) last = await attempt();
    assert.equal(last.status, 401, 'remaining budget (9, after setup\'s own login used 1 of 10) should still be normal auth failures');
    const eleventh = await attempt();
    assert.equal(eleventh.status, 429, 'the 11th request overall within the window must be rate-limited');

    await new Promise(r => setTimeout(r, 1700)); // window is 1500ms for this test server
    const afterWindow = await attempt();
    assert.equal(afterWindow.status, 401, 'after the window elapses, requests should be evaluated normally again');
  } finally {
    await rl.stop();
  }
});
