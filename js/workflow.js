// ============================================================
//  workflow.js — Approval Workflow Engine
//  Golden Leaves Ltd / Turan Capital Fund LP
//  Covers: KYC/AML approvals CO→MLRO→CEO. 'deal_ic' also exists below
//  purely to render 5 historical seeded records — no live call site
//  creates a new one (see server/wfDefinitions.js's comment on it; an
//  IC decision going forward is tracked by js/modules.js's icMemos
//  system instead, not this generic chain). 'capital_call'/
//  'subscription' definitions were removed — never had a call site or
//  seed data, purely dead code.
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
};

/* ─── Workflow Instances ────────────────────────────────────
   Each instance:
   {
     id, type, entityId, entityName, entityType,
     createdAt, createdBy, currentStep (0-based),
     status: 'active'|'approved'|'rejected'|'withdrawn',
     steps: [ { ...def, completedAt, completedBy, decision, comment } ]
   }
   Populated at runtime by js/api-auth.js via GET /api/workflow (see
   server/index.js) — server/wfDefinitions.js derives new instances'
   steps and server-enforces every step-approval action; this file no
   longer trusts its own writes as authoritative. */
let workflowInstances = [];

let activeWfId  = null;   // currently open modal

/* ─────────────────────────────────────────────────────────
   PAGE RENDER
───────────────────────────────────────────────────────── */
function renderWorkflowPage() {
  renderWfKPIs();
  renderWfList();
  renderPendingApprovalsBoard();
}

/* ─────────────────────────────────────────────────────────
   UNIFIED PENDING-APPROVALS BOARD
   The KYC/AML chain above is this file's own engine. Every other real
   approval process in the app lives in its own module with its own
   data/permission model (see the comment on each entry below for
   exactly what "pending" means there) — this just surfaces all of them
   in one place so "Согласования" reflects everything, not just KYC.
   Nothing about how any of these processes actually work changes here;
   each row just navigates to and opens the real place the decision is
   made.
───────────────────────────────────────────────────────── */
function collectExternalPendingApprovals() {
  const items = [];

  // IC Memo voting — quorum-based (4 fixed seats), not a linear chain.
  // "Pending" = memo hasn't reached a final decision yet (js/modules.js).
  (typeof icMemos !== 'undefined' ? icMemos : []).forEach(m => {
    if (m.status !== 'pending') return;
    items.push({
      category: 'IC Memo', icon: 'fa-handshake', color: '#f97316',
      title: m.company || `IC Memo #${m.id}`,
      meta: 'Голосование Investment Committee (кворум)',
      permission: 'icSeat',
      action: () => { navigateTo('ic'); setTimeout(() => openICModal(m.id), 200); },
    });
  });

  // Capital Call — Draft awaiting the ccApprove gate before it can be sent.
  (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : []).forEach(cc => {
    if (cc.status !== 'Draft') return;
    items.push({
      category: 'Capital Call', icon: 'fa-coins', color: '#8b5cf6',
      title: `Capital Call ${cc.ccNumber || ''} — ${cc.purpose || ''}`.trim(),
      meta: 'Ожидает одобрения (Черновик → Отправлен)',
      permission: 'ccApprove',
      action: () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); },
    });
  });

  // Capital Call — per-LP payment confirmation / AML clearance. Both are
  // one-shot gates on a line item, independent of each other and of the
  // call-level approval above.
  (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : []).forEach(cc => {
    if (cc.status === 'Draft') return;
    (cc.lineItems || []).forEach(li => {
      if (li.status === 'Pending' && !li.wireRef) {
        items.push({
          category: 'CC — платёж', icon: 'fa-money-check-dollar', color: '#22c55e',
          title: `${li.lpName} — Capital Call ${cc.ccNumber || ''}`,
          meta: 'Ожидает подтверждения оплаты (wire ref + документ)',
          permission: 'paymentConfirm',
          action: () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); },
        });
      }
      if (!li.amlOk) {
        items.push({
          category: 'CC — AML', icon: 'fa-user-shield', color: '#0ea5e9',
          title: `${li.lpName} — Capital Call ${cc.ccNumber || ''}`,
          meta: 'Ожидает AML/SoF проверки',
          permission: 'amlClear',
          action: () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); },
        });
      }
    });
  });

  // GP Conclusion sign-off — single approver, only once every DD category
  // has a written conclusion (don't surface deals whose DD isn't done yet).
  (typeof deals !== 'undefined' ? deals : []).forEach(d => {
    if (typeof DD_CONCLUSION_CATEGORIES === 'undefined') return;
    const conclusions = d.ddConclusions || [];
    const ddComplete = DD_CONCLUSION_CATEGORIES.every(cat => conclusions.some(c => c.category === cat.key));
    if (!ddComplete || d.gpConclusionSignedAt) return;
    items.push({
      category: 'GP Conclusion', icon: 'fa-file-signature', color: '#a855f7',
      title: d.company || `Сделка #${d.id}`,
      meta: 'DD завершён — ожидает подписания GP Conclusion',
      permission: 'authorICMemo',
      action: () => { navigateTo('deals'); setTimeout(() => { openDealDetailModal(d.id); switchDealTab('dd', d.id); }, 200); },
    });
  });

  // Conflict Approvals — single decision-maker, one-shot. High/Critical
  // risk auto-escalates (status 'Escalated') and requires the CEO
  // specifically, not just any decideConflicts holder — see
  // PUT /api/conflict-approvals/:id.
  (typeof conflictApprovals !== 'undefined' ? conflictApprovals : []).forEach(a => {
    if (a.status !== 'Pending' && a.status !== 'Escalated') return;
    const client = (typeof obClients !== 'undefined' ? obClients : []).find(c => c.id === a.clientId);
    items.push({
      category: a.status === 'Escalated' ? 'Конфликты — эскалировано' : 'Конфликты / Одобрения',
      icon: 'fa-gavel', color: '#ef4444',
      title: (client ? client.name : a.dealRef) || `Конфликт #${a.id}`,
      meta: a.status === 'Escalated' ? `Риск ${a.riskLevel} — требует решения CEO` : (a.description || 'Ожидает решения Compliance'),
      permission: 'decideConflicts',
      requireRole: a.status === 'Escalated' ? 'CEO' : null,
      action: () => { navigateTo('conflict-approvals'); setTimeout(() => openConflictApprovalDetail(a.id), 200); },
    });
  });

  // AFSA regulatory reports — single filer, one-shot, requires the filed
  // document as evidence (submitAfsaReport(), js/modules.js). "Pending"
  // here means not yet submitted, same as every other category — no date
  // filtering, so a report due months out still shows (matches how a
  // Draft Capital Call or an unsigned GP Conclusion show regardless of
  // any deadline).
  (typeof afsaReports !== 'undefined' ? afsaReports : []).forEach(r => {
    if (r.status === 'Отправлен') return;
    items.push({
      category: 'AFSA Отчётность', icon: 'fa-landmark', color: '#3b82f6',
      title: `${r.period} (${r.reportType})`,
      meta: `Дедлайн ${r.deadline} · ${r.status}`,
      permission: 'afsaSubmit',
      action: () => navigateTo('calendar'),
    });
  });

  return items;
}

// Rendered items are kept here (not re-derived from an inline onclick
// string) so each row's action closure — which captures a real object
// reference from collectExternalPendingApprovals()'s loops — stays
// callable; serializing a closure into an onclick="..." string would
// lose the variables it closed over.
let _pendingApprovalItems = [];

function runPendingApprovalAction(idx) {
  const item = _pendingApprovalItems[idx];
  if (item) item.action();
}

function renderPendingApprovalsBoard() {
  const el = document.getElementById('pendingApprovalsBoard');
  if (!el) return;
  _pendingApprovalItems = collectExternalPendingApprovals();

  const header = el.closest('.card')?.querySelector('.card-title');
  if (header) header.innerHTML = `<i class="fas fa-list-check" style="color:#f97316;margin-right:6px"></i>Все ожидающие решения (${_pendingApprovalItems.length})`;

  if (!_pendingApprovalItems.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:#8a9bbf">Нет ожидающих решений вне KYC/AML</div>';
    return;
  }

  el.innerHTML = _pendingApprovalItems.map((it, idx) => {
    const canAct = (typeof currentUserPermission !== 'function' || !it.permission || currentUserPermission(it.permission)) &&
      (!it.requireRole || (typeof currentUserRole === 'function' && currentUserRole() === it.requireRole));
    return `
      <div class="wf-row" onclick="runPendingApprovalAction(${idx})">
        <div class="wf-row-icon" style="background:${it.color}22;color:${it.color}">
          <i class="fas ${it.icon}"></i>
        </div>
        <div class="wf-row-main">
          <div class="wf-row-title">
            <span class="wf-entity-name">${it.title}</span>
            ${canAct ? '<span class="wf-my-badge"><i class="fas fa-bell"></i> Ваша роль может решить</span>' : ''}
          </div>
          <div class="wf-row-meta">
            <span style="color:${it.color};font-size:11px;font-weight:700">${it.category}</span>
            <span class="wf-meta-sep">·</span>
            <span style="font-size:11px;color:#8a9bbf">${it.meta}</span>
          </div>
        </div>
      </div>`;
  }).join('');
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
async function wfAction(id, decision) {
  const w = workflowInstances.find(x => x.id === id);
  if (!w || w.status !== 'active') return;
  const comment = (document.getElementById('wfComment')?.value || '').trim();
  if (decision === 'rejected' && !comment) {
    showToast('Укажите причину отклонения в комментарии', 'red');
    return;
  }
  // Fast client-side check — the server (PUT /api/workflow/:id) is the
  // real enforcement, this just avoids a round-trip for the common
  // wrong-role mis-click.
  const myRole = currentUserRole() || 'CEO';
  const step   = w.steps[w.currentStep];
  if (!step || step.role !== myRole) { showToast('Не ваш шаг', 'red'); return; }

  // Same one-shot-decision rule as withdrawWf/castICVote/decideConflictApproval:
  // no step here has an "undo" control once recorded. A rejection is at
  // least as consequential as a withdrawal — it kills the whole workflow
  // immediately (server: status → 'rejected', terminal) with no restart
  // control in the UI either. Approving the final step is equally terminal
  // and pushes the result onto the real entity (syncWfToEntity).
  const isFinalStep = w.currentStep === w.steps.length - 1;
  const confirmMsg = decision === 'rejected'
    ? `Отклонить этот шаг по «${w.entityName}»? Это немедленно завершит весь workflow как отклонённый — чтобы повторить, процесс нужно будет запускать заново с самого начала. Продолжить?`
    : isFinalStep
      ? `Это финальный шаг согласования «${w.entityName}» — решение сразу переведёт статус в «Одобрено» и применится к записи. Отменить нельзя. Продолжить?`
      : `Одобрить этот шаг по «${w.entityName}»? Решение будет зафиксировано без возможности отмены. Продолжить?`;
  if (!confirm(confirmMsg)) return;

  try {
    const updated = await apiFetch(`/api/workflow/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ decision, comment }),
    });
    const idx = workflowInstances.findIndex(x => x.id === id);
    if (idx !== -1) workflowInstances[idx] = updated;

    if (updated.status === 'rejected') {
      showToast(`❌ Workflow отклонён: ${w.entityName}`, 'red');
      await syncWfToEntity(updated, 'rejected');
    } else if (updated.status === 'approved') {
      showToast(`✅ Workflow завершён: ${w.entityName}`, 'green');
      await syncWfToEntity(updated, 'approved');
    } else {
      const nextStep = updated.steps[updated.currentStep];
      showToast(`✅ Шаг одобрен → ожидает ${nextStep.role}`, 'blue');
    }

    renderWfModalContent(updated);
    renderWorkflowPage();
    if (typeof updateBadges === 'function') updateBadges();
  } catch (err) {
    showToast('⚠️ Не удалось сохранить решение: ' + err.message, 'red');
  }
}

async function withdrawWf(id) {
  const w = workflowInstances.find(x => x.id === id);
  // No restart control in the UI — undoing this means manually re-triggering
  // the whole source process and collecting every step's approval again.
  if (!confirm(`Отозвать workflow по «${w ? w.entityName : 'этой записи'}»? Все уже собранные согласования будут потеряны — восстановить нельзя, для повтора процесс нужно будет запускать заново с начала. Продолжить?`)) return;
  try {
    const updated = await apiFetch(`/api/workflow/${id}/withdraw`, { method: 'POST' });
    const idx = workflowInstances.findIndex(x => x.id === id);
    if (idx !== -1) workflowInstances[idx] = updated;
    closeWfModal();
    renderWorkflowPage();
    showToast('Workflow отозван', 'red');
  } catch (err) {
    showToast('⚠️ Не удалось отозвать: ' + err.message, 'red');
  }
}

/* Sync workflow result back to entity data */
async function syncWfToEntity(w, result) {
  if (w.entityType === 'LP') {
    const lp = lpRegister.find(l => l.id === w.entityId);
    if (lp) {
      const prev = { kycStatus: lp.kycStatus, kycDate: lp.kycDate, status: lp.status };
      lp.kycStatus = result === 'approved' ? 'Одобрен' : 'Отклонён';
      if (result === 'approved') { lp.kycDate = new Date().toISOString().split('T')[0]; lp.status = 'Active'; }
      // KYC renewal completing is a real compliance milestone — this used
      // to only ever update lpRegister[] in memory (no apiFetch at all),
      // so the renewal's outcome was lost on reload despite the workflow
      // instance itself being correctly saved.
      try {
        await apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({
          kycStatus: lp.kycStatus, kycDate: lp.kycDate, status: lp.status,
        }) });
      } catch (err) {
        Object.assign(lp, prev);
        showToast('⚠️ Workflow завершён, но не удалось сохранить KYC-статус LP: ' + err.message, 'orange');
      }
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
    // deal_ic is historical-only (see server/wfDefinitions.js) — no live
    // call site creates a new instance of this type, so this branch only
    // ever ran for the 5 seeded records, all already resolved. Left as a
    // local-only mutation deliberately: PUT /api/deals/:id now hard-
    // blocks ic/icDecision entirely (a real IC decision can only come
    // from a resolved icMemos vote), so persisting here would 403 anyway.
    const d = deals.find(x => x.id === w.entityId);
    if (d) { d.ic = result === 'approved' ? 'Одобрено' : 'Отклонено'; }
  }
}

/* ─────────────────────────────────────────────────────────
   CREATE NEW WORKFLOW
───────────────────────────────────────────────────────── */
async function startWorkflow(type, entityId, entityName, entityType) {
  const def = WF_DEFINITIONS[type];
  if (!def) return;
  // Fast client-side check — the server (POST /api/workflow) does the real
  // dedup and derives steps from its own copy of the template regardless
  // of anything sent here.
  const existing = workflowInstances.find(w =>
    w.type === type && w.entityId === entityId && w.status === 'active'
  );
  if (existing) {
    showToast('Для этого объекта уже есть активный workflow', 'red');
    openWfModal(existing.id);
    return;
  }
  try {
    const instance = await apiFetch('/api/workflow', {
      method: 'POST',
      body: JSON.stringify({ type, entityId, entityName, entityType }),
    });
    const idx = workflowInstances.findIndex(w => w.id === instance.id);
    if (idx !== -1) workflowInstances[idx] = instance; else workflowInstances.unshift(instance);
    showToast(`🚀 Workflow запущен: ${entityName}`, 'blue');
    if (typeof updateBadges === 'function') updateBadges();
    openWfModal(instance.id);
  } catch (err) {
    showToast('⚠️ Не удалось запустить workflow: ' + err.message, 'red');
  }
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
