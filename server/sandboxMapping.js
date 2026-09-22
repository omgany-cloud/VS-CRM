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

// AI analysis (POST /api/sandbox/:id/analyze) — deliberately narrow v1
// limits (Astra's numbers): enough for a real memo + a few exhibits,
// small enough that a run stays cheap and fast and a runaway attachment
// list fails BEFORE calling the model, not after paying for the call.
const SANDBOX_ANALYZABLE_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);
const SANDBOX_ANALYZE_MAX_FILES = 5;
const SANDBOX_ANALYZE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const SANDBOX_ANALYZE_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const SANDBOX_ANALYZE_MAX_TOTAL_CHARS = 40000;
const SANDBOX_ANALYZE_ACTIONS = ['consider_screening', 'request_information', 'do_not_proceed'];
// Free-text focus/question the caller can attach to one analysis run
// ("на что обратить особое внимание") — from an authenticated accessFM+
// aiAssist staff member, not from an untrusted document, but still bounded.
const SANDBOX_ANALYZE_CUSTOM_INSTRUCTIONS_MAX = 2000;
// Mirrors js/sandbox.js's SBX_AI_ACTION_LABELS — used server-side only for
// the Excel export column, so it reads as Russian text instead of a code.
const SANDBOX_ANALYZE_ACTION_LABELS_RU = {
  consider_screening: 'Рассмотреть для скрининга',
  request_information: 'Запросить дополнительную информацию',
  do_not_proceed: 'Не продолжать',
};

// names: { [email]: display name } — built once per request so a list of N
// projects doesn't do N user lookups.
function displayName(names, email) {
  if (!email) return null;
  return (names && names[email]) || email;
}

// The list SELECT's last_ai_result_json is the raw stored result of the
// most recent successful run — malformed/missing is treated as "no AI
// analysis yet" rather than a hard failure, since this is a display
// convenience, not authoritative data (that's GET /api/sandbox/:id/aiRuns).
function lastAiSummaryFields(r) {
  if (!r.last_ai_result_json) return { lastAiSummary: '', lastAiRecommendation: '', lastAiRunAt: null };
  try {
    const parsed = JSON.parse(r.last_ai_result_json);
    return {
      lastAiSummary: parsed.summary || '',
      lastAiRecommendation: SANDBOX_ANALYZE_ACTION_LABELS_RU[parsed.recommendation?.action] || parsed.recommendation?.action || '',
      lastAiRunAt: r.last_ai_run_at || null,
    };
  } catch (e) {
    return { lastAiSummary: '', lastAiRecommendation: '', lastAiRunAt: null };
  }
}

// Row from the list/detail SELECT in server/index.js — that query adds the
// aggregate columns (open_tasks/overdue_tasks/next_due/last_ai_*) next to p.*.
function rowToSandboxProject(r, names) {
  return {
    id: r.id,
    version: r.version,
    fundId: r.fund_id,
    name: r.name,
    initiator: r.initiator || '',
    description: r.description || '',
    folderUrl: r.folder_url || '',
    localFolderPath: r.local_folder_path || '',
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
    ...lastAiSummaryFields(r),
  };
}

function rowToSandboxFile(r) {
  return {
    id: r.id,
    uploadId: r.upload_id,
    name: r.original_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: `/api/uploads/${r.upload_id}`,
    attachedBy: r.attached_by,
    attachedAt: r.attached_at,
  };
}

// List view (GET /api/sandbox/:id's aiRuns[]) — no result_json/
// input_snapshot_json, just enough to show a history row and let the
// user open one run's full detail (GET /api/sandbox/runs/:runId).
function rowToSandboxAiRunSummary(r) {
  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    model: r.model,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function rowToSandboxAiRun(r) {
  return {
    ...rowToSandboxAiRunSummary(r),
    inputSnapshot: JSON.parse(r.input_snapshot_json || '{}'),
    result: r.result_json ? JSON.parse(r.result_json) : null,
    errorMessage: r.error_message,
    consentNote: r.consent_note,
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
    sourceAiRunId: r.source_ai_run_id || null,
  };
}

module.exports = {
  SANDBOX_STATUSES, SANDBOX_PROMOTED_STATUS, SANDBOX_REASON_STATUSES,
  SANDBOX_TASK_STATUSES, SANDBOX_TASK_DONE_STATUSES, SANDBOX_TASK_PRIORITIES,
  SANDBOX_ANALYZABLE_MIME_TYPES, SANDBOX_ANALYZE_MAX_FILES, SANDBOX_ANALYZE_MAX_FILE_BYTES,
  SANDBOX_ANALYZE_MAX_TOTAL_BYTES, SANDBOX_ANALYZE_MAX_TOTAL_CHARS, SANDBOX_ANALYZE_ACTIONS,
  SANDBOX_ANALYZE_ACTION_LABELS_RU, SANDBOX_ANALYZE_CUSTOM_INSTRUCTIONS_MAX,
  rowToSandboxProject, rowToSandboxTask, rowToSandboxFile, rowToSandboxAiRun, rowToSandboxAiRunSummary,
};
