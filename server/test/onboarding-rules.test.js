// The server keeps the onboarding stage order (TZ 13.1 п. 5): a locked stage
// opens after its predecessor, a stopped onboarding cannot move on, escalation
// is not permission to activate, and a client is activated only through a
// completed stage 5.1 whose contract work has started.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, mlro, co;
const TEMPLATE = [['1.1', 'conflict_precheck'], ['2.1', 'doc_collection'], ['2.2', 'dd_outcome'], ['3.1', 'classification'],
  ['3.2', 'suitability'], ['4.1', 'engagement_letter'], ['5.1', 'activation']];
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, method = body === undefined ? 'GET' : 'POST', token = server.token) {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
async function client(name) {
  const c = await json(await api('/api/ob-clients', { name, direction: 'CF&A' }), 201);
  const { obTasks } = await json(await api('/api/ob-tasks', { clientId: c.id, tasks: TEMPLATE.map(([taskNum, formKey], i) =>
    ({ taskNum, formKey, title: 'Stage ' + taskNum, role: 'RM', phase: Number(taskNum[0]), status: i ? 'locked' : 'open' })) }), 201);
  return { c, t: Object.fromEntries(obTasks.map(t => [t.taskNum, t])) };
}
// Stage 2.2 is the MLRO's; other stages are moved by the seeded administrator.
const stage = (task, status, formData = {}, expected = 200, token = task.taskNum === '2.2' ? mlro.token : server.token) =>
  api(`/api/ob-tasks/${task.id}`, { status, formData }, 'PUT', token).then(r => json(r, expected));
async function user(role) {
  const email = `rules-${role.toLowerCase()}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Rules ' + role, role, password: 'RulesTest123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'RulesTest123!' }))).token };
}

before(async () => {
  server = await createTestServer({ port: 4216, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  mlro = await user('MLRO'); co = await user('COMPLIANCE_OFFICER');
});
after(async () => { if (server) await server.stop(); });

test('a locked stage opens only after its predecessor; escalation of 1.1 lets documents start', async () => {
  const { c, t } = await client('Order client');
  assert.match((await stage(t['2.2'], 'completed', { f_conclusion: 'Одобрить — Approve' }, 409)).error, /после завершения этапа 2\.1/);
  await stage(t['2.1'], 'open', {}, 409);
  await stage(t['1.1'], 'escalated', { f_decision: 'Требует эскалации' });
  await stage(t['2.1'], 'open');
  await stage(t['2.1'], 'nonsense', {}, 400);
  await json(await api('/api/ob-tasks', { clientId: c.id, tasks: [{ taskNum: '9.9', title: 'Decided at birth', status: 'completed' }] }), 400);
  assert.equal((await stage(t['2.1'], 'open')).status, 'open', 'saving an unchanged stage again is not a transition');
});

test('a stopped onboarding cannot move on until the stopping decision is revised', async () => {
  const { t } = await client('Stopped client');
  await stage(t['1.1'], 'rejected', { f_decision: 'No-Go' });
  assert.match((await stage(t['2.1'], 'open', {}, 409)).error, /остановлен на этапе 1\.1/);
  await stage(t['1.1'], 'open');
  await stage(t['2.1'], 'open', {}, 409);
  await stage(t['1.1'], 'completed', { f_decision: 'Go' });
  await stage(t['2.1'], 'open');
});

test('activation needs every stage completed (not escalated) and started contract work; the client follows stage 5.1', async () => {
  await json(await api('/api/ob-clients', { name: 'Born active', direction: 'CF&A', activated: true }), 400);
  const { c, t } = await client('Activation client');
  const contract = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'ACT-1', direction: 'CF&A', serviceType: 'Advising', status: 'Draft', feeAmount: 1 }), 201);
  await stage(t['1.1'], 'completed', { f_decision: 'Go' });
  for (const n of ['2.1', '2.2', '3.1']) await stage(t[n], 'completed', n === '2.2' ? { f_conclusion: 'Одобрить — Approve' } : {});
  await stage(t['3.2'], 'escalated');
  await stage(t['4.1'], 'open', {}, 409);
  await stage(t['3.2'], 'completed', { f_overallResult: 'Подходит' });
  await stage(t['4.1'], 'completed');
  await stage(t['5.1'], 'open');
  await stage(t['3.1'], 'escalated');
  const activation = { f_engagementId: String(contract.id) };
  assert.match((await stage(t['5.1'], 'completed', activation, 409)).error, /3\.1 \(на эскалации — ждёт решения\)/);
  await stage(t['3.1'], 'completed');
  assert.match((await stage(t['5.1'], 'completed', {}, 409)).error, /не выбран договор/);
  assert.match((await stage(t['5.1'], 'completed', activation, 409)).error, /работа по договору ACT-1 не начата/);
  assert.match((await json(await api(`/api/ob-clients/${c.id}`, { activated: true }, 'PUT'), 409)).error, /этапа 5\.1/);

  sql("UPDATE engagements SET status = 'Active' WHERE id = ?", contract.id); // work started from the contract card
  await stage(t['5.1'], 'completed', activation);
  assert.equal((await json(await api(`/api/ob-clients/${c.id}`, { activated: true }, 'PUT'))).activated, true);
});

test('only the MLRO records, changes or reopens the client check conclusion (2.2)', async () => {
  const { t } = await client('KYC client');
  await stage(t['1.1'], 'completed', { f_decision: 'Go' });
  await stage(t['2.1'], 'completed');
  const approve = { f_conclusion: 'Одобрить — Approve' };
  for (const token of [server.token, co.token]) assert.match((await stage(t['2.2'], 'completed', approve, 403, token)).error, /MLRO/);
  await stage(t['2.2'], 'in_progress', { f_conclusion: '' }, 200, co.token);
  await stage(t['2.2'], 'completed', { f_conclusion: 'Расширенная проверка (EDD)' });
  await stage(t['2.2'], 'completed', approve, 403, co.token);
  await stage(t['2.2'], 'completed', { f_conclusion: 'Расширенная проверка (EDD)' }, 200, server.token);
  await stage(t['2.2'], 'open', {}, 403, server.token);
  await stage(t['2.2'], 'completed', approve);
});
