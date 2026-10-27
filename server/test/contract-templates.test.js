const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('child_process');
const path = require('path');
const AdmZip = require('adm-zip');
const { createTestServer } = require('./helpers');

let server, rm, auditor, external, other, client, roles;
function word(text) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}
const original = word('Первоначальный шаблон'), revised = word('Уточнённые условия');
async function json(res, expected = 200) {
  const data = await res.json(); assert.equal(res.status, expected, JSON.stringify(data)); return data;
}
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `templates-${role}@test.example`;
  const data = await json(await api('/api/users', { email, name: role, role, password: 'TemplatesTest123!' }), 201);
  const db = new DatabaseSync(server.dbPath);
  db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(data.id); db.close();
  const login = await json(await api('/api/auth/login', { email, password: 'TemplatesTest123!' }));
  return { ...data, token: login.token };
}
async function upload(url, fields, bytes = original, token = server.token, filename = 'Шаблон.docx') {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append('file', new Blob([bytes]), filename);
  return fetch(server.baseUrl + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
async function template(extra = {}) {
  return json(await upload('/api/contract-templates', { name: 'Консультационные услуги', contractType: 'Engagement Letter', direction: 'CF&A', changeNote: 'Исходный шаблон', ...extra }), 201);
}
function createPath(t) { return `/api/contract-templates/${t.template.id}/versions/${t.version.id}/create-contract`; }
function creation(extra = {}) { return { clientId: client.id, serviceType: 'Advising', feeType: 'Fixed Fee', feeAmount: 0, currency: 'USD', date: '2026-10-27', requestKey: crypto.randomUUID(), ...extra }; }
async function emptyContract(extra = {}) {
  return json(await api('/api/engagements', { clientId: client.id, clientName: client.name, status: 'Draft', direction: 'CF&A', ...extra }), 201);
}
function filePath(t, v = t.version) { return `/api/contract-templates/${t.template.id}/versions/${v.id}/file`; }
async function bytes(url, token = server.token) {
  const res = await api(url, undefined, token); assert.equal(res.status, 200); return Buffer.from(await res.arrayBuffer());
}

before(async () => {
  server = await createTestServer({ port: 4204, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); auditor = await user('AUDITOR'); external = await user('IC_INDEPENDENT');
  other = await json(await api('/api/auth/signup', { companyName: 'Template other company', name: 'Other owner', email: 'templates-other@test.example', password: 'TemplatesOther123!' }), 201);
  client = await json(await api('/api/ob-clients', { name: 'Клиент шаблонов', direction: 'CF&A', activated: true }), 201);
  roles = (await json(await api('/api/roles'))).roles;
});
after(async () => { if (server) await server.stop(); });

test('template revision metadata is server-authored and preserves Word bytes and Cyrillic filename', async () => {
  const t = await template({ name: '<script>Название</script>' });
  assert.equal(t.template.latestVersion, 1);
  assert.equal(t.version.name, 'Шаблон.docx');
  assert.equal(t.version.version, 1);
  assert.ok(t.version.authorEmail);
  assert.equal(t.version.sha256, crypto.createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(await bytes(filePath(t)), original);
  const detail = await json(await api(`/api/contract-templates/${t.template.id}`));
  assert.equal(detail.versions[0].file_bytes, undefined);
  assert.equal(detail.template.name, '<script>Название</script>');
});

test('two independent contracts copy the chosen revision; updating template or one contract cannot change the others', async () => {
  const t = await template();
  const a = await json(await api(createPath(t), creation(), rm.token), 201);
  const b = await json(await api(createPath(t), creation()), 201);
  assert.notEqual(a.contract.id, b.contract.id);
  assert.equal(a.contract.documentVersion, 1);
  const historyA = await json(await api(`/api/engagements/${a.contract.id}/versions`));
  assert.deepEqual(historyA.versions[0].templateSource, { id: t.version.id, templateId: t.template.id, name: t.template.name, contractType: t.template.contractType, version: 1 });
  const updated = await json(await upload(`/api/contract-templates/${t.template.id}/versions`, { expectedVersion: 1, changeNote: 'Новые условия' }, revised), 201);
  assert.equal(updated.version.version, 2);
  await json(await upload(`/api/engagements/${a.contract.id}/versions`, { expectedVersion: 1, changeNote: 'Правки первого договора' }, revised), 201);
  const historyB = await json(await api(`/api/engagements/${b.contract.id}/versions`));
  assert.equal(historyB.currentVersion, 1);
  assert.deepEqual(await bytes(`/api/engagements/${b.contract.id}/versions/${historyB.versions[0].id}/file`), original);
  assert.deepEqual(await bytes(filePath(t)), original);
  assert.deepEqual(await bytes(filePath(t, updated.version)), revised);
  const old = await json(await api(createPath(t), creation()), 201);
  const oldHistory = await json(await api(`/api/engagements/${old.contract.id}/versions`));
  assert.equal(oldHistory.versions[0].templateSource.version, 1, 'explicitly selected old revision remains usable');
});

test('contract creation is atomic and idempotent and never trusts caller ownership, status or payment fields', async () => {
  const t = await template();
  const body = creation({ clientName: 'Forged', status: 'Active', paid: 999, invoiced: 999, direction: 'FM', documentVersion: 99 });
  const responses = await Promise.all([api(createPath(t), body), api(createPath(t), body)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  const rows = await Promise.all(responses.map(r => r.json()));
  assert.equal(rows[0].contract.id, rows[1].contract.id);
  assert.equal(rows[0].contract.status, 'Draft'); assert.equal(rows[0].contract.direction, 'CF&A');
  assert.equal(rows[0].contract.clientName, client.name); assert.equal(rows[0].contract.paid, 0);
  assert.equal(rows[0].contract.invoiced, 0); assert.equal(rows[0].contract.documentVersion, 1);
  assert.equal((await api(createPath(t), { ...body, feeAmount: 500 })).status, 409);
  assert.equal((await api(createPath(t), body, rm.token)).status, 409);
  const db = new DatabaseSync(server.dbPath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM engagement_document_versions WHERE engagement_id = ?').get(rows[0].contract.id).n, 1);
  db.close();
});

test('archive is reversible, preserves history and blocks new use and updates', async () => {
  const t = await template();
  const body = creation();
  const existing = await json(await api(createPath(t), body), 201);
  const archived = await json(await api(`/api/contract-templates/${t.template.id}/archive`, { archived: true, expectedRevision: 1 }));
  assert.equal(archived.template.archived, true);
  assert.equal((await api(createPath(t), creation())).status, 409);
  assert.equal((await upload(`/api/contract-templates/${t.template.id}/versions`, { expectedVersion: 1, changeNote: 'blocked' }, revised)).status, 409);
  assert.deepEqual(await bytes(filePath(t)), original);
  assert.equal((await json(await api(createPath(t), body))).contract.id, existing.contract.id, 'retry of a committed creation survives archive');
  assert.equal((await api(`/api/contract-templates/${t.template.id}/archive`, { archived: false, expectedRevision: 1 })).status, 409);
  await json(await api(`/api/contract-templates/${t.template.id}/archive`, { archived: false, expectedRevision: archived.template.revision }));
  await json(await api(createPath(t), creation()), 201);
});

test('applying to a blank draft is atomic and never overwrites a file or signed contract', async () => {
  const t = await template(), contract = await emptyContract();
  const url = `/api/contract-templates/${t.template.id}/versions/${t.version.id}/apply`;
  const result = await json(await api(url, { engagementId: contract.id, expectedVersion: 0 }, rm.token), 201);
  assert.equal(result.currentVersion, 1);
  assert.equal((await api(url, { engagementId: contract.id, expectedVersion: 0 })).status, 409);
  for (const patch of [{ contractUrl: 'https://example.com/current.docx' }, { status: 'Active' }, { signedDate: '2026-10-01' }]) {
    const blocked = await emptyContract(patch);
    assert.equal((await api(url, { engagementId: blocked.id, expectedVersion: 0 })).status, 409);
  }
});

test('tenant and FM barriers cover list, history, download, creation and applying', async () => {
  const cfa = await template(), fm = await template({ direction: 'FM' });
  for (const suffix of ['', `/versions/${cfa.version.id}/file`]) {
    assert.equal((await api(`/api/contract-templates/${cfa.template.id}${suffix}`, undefined, other.token)).status, 404);
    assert.equal((await api(`/api/contract-templates/${cfa.template.id}${suffix}`, undefined, external.token)).status, 403);
  }
  assert.equal((await api(createPath(cfa), creation(), other.token)).status, 404);
  assert.equal((await api(filePath(fm), undefined, rm.token)).status, 403);
  assert.equal((await api(`/api/contract-templates/${fm.template.id}`, undefined, rm.token)).status, 403);
  const list = await json(await api('/api/contract-templates', undefined, rm.token));
  assert.equal(list.templates.some(t => t.id === fm.template.id), false);
  assert.equal((await api(`/api/contract-templates/${cfa.template.id}/versions/${fm.version.id}/file`)).status, 404);
  const contract = await emptyContract();
  assert.equal((await api(`/api/contract-templates/${fm.template.id}/versions/${fm.version.id}/apply`, { engagementId: contract.id, expectedVersion: 0 })).status, 400);
  assert.equal((await api(createPath(fm), creation())).status, 400);
  assert.equal((await fetch(server.baseUrl + filePath(cfa))).status, 401);
});

test('customizable template permission is distinct from usage; revocation takes effect immediately and survives migration', async () => {
  const rmRole = roles.find(r => r.code === 'RELATIONSHIP_MANAGER');
  const fields = { name: 'Право RM', contractType: 'NDA', direction: 'CF&A', changeNote: 'Исходная' };
  assert.equal((await upload('/api/contract-templates', fields, original, rm.token)).status, 403);
  await json(await api(`/api/roles/${rmRole.id}`, { manageContractTemplates: true }, server.token, 'PUT'));
  const created = await json(await upload('/api/contract-templates', fields, original, rm.token), 201);
  assert.equal((await upload('/api/contract-templates', { ...fields, direction: 'FM' }, original, rm.token)).status, 403);
  assert.equal((await api(`/api/users/${rm.id}`, undefined, server.token, 'DELETE')).status, 409, 'template authorship prevents hard delete');
  const profileDb = new DatabaseSync(server.dbPath);
  profileDb.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run('Renamed employee', 'renamed-author@test.example', rm.id);
  profileDb.close();
  const deletion = await json(await api(`/api/users/${rm.id}`, undefined, server.token, 'DELETE'), 409);
  assert.ok(deletion.footprint.some(f => f.table === 'contract_template_versions' && f.column === 'created_by'), 'authorship survives a changed email and name');
  await json(await api(`/api/roles/${rmRole.id}`, { manageContractTemplates: false }, server.token, 'PUT'));
  assert.equal((await api(`/api/contract-templates/${created.template.id}/archive`, { archived: true, expectedRevision: 1 }, rm.token)).status, 403);
  const ceoRole = roles.find(r => r.code === 'CEO');
  await json(await api(`/api/roles/${ceoRole.id}`, { manageContractTemplates: false }, server.token, 'PUT'));
  const migration = spawnSync(process.execPath, ['-e', "require('./db')"], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: server.dbPath }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  assert.equal((await json(await api('/api/auth/me'))).permissions.manageContractTemplates, false);
  await json(await api(`/api/roles/${ceoRole.id}`, { manageContractTemplates: true }, server.token, 'PUT'));
});

test('read-only users can view/download but cannot create, upload, apply or archive', async () => {
  const t = await template();
  const list = await json(await api('/api/contract-templates', undefined, auditor.token));
  assert.equal(list.canManage, false); assert.equal(list.canUse, false);
  assert.deepEqual(await bytes(filePath(t), auditor.token), original);
  assert.equal((await api(createPath(t), creation(), auditor.token)).status, 403);
  assert.equal((await api(`/api/contract-templates/${t.template.id}/archive`, { archived: true, expectedRevision: 1 }, auditor.token)).status, 403);
  assert.equal((await upload('/api/contract-templates', {}, original, auditor.token)).status, 403);
});

test('duplicate/stale revision and invalid Word input create no extra history', async () => {
  const t = await template();
  const url = `/api/contract-templates/${t.template.id}/versions`;
  assert.equal((await upload(url, { expectedVersion: 1, changeNote: 'same' })).status, 409);
  const responses = await Promise.all([upload(url, { expectedVersion: 1, changeNote: 'new' }, revised), upload(url, { expectedVersion: 1, changeNote: 'new' }, revised)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  for (const [file, filename] of [[Buffer.alloc(0), 'empty.docx'], [Buffer.from('not zip'), 'invalid.docx'], [Buffer.from('%PDF-1.4'), 'file.pdf']]) {
    assert.equal((await upload(url, { expectedVersion: 2, changeNote: 'invalid' }, file, server.token, filename)).status, 400);
  }
  assert.equal((await json(await api(`/api/contract-templates/${t.template.id}`))).versions.length, 2);
});

test('invalid contract inputs leave no partially created engagement', async () => {
  const t = await template();
  const before = (await json(await api('/api/onboarding'))).engagements.length;
  for (const patch of [{ feeAmount: -1 }, { feeAmount: '100' }, { date: '2026-02-30' }, { currency: 'not-a-currency' }, { clientId: 999999 }, { requestKey: '' }]) {
    const response = await api(createPath(t), creation(patch));
    assert.ok([400, 404].includes(response.status));
  }
  const fmClient = await json(await api('/api/ob-clients', { name: 'FM creation blocked', direction: 'FM', activated: true }), 201);
  assert.equal((await api(createPath(t), creation({ clientId: fmClient.id }), rm.token)).status, 403);
  assert.equal((await json(await api('/api/onboarding'))).engagements.length, before);
});

test('early drafts preserve onboarding progress and protect the client relationship', async () => {
  const t = await template();
  const prospect = await json(await api('/api/ob-clients', { name: 'Client still onboarding', direction: 'CF&A', phase: 1 }), 201);
  const taskData = await json(await api('/api/ob-tasks', { clientId: prospect.id,
    tasks: [{ taskNum: '1.1', title: 'Pre-check', status: 'open', phase: 1, formKey: 'conflict_precheck' }] }), 201);
  const result = await json(await api(createPath(t), creation({ clientId: prospect.id }), rm.token), 201);
  assert.equal(result.contract.status, 'Draft');
  assert.equal(result.contract.documentVersion, 1);
  let process = await json(await api(`/api/engagements/${result.contract.id}/process`, undefined, rm.token));
  assert.equal(process.client.activated, false);
  assert.equal(process.client.phase, 1);
  assert.equal(process.tasks[0].id, taskData.obTasks[0].id);
  assert.equal(process.tasks[0].status, 'open');
  assert.equal(process.approval.available, true);
  assert.equal(process.approval.status, 'draft');
  assert.equal(process.recordedSignatureDate, null, 'contract date is not a signature');
  assert.equal((await api(`/api/ob-clients/${prospect.id}`, undefined, server.token, 'DELETE')).status, 409);
  assert.equal((await api(`/api/ob-clients/${prospect.id}`, { direction: 'FM' }, server.token, 'PUT')).status, 409);
  await json(await api(`/api/ob-tasks/${taskData.obTasks[0].id}`, { status: 'escalated' }, server.token, 'PUT'));
  process = await json(await api(`/api/engagements/${result.contract.id}/process`));
  assert.equal(process.tasks[0].status, 'escalated');
  assert.equal(process.client.activated, false);
  assert.equal(process.approval.status, 'draft', 'escalation does not approve the contract');
  await json(await api(`/api/ob-clients/${prospect.id}`, { activated: true }, server.token, 'PUT'));
  process = await json(await api(`/api/engagements/${result.contract.id}/process`));
  assert.equal(process.client.activated, true);
  assert.equal(process.approval.status, 'draft', 'client activation does not approve the text');
  assert.equal(process.serviceStatus, 'Draft');
});

test('onboarding projection observes parent access and never invents missing checks', async () => {
  const contract = await emptyContract();
  const url = `/api/engagements/${contract.id}/process`;
  const process = await json(await api(url, undefined, auditor.token));
  assert.deepEqual(process.tasks, []);
  assert.equal(process.approval.available, true);
  assert.equal((await api(url, undefined, other.token)).status, 404);
  assert.equal((await api(url, undefined, external.token)).status, 403);
  assert.equal((await fetch(server.baseUrl + url)).status, 401);
  const fm = await json(await api('/api/ob-clients', { name: 'FM process', direction: 'FM' }), 201);
  const fmContract = await emptyContract({ clientId: fm.id, direction: 'FM', serviceType: 'LP Investment (FM)' });
  assert.equal((await api(`/api/engagements/${fmContract.id}/process`, undefined, rm.token)).status, 403);
  const unlinked = await emptyContract({ clientId: null });
  const unlinkedProcess = await json(await api(`/api/engagements/${unlinked.id}/process`));
  assert.equal(unlinkedProcess.client, null);
  assert.deepEqual(unlinkedProcess.tasks, []);
});
