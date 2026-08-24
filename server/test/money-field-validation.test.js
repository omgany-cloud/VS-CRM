// Regression coverage for server-side money-field validation (QA
// Input/numeric-validation audit, 2026-08-24): commitment/invested/value/
// targetSize accepted negative numbers and NaN with zero server-side
// check. Only rejects when the field is actually present and invalid —
// omitted fields keep their existing defaulting behavior untouched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4137 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'MONEYVAL_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('LP: a negative commitment is rejected on create (400)', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'MONEYVAL_LP_BAD', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: -1000, status: 'Active', registerId: 'MV-1' }),
  });
  assert.equal(res.status, 400);
});

test('LP: a string commitment ("abc") is rejected on create (400)', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'MONEYVAL_LP_STR', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 'abc', status: 'Active', registerId: 'MV-1B' }),
  });
  assert.equal(res.status, 400);
});

test('LP: a valid non-negative commitment is accepted', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'MONEYVAL_LP_OK', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 0, status: 'Active', registerId: 'MV-2' }),
  });
  assert.equal(res.status, 201);
});

test('LP: a negative commitment is rejected on update (400)', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'MONEYVAL_LP_UPD', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'MV-3' }),
  })).json();
  const res = await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ commitment: -1 }) });
  assert.equal(res.status, 400);
});

test('Portfolio: negative invested/value are rejected on create (400)', async () => {
  const res1 = await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'MONEYVAL_PORT_1', sector: 'Test', invested: -5, value: 0 }),
  });
  assert.equal(res1.status, 400);
  const res2 = await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'MONEYVAL_PORT_2', sector: 'Test', invested: 0, value: -5 }),
  });
  assert.equal(res2.status, 400);
});

test('Portfolio: valid invested/value (including 0) are accepted', async () => {
  const res = await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'MONEYVAL_PORT_OK', sector: 'Test', invested: 0, value: 0 }),
  });
  assert.equal(res.status, 201);
});

test('Portfolio: a negative value is rejected on update (400)', async () => {
  const co = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'MONEYVAL_PORT_UPD', sector: 'Test', invested: 100, value: 100 }),
  })).json();
  const res = await server.apiFetch(`/api/portfolio/${co.id}`, { method: 'PUT', body: JSON.stringify({ value: -1 }) });
  assert.equal(res.status, 400);
});

test('Fund: a negative targetSize is rejected on create (400)', async () => {
  const res = await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'MONEYVAL_FUND_BAD', targetSize: -10 }) });
  assert.equal(res.status, 400);
});

test('Fund: a negative targetSize is rejected on update (400)', async () => {
  const res = await server.apiFetch(`/api/funds/${fundId}`, { method: 'PUT', body: JSON.stringify({ targetSize: -1 }) });
  assert.equal(res.status, 400);
});
