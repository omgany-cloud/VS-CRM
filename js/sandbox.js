// ============================================================
//  sandbox.js — Песочница: проекты до скрининга
//  Backed by /api/sandbox* (server/index.js, server/sandboxMapping.js).
//  A sandbox item is a raw project/company/asset that MIGHT deserve a
//  Скрининг slot: it has its own status, a goal, a link to the folder
//  with everything known so far, and a task list. Accepting it (CEO by
//  default — the screeningAccept permission) creates a real Deal at
//  Скрининг; the sandbox row then stays as read-only history.
//  The server never opens the folder link — it is only a link for staff.
// ============================================================

let sandboxProjects = [];
let sandboxPeople = [];
let sandboxLocalFilesEnabled = null;  // null = not fetched yet; boolean once known (GET /api/sandbox/config)
let sandboxSearch = '';
let sandboxStatusFilter = 'active';   // 'active' | 'all' | 'archive' | a single status
let sandboxDetail = null;             // { project, tasks, history } of the open project
let _sandboxBusy = false;             // one in-flight save/accept at a time (double-click guard)

const SBX_STATUS_COLORS = {
  'Новый': '#06b6d4', 'В проработке': '#8b5cf6', 'Ждём информацию': '#eab308',
  'Отложен': '#64748b', 'Отказ': '#ef4444', 'Передан в скрининг': '#22c55e',
};
const SBX_EDITABLE_STATUSES = ['Новый', 'В проработке', 'Ждём информацию', 'Отложен', 'Отказ'];
const SBX_REASON_STATUSES = ['Отказ', 'Отложен'];
const SBX_PRIORITY_COLORS = { 'Высокий': '#ef4444', 'Средний': '#f97316', 'Низкий': '#64748b' };
const SBX_TASK_STATUSES = ['К выполнению', 'В работе', 'Готово', 'Отменена'];
const SBX_DEAL_SECTORS = ['Технологии', 'Финансы', 'Здравоохранение', 'Энергетика', 'Недвижимость', 'Промышленность', 'АПК', 'Ритейл'];
const SBX_DEAL_TYPES = ['Equity', 'Convertible Note', 'SAFE', 'Debt', 'Mezzanine'];

const SBX_INPUT = 'background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;width:100%;box-sizing:border-box';
const SBX_LABEL = 'display:block;font-size:11px;font-weight:600;color:#8abfbb;margin-bottom:4px';

// Matches server/sandboxMapping.js's SANDBOX_ANALYZABLE_MIME_TYPES — kept
// as a separate client-side copy purely to decide which attached files get
// a selection checkbox; the server is the one that actually enforces it.
const SBX_ANALYZABLE_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);
// Matches server/sandboxMapping.js's SANDBOX_ANALYZE_MAX_FILES — display only.
const SANDBOX_ANALYZE_MAX_FILES = 5;
const SBX_AI_ACTION_LABELS = {
  consider_screening: { label: 'Рассмотреть для скрининга', color: '#22c55e' },
  request_information: { label: 'Запросить дополнительную информацию', color: '#eab308' },
  do_not_proceed: { label: 'Не продолжать', color: '#ef4444' },
};
const SBX_AI_SEVERITY_LABELS = { low: { label: 'низкий', color: '#64748b' }, medium: { label: 'средний', color: '#f97316' }, high: { label: 'высокий', color: '#ef4444' } };
const _sandboxRunCache = {};   // runId -> full run detail, fetched once per open modal session

function sbxFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ';
  return (bytes / 1024 / 1024).toFixed(1) + ' МБ';
}

const sbxToday = () => new Date().toISOString().slice(0, 10);
// The server already validates folder links; this only guards rendering
// (a legacy/foreign value must never become a live non-http href).
const sbxSafeLink = url => (/^https?:\/\//i.test(url || '') ? url : '');
const sbxFundName = id => {
  const f = (typeof funds !== 'undefined' ? funds : []).find(x => x.id === id);
  return f ? f.name : '';
};

function sbxStatusBadge(status) {
  const c = SBX_STATUS_COLORS[status] || '#64748b';
  return `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:6px;background:${c}22;color:${c};border:1px solid ${c}44;white-space:nowrap">${escapeHtml(status)}</span>`;
}

function sbxPersonOptions(selectedEmail, emptyLabel) {
  const opts = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
  let found = false;
  for (const p of sandboxPeople) {
    if (p.email === selectedEmail) found = true;
    opts.push(`<option value="${escapeHtml(p.email)}" ${p.email === selectedEmail ? 'selected' : ''}>${escapeHtml(p.name)}</option>`);
  }
  // Someone no longer in the FM-user list (deactivated, role changed) must
  // still show as the current value instead of silently reading as "nobody".
  if (selectedEmail && !found) opts.push(`<option value="${escapeHtml(selectedEmail)}" selected>${escapeHtml(selectedEmail)}</option>`);
  return opts.join('');
}

function sbxFundOptions(selectedId, emptyLabel) {
  const list = typeof funds !== 'undefined' ? funds : [];
  return [`<option value="">${escapeHtml(emptyLabel)}</option>`]
    .concat(list.map(f => `<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`))
    .join('');
}

/* ───────────────────────── Page: toolbar + list ───────────────────────── */

async function renderSandboxPage() {
  const el = document.getElementById('sandboxContent');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:32px;color:#4a5568">Загрузка...</div>';
  try {
    const archived = sandboxStatusFilter === 'archive';
    const [data, people, config] = await Promise.all([
      apiFetch('/api/sandbox' + (archived ? '?archived=1' : '')),
      sandboxPeople.length ? Promise.resolve(null) : apiFetch('/api/sandbox/people'),
      sandboxLocalFilesEnabled === null ? apiFetch('/api/sandbox/config') : Promise.resolve(null),
    ]);
    sandboxProjects = data.projects;
    if (people) sandboxPeople = people.people;
    if (config) sandboxLocalFilesEnabled = !!config.localFilesEnabled;
  } catch (err) {
    el.innerHTML = `<div style="text-align:center;padding:32px;color:#ef4444">⚠️ ${escapeHtml(err.message)}</div>`;
    return;
  }
  const filterOptions = [
    ['active', 'Активные'], ['all', 'Все'],
    ...SBX_EDITABLE_STATUSES.map(s => [s, s]),
    ['Передан в скрининг', 'Передан в скрининг'], ['archive', 'Архив'],
  ];
  el.innerHTML = `
    <div class="toolbar">
      <div class="search-box">
        <i class="fas fa-search"></i>
        <input type="text" id="sandboxSearchInput" placeholder="Поиск по названию, инициатору, цели..."
          value="${escapeHtml(sandboxSearch)}" oninput="sandboxSetSearch(this.value)" />
      </div>
      <select id="sandboxStatusSelect" onchange="sandboxSetStatusFilter(this.value)">
        ${filterOptions.map(([v, l]) => `<option value="${escapeHtml(v)}" ${sandboxStatusFilter === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
      </select>
      <button class="btn-ghost" onclick="exportSandboxProjects()"><i class="fas fa-file-excel"></i> Экспорт Excel</button>
      <button class="btn-primary" onclick="openSandboxNew()"><i class="fas fa-plus"></i> Новый проект</button>
    </div>
    <div id="sandboxList"></div>`;
  renderSandboxList();
}

function sandboxFiltered() {
  const q = sandboxSearch.trim().toLowerCase();
  return sandboxProjects.filter(p => {
    if (sandboxStatusFilter === 'active' && (p.status === 'Отказ' || p.status === 'Передан в скрининг')) return false;
    if (!['active', 'all', 'archive'].includes(sandboxStatusFilter) && p.status !== sandboxStatusFilter) return false;
    if (q && !`${p.name} ${p.initiator} ${p.goal}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderSandboxList() {
  const el = document.getElementById('sandboxList');
  if (!el) return;
  const rows = sandboxFiltered();

  // "Nothing here yet" and "nothing matches your filter" are different
  // situations and get different messages (and different next steps).
  if (!sandboxProjects.length) {
    el.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#8abfbb">
      <div style="font-size:14px;margin-bottom:6px">${sandboxStatusFilter === 'archive' ? 'Архив пуст' : 'В песочнице пока нет проектов'}</div>
      ${sandboxStatusFilter === 'archive' ? '' : '<div style="font-size:12px;color:#4a5568">Добавьте первый проект — компанию, проект или актив, который стоит рассмотреть.</div>'}
    </div></div>`;
    return;
  }
  if (!rows.length) {
    el.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#8abfbb">
      <div style="font-size:14px;margin-bottom:10px">Ничего не найдено по текущему фильтру</div>
      <button onclick="sandboxResetFilters()" style="background:rgba(20,184,166,0.12);border:1px solid rgba(20,184,166,0.3);color:#5eead4;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">Сбросить фильтр</button>
    </div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-flask" style="color:#a78bfa;margin-right:6px"></i>Проекты</span>
        <span style="font-size:12px;color:#8abfbb">${rows.length} из ${sandboxProjects.length}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Проект</th><th>Статус</th><th>Цель</th><th>Ответственный</th><th>Фонд</th><th>Задачи</th><th>Папка</th><th>Обновлён</th>
          </tr></thead>
          <tbody>${rows.map(sandboxRowHtml).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

function sandboxRowHtml(p) {
  const link = sbxSafeLink(p.folderUrl);
  const tasks = p.openTasks
    ? `${p.openTasks} откр.${p.overdueTasks ? ` <span style="color:#ef4444;font-weight:700">· ${p.overdueTasks} просрочено</span>` : ''}${p.nextDue ? `<div style="font-size:10px;color:#64748b">ближайшая: ${escapeHtml(p.nextDue)}</div>` : ''}`
    : '<span style="color:#4a5568">—</span>';
  return `
    <tr onclick="openSandboxProject(${p.id})" style="cursor:pointer">
      <td><div style="font-weight:700;color:#f1f5f9">${escapeHtml(p.name)}</div>
        ${p.initiator ? `<div style="font-size:11px;color:#64748b">${escapeHtml(p.initiator)}</div>` : ''}</td>
      <td>${sbxStatusBadge(p.status)}</td>
      <td style="font-size:12px;color:#94a3b8;max-width:280px" title="${escapeHtml(p.goal)}">${p.goal ? escapeHtml(p.goal.length > 90 ? p.goal.slice(0, 87) + '…' : p.goal) : '<span style="color:#4a5568">—</span>'}</td>
      <td style="font-size:12px;color:#e2e8f0">${escapeHtml(p.ownerName || '—')}</td>
      <td style="font-size:12px;color:#e2e8f0">${escapeHtml(sbxFundName(p.fundId) || '—')}</td>
      <td style="font-size:12px;color:#e2e8f0">${tasks}</td>
      <td onclick="event.stopPropagation()">${link
        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="Открыть папку" style="color:#5eead4"><i class="fas fa-folder-open"></i></a>`
        : '<span style="color:#4a5568">—</span>'}</td>
      <td style="font-size:11px;color:#94a3b8;white-space:nowrap">${escapeHtml(String(p.updatedAt || '').slice(0, 10))}</td>
    </tr>`;
}

function sandboxSetSearch(v) { sandboxSearch = v; renderSandboxList(); }
function sandboxSetStatusFilter(v) {
  const wasArchive = sandboxStatusFilter === 'archive';
  sandboxStatusFilter = v;
  // Archive is a different server query; everything else filters client-side.
  if ((v === 'archive') !== wasArchive) renderSandboxPage(); else renderSandboxList();
}
function sandboxResetFilters() {
  sandboxSearch = '';
  const wasArchive = sandboxStatusFilter === 'archive';
  sandboxStatusFilter = 'active';
  if (wasArchive) { renderSandboxPage(); return; }
  const input = document.getElementById('sandboxSearchInput');
  if (input) input.value = '';
  const sel = document.getElementById('sandboxStatusSelect');
  if (sel) sel.value = 'active';
  renderSandboxList();
}

/* ───────────────────────── Excel export ───────────────────────── */

// Reuses the shared downloadExcel() helper (js/export.js) — same as every
// other report in this app. Exports the currently filtered/searched list
// (Astra's advice: what's on screen, not a silent superset of it), with a
// second sheet naming the filters actually applied.
function exportSandboxProjects() {
  if (typeof downloadExcel !== 'function') { showToast('❌ Модуль экспорта не загружен', 'red'); return; }
  const rows = sandboxFiltered();
  const header = [
    'ID', 'Название', 'Фонд', 'Инициатор', 'Ответственный', 'Email ответственного',
    'Статус', 'Причина статуса', 'Отложено до', 'Цель проекта', 'Описание',
    'Открытых задач', 'Просроченных задач', 'Ссылка на папку', 'Создан', 'Обновлён',
  ];
  const data = rows.map(p => [
    p.id, p.name, p.fundId != null ? (sbxFundName(p.fundId) || `Фонд #${p.fundId}`) : 'Без фонда',
    p.initiator || '', p.ownerName || '', p.owner || '',
    p.status, p.statusReason || '', p.deferredUntil || '', p.goal || '', p.description || '',
    p.openTasks || 0, p.overdueTasks || 0, p.folderUrl || '',
    String(p.createdAt || '').slice(0, 10), String(p.updatedAt || '').slice(0, 10),
  ]);
  const paramsSheet = [
    ['Параметры экспорта'],
    ['Дата', sbxToday()],
    ['Фильтр статуса', sandboxStatusFilter],
    ['Поиск', sandboxSearch || '(нет)'],
    ['Проектов в выгрузке', rows.length],
  ];
  downloadExcel([
    { name: 'Песочница', data: [header, ...data], colWidths: [6, 26, 18, 20, 20, 26, 16, 26, 12, 34, 40, 10, 10, 34, 12, 12] },
    { name: 'Параметры', data: paramsSheet, colWidths: [20, 30] },
  ], `Sandbox_${sbxToday()}.xlsx`);
}

/* ───────────────────────── Modal shell ───────────────────────── */

function showSandboxModal(html) {
  document.getElementById('sandboxModalContent').innerHTML = html;
  document.getElementById('sandboxOverlay').style.display = 'block';
  document.getElementById('modal-sandbox').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeSandboxModal() {
  document.getElementById('sandboxOverlay').style.display = 'none';
  document.getElementById('modal-sandbox').style.display = 'none';
  document.body.style.overflow = '';
  sandboxDetail = null;
}

function sbxModalHeader(title, subtitleHtml) {
  return `
    <div style="padding:18px 24px;border-bottom:1px solid #1e293b;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;position:sticky;top:0;background:#1c3332;z-index:5">
      <div style="min-width:0">
        <h3 style="font-size:17px;font-weight:800;color:#f1f5f9;margin:0;overflow-wrap:anywhere">${title}</h3>
        ${subtitleHtml ? `<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${subtitleHtml}</div>` : ''}
      </div>
      <button onclick="closeSandboxModal()" aria-label="Закрыть"
        style="background:none;border:none;color:#8abfbb;font-size:20px;cursor:pointer;line-height:1">&times;</button>
    </div>`;
}

const SBX_FIELD_IDS = ['sb_name', 'sb_folder', 'sb_local_path', 'sb_owner', 'sb_fund', 'sb_status', 'sb_reason', 'sb_deferred', 'sb_goal', 'sb_description', 'sb_initiator'];
const SBX_FIELD_MAP = {
  name: 'sb_name', folderUrl: 'sb_folder', localFolderPath: 'sb_local_path', owner: 'sb_owner', fundId: 'sb_fund', status: 'sb_status',
  statusReason: 'sb_reason', deferredUntil: 'sb_deferred', goal: 'sb_goal', description: 'sb_description', initiator: 'sb_initiator',
};

function sbxReportError(err, fieldMap = SBX_FIELD_MAP) {
  if (!err.field || !fieldMap[err.field] || !showFieldError(fieldMap[err.field], err.message)) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

/* ───────────────────────── New project ───────────────────────── */

function openSandboxNew() {
  const fundOptions = sbxFundOptions(typeof activeFundId !== 'undefined' ? activeFundId : null, '— пока не выбран —');
  showSandboxModal(`
    ${sbxModalHeader('Новый проект')}
    <div style="padding:20px 24px">
      <div class="form-grid">
        <div class="form-group full">
          <label>Название *</label>
          <input type="text" id="sb_name" maxlength="200" placeholder="Компания, проект или актив" />
        </div>
        <div class="form-group">
          <label>Инициатор</label>
          <input type="text" id="sb_initiator" maxlength="200" placeholder="Кто предлагает / владелец" />
        </div>
        <div class="form-group">
          <label>Ответственный</label>
          <select id="sb_owner">${sbxPersonOptions('', 'Я (по умолчанию)')}</select>
        </div>
        <div class="form-group">
          <label>Фонд</label>
          <select id="sb_fund">${fundOptions}</select>
        </div>
        <div class="form-group">
          <label>Ссылка на папку с материалами</label>
          <input type="url" id="sb_folder" placeholder="https://drive.google.com/..." />
        </div>
        ${sandboxLocalFilesEnabled ? `
        <div class="form-group">
          <label>Путь к папке на сервере <span style="font-weight:400;color:#64748b">— для ИИ-анализа документов</span></label>
          <input type="text" id="sb_local_path" placeholder="например: Deals/2026/Ромашка" />
        </div>` : ''}
        <div class="form-group full">
          <label>Цель проекта</label>
          <textarea id="sb_goal" rows="2" maxlength="1000" placeholder="Что планируется сделать с проектом в ближайшей перспективе"></textarea>
        </div>
        <div class="form-group full">
          <label>Описание</label>
          <textarea id="sb_description" rows="3" maxlength="5000" placeholder="Что известно о проекте"></textarea>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
        <button class="btn-ghost" onclick="closeSandboxModal()">Отмена</button>
        <button class="btn-primary" onclick="saveSandboxNew()"><i class="fas fa-plus"></i> Добавить</button>
      </div>
    </div>`);
  document.getElementById('sb_name').focus();
}

async function saveSandboxNew() {
  if (_sandboxBusy) return;
  clearFieldErrors(SBX_FIELD_IDS);
  const val = id => document.getElementById(id).value.trim();
  const body = {
    name: val('sb_name'), initiator: val('sb_initiator'), goal: val('sb_goal'),
    description: val('sb_description'), folderUrl: val('sb_folder'),
  };
  if (document.getElementById('sb_local_path')) body.localFolderPath = val('sb_local_path');
  if (val('sb_owner')) body.owner = val('sb_owner');
  if (val('sb_fund')) body.fundId = Number(val('sb_fund'));
  _sandboxBusy = true;
  try {
    const created = await apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify(body) });
    closeSandboxModal();
    showToast('✅ Проект добавлен в песочницу');
    await renderSandboxPage();
    openSandboxProject(created.id);
  } catch (err) {
    sbxReportError(err);
  } finally {
    _sandboxBusy = false;
  }
}

/* ───────────────────────── Project detail ───────────────────────── */

async function openSandboxProject(id) {
  try {
    sandboxDetail = await apiFetch('/api/sandbox/' + id);
  } catch (err) {
    showToast('⚠️ Не удалось открыть проект: ' + err.message, 'red');
    return;
  }
  renderSandboxDetail();
}

async function reloadSandboxDetail() {
  if (!sandboxDetail) return;
  sandboxDetail = await apiFetch('/api/sandbox/' + sandboxDetail.project.id);
  renderSandboxDetail();
}

function sandboxCanAccept() { return currentUserPermission('screeningAccept'); }

function renderSandboxDetail() {
  const { project: p, tasks, history } = sandboxDetail;
  const locked = !!p.promotedDealId;   // accepted into screening: read-only history
  const dis = locked ? 'disabled' : '';
  const link = sbxSafeLink(p.folderUrl);
  const showReason = SBX_REASON_STATUSES.includes(p.status);
  const goalHistoryCount = history.filter(h => h.action === 'goal_changed').length;

  const lockedBanner = locked ? `
    <div style="margin:16px 24px 0;padding:10px 14px;border-radius:8px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#86efac;font-size:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span><i class="fas fa-check-circle"></i> Проект передан в скрининг (сделка №${p.promotedDealId}). Дальнейшая работа ведётся в разделе «Сделки».</span>
      <button onclick="sandboxOpenDeal(${p.promotedDealId})" style="margin-left:auto;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);color:#86efac;padding:5px 12px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">Открыть сделку</button>
    </div>` : '';

  const acceptBtn = locked ? '' : (sandboxCanAccept()
    ? `<button class="btn-primary" onclick="openSandboxAccept()" style="background:#22c55e"><i class="fas fa-arrow-right"></i> Принять в скрининг</button>`
    : `<span style="font-size:11px;color:#64748b" title="Право «Принятие проектов в скрининг» есть у CEO">В скрининг принимает CEO</span>`);

  showSandboxModal(`
    ${sbxModalHeader(escapeHtml(p.name), sbxStatusBadge(p.status) + (p.archived ? '<span style="font-size:10px;color:#94a3b8">· в архиве</span>' : ''))}
    ${lockedBanner}
    <div style="padding:20px 24px">
      <div class="form-grid">
        <div class="form-group full">
          <label>Название *</label>
          <input type="text" id="sb_name" maxlength="200" value="${escapeHtml(p.name)}" ${dis} />
        </div>
        <div class="form-group">
          <label>Инициатор</label>
          <input type="text" id="sb_initiator" maxlength="200" value="${escapeHtml(p.initiator)}" ${dis} />
        </div>
        <div class="form-group">
          <label>Ответственный</label>
          <select id="sb_owner" ${dis}>${sbxPersonOptions(p.owner, '— не назначен —')}</select>
        </div>
        <div class="form-group">
          <label>Фонд</label>
          <select id="sb_fund" ${dis}>${sbxFundOptions(p.fundId, '— пока не выбран —')}</select>
        </div>
        <div class="form-group">
          <label>Ссылка на папку с материалами</label>
          <div style="display:flex;gap:6px">
            <input type="url" id="sb_folder" value="${escapeHtml(p.folderUrl)}" placeholder="https://drive.google.com/..." ${dis} style="flex:1" />
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" title="Открыть папку"
              style="display:flex;align-items:center;padding:0 12px;border-radius:8px;background:rgba(20,184,166,0.12);border:1px solid rgba(20,184,166,0.3);color:#5eead4;text-decoration:none"><i class="fas fa-folder-open"></i></a>` : ''}
            ${!locked && p.folderUrl ? `<button type="button" onclick="sandboxClearField('sb_folder')" title="Очистить ссылку" aria-label="Очистить ссылку"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;width:36px;cursor:pointer;flex-shrink:0"><i class="fas fa-times"></i></button>` : ''}
          </div>
        </div>
        ${sandboxLocalFilesEnabled ? `
        <div class="form-group">
          <label>Путь к папке на сервере <span style="font-weight:400;color:#64748b">— для ИИ-анализа документов</span></label>
          <div style="display:flex;gap:6px">
            <input type="text" id="sb_local_path" value="${escapeHtml(p.localFolderPath)}" placeholder="например: Deals/2026/Ромашка" ${dis} style="flex:1" />
            ${!locked && p.localFolderPath ? `<button type="button" onclick="sandboxClearField('sb_local_path')" title="Очистить путь" aria-label="Очистить путь"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;width:36px;cursor:pointer;flex-shrink:0"><i class="fas fa-times"></i></button>` : ''}
          </div>
        </div>` : ''}
        <div class="form-group full">
          <label>Цель проекта <span style="font-weight:400;color:#64748b">— что планируется сделать в ближайшей перспективе</span></label>
          <div style="background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;white-space:pre-wrap;min-height:18px">${p.goal ? escapeHtml(p.goal) : '<span style="color:#64748b">Цель ещё не задана</span>'}</div>
          <div style="display:flex;gap:14px;align-items:center;margin-top:6px">
            ${locked ? '' : `<button type="button" onclick="openSandboxGoalChange()" style="background:none;border:none;color:#5eead4;cursor:pointer;font-size:11px;padding:0"><i class="fas fa-pen"></i> Изменить цель</button>`}
            ${goalHistoryCount ? `<button type="button" onclick="sandboxToggleGoalHistory()" style="background:none;border:none;color:#8abfbb;cursor:pointer;font-size:11px;padding:0">История целей (${goalHistoryCount})</button>` : ''}
          </div>
          <div id="sb_goal_history" style="display:none;margin-top:8px"></div>
        </div>
        <div class="form-group full">
          <label>Описание</label>
          <textarea id="sb_description" rows="3" maxlength="5000" ${dis}>${escapeHtml(p.description)}</textarea>
        </div>
        <div class="form-group">
          <label>Статус</label>
          <select id="sb_status" onchange="sandboxStatusChanged()" ${dis}>
            ${locked
              ? `<option selected>${escapeHtml(p.status)}</option>`
              : SBX_EDITABLE_STATUSES.map(s => `<option ${p.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" id="sb_deferred_wrap" style="${p.status === 'Отложен' ? '' : 'display:none'}">
          <label>Вернуться к проекту</label>
          <input type="date" id="sb_deferred" value="${escapeHtml(p.deferredUntil)}" ${dis} />
        </div>
        <div class="form-group full" id="sb_reason_wrap" style="${showReason ? '' : 'display:none'}">
          <label>Причина <span style="color:#ef4444">*</span></label>
          <input type="text" id="sb_reason" maxlength="1000" value="${escapeHtml(p.statusReason)}" placeholder="Почему отказ / почему откладываем" ${dis} />
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap">
        <div>${p.archived
          ? `<button class="btn-ghost" onclick="sandboxSetArchived(false)"><i class="fas fa-box-open"></i> Вернуть из архива</button>`
          : `<button class="btn-ghost" onclick="sandboxSetArchived(true)"><i class="fas fa-box-archive"></i> В архив</button>`}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${acceptBtn}
          ${locked ? '' : '<button class="btn-primary" onclick="saveSandboxProject()"><i class="fas fa-save"></i> Сохранить</button>'}
        </div>
      </div>

      <div id="sb_files_area">${sandboxFilesAiHtml(p, sandboxDetail.files || [], sandboxDetail.aiRuns || [], locked)}</div>
      <div id="sb_tasks_area">${sandboxTasksHtml(p, tasks, locked)}${sandboxHistoryHtml(history)}</div>
    </div>`);
}

/* ───────────────────────── Goal (changes with new circumstances) ───────────────────────── */

function sandboxToggleGoalHistory() {
  const el = document.getElementById('sb_goal_history');
  if (!el || !sandboxDetail) return;
  if (el.style.display === 'none') {
    const entries = sandboxDetail.history.filter(h => h.action === 'goal_changed');
    el.innerHTML = entries.map(h => `
      <div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #1e293b;font-size:11px">
        <span style="color:#64748b;white-space:nowrap;flex-shrink:0">${escapeHtml(String(h.createdAt).slice(0, 16))}</span>
        <span style="color:#94a3b8;flex-shrink:0">${escapeHtml(h.actorName)}</span>
        <span style="color:#e2e8f0;overflow-wrap:anywhere">${escapeHtml(h.summary)}</span>
      </div>`).join('');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function openSandboxGoalChange() {
  if (!sandboxDetail) return;
  const p = sandboxDetail.project;
  showSandboxModal(`
    ${sbxModalHeader('Изменить цель', `<span style="font-size:12px;color:#94a3b8">${escapeHtml(p.name)}</span>`)}
    <div style="padding:20px 24px">
      <div class="form-group full">
        <label>Текущая цель</label>
        <div style="background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:9px 12px;color:#94a3b8;font-size:13px;white-space:pre-wrap">${p.goal ? escapeHtml(p.goal) : '— не задана —'}</div>
      </div>
      <div class="form-group full" style="margin-top:12px">
        <label>Новая цель *</label>
        <textarea id="sbg_goal" rows="3" maxlength="1000" placeholder="Что планируется сделать дальше">${escapeHtml(p.goal)}</textarea>
      </div>
      <div class="form-group full" style="margin-top:12px">
        <label>Что изменилось / почему меняем цель ${p.goal ? '<span style="color:#ef4444">*</span>' : ''}</label>
        <textarea id="sbg_reason" rows="2" maxlength="1000" placeholder="Новые обстоятельства, из-за которых меняется цель"></textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
        <button class="btn-ghost" onclick="renderSandboxDetail()">Отмена</button>
        <button class="btn-primary" onclick="saveSandboxGoalChange()"><i class="fas fa-save"></i> Сохранить цель</button>
      </div>
    </div>`);
  document.getElementById('sbg_goal').focus();
}

async function saveSandboxGoalChange() {
  if (_sandboxBusy || !sandboxDetail) return;
  clearFieldErrors(['sbg_goal', 'sbg_reason']);
  const p = sandboxDetail.project;
  const goal = document.getElementById('sbg_goal').value.trim();
  const reason = document.getElementById('sbg_reason').value.trim();
  if (!goal) { showFieldError('sbg_goal', 'Введите цель'); return; }
  _sandboxBusy = true;
  try {
    await apiFetch('/api/sandbox/' + p.id, { method: 'PUT', body: JSON.stringify({ goal, goalChangeReason: reason, version: p.version }) });
    showToast('✅ Цель обновлена');
    await reloadSandboxDetail();
    renderSandboxPageQuiet();
  } catch (err) {
    if (/Version conflict/i.test(err.message)) {
      showToast('⚠️ Проект изменил кто-то другой — показана актуальная версия', 'orange');
      await reloadSandboxDetail().catch(() => {});
    } else if (err.field === 'goalChangeReason') {
      showFieldError('sbg_reason', err.message);
    } else {
      sbxReportError(err, { goal: 'sbg_goal' });
    }
  } finally {
    _sandboxBusy = false;
  }
}

// Task actions refresh only this area, never the form above it — a full
// re-render would silently throw away edits the user typed but hasn't
// saved yet (goal, description, ...). The project's own `version` is left
// as loaded on purpose: refreshing it here would let a later Save skip the
// conflict check against someone else's edit made in between.
async function reloadSandboxTasksArea() {
  if (!sandboxDetail) return;
  const fresh = await apiFetch('/api/sandbox/' + sandboxDetail.project.id);
  sandboxDetail.tasks = fresh.tasks;
  sandboxDetail.history = fresh.history;
  sandboxDetail.project.openTasks = fresh.project.openTasks;
  sandboxDetail.project.overdueTasks = fresh.project.overdueTasks;
  const area = document.getElementById('sb_tasks_area');
  if (area) area.innerHTML = sandboxTasksHtml(sandboxDetail.project, fresh.tasks, !!sandboxDetail.project.promotedDealId) + sandboxHistoryHtml(fresh.history);
}

// Clears one link/path field in place (folderUrl or localFolderPath) —
// doesn't save by itself, same as every other field in this form; the
// user still confirms with "Сохранить", so a clear can be undone by
// closing the modal without saving.
function sandboxClearField(id) {
  const el = document.getElementById(id);
  if (!el || el.disabled) return;
  el.value = '';
  el.focus();
  showToast('Поле очищено — нажмите «Сохранить», чтобы применить', 'orange');
}

function sandboxStatusChanged() {
  const status = document.getElementById('sb_status').value;
  document.getElementById('sb_reason_wrap').style.display = SBX_REASON_STATUSES.includes(status) ? '' : 'none';
  document.getElementById('sb_deferred_wrap').style.display = status === 'Отложен' ? '' : 'none';
}

async function saveSandboxProject() {
  if (_sandboxBusy || !sandboxDetail) return;
  clearFieldErrors(SBX_FIELD_IDS);
  const p = sandboxDetail.project;
  const val = id => document.getElementById(id).value.trim();
  const body = {
    version: p.version,
    name: val('sb_name'), initiator: val('sb_initiator'), owner: val('sb_owner') || null,
    fundId: val('sb_fund') ? Number(val('sb_fund')) : null,
    folderUrl: val('sb_folder'), description: val('sb_description'),
    status: document.getElementById('sb_status').value,
    statusReason: val('sb_reason'), deferredUntil: val('sb_deferred'),
  };   // goal is changed only via openSandboxGoalChange() — see its own required-reason rule
  if (document.getElementById('sb_local_path')) body.localFolderPath = val('sb_local_path');
  _sandboxBusy = true;
  try {
    await apiFetch('/api/sandbox/' + p.id, { method: 'PUT', body: JSON.stringify(body) });
    showToast('✅ Проект сохранён');
    await reloadSandboxDetail();
    renderSandboxPageQuiet();
  } catch (err) {
    if (/Version conflict/i.test(err.message)) {
      showToast('⚠️ Проект изменил кто-то другой — показана актуальная версия, повторите правку', 'orange');
      await reloadSandboxDetail().catch(() => {});
    } else {
      sbxReportError(err);
    }
  } finally {
    _sandboxBusy = false;
  }
}

// Refreshes the list behind the modal without touching the open dialog.
async function renderSandboxPageQuiet() {
  try {
    const data = await apiFetch('/api/sandbox' + (sandboxStatusFilter === 'archive' ? '?archived=1' : ''));
    sandboxProjects = data.projects;
    renderSandboxList();
  } catch (err) { /* the list refreshes on the next page visit anyway */ }
}

async function sandboxSetArchived(archived) {
  if (_sandboxBusy || !sandboxDetail) return;
  const p = sandboxDetail.project;
  if (archived && !confirm(`Отправить проект «${p.name}» в архив?`)) return;
  _sandboxBusy = true;
  try {
    await apiFetch('/api/sandbox/' + p.id, { method: 'PUT', body: JSON.stringify({ archived, version: p.version }) });
    showToast(archived ? '📦 Проект в архиве' : '✅ Проект возвращён из архива');
    closeSandboxModal();
    await renderSandboxPage();
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  } finally {
    _sandboxBusy = false;
  }
}

function sandboxOpenDeal(dealId) {
  closeSandboxModal();
  navigateTo('deals');
  if (typeof deals !== 'undefined' && deals.some(d => d.id === dealId)) openDealDetailModal(dealId);
}

/* ───────────────────────── Tasks ───────────────────────── */

function sandboxTasksHtml(p, tasks, locked) {
  const today = sbxToday();
  const rows = tasks.map(t => {
    const done = t.status === 'Готово' || t.status === 'Отменена';
    const overdue = !done && t.dueDate && t.dueDate < today;
    const pc = SBX_PRIORITY_COLORS[t.priority] || '#64748b';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1e293b;${done ? 'opacity:0.55' : ''}">
        <input type="checkbox" ${t.status === 'Готово' ? 'checked' : ''} ${locked ? 'disabled' : ''}
          onchange="sandboxToggleTask(${t.id}, this.checked)" aria-label="Выполнено" style="width:16px;height:16px;flex-shrink:0" />
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e2e8f0;${t.status === 'Готово' ? 'text-decoration:line-through' : ''};overflow-wrap:anywhere">${escapeHtml(t.title)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;display:flex;gap:10px;flex-wrap:wrap">
            <span>${escapeHtml(t.assigneeName || 'без исполнителя')}</span>
            ${t.dueDate ? `<span style="${overdue ? 'color:#ef4444;font-weight:700' : ''}">до ${escapeHtml(t.dueDate)}${overdue ? ' · просрочена' : ''}</span>` : ''}
            <span style="color:${pc}">● ${escapeHtml(t.priority)}</span>
            ${t.status === 'Отменена' ? '<span>отменена</span>' : ''}
          </div>
        </div>
        ${locked ? '' : `
          <select onchange="sandboxSetTaskStatus(${t.id}, this.value)" aria-label="Статус задачи"
            style="background:#0f1623;border:1px solid #2a4846;border-radius:6px;padding:4px 6px;color:#94a3b8;font-size:11px">
            ${SBX_TASK_STATUSES.map(s => `<option ${t.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
          <button onclick="sandboxDeleteTask(${t.id})" aria-label="Удалить задачу" title="Удалить"
            style="background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-trash"></i></button>`}
      </div>`;
  }).join('');

  const addForm = locked ? '' : `
    <div style="display:grid;grid-template-columns:2fr 1.2fr 1fr 1fr auto;gap:8px;margin-top:12px;align-items:end">
      <div><label style="${SBX_LABEL}">Новая задача</label>
        <input type="text" id="sb_task_title" maxlength="300" placeholder="Что нужно сделать" style="${SBX_INPUT}"
          onkeydown="if(event.key==='Enter'){sandboxAddTask();}" /></div>
      <div><label style="${SBX_LABEL}">Исполнитель</label>
        <select id="sb_task_assignee" style="${SBX_INPUT}">${sbxPersonOptions('', '— не назначен —')}</select></div>
      <div><label style="${SBX_LABEL}">Срок</label>
        <input type="date" id="sb_task_due" style="${SBX_INPUT}" /></div>
      <div><label style="${SBX_LABEL}">Приоритет</label>
        <select id="sb_task_priority" style="${SBX_INPUT}"><option>Высокий</option><option selected>Средний</option><option>Низкий</option></select></div>
      <button class="btn-primary" onclick="sandboxAddTask()" style="height:36px"><i class="fas fa-plus"></i></button>
    </div>`;

  return `
    <div style="margin-top:26px">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:6px"><i class="fas fa-list-check" style="color:#3b82f6;margin-right:6px"></i>Задачи
        <span style="font-weight:400;color:#64748b">· ${p.openTasks} открыто${p.overdueTasks ? `, <span style="color:#ef4444">${p.overdueTasks} просрочено</span>` : ''}</span></div>
      ${tasks.length ? rows : '<div style="font-size:12px;color:#4a5568;padding:10px 0">Задач пока нет</div>'}
      ${addForm}
    </div>`;
}

async function sandboxAddTask() {
  if (_sandboxBusy || !sandboxDetail) return;
  const ids = ['sb_task_title', 'sb_task_assignee', 'sb_task_due'];
  clearFieldErrors(ids);
  const val = id => document.getElementById(id).value.trim();
  const body = {
    title: val('sb_task_title'), assignee: val('sb_task_assignee') || null,
    dueDate: val('sb_task_due') || null, priority: document.getElementById('sb_task_priority').value,
  };
  _sandboxBusy = true;
  try {
    await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/tasks`, { method: 'POST', body: JSON.stringify(body) });
    await reloadSandboxTasksArea();
    renderSandboxPageQuiet();
    const input = document.getElementById('sb_task_title');
    if (input) input.focus();
  } catch (err) {
    sbxReportError(err, { title: 'sb_task_title', assignee: 'sb_task_assignee', dueDate: 'sb_task_due' });
  } finally {
    _sandboxBusy = false;
  }
}

// Task edits are queued rather than dropped while one is in flight: two
// quick clicks on different checkboxes must both land (a silent drop would
// leave the second box ticked in the UI but never saved).
let _sandboxTaskQueue = Promise.resolve();
function sandboxUpdateTask(taskId, patch) {
  _sandboxTaskQueue = _sandboxTaskQueue.then(async () => {
    try {
      await apiFetch('/api/sandbox/tasks/' + taskId, { method: 'PUT', body: JSON.stringify(patch) });
      await reloadSandboxTasksArea();
      renderSandboxPageQuiet();
    } catch (err) {
      showToast('⚠️ ' + err.message, 'red');
      await reloadSandboxTasksArea().catch(() => {});   // put the checkbox/select back to the server's truth
    }
  });
  return _sandboxTaskQueue;
}
function sandboxToggleTask(taskId, checked) { sandboxUpdateTask(taskId, { status: checked ? 'Готово' : 'К выполнению' }); }
function sandboxSetTaskStatus(taskId, status) { sandboxUpdateTask(taskId, { status }); }

async function sandboxDeleteTask(taskId) {
  if (_sandboxBusy) return;
  const t = sandboxDetail.tasks.find(x => x.id === taskId);
  if (!t || !confirm(`Удалить задачу «${t.title}»?`)) return;
  _sandboxBusy = true;
  try {
    await apiFetch('/api/sandbox/tasks/' + taskId, { method: 'DELETE' });
    await reloadSandboxTasksArea();
    renderSandboxPageQuiet();
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  } finally {
    _sandboxBusy = false;
  }
}

/* ───────────────────────── Documents + AI analysis ───────────────────────── */

function sandboxFilesAiHtml(p, files, aiRuns, locked) {
  const canAi = currentUserPermission('aiAssist');
  const analyzableCount = files.filter(f => SBX_ANALYZABLE_MIME.has(f.mimeType)).length;

  const fileRows = files.map(f => {
    const canSelect = SBX_ANALYZABLE_MIME.has(f.mimeType);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #1e293b">
        ${canSelect
          ? `<input type="checkbox" class="sb_ai_file_cb" value="${f.uploadId}" style="width:15px;height:15px;flex-shrink:0" ${locked ? 'disabled' : ''} />`
          : `<span style="width:15px;flex-shrink:0;text-align:center" title="Тип не поддерживается для ИИ-анализа (только PDF/PNG/JPEG/GIF)"><i class="fas fa-ban" style="color:#475569;font-size:10px"></i></span>`}
        <a href="${escapeHtml(resolveDocUrl(f.url))}" target="_blank" rel="noopener noreferrer" style="color:#5eead4;font-size:12px;flex:1;min-width:0;overflow-wrap:anywhere">${escapeHtml(f.name)}</a>
        <span style="font-size:10px;color:#64748b;white-space:nowrap">${sbxFileSize(f.sizeBytes)}</span>
        ${locked ? '' : `<button onclick="sandboxDetachFile(${f.id})" aria-label="Открепить" title="Открепить"
          style="background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-times"></i></button>`}
      </div>`;
  }).join('');

  const uploadBtn = locked ? '' : `<button class="btn-ghost" onclick="sandboxAttachFiles()" style="margin-top:10px"><i class="fas fa-paperclip"></i> Прикрепить файлы</button>`;

  const folderPanel = (!locked && sandboxLocalFilesEnabled && p.localFolderPath) ? `
    <div style="margin-top:14px;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:12px">
      <div style="font-size:11px;font-weight:700;color:#8abfbb;margin-bottom:2px"><i class="fas fa-server" style="color:#38bdf8;margin-right:5px"></i>Папка на сервере</div>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px;overflow-wrap:anywhere">${escapeHtml(p.localFolderPath)}</div>
      <button class="btn-ghost" onclick="sandboxToggleFolderPreview()" style="margin-right:8px"><i class="fas fa-eye"></i> Показать файлы</button>
      <div id="sb_folder_preview" style="display:none;margin-top:8px"></div>
      ${canAi ? `
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:11px;color:#94a3b8;cursor:pointer;margin-top:12px">
          <input type="checkbox" id="sb_folder_ai_consent" style="margin-top:2px;flex-shrink:0" />
          <span>Подтверждаю, что вправе передать документы из этой папки внешнему ИИ-провайдеру для анализа</span>
        </label>
        <button class="btn-primary" onclick="sandboxAnalyzeFolder()" style="margin-top:10px;background:#38bdf8">
          <i class="fas fa-folder-tree"></i> Проанализировать всю папку
        </button>
        <div style="font-size:10px;color:#4a5568;margin-top:6px">Файлы будут импортированы в CRM и добавлены в список выше; для анализа берутся до ${SANDBOX_ANALYZE_MAX_FILES} самых свежих.</div>
      ` : `<div style="font-size:11px;color:#64748b;margin-top:10px"><i class="fas fa-lock" style="margin-right:5px"></i>Нужно право «AI-ассистент»</div>`}
      <div id="sb_folder_ai_result"></div>
    </div>` : '';

  const aiPanel = locked ? '' : `
    <div style="margin-top:14px;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:12px">
      ${canAi ? `
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:11px;color:#94a3b8;cursor:pointer">
          <input type="checkbox" id="sb_ai_consent" style="margin-top:2px;flex-shrink:0" />
          <span>Подтверждаю, что вправе передать выбранные материалы внешнему ИИ-провайдеру для анализа</span>
        </label>
        <button class="btn-primary" onclick="sandboxRunAnalysis()" style="margin-top:10px" ${analyzableCount ? '' : 'disabled'}>
          <i class="fas fa-wand-magic-sparkles"></i> Запустить ИИ-анализ
        </button>
        ${analyzableCount ? '' : '<div style="font-size:11px;color:#64748b;margin-top:6px">Прикрепите PDF или изображение, чтобы запустить анализ</div>'}
      ` : `<div style="font-size:11px;color:#64748b"><i class="fas fa-lock" style="margin-right:5px"></i>Нужно право «AI-ассистент» — обратитесь к CEO / администратору ролей</div>`}
      <div id="sb_ai_result"></div>
    </div>`;

  const runsList = aiRuns.length ? `
    <div style="margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:#8abfbb;margin-bottom:4px">История анализов</div>
      ${aiRuns.map(r => `
        <div onclick="sandboxToggleRun(${r.id})" style="cursor:pointer;display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #1e293b;font-size:11px;align-items:center">
          <i class="fas fa-chevron-right" style="color:#4a5568;font-size:9px"></i>
          <span style="color:#64748b;white-space:nowrap">${escapeHtml(String(r.createdAt).slice(0, 16))}</span>
          <span style="color:#94a3b8">${escapeHtml(r.createdBy)}</span>
          <span style="color:${r.status === 'ok' ? '#5eead4' : '#ef4444'}">${r.status === 'ok' ? 'выполнен' : 'ошибка'}</span>
          ${r.model ? `<span style="color:#64748b">· ${escapeHtml(r.model)}</span>` : ''}
        </div>
        <div id="sb_ai_run_${r.id}" style="display:none"></div>
      `).join('')}
    </div>` : '';

  return `
    <div style="margin-top:26px">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:6px"><i class="fas fa-paperclip" style="color:#22c55e;margin-right:6px"></i>Документы и ИИ-анализ</div>
      ${files.length ? fileRows : '<div style="font-size:12px;color:#4a5568;padding:6px 0">Файлы не прикреплены</div>'}
      ${uploadBtn}
      ${folderPanel}
      ${aiPanel}
      ${runsList}
    </div>`;
}

async function reloadSandboxFilesArea() {
  if (!sandboxDetail) return;
  const fresh = await apiFetch('/api/sandbox/' + sandboxDetail.project.id);
  sandboxDetail.files = fresh.files;
  sandboxDetail.aiRuns = fresh.aiRuns;
  const area = document.getElementById('sb_files_area');
  if (area) area.innerHTML = sandboxFilesAiHtml(fresh.project, fresh.files, fresh.aiRuns, !!fresh.project.promotedDealId);
}

async function sandboxAttachFiles() {
  if (_sandboxBusy || !sandboxDetail) return;
  const files = await pickFiles('.pdf,.png,.jpg,.jpeg,.gif,.doc,.docx,.xls,.xlsx');
  if (!files.length) return;
  _sandboxBusy = true;
  let okCount = 0;
  try {
    for (const file of files) {
      try {
        const uploaded = await uploadFile(file);
        await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/files`, { method: 'POST', body: JSON.stringify({ uploadId: uploaded.id }) });
        okCount++;
      } catch (err) {
        showToast(`⚠️ ${file.name}: ${err.message}`, 'red');
      }
    }
    if (okCount) showToast(`✅ Прикреплено файлов: ${okCount}`);
    await reloadSandboxFilesArea();
  } finally {
    _sandboxBusy = false;
  }
}

async function sandboxDetachFile(fileId) {
  if (_sandboxBusy || !sandboxDetail) return;
  if (!confirm('Открепить файл от проекта? Сам файл останется в хранилище.')) return;
  _sandboxBusy = true;
  try {
    await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/files/${fileId}`, { method: 'DELETE' });
    await reloadSandboxFilesArea();
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  } finally {
    _sandboxBusy = false;
  }
}

/* ───────────────────────── Server folder (whole-folder AI analysis) ───────────────────────── */

async function sandboxToggleFolderPreview() {
  const el = document.getElementById('sb_folder_preview');
  if (!el || !sandboxDetail) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="font-size:11px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Загрузка списка файлов...</div>';
  try {
    const { files, truncated } = await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/local-files`);
    if (!files.length) { el.innerHTML = '<div style="font-size:11px;color:#64748b">Подходящих файлов не найдено (PDF, PNG, JPEG, GIF, Word, Excel)</div>'; return; }
    el.innerHTML = `
      <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">${files.length} файл(ов)${truncated ? ' (показаны первые ' + files.length + ')' : ''}</div>
      ${files.map(f => `
        <div style="display:flex;gap:10px;padding:3px 0;font-size:11px;color:#e2e8f0">
          <span style="flex:1;min-width:0;overflow-wrap:anywhere">${escapeHtml(f.relativePath)}</span>
          <span style="color:#64748b;white-space:nowrap">${sbxFileSize(f.sizeBytes)}</span>
        </div>`).join('')}`;
  } catch (err) {
    el.innerHTML = `<div style="font-size:11px;color:#ef4444">⚠️ ${escapeHtml(err.message)}</div>`;
  }
}

async function sandboxAnalyzeFolder() {
  if (_sandboxBusy || !sandboxDetail) return;
  const consent = document.getElementById('sb_folder_ai_consent');
  if (!consent || !consent.checked) { showToast('⚠️ Подтвердите согласие на передачу материалов ИИ', 'orange'); return; }
  const resultEl = document.getElementById('sb_folder_ai_result');
  _sandboxBusy = true;
  if (resultEl) resultEl.innerHTML = '<div style="font-size:12px;color:#64748b;margin-top:10px"><i class="fas fa-spinner fa-spin"></i> Импортируем файлы и анализируем...</div>';
  try {
    const run = await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/local-files/analyze-folder`, { method: 'POST', body: JSON.stringify({ consent: true }) });
    _sandboxRunCache[run.id] = run;
    showToast('✅ Анализ папки завершён');
    await reloadSandboxFilesArea();
    const area = document.getElementById('sb_folder_ai_result');
    if (area) {
      const fi = run.folderImport;
      const summary = fi ? `<div style="font-size:11px;color:#64748b;margin-top:10px">В папке: ${fi.totalInFolder} · импортировано: ${fi.imported} · в анализ вошло: ${fi.analyzed}${fi.skipped ? ` · не поместилось: ${fi.skipped}` : ''}${fi.errors.length ? ` · ошибок: ${fi.errors.length}` : ''}</div>` : '';
      area.innerHTML = sandboxRunResultHtml(run) + summary;
    }
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<div style="font-size:12px;color:#ef4444;margin-top:10px">⚠️ ${escapeHtml(err.message)}</div>`;
    else showToast('⚠️ ' + err.message, 'red');
  } finally {
    _sandboxBusy = false;
  }
}

async function sandboxRunAnalysis() {
  if (_sandboxBusy || !sandboxDetail) return;
  const consent = document.getElementById('sb_ai_consent');
  if (!consent || !consent.checked) { showToast('⚠️ Подтвердите согласие на передачу материалов ИИ', 'orange'); return; }
  const uploadIds = Array.from(document.querySelectorAll('.sb_ai_file_cb:checked')).map(cb => Number(cb.value));
  if (!uploadIds.length) { showToast('⚠️ Выберите хотя бы один документ (PDF или изображение)', 'orange'); return; }
  const resultEl = document.getElementById('sb_ai_result');
  _sandboxBusy = true;
  if (resultEl) resultEl.innerHTML = '<div style="font-size:12px;color:#64748b;margin-top:10px"><i class="fas fa-spinner fa-spin"></i> Анализируем...</div>';
  try {
    const run = await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds }) });
    _sandboxRunCache[run.id] = run;
    showToast('✅ Анализ завершён');
    await reloadSandboxFilesArea();
    const area = document.getElementById('sb_ai_result');
    if (area) area.innerHTML = sandboxRunResultHtml(run);
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<div style="font-size:12px;color:#ef4444;margin-top:10px">⚠️ ${escapeHtml(err.message)}</div>`;
    else showToast('⚠️ ' + err.message, 'red');
  } finally {
    _sandboxBusy = false;
  }
}

async function sandboxToggleRun(runId) {
  const el = document.getElementById('sb_ai_run_' + runId);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  if (!_sandboxRunCache[runId]) {
    el.innerHTML = '<div style="font-size:11px;color:#64748b;padding:8px 0"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
    try {
      _sandboxRunCache[runId] = await apiFetch('/api/sandbox/runs/' + runId);
    } catch (err) {
      el.innerHTML = `<div style="font-size:11px;color:#ef4444;padding:8px 0">⚠️ ${escapeHtml(err.message)}</div>`;
      return;
    }
  }
  el.innerHTML = sandboxRunResultHtml(_sandboxRunCache[runId]);
}

function sandboxRunResultHtml(run) {
  if (run.status !== 'ok' || !run.result) {
    return `<div id="sb_ai_panel_${run.id}" style="font-size:12px;color:#ef4444;margin-top:10px;padding:8px 0">⚠️ ${escapeHtml(run.errorMessage || 'Анализ не удался')}</div>`;
  }
  const r = run.result;
  const action = SBX_AI_ACTION_LABELS[r.recommendation.action] || { label: r.recommendation.action, color: '#64748b' };
  return `
    <div id="sb_ai_panel_${run.id}" style="margin-top:12px;padding-top:12px;border-top:1px solid #2a4846">
      <div style="font-size:11px;font-weight:700;color:#8abfbb;text-transform:uppercase;margin-bottom:6px">Резюме</div>
      <div style="font-size:12px;color:#e2e8f0;white-space:pre-wrap;margin-bottom:12px">${escapeHtml(r.summary)}</div>

      <div style="display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;background:${action.color}22;color:${action.color};border:1px solid ${action.color}44;margin-bottom:6px">
        ${escapeHtml(action.label)}
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:12px">${escapeHtml(r.recommendation.rationale)}</div>

      ${r.risks.length ? `
        <div style="font-size:11px;font-weight:700;color:#8abfbb;text-transform:uppercase;margin-bottom:6px">Риски</div>
        ${r.risks.map(risk => {
          const sev = SBX_AI_SEVERITY_LABELS[risk.severity] || { label: risk.severity, color: '#64748b' };
          return `<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px">
            <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;background:${sev.color}22;color:${sev.color};white-space:nowrap;margin-top:1px">${escapeHtml(sev.label)}</span>
            <span style="font-size:12px;color:#e2e8f0">${escapeHtml(risk.text)}</span>
          </div>`;
        }).join('')}` : ''}

      ${r.missingInfo.length ? `
        <div style="font-size:11px;font-weight:700;color:#8abfbb;text-transform:uppercase;margin:10px 0 6px">Не хватает информации</div>
        <ul style="margin:0 0 10px 18px;padding:0">${r.missingInfo.map(m => `<li style="font-size:12px;color:#e2e8f0;margin-bottom:3px">${escapeHtml(m)}</li>`).join('')}</ul>` : ''}

      ${r.suggestedTasks.length ? `
        <div style="font-size:11px;font-weight:700;color:#8abfbb;text-transform:uppercase;margin:10px 0 6px">Предлагаемые задачи</div>
        ${r.suggestedTasks.map(t => `
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#e2e8f0;margin-bottom:5px;cursor:pointer">
            <input type="checkbox" class="sb_ai_task_cb" data-title="${escapeAttr(t.title)}" data-priority="${escapeAttr(t.priority)}" checked style="width:14px;height:14px;flex-shrink:0" />
            ${escapeHtml(t.title)} <span style="color:${SBX_PRIORITY_COLORS[t.priority] || '#64748b'};font-size:10px">● ${escapeHtml(t.priority)}</span>
          </label>`).join('')}
        <button class="btn-ghost" onclick="sandboxCreateTasksFromRun(${run.id})" style="margin-top:4px"><i class="fas fa-list-check"></i> Создать выбранные задачи</button>` : ''}

      <div style="font-size:10px;color:#4a5568;margin-top:12px">Провайдер: ${escapeHtml(run.provider || '—')} · Модель: ${escapeHtml(run.model || '—')} · ${escapeHtml(String(run.createdAt).slice(0, 16))}</div>
    </div>`;
}

async function sandboxCreateTasksFromRun(runId) {
  if (_sandboxBusy || !sandboxDetail) return;
  const panel = document.getElementById('sb_ai_panel_' + runId);
  if (!panel) return;
  const checked = Array.from(panel.querySelectorAll('.sb_ai_task_cb:checked'));
  if (!checked.length) { showToast('⚠️ Выберите хотя бы одну задачу', 'orange'); return; }
  _sandboxBusy = true;
  let okCount = 0;
  try {
    for (const cb of checked) {
      try {
        await apiFetch(`/api/sandbox/${sandboxDetail.project.id}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ title: cb.dataset.title, priority: cb.dataset.priority, sourceAiRunId: runId }),
        });
        okCount++;
        cb.closest('label').style.opacity = '0.5';
        cb.disabled = true;
      } catch (err) {
        showToast(`⚠️ ${cb.dataset.title}: ${err.message}`, 'red');
      }
    }
    if (okCount) showToast(`✅ Создано задач: ${okCount}`);
    await reloadSandboxTasksArea();
  } finally {
    _sandboxBusy = false;
  }
}

/* ───────────────────────── History ───────────────────────── */

function sandboxHistoryHtml(history) {
  const rows = history.map(h => `
    <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #1e293b;font-size:12px">
      <span style="color:#64748b;white-space:nowrap;flex-shrink:0">${escapeHtml(String(h.createdAt).slice(0, 16))}</span>
      <span style="color:#94a3b8;flex-shrink:0">${escapeHtml(h.actorName)}</span>
      <span style="color:#e2e8f0;overflow-wrap:anywhere">${escapeHtml(h.summary)}</span>
    </div>`).join('');
  return `
    <div style="margin-top:26px">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:6px"><i class="fas fa-history" style="color:#0ea5e9;margin-right:6px"></i>История</div>
      ${rows || '<div style="font-size:12px;color:#4a5568">Пока пусто</div>'}
    </div>`;
}

/* ───────────────────────── Accept into Скрининг ───────────────────────── */

const SBX_ACCEPT_FIELDS = ['sba_fund', 'sba_amount', 'sba_sector', 'sba_type', 'sba_priority'];

function openSandboxAccept() {
  if (!sandboxDetail) return;
  const p = sandboxDetail.project;
  if (p.status === 'Отказ') { showToast('Проект отклонён — сначала верните его в работу', 'orange'); return; }
  const fundId = p.fundId != null ? p.fundId : (typeof activeFundId !== 'undefined' ? activeFundId : null);
  showSandboxModal(`
    ${sbxModalHeader('Принять в скрининг', `<span style="font-size:12px;color:#94a3b8">${escapeHtml(p.name)}</span>`)}
    <div style="padding:20px 24px">
      <p style="font-size:12px;color:#94a3b8;margin:0 0 14px">
        Будет создана сделка на стадии «Скрининг». Название, описание и ссылка на папку (как data room) перейдут в сделку;
        сумму и остальное можно уточнить позже. Проект в песочнице станет архивной записью.</p>
      <div class="form-grid">
        <div class="form-group full">
          <label>Фонд *</label>
          <select id="sba_fund">${sbxFundOptions(fundId, '— выберите фонд —')}</select>
        </div>
        <div class="form-group">
          <label>Сектор</label>
          <select id="sba_sector"><option value="">— не указан —</option>${SBX_DEAL_SECTORS.map(s => `<option>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label>Сумма инвестиций (M)</label>
          <input type="number" id="sba_amount" min="0" step="any" placeholder="пока неизвестна — оставьте пустым" />
        </div>
        <div class="form-group">
          <label>Тип сделки</label>
          <select id="sba_type">${SBX_DEAL_TYPES.map(s => `<option>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group">
          <label>Приоритет</label>
          <select id="sba_priority"><option>Высокий</option><option selected>Средний</option><option>Низкий</option></select>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
        <button class="btn-ghost" onclick="renderSandboxDetail()">Назад</button>
        <button class="btn-primary" onclick="confirmSandboxAccept()" style="background:#22c55e"><i class="fas fa-arrow-right"></i> Принять в скрининг</button>
      </div>
    </div>`);
}

async function confirmSandboxAccept() {
  if (_sandboxBusy || !sandboxDetail) return;
  clearFieldErrors(SBX_ACCEPT_FIELDS);
  const val = id => document.getElementById(id).value.trim();
  const body = { fundId: val('sba_fund') ? Number(val('sba_fund')) : null, type: val('sba_type'), priority: val('sba_priority') };
  if (val('sba_sector')) body.sector = val('sba_sector');
  if (val('sba_amount') !== '') body.amount = Number(val('sba_amount'));
  const project = sandboxDetail.project;
  _sandboxBusy = true;
  try {
    const out = await apiFetch(`/api/sandbox/${project.id}/promote`, { method: 'POST', body: JSON.stringify(body) });
    // Keep the Pipeline's in-memory list in step so the new deal shows up
    // without a page reload.
    if (typeof deals !== 'undefined' && out.deal && !deals.some(d => d.id === out.deal.id)) {
      deals.push(out.deal);
      if (typeof renderPipeline === 'function') renderPipeline(deals);
      if (typeof updateBadges === 'function') updateBadges();
    }
    showToast(out.alreadyPromoted ? 'Проект уже был принят в скрининг' : '✅ Проект принят в скрининг — сделка создана');
    await reloadSandboxDetail();
    renderSandboxPageQuiet();
  } catch (err) {
    sbxReportError(err, { fundId: 'sba_fund', amount: 'sba_amount', priority: 'sba_priority' });
  } finally {
    _sandboxBusy = false;
  }
}
