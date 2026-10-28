const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, cfo, other, mlro;
const key = () => crypto.randomUUID();
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `next-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Next ' + role, role, password: 'NextStep123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'NextStep123!' }))).token };
}
function step(kind, id, token = server.token) { return api(`/api/process-steps/${kind}/${id}`, undefined, token); }
const TEMPLATE = [['1.1', 'conflict_precheck', 'RM'], ['2.1', 'doc_collection', 'RM'], ['2.2', 'dd_outcome', 'CO'], ['3.1', 'classification', 'RM'],
  ['3.2', 'suitability', 'RM'], ['4.1', 'engagement_letter', 'RM'], ['5.1', 'activation', 'RM']];
async function client(direction = 'CF&A') {
  const c = await json(await api('/api/ob-clients', { name: 'Next client', direction }), 201);
  const { obTasks } = await json(await api('/api/ob-tasks', { clientId: c.id, tasks: TEMPLATE.map(([taskNum, formKey, role], i) =>
    ({ taskNum, formKey, role, title: 'Task ' + taskNum, status: i ? 'locked' : 'open', dueDate: '2026-11-0' + (i + 1) })) }), 201);
  return { c, tasks: Object.fromEntries(obTasks.map(t => [t.taskNum, t])) };
}
// The client check conclusion (2.2) is recorded by the MLRO.
async function setTask(task, status, formData = {}) { return json(await api(`/api/ob-tasks/${task.id}`, { status, formData }, task.taskNum === '2.2' ? mlro.token : server.token, 'PUT')); }
function upload(e, expected, text, token = rm.token) {
  const form = new FormData(); form.append('expectedVersion', String(expected)); form.append('changeNote', text);
  form.append('file', new Blob([Buffer.from('%PDF-1.4\n' + text)]), 'contract.pdf');
  return fetch(server.baseUrl + `/api/engagements/${e.id}/versions`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}

before(async () => {
  server = await createTestServer({ port: 4211, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO'); mlro = await user('MLRO');
  other = await json(await api('/api/auth/signup', { companyName: 'Other next company', name: 'Other', email: 'next-other@test.example', password: 'NextStep123!' }), 201);
});
after(async () => { if (server) await server.stop(); });

test('onboarding shows the current step, escalation, a stop and completion', async () => {
  const { c, tasks } = await client();
  let s = await json(await step('client', c.id, rm.token));
  assert.equal(s.tone, 'action'); assert.equal(s.title, '1.1 Проверка конфликтов (Go / No-Go)'); assert.equal(s.who, 'RM');
  assert.equal(s.dueDate, '2026-11-01'); assert.equal(s.action.taskId, tasks['1.1'].id); assert.equal(s.done, 0); assert.equal(s.steps.length, 7);

  await setTask(tasks['1.1'], 'escalated', { f_decision: 'Требует эскалации' });
  s = await json(await step('client', c.id));
  assert.equal(s.tone, 'wait'); assert.match(s.title, /эскалации: 1\.1/);
  await setTask(tasks['2.1'], 'open');
  s = await json(await step('client', c.id));
  assert.equal(s.title, '2.1 Сбор документов клиента'); assert.match(s.note, /1\.1 на эскалации/);

  await setTask(tasks['1.1'], 'completed', { f_decision: 'No-Go' });
  s = await json(await step('client', c.id));
  assert.equal(s.tone, 'stop'); assert.match(s.title, /остановлен: 1\.1 .* No-Go/);

  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE ob_clients SET activated = 1 WHERE id = ?').run(c.id); db.close();
  assert.equal((await json(await step('client', c.id))).tone, 'done');
});

test('onboarding steps respect the FM wall and the tenant', async () => {
  const { c } = await client('FM');
  const s = await json(await step('client', c.id));
  assert.equal(s.title, '1.1 Проверка конфликтов (Go / No-Go)'); assert.equal(s.steps.find(x => x.number === '3.1').title, 'Квалификация LP');
  await json(await step('client', c.id, rm.token), 403);
  await json(await step('client', c.id, other.token), 404);
  await json(await step('client', 999999), 404);
});

test('a contract walks from file to approval, signing and start of work', async () => {
  const { c, tasks } = await client();
  const e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'NEXT-1', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 100 }), 201);
  let s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Загрузите файл договора'); assert.equal(s.action.section, 'versions');
  await json(await upload(e, 0, 'first'), 201);
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Отправьте договор на согласование'); assert.equal(s.action.kind, 'contract-approval');
  assert.equal((await json(await step('contract', e.id, co.token))).tone, 'wait');

  let cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null, participants: [co.id, cfo.id], dueDays: 3, requestKey: key() }, rm.token), 201)).cycle;
  s = await json(await step('contract', e.id, co.token));
  assert.equal(s.title, 'Нужно ваше решение по договору'); assert.equal(s.action.kind, 'contract-decide');
  s = await json(await step('contract', e.id, rm.token));
  assert.match(s.title, /ждём Next COMPLIANCE_OFFICER, Next CFO/); assert.equal(s.text, 'Согласовали 0 из 2');

  const decide = async (who, decision, comment = '') => json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, {
    expectedRevision: cycle.revision, stepId: cycle.steps.find(x => x.userId === who.id).id, decision, comment, requestKey: key() }, who.token));
  await decide(co, 'returned', 'Исправьте сумму');
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Договор возвращён на доработку'); assert.match(s.text, /Исправьте сумму/);
  await json(await upload(e, 1, 'second'), 201);
  assert.equal((await json(await step('contract', e.id, rm.token))).title, 'Отправьте договор на согласование');

  cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 2, expectedCycleId: cycle.id, participants: [co.id, cfo.id], dueDays: 3, requestKey: key() }, rm.token), 201)).cycle;
  await decide(co, 'approved'); await decide(cfo, 'approved');
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Зарегистрируйте подписанный договор'); assert.equal(s.action.section, 'signing'); assert.equal(s.done, 2);
  assert.equal((await json(await step('contract', e.id, co.token))).title, 'Ожидается регистрация подписанного договора');

  const form = new FormData(); form.append('signedDate', '2026-10-20'); form.append('expectedCycleId', String(cycle.id)); form.append('requestKey', key());
  form.append('file', new Blob([Buffer.from('%PDF-1.4 signed')]), 'signed.pdf');
  const signed = await json(await fetch(server.baseUrl + `/api/engagements/${e.id}/signatures`, { method: 'POST', headers: { Authorization: 'Bearer ' + rm.token }, body: form }), 201);
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Для начала работы не хватает проверок клиента'); assert.match(s.text, /KYC/); assert.equal(s.action.clientId, c.id);

  await setTask(tasks['1.1'], 'completed', { f_decision: 'Go' });
  await setTask(tasks['2.1'], 'completed');
  await setTask(tasks['2.2'], 'completed', { f_conclusion: 'Одобрить — Approve' });
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.title, 'Начните работу по договору'); assert.equal(s.done, 3);
  await json(await api(`/api/engagements/${e.id}/activation`, { expectedSignatureId: signed.signature.id, requestKey: key() }, rm.token));
  s = await json(await step('contract', e.id, rm.token));
  assert.equal(s.tone, 'done'); assert.match(s.title, /Работа по договору начата/); assert.equal(s.done, 4);
  await json(await step('contract', e.id, other.token), 404);
});
