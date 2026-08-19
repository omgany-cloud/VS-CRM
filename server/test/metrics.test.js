// Integration coverage for GET /api/funds/:id/metrics and
// GET /api/lp/:id/metrics — the actual routes, real HTTP, real DB, same
// style as every other server/test/*.js file (see helpers.js's header for
// why this project tests this way).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;

before(async () => { server = await createTestServer({ port: 4102 }); });
after(async () => { await server.stop(); });

test('Fund/LP metrics: null across the board for a brand-new fund with no cash flows yet', async () => {
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_METRICS_EMPTY', type: 'Private Equity', currency: 'USD', targetSize: 5, vintage: 2026, carriedInterest: 20, preferredReturn: 8 }),
  })).json();
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'TEST_METRICS_LP_EMPTY', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'M-1' }),
  })).json();

  const fundMetrics = await (await server.apiFetch(`/api/funds/${fund.id}/metrics`)).json();
  assert.equal(fundMetrics.dpi, null);
  assert.equal(fundMetrics.rvpi, null);
  assert.equal(fundMetrics.tvpi, null);
  assert.equal(fundMetrics.irr, null);

  const lpMetrics = await (await server.apiFetch(`/api/lp/${lp.id}/metrics`)).json();
  assert.equal(lpMetrics.dpi, null);
  assert.equal(lpMetrics.paidIn, 0);
});

test('Fund/LP metrics: real numbers once capital is called, distributed, and portfolio value exists', async () => {
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_METRICS_FUND', type: 'Private Equity', currency: 'USD', targetSize: 5, vintage: 2026, carriedInterest: 20, preferredReturn: 8 }),
  })).json();
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'TEST_METRICS_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'M-2' }),
  })).json();

  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST',
    body: JSON.stringify({ fundId: fund.id, purpose: 'metrics test', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 100, called: 1000, paid: 1000, paymentDate: '2025-01-01' }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });

  const dist = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId: fund.id, rocAmount: 200, profitAmount: 0, paymentDate: '2025-12-31' }),
  })).json();
  await server.apiFetch(`/api/distributions/${dist.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });

  await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId: fund.id, name: 'TEST_METRICS_PORTCO', sector: 'Tech', invested: 800, value: 1000 }),
  });

  const fundMetrics = await (await server.apiFetch(`/api/funds/${fund.id}/metrics`)).json();
  assert.equal(fundMetrics.paidIn, 1000);
  assert.equal(fundMetrics.distributed, 200);
  assert.equal(fundMetrics.residualValue, 1000);
  assert.ok(Math.abs(fundMetrics.dpi - 0.2) < 0.001);
  assert.ok(Math.abs(fundMetrics.rvpi - 1.0) < 0.001);
  assert.ok(Math.abs(fundMetrics.tvpi - 1.2) < 0.001);
  assert.notEqual(fundMetrics.irr, null);

  // Single-LP fund: LP-level metrics should equal fund-level exactly
  // (100% pro-rata share of both cash flows and residual value).
  const lpMetrics = await (await server.apiFetch(`/api/lp/${lp.id}/metrics`)).json();
  assert.equal(lpMetrics.paidIn, fundMetrics.paidIn);
  assert.equal(lpMetrics.distributed, fundMetrics.distributed);
  assert.equal(lpMetrics.residualValue, fundMetrics.residualValue);
});

test('Fund metrics: 404 for a fund id outside this tenant/not found', async () => {
  const res = await server.apiFetch('/api/funds/999999/metrics');
  assert.equal(res.status, 404);
});

test('LP metrics: 404 for an LP id outside this tenant/not found', async () => {
  const res = await server.apiFetch('/api/lp/999999/metrics');
  assert.equal(res.status, 404);
});
