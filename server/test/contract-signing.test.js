const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, cfo, auditor, other;
const key = () => crypto.randomUUID();
const PDF = text => Buffer.from('%PDF-1.4\n' + text);
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `signing-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Signing ' + role, role, password: 'SigningTest123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'SigningTest123!' }))).token };
}
function multipart(url, fields, file, token) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  if (file) form.append('file', new Blob([file.bytes]), file.name);
  return fetch(server.baseUrl + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
async function onboarding(client, { conflict = 'Go', conflictStatus = 'completed', kyc = 'Одобрить — Approve', kycStatus = 'completed' } = {}) {
  await json(await api('/api/ob-tasks', { clientId: client.id, tasks: [
    { taskNum: '1.1', title: 'Conflict Pre-Check', phase: 1, role: 'RM', formKey: 'conflict_precheck', status: conflictStatus, formData: { f_decision: conflict, decision: conflict } },
    { taskNum: '2.2', title: 'DD Outcome', phase: 2, role: 'CO', formKey: 'dd_outcome', status: kycStatus, formData: { f_conclusion: kyc, conclusion: kyc } },
  ] }), 201);
}
async function setTask(client, number, status, formData) {
  const task = (await json(await api('/api/onboarding'))).obTasks.find(t => t.clientId === client.id && t.taskNum === number);
  await json(await api(`/api/ob-tasks/${task.id}`, { status, formData }, server.token, 'PUT'));
}
// Draft contract with an uploaded revision, approved by two colleagues.
async function approvedContract({ direction = 'CF&A', checks = {}, approve = true } = {}) {
  const author = direction === 'FM' ? server : rm;
  const client = await json(await api('/api/ob-clients', { name: 'Signing client', direction }), 201);
  if (checks) await onboarding(client, checks);
  const e = await json(await api('/api/engagements', { clientId: client.id, clientName: client.name, contractNum: 'SIGN-' + key().slice(0, 8),
    direction, serviceType: direction === 'FM' ? 'LP Investment (FM)' : 'Advising', status: 'Draft', feeAmount: 100, date: '2026-10-01' }), 201);
  await json(await multipart(`/api/engagements/${e.id}/versions`, { expectedVersion: 0, changeNote: 'Initial' }, { bytes: PDF('terms ' + e.id), name: 'contract.pdf' }, author.token), 201);
  if (!approve) return { e, client };
  const cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null,
    participants: [co.id, cfo.id], dueDays: 3, requestKey: key() }, author.token), 201)).cycle;
  for (const reviewer of [co, cfo]) {
    await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: cycle.revision,
      stepId: cycle.steps.find(s => s.userId === reviewer.id).id, decision: 'approved', comment: '', requestKey: key() }, reviewer.token));
  }
  return { e, client, cycle };
}
function signing(e, token = server.token) { return api(`/api/engagements/${e.id}/signing`, undefined, token); }
function register(e, state, { date = '2026-10-20', bytes = PDF('signed ' + e.id), name = 'signed.pdf', requestKey = key(), token = rm.token } = {}) {
  return multipart(`/api/engagements/${e.id}/signatures`, { signedDate: date, expectedCycleId: state.approvedVersion?.cycleId ?? 999, requestKey }, { bytes, name }, token);
}
function activate(e, state, token = rm.token, requestKey = key()) {
  return api(`/api/engagements/${e.id}/activation`, { expectedSignatureId: state.signature?.id ?? 999, requestKey }, token);
}
function engagementRow(id) {
  const db = new DatabaseSync(server.dbPath, { readOnly: true });
  try { return db.prepare('SELECT status, signed_date, activation_date, activated_by FROM engagements WHERE id = ?').get(id); } finally { db.close(); }
}

before(async () => {
  server = await createTestServer({ port: 4210, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO'); auditor = await user('AUDITOR');
  other = await json(await api('/api/auth/signup', { companyName: 'Other signing company', name: 'Other owner', email: 'signing-other@test.example', password: 'SigningTest123!' }), 201);
});
after(async () => { if (server) await server.stop(); });

test('approved revision is signed with a PDF, then work starts only through the checked command', async () => {
  const { e, cycle } = await approvedContract();
  let state = await json(await signing(e, rm.token));
  assert.equal(state.canRegister, true); assert.equal(state.canActivate, false);
  assert.equal(state.approvedVersion.cycleId, cycle.id); assert.equal(state.approvedVersion.version, 1);
  assert.deepEqual(state.readiness.conditions.map(c => [c.key, c.state]), [['signature', 'pending'], ['kyc', 'done'], ['conflict', 'done']]);
  await json(await activate(e, state), 409);

  const requestKey = key();
  state = await json(await register(e, state, { requestKey }), 201);
  assert.equal(state.signature.signedDate, '2026-10-20'); assert.equal(state.signature.version, 1);
  assert.equal(state.readiness.ready, true); assert.equal(state.canActivate, true); assert.equal(state.canRegister, false);
  assert.equal(engagementRow(e.id).signed_date, '2026-10-20');
  // Retry of the same upload returns the recorded registration instead of a duplicate.
  const replay = await json(await register(e, { approvedVersion: { cycleId: cycle.id } }, { requestKey }));
  assert.equal(replay.reused, true); assert.equal(replay.signature.id, state.signature.id);
  await json(await register(e, state, { requestKey, date: '2026-10-21' }), 409);

  const file = await fetch(server.baseUrl + `/api/engagements/${e.id}/signatures/${state.signature.id}/file`, { headers: { Authorization: 'Bearer ' + co.token } });
  assert.equal(file.status, 200); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF('signed ' + e.id));

  const activationKey = key();
  const started = await json(await activate(e, state, rm.token, activationKey));
  assert.equal(started.serviceStatus, 'Active'); assert.equal(started.activation.by, 'Signing RELATIONSHIP_MANAGER');
  assert.ok(started.activation.conditions.every(c => c.state === 'done'));
  assert.equal(engagementRow(e.id).status, 'Active');
  assert.equal((await json(await activate(e, state, rm.token, activationKey))).reused, true);
  await json(await activate(e, state), 409);
  const actions = (await json(await api(`/api/audit-log?entityType=engagements&entityId=${e.id}`))).entries.map(x => x.action);
  assert.ok(actions.includes('contract_signed') && actions.includes('contract_activated'));
});

test('ordinary create and edit cannot start work or change signature dates', async () => {
  const { e } = await approvedContract();
  await json(await api('/api/engagements', { clientName: 'Bypass', direction: 'CF&A', status: 'Active' }), 409);
  await json(await api('/api/engagements', { clientName: 'Bypass', direction: 'CF&A', status: 'Draft', signedDate: '2026-10-01' }), 409);
  await json(await api(`/api/engagements/${e.id}`, { status: 'Active' }, rm.token, 'PUT'), 409);
  await json(await api(`/api/engagements/${e.id}`, { signedDate: '2026-10-01' }, rm.token, 'PUT'), 409);
  await json(await api(`/api/engagements/${e.id}`, { activationDate: '2026-10-01' }, rm.token, 'PUT'), 409);
  let state = await json(await signing(e));
  state = await json(await register(e, state), 201);
  const full = (await json(await api('/api/onboarding'))).engagements.find(x => x.id === e.id);
  // A full card round-trip with unchanged evidence still saves non-contract fields.
  const saved = await json(await api(`/api/engagements/${e.id}`, { ...full, notes: 'Saved note' }, rm.token, 'PUT'));
  assert.equal(saved.notes, 'Saved note'); assert.equal(saved.signedDate, '2026-10-20');
  await json(await api(`/api/engagements/${e.id}`, { ...full, signedDate: null }, rm.token, 'PUT'), 409);
});

test('registration validates approval, PDF, date and rights', async () => {
  const { e: draft } = await approvedContract({ approve: false });
  const draftState = await json(await signing(draft));
  assert.equal(draftState.canRegister, false); assert.equal(draftState.approvedVersion, null);
  assert.equal(draftState.readiness.conditions[0].detail, 'Текущая редакция не согласована');
  await json(await register(draft, draftState), 409);

  const { e } = await approvedContract();
  const state = await json(await signing(e));
  await json(await register(e, state, { name: 'signed.docx' }), 400);
  await json(await register(e, state, { bytes: Buffer.from('not a pdf'), name: 'fake.pdf' }), 400);
  await json(await register(e, state, { date: '2026-02-30' }), 400);
  await json(await register(e, state, { date: '2999-01-01' }), 400);
  await json(await register(e, state, { token: co.token }), 403);
  await json(await register(e, state, { token: auditor.token }), 403);
  assert.equal((await json(await signing(e, co.token))).canRegister, false);
  await json(await signing(e, other.token), 404);
  await json(await register(e, state, { token: other.token }), 404);
  await json(await api(`/api/engagements/${e.id}/activation`, { expectedSignatureId: 1, requestKey: key() }, co.token), 403);
});

test('KYC and conflict decisions gate the start of work; escalation and EDD do not count as approval', async () => {
  const { e, client } = await approvedContract({ checks: { kyc: 'Расширенная проверка (EDD)', conflict: 'Требует эскалации', conflictStatus: 'escalated' } });
  let state = await json(await register(e, await json(await signing(e))), 201);
  assert.deepEqual(state.readiness.conditions.map(c => [c.key, c.state]), [['signature', 'done'], ['kyc', 'pending'], ['conflict', 'pending']]);
  const refused = await json(await activate(e, state), 409);
  assert.match(refused.error, /KYC/); assert.equal(refused.conditions.length, 3);
  assert.equal(engagementRow(e.id).status, 'Draft');

  await setTask(client, '2.2', 'completed', { f_conclusion: 'Одобрить — Approve' });
  await setTask(client, '1.1', 'completed', { f_decision: 'Go' });
  // A pending decision for this client blocks; one for another contract does not.
  const elsewhere = await approvedContract();
  await json(await api('/api/conflict-approvals', { decisionType: 'Routine Conflict', riskLevel: 'Low', clientId: client.id, engagementId: elsewhere.e.id, status: 'Pending' }), 201);
  const pending = await json(await api('/api/conflict-approvals', { decisionType: 'Dual-Mandate', riskLevel: 'Low', clientId: client.id }), 201);
  state = await json(await signing(e));
  assert.equal(state.readiness.conditions[2].state, 'pending'); assert.match(state.readiness.conditions[2].detail, /Dual-Mandate/);
  await json(await api(`/api/conflict-approvals/${pending.id}`, { status: 'Approved', rationale: 'Mitigated' }, server.token, 'PUT'));
  state = await json(await signing(e));
  assert.equal(state.readiness.ready, true);
  assert.equal((await json(await activate(e, state))).serviceStatus, 'Active');

  const { e: refusedKyc, client: refusedClient } = await approvedContract({ checks: { kyc: 'Отказать — Reject' } });
  const refusedState = await json(await signing(refusedKyc));
  assert.equal(refusedState.readiness.conditions[1].state, 'rejected');
  await setTask(refusedClient, '1.1', 'completed', { f_decision: 'No-Go' });
  assert.equal((await json(await signing(refusedKyc))).readiness.conditions[2].state, 'rejected');
  const { e: noTasks } = await approvedContract({ checks: null });
  assert.deepEqual((await json(await signing(noTasks))).readiness.conditions.slice(1).map(c => c.state), ['unknown', 'unknown']);
});

test('a signature pins the approved revision; voiding is recorded and impossible after work starts', async () => {
  const { e, cycle } = await approvedContract();
  let state = await json(await register(e, await json(await signing(e))), 201);
  const history = await json(await api(`/api/engagements/${e.id}/approvals`, undefined, rm.token));
  assert.equal(history.cycles[0].canRework, false);
  const rework = await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/rework`, { expectedRevision: history.cycles[0].revision, reason: 'Change', requestKey: key() }, rm.token), 409);
  assert.match(rework.error, /подписан/);

  await json(await api(`/api/engagements/${e.id}/signatures/${state.signature.id}/void`, { reason: '', requestKey: key() }, rm.token), 400);
  await json(await api(`/api/engagements/${e.id}/signatures/${state.signature.id}/void`, { reason: 'Wrong file', requestKey: key() }, co.token), 403);
  state = await json(await api(`/api/engagements/${e.id}/signatures/${state.signature.id}/void`, { reason: 'Wrong file', requestKey: key() }, rm.token));
  assert.equal(state.signature, null); assert.equal(state.voided[0].voidReason, 'Wrong file'); assert.equal(state.canRegister, true);
  assert.equal(engagementRow(e.id).signed_date, null);
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals`, undefined, rm.token))).cycles[0].canRework, true);

  state = await json(await register(e, state, { date: '2026-10-22', bytes: PDF('correct') }), 201);
  state = await json(await activate(e, state));
  assert.equal(state.canVoid, false);
  await json(await api(`/api/engagements/${e.id}/signatures/${state.signature.id}/void`, { reason: 'Too late', requestKey: key() }, rm.token), 409);
  // Voided evidence stays downloadable as history.
  const old = await fetch(server.baseUrl + `/api/engagements/${e.id}/signatures/${state.voided[0].id}/file`, { headers: { Authorization: 'Bearer ' + rm.token } });
  assert.equal(old.status, 200);
});

test('FM subscription agreements follow the same rules behind the Chinese wall', async () => {
  const { e } = await approvedContract({ direction: 'FM' });
  await json(await signing(e, rm.token), 403);
  let state = await json(await signing(e));
  await json(await register(e, state, { token: rm.token }), 403);
  state = await json(await register(e, state, { token: server.token }), 201);
  assert.equal((await json(await activate(e, state, server.token))).serviceStatus, 'Active');
});
