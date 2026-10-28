// /api/workflow (KYC, NAV approval chains) respects the record behind each
// chain: it must exist in the company, be open to the requester, and FM
// chains stay behind the FM wall in lists, decisions, withdrawals and emails.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, other, fund, lp, nav, cfa, fm;
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
function rows(query, ...args) { const db = new DatabaseSync(server.dbPath, { readOnly: true }); try { return db.prepare(query).all(...args); } finally { db.close(); } }
async function user(role) {
  const email = `wf-${role.toLowerCase()}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'WF ' + role, role, password: 'Workflow123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, email, token: (await json(await api('/api/auth/login', { email, password: 'Workflow123!' }))).token };
}
const start = (type, entityId, token, extra = {}) => api('/api/workflow', { type, entityId, entityName: 'Forged name', entityType: 'Forged', ...extra }, token);
const listed = async (token, id) => (await json(await api('/api/workflow', undefined, token))).workflowInstances.some(w => w.id === id);
const waitFor = async (check) => { for (let i = 0; i < 40; i++) { const found = check(); if (found.length) return found; await new Promise(r => setTimeout(r, 50)); } return check(); };

before(async () => {
  server = await createTestServer({ port: 4212, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER');
  other = await json(await api('/api/auth/signup', { companyName: 'Other wf company', name: 'Other', email: 'wf-other@test.example', password: 'Workflow123!' }), 201);
  fund = await json(await api('/api/funds', { name: 'WF Fund', shortName: 'WFF', assetClass: 'hedge_fund' }), 201);
  lp = await json(await api('/api/lp', { fundId: fund.id, name: 'WF LP', type: 'x', lpType: 'Institution', country: 'x', commitment: 1000, status: 'Active', registerId: 'WF-1' }), 201);
  nav = await json(await api('/api/hf/nav', { fundId: fund.id, asOfDate: '2026-01-01', grossAssetValue: 100000, liabilities: 0, unitsOutstanding: 1000 }), 201);
  cfa = await json(await api('/api/ob-clients', { name: 'WF CF&A client', direction: 'CF&A' }), 201);
  fm = await json(await api('/api/ob-clients', { name: 'WF FM client', direction: 'FM' }), 201);
});
after(async () => { if (server) await server.stop(); });

test('a chain needs an existing record open to the requester, and the record names it', async () => {
  await json(await start('kyc_lp', undefined), 400);
  await json(await start('kyc_lp', 'abc'), 400);
  await json(await start('kyc_lp', 999999), 404);
  await json(await start('kyc_lp', lp.id, other.token), 404);
  await json(await start('kyc_lp', lp.id, rm.token), 403);
  await json(await start('kyc_cfa', fm.id), 400);
  await json(await start('kyc_cfa', fm.id, rm.token), 403);

  const kyc = await json(await start('kyc_cfa', cfa.id, rm.token), 201);
  assert.equal(kyc.entityId, cfa.id); assert.equal(kyc.entityName, 'WF CF&A client'); assert.equal(kyc.entityType, 'CF&A');
  assert.equal((await json(await start('kyc_cfa', String(cfa.id), rm.token))).id, kyc.id, 'a repeat finds the same active chain');
  const navChain = await json(await start('nav_publish', nav.id), 201);
  assert.match(navChain.entityName, /^NAV WFF на 2026-01-01$/); assert.equal(navChain.entityType, 'HfNav');
  const lpChain = await json(await start('kyc_lp', lp.id), 201);
  assert.equal(lpChain.entityName, 'WF LP'); assert.equal(lpChain.entityType, 'LP');
});

test('FM chains stay behind the FM wall in the list, decisions, withdrawal and step emails', async () => {
  const lp2 = await json(await api('/api/lp', { fundId: fund.id, name: 'WF LP 2', type: 'x', lpType: 'Institution', country: 'x', commitment: 1000, status: 'Active', registerId: 'WF-2' }), 201);
  const chain = await json(await start('kyc_lp', lp2.id), 201);
  const kyc = (await json(await api('/api/workflow', undefined, rm.token))).workflowInstances.find(w => w.type === 'kyc_cfa');
  assert.ok(kyc, 'RM still sees the CF&A KYC of a client they can open');
  assert.equal(await listed(rm.token, chain.id), false); assert.equal(await listed(co.token, chain.id), true);
  await json(await api(`/api/workflow/${chain.id}`, { decision: 'approved' }, rm.token, 'PUT'), 404);
  await json(await api(`/api/workflow/${chain.id}/withdraw`, {}, rm.token), 404);
  await json(await api(`/api/workflow/${chain.id}`, { decision: 'approved' }, other.token, 'PUT'), 404);
  const notified = await waitFor(() => rows("SELECT recipient_email FROM notification_log WHERE event_type = 'workflow_step_assigned:0' AND entity_id = ?", chain.id));
  assert.deepEqual(notified.map(r => r.recipient_email), [co.email]);

  // The step role alone is not enough once that role loses FM access.
  sql("UPDATE roles SET access_fm = 0 WHERE code = 'COMPLIANCE_OFFICER'");
  try {
    assert.equal(await listed(co.token, chain.id), false);
    await json(await api(`/api/workflow/${chain.id}`, { decision: 'approved' }, co.token, 'PUT'), 404);
    const lp3 = await json(await api('/api/lp', { fundId: fund.id, name: 'WF LP 3', type: 'x', lpType: 'Institution', country: 'x', commitment: 1000, status: 'Active', registerId: 'WF-3' }), 201);
    const hidden = await json(await start('kyc_lp', lp3.id), 201);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(rows("SELECT id FROM notification_log WHERE event_type = 'workflow_step_assigned:0' AND entity_id = ?", hidden.id).length, 0);
  } finally { sql("UPDATE roles SET access_fm = 1 WHERE code = 'COMPLIANCE_OFFICER'"); }
  const decided = await json(await api(`/api/workflow/${chain.id}`, { decision: 'approved' }, co.token, 'PUT'));
  assert.equal(decided.currentStep, 1);
});
