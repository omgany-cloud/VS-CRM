// VC module (docs/TZ_VC_Module.md) — cap table CRUD on portfolio_rounds/
// portfolio_round_investors. Focus: ownership_pct_post is server-computed
// (never trusts a client-supplied value) and represents "stake purchased
// in that specific round, as % of the company at that round's post-money"
// — while fundOwnershipPct is the separate, genuinely dilution-aware
// number (the fund's own stake carried forward and diluted through every
// later round's pre/post-money ratio). See §2.2 of the TZ for why these
// are two different numbers on purpose.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId, portfolioId;

before(async () => {
  server = await createTestServer({ port: 4117 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'VC_TEST_FUND', assetClass: 'vc' }),
  })).json();
  fundId = fund.id;
  const portfolio = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'VC_TEST_CO', sector: 'SaaS', invested: 0, value: 0 }),
  })).json();
  portfolioId = portfolio.id;
});

after(async () => { await server.stop(); });

test('POST a round with investors computes ownership_pct_post from that round\'s post-money, ignoring any client-supplied value', async () => {
  const res = await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`, {
    method: 'POST',
    body: JSON.stringify({
      roundName: 'Seed', roundDate: '2025-01-01', preMoney: 4000000, postMoney: 5000000, amountRaised: 1000000,
      investors: [
        { investorName: 'VC_TEST_FUND', isOwnFund: true, amount: 500000, ownershipPctPost: 999 }, // 999 must be ignored
        { investorName: 'Angel X', amount: 500000 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  const fundInvestor = body.round.investors.find(i => i.investorName === 'VC_TEST_FUND');
  const angel = body.round.investors.find(i => i.investorName === 'Angel X');
  assert.equal(fundInvestor.ownershipPctPost, 10); // 500000 / 5000000 * 100
  assert.equal(angel.ownershipPctPost, 10);
  assert.equal(body.fundOwnershipPct, 10);
});

test('a second round dilutes fundOwnershipPct by pre/post-money, but does not retroactively change round 1\'s stored per-round pct', async () => {
  const res = await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`, {
    method: 'POST',
    body: JSON.stringify({
      roundName: 'Series A', roundDate: '2025-06-01', preMoney: 10000000, postMoney: 13000000, amountRaised: 3000000,
      investors: [{ investorName: 'New VC', amount: 3000000 }],
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  // 10% carried from Seed, diluted by 10,000,000/13,000,000
  assert.ok(Math.abs(body.fundOwnershipPct - 10 * (10000000 / 13000000)) < 1e-6);
  const newVc = body.round.investors.find(i => i.investorName === 'New VC');
  assert.ok(Math.abs(newVc.ownershipPctPost - (3000000 / 13000000) * 100) < 1e-6);

  const list = await (await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`)).json();
  const seedRound = list.rounds.find(r => r.roundName === 'Seed');
  const seedFundInvestor = seedRound.investors.find(i => i.investorName === 'VC_TEST_FUND');
  assert.equal(seedFundInvestor.ownershipPctPost, 10); // unchanged — see file header
  assert.ok(Math.abs(list.fundOwnershipPct - 10 * (10000000 / 13000000)) < 1e-6);
});

test('PUT replaces a round\'s investors wholesale and recomputes fundOwnershipPct', async () => {
  const list = await (await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`)).json();
  const seedRound = list.rounds.find(r => r.roundName === 'Seed');

  const res = await server.apiFetch(`/api/portfolio/rounds/${seedRound.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      postMoney: 5000000,
      investors: [{ investorName: 'VC_TEST_FUND', isOwnFund: true, amount: 1000000 }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.round.investors.length, 1);
  assert.equal(body.round.investors[0].ownershipPctPost, 20); // 1,000,000 / 5,000,000 * 100
});

test('DELETE removes the round and its investors, and recomputes remaining fundOwnershipPct', async () => {
  const list = await (await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`)).json();
  const seriesA = list.rounds.find(r => r.roundName === 'Series A');
  const del = await server.apiFetch(`/api/portfolio/rounds/${seriesA.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const after2 = await (await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`)).json();
  assert.equal(after2.rounds.length, 1);
  assert.equal(after2.fundOwnershipPct, 20); // back to the (edited) Seed-only stake, no more dilution
});

test('roundName is required', async () => {
  const res = await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`, { method: 'POST', body: JSON.stringify({ investors: [] }) });
  assert.equal(res.status, 400);
});

test('Tenant isolation: rounds are invisible and unreachable from a fresh tenant', async () => {
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ VC Isolation Co', name: 'Tenant B Admin', email: 'tenantb-vc@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token } = await signupRes.json();
  const bFetch = (pathname, opts = {}) => fetch(server.baseUrl + pathname, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  assert.equal((await bFetch(`/api/portfolio/${portfolioId}/rounds`)).status, 404);
  const list = await (await server.apiFetch(`/api/portfolio/${portfolioId}/rounds`)).json();
  const roundId = list.rounds[0].id;
  assert.equal((await bFetch(`/api/portfolio/rounds/${roundId}`, { method: 'DELETE' })).status, 404);
});
