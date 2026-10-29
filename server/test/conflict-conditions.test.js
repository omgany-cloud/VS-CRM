const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, cfo, auditor, mlro;
const key = () => crypto.randomUUID();
const PDF = text => Buffer.from('%PDF-1.4\n' + text);
const day = (offset = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + offset * 86400000));
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(statement, ...params) { const db = new DatabaseSync(server.dbPath); try { db.prepare(statement).run(...params); } finally { db.close(); } }
async function user(role) {
  const email = `conditions-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Conditions ' + role, role, password: 'ConditionsTest123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, email, token: (await json(await api('/api/auth/login', { email, password: 'ConditionsTest123!' }))).token };
}
function multipart(url, fields, file, token) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  if (file) form.append('file', new Blob([file.bytes]), file.name);
  return fetch(server.baseUrl + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
const conflict = (body, token = co.token) => api('/api/conflict-approvals', { decisionType: 'Dual-Mandate', riskLevel: 'Low', ...body }, token).then(r => json(r, 201));
const decide = (id, body, token = co.token) => api(`/api/conflict-approvals/${id}`, body, token, 'PUT');
const listed = async (id, token = co.token) => (await json(await api('/api/conflict-approvals', undefined, token))).conflictApprovals.find(a => a.id === id);
const condition = (assignee, extra = {}) => ({ text: 'Установить информационный барьер', assigneeId: assignee.id, dueDate: day(3), beforeStart: true, ...extra });

// A signed CF&A contract whose client passed 1.1 (Go) and 2.2 (approved): only conflict decisions are left.
async function signedContract(name) {
  const client = await json(await api('/api/ob-clients', { name, direction: 'CF&A' }), 201);
  const { obTasks } = await json(await api('/api/ob-tasks', { clientId: client.id, tasks: [
    { taskNum: '1.1', title: 'Conflict Pre-Check', phase: 1, role: 'RM', formKey: 'conflict_precheck', status: 'open' },
    { taskNum: '2.2', title: 'DD Outcome', phase: 2, role: 'CO', formKey: 'dd_outcome', status: 'open' },
  ] }), 201);
  await json(await api(`/api/ob-tasks/${obTasks[0].id}`, { status: 'completed', formData: { f_decision: 'Go' } }, server.token, 'PUT'));
  await json(await api(`/api/ob-tasks/${obTasks[1].id}`, { status: 'completed', formData: { f_conclusion: 'Одобрить — Approve' } }, mlro.token, 'PUT'));
  const e = await json(await api('/api/engagements', { clientId: client.id, clientName: client.name, contractNum: 'COND-' + key().slice(0, 8),
    direction: 'CF&A', serviceType: 'Advising', status: 'Draft', feeAmount: 100, date: '2026-10-01' }), 201);
  await json(await multipart(`/api/engagements/${e.id}/versions`, { expectedVersion: 0, changeNote: 'Initial' }, { bytes: PDF('terms ' + e.id), name: 'contract.pdf' }, rm.token), 201);
  const cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null, participants: [cfo.id], dueDays: 3, requestKey: key() }, rm.token), 201)).cycle;
  await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: cycle.revision, stepId: cycle.steps[0].id, decision: 'approved', comment: '', requestKey: key() }, cfo.token));
  await json(await multipart(`/api/engagements/${e.id}/signatures`, { signedDate: day(-1), expectedCycleId: cycle.id, requestKey: key() }, { bytes: PDF('signed ' + e.id), name: 'signed.pdf' }, rm.token), 201);
  return { client, e };
}
const conflictCheck = async e => (await json(await api(`/api/engagements/${e.id}/signing`))).readiness.conditions.find(c => c.key === 'conflict');
async function activate(e, status) {
  const state = await json(await api(`/api/engagements/${e.id}/signing`));
  return json(await api(`/api/engagements/${e.id}/activation`, { expectedSignatureId: state.signature.id, requestKey: key() }, rm.token), status);
}
async function mail(from, pattern) {
  for (let i = 0; i < 40 && !pattern.test(server.output().slice(from)); i++) await new Promise(r => setTimeout(r, 50));
  return server.output().slice(from);
}

before(async () => {
  server = await createTestServer({ port: 4218, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO'); auditor = await user('AUDITOR'); mlro = await user('MLRO');
});
after(async () => { if (server) await server.stop(); });

test('«approved with conditions» needs conditions with an executor and a deadline, and the decision is final', async () => {
  const client = await json(await api('/api/ob-clients', { name: 'Conditions client A', direction: 'CF&A' }), 201);
  const a = await conflict({ clientId: client.id });
  const { people } = await json(await api(`/api/conflict-approvals/${a.id}/condition-assignees`, undefined, co.token));
  assert.ok(people.some(p => p.id === rm.id) && people.some(p => p.id === cfo.id));
  assert.ok(!people.some(p => p.id === auditor.id), 'a read-only auditor cannot be an executor');
  await json(await api(`/api/conflict-approvals/${a.id}/condition-assignees`, undefined, cfo.token), 403);

  const conditional = { status: 'Approved with conditions' };
  assert.match((await json(await decide(a.id, conditional), 400)).error, /хотя бы одно условие/);
  assert.match((await json(await decide(a.id, { ...conditional, conditions: [condition(rm, { dueDate: day(-1) })] }), 400)).error, /в прошлом/);
  assert.match((await json(await decide(a.id, { ...conditional, conditions: [condition(auditor)] }), 400)).error, /исполнителя/);
  assert.match((await json(await decide(a.id, { ...conditional, conditions: [condition(rm), condition(rm, { text: '  ' })] }), 400)).error, /условие 2/);
  assert.equal((await listed(a.id)).status, 'Pending', 'a refused decision changes nothing');

  const decided = await json(await decide(a.id, { ...conditional, conditions: [condition(rm), condition(cfo, { text: 'Квартальный отчёт о барьере', dueDate: day(30), beforeStart: false })] }));
  assert.equal(decided.status, 'Approved with conditions'); assert.ok(decided.decidedBy);
  assert.deepEqual(decided.conditions.map(c => [c.assigneeId, c.beforeStart, c.status]), [[rm.id, true, 'open'], [cfo.id, false, 'open']]);
  assert.match((await json(await decide(a.id, { status: 'Approved' }), 409)).error, /уже принято/);
  assert.equal((await listed(a.id)).status, 'Approved with conditions');

  const forRm = (await listed(a.id, rm.token)).conditions;
  assert.deepEqual(forRm.map(c => [c.canComplete, c.canCancel]), [[true, false], [false, false]], 'the executor confirms only their own condition');
  assert.deepEqual((await listed(a.id)).conditions.map(c => [c.canComplete, c.canCancel]), [[true, true], [true, true]]);
});

test('open before-start conditions hold the start of work until the executor confirms them', async () => {
  const { client, e } = await signedContract('Conditions client B');
  const a = await conflict({ clientId: client.id });
  await json(await decide(a.id, { status: 'Approved with conditions', conditions: [condition(rm), condition(cfo, { text: 'Ежеквартальная проверка', dueDate: day(60), beforeStart: false })] }));
  const [blocking] = (await listed(a.id)).conditions;

  let check = await conflictCheck(e);
  assert.equal(check.state, 'pending'); assert.equal(check.approvalId, a.id);
  assert.match(check.detail, /Установить информационный барьер/); assert.match(check.detail, /Conditions RELATIONSHIP_MANAGER/);
  assert.match((await activate(e, 409)).error, /Установить информационный барьер/);
  const step = await json(await api(`/api/process-steps/contract/${e.id}`));
  assert.deepEqual([step.action.kind, step.action.approvalId], ['conflict-approval', a.id], 'the next step opens the decision, not onboarding');

  const done = `/api/conflict-approvals/${a.id}/conditions/${blocking.id}/complete`;
  assert.match((await json(await api(done, { note: 'done' }, cfo.token), 403)).error, /исполнитель/);
  assert.match((await json(await api(done, { note: '  ' }, rm.token), 400)).error, /что сделано/);
  const closed = await json(await api(done, { note: 'Барьер установлен, приказ № 12' }, rm.token));
  const confirmed = closed.conditions.find(c => c.id === blocking.id);
  assert.deepEqual([confirmed.status, confirmed.closeNote, confirmed.closedByName], ['done', 'Барьер установлен, приказ № 12', 'Conditions RELATIONSHIP_MANAGER']);
  await json(await api(done, { note: 'again' }, rm.token), 409);

  check = await conflictCheck(e);
  assert.equal(check.state, 'done', 'a condition for the course of work does not hold the start');
  assert.equal((await activate(e)).serviceStatus, 'Active');
});

test('a conditional decision without recorded conditions holds the start; only deciders add or cancel conditions', async () => {
  const { client, e } = await signedContract('Conditions client C');
  const a = await conflict({ clientId: client.id });
  sql("UPDATE conflict_approvals SET status = 'Approved with conditions', decided_by = 'Legacy' WHERE id = ?", a.id);
  let check = await conflictCheck(e);
  assert.equal(check.state, 'pending'); assert.match(check.detail, /без записанных условий/);

  const add = `/api/conflict-approvals/${a.id}/conditions`;
  await json(await api(add, { conditions: [condition(rm)] }, cfo.token), 403);
  await json(await api(add, { conditions: [condition(rm)] }, auditor.token), 403);
  const added = await json(await api(add, { conditions: [condition(rm)] }, co.token), 201);
  const pending = await conflict({ clientId: client.id, engagementId: e.id });
  assert.match((await json(await api(`/api/conflict-approvals/${pending.id}/conditions`, { conditions: [condition(rm)] }, co.token), 409)).error, /«Одобрено с условиями»/);
  await json(await decide(pending.id, { status: 'Approved' }));

  const cancel = `/api/conflict-approvals/${a.id}/conditions/${added.conditions[0].id}/cancel`;
  await json(await api(cancel, { reason: 'Не нужно' }, rm.token), 403);
  assert.match((await json(await api(cancel, {}, co.token), 400)).error, /причину/);
  const cancelled = await json(await api(cancel, { reason: 'Клиент отказался от второго мандата' }, co.token));
  assert.equal(cancelled.conditions[0].status, 'cancelled');
  check = await conflictCheck(e);
  assert.equal(check.state, 'done');
});

test('the executor must see the decision; executors get an email when assigned and a reminder when it is due', async () => {
  const fm = await json(await api('/api/ob-clients', { name: 'Conditions FM client', direction: 'FM' }), 201);
  const fmDecision = await conflict({ clientId: fm.id });
  const { people } = await json(await api(`/api/conflict-approvals/${fmDecision.id}/condition-assignees`, undefined, co.token));
  assert.ok(!people.some(p => p.id === rm.id), 'an RM without FM access cannot execute an FM condition');
  assert.match((await json(await decide(fmDecision.id, { status: 'Approved with conditions', conditions: [condition(rm)] }), 400)).error, /исполнителя/);

  const client = await json(await api('/api/ob-clients', { name: 'Conditions client D', direction: 'CF&A' }), 201);
  const a = await conflict({ clientId: client.id });
  const from = server.output().length;
  await json(await decide(a.id, { status: 'Approved with conditions', conditions: [condition(rm, { text: 'Раскрыть конфликт клиенту', dueDate: day(0) }), condition(co, { text: 'Проверить раскрытие' })] }));
  const sent = await mail(from, /To: conditions-RELATIONSHIP_MANAGER@test\.example \| Subject: Условие по конфликту интересов/);
  assert.match(sent, /To: conditions-RELATIONSHIP_MANAGER@test\.example \| Subject: Условие по конфликту интересов: срок/);
  assert.doesNotMatch(sent, /To: conditions-COMPLIANCE_OFFICER@test\.example \| Subject: Условие по конфликту/, 'a decider assigning themself gets no email');

  const digestFrom = server.output().length;
  await json(await api('/api/notifications/run-digest', {}));
  assert.match(server.output().slice(digestFrom), /To: conditions-RELATIONSHIP_MANAGER@test\.example \| Subject: Условия по конфликтам интересов: 1/);
});
