// Multi-strategy foundation (docs/ARCHITECTURE_Multi_Strategy_Roadmap.md
// §3, docs/TZ_Hedge_Fund_Module.md Stage 0) — funds.assetClass is
// client-settable, funds.operatingModel is DERIVED from it server-side
// and must never be settable directly, since every future engine
// (waterfallEngine.js for closed-end, the not-yet-built
// performanceFeeEngine.js for open-end) branches on operatingModel.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

test('Fund asset class / operating model', async (t) => {
  const server = await createTestServer({ port: 4108 });
  t.after(() => server.stop());

  await t.test('a fund created with no assetClass defaults to pe/closed-end', async () => {
    const res = await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'Default Class Fund' }) });
    assert.equal(res.status, 201);
    const fund = await res.json();
    assert.equal(fund.assetClass, 'pe');
    assert.equal(fund.operatingModel, 'closed-end');
  });

  await t.test('a hedge_fund asset class derives operating_model open-end', async () => {
    const res = await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'HF Fund', assetClass: 'hedge_fund' }) });
    assert.equal(res.status, 201);
    const fund = await res.json();
    assert.equal(fund.assetClass, 'hedge_fund');
    assert.equal(fund.operatingModel, 'open-end');
  });

  await t.test('an unknown assetClass is rejected', async () => {
    const res = await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'Bad Class Fund', assetClass: 'crypto' }) });
    assert.equal(res.status, 400);
  });

  await t.test('a client cannot set operatingModel directly — it is always re-derived from assetClass', async () => {
    const res = await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'Spoof Fund', assetClass: 'pe', operatingModel: 'open-end' }) });
    assert.equal(res.status, 201);
    const fund = await res.json();
    assert.equal(fund.operatingModel, 'closed-end', 'operatingModel must be derived from assetClass, not trusted from the request body');
  });

  await t.test('PUT changing assetClass re-derives operatingModel', async () => {
    const created = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'Convert Me', assetClass: 'pe' }) })).json();
    assert.equal(created.operatingModel, 'closed-end');

    const updated = await (await server.apiFetch(`/api/funds/${created.id}`, { method: 'PUT', body: JSON.stringify({ assetClass: 'hedge_fund' }) })).json();
    assert.equal(updated.assetClass, 'hedge_fund');
    assert.equal(updated.operatingModel, 'open-end');
  });

  await t.test('PUT with no assetClass in the body keeps the existing one and its derived operatingModel', async () => {
    const created = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'Untouched Class', assetClass: 'reit' }) })).json();
    const updated = await (await server.apiFetch(`/api/funds/${created.id}`, { method: 'PUT', body: JSON.stringify({ targetSize: 42 }) })).json();
    assert.equal(updated.assetClass, 'reit');
    assert.equal(updated.operatingModel, 'closed-end');
    assert.equal(updated.targetSize, 42);
  });
});
