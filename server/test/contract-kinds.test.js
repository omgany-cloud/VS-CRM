const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, co, cfo, coo, legal;
const key = () => crypto.randomUUID();
const PDF = text => Buffer.from('%PDF-1.4\n' + text);
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
async function user(role) {
  const email = `kinds-${role}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Kinds ' + role, role, password: 'KindsTest123!' }), 201);
  const db = new DatabaseSync(server.dbPath); db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(u.id); db.close();
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'KindsTest123!' }))).token };
}
function upload(url, fields, file, token) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  form.append('file', new Blob([file.bytes]), file.name);
  return fetch(server.baseUrl + url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}
function contract(kind, extra = {}, token = rm.token) {
  return api('/api/engagements', { contractKind: kind, clientName: kind === 'supplier' ? 'ТОО «Аудит Плюс»' : 'ИП Сериков', counterpartyBin: '123456789012',
    counterpartyCountry: 'Казахстан', serviceType: kind === 'supplier' ? 'Аудит отчётности' : 'Консультация', contractNum: 'K-' + key().slice(0, 8),
    status: 'Draft', feeAmount: 100, date: '2026-10-01', ...extra }, token);
}
// Upload, approval by two colleagues and the signed PDF, as for any contract.
async function approveAndSign(e) {
  await json(await upload(`/api/engagements/${e.id}/versions`, { expectedVersion: 0, changeNote: 'Initial' }, { bytes: PDF('terms ' + e.id), name: 'contract.pdf' }, rm.token), 201);
  const cycle = (await json(await api(`/api/engagements/${e.id}/approvals`, { expectedVersion: 1, expectedCycleId: null, participants: [co.id, cfo.id], dueDays: 3, requestKey: key() }, rm.token), 201)).cycle;
  for (const reviewer of [co, cfo]) {
    await json(await api(`/api/engagements/${e.id}/approvals/${cycle.id}/decision`, { expectedRevision: cycle.revision,
      stepId: cycle.steps.find(s => s.userId === reviewer.id).id, decision: 'approved', comment: '', requestKey: key() }, reviewer.token));
  }
  await json(await upload(`/api/engagements/${e.id}/signatures`, { signedDate: '2026-10-20', expectedCycleId: cycle.id, requestKey: key() }, { bytes: PDF('signed ' + e.id), name: 'signed.pdf' }, rm.token), 201);
  return json(await api(`/api/engagements/${e.id}/signing`, undefined, rm.token));
}
const signing = (e, token = rm.token) => api(`/api/engagements/${e.id}/signing`, undefined, token).then(r => json(r));
const step = (e, token) => api(`/api/process-steps/contract/${e.id}`, undefined, token).then(r => json(r));
const decide = (e, body, token) => api(`/api/engagements/${e.id}/counterparty-decisions`, { requestKey: key(), expectedDecisionId: 0, ...body }, token);
const activate = (e, state) => api(`/api/engagements/${e.id}/activation`, { expectedSignatureId: state.signature.id, requestKey: key() }, rm.token);

before(async () => {
  server = await createTestServer({ port: 4220, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); co = await user('COMPLIANCE_OFFICER'); cfo = await user('CFO'); coo = await user('COO'); legal = await user('LEGAL');
});
after(async () => { if (server) await server.stop(); });

test('a supplier contract has no client card and starts after the ADATA check by the COO or Legal', async () => {
  await json(await contract('supplier', { counterpartyBin: '123' }), 400);
  await json(await contract('supplier', { clientId: 1 }), 400);
  await json(await contract('supplier', { serviceType: '' }), 400);
  await json(await contract('partner'), 400);
  const e = await json(await contract('supplier'), 201);
  assert.deepEqual([e.contractKind, e.clientId, e.direction, e.counterpartyBin], ['supplier', null, null, '123456789012']);
  assert.equal((await json(await api(`/api/engagements/${e.id}`, { contractKind: 'client' }, rm.token, 'PUT'), 409)).error, 'Вид договора не меняется — заведите новый договор');
  await json(await api(`/api/engagements/${e.id}`, { counterpartyCountry: 'Казахстан, Алматы' }, rm.token, 'PUT'));

  let state = await signing(e);
  assert.deepEqual(state.readiness.conditions.map(c => c.key), ['signature', 'screening']);
  assert.equal(state.counterparty.canDecide, false, 'the RM does not check suppliers');
  assert.equal((await signing(e, coo.token)).counterparty.canDecide, true);
  const forCoo = await step(e, coo.token), forRm = await step(e, rm.token);
  assert.deepEqual([forCoo.title, forCoo.mine], ['Проверьте поставщика в ADATA', true]);
  assert.equal(forRm.title, 'Загрузите файл договора');

  state = await approveAndSign(e);
  const refused = await json(await activate(e, state), 409);
  assert.equal(refused.conditions.find(c => c.key === 'screening').state, 'pending');
  assert.equal((await step(e, rm.token)).title, 'Для начала работы не хватает решения по контрагенту');

  await json(await decide(e, { result: 'approved', note: 'ADATA: замечаний нет' }), 403);
  await json(await decide(e, { result: 'approved', note: 'ADATA: замечаний нет' }, co.token), 403);
  await json(await decide(e, { result: 'approved', note: '  ' }, coo.token), 400);
  const rejected = await json(await decide(e, { result: 'rejected', note: 'ADATA: налоговая задолженность' }, coo.token), 201);
  assert.equal(rejected.current.resultLabel, 'Отказ по итогам проверки');
  assert.equal((await step(e, rm.token)).tone, 'stop');
  await json(await decide(e, { result: 'not_required', note: 'Разовая закупка' }, legal.token), 409);

  const body = { result: 'not_required', note: 'Разовая закупка до 100 МРП', expectedDecisionId: rejected.current.id, requestKey: key() };
  const decided = await json(await api(`/api/engagements/${e.id}/counterparty-decisions`, body, legal.token), 201);
  assert.deepEqual([decided.current.result, decided.current.decidedBy, decided.history.length], ['not_required', 'Kinds LEGAL', 1]);
  assert.equal((await json(await api(`/api/engagements/${e.id}/counterparty-decisions`, body, legal.token))).reused, true);
  await json(await api(`/api/engagements/${e.id}/counterparty-decisions`, { ...body, note: 'Другое' }, legal.token), 409);

  state = await signing(e);
  assert.equal(state.readiness.ready, true); assert.equal(state.canActivate, true);
  await json(await activate(e, state));
  await json(await decide(e, { result: 'rejected', note: 'Поздно', expectedDecisionId: decided.current.id }, coo.token), 409);
  assert.equal((await json(await api(`/api/engagements/${e.id}/payments`, undefined, rm.token))).supplier, true);
  await json(await api(`/api/engagements/${e.id}`, undefined, rm.token, 'DELETE'), 409);
});

test('a service outside the licence: the CEO, COO or Legal record that onboarding is not needed', async () => {
  const e = await json(await contract('unlicensed'), 201);
  let state = await signing(e);
  assert.deepEqual(state.readiness.conditions.map(c => c.key), ['signature', 'exemption']);
  assert.deepEqual(state.counterparty.results.map(r => r.value), ['approved', 'rejected']);
  await json(await upload(`/api/engagements/${e.id}/versions`, { expectedVersion: 0, changeNote: 'Initial' }, { bytes: PDF('unlicensed ' + e.id), name: 'contract.pdf' }, rm.token), 201);
  const approvals = await json(await api(`/api/engagements/${e.id}/approvals`, undefined, rm.token));
  assert.deepEqual([approvals.hasClient, approvals.canSubmit], [true, true], 'no client card is needed to send it for approval');

  await json(await decide(e, { result: 'not_required', note: 'Нет такого результата' }), 400);
  await json(await decide(e, { result: 'approved', note: 'Консультация не регулируется' }, co.token), 403);
  assert.equal((await step(e, server.token)).title, 'Решите, нужен ли клиенту онбординг');
  await json(await decide(e, { result: 'approved', note: 'Консультация по организации офиса — вне лицензии' }), 201);
  state = await signing(e);
  assert.equal(state.readiness.conditions[1].state, 'done');
  assert.match(state.readiness.conditions[1].detail, /^Онбординг не требуется: Консультация по организации офиса/);
});

test('COO and Legal roles carry the new permissions; client contracts keep the onboarding checks', async () => {
  const { roles } = await json(await api('/api/roles'));
  const role = code => roles.find(r => r.code === code);
  assert.deepEqual([role('COO').approveNoOnboarding, role('COO').checkCounterparties], [true, true]);
  assert.deepEqual([role('LEGAL').approveNoOnboarding, role('LEGAL').checkCounterparties], [true, true]);
  assert.deepEqual([role('CEO').approveNoOnboarding, role('CEO').checkCounterparties], [true, false]);

  const client = await json(await api('/api/ob-clients', { name: 'Kinds client', direction: 'CF&A' }), 201);
  const e = await json(await api('/api/engagements', { clientId: client.id, clientName: client.name, serviceType: 'Advising', status: 'Draft', feeAmount: 10, direction: 'CF&A' }, rm.token), 201);
  assert.equal(e.contractKind, 'client');
  const state = await signing(e);
  assert.deepEqual(state.readiness.conditions.map(c => c.key), ['signature', 'kyc', 'conflict']);
  assert.equal(state.counterparty, null);
  await json(await decide(e, { result: 'approved', note: 'x' }, coo.token), 409);
  await json(await api(`/api/engagements/${e.id}`, { contractKind: 'supplier' }, rm.token, 'PUT'), 409);
  const listed = (await json(await api('/api/onboarding', undefined, rm.token))).engagements;
  assert.ok(listed.some(x => x.contractKind === 'supplier'), 'staff without FM access see supplier contracts');
});

test('a supplier contract can be created from a Word template', async () => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zip.addFile('word/document.xml', Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Договор поставки</w:t></w:r></w:p></w:body></w:document>'));
  const t = await json(await upload('/api/contract-templates', { name: 'Договор с поставщиком', contractType: 'Договор поставки', direction: 'CF&A', changeNote: 'Исходный' },
    { bytes: zip.toBuffer(), name: 'Поставка.docx' }, server.token), 201);
  const path = `/api/contract-templates/${t.template.id}/versions/${t.version.id}/create-contract`;
  const base = { contractKind: 'supplier', clientName: 'ТОО «Офис Сервис»', serviceType: 'Аренда офиса', feeAmount: 500, currency: 'KZT', date: '2026-10-30' };
  await json(await api(path, { ...base, counterpartyBin: '12', requestKey: key() }), 400);
  const created = await json(await api(path, { ...base, requestKey: key() }), 201);
  assert.deepEqual([created.contract.contractKind, created.contract.clientId, created.contract.feeType, created.contract.documentVersion], ['supplier', null, null, 1]);
});
