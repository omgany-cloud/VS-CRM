// Regression coverage for lp_register.calledAmount/paidAmount/distributions
// no longer being second, independently-writable sources of truth for
// figures capital_call_line_items/distribution_line_items already track.
// calledAmount/paidAmount used to be kept in sync by a client-side
// write-back PUT after every Capital Call approval and payment
// (js/lp-register.js's approveCC()/markLPPayment(), explicitly commented
// "best-effort, doesn't block" — an admission it could silently drift);
// distributions was never written to at all. Now every LP read site
// (internal API, LP portal, external API, MCP) overrides all three with a
// live SUM() from the real ledgers instead of trusting the columns.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4103 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_LIVEFIN_FUND', type: 'Private Equity', currency: 'USD', targetSize: 5, vintage: 2026 }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

test('POST/PUT /api/lp ignore caller-supplied calledAmount/paidAmount/distributions — always live-computed', async () => {
  // Deliberately wrong stale values in the body — nothing should ever
  // trust these for a brand-new LP with zero real Capital Call/
  // distribution activity.
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({
      fundId, name: 'TEST_LIVEFIN_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test',
      commitment: 1000, status: 'Active', registerId: 'LF-1',
      calledAmount: 8000, paidAmount: 8000, distributions: 5000,
    }),
  })).json();
  assert.equal(lp.calledAmount, 0, 'a fresh LP with no real Capital Calls must not echo back a caller-supplied stale figure');
  assert.equal(lp.paidAmount, 0);
  assert.equal(lp.distributions, 0);

  const putRes = await server.apiFetch(`/api/lp/${lp.id}`, {
    method: 'PUT', body: JSON.stringify({ calledAmount: 9999, paidAmount: 9999, distributions: 9999 }),
  });
  const putBody = await putRes.json();
  assert.equal(putBody.calledAmount, 0, 'PUT must not let a caller overwrite the live-computed figures either');
  assert.equal(putBody.paidAmount, 0);
  assert.equal(putBody.distributions, 0);
});

test('calledAmount only counts non-Draft Capital Calls; paidAmount only counts what was actually paid', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LIVEFIN_LP2', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LF-2' }),
  })).json();

  // Still a Draft — never sent to this LP, must not count toward calledAmount.
  const draft = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'draft', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 100, called: 400 }] }),
  })).json();
  assert.equal(draft.status, 'Draft');
  let list = await (await server.apiFetch('/api/lp')).json();
  assert.equal(list.lp.find(l => l.id === lp.id).calledAmount, 0, 'a Draft Capital Call must not count toward calledAmount');

  // Approved (Draft -> Pending): now a real cash call, counts toward
  // calledAmount even though nothing has been paid yet.
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'real', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 100, called: 600 }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  list = await (await server.apiFetch('/api/lp')).json();
  const afterApproval = list.lp.find(l => l.id === lp.id);
  assert.equal(afterApproval.calledAmount, 600, 'only the approved (non-Draft) call counts');
  assert.equal(afterApproval.paidAmount, 0, 'nothing paid yet');

  // Record the actual payment on that line item.
  await server.apiFetch(`/api/capital-calls/${cc.id}/line-items/${lp.id}`, {
    method: 'PUT', body: JSON.stringify({ paid: 600, status: 'Paid', paymentDate: '2026-01-01', wireRef: 'WIRE-1', wireConfirmUrl: 'https://example.com/wire.pdf' }),
  });
  list = await (await server.apiFetch('/api/lp')).json();
  const afterPayment = list.lp.find(l => l.id === lp.id);
  assert.equal(afterPayment.calledAmount, 600, 'unchanged — still just the one approved call');
  assert.equal(afterPayment.paidAmount, 600, 'now reflects the real payment');

  // GET /api/lp/:id/metrics sums paid-in the exact same way — the two
  // figures must agree, confirming there's only one real source of truth.
  const metrics = await (await server.apiFetch(`/api/lp/${lp.id}/metrics`)).json();
  assert.equal(metrics.paidIn, 600);
});

test('GET /api/lp reflects real distribution_line_items, not a stale column — and ignores Draft distributions', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LIVEFIN_LP3', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LF-3' }),
  })).json();

  const draft = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, rocAmount: 999, profitAmount: 0 }),
  })).json();
  assert.equal(draft.status, 'Draft');
  let list = await (await server.apiFetch('/api/lp')).json();
  assert.equal(list.lp.find(l => l.id === lp.id).distributions, 0, 'a Draft distribution must not count toward the live figure');

  const sent = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, rocAmount: 300, profitAmount: 0 }),
  })).json();
  await server.apiFetch(`/api/distributions/${sent.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });

  list = await (await server.apiFetch('/api/lp')).json();
  const expected = sent.lineItems.find(li => li.lpId === lp.id).netAmount;
  assert.ok(expected > 0, 'sanity: this LP actually has a real allocation in the Sent distribution');
  assert.equal(list.lp.find(l => l.id === lp.id).distributions, expected, 'GET /api/lp must reflect the real distribution_line_items sum');

  const metrics = await (await server.apiFetch(`/api/lp/${lp.id}/metrics`)).json();
  assert.equal(metrics.distributed, expected);
});

test('LP portal (login + /me) also reflects the live figures, not the stale columns', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_LIVEFIN_LP4', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'LF-4', email: 'livefin4@example.com' }),
  })).json();
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'portal test', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 100, called: 500 }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
  const sent = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, rocAmount: 150, profitAmount: 0 }),
  })).json();
  await server.apiFetch(`/api/distributions/${sent.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
  const expectedDist = sent.lineItems.find(li => li.lpId === lp.id).netAmount;

  const { password } = await (await server.apiFetch(`/api/lp/${lp.id}/portal-password`, { method: 'PUT' })).json();
  const login = await (await fetch(server.baseUrl + '/api/portal/lp/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'livefin4@example.com', password }),
  })).json();
  assert.equal(login.lp.calledAmount, 500, 'portal login response must show the live calledAmount');
  assert.equal(login.lp.distributions, expectedDist, 'portal login response must show the live distributions');

  const me = await (await fetch(server.baseUrl + '/api/portal/lp/me', {
    headers: { Authorization: 'Bearer ' + login.token },
  })).json();
  assert.equal(me.lp.calledAmount, 500, '/api/portal/lp/me must show the live calledAmount too');
  assert.equal(me.lp.distributions, expectedDist, '/api/portal/lp/me must show the live distributions too');
});
