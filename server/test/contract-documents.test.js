const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const AdmZip = require('adm-zip');
const { createTestServer } = require('./helpers');

let server, rm, auditor, external, otherTenant;
const pdf = Buffer.from('%PDF-1.4\nContract revision one\n%%EOF');
const pdf2 = Buffer.from('%PDF-1.4\nContract revision two\n%%EOF');

async function json(response, expected = 200) {
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}
function headers(token = server.token) { return { Authorization: 'Bearer ' + token }; }
async function request(url, token, options = {}) {
  return server.apiFetch(url, { ...options, headers: headers(token) });
}
async function makeUser(role, suffix) {
  const email = `contract-${suffix}@test.example`;
  const user = await json(await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ name: suffix, email, role, password: 'ContractTest123!' }) }), 201);
  // Fixture-only: avoid the mandatory password-change gate, which is not the
  // contract feature under test (and deliberately blocks read-only users).
  const connection = new DatabaseSync(server.dbPath);
  connection.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(user.id);
  connection.close();
  const login = await json(await server.apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'ContractTest123!' }) }));
  return { ...user, token: login.token };
}
async function makeContract(extra = {}) {
  return json(await server.apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify({
    clientName: 'Тестовый клиент', contractNum: 'TEST-DOC', direction: 'CF&A', serviceType: 'Advising',
    feeAmount: 100, currency: 'USD', status: 'Draft', ...extra,
  }) }), 201);
}
async function upload(contract, expected = 0, bytes = pdf, options = {}) {
  const form = new FormData();
  form.append('expectedVersion', String(expected));
  form.append('changeNote', options.note ?? 'Первоначальная редакция');
  if (options.forgedAuthor) form.append('createdBy', '999999');
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), options.filename || 'Договор.pdf');
  return fetch(`${server.baseUrl}/api/engagements/${contract.id}/versions`, { method: 'POST', headers: headers(options.token), body: form });
}
async function history(contract, token) {
  return json(await request(`/api/engagements/${contract.id}/versions`, token));
}
function downloadPath(contract, version) { return `/api/engagements/${contract.id}/versions/${version.id}/file`; }

before(async () => {
  server = await createTestServer({ port: 4201, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await makeUser('RELATIONSHIP_MANAGER', 'rm');
  auditor = await makeUser('AUDITOR', 'auditor');
  external = await makeUser('IC_INDEPENDENT', 'external');
  otherTenant = await json(await server.apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({
    companyName: 'Contract tenant B', name: 'Other owner', email: 'other@contract-test.example', password: 'ContractOther123!',
  }) }), 201);
});
after(async () => { if (server) await server.stop(); });

test('PDF/DOCX history is immutable, numbered, server-authored and downloadable byte for byte', async () => {
  const contract = await makeContract({ contractUrl: 'https://example.com/legacy.pdf' });
  assert.equal((await upload(contract, 0, pdf, { token: rm.token, forgedAuthor: true })).status, 400);
  const first = await json(await upload(contract, 0, pdf, { token: rm.token }), 201);
  assert.equal(first.version.version, 1);
  assert.equal(first.version.name, 'Договор.pdf');
  assert.equal(first.version.authorEmail, rm.email);
  assert.equal(first.version.sha256, crypto.createHash('sha256').update(pdf).digest('hex'));
  assert.ok(Number.isFinite(Date.parse(first.version.createdAt)));
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zip.addFile('word/document.xml', Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'));
  const docx = zip.toBuffer();
  const second = await json(await upload(contract, 1, docx, { filename: 'Редакция 2.docx', note: 'Уточнили сроки' }), 201);
  const data = await history(contract);
  assert.deepEqual(data.versions.map(v => v.version), [2, 1]);
  assert.equal(data.currentVersion, 2);
  assert.equal(data.metadataChanged, false);
  assert.equal('file_bytes' in data.versions[0], false);
  for (const [version, bytes] of [[first.version, pdf], [second.version, docx]]) {
    const response = await request(downloadPath(contract, version), rm.token);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /^attachment;/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  const register = await json(await server.apiFetch('/api/onboarding'));
  const row = register.engagements.find(e => e.id === contract.id);
  assert.equal(row.documentVersion, 2);
  assert.equal(row.contractUrl, 'https://example.com/legacy.pdf');
  const connection = new DatabaseSync(server.dbPath);
  const audit = connection.prepare("SELECT * FROM audit_log WHERE entity_type = 'engagements' AND entity_id = ? AND action = 'document_version_added'").all(contract.id);
  connection.close();
  assert.equal(audit.length, 2);
});

test('same file and stale/concurrent requests do not create duplicate versions', async () => {
  const contract = await makeContract();
  await json(await upload(contract), 201);
  assert.equal((await upload(contract, 1)).status, 409);
  assert.equal((await upload(contract, 0, pdf2)).status, 409);
  const raced = await Promise.all([upload(contract, 1, pdf2), upload(contract, 1, pdf2)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [201, 409]);
  assert.equal((await history(contract)).versions.length, 2);
});

test('snapshots retain old terms; current metadata changes are visible and can be versioned', async () => {
  const contract = await makeContract();
  await json(await upload(contract), 201);
  await json(await server.apiFetch(`/api/engagements/${contract.id}`, { method: 'PUT', body: JSON.stringify({ feeAmount: 250, documentVersion: 0, notes: 'Updated terms' }) }));
  let data = await history(contract);
  assert.equal(data.currentVersion, 1, 'caller cannot overwrite the server counter');
  assert.equal(data.metadataChanged, true);
  assert.equal(data.versions[0].metadata.feeAmount, 100);
  await json(await upload(contract, 1, pdf, { note: 'Обновлены реквизиты карточки' }), 201);
  data = await history(contract);
  assert.equal(data.metadataChanged, false);
  assert.equal(data.versions[0].metadata.feeAmount, 250);
  assert.equal(data.versions[1].metadata.feeAmount, 100);
});

test('invalid, empty, oversized and malformed uploads leave history unchanged', async () => {
  const contract = await makeContract();
  for (const [bytes, options] of [[pdf, { note: '  ' }], [pdf, { note: 'x'.repeat(2001) }],
    [Buffer.alloc(0), {}], [pdf, { filename: 'bad.exe' }], [Buffer.from('<html>bad</html>'), {}],
    [Buffer.from('invalid ZIP'), { filename: 'bad.docx' }]]) {
    assert.equal((await upload(contract, 0, bytes, options)).status, 400);
  }
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1, 65);
  assert.equal((await upload(contract, 0, oversized)).status, 413);
  assert.equal((await upload(contract, 'invalid')).status, 400);
  assert.equal((await history(contract)).currentVersion, 0);
  assert.equal((await history(contract)).versions.length, 0);
});

test('tenant, parent, authentication and external-user boundaries protect lists and bytes', async () => {
  const contract = await makeContract();
  const otherContract = await makeContract();
  const result = await json(await upload(contract), 201);
  const filePath = downloadPath(contract, result.version);
  for (const endpoint of [`/api/engagements/${contract.id}/versions`, filePath]) {
    assert.equal((await fetch(server.baseUrl + endpoint)).status, 401);
    assert.equal((await request(endpoint, otherTenant.token)).status, 404);
    assert.equal((await request(endpoint, external.token)).status, 403);
  }
  assert.equal((await upload(contract, 1, pdf2, { token: otherTenant.token })).status, 404);
  assert.equal((await request(downloadPath(otherContract, result.version), server.token)).status, 404);
  assert.equal((await fetch(server.baseUrl + filePath + '?token=' + server.token)).status, 401);
});

test('FM barrier covers own direction, service type and linked client, including the register', async () => {
  const client = await json(await server.apiFetch('/api/ob-clients', { method: 'POST', body: JSON.stringify({ name: 'FM client', direction: 'FM' }) }), 201);
  for (const extra of [{ direction: 'FM' }, { serviceType: 'LP Investment (FM)' }, { clientId: client.id, direction: 'CF&A' }]) {
    const contract = await makeContract(extra);
    const result = await json(await upload(contract), 201);
    assert.equal((await request(`/api/engagements/${contract.id}/versions`, rm.token)).status, 403);
    assert.equal((await request(downloadPath(contract, result.version), rm.token)).status, 403);
    assert.equal((await upload(contract, 1, pdf2, { token: rm.token })).status, 403);
    const register = await json(await request('/api/onboarding', rm.token));
    assert.equal(register.engagements.some(e => e.id === contract.id), false);
  }
});

test('auditor can download but cannot upload; users with authorship must be deactivated instead of deleted', async () => {
  const contract = await makeContract();
  const result = await json(await upload(contract, 0, pdf, { token: rm.token }), 201);
  assert.equal((await history(contract, auditor.token)).canUpload, false);
  assert.equal((await request(downloadPath(contract, result.version), auditor.token)).status, 200);
  assert.equal((await upload(contract, 1, pdf2, { token: auditor.token })).status, 403);
  assert.equal((await server.apiFetch(`/api/users/${rm.id}`, { method: 'DELETE' })).status, 409);
});

test('versions prevent deletion and client/direction reassignment, while payment edits remain usable', async () => {
  const contract = await makeContract();
  await json(await upload(contract), 201);
  assert.equal((await server.apiFetch(`/api/engagements/${contract.id}`, { method: 'DELETE' })).status, 409);
  for (const patch of [{ direction: 'FM' }, { clientId: 999999 }, { serviceType: 'LP Investment (FM)' }]) {
    assert.equal((await server.apiFetch(`/api/engagements/${contract.id}`, { method: 'PUT', body: JSON.stringify(patch) })).status, 409);
  }
  await json(await server.apiFetch(`/api/engagements/${contract.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'Закрыт', status: 'Terminated' }) }));
  assert.equal((await history(contract)).metadataChanged, false);
});

test('cross-tenant client references cannot be introduced through the legacy contract API', async () => {
  const client = await json(await request('/api/ob-clients', otherTenant.token, { method: 'POST', body: JSON.stringify({ name: 'Tenant B client', direction: 'CF&A' }) }), 201);
  assert.equal((await server.apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify({ clientName: 'Invalid', clientId: client.id }) })).status, 404);
  const contract = await makeContract();
  assert.equal((await server.apiFetch(`/api/engagements/${contract.id}`, { method: 'PUT', body: JSON.stringify({ clientId: client.id }) })).status, 404);
});

test('migration can run again without altering existing versions', async () => {
  const contract = await makeContract();
  const result = await json(await upload(contract), 201);
  const migrated = spawnSync(process.execPath, ['-e', "require('./db')"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: server.dbPath }, encoding: 'utf8',
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.equal((await history(contract)).versions[0].id, result.version.id);
  assert.deepEqual(Buffer.from(await (await server.apiFetch(downloadPath(contract, result.version))).arrayBuffer()), pdf);
});

test('static serving exposes frontend assets, never database/server source or encoded traversal paths', async () => {
  for (const endpoint of ['/server/data/test-4201.sqlite', '/server/index.js', '/%73erver/data/test-4201.sqlite',
    '/css/%2e%2e/server/data/test-4201.sqlite', '/css/..%2fserver/data/test-4201.sqlite', '/.env']) {
    assert.equal((await fetch(server.baseUrl + endpoint)).status, 404, endpoint);
  }
  for (const endpoint of ['/index.html', '/js/contract-documents.js', '/css/contract-documents.css', '/']) {
    assert.equal((await fetch(server.baseUrl + endpoint)).status, 200, endpoint);
  }
});

test('deactivation immediately revokes file access using an otherwise unexpired token', async () => {
  const contract = await makeContract();
  const result = await json(await upload(contract), 201);
  await json(await server.apiFetch(`/api/users/${rm.id}`, { method: 'PUT', body: JSON.stringify({ active: false }) }));
  assert.equal((await request(downloadPath(contract, result.version), rm.token)).status, 401);
  assert.equal((await request(`/api/engagements/${contract.id}/versions`, rm.token)).status, 401);
});
