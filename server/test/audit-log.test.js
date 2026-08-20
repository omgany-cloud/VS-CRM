// Coverage for server/auditLog.js — the cross-module "who/what/when"
// event feed (v1 scope: LP Register, Capital Calls, Distributions,
// Portfolio, Deals, Conflict Approvals, Engagements). Verifies real
// mutations through each module actually produce an audit_log row with
// a sensible action/summary, that GET /api/audit-log's filter and
// permission gate work, and tenant isolation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4107 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'TEST_AUDIT_FUND', type: 'Private Equity', currency: 'USD', targetSize: 5, vintage: 2026, carriedInterest: 20, preferredReturn: 8 }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

function latestEntryFor(entries, entityType, entityId) {
  return entries.find(e => e.entityType === entityType && e.entityId === entityId);
}

test('LP Register: create/update/delete each produce an audit_log entry with the right actor and action', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST',
    body: JSON.stringify({ fundId, name: 'TEST_AUDIT_LP', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'AU-1' }),
  })).json();
  await server.apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'updated' }) });
  await server.apiFetch(`/api/lp/${lp.id}`, { method: 'DELETE' });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=lp_register&entityId=${lp.id}`)).json();
  assert.equal(entries.length, 3, 'created + updated + deleted');
  const [deleted, updated, created] = entries; // DESC order, most recent first
  assert.equal(created.action, 'created');
  assert.equal(updated.action, 'updated');
  assert.equal(deleted.action, 'deleted');
  assert.equal(created.actorEmail, SEED_EMAIL);
  assert.ok(created.summary.includes('TEST_AUDIT_LP'), 'summary should name the record, not just say "created"');
});

test('Capital Calls: Draft->Pending is logged as "approved", not a generic "updated"', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_AUDIT_LP2', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'AU-2' }),
  })).json();
  const cc = await (await server.apiFetch('/api/capital-calls', {
    method: 'POST', body: JSON.stringify({ fundId, purpose: 'audit test', lineItems: [{ lpId: lp.id, commitment: 1000, pct: 100, called: 500 }] }),
  })).json();
  await server.apiFetch(`/api/capital-calls/${cc.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=capital_calls&entityId=${cc.id}`)).json();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action, 'approved', 'Draft -> Pending must log as approved, not updated');
  assert.equal(entries[1].action, 'created');
});

test('Distributions: created -> approved -> paid all log distinctly', async () => {
  const lp = await (await server.apiFetch('/api/lp', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_AUDIT_LP3', type: 'Юридическое лицо', lpType: 'Institution', country: 'Test', commitment: 1000, status: 'Active', registerId: 'AU-3' }),
  })).json();
  const dist = await (await server.apiFetch('/api/distributions', {
    method: 'POST', body: JSON.stringify({ fundId, rocAmount: 200, profitAmount: 0 }),
  })).json();
  await server.apiFetch(`/api/distributions/${dist.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
  const li = dist.lineItems.find(x => x.lpId === lp.id) || dist.lineItems[0];
  await server.apiFetch(`/api/distributions/${dist.id}/line-items/${li.lpId}`, {
    method: 'PUT', body: JSON.stringify({ status: 'Confirmed', wireRef: 'W-1', wireConfirmUrl: 'https://example.com/w.pdf', paymentDate: '2026-01-01' }),
  });
  await server.apiFetch(`/api/distributions/${dist.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Paid' }) });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=distributions&entityId=${dist.id}`)).json();
  const actions = entries.map(e => e.action).reverse(); // chronological
  assert.deepEqual(actions, ['created', 'approved', 'paid']);
});

test('Portfolio: archive/restore log distinctly from a generic update', async () => {
  const port = await (await server.apiFetch('/api/portfolio', {
    method: 'POST', body: JSON.stringify({ fundId, name: 'TEST_AUDIT_PORTCO', sector: 'Tech', invested: 0, value: 0 }),
  })).json();
  await server.apiFetch(`/api/portfolio/${port.id}`, { method: 'PUT', body: JSON.stringify({ sector: 'Fintech' }) });
  await server.apiFetch(`/api/portfolio/${port.id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=portfolio&entityId=${port.id}`)).json();
  const actions = entries.map(e => e.action).reverse();
  assert.deepEqual(actions, ['created', 'updated', 'archived']);
});

test('Deals: stage transitions log as "stage_changed"', async () => {
  const deal = await (await server.apiFetch('/api/deals', {
    method: 'POST', body: JSON.stringify({ fundId, company: 'TEST_AUDIT_DEAL', sector: 'Test', amount: 1 }),
  })).json();
  await server.apiFetch(`/api/deals/${deal.id}`, { method: 'PUT', body: JSON.stringify({ stage: 'Отклонена' }) });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=deals&entityId=${deal.id}`)).json();
  assert.equal(entries[0].action, 'stage_changed');
  assert.ok(entries[0].summary.includes('Скрининг') && entries[0].summary.includes('Отклонена'), 'summary should show old -> new stage');
});

test('Conflict Approvals: a resolved decision logs as "decided"', async () => {
  const conflict = await (await server.apiFetch('/api/conflict-approvals', {
    method: 'POST', body: JSON.stringify({ decisionType: 'Routine Conflict', riskLevel: 'Low', description: 'audit test' }),
  })).json();
  await server.apiFetch(`/api/conflict-approvals/${conflict.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Approved' }) });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=conflict_approvals&entityId=${conflict.id}`)).json();
  const actions = entries.map(e => e.action).reverse();
  assert.deepEqual(actions, ['created', 'decided']);
});

test('Engagements: create/status-change/delete each log distinctly', async () => {
  const eng = await (await server.apiFetch('/api/engagements', {
    method: 'POST', body: JSON.stringify({ clientName: 'TEST_AUDIT_ENG', serviceType: 'Advisory', direction: 'CFA', status: 'Draft' }),
  })).json();
  await server.apiFetch(`/api/engagements/${eng.id}`, { method: 'PUT', body: JSON.stringify({ status: 'Active' }) });
  await server.apiFetch(`/api/engagements/${eng.id}`, { method: 'DELETE' });

  const { entries } = await (await server.apiFetch(`/api/audit-log?entityType=engagements&entityId=${eng.id}`)).json();
  const actions = entries.map(e => e.action).reverse();
  assert.deepEqual(actions, ['created', 'status_changed', 'deleted']);
});

test('GET /api/audit-log is gated on manageUsers, and results are tenant-isolated', async () => {
  // A role without manageUsers (RM) must be rejected.
  const rmEmail = 'audit-rm@example.com';
  await server.apiFetch('/api/users', {
    method: 'POST', body: JSON.stringify({ email: rmEmail, password: 'AuditTest2026!', role: 'RELATIONSHIP_MANAGER', name: 'TEST_RM_AUDIT' }),
  });
  let login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rmEmail, password: 'AuditTest2026!' }),
  })).json();
  const asRm = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) } });
  await asRm('/api/users/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword: 'AuditTest2026!', newPassword: 'MyOwnPass789!' }) });
  login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rmEmail, password: 'MyOwnPass789!' }),
  })).json();
  const rmRes = await asRm('/api/audit-log');
  assert.equal(rmRes.status, 403);

  // Tenant isolation: a fresh tenant B must never see tenant A's entries.
  const signupRes = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Audit Isolation Co', name: 'Tenant B Admin', email: 'tenantb-audit@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signupRes.status, 201);
  const { token: bToken } = await signupRes.json();
  const bRes = await fetch(server.baseUrl + '/api/audit-log', { headers: { Authorization: 'Bearer ' + bToken } });
  assert.equal(bRes.status, 200);
  const bBody = await bRes.json();
  assert.equal(bBody.entries.length, 0, 'a brand-new tenant must see none of tenant A\'s audit history');
});
