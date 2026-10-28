// Daily task deadline email (TZ M3): open tasks due tomorrow, today or overdue
// go to the assignee (or the author of a free task), once a day, and only
// tasks that employee can still open are counted.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer, SEED_EMAIL } = require('./helpers');

let server, rm, co;
const day = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token) {
  return server.apiFetch(url, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
async function user(role) {
  const email = `due-${role.toLowerCase()}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Due ' + role, role, password: 'Deadline123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, email };
}
async function task(title, dueDate, extra = {}) { return (await json(await api('/api/discussions', { title, dueDate, requestKey: crypto.randomUUID(), ...extra }), 201)).id; }
const change = (kind, id, body) => api(`/api/discussions/${kind}/${id}/state`, { requestKey: crypto.randomUUID(), ...body });
// Console-mode mailer lines written by this digest run, as { to: count }.
async function digest() {
  const from = server.output().length;
  await json(await api('/api/notifications/run-digest', {}));
  const sent = {};
  for (const [, to, count] of server.output().slice(from).matchAll(/To: (\S+) \| Subject: Сроки задач: (\d+)/g)) sent[to] = Number(count);
  return sent;
}

before(async () => {
  server = await createTestServer({ port: 4213, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER');
  const fm = await json(await api('/api/ob-clients', { name: 'Due FM client', direction: 'FM' }), 201);
  const cfa = await json(await api('/api/ob-clients', { name: 'Due CF&A client', direction: 'CF&A' }), 201);
  const contract = await json(await api('/api/engagements', { clientId: cfa.id, clientName: cfa.name, contractNum: 'DUE-1', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 1 }), 201);

  await task('Author overdue', day(-1));
  const mine = await task('RM today', day(0), { participants: [rm.id] });
  await json(await change('room', mine, { action: 'assign', assigneeId: rm.id, expectedVersion: 0 }));
  await task('Next week', day(7));
  const done = await task('Done late', day(-2));
  await json(await change('room', done, { action: 'complete', expectedVersion: 0 }));
  const closed = await task('FM tomorrow', day(1), { participants: [co.id], source: { kind: 'client', id: fm.id } });
  await json(await change('room', closed, { action: 'assign', assigneeId: co.id, expectedVersion: 0 }));
  await json(await change('contract', contract.id, { action: 'due', dueDate: day(0), expectedVersion: 0 }));
  await json(await change('contract', contract.id, { action: 'assign', assigneeId: rm.id, expectedVersion: 1 }));
});
after(async () => { if (server) await server.stop(); });

test('one daily email per employee lists their own open tasks due tomorrow, today or overdue', async () => {
  assert.deepEqual(await digest(), { [SEED_EMAIL]: 1, [rm.email]: 2, [co.email]: 1 });
  assert.deepEqual(await digest(), {}, 'the same day does not repeat the email');
});

test('a task the employee can no longer open is left out of their email', async () => {
  sql("DELETE FROM notification_log WHERE event_type = 'task_deadlines'");
  sql("UPDATE roles SET access_fm = 0 WHERE code = 'COMPLIANCE_OFFICER'");
  try { assert.deepEqual(await digest(), { [SEED_EMAIL]: 1, [rm.email]: 2 }); }
  finally { sql("UPDATE roles SET access_fm = 1 WHERE code = 'COMPLIANCE_OFFICER'"); }
});
