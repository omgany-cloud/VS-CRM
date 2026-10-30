const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, auditor;
const key = () => crypto.randomUUID();
function word(text) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  return zip.toBuffer();
}
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `chatver-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Chat ' + role, role, password: 'ChatVersion123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'ChatVersion123!' }))).token };
}
async function contract() {
  const client = await json(await api('/api/ob-clients', { name: 'Chat version client', direction: 'CF&A' }), 201);
  return json(await api('/api/engagements', { clientId: client.id, clientName: client.name, serviceType: 'Advising', status: 'Draft', feeAmount: 10, direction: 'CF&A', date: '2026-10-01' }, rm.token), 201);
}
// A chat message in the contract's task with the given attachments.
async function attach(e, files, { version = 0, cycle = null } = {}) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ text: 'Новая редакция в приложении', requestKey: key(), expectedVersion: version, expectedCycleId: cycle }));
  for (const [name, bytes] of files) form.append('files', new Blob([bytes]), name);
  const res = await fetch(server.baseUrl + `/api/engagements/${e.id}/approvals/chat`, { method: 'POST', headers: { Authorization: 'Bearer ' + rm.token }, body: form });
  return (await json(res, 201)).message.attachments;
}
const promote = (e, body, token = rm.token) => api(`/api/engagements/${e.id}/versions/from-attachment`, body, token);

before(async () => {
  server = await createTestServer({ port: 4221, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); auditor = await user('AUDITOR');
});
after(async () => { if (server) await server.stop(); });

test('a contract file attached in the task becomes a revision only by the explicit command', async () => {
  const e = await contract(), other = await contract();
  const [docx, note] = await attach(e, [['Договор v2.docx', word('Редакция из чата')], ['заметка.txt', Buffer.from('просто текст')]]);
  const [foreign] = await attach(other, [['Чужой.docx', word('Чужой договор')]]);
  assert.equal((await json(await api(`/api/engagements/${e.id}/versions`, undefined, rm.token))).currentVersion, 0, 'an attachment alone is not a revision');

  await json(await promote(e, { fileId: docx.id, changeNote: ' ', expectedVersion: 0 }), 400);
  await json(await promote(e, { fileId: note.id, changeNote: 'Текст', expectedVersion: 0 }), 400);
  await json(await promote(e, { fileId: foreign.id, changeNote: 'Чужой', expectedVersion: 0 }), 404);
  await json(await promote(e, { fileId: docx.id, changeNote: 'Не та версия', expectedVersion: 1 }), 409);
  await json(await promote(e, { fileId: docx.id, changeNote: 'Только просмотр', expectedVersion: 0 }, auditor.token), 403);

  const saved = await json(await promote(e, { fileId: docx.id, changeNote: 'Правки юриста из переписки', expectedVersion: 0 }), 201);
  assert.deepEqual([saved.currentVersion, saved.version.name, saved.version.changeNote, saved.version.author], [1, 'Договор v2.docx', 'Правки юриста из переписки', 'Chat RELATIONSHIP_MANAGER']);
  await json(await promote(e, { fileId: docx.id, changeNote: 'Ещё раз', expectedVersion: 0 }), 409);
  assert.match((await json(await promote(e, { fileId: docx.id, changeNote: 'Тот же файл', expectedVersion: 1 }), 409)).error, /уже является текущей версией/);
  const chat = await json(await api(`/api/engagements/${e.id}/approvals/chat`, undefined, rm.token));
  assert.deepEqual(chat.documents.map(d => [d.version, d.filename]), [[1, 'Договор v2.docx']], 'the new revision shows in the task too');

  // While the revision is under approval it is frozen, as for an upload in the card.
  const cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null, participants: [co.id], dueDays: 3, requestKey: key() }, rm.token), 201)).cycle;
  const [later] = await attach(e, [['Договор v3.docx', word('Ещё правки')]], { version: 1, cycle: cycle.id });
  await json(await promote(e, { fileId: later.id, changeNote: 'Во время согласования', expectedVersion: 1 }), 409);
});
