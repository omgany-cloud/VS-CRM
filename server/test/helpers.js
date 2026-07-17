// Shared setup for server/test/*.test.js — spawns a real `node index.js`
// against a throwaway SQLite file (never the real pilot database) and
// exposes a small fetch-based client. Integration-style on purpose: this
// app is a thin CRUD-over-HTTP layer where the real risk is in the full
// request pipeline (routing + auth + permission gates + business logic
// together), which only running the real server actually exercises —
// matches how every change in this project has been manually verified
// via curl/CDP all along, just made permanent and automatic.
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const SERVER_DIR = path.join(__dirname, '..');
const SEED_EMAIL = 'admin@turancapital.kz';
const SEED_PASSWORD = 'TuranDemo2025!';

function cleanupDbFiles(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

// port: distinct per test file so parallel `node --test` workers never
// collide. authRateLimitWindowMs: short by default so auth.test.js can
// actually observe the limiter resetting without a real 15-minute wait.
async function createTestServer({ port, authRateLimitWindowMs = 2000 } = {}) {
  if (!port) throw new Error('createTestServer requires a distinct port per test file');
  const dbPath = path.join(SERVER_DIR, 'data', `test-${port}.sqlite`);
  cleanupDbFiles(dbPath);

  const env = {
    ...process.env,
    DB_PATH: dbPath,
    PORT: String(port),
    AUTH_RATE_LIMIT_WINDOW_MS: String(authRateLimitWindowMs),
    JWT_SECRET: 'test-only-secret-not-for-real-use',
  };

  const seed = spawnSync('node', ['seed.js'], { cwd: SERVER_DIR, env });
  if (seed.status !== 0) {
    throw new Error('seed.js failed:\n' + seed.stdout?.toString() + seed.stderr?.toString());
  }

  const child = spawn('node', ['index.js'], { cwd: SERVER_DIR, env });
  const baseUrl = `http://localhost:${port}`;

  const deadline = Date.now() + 10000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl + '/');
      if (res.status) { up = true; break; }
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!up) {
    child.kill();
    throw new Error(`Test server on port ${port} never came up`);
  }

  const loginRes = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error('Seeded admin login failed: ' + (await loginRes.text()));
  const { token } = await loginRes.json();

  async function apiFetch(pathname, opts = {}) {
    const res = await fetch(baseUrl + pathname, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        ...(opts.headers || {}),
      },
    });
    return res;
  }

  async function stop() {
    child.kill();
    // Windows doesn't always release the file handle the instant the
    // process dies — retry the cleanup a few times rather than failing
    // the whole test file over what's ultimately a harmless leftover
    // temp file.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { cleanupDbFiles(dbPath); return; } catch (err) {
        if (attempt === 4) { console.warn(`[test] could not remove ${dbPath}:`, err.message); return; }
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  return { baseUrl, token, apiFetch, stop };
}

module.exports = { createTestServer, SEED_EMAIL, SEED_PASSWORD };
