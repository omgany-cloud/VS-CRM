// ============================================================
//  Turan Capital Fund LP — Application Logic
//  GP: Golden Leaves Ltd | License: AFSA-A-LA-2024-0038
// ============================================================

let jcChart = null, lpTypeChart = null, navChart = null, sectorChart = null;

/* ===== CURRENT USER =====
   Backed by the real logged-in account (js/api-auth.js's getAuth()), not a
   self-selectable dropdown — currentUserRole is a read-only function, not a
   mutable variable, so it can't be used to self-escalate. */
function currentUserRole() {
  const auth = (typeof getAuth === 'function') ? getAuth() : null;
  return auth && auth.user ? auth.user.role : null;
}

// For authorship-stamping fields (createdBy/completedBy/rm/etc.) — the real
// identity of who did it, not their role label.
function currentUserDisplayName() {
  const auth = (typeof getAuth === 'function') ? getAuth() : null;
  if (!auth || !auth.user) return 'CEO';
  return auth.user.name || auth.user.email;
}

function initUserRole() {
  updateUserRoleUI(currentUserRole());
}

function updateUserRoleUI(role) {
  const cfg = (typeof ROLES !== 'undefined' && ROLES[role]) || { icon: 'fa-user', color: '#64748b' };
  const auth = (typeof getAuth === 'function') ? getAuth() : null;
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarUserAvatar');
  const displayName = auth && auth.user ? (auth.user.name || auth.user.email) : '—';
  if (nameEl) nameEl.textContent = displayName;
  if (roleEl) {
    const label = (typeof roleLabel === 'function') ? roleLabel(role) : (role || '—');
    roleEl.textContent = currentUserPermission('readOnly') ? `${label} · Только просмотр` : label;
  }
  if (avatarEl) {
    avatarEl.style.background = cfg.color;
    avatarEl.innerHTML = `<i class="fas ${cfg.icon}"></i>`;
  }
  const usersNav = document.querySelector('.nav-item[data-page="users"]');
  const canSeeUsersPage = currentUserPermission('manageUsers') || currentUserPermission('manageRoles');
  if (usersNav) usersNav.style.display = canSeeUsersPage ? '' : 'none';

  const roBanner = document.getElementById('readOnlyBanner');
  if (roBanner) roBanner.style.display = currentUserPermission('readOnly') ? '' : 'none';

  if (typeof applyReadOnlyUI === 'function') applyReadOnlyUI();
}

// Repurposed from the old self-service role switcher: now just opens the
// account menu (name/role + Logout) — see the #roleMenu block in index.html.
function toggleUserRoleMenu() {
  const menu = document.getElementById('roleMenu');
  if (!menu) return;
  const title = document.getElementById('accountMenuTitle');
  if (title) {
    const auth = (typeof getAuth === 'function') ? getAuth() : null;
    title.textContent = auth && auth.user ? (auth.user.name || auth.user.email) : 'Аккаунт';
  }
  const isOpen = menu.style.display === 'block';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Position near avatar
    const avatar = document.getElementById('sidebarUserAvatar');
    if (avatar) {
      const rect = avatar.getBoundingClientRect();
      menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      menu.style.left   = rect.left + 'px';
    }
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target) && e.target !== avatar) {
          menu.style.display = 'none';
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 50);
  }
}

function openChangePasswordModal() {
  const menu = document.getElementById('roleMenu');
  if (menu) menu.style.display = 'none';
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('obNewModalTitle').innerHTML = '<i class="fas fa-key" style="color:#3b82f6;margin-right:8px"></i>Сменить пароль';
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;gap:12px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Текущий пароль</label>
        <input type="password" id="pw_current"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Новый пароль (мин. 8 символов)</label>
        <input type="password" id="pw_new"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Повторите новый пароль</label>
        <input type="password" id="pw_confirm"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveChangePassword()" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Сохранить</button>
    </div>`;
  modal.style.display = 'flex';
}

async function saveChangePassword() {
  const currentPassword = document.getElementById('pw_current')?.value;
  const newPassword = document.getElementById('pw_new')?.value;
  const confirmPassword = document.getElementById('pw_confirm')?.value;
  if (!currentPassword) { showToast('⚠️ Введите текущий пароль', 'red'); return; }
  if (!newPassword || newPassword.length < 8) { showToast('⚠️ Новый пароль минимум 8 символов', 'red'); return; }
  if (newPassword !== confirmPassword) { showToast('⚠️ Пароли не совпадают', 'red'); return; }
  try {
    await apiFetch('/api/users/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    closeObNewModal();
    showToast('✅ Пароль изменён', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  setCurrentDate();
  initNavigation();
  initUserRole();
  // Init fund switcher (funds[] is populated later by loadFundsFromApi()
  // after login — nothing to brand yet on first paint).
  renderFundSwitcher();
  if (getActiveFund()) updateFundBranding(getActiveFund());
  updateBadges();
  renderDashboard();
  renderClosing();
  renderPipeline(deals);
  renderPortfolio(portfolio);
  renderHarvesting();
  renderDocumentsPage();
  renderSubscriptionPage();
});

/* ===== DATE ===== */
function setCurrentDate() {
  const d = new Date();
  document.getElementById('currentDate').textContent = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ===== BADGES ===== */
function updateBadges() {
  const activeDeals = deals.filter(d => d.stage !== 'Закрыта' && d.stage !== 'Отклонена IC').length;

  // Badges
  const wfPending   = typeof getActiveWfCount === 'function' ? getActiveWfCount() : 0;
  const icPending   = typeof icMemos !== 'undefined' ? icMemos.filter(m => m.status === 'pending').length : 0;
  const kycOverdue  = typeof obClients !== 'undefined' ? obClients.filter(x => {
    const d = x.kycDate;
    if (!d) return false;
    const renew = new Date(d); renew.setMonth(renew.getMonth() + 12);
    return renew < new Date();
  }).length : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.textContent = val; el.style.display = val ? '' : 'none'; } };
  set('badge-deals', activeDeals);
  set('badge-workflow', wfPending);
  set('badge-ic', icPending);
  set('badge-kycrenewal', kycOverdue);
  // Vault: total files across all aggregated sources
  const vaultCount = typeof vaultGetAllFiles === 'function' ? vaultGetAllFiles().length : 0;
  set('badge-vault', vaultCount);
  // Onboarding (TZ)
  const obOverdue = typeof getObOverdueCount === 'function' ? getObOverdueCount() : 0;
  const coiOpen   = typeof coiRegistry !== 'undefined' ? coiRegistry.filter(c => c.status !== 'Resolved').length : 0;
  set('badge-ob-clients', obOverdue + (typeof obClients !== 'undefined' ? obClients.filter(c => c.onboardingStatus === 'At Risk' || c.onboardingStatus === 'Delayed').length : 0));
  set('badge-coi', coiOpen);
  const engDraft = typeof engagements !== 'undefined' ? engagements.filter(e => e.status === 'Draft').length : 0;
  set('badge-engagements', engDraft);
  const conflictPending = typeof conflictApprovals !== 'undefined' ? conflictApprovals.filter(a => a.status === 'Pending').length : 0;
  set('badge-conflict-approvals', conflictPending);
  // LP Register badge — active LP count
  const lpRegActive = typeof lpRegister !== 'undefined' ? lpRegister.filter(l => l.status === 'Active').length : 0;
  set('badge-lp-register', lpRegActive);
  // Capital Calls badge — pending CCs
  const ccPending = typeof capitalCallsLog !== 'undefined' ? capitalCallsLog.filter(c => c.status === 'Pending').length : 0;
  set('badge-lp-capital-calls', ccPending);
}

/* ===== NAVIGATION ===== */
function initNavigation() {
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    });
  });
  document.querySelectorAll('[data-page]').forEach(el => {
    if (!el.classList.contains('nav-item')) {
      el.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(el.dataset.page);
      });
    }
  });
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
}

const PAGE_LABELS = {
  dashboard:     'nav_dashboard',
  closing:       'nav_closing',
  deals:         'nav_deals',
  portfolio:     'nav_portfolio',
  harvesting:    'nav_harvesting',
  distributions: 'Distributions — Waterfall',
  documents:     'nav_documents',
  export:        'Экспорт Excel',
  workflow:      'Согласования',
  kycrenewal:    'KYC Renewal',
  calendar:      'Compliance Calendar',
  ic:            'Investment Committee',
  vault:         'Хранилище файлов',
  'ob-clients':  'Клиенты FM + CF&A — Онбординг',
  'ob-restricted': 'Restricted List / COI',
  engagements:   'Реестр договоров',
  'conflict-approvals': 'Конфликты / Одобрения — CF Deal Committee',
  subscription:  'nav_subscription',
  'lp-register':      'LP Register — Реестр партнёров',
  'lp-capital-calls': 'Capital Calls — Журнал взносов',
  users:         'Команда / Пользователи',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  document.getElementById('pageBreadcrumb').textContent = t(PAGE_LABELS[page] || page);
  // Close fund dropdown if open
  const dd = document.getElementById('fundSwitcherDropdown');
  if (dd) dd.classList.remove('open');
  if (page === 'dashboard')    { renderDashboardCharts(); }
  if (page === 'reports')      { renderReportCharts(); }
  if (page === 'documents')    { renderDocumentsPage(); }
  if (page === 'subscription') { renderSubscriptionPage(); }
  if (page === 'export')       { renderExportPage(); }
  if (page === 'workflow')     { renderWorkflowPage(); }
  if (page === 'kycrenewal')   { renderKycRenewalPage(); }
  if (page === 'distributions'){ renderDistributionPage(); }
  if (page === 'calendar')     { renderComplianceCalendar(); }
  if (page === 'ic')           { renderICPage(); }
  if (page === 'vault')        { renderVaultPage(); }
  if (page === 'ob-clients')       { renderOnboardingPage(); }
  if (page === 'ob-restricted')     { renderRestrictedListPage(); }
  if (page === 'engagements')       { renderEngagementsPage(); }
  if (page === 'conflict-approvals'){ renderConflictApprovalsPage(); }
  if (page === 'lp-register')       { renderLPRegisterPage(); }
  if (page === 'lp-capital-calls')  { renderCapitalCallsPage(); }
  if (page === 'users')             { renderUsersPage(); }
}

/* ===== DASHBOARD ===== */
function renderDashboard() {
  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  // KPI counts — use lpRegister (new) if available, fallback to 0
  const scopedLps = typeof lpRegister !== 'undefined' ? (fundScoped ? lpRegister.filter(l => l.fundId === activeFundId) : lpRegister) : [];
  const activeLPs = scopedLps.filter(l => l.status === 'Active').length;
  const obInProgress = typeof obClients !== 'undefined' ? obClients.filter(c => c.direction === 'FM' && c.onboardingStatus !== 'Active').length : 0;
  const lpCountEl = document.getElementById('kpiLpCount');
  if (lpCountEl) lpCountEl.textContent = activeLPs;
  const lpKpiDelta = document.getElementById('kpiLpDelta');
  if (lpKpiDelta) {
    lpKpiDelta.textContent = obInProgress > 0 ? `↑ ${obInProgress} в онбординге` : 'Все LP активны';
    lpKpiDelta.className = 'kpi-delta ' + (obInProgress > 0 ? 'warning' : 'up');
  }

  const scopedPortfolio = fundScoped ? portfolio.filter(p => p.fundId === activeFundId) : portfolio;
  const portCountEl = document.getElementById('kpiPortCount');
  if (portCountEl) portCountEl.textContent = scopedPortfolio.length;

  // Onboarding TZ widgets
  if (typeof renderDashboardObWidget === 'function')  renderDashboardObWidget();
  if (typeof renderDashboardCoiWidget === 'function') renderDashboardCoiWidget();
  if (typeof renderDashboardRmWidget === 'function')  renderDashboardRmWidget();
  if (typeof renderDashboardLPWidget === 'function')  renderDashboardLPWidget();
  setTimeout(renderDashboardCharts, 150);
}

function toggleTask(id) { /* legacy stub — not used */ }

function renderKYCStatus() {
  const container = document.getElementById('kycStatusList');
  if (!container) return;
  // Use lpRegister (new) if available
  const list = typeof lpRegister !== 'undefined' ? lpRegister : [];
  container.innerHTML = list.slice(0,6).map(lp => `
    <div class="kyc-mini-row">
      <div class="cell-avatar" style="background:${getColor(lp.id)};width:30px;height:30px;font-size:11px;flex-shrink:0">${(lp.name||'?').charAt(0)}</div>
      <span class="kyc-mini-name">${lp.name}</span>
      ${kycStatusBadge(lp.kycStatus || 'Active')}
    </div>
  `).join('') || '<div style="color:#4a5568;font-size:12px;padding:8px">Нет активных LP</div>';
}

function renderDashboardCharts() {
  // J-Curve
  const jCtx = document.getElementById('chartJCurve');
  if (jCtx) {
    if (jcChart) jcChart.destroy();
    jcChart = new Chart(jCtx, {
      type: 'bar',
      data: {
        labels: chartData.jcurve.labels,
        datasets: [
          {
            label: 'Денежный поток ($M)',
            data: chartData.jcurve.cashflow,
            backgroundColor: chartData.jcurve.cashflow.map(v => v < 0 ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)'),
            borderColor:     chartData.jcurve.cashflow.map(v => v < 0 ? '#ef4444' : '#22c55e'),
            borderWidth: 1.5,
            borderRadius: 4,
          },
          {
            label: 'Накопленный ($M)',
            data: chartData.jcurve.cashflow.reduce((acc, v, i) => { acc.push((acc[i-1]||0)+v); return acc; }, []),
            type: 'line',
            borderColor: '#3b82f6',
            backgroundColor: 'transparent',
            tension: 0.4,
            pointRadius: 4,
            borderWidth: 2,
            yAxisID: 'y',
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#8a9bbf', font:{size:11} } } },
        scales: {
          x: { ticks:{color:'#5a6b8a'}, grid:{color:'#2a3448'} },
          // Axis symbol follows activeFundId; underlying series is still
          // static mock data (js/data.js chartData) — pre-existing
          // limitation, out of scope for this currency-honesty sweep.
          y: { ticks:{color:'#5a6b8a', callback: v=>currencySymbol(currencyForFundId(activeFundId))+v+'M'}, grid:{color:'#2a3448'} }
        }
      }
    });
  }

  // LP Types
  const lpCtx = document.getElementById('chartLPTypes');
  if (lpCtx) {
    if (lpTypeChart) lpTypeChart.destroy();
    lpTypeChart = new Chart(lpCtx, {
      type: 'doughnut',
      data: {
        labels: chartData.lpTypes.labels,
        datasets: [{ data: chartData.lpTypes.data, backgroundColor: COLORS, borderColor:'#1c2333', borderWidth:2, hoverOffset:6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout:'62%',
        plugins: { legend: { position:'bottom', labels:{color:'#8a9bbf',font:{size:10},padding:10} } }
      }
    });
  }
}

/* ===== CLOSING ===== */
/* ═══════════════════════════════════════════════════════════
   FIRST CLOSING — Live Operational Dashboard
   Все статусы считаются из реальных данных системы:
   lpRegister, capitalCallsLog, firstClosingState
═══════════════════════════════════════════════════════════ */

function renderClosing() {
  const el = document.getElementById('closingDashboard');
  if (!el) return;

  const fp  = FUND_PARAMS;
  const fcs = firstClosingState;

  /* ── Живые данные из системы ── */
  // Scoped to activeFundId — this page previously summed LPs/capital calls
  // across every fund with no fundId filter at all, which was already an
  // existing cross-fund contamination bug (a second fund's LPs inflated
  // this checklist's totals) and became a currency-mixing bug too once
  // funds can have different currencies.
  const activeLP        = lpRegister.filter(l => l.status === 'Active' && l.fundId === activeFundId);
  const totalCommit     = activeLP.reduce((s, l) => s + (l.commitment || 0), 0);
  const allKycOk        = activeLP.length > 0 && activeLP.every(l => l.kycStatus === 'Одобрен');
  const allSAok         = activeLP.length > 0 && activeLP.every(l => l.saNumber);
  const commitOk        = totalCommit >= fp.firstClosingMin * 1e6;
  const boardResOk      = !!fcs.boardResolutionUrl;
  const closingCertOk   = !!fcs.closingCertUrl;
  const fmtUSD          = (n) => fmtCurrency(n, currencyForFundId(activeFundId));
  const firstCC         = capitalCallsLog.find(cc => cc.fundId === activeFundId && !cc.individualLP)
                        || capitalCallsLog.find(cc => cc.fundId === activeFundId)
                        || null;
  const firstCCok       = !!firstCC;
  const wlCount         = fcs.welcomeLetterLog.length;
  const wlTotal         = activeLP.length;
  const wlAllOk         = wlTotal > 0 && wlCount >= wlTotal;
  const lpRegOk         = activeLP.length > 0;
  const afsaOk          = !!(fcs.afsaNotifDate && fcs.afsaNotifNum);

  /* ── Timeline авто-статусы ── */
  const t1ok = commitOk && allKycOk;                          // Неделя −2
  const t2ok = t1ok && boardResOk;                            // Неделя −1
  const t3ok = t2ok && closingCertOk && allSAok;              // День 0
  const t4ok = t3ok && firstCCok;                             // Неделя +1
  const t5ok = t4ok && wlAllOk && lpRegOk && afsaOk;         // Неделя +4

  /* ── Общий прогресс ── */
  const steps  = [t1ok, t2ok, t3ok, t4ok, t5ok];
  const doneN  = steps.filter(Boolean).length;
  const pct    = Math.round(doneN / steps.length * 100);
  const overallStatus = t5ok ? 'Завершён' : t3ok ? 'В процессе' : 'Подготовка';
  const overallColor  = t5ok ? '#22c55e'  : t3ok ? '#f97316'    : '#8b5cf6';

  /* ── helpers ── */
  const inpStyle  = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:6px 10px;color:#e2e8f0;font-size:12px;flex:1;min-width:0`;
  const saveBtnS  = `background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap`;
  const prevBtnS  = `background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#a78bfa;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap`;
  const navBtnS   = `background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap`;

  const statusDot = (ok) => ok
    ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:6px"></span>`
    : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#334155;margin-right:6px;border:1px solid #475569"></span>`;

  const sectionHeader = (icon, color, title, statusOk, badgeText) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1e293b">
      <div style="width:36px;height:36px;background:rgba(${color},0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="${icon}" style="color:rgb(${color});font-size:15px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800;color:#f1f5f9">${title}</div>
      </div>
      ${badgeText ? `<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;
        background:${statusOk?'rgba(34,197,94,0.12)':'rgba(100,116,139,0.15)'};
        color:${statusOk?'#4ade80':'#64748b'};border:1px solid ${statusOk?'rgba(34,197,94,0.3)':'#2a3448'}">
        ${statusOk ? '✓ ' : ''}${badgeText}
      </span>` : ''}
    </div>`;

  /* ════════════════════════════════════════════════
     Timeline step builder
  ════════════════════════════════════════════════ */
  const timelineStep = (label, title, desc, resp, ok, active) => `
    <div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:100px">
      <div style="width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;
        background:${ok?'rgba(34,197,94,0.2)':active?'rgba(249,115,22,0.2)':'rgba(30,41,59,0.8)'};
        border:2px solid ${ok?'#22c55e':active?'#f97316':'#334155'};
        color:${ok?'#22c55e':active?'#f97316':'#475569'}">
        ${ok?'<i class="fas fa-check"></i>':active?'<i class="fas fa-circle-notch fa-spin" style="font-size:12px"></i>':'<span style="font-size:11px">○</span>'}
      </div>
      <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-top:6px;text-align:center">${label}</div>
      <div style="font-size:11px;font-weight:700;color:${ok?'#22c55e':active?'#f97316':'#94a3b8'};text-align:center;margin-top:2px">${title}</div>
      <div style="font-size:10px;color:#64748b;text-align:center;margin-top:4px;line-height:1.5">${desc}</div>
      <div style="font-size:9px;color:#475569;margin-top:4px;font-style:italic">${resp}</div>
    </div>`;

  const timelineConnector = (ok) => `
    <div style="flex:0 0 32px;height:2px;margin-top:21px;
      background:${ok?'#22c55e':'#1e293b'};
      border-radius:2px;align-self:flex-start"></div>`;

  /* ════════════════════════════════════════════════
     LP rows for Subscription Agreements
  ════════════════════════════════════════════════ */
  const saRows = activeLP.length === 0
    ? `<div style="color:#64748b;font-size:12px;padding:10px 0">Нет активных LP в реестре</div>`
    : activeLP.map(lp => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #1a2335">
        <div style="width:22px;height:22px;border-radius:50%;background:${lp.saNumber?'rgba(34,197,94,0.15)':'rgba(100,116,139,0.15)'};
          display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fas fa-${lp.saNumber?'check':'times'}" style="font-size:9px;color:${lp.saNumber?'#22c55e':'#64748b'}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${lp.name}</div>
          <div style="font-size:10px;color:#64748b">${lp.saNumber || '— SA не указан'} · KYC: <span style="color:${lp.kycStatus==='Одобрен'?'#22c55e':'#f97316'}">${lp.kycStatus}</span></div>
        </div>
        ${lp.lpaUrl ? `
          <button onclick="_obOpenPreviewModal('${lp.lpaUrl.replace(/'/g,"\\'")}','${lp.lpaUrl.replace(/'/g,"\\'")}')"
            style="${prevBtnS}"><i class="fas fa-eye" style="margin-right:4px"></i>LPA</button>` : ''}
        <button onclick="navigateTo('lp-register')"
          style="${navBtnS}"><i class="fas fa-external-link-alt" style="margin-right:4px"></i>LP</button>
      </div>`).join('');

  /* ════════════════════════════════════════════════
     Welcome Letter rows
  ════════════════════════════════════════════════ */
  const wlRows = activeLP.length === 0
    ? `<div style="color:#64748b;font-size:12px;padding:10px 0">Нет активных LP</div>`
    : activeLP.map(lp => {
        const sent = fcs.welcomeLetterLog.includes(lp.id);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #1a2335">
          <div style="width:22px;height:22px;border-radius:50%;background:${sent?'rgba(34,197,94,0.15)':'rgba(234,179,8,0.1)'};
            display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas fa-${sent?'check':'clock'}" style="font-size:9px;color:${sent?'#22c55e':'#eab308'}"></i>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:#e2e8f0">${lp.name}</div>
            <div style="font-size:10px;color:#64748b">${lp.registerId} · ${sent?'<span style="color:#22c55e">Letter отправлен</span>':'<span style="color:#eab308">Ожидает</span>'}</div>
          </div>
          <button onclick="fcGenerateWelcomeLetter(${lp.id})"
            style="background:${sent?'rgba(34,197,94,0.08)':'rgba(59,130,246,0.12)'};
              border:1px solid ${sent?'rgba(34,197,94,0.2)':'rgba(59,130,246,0.3)'};
              color:${sent?'#4ade80':'#60a5fa'};
              padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-${sent?'redo':'envelope-open-text'}" style="margin-right:4px"></i>${sent?'Повторно':'Сгенерировать'}
          </button>
        </div>`;
      }).join('');

  /* ════════════════════════════════════════════════
     HTML RENDER
  ════════════════════════════════════════════════ */
  el.innerHTML = `

    <!-- ══ PAGE HEADER ══ -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
          <h1 style="font-size:22px;font-weight:800;color:#f1f5f9;margin:0">First Closing</h1>
          <span style="font-size:11px;font-weight:700;padding:3px 12px;border-radius:20px;
            background:${t5ok?'rgba(34,197,94,0.15)':t3ok?'rgba(249,115,22,0.15)':'rgba(139,92,246,0.15)'};
            color:${overallColor};border:1px solid ${t5ok?'rgba(34,197,94,0.3)':t3ok?'rgba(249,115,22,0.3)':'rgba(139,92,246,0.3)'}"
          >${overallStatus}</span>
        </div>
        <div style="font-size:12px;color:#64748b">${fp.name} · GP: ${fp.gp} · AFSA: ${fp.license} · Дата закрытия: <b style="color:#94a3b8">${fcs.closingDate || '—'}</b></div>
      </div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="text-align:right">
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">Прогресс First Closing</div>
          <div style="font-size:22px;font-weight:800;color:${overallColor}">${pct}%</div>
        </div>
        <div style="width:56px;height:56px;position:relative">
          <svg viewBox="0 0 36 36" style="transform:rotate(-90deg);width:56px;height:56px">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1e293b" stroke-width="3"/>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="${overallColor}" stroke-width="3"
              stroke-dasharray="${pct} ${100-pct}" stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
            font-size:10px;font-weight:800;color:${overallColor}">${doneN}/${steps.length}</div>
        </div>
      </div>
    </div>

    <!-- ══ TIMELINE ══ -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-route" style="color:#f97316;margin-right:6px"></i>Timeline First Closing</span>
        <span style="font-size:11px;color:#64748b">Авто-статус из данных системы</span>
      </div>
      <div style="display:flex;align-items:flex-start;padding:8px 0 4px;overflow-x:auto">
        ${timelineStep('Неделя −2','Подготовка','Мин. $5M<br>KYC/AML LP','CEO + CCO', t1ok, !t1ok)}
        ${timelineConnector(t1ok)}
        ${timelineStep('Неделя −1','Документы','Board Resolution<br>Closing Cert.<br>Банк уведомлён','CFO + CEO', t2ok, t1ok&&!t2ok)}
        ${timelineConnector(t2ok)}
        ${timelineStep('День 0','Closing Day','Board Meeting<br>Подписание SA<br>Closing Cert.','GP Board + CEO', t3ok, t2ok&&!t3ok)}
        ${timelineConnector(t3ok)}
        ${timelineStep('Неделя +1','Capital Call','CC Notice #1<br>10 рабочих дней','CFO', t4ok, t3ok&&!t4ok)}
        ${timelineConnector(t4ok)}
        ${timelineStep('Неделя +4','Завершение','Welcome Letters<br>LP Register ✓<br>AFSA уведомлён','CEO + Reg.Agent', t5ok, t4ok&&!t5ok)}
      </div>
    </div>

    <!-- ══ DOCUMENTS GRID ══ -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <!-- Template 1: Subscription Agreements -->
      <div class="card">
        ${sectionHeader('fas fa-file-signature','59,130,246',
          'Template 1 — Subscription Agreements',
          allSAok && allKycOk,
          activeLP.length ? `${activeLP.filter(l=>l.saNumber).length}/${activeLP.length} LP` : 'Нет LP')}
        ${saRows}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="navigateTo('ob-clients')" style="${navBtnS}">
            <i class="fas fa-user-plus" style="margin-right:4px"></i>Онбординг LP
          </button>
          <button onclick="navigateTo('lp-register')" style="${navBtnS}">
            <i class="fas fa-list" style="margin-right:4px"></i>LP Register
          </button>
        </div>
      </div>

      <!-- Template 2: Board Resolution -->
      <div class="card">
        ${sectionHeader('fas fa-gavel','168,85,247',
          'Template 2 — Board Resolution',
          boardResOk,
          boardResOk ? 'Загружен' : 'Нужен URL')}
        <div style="font-size:11px;color:#64748b;margin-bottom:10px">
          Решение GP Board о проведении First Closing · Подписывается всеми директорами Golden Leaves Ltd
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input type="text" id="fc_boardResUrl" placeholder="https://drive.google.com/... (ссылка на подписанный документ)"
            value="${fcs.boardResolutionUrl}" style="${inpStyle}" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="fcSaveUrl('boardResolutionUrl','fc_boardResUrl')" style="${saveBtnS}">
            <i class="fas fa-save" style="margin-right:4px"></i>Сохранить
          </button>
          ${fcs.boardResolutionUrl ? `
            <button onclick="_obOpenPreviewModal('${fcs.boardResolutionUrl.replace(/'/g,"\\'")}','${fcs.boardResolutionUrl.replace(/'/g,"\\'")}')"
              style="${prevBtnS}"><i class="fas fa-eye" style="margin-right:4px"></i>Открыть
            </button>` : ''}
        </div>
      </div>

      <!-- Template 3: Closing Certificate -->
      <div class="card">
        ${sectionHeader('fas fa-certificate','249,115,22',
          'Template 3 — Closing Certificate',
          closingCertOk,
          closingCertOk ? 'Загружен' : 'Нужен URL')}
        <div style="font-size:11px;color:#64748b;margin-bottom:10px">
          Официальный сертификат First Closing · Дата закрытия, сумма commitments, список LP
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <input type="text" id="fc_certUrl" placeholder="https://drive.google.com/..."
            value="${fcs.closingCertUrl}" style="${inpStyle}" />
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <label style="font-size:11px;color:#8a9bbf;white-space:nowrap">Дата закрытия:</label>
          <input type="date" id="fc_closingDate" value="${fcs.closingDate}"
            style="${inpStyle};max-width:160px" />
          <button onclick="fcSaveClosingDate()" style="${saveBtnS}">
            <i class="fas fa-save"></i>
          </button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="fcSaveUrl('closingCertUrl','fc_certUrl')" style="${saveBtnS}">
            <i class="fas fa-save" style="margin-right:4px"></i>Сохранить
          </button>
          ${fcs.closingCertUrl ? `
            <button onclick="_obOpenPreviewModal('${fcs.closingCertUrl.replace(/'/g,"\\'")}','${fcs.closingCertUrl.replace(/'/g,"\\'")}')"
              style="${prevBtnS}"><i class="fas fa-eye" style="margin-right:4px"></i>Открыть
            </button>` : ''}
        </div>
      </div>

      <!-- Template 4: Capital Call Notice #1 -->
      <div class="card">
        ${sectionHeader('fas fa-coins','34,197,94',
          'Template 4 — Capital Call Notice #1',
          firstCCok,
          firstCCok ? `${firstCC.ccNumber} · ${firstCC.status}` : 'Не создан')}
        <div style="font-size:11px;color:#64748b;margin-bottom:12px">
          Первый Capital Call после закрытия — 10 рабочих дней · Pro-rata по commitments LP
        </div>
        ${firstCCok ? `
          <div style="background:#0f1623;border-radius:8px;padding:10px 14px;margin-bottom:12px">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
              ${[
                {l:'CC №',     v:firstCC.ccNumber,                   c:'#f97316'},
                {l:'Сумма',    v:fmtUSD(firstCC.totalAmount),        c:'#22c55e'},
                {l:'Статус',   v:firstCC.status,                     c:firstCC.status==='Completed'?'#22c55e':'#f97316'},
                {l:'Дата уведомл.', v:firstCC.noticeDate,            c:'#94a3b8'},
                {l:'Дата платежа',  v:firstCC.paymentDate,           c:'#94a3b8'},
                {l:'Получено',      v:fmtUSD(firstCC.lineItems.reduce((s,li)=>s+(li.paid||0),0)), c:'#22c55e'},
              ].map(k=>`
                <div>
                  <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700">${k.l}</div>
                  <div style="font-size:11px;font-weight:700;color:${k.c}">${k.v}</div>
                </div>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button onclick="navigateTo('capital-calls')" style="${navBtnS}">
              <i class="fas fa-external-link-alt" style="margin-right:4px"></i>Capital Calls
            </button>
            <button onclick="generateCCNotice(${firstCC.id}, ${firstCC.lineItems[0]?.lpId})" style="${prevBtnS}">
              <i class="fas fa-file-pdf" style="margin-right:4px"></i>CC Notice PDF
            </button>
          </div>` : `
          <div style="background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2);border-radius:8px;padding:12px 14px;font-size:12px;color:#94a3b8;margin-bottom:12px">
            <i class="fas fa-info-circle" style="color:#f97316;margin-right:6px"></i>
            Capital Call создаётся через Capital Account Statement каждого LP
          </div>
          <button onclick="navigateTo('capital-calls')" style="${navBtnS}">
            <i class="fas fa-external-link-alt" style="margin-right:4px"></i>Перейти к Capital Calls
          </button>`}
      </div>

    </div>

    <!-- ══ SECOND ROW ══ -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <!-- Template 5: Welcome Letters -->
      <div class="card">
        ${sectionHeader('fas fa-envelope-open-text','234,179,8',
          'Template 5 — Welcome Letters LP',
          wlAllOk,
          wlTotal ? `${wlCount}/${wlTotal} LP` : 'Нет LP')}
        ${wlRows}
        ${activeLP.length > 1 ? `
          <div style="margin-top:12px;padding-top:10px;border-top:1px solid #1e293b">
            <button onclick="fcGenerateAllWelcomeLetters()" style="${saveBtnS};width:100%;justify-content:center;display:flex;gap:8px;align-items:center">
              <i class="fas fa-paper-plane"></i>Сгенерировать для всех LP (${activeLP.length})
            </button>
          </div>` : ''}
      </div>

      <!-- Template 6: LP Register -->
      <div class="card">
        ${sectionHeader('fas fa-list-alt','59,130,246',
          'Template 6 — LP Register',
          lpRegOk,
          lpRegOk ? `${activeLP.length} LP · ${fmtUSD(totalCommit)}` : 'Пустой')}
        <div style="font-size:11px;color:#64748b;margin-bottom:12px">
          Реестр инвесторов обновляется автоматически через Онбординг → Задача 5.1
        </div>
        ${activeLP.length > 0 ? `
          <div style="background:#0f1623;border-radius:8px;padding:10px 14px;margin-bottom:12px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[
                {l:'Активных LP',     v:activeLP.length,                                   c:'#3b82f6'},
                {l:'Total Commitment',v:fmtUSD(totalCommit),                               c:'#22c55e'},
                {l:'Min. Commitment', v:`$${fp.firstClosingMin}M`,                         c:commitOk?'#22c55e':'#ef4444'},
                {l:'Выполнение',      v:commitOk?'✓ Порог достигнут':'✗ Ниже минимума',   c:commitOk?'#22c55e':'#ef4444'},
                {l:'KYC All OK',      v:allKycOk?'✓ Все проверены':'⚠ Есть незавершённые', c:allKycOk?'#22c55e':'#f97316'},
                {l:'AFSA >20% check', v:activeLP.filter(l=>l.ownershipPct>20&&!l.afsaNotified).length===0?'✓ OK':'⚠ Требует уведомления',
                                      c:activeLP.filter(l=>l.ownershipPct>20&&!l.afsaNotified).length===0?'#22c55e':'#f97316'},
              ].map(k=>`
                <div>
                  <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700">${k.l}</div>
                  <div style="font-size:11px;font-weight:700;color:${k.c}">${k.v}</div>
                </div>`).join('')}
            </div>
          </div>` : ''}
        <button onclick="navigateTo('lp-register')" style="${navBtnS};display:inline-flex;align-items:center;gap:6px">
          <i class="fas fa-external-link-alt"></i>Открыть LP Register
        </button>
      </div>

      <!-- Template 8: AFSA Notification -->
      <div class="card" style="grid-column:1/-1">
        ${sectionHeader('fas fa-landmark','239,68,68',
          'Template 8 — AFSA Notification (First Closing)',
          afsaOk,
          afsaOk ? `Отправлено ${fcs.afsaNotifDate}` : 'Требуется')}
        <div style="font-size:11px;color:#64748b;margin-bottom:14px">
          Уведомление регулятора AFSA о завершении First Closing · Обязательно если LP с долей &gt;20% ·
          Срок: в течение 10 рабочих дней после Closing Day
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Дата отправки</label>
            <input type="date" id="fc_afsaDate" value="${fcs.afsaNotifDate}" style="${inpStyle};width:100%" />
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">№ письма / Reference</label>
            <input type="text" id="fc_afsaNum" placeholder="AFSA-2025-XXXX" value="${fcs.afsaNotifNum}" style="${inpStyle};width:100%" />
          </div>
          <div>
            <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">URL подтверждения</label>
            <input type="text" id="fc_afsaUrl" placeholder="https://..." value="${fcs.afsaConfirmUrl}" style="${inpStyle};width:100%" />
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="fcSaveAFSA()" style="${saveBtnS}">
            <i class="fas fa-save" style="margin-right:4px"></i>Сохранить данные AFSA
          </button>
          ${fcs.afsaConfirmUrl ? `
            <button onclick="_obOpenPreviewModal('${fcs.afsaConfirmUrl.replace(/'/g,"\\'")}','${fcs.afsaConfirmUrl.replace(/'/g,"\\'")}')"
              style="${prevBtnS}"><i class="fas fa-eye" style="margin-right:4px"></i>Подтверждение
            </button>` : ''}
        </div>
      </div>

    </div>
  `;
}

/* ── First Closing helpers ─────────────────────────────── */

function fcSaveUrl(field, inputId) {
  const val = document.getElementById(inputId)?.value?.trim();
  if (!val) { showToast('⚠ Вставьте ссылку на документ', 'red'); return; }
  firstClosingState[field] = val;
  showToast('✅ Ссылка сохранена', 'green');
  renderClosing();
}

function fcSaveClosingDate() {
  const val = document.getElementById('fc_closingDate')?.value;
  if (!val) return;
  firstClosingState.closingDate = val;
  showToast('✅ Дата закрытия сохранена', 'green');
  renderClosing();
}

function fcSaveAFSA() {
  const date = document.getElementById('fc_afsaDate')?.value;
  const num  = document.getElementById('fc_afsaNum')?.value?.trim();
  const url  = document.getElementById('fc_afsaUrl')?.value?.trim();
  if (!date || !num) { showToast('⚠ Укажите дату и номер письма', 'red'); return; }
  firstClosingState.afsaNotifDate   = date;
  firstClosingState.afsaNotifNum    = num;
  firstClosingState.afsaConfirmUrl  = url || '';
  showToast('✅ Данные AFSA Notification сохранены', 'green');
  renderClosing();
}

function fcGenerateWelcomeLetter(lpId) {
  generateLPWelcomeLetter(lpId);
  if (!firstClosingState.welcomeLetterLog.includes(lpId)) {
    firstClosingState.welcomeLetterLog.push(lpId);
  }
  setTimeout(() => renderClosing(), 400);
}

function fcGenerateAllWelcomeLetters() {
  const activeLP = lpRegister.filter(l => l.status === 'Active');
  if (!activeLP.length) { showToast('⚠ Нет активных LP', 'red'); return; }
  activeLP.forEach((lp, i) => {
    setTimeout(() => {
      generateLPWelcomeLetter(lp.id);
      if (!firstClosingState.welcomeLetterLog.includes(lp.id)) {
        firstClosingState.welcomeLetterLog.push(lp.id);
      }
      if (i === activeLP.length - 1) {
        setTimeout(() => {
          showToast(`✅ Welcome Letters сгенерированы для всех ${activeLP.length} LP`, 'green');
          renderClosing();
        }, 500);
      }
    }, i * 500);
  });
}

/* ── Legacy stubs (старые функции оставлены чтобы не сломать возможные внешние вызовы) ── */
function renderClosingChecklist() {}
function renderClosingDocs()      {}
function toggleClosingItem()      {}

/* ===== PIPELINE (KANBAN) ===== */
const DEAL_STAGES = ['Скрининг','IC Review','Due Diligence','Term Sheet','Переговоры','Закрыта','Отклонена IC'];
const STAGE_COLORS = {
  'Скрининг':     '#06b6d4',
  'IC Review':    '#f97316',
  'Due Diligence':'#8b5cf6',
  'Term Sheet':   '#eab308',
  'Переговоры':   '#3b82f6',
  'Закрыта':      '#22c55e',
  'Отклонена IC': '#ef4444',
};

function renderPipeline(data) {
  const board = document.getElementById('pipelineBoard');
  if (typeof activeFundId !== 'undefined' && activeFundId != null) {
    data = data.filter(d => d.fundId === activeFundId);
  }
  board.innerHTML = DEAL_STAGES.map(stage => {
    const sd = data.filter(d => d.stage === stage);
    const total = sd.reduce((s, d) => s + d.amount, 0);
    return `
      <div class="pipeline-col">
        <div class="pipeline-col-header">
          <span class="pipeline-col-title" style="color:${STAGE_COLORS[stage]}">${stage}</span>
          <span class="pipeline-col-count">${sd.length}</span>
        </div>
        <div class="pipeline-col-body">
          ${sd.length
            ? sd.map(d => dealCard(d)).join('')
            : '<div class="pipe-empty">Нет сделок</div>'}
          ${total > 0 ? `<div class="pipe-total">${currencySymbol(currencyForFundId(activeFundId))}${total}M</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function dealCard(d) {
  const stageColor = STAGE_COLORS[d.stage] || '#64748b';
  const prioColors = { 'Высокий':'#ef4444','Средний':'#f97316','Низкий':'#64748b' };
  const prioColor  = prioColors[d.priority] || '#64748b';
  const icColors   = { 'Одобрено':'#22c55e','Подано':'#f97316','Отклонено':'#ef4444','Не подано':'#475569','На рассмотрении':'#eab308' };
  const icColor    = icColors[d.ic] || '#64748b';

  const tagsHtml = (d.tags||[]).slice(0,3).map(t =>
    `<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(59,130,246,0.1);color:#60a5fa;font-weight:600">${t}</span>`
  ).join('');

  const nextActionHtml = d.nextAction ? `
    <div style="display:flex;align-items:center;gap:5px;margin-top:6px;padding:5px 7px;background:#0f1623;border-radius:6px">
      <i class="fas fa-bolt" style="color:#eab308;font-size:9px"></i>
      <span style="font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.nextAction}</span>
      ${d.nextActionDate ? `<span style="font-size:9px;color:#64748b;margin-left:auto;white-space:nowrap">${d.nextActionDate}</span>` : ''}
    </div>` : '';

  return `
    <div class="deal-card" onclick="openDealDetailModal(${d.id})" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:#f1f5f9;line-height:1.3">${d.company}</div>
        <div style="width:8px;height:8px;border-radius:50%;background:${prioColor};flex-shrink:0;margin-top:3px"
          title="Приоритет: ${d.priority}"></div>
      </div>
      <div style="font-size:10px;color:#64748b;margin-bottom:5px">
        <i class="fas fa-tag" style="margin-right:3px;font-size:9px"></i>${d.sector}
        · ${d.country||''}
        ${d.companyStage ? `· <span style="color:#8b5cf6">${d.companyStage}</span>` : ''}
      </div>
      <div style="font-size:12px;font-weight:700;color:#22c55e;margin-bottom:5px">
        ${currencySymbol(currencyForEntity(d))}${d.amount}M
        <span style="font-size:10px;color:#64748b;font-weight:400">· ${d.type}</span>
        ${d.preMoney ? `<span style="font-size:10px;color:#8b5cf6;font-weight:400"> · pre ${currencySymbol(currencyForEntity(d))}${d.preMoney}M</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:5px;
          background:${d.ic==='Одобрено'?'rgba(34,197,94,0.1)':d.ic==='Отклонено'?'rgba(239,68,68,0.1)':'rgba(100,116,139,0.1)'};
          color:${icColor}">IC: ${d.ic}</span>
        ${tagsHtml}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#5a6b8a;margin-top:4px">
        <span><i class="fas fa-user" style="margin-right:3px"></i>${d.manager}</span>
        ${(d.comments||[]).length > 0 ? `<span><i class="fas fa-comment" style="margin-right:3px;color:#3b82f6"></i>${d.comments.length}</span>` : ''}
        ${d.updatedAt ? `<span>${d.updatedAt}</span>` : ''}
      </div>
      ${nextActionHtml}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   DEAL DETAIL MODAL — 6 вкладок
═══════════════════════════════════════════════════════════ */
let _activeDealTab = 'overview';

function openDealDetailModal(dealId) {
  const d = deals.find(x => x.id === dealId);
  if (!d) return;
  _activeDealTab = 'overview';
  _renderDealModal(d);
  document.getElementById('dealDetailOverlay').style.display = 'block';
  document.getElementById('modal-deal-detail').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeDealDetailModal() {
  document.getElementById('dealDetailOverlay').style.display = 'none';
  document.getElementById('modal-deal-detail').style.display = 'none';
  document.body.style.overflow = '';
}

function switchDealTab(tab, dealId) {
  _activeDealTab = tab;
  const d = deals.find(x => x.id === dealId);
  if (d) _renderDealModal(d);
}

function _renderDealModal(d) {
  const stageColor = STAGE_COLORS[d.stage] || '#64748b';
  const tabs = [
    { id:'overview',   icon:'fa-eye',           label:'Обзор'      },
    { id:'documents',  icon:'fa-link',           label:'Документы'  },
    { id:'ic',         icon:'fa-gavel',          label:'IC'         },
    { id:'dd',         icon:'fa-microscope',     label:'Due Dil.'   },
    { id:'history',    icon:'fa-history',        label:'История'    },
  ];

  const iS = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;
  const lS = `font-size:10px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:3px;text-transform:uppercase`;
  const gS = `margin-bottom:12px`;

  /* ── DD status helpers ── */
  const ddStatusColor = s => s==='OK'?'#22c55e':s==='В процессе'||s==='Получен'?'#f97316':s==='Red Flag'?'#ef4444':'#64748b';
  const ddStatusIcon  = s => s==='OK'?'fa-check-circle':s==='В процессе'?'fa-spinner':s==='Получен'?'fa-download':s==='Red Flag'?'fa-exclamation-triangle':'fa-clock';
  const ddBlock = (title, items, color) => `
    <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-folder" style="margin-right:5px"></i>${title}
      </div>
      ${!items||!items.length ? `<div style="font-size:11px;color:#475569;font-style:italic">Нет данных</div>` :
        items.map(it => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1a2335">
            <i class="fas ${ddStatusIcon(it.status)}" style="color:${ddStatusColor(it.status)};font-size:11px;width:12px;text-align:center"></i>
            <span style="flex:1;font-size:11px;color:#e2e8f0">${it.item}</span>
            <span style="font-size:10px;color:${ddStatusColor(it.status)};font-weight:600;cursor:pointer"
              onclick="event.stopPropagation();cycleDDStatus(${d.id},'${title}',${items.indexOf(it)})">${it.status}</span>
          </div>`).join('')}
    </div>`;

  /* ── Vote badge ── */
  const voteBadge = v => `<span style="font-size:10px;padding:2px 8px;border-radius:5px;font-weight:700;
    background:${v==='Yes'?'rgba(34,197,94,0.12)':v==='No'?'rgba(239,68,68,0.12)':'rgba(100,116,139,0.12)'};
    color:${v==='Yes'?'#22c55e':v==='No'?'#ef4444':'#64748b'}">${v}</span>`;

  /* ── Tab content ── */
  let tabContent = '';

  if (_activeDealTab === 'overview') {
    tabContent = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="${gS}"><label style="${lS}">Страна</label>
          <input style="${iS}" value="${d.country||''}"
            onchange="dealField(${d.id},'country',this.value)" /></div>
        <div style="${gS}"><label style="${lS}">Стадия компании</label>
          <select style="${iS}" onchange="dealField(${d.id},'companyStage',this.value)">
            ${['Growth Stage','Expansion','Scale-up','Distressed/Turnaround','Development/Construction'].map(s=>`<option ${d.companyStage===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Источник сделки</label>
          <select style="${iS}" onchange="dealField(${d.id},'dealSource',this.value)">
            ${['Партнёр','Inbound','Конференция','Ивент','Рекомендация','Прямой outreach'].map(s=>`<option ${d.dealSource===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Первый контакт</label>
          <input type="date" style="${iS}" value="${d.firstContactDate||''}"
            onchange="dealField(${d.id},'firstContactDate',this.value)" /></div>
        <div style="${gS}"><label style="${lS}">Выручка / MRR</label>
          <input style="${iS}" value="${d.revenue||''}"
            onchange="dealField(${d.id},'revenue',this.value)" /></div>
        <div style="${gS}"><label style="${lS}">Размер раунда</label>
          <input style="${iS}" value="${d.roundSize||''}"
            onchange="dealField(${d.id},'roundSize',this.value)" /></div>
        <div style="${gS}"><label style="${lS}">Чек фонда ($M)</label>
          <input type="number" style="${iS}" value="${d.checkSize||d.amount||''}"
            onchange="dealField(${d.id},'checkSize',parseFloat(this.value))" /></div>
        <div style="${gS}"><label style="${lS}">Ответственный</label>
          <select style="${iS}" onchange="dealField(${d.id},'manager',this.value)">
            ${['CEO','Investment Manager','CFO','Analyst'].map(s=>`<option ${d.manager===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
      </div>
      <div style="${gS}"><label style="${lS}">Описание / Investment Thesis</label>
        <textarea style="${iS};height:70px;resize:none"
          onchange="dealField(${d.id},'description',this.value)">${d.description||''}</textarea></div>
      <div style="${gS}"><label style="${lS}">Теги (через запятую)</label>
        <input style="${iS}" value="${(d.tags||[]).join(', ')}"
          onchange="dealField(${d.id},'tags',this.value.split(',').map(t=>t.trim()).filter(Boolean))" /></div>

      <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;color:#eab308;text-transform:uppercase;margin-bottom:8px">
          <i class="fas fa-bolt" style="margin-right:5px"></i>Следующий Action Item
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
          <div><label style="${lS}">Описание действия</label>
            <input style="${iS}" value="${d.nextAction||''}"
              onchange="dealField(${d.id},'nextAction',this.value)" placeholder="Следующий шаг..." /></div>
          <div><label style="${lS}">Дедлайн</label>
            <input type="date" style="${iS};width:150px" value="${d.nextActionDate||''}"
              onchange="dealField(${d.id},'nextActionDate',this.value)" /></div>
        </div>
      </div>

      <!-- Контакты основателей -->
      <div style="font-size:10px;font-weight:700;color:#8b5cf6;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-users" style="margin-right:5px"></i>Контакты компании
      </div>
      ${(d.founderContacts||[]).map((c,i) => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span style="font-size:10px;color:#8b5cf6;font-weight:700;min-width:60px">${c.role}</span>
          <span style="font-size:12px;color:#e2e8f0;font-weight:600">${c.name}</span>
          <span style="font-size:11px;color:#64748b">${c.phone||''}</span>
          <a href="mailto:${c.email||''}" style="font-size:11px;color:#3b82f6">${c.email||''}</a>
        </div>`).join('')}
      <button onclick="addFounderContact(${d.id})"
        style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-top:4px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить контакт
      </button>`;
  }

  else if (_activeDealTab === 'documents') {
    const docRow = (label, field) => `
      <div style="margin-bottom:12px">
        <label style="${lS}">${label}</label>
        <div style="display:flex;gap:8px">
          <input style="${iS}" value="${d[field]||''}" placeholder="https://drive.google.com/..."
            id="docfield_${field}_${d.id}"
            onchange="dealField(${d.id},'${field}',this.value)" />
          ${d[field] ? `<button onclick="_obOpenPreviewModal('${(d[field]||'').replace(/'/g,"\\'")}','${(d[field]||'').replace(/'/g,"\\'")}')"
            style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
              padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-eye"></i></button>` : ''}
        </div>
      </div>`;

    tabContent = `
      ${docRow('Pitch Deck', 'pitchDeckUrl')}
      ${docRow('Investment Memo', 'icMemoUrl')}
      ${docRow('Протокол IC / IC Minutes', 'icMinutesUrl')}

      <div style="font-size:10px;font-weight:700;color:#eab308;text-transform:uppercase;margin:14px 0 8px">
        <i class="fas fa-file-contract" style="margin-right:5px"></i>Term Sheet — версии
      </div>
      ${!(d.tsVersions||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет версий</div>` :
        d.tsVersions.map((v,i) => `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:#eab308;min-width:48px">${v.v}</span>
            <span style="font-size:11px;color:#64748b;white-space:nowrap">${v.date}</span>
            <input style="${iS}" value="${v.url||''}" placeholder="https://..."
              onchange="dealTSVersionUrl(${d.id},${i},this.value)" />
            ${v.url ? `<button onclick="_obOpenPreviewModal('${v.url.replace(/'/g,"\\'")}','${v.url.replace(/'/g,"\\'")}')"
              style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteTSVersion(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить версию"><i class="fas fa-trash"></i></button>
          </div>`).join('')}
      <button onclick="addTSVersion(${d.id})"
        style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.25);color:#eab308;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить версию TS
      </button>

      <div style="font-size:10px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-signature" style="margin-right:5px"></i>Подписанные документы (закрытие)
      </div>
      ${!(d.signedDocsUrls||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет документов</div>` :
        d.signedDocsUrls.map((doc,i) => `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:#22c55e;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.name}</span>
            <input style="${iS}" value="${doc.url||''}" placeholder="https://..."
              onchange="dealSignedDocUrl(${d.id},${i},this.value)" />
            ${doc.url ? `<button onclick="_obOpenPreviewModal('${doc.url.replace(/'/g,"\\'")}','${doc.url.replace(/'/g,"\\'")}')"
              style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteSignedDoc(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить"><i class="fas fa-trash"></i></button>
          </div>`).join('')}
      <button onclick="addSignedDoc(${d.id})"
        style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить документ
      </button>

      ${docRow('Подтверждение перевода (Wire Confirm)', 'wireConfirmUrl')}

      <!-- ── ПРОЧИЕ ДОКУМЕНТЫ ── -->
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin:14px 0 8px">
        <i class="fas fa-paperclip" style="margin-right:5px"></i>Прочие документы
      </div>
      ${!(d.otherDocs||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет документов</div>` :
        d.otherDocs.map((doc,i) => `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <input style="${iS};max-width:150px" value="${doc.name||''}" placeholder="Название..."
              onchange="dealOtherDocName(${d.id},${i},this.value)" />
            <input style="${iS}" value="${doc.url||''}" placeholder="https://..."
              onchange="dealOtherDocUrl(${d.id},${i},this.value)" />
            ${doc.url ? `<button onclick="_obOpenPreviewModal('${(doc.url||'').replace(/'/g,"\\'")}','${(doc.url||'').replace(/'/g,"\\'")}')"
              style="background:rgba(100,116,139,0.15);border:1px solid rgba(100,116,139,0.3);color:#94a3b8;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteOtherDoc(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить"><i class="fas fa-trash"></i></button>
          </div>`).join('')}
      <button onclick="addOtherDoc(${d.id})"
        style="background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#94a3b8;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить документ
      </button>`;
  }

  else if (_activeDealTab === 'ic') {
    const icStatusColor = { 'Одобрено':'#22c55e','Отклонено':'#ef4444','На рассмотрении':'#eab308','Не подано':'#64748b','На доработку':'#f97316' };
    tabContent = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="${gS}"><label style="${lS}">Pre-money valuation ($M)</label>
          <input type="number" style="${iS}" value="${d.preMoney||''}"
            onchange="dealField(${d.id},'preMoney',parseFloat(this.value))" placeholder="$M" /></div>
        <div style="${gS}"><label style="${lS}">Тип инструмента</label>
          <select style="${iS}" onchange="dealField(${d.id},'instrument',this.value)">
            ${['Equity','SAFE','Convertible Note','Mezzanine','Debt'].map(s=>`<option ${d.instrument===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Размер чека фонда ($M)</label>
          <input type="number" style="${iS}" value="${d.checkSize||d.amount||''}"
            onchange="dealField(${d.id},'checkSize',parseFloat(this.value))" /></div>
        <div style="${gS}"><label style="${lS}">Со-инвесторы</label>
          <input style="${iS}" value="${d.coInvestors||''}"
            onchange="dealField(${d.id},'coInvestors',this.value)" placeholder="Название фонда / инвестора" /></div>
        <div style="${gS}"><label style="${lS}">Решение IC</label>
          <select style="${iS}" onchange="dealField(${d.id},'icDecision',this.value);dealField(${d.id},'ic',this.value)">
            ${['Не подано','Подано','На рассмотрении','Одобрено','Отклонено','На доработку'].map(s=>`<option ${d.icDecision===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Дата заседания IC</label>
          <input type="date" style="${iS}" value="${d.icDate||''}"
            onchange="dealField(${d.id},'icDate',this.value)" /></div>
      </div>

      <!-- IC Votes -->
      <div style="font-size:10px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-vote-yea" style="margin-right:5px"></i>Голосование IC
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${!(d.icVotes||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic">Голосование не проведено</div>` :
          d.icVotes.map(v => `
            <div style="background:#0f1623;border-radius:8px;padding:7px 12px;display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:#94a3b8">${v.member}</span>
              ${voteBadge(v.vote)}
            </div>`).join('')}
      </div>

      <!-- Ключевые риски -->
      <div style="font-size:10px;font-weight:700;color:#ef4444;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-exclamation-triangle" style="margin-right:5px"></i>Ключевые риски
      </div>
      ${!(d.icRisks||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет рисков</div>` :
        d.icRisks.map((r,i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <i class="fas fa-dot-circle" style="color:#ef4444;font-size:10px"></i>
            <input style="${iS}" value="${r}"
              onchange="dealRisk(${d.id},${i},this.value)" />
            <button onclick="dealRemoveRisk(${d.id},${i})"
              style="background:none;border:none;color:#64748b;cursor:pointer;font-size:12px">✕</button>
          </div>`).join('')}
      <button onclick="dealAddRisk(${d.id})"
        style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить риск
      </button>

      <!-- ── БЛОК ОТКЛОНЕНИЯ IC (всегда виден на вкладке IC) ── -->
      ${(() => {
        const isRejected = d.stage === 'Отклонена IC' || d.icDecision === 'Отклонено';
        const borderColor = isRejected ? 'rgba(239,68,68,0.4)' : 'rgba(100,116,139,0.2)';
        const headerColor = isRejected ? '#ef4444' : '#64748b';
        const bgColor     = isRejected ? 'rgba(239,68,68,0.07)' : 'rgba(15,22,35,0.6)';
        return `
        <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:14px;margin-top:4px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div style="font-size:10px;font-weight:700;color:${headerColor};text-transform:uppercase">
              <i class="fas fa-times-circle" style="margin-right:5px"></i>Решение об отклонении IC
            </div>
            ${isRejected
              ? `<span style="font-size:9px;padding:2px 8px;border-radius:5px;background:rgba(239,68,68,0.15);color:#f87171;font-weight:700">ОТКЛОНЕНА</span>`
              : `<span style="font-size:9px;color:#475569;font-style:italic">заполняется при отказе</span>`}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div style="${gS}"><label style="${lS}">Причина отказа (категория)</label>
              <select style="${iS}" onchange="dealField(${d.id},'rejectCategory',this.value)">
                <option value="">— выбрать —</option>
                ${['Рынок','Команда','Оценка','Стадия','Продукт','Финансы','Другое'].map(s=>`<option ${d.rejectCategory===s?'selected':''}>${s}</option>`).join('')}
              </select></div>
            <div style="${gS}"><label style="${lS}">Возможность вернуться</label>
              <select style="${iS}" onchange="dealField(${d.id},'canReturn',this.value)">
                <option value="">— выбрать —</option>
                ${['Да','Нет','Через 6 месяцев','Через 12 месяцев','Через 2 года'].map(s=>`<option ${d.canReturn===s?'selected':''}>${s}</option>`).join('')}
              </select></div>
            <div style="${gS}"><label style="${lS}">Дата следующего follow-up</label>
              <input type="date" style="${iS}" value="${d.rejectFollowUpDate||''}"
                onchange="dealField(${d.id},'rejectFollowUpDate',this.value)" /></div>
            <div style="${gS}"><label style="${lS}">Кто принял решение об отказе</label>
              <input style="${iS}" value="${d.rejectDecisionBy||''}"
                onchange="dealField(${d.id},'rejectDecisionBy',this.value)" placeholder="CEO / IC Chair..." /></div>
          </div>
          <div style="${gS}"><label style="${lS}">Детальный комментарий</label>
            <textarea style="${iS};height:70px;resize:none"
              onchange="dealField(${d.id},'rejectComment',this.value)"
              placeholder="Обоснование решения, пожелания к компании...">${d.rejectComment||''}</textarea></div>
        </div>`;
      })()}`;
  }

  else if (_activeDealTab === 'dd') {
    tabContent = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div style="${gS}"><label style="${lS}">Дедлайн DD</label>
          <input type="date" style="${iS}" value="${d.ddDeadline||''}"
            onchange="dealField(${d.id},'ddDeadline',this.value)" /></div>
        <div style="${gS}"><label style="${lS}">Юрист фонда</label>
          <input style="${iS}" value="${d.tsFundLawyer||''}"
            onchange="dealField(${d.id},'tsFundLawyer',this.value)" placeholder="Dentons / GRATA..." /></div>
      </div>

      <!-- ── DATA ROOM ── -->
      <div style="margin-bottom:16px;padding:12px 14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:9px">
        <label style="${lS}"><i class="fas fa-database" style="margin-right:5px;color:#60a5fa"></i>Data Room — ссылка для DD</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <input style="${iS}" value="${d.dataRoomUrl||''}" placeholder="https://dataroom.intralinks.com/..."
            onchange="dealField(${d.id},'dataRoomUrl',this.value)" />
          ${d.dataRoomUrl ? `<button onclick="window.open('${(d.dataRoomUrl||'').replace(/'/g,"\\'")}','_blank')"
            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-external-link-alt" style="margin-right:4px"></i>Открыть</button>` : ''}
        </div>
      </div>
      ${ddBlock('Юридическое DD', d.ddLegal, '#3b82f6')}
      ${ddBlock('Финансовое DD',  d.ddFinancial, '#22c55e')}
      ${ddBlock('Техническое DD', d.ddTech, '#8b5cf6')}
      ${ddBlock('Коммерческое DD',d.ddCommercial, '#f97316')}

      ${(d.ddRedFlags||[]).length ? `
        <div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="font-size:10px;font-weight:700;color:#ef4444;margin-bottom:6px">
            <i class="fas fa-flag" style="margin-right:5px"></i>RED FLAGS
          </div>
          ${d.ddRedFlags.map(f=>`<div style="font-size:11px;color:#fca5a5;padding:3px 0">⚠ ${f}</div>`).join('')}
        </div>` : ''}

      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-user-tie" style="margin-right:5px"></i>Внешние консультанты
      </div>
      ${!(d.ddConsultants||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic">Нет консультантов</div>` :
        d.ddConsultants.map(c => `
          <div style="display:flex;gap:10px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px;align-items:center">
            <span style="font-size:12px;font-weight:600;color:#e2e8f0;flex:1">${c.name}</span>
            <span style="font-size:10px;color:#64748b">${c.role}</span>
            <span style="font-size:10px;font-weight:700;color:${c.status==='Завершено'?'#22c55e':'#f97316'}">${c.status}</span>
          </div>`).join('')}`;
  }

  else if (_activeDealTab === 'negotiation_DISABLED') {
    const showTS = ['Term Sheet','Переговоры','Закрыта'].includes(d.stage);
    tabContent = `
      ${showTS ? `
      <div style="background:#0f1623;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:#eab308;text-transform:uppercase;margin-bottom:10px">Term Sheet — Условия</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div><label style="${lS}">Pre-money ($M)</label>
            <input type="number" style="${iS}" value="${d.tsPreMoney||''}"
              onchange="dealField(${d.id},'tsPreMoney',parseFloat(this.value))" /></div>
          <div><label style="${lS}">Post-money ($M)</label>
            <input type="number" style="${iS}" value="${d.tsPostMoney||''}"
              onchange="dealField(${d.id},'tsPostMoney',parseFloat(this.value))" /></div>
          <div><label style="${lS}">Доля фонда (%)</label>
            <input type="number" style="${iS}" value="${d.tsFundShare||''}"
              onchange="dealField(${d.id},'tsFundShare',parseFloat(this.value))" /></div>
        </div>
        <div style="${gS}"><label style="${lS}">Права фонда (Board seat, Pro-rata, Anti-dilution...)</label>
          <textarea style="${iS};height:55px;resize:none"
            onchange="dealField(${d.id},'tsRights',this.value)">${d.tsRights||''}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="${lS}">Вестинг основателей</label>
            <input style="${iS}" value="${d.tsVesting||''}"
              onchange="dealField(${d.id},'tsVesting',this.value)" /></div>
          <div><label style="${lS}">Статус TS</label>
            <select style="${iS}" onchange="dealField(${d.id},'tsStatus',this.value)">
              ${['Не начат','На переговорах','Подписан','Отклонён'].map(s=>`<option ${d.tsStatus===s?'selected':''}>${s}</option>`).join('')}
            </select></div>
          <div><label style="${lS}">Юрист фонда</label>
            <input style="${iS}" value="${d.tsFundLawyer||''}"
              onchange="dealField(${d.id},'tsFundLawyer',this.value)" /></div>
          <div><label style="${lS}">Юрист компании</label>
            <input style="${iS}" value="${d.tsCompanyLawyer||''}"
              onchange="dealField(${d.id},'tsCompanyLawyer',this.value)" /></div>
        </div>
      </div>` : `<div style="font-size:12px;color:#64748b;margin-bottom:14px;font-style:italic">
        Term Sheet становится доступен на стадии «Term Sheet» и далее</div>`}

      <!-- Спорные пункты -->
      ${(d.negDisputedItems||[]).length ? `
        <div style="background:rgba(249,115,22,0.07);border:1px solid rgba(249,115,22,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px">
          <div style="font-size:10px;font-weight:700;color:#f97316;margin-bottom:6px">Спорные пункты</div>
          ${d.negDisputedItems.map(x=>`<div style="font-size:11px;color:#fdba74;padding:2px 0">• ${x}</div>`).join('')}
        </div>` : ''}

      <!-- Лог встреч -->
      <div style="font-size:10px;font-weight:700;color:#3b82f6;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-calendar-alt" style="margin-right:5px"></i>Лог встреч / звонков
      </div>
      ${!(d.negMeetings||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Встреч нет</div>` :
        [...d.negMeetings].reverse().map(m => `
          <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-bottom:7px">
            <div style="display:flex;justify-content:space-between;margin-bottom:5px">
              <span style="font-size:11px;font-weight:700;color:#e2e8f0">${m.date}</span>
              <span style="font-size:10px;color:#64748b">${m.participants}</span>
            </div>
            <div style="font-size:11px;color:#94a3b8">${m.outcome}</div>
          </div>`).join('')}
      <button onclick="dealAddMeeting(${d.id})"
        style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);color:#60a5fa;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить встречу
      </button>

      <!-- Планируемая дата закрытия -->
      <div style="${gS}"><label style="${lS}">Планируемая дата закрытия</label>
        <input type="date" style="${iS}" value="${d.closingDatePlanned||''}"
          onchange="dealField(${d.id},'closingDatePlanned',this.value)" /></div>

      <!-- Закрытие -->
      ${d.stage === 'Закрыта' ? `
        <div style="background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px;margin-top:4px">
          <div style="font-size:10px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:10px">
            <i class="fas fa-check-circle" style="margin-right:5px"></i>Параметры закрытой сделки
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div><label style="${lS}">Дата закрытия</label>
              <input type="date" style="${iS}" value="${d.closedDate||''}"
                onchange="dealField(${d.id},'closedDate',this.value)" /></div>
            <div><label style="${lS}">Финальная сумма ($M)</label>
              <input type="number" style="${iS}" value="${d.closedAmount||''}"
                onchange="dealField(${d.id},'closedAmount',parseFloat(this.value))" /></div>
            <div><label style="${lS}">Дата перевода (Wire)</label>
              <input type="date" style="${iS}" value="${d.wireDate||''}"
                onchange="dealField(${d.id},'wireDate',this.value)" /></div>
            <div><label style="${lS}">Первый Board Meeting</label>
              <input type="date" style="${iS}" value="${d.firstBoardMeeting||''}"
                onchange="dealField(${d.id},'firstBoardMeeting',this.value)" /></div>
          </div>
          <div style="margin-top:10px"><label style="${lS}">KPI на 6 месяцев</label>
            <input style="${iS}" value="${d.kpi6m||''}"
              onchange="dealField(${d.id},'kpi6m',this.value)" /></div>
          <div style="margin-top:8px"><label style="${lS}">KPI на 12 месяцев</label>
            <input style="${iS}" value="${d.kpi12m||''}"
              onchange="dealField(${d.id},'kpi12m',this.value)" /></div>
        </div>` : ''}`;
  }

  else if (_activeDealTab === 'history') {
    tabContent = `
      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">
          <i class="fas fa-comment-dots" style="margin-right:5px;color:#3b82f6"></i>История комментариев (${(d.comments||[]).length})
        </div>
        ${!(d.comments||[]).length ? `<div style="font-size:12px;color:#475569;font-style:italic;padding:16px 0;text-align:center">Комментариев нет</div>` :
          [...(d.comments||[])].reverse().map(c => `
            <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:7px">
                  <div style="width:26px;height:26px;border-radius:50%;background:rgba(59,130,246,0.2);
                    display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#60a5fa">
                    ${c.author.charAt(0)}
                  </div>
                  <span style="font-size:12px;font-weight:700;color:#e2e8f0">${c.author}</span>
                </div>
                <span style="font-size:10px;color:#64748b">${c.date}</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.6">${c.text}</div>
            </div>`).join('')}
      </div>
      <div style="background:#0f1623;border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">Новый комментарий</div>
        <select id="comment_author_${d.id}" style="${iS};margin-bottom:8px">
          ${['CEO','Investment Manager','CFO','Analyst','Board Member'].map(r=>`<option>${r}</option>`).join('')}
        </select>
        <textarea id="comment_text_${d.id}" rows="3" style="${iS};height:70px;resize:none;margin-bottom:8px"
          placeholder="Комментарий по сделке..."></textarea>
        <button onclick="dealAddComment(${d.id})"
          style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
            padding:6px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-paper-plane" style="margin-right:5px"></i>Добавить
        </button>
      </div>`;
  }

  /* ── Progress bar по этапам ── */
  const stageOrder = ['Скрининг','IC Review','Due Diligence','Term Sheet','Переговоры','Закрыта'];
  const stageIdx   = stageOrder.indexOf(d.stage);
  const progressPct = d.stage === 'Отклонена IC' ? 0
    : stageIdx >= 0 ? Math.round((stageIdx + 1) / stageOrder.length * 100) : 0;

  document.getElementById('dealDetailContent').innerHTML = `
    <!-- ── HEADER ── -->
    <div style="padding:20px 24px 0;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#1c2333;z-index:10">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h2 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0">${d.company}</h2>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;
              background:${stageColor}22;color:${stageColor};border:1px solid ${stageColor}44">
              ${d.stage}
            </span>
            <span style="font-size:10px;padding:2px 8px;border-radius:5px;
              background:${d.priority==='Высокий'?'rgba(239,68,68,0.1)':d.priority==='Средний'?'rgba(249,115,22,0.1)':'rgba(100,116,139,0.1)'};
              color:${d.priority==='Высокий'?'#f87171':d.priority==='Средний'?'#fb923c':'#64748b'}">
              ● ${d.priority}
            </span>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px">
            ${d.sector} · ${d.country||''} · ${currencySymbol(currencyForEntity(d))}${d.amount}M · ${d.type}
            ${d.preMoney ? ` · pre-money ${currencySymbol(currencyForEntity(d))}${d.preMoney}M` : ''}
            · <span style="color:#94a3b8">${d.manager}</span>
          </div>
          ${d.stage !== 'Отклонена IC' ? `
          <div style="display:flex;align-items:center;gap:6px;margin-top:8px">
            <div style="flex:1;height:4px;background:#0f1623;border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${progressPct}%;background:${stageColor};border-radius:2px;transition:width 0.4s"></div>
            </div>
            <span style="font-size:10px;color:#64748b;white-space:nowrap">${progressPct}%</span>
          </div>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
          <select onchange="dealMoveStage(${d.id},this.value)"
            style="background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:5px 8px;color:#e2e8f0;font-size:11px;cursor:pointer">
            ${['Скрининг','IC Review','Due Diligence','Term Sheet','Переговоры','Закрыта','Отклонена IC'].map(s=>`
              <option value="${s}" ${d.stage===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <button onclick="closeDealDetailModal()"
            style="background:#1c2333;border:1px solid #2a3448;color:#64748b;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div style="display:flex;gap:2px;overflow-x:auto;padding-bottom:0">
        ${tabs.map(t => `
          <button onclick="switchDealTab('${t.id}',${d.id})"
            style="padding:8px 14px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:11px;font-weight:700;
              white-space:nowrap;transition:all 0.15s;
              background:${'_activeDealTab'==='${t.id}'?'#0f1623':'transparent'};
              ${_activeDealTab===t.id ? 'background:#0f1623;color:#f1f5f9;border-bottom:2px solid '+stageColor : 'background:transparent;color:#64748b;border-bottom:2px solid transparent'}">
            <i class="fas ${t.icon}" style="margin-right:5px"></i>${t.label}
          </button>`).join('')}
      </div>
    </div>

    <!-- ── TAB CONTENT ── -->
    <div style="padding:20px 24px 24px">
      ${tabContent}
    </div>
  `;
}

/* ── Deal helper functions ── */
function dealField(id, field, value) {
  const d = deals.find(x => x.id === id);
  if (d) { d[field] = value; renderPipeline(deals); }
}

function dealMoveStage(id, stage) {
  const d = deals.find(x => x.id === id);
  if (!d) return;

  // Closing a deal means capital gets deployed — never let that happen
  // without IC approval on record, regardless of which stage the deal is
  // currently sitting in. icDecision/ic are kept in sync by the manual
  // dropdown (js/app.js:1171-1172) but the real IC vote flow
  // (castICVote, js/modules.js) only ever sets `ic` — check both.
  if (stage === 'Закрыта' && d.ic !== 'Одобрено' && d.icDecision !== 'Одобрено') {
    showToast(`⛔ Нельзя закрыть сделку без одобрения IC (текущее решение IC: ${d.ic || d.icDecision || 'Не подано'})`, 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  d.stage = stage;
  d.updatedAt = today();
  showToast(`✅ ${d.company} → ${stage}`, 'green');
  _renderDealModal(d);
  renderPipeline(deals);
}

function dealAddRisk(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  d.icRisks = d.icRisks || [];
  d.icRisks.push('Новый риск');
  _renderDealModal(d);
}
function dealRisk(id, i, val) {
  const d = deals.find(x => x.id === id);
  if (d && d.icRisks) d.icRisks[i] = val;
}
function dealRemoveRisk(id, i) {
  const d = deals.find(x => x.id === id);
  if (d && d.icRisks) { d.icRisks.splice(i,1); _renderDealModal(d); }
}

function cycleDDStatus(id, blockTitle, idx) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const map = {'Юридическое DD':'ddLegal','Финансовое DD':'ddFinancial','Техническое DD':'ddTech','Коммерческое DD':'ddCommercial'};
  const key = map[blockTitle];
  if (!key || !d[key] || !d[key][idx]) return;
  const cycle = ['Запрошен','Получен','В процессе','OK','Red Flag'];
  const cur = d[key][idx].status;
  d[key][idx].status = cycle[(cycle.indexOf(cur)+1) % cycle.length];
  _renderDealModal(d);
}

function dealAddComment(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const author = document.getElementById(`comment_author_${id}`)?.value || 'CEO';
  const text   = document.getElementById(`comment_text_${id}`)?.value?.trim();
  if (!text) { showToast('⚠ Введите текст комментария', 'red'); return; }
  d.comments = d.comments || [];
  d.comments.push({ id: Date.now(), author, date: today(), text });
  _activeDealTab = 'history';
  _renderDealModal(d);
  showToast('✅ Комментарий добавлен', 'green');
}

function dealAddMeeting(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  d.negMeetings = d.negMeetings || [];
  d.negMeetings.push({ date: today(), participants: '', outcome: '' });
  _renderDealModal(d);
}

function addTSVersion(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const n = (d.tsVersions||[]).length + 1;
  d.tsVersions = [...(d.tsVersions||[]), { v:`v${n}`, date: today(), url:'' }];
  _renderDealModal(d);
}

function dealTSVersionUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (d && d.tsVersions && d.tsVersions[i]) d.tsVersions[i].url = url;
}

function addSignedDoc(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const name = prompt('Название документа (SHA, SPA, SAFE...):');
  if (!name) return;
  d.signedDocsUrls = [...(d.signedDocsUrls||[]), { name, url:'' }];
  _renderDealModal(d);
}

function dealSignedDocUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (d && d.signedDocsUrls && d.signedDocsUrls[i]) d.signedDocsUrls[i].url = url;
}

function addFounderContact(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  d.founderContacts = [...(d.founderContacts||[]), { role:'', name:'', phone:'', email:'' }];
  _renderDealModal(d);
}

/* ── TS version delete ── */
function deleteTSVersion(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.tsVersions) return;
  if (!confirm(`Удалить версию TS "${d.tsVersions[i]?.v}"?`)) return;
  d.tsVersions.splice(i, 1);
  _renderDealModal(d);
}

/* ── Signed doc delete ── */
function deleteSignedDoc(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.signedDocsUrls) return;
  if (!confirm(`Удалить документ "${d.signedDocsUrls[i]?.name}"?`)) return;
  d.signedDocsUrls.splice(i, 1);
  _renderDealModal(d);
}

/* ── Other docs: add / update name / update url / delete ── */
function addOtherDoc(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  d.otherDocs = [...(d.otherDocs||[]), { name:'', url:'' }];
  _renderDealModal(d);
}
function dealOtherDocName(id, i, val) {
  const d = deals.find(x => x.id === id);
  if (d && d.otherDocs && d.otherDocs[i]) d.otherDocs[i].name = val;
}
function dealOtherDocUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (d && d.otherDocs && d.otherDocs[i]) d.otherDocs[i].url = url;
}
function deleteOtherDoc(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.otherDocs) return;
  d.otherDocs.splice(i, 1);
  _renderDealModal(d);
}

function filterDeals(search) {
  const q = (search || document.getElementById('searchDeals').value || '').toLowerCase();
  const stage = document.getElementById('filterDealStage').value;
  const filtered = deals.filter(d => {
    const mq = !q
      || d.company.toLowerCase().includes(q)
      || (d.sector||'').toLowerCase().includes(q)
      || (d.description||'').toLowerCase().includes(q)
      || (d.country||'').toLowerCase().includes(q)
      || (d.tags||[]).some(t => t.toLowerCase().includes(q));
    const ms = !stage || d.stage === stage;
    return mq && ms;
  });
  renderPipeline(filtered);
}

async function saveDeal() {
  const company  = document.getElementById('deal_company').value.trim();
  const sector   = document.getElementById('deal_sector').value;
  const stage    = document.getElementById('deal_stage').value;
  const amount   = parseFloat(document.getElementById('deal_amount').value) || 0;
  const type     = document.getElementById('deal_type').value;
  const priority = document.getElementById('deal_priority').value;
  const manager  = document.getElementById('deal_manager').value;
  const ic       = document.getElementById('deal_ic').value;
  const description = document.getElementById('deal_comment').value.trim();

  if (!company) { alert('Введите название компании'); return; }

  const newDeal = {
    fundId: typeof activeFundId !== 'undefined' ? activeFundId : null,
    // ── Core (from form) ──
    company, sector, stage, amount,
    type, priority, manager,
    ic: ic || 'Не подано',

    // ── Overview fields ──
    country: '', companyStage: 'Growth Stage', dealSource: 'Inbound',
    description, revenue: '', roundSize: '',
    checkSize: amount || 0,
    pitchDeckUrl: '',
    firstContactDate: today(),
    updatedAt: today(),
    nextAction: '', nextActionDate: '',
    tags: [],

    // ── IC Review ──
    icMemoUrl: '', icMinutesUrl: '',
    preMoney: 0, instrument: type || 'Equity',
    coInvestors: '',
    icRisks: [],
    icDecision: ic || 'Не подано',
    icDate: '', 
    icVotes: [],

    // ── Due Diligence ──
    ddDeadline: '',
    dataRoomUrl: '',
    ddLegal:     [],
    ddFinancial: [],
    ddTech:      [],
    ddCommercial:[],
    ddConsultants: [],
    ddRedFlags:  [],

    // ── Term Sheet ──
    tsPreMoney: 0, tsPostMoney: 0, tsFundShare: 0,
    tsRights: '', tsVesting: '',
    tsSignedDate: '', tsStatus: 'Не начат',
    tsVersions: [],
    tsFundLawyer: '', tsCompanyLawyer: '',

    // ── Documents ──
    signedDocsUrls: [],
    wireDate: '', wireConfirmUrl: '',
    otherDocs: [],

    // ── Negotiations ──
    negMeetings: [], negDisputedItems: [],
    negBlockers: [],
    closingDatePlanned: '',

    // ── Closed deal ──
    closedDate: '', closedAmount: 0, closedValuation: 0,
    founderContacts: [],
    firstBoardMeeting: '', kpi6m: '', kpi12m: '',

    // ── Rejected ──
    rejectCategory: '', rejectComment: '',
    canReturn: '',
    rejectFollowUpDate: '', rejectDecisionBy: '',

    // ── Comments / history ──
    comments: [],
  };

  try {
    const created = await apiFetch('/api/deals', { method: 'POST', body: JSON.stringify(newDeal) });
    deals.push({ ...newDeal, ...created });
    renderPipeline(deals);
    updateBadges();
    closeModal();
    showToast('✅ Сделка добавлена в pipeline');
    ['deal_company','deal_amount','deal_comment'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить сделку: ' + err.message, 'red');
  }
}


/* ===== PORTFOLIO ===== */
async function savePortfolio() {
  const name        = document.getElementById('port_name').value.trim();
  const sector      = document.getElementById('port_sector').value;
  const stage       = document.getElementById('port_stage').value;
  const invested    = parseFloat(document.getElementById('port_invested').value) || 0;
  const value       = parseFloat(document.getElementById('port_value').value) || 0;
  const date        = document.getElementById('port_date').value || today();
  const exitStrategy= document.getElementById('port_exit').value;
  const exitYear    = parseInt(document.getElementById('port_exit_year').value) || null;

  if (!name) { alert('Введите название компании'); return; }

  const moic  = invested > 0 ? Math.round((value / invested) * 100) / 100 : 0;

  const newPortco = {
    fundId: typeof activeFundId !== 'undefined' ? activeFundId : null,
    name, sector, stage,
    bin: '', invested, value, date, exitStrategy, exitYear, moic,
    fundShare: 0, manager: currentUserDisplayName(), status: 'Active',
    nextAction: '', nextActionDate: '',
    lastUpdated: today(),

    financials: {
      quarters: [],
      revenue:   { plan: [], actual: [] },
      ebitda:    { plan: [], actual: [] },
      netProfit: { plan: [], actual: [] },
      employees: { plan: [], actual: [] },
      avgSalary: 0, taxContrib: 0,
      totalDebt: 0, fundDebt: 0, debtService: 0,
      collateral: '', collateralVal: 0, collateralStatus: '',
      covenants: [],
      overduePayment: false, overdueAmount: 0,
      paymentSchedule: [],
    },
    monitoring: {
      lastVisitDate: '',
      frequency: 'Ежеквартально',
      meetings: [],
      reportReceivedDate: '',
      auditStatus: 'Не начат',
      covenantViolations: '',
      riskLevel: 'Низкий',
      riskComment: '',
    },
    documents: {
      driveUrl: '',
      files: [],
    },
    compliance: {
      programName: '', programType: '', subsidizedRate: 0, grantAmount: 0, grantConditions: '',
      programs: [],
      reportingDeadlines: [],
      esg: {
        jobsCreatedPlan: 0, jobsCreatedActual: 0, jobsPreservedPlan: 0, jobsPreservedActual: 0,
        womenLeadership: false, womenPct: 0, regionType: '',
        environmentalNotes: '', socialImpact: '',
      },
    },
    exit: {
      exitType: exitStrategy, plannedDate: exitYear ? `${exitYear}-Q4` : '',
      targetValuation: 0, prepProgress: 0,
      checklist: [
        { item:'Финансовый аудит завершён', done:false },
        { item:'Юридическая структура очищена', done:false },
        { item:'Management team готова', done:false },
        { item:'Финансовая модель подготовлена', done:false },
        { item:'Потенциальные покупатели определены', done:false },
      ],
      buyers: [], notes: '',
    },
    history: [
      { type:'status', date: today(), author:'System', text:'Статус изменён: Active' },
    ],
  };

  try {
    const created = await apiFetch('/api/portfolio', { method: 'POST', body: JSON.stringify(newPortco) });
    portfolio.push({ ...newPortco, ...created });
    renderPortfolio(portfolio);
    updateBadges();
    closeModal();
    showToast(`✅ Компания добавлена в портфель: ${name}`);
    ['port_name','port_invested','port_value','port_date','port_exit_year'].forEach(id => document.getElementById(id).value = '');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить компанию: ' + err.message, 'red');
  }
}

let portfolioView = 'grid';
let _activePortTab = 'financials';
let _portChartRevenue = null;
let _portChartEbitda  = null;

function setPortfolioView(view, btnEl) {
  portfolioView = view;
  if (btnEl) {
    const group = btnEl.parentElement;
    if (group) group.querySelectorAll('.vt-btn').forEach(b => b.classList.toggle('active', b === btnEl));
  }
  renderPortfolio(portfolio);
}

function filterPortfolio(search) {
  const q = (search || '').toLowerCase();
  const filtered = portfolio.filter(p => {
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q)
      || (p.sector || '').toLowerCase().includes(q)
      || (p.manager || '').toLowerCase().includes(q);
  });
  renderPortfolio(filtered);
}

function deletePortfolioItem(id) {
  if (!confirm('Удалить компанию из портфеля?')) return;
  portfolio = portfolio.filter(p => p.id !== id);
  renderPortfolio(portfolio);
  updateBadges();
  showToast('🗑️ Компания удалена из портфеля', 'red');
}

/* ── Auto-status calculation ── */
function portAutoStatus(p) {
  if (!p.financials) return p.status || 'Active';
  const ov = p.financials.overduePayment;
  const days = ov ? 91 : 0; // simplified: if overdue flag set check amount context
  if (p.financials.overdueAmount > 0) {
    const oldest = (p.financials.paymentSchedule || []).find(s => s.status === 'Просрочен');
    if (oldest) {
      const diff = (new Date() - new Date(oldest.date)) / 86400000;
      if (diff > 90) return 'Problem';
      if (diff > 30) return 'Monitoring';
    }
  }
  return p.status || 'Active';
}

function portStatusColor(s) {
  return s === 'Active' ? '#22c55e' : s === 'Monitoring' ? '#eab308' : '#ef4444';
}
function portStatusLabel(s) {
  return s === 'Active' ? 'Активный' : s === 'Monitoring' ? 'Под мониторингом' : '⚠ Проблемный';
}

/* ── MOIC auto-calc ── */
function portMOIC(p) {
  return p.invested > 0 ? Math.round((p.value / p.invested) * 100) / 100 : 0;
}

/* ── Doc badge: count missing required docs ── */
function portDocBadge(p) {
  const required = ['SHA / Кредитное соглашение','Залоговые документы'];
  const have = (p.documents?.files || []).map(f => f.type);
  return required.filter(r => !have.some(h => h.includes(r.split(' ')[0]))).length;
}

/* ── Days since last contact ── */
function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((new Date() - new Date(dateStr)) / 86400000);
}

function renderPortfolio(data) {
  const container = document.getElementById('portfolioGrid');
  if (typeof activeFundId !== 'undefined' && activeFundId != null) {
    data = data.filter(p => p.fundId === activeFundId);
  }
  if (portfolioView === 'grid') {
    container.className = 'portfolio-grid';
    container.innerHTML = data.map((p, idx) => {
      const st    = portAutoStatus(p);
      const stCol = portStatusColor(st);
      const moic  = portMOIC(p);
      const moicColor = moic >= 2 ? '#22c55e' : moic >= 1.5 ? '#60a5fa' : moic >= 1 ? '#f97316' : '#ef4444';
      const docBad= portDocBadge(p);
      const dsL   = daysSince(p.monitoring?.lastVisitDate);
      const overdue = p.financials?.overduePayment;
      const naDate= p.nextActionDate;
      const naOverdue = naDate && new Date(naDate) < new Date();

      return `
        <div class="portfolio-card" onclick="openPortfolioModal(${p.id})" style="cursor:pointer;position:relative">
          <!-- Status indicator strip -->
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${stCol};border-radius:10px 10px 0 0"></div>

          <div class="port-card-header" style="padding-top:10px">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div class="port-card-logo" style="background:${getColor(idx)};flex-shrink:0">${p.name.charAt(0)}</div>
                <div>
                  <div class="port-card-name">${p.name}</div>
                  <div style="font-size:10px;color:#64748b">BIN: ${p.bin||'—'} · ${p.sector}</div>
                </div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;
                background:${stCol}22;color:${stCol};border:1px solid ${stCol}44">${portStatusLabel(st)}</span>
              ${docBad > 0 ? `<span style="font-size:9px;padding:1px 6px;border-radius:5px;background:rgba(239,68,68,0.15);color:#f87171;font-weight:700">📄 ${docBad} документ(а)</span>` : ''}
            </div>
          </div>

          <div class="port-card-body">
            <div class="port-metric">
              <span class="port-metric-label">Инвестировано</span>
              <span class="port-metric-value">${currencySymbol(currencyForEntity(p))}${p.invested}M</span>
            </div>
            <div class="port-metric">
              <span class="port-metric-label">Текущая стоимость</span>
              <span class="port-metric-value" style="color:#22c55e">${currencySymbol(currencyForEntity(p))}${p.value}M</span>
            </div>
            <div class="port-metric">
              <span class="port-metric-label">Доля фонда</span>
              <span class="port-metric-value">${p.fundShare||'—'}%</span>
            </div>
            <div class="port-metric">
              <span class="port-metric-label">MOIC</span>
              <span class="port-metric-value" style="color:${moicColor};font-size:15px;font-weight:800">${moic}x</span>
            </div>
          </div>

          <!-- Next action strip -->
          ${p.nextAction ? `
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;
            background:${naOverdue?'rgba(239,68,68,0.1)':'#0f1623'};
            border-radius:7px;margin-top:6px;
            border:1px solid ${naOverdue?'rgba(239,68,68,0.3)':'transparent'}">
            <i class="fas fa-bolt" style="color:${naOverdue?'#ef4444':'#eab308'};font-size:9px"></i>
            <span style="font-size:10px;color:${naOverdue?'#fca5a5':'#94a3b8'};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nextAction}</span>
            ${naDate?`<span style="font-size:9px;color:${naOverdue?'#ef4444':'#64748b'};white-space:nowrap">${naDate}</span>`:''}
          </div>` : ''}

          <!-- Manager + last contact -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:10px;color:#5a6b8a">
            <span><i class="fas fa-user" style="margin-right:3px"></i>${p.manager}</span>
            <span style="color:${dsL>60?'#ef4444':dsL>30?'#eab308':'#64748b'}">
              ${dsL<999 ? `${dsL}д назад` : '—'}
            </span>
          </div>

          ${overdue ? `<div style="margin-top:6px;font-size:10px;font-weight:700;color:#ef4444;
            padding:4px 8px;background:rgba(239,68,68,0.1);border-radius:5px;text-align:center">
            ⚠ Просрочка ${fmtCurrency(p.financials.overdueAmount, currencyForEntity(p))}
          </div>` : ''}
        </div>`;
    }).join('');
  } else {
    container.className = 'portfolio-list';
    container.innerHTML = data.map((p, idx) => {
      const st = portAutoStatus(p); const stCol = portStatusColor(st);
      const moic = portMOIC(p);
      return `
      <div class="portfolio-list-item" onclick="openPortfolioModal(${p.id})" style="cursor:pointer">
        <div style="width:34px;height:34px;border-radius:8px;background:${getColor(idx)};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff">${p.name.charAt(0)}</div>
        <div><strong>${p.name}</strong><div style="font-size:11px;color:var(--text-muted)">${p.sector}</div></div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:${stCol}22;color:${stCol}">${portStatusLabel(st)}</span>
        <div style="font-weight:700">${currencySymbol(currencyForEntity(p))}${p.invested}M</div>
        <div style="color:#22c55e;font-weight:700">${currencySymbol(currencyForEntity(p))}${p.value}M</div>
        <div style="color:#60a5fa;font-weight:800">${moic}x</div>
        <div>${p.exitStrategy} · ${p.exitYear}</div>
        <div class="action-btns">
          <button class="act-btn del" onclick="event.stopPropagation();deletePortfolioItem(${p.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }
}

/* ══════════════════════════════════════════════
   PORTFOLIO DETAIL MODAL
══════════════════════════════════════════════ */
function openPortfolioModal(portId) {
  const p = portfolio.find(x => x.id === portId);
  if (!p) return;
  _activePortTab = 'financials';
  _renderPortfolioModal(p);
  document.getElementById('portDetailOverlay').style.display = 'block';
  document.getElementById('modal-port-detail').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePortfolioModal() {
  document.getElementById('portDetailOverlay').style.display = 'none';
  document.getElementById('modal-port-detail').style.display = 'none';
  document.body.style.overflow = '';
  if (_portChartRevenue) { _portChartRevenue.destroy(); _portChartRevenue = null; }
  if (_portChartEbitda)  { _portChartEbitda.destroy();  _portChartEbitda  = null; }
}

function switchPortTab(tab, portId) {
  _activePortTab = tab;
  const p = portfolio.find(x => x.id === portId);
  if (p) _renderPortfolioModal(p);
}

function portField(id, field, value) {
  const p = portfolio.find(x => x.id === id);
  if (p) { p[field] = value; p.lastUpdated = today(); renderPortfolio(portfolio); }
}

function _renderPortfolioModal(p) {
  const st = portAutoStatus(p);
  const stCol = portStatusColor(st);
  const moic = portMOIC(p);
  const f = p.financials || {};
  const mon = p.monitoring || {};
  const docs = p.documents || { files:[] };
  const comp = p.compliance || {};
  const ex = p.exit || {};
  const hist = p.history || [];

  const iS = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;
  const lS = `font-size:10px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:3px;text-transform:uppercase`;
  const gS = `margin-bottom:12px`;

  /* ── Auto-flags ── */
  const ebitdaAct = (f.ebitda?.actual || []);
  const lastEbitda = ebitdaAct[ebitdaAct.length-1] || 0;
  const debtEbitda = lastEbitda > 0 ? (f.totalDebt||0) / (lastEbitda * 4 * 1000000 / 1000000) : 0;
  const dscr = (f.debtService||0) > 0 ? ((lastEbitda * 4 * 1000000) / (f.debtService||1)) : 0;
  const flagDebtEbitda = debtEbitda > 4;
  const flagDSCR = dscr > 0 && dscr < 1.2;
  const docBadge = portDocBadge(p);

  const tabs = [
    { id:'financials',  icon:'fa-chart-bar',      label:'Финансы',       badge: (flagDebtEbitda||flagDSCR) ? '⚠' : '' },
    { id:'monitoring',  icon:'fa-eye',             label:'Мониторинг',    badge: '' },
    { id:'documents',   icon:'fa-folder',          label:'Документы',     badge: docBadge > 0 ? docBadge : '' },
    { id:'compliance',  icon:'fa-shield-alt',      label:'Соответствие',  badge: '' },
    { id:'exit',        icon:'fa-sign-out-alt',    label:'Выход',         badge: '' },
    { id:'history',     icon:'fa-history',         label:'История',       badge: '' },
  ];

  let tabContent = '';

  /* ══ TAB 1: FINANCIALS ══ */
  if (_activePortTab === 'financials') {
    const qs = f.quarters || [];
    const revAct  = f.revenue?.actual  || [];
    const revPlan = f.revenue?.plan    || [];
    const ebAct   = f.ebitda?.actual   || [];
    const ebPlan  = f.ebitda?.plan     || [];
    const npAct   = f.netProfit?.actual || [];
    const npPlan  = f.netProfit?.plan   || [];
    const empAct  = f.employees?.actual || [];
    const empPlan = f.employees?.plan   || [];

    // Single currency-honest formatter, derived from this company's own
    // fund (p.fundId) — replaces the old fmtM/fmtKZT pair, which hardcoded
    // $ and ₸ independently of each other (fmtM even switched currency by
    // the amount's MAGNITUDE, not by what currency it's actually in) and
    // is exactly the bug that showed the same overdue-debt figure as $
    // on the card and ₸ here.
    const fmt = v => fmtCurrency(v, currencyForEntity(p));

    const qTableRow = (label, act, plan, unit='$K') => `
      <tr style="border-bottom:1px solid #1a2335">
        <td style="padding:6px 10px;font-size:11px;color:#94a3b8;font-weight:600">${label}</td>
        ${qs.map((_,i) => {
          const a=act[i]||0, pl=plan[i]||0;
          const col = a >= pl ? '#22c55e' : '#ef4444';
          return `<td style="padding:6px 8px;text-align:right;font-size:11px;color:${col};font-weight:700">${a}</td>
                  <td style="padding:6px 8px;text-align:right;font-size:11px;color:#475569">${pl}</td>`;
        }).join('')}
      </tr>`;

    tabContent = `
      <!-- ── KPI CARDS ── -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
        ${[
          { label:'MOIC',          val:`${moic}x`,                     color: moic>=2?'#22c55e':moic>=1?'#f97316':'#ef4444', icon:'fa-chart-line' },
          { label:'Debt/EBITDA',   val: debtEbitda>0?`${debtEbitda.toFixed(1)}x`:'—', color:flagDebtEbitda?'#ef4444':'#22c55e', icon:'fa-balance-scale' },
          { label:'DSCR',          val: dscr>0?`${dscr.toFixed(2)}x`:'—',             color:flagDSCR?'#ef4444':'#22c55e',      icon:'fa-shield-alt' },
          { label:'Просрочка',     val: f.overduePayment ? fmt(f.overdueAmount) : '✓ Нет', color:f.overduePayment?'#ef4444':'#22c55e', icon:'fa-exclamation-circle' },
        ].map(c=>`
          <div style="background:#0f1623;border:1px solid ${c.color}33;border-radius:10px;padding:12px;text-align:center">
            <i class="fas ${c.icon}" style="color:${c.color};font-size:14px;margin-bottom:4px;display:block"></i>
            <div style="font-size:18px;font-weight:800;color:${c.color}">${c.val}</div>
            <div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">${c.label}</div>
            ${c.label==='Debt/EBITDA'&&flagDebtEbitda?`<div style="font-size:9px;color:#ef4444;margin-top:3px">⚠ > 4.0x</div>`:''}
            ${c.label==='DSCR'&&flagDSCR?`<div style="font-size:9px;color:#ef4444;margin-top:3px">⚠ < 1.2x</div>`:''}
          </div>`).join('')}
      </div>

      <!-- ── QUARTERLY TABLE ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-table" style="margin-right:5px"></i>Квартальные показатели (Факт / План, $K)
      </div>
      <div style="overflow-x:auto;margin-bottom:14px">
        <table style="width:100%;border-collapse:collapse;min-width:500px">
          <thead>
            <tr style="background:#0a1120">
              <th style="padding:7px 10px;text-align:left;font-size:10px;color:#475569;font-weight:700">Показатель</th>
              ${qs.map(q=>`<th colspan="2" style="padding:7px 6px;text-align:center;font-size:10px;color:#64748b;font-weight:700">${q}</th>`).join('')}
            </tr>
            <tr style="background:#0a1120;border-bottom:1px solid #1a2335">
              <th></th>
              ${qs.map(()=>`<th style="padding:3px 6px;text-align:right;font-size:9px;color:#22c55e">Факт</th><th style="padding:3px 6px;text-align:right;font-size:9px;color:#475569">План</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${qTableRow('Выручка, $K',     revAct, revPlan)}
            ${qTableRow('EBITDA, $K',      ebAct,  ebPlan)}
            ${qTableRow('Чистая прибыль',  npAct,  npPlan)}
            ${qTableRow('Сотрудники, чел.',empAct, empPlan, 'чел')}
          </tbody>
        </table>
      </div>

      <!-- ── CHARTS ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:#0f1623;border-radius:10px;padding:14px">
          <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:8px;text-transform:uppercase">Выручка — Факт vs План ($K)</div>
          <div style="height:160px"><canvas id="portChartRevenue_${p.id}"></canvas></div>
        </div>
        <div style="background:#0f1623;border-radius:10px;padding:14px">
          <div style="font-size:10px;font-weight:700;color:#a78bfa;margin-bottom:8px;text-transform:uppercase">EBITDA — Факт vs План ($K)</div>
          <div style="height:160px"><canvas id="portChartEbitda_${p.id}"></canvas></div>
        </div>
      </div>

      <!-- ── DEBT & FINANCIAL DETAILS ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:#0f1623;border-radius:10px;padding:12px">
          <div style="font-size:10px;font-weight:700;color:#f97316;margin-bottom:8px;text-transform:uppercase">Долговая нагрузка</div>
          ${[
            ['Общий долг (все кредиторы)', fmt(f.totalDebt)],
            ['Долг перед фондом',          fmt(f.fundDebt)],
            ['Годовое обслуживание',       fmt(f.debtService)],
            ['Ср. зарплата',               fmt(f.avgSalary)],
            ['Налоговые отчисления',       fmt(f.taxContrib)],
          ].map(([l,v])=>`
            <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1a2335;font-size:11px">
              <span style="color:#94a3b8">${l}</span><span style="color:#e2e8f0;font-weight:700">${v}</span>
            </div>`).join('')}
        </div>
        <div style="background:#0f1623;border-radius:10px;padding:12px">
          <div style="font-size:10px;font-weight:700;color:#22c55e;margin-bottom:8px;text-transform:uppercase">Залог</div>
          <div style="font-size:11px;color:#e2e8f0;margin-bottom:8px">${f.collateral||'—'}</div>
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px">
            <span style="color:#94a3b8">Оценка</span><span style="color:#22c55e;font-weight:700">${fmt(f.collateralVal)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px">
            <span style="color:#94a3b8">Статус</span>
            <span style="color:${f.collateralStatus==='Зарегистрирован'?'#22c55e':'#f97316'};font-weight:700">${f.collateralStatus||'—'}</span>
          </div>
          <div style="margin-top:12px">
            <div style="font-size:10px;font-weight:700;color:#8a9bbf;margin-bottom:6px;text-transform:uppercase">Ковенанты</div>
            ${(f.covenants||[]).map(c=>`
              <div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px">
                <i class="fas ${c.ok?'fa-check-circle':'fa-times-circle'}" style="color:${c.ok?'#22c55e':'#ef4444'};font-size:11px;width:14px"></i>
                <span style="color:${c.ok?'#94a3b8':'#fca5a5'}">${c.name}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- ── PAYMENT SCHEDULE ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-calendar-check" style="margin-right:5px"></i>График платежей (12 мес.)
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="background:#0a1120">
          <th style="padding:7px 10px;text-align:left;font-size:10px;color:#475569">Дата</th>
          <th style="padding:7px 10px;text-align:left;font-size:10px;color:#475569">Тип</th>
          <th style="padding:7px 10px;text-align:right;font-size:10px;color:#475569">Сумма</th>
          <th style="padding:7px 10px;text-align:center;font-size:10px;color:#475569">Статус</th>
        </tr></thead>
        <tbody>
          ${(f.paymentSchedule||[]).map(ps => {
            const sCol = ps.status==='Оплачен'?'#22c55e':ps.status==='Просрочен'?'#ef4444':'#f97316';
            return `<tr style="border-bottom:1px solid #1a2335">
              <td style="padding:6px 10px;font-size:11px;color:#e2e8f0">${ps.date}</td>
              <td style="padding:6px 10px;font-size:11px;color:#94a3b8">${ps.type}</td>
              <td style="padding:6px 10px;font-size:11px;color:#e2e8f0;text-align:right;font-weight:700">${fmt(ps.amount)}</td>
              <td style="padding:6px 10px;text-align:center">
                <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:${sCol}22;color:${sCol}">${ps.status}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>

      <!-- ── ФИНАНСОВЫЙ ОТЧЁТ (форма ввода) ── -->
      <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:14px">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:10px;text-transform:uppercase">
          <i class="fas fa-file-upload" style="margin-right:5px"></i>Ввод квартального отчёта
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
          <div><label style="${lS}">Квартал</label>
            <select id="qr_quarter_${p.id}" style="${iS}">
              ${['Q1 2025','Q2 2025','Q3 2025','Q4 2025'].map(q=>`<option>${q}</option>`).join('')}
            </select></div>
          <div><label style="${lS}">Выручка ($K)</label>
            <input type="number" id="qr_rev_${p.id}" style="${iS}" placeholder="1200" /></div>
          <div><label style="${lS}">EBITDA ($K)</label>
            <input type="number" id="qr_ebitda_${p.id}" style="${iS}" placeholder="250" /></div>
          <div><label style="${lS}">Чистая прибыль ($K)</label>
            <input type="number" id="qr_np_${p.id}" style="${iS}" placeholder="130" /></div>
          <div><label style="${lS}">Сотрудников, чел.</label>
            <input type="number" id="qr_emp_${p.id}" style="${iS}" placeholder="56" /></div>
        </div>
        <button onclick="savePortQuarterlyReport(${p.id})"
          style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
            padding:7px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-save" style="margin-right:5px"></i>Сохранить данные квартала
        </button>
      </div>`;
  }

  /* ══ TAB 2: MONITORING ══ */
  else if (_activePortTab === 'monitoring') {
    const freqDays = {'Ежемесячно':30,'Ежеквартально':90,'Раз в полгода':180}[mon.frequency||'Ежеквартально']||90;
    const nextMon = mon.lastVisitDate ? new Date(new Date(mon.lastVisitDate).getTime() + freqDays*86400000).toISOString().split('T')[0] : '—';
    const dSince  = daysSince(mon.lastVisitDate);

    tabContent = `
      <!-- ── Monitoring Summary ── -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
        ${[
          { label:'Последний визит', val: mon.lastVisitDate||'—', color:dSince>60?'#ef4444':dSince>30?'#eab308':'#22c55e', icon:'fa-calendar-check' },
          { label:'Следующий мониторинг', val: nextMon, color:'#60a5fa', icon:'fa-calendar-plus' },
          { label:'Дней без контакта', val: dSince<999?`${dSince} дн.`:'—', color:dSince>60?'#ef4444':dSince>30?'#eab308':'#22c55e', icon:'fa-clock' },
        ].map(c=>`
          <div style="background:#0f1623;border-radius:10px;padding:12px;text-align:center">
            <i class="fas ${c.icon}" style="color:${c.color};font-size:14px;margin-bottom:4px;display:block"></i>
            <div style="font-size:14px;font-weight:800;color:${c.color}">${c.val}</div>
            <div style="font-size:9px;color:#64748b;text-transform:uppercase;margin-top:2px">${c.label}</div>
          </div>`).join('')}
      </div>

      <!-- ── Settings ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="${gS}"><label style="${lS}">Частота мониторинга</label>
          <select style="${iS}" onchange="portNestedField(${p.id},'monitoring','frequency',this.value)">
            ${['Ежемесячно','Ежеквартально','Раз в полгода'].map(v=>`<option ${mon.frequency===v?'selected':''}>${v}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Статус аудита</label>
          <select style="${iS}" onchange="portNestedField(${p.id},'monitoring','auditStatus',this.value)">
            ${['Не требуется','В процессе','Завершён'].map(v=>`<option ${mon.auditStatus===v?'selected':''}>${v}</option>`).join('')}
          </select></div>
        <div style="${gS}"><label style="${lS}">Уровень риска</label>
          <select style="${iS}" onchange="portNestedField(${p.id},'monitoring','riskLevel',this.value)">
            ${['Низкий','Средний','Высокий'].map(v=>`<option ${mon.riskLevel===v?'selected':''}>${v}</option>`).join('')}
          </select></div>
      </div>
      <div style="${gS}"><label style="${lS}">Нарушения ковенантов</label>
        <textarea style="${iS};height:55px;resize:none"
          onchange="portNestedField(${p.id},'monitoring','covenantViolations',this.value)"
          placeholder="Опишите нарушения или оставьте пустым">${mon.covenantViolations||''}</textarea></div>
      <div style="${gS}"><label style="${lS}">Комментарий по риску</label>
        <textarea style="${iS};height:55px;resize:none"
          onchange="portNestedField(${p.id},'monitoring','riskComment',this.value)">${mon.riskComment||''}</textarea></div>

      <!-- ── Meeting Log ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-calendar-alt" style="margin-right:5px"></i>Лог встреч (${(mon.meetings||[]).length})
      </div>
      ${!(mon.meetings||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:10px">Встреч не записано</div>` :
        [...(mon.meetings||[])].reverse().map((m,i) => `
          <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-bottom:10px;border-left:3px solid #3b82f6">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:12px;font-weight:700;color:#e2e8f0">${m.date}</span>
                <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(59,130,246,0.15);color:#60a5fa;font-weight:700">${m.format}</span>
              </div>
              <span style="font-size:10px;color:#64748b">${m.participants}</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:5px"><b style="color:#8a9bbf">Обсуждалось:</b> ${m.points}</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:5px"><b style="color:#8a9bbf">Решения:</b> ${m.decisions}</div>
            ${(m.actions||[]).length ? `
              <div style="margin-top:6px">
                <div style="font-size:10px;color:#eab308;font-weight:700;margin-bottom:4px">Action Items:</div>
                ${m.actions.map(a=>`
                  <div style="font-size:11px;color:#fde68a;padding:2px 0">
                    • ${a.text} — <span style="color:#64748b">${a.resp}</span> · <span style="color:#eab308">${a.deadline}</span>
                  </div>`).join('')}
              </div>` : ''}
          </div>`).join('')}

      <!-- ── Add Meeting Form ── -->
      <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:14px">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:10px;text-transform:uppercase">
          <i class="fas fa-plus" style="margin-right:5px"></i>Добавить встречу
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
          <div><label style="${lS}">Дата</label>
            <input type="date" id="mtg_date_${p.id}" style="${iS}" value="${today()}" /></div>
          <div><label style="${lS}">Формат</label>
            <select id="mtg_fmt_${p.id}" style="${iS}">
              ${['Визит','Звонок','Онлайн'].map(v=>`<option>${v}</option>`).join('')}
            </select></div>
          <div><label style="${lS}">Участники</label>
            <input id="mtg_pax_${p.id}" style="${iS}" placeholder="CEO, Менеджер компании..." /></div>
        </div>
        <div style="margin-bottom:8px"><label style="${lS}">Ключевые обсуждения</label>
          <textarea id="mtg_pts_${p.id}" rows="2" style="${iS};height:50px;resize:none" placeholder="Что обсуждалось..."></textarea></div>
        <div style="margin-bottom:8px"><label style="${lS}">Решения</label>
          <textarea id="mtg_dec_${p.id}" rows="2" style="${iS};height:50px;resize:none" placeholder="Принятые решения..."></textarea></div>
        <div style="margin-bottom:10px"><label style="${lS}">Action item (следующий шаг)</label>
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px">
            <input id="mtg_act_${p.id}" style="${iS}" placeholder="Описание действия..." />
            <input type="date" id="mtg_actd_${p.id}" style="${iS};width:140px" value="${today()}" />
            <input id="mtg_actr_${p.id}" style="${iS};width:120px" placeholder="Ответственный" />
          </div>
        </div>
        <button onclick="savePortMeeting(${p.id})"
          style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
            padding:7px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-save" style="margin-right:5px"></i>Сохранить встречу + создать задачу
        </button>
      </div>`;
  }

  /* ══ TAB 3: DOCUMENTS ══ */
  else if (_activePortTab === 'documents') {
    const requiredTypes = [
      'SHA / Кредитное соглашение',
      'Залоговые документы',
      'Финотчётность Q1 2025',
      'Финотчётность Q4 2024',
      'Финотчётность Q3 2024',
      'Финотчётность Q2 2024',
    ];
    const existTypes = (docs.files||[]).map(f=>f.type);
    const today30 = new Date(); today30.setDate(today30.getDate()+30);

    tabContent = `
      <!-- ── Drive link ── -->
      <div style="margin-bottom:14px;padding:12px 14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:9px">
        <label style="${lS}"><i class="fas fa-folder" style="margin-right:5px;color:#60a5fa"></i>Ссылка на папку Google Drive</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <input style="${iS}" value="${docs.driveUrl||''}" placeholder="https://drive.google.com/..."
            onchange="portNestedField(${p.id},'documents','driveUrl',this.value)" />
          ${docs.driveUrl?`<button onclick="window.open('${docs.driveUrl.replace(/'/g,"\\'")}','_blank')"
            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-external-link-alt"></i></button>`:''}
        </div>
      </div>

      <!-- ── Required docs checklist ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-clipboard-check" style="margin-right:5px"></i>Обязательные документы
      </div>
      ${requiredTypes.map(rt => {
        const found = (docs.files||[]).find(f=>f.type===rt);
        const present = !!found;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;margin-bottom:5px;
          background:${present?'rgba(34,197,94,0.06)':'rgba(239,68,68,0.06)'};
          border:1px solid ${present?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.25)'}">
          <i class="fas ${present?'fa-check-circle':'fa-times-circle'}" style="color:${present?'#22c55e':'#ef4444'};font-size:14px;width:16px"></i>
          <span style="flex:1;font-size:12px;color:${present?'#e2e8f0':'#fca5a5'};font-weight:${present?'500':'700'}">${rt}</span>
          ${present?`<span style="font-size:10px;color:#64748b">${found.date}</span>
            <span style="font-size:10px;color:#94a3b8">${found.uploadedBy}</span>`
            :`<span style="font-size:10px;color:#ef4444;font-weight:700">ОТСУТСТВУЕТ</span>`}
        </div>`;
      }).join('')}

      <!-- ── All docs list ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin:14px 0 8px">
        <i class="fas fa-folder-open" style="margin-right:5px"></i>Все документы (${(docs.files||[]).length})
      </div>
      ${!(docs.files||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:10px">Нет документов</div>` :
        (docs.files||[]).map((f,i) => {
          const expiring = f.expiryDate && new Date(f.expiryDate) <= today30 && new Date(f.expiryDate) >= new Date();
          const expired  = f.expiryDate && new Date(f.expiryDate) < new Date();
          return `
          <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:#0f1623;border-radius:8px;margin-bottom:6px;
            border-left:3px solid ${expired?'#ef4444':expiring?'#eab308':'#2a3448'}">
            <i class="fas fa-file-alt" style="color:${expired?'#ef4444':expiring?'#eab308':'#64748b'};font-size:13px"></i>
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;font-weight:700;color:#e2e8f0">${f.name}</div>
              <div style="font-size:10px;color:#64748b">${f.type} · ${f.period||'—'} · Загружен: ${f.date} · ${f.uploadedBy}</div>
              ${f.expiryDate?`<div style="font-size:10px;color:${expired?'#ef4444':expiring?'#eab308':'#64748b'}">
                ${expired?'⚠ Истёк:':expiring?'⚠ Истекает:':'Действителен до:'} ${f.expiryDate}
              </div>`:''}
            </div>
            <button onclick="deletePortDoc(${p.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;
                padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10px">✕</button>
          </div>`;
        }).join('')}

      <!-- ── Add doc form ── -->
      <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:#4ade80;margin-bottom:10px;text-transform:uppercase">
          <i class="fas fa-plus" style="margin-right:5px"></i>Добавить документ
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <div><label style="${lS}">Тип документа</label>
            <input id="doc_type_${p.id}" style="${iS}" placeholder="SHA / Финотчётность Q2..." /></div>
          <div><label style="${lS}">Название файла</label>
            <input id="doc_name_${p.id}" style="${iS}" placeholder="SHA_2025.pdf" /></div>
          <div><label style="${lS}">Период</label>
            <input id="doc_period_${p.id}" style="${iS}" placeholder="Q2 2025" /></div>
          <div><label style="${lS}">Загрузил</label>
            <input id="doc_by_${p.id}" style="${iS}" placeholder="CEO / Алибек Сейтов" /></div>
          <div><label style="${lS}">Дата загрузки</label>
            <input type="date" id="doc_date_${p.id}" style="${iS}" value="${today()}" /></div>
          <div><label style="${lS}">Срок действия (если есть)</label>
            <input type="date" id="doc_expiry_${p.id}" style="${iS}" /></div>
        </div>
        <button onclick="addPortDoc(${p.id})"
          style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;
            padding:7px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-plus" style="margin-right:5px"></i>Добавить документ
        </button>
      </div>`;
  }

  /* ══ TAB 4: COMPLIANCE ══ */
  else if (_activePortTab === 'compliance') {
    const esg = comp.esg || {};
    tabContent = `
      <!-- ── Program Info ── -->
      <div style="background:#0f1623;border-radius:10px;padding:14px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:700;color:#a78bfa;text-transform:uppercase;margin-bottom:10px">
          <i class="fas fa-hand-holding-usd" style="margin-right:5px"></i>Программа поддержки
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="${gS}"><label style="${lS}">Название программы</label>
            <input style="${iS}" value="${comp.programName||''}"
              onchange="portNestedField(${p.id},'compliance','programName',this.value)" /></div>
          <div style="${gS}"><label style="${lS}">Тип программы</label>
            <select style="${iS}" onchange="portNestedField(${p.id},'compliance','programType',this.value)">
              ${[['government','Государственная'],['fund','Фонда'],['grant','Грант'],['subsidized','Субсидирование']].map(([v,l])=>`<option value="${v}" ${comp.programType===v?'selected':''}>${l}</option>`).join('')}
            </select></div>
          <div style="${gS}"><label style="${lS}">Субсидируемая ставка (%)</label>
            <input type="number" style="${iS}" value="${comp.subsidizedRate||''}"
              onchange="portNestedField(${p.id},'compliance','subsidizedRate',parseFloat(this.value))" /></div>
          <div style="${gS}"><label style="${lS}">Размер гранта (₸)</label>
            <input type="number" style="${iS}" value="${comp.grantAmount||''}"
              onchange="portNestedField(${p.id},'compliance','grantAmount',parseFloat(this.value))" /></div>
        </div>
        <div style="${gS}"><label style="${lS}">Условия гранта</label>
          <textarea style="${iS};height:55px;resize:none"
            onchange="portNestedField(${p.id},'compliance','grantConditions',this.value)">${comp.grantConditions||''}</textarea></div>

        <!-- Gov programs multi-select -->
        <div style="font-size:10px;font-weight:700;color:#8a9bbf;margin-bottom:8px;text-transform:uppercase">Государственные программы</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${['Damu','KazAgro','QazIndustry','Другое'].map(prog => {
            const sel = (comp.programs||[]).includes(prog);
            return `<button onclick="togglePortProgram(${p.id},'${prog}')"
              style="padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;transition:all 0.15s;
                ${sel?'background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.5);color:#a78bfa'
                      :'background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#64748b'}">
              ${prog}
            </button>`;
          }).join('')}
        </div>
      </div>

      <!-- ── Reporting Deadlines ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-calendar-exclamation" style="margin-right:5px"></i>Дедлайны отчётности
      </div>
      ${!(comp.reportingDeadlines||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:10px">Нет дедлайнов</div>` :
        (comp.reportingDeadlines||[]).map((rd,i) => {
          const days14 = new Date(); days14.setDate(days14.getDate()+14);
          const urgent = !rd.done && new Date(rd.deadline) <= days14;
          return `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;margin-bottom:6px;
            background:${rd.done?'rgba(34,197,94,0.06)':urgent?'rgba(239,68,68,0.07)':'rgba(15,22,35,0.8)'};
            border:1px solid ${rd.done?'rgba(34,197,94,0.2)':urgent?'rgba(239,68,68,0.3)':'#1a2335'}">
            <input type="checkbox" ${rd.done?'checked':''} onchange="portToggleReportDL(${p.id},${i},this.checked)"
              style="width:15px;height:15px;accent-color:#22c55e;cursor:pointer" />
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;color:${rd.done?'#64748b':urgent?'#fca5a5':'#e2e8f0'}">${rd.description}</div>
              <div style="font-size:10px;color:#64748b">${rd.program} · Дедлайн: ${rd.deadline}${urgent?' ⚠ СРОЧНО':''}</div>
            </div>
            ${!rd.done&&urgent?`<span style="font-size:9px;padding:2px 7px;border-radius:5px;background:rgba(239,68,68,0.15);color:#f87171;font-weight:700">14 дней</span>`:''}
          </div>`;
        }).join('')}

      <button onclick="addPortReportDeadline(${p.id})"
        style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
          padding:6px 14px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:16px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить дедлайн
      </button>

      <!-- ── ESG / Social ── -->
      <div style="background:rgba(34,197,94,0.05);border:1px solid rgba(34,197,94,0.2);border-radius:10px;padding:14px">
        <div style="font-size:10px;font-weight:700;color:#4ade80;text-transform:uppercase;margin-bottom:12px">
          <i class="fas fa-leaf" style="margin-right:5px"></i>ESG / Социальные показатели
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
          ${[
            ['Новые рабочие места — план', 'esg_jcp', esg.jobsCreatedPlan||0],
            ['Новые рабочие места — факт', 'esg_jca', esg.jobsCreatedActual||0],
            ['Сохранено мест — план',      'esg_jpp', esg.jobsPreservedPlan||0],
            ['Сохранено мест — факт',      'esg_jpa', esg.jobsPreservedActual||0],
            ['Доля женщин в управлении, %','esg_wp',  esg.womenPct||0],
          ].map(([l,id,v])=>`
            <div><label style="${lS}">${l}</label>
              <input type="number" id="${id}_${p.id}" style="${iS}" value="${v}"
                onchange="portESGField(${p.id},'${id.replace('esg_','')}',parseInt(this.value))" /></div>`).join('')}
          <div><label style="${lS}">Тип региона</label>
            <select style="${iS}" onchange="portNestedNestedField(${p.id},'compliance','esg','regionType',this.value)">
              ${['Сельский','Городской','Городской центр','Региональный центр'].map(v=>`<option ${esg.regionType===v?'selected':''}>${v}</option>`).join('')}
            </select></div>
        </div>
        <div style="margin-bottom:8px"><label style="${lS}">Женское руководство</label>
          <div style="display:flex;gap:8px">
            ${['Да','Нет'].map(v=>`<button onclick="portNestedNestedField(${p.id},'compliance','esg','womenLeadership',${v==='Да'})"
              style="padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;
                ${(esg.womenLeadership&&v==='Да')||(!esg.womenLeadership&&v==='Нет')?
                  'background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);color:#4ade80'
                  :'background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#64748b'}">${v}</button>`).join('')}
          </div>
        </div>
        <div style="margin-bottom:8px"><label style="${lS}">Экологические меры</label>
          <textarea style="${iS};height:50px;resize:none"
            onchange="portNestedNestedField(${p.id},'compliance','esg','environmentalNotes',this.value)">${esg.environmentalNotes||''}</textarea></div>
        <div><label style="${lS}">Социальный эффект</label>
          <textarea style="${iS};height:50px;resize:none"
            onchange="portNestedNestedField(${p.id},'compliance','esg','socialImpact',this.value)">${esg.socialImpact||''}</textarea></div>
      </div>`;
  }

  /* ══ TAB 5: EXIT ══ */
  else if (_activePortTab === 'exit') {
    const checklist = ex.checklist || [];
    const done = checklist.filter(c=>c.done).length;
    const pct  = checklist.length ? Math.round(done/checklist.length*100) : ex.prepProgress||0;
    const pctColor = pct>=80?'#22c55e':pct>=50?'#f97316':'#ef4444';

    tabContent = `
      <!-- ── Exit KPIs ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:#0f1623;border-radius:10px;padding:14px">
          <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">Параметры выхода</div>
          <div style="${gS}"><label style="${lS}">Тип выхода</label>
            <select style="${iS}" onchange="portNestedField(${p.id},'exit','exitType',this.value)">
              ${['Buyback founder','Strategic Sale','Secondary','IPO on KASE','Другое'].map(v=>`<option ${ex.exitType===v?'selected':''}>${v}</option>`).join('')}
            </select></div>
          <div style="${gS}"><label style="${lS}">Планируемая дата</label>
            <input style="${iS}" value="${ex.plannedDate||''}"
              onchange="portNestedField(${p.id},'exit','plannedDate',this.value)" placeholder="2028-Q4" /></div>
          <div><label style="${lS}">Целевая оценка ($M)</label>
            <input type="number" style="${iS}" value="${ex.targetValuation||''}"
              onchange="portNestedField(${p.id},'exit','targetValuation',parseFloat(this.value))" /></div>
        </div>
        <!-- Progress ring -->
        <div style="background:#0f1623;border-radius:10px;padding:14px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:12px">Готовность к выходу</div>
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" stroke-width="10"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="${pctColor}" stroke-width="10"
              stroke-dasharray="${2*Math.PI*40}" stroke-dashoffset="${2*Math.PI*40*(1-pct/100)}"
              stroke-linecap="round" transform="rotate(-90 50 50)"/>
            <text x="50" y="55" text-anchor="middle" fill="${pctColor}" font-size="18" font-weight="800">${pct}%</text>
          </svg>
          <div style="font-size:11px;color:#64748b;margin-top:6px">${done}/${checklist.length} шагов выполнено</div>
        </div>
      </div>

      <!-- ── Checklist ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-tasks" style="margin-right:5px"></i>Чеклист подготовки
      </div>
      ${checklist.map((c,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;margin-bottom:5px;
          background:${c.done?'rgba(34,197,94,0.06)':'rgba(15,22,35,0.8)'};
          border:1px solid ${c.done?'rgba(34,197,94,0.2)':'#1a2335'}">
          <input type="checkbox" ${c.done?'checked':''} onchange="portExitCheck(${p.id},${i},this.checked)"
            style="width:15px;height:15px;accent-color:#22c55e;cursor:pointer" />
          <span style="font-size:12px;color:${c.done?'#64748b':'#e2e8f0'};
            ${c.done?'text-decoration:line-through':''}">${c.item}</span>
          ${c.done?`<i class="fas fa-check-circle" style="color:#22c55e;font-size:12px;margin-left:auto"></i>`:''}
        </div>`).join('')}
      
      <!-- Progress bar -->
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px;margin-bottom:16px">
        <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pctColor};border-radius:3px;transition:width 0.4s"></div>
        </div>
        <span style="font-size:11px;color:${pctColor};font-weight:700;white-space:nowrap">${pct}%</span>
      </div>

      <!-- ── Buyers ── -->
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-user-tie" style="margin-right:5px"></i>Потенциальные покупатели
      </div>
      ${!(ex.buyers||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:10px">Нет записей</div>` :
        (ex.buyers||[]).map((b,i)=>`
          <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;color:#e2e8f0;min-width:120px">${b.name}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(59,130,246,0.12);color:#60a5fa">${b.type}</span>
            <span style="font-size:10px;color:#64748b;flex:1">${b.contact}</span>
            <span style="font-size:10px;font-weight:700;color:#eab308">${b.status}</span>
            <button onclick="deletePortBuyer(${p.id},${i})"
              style="background:none;border:none;color:#475569;cursor:pointer;font-size:12px">✕</button>
          </div>`).join('')}
      <button onclick="addPortBuyer(${p.id})"
        style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);color:#60a5fa;
          padding:6px 14px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить покупателя
      </button>

      <div><label style="${lS}">Заметки по стратегии выхода</label>
        <textarea style="${iS};height:80px;resize:none"
          onchange="portNestedField(${p.id},'exit','notes',this.value)">${ex.notes||''}</textarea></div>`;
  }

  /* ══ TAB 6: HISTORY ══ */
  else if (_activePortTab === 'history') {
    const allHistory = [...hist].sort((a,b) => new Date(b.date)-new Date(a.date));
    const iconMap = { comment:'fa-comment-dots', status:'fa-exchange-alt', doc:'fa-file-upload', task:'fa-tasks' };
    const colorMap= { comment:'#60a5fa', status:'#eab308', doc:'#22c55e', task:'#a78bfa' };

    tabContent = `
      <div style="font-size:10px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:12px">
        <i class="fas fa-stream" style="margin-right:5px"></i>Лента активности (${allHistory.length} событий)
      </div>

      <div style="position:relative">
        <!-- Timeline line -->
        <div style="position:absolute;left:18px;top:0;bottom:0;width:2px;background:#1e293b"></div>

        ${allHistory.length ? allHistory.map(h => `
          <div style="display:flex;gap:12px;margin-bottom:12px;position:relative">
            <div style="width:36px;height:36px;border-radius:50%;
              background:${colorMap[h.type]||'#64748b'}22;
              border:2px solid ${colorMap[h.type]||'#64748b'};
              display:flex;align-items:center;justify-content:center;flex-shrink:0;z-index:1">
              <i class="fas ${iconMap[h.type]||'fa-circle'}" style="color:${colorMap[h.type]||'#64748b'};font-size:12px"></i>
            </div>
            <div style="background:#0f1623;border-radius:10px;padding:10px 14px;flex:1">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span style="font-size:11px;font-weight:700;color:#e2e8f0">${h.author}</span>
                <span style="font-size:10px;color:#64748b">${h.date}</span>
              </div>
              <div style="font-size:12px;color:#94a3b8">${h.text}</div>
            </div>
          </div>`).join('')
        : `<div style="font-size:12px;color:#475569;font-style:italic;padding:20px 0 20px 48px">История пуста</div>`}
      </div>

      <!-- ── Add comment ── -->
      <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:14px;margin-top:8px">
        <div style="font-size:10px;font-weight:700;color:#60a5fa;margin-bottom:8px;text-transform:uppercase">Новый комментарий</div>
        <select id="portHist_author_${p.id}" style="${iS};margin-bottom:8px">
          ${['CEO','Investment Manager','CFO','Analyst'].map(r=>`<option>${r}</option>`).join('')}
        </select>
        <textarea id="portHist_text_${p.id}" rows="3" style="${iS};height:70px;resize:none;margin-bottom:8px"
          placeholder="Комментарий по компании..."></textarea>
        <button onclick="addPortHistoryComment(${p.id})"
          style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
            padding:7px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-paper-plane" style="margin-right:5px"></i>Добавить
        </button>
      </div>`;
  }

  /* ── Assemble modal ── */
  const moicColor = moic>=2?'#22c55e':moic>=1.5?'#60a5fa':moic>=1?'#f97316':'#ef4444';

  document.getElementById('portDetailContent').innerHTML = `
    <!-- ── HEADER ── -->
    <div style="padding:20px 24px 0;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#1c2333;z-index:10">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="width:40px;height:40px;border-radius:10px;background:${getColor(portfolio.indexOf(p))};
              display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0">
              ${p.name.charAt(0)}</div>
            <div>
              <h2 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0">${p.name}</h2>
              <div style="font-size:11px;color:#64748b">BIN: ${p.bin||'—'} · ${p.sector} · Доля фонда: ${p.fundShare||'—'}%</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;
              background:${stCol}22;color:${stCol};border:1px solid ${stCol}44">${portStatusLabel(st)}</span>
          </div>
          <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap">
            ${[
              [`${currencySymbol(currencyForEntity(p))}${p.invested}M инвестировано`, '#64748b'],
              [`${currencySymbol(currencyForEntity(p))}${p.value}M текущая стоим.`,   '#22c55e'],
              [`${moic}x MOIC`,                 moicColor],
              [`${p.fundShare||'—'}% доля`,     '#a78bfa'],
            ].map(([v,c])=>`<span style="font-size:12px;font-weight:700;color:${c}">${v}</span>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
          <select onchange="portChangeStatus(${p.id},this.value)"
            style="background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:5px 8px;color:#e2e8f0;font-size:11px;cursor:pointer">
            ${['Active','Monitoring','Problem'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${portStatusLabel(s)}</option>`).join('')}
          </select>
          <button onclick="closePortfolioModal()"
            style="background:#1c2333;border:1px solid #2a3448;color:#64748b;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div style="display:flex;gap:2px;overflow-x:auto;padding-bottom:0">
        ${tabs.map(t => `
          <button onclick="switchPortTab('${t.id}',${p.id})"
            style="padding:8px 12px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:11px;font-weight:700;
              white-space:nowrap;transition:all 0.15s;position:relative;
              ${_activePortTab===t.id ? `background:#0f1623;color:#f1f5f9;border-bottom:2px solid ${stCol}`
                                      : 'background:transparent;color:#64748b;border-bottom:2px solid transparent'}">
            <i class="fas ${t.icon}" style="margin-right:5px"></i>${t.label}
            ${t.badge ? `<span style="position:absolute;top:4px;right:4px;font-size:9px;padding:1px 5px;border-radius:8px;
              background:${typeof t.badge==='number'?'#ef4444':'#eab308'};color:#fff;font-weight:800;line-height:1.4">${t.badge}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>

    <!-- ── TAB CONTENT ── -->
    <div style="padding:20px 24px 24px">
      ${tabContent}
    </div>
  `;

  /* ── Render charts after DOM injection ── */
  if (_activePortTab === 'financials') {
    setTimeout(() => {
      const qs = f.quarters || [];
      const chartCfg = (labels, ds1, ds2, color1, color2) => ({
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label:'Факт', data:ds1, backgroundColor:color1+'99', borderColor:color1, borderWidth:1.5, borderRadius:4 },
            { label:'План', data:ds2, backgroundColor:color2+'44', borderColor:color2, borderWidth:1.5, borderRadius:4, borderDash:[4,3] },
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ labels:{ color:'#94a3b8', font:{ size:10 }, boxWidth:12 }}},
          scales:{
            x:{ ticks:{ color:'#64748b', font:{size:9} }, grid:{ color:'#1e293b' }},
            y:{ ticks:{ color:'#64748b', font:{size:9} }, grid:{ color:'#1e293b' }},
          }
        }
      });
      const revCanvas = document.getElementById(`portChartRevenue_${p.id}`);
      const ebCanvas  = document.getElementById(`portChartEbitda_${p.id}`);
      if (revCanvas) {
        if (_portChartRevenue) _portChartRevenue.destroy();
        _portChartRevenue = new Chart(revCanvas, chartCfg(qs, f.revenue?.actual||[], f.revenue?.plan||[], '#60a5fa','#1e40af'));
      }
      if (ebCanvas) {
        if (_portChartEbitda) _portChartEbitda.destroy();
        _portChartEbitda = new Chart(ebCanvas, chartCfg(qs, f.ebitda?.actual||[], f.ebitda?.plan||[], '#a78bfa','#4c1d95'));
      }
    }, 50);
  }
}

/* ══════════════════════════════════════════════
   PORTFOLIO HELPER FUNCTIONS
══════════════════════════════════════════════ */
function portChangeStatus(id, status) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const old = p.status;
  p.status = status;
  p.lastUpdated = today();
  p.history = p.history || [];
  p.history.push({ type:'status', date:today(), author:'System', text:`Статус изменён: ${portStatusLabel(old)} → ${portStatusLabel(status)}` });
  if (status === 'Problem') {
    // Auto-create urgent task
    if (typeof addTask === 'function') {
      addTask({
        title: `Срочно: проверка ${p.name} (статус Проблемный)`,
        type: 'Прочее', priority: 'high', assignee: 'CEO',
        relatedClient: p.name, relatedModule: 'portfolio',
        deadline: today(),
        description: `Портфельная компания «${p.name}» переведена в статус "Проблемный". Требуется срочная проверка.`,
      });
    }
    showToast(`⚠ ${p.name} — статус Проблемный. Создана срочная задача.`, 'red');
  } else {
    showToast(`✅ ${p.name} — статус обновлён: ${portStatusLabel(status)}`, 'green');
  }
  _renderPortfolioModal(p);
  renderPortfolio(portfolio);
}

function portNestedField(id, section, field, value) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p[section]) p[section] = {};
  p[section][field] = value;
  p.lastUpdated = today();
}

function portNestedNestedField(id, section, subsection, field, value) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p[section]) p[section] = {};
  if (!p[section][subsection]) p[section][subsection] = {};
  p[section][subsection][field] = value;
  p.lastUpdated = today();
}

function portESGField(id, key, value) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const keyMap = { jcp:'jobsCreatedPlan',jca:'jobsCreatedActual',jpp:'jobsPreservedPlan',jpa:'jobsPreservedActual',wp:'womenPct' };
  const field = keyMap[key];
  if (!field) return;
  if (!p.compliance) p.compliance = {};
  if (!p.compliance.esg) p.compliance.esg = {};
  p.compliance.esg[field] = value;
}

function savePortQuarterlyReport(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const q   = document.getElementById(`qr_quarter_${id}`)?.value;
  const rev = parseFloat(document.getElementById(`qr_rev_${id}`)?.value) || 0;
  const eb  = parseFloat(document.getElementById(`qr_ebitda_${id}`)?.value) || 0;
  const np  = parseFloat(document.getElementById(`qr_np_${id}`)?.value) || 0;
  const emp = parseInt(document.getElementById(`qr_emp_${id}`)?.value) || 0;
  if (!rev && !eb) { showToast('⚠ Введите хотя бы Выручку или EBITDA', 'red'); return; }
  if (!p.financials) p.financials = { quarters:[], revenue:{actual:[],plan:[]}, ebitda:{actual:[],plan:[]}, netProfit:{actual:[],plan:[]}, employees:{actual:[],plan:[]} };
  const f = p.financials;
  if (!f.quarters.includes(q)) {
    f.quarters.push(q);
    (f.revenue.actual).push(rev);
    (f.ebitda.actual).push(eb);
    (f.netProfit.actual).push(np);
    (f.employees.actual).push(emp);
    (f.revenue.plan).push(rev);
    (f.ebitda.plan).push(eb);
    (f.netProfit.plan).push(np);
    (f.employees.plan).push(emp);
  } else {
    const i = f.quarters.indexOf(q);
    f.revenue.actual[i]   = rev;
    f.ebitda.actual[i]    = eb;
    f.netProfit.actual[i] = np;
    f.employees.actual[i] = emp;
  }
  p.history = p.history || [];
  p.history.push({ type:'doc', date:today(), author:'Менеджер', text:`Введены данные квартального отчёта ${q}: Выручка $${rev}K, EBITDA $${eb}K` });
  p.lastUpdated = today();
  showToast(`✅ Отчёт ${q} сохранён`, 'green');
  _renderPortfolioModal(p);
  renderPortfolio(portfolio);
}

function savePortMeeting(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const date = document.getElementById(`mtg_date_${id}`)?.value || today();
  const fmt  = document.getElementById(`mtg_fmt_${id}`)?.value || 'Визит';
  const pax  = document.getElementById(`mtg_pax_${id}`)?.value?.trim() || '';
  const pts  = document.getElementById(`mtg_pts_${id}`)?.value?.trim() || '';
  const dec  = document.getElementById(`mtg_dec_${id}`)?.value?.trim() || '';
  const actT = document.getElementById(`mtg_act_${id}`)?.value?.trim() || '';
  const actD = document.getElementById(`mtg_actd_${id}`)?.value || today();
  const actR = document.getElementById(`mtg_actr_${id}`)?.value?.trim() || '';
  if (!pts) { showToast('⚠ Заполните ключевые обсуждения', 'red'); return; }
  if (!p.monitoring) p.monitoring = {};
  p.monitoring.meetings = p.monitoring.meetings || [];
  const meeting = { date, format:fmt, participants:pax, points:pts, decisions:dec, actions:[] };
  if (actT) meeting.actions.push({ text:actT, deadline:actD, resp:actR });
  p.monitoring.meetings.push(meeting);
  p.monitoring.lastVisitDate = date;
  p.lastUpdated = today();
  p.history = p.history || [];
  p.history.push({ type:'comment', date, author:pax.split(',')[0]||'Менеджер', text:`Встреча (${fmt}): ${pts.slice(0,80)}${pts.length>80?'…':''}` });
  // Auto-create monitoring task
  const freqDays = {'Ежемесячно':30,'Ежеквартально':90,'Раз в полгода':180}[p.monitoring.frequency||'Ежеквартально']||90;
  const nextDate = new Date(new Date(date).getTime() + freqDays*86400000).toISOString().split('T')[0];
  if (typeof addTask === 'function') {
    addTask({
      title: `Мониторинг ${p.name} — следующий визит до ${nextDate}`,
      type: 'Прочее', priority: 'medium', assignee: 'RM (Relationship Manager)',
      relatedClient: p.name, relatedModule: 'portfolio',
      deadline: nextDate,
      description: `Плановый мониторинговый визит для портфельной компании «${p.name}».`,
    });
  }
  showToast(`✅ Встреча сохранена. Задача «Следующий мониторинг» создана на ${nextDate}.`, 'green');
  _activePortTab = 'monitoring';
  _renderPortfolioModal(p);
}

function addPortDoc(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const type   = document.getElementById(`doc_type_${id}`)?.value?.trim();
  const name   = document.getElementById(`doc_name_${id}`)?.value?.trim();
  const period = document.getElementById(`doc_period_${id}`)?.value?.trim() || '';
  const by     = document.getElementById(`doc_by_${id}`)?.value?.trim() || 'Менеджер';
  const date   = document.getElementById(`doc_date_${id}`)?.value || today();
  const expiry = document.getElementById(`doc_expiry_${id}`)?.value || '';
  if (!type || !name) { showToast('⚠ Введите тип и название файла', 'red'); return; }
  if (!p.documents) p.documents = { files:[] };
  p.documents.files.push({ type, name, date, period, uploadedBy:by, expiryDate:expiry, status:'OK' });
  p.history = p.history || [];
  p.history.push({ type:'doc', date, author:by, text:`Загружен документ: ${name} (${type})` });
  // Auto-task if expiry set
  if (expiry && typeof addTask === 'function') {
    const exDate = new Date(expiry); exDate.setDate(exDate.getDate()-30);
    addTask({
      title: `Обновить документ «${type}» для ${p.name} — истекает ${expiry}`,
      type: 'Договор', priority: 'medium', assignee: 'CO (Compliance Officer)',
      relatedClient: p.name, relatedModule: 'portfolio',
      deadline: exDate.toISOString().split('T')[0],
      description: `Документ «${type}» портфельной компании «${p.name}» истекает ${expiry}. Требуется продление/обновление.`,
    });
  }
  p.lastUpdated = today();
  showToast(`✅ Документ «${name}» добавлен`, 'green');
  _renderPortfolioModal(p);
}

function deletePortDoc(id, i) {
  const p = portfolio.find(x=>x.id===id);
  if (!p?.documents?.files) return;
  if (!confirm(`Удалить документ «${p.documents.files[i]?.name}»?`)) return;
  p.documents.files.splice(i, 1);
  _renderPortfolioModal(p);
}

function togglePortProgram(id, prog) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p.compliance) p.compliance = {};
  p.compliance.programs = p.compliance.programs || [];
  const idx = p.compliance.programs.indexOf(prog);
  if (idx >= 0) p.compliance.programs.splice(idx,1);
  else p.compliance.programs.push(prog);
  _renderPortfolioModal(p);
}

function portToggleReportDL(id, i, checked) {
  const p = portfolio.find(x=>x.id===id);
  if (!p?.compliance?.reportingDeadlines?.[i]) return;
  p.compliance.reportingDeadlines[i].done = checked;
  p.lastUpdated = today();
}

function addPortReportDeadline(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p.compliance) p.compliance = {};
  p.compliance.reportingDeadlines = p.compliance.reportingDeadlines || [];
  p.compliance.reportingDeadlines.push({ program:'', deadline:'', description:'Новый дедлайн', done:false });
  _renderPortfolioModal(p);
}

function portExitCheck(id, i, checked) {
  const p = portfolio.find(x=>x.id===id);
  if (!p?.exit?.checklist?.[i]) return;
  p.exit.checklist[i].done = checked;
  p.lastUpdated = today();
  _renderPortfolioModal(p);
}

function addPortBuyer(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p.exit) p.exit = {};
  p.exit.buyers = p.exit.buyers || [];
  p.exit.buyers.push({ name:'', type:'PE Fund', contact:'', status:'Первичный контакт' });
  _renderPortfolioModal(p);
}

function deletePortBuyer(id, i) {
  const p = portfolio.find(x=>x.id===id);
  if (!p?.exit?.buyers) return;
  p.exit.buyers.splice(i,1);
  _renderPortfolioModal(p);
}

function addPortHistoryComment(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const author = document.getElementById(`portHist_author_${id}`)?.value || 'CEO';
  const text   = document.getElementById(`portHist_text_${id}`)?.value?.trim();
  if (!text) { showToast('⚠ Введите текст комментария', 'red'); return; }
  p.history = p.history || [];
  p.history.push({ type:'comment', date:today(), author, text });
  showToast('✅ Комментарий добавлен', 'green');
  _renderPortfolioModal(p);
}

/* ===== HARVESTING ===== */
function renderHarvesting() {
  const realized = harvestingList.filter(h => h.status === 'Реализован').length;
  const inProg   = harvestingList.filter(h => h.status === 'На выходе').length;
  document.getElementById('exitRealized').textContent = realized;
  document.getElementById('exitInProgress').textContent = inProg;

  const tbody = document.getElementById('harvestingTableBody');
  tbody.innerHTML = harvestingList.map(h => `
    <tr>
      <td><strong style="color:var(--text-primary)">${h.name}</strong></td>
      <td><span class="badge badge-blue">${h.exitStrategy}</span></td>
      <td>$${h.invested}M</td>
      <td>${h.exitValue > 0 ? `<strong style="color:var(--accent-green)">$${h.exitValue}M</strong>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${h.moic > 0 ? `<strong style="color:var(--accent-green)">${h.moic}x</strong>` : '—'}</td>
      <td>${h.irr > 0 ? `<strong style="color:var(--accent-green)">${h.irr}%</strong>` : '—'}</td>
      <td>${exitStatusBadge(h.status)}</td>
      <td style="font-size:12px;color:var(--text-muted)">${h.exitDate}</td>
      <td>
        <div class="action-btns">
          <button class="act-btn" onclick="markExitDone(${h.id})"><i class="fas fa-check-double"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

function markExitDone(id) {
  const h = harvestingList.find(x => x.id === id);
  if (!h) return;
  const val = prompt('Введите сумму выхода ($M):', '');
  if (!val) return;
  h.exitValue = parseFloat(val);
  h.moic = h.invested > 0 ? Math.round((h.exitValue / h.invested) * 100) / 100 : 0;
  h.irr  = Math.round(Math.pow(h.exitValue / h.invested, 1 / 5) * 100 - 100);
  h.status = 'Реализован';
  renderHarvesting();
  showToast(`✅ Выход завершён: ${h.name} · MOIC ${h.moic}x`);
}

/* ===== CAPITAL CALLS ===== */
function renderCapitalCalls() {
  const tbody = document.getElementById('capCallsTableBody');
  if (!tbody) return;
  tbody.innerHTML = capitalCalls.map((cc, idx) => `
    <tr>
      <td><strong>Capital Call #${idx + 1}</strong></td>
      <td>${formatDate(cc.noticeDate)}</td>
      <td>${formatDate(cc.payDate)}</td>
      <td><strong>$${(cc.amount/1e6).toFixed(2)}M</strong></td>
      <td>${cc.pct}%</td>
      <td style="font-size:12px;color:var(--text-muted)">${cc.purpose}</td>
      <td>${cc.status === 'Завершён'
            ? '<span class="badge badge-green">Завершён</span>'
            : '<span class="badge badge-orange">Ожидается</span>'}</td>
      <td>${cc.received > 0 ? `<span style="color:var(--accent-green);font-weight:700">$${(cc.received/1e6).toFixed(2)}M</span>` : '—'}</td>
    </tr>`).join('');
}

function saveCapCall() {
  const notice = document.getElementById('cc_notice_date').value || new Date().toISOString().split('T')[0];
  const amount = parseFloat(document.getElementById('cc_amount').value) || 0;
  const pct    = parseFloat(document.getElementById('cc_pct').value) || 0;
  const purpose = document.getElementById('cc_purpose').value;

  // Pay date = notice date + 10 business days (approx 14 calendar days)
  const payDateObj = new Date(notice);
  payDateObj.setDate(payDateObj.getDate() + 14);
  const payDate = payDateObj.toISOString().split('T')[0];

  capitalCalls.push({ id: Date.now(), noticeDate: notice, payDate, amount: amount * 1e6, pct, purpose, status: 'Ожидается', received: 0 });
  renderCapitalCalls();
  closeModal();
  showToast('✅ Capital Call создан');
  ['cc_notice_date','cc_amount','cc_pct'].forEach(id => document.getElementById(id).value = '');
}

/* ===== DISTRIBUTIONS ===== */
function renderDistributions() {
  const tbody = document.getElementById('distributionsTableBody');
  if (!tbody) return;
  if (!distributions.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Distributions ещё не проводились</td></tr>`;
    return;
  }
  tbody.innerHTML = distributions.map(d => `
    <tr>
      <td>${formatDate(d.date)}</td>
      <td><strong style="color:var(--text-primary)">${d.source}</strong></td>
      <td><strong style="color:var(--accent-green)">$${d.total}M</strong></td>
      <td>$${d.roc}M</td>
      <td>$${d.pref}M</td>
      <td>$${d.carry}M</td>
      <td><span class="badge badge-green">Завершено</span></td>
    </tr>`).join('');
}

function saveDistribution() {
  const date   = document.getElementById('dist_date').value;
  const source = document.getElementById('dist_source').value.trim() || '—';
  const total  = parseFloat(document.getElementById('dist_total').value) || 0;
  const roc    = parseFloat(document.getElementById('dist_roc').value) || 0;
  const pref   = parseFloat(document.getElementById('dist_pref').value) || 0;
  const carry  = parseFloat(document.getElementById('dist_carry').value) || 0;

  distributions.push({ id: Date.now(), date, source, total, roc, pref, carry });
  renderDistributions();
  closeModal();
  showToast('✅ Distribution добавлено');
}

/* ===== REPORTS ===== */
function renderReports() {
  renderReportSchedule();
  setTimeout(renderReportCharts, 150);
}

function renderReportSchedule() {
  const container = document.getElementById('reportSchedule');
  if (!container) return;
  const statusMap = { 'Отправлен':'badge-green','В процессе':'badge-orange','Ожидается':'badge-gray' };
  container.innerHTML = reportSchedule.map(r => `
    <div class="report-row">
      <span class="rr-period">${r.period}</span>
      <span class="badge ${r.type === 'Годовой' ? 'badge-purple' : 'badge-blue'}">${r.type}</span>
      <span class="rr-deadline"><i class="fas fa-clock"></i> ${formatDate(r.deadline)}</span>
      <span class="badge ${statusMap[r.status]}">${r.status}</span>
      <span class="rr-resp">${r.resp}</span>
    </div>`).join('');
}

function renderReportCharts() {
  // NAV chart
  const navCtx = document.getElementById('chartNAV');
  if (navCtx) {
    if (navChart) navChart.destroy();
    navChart = new Chart(navCtx, {
      type: 'line',
      data: {
        labels: chartData.nav.labels,
        datasets: [{
          label: 'NAV ($M)',
          data: chartData.nav.nav,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: '#3b82f6', borderWidth: 2.5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color:'#8a9bbf' } } },
        scales: {
          x: { ticks:{color:'#5a6b8a'}, grid:{color:'#2a3448'} },
          // Axis symbol follows activeFundId; underlying series is still
          // static mock data (js/data.js chartData) — pre-existing
          // limitation, out of scope for this currency-honesty sweep.
          y: { ticks:{color:'#5a6b8a', callback: v=>currencySymbol(currencyForFundId(activeFundId))+v+'M'}, grid:{color:'#2a3448'} }
        }
      }
    });
  }

  // Sector chart
  const secCtx = document.getElementById('chartSectors');
  if (secCtx) {
    if (sectorChart) sectorChart.destroy();
    sectorChart = new Chart(secCtx, {
      type: 'doughnut',
      data: {
        labels: chartData.sectors.labels,
        datasets: [{ data: chartData.sectors.data, backgroundColor: COLORS, borderColor:'#1c2333', borderWidth:2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout:'60%',
        plugins: { legend: { position:'bottom', labels:{color:'#8a9bbf',font:{size:10},padding:10} } }
      }
    });
  }
}

/* ===== MODALS ===== */
function openModal(name) {
  document.getElementById('modalOverlay').classList.add('active');
  const m = document.getElementById('modal-' + name);
  if (m) m.classList.add('active');
}
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

/* ===== TOAST ===== */
function showToast(msg, color = 'green') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  const colors = { red:'var(--accent-red)', orange:'var(--accent-orange)', blue:'var(--accent-blue)', green:'var(--accent-green)' };
  t.style.borderLeftColor = colors[color] || colors.green;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

/* ===== HELPERS ===== */
function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function kycStatusBadge(s) {
  const m = { 'Одобрен':'badge-green','В процессе':'badge-orange','На проверке':'badge-blue','Отклонён':'badge-red','Не начат':'badge-gray' };
  return `<span class="badge ${m[s]||'badge-gray'}">${s}</span>`;
}

function stageBadgePort(s) {
  const m = { 'Активная':'badge-green','Value Creation':'badge-blue','Мониторинг':'badge-orange','На выходе':'badge-purple' };
  return `<span class="badge ${m[s]||'badge-gray'}">${s}</span>`;
}

function exitStatusBadge(s) {
  const m = { 'Реализован':'badge-green','На выходе':'badge-orange','Мониторинг':'badge-blue' };
  return `<span class="badge ${m[s]||'badge-gray'}">${s}</span>`;
}
