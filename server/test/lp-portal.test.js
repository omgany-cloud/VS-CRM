// Regression coverage for the LP self-service portal (lp-portal.html) —
// a fourth identity space (requireLpPortalAuth, server/auth.js) added
// alongside internal users, the portfolio-company portal, and API keys.
// Covers: login success/failure, the curated view never leaking
// internal-only LP fields, an LP only ever seeing its OWN capital call
// line items (not another LP's), and that tokens from one identity space
// don't work against another's routes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4096 });
  // seed.js no longer creates any funds — create a throwaway one to attach
  // the test LPs to.
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('LP portal: login, curated self-service view, and per-LP data isolation', async () => {
  const lpA = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'ZZZ_LPPORTAL_A', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LPP-A', email: 'lpp-a@example.com' }),
  })).json();
  const lpB = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'ZZZ_LPPORTAL_B', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 2000, status: 'Active', registerId: 'LPP-B', email: 'lpp-b@example.com' }),
  })).json();

  // Staff sets document links for LP A — previously lpaUrl was displayed
  // in the CRM but never actually persisted (no lp_register column to
  // bind it to); confirm it now round-trips through a real PUT.
  const docSave = await server.apiFetch(`/api/lp/${lpA.id}`, {
    method: 'PUT', body: JSON.stringify({ lpaUrl: 'https://example.com/lpa.pdf', saUrl: 'https://example.com/sa.pdf' }),
  });
  assert.equal(docSave.status, 200);
  assert.equal((await docSave.json()).lpaUrl, 'https://example.com/lpa.pdf');

  // Staff generates a portal password for LP A only.
  const genRes = await server.apiFetch(`/api/lp/${lpA.id}/portal-password`, { method: 'PUT' });
  assert.equal(genRes.status, 200);
  const { password } = await genRes.json();
  assert.ok(password && password.length >= 8);

  // Wrong password rejected.
  const badLogin = await fetch(server.baseUrl + '/api/portal/lp/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lpp-a@example.com', password: 'definitely-wrong' }),
  });
  assert.equal(badLogin.status, 401);

  // Correct login succeeds and returns a curated view (not the full internal record).
  const loginRes = await fetch(server.baseUrl + '/api/portal/lp/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lpp-a@example.com', password }),
  });
  assert.equal(loginRes.status, 200);
  const { token, lp } = await loginRes.json();
  assert.equal(lp.name, 'ZZZ_LPPORTAL_A');
  assert.equal(lp.commitment, 1000);
  assert.equal(lp.notes, undefined, 'internal staff notes must not leak to the LP');
  assert.equal(lp.rm, undefined, 'internal RM assignment must not leak to the LP');
  assert.equal(lp.riskRating, undefined, 'internal risk rating must not leak to the LP');
  assert.equal(lp.lpaUrl, 'https://example.com/lpa.pdf', 'the LP must see its own document links');
  assert.equal(lp.saUrl, 'https://example.com/sa.pdf');

  async function lpFetch(path) {
    return fetch(server.baseUrl + path, { headers: { Authorization: 'Bearer ' + token } });
  }

  const meRes = await lpFetch('/api/portal/lp/me');
  assert.equal(meRes.status, 200);
  assert.equal((await meRes.json()).lp.name, 'ZZZ_LPPORTAL_A');

  // One capital call covering both LPs.
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST',
    body: JSON.stringify({
      fundId, purpose: 'ZZZ_LPPORTAL_CC',
      lineItems: [
        { lpId: lpA.id, commitment: 1000, pct: 5, called: 50 },
        { lpId: lpB.id, commitment: 2000, pct: 5, called: 100 },
      ],
    }),
  })).json();

  // LP A's portal must see exactly its own line item — not LP B's.
  const ccRes = await lpFetch('/api/portal/lp/capital-calls');
  assert.equal(ccRes.status, 200);
  const { capitalCalls } = await ccRes.json();
  assert.equal(capitalCalls.length, 1, 'LP A must see exactly one capital call line — its own');
  assert.equal(capitalCalls[0].called, 50);
  assert.equal(capitalCalls[0].ccNumber, cc.ccNumber);

  // Cross-identity-space checks: a staff token doesn't work on LP-portal
  // routes, and an LP-portal token doesn't work on internal routes.
  const staffOnLpRoute = await server.apiFetch('/api/portal/lp/me');
  assert.equal(staffOnLpRoute.status, 401);
  const lpOnStaffRoute = await lpFetch('/api/lp');
  assert.equal(lpOnStaffRoute.status, 401);

  // An LP with no email on file can't have a portal password generated
  // (email doubles as the login identifier).
  const lpNoEmail = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'ZZZ_LPPORTAL_NOEMAIL', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 500, status: 'Active', registerId: 'LPP-C' }),
  })).json();
  const genNoEmail = await server.apiFetch(`/api/lp/${lpNoEmail.id}/portal-password`, { method: 'PUT' });
  assert.equal(genNoEmail.status, 409);

  // cleanup
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'DELETE' }).catch(() => {});
  await server.apiFetch(`/api/lp/${lpA.id}`, { method: 'DELETE' }).catch(() => {});
  await server.apiFetch(`/api/lp/${lpB.id}`, { method: 'DELETE' }).catch(() => {});
  await server.apiFetch(`/api/lp/${lpNoEmail.id}`, { method: 'DELETE' }).catch(() => {});
});
