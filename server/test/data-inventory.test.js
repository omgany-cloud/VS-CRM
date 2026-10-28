// dataInventory.js reports legacy records the newer server rules would refuse,
// reads the database without changing it, and never needs ./db migrations.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { createTestServer } = require('./helpers');

let server;
async function json(res, status = 200) { const body = await res.json(); assert.equal(res.status, status, JSON.stringify(body)); return body; }
const api = (url, body) => server.apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
function sql(query, ...args) { const db = new DatabaseSync(server.dbPath); try { return db.prepare(query).run(...args); } finally { db.close(); } }
function get(query, ...args) { const db = new DatabaseSync(server.dbPath, { readOnly: true }); try { return db.prepare(query).get(...args); } finally { db.close(); } }
const fingerprint = () => crypto.createHash('sha1').update(get(
  "SELECT group_concat(name || ':' || (SELECT count(*) FROM pragma_table_info(name))) s FROM sqlite_master WHERE type = 'table'").s).digest('hex');
function inventory() {
  const run = spawnSync('node', ['dataInventory.js', server.dbPath, '--json'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return Object.fromEntries(JSON.parse(run.stdout).sections.map(s => [s.title, s.items]));
}

before(async () => { server = await createTestServer({ port: 4215, extraEnv: { SMTP_HOST: '', AI_PROVIDER: '' } }); });
after(async () => { if (server) await server.stop(); });

test('legacy records are listed by kind and the database is left as it was', async () => {
  const clean = inventory();
  assert.ok(Object.values(clean).every(items => items.length === 0), JSON.stringify(clean));

  const a = await json(await api('/api/ob-clients', { name: 'Inventory A', direction: 'CF&A' }), 201);
  const b = await json(await api('/api/ob-clients', { name: 'Inventory B', direction: 'FM' }), 201);
  const contract = await json(await api('/api/engagements', { clientId: a.id, clientName: a.name, contractNum: 'INV-1', direction: 'CF&A', serviceType: 'Advising', status: 'Draft', feeAmount: 1 }), 201);
  const tenant = get('SELECT tenant_id FROM engagements WHERE id = ?', contract.id).tenant_id;
  sql("UPDATE engagements SET status = 'Active', signed_date = '2026-01-01', direction = 'FM' WHERE id = ?", contract.id);
  sql('UPDATE ob_clients SET activated = 1 WHERE id = ?', a.id);
  sql("INSERT INTO conflict_approvals (tenant_id, client_id, engagement_id, decision_type, status) VALUES (?, ?, ?, 'Dual-Mandate', 'Approved')", tenant, b.id, contract.id);
  sql("INSERT INTO workflow_instances (tenant_id, type, entity_id, entity_name, entity_type, created_at, created_by, current_step, status, steps_json) VALUES (?, 'kyc_lp', 999999, 'Ghost LP', 'LP', '2026-01-01', 'x', 0, 'active', '[]')", tenant);
  const stale = await json(await api('/api/ob-clients', { name: 'Inventory stale KYC', direction: 'CF&A' }), 201);
  sql('UPDATE ob_clients SET activated = 1 WHERE id = ?', stale.id);
  sql(`INSERT INTO ob_tasks (tenant_id, client_id, task_num, title, phase, role, form_key, status, form_data_json, completed_at)
    VALUES (?, ?, '2.2', 'Client Due Diligence Outcome', 2, 'MLRO', 'dd_outcome', 'completed', ?, '2020-01-15')`, tenant, stale.id, JSON.stringify({ f_conclusion: 'Одобрить — Approve' }));
  const before = fingerprint();

  const found = inventory();
  const count = title => found[title].length;
  assert.equal(count('Договоры «Активен» без зарегистрированной подписи'), 1);
  assert.equal(count('Договоры «Активен» без серверной проверки начала работы'), 1);
  assert.equal(count('Дата подписания из старой формы без подписанного файла'), 1);
  assert.match(found['Направление договора не совпадает с направлением клиента'][0], /договор FM, клиент CF&A/);
  assert.match(found['Активированные клиенты с незавершёнными этапами'][0], /этапы онбординга не созданы/);
  assert.equal(count('Активированные клиенты без выбранного договора'), 2, 'both activated clients lack a chosen contract');
  assert.equal(count('Активированные клиенты без одобренного KYC (2.2)'), 1);
  assert.match(found['Решения по конфликтам: договор другого клиента'][0], new RegExp(`клиент #${b.id}, договор #${contract.id} клиента #${a.id}`));
  assert.equal(count('Принятые решения по конфликтам без отметки, кто решил'), 1);
  assert.match(found['Согласования KYC/NAV без существующего объекта'][0], /Ghost LP/);
  assert.deepEqual(found['Активированные клиенты с истёкшим KYC'], [`клиент #${stale.id} «Inventory stale KYC» (CF&A): заключение от 15.01.2020, действовало до 15.01.2022`]);
  assert.equal(fingerprint(), before, 'the report does not change the schema');
  assert.equal(get('SELECT status FROM engagements WHERE id = ?', contract.id).status, 'Active');
});
