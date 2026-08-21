// VC module (docs/TZ_VC_Module.md §3) — GET /api/spvs/:id/metrics must
// use the SPV's OWN carriedInterestPct/preferredReturnPct/catchUpPct
// (reusing server/waterfallEngine.js at the profit-split step, and
// server/metricsEngine.js's generic computeMetrics for IRR/DPI/RVPI/TVPI)
// — never the parent fund's. The fund here is deliberately configured
// with different economics than the SPV so a bug that mixed them up
// would produce a visibly wrong carry split.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, spvId, portfolioId, inv;

before(async () => {
  server = await createTestServer({ port: 4120 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST',
    body: JSON.stringify({ name: 'SPV_METRICS_FUND', assetClass: 'vc', carriedInterest: 20, preferredReturn: 8 }),
  })).json();
  fundId = fund.id;
  const portfolio = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'SPV_METRICS_CO', invested: 100000, value: 200000 }),
  })).json();
  portfolioId = portfolio.id;
  const spv = await (await server.apiFetch('/api/spvs', {
    method: 'POST',
    body: JSON.stringify({ fundId, portfolioId, name: 'Metrics SPV', carriedInterestPct: 10, preferredReturnPct: 0, catchUpPct: 100 }),
  })).json();
  spvId = spv.id;
  inv = await (await server.apiFetch(`/api/spvs/${spvId}/investors`, { method: 'POST', body: JSON.stringify({ name: 'Metrics Investor', commitment: 100000 }) })).json();
});

after(async () => { await server.stop(); });

test('metrics are null across the board before any real cash flow', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/metrics`);
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.dpi, null);
  assert.equal(m.rvpi, null);
  assert.equal(m.tvpi, null);
  assert.equal(m.irr, null);
});

test('a profit distribution carries at the SPV\'s own 10% rate, not the parent fund\'s 20%', async () => {
  const cc = await (await server.apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose: 'Investment', totalAmount: 100000 }) })).json();
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  await server.apiFetch(`/api/spv-capital-calls/${cc.id}/line-items/${inv.id}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Paid', paid: 100000, paymentDate: '2025-01-01', wireRef: 'WR-M1', wireConfirmUrl: 'https://example.com/m1.pdf' }),
  });

  // preferredReturnPct=0 -> the whole 100,000 profit runs straight through
  // to the final carry tier: GP gets exactly carriedInterestPct% of it.
  const dist = await (await server.apiFetch(`/api/spvs/${spvId}/distributions`, {
    method: 'POST', body: JSON.stringify({ profitAmount: 100000, paymentDate: '2025-06-01' }),
  })).json();
  // Metrics only count non-Draft distributions (same "Draft is not a real
  // cash flow yet" rule as the fund-level Distributions module) — send it.
  await server.apiFetch(`/api/spv-distributions/${dist.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
  const li = dist.lineItems[0];
  assert.equal(li.grossAmount, 100000);
  assert.equal(li.gpCarryAmount, 10000); // 10% of profit — the SPV's own rate
  assert.equal(li.netAmount, 90000);
});

test('GET metrics reflects the real paid-in/distributed ledger and a residual value prorated from the linked portfolio company', async () => {
  const res = await server.apiFetch(`/api/spvs/${spvId}/metrics`);
  const m = await res.json();
  assert.equal(m.paidIn, 100000);
  assert.equal(m.distributed, 90000);
  // portfolio.invested=100000, portfolio.value=200000, SPV paid-in=100000
  // -> spvInvested/portfolio.invested = 1 -> residualValue = 200000.
  assert.equal(m.residualValue, 200000);
  assert.ok(m.dpi > 0);
  assert.ok(m.tvpi > m.dpi); // residual value adds on top of DPI
});

test('404 for an SPV id outside this tenant/not found', async () => {
  const res = await server.apiFetch('/api/spvs/999999/metrics');
  assert.equal(res.status, 404);
});
