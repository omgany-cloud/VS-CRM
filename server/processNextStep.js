// "Следующий шаг" shown above a process task's chat: the one thing to do now,
// computed from live records. Display only — every action keeps its own checks.
const express = require('express');
const { db } = require('./db');
const { requireAuth, requireInternal } = require('./auth');
const { handle, ContractError } = require('./contractDocuments');
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

// Onboarding stages name a role; the user's role code that performs it.
const STAGE_ROLES = { RM: 'RELATIONSHIP_MANAGER', CO: 'COMPLIANCE_OFFICER' };

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
  if (next) return { ...base, tone: 'action', title: `${next.number} ${next.title}`, who: next.role, dueDate: next.dueDate, action: open(next), mine: STAGE_ROLES[next.role] === req.user.role, ...(note ? { note } : {}) };
  if (escalated) return { ...base, tone: 'wait', title: `Ожидается решение по эскалации: ${escalated.number} ${escalated.title}`, text: 'После решения CO обновите этот шаг', action: open(escalated), mine: req.user.role === 'COMPLIANCE_OFFICER' };
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
      return { ...base, tone: 'action', title: 'Нужно ваше решение по договору', text: `${progress}. Кнопки решения — под полем сообщения`, action: { kind: 'contract-decide', label: 'Принять решение' }, mine: true };
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
    const unmet = check.conditions.filter(c => c.state !== 'done'), missing = unmet.map(c => `${c.label} — ${c.detail}`).join('; ');
    // Only a conflict decision or its conditions left: that is where to go, not onboarding.
    if (unmet.length === 1 && unmet[0].approvalId) {
      return { ...base, tone: 'wait', title: 'Для начала работы не хватает решения по конфликту интересов', text: missing,
        action: { kind: 'conflict-approval', approvalId: unmet[0].approvalId, label: 'Открыть решение по конфликту' } };
    }
    return { ...base, tone: 'wait', title: 'Для начала работы не хватает проверок клиента', text: missing,
      ...(contract.client_id ? { action: { kind: 'onboarding-client', clientId: contract.client_id, label: 'Открыть онбординг' } } : {}) };
  }
  if (!contract.client_id) return { ...base, tone: 'action', title: 'Свяжите договор с карточкой клиента', text: 'Без клиента договор нельзя отправить на согласование', action: card('details', 'Открыть карточку договора') };
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

function localDay() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function shownDay(day) { return day ? day.slice(0, 10).split('-').reverse().join('.') : ''; }
function sameEmail(a, b) { return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
function personName(tenantId, email) {
  const user = email && db.prepare('SELECT name, email FROM users WHERE tenant_id = ? AND lower(email) = lower(?)').get(tenantId, email);
  return user ? user.name || user.email : email || '';
}

// Sandbox (owner's decision 29.10.2026): new → worked on through the project's
// own tasks → decision. Only the CEO (screeningAccept) passes a project to
// screening; refusal and postponement are recorded on the project itself.
function sandboxStep(req, projectId) {
  const project = getSource(req, 'sandbox', projectId).row, p = req.user.permissions, writer = !p.readOnly;
  const tasks = db.prepare(`SELECT title, assignee, due_date FROM sandbox_tasks WHERE tenant_id = ? AND project_id = ?
    AND status IN ('К выполнению', 'В работе') ORDER BY due_date IS NULL, due_date, id`).all(req.tenantId, project.id);
  const status = project.status, working = ['В проработке', 'Ждём информацию'].includes(status);
  const steps = [
    { number: '1', title: 'Проект заведён', status: 'completed' },
    { number: '2', title: 'Проработка: задачи проекта', status: status === 'Новый' ? 'open' : working ? 'in_progress' : 'completed' },
    { number: '3', title: 'Решение: скрининг (CEO), отказ или отложить', status: status === 'Передан в скрининг' ? 'completed' : status === 'Отказ' ? 'rejected'
      : status === 'Отложен' || (status === 'В проработке' && !tasks.length) ? 'open' : 'locked' },
  ];
  const base = { process: 'sandbox', processId: project.id, processTitle: project.name, steps, done: steps.filter(s => s.status === 'completed').length };
  const open = { kind: 'open-record', record: 'sandbox', id: project.id, label: 'Открыть проект' };
  const owner = personName(req.tenantId, project.owner), ownerIsMe = sameEmail(project.owner, req.user.email);
  if (project.archived) return { ...base, tone: 'done', title: 'Проект в архиве' };
  if (status === 'Передан в скрининг') {
    return { ...base, tone: 'done', title: 'Передан в скрининг', text: 'Проект стал сделкой на стадии «Скрининг»',
      ...(project.promoted_deal_id ? { action: { kind: 'open-record', record: 'deal', id: project.promoted_deal_id, label: 'Открыть сделку' } } : {}) };
  }
  if (status === 'Отказ') return { ...base, tone: 'stop', title: 'Отказ по проекту', text: project.status_reason || '', action: open };
  if (status === 'Отложен') {
    const until = project.deferred_until;
    if (until && until <= localDay()) {
      return { ...base, tone: 'action', title: 'Срок отложения наступил — вернитесь к проекту', who: owner, dueDate: until,
        text: 'Верните проект в проработку или примите решение', action: open, mine: writer && ownerIsMe };
    }
    return { ...base, tone: 'wait', title: until ? `Проект отложен до ${shownDay(until)}` : 'Проект отложен', text: project.status_reason || '', action: open };
  }
  if (status === 'Новый') {
    return { ...base, tone: 'action', title: 'Начните проработку проекта', who: owner, text: 'Статус «В проработке» и задачи с исполнителями и сроками', action: open, mine: writer && ownerIsMe };
  }
  if (tasks.length) {
    const task = tasks.find(t => sameEmail(t.assignee, req.user.email)) || tasks[0];
    const more = tasks.length > 1 ? `; ещё открыто: ${tasks.length - 1}` : '';
    return { ...base, tone: 'action', title: `Задача проекта: «${task.title}»`, who: personName(req.tenantId, task.assignee) || 'исполнитель не назначен',
      ...(task.due_date ? { dueDate: task.due_date } : {}), text: (status === 'Ждём информацию' ? 'Ждём информацию' : 'Проработка проекта') + more,
      action: open, mine: writer && sameEmail(task.assignee, req.user.email) };
  }
  if (status === 'Ждём информацию') {
    return { ...base, tone: 'wait', title: 'Ждём информацию', who: owner, text: 'Когда информация придёт — верните проект в «В проработке»', action: open };
  }
  const ceo = writer && !!p.screeningAccept;
  return { ...base, tone: ceo ? 'action' : 'wait', title: ceo ? 'Примите решение по проекту' : 'Ждём решения по проекту',
    who: 'CEO', text: 'Передать в скрининг (CEO), отказ или отложить до даты', action: open, mine: ceo };
}

// Conflict decision → its conditions with executors (TZ section 44).
function conflictStep(req, approvalId) {
  const approval = getSource(req, 'conflict', approvalId).row, p = req.user.permissions, writer = !p.readOnly;
  const conditions = db.prepare(`SELECT c.text, c.due_date, c.before_start, c.status, c.assignee_id, COALESCE(u.name, u.email) AS assignee FROM conflict_conditions c
    LEFT JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.assignee_id WHERE c.tenant_id = ? AND c.approval_id = ? ORDER BY c.due_date, c.id`).all(req.tenantId, approval.id);
  const status = approval.status, conditional = status === 'Approved with conditions';
  const openConditions = conditions.filter(c => c.status === 'open');
  const steps = [{ number: '1', title: 'Решение по конфликту', status: status === 'Pending' ? 'open' : status === 'Escalated' ? 'escalated' : status === 'Rejected' ? 'rejected' : 'completed' }];
  if (conditional) steps.push({ number: '2', title: 'Выполнение условий', status: !conditions.length ? 'open' : openConditions.length ? 'in_progress' : 'completed' });
  const base = { process: 'conflict', processId: approval.id, processTitle: approval.deal_ref || approval.decision_type, steps, done: steps.filter(s => s.status === 'completed').length };
  const open = { kind: 'conflict-approval', approvalId: approval.id, label: 'Открыть решение' };
  const decider = writer && !!p.decideConflicts;
  if (status === 'Pending' || status === 'Escalated') {
    const mine = status === 'Escalated' ? writer && req.user.role === 'CEO' : decider;
    return { ...base, tone: mine ? 'action' : 'wait', title: mine ? 'Примите решение по конфликту' : 'Ждём решения по конфликту',
      who: status === 'Escalated' ? 'CEO (эскалация)' : 'CEO, Compliance Officer или MLRO', text: `${approval.decision_type} · риск ${approval.risk_level}`, action: open, mine };
  }
  if (status === 'Rejected') return { ...base, tone: 'stop', title: 'Решение по конфликту: отклонено', text: approval.rationale || '', action: open };
  if (!conditional) return { ...base, tone: 'done', title: 'Решение по конфликту: одобрено' };
  if (!conditions.length) {
    return { ...base, tone: decider ? 'action' : 'wait', title: 'Внесите условия решения', who: 'CEO, Compliance Officer или MLRO',
      text: 'Без записанных условий работа по договору клиента не начнётся', action: open, mine: decider };
  }
  if (!openConditions.length) return { ...base, tone: 'done', title: 'Условия решения выполнены' };
  const condition = openConditions.find(c => c.assignee_id === req.user.id) || openConditions[0];
  const more = openConditions.length > 1 ? `; ещё открыто: ${openConditions.length - 1}` : '';
  return { ...base, tone: 'action', title: `Условие: «${condition.text}»`, who: condition.assignee || '', dueDate: condition.due_date,
    text: (condition.before_start ? 'Нужно до начала работы по договору' : 'В ходе работы') + more, action: open, mine: writer && condition.assignee_id === req.user.id };
}

// Each process kind a task can follow, in the order a free task picks its process.
const PROCESS_STEPS = { client: onboardingStep, contract: contractStep, conflict: conflictStep, sandbox: sandboxStep };
const STEP_KINDS = Object.keys(PROCESS_STEPS);
function processStep(req, kind, id) {
  if (!Object.hasOwn(PROCESS_STEPS, kind)) throw new ContractError(404, 'Для этого процесса шаги не рассчитываются');
  return PROCESS_STEPS[kind](req, id);
}
// "Мой ход": the step is addressed to the user (their decision, condition,
// sandbox task or stage role), or it is an action and they are responsible for the task.
function myTurn(req, step, task) {
  return !!step && (!!step.mine || (step.tone === 'action' && task?.assignee?.id === req.user.id));
}

const router = express.Router();
router.use(requireAuth, requireInternal, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/:kind/:id', handle((req, res) => res.json(processStep(req, req.params.kind, req.params.id))));

module.exports = { router, processStep, myTurn, STEP_KINDS };
