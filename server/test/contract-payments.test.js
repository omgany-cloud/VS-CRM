// Contract payments: payment orders attached by hand, "Оплачено" summed by the
// server, duplicates and wrong files refused, rights and the FM wall respected,
// mistaken entries voided with a reason (owner's decision 28.10.2026).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server, rm, cfo, co, auditor, other;
const key = () => crypto.randomUUID();
const PDF = text => Buffer.from('%PDF-1.4\n' + text);
const JPG = text => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(text)]);
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
function api(url, body, token = server.token, method = body === undefined ? 'GET' : 'POST') {
  return server.apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { Authorization: 'Bearer ' + token } });
}
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
function row(query, ...args) { const db = new DatabaseSync(server.dbPath, { readOnly: true }); try { return db.prepare(query).get(...args); } finally { db.close(); } }
async function user(role) {
  const email = `pay-${role.toLowerCase()}@test.example`;
  const u = await json(await api('/api/users', { email, name: 'Pay ' + role, role, password: 'Payments123!' }), 201);
  sql('UPDATE users SET must_change_password = 0 WHERE id = ?', u.id);
  return { ...u, token: (await json(await api('/api/auth/login', { email, password: 'Payments123!' }))).token };
}
async function contract(direction = 'CF&A', feeAmount = 1000) {
  const c = await json(await api('/api/ob-clients', { name: 'Payment client', direction }), 201);
  return json(await api('/api/engagements', { clientId: c.id, clientName: c.name, contractNum: 'PAY-' + key().slice(0, 6), direction,
    serviceType: direction === 'FM' ? 'LP Investment (FM)' : 'Advising', status: 'Draft', feeAmount, currency: 'KZT' }), 201);
}
function pay(e, fields, file = { bytes: PDF('order ' + key()), name: 'order.pdf' }, token = rm.token) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ amount: '400,50', paidDate: '2026-10-01', paymentNumber: '17', requestKey: key(), ...fields })) form.append(name, value);
  if (file) form.append('file', new Blob([file.bytes]), file.name);
  return fetch(server.baseUrl + `/api/engagements/${e.id}/payments`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
}

before(async () => {
  server = await createTestServer({ port: 4217, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } });
  rm = await user('RELATIONSHIP_MANAGER'); cfo = await user('CFO'); co = await user('COMPLIANCE_OFFICER'); auditor = await user('AUDITOR');
  other = await json(await api('/api/auth/signup', { companyName: 'Other pay company', name: 'Other', email: 'pay-other@test.example', password: 'Payments123!' }), 201);
});
after(async () => { if (server) await server.stop(); });

test('payment orders add up to "paid"; the balance is the fee minus paid; a retry does not count twice', async () => {
  const e = await contract();
  const requestKey = key(), file = { bytes: PDF('first order'), name: 'first.pdf' };
  let state = await json(await pay(e, { amount: '400,50', requestKey, payer: 'ТОО Клиент', note: 'Аванс' }, file), 201);
  assert.equal(state.paid, 400.5); assert.equal(state.balance, 599.5); assert.equal(state.currency, 'KZT');
  assert.equal(state.payments[0].paymentNumber, '17'); assert.equal(state.payments[0].payer, 'ТОО Клиент'); assert.equal(state.payments[0].recordedBy, 'Pay RELATIONSHIP_MANAGER');
  assert.equal((await json(await pay(e, { amount: '400,50', requestKey, payer: 'ТОО Клиент', note: 'Аванс' }, file))).payments.length, 1, 'a retried request is not a second payment');
  state = await json(await pay(e, { amount: '1 000', paymentNumber: '18', paidDate: '2026-10-05' }, { bytes: JPG('scan'), name: 'scan.jpg' }, cfo.token), 201);
  assert.equal(state.paid, 1400.5); assert.equal(state.balance, -400.5);
  assert.equal(row('SELECT paid FROM engagements WHERE id = ?', e.id).paid, 1400.5);
  assert.deepEqual(state.payments.map(p => p.paymentNumber), ['18', '17']);
});

test('wrong amounts, dates, files and duplicate orders are refused', async () => {
  const e = await contract();
  for (const fields of [{ amount: '0' }, { amount: '1.234' }, { amount: '-5' }, { amount: 'сто' }, { paidDate: '2999-01-01' }, { paidDate: '2026-02-30' }, { paymentNumber: '  ' }]) {
    await json(await pay(e, fields), 400);
  }
  await json(await pay(e, {}, null), 400);
  await json(await pay(e, {}, { bytes: Buffer.from('plain text'), name: 'order.pdf' }), 400);
  await json(await pay(e, {}, { bytes: PDF('ok'), name: 'order.txt' }), 400);
  const file = { bytes: PDF('only once'), name: 'once.pdf' };
  await json(await pay(e, { paymentNumber: '50' }, file), 201);
  assert.match((await json(await pay(e, { paymentNumber: '51' }, file), 409)).error, /уже внесена: № 50/);
  await json(await pay(e, { paymentNumber: '50' }), 409);
});

test('only contract managers and payment confirmers record; the FM wall and LP contracts are respected', async () => {
  const e = await contract();
  await json(await pay(e, {}, undefined, co.token), 403);
  await json(await pay(e, {}, undefined, auditor.token), 403);
  await json(await pay(e, {}, undefined, other.token), 404);
  assert.equal((await json(await api(`/api/engagements/${e.id}/payments`, undefined, co.token))).canRecord, false);
  const fm = await contract('FM', 5000000);
  assert.match((await json(await pay(fm, {}, undefined, server.token), 409)).error, /Capital Calls/);
  const view = await json(await api(`/api/engagements/${fm.id}/payments`));
  assert.equal(view.fm, true); assert.equal(view.balance, null); assert.equal(view.canRecord, false);
  await json(await api(`/api/engagements/${fm.id}/payments`, undefined, rm.token), 403);
});

test('a mistaken payment is voided with a reason and leaves history; "paid" cannot be typed in; a paid contract is not deleted', async () => {
  const e = await contract();
  sql('UPDATE engagements SET paid_before_payments = 100, paid = 100 WHERE id = ?', e.id); // typed in before payment orders
  let state = await json(await pay(e, { amount: '250' }), 201);
  assert.equal(state.paid, 350); assert.equal(state.paidBefore, 100);
  const id = state.payments[0].id;
  await json(await api(`/api/engagements/${e.id}/payments/${id}/void`, { reason: ' ', requestKey: key() }, rm.token), 400);
  await json(await api(`/api/engagements/${e.id}/payments/${id}/void`, { reason: 'Не тот договор', requestKey: key() }, co.token), 403);
  state = await json(await api(`/api/engagements/${e.id}/payments/${id}/void`, { reason: 'Не тот договор', requestKey: key() }, rm.token));
  assert.equal(state.paid, 100); assert.equal(state.payments[0].status, 'voided'); assert.equal(state.payments[0].voidReason, 'Не тот договор');
  await json(await api(`/api/engagements/${e.id}/payments/${id}/void`, { reason: 'Again', requestKey: key() }, rm.token), 409);
  const file = await fetch(server.baseUrl + `/api/engagements/${e.id}/payments/${id}/file`, { headers: { Authorization: 'Bearer ' + rm.token } });
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'application/pdf');

  assert.match((await json(await api(`/api/engagements/${e.id}`, { paid: 999 }, server.token, 'PUT'), 409)).error, /платёжками/);
  await json(await api(`/api/engagements/${e.id}`, { paid: 100, notes: 'unchanged paid is fine' }, server.token, 'PUT'));
  await json(await api('/api/engagements', { clientName: 'Forged paid', direction: 'CF&A', serviceType: 'Advising', status: 'Draft', paid: 5 }), 409);
  assert.equal((await api(`/api/engagements/${e.id}`, undefined, server.token, 'DELETE')).status, 409);
});
