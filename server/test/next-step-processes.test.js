const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, analyst, co, cfo, rm;
const key = () => crypto.randomUUID();
const day = (offset = 0) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(Date.now() + offset * 86400000));
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(statement, ...params) { const db = new DatabaseSync(server.dbPath, { enableForeignKeyConstraints: false }); try { db.prepare(statement).run(...params); } finally { db.close(); } }
async function user(role) {
  const email = `steps-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Steps ' + role, role, password: 'StepsTest123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, email, token: (await json(await api('/api/auth/login', { email, password: 'StepsTest123!' }))).token };
}
const step = (kind, id, token = server.token) => api(`/api/process-steps/${kind}/${id}`, undefined, token).then(r => json(r));
const listed = async (token, title) => (await json(await api('/api/discussions', undefined, token))).items.find(i => i.title === title);

before(async () => {
  server = await createTestServer({ port: 4219, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  analyst = await user('ANALYST'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO'); rm = await user('RELATIONSHIP_MANAGER');
});
after(async () => { if (server) await server.stop(); });

test('a sandbox project leads from new to its tasks to the CEO decision; each step names whose turn it is', async () => {
  const project = await json(await api('/api/sandbox', { name: 'Steps sandbox project' }), 201);
  let mine = await step('sandbox', project.id), theirs = await step('sandbox', project.id, analyst.token);
  assert.equal(mine.title, 'Начните проработку проекта'); assert.equal(mine.mine, true, 'the owner starts the work');
  assert.equal(theirs.mine, false); assert.deepEqual(mine.action, { kind: 'open-record', record: 'sandbox', id: project.id, label: 'Открыть проект' });

  sql("UPDATE sandbox_projects SET status = 'В проработке' WHERE id = ?", project.id);
  await json(await api(`/api/sandbox/${project.id}/tasks`, { title: 'Собрать финансовую модель', assignee: analyst.email, dueDate: day(2) }), 201);
  await json(await api(`/api/sandbox/${project.id}/tasks`, { title: 'Позвонить основателю', dueDate: day(1) }), 201);
  theirs = await step('sandbox', project.id, analyst.token); mine = await step('sandbox', project.id);
  assert.equal(theirs.title, 'Задача проекта: «Собрать финансовую модель»', 'the executor sees their own task first');
  assert.equal(theirs.mine, true); assert.match(theirs.text, /ещё открыто: 1/);
  assert.equal(mine.title, 'Задача проекта: «Позвонить основателю»'); assert.equal(mine.mine, false);

  sql("UPDATE sandbox_tasks SET status = 'Готово' WHERE project_id = ?", project.id);
  mine = await step('sandbox', project.id); theirs = await step('sandbox', project.id, analyst.token);
  assert.deepEqual([mine.tone, mine.title, mine.mine], ['action', 'Примите решение по проекту', true], 'only the CEO passes a project to screening');
  assert.deepEqual([theirs.tone, theirs.title, theirs.mine], ['wait', 'Ждём решения по проекту', false]);
  assert.equal(mine.steps[2].status, 'open');

  sql("UPDATE sandbox_projects SET status = 'Отложен', status_reason = 'Ждём отчётность', deferred_until = ? WHERE id = ?", day(10), project.id);
  mine = await step('sandbox', project.id);
  assert.equal(mine.tone, 'wait'); assert.match(mine.title, /Проект отложен до/); assert.equal(mine.text, 'Ждём отчётность');
  sql('UPDATE sandbox_projects SET deferred_until = ? WHERE id = ?', day(0), project.id);
  mine = await step('sandbox', project.id);
  assert.deepEqual([mine.tone, mine.mine], ['action', true]); assert.match(mine.title, /Срок отложения наступил/);

  sql("UPDATE sandbox_projects SET status = 'Отказ', status_reason = 'Не наш профиль', deferred_until = NULL WHERE id = ?", project.id);
  assert.deepEqual(['stop', 'Не наш профиль'], [(mine = await step('sandbox', project.id)).tone, mine.text]);
  sql("UPDATE sandbox_projects SET status = 'Передан в скрининг', promoted_deal_id = 77 WHERE id = ?", project.id);
  mine = await step('sandbox', project.id);
  assert.equal(mine.tone, 'done'); assert.deepEqual(mine.action, { kind: 'open-record', record: 'deal', id: 77, label: 'Открыть сделку' });
  await json(await api(`/api/process-steps/sandbox/${project.id}`, undefined, rm.token), 403);
  await json(await api('/api/process-steps/deal/1'), 404);
});

test('a conflict decision is the deciders\' turn, an escalated one the CEO\'s, each condition its executor\'s', async () => {
  const client = await json(await api('/api/ob-clients', { name: 'Steps conflict client', direction: 'CF&A' }), 201);
  const pending = await json(await api('/api/conflict-approvals', { decisionType: 'Dual-Mandate', riskLevel: 'Low', clientId: client.id }, co.token), 201);
  let forCo = await step('conflict', pending.id, co.token), forCfo = await step('conflict', pending.id, cfo.token);
  assert.deepEqual([forCo.tone, forCo.mine], ['action', true]); assert.deepEqual([forCfo.tone, forCfo.mine], ['wait', false]);
  assert.deepEqual(forCo.action, { kind: 'conflict-approval', approvalId: pending.id, label: 'Открыть решение' });

  const escalated = await json(await api('/api/conflict-approvals', { decisionType: 'Internal Client', riskLevel: 'High', clientId: client.id }, co.token), 201);
  assert.equal((await step('conflict', escalated.id, co.token)).mine, false);
  assert.equal((await step('conflict', escalated.id)).mine, true, 'only the CEO decides an escalated conflict');

  await json(await api(`/api/conflict-approvals/${pending.id}`, { status: 'Approved with conditions', conditions: [
    { text: 'Раскрыть конфликт клиенту', assigneeId: rm.id, dueDate: day(3), beforeStart: true }] }, co.token, 'PUT'));
  const forRm = await step('conflict', pending.id, rm.token);
  assert.deepEqual([forRm.title, forRm.mine, forRm.who], ['Условие: «Раскрыть конфликт клиенту»', true, 'Steps RELATIONSHIP_MANAGER']);
  assert.equal((await step('conflict', pending.id, co.token)).mine, false);
  sql("UPDATE conflict_conditions SET status = 'done' WHERE approval_id = ?", pending.id);
  assert.equal((await step('conflict', pending.id, rm.token)).tone, 'done');
});

test('«Мой ход» in the task list follows the process the task is linked to', async () => {
  const project = await json(await api('/api/sandbox', { name: 'Turn sandbox project' }), 201);
  sql("UPDATE sandbox_projects SET status = 'В проработке' WHERE id = ?", project.id);
  await json(await api(`/api/sandbox/${project.id}/tasks`, { title: 'Проверить рынок', assignee: analyst.email }), 201);
  await json(await api('/api/discussions', { title: 'Turn: sandbox task', participants: [analyst.id], source: { kind: 'sandbox', id: project.id }, requestKey: key() }), 201);
  assert.equal((await listed(analyst.token, 'Turn: sandbox task')).task.myTurn, true);
  assert.equal((await listed(server.token, 'Turn: sandbox task')).task.myTurn, false);

  // Responsible for the task: an action step of its process is theirs too.
  const fresh = await json(await api('/api/sandbox', { name: 'Turn new project' }), 201);
  const owned = await json(await api('/api/discussions', { title: 'Turn: responsible', participants: [cfo.id], source: { kind: 'sandbox', id: fresh.id }, requestKey: key() }), 201);
  assert.equal((await listed(cfo.token, 'Turn: responsible')).task.myTurn, false);
  await json(await api(`/api/discussions/room/${owned.id}/state`, { action: 'assign', assigneeId: cfo.id, expectedVersion: 0, requestKey: key() }));
  assert.equal((await listed(cfo.token, 'Turn: responsible')).task.myTurn, true);

  const client = await json(await api('/api/ob-clients', { name: 'Turn conflict client', direction: 'CF&A' }), 201);
  const decision = await json(await api('/api/conflict-approvals', { decisionType: 'Routine Conflict', riskLevel: 'Low', clientId: client.id }, co.token), 201);
  const room = await json(await api('/api/discussions', { title: 'Turn: conflict task', participants: [co.id, cfo.id], source: { kind: 'conflict', id: decision.id }, requestKey: key() }), 201);
  assert.equal((await listed(co.token, 'Turn: conflict task')).task.myTurn, true);
  assert.equal((await listed(cfo.token, 'Turn: conflict task')).task.myTurn, false, 'a waiting step is nobody\'s turn but the decider\'s');
  await json(await api(`/api/discussions/room/${room.id}/state`, { action: 'complete', result: 'Решение принято', expectedVersion: 0, requestKey: key() }));
  assert.equal((await listed(co.token, 'Turn: conflict task')).task.myTurn, false, 'a completed task is nobody\'s turn');
});
