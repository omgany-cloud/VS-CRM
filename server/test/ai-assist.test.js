// Coverage for the onboarding AI-assist routes (server/index.js's
// ai-draft/ai-extract/ai-screen, backed by server/aiProvider.js). Runs
// with AI_PROVIDER=stub (a test-only seam in aiProvider.js — see its
// completeJsonStub comment) so these tests exercise the real route logic
// (permission gate, task/client lookup, schema validation) without a live
// API key or network call. One fixture covers every route's schema since
// zod ignores keys a given schema doesn't declare.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

const AI_STUB_RESPONSE = {
  riskJurisdiction: 'Low', riskSanction: 'Low', riskRep: 'Low', riskBusiness: 'Low', riskTotal: 'Low',
  conclusion: 'Одобрить — Approve', mlroNote: 'stub mlro note', rationale: 'stub rationale',
  documentType: 'Passport', extractedName: 'Test Name', extractedIdNumber: '123456',
  extractedAddress: 'Test Address', extractedDob: '2000-01-01', statedSourceOfFunds: 'Salary',
  nameMatchesClient: 'Да', notes: 'stub extract notes',
  possibleMatch: false, matchedEntries: [], confidence: 'Низкая', reasoning: 'stub screen reasoning',
};

let server;
let clientId;
let ddTaskId;

async function uploadTestFile(bytes, mime, filename) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  return fetch(server.baseUrl + '/api/uploads', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + server.token },
    body: form,
  });
}

before(async () => {
  server = await createTestServer({
    port: 4098,
    extraEnv: { AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(AI_STUB_RESPONSE) },
  });

  const client = await (await server.apiFetch('/api/ob-clients', {
    method: 'POST',
    body: JSON.stringify({ name: 'TEST_AI_CLIENT', type: 'Corporate', direction: 'CF&A' }),
  })).json();
  clientId = client.id;

  const tasksRes = await server.apiFetch('/api/ob-tasks', {
    method: 'POST',
    body: JSON.stringify({
      clientId,
      tasks: [{ taskNum: '2.2', title: 'DD Outcome', phase: 2, role: 'CO', formKey: 'dd_outcome', status: 'in_progress', formData: {} }],
    }),
  });
  const { obTasks: created } = await tasksRes.json();
  ddTaskId = created[0].id;
});

after(async () => { await server.stop(); });

test('ai-draft is 403 without the aiAssist permission (default off for the seeded CEO role)', async () => {
  const res = await server.apiFetch(`/api/ob-tasks/${ddTaskId}/ai-draft`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('granting aiAssist via PUT /api/roles/:id (existing roles admin path)', async () => {
  const { roles } = await (await server.apiFetch('/api/roles')).json();
  const ceo = roles.find(r => r.code === 'CEO');
  assert.ok(ceo, 'seeded CEO role must exist');
  const res = await server.apiFetch(`/api/roles/${ceo.id}`, {
    method: 'PUT', body: JSON.stringify({ aiAssist: true }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.aiAssist, true);
});

test('ai-draft returns a validated draft once permitted, and never mutates the task itself', async () => {
  const res = await server.apiFetch(`/api/ob-tasks/${ddTaskId}/ai-draft`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.riskTotal, 'Low');
  assert.equal(body.conclusion, 'Одобрить — Approve');
  assert.equal(typeof body.mlroNote, 'string');
  assert.equal(typeof body.rationale, 'string');

  // No PUT /api/ob-tasks/:id/ai-draft-adjacent write path exists — confirm
  // the task's own formData is untouched by fetching it via the ordinary
  // list route (there's no GET /api/ob-tasks/:id single-resource route).
  const { obTasks } = await (await server.apiFetch('/api/onboarding')).json();
  const task = obTasks.find(t => t.id === ddTaskId);
  assert.deepEqual(task.formData, {}, 'ai-draft must not write to the task it drafted for');
});

test('ai-draft 400s for a task that is not the DD Outcome (2.2) task', async () => {
  const { obTasks: other } = await (await server.apiFetch('/api/ob-tasks', {
    method: 'POST',
    body: JSON.stringify({ clientId, tasks: [{ taskNum: '1.1', title: 'Conflict Pre-Check', phase: 1, role: 'RM', formKey: 'conflict_precheck', status: 'in_progress', formData: {} }] }),
  })).json();
  const res = await server.apiFetch(`/api/ob-tasks/${other[0].id}/ai-draft`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('ai-draft 404s for a task id outside this tenant', async () => {
  const res = await server.apiFetch('/api/ob-tasks/999999/ai-draft', { method: 'POST' });
  assert.equal(res.status, 404);
});

test('ai-extract requires uploadId', async () => {
  const res = await server.apiFetch(`/api/ob-tasks/${ddTaskId}/ai-extract`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('ai-extract rejects a non-PDF/image upload', async () => {
  const uploadRes = await uploadTestFile(Buffer.from('not a real doc'), 'application/msword', 'test.doc');
  assert.equal(uploadRes.status, 201);
  const { id: uploadId } = await uploadRes.json();
  const res = await server.apiFetch(`/api/ob-tasks/${ddTaskId}/ai-extract`, { method: 'POST', body: JSON.stringify({ uploadId }) });
  assert.equal(res.status, 400);
});

test('ai-extract returns a validated extraction for an image upload', async () => {
  const uploadRes = await uploadTestFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'image/png', 'test.png');
  assert.equal(uploadRes.status, 201);
  const { id: uploadId } = await uploadRes.json();
  const res = await server.apiFetch(`/api/ob-tasks/${ddTaskId}/ai-extract`, { method: 'POST', body: JSON.stringify({ uploadId }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.documentType, 'Passport');
  assert.equal(body.nameMatchesClient, 'Да');
});

test('ai-screen returns a validated flag and never writes restrictedMatch itself', async () => {
  const res = await server.apiFetch(`/api/ob-clients/${clientId}/ai-screen`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.possibleMatch, false);
  assert.equal(body.confidence, 'Низкая');

  const { obClients } = await (await server.apiFetch('/api/onboarding')).json();
  const client = obClients.find(c => c.id === clientId);
  assert.equal(client.restrictedMatch, false, 'ai-screen must not write restrictedMatch itself');
});

test('ai-screen 404s for a client id outside this tenant', async () => {
  const res = await server.apiFetch('/api/ob-clients/999999/ai-screen', { method: 'POST' });
  assert.equal(res.status, 404);
});
