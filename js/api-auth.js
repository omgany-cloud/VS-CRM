// ============================================================
//  Vertical-slice auth + API client (proof of concept)
//
//  Scope: this file gates the whole app behind a login screen
//  backed by a real JWT + multi-tenant SQLite backend
//  (server/index.js), and rewires ONLY the LP Register page to
//  fetch/save through that API instead of the hardcoded
//  `lpRegister` array in js/lp-register.js. Every other page in
//  the app still runs on its original static demo data — this
//  is intentionally a single vertical slice, not a full backend
//  migration.
// ============================================================

const API_BASE = window.location.origin;
const AUTH_STORAGE_KEY = 'turan_auth_v1';

// ===== Update-available check =====
// This SPA's <script> tags (index.html) load once per page load and
// never re-fetch on their own — a tab left open across a server restart
// (i.e. a deploy) keeps running the old JS indefinitely, with no
// indication anything changed even though the API underneath it is
// already new. Runs independently of login state (an unauthenticated
// login screen should be promptable too), starts immediately.
let _appVersionAtLoad = null;
const VERSION_CHECK_INTERVAL_MS = 60 * 1000;
async function checkAppVersion() {
  try {
    const res = await fetch(API_BASE + '/api/version');
    const data = await res.json();
    if (_appVersionAtLoad === null) { _appVersionAtLoad = data.version; return; }
    if (data.version !== _appVersionAtLoad) {
      const banner = document.getElementById('updateAvailableBanner');
      if (banner) banner.style.display = 'block';
    }
  } catch (err) {
    // Silent — a failed version check shouldn't itself be disruptive,
    // and a transient network blip shouldn't fire a false "please reload".
  }
}
function startVersionCheckLoop() {
  checkAppVersion();
  setInterval(checkAppVersion, VERSION_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAppVersion();
  });
}
if (typeof document !== 'undefined') startVersionCheckLoop();

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || 'null'); }
  catch (e) { return null; }
}

function setAuth(auth) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function apiLogout() {
  clearAuth();
  window.location.reload();
}

// The login response inlines the caller's resolved permissions (see
// server/index.js's /api/auth/login) so the UI can gate itself without an
// extra round-trip.
function currentUserPermission(key) {
  const auth = getAuth();
  return !!(auth && auth.permissions && auth.permissions[key]);
}

// For non-boolean permission values (currently only icSeat, a nullable
// string enum) — currentUserPermission() coerces everything to boolean via
// !!, which silently breaks any `=== someString` comparison.
function currentUserPermissionValue(key) {
  const auth = getAuth();
  return auth && auth.permissions ? auth.permissions[key] : null;
}

// Mirrors server/auth.js's MUTATING_METHODS + readOnly gate exactly (same
// method set, same intent) — but every mutating action in this app funnels
// through apiFetch, so blocking here catches all of them in one place,
// instantly and without a network round-trip. Without this, a read-only
// user could fill out an entire form (or click Delete) and only discover
// the restriction after the server's 403 comes back — the UI would look
// fully functional right up to that point. This makes the client agree
// with the server from the very first click instead of lying until the end.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (MUTATING_METHODS.has(method) && currentUserPermission('readOnly')) {
    showToast('🔒 Ваша роль — «Только просмотр»: изменения недоступны', 'red');
    throw new Error('Forbidden: read-only role cannot modify data');
  }
  const auth = getAuth();
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {},
    auth ? { Authorization: 'Bearer ' + auth.token } : {}
  );
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  if (res.status === 401) {
    clearAuth();
    showLoginOverlay('Сессия истекла, войдите снова.');
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('HTTP ' + res.status));
  }
  return res.status === 204 ? null : res.json();
}

// ── Real file uploads (POST/GET /api/uploads, server/index.js) ───────
// Every other document field in this app is a "paste a link you already
// have" text input — this is the one path that actually stores file
// bytes on the server, currently wired up for Capital Call payment
// confirmation (js/lp-register.js's markLPPayment()).

// Opens the native file picker and resolves with the chosen File, or
// null if the user cancelled. No <input type="file"> markup needed at
// the call site — this builds and tears down its own hidden element.
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
    input.addEventListener('change', () => {
      settled = true;
      resolve(input.files && input.files[0] ? input.files[0] : null);
      cleanup();
    }, { once: true });
    // The native picker gives no cancel event — the window regaining
    // focus without a prior 'change' is the best available signal that
    // the user dismissed the dialog instead of choosing a file.
    window.addEventListener('focus', function onFocus() {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => { if (!settled) { resolve(null); cleanup(); } }, 300);
    }, { once: true });
    input.click();
  });
}

// Raw fetch, not apiFetch — multipart bodies need the browser to set
// their own Content-Type (with the boundary), which apiFetch's hardcoded
// 'Content-Type: application/json' would break.
async function uploadFile(file) {
  if (MUTATING_METHODS.has('POST') && currentUserPermission('readOnly')) {
    showToast('🔒 Ваша роль — «Только просмотр»: изменения недоступны', 'red');
    throw new Error('Forbidden: read-only role cannot modify data');
  }
  const auth = getAuth();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(API_BASE + '/api/uploads', {
    method: 'POST',
    headers: auth ? { Authorization: 'Bearer ' + auth.token } : {},
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('HTTP ' + res.status));
  }
  return res.json(); // { id, url, name }
}

// GET /api/uploads/:id has no session/cookie to ride on — a bare <a>/
// window.open/iframe can't attach an Authorization header, so the
// current viewer's own token gets appended as a query param instead
// (server/index.js accepts either). External links (Google Drive,
// SharePoint, ...) pass through untouched.
function resolveDocUrl(url) {
  if (!url || !url.startsWith('/api/uploads/')) return url;
  const auth = getAuth();
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'token=' + encodeURIComponent(auth ? auth.token : '');
}

// ── Generic "upload from computer" attach point, reused by every
// document-link field in the app (markLPPayment() was the first, one-off
// version of this before it got generalized here). Deliberately doesn't
// know anything about which entity/field it's filling in — it just puts
// the uploaded file's URL into an existing <input> and then lets that
// input's own already-working save path take over, exactly as if the
// user had pasted the link themselves:
//   - if the input has an inline onchange="save(...,this.value)" handler
//     (true for every onchange-auto-saved field), calling input.onchange()
//     re-invokes it with `this` correctly bound to the input, so
//     `this.value` resolves to the URL just set;
//   - fields that save via a separate explicit button (First Closing's
//     fcSaveUrl(), the DD-conclusion "add document" inputs, onboarding's
//     submit-the-whole-form pattern) have no onchange handler at all, so
//     this just fills the field and stops — the user still clicks
//     whatever button they'd have clicked after pasting a link.
//   - a caller that needs to force the save anyway (fields not driven by
//     the input's own onchange, e.g. First Closing's button-triggered
//     fcSaveUrl) can pass saveFn, invoked instead of the onchange fallback.
async function attachUploadedFile(inputId, saveFn) {
  const file = await pickFile('.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx');
  if (!file) return;
  const input = document.getElementById(inputId);
  if (!input) return;
  showToast('📎 Загрузка файла...', 'blue');
  try {
    const uploaded = await uploadFile(file);
    input.value = uploaded.url;
    if (typeof saveFn === 'function') saveFn();
    else if (typeof input.onchange === 'function') input.onchange();
    showToast(`✅ Файл «${file.name}» загружен`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось загрузить файл: ' + err.message, 'red');
  }
}

// Render helper — a small paperclip button next to a doc-link <input>.
// saveCallExpr, if given, is a literal JS call expression (as a string,
// e.g. "fcSaveUrl('boardResolutionUrl','fc_boardResUrl')") wrapped in an
// arrow function and passed as attachUploadedFile's explicit saveFn; omit
// it for the (much more common) case where the input's own onchange
// handler already does the right thing once its value is set.
function docUploadBtn(inputId, saveCallExpr) {
  const args = saveCallExpr ? `'${inputId}',()=>{${saveCallExpr}}` : `'${inputId}'`;
  return `<button type="button" onclick="attachUploadedFile(${args})"
    style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:0 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0"
    title="Загрузить файл с компьютера"><i class="fas fa-paperclip"></i></button>`;
}

// ── Read-only visual dimming ─────────────────────────────────────────
// The exact, closed set of onclick handlers that call apiFetch with a
// mutating method (derived by grepping every `method: 'POST'|'PUT'|
// 'PATCH'|'DELETE'` call site in js/*.js and reading off the enclosing
// function name — not a guess). Deliberately does NOT include functions
// that only open a modal/form to view or edit something (e.g.
// openFundModal, openDealDetailModal) — a read-only user should still be
// able to open and inspect any record; only the action that would
// actually attempt to persist a change gets dimmed. Keep this list in
// sync when a new mutating action is added — apiFetch's own guard above
// still blocks it either way, this only affects whether it *looks*
// disabled ahead of the click.
const READONLY_GATED_FN_NAMES = [
  'saveChangePassword', 'saveDeal', 'savePortfolio', 'handleFileUpload',
  'saveFund', 'markLPPayment', 'markLpAmlOk', 'saveIndividualCC', 'approveCC',
  'registerLPFromOnboarding', 'castICVote', 'saveRiskConclusion', 'saveNewICMemo',
  'createObClient', 'submitObTask', 'reopenObTask', 'saveNewRestrictedEntry',
  'saveNewConflictApproval', 'decideConflictApproval', 'saveNewCoiEntry', 'saveNewUser',
  'saveUserEdit', 'toggleUserActive', 'deleteUser', 'saveNewRole', 'saveNewApiKey', 'revokeApiKey',
  'saveRoleEdit', 'deleteRole', 'wfAction', 'withdrawWf', 'startWorkflow',
  'saveNewEngagement', 'updateEngPayment', 'obAddTaskComment',
  'saveDDConclusion', 'removeDDConclusionDoc', 'signGpConclusion',
  'dealField', 'dealMoveStage', 'dealAddMeeting', 'addTSVersion', 'dealTSVersionUrl',
  'addSignedDoc', 'dealSignedDocUrl', 'addFounderContact', 'deleteTSVersion',
  'deleteSignedDoc', 'addOtherDoc', 'dealOtherDocName', 'dealOtherDocUrl', 'deleteOtherDoc',
  'markAfsaNotified', 'fcSaveUrl', 'fcSaveClosingDate', 'fcSaveAFSA',
  'fcGenerateWelcomeLetter', 'fcGenerateAllWelcomeLetters', 'attachUploadedFile',
  'portNestedField',
  'deleteLP', 'setLPStatus', 'deleteCC', 'deleteDeal',
  'deletePortfolioCompany', 'archivePortfolioCompany', 'restorePortfolioCompany',
  'deleteEngagement', 'deleteObClient', 'generatePortalPassword',
];
const READONLY_GATED_FN_RE = new RegExp('^\\s*(' + READONLY_GATED_FN_NAMES.join('|') + ')\\s*\\(');
// Triggers that don't call a gated function directly by name (e.g. the
// hidden <input type="file"> is fired via a wrapper div's onclick) —
// matched by selector instead.
const READONLY_GATED_SELECTORS = ['.doc-upload-zone'];

let _roSweepScheduled = false;
function scheduleReadOnlySweep() {
  if (_roSweepScheduled) return;
  _roSweepScheduled = true;
  requestAnimationFrame(() => {
    _roSweepScheduled = false;
    applyReadOnlyUI();
  });
}

function applyReadOnlyUI() {
  const isRO = currentUserPermission('readOnly');
  document.querySelectorAll('[onclick]').forEach(el => {
    const isGated = READONLY_GATED_FN_RE.test(el.getAttribute('onclick') || '');
    if (isGated) el.classList.toggle('ro-disabled', isRO);
    else if (el.classList.contains('ro-disabled')) el.classList.remove('ro-disabled');
  });
  READONLY_GATED_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.toggle('ro-disabled', isRO));
  });
}

if (typeof document !== 'undefined') {
  new MutationObserver(scheduleReadOnlySweep)
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['onclick'] });
}

// ── Double-submit guard ──────────────────────────────────────────────
// None of the gated mutating actions above guarded against being
// re-invoked while a previous call for the same target was still in
// flight — a double-click (or just an impatient second click before the
// round-trip finishes) could fire the exact same create/update/delete
// twice. Reuses READONLY_GATED_FN_NAMES (the same closed set derived
// from every mutating apiFetch call site) so both guards drift together
// instead of needing two lists kept in sync by hand.
//
// Two parts sharing one in-flight registry, keyed by function name +
// arguments (e.g. deleteUser(42) and deleteUser(43) are different keys —
// only a literal re-entrant call for the SAME target is blocked, not
// unrelated concurrent actions on different rows):
//  1. Function-level (the actual fix): each gated function is wrapped so
//     a second call with the same key while the first's promise is still
//     pending is swallowed before it ever reaches apiFetch — this holds
//     regardless of what triggered the call (mouse, keyboard, whatever).
//  2. Visual: the specific element that was clicked gets dimmed
//     (.busy-disabled, pointer-events:none) for the duration of its call.
const _inFlightCallElements = new Map(); // key -> Set of DOM elements to un-dim on settle

let _lastClickTarget = null;
if (typeof document !== 'undefined') {
  // Capture phase so this runs BEFORE the inline onclick handler fires,
  // giving the wrapped function below a way to know which element
  // triggered it (a bare fn() call inside onclick="fn()" doesn't carry
  // `this` through to fn, so there's no other way to recover the element).
  document.addEventListener('click', (e) => {
    _lastClickTarget = e.target.closest('[onclick]') || null;
  }, true);
}

function _busyCallKey(fnName, args) {
  try { return fnName + ':' + JSON.stringify(args); }
  catch (e) { return fnName + ':' + args.length; } // fallback if an arg isn't JSON-safe
}

READONLY_GATED_FN_NAMES.forEach(fnName => {
  const original = window[fnName];
  if (typeof original !== 'function') return;
  window[fnName] = function (...args) {
    const key = _busyCallKey(fnName, args);
    if (_inFlightCallElements.has(key)) return; // identical call already in flight — swallow the duplicate
    const clickedEl = _lastClickTarget;
    const els = new Set();
    if (clickedEl) { els.add(clickedEl); clickedEl.classList.add('busy-disabled'); }
    _inFlightCallElements.set(key, els);
    const settle = () => {
      els.forEach(el => el.classList.remove('busy-disabled'));
      _inFlightCallElements.delete(key);
    };
    let result;
    try {
      result = original.apply(this, args);
    } catch (err) {
      settle();
      throw err;
    }
    if (result && typeof result.finally === 'function') result.finally(settle);
    else settle();
    return result;
  };
});

/* ===== Funds — backed by the real API =====
   Loaded first, before every other loader (loadAllApiData below awaits
   this one), so activeFundId is set to a real fund id before any
   fund-filtered render (renderDashboard, renderPipeline, etc.) runs. */
async function loadFundsFromApi() {
  try {
    const data = await apiFetch('/api/funds');
    if (typeof funds === 'undefined') return;
    funds.length = 0;
    funds.push(...data.funds);
    if (funds.length && (typeof activeFundId === 'undefined' || activeFundId == null || !funds.some(f => f.id === activeFundId))) {
      activeFundId = funds[0].id;
    }
    if (typeof renderFundSwitcher === 'function') renderFundSwitcher();
    if (funds.length && typeof updateFundBranding === 'function') updateFundBranding(getActiveFund());
  } catch (err) {
    console.error('Failed to load funds from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить фонды из API: ' + err.message, 'red');
  }
}

/* ===== First Closing Checklist — backed by the real API, one row per fund ===== */
async function loadFirstClosingFromApi() {
  try {
    const data = await apiFetch('/api/first-closing');
    if (typeof firstClosingList === 'undefined') return;
    firstClosingList.length = 0;
    firstClosingList.push(...data.firstClosing);
    const page = document.getElementById('page-closing');
    if (page && page.classList.contains('active') && typeof renderClosing === 'function') {
      renderClosing();
    }
  } catch (err) {
    console.error('Failed to load First Closing data from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить данные First Closing из API: ' + err.message, 'red');
  }
}

/* ===== LP Register — backed by the real API ===== */
async function loadLpRegisterFromApi() {
  try {
    const data = await apiFetch('/api/lp');
    if (typeof lpRegister === 'undefined') return;
    lpRegister.length = 0;
    lpRegister.push(...data.lp);
    // If the LP Register page happens to be visible right now, refresh it with real data.
    const page = document.getElementById('page-lp-register');
    if (page && page.classList.contains('active') && typeof renderLPRegisterPage === 'function') {
      renderLPRegisterPage();
    }
    if (typeof renderDashboard === 'function') renderDashboard();
  } catch (err) {
    console.error('Failed to load LP register from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить LP из API: ' + err.message, 'red');
  }
}

// The Согласования page's unified pending-approvals board (js/workflow.js)
// reads from capitalCallsLog/icMemos/deals/conflictApprovals, none of
// which it owns the loading of — each of those arrays' own loader calls
// this after refreshing, so the board picks up new data whenever any of
// its sources does, not just when workflow's own instances change.
function refreshPendingApprovalsBoardIfActive() {
  const page = document.getElementById('page-workflow');
  if (page && page.classList.contains('active') && typeof renderPendingApprovalsBoard === 'function') {
    renderPendingApprovalsBoard();
  }
}

// Same idea as refreshPendingApprovalsBoardIfActive(), for the Compliance
// Calendar page — its events are built fresh from live arrays every call
// (buildCalendarEvents(), js/modules.js), so it just needs a re-render
// whenever a source it reads (lpRegister, obClients, capitalCallsLog,
// afsaReports) changes while the page happens to be open.
function refreshComplianceCalendarIfActive() {
  const page = document.getElementById('page-calendar');
  if (page && page.classList.contains('active') && typeof renderComplianceCalendar === 'function') {
    renderComplianceCalendar();
  }
}

/* ===== Capital Calls — backed by the real API ===== */
async function loadCapitalCallsFromApi() {
  try {
    const data = await apiFetch('/api/capital-calls');
    if (typeof capitalCallsLog === 'undefined') return;
    capitalCallsLog.length = 0;
    capitalCallsLog.push(...data.capitalCalls);
    const page = document.getElementById('page-lp-capital-calls');
    if (page && page.classList.contains('active') && typeof renderCapitalCallsPage === 'function') {
      renderCapitalCallsPage();
    }
    refreshPendingApprovalsBoardIfActive();
    refreshComplianceCalendarIfActive();
  } catch (err) {
    console.error('Failed to load capital calls from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить Capital Calls из API: ' + err.message, 'red');
  }
}

/* ===== AFSA Regulatory Reports — backed by the real API =====
   Replaces the old static js/data.js `reportSchedule` array. */
let afsaReports = [];
async function loadAfsaReportsFromApi() {
  try {
    const data = await apiFetch('/api/afsa-reports');
    afsaReports.length = 0;
    afsaReports.push(...data.afsaReports);
    refreshComplianceCalendarIfActive();
    refreshPendingApprovalsBoardIfActive();
  } catch (err) {
    console.error('Failed to load AFSA reports from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить отчётность AFSA из API: ' + err.message, 'red');
  }
}

/* ===== Deal Pipeline — backed by the real API =====
   Unlike LP Register / Capital Calls, the kanban board is rendered once at
   DOMContentLoaded and kept live in the DOM (not re-rendered per
   navigation), so this refresh is triggered from loadAllApiData() rather
   than the navigateTo wrapper below. */
async function loadDealsFromApi() {
  try {
    const data = await apiFetch('/api/deals');
    if (typeof deals === 'undefined') return;
    deals.length = 0;
    deals.push(...data.deals);
    if (typeof dealIdCounter !== 'undefined' && deals.length) {
      dealIdCounter = Math.max(...deals.map(d => d.id)) + 1;
    }
    if (typeof renderPipeline === 'function') renderPipeline(deals);
    if (typeof renderDashboard === 'function') renderDashboard();
    refreshPendingApprovalsBoardIfActive();
  } catch (err) {
    console.error('Failed to load deals from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить сделки из API: ' + err.message, 'red');
  }
}

/* ===== Portfolio — backed by the real API =====
   Same DOM-lifecycle situation as Deal Pipeline (rendered once, kept live). */
async function loadPortfolioFromApi() {
  try {
    const data = await apiFetch('/api/portfolio');
    if (typeof portfolio === 'undefined') return;
    portfolio.length = 0;
    portfolio.push(...data.portfolio);
    if (typeof portfolioIdCounter !== 'undefined' && portfolio.length) {
      portfolioIdCounter = Math.max(...portfolio.map(p => p.id)) + 1;
    }
    if (typeof renderPortfolio === 'function') renderPortfolio(portfolio);
    if (typeof renderDashboard === 'function') renderDashboard();
  } catch (err) {
    console.error('Failed to load portfolio from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить портфель из API: ' + err.message, 'red');
  }
}

/* ===== Onboarding / KYC-AML — backed by the real API =====
   One combined fetch for restrictedList/coiRegistry/obClients/obTasks/
   engagements, mirroring how the frontend always uses them together.
   All 3 onboarding pages (ob-clients, ob-restricted, engagements) ARE
   re-rendered per navigateTo call in app.js's own logic, so this hooks
   into the navigateTo wrapper below like LP Register/Capital Calls. */
async function loadOnboardingFromApi() {
  try {
    const data = await apiFetch('/api/onboarding');
    if (typeof restrictedList !== 'undefined') { restrictedList.length = 0; restrictedList.push(...data.restrictedList); }
    if (typeof coiRegistry !== 'undefined') { coiRegistry.length = 0; coiRegistry.push(...data.coiRegistry); }
    if (typeof obClients !== 'undefined') { obClients.length = 0; obClients.push(...data.obClients); }
    if (typeof obTasks !== 'undefined') { obTasks.length = 0; obTasks.push(...data.obTasks); }
    if (typeof engagements !== 'undefined') { engagements.length = 0; engagements.push(...data.engagements); }

    if (typeof obCoiIdCounter !== 'undefined' && coiRegistry.length) obCoiIdCounter = Math.max(...coiRegistry.map(c => c.id)) + 1;
    if (typeof engIdCounter !== 'undefined' && engagements.length) engIdCounter = Math.max(...engagements.map(e => e.id)) + 1;

    const obPage = document.getElementById('page-ob-clients');
    if (obPage && obPage.classList.contains('active') && typeof renderOnboardingPage === 'function') renderOnboardingPage();
    const restrictedPage = document.getElementById('page-ob-restricted');
    if (restrictedPage && restrictedPage.classList.contains('active') && typeof renderRestrictedListPage === 'function') renderRestrictedListPage();
    const engPage = document.getElementById('page-engagements');
    if (engPage && engPage.classList.contains('active') && typeof renderEngagementsPage === 'function') renderEngagementsPage();
    if (typeof updateBadges === 'function') updateBadges();
  } catch (err) {
    console.error('Failed to load onboarding data from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить онбординг из API: ' + err.message, 'red');
  }
}

/* ===== IC Memos — backed by the real API ===== */
async function loadIcMemosFromApi() {
  try {
    const data = await apiFetch('/api/ic-memos');
    if (typeof icMemos === 'undefined') return;
    icMemos.length = 0;
    icMemos.push(...data.icMemos);
    if (typeof icIdCounter !== 'undefined' && icMemos.length) {
      icIdCounter = Math.max(...icMemos.map(m => m.id)) + 1;
    }
    const page = document.getElementById('page-ic');
    if (page && page.classList.contains('active') && typeof renderICPage === 'function') renderICPage();
    if (typeof updateBadges === 'function') updateBadges();
    refreshPendingApprovalsBoardIfActive();
  } catch (err) {
    console.error('Failed to load IC memos from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить IC-меморандумы из API: ' + err.message, 'red');
  }
}

/* ===== Workflow (approval chains) — backed by the real API =====
   Loaded eagerly (loadAllApiData) as well as on navigate, same reason IC
   memos are: the sidebar workflow badge (getActiveWfCount(), js/app.js)
   needs correct data right after login, not just when the page is open. */
async function loadWorkflowFromApi() {
  try {
    const data = await apiFetch('/api/workflow');
    if (typeof workflowInstances === 'undefined') return;
    workflowInstances.length = 0;
    workflowInstances.push(...data.workflowInstances);
    const page = document.getElementById('page-workflow');
    if (page && page.classList.contains('active') && typeof renderWorkflowPage === 'function') renderWorkflowPage();
    if (typeof updateBadges === 'function') updateBadges();
  } catch (err) {
    console.error('Failed to load workflow instances from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить workflow из API: ' + err.message, 'red');
  }
}

/* ===== Documents / Vault — backed by the real API =====
   docFiles is the merged docs/vault entity (see server/db.js's
   `documents` table comment for why task-attachments stay
   client-side). Both the Documents page AND the Vault page (which
   aggregates docFiles + task attachments) need this refreshed. */
async function loadDocumentsFromApi() {
  try {
    const data = await apiFetch('/api/documents');
    if (typeof docFiles === 'undefined') return;
    docFiles.length = 0;
    docFiles.push(...data.documents);
    const docsPage = document.getElementById('page-documents');
    if (docsPage && docsPage.classList.contains('active') && typeof renderDocumentsPage === 'function') renderDocumentsPage();
    const vaultPage = document.getElementById('page-vault');
    if (vaultPage && vaultPage.classList.contains('active') && typeof renderVaultPage === 'function') renderVaultPage();
  } catch (err) {
    console.error('Failed to load documents from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить документы из API: ' + err.message, 'red');
  }
}

/* ===== Conflict Approvals — backed by the real API =====
   Digital Decision/Escalation Matrix audit trail (COI Addendum Section E):
   the "Конфликты / Одобрения" page. `conflictApprovals` is declared here
   since no legacy frontend source ever held this data. */
let conflictApprovals = [];
async function loadConflictApprovalsFromApi() {
  try {
    const data = await apiFetch('/api/conflict-approvals');
    conflictApprovals.length = 0;
    conflictApprovals.push(...data.conflictApprovals);
    const page = document.getElementById('page-conflict-approvals');
    if (page && page.classList.contains('active') && typeof renderConflictApprovalsPage === 'function') renderConflictApprovalsPage();
    if (typeof updateBadges === 'function') updateBadges();
    refreshPendingApprovalsBoardIfActive();
  } catch (err) {
    console.error('Failed to load conflict approvals from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить конфликты/одобрения из API: ' + err.message, 'red');
  }
}

/* ===== Users (Team / Access Control) — backed by the real API =====
   Gated by the manageUsers permission — the server 403s anyone without it,
   and the nav item itself is hidden client-side (see updateUserRoleUI in
   js/app.js). Loaded on-demand like Documents/Vault, not part of
   loadAllApiData(). */
async function loadUsersFromApi() {
  try {
    const data = await apiFetch('/api/users');
    if (typeof crmUsers === 'undefined') return;
    crmUsers.length = 0;
    crmUsers.push(...data.users);
    const page = document.getElementById('page-users');
    if (page && page.classList.contains('active') && typeof renderUsersPage === 'function') renderUsersPage();
  } catch (err) {
    console.error('Failed to load users from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить пользователей из API: ' + err.message, 'red');
  }
}

/* ===== Roles (Access Control constructor) — backed by the real API =====
   GET is reachable by every authenticated user (everyone needs the
   catalogue to resolve role labels/icons/colors — js/roles.js's ROLES
   object is populated from here, not hardcoded). Loaded once right after
   login, before initUserRole()/loadAllApiData() run, so the very first
   render already has real labels instead of the pre-login fallback. */
async function loadRolesFromApi() {
  try {
    const data = await apiFetch('/api/roles');
    const next = {};
    for (const r of data.roles) next[r.code] = r;
    ROLES = next;
    ROLE_CODES = Object.keys(ROLES);
    const page = document.getElementById('page-users');
    if (page && page.classList.contains('active') && typeof renderRolesPage === 'function' && typeof usersActiveTab !== 'undefined' && usersActiveTab === 'roles') renderRolesPage();
  } catch (err) {
    console.error('Falling back to built-in role catalogue:', err);
  }
}

// Wrap the app's navigateTo so API-backed pages always pull fresh data
// from the API right before they're shown (in addition to the
// background refresh triggered right after login).
(function wrapNavigateTo() {
  const originalNavigateTo = window.navigateTo;
  if (typeof originalNavigateTo !== 'function') return;
  window.navigateTo = function (page) {
    originalNavigateTo(page);
    if (page === 'lp-register') loadLpRegisterFromApi();
    if (page === 'lp-capital-calls') loadCapitalCallsFromApi();
    if (page === 'ob-clients' || page === 'ob-restricted' || page === 'engagements') { loadOnboardingFromApi(); loadConflictApprovalsFromApi(); }
    if (page === 'conflict-approvals') loadConflictApprovalsFromApi();
    if (page === 'ic') loadIcMemosFromApi();
    if (page === 'workflow') {
      // The unified pending-approvals board on this page pulls from all
      // four of these sources (see collectExternalPendingApprovals(),
      // js/workflow.js) in addition to this page's own workflow instances.
      loadWorkflowFromApi();
      loadCapitalCallsFromApi();
      loadIcMemosFromApi();
      loadDealsFromApi();
      loadConflictApprovalsFromApi();
      loadAfsaReportsFromApi();
    }
    if (page === 'calendar') { loadCapitalCallsFromApi(); loadAfsaReportsFromApi(); }
    if (page === 'documents' || page === 'vault') loadDocumentsFromApi();
    if (page === 'users') loadUsersFromApi();
  };
})();

async function loadAllApiData() {
  await loadFundsFromApi();
  loadLpRegisterFromApi();
  loadCapitalCallsFromApi();
  loadFirstClosingFromApi();
  loadDealsFromApi();
  loadPortfolioFromApi();
  loadOnboardingFromApi();
  loadConflictApprovalsFromApi();
  loadIcMemosFromApi();
  loadWorkflowFromApi();
  loadAfsaReportsFromApi();
  loadDocumentsFromApi();
}

/* ===== Login gate ===== */
function showLoginOverlay(message) {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const err = document.getElementById('loginError');
  if (err) err.textContent = message || '';
}

function hideLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'none';
}

function toggleAuthForm(which) {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  if (!loginForm || !signupForm) return;
  loginForm.style.display = which === 'signup' ? 'none' : 'block';
  signupForm.style.display = which === 'signup' ? 'block' : 'none';
}

// ── Keep a logged-in session's cached role/permissions in sync ──────────
// getAuth()/currentUserPermission() read from localStorage, populated once
// at login — without this, an admin revoking access or flipping someone to
// read-only has no effect on that person's already-open tab until their
// 12h token expires: the banner stays hidden, buttons stay undimmed, and
// apiFetch's readOnly guard keeps evaluating the stale cached value. Poll
// GET /api/auth/me (cheap — requireAuth already re-reads role/active/
// permissions from the DB on every request, this just exposes that) and
// re-apply the same UI refresh updateUserRoleUI() already does on login.
// A 401 here (token expired OR the account was just deactivated) is
// already handled by apiFetch itself — it clears auth and shows the login
// overlay, so there's nothing extra to do in that case.
async function refreshAuthFromServer() {
  const auth = getAuth();
  if (!auth) return;
  try {
    const data = await apiFetch('/api/auth/me');
    const prevRole  = auth.user && auth.user.role;
    const prevPerms = JSON.stringify(auth.permissions);
    auth.user        = data.user;
    auth.permissions = data.permissions;
    setAuth(auth);
    if (typeof updateUserRoleUI === 'function') updateUserRoleUI(data.user.role);
    const changed = prevRole !== data.user.role || prevPerms !== JSON.stringify(data.permissions);
    if (changed && typeof showToast === 'function') {
      showToast('ℹ️ Ваша роль или права были обновлены администратором', 'blue');
    }
  } catch (err) {
    if (!/Unauthorized/.test(err.message)) console.error('Failed to refresh auth from server:', err);
  }
}

let _authRefreshTimer = null;
const AUTH_REFRESH_INTERVAL_MS = 60 * 1000;
function startAuthRefreshLoop() {
  if (_authRefreshTimer) return;
  _authRefreshTimer = setInterval(refreshAuthFromServer, AUTH_REFRESH_INTERVAL_MS);
  // Also refresh the moment the tab regains focus — covers the common case
  // (admin changes something while the user is away/on another tab) faster
  // than waiting out the rest of the poll interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAuthFromServer();
  });
}

// Shared by both the login and signup submit handlers below — same
// post-auth sequence either way.
async function completeAuth(data) {
  setAuth(data);
  hideLoginOverlay();
  await loadRolesFromApi();
  if (typeof initUserRole === 'function') initUserRole();
  loadAllApiData();
  startAuthRefreshLoop();
}

(function initAuthGate() {
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginError');
      errEl.textContent = '';
      try {
        const res = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        await completeAuth(data);
      } catch (err) {
        errEl.textContent = err.message || 'Не удалось войти';
      }
    });
  }

  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const companyName = document.getElementById('signupCompanyName').value.trim();
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
      const errEl = document.getElementById('signupError');
      errEl.textContent = '';
      if (!companyName || !name || !email || !password) { errEl.textContent = 'Заполните все поля'; return; }
      if (password.length < 8) { errEl.textContent = 'Пароль минимум 8 символов'; return; }
      if (password !== passwordConfirm) { errEl.textContent = 'Пароли не совпадают'; return; }
      try {
        const res = await fetch(API_BASE + '/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName, name, email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Signup failed');
        await completeAuth(data);
      } catch (err) {
        errEl.textContent = err.message || 'Не удалось зарегистрировать компанию';
      }
    });
    if (typeof attachPasswordStrengthMeter === 'function') {
      attachPasswordStrengthMeter(document.getElementById('signupPassword'));
    }
  }

  const auth = getAuth();
  if (auth && auth.token) {
    hideLoginOverlay();
    loadRolesFromApi().then(() => {
      if (typeof initUserRole === 'function') initUserRole();
      loadAllApiData();
      startAuthRefreshLoop();
    });
  } else {
    showLoginOverlay();
  }
})();
