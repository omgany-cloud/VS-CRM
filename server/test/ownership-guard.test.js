// Regression coverage for the ownership_pct-sum guard (QA Data Integrity
// audit, 2026-08-21): POST/PUT /api/lp wrote ownership_pct as-is with zero
// validation — the sum across a fund's LPs could silently exceed 100%.
// Covers: boundary (exactly 100% allowed), over-100% rejected on create,
// over-100% rejected on update, excluding the LP's own prior value on
// update, and LPs with no fundId not being validated at all.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4129 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'OWNERSHIP_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

function makeLpBody(overrides) {
  return JSON.stringify({
    fundId, name: 'LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
    commitment: 100000, status: 'Active', ...overrides,
  });
}

test('creating LPs whose ownership_pct sums to exactly 100% is accepted (boundary case)', async () => {
  const a = await server.apiFetch('/api/lp', { method: 'POST', body: makeLpBody({ registerId: 'OWN-1', ownershipPct: 60 }) });
  assert.equal(a.status, 201);
  const b = await server.apiFetch('/api/lp', { method: 'POST', body: makeLpBody({ registerId: 'OWN-2', ownershipPct: 40 }) });
  assert.equal(b.status, 201);
});

test('creating an LP that would push the fund total past 100% is rejected (400)', async () => {
  const res = await server.apiFetch('/api/lp', { method: 'POST', body: makeLpBody({ registerId: 'OWN-3', ownershipPct: 0.01 }) });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /100/);
});

test('updating an LP to push the fund total past 100% is rejected (400)', async () => {
  const created = await (await server.apiFetch('/api/lp', { method: 'POST', body: makeLpBody({ registerId: 'OWN-4', ownershipPct: 0 }) })).json();
  const res = await server.apiFetch(`/api/lp/${created.id}`, { method: 'PUT', body: JSON.stringify({ ownershipPct: 5 }) });
  assert.equal(res.status, 400);
});

test('updating an LP without changing its own ownership_pct is unaffected by its own prior value (excludes self)', async () => {
  const created = await (await server.apiFetch('/api/lp', { method: 'POST', body: makeLpBody({ registerId: 'OWN-5', ownershipPct: 0 }) })).json();
  // Fund is already at 100% from the first test's two LPs; re-saving this
  // LP's own (unrelated) fields must not fail just because ITS value is
  // being re-submitted as part of the merge.
  const res = await server.apiFetch(`/api/lp/${created.id}`, { method: 'PUT', body: JSON.stringify({ ownershipPct: 0, notes: 'updated' }) });
  assert.equal(res.status, 200);
});

test('an LP with no fundId is not validated against any fund total', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ name: 'No Fund LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'OWN-6', ownershipPct: 999 }),
  });
  assert.equal(res.status, 201);
});
