// Server-side order of the onboarding stages (TZ 13.1 п. 5). The browser still
// fills the forms and suggests the next stage; the server refuses a transition
// the process does not allow, whoever sends it.
const { db } = require('./db');

// A locked stage opens once these stages are completed (or, for 1.1, sent to
// escalation — work on documents may go on while CO decides). Mirrors
// unlockNextTask() in js/onboarding.js.
const PREREQUISITES = { '2.1': ['1.1'], '2.2': ['2.1'], '3.1': ['2.2'], '3.2': ['2.2'], '4.1': ['3.2'], '5.1': ['4.1'] };
const STATUSES = new Set(['locked', 'open', 'in_progress', 'completed', 'escalated', 'rejected']);
const FORWARD = new Set(['open', 'in_progress', 'completed', 'escalated']);
// Outcomes that stop onboarding, as in submitObTask(); stored as status 'rejected'
// by the current form, or as 'completed' with this outcome by older records.
const HALTS = {
  conflict_precheck: d => /No-Go/.test(d.f_decision || d.decision || '') && 'решение No-Go',
  dd_outcome: d => /Отказать/.test(d.f_conclusion || d.conclusion || '') && 'заключение «Отказать»',
  suitability: d => (d.f_overallResult || d.overallResult) === 'Не подходит — отказ' && 'клиент не подходит',
  lp_qualification: d => /Не квалифицирован/.test(d.f_lpQualResult || d.lpQualResult || '') && 'LP не квалифицирован',
  lp_investment_profile: d => (d.f_fundSuitResult || d.fundSuitResult) === 'Нет — отказ' && 'LP не соответствует стратегии фонда',
};
const formData = json => { try { return JSON.parse(json || '{}'); } catch { return {}; } };
const stage = t => `${t.task_num} ${t.title}`;

function clientTasks(tenantId, clientId) {
  return db.prepare('SELECT * FROM ob_tasks WHERE tenant_id = ? AND client_id = ? ORDER BY task_num, id').all(tenantId, clientId);
}
function haltReason(task) {
  if (task.status === 'rejected') return 'отказ';
  return task.status === 'completed' && HALTS[task.form_key]?.(formData(task.form_data_json)) || null;
}

// What still stands in the way of activation, given the stages as they will be.
function activationProblems(tenantId, client, tasks) {
  const problems = [];
  const activation = tasks.find(t => t.task_num === '5.1');
  if (!activation) return ['этап 5.1 «Активация» не создан'];
  const open = tasks.filter(t => t.task_num !== '5.1' && t.status !== 'completed');
  if (open.length) problems.push('не завершены этапы ' + open.map(t => `${t.task_num} (${t.status === 'escalated' ? 'на эскалации — ждёт решения' : t.status})`).join(', '));
  const halted = tasks.find(t => t.task_num !== '5.1' && haltReason(t));
  if (halted) problems.push(`онбординг остановлен на этапе ${stage(halted)}`);
  const data = formData(activation.form_data_json), contractId = Number(data.f_engagementId || data.engagementId);
  const contract = Number.isSafeInteger(contractId) && contractId > 0 &&
    db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ? AND client_id = ?').get(tenantId, contractId, client.id);
  if (!contract || (contract.direction && contract.direction !== client.direction)) problems.push('в этапе 5.1 не выбран договор этого клиента');
  else if (contract.status !== 'Active') problems.push(`работа по договору ${contract.contract_num || '#' + contract.id} не начата — зарегистрируйте подписание и начните работу в карточке договора`);
  return problems;
}

// Owner's decision 28.10.2026: the client check conclusion (stage 2.2, KYC) is
// recorded, changed or reopened by the CEO (SEO), the Compliance Officer or the
// MLRO; others may still open the form.
const KYC_DECIDERS = new Set(['CEO', 'SEO', 'COMPLIANCE_OFFICER', 'MLRO']);
const DECIDED = new Set(['completed', 'rejected']);
const kycConclusion = data => (data?.f_conclusion || data?.conclusion || '');
function kycDecisionBlocked(existing, next, role) {
  if (existing.form_key !== 'dd_outcome' || KYC_DECIDERS.has(role)) return null;
  const decides = DECIDED.has(next.status) && next.status !== existing.status;
  const revises = DECIDED.has(existing.status) && (next.status !== existing.status || kycConclusion(next.formData) !== kycConclusion(formData(existing.form_data_json)));
  return decides || revises ? { status: 403, message: 'Заключение по проверке клиента (этап 2.2) сохраняют и пересматривают CEO, Compliance Officer и MLRO' } : null;
}

// Returns { status, message } when the stage may not take `next` (status + form data), else null.
function checkTaskTransition(tenantId, existing, next, role) {
  if (!STATUSES.has(next.status)) return { status: 400, message: 'Неизвестный статус этапа' };
  const kyc = kycDecisionBlocked(existing, next, role);
  if (kyc) return kyc;
  // The browser re-saves every stage after each step; only a change of status is a transition.
  if (next.status === existing.status) return null;
  const tasks = clientTasks(tenantId, existing.client_id).map(t => t.id === existing.id ? { ...t, status: next.status, form_data_json: JSON.stringify(next.formData || {}) } : t);
  const others = tasks.filter(t => t.id !== existing.id);
  if (FORWARD.has(next.status)) {
    const halted = others.find(haltReason);
    if (halted) return { status: 409, message: `Онбординг остановлен на этапе ${stage(halted)} (${haltReason(halted)}). Сначала пересмотрите это решение.` };
    if (existing.status === 'locked') {
      const passed = t => t.status === 'completed' || (t.task_num === '1.1' && t.status === 'escalated');
      const waiting = others.filter(t => (PREREQUISITES[existing.task_num] || []).includes(t.task_num) && !passed(t));
      if (waiting.length) return { status: 409, message: `Этап ${existing.task_num} откроется после завершения этапа ${waiting.map(t => t.task_num).join(', ')}` };
    }
  }
  if (next.status === 'completed' && existing.task_num === '5.1') {
    const client = db.prepare('SELECT * FROM ob_clients WHERE tenant_id = ? AND id = ?').get(tenantId, existing.client_id);
    const problems = client ? activationProblems(tenantId, client, tasks) : ['клиент не найден'];
    if (problems.length) return { status: 409, message: 'Активация невозможна: ' + problems.join('; ') };
  }
  return null;
}

// A client becomes activated only through a completed stage 5.1 whose checks still hold.
function checkClientActivation(tenantId, client) {
  const tasks = clientTasks(tenantId, client.id);
  const activation = tasks.find(t => t.task_num === '5.1');
  if (activation?.status !== 'completed') return { status: 409, message: 'Клиент активируется завершением этапа 5.1 «Активация»' };
  const problems = activationProblems(tenantId, client, tasks);
  return problems.length ? { status: 409, message: 'Активация невозможна: ' + problems.join('; ') } : null;
}

module.exports = { PREREQUISITES, HALTS, haltReason, checkTaskTransition, checkClientActivation, activationProblems };
