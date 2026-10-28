// "Следующий шаг" shown above a process task's chat: the one thing to do now,
// computed from live records. Display only — every action keeps its own checks.
const express = require('express');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { handle } = require('./contractDocuments');
const { getSource } = require('./discussionSources');
const { contractMetadata, latestCycle, approvalSummary } = require('./contractApprovalState');
const { readiness, activeSignature } = require('./contractSigning');
const { HALTS } = require('./onboardingRules');

// [CF&A, FM] labels; the stored task titles are the onboarding module's English names.
const STEP_LABELS = {
  '1.1': ['Проверка конфликтов (Go / No-Go)'],
  '2.1': ['Сбор документов клиента', 'Сбор документов LP'],
  '2.2': ['Проверка клиента (Due Diligence)', 'Проверка AML / KYC'],
  '3.1': ['Классификация клиента', 'Квалификация LP'],
  '3.2': ['Suitability / Appropriateness', 'Инвестиционный профиль LP'],
  '4.1': ['Договор с клиентом', 'Subscription Agreement'],
  '5.1': ['Активация клиента', 'Активация LP'],
};

function stepLabel(number, fm, fallback) {
  const labels = STEP_LABELS[number];
  return labels ? (fm && labels[1]) || labels[0] : fallback;
}

function onboardingStep(req, clientId) {
  const source = getSource(req, 'client', clientId), client = source.row, fm = client.direction === 'FM';
  const tasks = db.prepare(`SELECT id, task_num, title, role, form_key, status, due_date, form_data_json FROM ob_tasks
    WHERE tenant_id = ? AND client_id = ? ORDER BY task_num, id`).all(req.tenantId, client.id);
  const steps = tasks.map(t => ({ id: t.id, number: t.task_num, title: stepLabel(t.task_num, fm, t.title), role: t.role, status: t.status, dueDate: t.due_date }));
  const base = { process: 'client', processId: client.id, processTitle: client.name, steps, done: steps.filter(s => s.status === 'completed').length };
  const open = step => ({ kind: 'onboarding-step', taskId: step.id, label: `Открыть шаг ${step.number}` });
  if (client.activated) return { ...base, tone: 'done', title: fm ? 'Онбординг завершён — LP активирован' : 'Онбординг завершён — клиент активирован' };
  if (!tasks.length) return { ...base, tone: 'wait', title: 'Этапы онбординга не созданы', action: { kind: 'onboarding-client', label: 'Открыть онбординг' } };
  for (const [i, t] of tasks.entries()) {
    let data = {};
    try { data = JSON.parse(t.form_data_json || '{}'); } catch (_) { /* unreadable form stops nothing */ }
    const halt = t.status === 'rejected' ? 'отказ' : t.status === 'completed' && HALTS[t.form_key]?.(data);
    if (halt) return { ...base, tone: 'stop', title: `Онбординг остановлен: ${steps[i].number} ${steps[i].title} — ${halt}`, action: open(steps[i]) };
  }
  const escalated = steps.find(s => s.status === 'escalated');
  const next = steps.find(s => ['open', 'in_progress'].includes(s.status));
  const note = escalated && `Шаг ${escalated.number} на эскалации — ожидается решение CO`;
  if (next) return { ...base, tone: 'action', title: `${next.number} ${next.title}`, who: next.role, dueDate: next.dueDate, action: open(next), ...(note ? { note } : {}) };
  if (escalated) return { ...base, tone: 'wait', title: `Ожидается решение по эскалации: ${escalated.number} ${escalated.title}`, text: 'После решения CO обновите этот шаг', action: open(escalated) };
  const pending = steps.find(s => s.status !== 'completed');
  if (pending) return { ...base, tone: 'wait', title: `${pending.number} ${pending.title}`, text: 'Шаг откроется после завершения предыдущих этапов' };
  return { ...base, tone: 'wait', title: 'Все этапы выполнены, клиент ещё не активирован', action: { kind: 'onboarding-client', label: 'Открыть онбординг' } };
}

function contractStep(req, engagementId) {
  const source = getSource(req, 'contract', engagementId), contract = source.row;
  const p = req.user.permissions, writer = !p.readOnly;
  const summary = approvalSummary(contract), cycle = latestCycle(contract.tenant_id, contract.id);
  const signature = activeSignature(contract.tenant_id, contract.id);
  const approved = summary.status === 'approved', active = contract.status === 'Active';
  const steps = [
    { number: '1', title: 'Файл договора', status: contract.document_version ? 'completed' : 'open' },
    { number: '2', title: 'Согласование', status: approved || active ? 'completed' : summary.status === 'active' ? 'in_progress' : contract.document_version ? 'open' : 'locked' },
    { number: '3', title: 'Подписание', status: signature || active ? 'completed' : approved ? 'open' : 'locked' },
    { number: '4', title: 'Начало работы', status: active ? 'completed' : signature ? 'open' : 'locked' },
  ];
  const base = { process: 'contract', processId: contract.id, processTitle: source.title, steps, done: steps.filter(s => s.status === 'completed').length };
  const card = (section, label) => ({ kind: 'contract-card', section, label });
  if (active) {
    const started = db.prepare('SELECT activation_date FROM contract_activations WHERE tenant_id = ? AND engagement_id = ? ORDER BY id DESC LIMIT 1').get(req.tenantId, contract.id);
    return { ...base, tone: 'done', title: started ? `Работа по договору начата ${started.activation_date}` : 'Работа по договору идёт' };
  }
  if (['Completed', 'Terminated'].includes(contract.status)) return { ...base, tone: 'done', title: contract.status === 'Completed' ? 'Договор завершён' : 'Договор прекращён' };
  if (!contract.document_version) return { ...base, tone: 'action', title: 'Загрузите файл договора', text: 'DOCX или PDF — в блоке «Версии документа»', action: card('versions', 'Открыть карточку договора') };
  if (summary.status === 'active') {
    const decisions = db.prepare('SELECT assignee_id, assignee_name, status FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? ORDER BY position').all(req.tenantId, cycle.id);
    const waiting = decisions.filter(s => s.status === 'pending'), agreed = decisions.filter(s => s.status === 'approved').length;
    const progress = `Согласовали ${agreed} из ${decisions.length}`;
    if (writer && waiting.some(s => s.assignee_id === req.user.id)) {
      return { ...base, tone: 'action', title: 'Нужно ваше решение по договору', text: `${progress}. Кнопки решения — под полем сообщения`, action: { kind: 'contract-decide', label: 'Принять решение' } };
    }
    return { ...base, tone: 'wait', title: `На согласовании: ждём ${waiting.map(s => s.assignee_name).join(', ') || 'решения'}`, text: progress };
  }
  if (approved) {
    if (!signature) {
      return writer && p.recordContractSignature
        ? { ...base, tone: 'action', title: 'Зарегистрируйте подписанный договор', text: 'PDF с подписями обеих сторон и дата подписания', action: card('signing', 'Открыть подписание') }
        : { ...base, tone: 'wait', title: 'Ожидается регистрация подписанного договора', text: 'Регистрирует сотрудник с правом «Регистрация подписания договоров»' };
    }
    const check = readiness(contract);
    if (check.ready) {
      return writer && p.manageContracts
        ? { ...base, tone: 'action', title: 'Начните работу по договору', text: 'Подписание и проверки клиента выполнены', action: card('signing', 'Начать работу') }
        : { ...base, tone: 'wait', title: 'Договор готов к началу работы', text: 'Начинает работу сотрудник с правом ведения договоров' };
    }
    const missing = check.conditions.filter(c => c.state !== 'done').map(c => `${c.label} — ${c.detail}`).join('; ');
    return { ...base, tone: 'wait', title: 'Для начала работы не хватает проверок клиента', text: missing,
      ...(contract.client_id ? { action: { kind: 'onboarding-client', clientId: contract.client_id, label: 'Открыть онбординг' } } : {}) };
  }
  if (!contract.client_id) return { ...base, tone: 'action', title: 'Свяжите договор с карточкой клиента', text: 'Без клиента договор нельзя отправить на согласование', action: card('versions', 'Открыть карточку договора') };
  const version = db.prepare('SELECT id, metadata_json FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
    .get(req.tenantId, contract.id, contract.document_version);
  if (summary.status === 'needs_revision' || version?.metadata_json !== JSON.stringify(contractMetadata(contract))) {
    return { ...base, tone: 'action', title: 'Загрузите новую редакцию договора', text: 'Файл или реквизиты изменились после прошлой редакции', action: card('versions', 'Открыть карточку договора') };
  }
  // After a return the author usually uploads a corrected revision; then it is ready to resubmit.
  if (['returned', 'rejected'].includes(summary.status) && cycle.document_version_id === version.id) {
    const remark = db.prepare("SELECT assignee_name, comment FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND status IN ('returned','rejected') ORDER BY decided_at DESC LIMIT 1").get(req.tenantId, cycle.id);
    return { ...base, tone: 'action', title: summary.status === 'returned' ? 'Договор возвращён на доработку' : 'Договор отклонён',
      text: `${remark ? `${remark.assignee_name}: ${remark.comment}. ` : ''}Загрузите исправленную редакцию и отправьте снова`, action: card('versions', 'Открыть карточку договора') };
  }
  return writer && p.manageContracts
    ? { ...base, tone: 'action', title: 'Отправьте договор на согласование', text: 'Выберите согласующих — справа, «Настройка и история согласования»', action: { kind: 'contract-approval', label: 'Выбрать согласующих' } }
    : { ...base, tone: 'wait', title: 'Договор готов к отправке на согласование', text: 'Отправляет сотрудник с правом ведения договоров' };
}

const router = express.Router();
router.use(requireAuth, requireInternal, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/client/:id', handle((req, res) => res.json(onboardingStep(req, req.params.id))));
router.get('/contract/:id', handle((req, res) => res.json(contractStep(req, req.params.id))));

module.exports = router;
