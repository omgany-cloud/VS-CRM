// Regression coverage for the "field" key on 400 responses (QA P3 audit
// finding: "Field-level ошибок нет вообще"), scoped to the 4 forms named
// as highest-value (LP, Deal, Portfolio, Capital Call — fund and SPV
// mirror). js/api-auth.js's apiFetch() attaches this to the thrown
// Error as err.field; js/app.js's showFieldError()/clearFieldErrors()
// use it to highlight the actual input — those are DOM-only and covered
// here only at the API-contract level (does the server actually send
// `field`), not via a browser.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4139 });
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'FIELDERR_FUND' }) })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('Deal: missing company reports field: "company"', async () => {
  const res = await server.apiFetch('/api/deals', { method: 'POST', body: JSON.stringify({ fundId }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'company');
});

test('Portfolio: missing name reports field: "name"', async () => {
  const res = await server.apiFetch('/api/portfolio', { method: 'POST', body: JSON.stringify({ fundId }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'name');
});

test('Portfolio: a negative invested reports field: "invested"', async () => {
  const res = await server.apiFetch('/api/portfolio', { method: 'POST', body: JSON.stringify({ fundId, name: 'FIELDERR_PORT', invested: -1, value: 0 }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'invested');
});

test('LP: missing name reports field: "name"', async () => {
  const res = await server.apiFetch('/api/lp', { method: 'POST', body: JSON.stringify({ fundId }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'name');
});

test('LP: a negative commitment reports field: "commitment"', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'FIELDERR_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: -1, status: 'Active', registerId: 'FE-1' }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'commitment');
});

test('LP: an invalid obClientId reports field: "obClientId"', async () => {
  const res = await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'FIELDERR_LP2', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1, status: 'Active', registerId: 'FE-2', obClientId: 999999 }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'obClientId');
});

test('Capital Call: missing purpose reports field: "purpose"', async () => {
  const res = await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'purpose');
});

test('Capital Call: Draft -> Pending with a bad noticeDate reports field: "noticeDate"', async () => {
  const cc = await (await server.apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify({ fundId, purpose: 'field test', totalAmount: 1000 }) })).json();
  const res = await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending', noticeDate: 'garbage' }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'noticeDate');
});

test('SPV Capital Call: missing purpose reports field: "purpose"', async () => {
  const spv = await (await server.apiFetch('/api/spvs', { method: 'POST', body: JSON.stringify({ fundId, name: 'FIELDERR_SPV' }) })).json();
  const res = await server.apiFetch(`/api/spvs/${spv.id}/capital-calls`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'purpose');
});
