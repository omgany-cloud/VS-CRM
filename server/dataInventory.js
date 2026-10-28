// Read-only inventory of records created before the server-side rules of
// v1.59–v1.61 (TZ 15, P0): contracts started without a registered signature,
// clients activated without a linked contract or finished checks, conflict
// decisions whose links do not hold. Nothing is changed; each finding needs a
// person's decision.
//
// Opens the SQLite file directly in read-only mode and never loads ./db (which
// would run migrations). Usage, from server/:
//   node dataInventory.js [path-to.sqlite] [--json]
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { KYC_VALIDITY_MONTHS, kycValidUntil } = require('./kycPolicy');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) || process.env.DB_PATH || path.join(__dirname, 'data', 'crm.sqlite');
if (!fs.existsSync(file)) { console.error('Файл базы не найден: ' + file); process.exit(1); }
const db = new DatabaseSync(file, { readOnly: true });
const has = table => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const formData = json => { try { return JSON.parse(json || '{}'); } catch { return {}; } };
const contractName = r => `договор #${r.id} «${r.contract_num || 'без номера'} · ${r.client_name || '—'}»`;

const sections = [];
function section(title, why, items) { sections.push({ title, why, items }); }

// Contracts
const signed = has('contract_signatures') ? 'EXISTS (SELECT 1 FROM contract_signatures s WHERE s.tenant_id = e.tenant_id AND s.engagement_id = e.id AND s.status = \'active\')' : '0';
const started = has('contract_activations') ? 'EXISTS (SELECT 1 FROM contract_activations a WHERE a.tenant_id = e.tenant_id AND a.engagement_id = e.id)' : '0';
section('Договоры «Активен» без зарегистрированной подписи', 'Начаты до M2.2: подписанный PDF и дата подписи не зарегистрированы в карточке.',
  all(`SELECT e.* FROM engagements e WHERE e.status = 'Active' AND NOT ${signed} ORDER BY e.tenant_id, e.id`).map(contractName));
section('Договоры «Активен» без серверной проверки начала работы', 'Статус поставлен вручную: условия (подпись, KYC, конфликт) сервером не проверялись.',
  all(`SELECT e.* FROM engagements e WHERE e.status = 'Active' AND NOT ${started} ORDER BY e.tenant_id, e.id`).map(contractName));
section('Дата подписания из старой формы без подписанного файла', 'Дата есть, но подписанный PDF не зарегистрирован; новая проверка такую дату не учитывает.',
  all(`SELECT e.* FROM engagements e WHERE (e.signed_date IS NOT NULL AND e.signed_date != '' OR e.lp_signed_date IS NOT NULL AND e.lp_signed_date != '') AND NOT ${signed} ORDER BY e.tenant_id, e.id`).map(contractName));
section('Договоры без карточки клиента', 'Без клиента договор нельзя отправить на согласование и начать по нему работу.',
  all(`SELECT e.* FROM engagements e LEFT JOIN ob_clients c ON c.tenant_id = e.tenant_id AND c.id = e.client_id WHERE c.id IS NULL ORDER BY e.tenant_id, e.id`)
    .map(r => contractName(r) + (r.client_id ? ` (клиент #${r.client_id} не найден)` : '')));
section('Направление договора не совпадает с направлением клиента', 'CF&A/FM определяет доступ (стена FM) и набор проверок.',
  all(`SELECT e.*, c.direction AS client_direction FROM engagements e JOIN ob_clients c ON c.tenant_id = e.tenant_id AND c.id = e.client_id
    WHERE e.direction IS NOT NULL AND e.direction != c.direction ORDER BY e.tenant_id, e.id`).map(r => `${contractName(r)}: договор ${r.direction}, клиент ${r.client_direction}`));

// Activated clients
const tasksOf = (tenantId, clientId) => all('SELECT task_num, status, form_data_json, completed_at FROM ob_tasks WHERE tenant_id = ? AND client_id = ? ORDER BY task_num', tenantId, clientId);
const activated = all('SELECT * FROM ob_clients WHERE activated = 1 ORDER BY tenant_id, id');
const clientName = c => `клиент #${c.id} «${c.name}» (${c.direction})`;
section('Активированные клиенты с незавершёнными этапами', 'Активация прошла, хотя этапы онбординга открыты, на эскалации или не созданы.',
  activated.flatMap(c => {
    const tasks = tasksOf(c.tenant_id, c.id), open = tasks.filter(t => t.status !== 'completed');
    if (!tasks.length) return [`${clientName(c)}: этапы онбординга не созданы`];
    return open.length ? [`${clientName(c)}: ${open.map(t => `${t.task_num} — ${t.status}`).join(', ')}`] : [];
  }));
section('Активированные клиенты без выбранного договора', 'С v1.59 активация (5.1) указывает договор явно; раньше брался первый договор клиента.',
  activated.filter(c => !tasksOf(c.tenant_id, c.id).some(t => t.task_num === '5.1' && (formData(t.form_data_json).f_engagementId || formData(t.form_data_json).engagementId))).map(clientName));
section('Активированные клиенты без одобренного KYC (2.2)', 'Итог проверки клиента не «Одобрить» или этап не завершён.',
  activated.filter(c => {
    const kyc = tasksOf(c.tenant_id, c.id).find(t => t.task_num === '2.2'), data = formData(kyc?.form_data_json);
    return !(kyc?.status === 'completed' && /^Одобрить/.test(data.f_conclusion || data.conclusion || ''));
  }).map(clientName));
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shown = day => day.slice(0, 10).split('-').reverse().join('.');
section('Активированные клиенты с истёкшим KYC', `KYC действует ${KYC_VALIDITY_MONTHS / 12} года от заключения 2.2; нужна повторная проверка клиента.`,
  activated.flatMap(c => {
    const kyc = tasksOf(c.tenant_id, c.id).find(t => t.task_num === '2.2' && t.status === 'completed');
    const decided = kyc && (kyc.completed_at || formData(kyc.form_data_json).f_ddDate), until = decided && kycValidUntil(decided);
    return until && until < today ? [`${clientName(c)}: заключение от ${shown(decided)}, действовало до ${shown(until)}`] : [];
  }));

// Conflict decisions
if (has('conflict_approvals')) {
  const conflicts = all(`SELECT a.*, c.id AS c_id, e.id AS e_id, e.client_id AS e_client FROM conflict_approvals a
    LEFT JOIN ob_clients c ON c.tenant_id = a.tenant_id AND c.id = a.client_id
    LEFT JOIN engagements e ON e.tenant_id = a.tenant_id AND e.id = a.engagement_id ORDER BY a.tenant_id, a.id`);
  const conflictName = a => `конфликт #${a.id} «${a.decision_type}», ${a.status}`;
  section('Решения по конфликтам со ссылкой на несуществующую запись', 'Клиент или договор удалён либо указан неверно.',
    conflicts.filter(a => a.client_id != null && a.c_id == null || a.engagement_id != null && a.e_id == null).map(conflictName));
  section('Решения по конфликтам: договор другого клиента', 'Такое решение может засчитаться не тому договору при начале работы.',
    conflicts.filter(a => a.c_id != null && a.e_id != null && a.e_client !== a.client_id).map(a => `${conflictName(a)}: клиент #${a.client_id}, договор #${a.engagement_id} клиента #${a.e_client ?? '—'}`));
  section('Принятые решения по конфликтам без отметки, кто решил', 'Решение сохранено до серверной фиксации автора решения.',
    conflicts.filter(a => ['Approved', 'Approved with conditions', 'Rejected'].includes(a.status) && !a.decided_by).map(conflictName));
}

// Approval chains and task assignees
if (has('workflow_instances')) {
  const targets = { kyc_lp: 'lp_register', kyc_cfa: 'ob_clients', nav_publish: 'hf_nav_history', deal_ic: 'deals' };
  section('Согласования KYC/NAV без существующего объекта', 'Цепочка указывает на запись, которой нет в этой компании.',
    all('SELECT * FROM workflow_instances ORDER BY tenant_id, id').filter(w => targets[w.type] && (w.entity_id == null
      || !db.prepare(`SELECT 1 FROM ${targets[w.type]} WHERE tenant_id = ? AND id = ?`).get(w.tenant_id, w.entity_id)))
      .map(w => `согласование #${w.id} ${w.type} «${w.entity_name || ''}», ${w.status}`));
}
if (has('discussion_task_state') && db.prepare("SELECT 1 FROM pragma_table_info('discussion_task_state') WHERE name = 'assignee_id'").get()) {
  section('Открытые задачи у неактивных сотрудников', 'Ответственный отключён: задача и напоминания о сроке никому не приходят.',
    all(`SELECT s.*, u.name, u.email FROM discussion_task_state s JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.assignee_id
      WHERE s.status = 'open' AND u.active = 0 ORDER BY s.tenant_id, s.id`)
      .map(s => `${s.room_id ? 'задача #' + s.room_id : 'задача договора #' + s.engagement_id}: ${s.name || s.email}`));
}
db.close();

if (args.includes('--json')) { console.log(JSON.stringify({ file, sections }, null, 1)); process.exit(0); }
console.log(`Проверка данных: ${file}\n`);
for (const s of sections) {
  console.log(`${s.items.length ? '⚠' : '✓'} ${s.title}: ${s.items.length}`);
  if (s.items.length) { console.log(`  ${s.why}`); for (const item of s.items) console.log(`  – ${item}`); }
}
console.log(`\nНайдено: ${sections.reduce((n, s) => n + s.items.length, 0)}. Скрипт ничего не изменял.`);
