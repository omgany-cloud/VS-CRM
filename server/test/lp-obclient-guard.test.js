// Regression coverage for the obClientId activation guard (QA finding:
// the "LP Register" UI banner claimed direct entry never bypasses
// KYC/AML, but POST /api/lp never checked obClientId against anything —
// server/index.js). Deliberately the soft variant: obClientId is only
// validated when the caller supplies one; LPs created with no obClientId
// at all (tests, external API/MCP, manual ops entry) are unaffected.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4130 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'OBGUARD_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('creating an LP with no obClientId at all is unaffected', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'No ObClient LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'OBG-1' }),
  });
  assert.equal(res.status, 201);
});

test('creating an LP with an obClientId that does not exist in this tenant is rejected (400)', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'Bad ObClient LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'OBG-2', obClientId: 999999 }),
  });
  assert.equal(res.status, 400);
});

test('creating an LP referencing a NOT-activated onboarding client is rejected (400)', async () => {
  const client = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_UNACTIVATED_CLIENT', direction: 'FM', activated: false }),
  })).json();
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'Unactivated Client LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'OBG-3', obClientId: client.id }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /not yet activated/);
});

test('creating an LP referencing an activated onboarding client succeeds', async () => {
  const client = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_ACTIVATED_CLIENT', direction: 'FM', activated: true }),
  })).json();
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'Activated Client LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'OBG-4', obClientId: client.id }),
  });
  assert.equal(res.status, 201);
});
