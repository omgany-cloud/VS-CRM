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

async function apiFetch(path, options = {}) {
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
  } catch (err) {
    console.error('Failed to load capital calls from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить Capital Calls из API: ' + err.message, 'red');
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

    if (typeof obClientIdCounter !== 'undefined' && obClients.length) obClientIdCounter = Math.max(...obClients.map(c => c.id)) + 1;
    if (typeof obTaskIdCounter !== 'undefined' && obTasks.length) obTaskIdCounter = Math.max(...obTasks.map(t => t.id)) + 1;
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
  } catch (err) {
    console.error('Failed to load IC memos from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить IC-меморандумы из API: ' + err.message, 'red');
  }
}

/* ===== Documents / Vault — backed by the real API =====
   docFiles is the merged docs/vault entity (see js/api-auth.js's
   loadDocumentsFromApi comment and server/db.js's `documents` table
   comment for why cfaDocFiles/task-attachments stay client-side). Both
   the Documents page AND the Vault page (which aggregates docFiles +
   two other still-client-side sources) need this refreshed. */
async function loadDocumentsFromApi() {
  try {
    const data = await apiFetch('/api/documents');
    if (typeof docFiles === 'undefined') return;
    docFiles.length = 0;
    docFiles.push(...data.documents);
    if (typeof docNextId !== 'undefined' && docFiles.length) {
      docNextId = Math.max(...docFiles.map(d => d.id)) + 1;
    }
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
  } catch (err) {
    console.error('Failed to load conflict approvals from API:', err);
    if (typeof showToast === 'function') showToast('⚠️ Не удалось загрузить конфликты/одобрения из API: ' + err.message, 'red');
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
    if (page === 'documents' || page === 'vault') loadDocumentsFromApi();
  };
})();

function loadAllApiData() {
  loadLpRegisterFromApi();
  loadCapitalCallsFromApi();
  loadDealsFromApi();
  loadPortfolioFromApi();
  loadOnboardingFromApi();
  loadConflictApprovalsFromApi();
  loadIcMemosFromApi();
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
        setAuth(data);
        hideLoginOverlay();
        loadAllApiData();
      } catch (err) {
        errEl.textContent = err.message || 'Не удалось войти';
      }
    });
  }

  const auth = getAuth();
  if (auth && auth.token) {
    hideLoginOverlay();
    loadAllApiData();
  } else {
    showLoginOverlay();
  }
})();
