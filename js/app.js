// ============================================================
//  Turan Capital Fund LP — Application Logic
//  GP: Golden Leaves Ltd | License: AFSA-A-LA-2024-0038
// ============================================================

let jcChart = null, lpTypeChart = null;

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

  // Portfolio (monitoring conclusions, uploaded documents) is internal-GP-
  // staff-only — external IC seats (Independent Member, LP Rep) already get
  // a 403 from the server (requireInternal on /api/portfolio/*), this just
  // hides the nav link so they don't land on a broken empty page.
  const portfolioNav = document.querySelector('.nav-item[data-page="portfolio"]');
  if (portfolioNav) portfolioNav.style.display = currentUserPermission('internal') ? '' : 'none';

  // Vault aggregates real files from every internal module (deals,
  // portfolio, capital calls, AFSA reports, onboarding contracts) — same
  // internal-only reasoning as Portfolio above. Its own data source (GET
  // /api/uploads/meta) already 403s a non-internal role server-side.
  const vaultNav = document.querySelector('.nav-item[data-page="vault"]');
  if (vaultNav) vaultNav.style.display = currentUserPermission('internal') ? '' : 'none';

  const roBanner = document.getElementById('readOnlyBanner');
  if (roBanner) roBanner.style.display = currentUserPermission('readOnly') ? '' : 'none';

  if (typeof applyReadOnlyUI === 'function') applyReadOnlyUI();
}

// This app's layout is built for desktop use; below this width, things
// like data tables (some with a fixed min-width) and wide modals stop
// adapting and become hard to use. Live off the current viewport width
// rather than a one-time dismissal, so narrowing the window later still
// shows it, and widening it back hides it again — not gated behind login,
// since it's relevant on the login screen too.
const SMALL_SCREEN_BREAKPOINT = 600;
function checkSmallScreenWarning() {
  const banner = document.getElementById('smallScreenBanner');
  if (banner) banner.style.display = window.innerWidth < SMALL_SCREEN_BREAKPOINT ? '' : 'none';
}
if (typeof window !== 'undefined') {
  checkSmallScreenWarning();
  let _smallScreenResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_smallScreenResizeTimer);
    _smallScreenResizeTimer = setTimeout(checkSmallScreenWarning, 150);
  });
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
  if (typeof attachPasswordStrengthMeter === 'function') attachPasswordStrengthMeter(document.getElementById('pw_new'));
  _snapshotObNewModal();
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
    closeObNewModalSilent();
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
  const activeDeals = deals.filter(d => d.stage !== 'Закрыта' && d.stage !== 'Отклонена' && d.stage !== 'Отклонена IC').length;

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
  // _vaultFilesCache (js/vault.js) is only populated once the Vault page
  // has actually been rendered (its aggregation needs an async bulk
  // metadata fetch, so it can't run synchronously on every badge update) —
  // reads as 0 until then, same as any other page whose data hasn't
  // loaded yet.
  const vaultCount = typeof _vaultFilesCache !== 'undefined' ? _vaultFilesCache.length : 0;
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
  if (page === 'documents')    { renderDocumentsPage(); }
  if (page === 'subscription') { renderSubscriptionPage(); }
  if (page === 'export')       { renderExportPage(); }
  if (page === 'workflow')     { renderWorkflowPage(); }
  if (page === 'kycrenewal')   { renderKycRenewalPage(); }
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

  // AUM — real total LP commitments for this fund, not the fund's target
  // size (updateFundBranding()/js/funds.js sets kpiAum to targetSize as a
  // placeholder before this data is loaded; this overwrites it with the
  // real figure once lpRegister is available).
  const fund = (typeof funds !== 'undefined' && fundScoped) ? funds.find(f => f.id === activeFundId) : null;
  const curr = typeof currencyForFundId === 'function' ? currencyForFundId(activeFundId) : 'USD';
  const totalCommitted = scopedLps.reduce((s, l) => s + (l.commitment || 0), 0);
  const aumEl = document.getElementById('kpiAum');
  if (aumEl && totalCommitted > 0) {
    aumEl.textContent = typeof fmtCurrency === 'function' ? fmtCurrency(totalCommitted, curr) : `$${(totalCommitted/1e6).toFixed(1)}M`;
  }
  const aumDeltaEl = document.getElementById('kpiAumDelta');
  if (aumDeltaEl && fund && fund.targetSize) {
    const pctOfTarget = Math.round((totalCommitted / 1e6 / fund.targetSize) * 100);
    aumDeltaEl.textContent = totalCommitted > 0
      ? `Цель: $${fund.targetSize}M · Committed: ${pctOfTarget}%`
      : `Цель: $${fund.targetSize}M · Min: $5M`;
  }

  // MOIC "Текущий" — real, computed from portfolio current value / invested
  // for this fund. IRR "Текущий" stays honest instead of a frozen fake
  // number: a real annualized IRR needs dated cash-flow-in/out timing
  // (calls + distributions), and this app has no real distributions data
  // at all (the Distributions module was removed) — showing a made-up
  // percentage would be worse than admitting it can't be computed yet.
  const totalInvested = scopedPortfolio.reduce((s, p) => s + (p.invested || 0), 0);
  const totalValue    = scopedPortfolio.reduce((s, p) => s + (p.value || 0), 0);
  const moicCurrentEl = document.getElementById('kpiMoicCurrent');
  if (moicCurrentEl) {
    moicCurrentEl.textContent = totalInvested > 0 ? `Текущий: ${(totalValue / totalInvested).toFixed(2)}x` : 'Текущий: нет данных';
  }
  const irrCurrentEl = document.getElementById('kpiIrrCurrent');
  if (irrCurrentEl) irrCurrentEl.textContent = 'Расчёт недоступен — нет данных о распределениях';

  if (typeof renderKYCStatus === 'function') renderKYCStatus();
  if (typeof updateLifecycleBar === 'function') updateLifecycleBar();

  // Onboarding TZ widgets
  if (typeof renderDashboardObWidget === 'function')  renderDashboardObWidget();
  if (typeof renderDashboardCoiWidget === 'function') renderDashboardCoiWidget();
  if (typeof renderDashboardRmWidget === 'function')  renderDashboardRmWidget();
  if (typeof renderDashboardLPWidget === 'function')  renderDashboardLPWidget();
  setTimeout(renderDashboardCharts, 150);
}

// Real milestones instead of a hardcoded completed/active state: no LPs
// yet -> Онбординг is the active stage; LPs exist but no closing_date on
// this fund's first_closing row -> First Closing active; closed but no
// portfolio companies yet -> Инвестирование active; portfolio companies
// exist -> Создание стоимости active. Sequential, so every earlier stage
// shows completed.
function updateLifecycleBar() {
  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const scopedLps = typeof lpRegister !== 'undefined' ? (fundScoped ? lpRegister.filter(l => l.fundId === activeFundId) : lpRegister) : [];
  const scopedPortfolio = typeof portfolio !== 'undefined' ? (fundScoped ? portfolio.filter(p => p.fundId === activeFundId) : portfolio) : [];
  const hasClosing = typeof firstClosingList !== 'undefined' && firstClosingList.some(fc => fc.fundId === activeFundId && fc.closingDate);

  const stageIdx = scopedPortfolio.length > 0 ? 3 : hasClosing ? 2 : scopedLps.length > 0 ? 1 : 0;
  const stageIds = ['lcStageOnboarding', 'lcStageClosing', 'lcStageInvesting', 'lcStageValueCreation'];
  const connectorIds = ['lcConnector1', 'lcConnector2', 'lcConnector3'];

  stageIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('completed', 'active');
    const dot = el.querySelector('.lc-dot');
    if (i < stageIdx) { el.classList.add('completed'); if (dot) dot.innerHTML = '<i class="fas fa-check"></i>'; }
    else if (i === stageIdx) { el.classList.add('active'); if (dot) dot.innerHTML = '<i class="fas fa-play"></i>'; }
    else if (dot) dot.textContent = String(i + 1);
  });
  connectorIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('completed', 'active');
    if (i < stageIdx) el.classList.add('completed');
    else if (i === stageIdx) el.classList.add('active');
  });
}

function renderKYCStatus() {
  const container = document.getElementById('kycStatusList');
  if (!container) return;
  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const list = typeof lpRegister !== 'undefined' ? (fundScoped ? lpRegister.filter(l => l.fundId === activeFundId) : lpRegister) : [];
  container.innerHTML = list.slice(0,6).map(lp => `
    <div class="kyc-mini-row">
      <div class="cell-avatar" style="background:${getColor(lp.id)};width:30px;height:30px;font-size:11px;flex-shrink:0">${(lp.name||'?').charAt(0)}</div>
      <span class="kyc-mini-name">${escapeHtml(lp.name)}</span>
      ${kycStatusBadge(lp.kycStatus || 'Active')}
    </div>
  `).join('') || '<div style="color:#4a5568;font-size:12px;padding:8px">Нет активных LP</div>';
}

// Real per-year net cash flow from capitalCallsLog (money called = out,
// negated) for this fund — replaces the old hardcoded js/data.js
// chartData.jcurve series. There's deliberately no positive (inflow) side
// yet: this app has no real distributions data (that module was removed),
// so the chart is honestly just the downward leg of the "J" for a fund
// still in its investment period, not a fabricated eventual upturn.
function buildRealJCurveData() {
  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const calls = typeof capitalCallsLog !== 'undefined'
    ? (fundScoped ? capitalCallsLog.filter(cc => cc.fundId === activeFundId) : capitalCallsLog)
    : [];
  const byYear = {};
  calls.forEach(cc => {
    if (!cc.noticeDate) return;
    const year = cc.noticeDate.slice(0, 4);
    byYear[year] = (byYear[year] || 0) - (cc.totalAmount || 0) / 1e6;
  });
  const years = Object.keys(byYear).sort();
  if (!years.length) return { labels: [String(new Date().getFullYear())], cashflow: [0] };
  return { labels: years, cashflow: years.map(y => Math.round(byYear[y] * 100) / 100) };
}

// Real commitment-by-lpType breakdown for this fund — replaces the old
// hardcoded js/data.js chartData.lpTypes, which used a fictional label
// set that didn't match the real lpType values (Institution/Family
// Office/HNWI) at all.
const LP_TYPE_LABELS = { Institution: 'Институциональный', 'Family Office': 'Семейный офис', HNWI: 'Состоятельное частное лицо (HNWI)' };
function buildRealLpTypesData() {
  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const lps = typeof lpRegister !== 'undefined'
    ? (fundScoped ? lpRegister.filter(l => l.fundId === activeFundId) : lpRegister)
    : [];
  const byType = {};
  lps.forEach(lp => {
    const key = lp.lpType || lp.type || 'Другое';
    byType[key] = (byType[key] || 0) + (lp.commitment || 0) / 1e6;
  });
  const keys = Object.keys(byType);
  if (!keys.length) return { labels: ['Нет данных'], data: [1] };
  return { labels: keys.map(k => LP_TYPE_LABELS[k] || k), data: keys.map(k => Math.round(byType[k] * 100) / 100) };
}

function renderDashboardCharts() {
  // J-Curve
  const jCtx = document.getElementById('chartJCurve');
  if (jCtx) {
    if (jcChart) jcChart.destroy();
    const jc = buildRealJCurveData();
    jcChart = new Chart(jCtx, {
      type: 'bar',
      data: {
        labels: jc.labels,
        datasets: [
          {
            label: 'Денежный поток ($M)',
            data: jc.cashflow,
            backgroundColor: jc.cashflow.map(v => v < 0 ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)'),
            borderColor:     jc.cashflow.map(v => v < 0 ? '#ef4444' : '#22c55e'),
            borderWidth: 1.5,
            borderRadius: 4,
          },
          {
            label: 'Накопленный ($M)',
            data: jc.cashflow.reduce((acc, v, i) => { acc.push((acc[i-1]||0)+v); return acc; }, []),
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
          y: { ticks:{color:'#5a6b8a', callback: v=>currencySymbol(currencyForFundId(activeFundId))+v+'M'}, grid:{color:'#2a3448'} }
        }
      }
    });
  }

  // LP Types
  const lpCtx = document.getElementById('chartLPTypes');
  if (lpCtx) {
    if (lpTypeChart) lpTypeChart.destroy();
    const lt = buildRealLpTypesData();
    lpTypeChart = new Chart(lpCtx, {
      type: 'doughnut',
      data: {
        labels: lt.labels,
        datasets: [{ data: lt.data, backgroundColor: COLORS, borderColor:'#1c2333', borderWidth:2, hoverOffset:6 }]
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
   lpRegister, capitalCallsLog, firstClosingList
═══════════════════════════════════════════════════════════ */

// firstClosingList (js/data.js) is loaded from GET /api/first-closing —
// one row per fund. Returns a blank, not-yet-saved state for a fund that
// has never had one of its fields edited yet (the first PUT creates the
// real row server-side).
function currentFirstClosingState() {
  return firstClosingList.find(f => f.fundId === activeFundId) || {
    fundId: activeFundId, boardResolutionUrl: '', closingCertUrl: '', closingDate: '',
    firstCCId: null, afsaNotifDate: '', afsaNotifNum: '', afsaConfirmUrl: '', welcomeLetterLog: [],
  };
}

function renderClosing() {
  const el = document.getElementById('closingDashboard');
  if (!el) return;

  const fp  = FUND_PARAMS;
  const fcs = currentFirstClosingState();

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
          <div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(lp.name)}</div>
          <div style="font-size:10px;color:#64748b">${lp.saNumber || '— SA не указан'} · KYC: <span style="color:${lp.kycStatus==='Одобрен'?'#22c55e':'#f97316'}">${lp.kycStatus}</span></div>
        </div>
        ${lp.lpaUrl ? `
          <button onclick="_obOpenPreviewModal('${escapeAttr(lp.lpaUrl)}','${escapeAttr(lp.lpaUrl)}')"
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
            <div style="font-size:12px;font-weight:600;color:#e2e8f0">${escapeHtml(lp.name)}</div>
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
          <input type="text" id="fc_boardResUrl" placeholder="https://drive.google.com/... или загрузите файл"
            value="${fcs.boardResolutionUrl}" style="${inpStyle}" />
          ${docUploadBtn('fc_boardResUrl', "fcSaveUrl('boardResolutionUrl','fc_boardResUrl')")}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="fcSaveUrl('boardResolutionUrl','fc_boardResUrl')" style="${saveBtnS}">
            <i class="fas fa-save" style="margin-right:4px"></i>Сохранить
          </button>
          ${fcs.boardResolutionUrl ? `
            <button onclick="_obOpenPreviewModal('${resolveDocUrl(fcs.boardResolutionUrl).replace(/'/g,"\\'")}','${resolveDocUrl(fcs.boardResolutionUrl).replace(/'/g,"\\'")}')"
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
          <input type="text" id="fc_certUrl" placeholder="https://drive.google.com/... или загрузите файл"
            value="${fcs.closingCertUrl}" style="${inpStyle}" />
          ${docUploadBtn('fc_certUrl', "fcSaveUrl('closingCertUrl','fc_certUrl')")}
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
            <button onclick="_obOpenPreviewModal('${resolveDocUrl(fcs.closingCertUrl).replace(/'/g,"\\'")}','${resolveDocUrl(fcs.closingCertUrl).replace(/'/g,"\\'")}')"
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
            <div style="display:flex;gap:6px">
              <input type="text" id="fc_afsaUrl" placeholder="https://... или файл" value="${fcs.afsaConfirmUrl}" style="${inpStyle};width:100%" />
              ${docUploadBtn('fc_afsaUrl')}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="fcSaveAFSA()" style="${saveBtnS}">
            <i class="fas fa-save" style="margin-right:4px"></i>Сохранить данные AFSA
          </button>
          ${fcs.afsaConfirmUrl ? `
            <button onclick="_obOpenPreviewModal('${resolveDocUrl(fcs.afsaConfirmUrl).replace(/'/g,"\\'")}','${resolveDocUrl(fcs.afsaConfirmUrl).replace(/'/g,"\\'")}')"
              style="${prevBtnS}"><i class="fas fa-eye" style="margin-right:4px"></i>Подтверждение
            </button>` : ''}
        </div>
      </div>

    </div>
  `;
}

/* ── First Closing helpers ─────────────────────────────── */

// Shared by every fc* mutator below — PUTs the changed field(s) to this
// fund's first-closing row (server upserts if none exists yet) and syncs
// the local firstClosingList entry from the response. Same "one field,
// server merges" pattern used everywhere else in this app.
async function _persistFirstClosingFields(fields) {
  try {
    const updated = await apiFetch(`/api/first-closing/${activeFundId}`, {
      method: 'PUT', body: JSON.stringify(fields),
    });
    const idx = firstClosingList.findIndex(f => f.fundId === activeFundId);
    if (idx === -1) firstClosingList.push(updated); else firstClosingList[idx] = updated;
    return true;
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
    return false;
  }
}

async function fcSaveUrl(field, inputId) {
  const val = document.getElementById(inputId)?.value?.trim();
  if (!val) { showToast('⚠ Вставьте ссылку на документ', 'red'); return; }
  if (await _persistFirstClosingFields({ [field]: val })) {
    showToast('✅ Ссылка сохранена', 'green');
    renderClosing();
  }
}

async function fcSaveClosingDate() {
  const val = document.getElementById('fc_closingDate')?.value;
  if (!val) return;
  if (await _persistFirstClosingFields({ closingDate: val })) {
    showToast('✅ Дата закрытия сохранена', 'green');
    renderClosing();
  }
}

async function fcSaveAFSA() {
  const date = document.getElementById('fc_afsaDate')?.value;
  const num  = document.getElementById('fc_afsaNum')?.value?.trim();
  const url  = document.getElementById('fc_afsaUrl')?.value?.trim();
  if (!date || !num) { showToast('⚠ Укажите дату и номер письма', 'red'); return; }
  if (await _persistFirstClosingFields({ afsaNotifDate: date, afsaNotifNum: num, afsaConfirmUrl: url || '' })) {
    showToast('✅ Данные AFSA Notification сохранены', 'green');
    renderClosing();
  }
}

async function fcGenerateWelcomeLetter(lpId) {
  generateLPWelcomeLetter(lpId);
  const fcs = currentFirstClosingState();
  if (!fcs.welcomeLetterLog.includes(lpId)) {
    await _persistFirstClosingFields({ welcomeLetterLog: [...fcs.welcomeLetterLog, lpId] });
  }
  setTimeout(() => renderClosing(), 400);
}

async function fcGenerateAllWelcomeLetters() {
  // fundId scoping was missing here (every other spot on this page
  // already scopes activeLP by activeFundId — this one call site got
  // missed in that earlier pass), so a second fund's Active LPs used to
  // get Welcome Letters generated too.
  const activeLP = lpRegister.filter(l => l.status === 'Active' && l.fundId === activeFundId);
  if (!activeLP.length) { showToast('⚠ Нет активных LP', 'red'); return; }
  const log = [...currentFirstClosingState().welcomeLetterLog];
  activeLP.forEach((lp, i) => {
    setTimeout(async () => {
      generateLPWelcomeLetter(lp.id);
      if (!log.includes(lp.id)) log.push(lp.id);
      if (i === activeLP.length - 1) {
        await _persistFirstClosingFields({ welcomeLetterLog: log });
        setTimeout(() => {
          showToast(`✅ Welcome Letters сгенерированы для всех ${activeLP.length} LP`, 'green');
          renderClosing();
        }, 500);
      }
    }, i * 500);
  });
}

/* ===== PIPELINE (KANBAN) ===== */
// 'Отклонена' и 'Отклонена IC' are deliberately two different terminal
// stages, not one — see dealMoveStage()'s gates. 'Отклонена' is an early,
// informal pass (Скрининг/DD, no committee involved — any RM/CEO can call
// it); 'Отклонена IC' can only be reached via a real Investment Committee
// vote (castICVote, js/modules.js). Conflating them into one label would
// corrupt the fund's own pipeline-conversion reporting (sourced -> DD ->
// IC -> closed) and blur who was actually accountable for the "no".
const DEAL_STAGES = ['Скрининг','Due Diligence','IC Review','Term Sheet','Переговоры','Закрыта','Отклонена','Отклонена IC'];
const STAGE_COLORS = {
  'Скрининг':     '#06b6d4',
  'IC Review':    '#f97316',
  'Due Diligence':'#8b5cf6',
  'Term Sheet':   '#eab308',
  'Переговоры':   '#3b82f6',
  'Закрыта':      '#22c55e',
  'Отклонена':    '#64748b',
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
      <span style="font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.nextAction)}</span>
      ${d.nextActionDate ? `<span style="font-size:9px;color:#64748b;margin-left:auto;white-space:nowrap">${d.nextActionDate}</span>` : ''}
    </div>` : '';

  return `
    <div class="deal-card" onclick="openDealDetailModal(${d.id})" style="cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:#f1f5f9;line-height:1.3">${escapeHtml(d.company)}</div>
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

async function deleteDeal(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  if (!confirm(`Удалить сделку «${d.company}» без возможности восстановления? Возможно только если по сделке ещё нет меморандума IC.`)) return;
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'DELETE' });
    deals = deals.filter(x => x.id !== id);
    closeDealDetailModal();
    renderPipeline(deals);
    updateBadges();
    showToast('✅ Сделка удалена', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
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
    { id:'dd',         icon:'fa-microscope',     label:'Due Dil.'   },
  ];

  const iS = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;
  const lS = `font-size:10px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:3px;text-transform:uppercase`;
  const gS = `margin-bottom:12px`;


  /* ── Vote badge ── */
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
            <input style="${iS}" value="${escapeHtml(d.nextAction)}"
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
    const docRow = (label, field) => {
      const inputId = `docfield_${field}_${d.id}`;
      const resolved = resolveDocUrl(d[field] || '');
      return `
      <div style="margin-bottom:12px">
        <label style="${lS}">${label}</label>
        <div style="display:flex;gap:8px">
          <input style="${iS}" value="${d[field]||''}" placeholder="https://drive.google.com/... или загрузите файл"
            id="${inputId}"
            onchange="dealField(${d.id},'${field}',this.value)" />
          ${docUploadBtn(inputId)}
          ${d[field] ? `<button onclick="_obOpenPreviewModal('${resolved.replace(/'/g,"\\'")}','${resolved.replace(/'/g,"\\'")}')"
            style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
              padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-eye"></i></button>` : ''}
        </div>
      </div>`;
    };

    tabContent = `
      ${docRow('Pitch Deck', 'pitchDeckUrl')}
      ${docRow('Investment Memo', 'icMemoUrl')}
      ${docRow('Протокол IC / IC Minutes', 'icMinutesUrl')}

      <div style="font-size:10px;font-weight:700;color:#eab308;text-transform:uppercase;margin:14px 0 8px">
        <i class="fas fa-file-contract" style="margin-right:5px"></i>Term Sheet — версии
      </div>
      ${!(d.tsVersions||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет версий</div>` :
        d.tsVersions.map((v,i) => { const tsInputId = `tsver_${d.id}_${i}`; return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:#eab308;min-width:48px">${v.v}</span>
            <span style="font-size:11px;color:#64748b;white-space:nowrap">${v.date}</span>
            <input style="${iS}" value="${v.url||''}" placeholder="https://... или загрузите файл"
              id="${tsInputId}"
              onchange="dealTSVersionUrl(${d.id},${i},this.value)" />
            ${docUploadBtn(tsInputId)}
            ${v.url ? `<button onclick="_obOpenPreviewModal('${resolveDocUrl(v.url).replace(/'/g,"\\'")}','${resolveDocUrl(v.url).replace(/'/g,"\\'")}')"
              style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteTSVersion(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить версию"><i class="fas fa-trash"></i></button>
          </div>`; }).join('')}
      <button onclick="addTSVersion(${d.id})"
        style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.25);color:#eab308;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:14px">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить версию TS
      </button>

      <div style="font-size:10px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:8px">
        <i class="fas fa-signature" style="margin-right:5px"></i>Подписанные документы (закрытие)
      </div>
      ${!(d.signedDocsUrls||[]).length ? `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:8px">Нет документов</div>` :
        d.signedDocsUrls.map((doc,i) => { const sdInputId = `signeddoc_${d.id}_${i}`; return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <span style="font-size:11px;font-weight:700;color:#22c55e;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.name}</span>
            <input style="${iS}" value="${doc.url||''}" placeholder="https://... или загрузите файл"
              id="${sdInputId}"
              onchange="dealSignedDocUrl(${d.id},${i},this.value)" />
            ${docUploadBtn(sdInputId)}
            ${doc.url ? `<button onclick="_obOpenPreviewModal('${resolveDocUrl(doc.url).replace(/'/g,"\\'")}','${resolveDocUrl(doc.url).replace(/'/g,"\\'")}')"
              style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteSignedDoc(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить"><i class="fas fa-trash"></i></button>
          </div>`; }).join('')}
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
        d.otherDocs.map((doc,i) => { const odInputId = `otherdoc_${d.id}_${i}`; return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f1623;border-radius:7px;margin-bottom:5px">
            <input style="${iS};max-width:150px" value="${doc.name||''}" placeholder="Название..."
              onchange="dealOtherDocName(${d.id},${i},this.value)" />
            <input style="${iS}" value="${doc.url||''}" placeholder="https://... или загрузите файл"
              id="${odInputId}"
              onchange="dealOtherDocUrl(${d.id},${i},this.value)" />
            ${docUploadBtn(odInputId)}
            ${doc.url ? `<button onclick="_obOpenPreviewModal('${resolveDocUrl(doc.url).replace(/'/g,"\\'")}','${resolveDocUrl(doc.url).replace(/'/g,"\\'")}')"
              style="background:rgba(100,116,139,0.15);border:1px solid rgba(100,116,139,0.3);color:#94a3b8;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap">
              <i class="fas fa-eye"></i></button>` : ''}
            <button onclick="deleteOtherDoc(${d.id},${i})"
              style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);color:#f87171;
                padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;white-space:nowrap"
              title="Удалить"><i class="fas fa-trash"></i></button>
          </div>`; }).join('')}
      <button onclick="addOtherDoc(${d.id})"
        style="background:rgba(100,116,139,0.1);border:1px solid rgba(100,116,139,0.25);color:#94a3b8;
          padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:4px"></i>Добавить документ
      </button>`;
  }


  else if (_activeDealTab === 'dd') {
    tabContent = `
      <!-- ── DATA ROOM ── -->
      <div style="margin-bottom:16px;padding:12px 14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:9px">
        <label style="${lS}"><i class="fas fa-database" style="margin-right:5px;color:#60a5fa"></i>Data Room — ссылка для DD</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <input style="${iS}" value="${d.dataRoomUrl||''}" placeholder="https://dataroom.intralinks.com/... или загрузите файл"
            id="dataRoomUrl_${d.id}"
            onchange="dealField(${d.id},'dataRoomUrl',this.value)" />
          ${docUploadBtn('dataRoomUrl_' + d.id)}
          ${d.dataRoomUrl ? `<button onclick="window.open('${resolveDocUrl(d.dataRoomUrl||'').replace(/'/g,"\\'")}','_blank')"
            style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;
              padding:5px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
            <i class="fas fa-external-link-alt" style="margin-right:4px"></i>Открыть</button>` : ''}
        </div>
      </div>
      ${(d.ddRedFlags||[]).length ? `
        <div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="font-size:10px;font-weight:700;color:#ef4444;margin-bottom:6px">
            <i class="fas fa-flag" style="margin-right:5px"></i>RED FLAGS
          </div>
          ${d.ddRedFlags.map(f=>`<div style="font-size:11px;color:#fca5a5;padding:3px 0">⚠ ${f}</div>`).join('')}
        </div>` : ''}

      ${ddConclusionsSection(d)}
      ${gpConclusionSection(d)}
      ${dealRejectionBlock(d)}`;
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

  /* ── Progress bar по этапам ── */
  const isRejectedStage = d.stage === 'Отклонена IC' || d.stage === 'Отклонена';
  const stageOrder = DEAL_STAGES.filter(s => s !== 'Отклонена IC' && s !== 'Отклонена');
  const stageIdx   = stageOrder.indexOf(d.stage);
  const progressPct = isRejectedStage ? 0
    : stageIdx >= 0 ? Math.round((stageIdx + 1) / stageOrder.length * 100) : 0;

  document.getElementById('dealDetailContent').innerHTML = `
    <!-- ── HEADER ── -->
    <div style="padding:20px 24px 0;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#1c2333;z-index:10">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h2 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0">${escapeHtml(d.company)}</h2>
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
          ${!isRejectedStage ? `
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
            ${DEAL_STAGES.map(s=>`
              <option value="${s}" ${d.stage===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <button onclick="deleteDeal(${d.id})" title="Удалить безвозвратно"
            style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center"><i class="fas fa-trash"></i></button>
          <button onclick="closeDealDetailModal()"
            style="background:#1c2333;border:1px solid #2a3448;color:#64748b;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div role="tablist" aria-label="Разделы сделки" style="display:flex;gap:2px;overflow-x:auto;padding-bottom:0">
        ${tabs.map(t => `
          <button role="tab" id="dealTab-${t.id}" aria-selected="${_activeDealTab===t.id}" aria-controls="dealTabPanel" onclick="switchDealTab('${t.id}',${d.id})"
            style="padding:8px 14px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:11px;font-weight:700;
              white-space:nowrap;transition:all 0.15s;
              background:${'_activeDealTab'==='${t.id}'?'#0f1623':'transparent'};
              ${_activeDealTab===t.id ? 'background:#0f1623;color:#f1f5f9;border-bottom:2px solid '+stageColor : 'background:transparent;color:#64748b;border-bottom:2px solid transparent'}">
            <i class="fas ${t.icon}" style="margin-right:5px"></i>${t.label}
          </button>`).join('')}
      </div>
    </div>

    <!-- ── TAB CONTENT ── -->
    <div role="tabpanel" id="dealTabPanel" aria-labelledby="dealTab-${_activeDealTab}" style="padding:20px 24px 24px">
      ${tabContent}
    </div>
  `;
}

/* ── Deal helper functions ──
   dealField()/dealMoveStage() below persist via PUT /api/deals/:id
   (only the one changed field, same "never send the whole local deal
   object" rule as every other save in this file — the server merges
   onto the existing row) — until this fix, both only mutated the local
   deals[] array, so every field edited through the deal detail modal
   was lost on reload. */
async function dealField(id, field, value) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const prev = d[field];
  d[field] = value;
  renderPipeline(deals);
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
  } catch (err) {
    d[field] = prev;
    renderPipeline(deals);
    _renderDealModal(d);
    showToast('⚠️ Не удалось сохранить изменение: ' + err.message, 'red');
  }
}

async function dealMoveStage(id, stage) {
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

  // IC approval alone isn't capital actually being deployed — that also
  // needs the definitive agreements (SHA/SPA) on record, not just a
  // committee vote. d.signedDocsUrls is the "Подписанные документы
  // (закрытие)" list on the Документы tab (addSignedDoc()).
  if (stage === 'Закрыта' && !(d.signedDocsUrls || []).length) {
    showToast('⛔ Нельзя закрыть сделку без подписанных документов (SHA/SPA) — добавьте их на вкладке Документы', 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  // Entering IC Review by hand must respect the same gate as creating a
  // real IC memo (saveNewICMemo(), js/modules.js) — otherwise the board
  // could show a deal "at IC Review" that no specialist has actually
  // signed off on. Moving OUT of IC Review (e.g. back to Due Diligence)
  // is never blocked here.
  if (stage === 'IC Review' && d.stage !== 'IC Review' && d.gpConclusionVerdict !== 'Рекомендовано к IC') {
    showToast('⛔ Сначала подпишите заключение УК со статусом "Рекомендовано к IC" на вкладке Due Diligence', 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  // Term Sheet / Переговоры mean the fund is actively structuring and
  // negotiating the investment — that can't start before IC has actually
  // approved the deal, same reasoning as the Закрыта gate above (and the
  // same two fields, since castICVote only ever sets `ic`).
  if ((stage === 'Term Sheet' || stage === 'Переговоры') && d.ic !== 'Одобрено' && d.icDecision !== 'Одобрено') {
    showToast(`⛔ Нельзя перейти к «${stage}» без одобрения IC (текущее решение IC: ${d.ic || d.icDecision || 'Не подано'})`, 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  // Переговоры means negotiating/signing the DEFINITIVE agreements (SHA/
  // SPA — d.signedDocsUrls, "Подписанные документы" on the Документы tab)
  // based on terms the Term Sheet already settled, so it can't start
  // before the Term Sheet itself is actually signed (tsStatus, set in the
  // "Term Sheet — Условия" panel on that same tab).
  if (stage === 'Переговоры' && d.tsStatus !== 'Подписан') {
    showToast('⛔ Term Sheet ещё не подписан — сначала завершите согласование условий на вкладке Документы', 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  // 'Отклонена' is the early, informal pass (Скрининг/DD — no committee
  // involved yet, any RM/CEO can call it). Once the deal has actually
  // reached the committee, a "no" has to go through the real thing —
  // routing it through the generic bucket instead would hide a real IC
  // rejection behind a label that claims no committee was ever involved.
  if (stage === 'Отклонена' && ['IC Review', 'Term Sheet', 'Переговоры'].includes(d.stage)) {
    showToast('⛔ Сделка уже на рассмотрении IC — отклонить можно только через решение комитета («Отклонена IC»)', 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  // 'Отклонена IC' is the mirror image of the Закрыта gate above: it
  // asserts the committee rejected this deal, so it can only be reached
  // once that's actually true, never picked by hand.
  if (stage === 'Отклонена IC' && d.ic !== 'Отклонено' && d.icDecision !== 'Отклонено') {
    showToast(`⛔ Нельзя пометить как «Отклонена IC» без решения комитета (текущее решение IC: ${d.ic || d.icDecision || 'Не подано'})`, 'red');
    _renderDealModal(d);
    renderPipeline(deals);
    return;
  }

  const prevStage = d.stage, prevUpdatedAt = d.updatedAt;
  d.stage = stage;
  d.updatedAt = today();
  _renderDealModal(d);
  renderPipeline(deals);
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({ stage: d.stage, updatedAt: d.updatedAt }) });
    showToast(`✅ ${d.company} → ${stage}`, 'green');
  } catch (err) {
    d.stage = prevStage;
    d.updatedAt = prevUpdatedAt;
    _renderDealModal(d);
    renderPipeline(deals);
    showToast('⚠️ Не удалось сохранить стадию: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════════════
   DD CONCLUSIONS — each of the 7 DD categories gets its own
   written conclusion (not just a checklist status), feeding the
   auto-compiled "Заключение УК" document below it. See
   js/modules.js's saveNewICMemo() for the gate this creates: an
   IC memo tied to a real deal can't be created until the deal's
   gpConclusionVerdict is 'Рекомендовано к IC'.
═══════════════════════════════════════════════════════════ */
const DD_CONCLUSION_CATEGORIES = [
  { key: 'Legal',      title: 'Юридическое DD', color: '#3b82f6' },
  { key: 'Financial',  title: 'Финансовое DD',  color: '#22c55e' },
  { key: 'Tech',       title: 'Техническое DD', color: '#8b5cf6' },
  { key: 'Commercial', title: 'Коммерческое DD',color: '#f97316' },
  { key: 'Risk',       title: 'Risk DD',        color: '#dc2626' },
  { key: 'Compliance', title: 'Compliance DD',  color: '#a855f7' },
  { key: 'MLRO',       title: 'MLRO DD',        color: '#0ea5e9' },
];

function ddConclusionsSection(d) {
  const conclusions = d.ddConclusions || [];
  return `
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #2a3448">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-file-signature" style="margin-right:5px"></i>Заключения ответственных лиц
      </div>
      ${DD_CONCLUSION_CATEGORIES.map(cat => {
        const c = conclusions.find(x => x.category === cat.key);
        const verdictColor = c?.verdict === 'Критично' ? '#ef4444' : c?.verdict === 'Есть замечания' ? '#f97316' : c?.verdict === 'Без замечаний' ? '#22c55e' : '#64748b';
        return `
        <div style="background:#0f1623;border-radius:10px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ${cat.color}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:11px;font-weight:700;color:${cat.color};text-transform:uppercase">${cat.title}</span>
            ${c ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:${verdictColor}22;color:${verdictColor}">${c.verdict || 'Без вердикта'}</span>` : ''}
          </div>
          ${c ? `
            <div style="font-size:11px;color:#5a6b8a;margin-bottom:6px">${escapeHtml(c.author)} · ${c.updatedAt}</div>
            ${(c.documents||[]).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
              ${c.documents.map((doc,i) => `<span style="font-size:10px;background:#1c2333;border-radius:5px;padding:3px 8px;display:inline-flex;align-items:center;gap:5px">
                <a href="${resolveDocUrl(doc.url)}" target="_blank" rel="noopener" style="color:#60a5fa;text-decoration:none"><i class="fas fa-link" style="margin-right:3px"></i>${escapeHtml(doc.name||doc.url)}</a>
                <span onclick="removeDDConclusionDoc(${d.id},'${cat.key}',${i})" style="cursor:pointer;color:#64748b">✕</span>
              </span>`).join('')}
            </div>` : `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:6px">Документы не приложены</div>`}
          ` : `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:6px">Заключение ещё не внесено</div>`}
          <details>
            <summary style="font-size:10px;color:#60a5fa;cursor:pointer">${c ? 'Изменить' : 'Внести заключение'}</summary>
            <div style="margin-top:8px">
              <select id="ddConclVerdict_${d.id}_${cat.key}" style="width:100%;background:#1c2333;border:1px solid #2a3448;border-radius:6px;padding:6px 8px;color:#e2e8f0;font-size:11px;margin-bottom:6px;box-sizing:border-box">
                <option value="">— Вердикт —</option>
                ${['Без замечаний','Есть замечания','Критично'].map(v => `<option value="${v}" ${c?.verdict===v?'selected':''}>${v}</option>`).join('')}
              </select>
              <div style="display:flex;gap:6px;margin-bottom:6px">
                <input id="ddConclDocName_${d.id}_${cat.key}" placeholder="Название документа" style="flex:1;background:#1c2333;border:1px solid #2a3448;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px;box-sizing:border-box" />
                <input id="ddConclDocUrl_${d.id}_${cat.key}" placeholder="https://... или загрузите файл" style="flex:1;background:#1c2333;border:1px solid #2a3448;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px;box-sizing:border-box" />
                ${docUploadBtn(`ddConclDocUrl_${d.id}_${cat.key}`)}
              </div>
              <button onclick="saveDDConclusion(${d.id},'${cat.key}')" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700"><i class="fas fa-save" style="margin-right:4px"></i>Сохранить</button>
            </div>
          </details>
        </div>`;
      }).join('')}
    </div>`;
}

async function saveDDConclusion(id, category) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const verdict = document.getElementById(`ddConclVerdict_${id}_${category}`)?.value || '';
  const docName = document.getElementById(`ddConclDocName_${id}_${category}`)?.value?.trim() || '';
  const docUrl  = document.getElementById(`ddConclDocUrl_${id}_${category}`)?.value?.trim() || '';
  if (!verdict) { showToast('⚠️ Выберите вердикт', 'red'); return; }

  d.ddConclusions = d.ddConclusions || [];
  let entry = d.ddConclusions.find(x => x.category === category);
  const prevEntry = entry ? { ...entry, documents: [...(entry.documents||[])] } : null;
  if (!entry) { entry = { category, documents: [] }; d.ddConclusions.push(entry); }
  entry.author = currentUserDisplayName();
  entry.verdict = verdict;
  entry.updatedAt = today();
  entry.documents = entry.documents || [];
  if (docUrl) entry.documents.push({ name: docName || docUrl, url: docUrl });

  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({ ddConclusions: d.ddConclusions }) });
    _renderDealModal(d);
    showToast(`✅ Заключение (${category}) сохранено`, 'green');
  } catch (err) {
    if (prevEntry) Object.assign(entry, prevEntry);
    else d.ddConclusions = d.ddConclusions.filter(x => x !== entry);
    _renderDealModal(d);
    showToast('⚠️ Не удалось сохранить заключение: ' + err.message, 'red');
  }
}

async function removeDDConclusionDoc(id, category, idx) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const entry = (d.ddConclusions||[]).find(x => x.category === category);
  if (!entry || !entry.documents || !entry.documents[idx]) return;
  const removed = entry.documents[idx];
  entry.documents.splice(idx, 1);
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({ ddConclusions: d.ddConclusions }) });
    _renderDealModal(d);
    showToast('🗑️ Ссылка удалена', 'red');
  } catch (err) {
    entry.documents.splice(idx, 0, removed);
    _renderDealModal(d);
    showToast('⚠️ Не удалось удалить ссылку: ' + err.message, 'red');
  }
}

function gpConclusionSection(d) {
  const signed = !!d.gpConclusionSignedAt;
  const verdictColor = d.gpConclusionVerdict === 'Рекомендовано к IC' ? '#22c55e' : d.gpConclusionVerdict === 'Не рекомендовано' ? '#ef4444' : '#f97316';
  return `
    <div style="margin-top:18px;padding-top:14px;border-top:2px solid #3b82f6;margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-stamp" style="margin-right:5px"></i>Заключение УК для Инвестиционного комитета
      </div>
      ${signed ? `
        <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:12px 14px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:12px;font-weight:700;color:#e2e8f0">${escapeHtml(d.gpConclusionSignedBy)}</span>
            <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:${verdictColor}22;color:${verdictColor}">${d.gpConclusionVerdict}</span>
          </div>
          <div style="font-size:11px;color:#5a6b8a;margin-bottom:6px">${d.gpConclusionSignedAt}</div>
          <div style="font-size:12px;color:#94a3b8;white-space:pre-wrap">${escapeHtml(d.gpConclusionSummary||'')}</div>
        </div>` : `<div style="font-size:11px;color:#475569;font-style:italic;margin-bottom:10px">Заключение УК ещё не подписано — меморандум для IC по этой сделке создать нельзя.</div>`}
      <button onclick="openGpConclusionDocument(${d.id})"
        style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;margin-right:8px">
        <i class="fas fa-file-alt" style="margin-right:5px"></i>Собрать документ
      </button>
      ${currentUserPermission('authorICMemo') ? `
      <details style="display:inline-block;vertical-align:middle">
        <summary style="font-size:11px;color:#60a5fa;cursor:pointer;display:inline">${signed ? 'Переподписать' : 'Подписать заключение'}</summary>
        <div style="margin-top:10px;max-width:420px">
          <button type="button" onclick="draftGpConclusion(${d.id})"
            style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#a78bfa;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-bottom:8px">
            <i class="fas fa-wand-magic-sparkles" style="margin-right:5px"></i>Сгенерировать черновик
          </button>
          <select id="gpConclVerdict_${d.id}" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:6px;padding:6px 8px;color:#e2e8f0;font-size:12px;margin-bottom:6px;box-sizing:border-box">
            <option value="">— Вердикт —</option>
            ${['Рекомендовано к IC','Не рекомендовано','Требует доработки'].map(v => `<option value="${v}" ${d.gpConclusionVerdict===v?'selected':''}>${v}</option>`).join('')}
          </select>
          <textarea id="gpConclSummary_${d.id}" rows="3" placeholder="Обоснование позиции УК..." style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:6px;padding:6px 8px;color:#e2e8f0;font-size:12px;resize:vertical;margin-bottom:6px;box-sizing:border-box">${escapeHtml(d.gpConclusionSummary||'')}</textarea>
          <button onclick="signGpConclusion(${d.id})" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700"><i class="fas fa-signature" style="margin-right:5px"></i>Подписать</button>
        </div>
      </details>` : ''}
    </div>`;
}

// Rule-based draft, not AI — fills the verdict/summary fields from a
// deterministic read of the 7 DD conclusions so the responsible person
// isn't starting from a blank page. Explicitly a draft: it only
// populates the form, never calls signGpConclusion() itself — the human
// still reviews, edits, and clicks "Подписать" themselves. Written so the
// text-generation part alone can be swapped for a real LLM call later
// without touching how it's wired into the sign-off form.
function draftGpConclusion(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const conclusions = d.ddConclusions || [];
  const catTitle = key => (DD_CONCLUSION_CATEGORIES.find(c => c.key === key) || {}).title || key;

  const written  = DD_CONCLUSION_CATEGORIES.filter(cat => conclusions.some(c => c.category === cat.key));
  const missing  = DD_CONCLUSION_CATEGORIES.filter(cat => !conclusions.some(c => c.category === cat.key));
  const critical = conclusions.filter(c => c.verdict === 'Критично');
  const flagged  = conclusions.filter(c => c.verdict === 'Есть замечания');
  const clean    = conclusions.filter(c => c.verdict === 'Без замечаний');

  let verdict;
  if (missing.length) verdict = 'Требует доработки';
  else if (critical.length) verdict = 'Не рекомендовано';
  else if (flagged.length) verdict = 'Требует доработки';
  else verdict = 'Рекомендовано к IC';

  const lines = [];
  lines.push(`Заключения получены по ${written.length} из ${DD_CONCLUSION_CATEGORIES.length} направлений DD.`);
  if (missing.length)  lines.push(`Отсутствуют заключения: ${missing.map(c => c.title).join(', ')}.`);
  if (critical.length) lines.push(`Критические замечания (${critical.length}): ${critical.map(c => catTitle(c.category)).join(', ')}.`);
  if (flagged.length)  lines.push(`Есть замечания (${flagged.length}): ${flagged.map(c => catTitle(c.category)).join(', ')}.`);
  if (clean.length)    lines.push(`Без замечаний (${clean.length}): ${clean.map(c => catTitle(c.category)).join(', ')}.`);
  lines.push('');
  lines.push(`Предварительная рекомендация: ${verdict}.`);
  if (critical.length) {
    lines.push('Обоснование: выявлены критические замечания, требующие устранения до вынесения на IC.');
  } else if (missing.length) {
    lines.push('Обоснование: due diligence не завершён, часть направлений не покрыта заключениями.');
  } else if (flagged.length) {
    lines.push('Обоснование: есть отдельные замечания без критичного характера — рекомендуется уточнение перед вынесением на IC.');
  } else {
    lines.push('Обоснование: все направления DD пройдены без замечаний.');
  }
  lines.push('');
  lines.push('[Черновик сгенерирован автоматически по правилам — проверьте и отредактируйте перед подписанием]');

  const summaryEl = document.getElementById(`gpConclSummary_${id}`);
  const verdictEl = document.getElementById(`gpConclVerdict_${id}`);
  if (summaryEl) summaryEl.value = lines.join('\n');
  if (verdictEl) verdictEl.value = verdict;
  showToast('📝 Черновик заключения УК сгенерирован — проверьте перед подписанием', 'blue');
}

async function signGpConclusion(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const verdict = document.getElementById(`gpConclVerdict_${id}`)?.value;
  const summary = document.getElementById(`gpConclSummary_${id}`)?.value?.trim() || '';
  if (!verdict) { showToast('⚠️ Выберите вердикт', 'red'); return; }
  if (!confirm(`Подписать заключение УК со статусом «${verdict}»? Это официальная позиция управляющей компании для Инвестиционного комитета.`)) return;

  const prev = {
    verdict: d.gpConclusionVerdict, summary: d.gpConclusionSummary,
    signedBy: d.gpConclusionSignedBy, signedAt: d.gpConclusionSignedAt,
  };
  d.gpConclusionVerdict = verdict;
  d.gpConclusionSummary = summary;
  d.gpConclusionSignedBy = currentUserDisplayName();
  d.gpConclusionSignedAt = today();
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({
      gpConclusionVerdict: d.gpConclusionVerdict, gpConclusionSummary: d.gpConclusionSummary,
      gpConclusionSignedBy: d.gpConclusionSignedBy, gpConclusionSignedAt: d.gpConclusionSignedAt,
    }) });
    _renderDealModal(d);
    showToast('✅ Заключение УК подписано', 'green');
  } catch (err) {
    d.gpConclusionVerdict = prev.verdict; d.gpConclusionSummary = prev.summary;
    d.gpConclusionSignedBy = prev.signedBy; d.gpConclusionSignedAt = prev.signedAt;
    _renderDealModal(d);
    showToast('⚠️ Не удалось сохранить заключение УК: ' + err.message, 'red');
  }
}

// Auto-compiled document — same openPrintableDocument() pattern already
// used by printICMemo() and every LP/onboarding document generator.
// Pulls all 7 category conclusions + the GP's own sign-off into one
// document; can be generated at any point (before signing too, to review
// what's been gathered so far), not only once signed.
function openGpConclusionDocument(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const fp = FUND_PARAMS;
  const fund = funds.find(f => f.id === d.fundId);
  const conclusions = d.ddConclusions || [];

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
  .resolution-box { background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:12px 16px; margin:14px 0; }
  .risk-box { border:1px solid #cbd5e0; border-radius:4px; padding:10px 14px; margin-bottom:14px; }
  .risk-box.veto { border-color:#dc2626; background:#fef2f2; }
  .signature-block { margin-top:32px; display:flex; justify-content:space-between; }
  .sig-col { width:45%; }
  .sig-line { border-top:1px solid #333; margin-top:44px; padding-top:5px; font-size:10pt; }
  .footer { margin-top:28px; padding-top:10px; border-top:1px solid #cbd5e0; font-size:8.5pt; color:#718096; text-align:center; }
  `;

  const body = `
  <div class="header">
    <div>
      <div class="logo-name">${fp.gp}</div>
      <div class="logo-sub">General Partner · ${fp.name}</div>
      <div class="logo-sub">AFSA: ${fp.license}</div>
    </div>
    <div class="ref-block">
      <div><b>Фонд:</b> ${fund ? fund.shortName : '—'}</div>
      <div><b>Deal:</b> ${escapeHtml(d.company)}</div>
      <div><b>Дата:</b> ${today()}</div>
      <div><b>STRICTLY CONFIDENTIAL</b></div>
    </div>
  </div>

  <h1>Заключение управляющей компании</h1>
  <div class="subtitle">по сделке для рассмотрения Инвестиционным комитетом ${fund ? escapeHtml(fund.shortName) : ''}</div>

  <table class="deal-table">
    <tr><td>Фонд</td><td><b>${fund ? escapeHtml(fund.name || fund.shortName) : 'Не привязан к фонду'}</b></td></tr>
    <tr><td>Компания</td><td><b>${escapeHtml(d.company)}</b></td></tr>
    <tr><td>Сектор</td><td>${d.sector||'—'}</td></tr>
    <tr><td>Сумма инвестиций</td><td><b>${currencySymbol(currencyForEntity(d))}${d.amount}M</b></td></tr>
    <tr><td>Стадия</td><td>${d.stage||'—'}</td></tr>
  </table>

  ${DD_CONCLUSION_CATEGORIES.map(cat => {
    const c = conclusions.find(x => x.category === cat.key);
    return `
    <div class="section">
      <div class="section-title">${cat.title}${c && c.verdict ? ' — ' + c.verdict : ''}</div>
      <div class="section-text">${c ? `${escapeHtml(c.author||'')} · ${c.updatedAt||''}` : 'Заключение не предоставлено'}</div>
      ${c && (c.documents||[]).length ? `<div style="font-size:9pt;color:#4a5568;margin-top:4px">Документы: ${c.documents.map(doc=>doc.name||doc.url).join(', ')}</div>` : ''}
    </div>`;
  }).join('')}

  ${d.gpConclusionSignedAt ? `
  <div class="resolution-box">
    <div class="section-title" style="border:none">Итоговая позиция УК</div>
    <div class="section-text"><b>${d.gpConclusionVerdict}</b></div>
    <div class="section-text">${d.gpConclusionSummary||''}</div>
  </div>` : `<div class="risk-box veto"><div class="section-text">Заключение УК ещё не подписано.</div></div>`}

  <div class="signature-block">
    <div class="sig-col">
      <div class="sig-line">
        <div>${d.gpConclusionSignedBy || '_______________________'}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gpTitle}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gp} (General Partner)</div>
      </div>
    </div>
  </div>

  <div class="footer">
    ${fp.gp} · ${fp.gpAddress} · BIN: ${fp.gpBIN} · AFSA: ${fp.license}<br>
    STRICTLY CONFIDENTIAL — Только для внутреннего использования и Инвестиционного комитета.
  </div>
  `;

  const win = openPrintableDocument(body, {
    title: `Заключение УК — ${escapeHtml(d.company)}`,
    features: 'width=900,height=800',
    extraStyle: docStyle,
  });
  if (win) showToast(`📄 Документ заключения УК сформирован`, 'green');
}

// Moved here from the now-removed "IC" tab — the only part of that tab
// that wasn't redundant with the real IC process (DD conclusions -> GP
// sign-off -> icMemos voting). Always rendered (not just when rejected)
// so it's ready to fill in the moment a rejection happens.
function dealRejectionBlock(d) {
  // 'Отклонена' (early, informal pass) and 'Отклонена IC' (formal
  // committee rejection, gated in dealMoveStage()) are different events
  // for pipeline-conversion reporting, but share the same follow-up
  // fields — this block just labels which one actually happened.
  const isIcRejection = d.stage === 'Отклонена IC' || d.icDecision === 'Отклонено';
  const isEarlyRejection = d.stage === 'Отклонена' && !isIcRejection;
  const isRejected = isIcRejection || isEarlyRejection;
  const borderColor = isRejected ? 'rgba(239,68,68,0.4)' : 'rgba(100,116,139,0.2)';
  const headerColor = isRejected ? '#ef4444' : '#64748b';
  const bgColor     = isRejected ? 'rgba(239,68,68,0.07)' : 'rgba(15,22,35,0.6)';
  const gS = `margin-bottom:12px`;
  const lS = `font-size:10px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:3px;text-transform:uppercase`;
  const iS = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;
  return `
    <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:14px;margin-top:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:10px;font-weight:700;color:${headerColor};text-transform:uppercase">
          <i class="fas fa-times-circle" style="margin-right:5px"></i>Решение об отклонении
        </div>
        ${isIcRejection
          ? `<span style="font-size:9px;padding:2px 8px;border-radius:5px;background:rgba(239,68,68,0.15);color:#f87171;font-weight:700">ОТКЛОНЕНА КОМИТЕТОМ (IC)</span>`
          : isEarlyRejection
          ? `<span style="font-size:9px;padding:2px 8px;border-radius:5px;background:rgba(100,116,139,0.15);color:#94a3b8;font-weight:700">ОТКЛОНЕНА ДО IC</span>`
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
}

// Shared by every array-field mutator below (TS versions, signed docs,
// other docs, founder contacts, negotiation meetings) — persists the
// whole current value of one JSON array field, same "one field, current
// value" PUT as dealField() above. Returns false (and toasts) on
// failure so the caller can roll back its own snapshot — array shapes
// differ too much (push vs splice vs indexed edit) for one shared
// rollback to fit all of them.
async function _persistDealArrayField(id, field) {
  const d = deals.find(x => x.id === id);
  if (!d) return true;
  try {
    await apiFetch(`/api/deals/${id}`, { method: 'PUT', body: JSON.stringify({ [field]: d[field] }) });
    return true;
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
    return false;
  }
}

async function dealAddMeeting(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const prev = d.negMeetings || [];
  d.negMeetings = [...prev, { date: today(), participants: '', outcome: '' }];
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'negMeetings')) { d.negMeetings = prev; _renderDealModal(d); }
}

async function addTSVersion(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const n = (d.tsVersions||[]).length + 1;
  const prev = d.tsVersions || [];
  d.tsVersions = [...prev, { v:`v${n}`, date: today(), url:'' }];
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'tsVersions')) { d.tsVersions = prev; _renderDealModal(d); }
}

async function dealTSVersionUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.tsVersions || !d.tsVersions[i]) return;
  const prevUrl = d.tsVersions[i].url;
  d.tsVersions[i].url = url;
  if (!await _persistDealArrayField(id, 'tsVersions')) { d.tsVersions[i].url = prevUrl; _renderDealModal(d); }
}

async function addSignedDoc(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const name = prompt('Название документа (SHA, SPA, SAFE...):');
  if (!name) return;
  const prev = d.signedDocsUrls || [];
  d.signedDocsUrls = [...prev, { name, url:'' }];
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'signedDocsUrls')) { d.signedDocsUrls = prev; _renderDealModal(d); }
}

async function dealSignedDocUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.signedDocsUrls || !d.signedDocsUrls[i]) return;
  const prevUrl = d.signedDocsUrls[i].url;
  d.signedDocsUrls[i].url = url;
  if (!await _persistDealArrayField(id, 'signedDocsUrls')) { d.signedDocsUrls[i].url = prevUrl; _renderDealModal(d); }
}

async function addFounderContact(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const prev = d.founderContacts || [];
  d.founderContacts = [...prev, { role:'', name:'', phone:'', email:'' }];
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'founderContacts')) { d.founderContacts = prev; _renderDealModal(d); }
}

/* ── TS version delete ── */
async function deleteTSVersion(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.tsVersions) return;
  if (!confirm(`Удалить версию TS "${d.tsVersions[i]?.v}"?`)) return;
  const prev = d.tsVersions;
  d.tsVersions = prev.filter((_, idx) => idx !== i);
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'tsVersions')) { d.tsVersions = prev; _renderDealModal(d); }
}

/* ── Signed doc delete ── */
async function deleteSignedDoc(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.signedDocsUrls) return;
  if (!confirm(`Удалить документ "${d.signedDocsUrls[i]?.name}"?`)) return;
  const prev = d.signedDocsUrls;
  d.signedDocsUrls = prev.filter((_, idx) => idx !== i);
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'signedDocsUrls')) { d.signedDocsUrls = prev; _renderDealModal(d); }
}

/* ── Other docs: add / update name / update url / delete ── */
async function addOtherDoc(id) {
  const d = deals.find(x => x.id === id);
  if (!d) return;
  const prev = d.otherDocs || [];
  d.otherDocs = [...prev, { name:'', url:'' }];
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'otherDocs')) { d.otherDocs = prev; _renderDealModal(d); }
}
async function dealOtherDocName(id, i, val) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.otherDocs || !d.otherDocs[i]) return;
  const prevName = d.otherDocs[i].name;
  d.otherDocs[i].name = val;
  if (!await _persistDealArrayField(id, 'otherDocs')) { d.otherDocs[i].name = prevName; _renderDealModal(d); }
}
async function dealOtherDocUrl(id, i, url) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.otherDocs || !d.otherDocs[i]) return;
  const prevUrl = d.otherDocs[i].url;
  d.otherDocs[i].url = url;
  if (!await _persistDealArrayField(id, 'otherDocs')) { d.otherDocs[i].url = prevUrl; _renderDealModal(d); }
}
async function deleteOtherDoc(id, i) {
  const d = deals.find(x => x.id === id);
  if (!d || !d.otherDocs) return;
  const prev = d.otherDocs;
  d.otherDocs = prev.filter((_, idx) => idx !== i);
  _renderDealModal(d);
  if (!await _persistDealArrayField(id, 'otherDocs')) { d.otherDocs = prev; _renderDealModal(d); }
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
  const amount   = parseFloat(document.getElementById('deal_amount').value) || 0;
  const type     = document.getElementById('deal_type').value;
  const priority = document.getElementById('deal_priority').value;
  const manager  = document.getElementById('deal_manager').value;
  const description = document.getElementById('deal_comment').value.trim();

  if (!company) { alert('Введите название компании'); return; }

  // Every new deal starts at Скрининг with no IC decision on record —
  // both used to be free-form selects on this form (deal_stage/deal_ic),
  // which meant creating a deal let you back-date it straight to
  // "Закрыта"/ic:"Одобрено" with zero DD, zero GP conclusion, zero real
  // IC vote. Real progression now only happens through dealMoveStage()'s
  // gates and castICVote()'s server-derived resolution.
  const newDeal = {
    fundId: typeof activeFundId !== 'undefined' ? activeFundId : null,
    // ── Core (from form) ──
    company, sector, stage: 'Скрининг', amount,
    type, priority, manager,
    ic: 'Не подано',

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
    icDecision: 'Не подано',
    icDate: '',
    icVotes: [],

    // ── Due Diligence ──
    ddDeadline: '',
    dataRoomUrl: '',
    ddLegal:     [],
    ddFinancial: [],
    ddTech:      [],
    ddCommercial:[],
    ddRisk:      [],
    ddCompliance:[],
    ddMlro:      [],
    ddRedFlags:  [],
    ddConclusions: [],
    gpConclusionVerdict: '', gpConclusionSummary: '', gpConclusionSignedBy: '', gpConclusionSignedAt: '',

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
    closeModalSilent();
    showToast('✅ Сделка добавлена в pipeline');
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
    closeModalSilent();
    showToast(`✅ Компания добавлена в портфель: ${name}`);
  } catch (err) {
    showToast('⚠️ Не удалось сохранить компанию: ' + err.message, 'red');
  }
}

let portfolioView = 'grid';
let portShowArchived = false;

function setPortfolioView(view, btnEl) {
  portfolioView = view;
  if (btnEl) {
    const group = btnEl.parentElement;
    if (group) group.querySelectorAll('.vt-btn').forEach(b => b.classList.toggle('active', b === btnEl));
  }
  renderPortfolio(portfolio);
}

function togglePortShowArchived() {
  portShowArchived = !portShowArchived;
  const btn = document.getElementById('portArchiveToggle');
  if (btn) btn.classList.toggle('active', portShowArchived);
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

async function deletePortfolioCompany(id) {
  const p = portfolio.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Удалить «${p.name}» из портфеля без возможности восстановления? Возможно только если по компании нет реальных инвестиций и она не связана с клиентом онбординга.`)) return;
  try {
    await apiFetch(`/api/portfolio/${id}`, { method: 'DELETE' });
    portfolio = portfolio.filter(x => x.id !== id);
    closePortfolioModal();
    renderPortfolio(portfolio);
    updateBadges();
    showToast('✅ Компания удалена из портфеля', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

async function archivePortfolioCompany(id) {
  const p = portfolio.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Отправить «${p.name}» в архив?`)) return;
  try {
    const updated = await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ archived: true }) });
    Object.assign(p, updated);
    if (document.getElementById('modal-port-detail').style.display !== 'none') _renderPortfolioModal(p);
    renderPortfolio(portfolio);
    showToast('📦 Компания отправлена в архив', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

async function restorePortfolioCompany(id) {
  const p = portfolio.find(x => x.id === id);
  if (!p) return;
  try {
    const updated = await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ archived: false }) });
    Object.assign(p, updated);
    if (document.getElementById('modal-port-detail').style.display !== 'none') _renderPortfolioModal(p);
    renderPortfolio(portfolio);
    showToast('📤 Компания восстановлена из архива', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
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
  data = data.filter(p => portShowArchived ? p.archived : !p.archived);
  if (data.length === 0) {
    container.className = portfolioView === 'grid' ? 'portfolio-grid' : 'portfolio-list';
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#4a5568">
      <i class="fas fa-briefcase" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>
      Портфельных компаний не найдено
    </div>`;
    return;
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
                  <div class="port-card-name">${escapeHtml(p.name)}</div>
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
        <div><strong>${escapeHtml(p.name)}</strong><div style="font-size:11px;color:var(--text-muted)">${p.sector}</div></div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:${stCol}22;color:${stCol}">${portStatusLabel(st)}</span>
        <div style="font-weight:700">${currencySymbol(currencyForEntity(p))}${p.invested}M</div>
        <div style="color:#22c55e;font-weight:700">${currencySymbol(currencyForEntity(p))}${p.value}M</div>
        <div style="color:#60a5fa;font-weight:800">${moic}x</div>
        <div>${p.exitStrategy} · ${p.exitYear}</div>
        <div class="action-btns">
          ${p.archived
            ? `<button class="act-btn" onclick="event.stopPropagation();restorePortfolioCompany(${p.id})"><i class="fas fa-box-open"></i></button>`
            : `<button class="act-btn del" onclick="event.stopPropagation();archivePortfolioCompany(${p.id})"><i class="fas fa-box-archive"></i></button>`}
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
  _renderPortfolioModal(p);
  document.getElementById('portDetailOverlay').style.display = 'block';
  document.getElementById('modal-port-detail').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePortfolioModal() {
  document.getElementById('portDetailOverlay').style.display = 'none';
  document.getElementById('modal-port-detail').style.display = 'none';
  document.body.style.overflow = '';
}

function _renderPortfolioModal(p) {
  const st = portAutoStatus(p);
  const stCol = portStatusColor(st);
  const moic = portMOIC(p);
  const mon = p.monitoring || {};
  const docs = p.documents || { files:[] };

  const iS = `background:#0f1623;border:1px solid #2a3448;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;
  const lS = `font-size:10px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:3px;text-transform:uppercase`;
  const gS = `margin-bottom:12px`;

  const requiredTypes = [
    'SHA / Кредитное соглашение',
    'Залоговые документы',
    'Финотчётность Q1 2025',
    'Финотчётность Q4 2024',
    'Финотчётность Q3 2024',
    'Финотчётность Q2 2024',
  ];
  const today30 = new Date(); today30.setDate(today30.getDate()+30);

  /* ── Monitoring conclusion (quarterly) ── */
  const conclusions = mon.conclusions || [];
  const quarterOpts = recentQuarters(6);
  const selQuarter = quarterOpts.includes(p._selMonConclQuarter) ? p._selMonConclQuarter : quarterOpts[0];
  const selConclusion = conclusions.find(c => c.quarter === selQuarter);

  const conclusionHistory = conclusions
    .filter(c => c.quarter !== selQuarter)
    .sort((a, b) => a.quarter < b.quarter ? 1 : -1);

  const tabContent = `
    <!-- ── Monitoring conclusion (quarterly) ── -->
    <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.25);border-radius:10px;padding:14px;margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-size:10px;font-weight:700;color:#c4b5fd;text-transform:uppercase">
          <i class="fas fa-clipboard-list" style="margin-right:5px"></i>Заключение мониторинга (раз в квартал)
        </div>
        <select id="monConclQuarter_${p.id}" style="${iS};width:auto" onchange="switchMonConclQuarter(${p.id},this.value)">
          ${quarterOpts.map(q=>`<option value="${q}" ${q===selQuarter?'selected':''}>${q}</option>`).join('')}
        </select>
      </div>
      <textarea id="monConclText_${p.id}" rows="5" style="${iS};height:110px;resize:vertical"
        placeholder="Нажмите «Сгенерировать черновик» или напишите заключение вручную...">${selConclusion?.text||''}</textarea>
      ${selConclusion?.editedBy ? `<div style="font-size:10px;color:#8a9bbf;margin-top:6px">Последнее изменение: ${selConclusion.editedBy}, ${selConclusion.editedAt}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button onclick="draftMonitoringConclusion(${p.id})"
          style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.4);color:#c4b5fd;
            padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-wand-magic-sparkles" style="margin-right:6px"></i>Сгенерировать черновик
        </button>
        <button onclick="saveMonitoringConclusion(${p.id})"
          style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;
            padding:7px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-save" style="margin-right:6px"></i>Сохранить
        </button>
      </div>
      ${conclusionHistory.length ? `
        <details style="margin-top:12px">
          <summary style="font-size:10px;color:#8a9bbf;cursor:pointer;text-transform:uppercase;font-weight:700">Прошлые кварталы (${conclusionHistory.length})</summary>
          ${conclusionHistory.map(c=>`
            <div style="background:#0f1623;border-radius:8px;padding:10px 12px;margin-top:8px">
              <div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-bottom:4px">
                <b style="color:#c4b5fd">${c.quarter}</b><span>${c.editedBy||'—'}, ${c.editedAt||''}</span>
              </div>
              <div style="font-size:11px;color:#94a3b8;white-space:pre-wrap">${c.text||''}</div>
            </div>`).join('')}
        </details>` : ''}
    </div>

    <!-- ── Drive link ── -->
    <div style="margin-bottom:14px;padding:12px 14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:9px">
      <label style="${lS}"><i class="fas fa-folder" style="margin-right:5px;color:#60a5fa"></i>Ссылка на папку Google Drive</label>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input style="${iS}" value="${docs.driveUrl||''}" placeholder="https://drive.google.com/... или загрузите файл"
          id="portDriveUrl_${p.id}"
          onchange="portNestedField(${p.id},'documents','driveUrl',this.value)" />
        ${docUploadBtn('portDriveUrl_' + p.id)}
        ${docs.driveUrl?`<button onclick="window.open('${resolveDocUrl(docs.driveUrl).replace(/'/g,"\\'")}','_blank')"
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
          ${f.url?`<button onclick="window.open('${resolveDocUrl(f.url).replace(/'/g,"\\'")}','_blank')"
            style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.25);color:#60a5fa;
              padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10px" title="Открыть файл"><i class="fas fa-eye"></i></button>`:''}
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
        <div style="grid-column:1/-1"><label style="${lS}">Файл (с компьютера) или ссылка</label>
          <div style="display:flex;gap:8px">
            <input id="doc_url_${p.id}" style="${iS}" placeholder="https://... или загрузите файл" />
            ${docUploadBtn('doc_url_' + p.id)}
          </div>
        </div>
      </div>
      <button onclick="addPortDoc(${p.id})"
        style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;
          padding:7px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:5px"></i>Добавить документ
      </button>
    </div>`;


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
              <h2 style="font-size:18px;font-weight:800;color:#f1f5f9;margin:0">${escapeHtml(p.name)}</h2>
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
          ${p.archived
            ? `<button onclick="restorePortfolioCompany(${p.id})" title="Восстановить из архива"
                style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;width:32px;height:32px;
                  border-radius:7px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center"><i class="fas fa-box-open"></i></button>`
            : `<button onclick="archivePortfolioCompany(${p.id})" title="В архив"
                style="background:rgba(148,163,184,0.12);border:1px solid rgba(148,163,184,0.3);color:#94a3b8;width:32px;height:32px;
                  border-radius:7px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center"><i class="fas fa-box-archive"></i></button>`}
          <button onclick="deletePortfolioCompany(${p.id})" title="Удалить безвозвратно"
            style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center"><i class="fas fa-trash"></i></button>
          <button onclick="closePortfolioModal()"
            style="background:#1c2333;border:1px solid #2a3448;color:#64748b;width:32px;height:32px;
              border-radius:7px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
      </div>
      ${p.archived ? `<div style="margin:0 24px 12px;padding:8px 12px;background:rgba(148,163,184,0.1);border:1px solid rgba(148,163,184,0.25);border-radius:8px;font-size:11px;color:#94a3b8">
        <i class="fas fa-box-archive" style="margin-right:6px"></i>В архиве${p.archivedBy ? ` · ${p.archivedBy} · ${formatDate(p.archivedAt)}` : ''}
      </div>` : ''}
    </div>

    <!-- ── DOCUMENTS ── -->
    <div style="padding:20px 24px 24px">
      ${tabContent}
    </div>
  `;
}

/* ══════════════════════════════════════════════
   PORTFOLIO HELPER FUNCTIONS
══════════════════════════════════════════════ */
async function portChangeStatus(id, status) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const old = p.status;
  const prevLastUpdated = p.lastUpdated;
  p.status = status;
  p.lastUpdated = today();
  p.history = p.history || [];
  p.history.push({ type:'status', date:today(), author:'System', text:`Статус изменён: ${portStatusLabel(old)} → ${portStatusLabel(status)}` });
  try {
    await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ status: p.status, history: p.history, lastUpdated: p.lastUpdated }) });
  } catch (err) {
    p.status = old;
    p.lastUpdated = prevLastUpdated;
    p.history.pop();
    _renderPortfolioModal(p);
    showToast('⚠️ Не удалось сохранить статус: ' + err.message, 'red');
    return;
  }
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

// Both of these only ever mutated the in-memory portfolio[] array — no
// apiFetch call at all, despite the server already having a real
// documents_json/monitoring_json/etc. column ready to receive updates
// (server/portfolioMapping.js). Every edit anywhere in the Portfolio
// company modal (monitoring, compliance, exit, document links, ...)
// was silently lost on reload.
async function portNestedField(id, section, field, value) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  if (!p[section]) p[section] = {};
  const prevSection = { ...p[section] };
  const prevLastUpdated = p.lastUpdated;
  p[section][field] = value;
  p.lastUpdated = today();
  try {
    await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ [section]: p[section], lastUpdated: p.lastUpdated }) });
    renderPortfolio(portfolio);
  } catch (err) {
    p[section] = prevSection;
    p.lastUpdated = prevLastUpdated;
    _renderPortfolioModal(p);
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

async function addPortDoc(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const type   = document.getElementById(`doc_type_${id}`)?.value?.trim();
  const name   = document.getElementById(`doc_name_${id}`)?.value?.trim();
  const period = document.getElementById(`doc_period_${id}`)?.value?.trim() || '';
  const by     = document.getElementById(`doc_by_${id}`)?.value?.trim() || 'Менеджер';
  const date   = document.getElementById(`doc_date_${id}`)?.value || today();
  const expiry = document.getElementById(`doc_expiry_${id}`)?.value || '';
  const url    = document.getElementById(`doc_url_${id}`)?.value?.trim() || '';
  if (!type || !name) { showToast('⚠ Введите тип и название файла', 'red'); return; }
  if (!p.documents) p.documents = { files:[] };
  const prevFiles = [...(p.documents.files||[])];
  const prevLastUpdated = p.lastUpdated;
  p.documents.files.push({ type, name, date, period, uploadedBy:by, expiryDate:expiry, status:'OK', url });
  p.lastUpdated = today();
  try {
    await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ documents: p.documents, lastUpdated: p.lastUpdated }) });
  } catch (err) {
    p.documents.files = prevFiles;
    p.lastUpdated = prevLastUpdated;
    _renderPortfolioModal(p);
    showToast('⚠️ Не удалось сохранить документ: ' + err.message, 'red');
    return;
  }
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
  showToast(`✅ Документ «${name}» добавлен`, 'green');
  _renderPortfolioModal(p);
  renderPortfolio(portfolio);
}

async function deletePortDoc(id, i) {
  const p = portfolio.find(x=>x.id===id);
  if (!p?.documents?.files) return;
  if (!confirm(`Удалить документ «${p.documents.files[i]?.name}»?`)) return;
  const prevFiles = [...p.documents.files];
  const prevLastUpdated = p.lastUpdated;
  p.documents.files.splice(i, 1);
  p.lastUpdated = today();
  try {
    await apiFetch(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify({ documents: p.documents, lastUpdated: p.lastUpdated }) });
  } catch (err) {
    p.documents.files = prevFiles;
    p.lastUpdated = prevLastUpdated;
    showToast('⚠️ Не удалось удалить документ: ' + err.message, 'red');
  }
  _renderPortfolioModal(p);
  renderPortfolio(portfolio);
}

/* ── Monitoring conclusion (quarterly, rule-based draft — see
   draftGpConclusion() in the Deal module for the same pattern: a
   deterministic summary built from what's already on file, not a real
   AI/LLM call. Written so the text-generation step alone can be swapped
   for a real model call later without touching the save/edit/history
   plumbing around it. ── */
function recentQuarters(count) {
  const now = new Date();
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  const out = [];
  let q = curQ, y = now.getFullYear();
  for (let i = 0; i < count; i++) {
    out.push(`Q${q} ${y}`);
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}

function switchMonConclQuarter(id, quarter) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  p._selMonConclQuarter = quarter;
  _renderPortfolioModal(p);
}

function draftMonitoringConclusion(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const quarter = document.getElementById(`monConclQuarter_${id}`)?.value || recentQuarters(1)[0];
  const files = (p.documents?.files || []);
  const requiredTypes = [
    'SHA / Кредитное соглашение', 'Залоговые документы',
    'Финотчётность Q1 2025', 'Финотчётность Q4 2024', 'Финотчётность Q3 2024', 'Финотчётность Q2 2024',
  ];
  const missing = requiredTypes.filter(rt => !files.some(f => f.type === rt));
  const conclusions = (p.monitoring?.conclusions || []).slice().sort((a,b) => a.quarter < b.quarter ? 1 : -1);
  const prevConclusion = conclusions.find(c => c.quarter !== quarter);
  const newFiles = prevConclusion ? files.filter(f => f.date > (prevConclusion.editedAt || '')) : files;
  const expired = files.filter(f => f.expiryDate && f.expiryDate < today());

  const lines = [];
  lines.push(`Мониторинг ${quarter}: в деле ${files.length} документ(ов), из них ${newFiles.length} — новых с последнего заключения (${prevConclusion ? prevConclusion.quarter : 'заключений ранее не было'}).`);
  lines.push(missing.length ? `Отсутствуют обязательные документы: ${missing.join(', ')}.` : 'Все обязательные документы в наличии.');
  if (newFiles.length) lines.push(`Новые документы за период: ${newFiles.map(f=>`${f.type} (${f.name})`).join('; ')}.`);
  if (expired.length) lines.push(`⚠ Истёк срок действия: ${expired.map(f=>`${f.type} (до ${f.expiryDate})`).join('; ')}.`);
  lines.push('— Черновик сформирован автоматически по составу и датам загруженных документов (без анализа их содержимого). Требует проверки и корректировки менеджером перед сохранением.');

  const el = document.getElementById(`monConclText_${id}`);
  if (el) el.value = lines.join('\n');
}

async function saveMonitoringConclusion(id) {
  const p = portfolio.find(x=>x.id===id);
  if (!p) return;
  const quarter = document.getElementById(`monConclQuarter_${id}`)?.value || recentQuarters(1)[0];
  const text = document.getElementById(`monConclText_${id}`)?.value?.trim() || '';
  if (!text) { showToast('⚠ Заключение пустое — нечего сохранять', 'red'); return; }
  const conclusions = (p.monitoring?.conclusions || []).filter(c => c.quarter !== quarter);
  conclusions.push({ quarter, text, editedBy: (typeof currentUserDisplayName === 'function' ? currentUserDisplayName() : 'Менеджер'), editedAt: today() });
  await portNestedField(id, 'monitoring', 'conclusions', conclusions);
  showToast(`✅ Заключение мониторинга за ${quarter} сохранено`, 'green');
  _renderPortfolioModal(p);
}

/* ===== MODALS ===== */
// id -> { fieldId: value } snapshot taken the moment a modal is shown, so
// closeModal() can tell whether the user actually typed anything before
// warning about discarding it. Dedicated open*Modal() wrappers that
// pre-populate fields (e.g. openNewFundModal/openEditFundModal) always
// call openModal(name) as their LAST step, after populating, so the
// snapshot always reflects the real starting state, not a blank one.
const _modalDirtySnapshots = {};
function _snapshotModalFields(modalEl) {
  const data = {};
  modalEl.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.id) return;
    data[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
  });
  return data;
}
function _isModalDirty(modalEl) {
  const snap = _modalDirtySnapshots[modalEl.id];
  if (!snap) return false;
  const current = _snapshotModalFields(modalEl);
  return Object.keys(current).some(k => current[k] !== snap[k]);
}
// System 3 (#modal-ob-new, js/onboarding.js + js/users.js): one shared
// modal div reused for ~8 different forms via innerHTML swaps. Each
// open*Modal() calls this once right after building its content, so
// closeObNewModal() (js/onboarding.js) can run the same dirty-check.
function _snapshotObNewModal() {
  const modal = document.getElementById('modal-ob-new');
  if (modal) _modalDirtySnapshots['modal-ob-new'] = _snapshotModalFields(modal);
}

function openModal(name) {
  document.getElementById('modalOverlay').classList.add('active');
  const m = document.getElementById('modal-' + name);
  if (m) {
    m.classList.add('active');
    _modalDirtySnapshots[m.id] = _snapshotModalFields(m);
  }
}
// Resets every plain input/select/textarea/checkbox inside a modal back to
// its HTML-authored default (value/selected/checked attribute), the same
// state a fresh page load would show. Runs on every close (save, cancel, X)
// so static modals reused across "new X" flows (deal/portfolio/capital
// call/fund) never leak a previous attempt's values into the next open.
// Dedicated open*Modal() functions that explicitly populate fields for
// editing (e.g. openEditFundModal) always do so AFTER this has already run
// on the prior close, so this never clobbers an edit-in-progress.
function _resetModalFields(modalEl) {
  modalEl.querySelectorAll('input, textarea').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
    else el.value = el.defaultValue;
  });
  modalEl.querySelectorAll('select').forEach(el => {
    const def = Array.from(el.options).find(o => o.defaultSelected);
    el.selectedIndex = def ? def.index : 0;
  });
}
// Used by Cancel/X/backdrop-click/Escape — every path a user takes to
// abandon a modal without saving. Warns first if anything was actually
// typed (per the dirty snapshot taken in openModal), and aborts the close
// entirely if the user chooses to keep editing.
function closeModal() {
  const activeModals = Array.from(document.querySelectorAll('.modal.active'));
  const dirty = activeModals.find(m => _isModalDirty(m));
  if (dirty && !confirm('У вас есть несохранённые изменения. Закрыть без сохранения?')) return;
  closeModalSilent();
}
// Used internally after a successful save — closes without asking, since
// there's nothing left to lose.
function closeModalSilent() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.querySelectorAll('.modal.active').forEach(m => {
    m.classList.remove('active');
    _resetModalFields(m);
    delete _modalDirtySnapshots[m.id];
  });
}

/* ===== TOAST ===== */
// Appends one toast element per call instead of reusing a single shared
// node — previously a second call while the first toast was still up
// would overwrite its text immediately and leave two competing
// "hide after 3.5s" timers racing each other, so a fast-following message
// (or an error right after a success toast) could get silently cut off.
// Each toast now has its own element and its own timer, so several can be
// visible at once (stacked via .toast-container's flex layout) and none
// get cut short by another one firing.
function showToast(msg, color = 'green') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const colors = { red:'var(--accent-red)', orange:'var(--accent-orange)', blue:'var(--accent-blue)', green:'var(--accent-green)' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeftColor = colors[color] || colors.green;
  el.textContent = msg;
  // Screen readers otherwise never announce a toast at all — it's just
  // new DOM content appearing with no notification. role="alert" (an
  // implicit assertive live region) for red/orange so an error interrupts
  // and gets read immediately; role="status" (polite) for the rest so it
  // doesn't cut off whatever's currently being read.
  el.setAttribute('role', (color === 'red' || color === 'orange') ? 'alert' : 'status');
  container.appendChild(el);

  // Defensive ceiling, not a queue — if something spams toasts, drop the
  // oldest rather than let them pile up and cover the screen.
  const MAX_VISIBLE_TOASTS = 5;
  while (container.children.length > MAX_VISIBLE_TOASTS) {
    container.firstElementChild.remove();
  }

  setTimeout(() => {
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 300); // plain timeout, not animationend — still cleans up if animations are disabled (reduced motion etc.)
  }, 3500);
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

