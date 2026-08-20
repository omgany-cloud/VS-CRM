// ============================================================
//  audit-log.js — cross-module "who/what/when" event feed
//  Backed by GET /api/audit-log (server/auditLog.js) — v1 scope:
//  LP Register, Capital Calls, Distributions, Portfolio, Deals,
//  Conflict Approvals, Engagements. Event-only (no per-field diff),
//  same deliberate v1 choice as the server side — see auditLog.js.
// ============================================================

let auditLogEntries = [];
let auditLogEntityFilter = '';

const AUDIT_ENTITY_LABELS = {
  lp_register:        { label: 'LP Register',        color: '#14b8a6' },
  capital_calls:       { label: 'Capital Calls',       color: '#f97316' },
  distributions:        { label: 'Distributions',        color: '#22c55e' },
  portfolio:            { label: 'Portfolio',             color: '#f97316' },
  deals:                { label: 'Deal Pipeline',         color: '#3b82f6' },
  conflict_approvals:   { label: 'Conflicts / COI',        color: '#ef4444' },
  engagements:          { label: 'Реестр договоров',       color: '#22c55e' },
};

const AUDIT_ACTION_LABELS = {
  created:        { label: 'Создано',      color: '#22c55e' },
  updated:        { label: 'Изменено',     color: '#94a3b8' },
  deleted:        { label: 'Удалено',      color: '#ef4444' },
  approved:       { label: 'Подтверждено', color: '#14b8a6' },
  paid:           { label: 'Закрыто',      color: '#22c55e' },
  archived:       { label: 'В архив',      color: '#94a3b8' },
  restored:       { label: 'Из архива',    color: '#8b5cf6' },
  stage_changed:  { label: 'Смена стадии', color: '#3b82f6' },
  status_changed: { label: 'Смена статуса', color: '#3b82f6' },
  decided:        { label: 'Решение принято', color: '#eab308' },
};

function auditEntityBadge(entityType) {
  const cfg = AUDIT_ENTITY_LABELS[entityType] || { label: entityType, color: '#64748b' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.color}18;color:${cfg.color}">${cfg.label}</span>`;
}
function auditActionBadge(action) {
  const cfg = AUDIT_ACTION_LABELS[action] || { label: action, color: '#64748b' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.color}18;color:${cfg.color}">${cfg.label}</span>`;
}

async function renderAuditLogPage() {
  const el = document.getElementById('auditLogContent');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:32px;color:#4a5568">Загрузка...</div>`;
  try {
    const qs = auditLogEntityFilter ? `?entityType=${encodeURIComponent(auditLogEntityFilter)}` : '';
    const data = await apiFetch('/api/audit-log' + qs);
    auditLogEntries = data.entries;
  } catch (err) {
    el.innerHTML = `<div style="text-align:center;padding:32px;color:#ef4444">⚠️ ${escapeHtml(err.message)}</div>`;
    return;
  }
  renderAuditLogTable();
}

function renderAuditLogTable() {
  const el = document.getElementById('auditLogContent');
  if (!el) return;

  el.innerHTML = `
    <!-- Toolbar -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px">
      <select onchange="auditLogEntityFilter=this.value;renderAuditLogPage()"
        style="background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px">
        <option value="">Все модули</option>
        ${Object.entries(AUDIT_ENTITY_LABELS).map(([key, cfg]) =>
          `<option value="${key}" ${auditLogEntityFilter === key ? 'selected' : ''}>${cfg.label}</option>`
        ).join('')}
      </select>
      <button onclick="renderAuditLogPage()"
        style="background:rgba(20,184,166,0.12);border:1px solid rgba(20,184,166,0.3);color:#5eead4;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-rotate" style="margin-right:6px"></i>Обновить
      </button>
    </div>

    <!-- Event Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-history" style="color:#0ea5e9;margin-right:6px"></i>Журнал событий</span>
        <span style="font-size:12px;color:#8abfbb">${auditLogEntries.length} записей · последние ${auditLogEntries.length >= 200 ? '200' : auditLogEntries.length}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Модуль</th>
              <th>Действие</th>
              <th>Кто</th>
              <th>Что произошло</th>
            </tr>
          </thead>
          <tbody>
            ${auditLogEntries.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:32px;color:#4a5568">Событий не найдено</td></tr>` :
              auditLogEntries.map(e => `
                <tr>
                  <td style="font-size:11px;color:#94a3b8;white-space:nowrap">${escapeHtml(e.createdAt)}</td>
                  <td>${auditEntityBadge(e.entityType)}</td>
                  <td>${auditActionBadge(e.action)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(e.actorEmail)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(e.summary)}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
