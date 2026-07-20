// ============================================================
//  onboarding.js — GL-CRM-PYRUS-TZ-004
//  Онбординг клиентов по ТЗ: 7 задач, Phase 1–5
//  Формы 1–8 + Маршрутизация + COI + Restricted List
// ============================================================

/* ═══════════════════════════════════════════════════
   ДАННЫЕ — СПРАВОЧНИКИ
═══════════════════════════════════════════════════ */

// Счётчики ID
let obCoiIdCounter    = 2;

// ── Restricted List (Форма 5.2) ──────────────────────────
let restrictedList = [];  // populated at runtime by js/api-auth.js via GET /api/onboarding (see server/index.js)

// ── COI Registry (Форма 5.1) ─────────────────────────────
let coiRegistry = [];  // populated at runtime by js/api-auth.js via GET /api/onboarding (see server/index.js)

// ── Clients (Карточки клиентов) ──────────────────────────
let obClients = [];  // populated at runtime by js/api-auth.js via GET /api/onboarding (see server/index.js)

// ── 7 задач онбординга: шаблоны по направлению ─────────────
// CF&A: Corporate Finance & Advisory
//   Услуги: Advising (Suitability) | Arranging (Appropriateness)
//   Клиент: физлицо или юрлицо, получающее консалтинговые услуги
// FM: Fund Management (управление фондом)
//   Клиент: Limited Partner (LP), инвестирует в фонд
//   НЕТ Suitability/Appropriateness (регуляторные COBS-правила не применяются к LP onboarding в том же объёме)
//   Вместо Engagement Letter → Subscription Agreement
const OB_TASK_TEMPLATES_CFA = [
  { num: '1.1', title: 'Conflict Pre-Check (Go/No-Go)',  phase: 1, role: 'RM', dayStart: 1,  dayEnd: 2,  formKey: 'conflict_precheck' },
  { num: '2.1', title: 'Documentation Collection',       phase: 2, role: 'RM', dayStart: 3,  dayEnd: 5,  formKey: 'doc_collection' },
  { num: '2.2', title: 'Client Due Diligence Outcome',   phase: 2, role: 'CO', dayStart: 5,  dayEnd: 7,  formKey: 'dd_outcome' },
  { num: '3.1', title: 'Client Classification',          phase: 3, role: 'RM', dayStart: 8,  dayEnd: 9,  formKey: 'classification' },
  { num: '3.2', title: 'Suitability / Appropriateness',  phase: 3, role: 'RM', dayStart: 9,  dayEnd: 10, formKey: 'suitability' },
  { num: '4.1', title: 'Draft & Sign Engagement Letter', phase: 4, role: 'RM', dayStart: 11, dayEnd: 13, formKey: 'engagement_letter' },
  { num: '5.1', title: 'Client Activation',              phase: 5, role: 'RM', dayStart: 14, dayEnd: 15, formKey: 'activation' },
];

const OB_TASK_TEMPLATES_FM = [
  { num: '1.1', title: 'Conflict Pre-Check (Go/No-Go)',  phase: 1, role: 'RM', dayStart: 1,  dayEnd: 2,  formKey: 'conflict_precheck' },
  { num: '2.1', title: 'Documentation Collection (LP)',  phase: 2, role: 'RM', dayStart: 3,  dayEnd: 5,  formKey: 'doc_collection' },
  { num: '2.2', title: 'AML / KYC Due Diligence',        phase: 2, role: 'CO', dayStart: 5,  dayEnd: 7,  formKey: 'dd_outcome' },
  { num: '3.1', title: 'LP Qualification Check',         phase: 3, role: 'RM', dayStart: 8,  dayEnd: 9,  formKey: 'lp_qualification' },
  { num: '3.2', title: 'Investment Profile & Suitability',phase: 3, role: 'RM', dayStart: 9,  dayEnd: 10, formKey: 'lp_investment_profile' },
  { num: '4.1', title: 'Subscription Agreement',         phase: 4, role: 'RM', dayStart: 11, dayEnd: 13, formKey: 'subscription_agreement' },
  { num: '5.1', title: 'LP Activation',                  phase: 5, role: 'RM', dayStart: 14, dayEnd: 15, formKey: 'activation' },
];

// Выбираем шаблон по направлению
function getTaskTemplates(direction) {
  return direction === 'FM' ? OB_TASK_TEMPLATES_FM : OB_TASK_TEMPLATES_CFA;
}

// Задачи онбординга (runtime)
let obTasks = [];


/* ═══════════════════════════════════════════════════
   CORE — создание клиента + 7 задач
═══════════════════════════════════════════════════ */

async function createObClient(data) {
  // Calculate target date = startDate + 15 business days (~21 calendar)
  const start = new Date(data.startDate || Date.now());
  const target = obAddBizDays(start, 15);

  const clientPayload = {
    name:             data.name,
    type:             data.type             || 'Corporate',
    classification:   data.classification   || (data.direction==='FM' ? 'Qualified Investor' : 'Professional Client'),
    serviceType:      data.direction==='FM' ? 'LP Investment' : (data.serviceType || 'Advising'),
    lpType:           data.direction==='FM' ? (data.lpType || 'HNWI') : undefined,
    commitment:       data.direction==='FM' ? (data.commitment || 0) : undefined,
    direction:        data.direction        || 'CF&A',
    rm:               data.rm               || currentUserDisplayName(),
    riskRating:       data.riskRating       || 'Medium',
    startDate:        start.toISOString().slice(0, 10),
    targetDate:       target.toISOString().slice(0, 10),
    nextAction:       data.direction==='FM'
      ? 'Start Conflict Pre-Check (Task 1.1) — FM LP Onboarding'
      : 'Start Conflict Pre-Check (Task 1.1) — CF&A Onboarding',
    notes:            data.notes            || '',
    restrictedMatch:  false,
    activated:        false,
  };

  let client;
  try {
    client = await apiFetch('/api/ob-clients', { method: 'POST', body: JSON.stringify(clientPayload) });
  } catch (err) {
    showToast('⚠️ Не удалось создать клиента: ' + err.message, 'red');
    return null;
  }
  obClients.push(client);

  const taskDrafts = buildOnboardingTaskDrafts(client);
  try {
    const createdTasks = await apiFetch('/api/ob-tasks', {
      method: 'POST',
      body: JSON.stringify({ clientId: client.id, tasks: taskDrafts }),
    });
    obTasks.push(...createdTasks.obTasks);
  } catch (err) {
    showToast('⚠️ Клиент создан, но задачи не удалось сохранить: ' + err.message, 'red');
  }

  if (await checkRestrictedList(client)) {     // auto-check
    apiFetch(`/api/ob-clients/${client.id}`, { method: 'PUT', body: JSON.stringify({ restrictedMatch: true }) })
      .catch(err => showToast('⚠️ Не удалось сохранить признак Restricted List: ' + err.message, 'orange'));
  }
  updateBadges();
  return client;
}

// Builds the 7-task checklist for a client (draft objects, no ids — the
// server assigns those via POST /api/ob-tasks).
function buildOnboardingTaskDrafts(client) {
  const start = new Date(client.startDate);
  // Определяем какие задачи должны быть открыты исходя из фазы клиента
  // Правило: все задачи с phase < client.phase считаются completed (демо-данные)
  //          задачи с phase === client.phase → open
  //          задачи с phase > client.phase  → locked
  const clientPhase = client.phase || 1;
  return getTaskTemplates(client.direction).map(tpl => {
    const dueDate = obAddBizDays(start, tpl.dayEnd);
    let status;
    if (client.activated) {
      status = 'completed';
    } else if (tpl.phase < clientPhase) {
      status = 'completed';
    } else if (tpl.phase === clientPhase) {
      status = 'open';
    } else {
      status = 'locked';
    }
    return {
      taskNum:      tpl.num,
      title:        tpl.title,
      phase:        tpl.phase,
      role:         tpl.role,
      formKey:      tpl.formKey,
      dueDate:      dueDate.toISOString().slice(0, 10),
      status,
      formData:     {},
      completedAt:  client.activated ? client.startDate : (tpl.phase < clientPhase ? client.startDate : null),
      completedBy:  client.activated ? 'CEO' : (tpl.phase < clientPhase ? 'RM (Relationship Manager)' : null),
    };
  });
}

/* ── Unlock next task after completing current ────── */
function unlockNextTask(clientId, completedTaskNum) {
  // nextMap: после завершения taskNum → какие следующие разблокировать
  // 3.1 → 3.2: если 3.2 ещё locked (могла быть уже открыта вместе с 3.1 на шаге 2.2)
  // 3.2 → 4.1: только когда 3.2 выполнена (основной триггер к фазе 4)
  // ALSO: 3.1 → 4.1 если 3.2 уже completed (оба завершены)
  const nextMap = {
    '1.1': ['2.1'],
    '2.1': ['2.2'],
    '2.2': ['3.1', '3.2'],  // обе Phase 3 задачи открываются параллельно
    '3.1': ['3.2'],          // FIX: если 3.2 ещё locked — открыть
    '3.2': ['4.1'],
    '4.1': ['5.1'],
    '5.1': [],
  };
  const toUnlock = nextMap[completedTaskNum] || [];
  toUnlock.forEach(num => {
    const t = obTasks.find(x => x.clientId === clientId && x.taskNum === num);
    if (t && t.status === 'locked') t.status = 'open';
  });

  // Дополнительно: если 3.1 завершена и 3.2 уже completed → открываем 4.1
  if (completedTaskNum === '3.1') {
    const t32 = obTasks.find(x => x.clientId === clientId && x.taskNum === '3.2');
    const t41 = obTasks.find(x => x.clientId === clientId && x.taskNum === '4.1');
    if (t32 && t32.status === 'completed' && t41 && t41.status === 'locked') {
      t41.status = 'open';
    }
  }

  // Update client phase
  updateClientPhase(clientId);
}

function updateClientPhase(clientId) {
  const client = obClients.find(c => c.id === clientId);
  if (!client) return;
  const tasks  = obTasks.filter(t => t.clientId === clientId);
  const done   = tasks.filter(t => t.status === 'completed').map(t => t.phase);
  const maxDone = done.length ? Math.max(...done) : 0;
  const open   = tasks.find(t => t.status === 'open');
  client.phase = open ? open.phase : (maxDone + 1 > 5 ? 5 : maxDone + 1);

  // Recalc onboardingStatus
  const today = new Date();
  const target = new Date(client.targetDate);
  const overdue = tasks.some(t => t.status === 'open' && new Date(t.dueDate) < today);
  if (client.activated) {
    client.onboardingStatus = 'Completed';
  } else if (overdue) {
    const daysLate = Math.ceil((today - target) / 86400000);
    client.onboardingStatus = daysLate > 0 ? 'Delayed' : 'At Risk';
  } else {
    client.onboardingStatus = 'On Track';
  }
}

/* ═══════════════════════════════════════════════════
   RESTRICTED LIST CHECK
═══════════════════════════════════════════════════ */

async function checkRestrictedList(client) {
  const nameL = client.name.toLowerCase();
  const match = restrictedList.find(r => nameL.includes(r.company.toLowerCase()) || r.company.toLowerCase().includes(nameL));
  if (match) {
    client.restrictedMatch = true;
    // Auto-create COI — persisted via the API (previously this only ever
    // pushed to the local coiRegistry array and never called the server,
    // so the toast below claiming "COI создан" was a lie: the record
    // silently vanished on the next page reload. POST /api/coi-registry
    // already existed and was correctly built, nothing here called it.
    const coiId = `COI-${new Date().getFullYear()}-${String(++obCoiIdCounter).padStart(3,'0')}`;
    const payload = {
      coiId,
      date:          new Date().toISOString().slice(0,10),
      conflictType:  'Restricted List Match',
      parties:       `${client.name} / Golden Leaves Ltd.`,
      severity:      match.restrictionType === 'Full Restriction' ? 'High' : 'Medium',
      status:        'Open',
      description:   `Клиент "${client.name}" совпадает с записью в Restricted List (${match.company}, ${match.fund}, ${match.ownershipPct}% владение).`,
      measures:      match.cfaAllowed ? 'CF&A разрешено при согласовании.' : 'CF&A услуги запрещены.',
      responsible:   'CO',
      reviewDate:    obAddBizDays(new Date(), 90).toISOString().slice(0,10),
      resolution:    '',
      linkedClientId: client.id,
    };
    try {
      const created = await apiFetch('/api/coi-registry', { method: 'POST', body: JSON.stringify(payload) });
      coiRegistry.push(created);
      showToast(`⚠️ Клиент "${client.name}" найден в Restricted List! COI создан.`, 'red');
    } catch (err) {
      showToast(`⚠️ Клиент "${client.name}" найден в Restricted List, но COI не удалось сохранить: ` + err.message, 'red');
    }
    return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════
   RENDER — ONBOARDING PAGE
═══════════════════════════════════════════════════ */

let obView       = 'board';   // 'board' | 'list'
let obDirFilter  = '';        // '' | 'FM' | 'CF&A'
let obStatusFilter = '';
let obSearch     = '';
let activeObClientId = null;

function renderOnboardingPage() {
  const el = document.getElementById('obContent');
  if (!el) return;
  renderObKPIs();
  renderObContent();
}

function renderObKPIs() {
  const el = document.getElementById('obKPIs');
  if (!el) return;

  // Direction-filtered pool (respects the current tab)
  const pool = obDirFilter
    ? obClients.filter(c => c.direction === obDirFilter)
    : obClients;

  const total     = pool.length;
  const active    = pool.filter(c => !c.activated).length;
  const completed = pool.filter(c => c.activated).length;
  const atRisk    = pool.filter(c => c.onboardingStatus === 'At Risk' || c.onboardingStatus === 'Delayed').length;
  const today     = new Date();
  const overdueTasks = obTasks.filter(t => {
    const client = obClients.find(c => c.id === t.clientId);
    if (obDirFilter && client?.direction !== obDirFilter) return false;
    return t.status === 'open' && new Date(t.dueDate) < today;
  }).length;

  // Direction split (only shown when All tab active)
  const cfaCount = obClients.filter(c => c.direction === 'CF&A').length;
  const fmCount  = obClients.filter(c => c.direction === 'FM').length;
  const fmCommitment = obClients
    .filter(c => c.direction === 'FM' && c.commitment)
    .reduce((s, c) => s + (c.commitment || 0), 0);

  el.innerHTML = `
    <div class="kpi-card" onclick="obStatusFilter='';obSearch='';renderObKPIs();renderObContent();"
      style="cursor:pointer;transition:box-shadow .15s" onmouseover="this.style.boxShadow='0 0 0 1px #3b82f6'" onmouseout="this.style.boxShadow=''">
      <div class="kpi-icon blue"><i class="fas fa-users"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">${obDirFilter ? obDirFilter + ' клиентов' : 'Всего клиентов'}</span>
        <span class="kpi-value">${total}</span>
        <span class="kpi-delta">${active} в онбординге <i class="fas fa-arrow-right" style="font-size:9px;margin-left:3px;opacity:.6"></i></span>
      </div>
    </div>
    <div class="kpi-card" onclick="obStatusFilter='__active__';obSearch='';renderObKPIs();renderObContent();"
      style="cursor:pointer;transition:box-shadow .15s;${obStatusFilter==='__active__'?'box-shadow:0 0 0 1px #f97316':''}"
      onmouseover="this.style.boxShadow='0 0 0 1px #f97316'" onmouseout="this.style.boxShadow='${obStatusFilter==='__active__'?'0 0 0 1px #f97316':''}'">
      <div class="kpi-icon orange"><i class="fas fa-hourglass-half"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">В процессе</span>
        <span class="kpi-value" style="color:#f97316">${active}</span>
        <span class="kpi-delta warning" onclick="event.stopPropagation();obStatusFilter='At Risk';renderObKPIs();renderObContent();"
          style="cursor:pointer;text-decoration:underline dotted" title="Показать только под риском">
          ${atRisk} под риском <i class="fas fa-arrow-right" style="font-size:9px;margin-left:3px;opacity:.6"></i>
        </span>
      </div>
    </div>
    <div class="kpi-card" onclick="obStatusFilter='Completed';obSearch='';renderObKPIs();renderObContent();"
      style="cursor:pointer;transition:box-shadow .15s;${obStatusFilter==='Completed'?'box-shadow:0 0 0 1px #22c55e':''}"
      onmouseover="this.style.boxShadow='0 0 0 1px #22c55e'" onmouseout="this.style.boxShadow='${obStatusFilter==='Completed'?'0 0 0 1px #22c55e':''}'">
      <div class="kpi-icon green"><i class="fas fa-check-circle"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Активированы</span>
        <span class="kpi-value" style="color:#22c55e">${completed}</span>
        <span class="kpi-delta up">Готово <i class="fas fa-arrow-right" style="font-size:9px;margin-left:3px;opacity:.6"></i></span>
      </div>
    </div>
    <div class="kpi-card" onclick="obStatusFilter='__overdue__';obSearch='';renderObKPIs();renderObContent();"
      style="cursor:pointer;transition:box-shadow .15s;${obStatusFilter==='__overdue__'?'box-shadow:0 0 0 1px #ef4444':''}"
      onmouseover="this.style.boxShadow='0 0 0 1px ${overdueTasks>0?'#ef4444':'#22c55e'}'" onmouseout="this.style.boxShadow='${obStatusFilter==='__overdue__'?'0 0 0 1px #ef4444':''}'">
      <div class="kpi-icon red"><i class="fas fa-exclamation-triangle"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Просроченных задач</span>
        <span class="kpi-value" style="color:${overdueTasks>0?'#ef4444':'#22c55e'}">${overdueTasks}</span>
        <span class="kpi-delta ${overdueTasks>0?'down':''}">${overdueTasks>0?'Требуют внимания <i class="fas fa-arrow-right" style="font-size:9px;margin-left:3px;opacity:.6"></i>':'Всё в норме'}</span>
      </div>
    </div>
    <div class="kpi-card" style="padding:14px 16px;gap:0;flex-direction:column;align-items:flex-start;min-width:180px">
      <div style="font-size:10px;font-weight:700;color:#5a6b8a;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">
        <i class="fas fa-filter" style="margin-right:5px;color:#475569"></i>Фильтр по направлению
      </div>
      <div style="display:flex;gap:8px;width:100%">
        <button onclick="obDirFilter='CF&A';renderObKPIs();renderObContent();"
          style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;
                 border-radius:10px;cursor:pointer;transition:all .15s;
                 background:${obDirFilter==='CF&A'?'rgba(139,92,246,0.18)':'rgba(139,92,246,0.07)'};
                 border:1px solid ${obDirFilter==='CF&A'?'rgba(139,92,246,0.5)':'rgba(139,92,246,0.2)'}">
          <span style="font-size:18px;font-weight:800;color:#a78bfa">${cfaCount}</span>
          <span style="font-size:10px;font-weight:700;color:#8b5cf6">CF&A</span>
          <span style="font-size:9px;color:#5a6b8a">${obClients.filter(c=>c.direction==='CF&A'&&!c.activated).length} актив.</span>
        </button>
        <button onclick="obDirFilter='FM';renderObKPIs();renderObContent();"
          style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;
                 border-radius:10px;cursor:pointer;transition:all .15s;
                 background:${obDirFilter==='FM'?'rgba(59,130,246,0.18)':'rgba(59,130,246,0.07)'};
                 border:1px solid ${obDirFilter==='FM'?'rgba(59,130,246,0.5)':'rgba(59,130,246,0.2)'}">
          <span style="font-size:18px;font-weight:800;color:#60a5fa">${fmCount}</span>
          <span style="font-size:10px;font-weight:700;color:#3b82f6">FM</span>
          <span style="font-size:9px;color:#3b82f6;font-weight:600">${fmtCurrency(fmCommitment, currencyForFundId(activeFundId))}</span>
        </button>
        ${obDirFilter ? `
        <button onclick="obDirFilter='';renderObKPIs();renderObContent();"
          style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 8px;
                 border-radius:10px;cursor:pointer;
                 background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25)">
          <i class="fas fa-times" style="color:#64748b;font-size:13px"></i>
          <span style="font-size:9px;color:#64748b">Все</span>
        </button>` : ''}
      </div>
    </div>`;
}

function renderObContent() {
  const el = document.getElementById('obContent');
  if (!el) return;

  // Highlight direction tabs
  const tabAll = document.getElementById('obTabAll');
  const tabCfa = document.getElementById('obTabCfa');
  const tabFm  = document.getElementById('obTabFm');
  if (tabAll) tabAll.style.opacity = obDirFilter === '' ? '1' : '0.45';
  if (tabCfa) tabCfa.style.opacity = obDirFilter === 'CF&A' ? '1' : '0.45';
  if (tabFm)  tabFm.style.opacity  = obDirFilter === 'FM'   ? '1' : '0.45';

  // Filter
  let clients = obClients.filter(c => {
    if (obDirFilter  && c.direction !== obDirFilter)  return false;
    if (obStatusFilter === '__active__') {
      // В процессе = все не-активированные
      if (c.activated) return false;
    } else if (obStatusFilter === 'Completed') {
      // Активированы — поле activated
      if (!c.activated) return false;
    } else if (obStatusFilter === '__overdue__') {
      // Клиенты, у которых есть хотя бы одна открытая задача с просроченным dueDate
      const today = new Date(); today.setHours(0,0,0,0);
      const hasOverdue = obTasks.some(t =>
        t.clientId === c.id && t.status === 'open' && new Date(t.dueDate) < today
      );
      if (!hasOverdue) return false;
    } else if (obStatusFilter) {
      if (c.onboardingStatus !== obStatusFilter) return false;
    }
    if (obSearch && !c.name.toLowerCase().includes(obSearch.toLowerCase()) &&
        !c.clientId.toLowerCase().includes(obSearch.toLowerCase())) return false;
    return true;
  });

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" id="obKPIs" style="margin-bottom:20px"></div>

    <!-- Toolbar -->
    <div class="card" style="margin-bottom:16px">
      <div style="padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <div style="position:relative;flex:1;min-width:180px">
          <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#4a5568;font-size:12px"></i>
          <input type="text" placeholder="Поиск клиента..." value="${obSearch}"
            oninput="obSearch=this.value;renderObContent()"
            style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px 8px 32px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        </div>
        <select onchange="obStatusFilter=this.value;renderObKPIs();renderObContent()"
          style="background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px">
          <option value="">Все статусы</option>
          <option value="__active__" ${obStatusFilter==='__active__'?'selected':''}>⏳ В процессе</option>
          <option value="On Track" ${obStatusFilter==='On Track'?'selected':''}>✅ On Track</option>
          <option value="At Risk" ${obStatusFilter==='At Risk'?'selected':''}>⚠️ At Risk</option>
          <option value="Delayed" ${obStatusFilter==='Delayed'?'selected':''}>🔴 Delayed</option>
          <option value="__overdue__" ${obStatusFilter==='__overdue__'?'selected':''}>⏰ С просроченными задачами</option>
          <option value="Completed" ${obStatusFilter==='Completed'?'selected':''}>🏁 Completed</option>
        </select>
        ${obDirFilter ? `<span style="font-size:11px;background:${obDirFilter==='CF&A'?'rgba(139,92,246,0.12)':'rgba(34,197,94,0.10)'};border:1px solid ${obDirFilter==='CF&A'?'rgba(139,92,246,0.3)':'rgba(34,197,94,0.3)'};color:${obDirFilter==='CF&A'?'#a78bfa':'#4ade80'};padding:4px 10px;border-radius:20px;font-weight:700">
          ${obDirFilter==='CF&A'?'📊':'🏦'} ${obDirFilter}
          <span onclick="obDirFilter='';renderObContent()" style="margin-left:5px;cursor:pointer;color:#ef4444">✕</span>
        </span>` : ''}
        <button onclick="openNewObClientModal()"
          style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;white-space:nowrap">
          <i class="fas fa-plus" style="margin-right:6px"></i>Новый клиент
          ${obDirFilter ? `<span style="font-size:10px;opacity:.8">(${obDirFilter})</span>` : ''}
        </button>
      </div>
    </div>

    <!-- Phase board -->
    <div class="ob-phase-board" id="obPhaseBoard">
      ${renderObPhaseBoard(clients)}
    </div>

    <!-- Client list table -->
    <div class="card" style="margin-top:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-list" style="color:#3b82f6;margin-right:6px"></i>Реестр клиентов</span>
        <span style="font-size:12px;color:#8a9bbf">${clients.length} клиентов</span>
      </div>
      ${renderObClientTable(clients)}
    </div>`;

  renderObKPIs();
}

function renderObPhaseBoard(clients) {
  const PHASES = [
    { num:1, label:'Phase 1', sub:'Conflict Check',    color:'#8b5cf6', icon:'fa-search' },
    { num:2, label:'Phase 2', sub:'Documentation',     color:'#f97316', icon:'fa-folder-open' },
    { num:3, label:'Phase 3', sub:'KYC/Classification',color:'#3b82f6', icon:'fa-shield-alt' },
    { num:4, label:'Phase 4', sub:'Engagement Letter', color:'#22c55e', icon:'fa-file-signature' },
    { num:5, label:'Phase 5', sub:'Activation',        color:'#eab308', icon:'fa-rocket' },
  ];

  return `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:8px">
    ${PHASES.map(p => {
      // Phase 5: показываем активированных клиентов (они завершили онбординг)
      // Phase 1–4: только не-активированных в этой фазе
      const inPhase = p.num === 5
        ? clients.filter(c => c.activated || (c.phase === 5 && !c.activated))
        : clients.filter(c => c.phase === p.num && !c.activated);
      return `
        <div style="background:#1c2333;border-radius:10px;padding:12px;border-top:3px solid ${p.color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div style="width:28px;height:28px;background:${p.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <i class="fas ${p.icon}" style="color:${p.color};font-size:11px"></i>
            </div>
            <div>
              <div style="font-size:11px;font-weight:800;color:#e2e8f0">${p.label}</div>
              <div style="font-size:10px;color:#8a9bbf">${p.sub}</div>
            </div>
            <span style="margin-left:auto;background:${p.color}20;color:${p.color};border-radius:20px;padding:2px 8px;font-size:11px;font-weight:700">${inPhase.length}</span>
          </div>
          ${inPhase.map(c => `
            <div onclick="openObClientModal(${c.id})"
              style="background:#0f1623;border-radius:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer;
                     border:1px solid ${c.activated ? 'rgba(34,197,94,0.3)' : '#2a3448'};transition:border-color 0.2s"
              onmouseover="this.style.borderColor='${p.color}'" onmouseout="this.style.borderColor='${c.activated ? 'rgba(34,197,94,0.3)' : '#2a3448'}'">
              <div style="font-size:12px;font-weight:700;color:#e2e8f0;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-size:10px;color:#8a9bbf">${c.clientId}</span>
                ${c.activated
                  ? '<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(34,197,94,0.15);color:#22c55e">✅ Active</span>'
                  : obStatusBadge(c.onboardingStatus)}
                ${c.direction==='FM' && c.commitment
                  ? `<span style="font-size:9px;color:#3b82f6;font-weight:700">${fmtCurrency(c.commitment, currencyForFundId(activeFundId))}</span>`
                  : c.serviceType && c.direction==='CF&A'
                    ? `<span style="font-size:9px;color:#8b5cf6;font-weight:700">${c.serviceType}</span>`
                    : ''}
                ${c.restrictedMatch ? '<span style="font-size:9px;background:rgba(239,68,68,0.15);color:#ef4444;border-radius:4px;padding:1px 5px;font-weight:700">⚠ RESTRICTED</span>' : ''}
              </div>
            </div>`).join('')}
          ${!inPhase.length ? `<div style="text-align:center;padding:16px 0;color:#4a5568;font-size:11px"><i class="fas fa-inbox"></i><br>Нет клиентов</div>` : ''}
        </div>`;
    }).join('')}
  </div>`;
}

function renderObClientTable(clients) {
  if (!clients.length) return `<div style="padding:40px;text-align:center;color:#4a5568"><i class="fas fa-users" style="font-size:32px;margin-bottom:10px;display:block;opacity:.4"></i>Клиентов не найдено</div>`;
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th><th>Клиент</th><th>Тип</th><th>Направление</th>
            <th>Фаза</th><th>Статус</th><th>Риск</th><th>RM</th>
            <th>Дата начала</th><th>Цель</th><th style="text-align:center">Задачи</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(c => {
            const tasks = obTasks.filter(t => t.clientId === c.id);
            const done  = tasks.filter(t => t.status === 'completed').length;
            const today = new Date();
            const overdue = tasks.some(t => t.status === 'open' && new Date(t.dueDate) < today);
            const isFm = c.direction === 'FM';
            const detailLine = isFm
              ? `<div style="font-size:10px;color:#3b82f6">${c.lpType||'LP'} · ${c.commitment?fmtCurrency(c.commitment, currencyForFundId(activeFundId)):'—'}</div>`
              : `<div style="font-size:10px;color:#8b5cf6">${c.serviceType||'—'} · ${c.classification||'—'}</div>`;
            return `
              <tr onclick="openObClientModal(${c.id})" style="cursor:pointer">
                <td style="font-size:11px;color:#8b5cf6;font-weight:700">${c.clientId}</td>
                <td>
                  <div style="font-weight:700;color:#e2e8f0;font-size:13px">${escapeHtml(c.name)}</div>
                  ${detailLine}
                  ${c.restrictedMatch ? '<div style="font-size:10px;color:#ef4444;font-weight:700">⚠ Restricted List</div>' : ''}
                </td>
                <td style="font-size:12px">${statusLabel(c.type)}</td>
                <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:${isFm?'rgba(59,130,246,0.12)':'rgba(139,92,246,0.12)'};color:${isFm?'#3b82f6':'#8b5cf6'}">${c.direction}</span></td>
                <td><span style="font-size:11px;font-weight:700;color:#f97316">Phase ${c.phase}</span></td>
                <td>${obStatusBadge(c.onboardingStatus)}</td>
                <td>${obRiskBadge(c.riskRating)}</td>
                <td style="font-size:11px;color:#94a3b8">${c.rm.split(' ')[0]}</td>
                <td style="font-size:12px;color:#8a9bbf">${c.startDate}</td>
                <td style="font-size:12px;color:${new Date(c.targetDate)<today&&!c.activated?'#ef4444':'#8a9bbf'}">${c.targetDate}</td>
                <td style="text-align:center">
                  <div style="font-size:11px;font-weight:700;color:${overdue?'#ef4444':done===7?'#22c55e':'#f97316'}">${done}/7 ${overdue?'⚠':''}</div>
                  <div style="width:60px;height:4px;background:#2a3448;border-radius:2px;margin:3px auto">
                    <div style="width:${Math.round(done/7*100)}%;height:4px;background:${done===7?'#22c55e':'#3b82f6'};border-radius:2px"></div>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Status/Risk badge helpers ───────────────────────── */
function obStatusBadge(s) {
  const cfg = {
    'On Track':  { bg:'rgba(34,197,94,0.12)',  c:'#22c55e' },
    'At Risk':   { bg:'rgba(249,115,22,0.12)', c:'#f97316' },
    'Delayed':   { bg:'rgba(239,68,68,0.12)',  c:'#ef4444' },
    'Completed': { bg:'rgba(59,130,246,0.12)', c:'#3b82f6' },
  }[s] || { bg:'rgba(100,116,139,0.12)', c:'#94a3b8' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg};color:${cfg.c};white-space:nowrap">${s}</span>`;
}
function obRiskBadge(r) {
  const cfg = { Low:{ bg:'rgba(34,197,94,0.12)', c:'#22c55e' }, Medium:{ bg:'rgba(249,115,22,0.12)', c:'#f97316' }, High:{ bg:'rgba(239,68,68,0.12)', c:'#ef4444' } }[r] || {};
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg||'#1c2333'};color:${cfg.c||'#94a3b8'}">${r ? statusLabel(r) : '—'}</span>`;
}

/* ═══════════════════════════════════════════════════
   MODAL — Client Card (detail)
═══════════════════════════════════════════════════ */

function openObClientModal(clientId) {
  activeObClientId = clientId;
  const modal   = document.getElementById('modal-ob-client');
  const overlay = document.getElementById('obClientOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  renderObClientModal(clientId);
  modal.style.display = 'flex';
}

function closeObClientModal() {
  const modal   = document.getElementById('modal-ob-client');
  const overlay = document.getElementById('obClientOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  activeObClientId = null;
}

function kycChecklistItems(c) {
  const items = [
    { label: 'Identity Verification', done: !!c.identityVerified },
    { label: 'Sanctions Screening', done: !!c.sanctionsCleared, extra: c.sanctionsCheckedAt || '' },
    { label: 'PEP Screening', done: !!c.pepStatus, extra: c.pepStatus || 'Не проверено' },
  ];
  if (c.direction === 'FM') {
    items.push({ label: 'Source of Funds', done: !!c.sofVerified });
    items.push({ label: 'Source of Wealth', done: !!c.sowVerified });
  }
  items.push({ label: 'Professional Client Status', done: !!c.professionalClientVerified });
  return items;
}

function renderObClientModal(clientId) {
  const c = obClients.find(x => x.id === clientId);
  if (!c) return;
  const tasks = obTasks.filter(t => t.clientId === clientId);
  const el = document.getElementById('obClientModalContent');
  if (!el) return;

  const today = new Date();
  const daysLeft = Math.ceil((new Date(c.targetDate) - today) / 86400000);

  el.innerHTML = `
    <!-- Client header -->
    <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #2a3448">
      <div style="width:52px;height:52px;border-radius:14px;background:${c.direction==='FM'?'rgba(59,130,246,0.15)':'rgba(139,92,246,0.15)'};
        display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:${c.direction==='FM'?'#3b82f6':'#8b5cf6'};flex-shrink:0">
        ${c.name.slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-size:17px;font-weight:800;color:#f1f5f9">${escapeHtml(c.name)}</span>
          ${c.restrictedMatch ? '<span style="font-size:11px;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:2px 8px;font-weight:700">⚠ Restricted List</span>' : ''}
          ${c.activated ? '<span style="font-size:11px;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:2px 8px;font-weight:700">✅ Активен</span>' : ''}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#8a9bbf">
          <span style="color:#8b5cf6;font-weight:700">${c.clientId}</span>
          <span>${statusLabel(c.type)}</span>
          <span style="font-weight:700;color:${c.direction==='FM'?'#3b82f6':'#8b5cf6'}">${c.direction}</span>
          ${c.direction==='FM'
            ? `<span style="background:rgba(59,130,246,0.1);color:#60a5fa;border-radius:5px;padding:1px 7px;font-weight:700">🏦 LP · ${c.lpType||'HNWI'}</span>
               <span>${c.classification}</span>`
            : `<span style="background:rgba(139,92,246,0.1);color:#a78bfa;border-radius:5px;padding:1px 7px;font-weight:700">📊 ${c.serviceType||'CF&A'}</span>
               <span>${c.classification}</span>`}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${obStatusBadge(c.onboardingStatus)}
        <div style="font-size:11px;color:${daysLeft<0?'#ef4444':daysLeft<3?'#f97316':'#8a9bbf'};margin-top:4px">
          ${c.activated ? 'Завершён' : daysLeft >= 0 ? `Осталось ${daysLeft}д` : `Просрочено ${Math.abs(daysLeft)}д`}
        </div>
      </div>
    </div>

    <!-- Info grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
      ${c.direction === 'FM' ? [
        ['RM', c.rm.split('(')[0].trim()],
        ['Тип LP', c.lpType || '—'],
        ['Квалификация', c.classification],
        ['Commitment', c.commitment ? fmtCurrency(c.commitment, currencyForFundId(activeFundId)) : '—'],
        ['Дата начала', c.startDate],
        ['Дата цели', c.targetDate],
        ['Риск', c.riskRating],
        ['Следующий шаг', c.nextAction],
      ].map(([k,v]) => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:3px">${k}</div>
          <div style="font-size:13px;color:#e2e8f0;font-weight:600">${escapeHtml(v)||'—'}</div>
        </div>`).join('') : [
        ['RM', c.rm.split('(')[0].trim()],
        ['Тип услуги', c.serviceType],
        ['Классификация', c.classification],
        ['Риск', c.riskRating],
        ['Дата начала', c.startDate],
        ['Дата цели', c.targetDate],
        ['Фаза', 'Phase ' + c.phase],
        ['Следующий шаг', c.nextAction],
      ].map(([k,v]) => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:3px">${k}</div>
          <div style="font-size:13px;color:#e2e8f0;font-weight:600">${escapeHtml(v)||'—'}</div>
        </div>`).join('')}
    </div>

    <!-- Notes -->
    ${c.notes ? `<div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:20px;font-size:12px;color:#94a3b8;border-left:3px solid #3b82f6">${escapeHtml(c.notes)}</div>` : ''}

    <!-- KYC Checklist (Onboarding Templates package: Identity/SOF/SOW/PEP/
         Sanctions/Professional Client/CRS) — summary projected from the
         2.2 (dd_outcome) and 3.1 (classification) task forms below; full
         detail (which list, which tool, notes) lives in each task's data. -->
    <div style="font-size:12px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:12px">
      <i class="fas fa-shield-alt" style="margin-right:6px;color:#3b82f6"></i>KYC чек-лист
    </div>
    <div style="background:#1c2333;border-radius:10px;padding:0 14px;margin-bottom:20px">
      ${kycChecklistItems(c).map((item, i, arr) => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;${i<arr.length-1?'border-bottom:1px solid #2a3448;':''}font-size:12px">
          <i class="fas ${item.done?'fa-check-circle':'fa-times-circle'}" style="color:${item.done?'#22c55e':'#5a6b8a'};width:16px;flex-shrink:0;text-align:center"></i>
          <span style="flex:1;color:#e2e8f0">${item.label}</span>
          <span style="color:#8a9bbf;font-size:11px">${item.extra||''}</span>
        </div>`).join('')}
    </div>

    <!-- 7 Tasks timeline -->
    <div style="font-size:12px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:12px">
      <i class="fas fa-tasks" style="margin-right:6px;color:#f97316"></i>7 задач онбординга
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      ${tasks.map(t => renderObTaskRow(t, c)).join('')}
    </div>

    <!-- Footer actions -->
    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a3448">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="openNewObClientModal(${c.id})"
          style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-edit"></i> Редактировать
        </button>
        ${!c.activated ? `<button onclick="deleteObClient(${c.id})"
          style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-trash"></i> Удалить
        </button>` : ''}
      </div>
      <button onclick="closeObClientModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;
}

function renderObTaskRow(task, client) {
  const today   = new Date();
  const due     = new Date(task.dueDate);
  const isOverdue = task.status === 'open' && due < today;
  const statusCfg = {
    locked:    { icon:'fa-lock',         color:'#4a5568',  bg:'rgba(74,85,105,0.12)',  label:'Заблокирована' },
    open:      { icon:'fa-play-circle',  color:'#f97316',  bg:'rgba(249,115,22,0.12)', label:'Открыта' },
    completed: { icon:'fa-check-circle', color:'#22c55e',  bg:'rgba(34,197,94,0.12)',  label:'Выполнена' },
    rejected:  { icon:'fa-times-circle', color:'#ef4444',  bg:'rgba(239,68,68,0.12)',  label:'Отклонена' },
    escalated: { icon:'fa-arrow-up',     color:'#eab308',  bg:'rgba(234,179,8,0.12)',  label:'Эскалирована' },
  }[task.status] || {};

  const PHASE_COLORS = ['','#8b5cf6','#f97316','#3b82f6','#22c55e','#eab308'];

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0f1623;border-radius:10px;
      border:1px solid ${isOverdue?'rgba(239,68,68,0.3)':'#2a3448'};border-left:3px solid ${PHASE_COLORS[task.phase]||'#2a3448'};
      ${task.status !== 'locked' ? 'cursor:pointer;' : ''}"
      ${task.status !== 'locked' ? `onclick="openObTaskForm(${task.id})"
        onmouseover="this.style.borderColor='${PHASE_COLORS[task.phase]||'#3b82f6'}'"
        onmouseout="this.style.borderColor='${isOverdue?'rgba(239,68,68,0.3)':'#2a3448'}'"`  : ''}>
      <div style="width:30px;height:30px;border-radius:8px;background:${statusCfg.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas ${statusCfg.icon}" style="color:${statusCfg.color};font-size:13px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:800;color:${PHASE_COLORS[task.phase]};letter-spacing:.5px">TASK ${task.taskNum}</span>
          <span style="font-size:13px;font-weight:600;color:${task.status==='locked'?'#4a5568':'#e2e8f0'}">${task.title}</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;font-size:11px;color:#5a6b8a">
          <span><i class="fas fa-user" style="margin-right:3px"></i>${task.role}</span>
          <span><i class="fas fa-calendar" style="margin-right:3px"></i>${task.dueDate}</span>
          ${isOverdue ? '<span style="color:#ef4444;font-weight:700">⚠ Просрочено</span>' : ''}
          ${task.completedAt ? `<span style="color:#22c55e"><i class="fas fa-check"></i> ${task.completedAt}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${statusCfg.bg};color:${statusCfg.color}">${statusCfg.label}</span>
        ${task.status !== 'locked' ? `<i class="fas fa-chevron-right" style="color:#4a5568;font-size:11px"></i>` : ''}
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════
   TASK FORM — инлайн внутри modal-ob-client
   (NO second modal — форма рендерится поверх списка
    задач прямо внутри карточки клиента)
═══════════════════════════════════════════════════ */

let activeObTaskId   = null;
let obModalView      = 'client'; // 'client' | 'form'

/**
 * Открыть форму задачи ВНУТРИ уже открытого modal-ob-client.
 * Заменяем содержимое #obClientModalContent на форму + кнопку «← Назад».
 */
function openObTaskForm(taskId) {
  activeObTaskId = taskId;
  const task   = obTasks.find(t => t.id === taskId);
  if (!task || task.status === 'locked') return;
  const client = obClients.find(c => c.id === task.clientId);
  if (!client) return;

  // ── Restore draft from localStorage (if task not yet completed) ──
  if (task.status !== 'completed' && task.status !== 'rejected') {
    const draftFd = obDraftLoad(task.id);
    if (draftFd) {
      // Merge draft into task.formData (draft wins over any previous formData)
      task.formData = Object.assign({}, task.formData || {}, draftFd);
    }
  }

  obModalView = 'form';

  // Убедимся, что modal-ob-client открыт
  const modal = document.getElementById('modal-ob-client');
  if (modal && modal.style.display !== 'flex') {
    activeObClientId = client.id;
    const overlay = document.getElementById('obClientOverlay');
    if (overlay) overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    modal.style.display = 'flex';
  }

  const el = document.getElementById('obClientModalContent');
  if (!el) return;

  const PHASE_COLORS = ['','#8b5cf6','#f97316','#3b82f6','#22c55e','#eab308'];
  const isCompleted  = task.status === 'completed' || task.status === 'rejected';

  el.innerHTML = `
    <!-- ← Назад к задачам -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #2a3448">
      <button onclick="closeObTaskForm()" title="Назад к задачам"
        style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
               padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px">
        <i class="fas fa-arrow-left"></i> Назад
      </button>
      <div style="flex:1;min-width:0">
        <div style="font-size:11px;color:#8a9bbf;margin-bottom:1px">${client.name} · ${client.clientId}</div>
        <div style="font-size:14px;font-weight:800;color:#f1f5f9">
          <span style="color:${PHASE_COLORS[task.phase]};margin-right:6px">TASK ${task.taskNum}</span>${task.title}
        </div>
      </div>
      ${isCompleted
        ? ('<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">'
           + (task.status === 'rejected'
               ? '<span style="background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700">❌ Отклонена</span>'
               : '<span style="background:rgba(34,197,94,0.12);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700">✅ Выполнена</span>')
           + (currentUserRole() !== 'RELATIONSHIP_MANAGER'
               ? '<button onclick="reopenObTask(' + taskId + ')" title="Открыть задачу для редактирования" style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:#f97316;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700"><i class=\\"fas fa-pen\\" style=\\"margin-right:4px\\"></i>Редактировать</button>'
               : '')
           + '</div>')
        : `<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
             <span id="obDraftIndicator" style="font-size:10px;color:#4a5568;display:none;align-items:center;gap:4px">
               <i class="fas fa-circle-check" style="font-size:9px"></i>Автосохранено
             </span>
             <span style="background:rgba(249,115,22,0.12);color:#f97316;border:1px solid rgba(249,115,22,0.3);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700">
               <i class="fas fa-clock" style="margin-right:4px"></i>Срок: ${task.dueDate}
             </span>
           </div>`}
      ${obTaskPdfButtonHtml(task, client)}
    </div>

    <!-- Скроллируемый контейнер формы -->
    <div style="overflow-y:auto;max-height:calc(100% - 70px);padding-right:4px">
      ${renderChineseWallBanner(client)}
      ${buildTaskForm(task, client)}
      ${renderObTaskComments(task)}
    </div>`;

  // ── Post-render init ───────────────────────────────────────
  setTimeout(function() {
    // 1. doc_collection: set initial button state
    if (task.formKey === 'doc_collection' && task.status !== 'completed' && task.status !== 'rejected') {
      const list = document.getElementById('docRequiredList');
      if (list) {
        const total = list.querySelectorAll('select[id^="f_doc_"]').length;
        if (total) obDocStatusChange(-1, '', total, false);
      }
    }
    // 2. classification: wire up score cards + retail warning + opt-up/down blocks
    if (task.formKey === 'classification') {
      obClassScoreInit(task.id, client.type);
    }
    // 2b. lp_qualification (FM 3.1): wire up LP score cards
    if (task.formKey === 'lp_qualification') {
      obLpQualScoreInit(task.id, client.type);
    }
    // 2c. activation (5.1): init amendments runtime array from saved formData
    if (task.formKey === 'activation') {
      const savedAm = task.formData && (task.formData.f_amendments || task.formData.amendments);
      try {
        window._obAmendments = savedAm ? JSON.parse(savedAm) : [];
      } catch(e) {
        window._obAmendments = [];
      }
      // Re-render if any amendments exist (for completed view or editing)
      if (window._obAmendments.length > 0) {
        _obRenderAmendments(task.id);
      }
    }
    // 3. Auto-save: attach change listeners to all form fields
    if (task.status !== 'completed' && task.status !== 'rejected') {
      obDraftAttachListeners(task.id, task.formKey);
    }
  }, 0);
}

/**
 * Вернуться к карточке клиента (из формы)
 */
function closeObTaskForm() {
  obModalView = 'client';
  activeObTaskId = null;
  if (activeObClientId != null) {
    renderObClientModal(activeObClientId);
  }
}

// Free-text comment thread on a task — separate from the wizard's own
// structured form fields (task.formData), persisted via POST
// /api/ob-tasks/:id/comments (server/index.js). Available regardless of
// task status, same reasoning as obTaskPdfButtonHtml above.
function renderObTaskComments(task) {
  const comments = task.comments || [];
  return `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #2a3448">
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-comment-dots" style="margin-right:5px;color:#3b82f6"></i>Комментарии (${comments.length})
      </div>
      ${!comments.length ? `<div style="font-size:12px;color:#475569;font-style:italic;padding:12px 0;text-align:center">Комментариев нет</div>` :
        [...comments].reverse().map(c => `
          <div style="background:#0f1623;border-radius:10px;padding:10px 14px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:12px;font-weight:700;color:#e2e8f0">${escapeHtml(c.author)}</span>
              <span style="font-size:10px;color:#64748b">${escapeHtml(c.createdAt || '')}</span>
            </div>
            <div style="font-size:12px;color:#94a3b8;line-height:1.6">${escapeHtml(c.text)}</div>
          </div>`).join('')}
      <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-top:8px">
        <textarea id="obTaskCommentText_${task.id}" rows="2"
          style="width:100%;background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:12px;resize:vertical;box-sizing:border-box;margin-bottom:8px"
          placeholder="Комментарий к задаче..."></textarea>
        <button onclick="obAddTaskComment(${task.id})"
          style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:6px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-paper-plane" style="margin-right:5px"></i>Добавить
        </button>
      </div>
    </div>`;
}

async function obAddTaskComment(taskId) {
  const task = obTasks.find(t => t.id === taskId);
  if (!task) return;
  const textEl = document.getElementById(`obTaskCommentText_${taskId}`);
  const text = textEl?.value?.trim();
  if (!text) { showToast('⚠️ Введите текст комментария', 'red'); return; }
  try {
    const comment = await apiFetch(`/api/ob-tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
    task.comments = task.comments || [];
    task.comments.push(comment);
    if (activeObTaskId === taskId) openObTaskForm(taskId); // re-render to show the new comment
    showToast('✅ Комментарий добавлен', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить комментарий: ' + err.message, 'red');
  }
}

// PDF/document preview-and-print button for a task — available regardless
// of whether the task is finished, not just after completion, so the user
// can preview/print while still filling in the form (reads whatever is in
// task.formData so far, same as the completed view reads the final
// submitted data). Shared by openObTaskForm's header (top, always visible
// without scrolling) and buildTaskForm's footer (bottom, next to Submit).
function obTaskPdfButtonHtml(task, client) {
  return task.formKey === 'dd_outcome'
    ? '<button onclick="obGenerateDDReport(' + task.id + ')" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px"><i class=\\"fas fa-file-pdf\\"></i>Сохранить PDF</button>'
    : (task.formKey === 'engagement_letter')
    ? '<button onclick="obGenerateTermSheet(' + task.id + ')" style="background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:#fff;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px"><i class=\\"fas fa-file-contract\\"></i>Term Sheet PDF</button>'
    : (task.formKey === 'subscription_agreement')
    ? '<button onclick="obGenerateSubscriptionAgreement(' + task.id + ')" style="background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:#fff;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px"><i class=\\"fas fa-file-contract\\"></i>SA PDF</button>'
    : (task.formKey === 'activation' && client.direction === 'FM' && (task.formData?.f_lpaUrl || task.formData?.lpaUrl || client.lpaUrl))
    ? '<button onclick="obViewLpaFromTask(' + task.id + ')" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px"><i class=\\"fas fa-file-contract\\"></i>Открыть LPA</button>'
    : (task.formKey === 'activation' && (task.formData?.f_contractUrl || task.formData?.contractUrl || client.contractUrl))
    ? '<button onclick="obViewContractFromTask(' + task.id + ')" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;display:flex;align-items:center;gap:5px"><i class=\\"fas fa-file-pdf\\"></i>Открыть договор</button>'
    : '';
}

/* ── Build form HTML by formKey ───────────────────── */
function buildTaskForm(task, client) {
  const fd = task.formData || {};
  const isCompleted = task.status === 'completed' || task.status === 'rejected';
  const disabledAttr = isCompleted ? 'disabled' : '';
  const inputStyle = `width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box;${isCompleted?'opacity:.7;':''}`;
  const selectStyle = inputStyle;
  const labelStyle  = `font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase`;
  const formGroupStyle = `margin-bottom:14px`;

  // Header (краткая полоска, без дублирования — основной заголовок в openObTaskForm)
  const PHASE_COLORS = ['','#8b5cf6','#f97316','#3b82f6','#22c55e','#eab308'];
  let html = ``; // без отдельного header-блока

  // Form body by type
  switch (task.formKey) {

    /* ─── ФОРМА 2 — Conflict Pre-Check (1.1) ──────── */
    case 'conflict_precheck': {
      const isFM_cp = client.direction === 'FM';
      const cpColor = isFM_cp ? '#3b82f6' : '#8b5cf6';
      const cpLabel = isFM_cp ? '🏦 FM — LP Conflict Pre-Check' : '📊 CF&A — Conflict Pre-Check';

      html += `
        <!-- Direction header -->
        <div style="background:rgba(${isFM_cp?'59,130,246':'139,92,246'},0.08);border:1px solid rgba(${isFM_cp?'59,130,246':'139,92,246'},0.25);border-radius:8px;padding:9px 14px;margin-bottom:14px">
          <span style="font-size:12px;font-weight:700;color:${cpColor}">${cpLabel}</span>
          ${isFM_cp ? `<div style="font-size:11px;color:#64748b;margin-top:4px">
            Проверка конфликтов перед инвестированием LP в фонд под управлением FM</div>` : `<div style="font-size:11px;color:#64748b;margin-top:4px">
            Проверка конфликтов перед началом консультационного / организационного мандата CF&A</div>`}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата проверки *</label>
          <input type="date" id="f_checkDate" value="${fd.checkDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${buildSelect('f_restrictedMatch','Совпадение с Restricted List',['Нет','Да'],fd.restrictedMatch,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_clientMatch','Совпадение с существующими клиентами',['Нет','Да'],fd.clientMatch,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_staffConflict','Конфликт с сотрудниками',['Нет','Да'],fd.staffConflict,disabledAttr,selectStyle,labelStyle)}
          ${isFM_cp
            ? buildSelect('f_portfolioConflict','Конфликт с портфельными компаниями фонда',['Нет','Да'],fd.portfolioConflict,disabledAttr,selectStyle,labelStyle)
            : buildSelect('f_dealConflict','Конфликт по существующим мандатам',['Нет','Да'],fd.dealConflict,disabledAttr,selectStyle,labelStyle)
          }
          ${isFM_cp ? buildSelect('f_relatedParty','LP — связанная сторона с GP / Управляющим',['Нет','Да'],fd.relatedParty,disabledAttr,selectStyle,labelStyle) : ''}
          ${buildSelect('f_result','Результат проверки',['🟢 Green (нет конфликта)','🟡 Yellow (требует анализа)','🔴 Red (отказ)'],fd.result,disabledAttr,selectStyle,labelStyle)}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">${isFM_cp ? 'Описание конфликта / примечание (если есть)' : 'Описание конфликта (если есть)'}</label>
          <textarea id="f_conflictDesc" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="${isFM_cp ? 'Укажите конфликт с портфелем, GP, связанными сторонами...' : 'Опишите найденный конфликт...'}">${fd.conflictDesc||''}</textarea></div>

        ${buildSelect2('f_decision','Решение (Go / No-Go)',['Go','No-Go','Требует эскалации'],fd.decision,disabledAttr,selectStyle,labelStyle,formGroupStyle)}

        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM</label>
          <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="${isFM_cp ? 'Дополнительные комментарии по конфликту для LP...' : 'Дополнительные комментарии...'}">${fd.rmComment||''}</textarea></div>`;
      break;
    }

    /* ─── ФОРМА 3 — Documentation Collection (2.1) ── */
    case 'doc_collection': {
      const isFM   = client.direction === 'FM';
      const isCorp = client.type === 'Corporate';

      // ── Document checklists per direction + type ─────────────────────────
      const docs = isFM && isCorp
        ? [
            { name:'Certificate of Incorporation / Свидетельство о регистрации', required:true  },
            { name:'Charter / Articles of Association (Устав)',                   required:true  },
            { name:'UBO Declaration + Паспорта бенефициаров (≥10%)',              required:true  },
            { name:'Board Resolution to Invest in Alternative Funds',             required:true  },
            { name:'Audited Financial Statements (2 года)',                        required:true  },
            { name:'Bank Reference Letter',                                        required:true  },
            { name:'Investor Declaration / LP Questionnaire',                     required:true  },
            { name:'Source of Funds Declaration',                                  required:true  },
            { name:'Подтверждение адреса компании',                               required:false },
          ]
        : isFM && !isCorp
        ? [
            { name:'Паспорт / Удостоверение личности',                             required:true  },
            { name:'Подтверждение адреса (счёт/выписка — не старше 3 мес.)',        required:true  },
            { name:'Source of Funds Declaration (источник средств)',               required:true  },
            { name:'Source of Wealth Declaration (источник состояния)',            required:true  },
            { name:'Investor Declaration / LP Questionnaire',                     required:true  },
            { name:'Tax ID / TIN',                                                 required:true  },
            { name:'Bank Reference Letter',                                        required:true  },
            { name:'PEP Self-Declaration',                                         required:false },
          ]
        : isCorp
        ? [
            { name:'Certificate of Incorporation',                                 required:true  },
            { name:'Устав компании (Charter)',                                     required:true  },
            { name:'Register of Directors',                                        required:true  },
            { name:'UBO Declaration + паспорта',                                   required:true  },
            { name:'Финансовая отчётность (2 года)',                               required:true  },
            { name:'Подтверждение адреса компании',                               required:false },
          ]
        : [
            { name:'Паспорт / Удостоверение личности',                             required:true  },
            { name:'Подтверждение адреса',                                         required:true  },
            { name:'Source of Funds Declaration',                                  required:true  },
            { name:'Source of Wealth Declaration',                                 required:true  },
            { name:'PEP Declaration',                                              required:false },
            { name:'CV / Professional Profile',                                    required:false },
          ];

      const reqDocs  = docs.filter(d => d.required);
      const optDocs  = docs.filter(d => !d.required);
      const reqCount = reqDocs.length;

      // ── Direction label for the header badge ─────────────────────────────
      const dirLabel  = isFM ? '🏦 FM — LP Documents' : '📊 CF&A — Client Documents';
      const dirColor  = isFM ? '#3b82f6' : '#8b5cf6';
      const typeLabel = isFM
        ? (isCorp ? 'Corporate LP' : `Individual LP · ${client.lpType||'HNWI'}`)
        : client.type;

      // ── Helper: colour + icon for doc status ─────────────────────────────
      // Computed server-side for initial render; JS will update dynamically
      function docRowStyle(status) {
        if (status === 'Получен')    return { bg:'rgba(34,197,94,0.07)',  border:'rgba(34,197,94,0.25)',  icon:'fa-check-circle',  ic:'#22c55e', tc:'#86efac' };
        if (status === 'Ожидается')  return { bg:'rgba(234,179,8,0.07)',  border:'rgba(234,179,8,0.25)',  icon:'fa-clock',         ic:'#eab308', tc:'#fde047' };
        if (status === 'Отсутствует')return { bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.25)',  icon:'fa-times-circle',  ic:'#ef4444', tc:'#fca5a5' };
        return                               { bg:'transparent',          border:'#1e293b',               icon:'fa-file-alt',      ic:dirColor,  tc:'#e2e8f0' };
      }

      // ── Compute initial counter for server-side render ───────────────────
      let initReceived = 0;
      reqDocs.forEach((d,i) => {
        if ((fd['f_doc_'+i]||'Ожидается') === 'Получен') initReceived++;
      });
      const allGood = initReceived === reqCount;

      html += `
        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата запроса документов *</label>
          <input type="date" id="f_requestDate" value="${fd.f_requestDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        <!-- Direction + type header banner -->
        <div style="background:rgba(${isFM?'59,130,246':'139,92,246'},0.08);border:1px solid rgba(${isFM?'59,130,246':'139,92,246'},0.25);border-radius:8px;padding:9px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <span style="font-size:12px;font-weight:700;color:${dirColor}"><i class="fas fa-folder-open" style="margin-right:6px"></i>${dirLabel}</span>
          <span style="font-size:11px;color:#64748b;background:#1e293b;padding:2px 10px;border-radius:12px">${typeLabel}</span>
        </div>

        <!-- ══ Progress counter banner ══ -->
        <div id="docProgressBanner" style="border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;
          background:${allGood?'rgba(34,197,94,0.10)':'rgba(234,179,8,0.08)'};
          border:1px solid ${allGood?'rgba(34,197,94,0.35)':'rgba(234,179,8,0.3)'}">
          <div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;
            background:${allGood?'rgba(34,197,94,0.18)':'rgba(234,179,8,0.15)'};
            font-size:16px;color:${allGood?'#22c55e':'#eab308'}">
            <i class="fas fa-${allGood?'check-circle':'hourglass-half'}"></i>
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:800;color:${allGood?'#22c55e':'#fde047'}">
              <span id="docReceivedCount">${initReceived}</span> / ${reqCount} обязательных документов получены
            </div>
            <div id="docProgressSubtext" style="font-size:11px;margin-top:2px;color:${allGood?'#86efac':'#a78bfa'}">
              ${allGood ? '✅ Все обязательные документы получены — можно завершить задачу' : '⏳ Получите все обязательные документы для завершения задачи'}
            </div>
          </div>
          <!-- mini progress bar -->
          <div style="width:80px;flex-shrink:0">
            <div style="font-size:11px;color:#64748b;text-align:right;margin-bottom:3px">${Math.round(initReceived/reqCount*100)}%</div>
            <div style="height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
              <div id="docProgressBar" style="height:6px;border-radius:3px;transition:width .3s,background .3s;
                width:${Math.round(initReceived/reqCount*100)}%;
                background:${allGood?'#22c55e':'#eab308'}"></div>
            </div>
          </div>
        </div>

        <!-- ══ Required docs ══ -->
        <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">
          <i class="fas fa-asterisk" style="margin-right:5px;font-size:9px"></i>Обязательные документы (${reqCount})
        </div>
        <div id="docRequiredList" style="border-radius:10px;overflow:hidden;border:1px solid #1e293b;margin-bottom:14px">
        ${reqDocs.map((d,i) => {
          const st  = fd['f_doc_'+i] || 'Ожидается';
          const s   = docRowStyle(st);
          return `
          <div id="docRow_${i}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            background:${s.bg};border-bottom:1px solid #1e293b;transition:background .2s">
            <i class="fas ${s.icon}" id="docRowIcon_${i}"
              style="color:${s.ic};font-size:14px;flex-shrink:0;width:16px;text-align:center"></i>
            <span style="flex:1;font-size:12px;color:${s.tc};font-weight:600">${d.name}</span>
            <select id="f_doc_${i}" ${disabledAttr}
              onchange="obDocStatusChange(${i},this.value,${reqCount},${isCompleted})"
              style="background:#0f1623;border:1px solid #2a3448;border-radius:6px;padding:5px 8px;
                     color:#e2e8f0;font-size:11px;min-width:130px;cursor:pointer">
              ${['Получен','Ожидается','Отсутствует'].map(o =>
                `<option value="${o}" ${st===o?'selected':''}>${o}</option>`
              ).join('')}
            </select>
          </div>`;
        }).join('')}
        </div>

        <!-- ══ Optional docs ══ -->
        ${optDocs.length ? `
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px">
          <i class="fas fa-circle-dot" style="margin-right:5px;font-size:9px"></i>Дополнительные документы
        </div>
        <div style="border-radius:10px;overflow:hidden;border:1px solid #1e293b;margin-bottom:14px">
        ${optDocs.map((d,i) => {
          const idx = reqCount + i;
          const st  = fd['f_doc_'+idx] || 'Ожидается';
          const s   = docRowStyle(st);
          return `
          <div id="docRow_${idx}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;
            background:${s.bg};border-bottom:1px solid #1e293b;transition:background .2s">
            <i class="fas ${s.icon}" id="docRowIcon_${idx}"
              style="color:${s.ic};font-size:13px;flex-shrink:0;width:16px;text-align:center"></i>
            <span style="flex:1;font-size:12px;color:${s.tc};opacity:.8">${d.name}
              <span style="font-size:10px;color:#475569;font-weight:400"> — опционально</span></span>
            <select id="f_doc_${idx}" ${disabledAttr}
              onchange="obDocStatusChange(${idx},this.value,${reqCount},${isCompleted})"
              style="background:#0f1623;border:1px solid #2a3448;border-radius:6px;padding:5px 8px;
                     color:#94a3b8;font-size:11px;min-width:130px;cursor:pointer">
              ${['Получен','Ожидается','Отсутствует'].map(o =>
                `<option value="${o}" ${st===o?'selected':''}>${o}</option>`
              ).join('')}
            </select>
          </div>`;
        }).join('')}
        </div>` : ''}

        <!-- ══ Summary + dates ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:4px">
          <div style="font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">
            <i class="fas fa-clipboard-check" style="margin-right:5px"></i>Итог сбора документов
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="${labelStyle}">Статус сбора</label>
              <select id="f_allReceived" ${disabledAttr} style="${selectStyle}">
                ${['Нет','Частично','Да — все получены'].map(o =>
                  `<option value="${o}" ${(fd.f_allReceived||'Нет')===o?'selected':''}>${o}</option>`
                ).join('')}
              </select>
            </div>
            <div>
              <label style="${labelStyle}">Дата получения всех документов</label>
              <input type="date" id="f_receivedDate" value="${fd.f_receivedDate||''}" ${disabledAttr} style="${inputStyle}" />
            </div>
          </div>
          ${isFM ? `<div style="margin-top:10px"><label style="${labelStyle}">LP Questionnaire — версия / дата</label>
            <input type="text" id="f_lpqVersion" value="${fd.f_lpqVersion||''}" ${disabledAttr} style="${inputStyle}" placeholder="LPQ v2.1 — 10.06.2026" /></div>` : ''}
          <div style="margin-top:10px"><label style="${labelStyle}">Комментарий RM</label>
            <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Комментарии по документам...">${fd.f_rmComment||''}</textarea></div>
        </div>`;
      break;
    }

    /* ─── ФОРМА 4 — DD Outcome / AML-KYC (2.2) ───── */
    case 'dd_outcome': {
      const isFM_dd = client.direction === 'FM';
      const ddTitle  = isFM_dd ? '🏦 AML / KYC Due Diligence — LP' : '📊 Client Due Diligence Outcome — CF&A';
      const ddColor  = isFM_dd ? '#3b82f6' : '#8b5cf6';

      // Carry-over: doc_collection status
      const prevDoc  = obTasks.find(t => t.clientId === client.id && t.taskNum === '2.1');
      const docStatus = prevDoc?.formData?.f_allReceived || null;

      html += `
        <!-- Direction header -->
        <div style="background:rgba(${isFM_dd?'59,130,246':'139,92,246'},0.08);border:1px solid rgba(${isFM_dd?'59,130,246':'139,92,246'},0.25);border-radius:8px;padding:9px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:700;color:${ddColor}">${ddTitle}</span>
          ${docStatus ? `<span style="font-size:11px;color:#64748b;background:#1e293b;padding:2px 10px;border-radius:12px">
            <i class="fas fa-link" style="margin-right:4px"></i>Документы (2.1): ${docStatus}</span>` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          <div style="${formGroupStyle};grid-column:1/-1"><label style="${labelStyle}">Дата проверки *</label>
            <input type="date" id="f_ddDate" value="${fd.ddDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>
        </div>

        <!-- Section 1: Identification -->
        <div style="font-size:11px;font-weight:700;color:#3b82f6;margin-bottom:8px;text-transform:uppercase">
          Раздел 1 — ${isFM_dd ? 'Идентификация LP' : 'Идентификация клиента'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${isFM_dd
            ? buildSelect('f_corpVerified', client.type==='Corporate' ? 'Корпоративные данные LP проверены' : 'Личность LP подтверждена', ['Да','Нет','Расхождения выявлены'], fd.corpVerified, disabledAttr, selectStyle, labelStyle)
            : buildSelect('f_corpVerified','Корпоративные данные проверены',['Да','Нет','Расхождения выявлены'],fd.corpVerified,disabledAttr,selectStyle,labelStyle)
          }
          <div><label style="${labelStyle}">Источник проверки</label>
            <input type="text" id="f_verifySource" value="${fd.verifySource||'Kompra.kz'}" ${disabledAttr} style="${inputStyle}" placeholder="Kompra.kz, гос. реестр..." /></div>
          ${isFM_dd ? buildSelect('f_lpDocsVerified','Документы LP верифицированы (2.1)',['Да','Нет','Частично'],fd.lpDocsVerified,disabledAttr,selectStyle,labelStyle) : ''}
          ${isFM_dd && client.type==='Corporate' ? buildSelect('f_uboVerified','UBO верифицированы (все ≥10%)',['Да','Нет','Частично'],fd.uboVerified,disabledAttr,selectStyle,labelStyle) : ''}
        </div>

        <!-- Section 2: Sanctions -->
        <div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:8px;text-transform:uppercase">Раздел 2 — Санкционная проверка</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${['UN Sanctions','OFAC SDN','EU Sanctions','UK Sanctions (OFSI)'].map((s,i) =>
            buildSelect(`f_sanction_${i}`, s, ['Совпадений нет','Совпадение найдено'], fd[`sanction_${i}`], disabledAttr, selectStyle, labelStyle)
          ).join('')}
          ${buildSelect('f_sanctionTotal','Итог санкционной проверки',['Чисто','Совпадение — требует эскалации'],fd.sanctionTotal,disabledAttr,selectStyle,labelStyle)}
          <div><label style="${labelStyle}">Инструмент проверки</label>
            <input type="text" id="f_sanctionTool" value="${fd.sanctionTool||'Dow Jones / ComplyAdvantage'}" ${disabledAttr} style="${inputStyle}" /></div>
        </div>

        <!-- Section 3: PEP -->
        <div style="font-size:11px;font-weight:700;color:#f97316;margin-bottom:8px;text-transform:uppercase">
          Раздел 3 — PEP Screening${isFM_dd ? ' (LP / UBO)' : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${buildSelect('f_pepClient', isFM_dd ? 'PEP-статус LP (физлицо)' : 'PEP-статус клиента', ['Не PEP','PEP','Связан с PEP'],fd.pepClient,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_pepDirectors', isFM_dd ? (client.type==='Corporate' ? 'PEP-статус UBO / Директоров' : 'PEP-статус доверенных лиц') : 'PEP-статус директоров/UBO', ['Не PEP','PEP','Связан с PEP'],fd.pepDirectors,disabledAttr,selectStyle,labelStyle)}
        </div>

        <!-- Section 4: Source of Funds (FM extra) -->
        ${isFM_dd ? `
        <div style="font-size:11px;font-weight:700;color:#22c55e;margin-bottom:8px;text-transform:uppercase">Раздел 4 — Source of Funds / Wealth (LP)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${buildSelect('f_sofVerified','Source of Funds — верифицирован',['Да','Нет','Требует доп. документов'],fd.sofVerified,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_sowVerified','Source of Wealth — верифицирован',['Да','Нет','Требует доп. документов'],fd.sowVerified,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_bankRefOk','Bank Reference Letter — OK',['Да','Нет','Не предоставлен'],fd.bankRefOk,disabledAttr,selectStyle,labelStyle)}
          ${buildSelect('f_taxIdVerified','Tax ID / TIN верифицирован',['Да','Нет'],fd.taxIdVerified,disabledAttr,selectStyle,labelStyle)}
        </div>` : ''}

        <!-- Section Adverse Media -->
        <div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:8px;text-transform:uppercase">
          Раздел ${isFM_dd?'5':'4'} — Adverse Media
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${buildSelect('f_adverseMedia','Открытые источники / Медиа',['Негативной информации не выявлено','Выявлена негативная информация'],fd.adverseMedia,disabledAttr,selectStyle,labelStyle)}
        </div>

        <!-- Section Risk Rating -->
        <div style="font-size:11px;font-weight:700;color:#eab308;margin-bottom:8px;text-transform:uppercase">
          Раздел ${isFM_dd?'6':'5'} — Риск-рейтинг${isFM_dd?' LP':''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${[
            `f_riskJurisdiction:${isFM_dd?'Риск юрисдикции LP':'Юрисдикционный риск'}`,
            'f_riskSanction:Санкционный риск',
            `f_riskRep:${isFM_dd?'Репутационный риск LP':'Репутационный риск'}`,
            `f_riskBusiness:${isFM_dd?'Риск источника средств LP':'Риск бизнес-деятельности'}`,
            `f_riskTotal:Итоговый риск-рейтинг`
          ].map(pair => {
            const [fid, label] = pair.split(':');
            const opts = fid==='f_riskTotal' ? ['Low','Medium','High','Unacceptable'] : ['Low','Medium','High'];
            return buildSelect(fid, label, opts, fd[fid], disabledAttr, selectStyle, labelStyle);
          }).join('')}
        </div>

        <!-- Section Conclusion -->
        <div style="font-size:11px;font-weight:700;color:#f97316;margin-bottom:8px;text-transform:uppercase">
          Раздел ${isFM_dd?'7':'6'} — Заключение${isFM_dd?' AML/KYC':''}
        </div>
        ${buildSelect2('f_conclusion','Заключение / Conclusion',['Одобрить — Approve','Отказать — Reject','Расширенная проверка (EDD)'],fd.conclusion,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
        ${isFM_dd ? `
        <div style="${formGroupStyle}"><label style="${labelStyle}">Примечание по рискам LP (MLRO) *</label>
          <textarea id="f_mlroNote" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="Пояснение MLRO по рискам LP...">${fd.mlroNote||''}</textarea></div>` : ''}
        <div style="${formGroupStyle}"><label style="${labelStyle}">Additional Comments / Observations <span style="font-size:10px;color:#64748b;text-transform:none;font-weight:400">(будет включён в PDF-отчёт)</span></label>
          <textarea id="f_coComment" rows="4" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="${isFM_dd?'Additional observations, risk justification, or AML/KYC notes for the record...':'Additional observations or compliance notes for the record...'}">${fd.coComment||''}</textarea></div>
        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
            <i class="fas fa-pen-nib" style="margin-right:5px;color:#3b82f6"></i>Имена для PDF <span style="font-size:10px;color:#4a5568;font-weight:400;text-transform:none"> — физическая подпись ставится вручную после печати</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="${labelStyle}">Имя CCO (для PDF)</label><input type="text" id="f_signCO" value="${fd.signCO||''}" ${disabledAttr} style="${inputStyle}" placeholder="Full name of CCO" /></div>
            <div><label style="${labelStyle}">Имя MLRO (для PDF)</label><input type="text" id="f_signMLRO" value="${fd.signMLRO||''}" ${disabledAttr} style="${inputStyle}" placeholder="Full name of MLRO" /></div>
          </div>
        </div>`;
      break;
    }

    /* ─── ФОРМА 5 — Client Classification (3.1) ───── */
    case 'classification': {
      const prevDD   = obTasks.find(t => t.clientId === client.id && t.taskNum === '2.2');
      const ddRisk   = prevDD?.formData?.f_riskTotal || null;
      const ddConcl  = prevDD?.formData?.f_conclusion || '';
      const isIndiv  = client.type === 'Individual';
      const isCorp   = client.type === 'Corporate';
      // Default proposed class: Individual → Professional Client, Corporate → depends on criteria
      const autoClass = isIndiv ? 'Professional Client' : 'Market Counterparty';
      const tid = task.id;

      html += `
        <!-- DD Risk carry-over banner -->
        ${ddRisk ? `<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:12px">
          <i class="fas fa-link" style="color:#3b82f6;flex-shrink:0"></i>
          <span>Из задачи 2.2: <b>DD Риск — ${ddRisk}</b> · Заключение: <b>${ddConcl}</b></span>
        </div>` : ''}

        <!-- Direction + type badge -->
        <div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:12px">
          <i class="fas fa-id-card" style="color:#8b5cf6"></i>
          <span>Тип клиента: <b style="color:#a78bfa">${client.type}</b> · Услуга: <b style="color:#a78bfa">${client.serviceType}</b></span>
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата классификации *</label>
          <input type="date" id="f_classDate" value="${fd.classDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        <!-- ══ Company policy notice ══ -->
        <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.25);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#93c5fd">
          <i class="fas fa-info-circle" style="color:#3b82f6;margin-right:6px"></i>
          Компания оказывает услуги исключительно <b>Professional Clients</b> и <b>Market Counterparties</b>.
          Retail Clients не принимаются на обслуживание.
        </div>

        ${isIndiv ? `
        <!-- ══ INDIVIDUAL: Professional Client — any 1 of 3 ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-tie"></i> Критерии Professional Client — физическое лицо
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">Достаточно выполнения <b>любого 1</b> из 3 критериев</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_indAssets1m',
              '① Чистые активы ≥ $1,000,000 (без учёта жилья и пенсии)',
              ['Нет','Да'], fd.indAssets1m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_indIncome100k',
              '② Годовой доход ≥ $100,000 в каждый из последних 2 лет',
              ['Нет','Да'], fd.indIncome100k, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_indExperience3y',
              '③ Проф. квалификация / опыт ≥ 3 лет (CFA / CPA / FRM / senior mgmt / portfolio mgmt / trading)',
              ['Нет','Да'], fd.indExperience3y, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div id="profScoreInd_${tid}" style="padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;background:#1c2333;color:#64748b">
            <i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта
          </div>
        </div>` : `
        <!-- ══ CORPORATE: Professional Client — any 1 of 4 ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-building"></i> Критерии Professional Client — юридическое лицо
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">Достаточно выполнения <b>любого 1</b> из 4 критериев (или субкритерия IV)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_corpTurnover2m',
              '① Годовой оборот ≥ $2,000,000',
              ['Нет','Да'], fd.corpTurnover2m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpBalance1m',
              '② Итог баланса ≥ $1,000,000',
              ['Нет','Да'], fd.corpBalance1m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpRegulated',
              '③ Регулируемая финансовая организация (банк / УА / страховая)',
              ['Нет','Да'], fd.corpRegulated, disabledAttr, selectStyle, labelStyle)}
          </div>
          <!-- Sub-criterion IV: large corp 2-of-3 -->
          <div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:700">
              ④ Крупная корпорация — необходимо выполнение <b>2 из 3</b> подкритериев:
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${buildSelect('f_corpLargeTurnover',
                'Оборот ≥ $2,000,000',
                ['Нет','Да'], fd.corpLargeTurnover, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_corpLargeBalance',
                'Баланс ≥ $1,000,000',
                ['Нет','Да'], fd.corpLargeBalance, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_corpEmployees50',
                'Штат ≥ 50 сотрудников',
                ['Нет','Да'], fd.corpEmployees50, disabledAttr, selectStyle, labelStyle)}
            </div>
          </div>
          <div id="profScoreCorp_${tid}" style="padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;background:#1c2333;color:#64748b">
            <i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта
          </div>
        </div>`}

        <!-- ══ MARKET COUNTERPARTY criteria ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#8b5cf6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-landmark"></i> Критерии Market Counterparty
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">
            Критерии I–III: достаточно <b>любого 1</b>. Критерий IV (крупная корпорация): все <b>3 условия одновременно (AND)</b>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_mcpLicensed',
              '① Лицензированный финансовый институт (банк / инвест. фирма / страховая)',
              ['Нет','Да'], fd.mcpLicensed, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_mcpGovEntity',
              '② Центральный банк / госорган / правительственное агентство',
              ['Нет','Да'], fd.mcpGovEntity, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_mcpSupranational',
              '③ Наднациональная организация (World Bank, IFC, EBRD и др.)',
              ['Нет','Да'], fd.mcpSupranational, disabledAttr, selectStyle, labelStyle)}
          </div>
          <!-- Sub-criterion IV: large corp AND -->
          <div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:700">
              ④ Крупная корпорация — все <b>3 условия обязательны одновременно:</b>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${buildSelect('f_mcpTurnover20m',
                'Годовой оборот ≥ $20,000,000',
                ['Нет','Да'], fd.mcpTurnover20m, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_mcpBalance10m',
                'Итог баланса ≥ $10,000,000',
                ['Нет','Да'], fd.mcpBalance10m, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_mcpEquity2m',
                'Собственный капитал ≥ $2,000,000',
                ['Нет','Да'], fd.mcpEquity2m, disabledAttr, selectStyle, labelStyle)}
            </div>
          </div>
          <div id="mcpScore_${tid}" style="padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;background:#1c2333;color:#64748b">
            <i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта
          </div>
        </div>

        <!-- ══ Proposed classification + CO decision ══ -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
          ${buildSelect2('f_proposedClass','Предложенная классификация (RM)',['Professional Client','Market Counterparty'],fd.proposedClass||autoClass,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
          ${buildSelect2('f_coDecision','Решение CO',['Ожидается','Подтверждено','Отклонено','Требует уточнения'],fd.coDecision,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Обоснование RM *</label>
          <textarea id="f_rmJustification" rows="3" ${disabledAttr} style="${inputStyle};resize:vertical"
            placeholder="Укажите, каким критериям соответствует клиент и обоснование предложенной классификации...">${fd.rmJustification||''}</textarea></div>
        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий CO</label>
          <textarea id="f_coComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.coComment||''}</textarea></div>

        <!-- ══ Client notification ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-bell"></i> Уведомление клиента
          </div>
          ${buildSelect2('f_clientNotified','Клиент уведомлён о присвоенной категории?',['Нет','Да — письменно','Да — устно'],fd.clientNotified,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
          <div style="${formGroupStyle}"><label style="${labelStyle}">Дата уведомления</label>
            <input type="date" id="f_notifyDate" value="${fd.notifyDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
        </div>

        <!-- ══ Opt-up / Opt-down ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:4px">
          <div style="font-size:11px;font-weight:800;color:#eab308;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-arrow-up-down"></i> Opt-up / Opt-down
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_optUpRequest','Клиент запросил повышение категории (opt-up)?',['Нет','Да'], fd.optUpRequest, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_optDownRequest','Клиент запросил понижение категории (opt-down)?',['Нет','Да'], fd.optDownRequest, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div id="optUpBlock_${tid}" style="display:${(fd.optUpRequest==='Да')?'block':'none'}">
            ${buildSelect2('f_optUpWritten','Письменное заявление на opt-up получено?',['Нет','Да'],fd.optUpWritten,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата заявления на opt-up</label>
              <input type="date" id="f_optUpDate" value="${fd.optUpDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            ${buildSelect2('f_optUpCoApproval','Одобрено CO?',['Нет','Да'],fd.optUpCoApproval,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
          </div>
          <div id="optDownBlock_${tid}" style="display:${(fd.optDownRequest==='Да')?'block':'none'}">
            ${buildSelect2('f_optDownWritten','Письменное заявление на opt-down получено?',['Нет','Да'],fd.optDownWritten,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата заявления на opt-down</label>
              <input type="date" id="f_optDownDate" value="${fd.optDownDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
          </div>
        </div>`;
      break;
    }

    /* ─── ФОРМА 6 — Suitability / Appropriateness (3.2) */
    case 'suitability': {
      const isAdvising  = client.serviceType === 'Advising' || client.serviceType === 'Both';
      const isIndivS    = client.type === 'Individual';
      const prevClass   = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.1');
      const clientClass = prevClass?.formData?.f_proposedClass || client.classification || 'Professional Client';

      html += `
        <!-- Carry-over from Classification -->
        ${prevClass ? `<div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#8b5cf6;flex-shrink:0"></i>
          Классификация (3.1): <b style="color:#a78bfa">${clientClass}</b> · CO: <b>${prevClass.formData?.f_coDecision||'—'}</b>
        </div>` : ''}

        <!-- Assessment type info banner -->
        <div style="background:#1c2333;border-radius:8px;padding:10px 14px;margin-bottom:6px;font-size:12px;font-weight:700;color:#f97316;display:flex;align-items:center;gap:8px">
          <i class="fas fa-balance-scale"></i>
          Тип оценки: ${isAdvising
            ? '🎯 Suitability Assessment (Section 3.2) — услуга: Advising on Investments'
            : '📋 Appropriateness Assessment (Section 3.3) — услуга: Arranging Deals in Investments'}
          <span style="font-weight:400;color:#64748b;font-size:11px;margin-left:4px">· Клиент: ${statusLabel(client.type)}</span>
        </div>
        <div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.15);border-radius:8px;padding:8px 14px;margin-bottom:14px;font-size:11px;color:#94a3b8">
          ${isAdvising
            ? '<i class="fas fa-info-circle" style="margin-right:5px;color:#f97316"></i>Advising: компания предоставляет персональные инвестиционные рекомендации. Требуется <b>полная Suitability-оценка</b> (профиль клиента, финансовое положение, знания и опыт).'
            : '<i class="fas fa-info-circle" style="margin-right:5px;color:#3b82f6"></i>Arranging: компания организует сделку без выдачи инвестиционных рекомендаций. Достаточно <b>Appropriateness-оценки</b> (знания клиента, опыт с инструментами, финансовая способность).'}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата оценки *</label>
          <input type="date" id="f_suitDate" value="${fd.suitDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        ${isAdvising ? `
        <!-- ══════════════════════════════════════════════
             SUITABILITY ASSESSMENT (Advising — Section 3.2)
             Block A: Client Profile
             Block B: Financial Situation
             Block C: Knowledge & Experience
             Block D: Recommendation & Suitability Conclusion
             Block E: Four-Eyes Review
        ══════════════════════════════════════════════ -->

        <!-- ── Block A: Client Profile Assessment ──────────────────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-crosshairs"></i>Блок A — Client Profile Assessment
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.2A — инвестиционные цели, горизонт, риск, ликвидность</div>

          <!-- A.1 Investment Objectives — select all applicable -->
          <div style="${formGroupStyle}">
            <label style="${labelStyle}">Инвестиционные цели (отметьте все применимые) *</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
              ${[
                ['f_objPreservation', 'Capital Preservation — сохранение капитала (purchasing power)'],
                ['f_objIncome',       'Income Generation — регулярный доход (distributions / dividends)'],
                ['f_objGrowth',       'Capital Growth — долгосрочный рост стоимости'],
                ['f_objSpeculation',  'Speculation — высокий риск / высокая доходность'],
              ].map(([fid, lbl]) => `
                <label style="display:flex;align-items:flex-start;gap:8px;background:#1c2333;border-radius:6px;padding:8px 10px;cursor:${isCompleted?'default':'pointer'};border:1px solid rgba(42,52,72,0.8)">
                  <input type="checkbox" id="${fid}" ${fd[fid.replace('f_','')]===true||fd[fid]===true||fd[fid]==='true'?'checked':''} ${disabledAttr}
                    style="margin-top:2px;flex-shrink:0;accent-color:#22c55e" />
                  <span style="font-size:11px;color:#cbd5e1;line-height:1.4">${lbl}</span>
                </label>`).join('')}
            </div>
            <div style="${formGroupStyle};margin-top:8px"><label style="${labelStyle}">Дополнительные цели / комментарий</label>
              <textarea id="f_investGoals" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
                placeholder="M&A цели, стратегическое партнёрство, диверсификация по классам активов...">${fd.investGoals||''}</textarea></div>
          </div>

          <!-- A.2 Risk Tolerance -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_riskTolerance','Толерантность к риску *',
              ['Conservative — минимальный риск потери капитала',
               'Moderate — умеренная волатильность допустима',
               'Aggressive — высокая волатильность ради роста'],
              fd.riskTolerance, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_horizon','Инвестиционный горизонт *',
              ['Short-term — краткосрочный (< 1 года)',
               'Medium-term — среднесрочный (1–5 лет)',
               'Long-term — долгосрочный (> 5 лет)'],
              fd.horizon, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_liquidityNeeds','Потребность в ликвидности *',
              ['Immediate — немедленная ликвидность',
               'Short-term — в течение 1 года',
               'Long-term — нет ближайших потребностей'],
              fd.liquidityNeeds, disabledAttr, selectStyle, labelStyle)}
          </div>
        </div>

        <!-- ── Block B: Financial Situation Analysis ─────────────────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-wallet"></i>Блок B — Financial Situation Analysis
            <span style="font-size:10px;font-weight:400;text-transform:none;color:#64748b;margin-left:4px">${isIndivS ? '(Individual)' : '(Corporate)'}</span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.2B — чистый капитал и анализ доходов</div>

          ${isIndivS ? `
          <!-- B — Individual: Net Worth + Income Analysis -->
          <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">Net Worth Assessment</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_totalAssets',   'Совокупные активы (без жилья и пенсии)',
              ['< $100K','$100K – $500K','$500K – $1M','$1M – $5M','> $5M'],
              fd.totalAssets, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_totalLiab',     'Совокупные обязательства',
              ['Нет','< $50K','$50K – $500K','> $500K'],
              fd.totalLiab, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_netLiquidAssets','Чистые ликвидные активы для инвестирования',
              ['< $50K','$50K – $250K','$250K – $1M','> $1M'],
              fd.netLiquidAssets, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_dealPctWealth', 'Доля предлагаемой сделки от общего капитала',
              ['< 5%','5% – 20%','20% – 50%','> 50%'],
              fd.dealPctWealth, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">Income Analysis</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_annualIncome',   'Годовой доход из всех источников',
              ['< $50K','$50K – $200K','$200K – $500K','> $500K'],
              fd.annualIncome, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_incomeStability','Стабильность и предсказуемость дохода',
              ['Нестабильный / нерегулярный','Умеренно стабильный','Высокостабильный / зарплата/рента'],
              fd.incomeStability, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_futureIncome',   'Ожидаемые изменения дохода',
              ['Снижение ожидается','Без изменений','Рост ожидается'],
              fd.futureIncome, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_lossCapacity',   'Способность выдержать потери',
              ['Минимальная — потеря критична','Умеренная — до 20% портфеля','Высокая — потеря портфеля допустима'],
              fd.lossCapacity, disabledAttr, selectStyle, labelStyle)}
          </div>` : `
          <!-- B — Corporate: Revenue / EBITDA / Debt + Deal context -->
          <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">Financial Position (Corporate)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_corpRevenue',  'Годовая выручка',
              ['< $1M','$1M – $10M','$10M – $50M','> $50M'],
              fd.corpRevenue, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpEbitda',   'EBITDA / Операционная прибыль',
              ['Убыток','Нулевая','Положительная','Высокая (> 20%)'],
              fd.corpEbitda, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpDebt',     'Долговая нагрузка (Debt/Equity)',
              ['Низкая (< 0.5)','Средняя (0.5 – 1.5)','Высокая (> 1.5)'],
              fd.corpDebt, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpDealSize', 'Предполагаемый размер сделки',
              ['< $500K','$500K – $5M','$5M – $50M','> $50M'],
              fd.corpDealSize, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Цель сделки / мандата *</label>
            <textarea id="f_financialPos" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="M&A цель, привлечение капитала, реструктуризация, fairness opinion...">${fd.financialPos||''}</textarea></div>`}
        </div>

        <!-- ── Block C: Knowledge and Experience Evaluation ──────────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-graduation-cap"></i>Блок C — Knowledge and Experience Evaluation
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.2C — инвестиционный опыт и профессиональный бэкграунд</div>

          <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">C.1 Investment Experience</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_expEquity',    'Опыт в акциях (публичных / частных)',
              ['Нет','Базовый (< 1 yr)','Средний (1–5 yr)','Продвинутый (5+ yr)'],
              fd.expEquity, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_expBonds',     'Опыт с облигациями / долговыми инструментами',
              ['Нет','Базовый','Средний','Продвинутый'],
              fd.expBonds, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_expAlts',      'Опыт в альтернативных инвестициях (PE / HF и др.)',
              ['Нет','Базовый','Средний','Продвинутый'],
              fd.expAlts, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_expMA',        'Опыт в M&A-сделках',
              ['Нет','Участник 1–2 сделок','Регулярный участник'],
              fd.expMA, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_expIntl',      'Международный инвестиционный опыт',
              ['Нет','Ограниченный','Значительный'],
              fd.expIntl, disabledAttr, selectStyle, labelStyle)}
          </div>

          <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">C.2 Professional Background</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_bgEducation',  'Образование в области финансов / инвестиций',
              ['Нет','Профильное образование (бакалавр/магистр)','Профессиональный сертификат (CFA / CPA / FRM и др.)'],
              fd.bgEducation, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_bgProfExp',    'Опыт работы в финансовых услугах',
              ['Нет','< 3 лет','3–10 лет','> 10 лет'],
              fd.bgProfExp, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_bgBoardRole',  'Должности в советах директоров / advisory-роли',
              ['Нет','Да — в одной компании','Да — в нескольких компаниях'],
              fd.bgBoardRole, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_bgComplexInstr','Понимание сложных финансовых инструментов',
              ['Нет','Базовое','Хорошее','Профессиональное'],
              fd.bgComplexInstr, disabledAttr, selectStyle, labelStyle)}
          </div>
        </div>

        <!-- ── Block D: Recommendation & Suitability Conclusion ──────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-lightbulb"></i>Блок D — Recommendation & Suitability Conclusion
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.4 — описание рекомендации и итог оценки</div>

          <div style="${formGroupStyle}"><label style="${labelStyle}">Описание рекомендуемой инвестиции / советника *</label>
            <textarea id="f_recProduct" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Напр.: M&A Advisory для сделки $5M | Investment advice — диверсификация в PE и облигации...">${fd.recProduct||''}</textarea></div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Ключевые характеристики и риски рекомендации</label>
            <textarea id="f_recRisks" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Профиль риска, ликвидность, сложность, потенциальные конфликты интересов...">${fd.recRisks||''}</textarea></div>

          <!-- Suitability Conclusion — 3 options per document Section 3.4 -->
          ${buildSelect2('f_suitMatch','Suitability Conclusion *',
            ['SUITABLE — инвестиция / совет соответствует профилю клиента',
             'SUITABLE WITH CAUTION — подходит, но требует специфических предупреждений о рисках',
             'NOT SUITABLE — рекомендация не соответствует профилю клиента'],
            fd.suitMatch, disabledAttr, selectStyle, labelStyle, formGroupStyle)}
          <div style="${formGroupStyle}"><label style="${labelStyle}">Обоснование заключения (если NOT SUITABLE или WITH CAUTION) *</label>
            <textarea id="f_suitJustify" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Детальное обоснование...">${fd.suitJustify||''}</textarea></div>
        </div>

        ` : `
        <!-- ══════════════════════════════════════════════
             APPROPRIATENESS ASSESSMENT (Arranging — Section 3.3)
             Block 1: Knowledge of Relevant Instruments
             Block 2: Transaction Experience
             Block 3: Financial Capacity
        ══════════════════════════════════════════════ -->

        <!-- ── Appropriateness Block 1: Knowledge of Relevant Instruments ── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-chart-bar"></i>Блок 1 — Knowledge of Relevant Instruments
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.3 — знание инструментов, используемых в организуемой сделке</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_instrType',     'Основной тип инструмента сделки',
              ['Акции (equity)','Облигации / долг (debt)','Деривативы','Паи фондов','Структурные продукты','Private placement','Другое'],
              fd.instrType, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_instrExp',      'Опыт работы с данным типом инструментов',
              ['Нет опыта','< 1 года','1–3 года','> 3 лет'],
              fd.instrExp, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_privatePlaceExp','Опыт участия в private placements / аналогичных сделках',
              ['Нет','Один раз','2–5 раз','Регулярно'],
              fd.privatePlaceExp, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_understandRisk', 'Клиент понимает риски и условия инструмента?',
              ['Нет','Частично','Да'],
              fd.understandRisk, disabledAttr, selectStyle, labelStyle)}
          </div>
          ${buildSelect2('f_riskWarning','Предупреждение о рисках инструмента направлено клиенту?',
            ['Нет','Да — письменно','Да — устно'],
            fd.riskWarning, disabledAttr, selectStyle, labelStyle, formGroupStyle)}
        </div>

        <!-- ── Appropriateness Block 2: Transaction Experience ───────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-handshake"></i>Блок 2 — Transaction Experience
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.3 — опыт участия в аналогичных сделках и понимание процессов</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_txnPriorExp',  'Участие в сопоставимых сделках ранее',
              ['Нет','1–2 сделки','3–5 сделок','Более 5 сделок'],
              fd.txnPriorExp, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_txnDDUnderstand','Понимание процессов due diligence',
              ['Нет','Базовое','Хорошее','Опытный участник'],
              fd.txnDDUnderstand, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_txnLegalDocs', 'Знакомство с юридической документацией и процедурой закрытия',
              ['Нет','Частичное','Хорошее','Профессиональное'],
              fd.txnLegalDocs, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Описание сделки / предмет мандата *</label>
            <textarea id="f_recProduct" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Опишите предмет сделки, структуру и роль компании в её организации...">${fd.recProduct||''}</textarea></div>
        </div>

        <!-- ── Appropriateness Block 3: Financial Capacity ───────────── -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-coins"></i>Блок 3 — Financial Capacity
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Section 3.3 — способность самостоятельно оценить инвестицию и выполнить обязательства</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_fcEvalCapacity','Способность самостоятельно оценить инвест. возможность',
              ['Нет — требуется внешний советник','Частичная','Да — самостоятельно'],
              fd.fcEvalCapacity, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_fcProfAdvice',  'Доступ к профессиональным советникам (юридическим, налоговым, техническим)',
              ['Нет','Ограниченный','Да — привлекаются регулярно'],
              fd.fcProfAdvice, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_fcCommitUnder', 'Понимание требований по взносам и возможных исходов',
              ['Нет','Частичное','Да — полное'],
              fd.fcCommitUnder, disabledAttr, selectStyle, labelStyle)}
          </div>
          ${buildSelect2('f_suitMatch','Appropriateness Conclusion *',
            ['APPROPRIATE — клиент обладает знаниями и опытом для данной сделки',
             'APPROPRIATE WITH WARNING — подходит, предупреждение о рисках выдано',
             'NOT APPROPRIATE — недостаточный уровень знаний / опыта'],
            fd.suitMatch, disabledAttr, selectStyle, labelStyle, formGroupStyle)}
        </div>
        `}

        <!-- ══ Four-Eyes Review (Section 3.4) ══ -->
        <div style="background:#1c2333;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#eab308;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-friends"></i>Four-Eyes Review (Section 3.4)
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px">Level 1 — Investment Adviser (RM) · Level 2 — Senior Adviser / Compliance Officer</div>

          <!-- Overall result + CO decision -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
            ${buildSelect2('f_overallResult','Итоговая оценка (Overall Result) *',
              ['Suitable / Appropriate — рекомендовано',
               'Suitable With Caution / Appropriate With Warning — с оговорками',
               'Not Suitable / Not Appropriate — отказ'],
              fd.overallResult, disabledAttr, selectStyle, labelStyle, formGroupStyle)}
            ${buildSelect2('f_coDecision','Решение CO (Level 2 Review) *',
              ['Ожидается','Утверждено','Отклонено'],
              fd.coDecision, disabledAttr, selectStyle, labelStyle, formGroupStyle)}
          </div>

          <!-- Level 1: Investment Adviser -->
          <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-bottom:10px">
            <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
              <i class="fas fa-user" style="margin-right:4px"></i>Level 1 — Investment Adviser / RM
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div style="${formGroupStyle}"><label style="${labelStyle}">Имя Investment Adviser (RM) *</label>
                <input type="text" id="f_adviserName" value="${fd.adviserName||''}" ${disabledAttr} style="${inputStyle}"
                  placeholder="Full name of Investment Adviser" /></div>
              <div style="${formGroupStyle}"><label style="${labelStyle}">Дата подготовки</label>
                <input type="date" id="f_adviserDate" value="${fd.adviserDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>
            </div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM (обоснование рекомендации) *</label>
              <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
                placeholder="Обоснование оценки и рекомендации...">${fd.rmComment||''}</textarea></div>
          </div>

          <!-- Level 2: Compliance Officer -->
          <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-bottom:10px">
            <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
              <i class="fas fa-shield-alt" style="margin-right:4px"></i>Level 2 — Senior Adviser / Compliance Officer (Four-Eyes Review)
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div style="${formGroupStyle}"><label style="${labelStyle}">Имя CO / Senior Adviser *</label>
                <input type="text" id="f_coName" value="${fd.coName||''}" ${disabledAttr} style="${inputStyle}"
                  placeholder="Full name of CO / Senior Adviser" /></div>
              <div style="${formGroupStyle}"><label style="${labelStyle}">Дата проверки</label>
                <input type="date" id="f_coReviewDate" value="${fd.coReviewDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            </div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий CO</label>
              <textarea id="f_coComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.coComment||''}</textarea></div>
          </div>

          <!-- Client Acknowledgment -->
          <div style="background:#0f1623;border-radius:8px;padding:10px 12px">
            <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
              <i class="fas fa-file-signature" style="margin-right:4px"></i>Client Acknowledgment
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${buildSelect('f_clientAck','Клиент получил и подписал копию оценки?',
                ['Нет','Да — письменно','Да — электронная подпись'],
                fd.clientAck, disabledAttr, selectStyle, labelStyle)}
              <div style="${formGroupStyle}"><label style="${labelStyle}">Дата подтверждения клиентом</label>
                <input type="date" id="f_clientAckDate" value="${fd.clientAckDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            </div>
          </div>
        </div>`;
      break;
    }

    /* ─── ФОРМА 7 — Engagement Letter (4.1) ─────────── */
    case 'engagement_letter': {
      const engSeq   = String(engIdCounter).padStart(3,'0');
      const prevSuit = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.2');
      const prevClass= obTasks.find(t => t.clientId === client.id && t.taskNum === '3.1');
      const suitResult  = prevSuit?.formData?.f_overallResult  || '';
      const classResult = prevClass?.formData?.f_proposedClass || prevClass?.formData?.proposedClass || '';
      const isAdvising  = client.serviceType === 'Advising' || client.serviceType === 'Both';

      html += `
        <!-- Carry-over banners -->
        ${prevClass ? `<div style="background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#8b5cf6;flex-shrink:0"></i>
          Классификация (3.1): <b style="color:#a78bfa">${classResult||'—'}</b>
        </div>` : ''}
        ${prevSuit ? `<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#22c55e;flex-shrink:0"></i>
          ${isAdvising ? 'Suitability' : 'Appropriateness'} (3.2):
          <b style="color:${suitResult.includes('Not')||suitResult.includes('Нет')?'#ef4444':'#22c55e'}">${suitResult||'—'}</b>
        </div>` : ''}

        <!-- TS info banner -->
        <div style="background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:12px;color:#fdba74;display:flex;align-items:center;gap:8px">
          <i class="fas fa-file-contract"></i>
          <span>Задача 4.1 — <b>Term Sheet</b> для CF&A. Документ подписывается <b>до</b> основного Engagement Letter и передаётся юристам для подготовки договора.</span>
        </div>

        <!-- ══ Section 1: TS Identification ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-hashtag"></i>Реквизиты Term Sheet
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div><label style="${labelStyle}">Номер TS *</label>
              <input type="text" id="f_engNum" value="${fd.engNum||`TS-${new Date().getFullYear()}-${engSeq}`}" ${disabledAttr} style="${inputStyle}" /></div>
            <div><label style="${labelStyle}">Дата TS *</label>
              <input type="date" id="f_engDate" value="${fd.engDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>
            ${buildSelect('f_governingLaw','Применимое право',
              ['AIFC Law','Казахстанское право (ГК РК)','English Law','Other'],
              fd.governingLaw, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_exclusivity','Эксклюзивность мандата',
              ['Не предусмотрена','Эксклюзивный мандат — 6 мес.','Эксклюзивный мандат — 12 мес.','Эксклюзивный мандат — custom'],
              fd.exclusivity, disabledAttr, selectStyle, labelStyle)}
          </div>
        </div>

        <!-- ══ Section 2: Scope of Engagement ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-briefcase"></i>Предмет и объём услуг
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Scope of Engagement / Описание мандата *</label>
            <textarea id="f_engScope" rows="3" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Подробное описание: цель сделки, роль компании, ожидаемые deliverables, этапы работы...">${fd.engScope||prevSuit?.formData?.recProduct||''}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_serviceType','Тип услуги',
              ['Advising on Investments','Arranging Deals in Investments','Advisory + Arranging (Both)'],
              fd.serviceType||(isAdvising?'Advising on Investments':'Arranging Deals in Investments'),
              disabledAttr, selectStyle, labelStyle)}
            <div><label style="${labelStyle}">Предполагаемая дата начала</label>
              <input type="date" id="f_engStart" value="${fd.engStart||today()}" ${disabledAttr} style="${inputStyle}" /></div>
            <div><label style="${labelStyle}">Предполагаемая дата завершения</label>
              <input type="date" id="f_engExpiry" value="${fd.engExpiry||''}" ${disabledAttr} style="${inputStyle}" /></div>
          </div>
        </div>

        <!-- ══ Section 3: Commercial Terms ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-dollar-sign"></i>Коммерческие условия (Commercial Terms)
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_feeType','Структура вознаграждения',
              ['Fixed Fee','Success Fee','Retainer + Success Fee','Fixed Fee + Success Fee','Комбинированный'],
              fd.feeType, disabledAttr, selectStyle, labelStyle)}
            <div><label style="${labelStyle}">Fixed Fee</label>
              <input type="number" id="f_feeAmount" value="${fd.feeAmount||''}" ${disabledAttr} style="${inputStyle}" placeholder="50 000" /></div>
            <div><label style="${labelStyle}">Success Fee (%)</label>
              <input type="number" id="f_successFee" value="${fd.successFee||''}" ${disabledAttr} style="${inputStyle}" placeholder="2" /></div>
            <div><label style="${labelStyle}">Retainer (/ мес.)</label>
              <input type="number" id="f_retainer" value="${fd.retainer||''}" ${disabledAttr} style="${inputStyle}" placeholder="5 000" /></div>
            <div><label style="${labelStyle}">Валюта</label>
              <select id="f_currency" ${disabledAttr} style="${selectStyle}">
                ${Object.entries(CURRENCIES).map(([code,c]) => `<option value="${code}"${(fd.currency||'USD')===code?' selected':''}>${c.label}</option>`).join('')}
              </select></div>
            ${buildSelect('f_payTerms','Порядок оплаты',
              ['При подписании договора','Ежемесячно','По завершении сделки','50% аванс + 50% по закрытию','По milestone'],
              fd.payTerms, disabledAttr, selectStyle, labelStyle)}
          </div>
        </div>

        <!-- ══ Section 4: Conditions Precedent ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-clipboard-check"></i>Условия, предшествующие подписанию договора (CPs)
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Conditions Precedent</label>
            <textarea id="f_conditionsPrecedent" rows="3" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Перечислите условия: KYC completed / Board resolution / NDA signed / Regulatory approval...">${fd.conditionsPrecedent||''}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
            ${buildSelect('f_ndaSigned','NDA подписан?',
              ['Не требуется','Нет — требуется до договора','Да — подписан'],
              fd.ndaSigned, disabledAttr, selectStyle, labelStyle)}
          </div>
        </div>

        <!-- ══ Section 5: RM Notes for Legal Counsel ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-gavel"></i>Комментарии RM для юридического отдела
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">RM Notes for Legal Counsel *</label>
            <textarea id="f_legalNotes" rows="4" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Специфика сделки, ключевые риски, нестандартные условия, пожелания клиента, флаги для юристов (opt-up/opt-down, MCP status, regulatory flags)...">${fd.legalNotes||''}</textarea></div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM (общий)</label>
            <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical"
              placeholder="Общие комментарии по сделке...">${fd.rmComment||''}</textarea></div>
        </div>

        <!-- ══ Section 6: Signing Status ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-signature"></i>Статус подписания Term Sheet
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_clientSigned','Term Sheet подписан клиентом?',
              ['Нет','Ожидается','Да — оригинал','Да — эл. подпись'],
              fd.clientSigned, disabledAttr, selectStyle, labelStyle)}
            <div><label style="${labelStyle}">Дата подписания клиентом</label>
              <input type="date" id="f_signDate" value="${fd.signDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
          </div>
        </div>

        <div style="background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.15);border-radius:8px;padding:10px 14px;font-size:11px;color:#fdba74">
          <i class="fas fa-info-circle" style="margin-right:5px"></i>
          После завершения задачи Term Sheet автоматически появится в <b>Реестре договоров</b>. Для генерации PDF Term Sheet нажмите кнопку в баннере завершённой задачи.
        </div>`;
      break;
    }

    /* ─── ФОРМА 8 — Client Activation (5.1) ───────── */
    case 'activation': {
      const allPrev  = obTasks.filter(t => t.clientId === client.id && t.taskNum !== '5.1');
      const allDone  = allPrev.every(t => t.status === 'completed' || t.status === 'escalated');
      const blockers = allPrev.filter(t => t.status !== 'completed' && t.status !== 'escalated');

      // Collect summary from prior tasks
      const classTask  = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.1');
      const suitTask   = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.2');
      const engTask    = obTasks.find(t => t.clientId === client.id && t.taskNum === '4.1');
      const ddTask     = obTasks.find(t => t.clientId === client.id && t.taskNum === '2.2');
      const isFmClient = client.direction === 'FM';

      // Labels for FM vs CF&A
      const classLabel = isFmClient ? 'LP Квалификация' : 'Классификация';
      const classVal   = isFmClient
        ? (classTask?.formData?.f_lpQualResult || client.classification || '—')
        : (classTask?.formData?.f_proposedClass || client.classification || '—');
      const suitLabel  = isFmClient ? 'Investment Profile' : 'Suitability';
      const suitVal    = isFmClient
        ? (suitTask?.formData?.f_fundSuitResult || '—')
        : (suitTask?.formData?.f_overallResult  || '—');
      const engLabel   = isFmClient ? 'Sub. Agreement №' : 'Договор №';
      const engVal     = isFmClient
        ? (engTask?.formData?.f_subNum   || '—')
        : (engTask?.formData?.f_engNum   || '—');
      const engSub     = isFmClient
        ? (engTask?.formData?.f_lpSigned || '')
        : (engTask?.formData?.f_clientSigned || '');

      const amlMonths   = client.riskRating === 'High' ? 6 : 12;
      const amlDate     = (() => { const d = new Date(); d.setMonth(d.getMonth()+amlMonths); return d.toISOString().slice(0,10); })();
      const reClassDate = (() => { const d = new Date(); d.setFullYear(d.getFullYear()+1); return d.toISOString().slice(0,10); })();

      // Restore saved amendments array (for completed task re-view)
      const savedAmendments = fd.amendments ? (typeof fd.amendments === 'string' ? JSON.parse(fd.amendments) : fd.amendments) : [];

      html += `
        <!-- Pre-flight check -->
        <div style="background:${allDone?'rgba(34,197,94,0.08)':'rgba(239,68,68,0.08)'};border:1px solid ${allDone?'rgba(34,197,94,0.25)':'rgba(239,68,68,0.25)'};border-radius:10px;padding:14px;margin-bottom:16px">
          <div style="font-size:13px;font-weight:800;color:${allDone?'#22c55e':'#ef4444'};margin-bottom:${allDone?'0':'10px'}">
            <i class="fas fa-${allDone?'check-circle':'exclamation-triangle'}" style="margin-right:6px"></i>
            ${allDone ? '✅ Все задачи онбординга выполнены — готово к активации!' : `❌ Есть незавершённые задачи (${blockers.length})`}
          </div>
          ${!allDone ? `
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
              ${blockers.map(t => `
                <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:#ef4444">
                  <i class="fas fa-lock" style="font-size:10px;flex-shrink:0"></i>
                  <span>Задача ${t.taskNum}: ${t.title} — <b>${t.status === 'locked' ? 'Заблокирована' : 'Не завершена'}</b></span>
                </div>`).join('')}
            </div>` : ''}
        </div>

        <!-- Prior tasks summary -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">📋 Сводка по онбордингу</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
            ${[
              ['DD Заключение', ddTask?.formData?.f_conclusion||'—', ddTask?.formData?.f_riskTotal||''],
              [classLabel, classVal, classTask?.formData?.f_coDecision||''],
              [suitLabel,  suitVal,  ''],
              [engLabel,   engVal,   engSub],
            ].map(([k,v,sub]) => `
              <div style="background:#1c2333;border-radius:6px;padding:8px 10px">
                <div style="font-size:10px;color:#5a6b8a;margin-bottom:2px;text-transform:uppercase">${k}</div>
                <div style="font-weight:700;color:#e2e8f0">${v}</div>
                ${sub ? `<div style="font-size:10px;color:#8a9bbf">${sub}</div>` : ''}
              </div>`).join('')}
          </div>
        </div>

        ${isFmClient ? _obBuildFmActivationSections(task, client, fd, isCompleted, savedAmendments, formGroupStyle, labelStyle, inputStyle, selectStyle, disabledAttr) : `

        <!-- ══ CF&A 5.1: Contract Upload + Key Terms + Amendments ══ -->

        <!-- Section 1: Contract Key Terms -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-file-signature"></i> Секция 1 — Реквизиты подписанного договора
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">Номер договора *</label>
              <input type="text" id="f_contractNum" value="${fd.contractNum||''}" ${disabledAttr} style="${inputStyle}" placeholder="ENG-2025-001" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата подписания *</label>
              <input type="date" id="f_contractDate" value="${fd.contractDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата истечения договора</label>
              <input type="date" id="f_contractExpiry" value="${fd.contractExpiry||''}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Сумма / объём сделки ($)</label>
              <input type="number" id="f_contractValue" value="${fd.contractValue||''}" ${disabledAttr} style="${inputStyle}" placeholder="0" min="0" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Ставка комиссии (%)</label>
              <input type="number" id="f_feeRate" value="${fd.feeRate||''}" ${disabledAttr} style="${inputStyle}" placeholder="0.00" step="0.01" min="0" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Success Fee (%)</label>
              <input type="number" id="f_successFeeRate" value="${fd.successFeeRate||''}" ${disabledAttr} style="${inputStyle}" placeholder="0.00" step="0.01" min="0" /></div>
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Особые условия</label>
            <textarea id="f_specialConditions" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="Специфические условия договора, ограничения, оговорки...">${fd.specialConditions||''}</textarea></div>
        </div>

        <!-- Section 2: Signed Contract Document -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-link"></i> Секция 2 — Подписанный договор (ссылка)
          </div>
          <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:12px;font-size:11px;color:#93c5fd">
            <i class="fas fa-info-circle" style="margin-right:5px"></i>
            Укажите ссылку на подписанный обеими сторонами PDF договор (Google Drive, SharePoint, OneDrive, корпоративный сервер и т.д.)
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">🔗 Ссылка на подписанный договор (PDF) *</label>
            <div style="display:flex;gap:6px">
              <input type="url" id="f_contractUrl" value="${fd.contractUrl||''}" ${disabledAttr} style="${inputStyle}" placeholder="https://drive.google.com/file/d/... или загрузите файл" />
              ${!isCompleted ? docUploadBtn('f_contractUrl') : ''}
            </div>
          </div>
          ${!isCompleted ? `
          <button type="button" onclick="obViewContract()" style="margin-top:4px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);color:#60a5fa;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px">
            <i class="fas fa-eye"></i> Предпросмотр договора
          </button>` : `
          <button type="button" onclick="obViewContract()" style="margin-top:4px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);color:#60a5fa;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px">
            <i class="fas fa-eye"></i> Открыть договор
          </button>`}
        </div>

        <!-- Section 3: Amendments -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#8b5cf6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-file-alt"></i> Секция 3 — Дополнительные соглашения
          </div>
          <div id="ob_amendments_list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
            ${_obRenderSavedAmendments(savedAmendments, isCompleted)}
          </div>
          ${!isCompleted ? `
          <div style="background:#1c2333;border-radius:8px;padding:10px;margin-bottom:8px" id="ob_amend_input_row">
            <div style="font-size:11px;color:#8b5cf6;font-weight:700;margin-bottom:8px">Новое доп. соглашение:</div>
            <div style="display:grid;grid-template-columns:90px 130px 1fr 200px;gap:8px;align-items:end">
              <div><label style="${labelStyle}">Номер ДС</label>
                <input type="text" id="ob_amend_num" style="${inputStyle}" placeholder="ДС-1" /></div>
              <div><label style="${labelStyle}">Дата подписания</label>
                <input type="date" id="ob_amend_date" style="${inputStyle}" /></div>
              <div><label style="${labelStyle}">Краткое описание</label>
                <input type="text" id="ob_amend_desc" style="${inputStyle}" placeholder="Изменение ставки, продление срока..." /></div>
              <div><label style="${labelStyle}">🔗 Ссылка на ДС</label>
                <div style="display:flex;gap:4px">
                  <input type="url" id="ob_amend_url" style="${inputStyle}" placeholder="https://... или файл" />
                  ${docUploadBtn('ob_amend_url')}
                </div>
              </div>
            </div>
            <button type="button" onclick="obAddAmendment(${task.id})" style="margin-top:8px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.35);color:#c4b5fd;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px">
              <i class="fas fa-plus"></i> Добавить доп. соглашение
            </button>
          </div>` : ''}
        </div>

        <!-- Section 4: Activation -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-check"></i> Секция 4 — Активация клиента
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата активации *</label>
              <input type="date" id="f_activationDate" value="${fd.activationDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Активировал (ФИО юриста / RM) *</label>
              <input type="text" id="f_activatedBy" value="${fd.activatedBy||''}" ${disabledAttr} style="${inputStyle}" placeholder="Введите ФИО..." /></div>
          </div>
          ${buildSelect('f_docsVerified','Документы верифицированы?',['Нет','Да'],fd.docsVerified,disabledAttr,selectStyle,labelStyle)}
          <div style="${formGroupStyle};margin-top:10px"><label style="${labelStyle}">Примечания к активации</label>
            <textarea id="f_activationNotes" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical" placeholder="Дополнительные примечания...">${fd.activationNotes||''}</textarea></div>
        </div>
        `}

        <!-- Auto-dates preview -->
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px;font-size:12px;color:#94a3b8">
          <div style="font-weight:700;color:#22c55e;margin-bottom:10px"><i class="fas fa-magic" style="margin-right:5px"></i>После активации будет автоматически установлено:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${[
              ['Статус клиента', 'Active ✅', '#22c55e'],
              ['Онбординг', 'Completed 🏁', '#3b82f6'],
              [`AML Review (${client.riskRating})`, amlDate, client.riskRating==='High'?'#ef4444':'#f97316'],
              ['Ре-классификация', reClassDate, '#8b5cf6'],
            ].map(([l,v,c]) => `
              <div style="background:#0f1623;border-radius:6px;padding:8px 10px">
                <div style="font-size:10px;color:#5a6b8a;margin-bottom:2px">${l}</div>
                <div style="font-weight:700;color:${c};font-size:12px">${v}</div>
              </div>`).join('')}
          </div>
        </div>`;
      break;
    }

    /* ─── ФОРМА FM-3.1 — LP Qualification Check ──────── */
    case 'lp_qualification': {
      const prevDD  = obTasks.find(t => t.clientId === client.id && t.taskNum === '2.2');
      const ddRisk  = prevDD?.formData?.f_riskTotal || null;
      const isIndivLP = client.type === 'Individual';
      const tid = task.id;

      html += `
        <!-- DD Risk carry-over -->
        ${ddRisk ? `<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#3b82f6;flex-shrink:0"></i>
          Из AML/KYC (2.2): <b>Риск — ${ddRisk}</b>
        </div>` : ''}

        <!-- LP type + policy notice -->
        <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;font-size:12px">
          <i class="fas fa-id-card" style="color:#3b82f6"></i>
          <span>Тип LP: <b style="color:#60a5fa">${statusLabel(client.type)}</b> · LP Type: <b style="color:#60a5fa">${client.lpType||'HNWI'}</b></span>
        </div>

        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#93c5fd">
          <i class="fas fa-info-circle" style="margin-right:6px"></i>
          Компания принимает LP с категорией <b>Qualified Investor</b> или <b>Professional Investor</b>.
          Критерии квалификации аналогичны критериям Professional Client.
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата проверки *</label>
          <input type="date" id="f_qualDate" value="${fd.qualDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        ${isIndivLP ? `
        <!-- ══ INDIVIDUAL LP: Qualified Investor — any 1 of 3 ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-tie"></i> Критерии Qualified Investor — физическое лицо (LP)
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">Достаточно выполнения <b>любого 1</b> из 3 критериев</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_indAssets1m',
              '① Чистые активы ≥ $1,000,000 (без учёта жилья и пенсии)',
              ['Нет','Да'], fd.indAssets1m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_indIncome100k',
              '② Годовой доход ≥ $100,000 в каждый из последних 2 лет',
              ['Нет','Да'], fd.indIncome100k, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_indExperience3y',
              '③ Проф. квалификация / опыт ≥ 3 лет (CFA / CPA / FRM / senior mgmt / portfolio mgmt / trading)',
              ['Нет','Да'], fd.indExperience3y, disabledAttr, selectStyle, labelStyle)}
          </div>
          <div id="lpScoreInd_${tid}" style="padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;background:#1c2333;color:#64748b">
            <i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта
          </div>
        </div>` : `
        <!-- ══ CORPORATE LP: Qualified Investor — any 1 of 4 ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:4px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-building"></i> Критерии Qualified Investor — юридическое лицо (LP)
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">Достаточно выполнения <b>любого 1</b> из 4 критериев (или субкритерия IV)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            ${buildSelect('f_corpTurnover2m',
              '① Годовой оборот ≥ $2,000,000',
              ['Нет','Да'], fd.corpTurnover2m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpBalance1m',
              '② Итог баланса ≥ $1,000,000',
              ['Нет','Да'], fd.corpBalance1m, disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_corpRegulated',
              '③ Регулируемая финансовая организация (банк / УА / страховая)',
              ['Нет','Да'], fd.corpRegulated, disabledAttr, selectStyle, labelStyle)}
          </div>
          <!-- Sub-criterion IV: large corp 2-of-3 -->
          <div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:700">
              ④ Крупная корпорация — необходимо выполнение <b>2 из 3</b> подкритериев:
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${buildSelect('f_corpLargeTurnover',
                'Оборот ≥ $2,000,000',
                ['Нет','Да'], fd.corpLargeTurnover, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_corpLargeBalance',
                'Баланс ≥ $1,000,000',
                ['Нет','Да'], fd.corpLargeBalance, disabledAttr, selectStyle, labelStyle)}
              ${buildSelect('f_corpEmployees50',
                'Штат ≥ 50 сотрудников',
                ['Нет','Да'], fd.corpEmployees50, disabledAttr, selectStyle, labelStyle)}
            </div>
          </div>
          <div id="lpScoreCorp_${tid}" style="padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;background:#1c2333;color:#64748b">
            <i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта
          </div>
        </div>`}

        <!-- ══ Qualification result + FM-specific fields ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-check-double"></i> Итог квалификации LP
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            ${buildSelect('f_pepLP',         'PEP-статус LP',                        ['Не PEP','PEP','Связан с PEP'],         fd.pepLP,          disabledAttr, selectStyle, labelStyle)}
            ${buildSelect('f_sourceOfFunds', 'Источник средств подтверждён',          ['Нет','Да'],                            fd.sourceOfFunds,  disabledAttr, selectStyle, labelStyle)}
          </div>
          ${buildSelect2('f_lpQualResult','Итоговый результат квалификации',['Квалифицирован — Qualified Investor','Квалифицирован — Professional Investor','Не квалифицирован — отказ'],fd.lpQualResult,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Commitment LP (${currencyForFundId(activeFundId)}) *</label>
          <input type="number" id="f_commitmentAmount" value="${fd.commitmentAmount||client.commitment||''}" ${disabledAttr} style="${inputStyle}" placeholder="1000000" /></div>

        <!-- ══ Client notification ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-bell"></i> Уведомление LP
          </div>
          ${buildSelect2('f_clientNotified','LP уведомлён о присвоенной категории?',['Нет','Да — письменно','Да — устно'],fd.clientNotified,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
          <div style="${formGroupStyle}"><label style="${labelStyle}">Дата уведомления</label>
            <input type="date" id="f_notifyDate" value="${fd.notifyDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM</label>
          <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.rmComment||''}</textarea></div>
        ${buildSelect2('f_coDecision','Решение CO',['Ожидается','Подтверждено','Отклонено'],fd.coDecision,disabledAttr,selectStyle,labelStyle,formGroupStyle)}`;
      break;
    }

    /* ─── ФОРМА FM-3.2 — LP Investment Profile & Suitability ── */
    case 'lp_investment_profile': {
      const prevQual = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.1');
      const qualResult = prevQual?.formData?.f_lpQualResult || '';

      html += `
        ${prevQual ? `<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#3b82f6;flex-shrink:0"></i>
          Квалификация LP (3.1): <b style="color:${qualResult.includes('Не')?'#ef4444':'#22c55e'}">${qualResult||'—'}</b>
        </div>` : ''}

        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#93c5fd">
          <i class="fas fa-info-circle" style="margin-right:6px"></i>
          FM: инвестиционный профиль LP для определения соответствия стратегии фонда (Fund Suitability для FM — оценка пригодности инвестиционной стратегии для конкретного LP).
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Дата профилирования *</label>
          <input type="date" id="f_profileDate" value="${fd.profileDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>

        <!-- Инвестиционный профиль LP -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px">
            <i class="fas fa-chart-pie" style="margin-right:5px"></i>Инвестиционный профиль LP
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_investHorizon','Инвестиционный горизонт',['Краткосрочный (<3 л.)','Среднесрочный (3–7 л.)','Долгосрочный (7+ л.)'],fd.investHorizon,disabledAttr,selectStyle,labelStyle)}
            ${buildSelect('f_riskAppetite','Риск-аппетит',['Консервативный','Умеренный','Агрессивный'],fd.riskAppetite,disabledAttr,selectStyle,labelStyle)}
            ${buildSelect('f_altFundExp','Опыт в альтернативных фондах',['Нет','Менее 3 лет','3–7 лет','Более 7 лет'],fd.altFundExp,disabledAttr,selectStyle,labelStyle)}
            ${buildSelect('f_liquidityPref','Ожидания по ликвидности',['Нет (closed-end)','Частичная','Полная'],fd.liquidityPref,disabledAttr,selectStyle,labelStyle)}
          </div>
        </div>

        <!-- Соответствие стратегии фонда -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px">
            <i class="fas fa-bullseye" style="margin-right:5px"></i>Соответствие стратегии фонда
          </div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Стратегия фонда понятна LP?</label>
            <select id="f_strategyUnderstood" ${disabledAttr} style="${selectStyle}">
              ${['Да','Нет','Частично'].map(o=>`<option ${(fd.strategyUnderstood||'Да')===o?'selected':''}>${o}</option>`).join('')}
            </select></div>
          <div style="${formGroupStyle}"><label style="${labelStyle}">Риски фонда раскрыты LP (blind pool)?</label>
            <select id="f_risksDisclosed" ${disabledAttr} style="${selectStyle}">
              ${['Да — письменно','Да — устно','Нет'].map(o=>`<option ${(fd.risksDisclosed||'Да — письменно')===o?'selected':''}>${o}</option>`).join('')}
            </select></div>
          ${buildSelect2('f_fundSuitResult','Итог: LP соответствует стратегии фонда?',['Да — полностью','Условно — с оговорками','Нет — отказ'],fd.fundSuitResult,disabledAttr,selectStyle,labelStyle,formGroupStyle)}
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM</label>
          <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.rmComment||''}</textarea></div>
        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий CO / Compliance</label>
          <textarea id="f_coComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.coComment||''}</textarea></div>`;
      break;
    }

    /* ─── ФОРМА FM-4.1 — Subscription Agreement ───────── */
    case 'subscription_agreement': {
      const prevQual    = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.1');
      const prevProfile = obTasks.find(t => t.clientId === client.id && t.taskNum === '3.2');
      const qualResult  = prevQual?.formData?.f_lpQualResult    || '';
      const profileResult = prevProfile?.formData?.f_fundSuitResult || '';

      html += `
        <!-- Carry-over banners -->
        ${prevQual ? `<div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:8px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#3b82f6;flex-shrink:0"></i>
          LP Квалификация (3.1): <b style="color:#60a5fa">${qualResult||'—'}</b>
        </div>` : ''}
        ${prevProfile ? `<div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:12px;display:flex;align-items:center;gap:8px">
          <i class="fas fa-link" style="color:#22c55e;flex-shrink:0"></i>
          Investment Profile (3.2): <b style="color:${profileResult.includes('Нет')?'#ef4444':'#22c55e'}">${profileResult||'—'}</b>
        </div>` : ''}

        <!-- SA info banner -->
        <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:14px;font-size:12px;color:#93c5fd;display:flex;align-items:center;gap:8px">
          <i class="fas fa-info-circle" style="flex-shrink:0"></i>
          <span>SA служит юридическим основанием для юристов при составлении <b>LP Agreement</b>. После подписания SA → ссылка на LP Agreement фиксируется в задаче 5.1.</span>
        </div>

        <!-- ══ Section 1: SA Identification ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-file-signature"></i> Секция 1 — Реквизиты Subscription Agreement
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">Номер SA *</label>
              <input type="text" id="f_subNum" value="${fd.subNum||`SA-${new Date().getFullYear()}-${String(engIdCounter).padStart(3,'0')}`}" ${disabledAttr} style="${inputStyle}" placeholder="SA-2025-001" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата SA *</label>
              <input type="date" id="f_subDate" value="${fd.subDate||today()}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата LPA (основное соглашение) *</label>
              <input type="date" id="f_lpaDate" value="${fd.lpaDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            ${buildSelect('f_fundClass','Класс долей (Fund Class)',['Class A','Class B','Class C','Founder Class'],fd.fundClass,disabledAttr,selectStyle,labelStyle)}
          </div>
        </div>

        <!-- ══ Section 2: LP данные ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#8b5cf6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-tie"></i> Секция 2 — LP: данные подписанта
          </div>
          <div style="background:#1c2333;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#94a3b8">
            <b style="color:#c4b5fd">${client.name}</b> · ${client.type} · Commitment: <b style="color:#60a5fa">${fmtCurrency(client.commitment||0, currencyForFundId(activeFundId))}</b>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">ФИО Директора / CEO LP (подписант) *</label>
              <input type="text" id="f_lpCEO" value="${fd.lpCEO||''}" ${disabledAttr} style="${inputStyle}" placeholder="Иванов Иван Иванович" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Должность подписанта LP</label>
              <input type="text" id="f_lpSignerTitle" value="${fd.lpSignerTitle||'Генеральный директор'}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}" style="grid-column:span 2"><label style="${labelStyle}">Юридический адрес LP</label>
              <input type="text" id="f_lpAddress" value="${fd.lpAddress||''}" ${disabledAttr} style="${inputStyle}" placeholder="Республика Казахстан, г. ..." /></div>
          </div>
        </div>

        <!-- ══ Section 3: Коммерческие условия ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-dollar-sign"></i> Секция 3 — Коммерческие условия
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">Capital Commitment LP (${currencyForFundId(activeFundId)}) *</label>
              <input type="number" id="f_subCommitment" value="${fd.subCommitment||client.commitment||''}" ${disabledAttr} style="${inputStyle}" placeholder="500000" min="0" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата первого Capital Call (план)</label>
              <input type="date" id="f_firstCallDate" value="${fd.firstCallDate||''}" ${disabledAttr} style="${inputStyle}" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">Дата истечения SA</label>
              <input type="date" id="f_subExpiry" value="${fd.subExpiry||''}" ${disabledAttr} style="${inputStyle}" /></div>
          </div>
        </div>

        <!-- ══ Section 4: Банковские реквизиты LP ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-university"></i> Секция 4 — Банковские реквизиты LP (для перечисления)
          </div>
          <div style="background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.15);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#fdba74">
            <i class="fas fa-info-circle" style="margin-right:5px"></i>
            Реквизиты LP — уникальные для каждого инвестора. Поля для ручного заполнения.
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="${formGroupStyle}"><label style="${labelStyle}">Название банка LP</label>
              <input type="text" id="f_bankName" value="${fd.bankName||''}" ${disabledAttr} style="${inputStyle}" placeholder="АО «Народный Банк Казахстана»" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">БИК / SWIFT</label>
              <input type="text" id="f_bankSWIFT" value="${fd.bankSWIFT||''}" ${disabledAttr} style="${inputStyle}" placeholder="HSBKKZKX" /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">IBAN / ИИК (KZT)</label>
              <input type="text" id="f_bankIBANkzt" value="${fd.bankIBANkzt||''}" ${disabledAttr} style="${inputStyle}" placeholder="KZ..." /></div>
            <div style="${formGroupStyle}"><label style="${labelStyle}">IBAN / ИИК (USD)</label>
              <input type="text" id="f_bankIBANusd" value="${fd.bankIBANusd||''}" ${disabledAttr} style="${inputStyle}" placeholder="KZ..." /></div>
            <div style="${formGroupStyle}" style="grid-column:span 2"><label style="${labelStyle}">Адрес банка LP</label>
              <input type="text" id="f_bankAddress" value="${fd.bankAddress||''}" ${disabledAttr} style="${inputStyle}" placeholder="г. Алматы, ул. ..." /></div>
          </div>
        </div>

        <!-- ══ Section 5: Статус подписания ══ -->
        <div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px">
            <i class="fas fa-signature"></i> Секция 5 — Статус подписания SA
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            ${buildSelect('f_lpSigned','Подписан LP?',['Нет','Ожидается','Да — оригинал','Да — эл. подпись'],fd.lpSigned,disabledAttr,selectStyle,labelStyle)}
            ${buildSelect('f_gpSigned','Подписан GP (Golden Leaves Ltd)?',['Нет','Ожидается','Да'],fd.gpSigned,disabledAttr,selectStyle,labelStyle)}
          </div>
        </div>

        <div style="${formGroupStyle}"><label style="${labelStyle}">Комментарий RM</label>
          <textarea id="f_rmComment" rows="2" ${disabledAttr} style="${inputStyle};resize:vertical">${fd.rmComment||''}</textarea></div>

        <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:10px 14px;font-size:11px;color:#93c5fd">
          <i class="fas fa-info-circle" style="margin-right:5px"></i>
          После завершения: SA попадает в <b>Реестр договоров</b>. Юристы используют SA для составления LP Agreement → ссылка на LPA фиксируется в задаче <b>5.1</b>.
        </div>`;
      break;
    }

    default:
      html += `<div style="padding:40px;text-align:center;color:#8a9bbf">Форма: ${task.formKey}</div>`;
  }

  const pdfBtn = obTaskPdfButtonHtml(task, client);

  // Submit / comment section — show re-open banner if completed
  if (isCompleted) {
    const canEdit = (currentUserRole() !== 'RELATIONSHIP_MANAGER');
    const editBtn = canEdit
      ? '<button onclick="reopenObTask(' + task.id + ')" style="background:rgba(249,115,22,0.15);border:1px solid rgba(249,115,22,0.35);color:#fb923c;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0"><i class=\\"fas fa-pen\\" style=\\"margin-right:5px\\"></i>Редактировать</button>'
      : '<span style="font-size:11px;color:#4a5568">RM: редактирование недоступно</span>';
    html += `
      <div style="margin-top:14px;padding:10px 14px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <i class="fas fa-check-circle" style="color:#22c55e;font-size:16px;flex-shrink:0"></i>
        <div style="flex:1;font-size:12px;color:#86efac;min-width:120px">
          Задача выполнена <strong>${task.completedAt || ''}</strong> · ${task.completedBy || ''}
        </div>
        ${pdfBtn}
        ${editBtn}
      </div>`;
  } else {
    const wallCheck  = chineseWallCheck(client);
    const wallBlocked = !wallCheck.allowed;
    // For doc_collection: compute initial readiness to pre-set button state
    const isDocForm   = task.formKey === 'doc_collection';
    // We'll set id="obSubmitTaskBtn" so obDocStatusChange() can control it
    const submitDisabled = wallBlocked ? 'disabled' : '';
    const submitBg = wallBlocked
      ? 'rgba(100,116,139,0.2)'
      : 'linear-gradient(135deg,#22c55e,#16a34a)';
    const submitColor  = wallBlocked ? '#4a5568' : '#fff';
    const submitCursor = wallBlocked ? 'not-allowed' : 'pointer';
    const submitIcon   = wallBlocked ? 'lock' : 'check';
    const submitLabel  = wallBlocked ? 'Заблокировано' : 'Завершить задачу';
    const submitTitle  = wallBlocked ? 'title="Китайская стена: запрещено"' : '';
    html += `
      <div style="padding-top:14px;border-top:1px solid #2a3448;margin-top:10px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center">
        ${isDocForm ? `<span id="obSubmitDocHint" style="font-size:11px;color:#eab308;flex:1;display:none">
          <i class="fas fa-exclamation-triangle" style="margin-right:4px"></i>Получите все обязательные документы
        </span>` : ''}
        ${pdfBtn}
        <button id="obSubmitTaskBtn" onclick="submitObTask(${task.id})" ${submitDisabled} ${submitTitle}
          style="background:${submitBg};border:none;color:${submitColor};padding:8px 20px;border-radius:8px;cursor:${submitCursor};font-size:13px;font-weight:700;transition:all .2s">
          <i class="fas fa-${submitIcon}" style="margin-right:5px"></i>${submitLabel}
        </button>
      </div>`;
  }

  return html;
}

/* ── Helper: build inline select ───────────────── */
function buildSelect(id, label, options, selected, disabled, style, labelStyle) {
  return `<div><label style="${labelStyle}">${label}</label>
    <select id="${id}" ${disabled} style="${style}">
      ${options.map(o => `<option ${(selected||options[0])===o?'selected':''}>${o}</option>`).join('')}
    </select></div>`;
}
function buildSelect2(id, label, options, selected, disabled, style, labelStyle, groupStyle) {
  return `<div style="${groupStyle}"><label style="${labelStyle}">${label}</label>
    <select id="${id}" ${disabled} style="${style}">
      ${options.map(o => `<option ${(selected||options[0])===o?'selected':''}>${o}</option>`).join('')}
    </select></div>`;
}
function today() { return new Date().toISOString().slice(0,10); }

/* ═══════════════════════════════════════════════════
   SAVE / SUBMIT TASK
═══════════════════════════════════════════════════ */

/** @deprecated — replaced by auto-save; kept for safety */
async function submitObTask(taskId) {
  const task   = obTasks.find(t => t.id === taskId);
  const client = obClients.find(c => c.id === task?.clientId);
  if (!task || !client) return;

  // ── Chinese Wall check ──────────────────────────
  if (!checkWallBeforeSubmit(client)) return;

  // ── doc_collection: блокировка если не все обязательные получены ──
  if (task.formKey === 'doc_collection') {
    const missing = obDocGetMissing();
    if (missing.length > 0) {
      showToast('🔴 Нельзя завершить: ' + missing.length + ' обяз. документ(а) не получены:\n' + missing.slice(0,3).join('; ') + (missing.length>3?'…':''), 'red');
      return;
    }
  }

  // ── suitability: Retail Client + Arranging — блокировка без одобрения CEO ──
  // (Removed: company does not accept Retail Clients per policy)

  const fd = collectFormData(task.formKey, task.clientId);

  // ── Confirm before committing an outcome that halts onboarding and
  //    notifies leadership (mirrors the rejection checks in the routing
  //    logic below) — once submitted the task is 'completed' and there is
  //    no re-decide control in the UI, same one-shot risk as the IC vote /
  //    conflict-approval decisions this confirm pattern also guards. ──
  const willHaltOnboarding = ({
    conflict_precheck:     () => (fd.f_decision       || '').includes('No-Go'),
    dd_outcome:            () => (fd.f_conclusion     || '').includes('Отказать'),
    suitability:           () => fd.f_overallResult === 'Не подходит — отказ',
    lp_qualification:      () => (fd.f_lpQualResult   || '').includes('Не квалифицирован'),
    lp_investment_profile: () => fd.f_fundSuitResult === 'Нет — отказ',
  }[task.formKey] || (() => false))();
  if (willHaltOnboarding && !confirm('Это решение остановит онбординг клиента и уведомит руководство. Отменить его после отправки будет нельзя. Продолжить?')) return;

  task.formData    = fd;
  task.status      = 'completed';
  task.completedAt = today();
  task.completedBy = currentUserDisplayName();
  // ── Clear draft from localStorage ──────────────────
  obDraftClear(task.id);

  // ── Routing logic ────────────────────────────
  let rejected = false;

  if (task.formKey === 'conflict_precheck') {
    const decision = fd.f_decision || '';
    if (decision.includes('No-Go')) {
      rejected = true;
      client.onboardingStatus = 'Delayed';
      showToast('🔴 No-Go: онбординг остановлен', 'red');
    } else if (decision.includes('эскалации')) {
      task.status = 'escalated';
      showToast('🟡 Эскалация к CO', 'orange');
    }
    if (fd.f_restrictedMatch === 'Да') await checkRestrictedList(client);
  }

  if (task.formKey === 'dd_outcome') {
    const conclusion = fd.f_conclusion || '';
    if (conclusion.includes('Отказать')) {
      rejected = true;
      client.onboardingStatus = 'Delayed';
      showToast('🔴 DD Outcome: отказано. Уведомлен SEO/CEO.', 'red');
    } else if (conclusion.includes('EDD')) {
      showToast('🟡 Назначена расширенная проверка (EDD)', 'orange');
    }
    // ── KYC checklist summary (Onboarding Templates 1/2/6/8) — propagate
    // from this task's granular fields onto the client record so the
    // checklist is queryable without parsing every task's form_data_json.
    // Runs regardless of the conclusion: these reflect what was actually
    // checked, not whether the client was approved. ──
    client.identityVerified   = fd.f_corpVerified === 'Да';
    client.pepStatus          = fd.f_pepClient || client.pepStatus;
    client.sanctionsCleared   = fd.f_sanctionTotal === 'Чисто';
    client.sanctionsCheckedAt = fd.f_ddDate || today();
    if (client.direction === 'FM') {
      client.sofVerified = fd.f_sofVerified === 'Да';
      client.sowVerified = fd.f_sowVerified === 'Да';
    }
  }

  if (task.formKey === 'suitability') {
    const result = fd.f_overallResult || '';
    if (result === 'Не подходит — отказ') {
      rejected = true;
      client.onboardingStatus = 'Delayed';
      showToast('🔴 Suitability: клиент не подходит. Уведомлен CEO.', 'red');
    }
  }

  // ── Classification: update client.classification ──────
  if (task.formKey === 'classification' && !rejected) {
    const newClass = fd.f_proposedClass;
    if (newClass && newClass !== client.classification) {
      client.classification = newClass;
      showToast(`📋 Классификация обновлена: ${newClass}`, 'blue');
    }
    // Professional Client status check (Onboarding Templates, Template 5)
    // was completed and scored — mark it verified regardless of whether
    // the resulting tier changed.
    if (newClass) client.professionalClientVerified = true;
  }

  // ── LP Qualification: update client.classification ────
  if (task.formKey === 'lp_qualification' && !rejected) {
    const result = fd.f_lpQualResult || '';
    if (result.includes('Не квалифицирован')) {
      rejected = true;
      client.onboardingStatus = 'Delayed';
      showToast('🔴 LP не квалифицирован. Онбординг остановлен.', 'red');
    } else {
      const newClass = fd.f_classification || 'Qualified Investor';
      client.classification = newClass;
      if (fd.f_commitmentAmount) client.commitment = parseFloat(fd.f_commitmentAmount);
    }
  }

  // ── LP Investment Profile: block if not suitable ──────
  if (task.formKey === 'lp_investment_profile' && !rejected) {
    const result = fd.f_fundSuitResult || '';
    if (result === 'Нет — отказ') {
      rejected = true;
      client.onboardingStatus = 'Delayed';
      showToast('🔴 LP не соответствует стратегии фонда. Онбординг остановлен.', 'red');
    }
  }

  // ── Subscription Agreement: auto-create + persist in engagements[] ─
  if (task.formKey === 'subscription_agreement' && !rejected) {
    const subNum = fd.f_subNum || `SA-${new Date().getFullYear()}-${String(engIdCounter).padStart(3,'0')}`;
    const alreadyExists = engagements.some(e => e.contractNum === subNum && e.clientId === client.id);
    if (!alreadyExists) {
      const commitment = parseFloat(fd.f_subCommitment) || client.commitment || 0;
      const newEng = {
        engId:       `SA-${new Date().getFullYear()}-${String(engIdCounter++).padStart(3,'0')}`,
        clientId:    client.id,
        clientName:  client.name,
        serviceType: 'LP Investment (FM)',
        direction:   'FM',
        contractNum: subNum,
        date:        fd.f_subDate || today(),
        status:      (fd.f_lpSigned || '').startsWith('Да') && (fd.f_gpSigned||'') === 'Да' ? 'Active' : 'Draft',
        feeType:     'Management Fee + Carry',
        feeAmount:   commitment,
        currency:    currencyForFundId(activeFundId),
        successFee:  20,     // стандартный carry 20%
        retainer:    null,
        payTerms:    'По Capital Call',
        invoiced:    0,
        paid:        0,
        startDate:   fd.f_subDate    || today(),
        endDate:     fd.f_subExpiry  || '',
        rm:          currentUserDisplayName(),
        notes:       `FM LP Subscription. Commitment: ${fmtCurrency(commitment, currencyForFundId(activeFundId))}. Fund class: ${fd.f_fundClass||'—'}. ${fd.f_rmComment||''}`,
      };
      try {
        const created = await apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify(newEng) });
        engagements.push(created);
        showToast(`📄 Subscription Agreement ${created.engId} добавлен в Реестр`, 'green');
      } catch (err) {
        showToast('⚠️ Не удалось сохранить Subscription Agreement: ' + err.message, 'red');
      }
    }
  }

  // ── Engagement Letter: auto-create + persist in engagements[] ─────
  if (task.formKey === 'engagement_letter' && !rejected) {
    // Check for duplicate by contract number
    const engNum = fd.f_engNum || `GL-${new Date().getFullYear()}-${String(engIdCounter).padStart(3,'0')}`;
    const alreadyExists = engagements.some(e => e.contractNum === engNum && e.clientId === client.id);
    if (!alreadyExists) {
      const newEng = {
        engId:       `ENG-${new Date().getFullYear()}-${String(engIdCounter++).padStart(3,'0')}`,
        clientId:    client.id,
        clientName:  client.name,
        serviceType: client.serviceType,
        direction:   'CF&A',
        contractNum: engNum,
        date:        fd.f_engDate || today(),
        status:      fd.f_clientSigned === 'Да' ? 'Active' : 'Draft',
        feeType:     fd.f_feeType || 'Fixed Fee',
        feeAmount:   parseFloat(fd.f_feeAmount) || 0,
        currency:    fd.f_currency || 'USD',
        successFee:  parseFloat(fd.f_successFee) || null,
        retainer:    parseFloat(fd.f_retainer)   || null,
        payTerms:    fd.f_payTerms || 'При подписании',
        invoiced:    0,
        paid:        0,
        startDate:   fd.f_engDate    || today(),
        endDate:     fd.f_engExpiry  || '',
        rm:          currentUserDisplayName(),
        notes:       fd.f_rmComment  || '',
      };
      try {
        const created = await apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify(newEng) });
        engagements.push(created);
        showToast(`📄 Договор ${created.engId} автоматически добавлен в Реестр`, 'green');
      } catch (err) {
        showToast('⚠️ Не удалось сохранить договор: ' + err.message, 'red');
      }
    }
  }

  // ── Activation: blocker check ──────────────────────────
  if (task.formKey === 'activation') {
    const allPrevTasks = obTasks.filter(t => t.clientId === client.id && t.taskNum !== '5.1');
    const allDoneNow   = allPrevTasks.every(t => t.status === 'completed' || t.status === 'escalated');
    if (!allDoneNow) {
      // Revert status — activation is blocked
      task.status      = 'open';
      task.completedAt = null;
      task.completedBy = null;
      const blockerNames = allPrevTasks
        .filter(t => t.status !== 'completed' && t.status !== 'escalated')
        .map(t => `${t.taskNum}: ${t.title}`).join(', ');
      showToast(`⛔ Активация заблокирована. Незавершено: ${blockerNames}`, 'red');
      closeObTaskForm();
      renderObContent();
      return;  // exit — do not proceed
    }
    if (!rejected) {
      // ── CF&A: persist contractUrl + amendments to engagement record ──
      if (client.direction !== 'FM') {
        const contractUrl  = fd.f_contractUrl  || fd.contractUrl  || '';
        const amendments   = fd.f_amendments   || fd.amendments   || '[]';
        const contractNum  = fd.f_contractNum  || fd.contractNum  || '';
        const contractDate = fd.f_contractDate || fd.contractDate || '';
        const contractExpiry = fd.f_contractExpiry || fd.contractExpiry || '';
        const contractValue  = fd.f_contractValue  || fd.contractValue  || '';
        const feeRate        = fd.f_feeRate        || fd.feeRate        || '';
        const successFeeRate = fd.f_successFeeRate || fd.successFeeRate || '';
        const specialCond    = fd.f_specialConditions || fd.specialConditions || '';
        const activationDate = fd.f_activationDate   || fd.activationDate   || today();
        const activatedBy    = fd.f_activatedBy      || fd.activatedBy      || '';
        // Update matching engagement record (created at 4.1 step)
        let engRecord = engagements.find(e => e.clientId === client.id && e.serviceType !== 'LP Investment (FM)');
        const engRecordIsNew = !engRecord;
        if (!engRecord) {
          // 4.1 was skipped — create record now from 5.1 data
          const seq2 = String(engIdCounter++).padStart(3,'0');
          engRecord = {
            engId:       `ENG-${new Date().getFullYear()}-${seq2}`,
            clientId:    client.id,
            clientName:  client.name,
            serviceType: client.serviceType || 'Advising',
            direction:   'CF&A',
            contractNum: contractNum || `GL-${new Date().getFullYear()}-${seq2}`,
            date:        contractDate || today(),
            status:      'Active',
            feeType:     'Fixed Fee',
            feeAmount:   parseFloat(contractValue) || 0,
            // No currency field on the 5.1 form itself (only 4.1 has one) —
            // this branch only fires when 4.1 was skipped entirely, so
            // there's nothing to read; defaults to USD like everywhere else
            // absent an explicit choice.
            currency:    'USD',
            successFee:  parseFloat(successFeeRate) || null,
            retainer:    null,
            payTerms:    'При подписании',
            invoiced:    0, paid: 0,
            startDate:   contractDate || today(),
            endDate:     contractExpiry || '',
            rm:          currentUserDisplayName(),
            notes:       specialCond || '',
          };
        } else {
          if (contractUrl)    engRecord.contractUrl  = contractUrl;
          if (amendments)     engRecord.amendments   = amendments;
          if (contractNum)    engRecord.contractNum  = contractNum;
          if (contractDate)   engRecord.signedDate   = contractDate;
          if (contractExpiry) engRecord.endDate      = contractExpiry;
          if (contractValue)  engRecord.dealValue    = parseFloat(contractValue) || engRecord.feeAmount;
          if (feeRate)        engRecord.feeRate      = parseFloat(feeRate);
          if (successFeeRate) engRecord.successFee   = parseFloat(successFeeRate);
          if (specialCond)    engRecord.notes        = (engRecord.notes||'') + ' | ' + specialCond;
        }
        engRecord.status         = 'Active';
        engRecord.direction      = engRecord.direction || 'CF&A';
        engRecord.activationDate = activationDate;
        engRecord.activatedBy    = activatedBy;
        engRecord.contractUrl    = engRecord.contractUrl || contractUrl;
        try {
          if (engRecordIsNew) {
            const created = await apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify(engRecord) });
            Object.assign(engRecord, created);
            engagements.push(engRecord);
            showToast(`📄 Договор ${engRecord.engId} создан и активирован в Реестре`, 'green');
          } else {
            const updated = await apiFetch(`/api/engagements/${engRecord.id}`, { method: 'PUT', body: JSON.stringify(engRecord) });
            Object.assign(engRecord, updated);
            showToast(`📄 Договор ${contractNum||engRecord.contractNum} обновлён в Реестре → Active`, 'green');
          }
        } catch (err) {
          showToast('⚠️ Не удалось сохранить договор: ' + err.message, 'red');
        }
        // Store on client for quick access
        client.contractUrl = contractUrl;
        client.activatedBy = activatedBy;
        // Reset runtime amendments array
        window._obAmendments = [];
      }

      // ── FM: persist lpaUrl + amendments + key LPA params to engagement record ──
      if (client.direction === 'FM') {
        const lpaUrl             = fd.f_lpaUrl             || fd.lpaUrl             || '';
        const amendments         = fd.f_amendments         || fd.amendments         || '[]';
        const contractNum        = fd.f_contractNum        || fd.contractNum        || '';
        const contractDate       = fd.f_contractDate       || fd.contractDate       || '';
        const contractExpiry     = fd.f_contractExpiry     || fd.contractExpiry     || '';
        const commitmentConfirmed= fd.f_commitmentConfirmed|| fd.commitmentConfirmed|| '';
        const lpSignedDate       = fd.f_lpSignedDate       || fd.lpSignedDate       || '';
        const capitalCallDate    = fd.f_capitalCallDate    || fd.capitalCallDate    || '';
        const capitalCallSchedule= fd.f_capitalCallSchedule|| fd.capitalCallSchedule|| '';
        const activationDate     = fd.f_activationDate     || fd.activationDate     || today();
        const activatedBy        = fd.f_activatedBy        || fd.activatedBy        || '';
        // Find or create SA engagement record
        let saRecord = engagements.find(e => e.clientId === client.id && e.serviceType === 'LP Investment (FM)');
        const saRecordIsNew = !saRecord;
        if (!saRecord) {
          // 4.1 was skipped — create record now
          const seq2 = String(engIdCounter++).padStart(3,'0');
          const cmt  = parseFloat(commitmentConfirmed) || client.commitment || 0;
          saRecord = {
            engId:       `SA-${new Date().getFullYear()}-${seq2}`,
            clientId:    client.id,
            clientName:  client.name,
            serviceType: 'LP Investment (FM)',
            direction:   'FM',
            contractNum: contractNum || `SA-${new Date().getFullYear()}-${seq2}`,
            date:        contractDate || today(),
            status:      'Active',
            feeType:     'Management Fee + Carry',
            feeAmount:   cmt,
            currency:    currencyForFundId(activeFundId),
            successFee:  20,
            retainer:    null,
            payTerms:    'По Capital Call',
            invoiced:    0, paid: 0,
            startDate:   contractDate || today(),
            endDate:     contractExpiry || '',
            rm:          currentUserDisplayName(),
            notes:       `FM LP Subscription. Commitment: ${fmtCurrency(cmt, currencyForFundId(activeFundId))}.`,
          };
        }
        // Enrich record with 5.1 form data
        saRecord.status          = 'Active';
        saRecord.direction       = 'FM';
        saRecord.lpaUrl          = lpaUrl          || saRecord.lpaUrl || '';
        saRecord.amendments      = amendments      || saRecord.amendments || '[]';
        if (contractNum)         saRecord.contractNum      = contractNum;
        if (contractDate)        saRecord.signedDate       = contractDate;
        if (contractExpiry)      saRecord.endDate          = contractExpiry;
        if (commitmentConfirmed) saRecord.feeAmount        = parseFloat(commitmentConfirmed) || saRecord.feeAmount;
        if (lpSignedDate)        saRecord.lpSignedDate     = lpSignedDate;
        if (capitalCallDate)     saRecord.capitalCallDate  = capitalCallDate;
        if (capitalCallSchedule) saRecord.notes            = (saRecord.notes||'') + ' | CC: ' + capitalCallSchedule;
        saRecord.activationDate  = activationDate;
        saRecord.activatedBy     = activatedBy;
        try {
          if (saRecordIsNew) {
            const created = await apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify(saRecord) });
            Object.assign(saRecord, created);
            engagements.push(saRecord);
            showToast(`📄 LP Agreement ${saRecord.engId} создан и активирован в Реестре`, 'green');
          } else {
            const updated = await apiFetch(`/api/engagements/${saRecord.id}`, { method: 'PUT', body: JSON.stringify(saRecord) });
            Object.assign(saRecord, updated);
            showToast(`📄 LP Agreement ${contractNum||saRecord.contractNum} обновлён в Реестре → Active`, 'green');
          }
        } catch (err) {
          showToast('⚠️ Не удалось сохранить LP Agreement: ' + err.message, 'red');
        }
        // Store on client for quick access
        client.lpaUrl      = lpaUrl;
        client.activatedBy = activatedBy;
        // Reset runtime amendments array
        window._obAmendments = [];
      }

      client.activated        = true;
      client.onboardingStatus = 'Completed';
      client.phase            = 5;
      client.nextAction       = '—';
      // AML review date
      const amlMonths = client.riskRating === 'High' ? 6 : 12;
      const amlDateD  = new Date(); amlDateD.setMonth(amlDateD.getMonth() + amlMonths);
      client.amlReviewDate = amlDateD.toISOString().slice(0,10);
      // Re-classification date
      const reClassD = new Date(); reClassD.setFullYear(reClassD.getFullYear() + 1);
      client.reClassDate = reClassD.toISOString().slice(0,10);
      showToast(`✅ Клиент "${client.name}" активирован! Статус: Active`, 'green');

      // ── Auto-register FM LP into LP Register ──────────────
      // registerLPFromOnboarding is now async (POSTs to /api/lp) — the
      // navigate+highlight follow-up must wait for the real saved LP
      // (with its server-assigned id) instead of racing ahead of it.
      if (client.direction === 'FM' && typeof registerLPFromOnboarding === 'function') {
        const saTask  = obTasks.find(t => t.clientId === client.id && t.formKey === 'subscription_agreement');
        const actTask = task; // activation task 5.1: has f_lpaUrl, f_contractNum, f_commitmentConfirmed
        registerLPFromOnboarding(client, saTask, actTask).then(function(savedLP) {
          if (!savedLP) return; // duplicate, or save failed — error/info toast already shown

          var newLPId = savedLP.id;

          setTimeout(function() {
            if (typeof navigateTo === 'function') {
              // Закрыть модал клиента перед переходом (иначе перекрывает LP Register)
              closeObClientModal();
              navigateTo('lp-register');
              // Wait for renderLPRegisterPage() to finish writing DOM
              setTimeout(function() {
                var selector = newLPId !== null
                  ? '#lpRegisterContent tr[data-lp-id="' + newLPId + '"]'
                  : '#lpRegisterContent tr[data-lp-id]';
                var targetRow = document.querySelector(selector);
                if (!targetRow) {
                  // fallback: last row
                  var allRows = document.querySelectorAll('#lpRegisterContent tr[data-lp-id]');
                  targetRow = allRows.length ? allRows[allRows.length - 1] : null;
                }
                if (targetRow) {
                  targetRow.style.transition = 'background 0.6s';
                  targetRow.style.background = 'rgba(34,197,94,0.25)';
                  targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(function(){ targetRow.style.background = ''; }, 3000);
                }
              }, 600);
            }
          }, 900);
        });
      }
    }
  }

  if (rejected) {
    task.status = 'rejected';
  } else {
    unlockNextTask(client.id, task.taskNum);
  }

  // Persist everything that may have changed: this task, any sibling tasks
  // unlockNextTask() just opened, and the client (phase/onboardingStatus/KYC
  // fields/etc. — too many conditional branches above touch it to track
  // precisely, so the whole object is sent; PUT /api/ob-clients/:id already
  // does a safe partial merge). Best-effort: the local UI above has already
  // committed these changes and this function's branching is too entangled
  // to safely unwind on a failed save, so a failure here is a warning, not
  // a rollback.
  const clientTasks = obTasks.filter(t => t.clientId === client.id);
  const persistResults = await Promise.allSettled([
    ...clientTasks.map(t => apiFetch(`/api/ob-tasks/${t.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: t.status, formData: t.formData, completedAt: t.completedAt, completedBy: t.completedBy }),
    })),
    apiFetch(`/api/ob-clients/${client.id}`, { method: 'PUT', body: JSON.stringify(client) }),
  ]);
  if (persistResults.some(r => r.status === 'rejected')) {
    showToast('⚠️ Часть изменений не удалось сохранить на сервере — обновите страницу и проверьте', 'orange');
  }

  updateBadges();

  // Вернуться к карточке клиента (форма показывалась инлайн)
  closeObTaskForm();
  renderObContent();
}

/* ── Reopen completed task for editing ─────────────────
   Allowed roles: CEO, CO, MLRO, Analyst (NOT RM)
   Saves current formData snapshot as previousFormData,
   resets status → 'open', re-renders the form in editable mode.
────────────────────────────────────────────────────── */
async function reopenObTask(taskId) {
  // Role guard
  if (currentUserRole() === 'RELATIONSHIP_MANAGER') {
    showToast('⛔ RM не может редактировать завершённые задачи', 'red');
    return;
  }

  const task = obTasks.find(t => t.id === taskId);
  if (!task) return;
  if (task.status !== 'completed' && task.status !== 'escalated' && task.status !== 'rejected') {
    showToast('Задача уже открыта для редактирования', 'blue');
    return;
  }

  try {
    await apiFetch(`/api/ob-tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'open', completedAt: null, completedBy: null }),
    });
  } catch (err) {
    showToast('⚠️ Не удалось открыть задачу для редактирования: ' + err.message, 'red');
    return;
  }

  // Snapshot (local-only convenience for the in-form "what changed" view — no DB column)
  task.previousFormData  = JSON.parse(JSON.stringify(task.formData || {}));
  task.previousCompletedAt = task.completedAt;
  task.previousCompletedBy = task.completedBy;

  // Revert to open
  task.status      = 'open';
  task.completedAt = null;
  task.completedBy = null;
  // Clear any stale draft so editing starts from last saved formData
  obDraftClear(taskId);

  showToast(`✏️ Задача ${task.taskNum} открыта для редактирования`, 'orange');

  // Re-render form in edit mode (now isCompleted = false → inputs enabled)
  openObTaskForm(taskId);
}

function collectFormData(formKey, clientId) {
  const fd = {};
  // Collect all inputs/selects/textareas with id starting with f_
  // Store BOTH with prefix (fd["f_coComment"]) AND without (fd["coComment"])
  // so that rendering code (uses no-prefix) and routing code (uses f_-prefix)
  // both find their values correctly.
  document.querySelectorAll('[id^="f_"]').forEach(el => {
    fd[el.id] = el.value;                      // e.g. fd["f_coComment"]
    fd[el.id.replace(/^f_/, '')] = el.value;   // e.g. fd["coComment"]
  });
  // Special: doc selects for doc_collection
  if (formKey === 'doc_collection') {
    document.querySelectorAll('[id^="f_doc_"]').forEach(el => {
      fd[el.id] = el.value;
      fd[el.id.replace(/^f_/, '')] = el.value;
    });
  }
  // Special: activation — collect amendments array from DOM
  if (formKey === 'activation') {
    const amendRows = document.querySelectorAll('#ob_amendments_list [data-amend-idx]');
    if (amendRows.length > 0) {
      // Already rendered from saved data — re-read from _obAmendments runtime array
      fd['amendments']   = JSON.stringify(window._obAmendments || []);
      fd['f_amendments'] = fd['amendments'];
    } else if (window._obAmendments && window._obAmendments.length > 0) {
      fd['amendments']   = JSON.stringify(window._obAmendments);
      fd['f_amendments'] = fd['amendments'];
    } else {
      fd['amendments']   = fd['amendments'] || '[]';
      fd['f_amendments'] = fd['amendments'];
    }
  }
  return fd;
}

/* ══════════════════════════════════════════════════════════════════
   ACTIVATION HELPERS — Task 5.1
   obAddAmendment(taskId)    — добавить строку доп. соглашения в DOM
   obRemoveAmendment(idx)    — удалить строку из DOM
   obViewContract()          — предпросмотр/открытие договора по URL
══════════════════════════════════════════════════════════════════ */

// Runtime amendment list (persisted to formData on submit)
if (typeof window._obAmendments === 'undefined') window._obAmendments = [];

// Render saved amendments array to HTML string (used inside buildTaskForm template literal)
function _obRenderSavedAmendments(arr, isCompleted) {
  if (!arr || arr.length === 0) {
    return '<div style="font-size:12px;color:#4a5568;padding:8px;text-align:center">Доп. соглашений нет</div>';
  }
  return arr.map(function(am, i) {
    var urlCell = am.url ? '<a href="' + escapeAttr(resolveDocUrl(am.url)) + '" target="_blank" style="color:#60a5fa">' + escapeHtml(am.url) + '</a>' : '—';
    var delBtn  = isCompleted ? '' : '<button type="button" onclick="obRemoveAmendment(' + i + ')" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:11px">🗑</button>';
    return '<div style="display:grid;grid-template-columns:80px 120px 1fr 200px auto;gap:8px;align-items:center;background:#1c2333;border-radius:8px;padding:8px 10px" data-amend-idx="' + i + '">'
      + '<div style="font-size:11px;font-weight:700;color:#c4b5fd">' + escapeHtml(am.num || '—') + '</div>'
      + '<div style="font-size:11px;color:#94a3b8">' + (am.date || '—') + '</div>'
      + '<div style="font-size:11px;color:#e2e8f0">' + (escapeHtml(am.description) || '—') + '</div>'
      + '<div style="font-size:11px;color:#60a5fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + urlCell + '</div>'
      + delBtn + '</div>';
  }).join('');
}

// Build FM 5.1 activation form sections as plain string (avoids nested template literal depth issues)
function _obBuildFmActivationSections(task, client, fd, isCompleted, savedAmendments, formGroupStyle, labelStyle, inputStyle, selectStyle, disabledAttr) {
  var engTask = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '4.1'; });
  var saNum  = fd.contractNum || (engTask && engTask.formData && engTask.formData.f_subNum) || '';
  var cmt    = fd.commitmentConfirmed || (engTask && engTask.formData && engTask.formData.f_subCommitment) || client.commitment || '';
  var ccDate = fd.capitalCallDate || (engTask && engTask.formData && engTask.formData.f_firstCallDate) || '';
  var dis    = disabledAttr || '';
  var previewBtnLabel = isCompleted ? 'Открыть LPA' : 'Предпросмотр LPA';
  var amendInputBlock = isCompleted ? '' :
    '<div style="background:#1c2333;border-radius:8px;padding:10px;margin-bottom:8px" id="ob_amend_input_row">'
    + '<div style="font-size:11px;color:#8b5cf6;font-weight:700;margin-bottom:8px">Новое доп. соглашение:</div>'
    + '<div style="display:grid;grid-template-columns:90px 130px 1fr 200px;gap:8px;align-items:end">'
    + '<div><label style="' + labelStyle + '">Номер ДС</label><input type="text" id="ob_amend_num" style="' + inputStyle + '" placeholder="ДС-1" /></div>'
    + '<div><label style="' + labelStyle + '">Дата подписания</label><input type="date" id="ob_amend_date" style="' + inputStyle + '" /></div>'
    + '<div><label style="' + labelStyle + '">Краткое описание</label><input type="text" id="ob_amend_desc" style="' + inputStyle + '" placeholder="Изменение суммы Commitment, продление срока..." /></div>'
    + '<div><label style="' + labelStyle + '">🔗 Ссылка на ДС</label><div style="display:flex;gap:4px"><input type="url" id="ob_amend_url" style="' + inputStyle + '" placeholder="https://... или файл" />' + docUploadBtn('ob_amend_url') + '</div></div>'
    + '</div>'
    + '<button type="button" onclick="obAddAmendment(' + task.id + ')" style="margin-top:8px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.35);color:#c4b5fd;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px"><i class="fas fa-plus"></i> Добавить доп. соглашение</button>'
    + '</div>';

  return ''
    // Section 1: LPA URL
    + '<div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">'
    + '<div style="font-size:11px;font-weight:800;color:#3b82f6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="fas fa-link"></i> Секция 1 — Соглашение с LP (ссылка на LPA)</div>'
    + '<div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:8px;padding:9px 14px;margin-bottom:12px;font-size:11px;color:#93c5fd"><i class="fas fa-info-circle" style="margin-right:5px"></i>Вставьте ссылку на подписанный LP Agreement (LPA), подготовленный юристами на основе Subscription Agreement.</div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">🔗 Ссылка на подписанный LP Agreement (LPA) *</label>'
    + '<div style="display:flex;gap:6px">'
    + '<input type="url" id="f_lpaUrl" value="' + (fd.lpaUrl || '') + '" ' + dis + ' style="' + inputStyle + '" placeholder="https://drive.google.com/file/d/... или загрузите файл" />'
    + (dis ? '' : docUploadBtn('f_lpaUrl'))
    + '</div></div>'
    + '<button type="button" onclick="obViewLpaContract()" style="margin-top:4px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.35);color:#60a5fa;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:6px"><i class="fas fa-eye"></i> ' + previewBtnLabel + '</button>'
    + '</div>'

    // Section 2: Key LPA Parameters
    + '<div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">'
    + '<div style="font-size:11px;font-weight:800;color:#22c55e;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="fas fa-file-signature"></i> Секция 2 — Ключевые параметры LPA</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Номер SA / LPA *</label><input type="text" id="f_contractNum" value="' + saNum + '" ' + dis + ' style="' + inputStyle + '" placeholder="SA-2025-001" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Дата подписания LPA *</label><input type="date" id="f_contractDate" value="' + (fd.contractDate || '') + '" ' + dis + ' style="' + inputStyle + '" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Дата истечения / Срок фонда</label><input type="date" id="f_contractExpiry" value="' + (fd.contractExpiry || '') + '" ' + dis + ' style="' + inputStyle + '" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Подтверждённый Commitment ($)</label><input type="number" id="f_commitmentConfirmed" value="' + cmt + '" ' + dis + ' style="' + inputStyle + '" placeholder="0" min="0" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Дата подписания LP</label><input type="date" id="f_lpSignedDate" value="' + (fd.lpSignedDate || '') + '" ' + dis + ' style="' + inputStyle + '" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Первый Capital Call</label><input type="date" id="f_capitalCallDate" value="' + ccDate + '" ' + dis + ' style="' + inputStyle + '" /></div>'
    + '</div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">График Capital Calls / Особые условия LPA</label>'
    + '<textarea id="f_capitalCallSchedule" rows="2" ' + dis + ' style="' + inputStyle + ';resize:vertical" placeholder="Call 1 — 40% при закрытии, Call 2 — 30% через 12 мес., Call 3 — 30% через 24 мес. ...">' + (fd.capitalCallSchedule || '') + '</textarea></div>'
    + '</div>'

    // Section 3: Amendments
    + '<div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">'
    + '<div style="font-size:11px;font-weight:800;color:#8b5cf6;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="fas fa-file-alt"></i> Секция 3 — Дополнительные соглашения (к SA / LPA)</div>'
    + '<div id="ob_amendments_list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">'
    + _obRenderSavedAmendments(savedAmendments, isCompleted)
    + '</div>'
    + amendInputBlock
    + '</div>'

    // Section 4: Activation
    + '<div style="background:#0f1623;border:1px solid #2a3448;border-radius:10px;padding:14px;margin-bottom:14px">'
    + '<div style="font-size:11px;font-weight:800;color:#f97316;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px"><i class="fas fa-user-check"></i> Секция 4 — Активация LP</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Дата активации *</label><input type="date" id="f_activationDate" value="' + (fd.activationDate || today()) + '" ' + dis + ' style="' + inputStyle + '" /></div>'
    + '<div style="' + formGroupStyle + '"><label style="' + labelStyle + '">Активировал (ФИО юриста / RM) *</label><input type="text" id="f_activatedBy" value="' + (fd.activatedBy || '') + '" ' + dis + ' style="' + inputStyle + '" placeholder="Введите ФИО..." /></div>'
    + '</div>'
    + buildSelect('f_docsVerified', 'Документы верифицированы?', ['Нет', 'Да'], fd.docsVerified, disabledAttr, selectStyle, labelStyle)
    + '<div style="' + formGroupStyle + ';margin-top:10px"><label style="' + labelStyle + '">Примечания к активации</label>'
    + '<textarea id="f_activationNotes" rows="2" ' + dis + ' style="' + inputStyle + ';resize:vertical" placeholder="Дополнительные примечания...">' + (fd.activationNotes || '') + '</textarea></div>'
    + '</div>';
}

function obAddAmendment(taskId) {
  const num  = (document.getElementById('ob_amend_num')  || {}).value || '';
  const date = (document.getElementById('ob_amend_date') || {}).value || '';
  const desc = (document.getElementById('ob_amend_desc') || {}).value || '';
  const url  = (document.getElementById('ob_amend_url')  || {}).value || '';
  if (!num && !desc) {
    showToast('⚠️ Укажите номер или описание ДС', 'orange');
    return;
  }
  window._obAmendments = window._obAmendments || [];
  window._obAmendments.push({ num, date, description: desc, url });
  // Re-render list
  _obRenderAmendments(taskId);
  // Clear inputs
  ['ob_amend_num','ob_amend_date','ob_amend_desc','ob_amend_url'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  showToast('✅ Доп. соглашение добавлено', 'green');
}

function obRemoveAmendment(idx) {
  window._obAmendments = window._obAmendments || [];
  window._obAmendments.splice(idx, 1);
  // Find the taskId from the open form
  const formEl = document.getElementById('ob_amendments_list');
  const taskId = formEl ? parseInt(formEl.getAttribute('data-task-id') || '0') : 0;
  _obRenderAmendments(taskId);
  showToast('🗑 Доп. соглашение удалено', 'orange');
}

function _obRenderAmendments(taskId) {
  const list = document.getElementById('ob_amendments_list');
  if (!list) return;
  list.setAttribute('data-task-id', taskId || 0);
  const ams = window._obAmendments || [];
  const inputStyle = 'background:#1c2333;border:1px solid #2a3448;border-radius:6px;padding:6px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box';
  const labelStyle = 'font-size:10px;color:#8a9bbf;margin-bottom:3px;display:block;text-transform:uppercase;font-weight:700';
  if (ams.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:#4a5568;padding:8px;text-align:center">Доп. соглашений нет</div>';
    return;
  }
  list.innerHTML = ams.map((am, i) => `
    <div style="display:grid;grid-template-columns:80px 120px 1fr 200px auto;gap:8px;align-items:center;background:#1c2333;border-radius:8px;padding:8px 10px" data-amend-idx="${i}">
      <div style="font-size:11px;font-weight:700;color:#c4b5fd">${escapeHtml(am.num)||'—'}</div>
      <div style="font-size:11px;color:#94a3b8">${am.date||'—'}</div>
      <div style="font-size:11px;color:#e2e8f0">${escapeHtml(am.description)||'—'}</div>
      <div style="font-size:11px;color:#60a5fa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${am.url ? `<a href="${escapeAttr(am.url)}" target="_blank" style="color:#60a5fa">${escapeHtml(am.url)}</a>` : '—'}
      </div>
      <button type="button" onclick="obRemoveAmendment(${i})" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:11px">🗑</button>
    </div>`).join('');
}

function obViewContract() {
  const urlEl = document.getElementById('f_contractUrl');
  const rawUrl = urlEl ? urlEl.value.trim() : '';
  if (!rawUrl) {
    showToast('⚠️ Укажите ссылку на договор', 'orange');
    return;
  }
  const url = resolveDocUrl(rawUrl);
  // Build a Google Drive preview URL if it's a Drive link
  let previewUrl = url;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    previewUrl = 'https://drive.google.com/file/d/' + driveMatch[1] + '/preview';
  }
  // Try iframe modal first; fallback to new tab
  _obOpenPreviewModal(previewUrl, url);
}

function _obOpenPreviewModal(previewUrl, originalUrl) {
  // Remove existing modal
  const existing = document.getElementById('ob_contract_modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'ob_contract_modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="width:100%;max-width:960px;height:85vh;background:#1c2333;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;border:1px solid #2a3448">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#0f1623;border-bottom:1px solid #2a3448;flex-shrink:0">
        <div style="font-size:13px;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:8px">
          <i class="fas fa-file-pdf" style="color:#ef4444"></i> Просмотр договора
        </div>
        <div style="display:flex;gap:8px">
          <a href="${originalUrl}" target="_blank" style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:5px">
            <i class="fas fa-external-link-alt"></i> Открыть в новой вкладке
          </a>
          <button onclick="document.getElementById('ob_contract_modal').remove()" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">
            <i class="fas fa-times"></i> Закрыть
          </button>
        </div>
      </div>
      <iframe id="ob_contract_iframe" src="${previewUrl}" style="flex:1;border:none;width:100%" allow="autoplay"></iframe>
      <div id="ob_contract_fallback" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:40px">
        <i class="fas fa-exclamation-triangle" style="font-size:32px;color:#f97316"></i>
        <div style="font-size:14px;color:#e2e8f0;text-align:center">Предпросмотр недоступен (X-Frame-Options)</div>
        <div style="font-size:12px;color:#8a9bbf;text-align:center">Нажмите «Открыть в новой вкладке» для просмотра</div>
        <a href="${originalUrl}" target="_blank" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;text-decoration:none">
          <i class="fas fa-external-link-alt" style="margin-right:6px"></i>Открыть договор
        </a>
      </div>
    </div>`;

  // Close on backdrop click
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);

  // Detect iframe load failure (X-Frame-Options)
  const iframe = document.getElementById('ob_contract_iframe');
  const fallback = document.getElementById('ob_contract_fallback');
  if (iframe && fallback) {
    iframe.addEventListener('error', () => {
      iframe.style.display = 'none';
      fallback.style.display = 'flex';
    });
    // Timeout fallback: if iframe hasn't loaded content after 5s, show fallback
    setTimeout(() => {
      try {
        // If cross-origin, accessing contentDocument will throw
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc || doc.body.innerHTML === '') {
          iframe.style.display = 'none';
          fallback.style.display = 'flex';
        }
      } catch (e) {
        // Cross-origin — iframe is actually loading, that's fine
      }
    }, 5000);
  }
}

// View contract from completed banner button (uses saved formData URL)
function obViewContractFromTask(taskId) {
  const task   = obTasks.find(t => t.id === taskId);
  const client = task ? obClients.find(c => c.id === task.clientId) : null;
  const rawUrl = (task && task.formData && (task.formData.f_contractUrl || task.formData.contractUrl))
               || (client && client.contractUrl)
               || '';
  if (!rawUrl) {
    showToast('⚠️ Ссылка на договор не указана', 'orange');
    return;
  }
  const url = resolveDocUrl(rawUrl);
  let previewUrl = url;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    previewUrl = 'https://drive.google.com/file/d/' + driveMatch[1] + '/preview';
  }
  _obOpenPreviewModal(previewUrl, url);
}

// View LPA from FM activation form (reads f_lpaUrl input)
function obViewLpaContract() {
  const urlEl = document.getElementById('f_lpaUrl');
  const rawUrl = urlEl ? urlEl.value.trim() : '';
  if (!rawUrl) {
    showToast('⚠️ Укажите ссылку на LP Agreement', 'orange');
    return;
  }
  const url = resolveDocUrl(rawUrl);
  let previewUrl = url;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    previewUrl = 'https://drive.google.com/file/d/' + driveMatch[1] + '/preview';
  }
  _obOpenPreviewModal(previewUrl, url);
}

// View LPA from FM completed banner button (uses saved formData URL)
function obViewLpaFromTask(taskId) {
  const task   = obTasks.find(t => t.id === taskId);
  const client = task ? obClients.find(c => c.id === task.clientId) : null;
  const rawUrl = (task && task.formData && (task.formData.f_lpaUrl || task.formData.lpaUrl))
               || (client && client.lpaUrl)
               || '';
  if (!rawUrl) {
    showToast('⚠️ Ссылка на LP Agreement не указана', 'orange');
    return;
  }
  const url = resolveDocUrl(rawUrl);
  let previewUrl = url;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    previewUrl = 'https://drive.google.com/file/d/' + driveMatch[1] + '/preview';
  }
  _obOpenPreviewModal(previewUrl, url);
}

/* ════════════════════════════════════════════════════════════════
   obGenerateSubscriptionAgreement(taskId)
   FM 4.1 — Subscription Agreement PDF (window.print)
   Bilingual EN/RU table layout, fixed SA text from real document
   + Appendix A (LP Qualification 3.1)
   + Appendix B (Investment Profile 3.2)
════════════════════════════════════════════════════════════════ */
function obGenerateSubscriptionAgreement(taskId) {
  var task = obTasks.find(function(t){ return t.id === taskId; });
  if (!task) { showToast('Задача не найдена', 'red'); return; }
  var client = obClients.find(function(c){ return c.id === task.clientId; });
  if (!client) { showToast('Клиент не найден', 'red'); return; }
  var fd   = task.formData || {};
  var t31  = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '3.1'; });
  var t32  = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '3.2'; });
  var fd31 = (t31 && t31.formData) || {};
  var fd32 = (t32 && t32.formData) || {};

  var subNum     = fd.subNum    || ('SA-' + new Date().getFullYear() + '-XXX');
  var saDate     = fd.subDate   || '_____, 2025';
  var lpaDate    = fd.lpaDate   || '_____, 2025';
  var commitment = Number(fd.subCommitment || client.commitment || 0);
  // Commitment is genuine LP/fund economics — follows the fund currently
  // selected in the fund switcher (activeFundId), same as elsewhere in
  // onboarding (obClients itself carries no fundId, but registerLPFromOnboarding
  // always stamps the new LP with activeFundId, so that's the honest
  // context here too). Kept the "CODE 500,000" textual style rather than
  // an abbreviated symbol — appropriate for a legal document.
  var fmtU       = function(v){ return currencyForFundId(activeFundId) + ' ' + Number(v).toLocaleString('en-US'); };
  var lpName     = client.name  || '_______________';
  var lpCEO      = fd.lpCEO     || '_______________';
  var lpTitle    = fd.lpSignerTitle || 'Генеральный директор';
  var lpAddress  = fd.lpAddress || '_______________';
  var fundClass  = fd.fundClass || '—';
  var firstCallDate = fd.firstCallDate || '—';
  var bankName   = fd.bankName   || '[Insert Bank Name]';
  var bankSWIFT  = fd.bankSWIFT  || '[Insert SWIFT/BIC]';
  var bankIBANkzt= fd.bankIBANkzt|| '[Insert IBAN KZT]';
  var bankIBANusd= fd.bankIBANusd|| '[Insert IBAN USD]';
  var bankAddr   = fd.bankAddress|| '[Insert Bank Address]';

  // ── helper: bilingual row ─────────────────────────────────────
  function biRow(en, ru) {
    return '<tr><td class="en">' + en + '</td><td class="ru">' + ru + '</td></tr>';
  }
  function biSection(enTitle, ruTitle, enContent, ruContent) {
    return '<table class="bi-table">' +
      '<tr><th class="en">' + enTitle + '</th><th class="ru">' + ruTitle + '</th></tr>' +
      '<tr><td class="en body-text">' + enContent + '</td>' +
      '<td class="ru body-text">' + ruContent + '</td></tr>' +
      '</table>';
  }
  function biHead(en, ru) {
    return '<table class="bi-table header-table">' +
      '<tr><td class="en header-cell">' + en + '</td><td class="ru header-cell">' + ru + '</td></tr>' +
      '</table>';
  }
  function dataRow(label, value) {
    return '<tr><td class="lbl">' + label + '</td><td class="val">' + (value||'—') + '</td></tr>';
  }
  function dataTable(rows) {
    return '<table class="data-table">' + rows.map(function(r){ return dataRow(r[0],r[1]); }).join('') + '</table>';
  }

  var docStyle =
    '@page{margin:2cm 2.5cm;size:A4}' +
    '.cover{text-align:center;padding:40pt 0 20pt}' +
    '.cover h1{font-size:14pt;font-weight:bold;text-transform:uppercase;border-bottom:2px solid #000;padding-bottom:8pt;margin-bottom:12pt}' +
    '.cover .meta{font-size:10pt;line-height:1.8}' +
    '.bi-table{width:100%;border-collapse:collapse;margin:6pt 0}' +
    '.bi-table td,.bi-table th{border:1px solid #aaa;padding:6pt 8pt;vertical-align:top;width:50%}' +
    '.bi-table th{background:#1e3a5f;color:#fff;font-weight:bold;font-size:9.5pt}' +
    '.bi-table th.en{text-align:left}.bi-table th.ru{text-align:left}' +
    '.bi-table td.en{font-size:9.5pt;line-height:1.45}' +
    '.bi-table td.ru{font-size:9.5pt;line-height:1.45}' +
    '.bi-table .header-cell{font-size:11pt;font-weight:bold;background:#f0f4f8;color:#1e3a5f;text-align:center;border:1px solid #1e3a5f}' +
    '.bi-table .body-text{font-size:9pt;line-height:1.5}' +
    '.data-table{width:100%;border-collapse:collapse;margin:6pt 0}' +
    '.data-table td{border:1px solid #ccc;padding:5pt 8pt;font-size:9.5pt;vertical-align:top}' +
    '.data-table .lbl{background:#f1f5f9;font-weight:bold;width:40%;color:#374151}' +
    '.data-table .val{color:#000}' +
    '.section-header{background:#1e3a5f;color:#fff;padding:6pt 10pt;font-weight:bold;font-size:10pt;margin:10pt 0 0}' +
    '.appx-header{background:#374151;color:#fff;padding:8pt 12pt;margin:14pt 0 6pt;font-size:11pt;font-weight:bold}' +
    '.sig-table{width:100%;border-collapse:collapse;margin:12pt 0}' +
    '.sig-table td{border:1px solid #999;padding:8pt 12pt;width:50%;vertical-align:bottom;font-size:9.5pt}' +
    '.sig-table .sig-label{font-weight:bold;margin-bottom:4pt}' +
    '.sig-table .sig-line{border-top:1px solid #000;margin-top:28pt;padding-top:3pt;font-size:8.5pt;color:#555}' +
    '.legal-notice{background:#fef9c3;border:1px solid #ca8a04;padding:8pt 12pt;font-size:8.5pt;margin:10pt 0;line-height:1.4}' +
    'h2{font-size:11pt;font-weight:bold;margin:10pt 0 4pt;color:#1e3a5f}' +
    'h3{font-size:10pt;font-weight:bold;margin:8pt 0 3pt;color:#374151}' +
    'p{margin:3pt 0;line-height:1.4;font-size:9.5pt}' +
    'hr{border:none;border-top:1px solid #aaa;margin:10pt 0}';

  var body =
    '<div style="font-size:12px;color:#374151;text-align:center;padding:8px 0;font-family:Arial,sans-serif">Subscription Agreement · ' + subNum + ' · ' + saDate + '</div>' +

    // COVER
    '<div class="cover">' +
    biHead(
      'SUBSCRIPTION AGREEMENT<br>of ' + saDate + '<br>(Republic of Kazakhstan, Astana city)<br>to the Limited Partnership Agreement of ' + lpaDate,
      'СОГЛАШЕНИЕ О ПРИСОЕДИНЕНИИ<br>от ' + saDate + '<br>(Республика Казахстан, город Астана)<br>к Соглашению об Ограниченном партнерстве от ' + lpaDate
    ) +
    '</div>' +

    // PARTIES
    biSection(
      'PARTIES',
      'СТОРОНЫ',
      '"Golden Leaves Ltd." Private Company, represented by the CEO <b>' + FUND_PARAMS.gpCEOen + '</b>, acting on the basis of the Charter, hereinafter referred to as the <b>"General Partner"</b>, on the one hand, and<br><br>' +
      '"<b>' + lpName + '</b>" Limited Liability Partnership, represented by the <b>' + lpTitle + ' ' + lpCEO + '</b>, acting on the basis of the Charter, hereinafter referred to as the <b>"Limited Partner"</b>, on the other hand.<br><br>' +
      'Hereinafter jointly referred to as the <b>"Parties"</b> or separately as the <b>"Party"</b>.',
      '«Golden Leaves Ltd.» Частная Компания, представленная Генеральным директором <b>' + FUND_PARAMS.gpCEO + '</b>, действующим на основании Устава, именуемая <b>«Генеральный Партнер»</b>, с одной стороны, и<br><br>' +
      '«<b>' + lpName + '</b>» Товарищество с ограниченной ответственностью, представленное <b>' + lpTitle + ' ' + lpCEO + '</b>, действующим на основании Устава, именуемое <b>«Ограниченный Партнер»</b>, с другой стороны.<br><br>' +
      'В дальнейшем совместно именуемые <b>«Сторонами»</b> или по отдельности — <b>«Стороной»</b>.'
    ) +

    biSection(
      'WHEREAS',
      'В СВЯЗИ С ТЕМ ЧТО',
      'Pursuant to the Limited Partnership Agreement dated <b>' + lpaDate + '</b>, and the Limited Partner wishes to subscribe for <b>"Turan Capital Holding"</b> Limited Partnership Interests.',
      'В соответствии с Соглашением об Ограниченном товариществе от <b>' + lpaDate + '</b>, Ограниченный Партнер желает присоединиться к доле в Ограниченном Партнерстве <b>«Turan Capital Holding»</b>.'
    ) +

    // §1 SUBSCRIPTION
    '<div class="section-header">1. Subscription and Capital Commitment &nbsp;|&nbsp; 1. Обязательство по капиталу</div>' +
    biSection('','',
      '1.1 The Subscriber hereby subscribes for a limited partnership interest ("Interest") in the Partnership, committing to contribute capital in the amount of <b>' + fmtU(commitment) + '</b> (the "Capital Commitment"). Fund Class: <b>' + fundClass + '</b>.<br><br>' +
      '1.2 The Capital Commitment shall be payable in cash in tranches upon issuance of capital calls by the General Partner. Each payment shall be due within <b>30 calendar days</b> following the date of the capital call notice.<br><br>' +
      '1.3 Minimum commitment: USD 500,000 unless otherwise agreed in writing by the General Partner.<br><br>' +
      '1.4 The General Partner may, in its sole discretion, accept or reject this Subscription in whole or in part.',
      '1.1 Настоящим Подписчик подписывается на долю участия в партнёрстве в качестве ограниченного партнёра, принимая обязательство внести капитал в размере <b>' + fmtU(commitment) + '</b> («Капитальное Обязательство»). Класс долей: <b>' + fundClass + '</b>.<br><br>' +
      '1.2 Капитальное Обязательство подлежит оплате денежными средствами траншами по мере поступления требований о внесении капитала (capital calls). Каждый платёж должен быть осуществлён в течение <b>30 календарных дней</b> с даты уведомления.<br><br>' +
      '1.3 Минимальная сумма обязательства: USD 500 000, если иное не согласовано письменно с Генеральным партнёром.<br><br>' +
      '1.4 Генеральный партнёр вправе по своему усмотрению принять или отклонить данную подписку.'
    ) +

    // §2 PROFIT DISTRIBUTION
    '<div class="section-header">2. Profit Distribution, Lock-in and Redemption &nbsp;|&nbsp; 2. Распределение прибыли, Lock-in и выкуп</div>' +
    biSection('','',
      '<b>80/20 Profit Split:</b> 80% of profits allocated to Limited Partners; 20% to General Partner as Carried Interest.<br><br>' +
      '<b>Waterfall Structure:</b><br>' +
      '① Return of Capital: LPs receive return of initial capital contributions.<br>' +
      '② Hurdle Rate: LPs receive <b>' + FUND_PARAMS.preferredReturn + '% p.a.</b> preferred return (compounded, in USD).<br>' +
      '③ Catch-Up: 100% to GP until GP has received 20% of aggregate profits.<br>' +
      '④ Profit Split: Remaining profits — <b>80% LP / 20% GP</b>.<br><br>' +
      '<b>Lock-in Period: ' + FUND_PARAMS.lockInPeriod + ' years</b> from initial capital contribution.<br>' +
      'Redemptions: twice per year (June 30 / December 31), with 30 calendar days notice.<br>' +
      'Early Exit Penalty: 2% – 5% of redemption amount.',
      '<b>Раздел 80/20:</b> 80% прибыли распределяются среди Ограниченных партнёров; 20% — Генеральному партнёру (Carried Interest).<br><br>' +
      '<b>Каскадная структура (Waterfall):</b><br>' +
      '① Возврат капитала: LP получают возврат первоначальных взносов.<br>' +
      '② Пороговая доходность: LP получают <b>' + FUND_PARAMS.preferredReturn + '% годовых</b> (сложные проценты, в USD).<br>' +
      '③ Catch-Up: 100% Генеральному партнёру до достижения 20% совокупной прибыли.<br>' +
      '④ Раздел прибыли: Оставшаяся прибыль — <b>80% LP / 20% GP</b>.<br><br>' +
      '<b>Период блокировки: ' + FUND_PARAMS.lockInPeriod + ' лет</b> с даты первого взноса.<br>' +
      'Выкуп: 2 раза в год (30 июня / 31 декабря), уведомление за 30 дней.<br>' +
      'Штраф за досрочный выход: 2% – 5% от суммы выкупа.'
    ) +

    // §3 MANAGEMENT FEE
    '<div class="section-header">3. Management Fee &nbsp;|&nbsp; 3. Комиссия за управление</div>' +
    biSection('','',
      'The General Partner shall be entitled to a Management Fee equal to <b>' + FUND_PARAMS.managementFee + '% per annum</b> of the Fund\'s Assets Under Management (AUM), calculated based on the latest available Net Asset Value (NAV). The Management Fee is accrued and payable semi-annually in arrears.',
      'Генеральный партнёр имеет право на Комиссию за управление в размере <b>' + FUND_PARAMS.managementFee + '% годовых</b> от Активов под управлением (AUM), рассчитываемой на основании последней доступной Чистой стоимости активов (NAV). Комиссия начисляется и выплачивается раз в полгода.'
    ) +

    // §4 WITHDRAWAL AND REDEMPTION
    '<div class="section-header">4. Withdrawal and Redemption Rights &nbsp;|&nbsp; 4. Права на вывод и выкуп</div>' +
    biSection('','',
      'Lock-in Period: The Limited Partner cannot withdraw capital during the lock-in period (first <b>' + FUND_PARAMS.lockInPeriod + ' years</b>).<br><br>' +
      'After expiration of the Lock-in Period, redemption requests may be submitted with no less than <b>30 calendar days</b> notice prior to the relevant Redemption Date (June 30 or December 31).<br><br>' +
      'All redemptions are subject to: (a) availability of liquidity; (b) compliance with minimum holding period; (c) review and approval by the General Partner; (d) early exit fees (2%–5%) where applicable; (e) possible discounting of redemption value for illiquid assets.',
      'Период блокировки: Ограниченный партнёр не может вывести капитал в течение периода блокировки (первые <b>' + FUND_PARAMS.lockInPeriod + ' лет</b>).<br><br>' +
      'По истечении периода блокировки запросы на выкуп подаются не позднее чем за <b>30 календарных дней</b> до даты выкупа (30 июня или 31 декабря).<br><br>' +
      'Все выкупы подлежат условиям: (a) наличие ликвидности; (b) минимальный срок владения; (c) одобрение Генерального партнёра; (d) штраф за досрочный выход (2%–5%); (e) дисконтирование при неликвидных активах.'
    ) +

    // §5 NAV
    '<div class="section-header">5. Valuation and NAV &nbsp;|&nbsp; 5. Оценка и NAV</div>' +
    biSection('','',
      'The NAV of the Fund shall be determined semi-annually as of the last Business Day of June and December each year, in accordance with IFRS. The Subscription Price for each Interest shall be based on the most recently available NAV.',
      'NAV Фонда определяется на полугодовой основе, на последний рабочий день июня и декабря каждого года, в соответствии с МСФО. Подписная цена для каждой доли определяется на основе последнего доступного NAV.'
    ) +

    // §6 REPRESENTATIONS
    '<div class="section-header">6. Representations and Warranties &nbsp;|&nbsp; 6. Заявления и гарантии</div>' +
    biSection('','',
      'The Subscriber represents and warrants that:<br>' +
      '6.1 It qualifies as a Professional Client under AIFC Conduct of Business Rules;<br>' +
      '6.2 It has received, read, and understood the Offering Materials and LPA, and has had the opportunity to consult with legal, tax, and financial advisors;<br>' +
      '6.3 It understands and accepts the risks, including potential total loss;<br>' +
      '6.4 It is making this investment for its own account and not with a view to resale or distribution.',
      'Подписчик заявляет и гарантирует, что:<br>' +
      '6.1 Он соответствует критериям Профессионального клиента в соответствии с AIFC COB Rules;<br>' +
      '6.2 Он получил, прочитал и понял Offering Materials и LPA, и имел возможность проконсультироваться с советниками;<br>' +
      '6.3 Он осознаёт и принимает риски, включая возможность полной потери капитала;<br>' +
      '6.4 Он осуществляет вложение от собственного имени и не с целью перепродажи.'
    ) +

    // §7–§10
    '<div class="section-header">7–10. Assignment · Default · Confidentiality · Transferability &nbsp;|&nbsp; 7–10. Передача · Дефолт · Конфиденциальность · Уступка</div>' +
    biSection('','',
      '7. This Agreement binds successors and permitted assigns. LP cannot assign interest without prior written GP consent.<br><br>' +
      '8. Default: If LP fails to meet capital commitments, GP may take legal action including forfeiture of profits or dilution of LP\'s interest.<br><br>' +
      '9. Confidentiality: LP agrees to keep confidential all Partnership documents and information received in connection with this investment.<br><br>' +
      '10. Transferability: LP may not transfer or assign interest in the Fund without prior written consent of the General Partner.',
      '7. Соглашение обязательно для правопреемников. LP не может передать долю без предварительного письменного согласия GP.<br><br>' +
      '8. Дефолт: При невыполнении обязательств GP вправе принять правовые меры, включая конфискацию прибыли или разводнение доли LP.<br><br>' +
      '9. Конфиденциальность: LP обязуется сохранять конфиденциальность всех документов и информации Партнёрства.<br><br>' +
      '10. Уступка: LP не вправе передать долю в Фонде без предварительного письменного согласия GP.'
    ) +

    // §11 DISPUTE
    '<div class="section-header">11. Dispute Resolution &nbsp;|&nbsp; 11. Урегулирование споров</div>' +
    biSection('','',
      '<b>Mediation:</b> Prior to arbitration, parties shall attempt to resolve disputes through mediation within <b>60 days</b>.<br><br>' +
      '<b>Arbitration:</b> Any dispute shall be settled by arbitration in accordance with the rules of the <b>International Arbitration Center of AIFC</b>, Astana. Language: English. Decision is final and binding.',
      '<b>Медиация:</b> До арбитража стороны предпринимают попытку урегулирования спора через медиацию в течение <b>60 дней</b>.<br><br>' +
      '<b>Арбитраж:</b> Споры разрешаются арбитражем в соответствии с правилами <b>Международного арбитражного центра AIFC</b>, Астана. Язык: английский. Решение окончательное и обязательное.'
    ) +

    // §12–§13
    '<div class="section-header">12–13. Governing Law · Force Majeure &nbsp;|&nbsp; 12–13. Применимое право · Форс-мажор</div>' +
    biSection('','',
      '12. This Agreement shall be governed by and construed in accordance with the laws of the <b>Astana International Financial Centre (AIFC)</b>. All disputes subject to exclusive jurisdiction of the <b>AIFC Court</b>.<br><br>' +
      '13. Neither party shall be liable for failure to perform obligations due to events beyond their control, including natural disasters, war, or regulatory changes.',
      '12. Настоящее Соглашение регулируется законодательством <b>МФЦА (Astana International Financial Centre)</b>. Все споры подлежат исключительной юрисдикции <b>Суда МФЦА</b>.<br><br>' +
      '13. Ни одна из сторон не несёт ответственности за невыполнение обязательств вследствие обстоятельств вне их контроля.'
    ) +

    // §14 BANK ACCOUNT
    '<div class="section-header">14. Bank Account for Contributions &nbsp;|&nbsp; 14. Банковский счёт для перечисления вкладов</div>' +
    '<h3>Golden Leaves Ltd. (General Partner / Генеральный Партнер)</h3>' +
    dataTable([
      ['Account Holder / Владелец счёта', FUND_PARAMS.fundShort],
      ['Bank / Банк', FUND_PARAMS.gpBankName],
      ['BIC / БИК', FUND_PARAMS.gpBIC],
      ['IBAN KZT / ИИК KZT', FUND_PARAMS.gpIBANkzt],
      ['IBAN USD / ИИК USD', FUND_PARAMS.gpIBANusd],
      ['Address / Адрес', FUND_PARAMS.gpAddress],
    ]) +
    '<h3>Limited Partner / Ограниченный Партнер — ' + lpName + '</h3>' +
    dataTable([
      ['Account Holder / Владелец счёта', lpName],
      ['Bank / Банк', bankName],
      ['SWIFT/BIC', bankSWIFT],
      ['IBAN KZT / ИИК KZT', bankIBANkzt],
      ['IBAN USD / ИИК USD', bankIBANusd],
      ['Bank Address / Адрес банка', bankAddr],
    ]) +
    '<p style="font-size:9pt;color:#555">All payments must be made by wire transfer in USD. LP is responsible for all transfer fees.</p>' +

    // LEGAL NOTICE
    '<div class="legal-notice">' +
    '<b>LEGALLY BINDING DOCUMENT / ЮРИДИЧЕСКИ ЗНАЧИМЫЙ ДОКУМЕНТ:</b> By signing this Subscription Agreement, the Limited Partner acknowledges having read, understood and accepted the terms and conditions set forth in the Offering Materials and the Limited Partnership Agreement. ' +
    'Подписывая настоящее Соглашение о подписке, Ограниченный партнёр подтверждает, что он ознакомился с условиями, изложенными в Инвестиционном меморандуме (Offering Materials) и Соглашении о Товариществе (LPA), понял и принимает их в полном объёме.' +
    '</div>' +

    // SIGNATURES
    '<h2 style="text-align:center;text-transform:uppercase">IN WITNESS WHEREOF / В СВИДЕТЕЛЬСТВО ТОГО ЧТО</h2>' +
    '<table class="sig-table">' +
    '<tr>' +
    '<td>' +
    '<div class="sig-label">GENERAL PARTNER / ГЕНЕРАЛЬНЫЙ ПАРТНЕР<br>' + FUND_PARAMS.gpFull + '</div>' +
    '<div class="sig-label" style="margin-top:6pt">' + FUND_PARAMS.gpTitle + ':<br>' + FUND_PARAMS.gpCEO + '</div>' +
    '<div class="sig-line">Signature / Подпись: _______________________</div>' +
    '<div class="sig-line">Date / Дата: _______________________</div>' +
    '<div class="sig-line">Seal / Печать: ⬜</div>' +
    '</td>' +
    '<td>' +
    '<div class="sig-label">LIMITED PARTNER / ОГРАНИЧЕННЫЙ ПАРТНЕР<br>«' + lpName + '»</div>' +
    '<div class="sig-label" style="margin-top:6pt">' + lpTitle + ':<br>' + lpCEO + '</div>' +
    '<div class="sig-line">Signature / Подпись: _______________________</div>' +
    '<div class="sig-line">Date / Дата: _______________________</div>' +
    '<div class="sig-line">Seal / Печать: ⬜</div>' +
    '</td>' +
    '</tr>' +
    '</table>' +

    // ═══ APPENDIX A: LP QUALIFICATION ═══════════════════════════
    '<div class="page-break"></div>' +
    '<div class="appx-header">APPENDIX A — LP QUALIFICATION SUMMARY &nbsp;|&nbsp; ПРИЛОЖЕНИЕ А — КВАЛИФИКАЦИЯ LP<br>' +
    '<span style="font-size:9pt;font-weight:normal">Source: Task 3.1 — LP Qualification Check</span></div>' +
    dataTable([
      ['SA Reference / Номер SA', subNum],
      ['LP Name / Наименование LP', lpName],
      ['LP Type / Тип LP', client.type],
      ['LP Category / Категория LP', client.lpType || '—'],
      ['Qualification Date / Дата проверки', fd31.qualDate || '—'],
      ['Qualification Result / Итог квалификации', fd31.lpQualResult || '—'],
      ['PEP Status / PEP-статус', fd31.pepLP || '—'],
      ['Source of Funds Confirmed', fd31.sourceOfFunds || '—'],
      ['CO Decision / Решение CO', fd31.coDecision || '—'],
    ]) +
    (function(){
      var isIndiv = client.type === 'Individual';
      var rows;
      if (isIndiv) {
        rows = [
          ['① Net Assets ≥ USD 1,000,000 (excl. residence)', fd31.indAssets1m || '—'],
          ['② Annual Income ≥ USD 100,000 (last 2 years)', fd31.indIncome100k || '—'],
          ['③ Professional Qualification ≥ 3 yrs (CFA/CPA/FRM)', fd31.indExperience3y || '—'],
        ];
      } else {
        rows = [
          ['① Annual Turnover ≥ USD 2,000,000', fd31.corpTurnover2m || '—'],
          ['② Balance Sheet ≥ USD 1,000,000', fd31.corpBalance1m || '—'],
          ['③ Regulated Financial Institution', fd31.corpRegulated || '—'],
          ['④ Large Corp — Turnover ≥ USD 2M', fd31.corpLargeTurnover || '—'],
          ['④ Large Corp — Balance ≥ USD 1M', fd31.corpLargeBalance || '—'],
          ['④ Large Corp — Staff ≥ 50', fd31.corpEmployees50 || '—'],
        ];
      }
      return '<h3>' + (isIndiv ? 'Individual LP — Qualification Criteria (any 1 of 3)' : 'Corporate LP — Qualification Criteria (any 1 of 4)') + '</h3>' +
        dataTable(rows);
    })() +
    dataTable([
      ['LP Notified of Category', fd31.clientNotified || '—'],
      ['Notification Date', fd31.notifyDate || '—'],
    ]) +
    '<p><b>RM Comment:</b> ' + (fd31.rmComment || '—') + '</p>' +
    '<table class="sig-table" style="margin-top:14pt"><tr>' +
    '<td><div class="sig-label">Compliance Officer (CO)</div><div class="sig-line">Name: ' + (fd31.coName||'_______') + '</div><div class="sig-line">Signature: _______________________ &nbsp; Date: _________</div></td>' +
    '<td><div class="sig-label">RM (Relationship Manager)</div><div class="sig-line">Name: _______________________ </div><div class="sig-line">Signature: _______________________ &nbsp; Date: _________</div></td>' +
    '</tr></table>' +

    // ═══ APPENDIX B: INVESTMENT PROFILE ══════════════════════════
    '<div class="page-break"></div>' +
    '<div class="appx-header">APPENDIX B — INVESTMENT PROFILE &amp; FUND SUITABILITY ASSESSMENT<br>' +
    '<span style="font-size:9pt;font-weight:normal">Source: Task 3.2 — LP Investment Profile &amp; Fund Suitability</span></div>' +
    '<h3>A. LP Investment Profile</h3>' +
    dataTable([
      ['Profiling Date / Дата профилирования', fd32.profileDate || '—'],
      ['Investment Horizon / Инвестиционный горизонт', fd32.investHorizon || '—'],
      ['Risk Appetite / Риск-аппетит', fd32.riskAppetite || '—'],
      ['Alternative Funds Experience', fd32.altFundExp || '—'],
      ['Liquidity Preference / Ликвидность', fd32.liquidityPref || '—'],
    ]) +
    '<h3>B. Fund Strategy Suitability / Соответствие стратегии фонда</h3>' +
    dataTable([
      ['Fund Strategy Understood / Стратегия понята LP', fd32.strategyUnderstood || '—'],
      ['Fund Risks Disclosed / Риски раскрыты LP', fd32.risksDisclosed || '—'],
      ['Fund Suitability Result / Итог', fd32.fundSuitResult || '—'],
    ]) +
    '<p><b>RM Comment:</b> ' + (fd32.rmComment || '—') + '</p>' +
    '<p><b>CO Comment:</b> ' + (fd32.coComment  || '—') + '</p>' +
    '<table class="sig-table" style="margin-top:14pt"><tr>' +
    '<td><div class="sig-label">Compliance Officer / RM</div><div class="sig-line">Signature: _______________________ &nbsp; Date: _________</div></td>' +
    '<td><div class="sig-label">LP Acknowledgment — ' + lpName + '</div><div class="sig-line">Signature: _______________________ &nbsp; Date: _________</div></td>' +
    '</tr></table>';

  var w = openPrintableDocument(body, {
    title: subNum + ' — Subscription Agreement',
    features: 'width=960,height=800',
    extraStyle: docStyle,
  });
  if (w) showToast('✅ Subscription Agreement готов к печати/PDF: ' + subNum, 'green');
}



/* ─── classification helpers ──────────────────────────────────────
   obClassScoreInit(taskId, clientType)
     Wires up live score cards, retail warning, and opt-up/down toggles
     for the classification form (3.1).
──────────────────────────────────────────────────────────────── */
function obClassScoreInit(taskId, clientType) {
  const isIndiv = clientType === 'Individual';

  // ── Individual: Professional Client — ANY 1 of 3 ────────────
  function updateProfScoreInd() {
    const box = document.getElementById('profScoreInd_' + taskId);
    if (!box) return;
    const fields = ['f_indAssets1m','f_indIncome100k','f_indExperience3y'];
    const yes = fields.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    if (yes === 0) {
      box.style.background = '#1c2333'; box.style.color = '#64748b';
      box.innerHTML = '<i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта';
    } else {
      box.style.background = 'rgba(34,197,94,0.1)'; box.style.color = '#22c55e';
      box.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px"></i>✅ Критерий выполнен (' + yes + ' из 3) — квалифицируется как Professional Client';
    }
  }

  // ── Corporate: Professional Client — ANY 1 of 4 (incl. sub-criterion IV: 2-of-3) ──
  function updateProfScoreCorp() {
    const box = document.getElementById('profScoreCorp_' + taskId);
    if (!box) return;
    // Simple criteria I–III
    const simple = ['f_corpTurnover2m','f_corpBalance1m','f_corpRegulated'];
    const simpleYes = simple.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    // Sub-criterion IV: large corp 2-of-3
    const sub = ['f_corpLargeTurnover','f_corpLargeBalance','f_corpEmployees50'];
    const subYes = sub.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    const largeCorp = subYes >= 2;
    const qualifies = simpleYes >= 1 || largeCorp;
    if (simpleYes === 0 && subYes === 0) {
      box.style.background = '#1c2333'; box.style.color = '#64748b';
      box.innerHTML = '<i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта';
    } else if (qualifies) {
      const reason = simpleYes >= 1
        ? 'критерий I–III выполнен'
        : 'крупная корпорация (' + subYes + '/3 подкритерия)';
      box.style.background = 'rgba(34,197,94,0.1)'; box.style.color = '#22c55e';
      box.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px"></i>✅ Квалифицируется как Professional Client (' + reason + ')';
    } else {
      box.style.background = 'rgba(239,68,68,0.08)'; box.style.color = '#f87171';
      box.innerHTML = '<i class="fas fa-times-circle" style="margin-right:5px"></i>❌ Не квалифицируется — критерий IV требует 2 из 3 подкритериев (' + subYes + '/3)';
    }
  }

  // ── Market Counterparty:
  //    Criteria I–III: any 1 qualifies
  //    Criterion IV (large corp): ALL 3 conditions (AND) ────────
  function updateMcpScore() {
    const box = document.getElementById('mcpScore_' + taskId);
    if (!box) return;
    // Simple I–III
    const simple = ['f_mcpLicensed','f_mcpGovEntity','f_mcpSupranational'];
    const simpleYes = simple.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    // Sub-criterion IV: large corp — ALL 3 required (AND)
    const andFields = ['f_mcpTurnover20m','f_mcpBalance10m','f_mcpEquity2m'];
    const andYes = andFields.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    const largeCorp = andYes === 3;
    const qualifies = simpleYes >= 1 || largeCorp;
    const anyFilled = simpleYes > 0 || andYes > 0;
    if (!anyFilled) {
      box.style.background = '#1c2333'; box.style.color = '#64748b';
      box.innerHTML = '<i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта';
    } else if (qualifies) {
      const reason = simpleYes >= 1
        ? 'критерий I–III выполнен'
        : 'крупная корпорация (все 3 условия AND ✓)';
      box.style.background = 'rgba(139,92,246,0.1)'; box.style.color = '#a78bfa';
      box.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px"></i>✅ Квалифицируется как Market Counterparty (' + reason + ')';
    } else if (andYes > 0 && andYes < 3) {
      box.style.background = 'rgba(234,179,8,0.08)'; box.style.color = '#fbbf24';
      box.innerHTML = '<i class="fas fa-exclamation-circle" style="margin-right:5px"></i>⚠ Критерий IV: ' + andYes + '/3 условий — нужны все 3 одновременно (AND)';
    } else {
      box.style.background = 'rgba(239,68,68,0.08)'; box.style.color = '#f87171';
      box.innerHTML = '<i class="fas fa-times-circle" style="margin-right:5px"></i>❌ Не квалифицируется как Market Counterparty';
    }
  }

  // ── Opt-up / Opt-down show/hide blocks ──────────────────────
  function updateOptBlocks() {
    const upSel   = document.getElementById('f_optUpRequest');
    const downSel = document.getElementById('f_optDownRequest');
    const upBlock   = document.getElementById('optUpBlock_' + taskId);
    const downBlock = document.getElementById('optDownBlock_' + taskId);
    if (upSel   && upBlock)   upBlock.style.display   = (upSel.value   === 'Да') ? 'block' : 'none';
    if (downSel && downBlock) downBlock.style.display = (downSel.value === 'Да') ? 'block' : 'none';
  }

  // ── Attach listeners ─────────────────────────────────────────
  const indFields  = ['f_indAssets1m','f_indIncome100k','f_indExperience3y'];
  const corpFields = ['f_corpTurnover2m','f_corpBalance1m','f_corpRegulated',
                      'f_corpLargeTurnover','f_corpLargeBalance','f_corpEmployees50'];
  const mcpFields  = ['f_mcpLicensed','f_mcpGovEntity','f_mcpSupranational',
                      'f_mcpTurnover20m','f_mcpBalance10m','f_mcpEquity2m'];

  (isIndiv ? indFields : corpFields).forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', isIndiv ? updateProfScoreInd : updateProfScoreCorp);
  });
  mcpFields.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateMcpScore);
  });
  const upSel   = document.getElementById('f_optUpRequest');
  const downSel = document.getElementById('f_optDownRequest');
  if (upSel)   upSel.addEventListener('change', updateOptBlocks);
  if (downSel) downSel.addEventListener('change', updateOptBlocks);

  // ── Run once on init (restore state from saved fd) ───────────
  if (isIndiv) updateProfScoreInd(); else updateProfScoreCorp();
  updateMcpScore();
  updateOptBlocks();
}

/* ─── lp_qualification helpers ────────────────────────────────────
   obLpQualScoreInit(taskId, clientType)
     Wires up live score cards for the LP Qualification Check form (FM 3.1).
     Individual LP: lpScoreInd_${taskId}  — any 1 of 3 criteria
     Corporate LP:  lpScoreCorp_${taskId} — any 1 of I–III OR sub-IV 2-of-3
     Same logic as obClassScoreInit (without MCP block, without opt-up/down).
──────────────────────────────────────────────────────────────── */
function obLpQualScoreInit(taskId, clientType) {
  const isIndiv = clientType === 'Individual';

  // ── Individual LP: Qualified Investor — ANY 1 of 3 ──────────
  function updateLpScoreInd() {
    const box = document.getElementById('lpScoreInd_' + taskId);
    if (!box) return;
    const fields = ['f_indAssets1m', 'f_indIncome100k', 'f_indExperience3y'];
    const yes = fields.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    if (yes === 0) {
      box.style.background = '#1c2333'; box.style.color = '#64748b';
      box.innerHTML = '<i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта';
    } else {
      box.style.background = 'rgba(34,197,94,0.1)'; box.style.color = '#22c55e';
      box.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px"></i>✅ Критерий выполнен (' + yes + ' из 3) — LP квалифицируется как Qualified / Professional Investor';
    }
  }

  // ── Corporate LP: Qualified Investor — ANY 1 of 4 (sub-IV: 2-of-3) ──
  function updateLpScoreCorp() {
    const box = document.getElementById('lpScoreCorp_' + taskId);
    if (!box) return;
    // Simple criteria I–III
    const simple = ['f_corpTurnover2m', 'f_corpBalance1m', 'f_corpRegulated'];
    const simpleYes = simple.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    // Sub-criterion IV: large corp 2-of-3
    const sub = ['f_corpLargeTurnover', 'f_corpLargeBalance', 'f_corpEmployees50'];
    const subYes = sub.filter(function(id) {
      const el = document.getElementById(id); return el && el.value === 'Да';
    }).length;
    const largeCorp = subYes >= 2;
    const qualifies = simpleYes >= 1 || largeCorp;
    if (simpleYes === 0 && subYes === 0) {
      box.style.background = '#1c2333'; box.style.color = '#64748b';
      box.innerHTML = '<i class="fas fa-calculator" style="margin-right:5px"></i>Выберите критерии для расчёта';
    } else if (qualifies) {
      const reason = simpleYes >= 1
        ? 'критерий I–III выполнен'
        : 'крупная корпорация (' + subYes + '/3 подкритерия)';
      box.style.background = 'rgba(34,197,94,0.1)'; box.style.color = '#22c55e';
      box.innerHTML = '<i class="fas fa-check-circle" style="margin-right:5px"></i>✅ Квалифицируется как Qualified / Professional Investor (' + reason + ')';
    } else {
      box.style.background = 'rgba(239,68,68,0.08)'; box.style.color = '#f87171';
      box.innerHTML = '<i class="fas fa-times-circle" style="margin-right:5px"></i>❌ Не квалифицируется — критерий IV требует 2 из 3 подкритериев (' + subYes + '/3)';
    }
  }

  // ── Attach listeners ─────────────────────────────────────────
  const indFields  = ['f_indAssets1m', 'f_indIncome100k', 'f_indExperience3y'];
  const corpFields = ['f_corpTurnover2m', 'f_corpBalance1m', 'f_corpRegulated',
                      'f_corpLargeTurnover', 'f_corpLargeBalance', 'f_corpEmployees50'];

  (isIndiv ? indFields : corpFields).forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', isIndiv ? updateLpScoreInd : updateLpScoreCorp);
  });

  // ── Run once on init (restore state from saved fd) ───────────
  if (isIndiv) updateLpScoreInd(); else updateLpScoreCorp();
}

/* ─── doc_collection helpers ──────────────────────────────────────
   obDocGetMissing()  — returns array of names of required docs
                        whose select value is NOT 'Получен'
   obDocStatusChange() — called onchange of each doc select:
                        updates row colour, progress bar,
                        f_allReceived, and submit button state
──────────────────────────────────────────────────────────────── */
function obDocGetMissing() {
  // Collect required doc rows: id="docRow_0", "docRow_1" ...
  // Required rows live inside #docRequiredList
  const list = document.getElementById('docRequiredList');
  if (!list) return [];
  const missing = [];
  list.querySelectorAll('select[id^="f_doc_"]').forEach(sel => {
    if (sel.value !== 'Получен') {
      // Get doc name from the sibling <span>
      const span = sel.closest('div')?.querySelector('span');
      missing.push(span ? span.textContent.trim() : sel.id);
    }
  });
  return missing;
}

function obDocStatusChange(idx, value, reqCount, isCompleted) {
  if (isCompleted) return; // form is read-only

  // ── 1. Update this row's appearance ──────────────────────────
  const row  = document.getElementById('docRow_' + idx);
  const icon = document.getElementById('docRowIcon_' + idx);
  if (row && icon) {
    const cfg = value === 'Получен'
      ? { bg:'rgba(34,197,94,0.07)',   border:'rgba(34,197,94,0.25)',   ic:'fa-check-circle', cc:'#22c55e', tc:'#86efac'  }
      : value === 'Ожидается'
      ? { bg:'rgba(234,179,8,0.07)',   border:'rgba(234,179,8,0.25)',   ic:'fa-clock',        cc:'#eab308', tc:'#fde047'  }
      : { bg:'rgba(239,68,68,0.08)',   border:'rgba(239,68,68,0.25)',   ic:'fa-times-circle', cc:'#ef4444', tc:'#fca5a5'  };
    row.style.background = cfg.bg;
    icon.className = 'fas ' + cfg.ic;
    icon.style.color = cfg.cc;
    const nameSpan = row.querySelector('span');
    if (nameSpan) nameSpan.style.color = cfg.tc;
  }

  // ── 2. Recount required docs (only those in #docRequiredList) ──
  const list = document.getElementById('docRequiredList');
  let received = 0;
  if (list) {
    list.querySelectorAll('select[id^="f_doc_"]').forEach(sel => {
      if (sel.value === 'Получен') received++;
    });
  }
  const allGood = received === reqCount;
  const pct     = reqCount > 0 ? Math.round(received / reqCount * 100) : 0;

  // ── 3. Update progress banner ─────────────────────────────────
  const countEl   = document.getElementById('docReceivedCount');
  const barEl     = document.getElementById('docProgressBar');
  const bannerEl  = document.getElementById('docProgressBanner');
  const subtextEl = document.getElementById('docProgressSubtext');
  if (countEl)  countEl.textContent = received;
  if (barEl) {
    barEl.style.width      = pct + '%';
    barEl.style.background = allGood ? '#22c55e' : (pct > 50 ? '#eab308' : '#ef4444');
  }
  if (bannerEl) {
    bannerEl.style.background   = allGood ? 'rgba(34,197,94,0.10)' : (pct > 50 ? 'rgba(234,179,8,0.08)' : 'rgba(239,68,68,0.07)');
    bannerEl.style.borderColor  = allGood ? 'rgba(34,197,94,0.35)' : (pct > 50 ? 'rgba(234,179,8,0.3)'  : 'rgba(239,68,68,0.25)');
    const iconEl = bannerEl.querySelector('i');
    const numEl  = bannerEl.querySelector('div > div:first-child');
    if (iconEl) {
      iconEl.className = 'fas fa-' + (allGood ? 'check-circle' : (pct > 50 ? 'hourglass-half' : 'exclamation-circle'));
      iconEl.parentElement.style.background = allGood ? 'rgba(34,197,94,0.18)' : (pct > 50 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)');
      iconEl.parentElement.style.color = allGood ? '#22c55e' : (pct > 50 ? '#eab308' : '#ef4444');
    }
    if (numEl) numEl.style.color = allGood ? '#22c55e' : (pct > 50 ? '#fde047' : '#fca5a5');
  }
  if (subtextEl) {
    subtextEl.textContent = allGood
      ? '✅ Все обязательные документы получены — можно завершить задачу'
      : '⏳ Получите все обязательные документы для завершения задачи';
    subtextEl.style.color = allGood ? '#86efac' : '#a78bfa';
  }
  // Update pct label (sibling of bar)
  const pctEl = barEl?.previousElementSibling;
  if (pctEl) pctEl.textContent = pct + '%';

  // ── 4. Auto-sync f_allReceived ────────────────────────────────
  const allRecvSel = document.getElementById('f_allReceived');
  if (allRecvSel) {
    allRecvSel.value = allGood ? 'Да — все получены' : (received > 0 ? 'Частично' : 'Нет');
  }

  // ── 5. Enable / disable submit button ────────────────────────
  const btn  = document.getElementById('obSubmitTaskBtn');
  const hint = document.getElementById('obSubmitDocHint');
  if (btn) {
    if (allGood) {
      btn.disabled = false;
      btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
      btn.style.color      = '#fff';
      btn.style.cursor     = 'pointer';
      btn.style.opacity    = '1';
      btn.innerHTML        = '<i class="fas fa-check" style="margin-right:5px"></i>Завершить задачу';
    } else {
      btn.disabled = true;
      btn.style.background = 'rgba(100,116,139,0.18)';
      btn.style.color      = '#4a5568';
      btn.style.cursor     = 'not-allowed';
      btn.style.opacity    = '0.7';
      btn.innerHTML        = '<i class="fas fa-lock" style="margin-right:5px"></i>Получите все документы (' + received + '/' + reqCount + ')';
    }
  }
  if (hint) hint.style.display = allGood ? 'none' : 'block';
}

/* ═══════════════════════════════════════════════════
   DRAFT AUTO-SAVE  (localStorage)
   Key format: ob_draft_{taskId}
   Saved: JSON of formData + timestamp
═══════════════════════════════════════════════════ */

// Debounce timer handle
var _obDraftTimer = null;

/** Save current form fields to localStorage (debounced 1 s) */
function obDraftTrigger(taskId, formKey) {
  clearTimeout(_obDraftTimer);
  _obDraftTimer = setTimeout(function() {
    obDraftSave(taskId, formKey);
  }, 1000);
}

/** Immediately serialize form fields → localStorage */
function obDraftSave(taskId, formKey) {
  try {
    const fd = {};
    document.querySelectorAll('[id^="f_"]').forEach(function(el) {
      fd[el.id] = el.value;                      // with f_ prefix
      fd[el.id.replace(/^f_/, '')] = el.value;   // without f_ prefix
    });
    const payload = { taskId: taskId, formKey: formKey, fd: fd, ts: Date.now() };
    localStorage.setItem('ob_draft_' + taskId, JSON.stringify(payload));

    // Show "Автосохранено" indicator
    var ind = document.getElementById('obDraftIndicator');
    if (ind) {
      ind.style.display = 'flex';
      ind.style.color   = '#22c55e';
      ind.innerHTML     = '<i class="fas fa-circle-check" style="font-size:9px"></i>&nbsp;Автосохранено';
      // Fade back to subtle after 3 s
      clearTimeout(ind._fadeTimer);
      ind._fadeTimer = setTimeout(function() {
        if (ind) ind.style.color = '#4a5568';
      }, 3000);
    }
  } catch(e) { /* localStorage may be unavailable — silently ignore */ }
}

/** Load draft from localStorage into task.formData (called before buildTaskForm) */
function obDraftLoad(taskId) {
  try {
    var raw = localStorage.getItem('ob_draft_' + taskId);
    if (!raw) return null;
    var payload = JSON.parse(raw);
    return payload.fd || null;
  } catch(e) { return null; }
}

/** Clear draft from localStorage (called after submitObTask) */
function obDraftClear(taskId) {
  try { localStorage.removeItem('ob_draft_' + taskId); } catch(e) {}
}

/**
 * Attach input/change/keyup listeners to every form field.
 * Each listener triggers obDraftTrigger (debounced 1 s).
 */
function obDraftAttachListeners(taskId, formKey) {
  var container = document.getElementById('obClientModalContent');
  if (!container) return;
  var fields = container.querySelectorAll('input[id^="f_"], select[id^="f_"], textarea[id^="f_"]');
  fields.forEach(function(el) {
    var evtName = (el.tagName === 'SELECT') ? 'change' : 'input';
    // Avoid double-attaching
    if (el._obDraftBound) return;
    el._obDraftBound = true;
    el.addEventListener(evtName, function() {
      obDraftTrigger(taskId, formKey);
    });
  });
}

/* ═══════════════════════════════════════════════════
   PDF REPORT — DD OUTCOME (Task 2.2)
═══════════════════════════════════════════════════ */


/**
 * obGenerateTermSheet(taskId)
 * CF&A Task 4.1 — Generates a legally binding Term Sheet PDF
 * Pulls data from Task 3.1 (Classification) and Task 3.2 (Suitability/Appropriateness)
 * Opens in new window → triggers window.print() → Save as PDF
 */
function obGenerateTermSheet(taskId) {
  var task   = obTasks.find(function(t){ return t.id === taskId; });
  if (!task) { showToast('Задача не найдена', 'red'); return; }
  var client = obClients.find(function(c){ return c.id === task.clientId; });
  if (!client) { showToast('Клиент не найден', 'red'); return; }
  var fd = task.formData || {};

  var t31 = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '3.1'; });
  var t32 = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '3.2'; });
  var t22 = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '2.2'; });
  var t21 = obTasks.find(function(t){ return t.clientId === client.id && t.taskNum === '2.1'; });
  var fd31 = (t31 && t31.formData) || {};
  var fd32 = (t32 && t32.formData) || {};
  var fd22 = (t22 && t22.formData) || {};

  var tsNum    = fd.engNum   || ('TS-' + new Date().getFullYear() + '-XXX');
  var tsDate   = fd.engDate  || new Date().toLocaleDateString('en-GB');
  var isAdv    = client.serviceType === 'Advising' || client.serviceType === 'Both';

  // ── helpers ──────────────────────────────────────────────────
  function esc(v) { return (v||'—').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function row(lbl, val) {
    return '<tr><td class="lbl">' + lbl + '</td><td class="val">' + esc(val) + '</td></tr>';
  }
  function row2(lbl, val, lbl2, val2) {
    return '<tr><td class="lbl">' + lbl + '</td><td class="val">' + esc(val) +
           '</td><td class="lbl">' + lbl2 + '</td><td class="val">' + esc(val2) + '</td></tr>';
  }
  function section(icon, num, title) {
    return '<div class="sec-hdr"><span class="sec-ico">' + icon + '</span><span class="sec-num">SECTION ' + num + '</span>' + title + '</div>';
  }
  function tbl(rows) { return '<table>' + rows + '</table>'; }
  function sigLine(role, name) {
    return '<tr>' +
      '<td style="padding:6pt 10pt;border:1px solid #e5e7eb;font-weight:700;font-size:9pt;background:#f8fafc;width:28%">' + role + '</td>' +
      '<td style="padding:6pt 10pt;border:1px solid #e5e7eb;font-size:9pt;width:36%">' + (name||'') + '</td>' +
      '<td style="padding:6pt 10pt;border:1px solid #e5e7eb;font-size:9pt;width:18%;color:#94a3b8">Signature</td>' +
      '<td style="padding:6pt 10pt;border:1px solid #e5e7eb;font-size:9pt;width:18%;color:#94a3b8">Date</td>' +
      '</tr>';
  }

  // investment objectives (checkboxes from 3.2)
  var objList = [
    fd32.objPreservation === true || fd32.objPreservation === 'true' ? 'Capital Preservation' : null,
    fd32.objIncome       === true || fd32.objIncome       === 'true' ? 'Income Generation'    : null,
    fd32.objGrowth       === true || fd32.objGrowth       === 'true' ? 'Capital Growth'       : null,
    fd32.objSpeculation  === true || fd32.objSpeculation  === 'true' ? 'Speculation'          : null,
  ].filter(Boolean);
  var objStr = objList.length ? objList.join(' · ') : (fd32.investGoals || '—');

  var docStyle =
  '*{box-sizing:border-box;margin:0;padding:0}' +
  'body{font-family:Calibri,"Segoe UI",Arial,sans-serif;font-size:10pt;color:#1a1a2e}' +
  '@page{size:A4;margin:15mm 18mm 18mm 18mm}' +

  /* Header bar */
  '.doc-header{background:#0f172a;color:#fff;padding:16pt 20pt;display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0}' +
  '.doc-header .co-name{font-size:16pt;font-weight:800;letter-spacing:.5pt;color:#f8fafc}' +
  '.doc-header .co-sub{font-size:8pt;color:#94a3b8;margin-top:3pt}' +
  '.doc-header .ts-ref{text-align:right}' +
  '.doc-header .ts-ref .ts-num{font-size:14pt;font-weight:700;color:#f97316}' +
  '.doc-header .ts-ref .ts-label{font-size:8pt;color:#94a3b8;text-transform:uppercase;letter-spacing:1pt}' +

  /* Title strip */
  '.title-strip{background:#f97316;color:#fff;text-align:center;padding:10pt 20pt;font-size:14pt;font-weight:800;letter-spacing:1.5pt;text-transform:uppercase}' +
  '.title-strip .ts-sub{font-size:8pt;font-weight:400;letter-spacing:.5pt;opacity:.9;margin-top:2pt}' +

  /* Meta bar */
  '.meta-bar{background:#0f172a;color:#e2e8f0;display:flex;gap:0;border-bottom:2px solid #f97316}' +
  '.meta-item{flex:1;padding:7pt 14pt;border-right:1px solid #1e293b;font-size:8.5pt}' +
  '.meta-item:last-child{border-right:none}' +
  '.meta-item .mi-label{color:#64748b;font-size:7.5pt;text-transform:uppercase;letter-spacing:.5pt;margin-bottom:2pt}' +
  '.meta-item .mi-val{font-weight:700;color:#f8fafc}' +

  /* Sections */
  '.body-wrap{padding:10pt 20pt 20pt}' +
  '.sec-hdr{background:#0f172a;color:#fff;padding:7pt 12pt;margin:14pt 0 6pt;display:flex;align-items:center;gap:10pt;border-left:4pt solid #f97316}' +
  '.sec-ico{font-size:12pt}' +
  '.sec-num{font-size:7.5pt;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:1pt;min-width:70pt}' +
  '.sec-hdr{font-size:10.5pt;font-weight:700;color:#f8fafc}' +

  /* Tables */
  'table{width:100%;border-collapse:collapse;margin-bottom:8pt;font-size:9.5pt}' +
  'td.lbl{background:#f1f5f9;font-weight:700;width:32%;padding:5pt 8pt;border:1px solid #e2e8f0;color:#374151;vertical-align:top}' +
  'td.val{padding:5pt 8pt;border:1px solid #e2e8f0;color:#1a1a2e;vertical-align:top}' +
  'td.lbl2{background:#fafafa;font-weight:700;width:18%;padding:5pt 8pt;border:1px solid #e2e8f0;color:#374151;font-size:9pt}' +

  /* Badges */
  '.badge{display:inline-block;padding:2pt 7pt;border-radius:3pt;font-size:8pt;font-weight:700}' +
  '.badge-green{background:#dcfce7;color:#166534}' +
  '.badge-blue{background:#dbeafe;color:#1e40af}' +
  '.badge-orange{background:#ffedd5;color:#9a3412}' +
  '.badge-red{background:#fee2e2;color:#991b1b}' +
  '.badge-purple{background:#ede9fe;color:#5b21b6}' +

  /* Summary boxes */
  '.sum-grid{display:grid;grid-template-columns:1fr 1fr;gap:8pt;margin-bottom:8pt}' +
  '.sum-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4pt;padding:8pt 10pt}' +
  '.sum-box .sb-label{font-size:7.5pt;color:#64748b;text-transform:uppercase;letter-spacing:.5pt;margin-bottom:3pt}' +
  '.sum-box .sb-val{font-size:10pt;font-weight:700;color:#0f172a}' +
  '.sum-box .sb-sub{font-size:8pt;color:#64748b;margin-top:2pt}' +

  /* Notice */
  '.notice{background:#fffbeb;border:1pt solid #fcd34d;border-radius:4pt;padding:8pt 12pt;margin:10pt 0;font-size:9pt;color:#92400e}' +

  /* Sig table */
  '.sig-section{margin-top:14pt;border-top:2pt solid #0f172a;padding-top:10pt}' +
  '.sig-table{width:100%;border-collapse:collapse;margin-top:8pt}' +

  /* Footer */
  '.doc-footer{margin-top:14pt;padding-top:8pt;border-top:1pt solid #e2e8f0;display:flex;justify-content:space-between;font-size:7.5pt;color:#94a3b8}';

  var body =
  // ── HEADER ──────────────────────────────────────────────────
  '<div class="doc-header">' +
    '<div><div class="co-name">Golden Leaves Ltd</div>' +
    '<div class="co-sub">' + FUND_PARAMS.license + ' · AIFC, Astana, Republic of Kazakhstan</div>' +
    '<div class="co-sub">CF&A Division — Advisory Services</div></div>' +
    '<div class="ts-ref"><div class="ts-label">Term Sheet</div><div class="ts-num">' + tsNum + '</div></div>' +
  '</div>' +
  '<div class="title-strip">TERM SHEET — ENGAGEMENT OF ADVISORY SERVICES' +
    '<div class="ts-sub">' + (isAdv ? 'Advising on Investments' : 'Arranging Deals in Investments') + ' · Legally Binding</div>' +
  '</div>' +

  // ── META BAR ────────────────────────────────────────────────
  '<div class="meta-bar">' +
    '<div class="meta-item"><div class="mi-label">Date</div><div class="mi-val">' + esc(tsDate) + '</div></div>' +
    '<div class="meta-item"><div class="mi-label">Client</div><div class="mi-val">' + esc(client.name) + '</div></div>' +
    '<div class="meta-item"><div class="mi-label">Classification</div><div class="mi-val">' + esc(fd31.proposedClass || fd31.f_proposedClass || client.classification || '—') + '</div></div>' +
    '<div class="meta-item"><div class="mi-label">Service Type</div><div class="mi-val">' + (isAdv ? 'Advising' : 'Arranging') + '</div></div>' +
    '<div class="meta-item"><div class="mi-label">Governing Law</div><div class="mi-val">' + esc(fd.governingLaw || 'AIFC Law') + '</div></div>' +
  '</div>' +

  '<div class="body-wrap">' +

  // ── SECTION 1: PARTIES ───────────────────────────────────────
  section('⚖️', '1', 'PARTIES') +
  tbl(
    row2('Client (Full Name)', client.name, 'BIN / IIN', client.bin || '—') +
    row2('Client Type', client.type, 'Client Classification', fd31.proposedClass || fd31.f_proposedClass || client.classification || '—') +
    row2('Address', client.address || '—', 'Email', client.email || '—') +
    row2('Phone', client.phone || '—', 'KYC/AML Risk Rating', fd22.riskTotal || fd22.f_riskTotal || client.riskRating || '—') +
    row('Service Provider', 'Golden Leaves Ltd · ' + FUND_PARAMS.license + ' · AIFC, Astana, Republic of Kazakhstan')
  ) +

  // ── SECTION 2: SCOPE OF ENGAGEMENT ──────────────────────────
  section('📋', '2', 'SCOPE OF ENGAGEMENT') +
  tbl(
    row('Service Type', isAdv ? 'Advising on Investments (Full Suitability Assessment applied — Section 3.2)' : 'Arranging Deals in Investments (Appropriateness Assessment applied — Section 3.3)') +
    row('Scope of Work / Description of Mandate', fd.engScope || fd32.recProduct || '—') +
    row2('Proposed Start Date', fd.engStart || '—', 'Proposed End Date / Duration', fd.engExpiry || '—') +
    row('Exclusivity', fd.exclusivity || 'Not specified')
  ) +

  // ── SECTION 3: COMMERCIAL TERMS ─────────────────────────────
  section('💰', '3', 'COMMERCIAL TERMS') +
  tbl(
    row('Fee Structure', fd.feeType || '—') +
    row2('Fixed Fee', fd.feeAmount ? currencySymbol(fd.currency || 'USD') + Number(fd.feeAmount).toLocaleString('en-US') : '—',
         'Success Fee (%)', fd.successFee ? fd.successFee + '%' : '—') +
    row2('Retainer (/month)', fd.retainer ? currencySymbol(fd.currency || 'USD') + Number(fd.retainer).toLocaleString('en-US') : '—',
         'Payment Terms', fd.payTerms || '—')
  ) +

  // ── SECTION 4: CLIENT CLASSIFICATION SUMMARY (from 3.1) ─────
  section('🏷️', '4', 'CLIENT CLASSIFICATION SUMMARY') +
  '<div class="sum-grid">' +
    '<div class="sum-box"><div class="sb-label">Classification</div>' +
    '<div class="sb-val">' + esc(fd31.proposedClass || fd31.f_proposedClass || '—') + '</div>' +
    '<div class="sb-sub">CO Decision: ' + esc(fd31.coDecision || fd31.f_coDecision || '—') + '</div></div>' +
    '<div class="sum-box"><div class="sb-label">Classification Date</div>' +
    '<div class="sb-val">' + esc(fd31.classDate || fd31.f_classDate || '—') + '</div>' +
    '<div class="sb-sub">Client Notified: ' + esc(fd31.clientNotified || '—') + '</div></div>' +
  '</div>' +
  tbl(
    (client.type === 'Individual'
      ? row('① Net Assets ≥ $1,000,000', fd31.indAssets1m || '—') +
        row('② Annual Income ≥ $100,000 (2 yrs)', fd31.indIncome100k || '—') +
        row('③ Professional Qualification ≥ 3 yrs', fd31.indExperience3y || '—')
      : row('① Annual Turnover ≥ $2,000,000', fd31.corpTurnover2m || '—') +
        row('② Balance Sheet ≥ $1,000,000', fd31.corpBalance1m || '—') +
        row('③ Regulated Financial Institution', fd31.corpRegulated || '—') +
        row('④ Large Corp (2-of-3 sub-criteria)', [fd31.corpLargeTurnover, fd31.corpLargeBalance, fd31.corpEmployees50].filter(function(v){return v==='Да';}).length + '/3 met')
    ) +
    row2('Opt-Up Request', fd31.optUpRequest || '—', 'Opt-Down Request', fd31.optDownRequest || '—')
  ) +

  // ── SECTION 5: SUITABILITY / APPROPRIATENESS SUMMARY (from 3.2) ──
  section('📊', '5', isAdv ? 'SUITABILITY ASSESSMENT SUMMARY' : 'APPROPRIATENESS ASSESSMENT SUMMARY') +
  '<div class="sum-grid">' +
    '<div class="sum-box"><div class="sb-label">Conclusion</div>' +
    '<div class="sb-val">' + esc(fd32.suitMatch || '—') + '</div></div>' +
    '<div class="sum-box"><div class="sb-label">Overall Result</div>' +
    '<div class="sb-val">' + esc(fd32.overallResult || '—') + '</div>' +
    '<div class="sb-sub">Assessment Date: ' + esc(fd32.suitDate || '—') + '</div></div>' +
  '</div>' +
  (isAdv
    ? tbl(
        row('Investment Objectives', objStr) +
        row2('Risk Tolerance', fd32.riskTolerance || '—', 'Investment Horizon', fd32.horizon || '—') +
        row2('Liquidity Requirements', fd32.liquidityNeeds || '—', 'Annual Income', fd32.annualIncome || '—') +
        row('Recommended Investment / Mandate', fd32.recProduct || '—') +
        row('Justification / Notes', fd32.suitJustify || fd32.rmComment || '—') +
        row2('Level 1 — Investment Adviser (RM)', fd32.adviserName || '—', 'Adviser Date', fd32.adviserDate || '—') +
        row2('Level 2 — Compliance Officer', fd32.coName || '—', 'CO Review Date', fd32.coReviewDate || '—') +
        row('Client Acknowledgment of Assessment', fd32.clientAck || '—')
      )
    : tbl(
        row2('Instrument Type', fd32.instrType || '—', 'Instrument Experience', fd32.instrExp || '—') +
        row2('Understands Instrument Risks', fd32.understandRisk || '—', 'Risk Warning Issued', fd32.riskWarning || '—') +
        row2('Prior Transaction Experience', fd32.txnPriorExp || '—', 'DD Process Knowledge', fd32.txnDDUnderstand || '—') +
        row('Mandate Description', fd32.recProduct || '—') +
        row2('Appropriateness Conclusion', fd32.suitMatch || '—', 'CO Decision', fd32.coDecision || '—')
      )
  ) +

  // ── SECTION 6: CONDITIONS PRECEDENT ─────────────────────────
  section('✅', '6', 'CONDITIONS PRECEDENT') +
  tbl(
    row('KYC / AML Status', fd22.conclusion || fd22.f_conclusion || '—') +
    row('AML Risk Rating', fd22.riskTotal || fd22.f_riskTotal || client.riskRating || '—') +
    row('Documents Received', t21 && t21.status === 'completed' ? 'All required documents received ✓' : 'Pending / In progress') +
    row('NDA Status', fd.ndaSigned || '—') +
    row('Additional Conditions Precedent', fd.conditionsPrecedent || 'None specified')
  ) +

  // ── SECTION 7: RM NOTES FOR LEGAL COUNSEL ───────────────────
  section('⚖️', '7', 'RM NOTES FOR LEGAL COUNSEL') +
  '<table><tr><td style="padding:10pt 12pt;border:1px solid #e2e8f0;font-size:9.5pt;background:#fffbeb;color:#1a1a2e;white-space:pre-wrap">' +
    esc(fd.legalNotes || '—') +
  '</td></tr></table>' +
  (fd.rmComment ? '<table><tr><td class="lbl" style="width:20%">General RM Comment</td><td class="val">' + esc(fd.rmComment) + '</td></tr></table>' : '') +

  // ── SECTION 8: SIGNATURES ────────────────────────────────────
  section('✍️', '8', 'SIGNATURES — EXECUTION PAGE') +
  '<div class="notice">⚖️ This Term Sheet constitutes a legally binding agreement between the Parties on the terms set forth herein. ' +
  'By signing below, each Party agrees to be bound by the terms of this Term Sheet pending execution of the full Engagement Letter. ' +
  'Governing Law: <strong>' + esc(fd.governingLaw || 'AIFC Law') + '</strong>.</div>' +
  '<table class="sig-table">' +
    '<thead><tr>' +
      '<th style="background:#0f172a;color:#fff;padding:5pt 8pt;font-size:8.5pt;text-align:left;border:1px solid #1e293b">Role</th>' +
      '<th style="background:#0f172a;color:#fff;padding:5pt 8pt;font-size:8.5pt;text-align:left;border:1px solid #1e293b">Name (Print)</th>' +
      '<th style="background:#0f172a;color:#fff;padding:5pt 8pt;font-size:8.5pt;text-align:left;border:1px solid #1e293b">Signature</th>' +
      '<th style="background:#0f172a;color:#fff;padding:5pt 8pt;font-size:8.5pt;text-align:left;border:1px solid #1e293b">Date</th>' +
    '</tr></thead><tbody>' +
    sigLine('For and on behalf of<br>Golden Leaves Ltd', 'Authorised Signatory') +
    sigLine('For and on behalf of<br>the Client', client.name) +
    sigLine('Witnessed by<br>(if applicable)', '') +
    '</tbody></table>' +

  // ── FOOTER ───────────────────────────────────────────────────
  '<div class="doc-footer">' +
    '<span>' + tsNum + ' · Generated ' + new Date().toLocaleDateString('en-GB') + ' by Golden Leaves Ltd CRM</span>' +
    '<span>Page 1 of 1 · ' + FUND_PARAMS.license + '</span>' +
  '</div>' +

  '</div>'; // body-wrap

  var w = openPrintableDocument(body, {
    title: 'Term Sheet — ' + esc(client.name) + ' — ' + tsNum,
    features: 'width=900,height=700',
    extraStyle: docStyle,
  });
  if (w) showToast('✅ Term Sheet готов к печати/PDF: ' + tsNum, 'green');
}

/**
 * obGenerateDDReport(taskId)
 * Generates a printable English-language Client Due Diligence Outcome Form
 * and opens it in a new window → triggers window.print() → Save as PDF.
 */
function obGenerateDDReport(taskId) {
  const task   = obTasks.find(t => t.id === taskId);
  if (!task) { showToast('Задача не найдена', 'red'); return; }
  const client = obClients.find(c => c.id === task.clientId);
  if (!client) { showToast('Клиент не найден', 'red'); return; }

  const fd = task.formData || {};
  const isFM = client.direction === 'FM';

  // ── Document reference number ────────────────────────────
  const year = (task.completedAt || new Date().toISOString().slice(0,10)).slice(0,4);
  const seq  = String(task.id).padStart(3,'0');
  const docRef = 'DD-' + year + '-' + seq;

  // ── Helper: value from fd with fallback ─────────────────
  function v(key, fallback) {
    const val = fd[key] || fd['f_' + key] || '';
    return val || (fallback !== undefined ? fallback : '—');
  }

  // ── Conclusion styling ───────────────────────────────────
  const conclusionRaw = v('f_conclusion','—');
  let conclusionColor = '#1e293b';
  let conclusionBg    = '#f1f5f9';
  let conclusionBorder = '#94a3b8';
  if (conclusionRaw.includes('Approve') || conclusionRaw.includes('Одобрить')) {
    conclusionColor = '#166534'; conclusionBg = '#dcfce7'; conclusionBorder = '#16a34a';
  } else if (conclusionRaw.includes('Reject') || conclusionRaw.includes('Отказать')) {
    conclusionColor = '#991b1b'; conclusionBg = '#fee2e2'; conclusionBorder = '#dc2626';
  } else if (conclusionRaw.includes('EDD')) {
    conclusionColor = '#92400e'; conclusionBg = '#fef3c7'; conclusionBorder = '#d97706';
  }

  // ── Risk rating color ────────────────────────────────────
  function riskColor(r) {
    if (!r || r === '—') return '#64748b';
    if (r === 'Low')         return '#16a34a';
    if (r === 'Medium')      return '#d97706';
    if (r === 'High')        return '#dc2626';
    if (r === 'Unacceptable') return '#7c3aed';
    return '#64748b';
  }

  // ── Sanctions rows ───────────────────────────────────────
  const sanctionLists = ['UN Sanctions List','OFAC SDN List','EU Consolidated Sanctions List','UK (OFSI) Sanctions List'];
  const sanctionRows = sanctionLists.map((name, i) => {
    const val = v('f_sanction_' + i, '—');
    const hit = val.includes('Совпадение') || val.includes('Match') || val.includes('найдено');
    return `<tr>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px">${name}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600;color:${hit?'#dc2626':'#16a34a'}">${hit ? '⚠ Match Found' : '✔ No Match'}</td>
    </tr>`;
  }).join('');

  // ── Risk rating table rows ───────────────────────────────
  const riskRows = [
    ['Jurisdiction Risk',                v('f_riskJurisdiction','—')],
    ['Sanctions Risk',                   v('f_riskSanction','—')],
    ['Reputational Risk',                v('f_riskRep','—')],
    isFM ? ['Source of Funds / Wealth Risk', v('f_riskBusiness','—')]
         : ['Business Activity Risk',    v('f_riskBusiness','—')],
    ['Overall Risk Rating',              v('f_riskTotal','—')],
  ].map(([label, rating]) => {
    const isTotal = label.startsWith('Overall');
    return `<tr style="${isTotal ? 'background:#f8fafc;font-weight:700;' : ''}">
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px${isTotal?';font-weight:700':''}">${label}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700;color:${riskColor(rating)}">${rating}</td>
    </tr>`;
  }).join('');

  // ── Source of Funds section (FM only) ───────────────────
  const sofSection = isFM ? `
    <div style="margin-bottom:28px">
      <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
                 border-bottom:2px solid #3b82f6;padding-bottom:6px;margin-bottom:14px">
        Section 4 — Source of Funds / Wealth Verification (LP)
      </h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
        <thead><tr style="background:#eff6ff">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;border-bottom:2px solid #dbeafe">Verification Item</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;border-bottom:2px solid #dbeafe">Result</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px">Source of Funds Verified</td>
              <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600">${v('f_sofVerified','—')}</td></tr>
          <tr><td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px">Source of Wealth Verified</td>
              <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600">${v('f_sowVerified','—')}</td></tr>
          <tr><td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px">Bank Reference Letter</td>
              <td style="padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:600">${v('f_bankRefOk','—')}</td></tr>
          <tr><td style="padding:7px 12px;font-size:12px">Tax ID / TIN Verified</td>
              <td style="padding:7px 12px;font-size:12px;font-weight:600">${v('f_taxIdVerified','—')}</td></tr>
        </tbody>
      </table>
    </div>` : '';

  // ── MLRO note (FM only) ──────────────────────────────────
  const mlroNoteSection = isFM && v('f_mlroNote','') !== '—' ? `
    <div style="margin-bottom:10px">
      <span style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase">MLRO Risk Note (LP):</span>
      <p style="margin:6px 0 0 0;font-size:12px;color:#1e293b;line-height:1.6;white-space:pre-wrap">${v('f_mlroNote','')}</p>
    </div>` : '';

  // ── Comments block ───────────────────────────────────────
  const commentsSection = v('f_coComment','') !== '—' ? `
    <div style="margin-top:10px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
      <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:8px">Additional Comments / Observations</div>
      <p style="margin:0;font-size:12px;color:#1e293b;line-height:1.7;white-space:pre-wrap">${v('f_coComment','')}</p>
    </div>` : '';

  // ── Adverse media + section numbers ─────────────────────
  const adverseSecNum  = isFM ? 5 : 4;
  const riskSecNum     = isFM ? 6 : 5;
  const conclusionSecNum = isFM ? 7 : 6;

  // ── Verification source ──────────────────────────────────
  const verifySourceVal = v('f_verifySource','Kompra.kz');
  const sanctionToolVal = v('f_sanctionTool','Dow Jones / ComplyAdvantage');

  // ── Document-specific style + body (shared print/PDF shell wraps this — see js/print-utils.js) ──
  const docStyle = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { font-family: 'Inter', Arial, sans-serif; font-size: 13px; line-height: 1.5; }
    .page { max-width: 760px; margin: 0 auto; padding: 40px 48px; }
    h2 { font-size: 15px; font-weight: 700; }
    h3 { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    @media print { .page { padding: 20px 24px; } }
  `;
  const body = `
<div class="page">

  <!-- ══ DOCUMENT HEADER ══ -->
  <div style="border-bottom:3px solid #1d4ed8;padding-bottom:18px;margin-bottom:24px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
      <div>
        <div style="font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">
          Golden Leaves Capital — ${isFM ? 'Fund Management' : 'CF&A Services'}
        </div>
        <h1 style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.2;margin-bottom:4px">
          CLIENT DUE DILIGENCE<br>OUTCOME FORM
        </h1>
        <div style="font-size:12px;color:#475569;margin-top:6px">
          ${isFM ? 'AML / KYC Due Diligence — Limited Partner' : 'Client Due Diligence Outcome — CF&A'}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Reference No.</div>
        <div style="font-size:16px;font-weight:800;color:#1d4ed8">${docRef}</div>
        <div style="font-size:10px;color:#64748b;margin-top:6px">Date: ${v('f_ddDate', task.completedAt || '—')}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">Completed: ${task.completedAt || '—'}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">By: ${task.completedBy || '—'}</div>
      </div>
    </div>
  </div>

  <!-- ══ SECTION 1: CORPORATE IDENTIFICATION ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #1d4ed8;padding-bottom:6px;margin-bottom:14px">
      Section 1 — ${isFM ? 'LP' : 'Client'} Identification
    </h3>
    <table style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <tbody>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;width:38%;border-bottom:1px solid #e2e8f0">Client / ${isFM?'LP':''} Name</td>
          <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0">${client.name}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Client ID</td>
          <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #e2e8f0">${client.clientId}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Type</td>
          <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #e2e8f0">${client.type}${isFM ? ' · ' + (client.lpType || 'HNWI') : ''}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Classification</td>
          <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #e2e8f0">${client.classification}${isFM && client.commitment ? ' · Commitment: ' + fmtCurrency(client.commitment, currencyForFundId(activeFundId)) : ''}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Corporate Data Verified</td>
          <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #e2e8f0">${v('f_corpVerified','—')}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase${isFM?';border-bottom:1px solid #e2e8f0':''}"}>Verification Source</td>
          <td style="padding:8px 12px;font-size:12px${isFM?';border-bottom:1px solid #e2e8f0':''}">${verifySourceVal}</td>
        </tr>
        ${isFM ? `<tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;border-bottom:1px solid #e2e8f0">LP Documents Verified (2.1)</td>
          <td style="padding:8px 12px;font-size:12px;border-bottom:1px solid #e2e8f0">${v('f_lpDocsVerified','—')}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase">UBO Verified (≥10%)</td>
          <td style="padding:8px 12px;font-size:12px">${v('f_uboVerified','N/A')}</td>
        </tr>` : ''}
      </tbody>
    </table>
  </div>

  <!-- ══ SECTION 2: SANCTIONS SCREENING ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #dc2626;padding-bottom:6px;margin-bottom:14px">
      Section 2 — Sanctions Screening
    </h3>
    <table style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <thead><tr style="background:#fef2f2">
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;border-bottom:2px solid #fecaca">Sanctions List</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;border-bottom:2px solid #fecaca">Screening Result</th>
      </tr></thead>
      <tbody>${sanctionRows}</tbody>
    </table>
    <div style="margin-top:10px;display:flex;gap:20px;font-size:12px">
      <div><span style="color:#475569;font-weight:700">Overall Sanctions Result: </span>
           <span style="font-weight:700;color:${(v('f_sanctionTotal','—').includes('Совпадение')||v('f_sanctionTotal','—').includes('Match'))?'#dc2626':'#16a34a'}">${v('f_sanctionTotal','—')}</span></div>
      <div><span style="color:#475569;font-weight:700">Screening Tool: </span>${sanctionToolVal}</div>
    </div>
  </div>

  <!-- ══ SECTION 3: PEP SCREENING ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #f97316;padding-bottom:6px;margin-bottom:14px">
      Section 3 — PEP Screening${isFM ? ' (LP / UBO)' : ''}
    </h3>
    <table style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <tbody>
        <tr style="background:#fff7ed">
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;width:38%;border-bottom:1px solid #e2e8f0">${isFM ? 'PEP Status — LP (Individual)' : 'PEP Status — Client'}</td>
          <td style="padding:8px 12px;font-size:12px;font-weight:600;border-bottom:1px solid #e2e8f0">${v('f_pepClient','—')}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase">${isFM ? 'PEP Status — UBO / Directors' : 'PEP Status — Directors / UBO'}</td>
          <td style="padding:8px 12px;font-size:12px;font-weight:600">${v('f_pepDirectors','—')}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ══ SECTION 4: SOURCE OF FUNDS (FM ONLY) ══ -->
  ${sofSection}

  <!-- ══ SECTION N: ADVERSE MEDIA ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #8b5cf6;padding-bottom:6px;margin-bottom:14px">
      Section ${adverseSecNum} — Adverse Media Check
    </h3>
    <table style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <tbody>
        <tr>
          <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;width:38%">Open Source / Media Search</td>
          <td style="padding:8px 12px;font-size:12px;font-weight:600">${v('f_adverseMedia','—')}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ══ SECTION N: RISK RATING ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #eab308;padding-bottom:6px;margin-bottom:14px">
      Section ${riskSecNum} — Risk Rating${isFM ? ' (LP)' : ''}
    </h3>
    <table style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <thead><tr style="background:#fefce8">
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#854d0e;text-transform:uppercase;border-bottom:2px solid #fef08a">Risk Category</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#854d0e;text-transform:uppercase;border-bottom:2px solid #fef08a">Rating</th>
      </tr></thead>
      <tbody>${riskRows}</tbody>
    </table>
  </div>

  <!-- ══ SECTION N: CONCLUSION ══ -->
  <div style="margin-bottom:28px">
    <h3 style="font-size:13px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.5px;
               border-bottom:2px solid #f97316;padding-bottom:6px;margin-bottom:14px">
      Section ${conclusionSecNum} — Conclusion${isFM ? ' / AML-KYC Decision' : ''}
    </h3>
    <div style="padding:16px 20px;background:${conclusionBg};border:2px solid ${conclusionBorder};border-radius:8px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:${conclusionColor};text-transform:uppercase;opacity:.7;margin-bottom:6px">Decision</div>
      <div style="font-size:16px;font-weight:800;color:${conclusionColor}">${conclusionRaw}</div>
    </div>
    ${mlroNoteSection}
    ${commentsSection}
  </div>

  <!-- ══ SIGNATURE BLOCK ══ -->
  <div style="margin-top:40px;padding-top:20px;border-top:2px solid #e2e8f0">
    <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:20px">
      Authorised Signatures
    </div>
    <div style="display:flex;gap:48px;flex-wrap:wrap">

      <!-- CCO signature -->
      <div style="flex:1;min-width:220px">
        <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px">
          Chief Compliance Officer (CCO)
        </div>
        <!-- Signature line -->
        <div style="border-bottom:1.5px solid #1e293b;height:48px;margin-bottom:6px"></div>
        <!-- Initials box -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="border:1.5px solid #94a3b8;border-radius:4px;width:44px;height:36px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:9px;color:#94a3b8;letter-spacing:.5px">INIT.</span>
          </div>
        </div>
        <div style="font-size:11px;color:#1e293b;font-weight:600">${v('f_signCO', '')}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">Date: _____ / _____ / _______</div>
      </div>

      <!-- MLRO signature -->
      <div style="flex:1;min-width:220px">
        <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px">
          Money Laundering Reporting Officer (MLRO)
        </div>
        <!-- Signature line -->
        <div style="border-bottom:1.5px solid #1e293b;height:48px;margin-bottom:6px"></div>
        <!-- Initials box -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="border:1.5px solid #94a3b8;border-radius:4px;width:44px;height:36px;display:flex;align-items:center;justify-content:center">
            <span style="font-size:9px;color:#94a3b8;letter-spacing:.5px">INIT.</span>
          </div>
        </div>
        <div style="font-size:11px;color:#1e293b;font-weight:600">${v('f_signMLRO', '')}</div>
        <div style="font-size:10px;color:#64748b;margin-top:2px">Date: _____ / _____ / _______</div>
      </div>

    </div>
    <div style="margin-top:20px;font-size:10px;color:#94a3b8;line-height:1.5;border-top:1px solid #e2e8f0;padding-top:12px">
      This document is confidential and prepared for internal compliance purposes only.
      Generated by Golden Leaves Capital CRM · ${docRef} · ${new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})}
    </div>
  </div>

</div>`;

  // ── Open in new window (shared helper — no auto-print timer, one
  //    consistent toolbar/button across every document generator) ──
  try {
    const win = openPrintableDocument(body, {
      title: 'DD Report — ' + client.name + ' — ' + docRef,
      features: 'width=900,height=750,scrollbars=yes,menubar=yes,toolbar=yes',
      extraStyle: docStyle,
    });
    if (win) showToast('✅ DD Report готов к печати/PDF: ' + docRef, 'green');
  } catch(e) {
    showToast('Ошибка генерации PDF: ' + e.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════
   NEW CLIENT MODAL
═══════════════════════════════════════════════════ */

function openNewObClientModal(editId) {
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';

  const client = editId ? obClients.find(function(c){ return c.id === editId; }) : null;
  const isEdit = !!client;
  const dir    = (client && client.direction) || obDirFilter || 'CF&A';
  const isFM   = dir === 'FM';

  // Update modal header title
  var hdr = document.getElementById('obNewModalTitle');
  if (hdr) hdr.innerHTML = '<i class="fas fa-' + (isEdit ? 'edit' : 'user-plus') + '" style="color:#3b82f6;margin-right:8px"></i>' + (isEdit ? 'Редактировать: ' + client.name : 'Новый клиент');

  var cfaBorder = isFM ? '#2a3448' : '#8b5cf6';
  var cfaBg     = isFM ? 'transparent' : 'rgba(139,92,246,0.12)';
  var cfaColor  = isFM ? '#8a9bbf' : '#a78bfa';
  var fmBorder  = isFM ? '#3b82f6' : '#2a3448';
  var fmBg      = isFM ? 'rgba(59,130,246,0.12)' : 'transparent';
  var fmColor   = isFM ? '#60a5fa' : '#8a9bbf';

  var inputStyle = 'width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box';
  var labelStyle = 'font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase';

  function sel(id, label, opts, val) {
    var v = val || opts[0];
    var options = opts.map(function(o){ return '<option value="' + o + '"' + (v === o ? ' selected' : '') + '>' + statusLabel(o) + '</option>'; }).join('');
    return '<div><label style="' + labelStyle + '">' + label + '</label>'
         + '<select id="' + id + '" style="' + inputStyle + '">' + options + '</select></div>';
  }

  var html = ''
    + '<div style="display:flex;gap:8px;margin-bottom:16px">'
    +   '<button id="obDirBtnCFA" type="button" onclick="switchObNewDirection(\'CF&A\')"'
    +     ' style="flex:1;padding:10px;border-radius:10px;border:2px solid ' + cfaBorder + ';background:' + cfaBg + ';color:' + cfaColor + ';cursor:pointer;font-size:13px;font-weight:700;transition:.2s">'
    +     '<i class="fas fa-briefcase" style="margin-right:6px"></i>📊 CF&A<br>'
    +     '<span style="font-size:10px;font-weight:400;opacity:.8">Corporate Finance &amp; Advisory</span>'
    +   '</button>'
    +   '<button id="obDirBtnFM" type="button" onclick="switchObNewDirection(\'FM\')"'
    +     ' style="flex:1;padding:10px;border-radius:10px;border:2px solid ' + fmBorder + ';background:' + fmBg + ';color:' + fmColor + ';cursor:pointer;font-size:13px;font-weight:700;transition:.2s">'
    +     '<i class="fas fa-landmark" style="margin-right:6px"></i>🏦 FM<br>'
    +     '<span style="font-size:10px;font-weight:400;opacity:.8">Fund Management (LP)</span>'
    +   '</button>'
    + '</div>'
    + '<input type="hidden" id="ob_direction" value="' + dir + '" />'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    +   '<div style="grid-column:1/-1">'
    +     '<label style="' + labelStyle + '">Полное имя / Название компании *</label>'
    +     '<input type="text" id="ob_name" value="' + ((client && client.name) || '') + '" placeholder="ООО Компания или ФИО" style="' + inputStyle + '" />'
    +   '</div>'
    +   sel('ob_type', 'Тип клиента', ['Individual','Corporate'], client && client.type)
    +   sel('ob_rm', 'Ответственный RM', ['RM (Relationship Manager)','CEO','Analyst'], client && client.rm)
    +   sel('ob_riskRating', 'Риск-рейтинг', ['Low','Medium','High'], client && client.riskRating)
    +   '<div>'
    +     '<label style="' + labelStyle + '">Дата начала онбординга *</label>'
    +     '<input type="date" id="ob_startDate" value="' + ((client && client.startDate) || today()) + '" style="' + inputStyle + '" />'
    +   '</div>'
    + '</div>'

    // CF&A fields
    + '<div id="obNewFieldsCFA" style="display:' + (isFM ? 'none' : 'block') + ';margin-top:12px">'
    +   '<div style="font-size:11px;font-weight:700;color:#8b5cf6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;border-top:1px solid #2a3448;padding-top:10px">'
    +     '<i class="fas fa-briefcase" style="margin-right:5px"></i>CF&A — тип услуги и классификация клиента'
    +   '</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    +     '<div>'
    +       '<label style="' + labelStyle + '">Тип услуги CF&A *</label>'
    +       '<select id="ob_serviceType" style="' + inputStyle + '">'
    +         '<option value="Advising"' + ((!client || client.serviceType === 'Advising') ? ' selected' : '') + '>Advising</option>'
    +         '<option value="Arranging"' + ((client && client.serviceType === 'Arranging') ? ' selected' : '') + '>Arranging</option>'
    +         '<option value="Both"' + ((client && client.serviceType === 'Both') ? ' selected' : '') + '>Both</option>'
    +       '</select>'
    +       '<div style="font-size:10px;color:#5a6b8a;margin-top:3px">Advising → Suitability · Arranging → Appropriateness</div>'
    +     '</div>'
    +     '<div>'
    +       '<label style="' + labelStyle + '">Классификация клиента</label>'
    +       '<select id="ob_classificationCFA" style="' + inputStyle + '">'
    +         '<option value="Professional Client"' + ((!client || client.classification === 'Professional Client') ? ' selected' : '') + '>Professional Client</option>'
    +         '<option value="Market Counterparty"' + ((client && client.classification === 'Market Counterparty') ? ' selected' : '') + '>Market Counterparty</option>'
    +         '<option value="Retail Client"' + ((client && client.classification === 'Retail Client') ? ' selected' : '') + '>Retail Client</option>'
    +       '</select>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    // FM fields
    + '<div id="obNewFieldsFM" style="display:' + (isFM ? 'block' : 'none') + ';margin-top:12px">'
    +   '<div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;border-top:1px solid #2a3448;padding-top:10px">'
    +     '<i class="fas fa-landmark" style="margin-right:5px"></i>FM — параметры Limited Partner'
    +   '</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    +     sel('ob_lpType', 'Тип LP', ['HNWI','Family Office','Institution','Corporate'], client && client.lpType)
    +     '<div>'
    +       '<label style="' + labelStyle + '">Квалификация инвестора</label>'
    +       '<select id="ob_classificationFM" style="' + inputStyle + '">'
    +         '<option value="Qualified Investor"' + ((!client || client.classification === 'Qualified Investor') ? ' selected' : '') + '>Qualified Investor</option>'
    +         '<option value="Professional Investor"' + ((client && client.classification === 'Professional Investor') ? ' selected' : '') + '>Professional Investor</option>'
    +       '</select>'
    +     '</div>'
    +     '<div style="grid-column:1/-1">'
    +       '<label style="' + labelStyle + '">Commitment (' + currencyForFundId(activeFundId) + ') *</label>'
    +       '<input type="number" id="ob_commitment" value="' + ((client && client.commitment) || '') + '" placeholder="1000000" style="' + inputStyle + '" />'
    +       '<div style="font-size:10px;color:#5a6b8a;margin-top:3px">Минимум $500K для Qualified Investor</div>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    // Notes
    + '<div style="margin-top:12px">'
    +   '<label style="' + labelStyle + '">Примечания</label>'
    +   '<textarea id="ob_notes" rows="2" placeholder="Дополнительная информация..." style="' + inputStyle + ';resize:vertical">' + ((client && client.notes) || '') + '</textarea>'
    + '</div>'

    // Footer buttons
    + '<div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">'
    +   '<button type="button" onclick="closeObNewModal()"'
    +     ' style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">'
    +     'Отмена'
    +   '</button>'
    +   '<button type="button" onclick="obSubmitNewClient()"'
    +     ' style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">'
    +     '<i class="fas fa-' + (isEdit ? 'save' : 'user-plus') + '" style="margin-right:6px"></i>'
    +     (isEdit ? 'Сохранить' : 'Создать клиента')
    +   '</button>'
    + '</div>';

  window._obNewEditId = editId || null;
  document.getElementById('obNewModalContent').innerHTML = html;
  modal.style.display = 'flex';
  _snapshotObNewModal();
}

// Глобальная функция — вызывается через onclick атрибут кнопки "Создать клиента"
function obSubmitNewClient() {
  if (window._obNewEditId) {
    saveObClientEdit(window._obNewEditId);
  } else {
    saveNewObClient();
  }
}

function obNewSelect(id, label, options, selected) {
  return `<div>
    <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">${label}</label>
    <select id="${id}" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
      ${options.map(o => `<option value="${o}" ${(selected||options[0])===o?'selected':''}>${statusLabel(o)}</option>`).join('')}
    </select>
  </div>`;
}

/** Переключить direction прямо в форме нового клиента */
function switchObNewDirection(dir) {
  const hiddenInput = document.getElementById('ob_direction');
  if (hiddenInput) hiddenInput.value = dir;
  // Обновить стили кнопок
  const btnCFA = document.getElementById('obDirBtnCFA');
  const btnFM  = document.getElementById('obDirBtnFM');
  if (btnCFA) {
    btnCFA.style.border      = dir==='CF&A' ? '2px solid #8b5cf6' : '2px solid #2a3448';
    btnCFA.style.background  = dir==='CF&A' ? 'rgba(139,92,246,0.12)' : 'transparent';
    btnCFA.style.color       = dir==='CF&A' ? '#a78bfa' : '#8a9bbf';
  }
  if (btnFM) {
    btnFM.style.border       = dir==='FM' ? '2px solid #3b82f6' : '2px solid #2a3448';
    btnFM.style.background   = dir==='FM' ? 'rgba(59,130,246,0.12)' : 'transparent';
    btnFM.style.color        = dir==='FM' ? '#60a5fa' : '#8a9bbf';
  }
  // Показать/скрыть блоки полей
  const cfaFields = document.getElementById('obNewFieldsCFA');
  const fmFields  = document.getElementById('obNewFieldsFM');
  if (cfaFields) cfaFields.style.display = dir==='CF&A' ? 'block' : 'none';
  if (fmFields)  fmFields.style.display  = dir==='FM'   ? 'block' : 'none';
}

// Used by Cancel/backdrop-click/Escape — warns first if the form was
// actually touched (per the snapshot each open*Modal() takes via
// _snapshotObNewModal(), js/app.js), same convention as closeModal()'s
// dirty-check for the other modal system.
function closeObNewModal() {
  const modal = document.getElementById('modal-ob-new');
  if (modal && _isModalDirty(modal) && !confirm('У вас есть несохранённые изменения. Закрыть без сохранения?')) return;
  closeObNewModalSilent();
}
// Used internally after a successful save/decision — closes without asking.
function closeObNewModalSilent() {
  const modal = document.getElementById('modal-ob-new');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  delete _modalDirtySnapshots['modal-ob-new'];
}

async function saveNewObClient() {
  const name = document.getElementById('ob_name')?.value?.trim();
  if (!name) { showToast('⚠️ Введите название клиента', 'red'); return; }
  const direction = document.getElementById('ob_direction')?.value || 'CF&A';
  const isFM = direction === 'FM';

  if (isFM) {
    const comm = parseFloat(document.getElementById('ob_commitment')?.value);
    if (!comm || comm < 1) { showToast('⚠️ Введите Commitment (' + currencyForFundId(activeFundId) + ') для LP', 'red'); return; }
  }

  const classEl = isFM
    ? document.getElementById('ob_classificationFM')
    : document.getElementById('ob_classificationCFA');
  const client = await createObClient({
    name,
    type:           document.getElementById('ob_type')?.value,
    classification: classEl?.value,
    serviceType:    isFM ? 'LP Investment' : (document.getElementById('ob_serviceType')?.value || 'Advising'),
    lpType:         isFM ? (document.getElementById('ob_lpType')?.value || 'HNWI') : undefined,
    commitment:     isFM ? (parseFloat(document.getElementById('ob_commitment')?.value) || 0) : undefined,
    direction,
    rm:             document.getElementById('ob_rm')?.value,
    riskRating:     document.getElementById('ob_riskRating')?.value,
    startDate:      document.getElementById('ob_startDate')?.value,
    notes:          document.getElementById('ob_notes')?.value,
  });
  if (!client) return; // error toast already shown inside createObClient
  closeObNewModalSilent();
  renderObContent();
  showToast('✅ Клиент "' + client.name + '" создан (' + direction + '). 7 задач сгенерированы.', 'green');
  setTimeout(function(){ openObClientModal(client.id); }, 300);
}

function saveObClientEdit(id) {
  const c = obClients.find(x => x.id === id);
  if (!c) return;
  const direction = document.getElementById('ob_direction')?.value || c.direction;
  const isFM = direction === 'FM';
  const classEl = isFM
    ? document.getElementById('ob_classificationFM')
    : document.getElementById('ob_classificationCFA');
  c.name           = document.getElementById('ob_name')?.value?.trim() || c.name;
  c.type           = document.getElementById('ob_type')?.value;
  c.classification = classEl?.value || c.classification;
  c.serviceType    = isFM ? 'LP Investment' : (document.getElementById('ob_serviceType')?.value || c.serviceType);
  if (isFM) {
    c.lpType    = document.getElementById('ob_lpType')?.value || c.lpType;
    c.commitment= parseFloat(document.getElementById('ob_commitment')?.value) || c.commitment;
  }
  c.direction      = direction;
  c.rm             = document.getElementById('ob_rm')?.value;
  c.riskRating     = document.getElementById('ob_riskRating')?.value;
  c.startDate      = document.getElementById('ob_startDate')?.value || c.startDate;
  c.notes          = document.getElementById('ob_notes')?.value;
  closeObNewModalSilent();
  renderObContent();
  showToast(`✅ Клиент "${c.name}" обновлён`, 'green');
}

async function deleteObClient(id) {
  const c = obClients.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Удалить клиента "${c.name}" и все его задачи онбординга без возможности восстановления?`)) return;
  try {
    await apiFetch(`/api/ob-clients/${id}`, { method: 'DELETE' });
    obClients = obClients.filter(x => x.id !== id);
    obTasks   = obTasks.filter(t => t.clientId !== id);
    closeObClientModal();
    renderObContent();
    updateBadges();
    showToast(`✅ Клиент "${c.name}" удалён`, 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════
   RESTRICTED LIST PAGE
═══════════════════════════════════════════════════ */

function renderRestrictedListPage() {
  const el = document.getElementById('restrictedListContent');
  if (!el) return;

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-ban" style="color:#ef4444;margin-right:6px"></i>Restricted List</span>
        <button onclick="openAddRestrictedModal()"
          style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-plus"></i> Добавить
        </button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Компания</th><th>Сектор</th><th>Фонд</th><th>Доля %</th><th>Ограничение</th><th>CF&A разрешено</th><th>Добавлено</th></tr></thead>
          <tbody>
            ${restrictedList.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:30px;color:#4a5568"><i class="fas fa-ban" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>Restricted List пуст</td></tr>` :
            restrictedList.map(r => `
              <tr>
                <td style="font-weight:700;color:#ef4444">${escapeHtml(r.company)}</td>
                <td style="font-size:12px">${r.sector}</td>
                <td style="font-size:12px;color:#3b82f6">${r.fund}</td>
                <td style="font-weight:700">${r.ownershipPct}%</td>
                <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;
                  background:${r.restrictionType==='Full Restriction'?'rgba(239,68,68,0.12)':'rgba(249,115,22,0.12)'};
                  color:${r.restrictionType==='Full Restriction'?'#ef4444':'#f97316'}">${r.restrictionType}</span></td>
                <td>${r.cfaAllowed
                  ? '<span style="color:#22c55e;font-weight:700">✅ Да (с согласованием)</span>'
                  : '<span style="color:#ef4444;font-weight:700">❌ Нет</span>'}</td>
                <td style="font-size:11px;color:#8a9bbf">${r.addedAt} · ${r.addedBy}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- COI Registry -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-exclamation-triangle" style="color:#f97316;margin-right:6px"></i>Реестр конфликтов интересов (COI)</span>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;color:#8a9bbf">${coiRegistry.length} записей</span>
          <button onclick="openAddCoiModal()"
            style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:#fb923c;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
            <i class="fas fa-plus"></i> Добавить запись
          </button>
        </div>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>ID</th><th>Дата</th><th>Тип</th><th>Стороны</th><th>Severity</th><th>Статус</th><th>Ответственный</th></tr></thead>
          <tbody>
            ${coiRegistry.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:30px;color:#4a5568"><i class="fas fa-exclamation-triangle" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>Конфликтов интересов не зарегистрировано</td></tr>` :
            coiRegistry.map(r => {
              const sevCfg = {Low:{c:'#22c55e',bg:'rgba(34,197,94,0.12)'},Medium:{c:'#f97316',bg:'rgba(249,115,22,0.12)'},High:{c:'#ef4444',bg:'rgba(239,68,68,0.12)'},Critical:{c:'#dc2626',bg:'rgba(220,38,38,0.15)'}}[r.severity]||{};
              return `
                <tr>
                  <td style="font-size:11px;color:#8b5cf6;font-weight:700">${r.coiId}</td>
                  <td style="font-size:12px">${r.date}</td>
                  <td style="font-size:12px">${r.conflictType}</td>
                  <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.parties)}">${escapeHtml(r.parties)}</td>
                  <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${sevCfg.bg};color:${sevCfg.c}">${r.severity}</span></td>
                  <td><span style="font-size:11px;font-weight:700;color:${r.status==='Resolved'?'#22c55e':'#f97316'}">${r.status}</span></td>
                  <td style="font-size:12px">${r.responsible}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Restricted List: Add Entry Modal ──────────────── */
function openAddRestrictedModal() {
  const modal   = document.getElementById('modal-restricted-add');
  const overlay = document.getElementById('restrictedAddOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const inputStyle = 'width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box';
  const labelStyle = 'font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase';

  document.getElementById('restrictedAddModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="grid-column:1/-1">
        <label style="${labelStyle}">Компания *</label>
        <input type="text" id="ra_company" placeholder="Название компании" style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Сектор</label>
        <input type="text" id="ra_sector" placeholder="Технологии, АПК..." style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Фонд</label>
        <input type="text" id="ra_fund" value="TCF-I" style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Доля владения (%)</label>
        <input type="number" id="ra_ownershipPct" min="0" max="100" placeholder="40" style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Тип ограничения</label>
        <select id="ra_restrictionType" style="${inputStyle}">
          <option value="Full Restriction">Full Restriction</option>
          <option value="Requires Approval">Requires Approval</option>
        </select>
      </div>
      <div>
        <label style="${labelStyle}">CF&A разрешено</label>
        <select id="ra_cfaAllowed" style="${inputStyle}">
          <option value="false">Нет</option>
          <option value="true">Да (с согласованием)</option>
        </select>
      </div>
      <div>
        <label style="${labelStyle}">Требуется согласование</label>
        <select id="ra_requiresApproval" style="${inputStyle}">
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button type="button" onclick="closeAddRestrictedModal()"
        style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">
        Отмена
      </button>
      <button type="button" onclick="saveNewRestrictedEntry()"
        style="background:linear-gradient(135deg,#ef4444,#dc2626);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Добавить
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function closeAddRestrictedModal() {
  const modal   = document.getElementById('modal-restricted-add');
  const overlay = document.getElementById('restrictedAddOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function saveNewRestrictedEntry() {
  const company = document.getElementById('ra_company')?.value?.trim();
  if (!company) { showToast('⚠️ Введите название компании', 'red'); return; }

  // POST /api/restricted-list requires both decideConflicts AND accessFM
  // (server/index.js) — check here too for an immediate, specific message
  // instead of a generic API-error toast on 403.
  if (!currentUserPermission('decideConflicts') || !currentUserPermission('accessFM')) {
    showToast('⛔ Недостаточно прав для добавления в Restricted List', 'red');
    return;
  }

  const entry = {
    company,
    sector:           document.getElementById('ra_sector')?.value?.trim() || '—',
    fund:             document.getElementById('ra_fund')?.value?.trim() || 'TCF-I',
    ownershipPct:     parseFloat(document.getElementById('ra_ownershipPct')?.value) || 0,
    restrictionType:  document.getElementById('ra_restrictionType')?.value || 'Full Restriction',
    cfaAllowed:       document.getElementById('ra_cfaAllowed')?.value === 'true',
    requiresApproval: document.getElementById('ra_requiresApproval')?.value === 'true',
  };

  try {
    const created = await apiFetch('/api/restricted-list', { method: 'POST', body: JSON.stringify(entry) });
    restrictedList.push(created);
    closeAddRestrictedModal();
    renderRestrictedListPage();
    showToast(`✅ "${created.company}" добавлена в Restricted List`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

/* ── COI Registry: manual Add Entry Modal ──────────────────
   For conflicts identified by means other than the Restricted-List
   name-matching auto-detector in checkRestrictedList() above (e.g. a
   personal relationship, insider knowledge) — same POST /api/coi-registry
   endpoint either way. */
function openAddCoiModal() {
  const modal   = document.getElementById('modal-coi-add');
  const overlay = document.getElementById('coiAddOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const inputStyle = 'width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box';
  const labelStyle = 'font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase';

  document.getElementById('coiAddModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="grid-column:1/-1">
        <label style="${labelStyle}">Стороны конфликта *</label>
        <input type="text" id="coi_parties" placeholder="ФИО / компания А / компания Б..." style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Тип конфликта</label>
        <input type="text" id="coi_conflictType" placeholder="Personal Relationship, Insider Info..." style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Severity</label>
        <select id="coi_severity" style="${inputStyle}">
          <option value="Low">Low</option>
          <option value="Medium" selected>Medium</option>
          <option value="High">High</option>
          <option value="Critical">Critical</option>
        </select>
      </div>
      <div style="grid-column:1/-1">
        <label style="${labelStyle}">Описание *</label>
        <input type="text" id="coi_description" placeholder="Что именно за конфликт..." style="${inputStyle}" />
      </div>
      <div style="grid-column:1/-1">
        <label style="${labelStyle}">Меры / ограничения</label>
        <input type="text" id="coi_measures" placeholder="Какие меры приняты..." style="${inputStyle}" />
      </div>
      <div>
        <label style="${labelStyle}">Ответственный</label>
        <input type="text" id="coi_responsible" value="CO" style="${inputStyle}" />
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button type="button" onclick="closeAddCoiModal()"
        style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">
        Отмена
      </button>
      <button type="button" onclick="saveNewCoiEntry()"
        style="background:linear-gradient(135deg,#f97316,#dc2626);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Добавить
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function closeAddCoiModal() {
  const modal   = document.getElementById('modal-coi-add');
  const overlay = document.getElementById('coiAddOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function saveNewCoiEntry() {
  const parties = document.getElementById('coi_parties')?.value?.trim();
  const description = document.getElementById('coi_description')?.value?.trim();
  if (!parties)     { showToast('⚠️ Укажите стороны конфликта', 'red'); return; }
  if (!description) { showToast('⚠️ Укажите описание', 'red'); return; }

  const entry = {
    coiId:        `COI-${new Date().getFullYear()}-${String(++obCoiIdCounter).padStart(3,'0')}`,
    date:         new Date().toISOString().slice(0,10),
    conflictType: document.getElementById('coi_conflictType')?.value?.trim() || 'Other',
    parties,
    severity:     document.getElementById('coi_severity')?.value || 'Medium',
    status:       'Open',
    description,
    measures:     document.getElementById('coi_measures')?.value?.trim() || '',
    responsible:  document.getElementById('coi_responsible')?.value?.trim() || 'CO',
    reviewDate:   obAddBizDays(new Date(), 90).toISOString().slice(0,10),
    resolution:   '',
    linkedClientId: null,
  };

  try {
    const created = await apiFetch('/api/coi-registry', { method: 'POST', body: JSON.stringify(entry) });
    coiRegistry.push(created);
    closeAddCoiModal();
    renderRestrictedListPage();
    showToast(`✅ Запись COI ${created.coiId} добавлена`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════ */

function obAddBizDays(date, days) {
  let d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// Used by app.js updateBadges
function getObOverdueCount() {
  const today = new Date();
  return obTasks.filter(t => t.status === 'open' && new Date(t.dueDate) < today).length;
}

/* ═══════════════════════════════════════════════════
   ENGAGEMENTS REGISTRY (5.3)
═══════════════════════════════════════════════════ */

let engagements = [];  // populated at runtime by js/api-auth.js via GET /api/onboarding (see server/index.js)
let engIdCounter = 6;

/* Runtime filter state for engagements page */
let engFilter = '';
let engStatusFilter = '';
let engDirFilter = '';

function renderEngagementsPage() {
  const el = document.getElementById('engagementsContent');
  if (!el) return;

  // KNOWN LIMITATION: these KPI totals sum every engagement regardless of
  // its own currency (CF&A engagements can now be USD/EUR/KZT/RUB
  // independently of each other, unlike fund-scoped amounts elsewhere in
  // the app). A proper fix needs a per-currency breakdown, not a single
  // number — out of scope for the currency-selector work that added
  // per-engagement currency; flagging rather than silently leaving it
  // looking precise. Individual rows/cards below ARE correctly per-currency.
  const totalFees     = engagements.reduce((s,e) => s + (e.feeAmount||0), 0);
  const totalInvoiced = engagements.reduce((s,e) => s + (e.invoiced||0), 0);
  const totalPaid     = engagements.reduce((s,e) => s + (e.paid||0), 0);
  const totalBalance  = totalInvoiced - totalPaid;
  const cntActive     = engagements.filter(e => e.status === 'Active').length;
  const cntFM         = engagements.filter(e => e.serviceType === 'LP Investment (FM)').length;
  const cntCFA        = engagements.filter(e => e.serviceType !== 'LP Investment (FM)').length;

  // Apply filters
  const filtered = engagements.filter(e => {
    if (engStatusFilter && e.status !== engStatusFilter) return false;
    if (engDirFilter === 'FM'  && e.serviceType !== 'LP Investment (FM)') return false;
    if (engDirFilter === 'CFA' && e.serviceType === 'LP Investment (FM)') return false;
    if (engFilter) {
      const q = engFilter.toLowerCase();
      if (!e.clientName.toLowerCase().includes(q) &&
          !e.contractNum.toLowerCase().includes(q) &&
          !(e.engId||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-file-contract"></i></div>
        <div class="kpi-body"><span class="kpi-label">Договоров</span>
          <span class="kpi-value">${engagements.length}</span>
          <span class="kpi-delta">${cntActive} активных</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fas fa-exchange-alt"></i></div>
        <div class="kpi-body"><span class="kpi-label">CF&A / FM</span>
          <span class="kpi-value">${cntCFA} / ${cntFM}</span>
          <span class="kpi-delta">По направлениям</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon orange"><i class="fas fa-file-invoice-dollar"></i></div>
        <div class="kpi-body"><span class="kpi-label">Инвойсировано</span>
          <span class="kpi-value">$${(totalInvoiced/1000).toFixed(0)}K</span>
          <span class="kpi-delta">${totalPaid>0?'Частично оплачено':'Ожидает'}</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fas fa-balance-scale"></i></div>
        <div class="kpi-body"><span class="kpi-label">Остаток</span>
          <span class="kpi-value" style="color:${totalBalance>0?'#f97316':'#22c55e'}">$${(totalBalance/1000).toFixed(0)}K</span>
          <span class="kpi-delta ${totalBalance>0?'warning':'up'}">${totalBalance>0?'К оплате':'Всё оплачено'}</span></div>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <input type="text" placeholder="🔍 Поиск по клиенту, договору..." value="${engFilter}"
        oninput="engFilter=this.value;renderEngagementsPage()"
        style="flex:1;min-width:180px;background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:7px 12px;color:#e2e8f0;font-size:12px" />
      <select onchange="engStatusFilter=this.value;renderEngagementsPage()"
        style="background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:7px 12px;color:#e2e8f0;font-size:12px">
        <option value="" ${engStatusFilter===''?'selected':''}>Все статусы</option>
        <option value="Active"      ${engStatusFilter==='Active'?'selected':''}>Активен</option>
        <option value="Draft"       ${engStatusFilter==='Draft'?'selected':''}>Черновик</option>
        <option value="Completed"   ${engStatusFilter==='Completed'?'selected':''}>Завершён</option>
        <option value="Terminated"  ${engStatusFilter==='Terminated'?'selected':''}>Прекращён</option>
      </select>
      <select onchange="engDirFilter=this.value;renderEngagementsPage()"
        style="background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:7px 12px;color:#e2e8f0;font-size:12px">
        <option value=""    ${engDirFilter===''?'selected':''}>Все направления</option>
        <option value="CFA" ${engDirFilter==='CFA'?'selected':''}>CF&A</option>
        <option value="FM"  ${engDirFilter==='FM'?'selected':''}>FM (LP)</option>
      </select>
      ${(engFilter||engStatusFilter||engDirFilter) ? `<button onclick="engFilter='';engStatusFilter='';engDirFilter='';renderEngagementsPage()"
        style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px"><i class="fas fa-times"></i> Сбросить</button>` : ''}
      <span style="font-size:11px;color:#5a6b8a;white-space:nowrap">${filtered.length} из ${engagements.length}</span>
      <button onclick="openNewEngagementModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600"><i class="fas fa-plus"></i> Новый договор</button>
    </div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-file-contract" style="color:#22c55e;margin-right:6px"></i>Реестр договоров</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th><th>Клиент</th><th>Направление</th><th>Статус</th>
              <th>Подписан</th><th>Сумма / Fee</th><th>Инвойс.</th><th>Оплачено</th><th>Остаток</th><th>Документ</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:30px;color:#4a5568"><i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:8px"></i>Договоры не найдены</td></tr>` :
            filtered.map(e => {
              const balance   = (e.invoiced||0) - (e.paid||0);
              const isFM      = e.serviceType === 'LP Investment (FM)';
              const statusCfg = {Active:{c:'#22c55e',bg:'rgba(34,197,94,0.12)'},Draft:{c:'#8a9bbf',bg:'rgba(100,116,139,0.12)'},Completed:{c:'#3b82f6',bg:'rgba(59,130,246,0.12)'},Terminated:{c:'#ef4444',bg:'rgba(239,68,68,0.12)'}}[e.status]||{c:'#8a9bbf',bg:'rgba(100,116,139,0.12)'};
              const dirColor  = isFM ? '#3b82f6' : '#8b5cf6';
              const dirBg     = isFM ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.12)';
              const dirLabel  = isFM ? 'FM · LP' : 'CF&A';
              const docUrl    = isFM ? (e.lpaUrl||'') : (e.contractUrl||'');
              const signed    = e.signedDate || e.date || '—';
              return `
                <tr onclick="openEngagementModal(${e.id})" style="cursor:pointer">
                  <td>
                    <div style="font-size:11px;color:#22c55e;font-weight:700">${e.engId}</div>
                    <div style="font-size:10px;color:#5a6b8a">${e.contractNum}</div>
                  </td>
                  <td>
                    <div style="font-weight:700;color:#e2e8f0;font-size:13px">${escapeHtml(e.clientName)}</div>
                    <div style="font-size:10px;color:#8a9bbf">${e.rm.split('(')[0].trim()}</div>
                  </td>
                  <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${dirBg};color:${dirColor}">${dirLabel}</span>
                    <div style="font-size:10px;color:#5a6b8a;margin-top:2px">${e.serviceType}</div>
                  </td>
                  <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${statusCfg.bg};color:${statusCfg.c}">${statusLabel(e.status)}</span>
                    ${e.activationDate ? `<div style="font-size:9px;color:#22c55e;margin-top:2px">✓ ${e.activationDate}</div>` : ''}
                  </td>
                  <td style="font-size:12px;color:#94a3b8">${signed}</td>
                  <td>
                    <div style="font-weight:700;color:#22c55e;font-size:13px">${fmtCurrency(e.feeAmount||0, e.currency||'USD')}</div>
                    <div style="font-size:10px;color:#5a6b8a">${statusLabel(e.feeType)}</div>
                  </td>
                  <td style="font-size:12px;color:#f97316">${fmtCurrency(e.invoiced||0, e.currency||'USD')}</td>
                  <td style="font-size:12px;color:#22c55e">${fmtCurrency(e.paid||0, e.currency||'USD')}</td>
                  <td style="font-weight:700;color:${balance>0?'#f97316':'#22c55e'};font-size:12px">${fmtCurrency(balance, e.currency||'USD')}</td>
                  <td style="text-align:center">
                    ${docUrl
                      ? `<button onclick="event.stopPropagation();_obOpenPreviewModal('${docUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${docUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')"
                          title="Открыть документ"
                          style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#c4b5fd;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px">
                          <i class="fas fa-file-contract"></i>
                        </button>`
                      : '<span style="font-size:10px;color:#3a4a5c">—</span>'}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Engagement modal ──────────────────────────── */
let activeEngId = null;

function openEngagementModal(engId) {
  activeEngId = engId;
  const e = engagements.find(x => x.id === engId);
  if (!e) return;
  const modal   = document.getElementById('modal-engagement');
  const overlay = document.getElementById('engagementOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const balance    = e.invoiced - e.paid;
  const isFM       = e.serviceType === 'LP Investment (FM)';
  let amendArr = [];
  try { amendArr = e.amendments ? (typeof e.amendments === 'string' ? JSON.parse(e.amendments) : e.amendments) : []; } catch(_) {}
  let paymentHistoryArr = [];
  try { paymentHistoryArr = e.paymentHistory ? (typeof e.paymentHistory === 'string' ? JSON.parse(e.paymentHistory) : e.paymentHistory) : []; } catch(_) {}
  const docUrl = isFM ? (e.lpaUrl || '') : (e.contractUrl || '');
  const balanceColor = balance > 0 ? '#ef4444' : balance < 0 ? '#60a5fa' : '#22c55e';

  // Build info rows dynamically (skip empty optional fields)
  const infoRows = [
    ['Договор №',         e.contractNum || '—'],
    ['Дата подписания',   e.signedDate  || e.date || '—'],
    ['Клиент',            e.clientName],
    ['Тип услуги',        e.serviceType],
    ['Тип fee',           statusLabel(e.feeType)],
    ['Статус',            statusLabel(e.status)],
    ['Срок',              (e.startDate||'—') + ' → ' + (e.endDate||'—')],
    ['RM',                e.rm],
    ...(e.activationDate ? [['Дата активации',  e.activationDate]] : []),
    ...(e.activatedBy    ? [['Активировал',     e.activatedBy]]    : []),
    ...(isFM && e.lpSignedDate    ? [['LP подписал',    e.lpSignedDate]]    : []),
    ...(isFM && e.capitalCallDate ? [['Первый CC',      e.capitalCallDate]] : []),
  ];

  document.getElementById('engagementModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      ${infoRows.map(([k,v]) => `
        <div style="background:#0f1623;border-radius:8px;padding:9px 12px">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">${k}</div>
          <div style="font-size:13px;color:#e2e8f0;font-weight:600">${escapeHtml(v)}</div>
        </div>`).join('')}
    </div>

    ${docUrl ? `
    <div style="background:#0f1623;border-radius:8px;padding:9px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-left:3px solid #8b5cf6">
      <div style="min-width:0">
        <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">${isFM ? 'LP Agreement (LPA)' : 'Ссылка на договор'}</div>
        <div style="font-size:11px;color:#a78bfa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(docUrl.length>65 ? docUrl.slice(0,65)+'…' : docUrl)}</div>
      </div>
      <button onclick="_obOpenPreviewModal('${escapeAttr(docUrl)}','${escapeAttr(docUrl)}')"
        style="flex-shrink:0;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.35);color:#c4b5fd;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700">
        <i class="fas fa-eye"></i> Открыть
      </button>
    </div>` : ''}

    ${amendArr.length > 0 ? `
    <div style="background:#0f1623;border-radius:8px;padding:9px 12px;margin-bottom:12px">
      <div style="font-size:10px;color:#8b5cf6;text-transform:uppercase;font-weight:700;margin-bottom:8px"><i class="fas fa-file-alt" style="margin-right:4px"></i>Доп. соглашения (${amendArr.length})</div>
      ${amendArr.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1e293b;font-size:11px">
          <span style="color:#c4b5fd;font-weight:700;min-width:55px">${a.num||'—'}</span>
          <span style="color:#94a3b8;min-width:95px">${a.date||'—'}</span>
          <span style="color:#e2e8f0;flex:1">${escapeHtml(a.description)||'—'}</span>
          ${a.url ? `<a href="${a.url}" target="_blank" style="color:#60a5fa;font-size:10px"><i class="fas fa-external-link-alt"></i></a>` : ''}
        </div>`).join('')}
    </div>` : ''}


    <!-- Financials -->
    <div style="background:#1c2333;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:10px">Финансы</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
        ${[
          ['Гонорар', fmtCurrency(e.feeAmount, e.currency||'USD'), '#e2e8f0'],
          ['Инвойсировано', fmtCurrency(e.invoiced, e.currency||'USD'), '#f97316'],
          ['Оплачено', fmtCurrency(e.paid, e.currency||'USD'), '#22c55e'],
          [balance < 0 ? 'Переплата' : 'Остаток', fmtCurrency(Math.abs(balance), e.currency||'USD'), balanceColor],
        ].map(([l,v,c]) => `
          <div style="text-align:center;background:#0f1623;border-radius:8px;padding:10px">
            <div style="font-size:10px;color:#5a6b8a;margin-bottom:4px">${l}</div>
            <div style="font-size:15px;font-weight:800;color:${c}">${v}</div>
          </div>`).join('')}
      </div>
      <div style="margin-top:12px">
        <div style="font-size:11px;color:#5a6b8a;margin-bottom:4px">Прогресс оплаты</div>
        <div style="height:6px;background:#2a3448;border-radius:3px">
          <div style="width:${e.invoiced>0?Math.min(100,Math.round(e.paid/e.invoiced*100)):0}%;height:6px;background:#22c55e;border-radius:3px"></div>
        </div>
      </div>
      <!-- Quick update: payment + deal ref -->
      <div style="display:flex;gap:8px;margin-top:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;color:#5a6b8a;margin-bottom:4px">Обновить "Оплачено" (${currencySymbol(e.currency||'USD')})</div>
          <input type="number" id="engPaidUpdate" value="${e.paid}" min="0"
            style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        </div>
        <div style="flex:1;min-width:110px">
          <div style="font-size:10px;color:#5a6b8a;margin-bottom:4px">Обновить "Инвойсировано" (${currencySymbol(e.currency||'USD')})</div>
          <input type="number" id="engInvoicedUpdate" value="${e.invoiced}" min="0"
            style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        </div>
        <div style="flex:1;min-width:130px">
          <div style="font-size:10px;color:#5a6b8a;margin-bottom:4px">Deal Ref</div>
          <input type="text" id="engDealRefUpdate" value="${e.dealRef ? e.dealRef.replace(/"/g,'&quot;') : ''}" placeholder="DEAL-XXX-2026"
            style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        </div>
        <button onclick="updateEngPayment(${e.id})"
          style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap">
          <i class="fas fa-save"></i> Сохранить
        </button>
      </div>
    </div>

    ${paymentHistoryArr.length > 0 ? `
    <div style="background:#0f1623;border-radius:8px;padding:9px 12px;margin-bottom:12px">
      <div style="font-size:10px;color:#22c55e;text-transform:uppercase;font-weight:700;margin-bottom:8px"><i class="fas fa-clock-rotate-left" style="margin-right:4px"></i>История изменений оплаты (${paymentHistoryArr.length})</div>
      ${paymentHistoryArr.slice().reverse().map(h => `
        <div style="padding:5px 0;border-bottom:1px solid #1e293b;font-size:11px">
          <span style="color:#94a3b8;min-width:140px;display:inline-block">${h.at||'—'} · ${h.by||'—'}</span>
          <span style="color:#e2e8f0">${h.note||'—'}</span>
        </div>`).join('')}
    </div>` : ''}

    ${e.notes ? `<div style="font-size:12px;color:#94a3b8;background:#1c2333;border-radius:8px;padding:10px;margin-bottom:14px;border-left:3px solid #22c55e">${escapeHtml(e.notes)}</div>` : ''}

    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:12px;border-top:1px solid #2a3448">
      <button onclick="deleteEngagement(${e.id})"
        style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-trash"></i> Удалить
      </button>
      <button onclick="closeEngagementModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function closeEngagementModal() {
  const modal   = document.getElementById('modal-engagement');
  const overlay = document.getElementById('engagementOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  activeEngId = null;
}

async function deleteEngagement(id) {
  const e = engagements.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Удалить договор с «${e.clientName}» без возможности восстановления? Возможно только если по нему нет платежей и нет связанных записей COI.`)) return;
  try {
    await apiFetch(`/api/engagements/${id}`, { method: 'DELETE' });
    engagements = engagements.filter(x => x.id !== id);
    closeEngagementModal();
    renderEngagementsPage();
    showToast('✅ Договор удалён', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

async function updateEngPayment(engId) {
  const e = engagements.find(x => x.id === engId);
  if (!e) return;
  const paid     = parseFloat(document.getElementById('engPaidUpdate')?.value) || 0;
  const invoiced = parseFloat(document.getElementById('engInvoicedUpdate')?.value) || 0;
  const dealRef  = document.getElementById('engDealRefUpdate')?.value.trim() || null;
  if (paid < 0 || invoiced < 0) { showToast('⚠️ Суммы не могут быть отрицательными', 'red'); return; }

  const prevPaid = e.paid, prevInvoiced = e.invoiced, prevDealRef = e.dealRef, prevHistory = e.paymentHistory;
  let historyArr = [];
  try { historyArr = e.paymentHistory ? (typeof e.paymentHistory === 'string' ? JSON.parse(e.paymentHistory) : e.paymentHistory) : []; } catch(_) {}
  const changes = [];
  if (paid !== e.paid)         changes.push(`Оплачено: ${fmtCurrency(e.paid, e.currency||'USD')} → ${fmtCurrency(paid, e.currency||'USD')}`);
  if (invoiced !== e.invoiced) changes.push(`Инвойсировано: ${fmtCurrency(e.invoiced, e.currency||'USD')} → ${fmtCurrency(invoiced, e.currency||'USD')}`);
  if (dealRef !== (e.dealRef || null)) changes.push(`Deal Ref: ${e.dealRef || '—'} → ${dealRef || '—'}`);
  if (changes.length) historyArr = [...historyArr, { at: today(), by: currentUserDisplayName(), note: changes.join('; ') }];

  e.paid     = paid;
  e.invoiced = invoiced;
  e.dealRef  = dealRef;
  e.paymentHistory = historyArr;
  try {
    const updated = await apiFetch(`/api/engagements/${engId}`, { method: 'PUT', body: JSON.stringify(e) });
    Object.assign(e, updated);
    const balance = e.invoiced - e.paid;
    const balanceMsg = balance > 0 ? `Остаток: ${fmtCurrency(balance, e.currency||'USD')}`
                      : balance < 0 ? `Переплата: ${fmtCurrency(-balance, e.currency||'USD')}`
                      : 'Оплачено полностью';
    showToast(`💰 Оплата обновлена. ${balanceMsg}`, balance>0?'orange':balance<0?'blue':'green');
  } catch (err) {
    e.paid = prevPaid; e.invoiced = prevInvoiced; e.dealRef = prevDealRef; e.paymentHistory = prevHistory;
    showToast('⚠️ Не удалось сохранить оплату: ' + err.message, 'red');
  }
  openEngagementModal(engId);   // re-render
  renderEngagementsPage();
}

function openNewEngagementModal() {
  const modal   = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';

  const seq = String(engIdCounter).padStart(3,'0');
  // FM engagements (LP subscriptions) are generated automatically as part
  // of the onboarding wizard's FM task flow (see registerLPFromOnboarding
  // and the activation-task handling below) with their own required fields
  // (LPA, LP signed date, first capital call date) — this generic form
  // always creates a CF&A engagement, so only CF&A clients are offered
  // here to avoid mislabeling an FM client's contract as CF&A.
  const clientOptions = obClients.filter(c => c.activated && c.direction !== 'FM').map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)} (${c.clientId})</option>`).join('');

  document.getElementById('obNewModalContent').innerHTML = `
    <div style="font-size:14px;font-weight:800;color:#f1f5f9;margin-bottom:16px">
      <i class="fas fa-file-contract" style="color:#22c55e;margin-right:8px"></i>Новый договор
    </div>
    <div style="font-size:11px;color:#5a6b8a;margin-bottom:12px">Только для клиентов CF&amp;A — договоры FM (LP Investment) создаются автоматически на этапе онбординга LP.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="grid-column:1/-1">
        <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Клиент *</label>
        <select id="eng_clientId" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${clientOptions || '<option value="">— Нет активированных клиентов CF&A —</option>'}
        </select>
      </div>
      ${obNewSelect('eng_serviceType','Тип услуги',['Advising','Arranging','Both'],null)}
      ${obNewSelect('eng_feeType','Тип вознаграждения',['Fixed Fee','Success Fee','Retainer','Комбинированный'],null)}
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Сумма *</label>
        <input type="number" id="eng_feeAmount" placeholder="50000" min="0"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Валюта *</label>
        <select id="eng_currency" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${Object.entries(CURRENCIES).map(([code,c]) => `<option value="${code}"${code==='USD'?' selected':''}>${c.label}</option>`).join('')}
        </select></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Дата договора</label>
        <input type="date" id="eng_date" value="${today()}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Deal Ref (опционально)</label>
        <input type="text" id="eng_dealRef" placeholder="DEAL-XXX-2026"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        <div style="font-size:10px;color:#5a6b8a;margin-top:3px">Если у клиента уже есть договор с тем же Deal Ref, система считает это Dual-Mandate — требует рассмотрения CF Deal Committee.</div></div>
      <div style="grid-column:1/-1"><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Примечания</label>
        <textarea id="eng_notes" rows="2" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewEngagement()" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Создать договор
      </button>
    </div>`;

  modal.style.display = 'flex';
  _snapshotObNewModal();
}

async function saveNewEngagement() {
  const clientIdVal = document.getElementById('eng_clientId')?.value;
  const client = obClients.find(c => String(c.id) === String(clientIdVal));
  const feeAmount = parseFloat(document.getElementById('eng_feeAmount')?.value) || 0;
  const dealRef = document.getElementById('eng_dealRef')?.value.trim() || null;
  if (!client) { showToast('⚠️ Выберите клиента', 'red'); return; }
  if (feeAmount <= 0) { showToast('⚠️ Сумма гонорара должна быть больше 0', 'red'); return; }

  // Two engagements for the same client sharing a Deal Ref is exactly the
  // Dual-Mandate scenario (COI Addendum Section D) — flag it up front
  // instead of letting it pass silently, since nothing else in the app
  // currently cross-checks deal_ref automatically.
  if (dealRef && engagements.some(e => e.clientId === client.id && e.dealRef === dealRef)) {
    if (!confirm(`У клиента "${client.name}" уже есть договор с Deal Ref "${dealRef}" — это Dual-Mandate (Advising + Arranging по одной сделке) и требует обязательного рассмотрения CF Deal Committee через раздел «Конфликты / Одобрения». Продолжить создание?`)) return;
  }

  const seq = String(engIdCounter++).padStart(3,'0');
  const eng = {
    engId:       `ENG-${new Date().getFullYear()}-${seq}`,
    clientId:    client.id,
    clientName:  client.name,
    serviceType: document.getElementById('eng_serviceType')?.value,
    direction:   'CF&A',
    contractNum: `GL-${new Date().getFullYear()}-${seq}`,
    date:        document.getElementById('eng_date')?.value || today(),
    status:      'Draft',
    feeType:     document.getElementById('eng_feeType')?.value,
    feeAmount,
    currency:    document.getElementById('eng_currency')?.value || 'USD',
    successFee:  null,
    retainer:    null,
    payTerms:    'При подписании',
    invoiced:    0,
    paid:        0,
    startDate:   document.getElementById('eng_date')?.value || today(),
    endDate:     '',
    rm:          currentUserDisplayName(),
    notes:       document.getElementById('eng_notes')?.value || '',
    dealRef,
  };
  try {
    const created = await apiFetch('/api/engagements', { method: 'POST', body: JSON.stringify(eng) });
    engagements.push(created);
    closeObNewModalSilent();
    renderEngagementsPage();
    showToast(`✅ Договор ${created.engId} создан`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить договор: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════
   CONFLICT APPROVALS — CF Deal Committee Decision &
   Escalation Matrix (COI Addendum Section E). Real API-
   backed (GET/POST/PUT /api/conflict-approvals) — unlike
   the local-only onboarding forms above, writes here go
   straight to the server since there's no legacy
   client-side array/behaviour to replicate.
═══════════════════════════════════════════════════ */

let conflictFilter = '';
let conflictStatusFilter = '';

function conflictRiskStyle(risk) {
  return {
    Low:      { c: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    Medium:   { c: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    High:     { c: '#f97316', bg: 'rgba(249,115,22,0.12)' },
    Critical: { c: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  }[risk] || { c: '#8a9bbf', bg: 'rgba(100,116,139,0.12)' };
}

function conflictStatusStyle(status) {
  if (status === 'Pending') return { c: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  if (status === 'Escalated') return { c: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
  if (status === 'Rejected') return { c: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (status === 'Approved') return { c: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
  return { c: '#3b82f6', bg: 'rgba(59,130,246,0.12)' }; // Approved with conditions, etc.
}

function renderConflictApprovalsPage() {
  const el = document.getElementById('conflictApprovalsContent');
  if (!el) return;
  const list = typeof conflictApprovals !== 'undefined' ? conflictApprovals : [];

  const cntPending   = list.filter(a => a.status === 'Pending').length;
  const cntEscalated = list.filter(a => a.status === 'Escalated').length;
  const cntDual      = list.filter(a => a.decisionType === 'Dual-Mandate').length;

  const filtered = list.filter(a => {
    if (conflictStatusFilter && a.status !== conflictStatusFilter) return false;
    if (conflictFilter) {
      const q = conflictFilter.toLowerCase();
      const client = obClients.find(c => c.id === a.clientId);
      if (!(a.dealRef || '').toLowerCase().includes(q) &&
          !(a.decisionType || '').toLowerCase().includes(q) &&
          !(client && client.name.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon orange"><i class="fas fa-gavel"></i></div>
        <div class="kpi-body"><span class="kpi-label">Решений в реестре</span>
          <span class="kpi-value">${list.length}</span>
          <span class="kpi-delta">${cntPending + cntEscalated} ожидают решения</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red"><i class="fas fa-triangle-exclamation"></i></div>
        <div class="kpi-body"><span class="kpi-label">Эскалировано</span>
          <span class="kpi-value">${cntEscalated}</span>
          <span class="kpi-delta">Требуют решения CEO</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fas fa-people-arrows"></i></div>
        <div class="kpi-body"><span class="kpi-label">Dual-Mandate</span>
          <span class="kpi-value">${cntDual}</span>
          <span class="kpi-delta">Advising + Arranging</span></div>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <input type="text" placeholder="🔍 Поиск по клиенту, deal ref, типу..." value="${conflictFilter}"
        oninput="conflictFilter=this.value;renderConflictApprovalsPage()"
        style="flex:1;min-width:180px;background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:7px 12px;color:#e2e8f0;font-size:12px" />
      <select onchange="conflictStatusFilter=this.value;renderConflictApprovalsPage()"
        style="background:#1c2333;border:1px solid #2a3448;border-radius:8px;padding:7px 12px;color:#e2e8f0;font-size:12px">
        <option value="" ${conflictStatusFilter===''?'selected':''}>Все статусы</option>
        <option value="Pending" ${conflictStatusFilter==='Pending'?'selected':''}>На рассмотрении</option>
        <option value="Escalated" ${conflictStatusFilter==='Escalated'?'selected':''}>Эскалировано (CEO)</option>
        <option value="Approved" ${conflictStatusFilter==='Approved'?'selected':''}>Одобрено</option>
        <option value="Approved with conditions" ${conflictStatusFilter==='Approved with conditions'?'selected':''}>Одобрено с условиями</option>
        <option value="Rejected" ${conflictStatusFilter==='Rejected'?'selected':''}>Отклонено</option>
      </select>
      ${(conflictFilter||conflictStatusFilter) ? `<button onclick="conflictFilter='';conflictStatusFilter='';renderConflictApprovalsPage()"
        style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px"><i class="fas fa-times"></i> Сбросить</button>` : ''}
      <span style="font-size:11px;color:#5a6b8a;white-space:nowrap">${filtered.length} из ${list.length}</span>
      <button onclick="openNewConflictApprovalModal()"
        style="background:#f97316;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600"><i class="fas fa-plus"></i> Завести решение</button>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-gavel" style="color:#f97316;margin-right:6px"></i>Decision &amp; Escalation Matrix</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Тип конфликта</th><th>Клиент</th><th>Deal Ref</th><th>Риск</th>
              <th>Fee</th><th>Кто решает</th><th>Срок</th><th>Статус</th><th>Дата решения</th><th>Кто решил</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:30px;color:#4a5568"><i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:8px"></i>Решений не найдено</td></tr>` :
            filtered.map(a => {
              const client = obClients.find(c => c.id === a.clientId);
              const risk   = conflictRiskStyle(a.riskLevel);
              const stat   = conflictStatusStyle(a.status);
              return `
                <tr onclick="openConflictApprovalDetail(${a.id})" style="cursor:pointer">
                  <td style="font-weight:700;color:#e2e8f0;font-size:13px">${statusLabel(a.decisionType)}</td>
                  <td style="font-size:12px;color:#94a3b8">${client ? client.name : '—'}</td>
                  <td style="font-size:11px;color:#5a6b8a">${a.dealRef || '—'}</td>
                  <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${risk.bg};color:${risk.c}">${statusLabel(a.riskLevel)}</span></td>
                  <td style="font-size:12px;color:#22c55e">${a.feeAmount ? fmtCurrency(a.feeAmount, a.currency||'USD') : '—'}</td>
                  <td style="font-size:11px;color:#94a3b8">${a.decisionMaker || '—'}</td>
                  <td style="font-size:11px;color:#8a9bbf">${a.requiredTimeline || '—'}</td>
                  <td><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${stat.bg};color:${stat.c}">${statusLabel(a.status)}</span></td>
                  <td style="font-size:11px;color:#5a6b8a">${a.decidedAt || '—'}</td>
                  <td style="font-size:11px;color:#5a6b8a">${a.decidedBy || '—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// When the user picks a linked engagement, default the fee currency to
// match it (a conflict-approval fee tied to an engagement should normally
// agree with that engagement's own currency) — still just a smart-fill,
// the user can still override it afterward since currency is stored
// independently on the conflict-approval row either way.
function updateCaCurrencyFromEngagement() {
  const engSel = document.getElementById('ca_engagementId');
  const currSel = document.getElementById('ca_currency');
  if (!engSel || !currSel || !engSel.value) return;
  const opt = engSel.options[engSel.selectedIndex];
  const curr = opt && opt.getAttribute('data-currency');
  if (curr) currSel.value = curr;
}

function openNewConflictApprovalModal() {
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';

  const clientOptions = obClients.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.clientId})</option>`).join('');
  const engOptions = engagements.map(e => `<option value="${e.id}" data-currency="${e.currency||'USD'}">${escapeHtml(e.clientName)} — ${e.engId}${e.dealRef ? ' [' + escapeHtml(e.dealRef) + ']' : ''}</option>`).join('');

  document.getElementById('obNewModalTitle').innerHTML = '<i class="fas fa-gavel" style="color:#f97316;margin-right:8px"></i>Новое решение по конфликту';
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Клиент *</label>
        <select id="ca_clientId" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          <option value="">— Не выбран —</option>${clientOptions}
        </select></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Договор (опционально)</label>
        <select id="ca_engagementId" onchange="updateCaCurrencyFromEngagement()" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          <option value="">— Без привязки к договору —</option>${engOptions}
        </select></div>
      ${obNewSelect('ca_decisionType','Тип конфликта',['Internal Client','Dual-Mandate','Routine Conflict','Other'],null)}
      ${obNewSelect('ca_riskLevel','Уровень риска',['Low','Medium','High','Critical'],null)}
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Deal Ref</label>
        <input type="text" id="ca_dealRef" placeholder="DEAL-XXX-2026"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Fee</label>
        <input type="number" id="ca_feeAmount" placeholder="90000"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Валюта</label>
        <select id="ca_currency" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${Object.entries(CURRENCIES).map(([code,c]) => `<option value="${code}"${code==='USD'?' selected':''}>${c.label}</option>`).join('')}
        </select></div>
      ${obNewSelect('ca_decisionMaker','Кто принимает решение',['Compliance Officer','CF Deal Committee','Board'],null)}
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Срок рассмотрения</label>
        <input type="text" id="ca_requiredTimeline" placeholder="Convened within 48 hours"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div style="grid-column:1/-1"><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Описание конфликта</label>
        <textarea id="ca_description" rows="2" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea></div>
      <div style="grid-column:1/-1"><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Rationale / условия одобрения</label>
        <textarea id="ca_rationale" rows="2" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box"></textarea></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewConflictApproval()" style="background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Завести решение
      </button>
    </div>`;

  modal.style.display = 'flex';
  _snapshotObNewModal();
}

async function saveNewConflictApproval() {
  const clientId = document.getElementById('ca_clientId')?.value;
  const decisionType = document.getElementById('ca_decisionType')?.value;
  if (!clientId) { showToast('⚠️ Выберите клиента', 'red'); return; }
  if (!decisionType) { showToast('⚠️ Выберите тип конфликта', 'red'); return; }

  const engagementId = document.getElementById('ca_engagementId')?.value || null;
  const payload = {
    clientId: parseInt(clientId, 10),
    engagementId: engagementId ? parseInt(engagementId, 10) : null,
    decisionType,
    riskLevel: document.getElementById('ca_riskLevel')?.value || 'Low',
    dealRef: document.getElementById('ca_dealRef')?.value || null,
    feeAmount: parseFloat(document.getElementById('ca_feeAmount')?.value) || null,
    currency: document.getElementById('ca_currency')?.value || 'USD',
    decisionMaker: document.getElementById('ca_decisionMaker')?.value || null,
    requiredTimeline: document.getElementById('ca_requiredTimeline')?.value || null,
    description: document.getElementById('ca_description')?.value || null,
    rationale: document.getElementById('ca_rationale')?.value || null,
    // status is deliberately omitted — the server decides Pending vs
    // Escalated from riskLevel (High/Critical auto-escalates to CEO-only),
    // same reasoning as Capital Call always starting at Draft server-side.
  };

  try {
    await apiFetch('/api/conflict-approvals', { method: 'POST', body: JSON.stringify(payload) });
    await loadConflictApprovalsFromApi();
    closeObNewModalSilent();
    renderConflictApprovalsPage();
    showToast('✅ Решение по конфликту заведено', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

function openConflictApprovalDetail(id) {
  const a = conflictApprovals.find(x => x.id === id);
  if (!a) return;
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  const client = obClients.find(c => c.id === a.clientId);
  const eng = engagements.find(e => e.id === a.engagementId);
  const risk = conflictRiskStyle(a.riskLevel);
  const stat = conflictStatusStyle(a.status);

  const isDecidable = a.status === 'Pending' || a.status === 'Escalated';
  // Same permission the server enforces, just checked here too so a user
  // who can't decide doesn't even see live-looking buttons that would
  // just 403 (real enforcement stays server-side either way). Escalated
  // (High/Critical risk) conflicts additionally require the CEO role
  // specifically — Compliance Officer/MLRO hold decideConflicts too but
  // can't resolve an escalated one.
  const canDecide = isDecidable && currentUserPermission('decideConflicts') &&
    (a.status !== 'Escalated' || currentUserRole() === 'CEO');

  document.getElementById('obNewModalTitle').innerHTML = `<i class="fas fa-gavel" style="color:#f97316;margin-right:8px"></i>${statusLabel(a.decisionType)}`;
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${risk.bg};color:${risk.c}">Риск: ${statusLabel(a.riskLevel)}</span>
      <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${stat.bg};color:${stat.c}">${statusLabel(a.status)}</span>
    </div>
    ${a.status === 'Escalated' ? `<div style="margin-bottom:14px;padding:10px 12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:12px;color:#fca5a5">
      <i class="fas fa-triangle-exclamation" style="margin-right:6px"></i>Риск ${statusLabel(a.riskLevel)} — решение может принять только CEO.</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;color:#94a3b8;margin-bottom:14px">
      <div><b style="color:#8a9bbf">Клиент:</b> ${client ? client.name : '—'}</div>
      <div><b style="color:#8a9bbf">Договор:</b> ${eng ? eng.engId : '—'}</div>
      <div><b style="color:#8a9bbf">Deal Ref:</b> ${a.dealRef || '—'}</div>
      <div><b style="color:#8a9bbf">Fee:</b> ${a.feeAmount ? currencySymbol(a.currency||'USD') + a.feeAmount.toLocaleString() : '—'}</div>
      <div><b style="color:#8a9bbf">Кто решает:</b> ${a.decisionMaker || '—'}</div>
      <div><b style="color:#8a9bbf">Срок:</b> ${a.requiredTimeline || '—'}</div>
      <div><b style="color:#8a9bbf">Дата решения:</b> ${a.decidedAt || '—'}</div>
      <div><b style="color:#8a9bbf">Кто решил:</b> ${a.decidedBy || '—'}</div>
    </div>
    ${a.description ? `<div style="margin-bottom:10px"><b style="font-size:11px;color:#8a9bbf;text-transform:uppercase">Описание</b><p style="font-size:13px;color:#e2e8f0;margin:4px 0 0">${escapeHtml(a.description)}</p></div>` : ''}
    ${a.rationale ? `<div style="margin-bottom:10px"><b style="font-size:11px;color:#8a9bbf;text-transform:uppercase">Rationale</b><p style="font-size:13px;color:#e2e8f0;margin:4px 0 0">${escapeHtml(a.rationale)}</p></div>` : ''}
    ${canDecide ? `
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="decideConflictApproval(${a.id},'Rejected')" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px"><i class="fas fa-xmark"></i> Отклонить</button>
      <button onclick="decideConflictApproval(${a.id},'Approved with conditions')" style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px"><i class="fas fa-check"></i> Одобрить с условиями</button>
      <button onclick="decideConflictApproval(${a.id},'Approved')" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700"><i class="fas fa-check-double"></i> Одобрить</button>
    </div>` : (isDecidable ? `<div style="padding-top:14px;border-top:1px solid #2a3448;margin-top:16px;font-size:12px;color:#64748b;text-align:right">
      <i class="fas fa-lock" style="margin-right:5px"></i>У вас нет прав на это решение</div>` : '')}`;

  modal.style.display = 'flex';
}

async function decideConflictApproval(id, status) {
  const a = conflictApprovals.find(x => x.id === id);
  if (!a) return;
  const client = obClients.find(c => c.id === a.clientId);
  // One-shot decision — the Approve/Reject buttons only render while
  // status === 'Pending' (see openConflictApprovalDetail), so once set
  // there is no re-decide control in the UI.
  if (!confirm(`Решение «${status}» по конфликту (${client ? client.name : 'клиент #' + a.clientId}) будет зафиксировано и не подлежит изменению через интерфейс. Продолжить?`)) return;
  try {
    // decidedAt/decidedBy are server-stamped from the authenticated user
    // (see PUT /api/conflict-approvals/:id) — not sent from here.
    await apiFetch(`/api/conflict-approvals/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    await loadConflictApprovalsFromApi();
    closeObNewModalSilent();
    renderConflictApprovalsPage();
    showToast(`✅ Решение обновлено: ${status}`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось обновить решение: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════
   DASHBOARD WIDGETS
═══════════════════════════════════════════════════ */

function renderDashboardObWidget() {
  const el = document.getElementById('dashObWidget');
  if (!el) return;
  const todayD   = new Date();
  const active   = obClients.filter(c => !c.activated);
  const onTrack  = active.filter(c => c.onboardingStatus === 'On Track');
  const atRisk   = active.filter(c => c.onboardingStatus === 'At Risk');
  const delayed  = active.filter(c => c.onboardingStatus === 'Delayed');
  const completed= obClients.filter(c => c.activated);
  const overdueTasks = obTasks.filter(t => t.status === 'open' && new Date(t.dueDate) < todayD);

  const total = active.length || 1; // avoid divide-by-zero
  const pctOnTrack = Math.round(onTrack.length / total * 100);
  const pctAtRisk  = Math.round(atRisk.length  / total * 100);
  const pctDelayed = Math.round(delayed.length  / total * 100);

  const phaseCounts = [1,2,3,4,5].map(p => active.filter(c => c.phase === p).length);
  const phaseColors = ['#8b5cf6','#f97316','#3b82f6','#22c55e','#eab308'];
  const phaseLabels = ['Conflict','Docs','KYC/Class','Engagement','Activation'];

  el.innerHTML = `
    <div style="padding:14px 16px">

      <!-- Status summary bar (On Track / At Risk / Delayed) -->
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase">Онбординг в процессе</span>
          <span style="font-size:11px;color:#8a9bbf">${active.length} клиентов</span>
        </div>
        <!-- Segmented status bar -->
        <div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:#1e293b;gap:1px">
          ${onTrack.length ? `<div style="flex:${onTrack.length};background:#22c55e;border-radius:4px 0 0 4px" title="On Track: ${onTrack.length}"></div>` : ''}
          ${atRisk.length  ? `<div style="flex:${atRisk.length};background:#f97316"  title="At Risk: ${atRisk.length}"></div>`  : ''}
          ${delayed.length ? `<div style="flex:${delayed.length};background:#ef4444;border-radius:0 4px 4px 0" title="Delayed: ${delayed.length}"></div>` : ''}
          ${!active.length ? `<div style="flex:1;background:#22c55e;border-radius:4px"></div>` : ''}
        </div>
        <!-- Legend row -->
        <div style="display:flex;gap:14px;margin-top:8px;flex-wrap:wrap">
          ${[
            ['On Track',  onTrack.length,  '#22c55e', 'fa-check-circle'],
            ['At Risk',   atRisk.length,   '#f97316', 'fa-exclamation-circle'],
            ['Delayed',   delayed.length,  '#ef4444', 'fa-times-circle'],
            ['Completed', completed.length,'#3b82f6', 'fa-flag-checkered'],
          ].map(([l,v,c,icon]) => `
            <div style="display:flex;align-items:center;gap:5px;cursor:pointer" onclick="obStatusFilter='${l==='Completed'?'':l}';navigateTo('ob-clients')" title="${l}: ${v}">
              <i class="fas ${icon}" style="color:${c};font-size:11px"></i>
              <span style="font-size:12px;font-weight:700;color:${c}">${v}</span>
              <span style="font-size:11px;color:#5a6b8a">${l}</span>
            </div>`).join('')}
          ${overdueTasks.length ? `
            <div style="display:flex;align-items:center;gap:5px;margin-left:auto">
              <i class="fas fa-clock" style="color:#ef4444;font-size:10px"></i>
              <span style="font-size:11px;color:#ef4444;font-weight:700">${overdueTasks.length} просрочено</span>
            </div>` : ''}
        </div>
      </div>

      <!-- Phase mini-chart -->
      ${active.length ? `
        <div style="font-size:10px;color:#5a6b8a;margin-bottom:6px;text-transform:uppercase;font-weight:700;letter-spacing:.5px">По фазам онбординга</div>
        <div style="display:flex;gap:3px;margin-bottom:12px;align-items:flex-end;height:36px">
          ${[0,1,2,3,4].map(i => {
            const maxCount = Math.max(...phaseCounts, 1);
            const h = Math.max(4, Math.round(phaseCounts[i] / maxCount * 32));
            return `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="${phaseLabels[i]}: ${phaseCounts[i]}">
                <span style="font-size:10px;font-weight:700;color:${phaseColors[i]}">${phaseCounts[i]||''}</span>
                <div style="width:100%;height:${h}px;background:${phaseCounts[i]>0?phaseColors[i]:'#1e293b'};border-radius:3px 3px 0 0;transition:height .3s"></div>
                <span style="font-size:9px;color:#4a5568">P${i+1}</span>
              </div>`;
          }).join('')}
        </div>` : ''}

      <!-- Client timeline rows -->
      ${active.length ? active.slice(0, 5).map(c => {
        const tasks   = obTasks.filter(t => t.clientId === c.id);
        const done    = tasks.filter(t => t.status === 'completed').length;
        const pct     = Math.round(done / 7 * 100);
        const daysLeft= Math.ceil((new Date(c.targetDate) - todayD) / 86400000);
        const sCfg    = {'On Track':{c:'#22c55e',bg:'rgba(34,197,94,0.12)'},'At Risk':{c:'#f97316',bg:'rgba(249,115,22,0.12)'},'Delayed':{c:'#ef4444',bg:'rgba(239,68,68,0.12)'}}[c.onboardingStatus]||{c:'#94a3b8',bg:'#1c2333'};
        return `
          <div onclick="navigateTo('ob-clients');setTimeout(()=>openObClientModal(${c.id}),300)"
            style="padding:8px 0;border-bottom:1px solid #1e293b;cursor:pointer"
            onmouseover="this.style.background='rgba(59,130,246,0.04)'" onmouseout="this.style.background=''">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
              <div style="width:22px;height:22px;border-radius:6px;background:${c.direction==='FM'?'rgba(59,130,246,0.15)':'rgba(139,92,246,0.15)'};
                display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;
                color:${c.direction==='FM'?'#3b82f6':'#8b5cf6'};flex-shrink:0">${c.name.slice(0,2).toUpperCase()}</div>
              <span style="flex:1;font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</span>
              <span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:4px;background:${sCfg.bg};color:${sCfg.c};flex-shrink:0">${c.onboardingStatus}</span>
              <span style="font-size:10px;color:${daysLeft<0?'#ef4444':daysLeft<3?'#f97316':'#5a6b8a'};flex-shrink:0;min-width:40px;text-align:right">
                ${daysLeft<0?`⚠${Math.abs(daysLeft)}д`:daysLeft===0?'Сегодня':`${daysLeft}д`}
              </span>
            </div>
            <!-- Mini task progress bar -->
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:4px;background:#1e293b;border-radius:2px">
                <div style="width:${pct}%;height:4px;background:${pct===100?'#22c55e':c.onboardingStatus==='Delayed'?'#ef4444':c.onboardingStatus==='At Risk'?'#f97316':'#3b82f6'};border-radius:2px;transition:width .3s"></div>
              </div>
              <span style="font-size:10px;color:#5a6b8a;flex-shrink:0">${done}/7</span>
            </div>
          </div>`;
      }).join('') : `
        <div style="text-align:center;padding:20px;color:#4a5568;font-size:12px">
          <i class="fas fa-check-circle" style="color:#22c55e;font-size:24px;display:block;margin-bottom:8px"></i>
          Все клиенты активированы
        </div>`}
    </div>`;
}

function renderDashboardCoiWidget() {
  const el = document.getElementById('dashCoiWidget');
  if (!el) return;
  const open = coiRegistry.filter(c => c.status !== 'Resolved');
  el.innerHTML = `
    <div style="padding:12px 16px">
      ${open.length ? open.map(r => {
        const sevCfg = {Low:{c:'#22c55e',bg:'rgba(34,197,94,0.12)'},Medium:{c:'#f97316',bg:'rgba(249,115,22,0.12)'},High:{c:'#ef4444',bg:'rgba(239,68,68,0.12)'},Critical:{c:'#dc2626',bg:'rgba(220,38,38,0.15)'}}[r.severity]||{};
        return `
          <div onclick="navigateTo('ob-restricted')" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1e293b;cursor:pointer">
            <div style="width:28px;height:28px;border-radius:8px;background:${sevCfg.bg||'#1c2333'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas fa-exclamation" style="color:${sevCfg.c||'#94a3b8'};font-size:12px"></i>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.parties}</div>
              <div style="font-size:10px;color:#5a6b8a">${r.coiId} · ${r.date}</div>
            </div>
            <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:${sevCfg.bg};color:${sevCfg.c};flex-shrink:0">${r.severity}</span>
          </div>`;
      }).join('') : `<div style="text-align:center;padding:24px;color:#4a5568;font-size:12px">
        <i class="fas fa-check-circle" style="color:#22c55e;font-size:20px;margin-bottom:6px;display:block"></i>
        Активных конфликтов нет
      </div>`}
    </div>`;
}

/* ── RM Workload Widget ──────────────────────────── */
function renderDashboardRmWidget() {
  const el = document.getElementById('dashRmWidget');
  if (!el) return;

  const todayD = new Date();
  const thisMonth = todayD.getMonth();
  const thisYear  = todayD.getFullYear();

  // Collect unique RMs from obClients
  const rmSet = [...new Set(obClients.map(c => c.rm))];

  const rmStats = rmSet.map(rm => {
    const clients      = obClients.filter(c => c.rm === rm);
    const activeClients= clients.filter(c => !c.activated);
    const myTasks      = obTasks.filter(t => {
      const c = obClients.find(x => x.id === t.clientId);
      return c && c.rm === rm;
    });
    const overdue = myTasks.filter(t =>
      t.status === 'open' && new Date(t.dueDate) < todayD
    );
    const completedThisMonth = myTasks.filter(t => {
      if (t.status !== 'completed' || !t.completedAt) return false;
      const d = new Date(t.completedAt);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const atRisk = activeClients.filter(c =>
      c.onboardingStatus === 'At Risk' || c.onboardingStatus === 'Delayed'
    );
    const load = activeClients.length > 4 ? 'High'
               : activeClients.length > 2 ? 'Medium' : 'Low';
    return { rm, activeClients, overdue, completedThisMonth, atRisk, load };
  });

  const loadCfg = {
    High:   { c:'#ef4444', bg:'rgba(239,68,68,0.12)',  icon:'fa-fire' },
    Medium: { c:'#f97316', bg:'rgba(249,115,22,0.12)', icon:'fa-balance-scale' },
    Low:    { c:'#22c55e', bg:'rgba(34,197,94,0.12)',  icon:'fa-leaf' },
  };

  el.innerHTML = `
    <div style="padding:14px 16px">
      <div style="font-size:10px;font-weight:700;color:#5a6b8a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
        Нагрузка по RM · ${todayD.toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}
      </div>
      ${rmStats.length ? rmStats.map(s => {
        const cfg  = loadCfg[s.load];
        const rmShort = s.rm.includes('(') ? s.rm.match(/\(([^)]+)\)/)?.[1] || s.rm : s.rm.split(' ')[0];
        const totalTasksActive = obTasks.filter(t => {
          const c = obClients.find(x => x.id === t.clientId);
          return c && c.rm === s.rm && t.status === 'open';
        }).length;
        return `
          <div style="background:#0f1623;border-radius:10px;padding:11px 13px;margin-bottom:8px;border:1px solid #2a3448;border-left:3px solid ${cfg.c}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="width:30px;height:30px;border-radius:8px;background:${cfg.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <i class="fas ${cfg.icon}" style="color:${cfg.c};font-size:12px"></i>
              </div>
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700;color:#e2e8f0">${rmShort}</div>
                <div style="font-size:10px;color:#5a6b8a">${s.rm}</div>
              </div>
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg};color:${cfg.c}">${s.load} load</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center">
              ${[
                ['Активных клиентов', s.activeClients.length, '#3b82f6'],
                ['Открытых задач',    totalTasksActive,       '#f97316'],
                ['Под риском',        s.atRisk.length,        s.atRisk.length>0?'#ef4444':'#22c55e'],
                ['Завершено (мес.)',   s.completedThisMonth.length, '#22c55e'],
              ].map(([l,v,c]) => `
                <div style="background:#1c2333;border-radius:6px;padding:6px 4px">
                  <div style="font-size:14px;font-weight:800;color:${c}">${v}</div>
                  <div style="font-size:9px;color:#5a6b8a;line-height:1.3">${l}</div>
                </div>`).join('')}
            </div>
            ${s.overdue.length ? `
              <div style="margin-top:8px;font-size:11px;color:#ef4444;display:flex;align-items:center;gap:5px">
                <i class="fas fa-exclamation-triangle" style="font-size:10px"></i>
                <span>${s.overdue.length} просроченных задач — требует внимания</span>
              </div>` : ''}
          </div>`;
      }).join('') : `
        <div style="text-align:center;padding:20px;color:#4a5568;font-size:12px">
          <i class="fas fa-users" style="font-size:20px;display:block;margin-bottom:6px;opacity:.4"></i>
          Нет активных RM
        </div>`}
    </div>`;
}

/* ═══════════════════════════════════════════════════
   CHINESE WALL — Item 10
   Role-based direction restriction (FM vs CF&A).
   Called before any form submission or deep access.
═══════════════════════════════════════════════════ */

/**
 * Returns { allowed: bool, reason: string }
 * Rule: any role without the `accessFM` permission can only work with
 * CF&A-direction clients (FM LP onboarding uses the legacy LP page, not
 * these TZ tasks). Which roles have accessFM is now configurable via the
 * Roles admin UI (js/users.js) — not a hardcoded role list.
 */
function chineseWallCheck(client) {
  if (!client) return { allowed: false, reason: 'Клиент не найден' };

  // Server enforces the same rule on GET/PUT /api/onboarding etc.
  // (server/chineseWall.js); this is just the client-side fast-fail so the
  // UI doesn't render blocked content.
  if (client.direction === 'FM' && !currentUserPermission('accessFM')) {
    return {
      allowed: false,
      reason: `Ваша роль (${roleLabel(currentUserRole())}) не имеет доступа к направлению FM. ` +
              `Доступ к клиентам направления FM ограничен Китайской стеной. ` +
              `(Регуляторное требование: информационная изоляция FM и CF&A)`
    };
  }

  return { allowed: true, reason: '' };
}

/**
 * Renders a Chinese Wall warning banner inside the task form or client modal.
 * Returns HTML string (empty string if access is allowed).
 */
function renderChineseWallBanner(client) {
  const check = chineseWallCheck(client);
  if (check.allowed) return '';
  return `
    <div style="background:rgba(239,68,68,0.10);border:2px solid rgba(239,68,68,0.35);border-radius:10px;
      padding:14px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
      <div style="width:36px;height:36px;background:rgba(239,68,68,0.15);border-radius:10px;
        display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas fa-shield-alt" style="color:#ef4444;font-size:16px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:#ef4444;margin-bottom:4px">
          🧱 Китайская стена — Доступ ограничен
        </div>
        <div style="font-size:12px;color:#fca5a5;line-height:1.5">${check.reason}</div>
      </div>
    </div>`;
}

/**
 * Checks wall before submitting a task.
 * Returns false if the wall blocks submission, and shows a toast.
 */
function checkWallBeforeSubmit(client) {
  const check = chineseWallCheck(client);
  if (!check.allowed) {
    showToast('🧱 Китайская стена: ' + check.reason.slice(0, 90) + '…', 'red');
    return false;
  }
  return true;
}
