const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('child_process');
const path = require('path');
const { createTestServer } = require('./helpers');

let server, rm, co, cfo, auditor, external, other, roles;
const key = () => crypto.randomUUID();
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `approval-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: role, role, password: 'ApprovalTest123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  const login = await json(await api('/api/auth/login', { email, password: 'ApprovalTest123!' }));
  return { ...u, token: login.token };
}
async function upload(contract, expected = 0, text = 'original', token = rm.token) {
  const form = new FormData();
  form.append('expectedVersion', String(expected)); form.append('changeNote', 'Terms ' + text);
  form.append('file', new Blob([Buffer.from('%PDF-1.4\n' + text)]), 'contract.pdf');
  return fetch(server.baseUrl + `/api/engagements/${contract.id}/versions`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
async function contract(options = {}) {
  const c = await json(await api('/api/ob-clients', { name: 'Approval client', direction: options.direction || 'CF&A' }), 201);
  const e = await json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'TEST-' + key(), direction: options.direction || 'CF&A',
    status: 'Draft', serviceType: 'Advising', feeAmount: 100, date: '2026-10-27', ...options }), 201);
  if (!options.noFile) await json(await upload(e, 0, 'original', options.direction === 'FM' ? server.token : rm.token), 201);
  return e;
}
async function route(options = {}) {
  return (await json(await api('/api/contract-approval-routes', { name: 'Legal and finance', direction: 'CF&A',
    allowSelfApproval: false, steps: [{ userId: co.id, dueDays: 2 }, { userId: cfo.id, dueDays: 3 }], ...options }), 201)).route;
}
async function history(e, token = server.token) { return json(await api(`/api/engagements/${e.id}/approvals`, undefined, token)); }
async function submission(e, r, overrides = {}) {
  const h = await history(e);
  return { expectedVersion: h.currentVersion, routeId: r.id, expectedRouteRevision: r.revision,
    expectedCycleId: h.cycles[0]?.id || null, requestKey: key(), ...overrides };
}
async function submit(e, r, overrides = {}) {
  return (await json(await api(`/api/engagements/${e.id}/approvals`, await submission(e, r, overrides), rm.token), 201)).cycle;
}
async function decide(e, cycle, actor, decision = 'approved', comment = '') {
  return (await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, {
    expectedRevision: cycle.revision, stepId: cycle.steps[cycle.currentStep].id, decision, comment, requestKey: key(),
  }, actor.token))).cycle;
}
async function control(e, cycle, action, token = rm.token) {
  return (await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/${action}`, { expectedRevision: cycle.revision, reason: 'Terms require revision', requestKey: key() }, token))).cycle;
}
async function directSubmission(e, overrides = {}) {
  const h = await history(e);
  return { expectedVersion: h.currentVersion, expectedCycleId: h.cycles[0]?.id || null,
    participants: [co.id, cfo.id], dueDays: 3, requestKey: key(), ...overrides };
}
async function submitDirect(e, overrides = {}) {
  return (await json(await api(`/api/engagements/${e.id}/approvals`, await directSubmission(e, overrides), rm.token), 201)).cycle;
}
function directDecision(e, cycle, actor, decision = 'approved', comment = '') {
  return api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, {
    expectedRevision: cycle.revision, stepId: cycle.steps.find(s => s.userId === actor.id).id,
    decision, comment, requestKey: key(),
  }, actor.token);
}
async function chat(e, token = rm.token, query = '') {
  return json(await api(`/api/engagements/${e.id}/approvals/chat${query}`, undefined, token));
}
async function messageBody(e, text = 'Обсудим договор', overrides = {}) {
  const h = await history(e);
  return { text, expectedVersion: h.currentVersion, expectedCycleId: h.cycles[0]?.id || null, requestKey: key(), ...overrides };
}
async function postMessage(e, body, token = rm.token) {
  return api(`/api/engagements/${e.id}/approvals/chat`, body, token);
}

test('contract task rename changes its label during approval without modifying the contract or approval',async()=>{
  const e=await contract();await submitDirect(e);
  const before=await history(e);
  const result=await json(await api(`/api/discussions/contract/${e.id}/state`,{action:'rename',title:'Новая задача согласования',expectedVersion:0,requestKey:key()},rm.token));
  assert.equal(result.task.title,'Новая задача согласования');assert.equal(result.task.reviewActive,true);
  assert.deepEqual(await history(e),before);
  assert.equal((await chat(e)).task.title,'Новая задача согласования');
  const source=await json(await api(`/api/discussions/source/contract/${e.id}`));
  assert.equal(source.items[0].title,'Новая задача согласования');
  const db=new DatabaseSync(server.dbPath,{readOnly:true});
  try{assert.equal(db.prepare('SELECT contract_num FROM engagements WHERE id=?').get(e.id).contract_num,e.contractNum);}finally{db.close();}
});

test('contract replies retain their original cycle while the response binds current context; assignment invites without approval vote',async()=>{
  const e=await contract(),another=await contract();
  const original=(await json(await postMessage(e,await messageBody(e,'Original question')),201)).message;
  const reply=await messageBody(e,'Answer',{replyToId:original.id});
  const first=(await json(await postMessage(e,reply),201)).message;
  assert.equal(first.replyTo.id,original.id);assert.equal(first.replyTo.text,'Original question');
  assert.equal((await json(await postMessage(e,reply))).message.id,first.id);
  await json(await postMessage(another,await messageBody(another,'Wrong task',{replyToId:original.id})),404);
  const url=`/api/discussions/contract/${e.id}/state`;
  const assigned=await json(await api(url,{action:'assign',assigneeId:co.id,expectedVersion:0,requestKey:key()},rm.token));
  assert.equal(assigned.task.assignee.id,co.id);assert.equal((await chat(e,co.token)).canPost,true);assert.equal((await history(e)).cycles.length,0);
  const cycle=await submitDirect(e);
  const after=(await json(await postMessage(e,await messageBody(e,'During review',{replyToId:original.id}),co.token),201)).message;
  assert.equal(after.cycleId,cycle.id);assert.equal(after.replyTo.id,original.id);
  assert.ok((await history(e)).cycles[0].steps.every(s=>s.status==='pending'));
});

test('contract task lifecycle cannot hide active approval; closed tasks preserve contract and block new submission',async()=>{
  const e=await contract();const cycle=await submitDirect(e);
  const url=`/api/discussions/contract/${e.id}/state`;
  const action=(action,expectedVersion,extra={})=>api(url,{action,expectedVersion,requestKey:key(),...extra},rm.token);
  await json(await action('complete',0),409);await json(await action('trash',0),409);
  await json(await action('due',0,{dueDate:'2026-11-01'}));
  assert.deepEqual((await history(e)).cycles[0].steps.map(s=>s.dueAt),cycle.steps.map(s=>s.dueAt));
  await control(e,cycle,'withdraw');
  await json(await action('complete',1));
  assert.equal((await chat(e)).canPost,false);
  await json(await api(`/api/engagements/${e.id}/approvals`,await directSubmission(e),rm.token),409);
  await json(await postMessage(e,await messageBody(e)),409);
  await json(await action('trash',2));
  const source=await json(await api(`/api/discussions/source/contract/${e.id}`));assert.equal(source.items[0].task.status,'trashed');
  assert.equal((await history(e)).currentVersion,1);assert.equal((await history(e)).cycles.length,1);
  await json(await api(`/api/engagements/${e.id}`,undefined,server.token,'DELETE'),409);
  assert.equal((await json(await action('restore',3))).task.status,'completed');
  await json(await action('reopen',4));
  const next=await submitDirect(e);assert.equal(next.status,'active');
});

before(async () => {
  server = await createTestServer({ port: 4205, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO');
  auditor = await user('AUDITOR'); external = await user('IC_INDEPENDENT');
  other = await json(await api('/api/auth/signup', { companyName: 'Other approval company', name: 'Other owner', email: 'approval-other@test.example', password: 'ApprovalTest123!' }), 201);
  roles = (await json(await api('/api/roles'))).roles;
});
after(async () => { if (server) await server.stop(); });

test('purging a contract task removes conversation but preserves documents and approval, and a new approval starts an empty task',async()=>{
  const e=await contract(),cycle=await submitDirect(e);
  const form=new FormData();form.append('payload',JSON.stringify(await messageBody(e,'Remove this chat')));form.append('files',new Blob(['Remove this attachment']),'remove.txt');
  const message=(await json(await fetch(server.baseUrl+`/api/engagements/${e.id}/approvals/chat`,{method:'POST',headers:{Authorization:'Bearer '+rm.token},body:form}),201)).message;
  const neighbor=await json(await api('/api/discussions',{title:'Neighbor',requestKey:key()}),201);
  await json(await api(`/api/discussions/${neighbor.id}/links`,{kind:'contract-chat',id:e.id}));
  await json(await api(`/api/discussions/${neighbor.id}/links`,{kind:'contract',id:e.id}));
  await control(e,cycle,'withdraw');const before=await history(e);
  await json(await api(`/api/discussions/contract/${e.id}/state`,{action:'trash',expectedVersion:0,requestKey:key()},rm.token));
  const payload={expectedVersion:1,requestKey:key()},url=`/api/discussions/contract/${e.id}`;
  await json(await api(url,payload,co.token,'DELETE'),403);
  await json(await api(url,payload,other.token,'DELETE'),404);
  await json(await api(url,payload,rm.token,'DELETE'));
  await json(await api(url,payload,rm.token,'DELETE'));
  assert.deepEqual(await history(e),before);
  const links=(await json(await api(`/api/discussions/${neighbor.id}`))).room.links;
  assert.ok(links.some(l=>l.kind==='contract'&&l.id===e.id));assert.ok(!links.some(l=>l.kind==='contract-chat'));
  const db=new DatabaseSync(server.dbPath,{readOnly:true});
  try{assert.equal(db.prepare('SELECT COUNT(*) n FROM discussion_files WHERE id=?').get(message.attachments[0].id).n,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{db.close();}
  await json(await api(`/api/engagements/${e.id}/approvals/chat`,undefined,rm.token),404);
  await json(await api(`/api/discussions/contract/${e.id}/state`,{action:'restore',expectedVersion:2,requestKey:key()},rm.token),404);
  assert.ok(!(await json(await api('/api/discussions'))).items.some(i=>i.kind==='contract'&&i.id===e.id));
  const remaining=(await json(await api(`/api/discussions/source/contract/${e.id}`))).items;
  assert.ok(!remaining.some(i=>i.kind==='contract'&&i.id===e.id));assert.ok(remaining.some(i=>i.kind==='room'&&i.id===neighbor.id));
  const next=await submitDirect(e);assert.equal(next.status,'active');
  const fresh=await chat(e);assert.equal(fresh.task.status,'open');assert.equal(fresh.messages.length,0);assert.equal(fresh.documents.length,1);
  // Retrying the old delete cannot delete this new approval's task.
  await json(await api(url,payload,rm.token,'DELETE'));assert.equal((await chat(e)).task.status,'open');
});

test('sequential approvals freeze a document, activate deadlines step by step and do not activate the client', async () => {
  const e = await contract(), r = await route();
  let cycle = await submit(e, r, { status: 'approved', currentStep: 99, initiatorId: co.id, steps: [{ userId: rm.id }] });
  assert.equal(cycle.status, 'active'); assert.equal(cycle.number, 1);
  assert.equal(cycle.initiatorId, rm.id); assert.equal(cycle.steps[0].userId, co.id);
  assert.equal(cycle.steps[0].status, 'pending'); assert.ok(cycle.steps[0].dueAt);
  assert.equal(cycle.steps[1].status, 'waiting'); assert.equal(cycle.steps[1].dueAt, null);
  assert.equal((await history(e, co.token)).cycles[0].canDecide, true);
  assert.equal((await history(e, cfo.token)).cycles[0].canDecide, false);
  assert.equal((await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: cycle.revision, stepId: cycle.steps[1].id, decision: 'approved', requestKey: key() }, cfo.token)).status, 409);
  cycle = await decide(e, cycle, co);
  assert.equal(cycle.currentStep, 1); assert.equal(cycle.status, 'active'); assert.ok(cycle.steps[1].dueAt);
  cycle = await decide(e, cycle, cfo);
  assert.equal(cycle.status, 'approved'); assert.ok(cycle.resolvedAt);
  const h = await history(e); assert.equal(h.summary.status, 'approved'); assert.equal(h.canSubmit, false);
  const process = await json(await api(`/api/engagements/${e.id}/process`));
  assert.equal(process.client.activated, false); assert.equal(process.serviceStatus, 'Draft'); assert.equal(process.recordedSignatureDate, null);
  assert.equal((await json(await api('/api/contract-approval-inbox'))).items.some(i => i.engagementId === e.id), false);
});

test('file and material terms cannot change while frozen; finance bookkeeping remains usable', async () => {
  const e = await contract(), r = await route();
  let cycle = await submit(e, r);
  assert.equal((await upload(e, 1, 'changed')).status, 409);
  for (const patch of [{ feeAmount: 500 }, { currency: 'EUR' }, { contractNum: 'changed' }, { endDate: '2027-01-01' }, { date: '2027-01-01' }, { dealRef: 'new deal' }]) {
    assert.equal((await api(`/api/engagements/${e.id}`, patch, server.token, 'PUT')).status, 409);
  }
  await json(await api(`/api/engagements/${e.id}`, { paid: 50, invoiced: 100 }, server.token, 'PUT'));
  assert.equal((await history(e)).summary.status, 'active');
  cycle = await decide(e, cycle, co); cycle = await decide(e, cycle, cfo);
  assert.equal((await upload(e, 1, 'changed')).status, 409);
  await control(e, cycle, 'rework');
  await json(await api(`/api/engagements/${e.id}`, { feeAmount: 500 }, server.token, 'PUT'));
  await json(await upload(e, 1, 'changed'), 201);
  let h = await history(e); assert.equal(h.summary.status, 'needs_revision'); assert.equal(h.cycles[0].status, 'approved');
  assert.ok(h.cycles[0].invalidatedAt); assert.equal(h.cycles[0].metadata.feeAmount, 100);
  const second = await submit(e, r); assert.equal(second.number, 2); assert.equal(second.version, 2);
  h = await history(e); assert.equal(h.cycles.length, 2); assert.equal(h.cycles[1].steps[0].status, 'approved');
});

test('return and rejection require explanation and preserve completed steps on a new cycle', async () => {
  const e = await contract(), r = await route();
  let cycle = await submit(e, r);
  const url = `/api/engagements/${e.id}/approvals/${cycle.id}/decision`;
  for (const decision of ['returned', 'rejected']) assert.equal((await api(url, { decision, expectedRevision: cycle.revision, stepId: cycle.steps[0].id, comment: '', requestKey: key() }, co.token)).status, 400);
  cycle = await decide(e, cycle, co, 'returned', 'Clarify payment terms');
  assert.equal(cycle.status, 'returned'); assert.equal(cycle.steps[1].status, 'cancelled');
  await json(await upload(e, 1, 'returned fixes'), 201);
  const second = await submit(e, r);
  const rejected = await decide(e, second, co, 'rejected', 'Unacceptable conditions');
  assert.equal(rejected.status, 'rejected');
  assert.equal((await history(e)).cycles[1].steps[0].comment, 'Clarify payment terms');
});

test('submission and decision retries are idempotent, stale/concurrent actions cannot advance twice', async () => {
  const e = await contract(), r = await route();
  const body = await submission(e, r), url = `/api/engagements/${e.id}/approvals`;
  const submissions = await Promise.all([api(url, body, rm.token), api(url, body, rm.token)]);
  assert.deepEqual(submissions.map(x => x.status).sort(), [200, 201]);
  const [first, retry] = await Promise.all(submissions.map(x => x.json()));
  assert.equal(first.cycle.id, retry.cycle.id); assert.equal((await history(e)).cycles.length, 1);
  assert.equal((await api(url, { ...body, note: 'changed' }, rm.token)).status, 409);
  const c = first.cycle, decision = { decision: 'approved', expectedRevision: c.revision, stepId: c.steps[0].id, requestKey: key() };
  const decisionUrl = `${url}/${c.id}/decision`;
  const results = await Promise.all([api(decisionUrl, decision, co.token), api(decisionUrl, decision, co.token)]);
  assert.deepEqual(results.map(x => x.status), [200, 200]);
  assert.equal((await history(e)).cycles[0].currentStep, 1);
  assert.equal((await api(decisionUrl, { ...decision, requestKey: key() }, co.token)).status, 409);
  assert.equal((await api(decisionUrl, decision, cfo.token)).status, 403);
  const nextCycle = (await history(e)).cycles[0];
  const contested = { expectedRevision: nextCycle.revision, stepId: nextCycle.steps[1].id, comment: 'Concurrent decision' };
  const competing = await Promise.all([
    api(decisionUrl, { ...contested, decision: 'approved', requestKey: key() }, cfo.token),
    api(decisionUrl, { ...contested, decision: 'returned', requestKey: key() }, cfo.token),
  ]);
  assert.deepEqual(competing.map(x => x.status).sort(), [200, 409]);
  assert.equal((await history(e)).cycles[0].revision, nextCycle.revision + 1);
});

test('route edits are versioned and do not rewrite a submitted route snapshot', async () => {
  const e = await contract(), r = await route();
  const staleSubmission = await submission(e, r);
  const updated = (await json(await api(`/api/contract-approval-routes/${r.id}`, { ...r, expectedRevision: r.revision, name: 'Renamed route', steps: [{ userId: cfo.id, dueDays: 1 }] }, server.token, 'PUT'))).route;
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, staleSubmission, rm.token)).status, 409);
  const cycle = await submit(e, updated);
  await json(await api(`/api/contract-approval-routes/${r.id}`, { ...updated, expectedRevision: updated.revision, name: 'Third name', active: false }, server.token, 'PUT'));
  const h = await history(e);
  assert.equal(h.cycles[0].route.name, 'Renamed route'); assert.equal(h.cycles[0].steps[0].userId, cfo.id);
  const approved = await decide(e, cycle, cfo); assert.equal(approved.status, 'approved');
  assert.equal((await api(`/api/contract-approval-routes/${r.id}`, { ...updated, expectedRevision: updated.revision }, server.token, 'PUT')).status, 409);
});

test('self approval is denied by default for both initiator and file author; only route policy permits it', async () => {
  const e = await contract();
  const selfRoute = await route({ steps: [{ userId: rm.id, dueDays: 1 }] });
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, await submission(e, selfRoute), rm.token)).status, 409);
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, await submission(e, selfRoute))).status, 409, 'file author still cannot approve when another user submits');
  assert.equal((await api('/api/contract-approval-routes', { ...selfRoute, allowSelfApproval: true, selfApprovalReason: '' })).status, 400);
  const allowed = await route({ steps: [{ userId: rm.id, dueDays: 1 }], allowSelfApproval: true, selfApprovalReason: 'Explicit test policy' });
  const cycle = await submit(e, allowed); assert.equal(cycle.route.allowSelfApproval, true);
  assert.equal((await decide(e, cycle, rm)).status, 'approved');
});

test('route and submission permissions are live and independently editable', async () => {
  const e = await contract(), r = await route();
  assert.equal((await api('/api/contract-approval-routes', { ...r }, rm.token)).status, 403);
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, await submission(e, r), co.token)).status, 403);
  const role = roles.find(x => x.code === 'RELATIONSHIP_MANAGER');
  await json(await api(`/api/roles/${role.id}`, { manageContracts: false }, server.token, 'PUT'));
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, await submission(e, r), rm.token)).status, 403);
  await json(await api(`/api/roles/${role.id}`, { manageContracts: true }, server.token, 'PUT'));
  await submit(e, r);
});

test('tenant, FM, external and read-only boundaries cover routes, history, inbox and decisions', async () => {
  const e = await contract(), r = await route(), cycle = await submit(e, r);
  const url = `/api/engagements/${e.id}/approvals`;
  assert.equal((await api(url, undefined, other.token)).status, 404);
  assert.equal((await api(url, undefined, external.token)).status, 403);
  assert.equal((await fetch(server.baseUrl + url)).status, 401);
  assert.equal((await api(url, await submission(e, r), auditor.token)).status, 403);
  assert.equal((await api(`${url}/${cycle.id}/decision`, { expectedRevision: 1, stepId: cycle.steps[0].id, decision: 'approved', requestKey: key() }, auditor.token)).status, 403);
  assert.equal((await json(await api('/api/contract-approval-inbox', undefined, other.token))).items.length, 0);
  const fm = await contract({ direction: 'FM' }), fmRoute = await route({ direction: 'FM' });
  const fmCycle = (await json(await api(`/api/engagements/${fm.id}/approvals`, await submission(fm, fmRoute)), 201)).cycle;
  assert.ok(fmCycle.id);
  assert.equal((await api(`/api/engagements/${fm.id}/approvals`, undefined, rm.token)).status, 403);
  assert.equal((await api('/api/contract-approval-routes?direction=FM', undefined, rm.token)).status, 403);
  const inbox = await json(await api('/api/contract-approval-inbox', undefined, rm.token));
  assert.equal(inbox.items.some(i => i.engagementId === fm.id), false);
  assert.equal((await api(url, { ...await submission(e, r), routeId: fmRoute.id }, other.token)).status, 404);
});

test('withdraw/rework ownership is checked, comments required, completed approval remains historical', async () => {
  const e = await contract(), r = await route(); let cycle = await submit(e, r);
  const url = `/api/engagements/${e.id}/approvals/${cycle.id}/withdraw`;
  const body = { expectedRevision: cycle.revision, reason: 'Cancel review', requestKey: key() };
  assert.equal((await api(url, body, co.token)).status, 403);
  assert.equal((await api(url, { ...body, reason: '' }, rm.token)).status, 400);
  const first = await json(await api(url, body, rm.token));
  assert.equal(first.cycle.status, 'withdrawn');
  assert.equal((await json(await api(url, body, rm.token))).reused, true);
  cycle = await submit(e, r); cycle = await decide(e, cycle, co); cycle = await decide(e, cycle, cfo);
  assert.equal((await api(`/api/engagements/${e.id}/approvals/${cycle.id}/withdraw`, { ...body, expectedRevision: cycle.revision, requestKey: key() }, rm.token)).status, 409);
  const rework = await control(e, cycle, 'rework');
  assert.equal(rework.status, 'approved'); assert.ok(rework.invalidatedAt); assert.equal(rework.current, false);
});

test('invalid or missing documents and changed metadata never create a partial approval', async () => {
  const r = await route(), e = await contract({ noFile: true });
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null, routeId: r.id, expectedRouteRevision: r.revision, requestKey: key() }, rm.token)).status, 409);
  await json(await upload(e), 201);
  await json(await api(`/api/engagements/${e.id}`, { feeAmount: 999 }, server.token, 'PUT'));
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, await submission(e, r), rm.token)).status, 409);
  assert.equal((await history(e)).cycles.length, 0);
  await json(await upload(e, 1, 'same bytes new metadata'), 201);
  await submit(e, r);
});

test('disabled assignees cannot decide or receive new cycles; assigned history prevents deletion', async () => {
  const e = await contract(), r = await route(); const cycle = await submit(e, r);
  assert.equal((await api(`/api/users/${co.id}`, undefined, server.token, 'DELETE')).status, 409);
  await json(await api(`/api/users/${co.id}`, { active: false }, server.token, 'PUT'));
  const h = await history(e); assert.equal(h.cycles[0].steps[0].available, false);
  assert.equal((await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: 1, stepId: cycle.steps[0].id, decision: 'approved', requestKey: key() }, co.token)).status, 401);
  const second = await contract();
  assert.equal((await api(`/api/engagements/${second.id}/approvals`, await submission(second, r), rm.token)).status, 409);
  await json(await api(`/api/contract-approval-routes/${r.id}`, { ...r, expectedRevision: r.revision, active: false }, server.token, 'PUT'));
  await json(await api(`/api/users/${co.id}`, { active: true }, server.token, 'PUT'));
});

test('read-only role changes revoke an assigned decision immediately; unused route assignments preserve user identity', async () => {
  const e = await contract(), r = await route(); const cycle = await submit(e, r);
  const coRole = roles.find(x => x.code === 'COMPLIANCE_OFFICER');
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: true }, server.token, 'PUT'));
  assert.equal((await history(e, co.token)).cycles[0].canDecide, false);
  assert.equal((await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: 1, stepId: cycle.steps[0].id, decision: 'approved', requestKey: key() }, co.token)).status, 403);
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: false }, server.token, 'PUT'));
  const analyst = await user('ANALYST');
  await route({ steps: [{ userId: analyst.id, dueDays: 1 }] });
  const deletion = await json(await api(`/api/users/${analyst.id}`, undefined, server.token, 'DELETE'), 409);
  assert.ok(deletion.footprint.some(f => f.table === 'contract_approval_routes' && f.column === 'steps_json.userId'));
});

test('route validation, stale cycles and tampered version metadata fail closed', async () => {
  const e = await contract(), r = await route();
  for (const patch of [{ steps: [] }, { steps: [{ userId: co.id, dueDays: 31 }] }, { steps: [{ userId: auditor.id, dueDays: 1 }] },
    { steps: [{ userId: co.id, dueDays: 1 }, { userId: co.id, dueDays: 1 }] }]) assert.equal((await api('/api/contract-approval-routes', { ...r, ...patch })).status, 400);
  let cycle = await submit(e, r);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE engagements SET fee_amount = 12345 WHERE id = ?').run(e.id); db.close();
  const h = await history(e); assert.equal(h.summary.status, 'needs_revision'); assert.equal(h.cycles[0].canDecide, false);
  assert.equal((await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: 1, stepId: cycle.steps[0].id, decision: 'approved', requestKey: key() }, co.token)).status, 409);
  await control(e, cycle, 'rework');
  const stale = await submission(e, r);
  await json(await upload(e, 1, 'new terms'), 201);
  cycle = await submit(e, r);
  await control(e, cycle, 'withdraw');
  assert.equal((await api(`/api/engagements/${e.id}/approvals`, { ...stale, expectedVersion: 2 }, rm.token)).status, 409);
});

test('repeated migrations preserve approvals and revoked route permissions', async () => {
  const e = await contract(), r = await route(); const cycle = await submit(e, r);
  // Real pre-parallel snapshots have no mode field at all.
  const legacyRoute = { ...cycle.route }; delete legacyRoute.mode;
  const oldDb = new DatabaseSync(server.dbPath);
  oldDb.prepare('UPDATE contract_approval_cycles SET route_json = ? WHERE id = ?').run(JSON.stringify(legacyRoute), cycle.id);
  oldDb.close();
  const ceo = roles.find(x => x.code === 'CEO');
  await json(await api(`/api/roles/${ceo.id}`, { manageContractRoutes: false }, server.token, 'PUT'));
  const migration = spawnSync(process.execPath, ['-e', "require('./db')"], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: server.dbPath }, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  assert.equal((await json(await api('/api/auth/me'))).permissions.manageContractRoutes, false);
  assert.equal((await history(e)).cycles[0].id, cycle.id);
  assert.equal((await history(e, cfo.token)).cycles[0].mode, 'sequential');
  assert.equal((await history(e, cfo.token)).cycles[0].canDecide, false);
  await json(await api(`/api/roles/${ceo.id}`, { manageContractRoutes: true }, server.token, 'PUT'));
});

test('selecting names starts all reviewers together without route-management permission', async () => {
  const e = await contract();
  const options = await history(e, rm.token);
  assert.equal(options.canManageRoutes, false);
  assert.ok(options.people.some(p => p.id === co.id));
  assert.ok(options.people.some(p => p.id === cfo.id));
  assert.equal(options.people.some(p => [rm.id, auditor.id, external.id].includes(p.id)), false);
  const cycle = await submitDirect(e);
  assert.equal(cycle.mode, 'parallel');
  assert.equal(cycle.route.active, false, 'a private selection is not a reusable shared route');
  assert.ok(cycle.steps.every(s => s.status === 'pending' && s.dueAt));
  assert.equal(new Set(cycle.steps.map(s => s.dueAt)).size, 1);
  for (const actor of [co, cfo]) {
    const h = await history(e, actor.token);
    assert.equal(h.cycles[0].canDecide, true);
    assert.equal(h.cycles[0].decisionStepId, cycle.steps.find(s => s.userId === actor.id).id);
    const inbox = (await json(await api('/api/contract-approval-inbox', undefined, actor.token))).items.find(i => i.engagementId === e.id);
    assert.equal(inbox.mine, true); assert.equal(inbox.canDecide, true);
    assert.equal(inbox.totalCount, 2); assert.equal(inbox.approvedCount, 0);
    assert.ok(inbox.assignee.includes(co.name) && inbox.assignee.includes(cfo.name));
  }
  assert.equal((await upload(e, 1, 'blocked during review')).status, 409);
  // The second displayed person can decide before the first, who can then
  // submit the originally opened form without refreshing a colleague's vote.
  const first = (await json(await directDecision(e, cycle, cfo))).cycle;
  assert.equal(first.status, 'active');
  assert.equal((await history(e, cfo.token)).cycles[0].canDecide, false);
  assert.equal((await history(e, co.token)).cycles[0].canDecide, true);
  assert.equal((await json(await directDecision(e, cycle, co))).cycle.status, 'approved');
  const process = await json(await api(`/api/engagements/${e.id}/process`));
  assert.equal(process.client.activated, false); assert.equal(process.recordedSignatureDate, null);
});

test('parallel simultaneous approvals and exact retries count every person once', async () => {
  const e = await contract();
  const payload = await directSubmission(e), url = `/api/engagements/${e.id}/approvals`;
  const submissions = await Promise.all([api(url, payload, rm.token), api(url, payload, rm.token)]);
  assert.deepEqual(submissions.map(r => r.status).sort(), [200, 201]);
  const [a, b] = await Promise.all(submissions.map(r => r.json()));
  assert.equal(a.cycle.id, b.cycle.id); assert.equal(a.cycle.route.id, b.cycle.route.id);
  const votes = await Promise.all([directDecision(e, a.cycle, co), directDecision(e, a.cycle, cfo)]);
  assert.deepEqual(votes.map(r => r.status), [200, 200]);
  const done = (await history(e)).cycles[0];
  assert.equal(done.status, 'approved'); assert.equal(done.revision, 3);
  assert.ok(done.steps.every(s => s.status === 'approved'));
  assert.equal((await directDecision(e, a.cycle, co)).status, 409);
  const second = await contract(), cycle = await submitDirect(second);
  const body = { expectedRevision: cycle.revision, stepId: cycle.steps.find(s => s.userId === cfo.id).id,
    decision: 'approved', requestKey: key() };
  const voteUrl = `/api/engagements/${second.id}/approvals/${cycle.id}/decision`;
  await json(await api(voteUrl, body, cfo.token));
  const retry = await json(await api(voteUrl, body, cfo.token));
  assert.equal(retry.reused, true); assert.equal(retry.cycle.revision, 2);
  assert.equal((await api(voteUrl, { ...body, decision: 'returned', comment: 'Changed mind' }, cfo.token)).status, 409);
});

test('a parallel return or rejection closes outstanding votes and preserves prior decisions', async () => {
  const owner = (await json(await api('/api/auth/me'))).user;
  for (const decision of ['returned', 'rejected']) {
    const e = await contract(), cycle = await submitDirect(e, { participants: [co.id, cfo.id, owner.id] });
    await json(await directDecision(e, cycle, co));
    assert.equal((await directDecision(e, cycle, cfo, decision)).status, 400);
    const closed = (await json(await directDecision(e, cycle, cfo, decision, 'Please revise the terms'))).cycle;
    assert.equal(closed.status, decision);
    assert.equal(closed.steps.find(s => s.userId === co.id).status, 'approved');
    assert.equal(closed.steps.find(s => s.userId === owner.id).status, 'cancelled');
    assert.equal((await history(e, server.token)).cycles[0].canDecide, false);
    assert.equal((await directDecision(e, cycle, { id: owner.id, token: server.token })).status, 409);
    const next = await submitDirect(e);
    assert.equal(next.number, 2); assert.ok(next.steps.every(s => s.status === 'pending'));
    assert.equal((await history(e)).cycles[1].steps.find(s => s.userId === cfo.id).comment, 'Please revise the terms');
  }
});

test('direct selection validates people and deadlines atomically and retains access boundaries', async () => {
  const e = await contract(), url = `/api/engagements/${e.id}/approvals`;
  const db = new DatabaseSync(server.dbPath);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM contract_approval_routes').get().n;
  const before = count();
  for (const patch of [{ participants: [] }, { participants: [co.id, co.id] }, { participants: [String(co.id)] },
    { participants: Array(21).fill(co.id) }, { dueDays: 0 }, { dueDays: 31 }, { dueDays: 1.5 }]) {
    assert.equal((await api(url, await directSubmission(e, patch), rm.token)).status, 400);
  }
  for (const id of [rm.id, auditor.id, external.id, other.user.id]) {
    assert.equal((await api(url, await directSubmission(e, { participants: [co.id, id] }), rm.token)).status, 409);
  }
  // A different initiator cannot appoint the file author either.
  assert.equal((await api(url, await directSubmission(e, { participants: [rm.id] }))).status, 409);
  const valid = await directSubmission(e);
  for (const actor of [co, auditor, external, other]) {
    assert.ok([403, 404].includes((await api(url, valid, actor.token)).status));
  }
  assert.equal(count(), before); assert.equal((await history(e)).cycles.length, 0);
  await json(await api(`/api/users/${co.id}`, { active: false }, server.token, 'PUT'));
  assert.equal((await api(url, valid, rm.token)).status, 409);
  assert.equal((await history(e, rm.token)).people.some(p => p.id === co.id), false);
  await json(await api(`/api/users/${co.id}`, { active: true }, server.token, 'PUT'));
  assert.equal(count(), before); db.close();
  const fm = await contract({ direction: 'FM' });
  assert.equal((await api(`/api/engagements/${fm.id}/approvals`, await directSubmission(fm, { participants: [rm.id] }))).status, 409);
});

test('parallel late, foreign-step and future-revision votes cannot reopen a cancelled review', async () => {
  const e = await contract(), cycle = await submitDirect(e);
  const url = `/api/engagements/${e.id}/approvals/${cycle.id}/decision`;
  const body = { expectedRevision: 99, stepId: cycle.steps.find(s => s.userId === cfo.id).id, decision: 'approved', requestKey: key() };
  assert.equal((await api(url, body, cfo.token)).status, 409);
  assert.equal((await api(url, { ...body, expectedRevision: 1 }, co.token)).status, 403);
  await control(e, cycle, 'withdraw');
  assert.ok((await history(e)).cycles[0].steps.every(s => s.status === 'cancelled'));
  const next = await submitDirect(e);
  assert.equal((await directDecision(e, cycle, cfo)).status, 409);
  assert.equal((await history(e)).cycles[0].id, next.id);
  assert.ok((await history(e)).cycles[0].steps.every(s => s.status === 'pending'));
});

test('parallel review policy and recipients remain frozen when the underlying route is edited', async () => {
  const e = await contract(), cycle = await submitDirect(e);
  const route = cycle.route;
  await json(await api(`/api/contract-approval-routes/${route.id}`, { ...route, expectedRevision: route.revision,
    name: 'Edited for a future use', active: false, steps: [{ userId: cfo.id, dueDays: 1 }] }, server.token, 'PUT'));
  const h = await history(e, co.token);
  assert.equal(h.cycles[0].mode, 'parallel'); assert.equal(h.cycles[0].steps.length, 2);
  assert.equal(h.cycles[0].canDecide, true);
  const coRole = roles.find(x => x.code === 'COMPLIANCE_OFFICER');
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: true }, server.token, 'PUT'));
  assert.equal((await history(e, co.token)).cycles[0].canDecide, false);
  assert.equal((await directDecision(e, cycle, co)).status, 403);
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: false }, server.token, 'PUT'));
});

test('shared discussion lets every reviewer speak without recording an approval', async () => {
  const e = await contract(), cycle = await submitDirect(e);
  const before = await history(e);
  const first = await json(await postMessage(e, await messageBody(e, 'Согласен с замечанием, но решение ещё не принято', {
    authorId: rm.id, author: 'Forged', createdAt: '2000-01-01', status: 'approved',
  }), co.token), 201);
  assert.equal(first.message.authorId, co.id); assert.equal(first.message.author, co.name);
  assert.equal(first.message.cycleId, cycle.id); assert.equal(first.message.version, 1);
  assert.notEqual(first.message.createdAt, '2000-01-01');
  await json(await postMessage(e, await messageBody(e, 'Уточните порядок оплаты'), cfo.token), 201);
  const [managerChat, legalChat, financeChat] = await Promise.all([chat(e), chat(e, co.token), chat(e, cfo.token)]);
  assert.deepEqual(managerChat.messages, legalChat.messages); assert.deepEqual(legalChat.messages, financeChat.messages);
  assert.ok(managerChat.canPost && legalChat.canPost && financeChat.canPost);
  assert.equal(managerChat.documents.length, 1); assert.equal(managerChat.documents[0].version, 1);
  assert.equal(managerChat.documents[0].file_bytes, undefined);
  const after = await history(e);
  assert.equal(after.cycles[0].revision, before.cycles[0].revision);
  assert.ok(after.cycles[0].steps.every(s => s.status === 'pending'));
  assert.equal(after.summary.frozen, true);
});

test('chat retries are exactly once, attribution survives renaming, conflicting keys are refused', async () => {
  const e = await contract(), cycle = await submitDirect(e);
  const body = await messageBody(e, 'Повтор доставки');
  const sends = await Promise.all([postMessage(e, body, co.token), postMessage(e, body, co.token)]);
  assert.deepEqual(sends.map(r => r.status).sort(), [200, 201]);
  const responses = await Promise.all(sends.map(r => r.json()));
  assert.equal(responses[0].message.id, responses[1].message.id);
  assert.equal((await chat(e)).messages.length, 1);
  assert.equal((await postMessage(e, { ...body, text: 'Different text' }, co.token)).status, 409);
  assert.equal((await postMessage(e, body, cfo.token)).status, 409);
  await json(await api(`/api/users/${co.id}`, { name: 'Renamed reviewer' }, server.token, 'PUT'));
  assert.equal((await chat(e)).messages[0].author, co.name);
  await json(await api(`/api/users/${co.id}`, { name: co.name }, server.token, 'PUT'));
  await control(e, cycle, 'withdraw');
  await submitDirect(e);
  assert.equal((await json(await postMessage(e, body, co.token))).reused, true);
});

test('chat validates text, rejects stale context and keeps one thread across revisions', async () => {
  const e = await contract(), url = `/api/engagements/${e.id}/approvals/chat`;
  for (const text of ['', '  ', 123, 'x'.repeat(4001)]) assert.equal((await postMessage(e, await messageBody(e, text))).status, 400);
  assert.equal((await postMessage(e, await messageBody(e, 'text', { requestKey: 'bad' }))).status, 400);
  const oldDraft = await messageBody(e, 'Old draft');
  const original = await json(await postMessage(e, await messageBody(e, '<img src=x onerror=alert(1)>')), 201);
  let cycle = await submitDirect(e);
  assert.equal((await postMessage(e, oldDraft)).status, 409);
  const previous = await messageBody(e, 'Review version one');
  await json(await postMessage(e, previous, co.token), 201);
  await control(e, cycle, 'rework');
  await json(await upload(e, 1, 'Version two'), 201);
  assert.equal((await postMessage(e, { ...previous, requestKey: key() }, co.token)).status, 409);
  await submitDirect(e);
  await json(await postMessage(e, await messageBody(e, 'Review version two'), cfo.token), 201);
  const feed = await chat(e);
  assert.equal(feed.messages.length, 3);
  assert.equal(feed.messages[0].text, original.message.text);
  assert.deepEqual(feed.messages.map(m => m.version), [1, 1, 2]);
  assert.equal(feed.documents.length, 2);
  assert.equal((await api(url + '?before=1&after=1')).status, 400);
  assert.equal((await api(url + '?after=NaN')).status, 400);
});

test('chat enforces live reviewer, tenant, FM, external and read-only boundaries', async () => {
  const e = await contract(), url = `/api/engagements/${e.id}/approvals/chat`;
  assert.equal((await chat(e, co.token)).canPost, false);
  assert.equal((await postMessage(e, await messageBody(e), co.token)).status, 403);
  const cycle = await submitDirect(e);
  assert.equal((await fetch(server.baseUrl + url)).status, 401);
  assert.equal((await api(url, undefined, other.token)).status, 404);
  assert.equal((await api(url, undefined, external.token)).status, 403);
  assert.equal((await chat(e, auditor.token)).canPost, false);
  assert.equal((await postMessage(e, await messageBody(e), auditor.token)).status, 403);
  const coRole = roles.find(r => r.code === 'COMPLIANCE_OFFICER');
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: true }, server.token, 'PUT'));
  assert.equal((await chat(e, co.token)).canPost, false);
  assert.equal((await postMessage(e, await messageBody(e), co.token)).status, 403);
  await json(await api(`/api/roles/${coRole.id}`, { readOnly: false }, server.token, 'PUT'));
  await json(await api(`/api/users/${co.id}`, { active: false }, server.token, 'PUT'));
  assert.equal((await api(url, undefined, co.token)).status, 401);
  await json(await api(`/api/users/${co.id}`, { active: true }, server.token, 'PUT'));
  await control(e, cycle, 'withdraw');
  await submitDirect(e, { participants: [cfo.id] });
  assert.equal((await chat(e, co.token)).canPost, false);
  assert.equal((await postMessage(e, await messageBody(e), co.token)).status, 403);
  const fm = await contract({ direction: 'FM' });
  assert.equal((await api(`/api/engagements/${fm.id}/approvals/chat`, undefined, rm.token)).status, 403);
});

test('chat cursor pagination catches up without losing messages and stays contract scoped', async () => {
  const e = await contract(), second = await contract();
  const base = await messageBody(e);
  const ids = [];
  for (let i = 0; i < 105; i++) ids.push((await json(await postMessage(e, { ...base, text: 'Message ' + i, requestKey: key() }), 201)).message.id);
  const recent = await chat(e);
  assert.equal(recent.messages.length, 100); assert.equal(recent.hasMore, true);
  const older = await chat(e, rm.token, '?before=' + recent.nextBefore);
  assert.equal(older.messages.length, 5); assert.equal(older.nextBefore, null);
  assert.deepEqual([...older.messages, ...recent.messages].map(m => m.id), ids);
  const first = await chat(e, rm.token, '?after=0');
  assert.equal(first.hasMore, true);
  const rest = await chat(e, rm.token, '?after=' + first.nextAfter);
  assert.deepEqual([...first.messages, ...rest.messages].map(m => m.id), ids);
  const fresh = (await json(await postMessage(e, { ...base, text: 'While polling', requestKey: key() }), 201)).message;
  assert.deepEqual((await chat(e, rm.token, '?after=' + rest.nextAfter)).messages.map(m => m.id), [fresh.id]);
  assert.equal((await chat(second, rm.token, '?after=' + first.nextAfter)).messages.length, 0);
});

test('discussion prevents deletion or reassignment of a draft and preserves its author identity', async () => {
  const e = await contract({ noFile: true }), writer = await user('CEO');
  const created = await json(await postMessage(e, await messageBody(e, 'Draft discussion'), writer.token), 201);
  assert.equal(created.message.version, 0); assert.equal(created.message.versionId, null); assert.equal(created.message.cycleId, null);
  const deletion = await json(await api(`/api/engagements/${e.id}`, undefined, server.token, 'DELETE'), 409);
  assert.ok(deletion.footprint.some(f => f.table === 'contract_discussion_messages'));
  assert.equal((await api(`/api/engagements/${e.id}`, { direction: 'FM' }, server.token, 'PUT')).status, 409);
  const another = await contract({ noFile: true });
  assert.equal((await api(`/api/engagements/${e.id}`, { clientId: another.clientId }, server.token, 'PUT')).status, 409);
  const userDeletion = await json(await api(`/api/users/${writer.id}`, undefined, server.token, 'DELETE'), 409);
  assert.ok(userDeletion.footprint.some(f => f.table === 'contract_discussion_messages'));
  const repeatMigration = spawnSync(process.execPath, ['-e', "require('./db')"], { cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: server.dbPath }, encoding: 'utf8' });
  assert.equal(repeatMigration.status, 0, repeatMigration.stderr);
  assert.equal((await chat(e)).messages[0].id, created.message.id);
});

test('the current file author can discuss remarks even when excluded from approving their own file', async () => {
  const e = await contract({ noFile: true });
  await json(await upload(e, 0, 'Authored by compliance', co.token), 201);
  await submitDirect(e, { participants: [cfo.id] });
  assert.equal((await history(e, co.token)).cycles[0].canDecide, false);
  assert.equal((await chat(e, co.token)).canPost, true);
  await json(await postMessage(e, await messageBody(e, 'Author clarification'), co.token), 201);
});
