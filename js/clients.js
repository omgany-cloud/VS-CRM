// ============================================================
//  clients.js — CF&A Client Management Module
//  Corporate Finance & Advisory — Golden Leaves Ltd
//  Covers: client onboarding, pipeline, KYC status, services
// ============================================================

/* ── CF&A Client Data ── */
let cfaClients = [
  {
    id: 1,
    name: 'Meridian Steel Kazakhstan JSC',
    type: 'Юридическое лицо',
    category: 'Corporate',
    country: 'Казахстан',
    industry: 'Металлургия',
    stage: 'Active',
    rmOwner: 'RM (Relationship Manager)',
    services: ['M&A Advisory', 'Debt Structuring'],
    revenue: 2.5,           // $M project fee
    engagementDate: '2025-09-01',
    kycStatus: 'Одобрен',
    amlStatus: 'Пройден',
    pepStatus: 'Нет',
    qualified: true,
    contact: { name: 'Жаксыбеков А.С.', title: 'CFO', email: 'zha@meridian.kz', phone: '+7 717 300 1000' },
    ubo: [{ name: 'Иванов И.И.', share: 55 }],
    description: 'Ведущий производитель стальных конструкций Казахстана. Проект — M&A сопровождение поглощения регионального конкурента.',
    documents: ['Articles of Association', 'UBO Declaration', 'Audited Financials 2024', 'Source of Funds'],
    notes: 'Приоритетный клиент. Проект на финальной стадии.',
    created: '2025-09-01',
    pipeline: [
      { stage: 'Lead', date: '2025-07-10', done: true },
      { stage: 'Qualified', date: '2025-08-01', done: true },
      { stage: 'Proposal', date: '2025-09-01', done: true },
      { stage: 'AML Review', date: '2025-09-15', done: true },
      { stage: 'Active', date: '2025-10-01', done: true },
    ],
    tasks: [2]
  },
  {
    id: 2,
    name: 'Steppe Renewables LLP',
    type: 'Юридическое лицо',
    category: 'SME',
    country: 'Казахстан',
    industry: 'Возобновляемая энергетика',
    stage: 'Proposal',
    rmOwner: 'RM (Relationship Manager)',
    services: ['Capital Raising', 'Project Finance'],
    revenue: 1.2,
    engagementDate: '2026-02-15',
    kycStatus: 'На проверке',
    amlStatus: 'В процессе',
    pepStatus: 'Нет',
    qualified: true,
    contact: { name: 'Нурмагамбетова Г.', title: 'CEO', email: 'g.nur@steppe.kz', phone: '+7 701 505 7070' },
    ubo: [{ name: 'Нурмагамбетова Г.', share: 60 }, { name: 'Иностранный партнёр', share: 40 }],
    description: 'Разработчик ветропарков в Акмолинской области. Ищет $20M проектного финансирования.',
    documents: ['Registration Certificate', 'Business Plan', 'Feasibility Study'],
    notes: 'UBO по иностранному партнёру требует дополнительных документов.',
    created: '2026-02-15',
    pipeline: [
      { stage: 'Lead', date: '2025-12-01', done: true },
      { stage: 'Qualified', date: '2026-01-15', done: true },
      { stage: 'Proposal', date: '2026-02-15', done: true },
      { stage: 'AML Review', date: null, done: false },
      { stage: 'Active', date: null, done: false },
    ],
    tasks: []
  },
  {
    id: 3,
    name: 'NovaTech Holdings (BVI) Ltd',
    type: 'Юридическое лицо',
    category: 'International',
    country: 'Британские Виргинские острова',
    industry: 'Технологии',
    stage: 'AML Review',
    rmOwner: 'CO (Compliance Officer)',
    services: ['Structuring', 'AIFC Registration'],
    revenue: 0.8,
    engagementDate: '2026-04-10',
    kycStatus: 'На подписи',
    amlStatus: 'Enhanced DD',
    pepStatus: 'Требует проверки',
    qualified: false,
    contact: { name: 'Smith J.', title: 'Director', email: 'j.smith@novatech.io', phone: '+44 20 7000 0001' },
    ubo: [{ name: 'Неизвестен', share: 100 }],
    description: 'Офшорная холдинговая структура. Планирует выход на рынок Казахстана через AIFC.',
    documents: ['Certificate of Incorporation', 'Register of Directors'],
    notes: '⚠️ Enhanced Due Diligence. Требуется одобрение MLRO.',
    created: '2026-04-10',
    pipeline: [
      { stage: 'Lead', date: '2026-03-01', done: true },
      { stage: 'Qualified', date: '2026-03-20', done: true },
      { stage: 'Proposal', date: '2026-04-10', done: true },
      { stage: 'AML Review', date: '2026-04-20', done: false },
      { stage: 'Active', date: null, done: false },
    ],
    tasks: [3]
  },
  {
    id: 4,
    name: 'Almaty Tech Ventures',
    type: 'ИП',
    category: 'SME',
    country: 'Казахстан',
    industry: 'Финтех',
    stage: 'Qualified',
    rmOwner: 'RM (Relationship Manager)',
    services: ['IPO Advisory', 'Valuation'],
    revenue: 0.5,
    engagementDate: '2026-05-20',
    kycStatus: 'Новый',
    amlStatus: 'Ожидание',
    pepStatus: 'Нет',
    qualified: true,
    contact: { name: 'Сейтжанов К.', title: 'Founder', email: 'k.seit@atv.kz', phone: '+7 727 400 5000' },
    ubo: [{ name: 'Сейтжанов К.', share: 100 }],
    description: 'Стартап в сфере платёжных решений. Планирует Pre-IPO раунд на $5M.',
    documents: [],
    notes: 'Новый клиент. Первичная встреча прошла успешно.',
    created: '2026-05-20',
    pipeline: [
      { stage: 'Lead', date: '2026-05-01', done: true },
      { stage: 'Qualified', date: '2026-05-20', done: true },
      { stage: 'Proposal', date: null, done: false },
      { stage: 'AML Review', date: null, done: false },
      { stage: 'Active', date: null, done: false },
    ],
    tasks: []
  },
];

let cfaClientIdCounter = 5;
let cfaFilter  = { stage: '', category: '', industry: '', search: '' };
let cfaView    = 'cards'; // 'cards' | 'list'
let cfaActiveId = null;

// Хранилище загруженных файлов: { 'clientId_docName': { name, size, type, dataUrl } }
const cfaDocFiles = {};

/* ─────────────────────────────────────────────
   UNIFIED DATA BRIDGE
   Возвращает объединённый список CF&A клиентов:
   - старые cfaClients[] (с меткой _source='legacy')
   - новые obClients[] с direction==='CF&A' (с меткой _source='ob')
   Все клиенты приводятся к единому формату карточки.
───────────────────────────────────────────── */

/**
 * Маппинг obClient (CF&A only!) → формат cfaClient для единого рендеринга.
 * Вызывается ТОЛЬКО для клиентов с direction === 'CF&A'.
 * CF&A услуги: Advising (инвест. консультирование) | Arranging (организация сделок) | Both
 */
function obClientToCfa(c) {
  // Определяем stage из фазы / статуса онбординга
  const phaseToStage = {
    1: 'Lead',
    2: 'AML Review',
    3: 'AML Review',  // Classification + Suitability
    4: 'Proposal',    // Engagement Letter
    5: 'Active',      // Активирован
  };
  const stage = c.activated ? 'Active' : (phaseToStage[c.phase] || 'Lead');

  // CF&A services: Advising → инвест. консультирование; Arranging → организация сделок/привлечение
  const serviceMap = {
    'Advising':  ['Investment Advisory'],
    'Arranging': ['Capital Raising / Arranging'],
    'Both':      ['Investment Advisory', 'Capital Raising / Arranging'],
  };

  return {
    id:             c.id,
    _source:        'ob',           // маркер: карточка из onboarding.js
    _obId:          c.id,
    name:           c.name,
    type:           c.type === 'Individual' ? 'Физическое лицо' : 'Юридическое лицо',
    category:       c.type === 'Corporate' ? 'Corporate' : 'Individual',
    country:        '—',
    industry:       '—',
    stage,
    rmOwner:        c.rm,
    services:       serviceMap[c.serviceType] || [c.serviceType || 'CF&A Service'],
    revenue:        0,
    engagementDate: c.startDate,
    kycStatus:      c.riskRating === 'High' ? 'Enhanced DD' : (c.activated ? 'Одобрен' : 'На проверке'),
    amlStatus:      c.activated ? 'Пройден' : 'В процессе',
    pepStatus:      'Нет',
    qualified:      c.phase >= 3,
    contact:        { name: c.rm.split('(')[0].trim(), title: 'RM', email: '', phone: '' },
    ubo:            [],
    description:    c.notes || '',
    documents:      [],
    notes:          `[CF&A Онбординг] Phase ${c.phase} · ${c.onboardingStatus}` +
                    ` · ${c.serviceType}` + (c.restrictedMatch ? ' ⚠ Restricted' : ''),
    created:        c.startDate,
    pipeline:       [],
    tasks:          [],
    // Дополнительные поля
    onboardingPhase:   c.phase,
    onboardingStatus:  c.onboardingStatus,
    clientId:          c.clientId,
    classification:    c.classification,
    direction:         c.direction,
    serviceType:       c.serviceType,
  };
}

/**
 * Получить полный объединённый список CF&A клиентов.
 * obClients с direction==='CF&A' идут первыми, затем legacy cfaClients.
 * Исключаем дублирование по имени (если legacy клиент уже есть в ob).
 */
function getUnifiedCFAClients() {
  const obCfa = (typeof obClients !== 'undefined')
    ? obClients.filter(c => c.direction === 'CF&A').map(obClientToCfa)
    : [];

  // Имена obClients (lowercase) чтобы исключить дубли из legacy
  const obNames = new Set(obCfa.map(c => c.name.toLowerCase().trim()));

  const legacyCfa = cfaClients
    .filter(c => !obNames.has(c.name.toLowerCase().trim()))
    .map(c => ({ ...c, _source: 'legacy' }));

  return [...obCfa, ...legacyCfa];
}

const CFA_STAGES = [
  { key: 'Lead',       label: 'Lead',        color: 'var(--text-muted)',    bg: 'rgba(100,116,139,0.12)' },
  { key: 'Qualified',  label: 'Qualified',   color: 'var(--accent-blue)',   bg: 'rgba(59,130,246,0.12)' },
  { key: 'Proposal',   label: 'Proposal',    color: 'var(--accent-orange)', bg: 'rgba(249,115,22,0.12)' },
  { key: 'AML Review', label: 'AML Review',  color: 'var(--accent-purple)', bg: 'rgba(139,92,246,0.12)' },
  { key: 'Active',     label: 'Active',      color: 'var(--accent-green)',  bg: 'rgba(34,197,94,0.12)'  },
];

const CFA_SERVICES = [
  'M&A Advisory', 'Capital Raising', 'Debt Structuring', 'Project Finance',
  'IPO Advisory', 'Valuation', 'Structuring', 'AIFC Registration',
  'Due Diligence', 'Corporate Governance', 'ESG Advisory'
];

const CFA_INDUSTRIES = [
  'Технологии', 'Финтех', 'Металлургия', 'Возобновляемая энергетика',
  'Нефть и газ', 'Недвижимость', 'Агросектор', 'Банки и финансы',
  'Ритейл', 'Здравоохранение', 'Прочее'
];

/* ─────────────────────────────────────────────
   RENDER CF&A PAGE
───────────────────────────────────────────── */
function renderCFAPage() {
  renderCFAKPIs();
  renderCFAPipeline();
  if (cfaView === 'cards') renderCFACards();
  else renderCFAList();
}

function renderCFAKPIs() {
  const all      = getUnifiedCFAClients();
  const total    = all.length;
  const active   = all.filter(c => c.stage === 'Active').length;
  const amlRev   = all.filter(c => c.stage === 'AML Review').length;
  const totalRev = cfaClients.reduce((s,c) => s + (c.revenue||0), 0); // только legacy имеют revenue
  const kycPend  = all.filter(c => c.kycStatus !== 'Одобрен').length;
  const obCount  = (typeof obClients !== 'undefined') ? obClients.filter(c => c.direction === 'CF&A').length : 0;

  const el = document.getElementById('cfaKPIs');
  if (!el) return;
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon blue"><i class="fas fa-building"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Клиентов CF&A</span>
        <span class="kpi-value">${total}</span>
        <span class="kpi-delta up">${active} активных · ${obCount} в онбординге</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon green"><i class="fas fa-dollar-sign"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Выручка (проекты)</span>
        <span class="kpi-value">$${totalRev.toFixed(1)}M</span>
        <span class="kpi-delta up">Advisory fees</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon purple"><i class="fas fa-shield-alt"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">AML Review</span>
        <span class="kpi-value" style="color:${amlRev>0?'var(--accent-orange)':'var(--accent-green)'}">${amlRev}</span>
        <span class="kpi-delta ${amlRev>0?'':'up'}">${amlRev>0?'Ожидают проверки':'Все проверены'}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon orange"><i class="fas fa-file-alt"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">KYC Ожидает</span>
        <span class="kpi-value" style="color:${kycPend>0?'var(--accent-orange)':'var(--accent-green)'}">${kycPend}</span>
        <span class="kpi-delta">${kycPend} клиентов</span>
      </div>
    </div>`;
}

function renderCFAPipeline() {
  const el = document.getElementById('cfaPipelineBar');
  if (!el) return;
  const all = getUnifiedCFAClients();
  el.innerHTML = CFA_STAGES.map(s => {
    const count = all.filter(c => c.stage === s.key).length;
    return `
      <div class="cfa-pipe-stage" onclick="filterCFA('stage','${s.key}')" title="Фильтр: ${s.label}">
        <div class="cfa-pipe-count" style="color:${s.color};background:${s.bg}">${count}</div>
        <div class="cfa-pipe-label" style="color:${s.color}">${s.label}</div>
        <div class="cfa-pipe-bar" style="background:${s.color};opacity:0.7;height:3px;border-radius:2px;width:${count>0?Math.min(count*30,100)+'px':'20px'}"></div>
      </div>
      ${s.key !== 'Active' ? '<i class="fas fa-arrow-right cfa-pipe-arrow"></i>' : ''}`;
  }).join('');
}

/* ── Cards View ── */
function renderCFACards() {
  const grid = document.getElementById('cfaCardsGrid');
  if (!grid) return;
  const listEl = document.getElementById('cfaListView');
  if (listEl) listEl.style.display = 'none';
  grid.style.display = 'grid';

  const items = getFilteredCFA();
  grid.innerHTML = items.length ? items.map(renderCFACard).join('') :
    `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">
      <i class="fas fa-building" style="font-size:40px;opacity:.3;display:block;margin-bottom:12px"></i>
      Нет клиентов по выбранным фильтрам
    </div>`;
}

function renderCFACard(c) {
  const stage = CFA_STAGES.find(s => s.key === c.stage) || CFA_STAGES[0];
  const kycColor = c.kycStatus === 'Одобрен' ? 'var(--accent-green)' : c.kycStatus === 'На проверке' ? 'var(--accent-orange)' : 'var(--text-muted)';
  const amlColor = c.amlStatus === 'Пройден' ? 'var(--accent-green)' : c.amlStatus === 'Enhanced DD' ? 'var(--accent-red)' : 'var(--accent-orange)';
  const isOb     = c._source === 'ob';
  const clickFn  = isOb ? `navigateTo('ob-clients');setTimeout(()=>openObClientModal(${c._obId}),200)` : `openCFAModal(${c.id})`;

  return `
    <div class="cfa-client-card" onclick="${clickFn}" style="position:relative">
      ${isOb ? `<div style="position:absolute;top:10px;right:10px;font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3)">
        Phase ${c.onboardingPhase} · TZ
      </div>` : ''}
      <div class="cfa-card-top">
        <div class="cfa-card-avatar">${c.name.slice(0,2).toUpperCase()}</div>
        <div class="cfa-card-info">
          <div class="cfa-card-name">${c.name}</div>
          <div class="cfa-card-sub">${isOb ? (c.classification + ' · ' + c.serviceType) : (c.industry + ' · ' + c.country)}</div>
        </div>
        <span class="task-status-pill" style="background:${stage.bg};color:${stage.color};white-space:nowrap">${stage.label}</span>
      </div>
      <div class="cfa-card-services">
        ${(c.services||[]).map(s => `<span class="cfa-service-tag">${s}</span>`).join('')}
      </div>
      <div class="cfa-card-metrics">
        <div class="cfa-metric">
          ${isOb
            ? `<span class="cfa-metric-val" style="font-size:10px;color:#f97316">${c.onboardingStatus||'—'}</span><span class="cfa-metric-label">Status</span>`
            : `<span class="cfa-metric-val">$${c.revenue}M</span><span class="cfa-metric-label">Fee</span>`
          }
        </div>
        <div class="cfa-metric">
          <span class="cfa-metric-val" style="color:${kycColor};font-size:11px">${c.kycStatus}</span>
          <span class="cfa-metric-label">KYC</span>
        </div>
        <div class="cfa-metric">
          <span class="cfa-metric-val" style="color:${amlColor};font-size:11px">${c.amlStatus}</span>
          <span class="cfa-metric-label">AML</span>
        </div>
      </div>
      <div class="cfa-card-footer">
        <div style="font-size:11px;color:var(--text-muted)">${(c.rmOwner||'').split(' ')[0]} · ${isOb ? (c.clientId||'') : (c.contact?.name||'')}</div>
        <div style="font-size:11px;color:var(--text-muted)">${isOb ? `<i class="fas fa-tasks"></i> TZ` : `${(c.documents||[]).length} <i class="fas fa-file"></i>`}</div>
      </div>
    </div>`;
}

/* ── List View ── */
function renderCFAList() {
  const grid = document.getElementById('cfaCardsGrid');
  if (grid) grid.style.display = 'none';
  const listEl = document.getElementById('cfaListView');
  if (!listEl) return;
  listEl.style.display = 'block';

  const items = getFilteredCFA();
  listEl.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Клиент</th><th>Тип</th><th>Индустрия/Направление</th><th>Услуги</th>
            <th>Стадия</th><th>KYC</th><th>AML</th><th>Fee/Phase</th><th>RM</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(c => {
            const stage = CFA_STAGES.find(s => s.key === c.stage) || CFA_STAGES[0];
            const kycColor = c.kycStatus==='Одобрен'?'var(--accent-green)':c.kycStatus==='На проверке'?'var(--accent-orange)':'var(--text-muted)';
            const isOb = c._source === 'ob';
            const clickFn = isOb
              ? `navigateTo('ob-clients');setTimeout(()=>openObClientModal(${c._obId}),200)`
              : `openCFAModal(${c.id})`;
            return `
              <tr style="cursor:pointer" onclick="${clickFn}">
                <td>
                  <div style="font-weight:700;color:var(--text-primary)">${c.name}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${isOb ? c.clientId : c.country}
                    ${isOb ? '<span style="font-size:9px;margin-left:4px;background:rgba(59,130,246,0.12);color:#3b82f6;padding:1px 5px;border-radius:10px">TZ</span>' : ''}
                  </div>
                </td>
                <td style="font-size:12px">${c.type}</td>
                <td style="font-size:12px">${isOb ? (c.direction + ' · ' + c.classification) : c.industry}</td>
                <td style="font-size:11px;color:var(--text-muted)">${(c.services||[]).join(', ')}</td>
                <td><span class="task-status-pill" style="background:${stage.bg};color:${stage.color}">${stage.label}</span></td>
                <td style="color:${kycColor};font-size:12px;font-weight:700">${c.kycStatus}</td>
                <td style="font-size:12px">${c.amlStatus}</td>
                <td style="font-weight:700;color:${isOb?'#f97316':'var(--accent-green)'}">
                  ${isOb ? `Phase ${c.onboardingPhase}` : `$${c.revenue}M`}
                </td>
                <td style="font-size:11px;color:var(--text-muted)">${(c.rmOwner||'').split(' ')[0]}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function getFilteredCFA() {
  const all = getUnifiedCFAClients();
  return all.filter(c => {
    if (cfaFilter.stage    && c.stage    !== cfaFilter.stage)    return false;
    if (cfaFilter.category && c.category !== cfaFilter.category) return false;
    if (cfaFilter.industry && c.industry !== cfaFilter.industry) return false;
    if (cfaFilter.search) {
      const q = cfaFilter.search.toLowerCase();
      if (!c.name.toLowerCase().includes(q) &&
          !(c.industry||'').toLowerCase().includes(q) &&
          !(c.clientId||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function filterCFA(key, val) {
  cfaFilter[key] = cfaFilter[key] === val ? '' : val; // toggle
  renderCFAPage();
}

function setCFAView(view) {
  cfaView = view;
  document.querySelectorAll('.cfa-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'cards') renderCFACards();
  else renderCFAList();
}

/* ── Client Detail Modal ── */
function openCFAModal(id) {
  const c = cfaClients.find(x => x.id === id);
  if (!c) return;
  cfaActiveId = id;
  const modal   = document.getElementById('modal-cfa');
  const overlay = document.getElementById('cfaModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const stage = CFA_STAGES.find(s => s.key === c.stage) || CFA_STAGES[0];
  const kycColor = c.kycStatus==='Одобрен'?'var(--accent-green)':c.kycStatus==='На проверке'?'var(--accent-orange)':'var(--accent-red)';
  const amlColor = c.amlStatus==='Пройден'?'var(--accent-green)':c.amlStatus==='Enhanced DD'?'var(--accent-red)':'var(--accent-orange)';

  // Pipeline steps
  const pipelineHtml = `
    <div class="cfa-modal-pipeline">
      ${c.pipeline.map((p,i) => `
        <div class="cmp-step ${p.done?'done':'pending'}">
          <div class="cmp-dot"><i class="fas ${p.done?'fa-check':'fa-circle'}"></i></div>
          <div class="cmp-label">${p.stage}</div>
          ${p.date ? `<div class="cmp-date">${new Date(p.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'})}</div>` : '<div class="cmp-date">—</div>'}
        </div>
        ${i < c.pipeline.length-1 ? '<div class="cmp-connector '+(p.done?'done':'')+'"></div>' : ''}`).join('')}
    </div>`;

  // KYC Document checklist
  const kycDocs = c.type === 'Физическое лицо'
    ? ['Паспорт/удостоверение личности','Подтверждение адреса','Источник средств','ИИН/ИНН','PEP-декларация','AML скрининг']
    : ['Свидетельство о регистрации','Устав','Список директоров','Список акционеров / UBO','Финансовая отчётность','Источник средств','AML скрининг','PEP-декларация директоров'];

  const docChecklistHtml = kycDocs.map(d => {
    const fileKey = c.id + '_' + d;
    const fileObj = cfaDocFiles[fileKey];
    const has = !!fileObj;
    const safeDocName = d.replace(/'/g, "\\'");
    return `
      <div class="kyc-check-item ${has?'ok':'missing'}" id="kyc-row-${c.id}-${d.replace(/[^a-zа-яё0-9]/gi,'_')}">
        <i class="fas ${has?'fa-check-circle':'fa-times-circle'}"></i>
        <span style="flex:1;font-size:12px">${d}</span>
        ${has ? `
          <span style="font-size:10px;color:var(--text-muted);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${fileObj.name}">
            <i class="fas fa-file" style="color:var(--accent-green)"></i> ${fileObj.name}
          </span>
          <button onclick="previewCFADoc('${fileKey}')" style="background:none;border:1px solid var(--accent-blue);color:var(--accent-blue);border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;flex-shrink:0;margin-left:4px">
            <i class="fas fa-eye"></i>
          </button>
          <button onclick="removeCFADoc(${c.id},'${safeDocName}')" style="background:none;border:1px solid var(--accent-red);color:var(--accent-red);border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;flex-shrink:0;margin-left:2px">
            <i class="fas fa-times"></i>
          </button>
        ` : `
          <label style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;font-size:11px;font-weight:600;
            background:rgba(59,130,246,0.12);color:var(--accent-blue);border:1px solid var(--accent-blue);
            border-radius:5px;cursor:pointer;flex-shrink:0;margin-left:auto" title="Выбрать файл с компьютера">
            <i class="fas fa-upload"></i> Загрузить
            <input type="file" style="display:none" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip"
              onchange="handleCFADocUpload(event,${c.id},'${safeDocName}')" />
          </label>
        `}
      </div>`;
  }).join('');

  document.getElementById('cfaModalContent').innerHTML = `
    <div class="cfa-modal-header">
      <div class="cfa-card-avatar" style="width:52px;height:52px;font-size:18px;border-radius:14px">${c.name.slice(0,2).toUpperCase()}</div>
      <div style="flex:1">
        <h2 style="font-size:17px;font-weight:800;color:var(--text-primary);margin:0 0 4px">${c.name}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span style="font-size:12px;color:var(--text-muted)">${c.type} · ${c.industry} · ${c.country}</span>
          <span class="task-status-pill" style="background:${stage.bg};color:${stage.color}">${stage.label}</span>
          ${!c.qualified ? '<span class="badge badge-red" style="font-size:11px">Не квалифицирован</span>' : ''}
        </div>
      </div>
    </div>

    <!-- Pipeline Progress -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title"><i class="fas fa-route" style="color:var(--accent-blue);margin-right:6px"></i>Онбординг Pipeline</span></div>
      ${pipelineHtml}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${CFA_STAGES.map(s => `
          <button class="task-status-btn ${c.stage===s.key?'active':''}"
            style="background:${c.stage===s.key?s.bg:'none'};color:${c.stage===s.key?s.color:'var(--text-muted)'};border-color:${c.stage===s.key?s.color:'var(--border)'}"
            onclick="moveCFAStage(${c.id},'${s.key}')">
            ${s.label}
          </button>`).join('')}
      </div>
    </div>

    <!-- Two columns: info + KYC -->
    <div class="two-col" style="margin-bottom:16px">
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-info-circle" style="color:var(--accent-blue);margin-right:6px"></i>Основная информация</span></div>
        <div class="task-modal-meta">
          <div class="task-meta-row"><span class="task-meta-label">RM</span><span>${c.rmOwner}</span></div>
          <div class="task-meta-row"><span class="task-meta-label">Контакт</span><span>${c.contact.name}, ${c.contact.title}</span></div>
          <div class="task-meta-row"><span class="task-meta-label">Email</span><a href="mailto:${c.contact.email}" style="color:var(--accent-blue)">${c.contact.email}</a></div>
          <div class="task-meta-row"><span class="task-meta-label">Телефон</span><span>${c.contact.phone}</span></div>
          <div class="task-meta-row"><span class="task-meta-label">Услуги</span><span>${c.services.join(', ')}</span></div>
          <div class="task-meta-row"><span class="task-meta-label">Гонорар</span><span style="color:var(--accent-green);font-weight:700">$${c.revenue}M</span></div>
          <div class="task-meta-row"><span class="task-meta-label">С клиентом с</span><span>${c.engagementDate ? new Date(c.engagementDate).toLocaleDateString('ru-RU') : '—'}</span></div>
        </div>
        ${c.notes ? `<div class="task-desc" style="margin-top:10px">${c.notes}</div>` : ''}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-shield-alt" style="color:var(--accent-purple);margin-right:6px"></i>KYC / AML Статус</span>
        </div>
        <div class="task-modal-meta" style="margin-bottom:12px">
          <div class="task-meta-row">
            <span class="task-meta-label">KYC</span>
            <span style="color:${kycColor};font-weight:700">${c.kycStatus}</span>
          </div>
          <div class="task-meta-row">
            <span class="task-meta-label">AML</span>
            <span style="color:${amlColor};font-weight:700">${c.amlStatus}</span>
          </div>
          <div class="task-meta-row">
            <span class="task-meta-label">PEP</span>
            <span style="color:${c.pepStatus!=='Нет'?'var(--accent-red)':'var(--accent-green)'};font-weight:700">${c.pepStatus}</span>
          </div>
          ${c.ubo.length ? `<div class="task-meta-row"><span class="task-meta-label">UBO</span>
            <span>${c.ubo.map(u=>`${u.name} (${u.share}%)`).join(', ')}</span>
          </div>` : ''}
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px">Чеклист документов:</div>
        ${docChecklistHtml}
      </div>
    </div>

    <div class="task-modal-footer">
      <button class="btn-ghost" style="border-color:#ef4444;color:#ef4444" onclick="deleteCFAClient(${c.id})"><i class="fas fa-trash"></i> Удалить</button>
      <button class="btn-ghost" onclick="openEditCFAModal(${c.id})"><i class="fas fa-edit"></i> Редактировать</button>
      <button class="btn-ghost" onclick="createTaskForClient('${c.name}')"><i class="fas fa-tasks"></i> Создать задачу</button>
      <button class="btn-ghost" style="border-color:#8b5cf6;color:#a78bfa" onclick="closeCFAModal();navigateTo('vault')"><i class="fas fa-database"></i> Хранилище файлов</button>
      <button class="btn-primary" onclick="closeCFAModal()">Закрыть</button>
    </div>`;

  modal.style.display = 'flex';
}

function deleteCFAClient(id) {
  const c = cfaClients.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Удалить клиента "${c.name}"?\n\nЭто действие нельзя отменить.`)) return;
  // Удаляем файлы документов клиента из хранилища
  Object.keys(cfaDocFiles).forEach(key => {
    if (key.startsWith(id + '_')) delete cfaDocFiles[key];
  });
  cfaClients = cfaClients.filter(x => x.id !== id);
  closeCFAModal();
  renderCFAPage();
  showToast('🗑 Клиент удалён: ' + c.name, 'red');
}

function moveCFAStage(id, stage) {
  const c = cfaClients.find(x => x.id === id);
  if (!c) return;
  c.stage = stage;
  const p = c.pipeline.find(p => p.stage === stage);
  if (p && !p.done) { p.done = true; p.date = new Date().toISOString().split('T')[0]; }
  openCFAModal(id);
  renderCFAPage();
  showToast('Стадия обновлена: ' + stage, 'blue');
}

/* ── Загрузка файла с компьютера ── */
function handleCFADocUpload(event, clientId, docName) {
  const file = event.target.files[0];
  if (!file) return;

  // Ограничение размера — 20 МБ
  if (file.size > 20 * 1024 * 1024) {
    showToast('Файл слишком большой (макс. 20 МБ)', 'red');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const fileKey = clientId + '_' + docName;
    cfaDocFiles[fileKey] = {
      name:       file.name,
      size:       file.size,
      type:       file.type,
      dataUrl:    e.target.result,
      uploadedAt: new Date().toISOString().slice(0,10),
    };
    // Обновить массив documents клиента
    const c = cfaClients.find(x => x.id === clientId);
    if (c && !c.documents.includes(docName)) c.documents.push(docName);

    openCFAModal(clientId); // перерисовать карточку
    showToast('📎 Загружен: ' + file.name, 'green');
  };
  reader.readAsDataURL(file);
}

function previewCFADoc(fileKey) {
  const f = cfaDocFiles[fileKey];
  if (!f) return;
  // Открыть файл в новой вкладке
  const w = window.open();
  if (f.type && f.type.startsWith('image/')) {
    w.document.write(`<html><body style="margin:0;background:#111">
      <img src="${f.dataUrl}" style="max-width:100%;display:block;margin:auto" />
    </body></html>`);
  } else if (f.type === 'application/pdf') {
    w.document.write(`<html><body style="margin:0;height:100vh">
      <embed src="${f.dataUrl}" type="application/pdf" width="100%" height="100%" />
    </body></html>`);
  } else {
    // Для doc/xls/zip — скачать
    const a = w.document.createElement('a');
    a.href = f.dataUrl;
    a.download = f.name;
    w.document.body.appendChild(a);
    a.click();
    w.close();
  }
}

function removeCFADoc(clientId, docName) {
  if (!confirm(`Удалить документ "${docName}"?`)) return;
  const fileKey = clientId + '_' + docName;
  delete cfaDocFiles[fileKey];
  const c = cfaClients.find(x => x.id === clientId);
  if (c) c.documents = c.documents.filter(d => d !== docName);
  openCFAModal(clientId);
  showToast('Документ удалён', 'red');
}

function markCFADocReceived(id, docName) {
  // Оставляем для обратной совместимости — теперь не используется
  openCFAModal(id);
}

function createTaskForClient(clientName) {
  closeCFAModal();
  navigateTo('tasks');
  setTimeout(() => {
    openTaskModal(null);
    setTimeout(() => {
      const el = document.getElementById('tf_client');
      if (el) el.value = clientName;
    }, 50);
  }, 100);
}

function closeCFAModal() {
  const m       = document.getElementById('modal-cfa');
  const overlay = document.getElementById('cfaModalOverlay');
  if (m)       m.style.display       = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  cfaActiveId = null;
}

function openAddCFAModal() {
  cfaActiveId = null;
  const modal   = document.getElementById('modal-cfa');
  const overlay = document.getElementById('cfaModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  document.getElementById('cfaModalContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <div class="kpi-icon blue" style="width:40px;height:40px;font-size:16px"><i class="fas fa-building"></i></div>
      <h2 style="font-size:16px;font-weight:800;color:var(--text-primary)">Новый CF&A клиент</h2>
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Название компании / ФИО *</label>
        <input id="cf_name" type="text" placeholder="Полное наименование" />
      </div>
      <div class="form-group">
        <label>Тип клиента</label>
        <select id="cf_type">
          <option>Юридическое лицо</option>
          <option>Физическое лицо</option>
          <option>ИП</option>
        </select>
      </div>
      <div class="form-group">
        <label>Индустрия</label>
        <select id="cf_industry">
          ${CFA_INDUSTRIES.map(i => `<option>${i}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Страна</label>
        <input id="cf_country" type="text" value="Казахстан" />
      </div>
      <div class="form-group">
        <label>Услуги</label>
        <select id="cf_service">
          ${CFA_SERVICES.map(s => `<option>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>RM / Ответственный</label>
        <select id="cf_rm">
          ${['RM (Relationship Manager)','CO (Compliance Officer)','CEO','Analyst'].map(r => `<option>${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Гонорар ($M)</label>
        <input id="cf_rev" type="number" step="0.1" placeholder="0.0" />
      </div>
      <div class="form-group">
        <label>Контактное лицо</label>
        <input id="cf_contact" type="text" placeholder="ФИО контакта" />
      </div>
      <div class="form-group">
        <label>Email контакта</label>
        <input id="cf_email" type="email" placeholder="email@company.com" />
      </div>
      <div class="form-group full">
        <label>Описание / Заметки</label>
        <textarea id="cf_notes" rows="2" placeholder="Кратко о клиенте и проекте..."></textarea>
      </div>
    </div>
    <div class="task-modal-footer">
      <button class="btn-ghost" onclick="closeCFAModal()">Отмена</button>
      <button class="btn-primary" onclick="saveNewCFAClient()"><i class="fas fa-check"></i> Добавить клиента</button>
    </div>`;
  modal.style.display = 'flex';
}

function openEditCFAModal(id) {
  const c = cfaClients.find(x => x.id === id);
  if (!c) return;
  cfaActiveId = id;
  const modal   = document.getElementById('modal-cfa');
  const overlay = document.getElementById('cfaModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('cfaModalContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <div class="kpi-icon blue" style="width:40px;height:40px;font-size:16px"><i class="fas fa-edit"></i></div>
      <div>
        <h2 style="font-size:16px;font-weight:800;color:var(--text-primary);margin:0">Редактировать клиента</h2>
        <div style="font-size:12px;color:var(--text-muted)">${c.name}</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label>Название компании / ФИО *</label>
        <input id="ef_name" type="text" value="${c.name}" />
      </div>
      <div class="form-group">
        <label>Тип клиента</label>
        <select id="ef_type">
          ${['Юридическое лицо','Физическое лицо','ИП'].map(t =>
            `<option ${c.type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Индустрия</label>
        <select id="ef_industry">
          ${CFA_INDUSTRIES.map(i => `<option ${c.industry===i?'selected':''}>${i}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Страна</label>
        <input id="ef_country" type="text" value="${c.country}" />
      </div>
      <div class="form-group">
        <label>Стадия</label>
        <select id="ef_stage">
          ${CFA_STAGES.map(s => `<option value="${s.key}" ${c.stage===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>KYC Статус</label>
        <select id="ef_kyc">
          ${['Новый','На проверке','На подписи','Одобрен','Отклонён'].map(k =>
            `<option ${c.kycStatus===k?'selected':''}>${k}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>AML Статус</label>
        <select id="ef_aml">
          ${['Ожидание','В процессе','Пройден','Enhanced DD','Отклонён'].map(k =>
            `<option ${c.amlStatus===k?'selected':''}>${k}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>PEP Статус</label>
        <select id="ef_pep">
          ${['Нет','Требует проверки','PEP Подтверждён'].map(k =>
            `<option ${c.pepStatus===k?'selected':''}>${k}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>RM / Ответственный</label>
        <select id="ef_rm">
          ${['RM (Relationship Manager)','CO (Compliance Officer)','CEO','Analyst'].map(r =>
            `<option ${c.rmOwner===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Гонорар ($M)</label>
        <input id="ef_rev" type="number" step="0.1" value="${c.revenue}" />
      </div>
      <div class="form-group">
        <label>Контактное лицо</label>
        <input id="ef_contact" type="text" value="${c.contact.name}" />
      </div>
      <div class="form-group">
        <label>Должность контакта</label>
        <input id="ef_title" type="text" value="${c.contact.title}" />
      </div>
      <div class="form-group">
        <label>Email</label>
        <input id="ef_email" type="email" value="${c.contact.email}" />
      </div>
      <div class="form-group">
        <label>Телефон</label>
        <input id="ef_phone" type="text" value="${c.contact.phone}" />
      </div>
      <div class="form-group full">
        <label>Описание</label>
        <textarea id="ef_desc" rows="2">${c.description||''}</textarea>
      </div>
      <div class="form-group full">
        <label>Заметки</label>
        <textarea id="ef_notes" rows="2">${c.notes||''}</textarea>
      </div>
    </div>
    <div class="task-modal-footer">
      <button class="btn-ghost" onclick="openCFAModal(${c.id})"><i class="fas fa-arrow-left"></i> Назад</button>
      <button class="btn-primary" onclick="saveEditCFAClient(${c.id})"><i class="fas fa-check"></i> Сохранить</button>
    </div>`;
  modal.style.display = 'flex';
}

function saveEditCFAClient(id) {
  const c = cfaClients.find(x => x.id === id);
  if (!c) return;
  const name = (document.getElementById('ef_name')?.value || '').trim();
  if (!name) { showToast('Введите название', 'red'); return; }
  c.name        = name;
  c.type        = document.getElementById('ef_type')?.value    || c.type;
  c.industry    = document.getElementById('ef_industry')?.value|| c.industry;
  c.country     = document.getElementById('ef_country')?.value || c.country;
  c.stage       = document.getElementById('ef_stage')?.value   || c.stage;
  c.kycStatus   = document.getElementById('ef_kyc')?.value     || c.kycStatus;
  c.amlStatus   = document.getElementById('ef_aml')?.value     || c.amlStatus;
  c.pepStatus   = document.getElementById('ef_pep')?.value     || c.pepStatus;
  c.rmOwner     = document.getElementById('ef_rm')?.value      || c.rmOwner;
  c.revenue     = parseFloat(document.getElementById('ef_rev')?.value) || c.revenue;
  c.description = document.getElementById('ef_desc')?.value    || c.description;
  c.notes       = document.getElementById('ef_notes')?.value   || c.notes;
  c.contact.name  = document.getElementById('ef_contact')?.value || c.contact.name;
  c.contact.title = document.getElementById('ef_title')?.value  || c.contact.title;
  c.contact.email = document.getElementById('ef_email')?.value  || c.contact.email;
  c.contact.phone = document.getElementById('ef_phone')?.value  || c.contact.phone;
  renderCFAPage();
  openCFAModal(id); // вернуться к карточке
  showToast('✅ Клиент обновлён: ' + name, 'green');
}

function saveNewCFAClient() {
  const name = document.getElementById('cf_name').value.trim();
  if (!name) { showToast('Введите название', 'red'); return; }
  const newClient = {
    id: cfaClientIdCounter++,
    name,
    type:     document.getElementById('cf_type').value,
    category: 'Corporate',
    country:  document.getElementById('cf_country').value,
    industry: document.getElementById('cf_industry').value,
    stage:    'Lead',
    rmOwner:  document.getElementById('cf_rm').value,
    services: [document.getElementById('cf_service').value],
    revenue:  parseFloat(document.getElementById('cf_rev').value) || 0,
    engagementDate: new Date().toISOString().split('T')[0],
    kycStatus: 'Новый', amlStatus: 'Ожидание', pepStatus: 'Нет',
    qualified: false,
    contact: { name: document.getElementById('cf_contact').value, title: '', email: document.getElementById('cf_email').value, phone: '' },
    ubo: [], description: '', notes: document.getElementById('cf_notes').value,
    documents: [], created: new Date().toISOString().split('T')[0],
    pipeline: CFA_STAGES.map(s => ({ stage: s.key, date: s.key==='Lead'?new Date().toISOString().split('T')[0]:null, done: s.key==='Lead' })),
    tasks: []
  };
  cfaClients.unshift(newClient);
  closeCFAModal();
  renderCFAPage();
  showToast('Клиент добавлен: ' + name, 'green');
}
