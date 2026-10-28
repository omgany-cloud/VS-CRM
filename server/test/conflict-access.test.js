// Conflict decisions link only records of this company the user can open,
// a contract must belong to the linked client, FM decisions stay behind the
// FM wall, and a decided conflict keeps its client and contract (TZ 13.1 п. 7).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, other, clientA, clientB, fm, contractA, contractB;
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
async function user(role) {
  const email = `coi-${role.toLowerCase()}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'COI ' + role, role, password: 'Conflict123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'Conflict123!' }))).token };
}
const conflict = (links, token = server.token, status = 201) => api('/api/conflict-approvals', { decisionType: 'Routine Conflict', riskLevel: 'Low', ...links }, token).then(r => json(r, status));
const update = (id, body, token = server.token, status = 200) => api(`/api/conflict-approvals/${id}`, body, token, 'PUT').then(r => json(r, status));
const listed = async (token, id) => (await json(await api('/api/conflict-approvals', undefined, token))).conflictApprovals.some(c => c.id === id);
async function contract(client) {
  return json(await api('/api/engagements', { clientId: client.id, clientName: client.name, contractNum: 'COI-' + client.id, direction: client.direction, serviceType: 'Advising', status: 'Draft', feeAmount: 1 }), 201);
}

before(async () => {
  server = await createTestServer({ port: 4214, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER');
  other = await json(await api('/api/auth/signup', { companyName: 'Other coi company', name: 'Other', email: 'coi-other@test.example', password: 'Conflict123!' }), 201);
  clientA = await json(await api('/api/ob-clients', { name: 'COI client A', direction: 'CF&A' }), 201);
  clientB = await json(await api('/api/ob-clients', { name: 'COI client B', direction: 'CF&A' }), 201);
  fm = await json(await api('/api/ob-clients', { name: 'COI FM client', direction: 'FM' }), 201);
  contractA = await contract(clientA); contractB = await contract(clientB);
});
after(async () => { if (server) await server.stop(); });

test('a conflict links only open records of this company, and its contract belongs to its client', async () => {
  await conflict({ clientId: 'x' }, server.token, 400);
  await conflict({ clientId: 999999 }, server.token, 404);
  await conflict({ clientId: clientA.id }, other.token, 404);
  await conflict({ engagementId: contractA.id }, other.token, 404);
  const mismatch = await conflict({ clientId: clientA.id, engagementId: contractB.id }, server.token, 400);
  assert.match(mismatch.error, /другому клиенту/);
  const linked = await conflict({ clientId: clientA.id, engagementId: String(contractA.id) });
  assert.equal(linked.clientId, clientA.id); assert.equal(linked.engagementId, contractA.id);
  assert.equal((await conflict({ description: 'no links' })).clientId, null);
  sql("UPDATE roles SET access_fm = 0 WHERE code = 'COMPLIANCE_OFFICER'");
  try { await conflict({ clientId: fm.id }, co.token, 403); }
  finally { sql("UPDATE roles SET access_fm = 1 WHERE code = 'COMPLIANCE_OFFICER'"); }
});

test('FM decisions stay behind the FM wall; a decided conflict keeps its client and contract', async () => {
  const closed = await conflict({ clientId: fm.id });
  assert.equal(await listed(rm.token, closed.id), false); assert.equal(await listed(co.token, closed.id), true);
  await update(closed.id, { status: 'Approved' }, other.token, 404);
  sql("UPDATE roles SET access_fm = 0 WHERE code = 'COMPLIANCE_OFFICER'");
  try { await update(closed.id, { status: 'Approved' }, co.token, 404); }
  finally { sql("UPDATE roles SET access_fm = 1 WHERE code = 'COMPLIANCE_OFFICER'"); }

  const pending = await conflict({ clientId: clientA.id, engagementId: contractA.id });
  await update(pending.id, { engagementId: contractB.id }, server.token, 400);
  const corrected = await update(pending.id, { clientId: clientB.id, engagementId: contractB.id });
  assert.equal(corrected.engagementId, contractB.id);
  assert.equal((await update(pending.id, { status: 'Approved', rationale: 'Mitigated' }, co.token)).status, 'Approved');
  const locked = await update(pending.id, { clientId: clientA.id, engagementId: contractA.id }, server.token, 409);
  assert.match(locked.error, /изменить нельзя/);
  assert.equal((await update(pending.id, { rationale: 'Mitigated, documented' })).engagementId, contractB.id);
});
