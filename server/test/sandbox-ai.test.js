// Coverage for Sandbox file attachments + AI analysis
// (server/index.js's /api/sandbox/:id/files*, /api/sandbox/:id/analyze,
// /api/sandbox/runs/:runId). Runs with AI_PROVIDER=stub (same test-only
// seam as ai-assist.test.js) so these exercise real route logic —
// permission gates, attachment/mime/size/char-budget checks, sourceIds
// clamping, run persistence — without a live API key.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers');

// Deliberately does not include either real upload_id used below — proves
// the server clamps a model-cited source rather than trusting it verbatim.
const AI_STUB_RESPONSE = {
  summary: 'stub summary of the project',
  risks: [{ severity: 'medium', text: 'stub risk finding', sourceIds: ['not-a-real-upload-id'] }],
  missingInfo: ['stub missing info item'],
  recommendation: { action: 'request_information', rationale: 'stub rationale' },
  suggestedTasks: [{ title: 'Запросить финмодель', priority: 'Средний' }],
};

// A structurally valid but content-less PDF (no text stream) — pdf-parse
// extracts no text, but pdfjs-dist CAN still render its (blank) page as an
// image, so this exercises the OCR-fallback success path, not the
// truly-unreadable one.
const BLANK_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
);
// Not a PDF at all — neither pdf-parse nor pdfjs-dist can make anything of
// this, so it's the one that should actually land in `unreadable`.
const GARBAGE_NOT_A_PDF = Buffer.from('this is not a pdf at all, just garbage text bytes 12345');

let server;
let projectId;

async function uploadTestFile(client, bytes, mime, filename) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  return client(server.baseUrl + '/api/uploads', { method: 'POST', headers: {}, body: form });
}
// server.apiFetch always sends Content-Type: application/json, which
// breaks a multipart body — build a raw-fetch variant that carries the
// same bearer token but lets fetch set its own multipart boundary.
function rawFetchAs(token) {
  return (url, opts = {}) => fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
}

before(async () => {
  server = await createTestServer({
    port: 4141,
    extraEnv: { AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(AI_STUB_RESPONSE) },
  });
  await server.apiFetch('/api/roles').then(async r => {
    const { roles } = await r.json();
    const ceo = roles.find(x => x.code === 'CEO');
    await server.apiFetch(`/api/roles/${ceo.id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });
  });
  const p = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_AI_TEST', goal: 'Оценить документы' }) })).json();
  projectId = p.id;
});

after(async () => { await server.stop(); });

async function attach(uploadId) {
  return server.apiFetch(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) });
}

test('a file must be uploaded, then attached — attaching twice is idempotent', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'deck.png');
  assert.equal(up.status, 201);
  const { id: uploadId } = await up.json();

  const first = await attach(uploadId);
  assert.equal(first.status, 201);
  const second = await attach(uploadId);
  assert.equal(second.status, 200, 'attaching the same file twice must not error or duplicate');

  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.equal(detail.files.filter(f => f.uploadId === uploadId).length, 1);
});

test('detaching removes the relation but not the underlying file', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([1, 2, 3]), 'image/png', 'to-detach.png');
  const { id: uploadId } = await up.json();
  const attached = await (await attach(uploadId)).json();

  const del = await server.apiFetch(`/api/sandbox/${projectId}/files/${attached.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.ok(!detail.files.some(f => f.uploadId === uploadId));
  // the raw upload itself must still be downloadable
  assert.equal((await rawFetchAs(server.token)(server.baseUrl + `/api/uploads/${uploadId}`)).status, 200);
});

test('analyze requires consent, at least one uploadId, and files actually attached to this project', async () => {
  const noConsent = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ uploadIds: [1] }) });
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json()).field, 'consent');

  const noFiles = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [] }) });
  assert.equal(noFiles.status, 400);

  const notAttached = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [999999] }) });
  assert.equal(notAttached.status, 400);
});

test('analyze rejects an attached file whose type is not PDF/image', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from('not a pdf'), 'application/msword', 'contract.doc');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /PDF|изображени/);
});

test('analyze rejects more than the per-run file limit', async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([i]), 'image/png', `p${i}.png`);
    const { id } = await up.json();
    await attach(id);
    ids.push(id);
  }
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: ids }) });
  assert.equal(res.status, 400);
});

test('analyze: happy path on an image — validated result, sourceIds clamped to real ids, run persisted and readable both from the project and standalone', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'image/png', 'teaser.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);

  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.status, 'ok');
  assert.equal(run.result.summary, 'stub summary of the project');
  assert.equal(run.result.recommendation.action, 'request_information');
  assert.deepEqual(run.result.risks[0].sourceIds, [], 'a sourceId the model invented (not one of the real upload ids) must be dropped, not trusted');
  assert.equal(run.consentNote.length > 0, true);
  assert.equal(run.inputSnapshot.goal, 'Оценить документы');

  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.ok(detail.aiRuns.some(r => r.id === run.id && r.status === 'ok'));

  const standalone = await (await server.apiFetch(`/api/sandbox/runs/${run.id}`)).json();
  assert.equal(standalone.result.summary, run.result.summary);

  const history = detail.history;
  assert.ok(history.some(h => h.action === 'ai_analyzed'));
});

test('analyze: a PDF with no text layer is rendered to an image and analyzed (OCR fallback), not silently dropped or errored', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), BLANK_PDF, 'application/pdf', 'scan.pdf');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.deepEqual(run.inputSnapshot.unreadable, [], 'a renderable scan must not be marked unreadable — it was analyzed as an image instead');
});

test('analyze: a file that is genuinely not a PDF (extraction AND rendering both fail) is flagged unreadable, not silently dropped or errored', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), GARBAGE_NOT_A_PDF, 'application/pdf', 'corrupt.pdf');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.deepEqual(run.inputSnapshot.unreadable, ['corrupt.pdf']);
});

test('a task can be created from an AI suggestion (sourceAiRunId) and is rejected if the run belongs to another project', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([9, 9]), 'image/png', 'x.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const run = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).json();

  const task = await (await server.apiFetch(`/api/sandbox/${projectId}/tasks`, {
    method: 'POST', body: JSON.stringify({ title: run.result.suggestedTasks[0].title, priority: run.result.suggestedTasks[0].priority, sourceAiRunId: run.id }),
  })).json();
  assert.equal(task.sourceAiRunId, run.id);

  const otherProject = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_AI_OTHER' }) })).json();
  const bad = await server.apiFetch(`/api/sandbox/${otherProject.id}/tasks`, {
    method: 'POST', body: JSON.stringify({ title: 'x', sourceAiRunId: run.id }),
  });
  assert.equal(bad.status, 400);
});

test('permissions: accessFM alone is not enough to analyze — aiAssist is required too, and to attach/detach files only accessFM is needed', async () => {
  const email = 'sbx-ai-analyst@example.com';
  await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email, password: 'SandboxAiTest2026!', role: 'ANALYST', name: 'TEST_ANALYST_AI' }) });
  const first = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'SandboxAiTest2026!' }),
  })).json();
  await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + first.token },
    body: JSON.stringify({ currentPassword: 'SandboxAiTest2026!', newPassword: 'MyOwnPass789!' }),
  });
  const login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'MyOwnPass789!' }),
  })).json();
  const asAnalyst = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) } });

  const up = await uploadTestFile(rawFetchAs(login.token), Buffer.from([5]), 'image/png', 'y.png');
  const { id: uploadId } = await up.json();
  assert.equal((await asAnalyst(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) })).status, 201);

  const denied = await asAnalyst(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /aiAssist/);
});

test('tenant isolation: another tenant cannot attach files, analyze, or read a run', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([7]), 'image/png', 'z.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const run = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).json();

  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Sandbox AI Isolation Co', name: 'Tenant B Admin', email: 'tenantb-sbx-ai@isolationtest.example', password: 'TenantBPassword123' }),
  });
  const { token } = await signup.json();
  const asB = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  // Grant tenant B's own admin aiAssist too — otherwise a 403 from the
  // permission gate (which runs before the tenant-scoped lookup) would be
  // indistinguishable from a real isolation check; this makes the 404
  // below prove tenant scoping specifically, not just permissions.
  const { roles: bRoles } = await (await asB('/api/roles')).json();
  await asB(`/api/roles/${bRoles.find(r => r.code === 'CEO').id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });

  assert.equal((await asB(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/runs/${run.id}`)).status, 404);
});
