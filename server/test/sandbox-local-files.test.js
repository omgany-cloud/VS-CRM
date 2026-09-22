// Coverage for the Sandbox "server folder" feature (SANDBOX_FILES_ROOT,
// server/index.js's GET/POST /api/sandbox/:id/local-files*) — a way to
// pull documents from a folder that lives on THE SERVER's own disk (a
// mapped share / synced client running there), never from a visitor's own
// computer (no website can reach that). Focus: config visibility, path
// validation (format at save time + realpath re-check at read time),
// listing filters/caps, import copies into the normal uploaded_files
// pipeline, and traversal/tenant isolation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTestServer } = require('./helpers');

let rootDir;
let server;
let projectId;

before(async () => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-root-'));
  fs.mkdirSync(path.join(rootDir, 'ProjectA', 'Legal'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'ProjectA', 'teaser.pdf'), '%PDF-1.1 fake');
  fs.writeFileSync(path.join(rootDir, 'ProjectA', 'Legal', 'nda.docx'), 'fake docx bytes');
  fs.writeFileSync(path.join(rootDir, 'ProjectA', 'notes.txt'), 'not an allowed type');
  fs.writeFileSync(path.join(rootDir, 'ProjectA', '.DS_Store'), 'hidden file');
  // A sibling directory OUTSIDE the project's own subfolder but still
  // inside the root — reachable only if a caller could smuggle '..' past
  // validation; used to prove that can't happen.
  fs.mkdirSync(path.join(rootDir, 'OtherProject'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'OtherProject', 'secret.pdf'), '%PDF-1.1 other tenant secret');

  server = await createTestServer({ port: 4142, extraEnv: { SANDBOX_FILES_ROOT: rootDir } });
  const p = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_LOCAL_TEST' }) })).json();
  projectId = p.id;
});

after(async () => {
  await server.stop();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('GET /api/sandbox/config reports the feature enabled without leaking the real root path', async () => {
  const cfg = await (await server.apiFetch('/api/sandbox/config')).json();
  assert.equal(cfg.localFilesEnabled, true);
  assert.equal(JSON.stringify(cfg).includes(rootDir.replace(/\\/g, '')), false, 'the configured filesystem path must never be echoed back');
});

test('localFolderPath is rejected at save time for absolute paths, UNC paths, and ".." traversal', async () => {
  for (const bad of ['C:\\Windows\\System32', '\\\\fileserver\\share', '/etc/passwd', '../OtherProject', 'ProjectA/../OtherProject', '/ProjectA']) {
    const res = await server.apiFetch(`/api/sandbox/${projectId}`, { method: 'PUT', body: JSON.stringify({ localFolderPath: bad }) });
    assert.equal(res.status, 400, `expected 400 for "${bad}"`);
    assert.equal((await res.json()).field, 'localFolderPath');
  }
});

test('listing without a configured localFolderPath is rejected; setting a real one lists filtered, capped, non-recursive-hidden files', async () => {
  const noPath = await server.apiFetch(`/api/sandbox/${projectId}/local-files`);
  assert.equal(noPath.status, 400);

  const setPath = await server.apiFetch(`/api/sandbox/${projectId}`, { method: 'PUT', body: JSON.stringify({ localFolderPath: 'ProjectA' }) });
  assert.equal(setPath.status, 200);

  const list = await (await server.apiFetch(`/api/sandbox/${projectId}/local-files`)).json();
  const names = list.files.map(f => f.name).sort();
  assert.deepEqual(names, ['nda.docx', 'teaser.pdf'], 'notes.txt (unsupported type) and .DS_Store (dotfile) must be filtered out');
  assert.ok(list.files.every(f => !f.relativePath.includes('..')));
  const legalFile = list.files.find(f => f.name === 'nda.docx');
  assert.equal(legalFile.relativePath, 'ProjectA/Legal/nda.docx', 'nested subfolders are walked, path is relative to the configured root');
});

test('a localFolderPath pointing at a real but nonexistent subfolder 404s, not 400/500', async () => {
  await server.apiFetch(`/api/sandbox/${projectId}`, { method: 'PUT', body: JSON.stringify({ localFolderPath: 'DoesNotExist' }) });
  const res = await server.apiFetch(`/api/sandbox/${projectId}/local-files`);
  assert.equal(res.status, 404);
  await server.apiFetch(`/api/sandbox/${projectId}`, { method: 'PUT', body: JSON.stringify({ localFolderPath: 'ProjectA' }) }); // restore for later tests
});

test('import copies a listed file into the normal uploaded_files/attachment pipeline, and skips a smuggled out-of-root path', async () => {
  const list = await (await server.apiFetch(`/api/sandbox/${projectId}/local-files`)).json();
  const teaser = list.files.find(f => f.name === 'teaser.pdf').relativePath;

  const res = await server.apiFetch(`/api/sandbox/${projectId}/local-files/import`, {
    method: 'POST', body: JSON.stringify({ paths: [teaser, 'OtherProject/secret.pdf', 'ProjectA/nope.pdf'] }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.imported.length, 1);
  assert.equal(body.imported[0].name, 'teaser.pdf');
  assert.equal(body.errors.length, 2, 'the out-of-scope path and the nonexistent one must both be reported, not silently dropped');
  const outOfScope = body.errors.find(e => e.path === 'OtherProject/secret.pdf');
  assert.ok(outOfScope, 'a path outside THIS project\'s own folder — even though still inside the shared root — must be rejected');
  assert.match(outOfScope.error, /вне папки/);

  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.ok(detail.files.some(f => f.name === 'teaser.pdf'), 'imported file now shows up through the ordinary attached-files list');
  assert.ok(detail.history.some(h => h.action === 'file_attached' && h.summary.includes('импортировано')));

  // The imported copy is a real, independent file on disk under UPLOADS_DIR
  // — proves it was actually copied, not just referenced by the original path.
  const uploadId = detail.files.find(f => f.name === 'teaser.pdf').uploadId;
  const dl = await server.apiFetch(`/api/uploads/${uploadId}`);
  assert.equal(dl.status, 200);
});

test('import is rejected outright when the project has no localFolderPath configured', async () => {
  const p = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_NO_PATH' }) })).json();
  const res = await server.apiFetch(`/api/sandbox/${p.id}/local-files/import`, { method: 'POST', body: JSON.stringify({ paths: ['ProjectA/teaser.pdf'] }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).field, 'localFolderPath');
});

test('import rejects an unsupported extension and a file over the size limit', async () => {
  fs.writeFileSync(path.join(rootDir, 'ProjectA', 'big.pdf'), Buffer.alloc(21 * 1024 * 1024, 1)); // > 20MB
  const list = await (await server.apiFetch(`/api/sandbox/${projectId}/local-files`)).json();
  assert.ok(!list.files.some(f => f.name === 'notes.txt'), 'unsupported extension never even appears in the listing');

  const res = await server.apiFetch(`/api/sandbox/${projectId}/local-files/import`, { method: 'POST', body: JSON.stringify({ paths: ['ProjectA/big.pdf'] }) });
  const body = await res.json();
  assert.equal(body.imported.length, 0);
  assert.match(body.errors[0].error, /МБ/);
  fs.rmSync(path.join(rootDir, 'ProjectA', 'big.pdf'));
});

test('local-files routes are blocked on a promoted (locked) project the same as ordinary attach', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'SBX_LOCAL_FUND' }) })).json();
  await server.apiFetch(`/api/sandbox/${projectId}/promote`, { method: 'POST', body: JSON.stringify({ fundId: fund.id }) });
  const res = await server.apiFetch(`/api/sandbox/${projectId}/local-files/import`, { method: 'POST', body: JSON.stringify({ paths: ['ProjectA/teaser.pdf'] }) });
  assert.equal(res.status, 409);
});

test('tenant isolation: another tenant cannot list or import this tenant\'s project folder', async () => {
  const p2 = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_LOCAL_TEST_2', localFolderPath: 'ProjectA' }) })).json();

  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Sandbox Local Isolation Co', name: 'Tenant B Admin', email: 'tenantb-sbx-local@isolationtest.example', password: 'TenantBPassword123' }),
  });
  const { token } = await signup.json();
  const asB = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });

  assert.equal((await asB(`/api/sandbox/${p2.id}/local-files`)).status, 404);
  assert.equal((await asB(`/api/sandbox/${p2.id}/local-files/import`, { method: 'POST', body: JSON.stringify({ paths: ['ProjectA/teaser.pdf'] }) })).status, 404);
});

test('feature is hidden when SANDBOX_FILES_ROOT is unset (existing behavior, sanity check against a second server)', async () => {
  const plain = await createTestServer({ port: 4143 });
  try {
    const cfg = await (await plain.apiFetch('/api/sandbox/config')).json();
    assert.equal(cfg.localFilesEnabled, false);
    const p = await (await plain.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'X' }) })).json();
    const res = await plain.apiFetch(`/api/sandbox/${p.id}/local-files`);
    assert.equal(res.status, 400);
  } finally {
    await plain.stop();
  }
});

/* ----- POST /api/sandbox/:id/local-files/analyze-folder — "analyze the
   whole folder" in one click, own server (needs both SANDBOX_FILES_ROOT
   and a stub AI provider) ----- */
test('analyze-folder: imports every supported file from the folder, reuses already-imported ones on a repeat run, and caps how many get sent to the model', async () => {
  const aiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-ai-root-'));
  const AI_STUB_RESPONSE = {
    summary: 'обзор папки', risks: [], missingInfo: [],
    recommendation: { action: 'consider_screening', rationale: 'ок' }, suggestedTasks: [],
  };
  fs.mkdirSync(path.join(aiRoot, 'Deal'));
  // 6 analyzable images — one more than SANDBOX_ANALYZE_MAX_FILES (5) — plus
  // one unsupported extension that must never be touched.
  for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(aiRoot, 'Deal', `p${i}.png`), Buffer.from([i]));
  fs.writeFileSync(path.join(aiRoot, 'Deal', 'ignore.txt'), 'skip me');

  const aiServer = await createTestServer({
    port: 4144,
    extraEnv: { SANDBOX_FILES_ROOT: aiRoot, AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(AI_STUB_RESPONSE) },
  });
  try {
    const { roles } = await (await aiServer.apiFetch('/api/roles')).json();
    await aiServer.apiFetch(`/api/roles/${roles.find(r => r.code === 'CEO').id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });
    const p = await (await aiServer.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_FOLDER_ANALYZE', localFolderPath: 'Deal' }) })).json();

    const noConsent = await aiServer.apiFetch(`/api/sandbox/${p.id}/local-files/analyze-folder`, { method: 'POST', body: JSON.stringify({}) });
    assert.equal(noConsent.status, 400);
    assert.equal((await noConsent.json()).field, 'consent');

    const res = await aiServer.apiFetch(`/api/sandbox/${p.id}/local-files/analyze-folder`, { method: 'POST', body: JSON.stringify({ consent: true }) });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.result.summary, 'обзор папки');
    assert.equal(body.folderImport.totalInFolder, 6, 'the .txt file must never be counted or imported');
    assert.equal(body.folderImport.imported, 6);
    assert.equal(body.folderImport.analyzed, 5, 'capped at SANDBOX_ANALYZE_MAX_FILES');
    assert.equal(body.folderImport.skipped, 1);

    const afterFirst = await (await aiServer.apiFetch(`/api/sandbox/${p.id}`)).json();
    assert.equal(afterFirst.files.length, 6, 'all 6 images attached, even the one not sent to the model this run');

    // Repeat run: same 6 files still on disk — must be REUSED, not copied again.
    const res2 = await aiServer.apiFetch(`/api/sandbox/${p.id}/local-files/analyze-folder`, { method: 'POST', body: JSON.stringify({ consent: true }) });
    const body2 = await res2.json();
    assert.equal(body2.folderImport.imported, 0, 'already-attached files (same name+size) must be reused, not re-copied');
    const afterSecond = await (await aiServer.apiFetch(`/api/sandbox/${p.id}`)).json();
    assert.equal(afterSecond.files.length, 6, 'no duplicate copies piled up on the second run');
  } finally {
    await aiServer.stop();
    fs.rmSync(aiRoot, { recursive: true, force: true });
  }
});
