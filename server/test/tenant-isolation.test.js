// Turns a one-time manual code audit (every tenant-scoped query in
// server/index.js/externalApi.js confirmed to filter by tenant_id) into
// a permanent tripwire — nothing else currently catches a future route
// that forgets that filter in this 2500+ line file. Two isolation
// vectors per entity: does tenant B's list ever include tenant A's
// data, and does tenant B's JWT let it touch tenant A's record by
// guessing/incrementing a numeric id (IDOR)?
//
// The portal BIN-login collision case is deliberately NOT covered here
// — it's an existing, documented, accepted design tradeoff (pre-auth,
// keyed by a real-world-unique business ID), not a gap this suite is
// meant to police.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server; // tenant A — the fully-seeded tenant from createTestServer()
let tenantB; // tenant B — freshly signed up, empty, isolated

before(async () => {
  server = await createTestServer({ port: 4095 });

  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      companyName: 'ZZZ Isolation Test Co',
      name: 'Tenant B Admin',
      email: 'tenantb-admin@isolationtest.example',
      password: 'TenantBPassword123',
    }),
  });
  assert.equal(signupRes.status, 201, 'signup must succeed to set up tenant B');
  const body = await signupRes.json();
  tenantB = { token: body.token, tenantId: body.tenant.id };

  async function bFetch(pathname, opts = {}) {
    return fetch(server.baseUrl + pathname, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tenantB.token, ...(opts.headers || {}) },
    });
  }
  tenantB.apiFetch = bFetch;
});

after(async () => { await server.stop(); });

// Generic isolation check, reused for every hybrid-delete entity: tenant
// A creates a record, assert tenant B's list doesn't contain it, assert
// tenant B's PUT/DELETE against that exact id 404s (not 200, not 403 —
// 403 would mean the row was found and only the action was denied; 404
// means tenant B's query never found tenant A's row at all, which is
// the actual isolation guarantee).
async function assertEntityIsolation({ name, createPath, createBody, listPath, listKey, idPath }) {
  const created = await (await server.apiFetch(createPath, { method: 'POST', body: JSON.stringify(createBody) })).json();
  assert.ok(created.id, `${name}: setup must actually create a record`);

  const bList = await (await tenantB.apiFetch(listPath)).json();
  assert.ok(!bList[listKey].some(r => r.id === created.id), `${name}: tenant B's list must not contain tenant A's record`);

  const bGetOrPut = await tenantB.apiFetch(idPath(created.id), { method: 'PUT', body: JSON.stringify({}) });
  assert.equal(bGetOrPut.status, 404, `${name}: tenant B's PUT against tenant A's id must 404, not touch/leak the record`);

  const bDelete = await tenantB.apiFetch(idPath(created.id), { method: 'DELETE' });
  assert.equal(bDelete.status, 404, `${name}: tenant B's DELETE against tenant A's id must 404`);

  // cleanup on tenant A's side
  await server.apiFetch(idPath(created.id), { method: 'DELETE' }).catch(() => {});
}

test('LP isolation', async () => {
  const fundsRes = await (await server.apiFetch('/api/funds')).json();
  const fundId = fundsRes.funds[0].id;
  await assertEntityIsolation({
    name: 'LP',
    createPath: '/api/lp',
    createBody: { fundId, name: 'ZZZ_ISO_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'ISO-1' },
    listPath: '/api/lp', listKey: 'lp',
    idPath: (id) => `/api/lp/${id}`,
  });
});

test('Deal isolation', async () => {
  const fundsRes = await (await server.apiFetch('/api/funds')).json();
  const fundId = fundsRes.funds[0].id;
  await assertEntityIsolation({
    name: 'Deal',
    createPath: '/api/deals',
    createBody: { fundId, company: 'ZZZ_ISO_DEAL', sector: 'Test', amount: 1, stage: 'Скрининг' },
    listPath: '/api/deals', listKey: 'deals',
    idPath: (id) => `/api/deals/${id}`,
  });
});

test('Portfolio isolation', async () => {
  const fundsRes = await (await server.apiFetch('/api/funds')).json();
  const fundId = fundsRes.funds[0].id;
  await assertEntityIsolation({
    name: 'Portfolio',
    createPath: '/api/portfolio',
    createBody: { fundId, name: 'ZZZ_ISO_PORT', sector: 'Test', invested: 0, value: 0 },
    listPath: '/api/portfolio', listKey: 'portfolio',
    idPath: (id) => `/api/portfolio/${id}`,
  });
});

test('Engagement isolation', async () => {
  // No standalone GET /api/engagements — engagements are only listed as
  // part of GET /api/onboarding.
  await assertEntityIsolation({
    name: 'Engagement',
    createPath: '/api/engagements',
    createBody: { clientName: 'ZZZ_ISO_ENG', serviceType: 'Advisory', direction: 'CFA', status: 'Draft' },
    listPath: '/api/onboarding', listKey: 'engagements',
    idPath: (id) => `/api/engagements/${id}`,
  });
});

test('Onboarding client isolation', async () => {
  await assertEntityIsolation({
    name: 'ObClient',
    createPath: '/api/ob-clients',
    createBody: { name: 'ZZZ_ISO_OBCLIENT', direction: 'FM', activated: false },
    listPath: '/api/onboarding', listKey: 'obClients',
    idPath: (id) => `/api/ob-clients/${id}`,
  });
});

test('Capital call isolation (Draft only, since PUT/DELETE both apply to a Draft-safe id)', async () => {
  const fundsRes = await (await server.apiFetch('/api/funds')).json();
  const fundId = fundsRes.funds[0].id;
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'ZZZ_ISO_CC_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'ISO-2' }),
  })).json();

  await assertEntityIsolation({
    name: 'CapitalCall',
    createPath: '/api/capital-calls',
    createBody: { fundId, purpose: 'ZZZ_ISO_CC', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 5, called: 50 }] },
    listPath: '/api/capital-calls', listKey: 'capitalCalls',
    idPath: (id) => `/api/capital-calls/${id}`,
  });

  await server.apiFetch(`/api/lp/${lp.id}`, { method: 'DELETE' }).catch(() => {});
});

test('Users isolation: tenant B cannot list, edit, or delete tenant A\'s users', async () => {
  const aUsers = await (await server.apiFetch('/api/users')).json();
  const aUserId = aUsers.users[0].id;

  const bUsers = await (await tenantB.apiFetch('/api/users')).json();
  assert.ok(!bUsers.users.some(u => u.id === aUserId), 'tenant B user list must not contain any tenant A user');

  const bEdit = await tenantB.apiFetch(`/api/users/${aUserId}`, { method: 'PUT', body: JSON.stringify({ name: 'hijacked' }) });
  assert.equal(bEdit.status, 404, 'tenant B editing tenant A\'s user id must 404');

  const bDelete = await tenantB.apiFetch(`/api/users/${aUserId}`, { method: 'DELETE' });
  assert.equal(bDelete.status, 404, 'tenant B deleting tenant A\'s user id must 404');
});

test('External API key isolation: a key only ever resolves to the tenant that created it', async () => {
  const aKeyRes = await (await server.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_ISO_KEY_A', scopes: ['read:lp'] }),
  })).json();
  const bKeyRes = await (await tenantB.apiFetch('/api/api-keys', {
    method: 'POST', body: JSON.stringify({ name: 'ZZZ_ISO_KEY_B', scopes: ['read:lp'] }),
  })).json();

  const aExternal = await (await fetch(server.baseUrl + '/api/v1/external/lp', { headers: { Authorization: 'Bearer ' + aKeyRes.key } })).json();
  const bExternal = await (await fetch(server.baseUrl + '/api/v1/external/lp', { headers: { Authorization: 'Bearer ' + bKeyRes.key } })).json();

  // Tenant A's seeded data has real LPs; tenant B is a fresh signup with none.
  assert.ok(aExternal.lp.length > 0, 'tenant A key should see tenant A\'s real seeded LPs');
  assert.equal(bExternal.lp.length, 0, 'tenant B key must see zero LPs — tenant B never created any, and must not see tenant A\'s');
  assert.ok(!bExternal.lp.some(l => aExternal.lp.some(al => al.id === l.id)), 'no LP id should ever appear in both tenants\' results');

  await server.apiFetch(`/api/api-keys/${aKeyRes.id}/revoke`, { method: 'PUT' }).catch(() => {});
  await tenantB.apiFetch(`/api/api-keys/${bKeyRes.id}/revoke`, { method: 'PUT' }).catch(() => {});
});

test('Fund isolation', async () => {
  await assertEntityIsolation({
    name: 'Fund',
    createPath: '/api/funds',
    createBody: { name: 'ZZZ_ISO_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 },
    listPath: '/api/funds', listKey: 'funds',
    idPath: (id) => `/api/funds/${id}`,
  });
});
