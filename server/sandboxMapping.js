// Shared row <-> frontend-object mapping + constants for the Sandbox
// ("Песочница") — the pre-Скрининг holding area for raw projects
// (server/db.js's sandbox_projects / sandbox_tasks).

// 'Передан в скрининг' is deliberately NOT settable through PUT — only the
// promote route (POST /api/sandbox/:id/promote) may set it, since it is
// the one status that also creates a real deal.
const SANDBOX_STATUSES = ['Новый', 'В проработке', 'Ждём информацию', 'Отложен', 'Отказ', 'Передан в скрининг'];
const SANDBOX_PROMOTED_STATUS = 'Передан в скрининг';
// A "no"/"not now" needs a recorded why — otherwise the sandbox turns
// into a graveyard nobody can learn anything from.
const SANDBOX_REASON_STATUSES = ['Отказ', 'Отложен'];

const SANDBOX_TASK_STATUSES = ['К выполнению', 'В работе', 'Готово', 'Отменена'];
const SANDBOX_TASK_DONE_STATUSES = ['Готово', 'Отменена'];
const SANDBOX_TASK_PRIORITIES = ['Высокий', 'Средний', 'Низкий'];

// names: { [email]: display name } — built once per request so a list of N
// projects doesn't do N user lookups.
function displayName(names, email) {
  if (!email) return null;
  return (names && names[email]) || email;
}

// Row from the list/detail SELECT in server/index.js — that query adds the
// aggregate columns (open_tasks/overdue_tasks/next_due) next to p.*.
function rowToSandboxProject(r, names) {
  return {
    id: r.id,
    version: r.version,
    fundId: r.fund_id,
    name: r.name,
    initiator: r.initiator || '',
    description: r.description || '',
    folderUrl: r.folder_url || '',
    goal: r.goal || '',
    status: r.status,
    statusReason: r.status_reason || '',
    deferredUntil: r.deferred_until || '',
    owner: r.owner || '',
    ownerName: displayName(names, r.owner),
    promotedDealId: r.promoted_deal_id,
    archived: !!r.archived,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openTasks: r.open_tasks || 0,
    overdueTasks: r.overdue_tasks || 0,
    nextDue: r.next_due || null,
  };
}

function rowToSandboxTask(r, names) {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    assignee: r.assignee || '',
    assigneeName: displayName(names, r.assignee),
    dueDate: r.due_date || '',
    priority: r.priority,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    completedAt: r.completed_at || null,
  };
}

module.exports = {
  SANDBOX_STATUSES, SANDBOX_PROMOTED_STATUS, SANDBOX_REASON_STATUSES,
  SANDBOX_TASK_STATUSES, SANDBOX_TASK_DONE_STATUSES, SANDBOX_TASK_PRIORITIES,
  rowToSandboxProject, rowToSandboxTask,
};
