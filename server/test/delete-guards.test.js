// Permanent regression coverage for the hybrid-delete pattern (real
// hard-delete only when a record has zero footprint, 409 + record intact
// otherwise) added across LP/deal/portfolio/engagement/capital-call/
// ob-client — these exact assertions were previously only ever checked
// by hand via one-off CDP scripts.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4091 });
  const res = await server.apiFetch('/api/funds');
  const { funds } = await res.json();
  fundId = funds[0].id;
});

after(async () => { await server.stop(); });

test('LP: clean delete succeeds and persists', async () => {
  const created = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_CLEAN', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-1' }),
  })).json();

  const del = await server.apiFetch(`/api/lp/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const list = await (await server.apiFetch('/api/lp')).json();
  assert.ok(!list.lp.some(l => l.id === created.id), 'deleted LP must not reappear after a fresh fetch');
});

test('LP: delete blocked once a capital call references it (409, record intact)', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_WITH_CC', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-2' }),
  })).json();
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST',
    body: JSON.stringify({ fundId, purpose: 'test', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 5, called: 50 }] }),
  })).json();

  const del = await server.apiFetch(`/api/lp/${lp.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  const body = await del.json();
  assert.match(body.error, /Exited/);

  const list = await (await server.apiFetch('/api/lp')).json();
  assert.ok(list.lp.some(l => l.id === lp.id), 'LP with real footprint must survive the blocked delete attempt');

  // cleanup: delete the CC first (still Draft), then the LP becomes deletable
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'DELETE' });
  await server.apiFetch(`/api/lp/${lp.id}`, { method: 'DELETE' });
});

test('Deal: clean delete succeeds; delete blocked once an IC memo references it', async () => {
  const clean = await (await server.apiFetch('/api/deals', {
    method: 'POST', body: JSON.stringify({ fundId, company: 'TEST_DEAL_CLEAN', sector: 'Test', amount: 1, stage: 'Скрининг' }),
  })).json();
  assert.equal((await server.apiFetch(`/api/deals/${clean.id}`, { method: 'DELETE' })).status, 200);
});

test('Portfolio: clean delete succeeds; blocked once invested > 0', async () => {
  const clean = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_PORT_CLEAN', sector: 'Test', invested: 0, value: 0 }),
  })).json();
  assert.equal((await server.apiFetch(`/api/portfolio/${clean.id}`, { method: 'DELETE' })).status, 200);

  const invested = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_PORT_INVESTED', sector: 'Test', invested: 5, value: 5 }),
  })).json();
  const del = await server.apiFetch(`/api/portfolio/${invested.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);

  // archive/restore round trip, with server-stamped archivedBy/archivedAt
  const archived = await (await server.apiFetch(`/api/portfolio/${invested.id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) })).json();
  assert.equal(archived.archived, true);
  assert.ok(archived.archivedBy && archived.archivedAt);
  const restored = await (await server.apiFetch(`/api/portfolio/${invested.id}`, { method: 'PUT', body: JSON.stringify({ archived: false }) })).json();
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedBy, null);
});

test('Capital call: Draft deletes cleanly; Pending is blocked permanently (no soft alternative)', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_LP_FOR_CC', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-3' }),
  })).json();

  const draft = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'test draft', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 5, called: 50 }] }),
  })).json();
  assert.equal((await server.apiFetch(`/api/capital-calls/${draft.id}`, { method: 'DELETE' })).status, 200);

  const pending = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'test pending', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 5, called: 50 }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${pending.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const del = await server.apiFetch(`/api/capital-calls/${pending.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('Engagement: clean delete succeeds', async () => {
  const clean = await (await server.apiFetch('/api/engagements', {
    method: 'POST', body: JSON.stringify({ clientName: 'TEST_ENG_CLEAN', serviceType: 'Advisory', direction: 'CFA', status: 'Draft' }),
  })).json();
  assert.equal((await server.apiFetch(`/api/engagements/${clean.id}`, { method: 'DELETE' })).status, 200);
});

test('Onboarding client: clean (unactivated) delete succeeds; activated is blocked', async () => {
  const clean = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_OBCLIENT_CLEAN', direction: 'FM', activated: false }),
  })).json();
  assert.equal((await server.apiFetch(`/api/ob-clients/${clean.id}`, { method: 'DELETE' })).status, 200);

  const activated = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_OBCLIENT_ACTIVATED', direction: 'FM', activated: true }),
  })).json();
  const del = await server.apiFetch(`/api/ob-clients/${activated.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});
