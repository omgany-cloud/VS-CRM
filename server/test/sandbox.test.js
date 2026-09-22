// Coverage for the Sandbox ("Песочница") — the pre-Скрининг holding area
// (server/index.js /api/sandbox*, server/sandboxMapping.js): CRUD + status
// rules, tasks, folder-link validation, history via audit_log, the
// screeningAccept-gated promote route (idempotent, atomic, creates a real
// Скрининг deal), and tenant isolation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let fundId;

before(async () => {
  server = await createTestServer({ port: 4140 });
  const fund = await (await server.apiFetch('/api/funds', {
    method: 'POST', body: JSON.stringify({ name: 'SANDBOX_TEST_FUND' }),
  })).json();
  fundId = fund.id;
});

after(async () => { await server.stop(); });

const json = res => res.json();
const post = (p, body) => server.apiFetch(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => server.apiFetch(p, { method: 'PUT', body: JSON.stringify(body) });

async function createProject(extra = {}) {
  const res = await post('/api/sandbox', { name: 'SBX_' + Math.random().toString(36).slice(2, 8), ...extra });
  assert.equal(res.status, 201);
  return res.json();
}

// A user in `role`, logged in with a real (non-temporary) password — same
// first-login password-change dance the other permission tests do.
async function loginAsRole(role, email) {
  await post('/api/users', { email, password: 'SandboxTest2026!', role, name: 'TEST_' + role });
  const first = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'SandboxTest2026!' }),
  })).json();
  await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + first.token },
    body: JSON.stringify({ currentPassword: 'SandboxTest2026!', newPassword: 'MyOwnPass789!' }),
  });
  const login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'MyOwnPass789!' }),
  })).json();
  return (p, opts = {}) => fetch(server.baseUrl + p, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) },
  });
}

test('create: name is required, defaults to status Новый with the creator as owner', async () => {
  const bad = await post('/api/sandbox', { name: '   ' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'name');

  const p = await createProject({ initiator: 'ТОО Ромашка', goal: 'Понять структуру собственности' });
  assert.equal(p.status, 'Новый');
  assert.equal(p.owner, 'admin@turancapital.kz');
  assert.equal(p.fundId, null, 'a fund is not required until the project is accepted into screening');
  assert.equal(p.promotedDealId, null);
  assert.equal(p.openTasks, 0);
});

test('folder link: only real http(s) links without credentials are accepted', async () => {
  const p = await createProject();
  for (const bad of ['javascript:alert(1)', 'ftp://files.example.com/x', 'not a link', 'https://user:pw@drive.google.com/x']) {
    const res = await put(`/api/sandbox/${p.id}`, { folderUrl: bad });
    assert.equal(res.status, 400, `${bad} must be rejected`);
  }
  const ok = await put(`/api/sandbox/${p.id}`, { folderUrl: 'https://drive.google.com/drive/folders/abc123' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).folderUrl, 'https://drive.google.com/drive/folders/abc123');
});

test('status rules: Отказ/Отложен need a reason, Передан в скрининг is not settable via PUT, reason clears when reopened', async () => {
  const p = await createProject();
  let res = await put(`/api/sandbox/${p.id}`, { status: 'Отказ' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'statusReason');

  res = await put(`/api/sandbox/${p.id}`, { status: 'Отказ', statusReason: 'Вне мандата фонда' });
  assert.equal(res.status, 200);
  const rejected = await res.json();
  assert.equal(rejected.status, 'Отказ');
  assert.equal(rejected.statusReason, 'Вне мандата фонда');

  res = await put(`/api/sandbox/${p.id}`, { status: 'Передан в скрининг' });
  assert.equal(res.status, 400, 'only the promote action may set this status');

  res = await put(`/api/sandbox/${p.id}`, { status: 'Отложен', statusReason: 'Ждём отчётность за Q3', deferredUntil: 'not-a-date' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'deferredUntil');

  res = await put(`/api/sandbox/${p.id}`, { status: 'В проработке' });
  const reopened = await res.json();
  assert.equal(reopened.status, 'В проработке');
  assert.equal(reopened.statusReason, '', 'the reason belongs to the Отказ/Отложен state and clears with it');
});

test('goal and status changes land in the project history', async () => {
  const p = await createProject({ goal: 'Первая цель' });
  await put(`/api/sandbox/${p.id}`, { goal: 'Запросить финмодель', goalChangeReason: 'Появились новые обстоятельства' });
  await put(`/api/sandbox/${p.id}`, { status: 'В проработке' });
  const detail = await (await server.apiFetch(`/api/sandbox/${p.id}`)).json();
  const actions = detail.history.map(h => h.action);
  assert.ok(actions.includes('created'));
  assert.ok(actions.includes('goal_changed'));
  assert.ok(actions.includes('status_changed'));
  assert.match(detail.history.find(h => h.action === 'goal_changed').summary, /Запросить финмодель/);
  assert.equal(detail.project.goal, 'Запросить финмодель');
});

test('a stale version is rejected with 409 when the caller sends one', async () => {
  const p = await createProject();
  const first = await put(`/api/sandbox/${p.id}`, { goal: 'A', version: p.version });
  assert.equal(first.status, 200);
  const stale = await put(`/api/sandbox/${p.id}`, { goal: 'B', version: p.version });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).current.goal, 'A');
});

test('goal changes: a reason is required once a goal is actually changed, not for the first-ever goal', async () => {
  const p = await createProject();   // goal starts empty
  const firstSet = await put(`/api/sandbox/${p.id}`, { goal: 'Понять структуру собственности' });
  assert.equal(firstSet.status, 200, 'setting the goal for the first time needs no reason');

  const noReason = await put(`/api/sandbox/${p.id}`, { goal: 'Запросить финмодель' });
  assert.equal(noReason.status, 400);
  assert.equal((await noReason.json()).field, 'goalChangeReason');

  const withReason = await put(`/api/sandbox/${p.id}`, { goal: 'Запросить финмодель', goalChangeReason: 'Основатель поднял раунд по-другому' });
  assert.equal(withReason.status, 200);
  const updated = await withReason.json();
  assert.equal(updated.goal, 'Запросить финмодель');

  const detail = await (await server.apiFetch(`/api/sandbox/${p.id}`)).json();
  const entry = detail.history.find(h => h.action === 'goal_changed' && h.summary.includes('Запросить финмодель'));
  assert.ok(entry);
  assert.match(entry.summary, /Основатель поднял раунд по-другому/);

  // resending the identical goal is not a change and needs no reason
  const same = await put(`/api/sandbox/${p.id}`, { goal: 'Запросить финмодель' });
  assert.equal(same.status, 200);
});

test('tasks: create, validate, complete, count open/overdue, delete', async () => {
  const p = await createProject();
  const noTitle = await post(`/api/sandbox/${p.id}/tasks`, { title: '' });
  assert.equal(noTitle.status, 400);
  assert.equal((await noTitle.json()).field, 'title');
  const badAssignee = await post(`/api/sandbox/${p.id}/tasks`, { title: 'X', assignee: 'nobody@nowhere.example' });
  assert.equal(badAssignee.status, 400);
  assert.equal((await badAssignee.json()).field, 'assignee');
  const badDate = await post(`/api/sandbox/${p.id}/tasks`, { title: 'X', dueDate: 'garbage' });
  assert.equal(badDate.status, 400);

  const overdue = await (await post(`/api/sandbox/${p.id}/tasks`, { title: 'Позвонить основателю', dueDate: '2020-01-01', assignee: 'admin@turancapital.kz', priority: 'Высокий' })).json();
  const future = await (await post(`/api/sandbox/${p.id}/tasks`, { title: 'Получить NDA', dueDate: '2999-01-01' })).json();
  assert.equal(overdue.status, 'К выполнению');
  assert.equal(overdue.assigneeName, 'Omirserikov Gaini');

  let list = (await (await server.apiFetch('/api/sandbox')).json()).projects.find(x => x.id === p.id);
  assert.equal(list.openTasks, 2);
  assert.equal(list.overdueTasks, 1);
  assert.equal(list.nextDue, '2020-01-01');

  const done = await (await put(`/api/sandbox/tasks/${overdue.id}`, { status: 'Готово' })).json();
  assert.equal(done.status, 'Готово');
  assert.ok(done.completedAt);
  list = (await (await server.apiFetch('/api/sandbox')).json()).projects.find(x => x.id === p.id);
  assert.equal(list.openTasks, 1);
  assert.equal(list.overdueTasks, 0);

  const reopened = await (await put(`/api/sandbox/tasks/${overdue.id}`, { status: 'В работе' })).json();
  assert.equal(reopened.completedAt, null);

  assert.equal((await server.apiFetch(`/api/sandbox/tasks/${future.id}`, { method: 'DELETE' })).status, 200);
  const detail = await (await server.apiFetch(`/api/sandbox/${p.id}`)).json();
  assert.deepEqual(detail.tasks.map(t => t.id), [overdue.id]);
  assert.ok(detail.history.some(h => h.action === 'task_created'));
  assert.ok(detail.history.some(h => h.action === 'task_completed'));
  assert.ok(detail.history.some(h => h.action === 'task_deleted'));
});

test('archived projects leave the default list and come back with archived=1', async () => {
  const p = await createProject();
  await put(`/api/sandbox/${p.id}`, { archived: true });
  const active = (await (await server.apiFetch('/api/sandbox')).json()).projects;
  assert.ok(!active.some(x => x.id === p.id));
  const archived = (await (await server.apiFetch('/api/sandbox?archived=1')).json()).projects;
  assert.ok(archived.some(x => x.id === p.id));
});

test('promote: needs a fund, creates one Скрининг deal, is idempotent, and freezes the project', async () => {
  const p = await createProject({ name: 'SBX_PROMOTE_ME', description: 'Тезис проекта', folderUrl: 'https://drive.google.com/drive/folders/promote1' });

  const noFund = await post(`/api/sandbox/${p.id}/promote`, {});
  assert.equal(noFund.status, 400);
  assert.equal((await noFund.json()).field, 'fundId');
  const badAmount = await post(`/api/sandbox/${p.id}/promote`, { fundId, amount: -5 });
  assert.equal(badAmount.status, 400);

  const res = await post(`/api/sandbox/${p.id}/promote`, { fundId, sector: 'Технологии', amount: 3 });
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.project.status, 'Передан в скрининг');
  assert.equal(out.project.promotedDealId, out.deal.id);
  assert.equal(out.deal.stage, 'Скрининг');
  assert.equal(out.deal.ic, 'Не подано');
  assert.equal(out.deal.company, 'SBX_PROMOTE_ME');
  assert.equal(out.deal.fundId, fundId);
  assert.equal(out.deal.amount, 3);
  assert.equal(out.deal.description, 'Тезис проекта');
  assert.equal(out.deal.dataRoomUrl, 'https://drive.google.com/drive/folders/promote1');

  const again = await post(`/api/sandbox/${p.id}/promote`, { fundId });
  assert.equal(again.status, 200);
  const againBody = await again.json();
  assert.equal(againBody.alreadyPromoted, true);
  assert.equal(againBody.deal.id, out.deal.id);
  const { deals } = await (await server.apiFetch('/api/deals')).json();
  assert.equal(deals.filter(d => d.company === 'SBX_PROMOTE_ME').length, 1, 'a repeat accept must not create a second deal');

  // Frozen: no edits, no new tasks, and the resulting deal can't be hard-deleted.
  assert.equal((await put(`/api/sandbox/${p.id}`, { goal: 'ещё правка' })).status, 409);
  assert.equal((await post(`/api/sandbox/${p.id}/tasks`, { title: 'поздно' })).status, 409);
  const del = await server.apiFetch(`/api/deals/${out.deal.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  assert.equal((await del.json()).footprint[0].table, 'sandbox_projects');

  const detail = await (await server.apiFetch(`/api/sandbox/${p.id}`)).json();
  assert.ok(detail.history.some(h => h.action === 'promoted'));
  const dealAudit = await (await server.apiFetch(`/api/audit-log?entityType=deals&entityId=${out.deal.id}`)).json();
  assert.ok(dealAudit.entries.some(e => e.action === 'created'));
});

test('promote: a rejected project must be reopened first', async () => {
  const p = await createProject();
  await put(`/api/sandbox/${p.id}`, { status: 'Отказ', statusReason: 'Не наш профиль' });
  assert.equal((await post(`/api/sandbox/${p.id}/promote`, { fundId })).status, 409);
});

test('permissions: any FM user can work the sandbox, only screeningAccept holders can promote, RM cannot see it', async () => {
  const asAnalyst = await loginAsRole('ANALYST', 'sbx-analyst@example.com');
  const p = await createProject();

  // Analyst (accessFM, no screeningAccept): full sandbox access, no promote.
  assert.equal((await asAnalyst('/api/sandbox')).status, 200);
  const created = await asAnalyst('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_BY_ANALYST' }) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).owner, 'sbx-analyst@example.com');
  const denied = await asAnalyst(`/api/sandbox/${p.id}/promote`, { method: 'POST', body: JSON.stringify({ fundId }) });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /screeningAccept/);

  // The people picker only offers users who could actually open the project.
  const asRm = await loginAsRole('RELATIONSHIP_MANAGER', 'sbx-rm@example.com');
  const { people } = await (await server.apiFetch('/api/sandbox/people')).json();
  assert.ok(people.some(x => x.email === 'sbx-analyst@example.com'));
  assert.ok(!people.some(x => x.email === 'sbx-rm@example.com'), 'RM has no accessFM, so cannot be an owner/assignee');
  assert.equal((await asRm('/api/sandbox')).status, 403);
  const rmAssign = await post(`/api/sandbox/${p.id}/tasks`, { title: 'x', assignee: 'sbx-rm@example.com' });
  assert.equal(rmAssign.status, 400);

  // The permission is a real, editable role flag: seeded CEO has it, Analyst does not.
  const { roles } = await (await server.apiFetch('/api/roles')).json();
  assert.equal(roles.find(r => r.code === 'CEO').screeningAccept, true);
  assert.equal(roles.find(r => r.code === 'ANALYST').screeningAccept, false);
});

test('tenant isolation: another tenant sees none of this tenant\'s projects and cannot touch them', async () => {
  const mine = await createProject({ name: 'SBX_ISOLATED' });
  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Sandbox Isolation Co', name: 'Tenant B Admin', email: 'tenantb-sbx@isolationtest.example', password: 'TenantBPassword123' }),
  });
  assert.equal(signup.status, 201);
  const { token } = await signup.json();
  const asB = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  assert.equal((await (await asB('/api/sandbox')).json()).projects.length, 0);
  assert.equal((await asB(`/api/sandbox/${mine.id}`)).status, 404);
  assert.equal((await asB(`/api/sandbox/${mine.id}`, { method: 'PUT', body: JSON.stringify({ goal: 'hijack' }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/${mine.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: 'x' }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/${mine.id}/promote`, { method: 'POST', body: JSON.stringify({ fundId }) })).status, 404);
  const after = await (await server.apiFetch(`/api/sandbox/${mine.id}`)).json();
  assert.equal(after.project.goal, '', 'tenant A\'s project must be untouched');
});
