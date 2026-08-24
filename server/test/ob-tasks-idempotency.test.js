// Regression coverage for POST /api/ob-tasks idempotency (QA Data
// Integrity audit, 2026-08-24): no UNIQUE(client_id, task_num) existed,
// so a double-click/retry duplicated the whole 7-task template for the
// same client. Now a UNIQUE index backs it, and the route itself treats
// a repeat call as idempotent — same input, same result, no duplicates.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

let server;
let clientId;

before(async () => {
  server = await createTestServer({ port: 4134 });
  const client = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'OBTASK_IDEMP_CLIENT', direction: 'FM' }),
  })).json();
  clientId = client.id;
});

after(async () => { await server.stop(); });

function taskTemplate() {
  return [
    { taskNum: '1.1', title: 'Conflict Pre-Check', phase: 1, role: 'RELATIONSHIP_MANAGER', status: 'open' },
    { taskNum: '1.2', title: 'KYC Intake', phase: 1, role: 'RELATIONSHIP_MANAGER', status: 'locked' },
  ];
}

test('a repeat POST for the same client does not create duplicate tasks', async () => {
  const first = await (await server.apiFetch('/api/ob-tasks', {
    method: 'POST', body: JSON.stringify({ clientId, tasks: taskTemplate() }),
  })).json();
  assert.equal(first.obTasks.length, 2);

  const second = await (await server.apiFetch('/api/ob-tasks', {
    method: 'POST', body: JSON.stringify({ clientId, tasks: taskTemplate() }),
  })).json();
  assert.equal(second.obTasks.length, 2, 'the repeat call must still return exactly 2 tasks, not 4');
  assert.deepEqual(
    second.obTasks.map(t => t.id).sort(),
    first.obTasks.map(t => t.id).sort(),
    'the repeat call must hand back the SAME task rows, not new ones'
  );
});

test('a genuinely different client still gets its own fresh set of tasks', async () => {
  const otherClient = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST', body: JSON.stringify({ name: 'OBTASK_IDEMP_CLIENT_2', direction: 'FM' }),
  })).json();
  const res = await (await server.apiFetch('/api/ob-tasks', {
    method: 'POST', body: JSON.stringify({ clientId: otherClient.id, tasks: taskTemplate() }),
  })).json();
  assert.equal(res.obTasks.length, 2);
  assert.ok(res.obTasks.every(t => t.clientId === otherClient.id));
});
