const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');
let server, rm, co, auditor, external, outsider, other;
const key = () => crypto.randomUUID();
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role, suffix = role) {
  const email = `discussion-${suffix}@test.example`;
  const u = await json(await api('/api/users', { email, name: role + suffix, role, password: 'Discussion123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  const login = await json(await api('/api/auth/login', { email, password: 'Discussion123!' })); return { ...u, token: login.token };
}
async function room(participants = [co.id], token = server.token) {
  return json(await api('/api/discussions', { title: 'Свободная тема', participants, requestKey: key() }, token), 201);
}
async function multipart(url, payload, files, token = server.token) {
  const form = new FormData(); form.append('payload', JSON.stringify(payload));
  files.forEach(f => form.append('files', new Blob([f.bytes]), f.name));
  return fetch(server.baseUrl + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
async function client(direction = 'CF&A') { return json(await api('/api/ob-clients', { name: 'Discussion test', direction }), 201); }
before(async () => {
  server = await createTestServer({ port: 4256, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); auditor = await user('AUDITOR');
  external = await user('IC_INDEPENDENT'); outsider = await user('CFO', 'outsider');
  other = await json(await api('/api/auth/signup', { companyName: 'Other discussions', name: 'Other', email: 'other-chat@test.example', password: 'Discussion123!' }), 201);
});
after(async () => { if (server) await server.stop(); });

test('process catalogue keeps empty sections visible and scopes records and counts to tenant and permissions', async () => {
  const admin = await json(await api('/api/discussions/sources'));
  const expected = ['client','contract','conflict','sandbox','deal','ic','portfolio','spv','lp','capital-call','distribution','closing','fund','subscription','redemption','nav','workflow','restricted','coi','report'];
  assert.deepEqual(admin.categories.map(c => c.kind), expected);
  for (const category of admin.categories) assert.equal(category.count, admin.items.filter(s => s.kind === category.kind).length);
  const empty = await json(await api('/api/discussions/sources', undefined, other.token));
  assert.equal(empty.categories.length, expected.length); assert.ok(empty.categories.every(c => c.count === 0));
  const restricted = await json(await api('/api/discussions/sources', undefined, rm.token));
  assert.ok(restricted.categories.some(c => c.kind === 'conflict'));
  assert.ok(!restricted.categories.some(c => ['lp','portfolio','spv','fund','capital-call'].includes(c.kind)));
  await json(await api('/api/discussions/sources', undefined, external.token), 403);
});

test('LP, portfolio, SPV, fund, closing, subscriptions, redemptions and compliance records link and open with their actual fund context', async () => {
  // Minimal fixtures only in the throwaway database, without executing financial actions.
  const db = new DatabaseSync(server.dbPath);
  const tenant = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(co.id).tenant_id;
  const add = (table, fields) => Number(db.prepare(`INSERT INTO ${table} (tenant_id, ${Object.keys(fields).join(',')}) VALUES (?, ${Object.keys(fields).map(() => '?').join(',')})`).run(tenant, ...Object.values(fields)).lastInsertRowid);
  const fundId = add('funds', { name: 'Catalogue Fund' });
  const lpId = add('lp_register', { fund_id: fundId, register_id: 'CAT-LP', name: 'Catalogue LP', type: 'Entity', lp_type: 'Professional' });
  const fixture = [
    ['fund', fundId], ['closing', fundId], ['lp', lpId],
    ['portfolio', add('portfolio', { fund_id: fundId, name: 'Catalogue portfolio' })],
    ['spv', add('spvs', { fund_id: fundId, name: 'Catalogue SPV' })],
    ['subscription', add('hf_subscriptions', { fund_id: fundId, lp_id: lpId, sub_number: 'CAT-SUB' })],
    ['redemption', add('hf_redemptions', { fund_id: fundId, lp_id: lpId, redemption_number: 'CAT-RED' })],
    ['restricted', add('restricted_list', { company: 'Catalogue restricted' })],
    ['coi', add('coi_registry', { coi_id: 'CAT-COI', description: 'Catalogue COI' })],
  ];
  db.close();
  const r = await room([]);
  for (const [kind,id] of fixture) {
    const result = await json(await api(`/api/discussions/source/${kind}/${id}`));
    assert.equal(result.source.kind, kind); assert.equal(result.source.id, id);
    if (!['coi','restricted'].includes(kind)) { assert.equal(result.source.fundId, fundId); assert.equal(result.source.fundName, 'Catalogue Fund'); }
    await json(await api(`/api/discussions/${r.id}/links`, { kind, id }));
    assert.ok((await json(await api(`/api/discussions/source/${kind}/${id}`))).items.some(i => i.id === r.id));
    await json(await api(`/api/discussions/source/${kind}/${id}`, undefined, other.token), 404);
  }
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).room.links.length, fixture.length);
  await json(await api(`/api/discussions/source/lp/${lpId}`, undefined, rm.token), 403);
  const stranger = await json(await api(`/api/discussions/source/lp/${lpId}`, undefined, outsider.token));
  assert.equal(stranger.items.length, 0); // Access to the LP does not expose private chats.
  await json(await api(`/api/lp/${lpId}`, undefined, server.token, 'DELETE'), 409);
  await json(await api(`/api/funds/${fundId}`, undefined, server.token, 'DELETE'), 409);
  const directory = await json(await api(`/api/discussions/${r.id}/people`));
  assert.ok(!directory.people.some(p => p.id === rm.id));
});

test('creating a process conversation attaches it atomically and replays without duplicate chats', async () => {
  const c = await client(), source = { kind: 'client', id: c.id };
  const body = { title: 'Процесс из каталога', source, requestKey: key() };
  const first = await json(await api('/api/discussions', body), 201);
  assert.equal((await json(await api('/api/discussions', body))).id, first.id);
  const view = await json(await api(`/api/discussions/${first.id}`));
  assert.equal(view.room.links[0].id, c.id); assert.equal(view.room.links[0].kind, 'client');
  const listings = await json(await api('/api/discussions'));
  assert.ok(listings.items.find(i => i.kind === 'room' && i.id === first.id).sources.some(s => s.kind === 'client' && s.id === c.id));
  await json(await api('/api/discussions', { ...body, source: null }), 409);
  const fm = await client('FM');
  const denied = { title: 'Not shared', source: { kind: 'client', id: fm.id }, participants: [rm.id], requestKey: key() };
  await json(await api('/api/discussions', denied), 403);
  const db = new DatabaseSync(server.dbPath); assert.equal(db.prepare('SELECT COUNT(*) n FROM discussion_rooms WHERE request_key = ?').get(denied.requestKey).n, 0); db.close();
  await json(await api('/api/discussions', { title: 'Read only', source, requestKey: key() }, auditor.token), 403);
  await json(await api('/api/discussions', { title: 'Wrong source', source: { kind: '__proto__', id: 1 }, requestKey: key() }), 404);
});

function mention(person, prefix = '') {
  const text = prefix + person.name + ', подключитесь к обсуждению';
  return { text, mentions: [{ userId: person.id, start: prefix.length, end: prefix.length + person.name.length }], requestKey: key() };
}
test('a title alone creates a chat; choosing a plain name joins a person atomically when the message sends', async () => {
  const r = await json(await api('/api/discussions', { title: 'Без списка участников', requestKey: key() }), 201);
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).room.members.length, 1);
  const options = await json(await api(`/api/discussions/${r.id}/people`));
  assert.ok(options.people.some(p => p.id === co.id && !p.member)); assert.ok(!options.people.some(p => p.id === external.id));
  await json(await api(`/api/discussions/${r.id}`, undefined, co.token), 404);
  const body = mention(co, '💬 ');
  const first = await json(await api(`/api/discussions/${r.id}/messages`, body), 201);
  const second = await json(await api(`/api/discussions/${r.id}/messages`, body));
  assert.equal(first.message.id, second.message.id); assert.equal(first.message.mentions[0].name, co.name);
  const view = await json(await api(`/api/discussions/${r.id}`, undefined, co.token));
  assert.equal(view.messages.length, 1); assert.equal(view.room.members.filter(p => p.id === co.id).length, 1);
  assert.equal(view.messages[0].text.slice(view.messages[0].mentions[0].start, view.messages[0].mentions[0].end), co.name);
  // Existing members can invite a colleague through the same composer.
  await json(await api(`/api/discussions/${r.id}/messages`, mention(outsider), co.token), 201);
  assert.equal((await json(await api(`/api/discussions/${r.id}`, undefined, outsider.token))).messages.length, 2);
});
test('literal names do not invite, and invalid or edited mention ranges never add a participant', async () => {
  const r = await room([]), body = mention(co);
  await json(await api(`/api/discussions/${r.id}/messages`, { text: co.name, requestKey: key() }), 201);
  await json(await api(`/api/discussions/${r.id}`, undefined, co.token), 404);
  await json(await api(`/api/discussions/${r.id}/messages`, { ...body, mentions: [{ ...body.mentions[0], end: 9999 }] }), 400);
  await json(await api(`/api/discussions/${r.id}/messages`, { ...body, text: 'X' + body.text.slice(1) }), 409);
  await json(await api(`/api/discussions/${r.id}/messages`, { ...body, mentions: [body.mentions[0], body.mentions[0]] }), 400);
  await json(await api(`/api/discussions/${r.id}/messages`, { ...body, mentions: [{ ...body.mentions[0], userId: external.id }] }), 400);
  await json(await multipart(`/api/discussions/${r.id}/messages`, body, [{ name: 'bad.exe', bytes: 'abc' }]), 400);
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).room.members.length, 1);
});
test('mentions enforce live process access and active identity, including replay after renaming', async () => {
  const r = await room([]), fm = await client('FM');
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: fm.id }));
  const options = await json(await api(`/api/discussions/${r.id}/people`)); assert.ok(!options.people.some(p => p.id === rm.id));
  await json(await api(`/api/discussions/${r.id}/messages`, mention(rm)), 403);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(co.id);
  await json(await api(`/api/discussions/${r.id}/messages`, mention(co)), 400);
  db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(co.id);
  const body = mention(co), sent = await json(await api(`/api/discussions/${r.id}/messages`, body), 201);
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run('Renamed employee', co.id);
  assert.equal((await json(await api(`/api/discussions/${r.id}/messages`, body))).message.id, sent.message.id);
  await json(await api(`/api/discussions/${r.id}/messages`, { ...body, requestKey: key() }), 409);
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(co.name, co.id); db.close();
});
test('mentions cannot invite other-tenant users and read-only accounts cannot invite', async () => {
  const r = await room([auditor.id]);
  await json(await api(`/api/discussions/${r.id}/messages`, mention(co), auditor.token), 403);
  const db = new DatabaseSync(server.dbPath), foreign = db.prepare('SELECT id, name FROM users WHERE email = ?').get('other-chat@test.example'); db.close();
  await json(await api(`/api/discussions/${r.id}/messages`, mention(foreign)), 400);
  await json(await api(`/api/discussions/${r.id}/people`, undefined, outsider.token), 404);
});
test('mentions in contract chat grant discussion participation but never a formal approval vote', async () => {
  const c = await client(), e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'MENTIONS', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 100 }), 201);
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals/chat`, undefined, co.token))).canPost, false);
  const body = { ...mention(co), expectedVersion: 0, expectedCycleId: null };
  await json(await api(`/api/engagements/${e.id}/approvals/chat`, body), 201);
  const chat = await json(await api(`/api/engagements/${e.id}/approvals/chat`, undefined, co.token));
  assert.equal(chat.canPost, true); assert.ok(chat.participants.some(p => p.id === co.id));
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals`, undefined, co.token))).cycles.length, 0);
  await json(await api(`/api/engagements/${e.id}/approvals/chat`, { text: 'Участвую', expectedVersion: 0, expectedCycleId: null, requestKey: key() }, co.token), 201);
});
test('related chats have reciprocal links, preserve separate membership and hide inaccessible titles', async () => {
  const a = await room([co.id]), b = await room([outsider.id]);
  await json(await api(`/api/discussions/${a.id}/links`, { kind: 'discussion', id: b.id }));
  await json(await api(`/api/discussions/${b.id}/links`, { kind: 'discussion', id: a.id }));
  const av = await json(await api(`/api/discussions/${a.id}`)), bv = await json(await api(`/api/discussions/${b.id}`));
  assert.equal(av.room.links.filter(l => l.kind === 'discussion' && l.id === b.id).length, 1);
  assert.equal(bv.room.links.filter(l => l.kind === 'discussion' && l.id === a.id).length, 1);
  assert.equal((await json(await api(`/api/discussions/${a.id}`, undefined, co.token))).room.links.length, 0);
  await json(await api(`/api/discussions/${b.id}`, undefined, co.token), 404);
  await json(await api(`/api/discussions/${a.id}`, undefined, outsider.token), 404);
  await json(await api(`/api/discussions/${a.id}/links`, { kind: 'discussion', id: a.id }), 400);
  const foreign = await room([], other.token);
  await json(await api(`/api/discussions/${a.id}/links`, { kind: 'discussion', id: foreign.id }), 404);
  const privateRoom = await room([], rm.token);
  assert.ok(!(await json(await api('/api/discussions/sources'))).items.some(i => i.kind === 'discussion' && i.id === privateRoom.id));
  await json(await api(`/api/discussions/${a.id}/links`, { kind: 'discussion', id: privateRoom.id }), 404);
});
test('a chat can link to contract conversation with a visible backlink and no merged history', async () => {
  const c = await client(), e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'CHAT-LINK', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 100 }), 201);
  const r = await room([co.id]);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'contract-chat', id: e.id }));
  assert.ok((await json(await api(`/api/discussions/${r.id}`))).room.links.some(l => l.kind === 'contract-chat' && l.id === e.id));
  assert.ok((await json(await api(`/api/engagements/${e.id}/approvals/chat`))).related.some(l => l.kind === 'discussion' && l.id === r.id));
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals/chat`, undefined, outsider.token))).related.length, 0);
  await json(await api(`/api/engagements/${e.id}`, undefined, server.token, 'DELETE'), 409);
});

test('free topics require no process, keep server authorship and are private even from a nonmember manager', async () => {
  const r = await room([co.id], rm.token);
  const body = { text: 'Просто вопрос коллегам', requestKey: key(), authorId: outsider.id, createdAt: 'fake' };
  const first = await json(await api(`/api/discussions/${r.id}/messages`, body, rm.token), 201);
  assert.equal(first.message.authorId, rm.id); assert.notEqual(first.message.createdAt, 'fake');
  const view = await json(await api(`/api/discussions/${r.id}`, undefined, co.token));
  assert.equal(view.room.links.length, 0); assert.equal(view.messages[0].text, body.text); assert.equal(view.room.canManage, false);
  for (const token of [server.token, outsider.token, other.token]) {
    await json(await api(`/api/discussions/${r.id}`, undefined, token), 404);
    assert.equal((await json(await api('/api/discussions', undefined, token))).items.some(i => i.kind === 'room' && i.id === r.id), false);
  }
  await json(await api('/api/discussions', undefined, external.token), 403);
});
test('room creation and message retries do not duplicate, conflicting payloads and reused keys fail', async () => {
  const body = { title: 'Повтор создания', participants: [co.id], requestKey: key() };
  const a = await json(await api('/api/discussions', body), 201), b = await json(await api('/api/discussions', body)); assert.equal(a.id, b.id);
  await json(await api('/api/discussions', { ...body, title: 'Changed' }), 409);
  const message = { text: 'Согласен', requestKey: key() };
  const m = await json(await api(`/api/discussions/${a.id}/messages`, message), 201);
  assert.equal((await json(await api(`/api/discussions/${a.id}/messages`, message))).message.id, m.message.id);
  await json(await api(`/api/discussions/${a.id}/messages`, { ...message, text: 'Different' }), 409);
  await json(await api(`/api/discussions/${a.id}/messages`, message, co.token), 409);
  assert.equal((await json(await api(`/api/discussions/${a.id}`))).messages.length, 1);
});
test('attachment-only messages are atomic, downloadable only by members and retries bind actual bytes', async () => {
  const r = await room(), payload = { text: '', requestKey: key() }, file = { name: 'Замечания.pdf', bytes: '%PDF-1.4\nDemo review' };
  const first = await json(await multipart(`/api/discussions/${r.id}/messages`, payload, [file]), 201);
  assert.equal(first.message.attachments[0].name, file.name);
  const again = await json(await multipart(`/api/discussions/${r.id}/messages`, payload, [file])); assert.equal(again.message.id, first.message.id);
  await json(await multipart(`/api/discussions/${r.id}/messages`, payload, [{ ...file, bytes: '%PDF-1.4\nDifferent' }]), 409);
  const url = `/api/discussions/${r.id}/files/${first.message.attachments[0].id}`;
  const download = await api(url, undefined, co.token); assert.equal(download.status, 200); assert.equal(await download.text(), file.bytes);
  assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.equal(download.headers.get('cache-control'), 'no-store');
  await json(await api(url, undefined, outsider.token), 404); await json(await api(url, undefined, other.token), 404);
  const r2 = await room(); await json(await api(`/api/discussions/${r2.id}/files/${first.message.attachments[0].id}`), 404);
});
test('malformed files, oversized uploads and excessive text leave no partial message or file', async () => {
  const r = await room(), url = `/api/discussions/${r.id}/messages`;
  for (const file of [{ name: 'bad.exe', bytes: 'abc' }, { name: 'fake.pdf', bytes: 'abc' }, { name: 'empty.txt', bytes: '' }, { name: 'fake.docx', bytes: 'PKbad' }]) {
    await json(await multipart(url, { text: 'Must not save', requestKey: key() }, [file]), 400);
  }
  await json(await multipart(url, { text: '', requestKey: key() }, [{ name: 'large.txt', bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 65) }]), 413);
  await json(await api(url, { text: 'x'.repeat(4001), requestKey: key() }), 400);
  await json(await api(url, { text: '', requestKey: key() }), 400);
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).messages.length, 0);
});
test('optional process links recheck every member access and never grant FM or other-tenant access', async () => {
  const cf = await client(), fm = await client('FM'), r = await room([rm.id, co.id]);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: cf.id }));
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: cf.id }));
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).room.links.length, 1);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: fm.id }), 403);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: cf.id }, co.token), 403);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: '__proto__', id: 1 }), 404);
  const foreign = await json(await api('/api/ob-clients', { name: 'Other', direction: 'CF&A' }, other.token), 201);
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: foreign.id }), 404);
  const sources = (await json(await api('/api/discussions/sources', undefined, rm.token))).items;
  assert.ok(sources.some(s => s.kind === 'client' && s.id === cf.id)); assert.ok(!sources.some(s => s.kind === 'client' && s.id === fm.id));
  assert.ok(!sources.some(s => ['deal','ic','nav','capital-call','report','sandbox'].includes(s.kind)));
  await json(await api(`/api/ob-clients/${cf.id}`, undefined, server.token, 'DELETE'), 409);
});
test('participants can be added only by owner, inherit history but cannot bypass linked-process permissions', async () => {
  const r = await room([co.id]); await json(await api(`/api/discussions/${r.id}/messages`, { text: 'History', requestKey: key() }), 201);
  await json(await api(`/api/discussions/${r.id}/members`, { participants: [outsider.id] }, co.token), 403);
  await json(await api(`/api/discussions/${r.id}/members`, { participants: [outsider.id] }));
  assert.equal((await json(await api(`/api/discussions/${r.id}`, undefined, outsider.token))).messages[0].text, 'History');
  await json(await api(`/api/discussions/${r.id}/members`, { participants: [external.id] }), 400);
  const fm = await client('FM'); await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: fm.id }));
  await json(await api(`/api/discussions/${r.id}/members`, { participants: [rm.id] }), 403);
});
test('read-only members can read but cannot post; deactivated and newly restricted roles lose live access', async () => {
  const r = await room([auditor.id, co.id]);
  assert.equal((await json(await api(`/api/discussions/${r.id}`, undefined, auditor.token))).canPost, false);
  await json(await api(`/api/discussions/${r.id}/messages`, { text: 'No', requestKey: key() }, auditor.token), 403);
  const fm = await client('FM'); await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: fm.id }));
  const db = new DatabaseSync(server.dbPath);
  db.prepare('UPDATE roles SET access_fm = 0 WHERE code = ?').run('COMPLIANCE_OFFICER');
  await json(await api(`/api/discussions/${r.id}`, undefined, co.token), 403);
  await json(await api(`/api/discussions/${r.id}/messages`, { text: 'No', requestKey: key() }, co.token), 403);
  db.prepare('UPDATE roles SET access_fm = 1 WHERE code = ?').run('COMPLIANCE_OFFICER');
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(co.id);
  const denied = await api(`/api/discussions/${r.id}`, undefined, co.token); assert.ok([401,403].includes(denied.status));
  db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(co.id); db.close();
});
test('contract attachments share the existing conversation and never replace its approved document', async () => {
  const c = await client();
  const e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'CHAT-FILE', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 100 }), 201);
  const payload = { text: '', expectedVersion: 0, expectedCycleId: null, requestKey: key() };
  const msg = await json(await multipart(`/api/engagements/${e.id}/approvals/chat`, payload, [{ name: 'notes.txt', bytes: 'Review notes' }]), 201);
  const feed = await json(await api(`/api/engagements/${e.id}/approvals/chat`)); assert.equal(feed.messages.length, 1); assert.equal(feed.documents.length, 0);
  const download = await api(`/api/engagements/${e.id}/approvals/chat/files/${msg.message.attachments[0].id}`); assert.equal(await download.text(), 'Review notes');
  await json(await api(`/api/engagements/${e.id}/approvals/chat/files/${msg.message.attachments[0].id}`, undefined, other.token), 404);
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals`))).currentVersion, 0);
  await json(await api(`/api/engagements/${e.id}`, undefined, server.token, 'DELETE'), 409);
});
test('chat pagination catches up and history remains bound to the selected room', async () => {
  const r = await room();
  for (let i = 0; i < 103; i++) await json(await api(`/api/discussions/${r.id}/messages`, { text: `Message ${i}`, requestKey: key() }), 201);
  const page = await json(await api(`/api/discussions/${r.id}`)); assert.equal(page.messages.length, 100); assert.equal(page.hasMore, true);
  const older = await json(await api(`/api/discussions/${r.id}?before=${page.nextBefore}`)); assert.equal(older.messages.length, 3);
  const first = await json(await api(`/api/discussions/${r.id}?after=0`)); assert.equal(first.messages.length, 100); assert.equal(first.hasMore, true);
  const rest = await json(await api(`/api/discussions/${r.id}?after=${first.nextAfter}`)); assert.equal(rest.messages.length, 3);
  await json(await api(`/api/discussions/${r.id}?before=1&after=2`), 400);
});
