// ============================================================
//  modules.js — 5 модулей CRM
//  1. KYC Renewal Tracker
//  2. Distribution Waterfall
//  3. Compliance Calendar
//  4. IC Module (Investment Committee)
//  5. LP Reports (individual statements)
// ============================================================

/* ═══════════════════════════════════════════════════════════
   MODULE 1 — KYC RENEWAL TRACKER
   AFSA требует ежегодного обновления KYC для всех LP и CF&A
═══════════════════════════════════════════════════════════ */

const KYC_RENEWAL_MONTHS = 12; // обновление каждые 12 месяцев
const KYC_WARN_DAYS      = 60; // предупреждать за 60 дней

function getKycRenewalStatus(dateStr) {
  if (!dateStr) return { status: 'never', label: 'Никогда не проводился', color: '#ef4444', daysLeft: null };
  const kycDate  = new Date(dateStr);
  const renewDue = new Date(kycDate);
  renewDue.setMonth(renewDue.getMonth() + KYC_RENEWAL_MONTHS);
  const today    = new Date();
  const daysLeft = Math.ceil((renewDue - today) / 86400000);
  if (daysLeft < 0)   return { status: 'overdue',  label: `Просрочено ${Math.abs(daysLeft)}д`, color: '#ef4444', daysLeft, renewDue };
  if (daysLeft <= KYC_WARN_DAYS) return { status: 'warning', label: `${daysLeft}д до обновления`, color: '#f97316', daysLeft, renewDue };
  return { status: 'ok', label: `${daysLeft}д до обновления`, color: '#22c55e', daysLeft, renewDue };
}

function renderKycRenewalPage() {
  const el = document.getElementById('kycRenewalContent');
  if (!el) return;

  // Combine LP + CF&A clients
  const lpItems = lpRegister.map(lp => ({
    id: 'lp_' + lp.id, name: lp.name, type: lp.type,
    category: 'LP', kycDate: lp.kycDate || null,
    kycStatus: lp.kycStatus || '—', rm: lp.rm,
    rawId: lp.id,
  }));
  const cfaItems = (typeof obClients !== 'undefined' ? obClients.filter(c => c.direction === 'CF&A') : []).map(c => ({
    id: 'cfa_' + c.id, name: c.name, type: c.type,
    category: 'CF&A', kycDate: c.startDate || null,
    kycStatus: c.activated ? 'Одобрен' : 'На проверке', rm: c.rm,
    rawId: c.id,
  }));
  const all = [...lpItems, ...cfaItems].map(item => ({
    ...item, renewal: getKycRenewalStatus(item.kycDate)
  })).sort((a,b) => (a.renewal.daysLeft??9999) - (b.renewal.daysLeft??9999));

  const overdue = all.filter(x => x.renewal.status === 'overdue').length;
  const warning = all.filter(x => x.renewal.status === 'warning').length;
  const ok      = all.filter(x => x.renewal.status === 'ok').length;
  const never   = all.filter(x => x.renewal.status === 'never').length;

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fas fa-exclamation-triangle"></i></div>
        <div class="kpi-body"><span class="kpi-label">Просрочено</span>
          <span class="kpi-value" style="color:${overdue>0?'#ef4444':'#22c55e'}">${overdue}</span>
          <span class="kpi-delta ${overdue>0?'down':'up'}">${overdue>0?'Срочно!':'Нет'}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon orange"><i class="fas fa-clock"></i></div>
        <div class="kpi-body"><span class="kpi-label">Скоро (≤60 дней)</span>
          <span class="kpi-value" style="color:${warning>0?'#f97316':'#22c55e'}">${warning}</span>
          <span class="kpi-delta">${warning} клиентов</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green"><i class="fas fa-check-circle"></i></div>
        <div class="kpi-body"><span class="kpi-label">Актуально</span>
          <span class="kpi-value">${ok}</span>
          <span class="kpi-delta up">KYC в норме</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fas fa-ban"></i></div>
        <div class="kpi-body"><span class="kpi-label">Не проводился</span>
          <span class="kpi-value" style="color:${never>0?'#ef4444':'#22c55e'}">${never}</span>
          <span class="kpi-delta ${never>0?'down':'up'}">${never>0?'Требуется':'Нет'}</span></div>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-sync-alt" style="color:#8b5cf6;margin-right:6px"></i>KYC Renewal Schedule</span>
        <span style="font-size:11px;color:#8a9bbf">Обновление каждые 12 месяцев · AFSA AML Rules</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Клиент / LP</th><th>Тип</th><th>Категория</th>
            <th>KYC Статус</th><th>Дата KYC</th><th>Дата обновления</th>
            <th>Статус</th><th>RM</th><th></th>
          </tr></thead>
          <tbody>
            ${all.map(item => `
              <tr>
                <td style="font-weight:700;color:var(--text-primary)">${item.name}</td>
                <td style="font-size:12px">${item.type}</td>
                <td><span class="task-type-badge">${item.category}</span></td>
                <td style="font-size:12px;color:${item.kycStatus==='Одобрен'?'#22c55e':'#f97316'};font-weight:700">${item.kycStatus}</td>
                <td style="font-size:12px;color:#8a9bbf">${item.kycDate ? new Date(item.kycDate).toLocaleDateString('ru-RU') : '—'}</td>
                <td style="font-size:12px;color:${item.renewal.color};font-weight:600">
                  ${item.renewal.renewDue ? new Date(item.renewal.renewDue).toLocaleDateString('ru-RU') : '—'}
                </td>
                <td>
                  <span style="background:${item.renewal.color}22;color:${item.renewal.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap">
                    ${item.renewal.status==='overdue'?'⚠️ ':item.renewal.status==='warning'?'⏰ ':'✅ '}${item.renewal.label}
                  </span>
                </td>
                <td style="font-size:11px;color:#8a9bbf">${(item.rm||'').split(' ')[0]}</td>
                <td>
                  <button onclick="startKycRenewal('${item.id}','${item.name.replace(/'/g,"\\'")}')"
                    style="background:rgba(139,92,246,0.12);border:1px solid #8b5cf6;color:#a78bfa;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;white-space:nowrap">
                    <i class="fas fa-redo"></i> Обновить KYC
                  </button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function startKycRenewal(id, name) {
  const isLP  = id.startsWith('lp_');
  const rawId = parseInt(id.split('_')[1]);
  const type  = isLP ? 'kyc_lp' : 'kyc_cfa';
  const etype = isLP ? 'LP' : 'CF&A';
  if (confirm(`Запустить KYC Renewal для "${name}"?\n\nБудет создан новый Approval Workflow CO→MLRO→CEO.`)) {
    navigateTo('workflow');
    setTimeout(() => startWorkflow(type, rawId, name, etype), 200);
  }
}


/* ═══════════════════════════════════════════════════════════
   MODULE 2 — COMPLIANCE CALENDAR
   AFSA deadlines + KYC renewals + Capital Calls + Tasks
═══════════════════════════════════════════════════════════ */

function buildCalendarEvents() {
  const events = [];
  const today  = new Date();

  // AFSA Reporting deadlines — afsaReports (server-backed, see
  // js/api-auth.js's loadAfsaReportsFromApi()), not the old js/data.js
  // reportSchedule static array (no backend, status could never change).
  // Clickable: the actual "mark submitted" action lives in the AFSA
  // reports table on this same page (renderAfsaReportsTable() below), so
  // this just gets you to the page — same "navigate, don't auto-act"
  // convention as the other categories.
  (typeof afsaReports !== 'undefined' ? afsaReports : []).forEach(r => {
    events.push({
      date: r.deadline, label: `Отчёт ${r.period} (${r.reportType})`,
      category: 'afsa', status: r.status, resp: r.resp,
      color: r.status === 'Отправлен' ? '#22c55e' : r.status === 'В процессе' ? '#f97316' : '#3b82f6',
      action: () => navigateTo('calendar'),
    });
  });

  // Capital Call dates — capitalCallsLog (server-backed, same data the LP
  // Register / Capital Calls page and the Согласования board use), not the
  // old js/data.js mock `capitalCalls` array this used to read (frozen,
  // disconnected demo rows unrelated to any real capital call). Clickable:
  // takes you to the actual call detail, same as the Согласования board.
  (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : []).forEach(cc => {
    events.push({
      date: cc.noticeDate, label: `Capital Call ${cc.ccNumber || ''} — ${cc.purpose || 'Notice'}`,
      category: 'capital', status: cc.status, resp: 'CFO',
      color: cc.status === 'Completed' || cc.status === 'Завершён' ? '#22c55e' : '#f97316',
      action: () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); },
    });
  });

  // KYC Renewals due — same LP + CF&A merge as renderKycRenewalPage()
  // (Module 1 above), so a CF&A client's renewal deadline shows up here
  // too, not just LP renewals. Clickable: goes to the KYC Renewal page,
  // where that same LP/client's own row has the "Обновить KYC" button —
  // the calendar doesn't launch the renewal workflow itself, it just gets
  // you to where you would.
  const kycLpItems  = lpRegister.map(lp => ({ name: lp.name, kycDate: lp.kycDate || null }));
  const kycCfaItems = (typeof obClients !== 'undefined' ? obClients.filter(c => c.direction === 'CF&A') : [])
    .map(c => ({ name: c.name, kycDate: c.startDate || null }));
  [...kycLpItems, ...kycCfaItems].forEach(item => {
    const r = getKycRenewalStatus(item.kycDate);
    if (r.renewDue) events.push({
      date: r.renewDue.toISOString().split('T')[0],
      label: `KYC Renewal: ${item.name}`,
      category: 'kyc', status: r.status === 'ok' ? 'Актуально' : r.status === 'warning' ? 'Скоро' : 'Просрочено',
      resp: 'CO', color: r.color,
      action: () => navigateTo('kycrenewal'),
    });
  });

  return events.sort((a,b) => new Date(a.date) - new Date(b.date));
}

const CAL_CATEGORIES = {
  afsa:    { label: 'AFSA Отчётность', icon: 'fa-landmark',      color: '#3b82f6'  },
  capital: { label: 'Capital Calls',   icon: 'fa-coins',          color: '#22c55e'  },
  kyc:     { label: 'KYC Renewal',     icon: 'fa-shield-alt',     color: '#8b5cf6'  },
};

// Rows are dispatched by index into this array (not a serialized closure
// in the onclick attribute) so each event's `action` — a real function
// closing over its own cc/item reference from buildCalendarEvents()'s
// loops — stays callable. Same pattern as js/workflow.js's
// _pendingApprovalItems/runPendingApprovalAction.
let _calendarEvents = [];

function runCalendarEventAction(idx) {
  const evt = _calendarEvents[idx];
  if (evt && evt.action) evt.action();
}

function renderComplianceCalendar() {
  const el = document.getElementById('calendarContent');
  if (!el) return;
  const events  = buildCalendarEvents();
  _calendarEvents = events;
  const today   = new Date();
  const upcoming = events.filter(e => {
    const d = new Date(e.date);
    return d >= today && d <= new Date(today.getTime() + 90*86400000);
  });
  const overdue = events.filter(e => new Date(e.date) < today && e.status !== 'Отправлен' && e.status !== 'Завершён');

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:20px">
      ${[
        ['fa-exclamation-triangle','red',  'Просрочено',   overdue.length,  overdue.length>0?'#ef4444':'#22c55e'],
        ['fa-calendar-week',       'blue', 'Ближайшие 30д',upcoming.filter(e=>new Date(e.date)<=new Date(today.getTime()+30*86400000)).length, '#3b82f6'],
        ['fa-calendar',            'purple','Ближайшие 90д',upcoming.length, '#8b5cf6'],
        ['fa-list',                'green', 'Всего событий', events.length,  '#22c55e'],
      ].map(([icon,color,label,val,vc]) => `
        <div class="kpi-card">
          <div class="kpi-icon ${color}"><i class="fas ${icon}"></i></div>
          <div class="kpi-body"><span class="kpi-label">${label}</span>
            <span class="kpi-value" style="color:${vc}">${val}</span></div>
        </div>`).join('')}
    </div>

    <!-- AFSA report obligations — the actual "mark submitted" action -->
    ${renderAfsaReportsTable()}

    <!-- Overdue -->
    ${overdue.length ? `
    <div class="card" style="margin-bottom:16px;border-color:rgba(239,68,68,0.3)">
      <div class="card-header">
        <span class="card-title" style="color:#ef4444"><i class="fas fa-fire" style="margin-right:6px"></i>Просроченные события</span>
      </div>
      ${overdue.map(e => renderCalEvent(e, true)).join('')}
    </div>` : ''}

    <!-- Upcoming grouped by month -->
    ${renderCalendarByMonth(upcoming)}

    <!-- Legend -->
    <div style="display:flex;gap:16px;flex-wrap:wrap;padding:16px 0;border-top:1px solid var(--border);margin-top:8px">
      ${Object.entries(CAL_CATEGORIES).map(([k,v]) => `
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8">
          <i class="fas ${v.icon}" style="color:${v.color}"></i> ${v.label}
        </div>`).join('')}
    </div>`;
}

function renderAfsaReportsTable() {
  const reports = (typeof afsaReports !== 'undefined' ? afsaReports : []).slice().sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  if (!reports.length) return '';
  const statusMap = { 'Отправлен': 'badge-green', 'В процессе': 'badge-orange', 'Ожидается': 'badge-gray' };
  const canSubmit = typeof currentUserPermission === 'function' && currentUserPermission('afsaSubmit');
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-landmark" style="color:#3b82f6;margin-right:6px"></i>Отчётность AFSA</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Период</th><th>Тип</th><th>Дедлайн</th><th>Статус</th><th>Ответственный</th><th>Действие</th></tr></thead>
          <tbody>
            ${reports.map(r => `
              <tr>
                <td>${r.period}</td>
                <td style="font-size:12px;color:#8a9bbf">${r.reportType}</td>
                <td>${formatDate(r.deadline)}</td>
                <td><span class="badge ${statusMap[r.status] || 'badge-gray'}">${r.status}</span></td>
                <td style="font-size:12px;color:#8a9bbf">${r.resp || '—'}</td>
                <td>${
                  r.status === 'Отправлен'
                    ? (r.documentUrl
                        ? `<a href="#" onclick="event.preventDefault();window.open(resolveDocUrl('${r.documentUrl}'),'_blank')" style="font-size:11px;color:#60a5fa">Открыть файл</a>`
                        : `<span style="font-size:11px;color:#64748b">${r.submittedAt || ''}</span>`)
                    : (canSubmit
                        ? `<button onclick="submitAfsaReport(${r.id})" class="btn-ghost" style="font-size:11px;padding:4px 10px"><i class="fas fa-paperclip"></i> Загрузить и отметить</button>`
                        : '<span style="font-size:11px;color:#64748b">—</span>')
                }</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// Requires both the file (the actual filed report — evidence, same
// reasoning as Capital Call payment confirmation's wireConfirmUrl) and
// the afsaSubmit permission; the server re-checks both independently.
async function submitAfsaReport(id) {
  const rep = afsaReports.find(r => r.id === id);
  if (!rep) return;
  const file = await pickFile();
  if (!file) return;
  try {
    const uploaded = await uploadFile(file);
    const updated = await apiFetch(`/api/afsa-reports/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Отправлен', documentUrl: uploaded.url }) });
    Object.assign(rep, updated);
    showToast(`✅ Отчёт «${rep.period} (${rep.reportType})» отмечен отправленным`, 'green');
    renderComplianceCalendar();
  } catch (err) {
    showToast('⚠️ Не удалось отметить отчёт отправленным: ' + err.message, 'red');
  }
}

function renderCalendarByMonth(events) {
  if (!events.length) return '<div class="card"><div style="padding:30px;text-align:center;color:#8a9bbf">Нет предстоящих событий</div></div>';
  const byMonth = {};
  events.forEach(e => {
    const m = e.date.slice(0,7);
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(e);
  });
  return Object.entries(byMonth).map(([month, evts]) => {
    const d = new Date(month + '-01');
    const label = d.toLocaleDateString('ru-RU', { month:'long', year:'numeric' });
    return `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-calendar-alt" style="color:#3b82f6;margin-right:6px"></i>${label}</span>
          <span style="font-size:11px;color:#8a9bbf">${evts.length} событий</span>
        </div>
        ${evts.map(e => renderCalEvent(e, false)).join('')}
      </div>`;
  }).join('');
}

function renderCalEvent(e, isOverdue) {
  const cat  = CAL_CATEGORIES[e.category] || CAL_CATEGORIES.task;
  const d    = new Date(e.date);
  const daysFromNow = Math.ceil((d - new Date()) / 86400000);
  const dStr = d.toLocaleDateString('ru-RU', { day:'numeric', month:'short' });
  // Every category now carries an action (see buildCalendarEvents()) —
  // clicking always just navigates to where the real action happens,
  // never performs it directly from the calendar row.
  const clickable = !!e.action;
  const idx = clickable ? _calendarEvents.indexOf(e) : -1;
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #1e293b;${clickable ? 'cursor:pointer' : ''}"
      ${clickable ? `onclick="runCalendarEventAction(${idx})" title="Перейти к действию"` : ''}>
      <div style="width:36px;height:36px;border-radius:9px;background:${e.color}22;color:${e.color};
                  display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">
        <i class="fas ${cat.icon}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.label}</div>
        <div style="font-size:11px;color:#8a9bbf;margin-top:2px">${cat.label} · ${e.resp||'—'} · ${e.status}</div>
      </div>
      ${clickable ? '<i class="fas fa-chevron-right" style="color:#475569;font-size:11px;flex-shrink:0"></i>' : ''}
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:700;color:${isOverdue?'#ef4444':daysFromNow<=7?'#f97316':'#8a9bbf'}">${dStr}</div>
        <div style="font-size:10px;color:${isOverdue?'#ef4444':daysFromNow<=7?'#f97316':'#94a3b8'}">
          ${isOverdue ? `${Math.abs(daysFromNow)}д назад` : daysFromNow===0 ? 'Сегодня' : `через ${daysFromNow}д`}
        </div>
      </div>
    </div>`;
}


/* ═══════════════════════════════════════════════════════════
   MODULE 3 — IC MODULE (Investment Committee)
   Меморандумы, голосование, история решений
═══════════════════════════════════════════════════════════ */

// Fixed IC voting composition per Constitution Section 7 (2 GP Reps +
// 1 Independent Member + 1 LP Rep — IC_SEATS in js/roles.js). Which role
// occupies each seat is configurable via the Roles admin UI, so this is
// derived live rather than a hardcoded 4-entry list of specific people —
// shows the role label holding the seat, not a specific person's name
// (the system no longer assumes a fixed 1:1 role<->person mapping).
function icRoleDefs() {
  return IC_SEATS.map(seat => {
    const r = roleForIcSeat(seat);
    return { role: seat, name: r ? r.label : '— вакантно —' };
  });
}
const IC_VOTES   = { approve: { label:'Одобрить', color:'#22c55e' }, reject: { label:'Отклонить', color:'#ef4444' }, defer: { label:'Доп. DD', color:'#8b5cf6' }, abstain: { label:'Воздержаться', color:'#94a3b8' } };
// 'defer' = комитет требует дополнительного due diligence (напр. внешние
// консультанты) прежде чем решать — не одобрение и не отказ. Резолюция
// меморандума (approved/rejected/deferred) выводится сервером в
// deriveIcResolution (server/index.js), это лишь метки для UI.
const IC_MEMO_STATUS_LABELS = { approved:'Одобрено', rejected:'Отклонено', deferred:'Доп. DD запрошено', pending:'На голосовании' };

let icMemos = [];  // populated at runtime by js/api-auth.js via GET /api/ic-memos (see server/index.js)
let icIdCounter = 6;
let activeIcId  = null;

function renderICPage() {
  renderICKPIs();
  renderICList();
}

function getFundScopedIcMemos() {
  return typeof activeFundId !== 'undefined' && activeFundId != null
    ? icMemos.filter(m => m.fundId === activeFundId)
    : icMemos;
}

function renderICKPIs() {
  const el = document.getElementById('icKPIs');
  if (!el) return;
  const fundMemos = getFundScopedIcMemos();
  const approved = fundMemos.filter(m => m.status === 'approved').length;
  const pending  = fundMemos.filter(m => m.status === 'pending').length;
  const rejected = fundMemos.filter(m => m.status === 'rejected').length;
  const totalApproved = fundMemos.filter(m=>m.status==='approved').reduce((s,m)=>s+m.amount,0);
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon blue"><i class="fas fa-file-contract"></i></div>
      <div class="kpi-body"><span class="kpi-label">IC Меморандумов</span>
        <span class="kpi-value">${fundMemos.length}</span>
        <span class="kpi-delta">${approved} одобрено</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon orange"><i class="fas fa-vote-yea"></i></div>
      <div class="kpi-body"><span class="kpi-label">На голосовании</span>
        <span class="kpi-value" style="color:${pending>0?'#f97316':'#22c55e'}">${pending}</span>
        <span class="kpi-delta ${pending>0?'warning':''}">${pending>0?'Ждут решения':'Нет'}</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon green"><i class="fas fa-check-double"></i></div>
      <div class="kpi-body"><span class="kpi-label">Одобрено ($M)</span>
        <span class="kpi-value">$${totalApproved.toFixed(1)}M</span>
        <span class="kpi-delta up">${approved} сделок</span></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon red"><i class="fas fa-times-circle"></i></div>
      <div class="kpi-body"><span class="kpi-label">Отклонено</span>
        <span class="kpi-value">${rejected}</span>
        <span class="kpi-delta">${rejected} сделок</span></div>
    </div>`;
}

function renderICList() {
  const el = document.getElementById('icList');
  if (!el) return;
  el.innerHTML = getFundScopedIcMemos().map(m => {
    const votedCount = m.votes.filter(v=>v.vote).length;
    const approveCount = m.votes.filter(v=>v.vote==='approve').length;
    const statusCfg = { approved:{label:'Одобрено',color:'#22c55e',bg:'rgba(34,197,94,0.12)'},
      pending:{label:'На голосовании',color:'#f97316',bg:'rgba(249,115,22,0.12)'},
      rejected:{label:'Отклонено',color:'#ef4444',bg:'rgba(239,68,68,0.12)'},
      deferred:{label:'Доп. DD запрошено',color:'#8b5cf6',bg:'rgba(139,92,246,0.12)'},
    }[m.status] || {};
    return `
      <div class="wf-row" onclick="openICModal(${m.id})" style="cursor:pointer">
        <div class="wf-row-icon" style="background:rgba(249,115,22,0.12);color:#f97316">
          <i class="fas fa-handshake"></i>
        </div>
        <div class="wf-row-main">
          <div class="wf-row-title">
            <span class="wf-entity-name">${m.company}</span>
            ${m.status==='pending'?'<span class="wf-my-badge"><i class="fas fa-vote-yea"></i> Голосование открыто</span>':''}
          </div>
          <div class="wf-row-meta">
            <span style="color:#f97316;font-size:11px;font-weight:700">$${m.amount}M ${m.type}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">${m.sector}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">IC: ${m.meetingDate ? new Date(m.meetingDate).toLocaleDateString('ru-RU') : '—'}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">Голоса: ${votedCount}/${m.votes.length} (${approveCount} за)</span>
          </div>
          <div class="wf-progress-bar">
            <div class="wf-progress-fill" style="width:${Math.round(votedCount/m.votes.length*100)}%;background:#f97316"></div>
          </div>
        </div>
        <span class="task-status-pill" style="background:${statusCfg.bg};color:${statusCfg.color}">${statusCfg.label}</span>
      </div>`;
  }).join('') || '<div style="padding:40px;text-align:center;color:#8a9bbf">Нет IC меморандумов</div>';
}

function openICModal(id) {
  activeIcId = id;
  const m     = icMemos.find(x => x.id === id);
  if (!m) return;
  const modal   = document.getElementById('modal-ic');
  const overlay = document.getElementById('icModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  renderICModalContent(m);
  modal.style.display = 'flex';
}

function closeICModal() {
  const modal   = document.getElementById('modal-ic');
  const overlay = document.getElementById('icModalOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  activeIcId = null;
}

const RISK_CONCLUSIONS = {
  'No Objection':        { label: 'Возражений нет',      color: '#22c55e' },
  'Conditional Approval': { label: 'Условное одобрение', color: '#3b82f6' },
  'Veto':                 { label: 'Вето',                color: '#ef4444' },
};

function icQuorumMet(votes) {
  const voted = votes.filter(v => v.vote);
  return voted.length >= 3 && voted.some(v => v.role === 'Independent Member');
}

function renderICModalContent(m) {
  // Each IC seat is now cast by the real account holding that seat's role
  // (Constitution Section 7: GP Rep 1 = CEO, GP Rep 2 = CFO, Independent
  // Member and LP Rep have their own external accounts) — a vote button
  // only renders on the row matching the logged-in user's own role, unvoted.
  const myRole = currentUserRole();
  const canCastVote = (v) => m.status === 'pending' && !v.vote && currentUserPermissionValue('icSeat') === v.role;
  const anyVotableByMe = m.status === 'pending' && m.votes.some(canCastVote);

  const votesHtml = m.votes.map((v, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #2a3448;font-size:12px">
      <div style="width:28px;height:28px;border-radius:8px;background:#1e293b;display:flex;align-items:center;justify-content:center;font-weight:800;color:#94a3b8;font-size:10px;flex-shrink:0">
        ${(v.name||v.role).slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="color:#e2e8f0;font-weight:600">${v.role}</div>
        <div style="color:#5a6b8a;font-size:10px">${v.name||''}</div>
      </div>
      ${v.vote ? `
        <span style="color:${IC_VOTES[v.vote]?.color};font-weight:700">${IC_VOTES[v.vote]?.label}</span>
        ${v.comment ? `<span style="color:#8a9bbf;font-style:italic;font-size:11px;max-width:160px">"${v.comment}"</span>` : ''}
      ` : canCastVote(v) ? `
        <div style="display:flex;gap:4px">
          ${Object.entries(IC_VOTES).map(([k,cfg]) => `
            <button onclick="castICVote(${m.id},${i},'${k}')" title="${cfg.label}"
              style="background:${cfg.color}18;border:1px solid ${cfg.color};color:${cfg.color};padding:4px 8px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700">
              ${cfg.label}
            </button>`).join('')}
        </div>
      ` : '<span style="color:#2a3448;font-style:italic">Ожидает...</span>'}
    </div>`).join('');

  const quorum = m.status === 'pending' ? icQuorumMet(m.votes) : m.quorumMet;

  document.getElementById('icModalContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div class="kpi-icon orange" style="width:46px;height:46px;font-size:18px;border-radius:12px"><i class="fas fa-handshake"></i></div>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800;color:#f1f5f9">${m.company}</div>
        <div style="font-size:12px;color:#f97316;font-weight:600">$${m.amount}M ${m.type} · ${m.sector}</div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;background:${quorum?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)'};color:${quorum?'#22c55e':'#ef4444'}">
        ${quorum ? 'Кворум набран' : 'Кворум не набран'}
      </span>
    </div>

    <!-- Sections -->
    ${[
      ['fa-lightbulb','#22c55e','Инвестиционный тезис', m.thesis],
      ['fa-exclamation-circle','#ef4444','Риски', m.risks],
      ['fa-chart-bar','#3b82f6','Финансовые показатели', m.financials],
      ['fa-sign-out-alt','#8b5cf6','Стратегия выхода', m.exitPlan],
    ].map(([icon,color,title,text]) => `
      <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;margin-bottom:6px;letter-spacing:.5px">
          <i class="fas ${icon}" style="margin-right:5px"></i>${title}
        </div>
        <div style="font-size:13px;color:#94a3b8;line-height:1.55">${text||'—'}</div>
      </div>`).join('')}

    <!-- Risk Manager conclusion (independent of the IC vote — Constitution Section 7.7) -->
    <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:10px;border:1px solid ${m.riskVeto?'rgba(239,68,68,0.4)':'#2a3448'}">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:6px;letter-spacing:.5px">
        <i class="fas fa-shield-alt" style="margin-right:5px"></i>Заключение Risk Manager (независимое вето)
      </div>
      <div style="font-size:13px;color:${m.riskConclusion ? RISK_CONCLUSIONS[m.riskConclusion]?.color : '#5a6b8a'};font-weight:700;margin-bottom:${currentUserPermission('riskVeto') ? '10px' : '0'}">
        ${m.riskConclusion ? (RISK_CONCLUSIONS[m.riskConclusion]?.label || m.riskConclusion) : 'Ещё не рассмотрено'}
      </div>
      ${currentUserPermission('riskVeto') ? `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select id="icRiskConclusionSelect_${m.id}" style="background:#0f1623;border:1px solid #2a3448;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px">
            <option value="">— Выбрать заключение —</option>
            ${Object.keys(RISK_CONCLUSIONS).map(k => `<option value="${k}" ${m.riskConclusion===k?'selected':''}>${RISK_CONCLUSIONS[k].label}</option>`).join('')}
          </select>
          <button onclick="saveRiskConclusion(${m.id})"
            style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.4);color:#dc2626;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
            <i class="fas fa-save"></i> Сохранить заключение</button>
        </div>` : ''}
    </div>

    <!-- Votes -->
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:#8a9bbf;margin-bottom:10px;text-transform:uppercase">Голосование IC (Constitution Section 7)</div>
      ${m.status !== 'pending' ? `
        <div style="font-size:11px;color:#5a6b8a;font-style:italic;margin-bottom:8px">
          Голосование завершено, меморандум переведён в статус «${IC_MEMO_STATUS_LABELS[m.status] || m.status}» — записи ниже финальны.
        </div>` : !anyVotableByMe ? `
        <div style="font-size:11px;color:#f97316;margin-bottom:8px">
          <i class="fas fa-info-circle" style="margin-right:4px"></i>Ваша роль (${roleLabel(myRole)}) не занимает ни одно из 4 мест IC в этом меморандуме, либо вы уже проголосовали.
        </div>` : ''}
      ${votesHtml}
    </div>

    ${m.resolution ? `
      <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:10px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:#22c55e;margin-bottom:6px"><i class="fas fa-gavel"></i> РЕШЕНИЕ IC</div>
        <div style="font-size:13px;color:#94a3b8">${m.resolution}</div>
      </div>` : ''}

    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="printICMemo(${m.id})"
        style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-print" style="margin-right:6px"></i>Печать / PDF</button>
      <button onclick="closeICModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Закрыть</button>
    </div>`;
}

// Printable single-memo document — same openPrintableDocument() pattern
// (js/print-utils.js) already used by Term Sheet, DD Report, LP Welcome
// Letter, Capital Call Notice and Capital Account Statement. One memo per
// print job (not a meeting-wide combined protocol) — matches how the
// modal itself always shows exactly one memo.
function printICMemo(id) {
  const m = icMemos.find(x => x.id === id);
  if (!m) return;
  const fp = FUND_PARAMS;

  const docStyle = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Times New Roman', serif; font-size:11pt; color:#111; padding:40px 60px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1e3a8a; padding-bottom:14px; margin-bottom:22px; }
  .logo-name { font-size:15pt; font-weight:700; color:#1e3a8a; }
  .logo-sub  { font-size:9pt; color:#4a5568; margin-top:2px; }
  .ref-block { text-align:right; font-size:9.5pt; color:#4a5568; }
  h1 { font-size:13pt; font-weight:700; color:#1e3a8a; text-transform:uppercase; text-align:center; margin:18px 0 4px; }
  .subtitle { text-align:center; font-size:10pt; color:#4a5568; margin-bottom:20px; }
  .deal-table { width:100%; border-collapse:collapse; margin:14px 0 20px; }
  .deal-table td { padding:6px 12px; border-bottom:1px solid #e2e8f0; font-size:10.5pt; }
  .deal-table td:first-child { font-weight:600; color:#2d3748; width:38%; background:#f8fafc; }
  .section { margin-bottom:14px; }
  .section-title { font-size:10pt; font-weight:700; color:#1e3a8a; text-transform:uppercase; letter-spacing:.4px; margin-bottom:5px; border-bottom:1px solid #cbd5e0; padding-bottom:3px; }
  .section-text { font-size:10.5pt; line-height:1.55; text-align:justify; }
  .risk-box { border:1px solid #cbd5e0; border-radius:4px; padding:10px 14px; margin-bottom:14px; }
  .risk-box.veto { border-color:#dc2626; background:#fef2f2; }
  .votes-table { width:100%; border-collapse:collapse; margin:10px 0 14px; }
  .votes-table th { background:#1e3a8a; color:#fff; padding:6px 10px; font-size:9.5pt; text-align:left; }
  .votes-table td { padding:6px 10px; border-bottom:1px solid #e2e8f0; font-size:10pt; }
  .quorum-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:9.5pt; font-weight:700; }
  .quorum-yes { background:#dcfce7; color:#15803d; }
  .quorum-no  { background:#fee2e2; color:#b91c1c; }
  .resolution-box { background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:12px 16px; margin:14px 0; }
  .signature-block { margin-top:32px; display:flex; justify-content:space-between; }
  .sig-col { width:45%; }
  .sig-line { border-top:1px solid #333; margin-top:44px; padding-top:5px; font-size:10pt; }
  .footer { margin-top:28px; padding-top:10px; border-top:1px solid #cbd5e0; font-size:8.5pt; color:#718096; text-align:center; }
  `;

  const quorum = m.status === 'pending' ? icQuorumMet(m.votes) : m.quorumMet;

  const votesRows = m.votes.map(v => `
    <tr>
      <td>${v.role}</td>
      <td>${v.name || '—'}</td>
      <td>${v.vote ? (IC_VOTES[v.vote]?.label || v.vote) : 'Ожидает'}</td>
      <td>${v.comment || '—'}</td>
    </tr>`).join('');

  const body = `
  <div class="header">
    <div>
      <div class="logo-name">${fp.gp}</div>
      <div class="logo-sub">General Partner · ${fp.name}</div>
      <div class="logo-sub">AFSA: ${fp.license}</div>
    </div>
    <div class="ref-block">
      <div><b>Memo Ref:</b> IC-${String(m.id).padStart(3,'0')}</div>
      <div><b>Дата заседания:</b> ${m.meetingDate || '—'}</div>
      <div><b>STRICTLY CONFIDENTIAL</b></div>
    </div>
  </div>

  <h1>Investment Committee Memorandum</h1>
  <div class="subtitle">Инвестиционный меморандум для Investment Committee (Constitution Section 7)</div>

  <table class="deal-table">
    <tr><td>Компания</td><td><b>${m.company}</b></td></tr>
    <tr><td>Сектор</td><td>${m.sector || '—'}</td></tr>
    <tr><td>Сумма инвестиций</td><td><b>$${m.amount}M</b></td></tr>
    <tr><td>Тип сделки</td><td>${m.type || '—'}</td></tr>
    <tr><td>Стадия</td><td>${m.stage || '—'}</td></tr>
    <tr><td>Автор меморандума</td><td>${m.author || '—'}</td></tr>
    <tr><td>Дата подготовки</td><td>${m.createdAt || '—'}</td></tr>
    <tr><td>Статус</td><td>${IC_MEMO_STATUS_LABELS[m.status] || 'На рассмотрении'}</td></tr>
  </table>

  ${[
    ['Инвестиционный тезис', m.thesis],
    ['Риски', m.risks],
    ['Финансовые показатели', m.financials],
    ['Стратегия выхода', m.exitPlan],
  ].map(([title, text]) => `
    <div class="section">
      <div class="section-title">${title}</div>
      <div class="section-text">${text || '—'}</div>
    </div>`).join('')}

  <div class="risk-box ${m.riskVeto ? 'veto' : ''}">
    <div class="section-title" style="border:none;margin-bottom:4px">Заключение Risk Manager (независимое вето, Constitution Section 7.7)</div>
    <div class="section-text"><b>${m.riskConclusion ? (RISK_CONCLUSIONS[m.riskConclusion]?.label || m.riskConclusion) : 'Ещё не рассмотрено'}</b></div>
  </div>

  <div class="section">
    <div class="section-title">Голосование IC</div>
    <div style="margin-bottom:8px">Кворум: <span class="quorum-badge ${quorum ? 'quorum-yes' : 'quorum-no'}">${quorum ? 'Набран' : 'Не набран'}</span></div>
    <table class="votes-table">
      <thead><tr><th>Место в IC</th><th>Имя</th><th>Голос</th><th>Комментарий</th></tr></thead>
      <tbody>${votesRows}</tbody>
    </table>
  </div>

  ${m.resolution ? `
  <div class="resolution-box">
    <div class="section-title" style="border:none;color:#15803d">Решение IC</div>
    <div class="section-text">${m.resolution}</div>
  </div>` : ''}

  <div class="signature-block">
    <div class="sig-col">
      <div class="sig-line">
        <div>${fp.gpCEO}</div>
        <div style="color:#4a5568;font-size:9.5pt">Председатель IC / ${fp.gpTitle}</div>
      </div>
    </div>
    <div class="sig-col">
      <div class="sig-line">
        <div>_______________________</div>
        <div style="color:#4a5568;font-size:9.5pt">Секретарь заседания</div>
      </div>
    </div>
  </div>

  <div class="footer">
    ${fp.gp} · ${fp.gpAddress} · BIN: ${fp.gpBIN} · AFSA: ${fp.license}<br>
    STRICTLY CONFIDENTIAL — Только для членов Investment Committee. Retention: 6 years (Constitution §8.5)
  </div>
  `;

  const win = openPrintableDocument(body, {
    title: `IC Memorandum — ${m.company}`,
    features: 'width=900,height=800',
    extraStyle: docStyle,
  });
  if (win) showToast(`🖨️ Меморандум по сделке «${m.company}» сформирован`, 'green');
}

async function castICVote(memoId, voteIdx, vote) {
  const m = icMemos.find(x => x.id === memoId);
  if (!m) return;
  const myVote = m.votes[voteIdx];
  if (!myVote) return;

  // A cast vote can never be changed (no re-vote control renders once
  // v.vote is set — see canCastVote in renderICModalContent), so this is a
  // one-shot, permanent decision — confirm before committing, and warn
  // explicitly when this vote will be the one that finalizes the memo.
  const wouldFinalize = (() => {
    const approveN = m.votes.filter((v, i) => v.vote === 'approve' || (i === voteIdx && vote === 'approve')).length;
    const allVoted = m.votes.every((v, i) => v.vote || i === voteIdx);
    const quorum   = icQuorumMet(m.votes.map((v, i) => i === voteIdx ? { ...v, vote } : v));
    return allVoted || (quorum && approveN > m.votes.length / 2);
  })();
  const confirmMsg = wouldFinalize
    ? `Голос «${IC_VOTES[vote].label}» окончательный и не подлежит изменению. Этот голос завершает голосование по меморандуму — решение будет зафиксировано немедленно. Продолжить?`
    : `Голос «${IC_VOTES[vote].label}» окончательный и не подлежит изменению. Продолжить?`;
  if (!confirm(confirmMsg)) return;

  const wasPending = m.status === 'pending';
  const votesPayload = m.votes.map((v, i) => i === voteIdx ? { ...v, vote, comment: v.comment || '' } : v);

  try {
    // The server derives quorum/status/resolution from the votes array
    // itself (deriveIcResolution, server/index.js) and never trusts a
    // client-computed value for them — so the vote isn't applied locally
    // until the server confirms it (previously it was mutated into `m`
    // before the request even went out, so a failed save could leave a
    // vote looking cast when it never persisted).
    //
    // The server also syncs the linked deal (ic/icDecision, and for a
    // "deferred" outcome: stage back to Due Diligence + the GP conclusion
    // reset) as part of this same request, with its own authority — that
    // can't be done from here at all: an IC vote is very often cast by an
    // external seat (Independent Member, LP Rep — server/rolesSeed.js:
    // internal:false, accessFM:false) who could never legally call
    // PUT /api/deals/:id themselves, let alone touch gpConclusion* fields
    // (gated behind authorICMemo, which those seats don't have either).
    const updated = await apiFetch(`/api/ic-memos/${m.id}`, {
      method: 'PUT',
      body: JSON.stringify({ votes: votesPayload }),
    });
    Object.assign(m, updated);

    if (wasPending && m.status !== 'pending' && m.dealId != null) {
      const deal = deals.find(d => d.id === m.dealId);
      if (deal) {
        if (m.status === 'deferred') {
          deal.ic = deal.icDecision = 'Доп. DD';
          deal.stage = 'Due Diligence';
          deal.gpConclusionVerdict = '';
          deal.gpConclusionSummary = '';
          deal.gpConclusionSignedBy = '';
          deal.gpConclusionSignedAt = '';
        } else {
          deal.ic = deal.icDecision = m.status === 'approved' ? 'Одобрено' : 'Отклонено';
        }
      }
    }

    const toastMsg = m.status === 'approved' ? '✅ IC одобрил инвестицию!'
      : m.status === 'rejected' ? '❌ IC отклонил инвестицию'
      : m.status === 'deferred' ? '🔄 IC запросил доп. due diligence — сделка возвращена на стадию DD'
      : `Голос "${IC_VOTES[vote].label}" зафиксирован (${myVote.role})`;
    const toastColor = m.status === 'approved' ? 'green' : m.status === 'rejected' ? 'red' : m.status === 'deferred' ? 'orange' : 'blue';
    showToast(toastMsg, toastColor);
  } catch (err) {
    showToast('⚠️ Не удалось сохранить голос: ' + err.message, 'red');
  }
  renderICModalContent(m);
  renderICPage();
  if (typeof renderPipeline === 'function' && typeof deals !== 'undefined') renderPipeline(deals);
}

async function saveRiskConclusion(memoId) {
  const m = icMemos.find(x => x.id === memoId);
  if (!m) return;
  const select = document.getElementById('icRiskConclusionSelect_' + memoId);
  const riskConclusion = select ? select.value : '';
  if (!riskConclusion) { showToast('⚠️ Выберите заключение', 'red'); return; }
  const riskVeto = riskConclusion === 'Veto';
  try {
    await apiFetch(`/api/ic-memos/${m.id}`, {
      method: 'PUT',
      body: JSON.stringify({ riskConclusion, riskVeto }),
    });
    m.riskConclusion = riskConclusion;
    m.riskVeto = riskVeto;
    showToast('✅ Заключение Risk Manager сохранено', 'green');
    renderICModalContent(m);
    renderICPage();
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

/* ─── NEW IC MEMORANDUM FORM ─────────────────────────────────────── */

function openNewICMemo() {
  const modal   = document.getElementById('modal-ic');
  const overlay = document.getElementById('icModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Build deal options from deals[] array
  const dealOptions = (typeof deals !== 'undefined' ? deals : [])
    .filter(d => d.stage !== 'Закрыта')
    .map(d => `<option value="${d.id}">${d.company} — $${d.amount}M (${d.stage})</option>`)
    .join('');

  const SECTORS = ['Технологии','Финансы','Промышленность','Здравоохранение','Недвижимость','Энергетика','Потребительский','Другое'];
  const TYPES   = ['Equity','Debt','Convertible Note','SAFE','Mezzanine','Other'];

  document.getElementById('icModalContent').innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div class="kpi-icon orange" style="width:44px;height:44px;font-size:17px;border-radius:12px;flex-shrink:0">
        <i class="fas fa-plus"></i>
      </div>
      <div>
        <div style="font-size:15px;font-weight:800;color:#f1f5f9">Новый IC Меморандум</div>
        <div style="font-size:11px;color:#8a9bbf">Заполните все обязательные поля и отправьте на голосование IC</div>
      </div>
    </div>

    <!-- Form grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">

      <!-- Deal / Company -->
      <div style="grid-column:1/-1">
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          <i class="fas fa-handshake" style="color:#f97316;margin-right:4px"></i>Компания / Сделка <span style="color:#ef4444">*</span>
        </label>
        <select id="icNewDealId" onchange="icFormSyncDeal()"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          <option value="">— Выберите из pipeline или введите вручную —</option>
          ${dealOptions}
          <option value="manual">✏️ Ввести вручную...</option>
        </select>
      </div>

      <!-- Manual company name (hidden by default) -->
      <div id="icManualNameWrap" style="grid-column:1/-1;display:none">
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          Название компании <span style="color:#ef4444">*</span>
        </label>
        <input id="icNewCompany" type="text" placeholder="Название компании..."
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>

      <!-- Amount -->
      <div>
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          <i class="fas fa-dollar-sign" style="color:#22c55e;margin-right:4px"></i>Сумма ($M) <span style="color:#ef4444">*</span>
        </label>
        <input id="icNewAmount" type="number" step="0.1" min="0" placeholder="напр. 3.5"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>

      <!-- Type -->
      <div>
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          <i class="fas fa-layer-group" style="color:#3b82f6;margin-right:4px"></i>Тип инструмента
        </label>
        <select id="icNewType"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>

      <!-- Sector -->
      <div>
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          <i class="fas fa-tag" style="color:#8b5cf6;margin-right:4px"></i>Сектор
        </label>
        <select id="icNewSector"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${SECTORS.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>

      <!-- Meeting date -->
      <div>
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">
          <i class="fas fa-calendar" style="color:#f97316;margin-right:4px"></i>Дата заседания IC
        </label>
        <input id="icNewMeetingDate" type="date" value="${new Date(Date.now()+14*86400000).toISOString().slice(0,10)}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>
    </div>

    <!-- Thesis -->
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:700;color:#22c55e;display:block;margin-bottom:4px;text-transform:uppercase">
        <i class="fas fa-lightbulb" style="margin-right:4px"></i>Инвестиционный тезис <span style="color:#ef4444">*</span>
      </label>
      <textarea id="icNewThesis" rows="3" placeholder="Опишите инвестиционный кейс, конкурентные преимущества, рыночную возможность..."
        style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
    </div>

    <!-- Risks -->
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:700;color:#ef4444;display:block;margin-bottom:4px;text-transform:uppercase">
        <i class="fas fa-exclamation-circle" style="margin-right:4px"></i>Ключевые риски <span style="color:#ef4444">*</span>
      </label>
      <textarea id="icNewRisks" rows="2" placeholder="Рыночные, операционные, регуляторные, технологические риски..."
        style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
    </div>

    <!-- Financials -->
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:700;color:#3b82f6;display:block;margin-bottom:4px;text-transform:uppercase">
        <i class="fas fa-chart-bar" style="margin-right:4px"></i>Финансовые показатели
      </label>
      <textarea id="icNewFinancials" rows="2" placeholder="Выручка, EBITDA, ARR, прогноз, оценка компании (pre/post-money)..."
        style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
    </div>

    <!-- Exit plan -->
    <div style="margin-bottom:16px">
      <label style="font-size:11px;font-weight:700;color:#8b5cf6;display:block;margin-bottom:4px;text-transform:uppercase">
        <i class="fas fa-sign-out-alt" style="margin-right:4px"></i>Стратегия выхода
      </label>
      <textarea id="icNewExit" rows="2" placeholder="M&A, IPO, вторичная продажа — временной горизонт и целевые мультипликаторы..."
        style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea>
    </div>

    <!-- IC Members panel -->
    <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:10px;text-transform:uppercase">
        <i class="fas fa-users" style="margin-right:5px"></i>Состав IC (Constitution Section 7) — проголосуют после создания
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${icRoleDefs().map(({role,name}) => `
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;cursor:pointer">
            <input type="checkbox" id="icMember_${role.replace(/\s/g,'_')}" checked
              style="accent-color:#f97316;width:14px;height:14px" />
            <span>${role} <span style="color:#5a6b8a">(${name})</span></span>
          </label>`).join('')}
      </div>
    </div>

    <!-- Buttons -->
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="closeICModal()"
        style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600">
        Отмена
      </button>
      <button onclick="saveNewICMemo()"
        style="background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-paper-plane" style="margin-right:6px"></i>Создать и открыть голосование
      </button>
    </div>`;

  modal.style.display = 'flex';
}

/* helper — sync fields when a deal is selected from dropdown */
function icFormSyncDeal() {
  const sel  = document.getElementById('icNewDealId');
  const wrap = document.getElementById('icManualNameWrap');
  if (!sel) return;
  const val = sel.value;

  if (val === 'manual') {
    if (wrap) wrap.style.display = 'block';
    return;
  }
  if (wrap) wrap.style.display = 'none';

  if (val && typeof deals !== 'undefined') {
    const deal = deals.find(d => String(d.id) === String(val));
    if (deal) {
      const amtEl = document.getElementById('icNewAmount');
      const secEl = document.getElementById('icNewSector');
      const typEl = document.getElementById('icNewType');
      if (amtEl && deal.amount) amtEl.value = deal.amount;
      if (secEl && deal.sector) {
        for (let i = 0; i < secEl.options.length; i++) {
          if (secEl.options[i].value === deal.sector) { secEl.selectedIndex = i; break; }
        }
      }
      if (typEl && deal.type) {
        for (let i = 0; i < typEl.options.length; i++) {
          if (typEl.options[i].value === deal.type) { typEl.selectedIndex = i; break; }
        }
      }

      // Draft the thesis/risks/financials text fields from the deal's
      // already-signed GP conclusion and DD conclusions, so whoever
      // creates the memo isn't retyping what specialists already
      // wrote up — same "draft, human reviews and edits" pattern as
      // draftGpConclusion() (js/app.js). Only overwrites what has a
      // real source; exit strategy has no equivalent field anywhere
      // upstream, so it's left for manual entry.
      const catTitle = key => (typeof DD_CONCLUSION_CATEGORIES !== 'undefined'
        ? (DD_CONCLUSION_CATEGORIES.find(c => c.key === key) || {}).title : null) || key;
      const conclusions = deal.ddConclusions || [];

      const thesisEl = document.getElementById('icNewThesis');
      if (thesisEl && deal.gpConclusionSummary) {
        thesisEl.value = `Заключение УК (${deal.gpConclusionVerdict}, подписано: ${deal.gpConclusionSignedBy || '—'} ${deal.gpConclusionSignedAt || ''}):\n${deal.gpConclusionSummary}`;
      }

      const risksEl = document.getElementById('icNewRisks');
      if (risksEl) {
        const concerns = conclusions.filter(c => c.verdict === 'Критично' || c.verdict === 'Есть замечания');
        if (concerns.length) {
          risksEl.value = concerns.map(c => {
            const docs = (c.documents || []).map(dc => dc.name || dc.url).join(', ');
            return `${catTitle(c.category)} — ${c.verdict}${docs ? ' (' + docs + ')' : ''}`;
          }).join('\n');
        } else if (conclusions.length) {
          risksEl.value = 'Существенных замечаний по итогам DD не выявлено (все полученные заключения — «Без замечаний»).';
        }
      }

      const finEl = document.getElementById('icNewFinancials');
      if (finEl) {
        const finConcl = conclusions.find(c => c.category === 'Financial');
        if (finConcl) {
          const docs = (finConcl.documents || []).map(dc => dc.name || dc.url).join(', ');
          finEl.value = `Financial DD — ${finConcl.verdict}${docs ? '. Документы: ' + docs : ''}`;
        }
      }
    }
  }
}

/* save new memo */
async function saveNewICMemo() {
  const dealSel   = document.getElementById('icNewDealId')?.value;
  const isManual  = dealSel === 'manual' || dealSel === '';
  const company   = isManual
    ? (document.getElementById('icNewCompany')?.value?.trim() || '')
    : (() => {
        const d = typeof deals !== 'undefined' ? deals.find(x => String(x.id) === String(dealSel)) : null;
        return d ? d.company : dealSel;
      })();
  const amount    = parseFloat(document.getElementById('icNewAmount')?.value) || 0;
  const type      = document.getElementById('icNewType')?.value || 'Equity';
  const sector    = document.getElementById('icNewSector')?.value || 'Другое';
  const meetDate  = document.getElementById('icNewMeetingDate')?.value || '';
  const thesis    = document.getElementById('icNewThesis')?.value?.trim() || '';
  const risks     = document.getElementById('icNewRisks')?.value?.trim() || '';
  const financials= document.getElementById('icNewFinancials')?.value?.trim() || '';
  const exitPlan  = document.getElementById('icNewExit')?.value?.trim() || '';

  // Validation
  if (!company) { showToast('⚠️ Укажите компанию', 'red'); return; }
  if (!amount || amount <= 0) { showToast('⚠️ Укажите сумму инвестиции', 'red'); return; }
  if (!thesis) { showToast('⚠️ Заполните инвестиционный тезис', 'red'); return; }
  if (!risks)  { showToast('⚠️ Заполните раздел рисков', 'red'); return; }

  // A memo tied to a real deal requires the Management Company's own
  // conclusion to already be signed off recommending it (js/app.js's
  // gpConclusionSection()/signGpConclusion()) — enforced again server-
  // side in POST /api/ic-memos so this can't be bypassed by calling the
  // API directly. Manual/standalone memos (no linked deal) skip this.
  if (!isManual) {
    const linkedDeal = typeof deals !== 'undefined' ? deals.find(x => String(x.id) === String(dealSel)) : null;
    if (linkedDeal && linkedDeal.gpConclusionVerdict !== 'Рекомендовано к IC') {
      showToast('⚠️ Сначала подпишите заключение УК со статусом "Рекомендовано к IC" на вкладке Due Diligence карточки сделки', 'red');
      return;
    }
  }

  // Selected IC members (fixed Constitution Section 7 roster — unchecked
  // ones are recorded as absent, same as the seeded "missing Independent
  // Member" scenario, so quorum still resolves correctly against them)
  const selectedRoles = icRoleDefs().filter(({role}) => {
    const cb = document.getElementById('icMember_' + role.replace(/\s/g,'_'));
    return cb ? cb.checked : true;
  });
  if (!selectedRoles.length) { showToast('⚠️ Выберите хотя бы одного члена IC', 'red'); return; }

  const newMemo = {
    fundId:      typeof activeFundId !== 'undefined' ? activeFundId : null,
    dealId:      isManual ? null : (parseInt(dealSel) || null),
    company,
    sector,
    amount,
    type,
    stage:       'IC Review',
    author:      currentUserDisplayName(),
    createdAt:   new Date().toISOString().slice(0,10),
    status:      'pending',
    meetingDate: meetDate,
    thesis,
    risks,
    financials,
    exitPlan,
    votes:       selectedRoles.map(({role,name}) => ({ role, name, vote: null, comment: '' })),
    resolution:  '',
    quorumMet:   false,
    riskVeto:    false,
    riskConclusion: null,
  };

  try {
    const created = await apiFetch('/api/ic-memos', { method: 'POST', body: JSON.stringify(newMemo) });

    // If deal exists — update its IC stage. Only the changed field is
    // sent (PUT /api/deals/:id merges onto the existing row), not the
    // whole local deal object, since other deal fields (KPIs, comments)
    // are edited elsewhere without ever being saved and shouldn't get
    // pulled in as a side effect of this save.
    if (created.dealId && typeof deals !== 'undefined') {
      const deal = deals.find(d => d.id === created.dealId);
      if (deal) {
        deal.stage = 'IC Review';
        try {
          await apiFetch(`/api/deals/${deal.id}`, { method: 'PUT', body: JSON.stringify({ stage: deal.stage }) });
        } catch (dealErr) {
          showToast('⚠️ Меморандум создан, но не удалось обновить стадию сделки: ' + dealErr.message, 'orange');
        }
      }
    }

    await loadIcMemosFromApi();
    closeICModal();
    renderICPage();
    updateBadges();
    showToast(`✅ Меморандум "${company}" создан. Голосование открыто!`, 'green');

    // Auto-open the new memo card after a short delay
    setTimeout(() => openICModal(created.id), 200);
  } catch (err) {
    showToast('⚠️ Не удалось создать меморандум: ' + err.message, 'red');
  }
}


/* ═══════════════════════════════════════════════════════════
   MODULE 4 — LP INDIVIDUAL REPORTS
   NAV Statement + Capital Account per LP
═══════════════════════════════════════════════════════════ */

let activeLpReportId = null;

function renderLPReportsPage() {
  const el = document.getElementById('lpReportsContent');
  if (!el) return;

  const totalNAV    = portfolio.reduce((s,p) => s+p.value,0);
  const totalCommit = lpRegister.reduce((s,l) => s+l.commitment,0);

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-users" style="color:#3b82f6;margin-right:6px"></i>Выберите LP для формирования отчёта</span>
        <span style="font-size:11px;color:#8a9bbf">NAV Statement · Capital Account · Distributions</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;padding:16px">
        ${lpRegister.map(lp => {
          const share    = lp.commitment / totalCommit;
          const navShare = (totalNAV * share).toFixed(3);
          const calledM  = lp.calledAmount / 1e6;
          const moic     = calledM > 0 ? (totalNAV * share / calledM).toFixed(2) : '—';
          const kycColor = lp.kycStatus==='Одобрен' ? '#22c55e' : '#f97316';
          return `
            <div class="cfa-client-card" onclick="openLPReport(${lp.id})" style="cursor:pointer">
              <div class="cfa-card-top">
                <div class="cfa-card-avatar">${lp.name.slice(0,2).toUpperCase()}</div>
                <div class="cfa-card-info">
                  <div class="cfa-card-name">${lp.name}</div>
                  <div class="cfa-card-sub">${lp.type} · ${lp.country}</div>
                </div>
                <span class="task-status-pill" style="background:rgba(34,197,94,0.1);color:#22c55e;white-space:nowrap">${lp.status}</span>
              </div>
              <div class="cfa-card-metrics" style="margin-top:10px">
                <div class="cfa-metric"><span class="cfa-metric-val">$${(lp.commitment/1e6).toFixed(1)}M</span><span class="cfa-metric-label">Commitment</span></div>
                <div class="cfa-metric"><span class="cfa-metric-val" style="color:#3b82f6">$${navShare}M</span><span class="cfa-metric-label">NAV Share</span></div>
                <div class="cfa-metric"><span class="cfa-metric-val" style="color:#f97316">${moic}x</span><span class="cfa-metric-label">MOIC</span></div>
              </div>
              <div class="cfa-card-footer" style="margin-top:8px">
                <div style="font-size:11px;color:${kycColor}">KYC: ${lp.kycStatus||'—'}</div>
                <div style="font-size:11px;color:#3b82f6;font-weight:700"><i class="fas fa-file-alt"></i> Открыть отчёт</div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

function openLPReport(lpId) {
  activeLpReportId = lpId;
  const lp    = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const modal   = document.getElementById('modal-lpreport');
  const overlay = document.getElementById('lpReportOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  renderLPReportContent(lp);
  modal.style.display = 'flex';
}

function closeLPReport() {
  const modal   = document.getElementById('modal-lpreport');
  const overlay = document.getElementById('lpReportOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  activeLpReportId = null;
}

function renderLPReportContent(lp) {
  // Convert to $M once, locally — lpRegister stores full dollars, but this
  // report displays everything in millions (matches Fact Sheet conventions).
  const commitM     = lp.commitment / 1e6;
  const calledM     = lp.calledAmount / 1e6;
  const distribM    = (lp.distributions || 0) / 1e6;
  const totalCommit = lpRegister.reduce((s,l) => s+l.commitment, 0) / 1e6;
  const totalNAV    = portfolio.reduce((s,p) => s+p.value, 0);
  const share       = commitM / totalCommit;
  const navShare    = totalNAV * share;
  const unrealized  = navShare - calledM;
  const moic        = calledM > 0 ? (navShare / calledM).toFixed(2) : '—';
  const dpi         = calledM > 0 ? (distribM / calledM).toFixed(2) : '0.00';
  const rvpi        = calledM > 0 ? (navShare / calledM).toFixed(2) : '—';
  const today       = new Date().toLocaleDateString('ru-RU', {day:'numeric',month:'long',year:'numeric'});
  const p           = FUND_PARAMS;
  const ccHistory   = capitalCalls.map((cc,i) => ({
    num: i+1, date: cc.noticeDate, payDate: cc.payDate,
    lpAmount: (lp.commitment / (totalCommit*1e6)) * cc.amount,
    status: cc.status,
  }));

  document.getElementById('lpReportModalContent').innerHTML = `
    <!-- Letterhead -->
    <div style="border-bottom:2px solid var(--accent-blue);padding-bottom:14px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:18px;font-weight:900;color:#f1f5f9">Turan Capital Fund LP</div>
          <div style="font-size:12px;color:#8a9bbf">GP: Golden Leaves Ltd · ${p.license}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:#8a9bbf">Capital Account Statement</div>
          <div style="font-size:11px;color:#8a9bbf">По состоянию на: ${today}</div>
          <div style="font-size:11px;color:#8a9bbf">Конфиденциально</div>
        </div>
      </div>
    </div>

    <!-- LP Info -->
    <div style="background:#1c2333;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">LP / Инвестор</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        ${[
          ['Наименование', lp.name],
          ['Тип', lp.type],
          ['Страна', lp.country],
          ['Контакт', lp.contact],
          ['KYC Статус', lp.kycStatus||'—'],
          ['RM', lp.rm],
        ].map(([k,v]) => `
          <div style="font-size:12px">
            <span style="color:#8a9bbf">${k}: </span>
            <span style="color:#e2e8f0;font-weight:600">${v}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- Capital Account Summary -->
    <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:10px">Capital Account Summary</div>
    <div style="background:#1c2333;border-radius:10px;overflow:hidden;margin-bottom:14px">
      ${[
        ['Commitment', `$${commitM.toFixed(3)}M`, '#e2e8f0'],
        ['Capital Called (Funded)', `$${calledM.toFixed(3)}M`, '#3b82f6'],
        ['Unfunded Commitment', `$${(commitM-calledM).toFixed(3)}M`, '#8a9bbf'],
        ['Distributions Received', `$${distribM.toFixed(3)}M`, '#22c55e'],
        ['NAV (Current Value)', `$${navShare.toFixed(3)}M`, '#3b82f6'],
        ['Unrealized Gain / (Loss)', `$${unrealized.toFixed(3)}M`, unrealized>=0?'#22c55e':'#ef4444'],
        ['MOIC (Total Value / Paid-In)', `${moic}x`, '#f97316'],
        ['DPI (Distributions / Paid-In)', `${dpi}x`, '#22c55e'],
        ['RVPI (Residual Value / Paid-In)', `${rvpi}x`, '#3b82f6'],
      ].map(([k,v,c],i) => `
        <div style="display:flex;justify-content:space-between;padding:9px 14px;${i>0?'border-top:1px solid #2a3448':''}">
          <span style="font-size:13px;color:#8a9bbf">${k}</span>
          <span style="font-size:13px;font-weight:700;color:${c}">${v}</span>
        </div>`).join('')}
    </div>

    <!-- Capital Call History -->
    <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:10px">Capital Call History</div>
    <div class="table-scroll" style="margin-bottom:14px">
      <table class="data-table">
        <thead><tr><th>#</th><th>Дата Notice</th><th>Дата платежа</th><th>Сумма LP ($)</th><th>Статус</th></tr></thead>
        <tbody>
          ${ccHistory.map(cc => `
            <tr>
              <td>CC #${cc.num}</td>
              <td style="font-size:12px">${new Date(cc.date).toLocaleDateString('ru-RU')}</td>
              <td style="font-size:12px">${new Date(cc.payDate).toLocaleDateString('ru-RU')}</td>
              <td style="font-weight:700;color:#3b82f6">$${(cc.lpAmount/1e6).toFixed(4)}M</td>
              <td><span class="task-status-pill" style="background:${cc.status==='Завершён'?'rgba(34,197,94,0.12)':'rgba(249,115,22,0.12)'};color:${cc.status==='Завершён'?'#22c55e':'#f97316'}">${cc.status}</span></td>
            </tr>`).join('')}
          <tr style="font-weight:800">
            <td colspan="3" style="color:#e2e8f0">ИТОГО</td>
            <td style="color:#3b82f6">$${calledM.toFixed(3)}M</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Disclaimer -->
    <div style="font-size:10px;color:#4a5568;border-top:1px solid #1e293b;padding-top:10px;line-height:1.5">
      Настоящий отчёт носит информационный характер и подготовлен Golden Leaves Ltd исключительно для ${lp.name}.
      Стоимость инвестиций основана на последней оценке портфеля и не гарантирует будущих результатов.
      Лицензия AFSA: ${p.license}.
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:8px">
      <button onclick="exportLPStatementExcel(${lp.id})"
        style="background:rgba(34,197,94,0.12);border:1px solid #22c55e;color:#4ade80;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-file-excel"></i> Скачать Excel
      </button>
      <button onclick="closeLPReport()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;
}

function exportLPStatementExcel(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp || typeof XLSX === 'undefined') return;
  const commitM     = lp.commitment / 1e6;
  const calledM     = lp.calledAmount / 1e6;
  const distribM    = (lp.distributions || 0) / 1e6;
  const totalCommit = lpRegister.reduce((s,l) => s+l.commitment, 0) / 1e6;
  const totalNAV    = portfolio.reduce((s,p) => s+p.value, 0);
  const share       = commitM / totalCommit;
  const navShare    = totalNAV * share;
  const today       = new Date().toLocaleDateString('ru-RU');

  const data = [
    ['CAPITAL ACCOUNT STATEMENT'],
    ['Turan Capital Fund LP · Golden Leaves Ltd'],
    ['Дата:', today],
    [],
    ['LP:', lp.name],
    ['Тип:', lp.type],
    ['Страна:', lp.country],
    [],
    ['CAPITAL ACCOUNT SUMMARY'],
    ['Показатель', 'Значение'],
    ['Commitment', `$${commitM.toFixed(3)}M`],
    ['Capital Called', `$${calledM.toFixed(3)}M`],
    ['Unfunded Commitment', `$${(commitM-calledM).toFixed(3)}M`],
    ['Distributions', `$${distribM.toFixed(3)}M`],
    ['NAV (Current)', `$${navShare.toFixed(3)}M`],
    ['MOIC', calledM > 0 ? `${(navShare/calledM).toFixed(2)}x` : '—'],
    [],
    ['CAPITAL CALL HISTORY'],
    ['#', 'Дата', 'Сумма LP ($M)', 'Статус'],
    ...capitalCalls.map((cc,i) => [
      `CC#${i+1}`, new Date(cc.noticeDate).toLocaleDateString('ru-RU'),
      (share * cc.amount / 1e6).toFixed(4),
      cc.status,
    ]),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:30},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, 'Capital Account');
  XLSX.writeFile(wb, `LP_Statement_${lp.name.replace(/\s/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('📊 Выписка скачана', 'green');
}
