// Coverage for "Импорт из XMind" (server/xmindImport.js,
// POST /api/sandbox/xmind/upload|import) — a one-way, file-based import
// (there is no live XMind API to sync against), keyed by each XMind
// topic's own internal id so a re-import of an edited map updates
// existing projects/tasks instead of duplicating them. Every fixture map
// here is built programmatically (AdmZip) rather than committing a real
// .xmind binary, so the exact tree shape under test is explicit.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { createTestServer } = require('./helpers');

function buildXmindFixture(rootTopic, { sheetTitle = 'Лист 1', sheetId = 'sheet1', extraFiles = {} } = {}) {
  const zip = new AdmZip();
  const content = [{ id: sheetId, class: 'sheet', title: sheetTitle, rootTopic }];
  zip.addFile('content.json', Buffer.from(JSON.stringify(content), 'utf8'));
  zip.addFile('metadata.json', Buffer.from('{}', 'utf8'));
  for (const [path, bytes] of Object.entries(extraFiles)) zip.addFile(path, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return zip.toBuffer();
}

const topic = (id, title, children, extra = {}) => ({ id, title, children: { attached: children || [] }, ...extra });

// One project ("proj1") with: two ordinary task leaves, one placeholder
// (must be skipped), one attachment topic (a fake PDF) whose own child is
// a task (must still surface — recursion continues past an attachment),
// a "nested_parent" branch whose child "nested_child" is a project
// candidate in its own right (recursion must be able to stop there when
// the caller selects it separately), and one leaf with an external
// source link (must be appended to the task title).
function baseTree() {
  return topic('root', 'Root', [
    topic('proj1', 'Project One', [
      topic('ctx1', 'Context node (not itself a task)', [
        topic('task1', 'Do thing A'),
        topic('task2', 'Do thing B'),
        topic('placeholder1', 'Подтема 1'),
      ]),
      topic('attach1', 'fake.pdf', [
        topic('task3', 'Task under attachment'),
      ], { href: 'xap:resources/fake.pdf' }),
      topic('nested_parent', 'Nested Parent', [
        topic('nested_child', 'Nested Child (separately selectable)', [
          topic('nested_child_task', 'Task under nested child'),
        ]),
        topic('sibling_task', 'Sibling task under nested parent'),
      ]),
      topic('src1', 'Idea with a source', [], { href: 'https://example.com/source' }),
    ]),
  ]);
}

let server;

before(async () => { server = await createTestServer({ port: 4147 }); });
after(async () => { await server.stop(); });

async function uploadFixture(fixtureBuf, filename = 'Карта.xmind') {
  const form = new FormData();
  form.append('file', new Blob([fixtureBuf]), filename);
  const res = await fetch(server.baseUrl + '/api/sandbox/xmind/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + server.token }, body: form });
  return res;
}

test('upload rejects a non-.xmind filename and a file that is not a real zip', async () => {
  const notXmind = await uploadFixture(Buffer.from('hello'), 'notes.txt');
  assert.equal(notXmind.status, 400);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('this is not a zip at all')]), 'fake.xmind');
  const res = await fetch(server.baseUrl + '/api/sandbox/xmind/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + server.token }, body: form });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /не похоже на настоящий/);
});

test('upload rejects a .xmind with no content.json (legacy XMind 8) with a clear message', async () => {
  const zip = new AdmZip();
  zip.addFile('content.xml', Buffer.from('<xmap-content/>'));
  const res = await uploadFixture(zip.toBuffer());
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /XMind 8/);
});

test('upload parses the tree correctly: placeholder, attachment, and source-link flags', async () => {
  const res = await uploadFixture(buildXmindFixture(baseTree(), { extraFiles: { 'resources/fake.pdf': '%PDF-1.4 fake' } }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.sheets.length, 1);
  assert.equal(body.sheets[0].title, 'Лист 1');
  const proj1 = body.sheets[0].root.children[0];
  assert.equal(proj1.title, 'Project One');
  const byId = id => { const walk = n => (n.id === id ? n : n.children.map(walk).find(Boolean)); return walk(body.sheets[0].root); };
  assert.equal(byId('placeholder1').isPlaceholder, true);
  assert.equal(byId('task1').isPlaceholder, false);
  assert.equal(byId('attach1').hasAttachment, true);
  assert.equal(byId('attach1').attachmentName, 'fake.pdf');
  assert.equal(byId('src1').sourceUrl, 'https://example.com/source');
  return body.uploadId; // not used here, just confirms it's present
});

test('import: creates the project, skips the placeholder, walks past an attachment to its task, imports the real file bytes, and appends the source link', async () => {
  const upRes = await uploadFixture(buildXmindFixture(baseTree(), { extraFiles: { 'resources/fake.pdf': '%PDF-1.4 fake bytes here' } }));
  const { uploadId, sheets } = await upRes.json();

  const res = await server.apiFetch('/api/sandbox/xmind/import', {
    method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [{ topicId: 'proj1' }] }),
  });
  assert.equal(res.status, 201);
  const { summary } = await res.json();
  assert.equal(summary.projectsCreated, 1);
  assert.equal(summary.filesImported, 1);
  // task1, task2, task3 (past the attachment), nested_child_task + sibling_task
  // (nested_child was NOT separately selected here, so its whole subtree
  // counts toward proj1), src1 (with its link appended) = 6. placeholder1 excluded.
  assert.equal(summary.tasksCreated, 6);

  const { projects } = await (await server.apiFetch('/api/sandbox')).json();
  const proj = projects.find(p => p.name === 'Project One');
  assert.ok(proj);
  const detail = await (await server.apiFetch(`/api/sandbox/${proj.id}`)).json();
  const titles = detail.tasks.map(t => t.title);
  assert.ok(titles.includes('Do thing A'));
  assert.ok(titles.includes('Task under attachment'));
  assert.ok(titles.includes('Task under nested child'), 'nested_child was not selected separately, so its subtree belongs to proj1');
  assert.ok(titles.some(t => t.startsWith('Idea with a source') && t.includes('https://example.com/source')));
  assert.ok(!titles.some(t => t.includes('Подтема')), 'the placeholder must never become a task');

  assert.equal(detail.files.length, 1);
  assert.equal(detail.files[0].name, 'fake.pdf');
  assert.equal(detail.files[0].mimeType, 'application/pdf');
  const dl = await server.apiFetch(`/api/uploads/${detail.files[0].uploadId}`);
  assert.equal(dl.status, 200);
});

test('import: selecting a deeply nested topic as its OWN project stops the parent from also claiming it as a task', async () => {
  // Own, never-reused topic ids — this must hold regardless of what other
  // tests in this file already imported into sandbox_xmind_links, not
  // just on a pristine server.
  const tree = topic('root', 'Root', [
    topic('n_parent', 'Nesting Parent Project', [
      topic('n_branch', 'Branch (not a task itself)', [
        topic('n_child', 'Nesting Child Project', [
          topic('n_child_task', 'Task under nesting child'),
        ]),
        topic('n_sibling_task', 'Sibling task under nesting parent'),
      ]),
    ]),
  ]);
  const { uploadId, sheets } = await (await uploadFixture(buildXmindFixture(tree))).json();

  const res = await server.apiFetch('/api/sandbox/xmind/import', {
    method: 'POST',
    body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [{ topicId: 'n_parent' }, { topicId: 'n_child' }] }),
  });
  assert.equal(res.status, 201);
  const { summary } = await res.json();
  assert.equal(summary.projectsCreated, 2);

  const { projects } = await (await server.apiFetch('/api/sandbox')).json();
  const parentProj = projects.find(p => p.name === 'Nesting Parent Project');
  const childProj = projects.find(p => p.name === 'Nesting Child Project');
  assert.ok(childProj, 'the nested topic must become its own project');

  const parentDetail = await (await server.apiFetch(`/api/sandbox/${parentProj.id}`)).json();
  assert.ok(!parentDetail.tasks.some(t => t.title === 'Task under nesting child'), 'must not be claimed by the parent once selected separately');
  assert.ok(parentDetail.tasks.some(t => t.title === 'Sibling task under nesting parent'), 'the sibling stays with the parent');

  const childDetail = await (await server.apiFetch(`/api/sandbox/${childProj.id}`)).json();
  assert.ok(childDetail.tasks.some(t => t.title === 'Task under nesting child'));
});

test('re-import of the same map is idempotent: no duplicate projects/tasks/files, and edits made inside the CRM survive', async () => {
  const fixture = buildXmindFixture(baseTree(), { extraFiles: { 'resources/fake.pdf': '%PDF-1.4 fake' } });
  const { uploadId: up1, sheets: sheets1 } = await (await uploadFixture(fixture)).json();
  const body = { uploadId: up1, sheetId: sheets1[0].id, selections: [{ topicId: 'proj1' }] };
  await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify(body) });

  const { projects } = await (await server.apiFetch('/api/sandbox')).json();
  const proj = projects.find(p => p.name === 'Project One');
  await server.apiFetch(`/api/sandbox/${proj.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Renamed inside the CRM', version: proj.version }) });

  // A second upload of the identical bytes (as if the user re-exported
  // the same, unedited map) gets its own uploadId — re-import must still
  // match by XMIND TOPIC id, not by which upload it came from.
  const { uploadId: up2, sheets: sheets2 } = await (await uploadFixture(fixture)).json();
  const res2 = await server.apiFetch('/api/sandbox/xmind/import', {
    method: 'POST', body: JSON.stringify({ uploadId: up2, sheetId: sheets2[0].id, selections: [{ topicId: 'proj1' }] }),
  });
  const { summary } = await res2.json();
  assert.equal(summary.projectsCreated, 0);
  assert.equal(summary.projectsUpdated, 1);
  assert.equal(summary.tasksCreated, 0);
  assert.equal(summary.tasksSkipped, 6);
  assert.equal(summary.filesImported, 0);
  assert.equal(summary.filesSkipped, 1);
  assert.deepEqual(summary.fieldsKeptFromCrm, ['«Renamed inside the CRM»: название']);

  const after = await (await server.apiFetch(`/api/sandbox/${proj.id}`)).json();
  assert.equal(after.project.name, 'Renamed inside the CRM', 'the CRM edit must not be clobbered by re-import');
  const { projects: allAfter } = await (await server.apiFetch('/api/sandbox')).json();
  assert.equal(allAfter.filter(p => p.name.includes('Project One') || p.name.includes('Renamed inside the CRM')).length, 1, 'no duplicate project created');
});

test('import: a project already accepted into screening is skipped, not overwritten', async () => {
  const fund = await (await server.apiFetch('/api/funds', { method: 'POST', body: JSON.stringify({ name: 'XMIND_TEST_FUND' }) })).json();
  const { uploadId, sheets } = await (await uploadFixture(buildXmindFixture(baseTree()))).json();
  await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [{ topicId: 'proj1' }] }) });

  const { projects } = await (await server.apiFetch('/api/sandbox')).json();
  const proj = projects.find(p => p.name === 'Project One');
  await server.apiFetch(`/api/sandbox/${proj.id}/promote`, { method: 'POST', body: JSON.stringify({ fundId: fund.id }) });

  const { uploadId: up2, sheets: sheets2 } = await (await uploadFixture(buildXmindFixture(baseTree()))).json();
  const res = await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId: up2, sheetId: sheets2[0].id, selections: [{ topicId: 'proj1' }] }) });
  const { summary } = await res.json();
  assert.equal(summary.projectsSkippedPromoted, 1);
  assert.equal(summary.projectsUpdated, 0);
  assert.equal(summary.tasksCreated, 0, 'a promoted project must not gain new tasks from a re-import either');
});

test('import validation: missing fields, unknown topic id, and too many selections', async () => {
  const { uploadId, sheets } = await (await uploadFixture(buildXmindFixture(baseTree()))).json();

  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ sheetId: sheets[0].id, selections: [{ topicId: 'proj1' }] }) })).status, 400);
  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, selections: [{ topicId: 'proj1' }] }) })).status, 400);
  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [] }) })).status, 400);
  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [{ topicId: 'does-not-exist' }] }) })).status, 400);
  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId: 999999, sheetId: sheets[0].id, selections: [{ topicId: 'proj1' }] }) })).status, 404);

  const tooMany = Array.from({ length: 201 }, (_, i) => ({ topicId: 'proj1' }));
  assert.equal((await server.apiFetch('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: tooMany }) })).status, 400);
});

test('tenant isolation: another tenant cannot import using this tenant\'s uploadId', async () => {
  const { uploadId, sheets } = await (await uploadFixture(buildXmindFixture(baseTree()))).json();
  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ XMind Isolation Co', name: 'Tenant B Admin', email: 'tenantb-xmind@isolationtest.example', password: 'TenantBPassword123' }),
  });
  const { token } = await signup.json();
  const asB = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const res = await asB('/api/sandbox/xmind/import', { method: 'POST', body: JSON.stringify({ uploadId, sheetId: sheets[0].id, selections: [{ topicId: 'proj1' }] }) });
  assert.equal(res.status, 404);
});

test('permissions: accessFM is required to upload or import', async () => {
  await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email: 'sbx-xmind-rm@example.com', password: 'XmindTest2026!', role: 'RELATIONSHIP_MANAGER', name: 'TEST_RM_XMIND' }) });
  const first = await (await fetch(server.baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sbx-xmind-rm@example.com', password: 'XmindTest2026!' }) })).json();
  await fetch(server.baseUrl + '/api/users/me/password', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + first.token }, body: JSON.stringify({ currentPassword: 'XmindTest2026!', newPassword: 'MyOwnPass789!' }) });
  const login = await (await fetch(server.baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sbx-xmind-rm@example.com', password: 'MyOwnPass789!' }) })).json();

  const form = new FormData();
  form.append('file', new Blob([buildXmindFixture(baseTree())]), 'Карта.xmind');
  const res = await fetch(server.baseUrl + '/api/sandbox/xmind/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + login.token }, body: form });
  assert.equal(res.status, 403);
});
