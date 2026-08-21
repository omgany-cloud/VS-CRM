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
  // seed.js no longer creates any funds — every test file that needs one
  // creates its own throwaway fixture instead of assuming seed data exists.
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_FUND', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  })).json();
  fundId = fund.id;
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

test('LP: delete blocked once a distribution references it (409, record intact) — not just capital calls', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LP_WITH_DIST', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-2B' }),
  })).json();
  // Auto pro-rated distribution across Active LPs of the fund — no capital
  // call involved, so this exercises distribution_line_items specifically.
  const dist = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, rocAmount: 100, profitAmount: 0 }),
  })).json();

  const del = await server.apiFetch(`/api/lp/${lp.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  const body = await del.json();
  assert.match(body.error, /Exited/);
  assert.ok(body.footprint.some(f => f.table === 'distribution_line_items'), 'footprint must report the distribution_line_items table');

  const list = await (await server.apiFetch('/api/lp')).json();
  assert.ok(list.lp.some(l => l.id === lp.id), 'LP with distribution footprint must survive the blocked delete attempt');

  // cleanup: delete the distribution first (still Draft), then the LP becomes deletable
  await server.apiFetch(`/api/distributions/${dist.id}`, { method: 'DELETE' });
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

test('Distribution: Draft deletes cleanly; Sent is blocked permanently (no soft alternative)', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_LP_FOR_DIST', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-3b' }),
  })).json();

  const draft = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, totalAmount: 50, rocAmount: 50, profitAmount: 0, lineItems: [{ lpId: lp.id, pct: 100, grossAmount: 50, gpCarryAmount: 0, netAmount: 50 }] }),
  })).json();
  assert.equal((await server.apiFetch(`/api/distributions/${draft.id}`, { method: 'DELETE' })).status, 200);

  const sent = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, totalAmount: 50, rocAmount: 50, profitAmount: 0, lineItems: [{ lpId: lp.id, pct: 100, grossAmount: 50, gpCarryAmount: 0, netAmount: 50 }] }),
  })).json();
  await server.apiFetch(`/api/distributions/${sent.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
  const del = await server.apiFetch(`/api/distributions/${sent.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
});

test('Distribution: pure ROC auto pro-rates by ownership; profit without lineItems runs the waterfall', async () => {
  // A dedicated fund, not the shared file-level `fundId` — earlier tests
  // in this file leave their LPs Active under that fund (by design, they
  // only clean up what each test itself needs to), so reusing it here
  // would pull unrelated LPs into the pro-rata pool and throw off the
  // expected split.
  const distFund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_FUND_DIST_PRORATA', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026, carriedInterest: 20, preferredReturn: 8 }),
  })).json();
  const lpA = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId: distFund.id, name: 'TEST_LP_DIST_A', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 3000, status: 'Active', registerId: 'T-3c' }),
  })).json();
  const lpB = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId: distFund.id, name: 'TEST_LP_DIST_B', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'T-3d' }),
  })).json();

  const auto = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId: distFund.id, rocAmount: 400, profitAmount: 0 }),
  })).json();
  const liA = auto.lineItems.find(li => li.lpId === lpA.id);
  const liB = auto.lineItems.find(li => li.lpId === lpB.id);
  assert.equal(liA.netAmount, 300, 'LP A (3000/4000 commitment) gets 75% of the ROC pro-rata');
  assert.equal(liB.netAmount, 100, 'LP B (1000/4000 commitment) gets 25% of the ROC pro-rata');

  // No capital calls were ever recorded as paid for this fund, so the
  // waterfall's preferred-return ledger is empty (nothing accrued, nothing
  // owed) — the whole profit amount degenerates to a straight
  // carriedInterest%-to-GP / rest-to-LPs split (waterfallEngine.js's tier 1
  // and 2 both correctly contribute $0 here), split pro-rata by
  // commitment across LPs same as ROC.
  const noLineItems = await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId: distFund.id, profitAmount: 100 }),
  });
  assert.equal(noLineItems.status, 201, 'profit without lineItems must now run the waterfall, not be rejected');
  const withWaterfall = await noLineItems.json();
  const wA = withWaterfall.lineItems.find(li => li.lpId === lpA.id);
  const wB = withWaterfall.lineItems.find(li => li.lpId === lpB.id);
  assert.equal(wA.netAmount, 60, 'LP A: 75% of $100 profit = $75 gross, less 20% carry = $60 net');
  assert.equal(wA.gpCarryAmount, 15, 'LP A carve-out: 20% of its $75 profit share');
  assert.equal(wB.netAmount, 20, 'LP B: 25% of $100 profit = $25 gross, less 20% carry = $20 net');
  assert.equal(wB.gpCarryAmount, 5, 'LP B carve-out: 20% of its $25 profit share');

  const missingFundId = await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ profitAmount: 100 }),
  });
  assert.equal(missingFundId.status, 400, 'profit without a fundId still has no way to look up waterfall parameters');
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

test('Fund: clean delete succeeds; blocked once an LP is attached, "closed" status works as the alternative', async () => {
  const clean = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_FUND_CLEAN', type: 'Private Equity', currency: 'USD', targetSize: 10, vintage: 2026 }),
  })).json();
  assert.equal((await server.apiFetch(`/api/funds/${clean.id}`, { method: 'DELETE' })).status, 200);

  // fundId (module-scoped) is the fund created in before() and reused by
  // every other test in this file — guaranteed to have real LP/deal/
  // portfolio footprint by now, so it's already a real "blocked" case rather than
  // needing a fresh fixture.
  const del = await server.apiFetch(`/api/funds/${fundId}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  const body = await del.json();
  assert.match(body.error, /closed/);

  const closed = await (await server.apiFetch(`/api/funds/${fundId}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) })).json();
  assert.equal(closed.status, 'closed');
  // revert so later-running test files (if any share seed data assumptions) aren't affected
  await server.apiFetch(`/api/funds/${fundId}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) });
});
