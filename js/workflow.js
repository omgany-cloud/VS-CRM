// ============================================================
//  workflow.js — Approval Workflow Engine
//  Golden Leaves Ltd / Turan Capital Fund LP
//  Covers: KYC/AML approvals CO→MLRO→CEO, Deal IC workflow,
//          Capital Call approvals, CF&A onboarding sign-offs
// ============================================================

/* ─── Workflow Definitions ─────────────────────────────────
   Each workflow has ordered steps. Each step:
   { role, label, action: 'approve'|'review'|'sign' }
─────────────────────────────────────────────────────────── */
const WF_DEFINITIONS = {
  kyc_lp: {
    label: 'KYC/AML — LP Onboarding',
    icon: 'fa-shield-alt',
    color: '#8b5cf6',
    steps: [
      { role: 'COMPLIANCE_OFFICER',   label: 'CO проверка документов',      action: 'review'  },
      { role: 'MLRO', label: 'MLRO — AML скрининг',         action: 'approve' },
      { role: 'CEO',  label: 'CEO — финальное одобрение',   action: 'approve' },
    ]
  },
  kyc_cfa: {
    label: 'KYC/AML — CF&A Client',
    icon: 'fa-building',
    color: '#3b82f6',
    steps: [
      { role: 'COMPLIANCE_OFFICER',   label: 'CO проверка документов',      action: 'review'  },
      { role: 'MLRO', label: 'MLRO — AML скрининг',         action: 'approve' },
      { role: 'CEO',  label: 'CEO — финальное одобрение',   action: 'approve' },
    ]
  },
  deal_ic: {
    label: 'Инвестиционный комитет',
    icon: 'fa-handshake',
    color: '#f97316',
    steps: [
      { role: 'ANALYST', label: 'Analyst — Investment Memo',   action: 'review'  },
      { role: 'RELATIONSHIP_MANAGER',      label: 'RM — коммерческая оценка',    action: 'review'  },
      { role: 'CEO',     label: 'IC — решение комитета',       action: 'approve' },
    ]
  },
  capital_call: {
    label: 'Capital Call — согласование',
    icon: 'fa-coins',
    color: '#22c55e',
    steps: [
      { role: 'COMPLIANCE_OFFICER',  label: 'CO — подготовка Notice',      action: 'review'  },
      { role: 'CEO', label: 'CEO — подписание Notice',     action: 'sign'    },
    ]
  },
  subscription: {
    label: 'Subscription Agreement',
    icon: 'fa-file-signature',
    color: '#14b8a6',
    steps: [
      { role: 'COMPLIANCE_OFFICER',   label: 'CO — проверка SA',           action: 'review'  },
      { role: 'CEO',  label: 'CEO — подписание SA',        action: 'sign'    },
    ]
  },
};

/* ─── Workflow Instances ────────────────────────────────────
   Each instance:
   {
     id, type, entityId, entityName, entityType,
     createdAt, createdBy, currentStep (0-based),
     status: 'active'|'approved'|'rejected'|'withdrawn',
     steps: [ { ...def, completedAt, completedBy, decision, comment } ]
   }
─────────────────────────────────────────────────────────── */
let workflowInstances = [
  // Deal IC — NomadTech Solutions (deal id 1) — closed, IC approved 2024-10-05
  {
    id: 1, type: 'deal_ic', entityId: 1, entityName: 'NomadTech Solutions', entityType: 'Deal',
    createdAt: '2024-09-15T09:00:00', createdBy: 'Analyst',
    currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2024-09-20T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Инвестиционный меморандум готов, метрики SaaS сильные.' },
      { role:'RELATIONSHIP_MANAGER',      label:'RM — коммерческая оценка',   action:'review',  completedAt:'2024-09-28T14:00:00', completedBy:'RM',      decision:'approved', comment:'Условия сделки согласованы с фаундерами.' },
      { role:'CEO',     label:'IC — решение комитета',      action:'approve', completedAt:'2024-10-05T10:00:00', completedBy:'CEO',     decision:'approved', comment:'IC единогласно одобрил инвестицию.' },
    ]
  },
  // Deal IC — VitaMed Astana (deal id 2) — closed, IC approved 2025-01-15
  {
    id: 2, type: 'deal_ic', entityId: 2, entityName: 'VitaMed Astana', entityType: 'Deal',
    createdAt: '2024-12-18T09:00:00', createdBy: 'Analyst',
    currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2024-12-22T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум завершён, DD по лицензиям МЗ РК пройден.' },
      { role:'RELATIONSHIP_MANAGER',      label:'RM — коммерческая оценка',   action:'review',  completedAt:'2025-01-06T15:00:00', completedBy:'RM',      decision:'approved', comment:'Коммерческие условия и pre-money согласованы.' },
      { role:'CEO',     label:'IC — решение комитета',      action:'approve', completedAt:'2025-01-15T10:00:00', completedBy:'CEO',     decision:'approved', comment:'IC одобрил сделку, средства к перечислению.' },
    ]
  },
  // Deal IC — Dala Agro Holding (deal id 3) — closed, IC approved 2025-04-10
  {
    id: 3, type: 'deal_ic', entityId: 3, entityName: 'Dala Agro Holding', entityType: 'Deal',
    createdAt: '2025-03-18T09:00:00', createdBy: 'Analyst',
    currentStep: 3, status: 'approved',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-03-22T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум по земельному банку и экспортным контрактам готов.' },
      { role:'RELATIONSHIP_MANAGER',      label:'RM — коммерческая оценка',   action:'review',  completedAt:'2025-04-01T15:00:00', completedBy:'RM',      decision:'approved', comment:'Условия convertible note согласованы.' },
      { role:'CEO',     label:'IC — решение комитета',      action:'approve', completedAt:'2025-04-10T10:00:00', completedBy:'CEO',     decision:'approved', comment:'IC одобрил сделку большинством голосов (Investment Manager воздержался/против).' },
    ]
  },
  // Deal IC — Retail Hub Karaganda (deal id 7) — rejected 2025-05-28
  {
    id: 4, type: 'deal_ic', entityId: 7, entityName: 'Retail Hub Karaganda', entityType: 'Deal',
    createdAt: '2025-05-05T09:00:00', createdBy: 'Analyst',
    currentStep: 2, status: 'rejected',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-05-10T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум готов, узкая региональная ниша отмечена как риск.' },
      { role:'RELATIONSHIP_MANAGER',      label:'RM — коммерческая оценка',   action:'review',  completedAt:'2025-05-20T15:00:00', completedBy:'RM',      decision:'approved', comment:'Коммерческая оценка завершена, масштабируемость под вопросом.' },
      { role:'CEO',     label:'IC — решение комитета',      action:'approve', completedAt:'2025-05-28T10:00:00', completedBy:'CEO',     decision:'rejected', comment:'Слишком нишевый региональный рынок, недостаточный потенциал масштабирования для мандата фонда.' },
    ]
  },
  // Deal IC — Green Energy Almaty (deal id 5) — в процессе, ждёт заседания IC 20.07.2025
  {
    id: 5, type: 'deal_ic', entityId: 5, entityName: 'Green Energy Almaty', entityType: 'Deal',
    createdAt: '2025-07-05T09:00:00', createdBy: 'Analyst',
    currentStep: 2, status: 'active',
    steps: [
      { role:'ANALYST', label:'Analyst — Investment Memo',  action:'review',  completedAt:'2025-07-08T11:00:00', completedBy:'Analyst', decision:'approved', comment:'Меморандум по солнечной электростанции готов, риски по земле отмечены.' },
      { role:'RELATIONSHIP_MANAGER',      label:'RM — коммерческая оценка',   action:'review',  completedAt:'2025-07-12T15:00:00', completedBy:'RM',      decision:'approved', comment:'Коммерческие условия и PPA-переговоры в норме.' },
      { role:'CEO',     label:'IC — решение комитета',      action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
    ]
  },
  // KYC LP — Байжанова Динара Сериковна — в процессе, ждёт MLRO AML-скрининга
  {
    id: 6, type: 'kyc_lp', entityId: 6, entityName: 'Байжанова Динара Сериковна', entityType: 'LP',
    createdAt: '2025-06-10T09:00:00', createdBy: 'RM',
    currentStep: 1, status: 'active',
    steps: [
      { role:'COMPLIANCE_OFFICER',   label:'CO проверка документов',    action:'review',  completedAt:'2025-06-18T11:20:00', completedBy:'CO',   decision:'approved', comment:'Паспорт и подтверждение адреса получены. Ожидается Source of Funds.' },
      { role:'MLRO', label:'MLRO — AML скрининг',        action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
      { role:'CEO',  label:'CEO — финальное одобрение',  action:'approve', completedAt:null, completedBy:null, decision:null, comment:'' },
    ]
  },
];

let wfIdCounter = 7;
let activeWfId  = null;   // currently open modal

/* ─────────────────────────────────────────────────────────
   PAGE RENDER
───────────────────────────────────────────────────────── */
function renderWorkflowPage() {
  renderWfKPIs();
  renderWfList();
}

function renderWfKPIs() {
  const el = document.getElementById('wfKPIs');
  if (!el) return;
  const active   = workflowInstances.filter(w => w.status === 'active').length;
  const approved = workflowInstances.filter(w => w.status === 'approved').length;
  const myRole   = currentUserRole() || 'CEO';
  const myPending = workflowInstances.filter(w => {
    if (w.status !== 'active') return false;
    const step = w.steps[w.currentStep];
    return step && step.role === myRole && !step.completedAt;
  }).length;
  const rejected = workflowInstances.filter(w => w.status === 'rejected').length;

  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-icon blue"><i class="fas fa-stream"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Активных workflow</span>
        <span class="kpi-value">${active}</span>
        <span class="kpi-delta ${active>0?'warning':'up'}">${active>0?'Требуют действий':'Нет активных'}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon orange"><i class="fas fa-user-clock"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Ждут моей роли (${myRole})</span>
        <span class="kpi-value" style="color:${myPending>0?'#f97316':'#22c55e'}">${myPending}</span>
        <span class="kpi-delta ${myPending>0?'down':'up'}">${myPending>0?'Требуется действие':'Нет ожидающих'}</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon green"><i class="fas fa-check-double"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Завершено</span>
        <span class="kpi-value">${approved}</span>
        <span class="kpi-delta up">одобрено</span>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-icon red"><i class="fas fa-times-circle"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">Отклонено</span>
        <span class="kpi-value" style="color:${rejected>0?'#ef4444':'#22c55e'}">${rejected}</span>
        <span class="kpi-delta ${rejected>0?'down':'up'}">${rejected>0?'Внимание':'Нет'}</span>
      </div>
    </div>`;
}

function renderWfList() {
  const el = document.getElementById('wfList');
  if (!el) return;
  const myRole = currentUserRole() || 'CEO';

  // Sort: active first, then by creation date desc
  const sorted = [...workflowInstances].sort((a,b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  el.innerHTML = sorted.map(w => {
    const def  = WF_DEFINITIONS[w.type];
    const step = w.steps[w.currentStep];
    const isMyTurn = w.status === 'active' && step && step.role === myRole && !step.completedAt;
    const pct  = Math.round((w.currentStep / w.steps.length) * 100);
    const completedSteps = w.steps.filter(s => s.completedAt).length;

    const statusCfg = {
      active:    { label:'Активен',   color:'#3b82f6', bg:'rgba(59,130,246,0.12)' },
      approved:  { label:'Одобрен',   color:'#22c55e', bg:'rgba(34,197,94,0.12)'  },
      rejected:  { label:'Отклонён',  color:'#ef4444', bg:'rgba(239,68,68,0.12)'  },
      withdrawn: { label:'Отозван',   color:'#94a3b8', bg:'rgba(148,163,184,0.1)' },
    }[w.status] || { label:w.status, color:'#94a3b8', bg:'rgba(148,163,184,0.1)' };

    return `
      <div class="wf-row ${isMyTurn?'wf-my-turn':''}" onclick="openWfModal(${w.id})">
        <div class="wf-row-icon" style="background:${def.color}22;color:${def.color}">
          <i class="fas ${def.icon}"></i>
        </div>
        <div class="wf-row-main">
          <div class="wf-row-title">
            <span class="wf-entity-name">${w.entityName}</span>
            ${isMyTurn ? '<span class="wf-my-badge"><i class="fas fa-bell"></i> Требуется ваше действие</span>' : ''}
          </div>
          <div class="wf-row-meta">
            <span style="color:${def.color};font-size:11px;font-weight:700">${def.label}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">Шаг ${completedSteps}/${w.steps.length}: ${step ? step.label : '—'}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">${new Date(w.createdAt).toLocaleDateString('ru-RU')}</span>
          </div>
          <div class="wf-progress-bar">
            <div class="wf-progress-fill" style="width:${Math.round(completedSteps/w.steps.length*100)}%;background:${def.color}"></div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
          <span class="task-status-pill" style="background:${statusCfg.bg};color:${statusCfg.color}">${statusCfg.label}</span>
          <span style="font-size:11px;color:#8a9bbf">${w.entityType}</span>
        </div>
      </div>`;
  }).join('') || '<div style="padding:40px;text-align:center;color:#8a9bbf">Нет workflow</div>';
}

/* ─────────────────────────────────────────────────────────
   MODAL
───────────────────────────────────────────────────────── */
function openWfModal(id) {
  activeWfId = id;
  const w   = workflowInstances.find(x => x.id === id);
  if (!w) return;
  const modal   = document.getElementById('modal-wf');
  const overlay = document.getElementById('wfModalOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  renderWfModalContent(w);
  modal.style.display = 'flex';
}

function closeWfModal() {
  const modal   = document.getElementById('modal-wf');
  const overlay = document.getElementById('wfModalOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  activeWfId = null;
}

function renderWfModalContent(w) {
  const def    = WF_DEFINITIONS[w.type];
  const myRole = currentUserRole() || 'CEO';
  const currentStep = w.steps[w.currentStep];
  const isMyTurn = w.status === 'active' && currentStep && currentStep.role === myRole && !currentStep.completedAt;

  const stepsHtml = w.steps.map((s, i) => {
    const isDone    = !!s.completedAt;
    const isCurrent = i === w.currentStep && w.status === 'active';
    const isPending = !isDone && !isCurrent;
    const dotColor  = isDone ? (s.decision === 'rejected' ? '#ef4444' : '#22c55e') : isCurrent ? def.color : '#2a3448';
    const dotIcon   = isDone ? (s.decision === 'rejected' ? 'fa-times' : 'fa-check') : isCurrent ? 'fa-clock' : 'fa-circle';
    return `
      <div class="wf-step ${isDone?'done':isCurrent?'current':'pending'}">
        <div class="wf-step-connector ${i===0?'first':''}"></div>
        <div class="wf-step-dot" style="background:${dotColor};border-color:${dotColor}">
          <i class="fas ${dotIcon}" style="font-size:10px;color:#fff"></i>
        </div>
        <div class="wf-step-body">
          <div class="wf-step-label" style="color:${isCurrent?def.color:isDone?'#e2e8f0':'#8a9bbf'}">
            ${s.label}
            <span class="wf-step-role-badge">${s.role}</span>
            ${s.action === 'sign' ? '<span class="wf-step-role-badge" style="background:rgba(20,184,166,0.15);color:#2dd4bf">Подпись</span>' : ''}
          </div>
          ${isDone ? `
            <div class="wf-step-done-info">
              <span style="color:${s.decision==='approved'?'#22c55e':'#ef4444'};font-weight:700;font-size:11px">
                ${s.decision==='approved'?'✓ Одобрено':'✗ Отклонено'}
              </span>
              <span style="color:#8a9bbf;font-size:11px"> · ${s.completedBy} · ${new Date(s.completedAt).toLocaleDateString('ru-RU')}</span>
              ${s.comment ? `<div style="color:#94a3b8;font-size:11px;margin-top:3px;font-style:italic">"${s.comment}"</div>` : ''}
            </div>` : isCurrent ? `<div style="font-size:11px;color:${def.color};font-weight:600">⏳ Ожидает действия</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const actionHtml = isMyTurn ? `
    <div class="wf-action-panel">
      <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:10px">
        <i class="fas fa-user-check" style="color:${def.color}"></i>
        Ваше действие (${myRole}): ${currentStep.label}
      </div>
      <textarea id="wfComment" rows="2" placeholder="Комментарий (обязателен при отклонении)..."
        style="width:100%;background:#1c2333;border:1px solid #2a3448;border-radius:8px;
               padding:10px;color:#e2e8f0;font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:10px"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="wfAction(${w.id},'approved')"
          style="background:rgba(34,197,94,0.15);border:1px solid #22c55e;color:#22c55e;
                 padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;flex:1">
          <i class="fas fa-check"></i> ${currentStep.action === 'sign' ? 'Подписать' : 'Одобрить'}
        </button>
        <button onclick="wfAction(${w.id},'rejected')"
          style="background:rgba(239,68,68,0.1);border:1px solid #ef4444;color:#ef4444;
                 padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;flex:1">
          <i class="fas fa-times"></i> Отклонить
        </button>
      </div>
    </div>` : '';

  document.getElementById('wfModalContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div class="kpi-icon" style="background:${def.color}22;color:${def.color};width:46px;height:46px;font-size:18px;border-radius:12px;display:flex;align-items:center;justify-content:center">
        <i class="fas ${def.icon}"></i>
      </div>
      <div>
        <div style="font-size:16px;font-weight:800;color:#f1f5f9">${w.entityName}</div>
        <div style="font-size:12px;color:${def.color};font-weight:600">${def.label} · ${w.entityType}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${[
        ['Инициатор', w.createdBy],
        ['Создан', new Date(w.createdAt).toLocaleDateString('ru-RU')],
        ['Статус', w.status === 'active' ? 'Активен' : w.status === 'approved' ? 'Одобрен' : 'Отклонён'],
        ['Прогресс', `${w.steps.filter(s=>s.completedAt).length} из ${w.steps.length} шагов`],
      ].map(([k,v]) => `
        <div style="background:#1c2333;border-radius:8px;padding:8px 12px">
          <div style="font-size:10px;color:#8a9bbf;font-weight:700;text-transform:uppercase;margin-bottom:2px">${k}</div>
          <div style="font-size:13px;color:#e2e8f0;font-weight:600">${v}</div>
        </div>`).join('')}
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:#8a9bbf;margin-bottom:12px;text-transform:uppercase;letter-spacing:.5px">Ход согласования</div>
      <div class="wf-steps-list">${stepsHtml}</div>
    </div>

    ${actionHtml}

    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:4px">
      ${w.status === 'active' ? `<button onclick="withdrawWf(${w.id})"
        style="background:none;border:1px solid #2a3448;color:#8a9bbf;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px">
        <i class="fas fa-undo"></i> Отозвать
      </button>` : ''}
      <button onclick="closeWfModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;
}

/* ─────────────────────────────────────────────────────────
   ACTIONS
───────────────────────────────────────────────────────── */
function wfAction(id, decision) {
  const w = workflowInstances.find(x => x.id === id);
  if (!w || w.status !== 'active') return;
  const comment = (document.getElementById('wfComment')?.value || '').trim();
  if (decision === 'rejected' && !comment) {
    showToast('Укажите причину отклонения в комментарии', 'red');
    return;
  }
  const myRole = currentUserRole() || 'CEO';
  const step   = w.steps[w.currentStep];
  if (!step || step.role !== myRole) { showToast('Не ваш шаг', 'red'); return; }

  step.completedAt = new Date().toISOString();
  step.completedBy = currentUserDisplayName();
  step.decision    = decision;
  step.comment     = comment;

  if (decision === 'rejected') {
    w.status = 'rejected';
    showToast(`❌ Workflow отклонён: ${w.entityName}`, 'red');
    // Sync back to entity
    syncWfToEntity(w, 'rejected');
  } else {
    w.currentStep++;
    if (w.currentStep >= w.steps.length) {
      w.status = 'approved';
      showToast(`✅ Workflow завершён: ${w.entityName}`, 'green');
      syncWfToEntity(w, 'approved');
    } else {
      const nextStep = w.steps[w.currentStep];
      showToast(`✅ Шаг одобрен → ожидает ${nextStep.role}`, 'blue');
    }
  }

  renderWfModalContent(w);
  renderWorkflowPage();
  if (typeof updateBadges === 'function') updateBadges();
}

function withdrawWf(id) {
  if (!confirm('Отозвать этот workflow?')) return;
  const w = workflowInstances.find(x => x.id === id);
  if (w) { w.status = 'withdrawn'; }
  closeWfModal();
  renderWorkflowPage();
  showToast('Workflow отозван', 'red');
}

/* Sync workflow result back to entity data */
function syncWfToEntity(w, result) {
  if (w.entityType === 'LP') {
    const lp = lpRegister.find(l => l.id === w.entityId);
    if (lp) {
      lp.kycStatus = result === 'approved' ? 'Одобрен' : 'Отклонён';
      if (result === 'approved') { lp.kycDate = new Date().toISOString().split('T')[0]; lp.status = 'Active'; }
    }
  }
  if (w.entityType === 'CF&A') {
    // CF&A clients are obClients (direction === 'CF&A') now — unlike the
    // old standalone cfaClients demo array, obClients has no separate
    // kycStatus/amlStatus/stage fields to sync a renewal result onto
    // (its `activated` flag is owned by the onboarding task flow, not
    // by ad-hoc KYC renewal workflows), so there's nothing further to do.
  }
  if (w.entityType === 'Deal') {
    const d = deals.find(x => x.id === w.entityId);
    if (d) { d.ic = result === 'approved' ? 'Одобрено' : 'Отклонено'; }
  }
}

/* ─────────────────────────────────────────────────────────
   CREATE NEW WORKFLOW
───────────────────────────────────────────────────────── */
function startWorkflow(type, entityId, entityName, entityType) {
  const def = WF_DEFINITIONS[type];
  if (!def) return;
  // Check for existing active workflow for this entity+type
  const existing = workflowInstances.find(w =>
    w.type === type && w.entityId === entityId && w.status === 'active'
  );
  if (existing) {
    showToast('Для этого объекта уже есть активный workflow', 'red');
    openWfModal(existing.id);
    return;
  }
  const instance = {
    id: wfIdCounter++,
    type, entityId, entityName, entityType,
    createdAt: new Date().toISOString(),
    createdBy: currentUserDisplayName(),
    currentStep: 0,
    status: 'active',
    steps: def.steps.map(s => ({ ...s, completedAt:null, completedBy:null, decision:null, comment:'' })),
  };
  workflowInstances.unshift(instance);
  showToast(`🚀 Workflow запущен: ${entityName}`, 'blue');
  if (typeof updateBadges === 'function') updateBadges();
  openWfModal(instance.id);
}

/* Helper: get active workflow count for badge */
function getActiveWfCount() {
  const myRole = currentUserRole() || 'CEO';
  return workflowInstances.filter(w => {
    if (w.status !== 'active') return false;
    const step = w.steps[w.currentStep];
    return step && step.role === myRole;
  }).length;
}
