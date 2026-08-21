// Regression coverage for optimistic locking (QA Data Integrity audit:
// "no version column, pure last-write-wins") on the 3 entities that
// finding named — deals, lp_register, portfolio. Deliberately opt-in:
// PUT only compares `version` when the caller supplies it, so every
// existing granular partial-update call site in js/*.js (none of which
// send version) keeps working exactly as before. version always
// increments server-side on a successful UPDATE either way.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4131 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'LOCK_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('LP: a fresh record starts at version 1; a PUT with no version field succeeds and increments it', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'LOCK_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LOCK-1' }),
  })).json();
  assert.equal(lp.version, 1);

  const updated = await (await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'no version sent' }) })).json();
  assert.equal(updated.version, 2, 'version must increment even when the caller does not check it');
});

test('LP: a stale version is rejected (409) and the record is left untouched', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'LOCK_LP2', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LOCK-2' }),
  })).json();
  // Editor A saves first, bumping version 1 -> 2.
  await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ version: 1, notes: 'editor A' }) });
  // Editor B still has the stale version 1 loaded.
  const conflict = await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ version: 1, notes: 'editor B — should be rejected' }) });
  assert.equal(conflict.status, 409);
  const body = await conflict.json();
  assert.ok(body.current, 'a 409 must hand back the current record so the caller can reload/merge');

  const list = await (await server.apiFetch('/api/lp')).json();
  assert.equal(list.lp.find(l => l.id === lp.id).notes, 'editor A', "editor B's stale write must not have applied");
});

test('LP: the correct current version is accepted', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'LOCK_LP3', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LOCK-3' }),
  })).json();
  const res = await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ version: lp.version, notes: 'correct version' }) });
  assert.equal(res.status, 200);
});

test('Deal: stale version rejected (409); correct version accepted', async () => {
  const deal = await (await server.apiFetch('/api/deals', {
    method: 'POST', body: JSON.stringify({ fundId, company: 'LOCK_DEAL', sector: 'Test', amount: 1, stage: 'Скрининг' }),
  })).json();
  assert.equal(deal.version, 1);

  const staleRes = await server.apiFetch(`/api/deals/${deal.id}`, { method: 'PUT', body: JSON.stringify({ version: 999, description: 'stale' }) });
  assert.equal(staleRes.status, 409);

  const okRes = await server.apiFetch(`/api/deals/${deal.id}`, { method: 'PUT', body: JSON.stringify({ version: deal.version, description: 'fresh' }) });
  assert.equal(okRes.status, 200);
  const updated = await okRes.json();
  assert.equal(updated.version, 2);
});

test('Portfolio: stale version rejected (409); correct version accepted', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'LOCK_PORTCO', sector: 'Test', stage: 'Active', invested: 0, value: 0 }),
  })).json();
  assert.equal(co.version, 1);

  const staleRes = await server.apiFetch(`/api/portfolio/${co.id}`, { method: 'PUT', body: JSON.stringify({ version: 999, nextAction: 'stale' }) });
  assert.equal(staleRes.status, 409);

  const okRes = await server.apiFetch(`/api/portfolio/${co.id}`, { method: 'PUT', body: JSON.stringify({ version: co.version, nextAction: 'fresh' }) });
  assert.equal(okRes.status, 200);
  const updated = await okRes.json();
  assert.equal(updated.version, 2);
});

test('Portfolio: an existing granular call site with no version field is unaffected (backward compatible)', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'LOCK_PORTCO2', sector: 'Test', stage: 'Active', invested: 0, value: 0 }),
  })).json();
  const res = await server.apiFetch(`/api/portfolio/${co.id}`, { method: 'PUT', body: JSON.stringify({ nextAction: 'no version, as usual' }) });
  assert.equal(res.status, 200);
});
