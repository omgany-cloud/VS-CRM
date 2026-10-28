const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');
let server, rm, co, auditor, external, outsider, other;
const key = () => crypto.randomUUID();
async function taskAction(id, action, version, extra = {}, token = server.token, status = 200) {
  // Completion needs a result (TZ M3); tests that are not about it get a default one.
  const result = action === 'complete' && !('result' in extra) ? { result: 'Готово' } : {};
  return json(await api(`/api/discussions/room/${id}/state`, { action, expectedVersion: version, requestKey: key(), ...result, ...extra }, token), status);
}
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

test('permanent deletion is trash-only, authorized and idempotent; removes files and both link directions without deleting neighbors',async()=>{
  const a=await room([co.id,auditor.id]),b=await room(),c=await client();
  await json(await api(`/api/discussions/${a.id}/links`,{kind:'discussion',id:b.id}));
  await json(await api(`/api/discussions/${a.id}/links`,{kind:'client',id:c.id}));
  const message=(await json(await multipart(`/api/discussions/${a.id}/messages`,{text:'Delete me',requestKey:key()},[{name:'delete.txt',bytes:'Delete file'}]),201)).message;
  await json(await api(`/api/discussions/${a.id}/messages`,{text:'Reply',replyToId:message.id,requestKey:key()}),201);
  const url=`/api/discussions/room/${a.id}`,payload={expectedVersion:1,requestKey:key()};
  await json(await api(url,{...payload,expectedVersion:0},server.token,'DELETE'),409);
  await taskAction(a.id,'trash',0);
  for(const [token,status] of [[co.token,403],[auditor.token,403],[outsider.token,404],[other.token,404]])await json(await api(url,payload,token,'DELETE'),status);
  await json(await api(url,{...payload,expectedVersion:0},server.token,'DELETE'),409);
  assert.deepEqual(await json(await api(url,payload,server.token,'DELETE')),{deleted:true});
  assert.deepEqual(await json(await api(url,payload,server.token,'DELETE')),{deleted:true});
  await json(await api(`/api/discussions/${a.id}`),404);
  await json(await api(`/api/discussions/${a.id}/files/${message.attachments[0].id}`),404);
  await taskAction(a.id,'restore',1,{},server.token,404);
  assert.equal((await json(await api(`/api/discussions/${b.id}`))).room.links.length,0);
  assert.ok((await json(await api(`/api/discussions/source/client/${c.id}`))).source);
  const db=new DatabaseSync(server.dbPath,{readOnly:true});
  try{
    for(const table of ['discussion_messages','discussion_members','discussion_links','discussion_task_state'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE room_id=?`).get(a.id).n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM discussion_files WHERE id=?').get(message.attachments[0].id).n,0);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();}
});

test('renaming preserves history and links, updates linked titles and enforces access, version and retries',async()=>{
  const r=await room([co.id,auditor.id]),neighbor=await room();
  await json(await api(`/api/discussions/${neighbor.id}/links`,{kind:'discussion',id:r.id}));
  await json(await api(`/api/discussions/${r.id}/messages`,{text:'Keep this message',requestKey:key()}),201);
  const before=await json(await api(`/api/discussions/${r.id}`));
  for(const title of ['', '   ', 'x'.repeat(161), null])await taskAction(r.id,'rename',0,{title},server.token,400);
  for(const [token,status] of [[co.token,403],[auditor.token,403],[outsider.token,404],[other.token,404]])await taskAction(r.id,'rename',0,{title:'Denied'},token,status);
  const extra={title:'  Новое название  ',requestKey:key()};
  const result=await taskAction(r.id,'rename',0,extra);
  assert.equal(result.task.title,'Новое название');assert.equal(result.task.version,1);
  assert.deepEqual(await taskAction(r.id,'rename',0,extra),result);
  await taskAction(r.id,'rename',0,{title:'Stale'},server.token,409);
  const after=await json(await api(`/api/discussions/${r.id}`));
  assert.equal(after.room.title,'Новое название');assert.deepEqual(after.messages,before.messages);assert.deepEqual(after.room.links,before.room.links);
  const linked=await json(await api(`/api/discussions/${neighbor.id}`));
  assert.equal(linked.room.links.find(l=>l.kind==='discussion'&&l.id===r.id).title,'Новое название');
  await taskAction(r.id,'complete',1);
  assert.equal((await taskAction(r.id,'rename',2,{title:'Completed title'})).task.status,'completed');
  await taskAction(r.id,'trash',3);await taskAction(r.id,'rename',4,{title:'Trash title'},server.token,409);
});

test('replies belong to the same task, are idempotent and preserve a server-owned quote and attachment label',async()=>{
  const r=await room(),another=await room();
  const source=(await json(await multipart(`/api/discussions/${r.id}/messages`,{text:'',requestKey:key()},[{name:'source.txt',bytes:'Reference'}]),201)).message;
  const body={text:'Reply',replyToId:source.id,requestKey:key()};
  const first=(await json(await api(`/api/discussions/${r.id}/messages`,body,co.token),201)).message;
  const retry=(await json(await api(`/api/discussions/${r.id}/messages`,body,co.token))).message;
  assert.equal(retry.id,first.id);assert.equal(first.replyTo.id,source.id);assert.equal(first.replyTo.author,source.author);assert.deepEqual(first.replyTo.files,['source.txt']);
  await json(await api(`/api/discussions/${r.id}/messages`,{...body,replyToId:null},co.token),409);
  const invitation=mention(outsider);await json(await api(`/api/discussions/${another.id}/messages`,{...invitation,replyToId:source.id}),404);
  await json(await api(`/api/discussions/${another.id}`,undefined,outsider.token),404);
  for(const replyToId of [0,-1,'1',999999]) await json(await api(`/api/discussions/${r.id}/messages`,{text:'Invalid',replyToId,requestKey:key()}),replyToId===999999?404:400);
  await json(await api(`/api/discussions/${r.id}/messages`,body,other.token),404);
  await taskAction(r.id,'trash',0);
  const stored=await json(await api(`/api/discussions/${r.id}`));assert.equal(stored.messages[1].replyTo.id,source.id);
});

test('task assignee must be an eligible member; owner, version and task state govern changes',async()=>{
  const r=await room([co.id,auditor.id]);
  const candidates=await json(await api(`/api/discussions/room/${r.id}/assignees`));
  assert.ok(candidates.people.some(p=>p.id===co.id));assert.ok(!candidates.people.some(p=>[auditor.id,outsider.id,external.id].includes(p.id)));
  await json(await api(`/api/discussions/room/${r.id}/assignees`,undefined,co.token),403);
  await taskAction(r.id,'assign',0,{assigneeId:outsider.id},server.token,403);
  const extra={assigneeId:co.id,requestKey:key()};const result=await taskAction(r.id,'assign',0,extra);
  assert.equal(result.task.assignee.id,co.id);assert.deepEqual(await taskAction(r.id,'assign',0,extra),result);
  assert.equal((await taskAction(r.id,'due',1,{dueDate:'2026-12-01'})).task.assignee.id,co.id);
  await taskAction(r.id,'assign',0,{assigneeId:null},server.token,409);
  await taskAction(r.id,'complete',2);
  await taskAction(r.id,'assign',3,{assigneeId:null},server.token,409);
  await taskAction(r.id,'reopen',3);assert.equal((await taskAction(r.id,'assign',4,{assigneeId:null})).task.assignee,null);
});

test('task dates validate calendar days; lifecycle commands enforce owner, version and idempotency', async () => {
  await json(await api('/api/discussions', {title:'Invalid date',dueDate:'2026-02-30',requestKey:key()}),400);
  const r=await json(await api('/api/discussions',{title:'Dated task',dueDate:'2028-02-29',participants:[co.id,auditor.id],requestKey:key()}),201);
  assert.equal((await json(await api(`/api/discussions/${r.id}`))).task.dueDate,'2028-02-29');
  for (const date of ['2027-02-29','2026-10-28T10:00:00Z','1999-01-01',123]) await taskAction(r.id,'due',0,{dueDate:date},server.token,400);
  await taskAction(r.id,'complete',0,{},co.token,403);
  await taskAction(r.id,'complete',0,{},auditor.token,403);
  await taskAction(r.id,'complete',0,{},outsider.token,404);
  await taskAction(r.id,'complete',0,{},other.token,404);
  const requestKey=key(), extra={dueDate:'2026-11-10',requestKey};
  const first=await taskAction(r.id,'due',0,extra);
  assert.equal(first.task.version,1); assert.deepEqual(await taskAction(r.id,'due',0,extra),first);
  await taskAction(r.id,'due',0,{...extra,dueDate:null},server.token,409);
  await taskAction(r.id,'complete',0,{},server.token,409);
  assert.equal((await taskAction(r.id,'due',1,{dueDate:null})).task.dueDate,null);
});

test('complete, trash and restore preserve links, process, files and history without changing a related task',async()=>{
  const a=await room(),b=await room(),c=await client();
  await json(await api(`/api/discussions/${a.id}/links`,{kind:'discussion',id:b.id}));
  await json(await api(`/api/discussions/${a.id}/links`,{kind:'client',id:c.id}));
  const payload={text:'Retained history',requestKey:key()};
  const msg=await json(await multipart(`/api/discussions/${a.id}/messages`,payload,[{name:'retained.txt',bytes:'Preserved attachment'}]),201);
  assert.equal((await taskAction(a.id,'complete',0)).task.status,'completed');
  await json(await api(`/api/discussions/${a.id}/messages`,{text:'Closed',requestKey:key()}),409);
  // A retry of an already-saved command is still safe after completion.
  assert.equal((await json(await multipart(`/api/discussions/${a.id}/messages`,payload,[{name:'retained.txt',bytes:'Preserved attachment'}]))).message.id,msg.message.id);
  await taskAction(a.id,'trash',1);
  const trashed=await json(await api(`/api/discussions/${a.id}`));
  assert.equal(trashed.task.status,'trashed');assert.equal(trashed.canPost,false);assert.equal(trashed.messages.length,1);assert.equal(trashed.room.links.length,2);
  const neighbor=await json(await api(`/api/discussions/${b.id}`));
  assert.equal(neighbor.task.status,'open');assert.equal(neighbor.room.links.find(l=>l.id===a.id&&l.kind==='discussion').status,'trashed');
  const file=await api(`/api/discussions/${a.id}/files/${msg.message.attachments[0].id}`);assert.equal(await file.text(),'Preserved attachment');
  assert.ok((await json(await api(`/api/discussions/source/client/${c.id}`))).source);
  await json(await api(`/api/ob-clients/${c.id}`,undefined,server.token,'DELETE'),409);
  await json(await api(`/api/discussions/${a.id}/members`,{participants:[outsider.id]}),409);
  await taskAction(a.id,'due',2,{dueDate:'2026-11-10'},server.token,409);
  assert.equal((await taskAction(a.id,'restore',2)).task.status,'completed');
  assert.equal((await taskAction(a.id,'reopen',3)).task.status,'open');
  await json(await api(`/api/discussions/${a.id}/messages`,{text:'Continued',requestKey:key()}),201);
});

test('unread counts are personal, monotonic, exclude own messages and enforce task access even for read-only users',async()=>{
  const r=await room([co.id,auditor.id]);
  const unread=async(token)=> (await json(await api('/api/discussions',undefined,token))).items.find(i=>i.kind==='room'&&i.id===r.id).unread;
  const m1=(await json(await api(`/api/discussions/${r.id}/messages`,{text:'First',requestKey:key()}),201)).message;
  assert.equal(await unread(server.token),0);assert.equal(await unread(co.token),1);assert.equal(await unread(auditor.token),1);
  const path=`/api/discussions/room/${r.id}/read`;
  await json(await api(path,{lastMessageId:m1.id},outsider.token),404);
  await json(await api(path,{lastMessageId:m1.id},other.token),404);
  assert.equal((await json(await api(path,{lastMessageId:m1.id},auditor.token))).unread,0);
  assert.equal(await unread(co.token),1);
  const m2=(await json(await api(`/api/discussions/${r.id}/messages`,{text:'Second',requestKey:key()},co.token),201)).message;
  await json(await api(path,{lastMessageId:m2.id},auditor.token));
  await json(await api(path,{lastMessageId:m1.id},auditor.token));
  assert.equal(await unread(auditor.token),0);assert.equal(await unread(server.token),1);
  const another=await room([auditor.id]);
  await json(await api(`/api/discussions/room/${another.id}/read`,{lastMessageId:m2.id},auditor.token),404);
  await json(await api(path,{lastMessageId:999999}),404);
  await taskAction(r.id,'trash',0);
  assert.equal((await json(await api(path,{lastMessageId:m2.id},auditor.token))).unread,0);
});

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

test('subtasks started from a contract appear once in its task for their members only', async () => {
  const c = await client(), e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'SUBTASK', direction: 'CF&A', status: 'Draft', serviceType: 'Advising', feeAmount: 100 }), 201);
  const sub = await json(await api('/api/discussions', { title: 'Запросить реквизиты', participants: [co.id], source: { kind: 'contract', id: e.id }, requestKey: key() }), 201);
  const mine = await json(await api(`/api/discussions/${sub.id}/links`, { kind: 'contract-chat', id: e.id }));
  assert.equal(mine.ok, true);
  const related = (await json(await api(`/api/engagements/${e.id}/approvals/chat`))).related.filter(l => l.kind === 'discussion' && l.id === sub.id);
  assert.equal(related.length, 1); assert.equal(related[0].label, 'Подзадача');
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals/chat`, undefined, co.token))).related.filter(l => l.id === sub.id).length, 1);
  const hidden = await json(await api('/api/discussions', { title: 'Чужая подзадача', participants: [], source: { kind: 'contract', id: e.id }, requestKey: key() }, rm.token), 201);
  assert.ok(!(await json(await api(`/api/engagements/${e.id}/approvals/chat`))).related.some(l => l.id === hidden.id));
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
  const catalogue=await json(await api(`/api/engagements/${e.id}/approvals/chat/files`,undefined,auditor.token));
  assert.equal(catalogue.files.length,1);assert.equal(catalogue.files[0].id,msg.message.attachments[0].id);assert.equal(catalogue.files[0].name,'notes.txt');
  await json(await api(`/api/engagements/${e.id}/approvals/chat/files`,undefined,other.token),404);
  const download = await api(`/api/engagements/${e.id}/approvals/chat/files/${msg.message.attachments[0].id}`); assert.equal(await download.text(), 'Review notes');
  await json(await api(`/api/engagements/${e.id}/approvals/chat/files/${msg.message.attachments[0].id}`, undefined, other.token), 404);
  assert.equal((await json(await api(`/api/engagements/${e.id}/approvals`))).currentVersion, 0);
  await json(await api(`/api/engagements/${e.id}`, undefined, server.token, 'DELETE'), 409);
});

test('file catalogue includes attachments outside the message page, preserves duplicate names and checks live access',async()=>{
  const r=await room([co.id,auditor.id]),separate=await room();
  const first=await json(await multipart(`/api/discussions/${r.id}/messages`,{text:'Old files',requestKey:key()},[
    {name:'Archive.txt',bytes:'Old version'},{name:'Archive.txt',bytes:'Other version'}]),201);
  for(let i=0;i<101;i++)await json(await api(`/api/discussions/${r.id}/messages`,{text:'Later '+i,requestKey:key()}),201);
  const latest=await json(await multipart(`/api/discussions/${r.id}/messages`,{text:'Latest file',requestKey:key()},[{name:'New.txt',bytes:'Latest'}]),201);
  const page=await json(await api(`/api/discussions/${r.id}`));assert.ok(!page.messages.some(m=>m.id===first.message.id));
  const catalogue=await json(await api(`/api/discussions/${r.id}/files`,undefined,auditor.token));
  assert.equal(catalogue.files.length,3);assert.equal(catalogue.files[0].id,latest.message.attachments[0].id);
  assert.equal(catalogue.files.filter(f=>f.name==='Archive.txt').length,2);
  for(const file of catalogue.files){assert.ok(file.createdAt&&file.author&&file.messageId);assert.equal(Object.hasOwn(file,'file_bytes'),false);assert.equal(Object.hasOwn(file,'sha256'),false);}
  const downloaded=await api(`/api/discussions/${r.id}/files/${first.message.attachments[0].id}`,undefined,auditor.token);assert.equal(await downloaded.text(),'Old version');
  assert.deepEqual((await json(await api(`/api/discussions/${separate.id}/files`))).files,[]);
  await json(await api(`/api/discussions/${r.id}/files`,undefined,outsider.token),404);
  await json(await api(`/api/discussions/${r.id}/files`,undefined,other.token),404);
  await json(await api(`/api/discussions/${separate.id}/files/${first.message.attachments[0].id}`),404);
  await taskAction(r.id,'complete',0);await taskAction(r.id,'trash',1);
  assert.equal((await json(await api(`/api/discussions/${r.id}/files`))).files.length,3);
  const db=new DatabaseSync(server.dbPath);db.prepare('UPDATE users SET active=0 WHERE id=?').run(co.id);db.close();
  const denied=await api(`/api/discussions/${r.id}/files`,undefined,co.token);assert.ok([401,403].includes(denied.status));
  const restore=new DatabaseSync(server.dbPath);restore.prepare('UPDATE users SET active=1 WHERE id=?').run(co.id);restore.close();
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

test('completing a task needs a result, which is kept, listed with the task clients and cleared on reopen', async () => {
  const r = await room(), c = await client();
  await json(await api(`/api/discussions/${r.id}/links`, { kind: 'client', id: c.id }));
  for (const result of [undefined, '   ', 123, 'x'.repeat(2001)]) {
    await json(await api(`/api/discussions/room/${r.id}/state`, { action: 'complete', expectedVersion: 0, requestKey: key(), ...(result === undefined ? {} : { result }) }), 400);
  }
  const done = await taskAction(r.id, 'complete', 0, { result: '  Договорились о встрече  ' });
  assert.equal(done.task.result, 'Договорились о встрече');
  const listed = (await json(await api('/api/discussions'))).items.find(i => i.kind === 'room' && i.id === r.id);
  assert.equal(listed.task.result, 'Договорились о встрече'); assert.deepEqual(listed.clients, [{ id: c.id, name: c.name }]);
  const audit = await json(await api(`/api/audit-log?entityType=discussion_rooms&entityId=${r.id}`));
  assert.ok(audit.entries.some(entry => entry.summary.includes('Результат: Договорились о встрече')));
  assert.equal((await taskAction(r.id, 'reopen', 1)).task.result, null);
});
