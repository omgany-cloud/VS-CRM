// ============================================================
//  funds.js — Multi-Fund Management
//  Populated at runtime by js/api-auth.js via GET /api/funds
//  (see server/index.js) — no hardcoded demo funds here anymore.
// ============================================================

let funds = [];
let activeFundId = null;
let fundModalEditId = null; // null = creating a new fund, else editing this fund's id

function getActiveFund() {
  return funds.find(f => f.id === activeFundId) || funds[0];
}

// For documents about a specific record (an LP, a capital call...) that
// must reflect THAT record's fund/GP details — not whichever fund happens
// to be switched to in the UI right now. Falls back to the active fund so
// callers with a stale/missing fundId still render something sane rather
// than crashing on undefined.
function getFundById(id) {
  return funds.find(f => f.id === id) || getActiveFund();
}

// Document generators (js/lp-register.js, js/modules.js) read GP-identity/
// banking fields off an `fp` object shaped like the old hardcoded
// FUND_PARAMS constant (js/data.js). This resolves it from the real fund
// a given record belongs to, falling back to FUND_PARAMS field-by-field
// for anything the fund doesn't have filled in yet (still-null new columns
// on an existing fund, or fund-terms fields this pass didn't migrate) —
// so a document never renders a blank/null GP address instead of at least
// a sensible placeholder.
const FUND_PARAMS_OVERRIDABLE_KEYS = [
  'name', 'gp', 'license', 'gpCEO', 'gpTitle', 'gpAddress', 'gpBIN',
  'gpBankName', 'gpBIC', 'gpIBANkzt', 'gpIBANusd',
  'managementFee', 'carriedInterest', 'preferredReturn', 'fundTerm',
];
function fundParamsFor(fundId) {
  const f = getFundById(fundId) || {};
  const out = { ...FUND_PARAMS };
  for (const k of FUND_PARAMS_OVERRIDABLE_KEYS) {
    if (f[k] != null && f[k] !== '') out[k] = f[k];
  }
  return out;
}

function switchFund(id) {
  activeFundId = id;
  const f = getActiveFund();
  renderFundSwitcher();
  if (f) updateFundBranding(f);
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderOnboardingTable === 'function') renderOnboardingTable(lpList);
  if (typeof renderPipeline === 'function') renderPipeline(deals);
  if (typeof renderPortfolio === 'function') renderPortfolio(portfolio);
  if (typeof renderLPRegisterPage === 'function') renderLPRegisterPage();
  if (typeof renderCapitalCallsPage === 'function') renderCapitalCallsPage();
  if (typeof renderICPage === 'function') renderICPage();
  if (f) showToast(`✅ ${f.shortName} — Все фонды`);
}

function renderFundSwitcher() {
  const container = document.getElementById('fundSwitcherDropdown');
  if (!container) return;
  container.innerHTML = funds.map(f => `
    <div class="fund-switch-item ${f.id === activeFundId ? 'active' : ''}" onclick="switchFund(${f.id})">
      <div class="fsi-dot" style="background:${f.color}"></div>
      <div class="fsi-body">
        <div class="fsi-name">${f.shortName}</div>
        <div class="fsi-type">${f.type} · $${f.targetSize}M</div>
      </div>
      <span class="fsi-status ${f.status}">${getFundStatusLabel(f.status)}</span>
      <span class="fsi-edit" onclick="event.stopPropagation();openEditFundModal(${f.id})" title="Редактировать">
        <i class="fas fa-pen" style="font-size:10px"></i>
      </span>
    </div>
  `).join('') + `
    <div class="fund-switch-divider"></div>
    <div class="fund-switch-item add-fund" onclick="openNewFundModal()">
      <div class="fsi-dot" style="background:var(--text-muted)"><i class="fas fa-plus" style="font-size:9px"></i></div>
      <div class="fsi-body"><div class="fsi-name">Создать новый фонд</div></div>
    </div>
  `;
}

function getFundStatusLabel(status) {
  const map = {
    active: 'Активный',
    fundraising: 'Фандрайзинг',
    harvesting: 'Harvesting',
    closed: 'Закрыт',
  };
  return map[status] || status;
}

function updateFundBranding(f) {
  const el = document.getElementById('activeFundName');
  if (el) el.textContent = f.shortName;
  const sub = document.getElementById('activeFundSub');
  if (sub) sub.textContent = f.license;
  const phase = document.getElementById('fundPhaseText');
  if (phase) phase.textContent = `${f.phase} · Year ${f.phaseYear}`;
  document.documentElement.style.setProperty('--fund-color', f.color);

  // Dashboard headline KPI cards — previously static HTML frozen to
  // whichever fund happened to load first; now reactive to switchFund().
  const aum = document.getElementById('kpiAum');
  if (aum) aum.textContent = `$${f.targetSize}M`;
  const aumDelta = document.getElementById('kpiAumDelta');
  if (aumDelta) aumDelta.textContent = `Целевой: $${f.targetSize}M · Min: $5M`;
  const irr = document.getElementById('kpiIrr');
  if (irr) irr.textContent = f.targetIRR || '—';
  const moic = document.getElementById('kpiMoic');
  if (moic) moic.textContent = f.targetMOIC || '—';
  const mgmtFee = document.getElementById('kpiMgmtFee');
  if (mgmtFee) mgmtFee.textContent = `${f.managementFee}% / год`;
  const carryDelta = document.getElementById('kpiCarryDelta');
  if (carryDelta) carryDelta.textContent = `Carried Interest: ${f.carriedInterest}%`;
}

// Opens the "Add Fund" modal in create mode.
function openNewFundModal() {
  fundModalEditId = null;
  ['nf_name','nf_gp','nf_size','nf_license','nf_desc',
   'nf_gpCEO','nf_gpTitle','nf_gpAddress','nf_gpBIN','nf_gpBankName','nf_gpBIC','nf_gpIBANkzt','nf_gpIBANusd',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const currEl = document.getElementById('nf_currency'); if (currEl) currEl.value = 'USD';
  const mfeeEl = document.getElementById('nf_mfee'); if (mfeeEl) mfeeEl.value = 2;
  const carryEl = document.getElementById('nf_carry'); if (carryEl) carryEl.value = 20;
  const prefEl = document.getElementById('nf_pref'); if (prefEl) prefEl.value = 8;
  const titleEl = document.getElementById('fundModalTitleText'); if (titleEl) titleEl.textContent = 'Создать новый фонд';
  const delBtn = document.getElementById('fundDeleteBtn'); if (delBtn) delBtn.style.display = 'none';
  const closeBtn = document.getElementById('fundCloseBtn'); if (closeBtn) closeBtn.style.display = 'none';
  openModal('addFund');
}

// Opens the same modal pre-filled, in edit mode.
function openEditFundModal(id) {
  const f = funds.find(x => x.id === id);
  if (!f) return;
  fundModalEditId = id;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
  set('nf_name', f.name);
  set('nf_gp', f.gp);
  set('nf_type', f.type);
  set('nf_currency', f.currency || 'USD');
  set('nf_size', f.targetSize);
  set('nf_vintage', f.vintage);
  set('nf_license', f.license);
  set('nf_desc', f.description);
  set('nf_mfee', f.managementFee);
  set('nf_carry', f.carriedInterest);
  set('nf_pref', f.preferredReturn);
  set('nf_gpCEO', f.gpCEO);
  set('nf_gpTitle', f.gpTitle);
  set('nf_gpAddress', f.gpAddress);
  set('nf_gpBIN', f.gpBIN);
  set('nf_gpBankName', f.gpBankName);
  set('nf_gpBIC', f.gpBIC);
  set('nf_gpIBANkzt', f.gpIBANkzt);
  set('nf_gpIBANusd', f.gpIBANusd);
  const titleEl = document.getElementById('fundModalTitleText');
  if (titleEl) titleEl.textContent = 'Редактировать фонд';
  const delBtn = document.getElementById('fundDeleteBtn');
  if (delBtn) delBtn.style.display = '';
  const closeBtn = document.getElementById('fundCloseBtn');
  if (closeBtn) closeBtn.style.display = f.status === 'closed' ? 'none' : '';
  openModal('addFund');
}

async function saveFund() {
  const name     = document.getElementById('nf_name').value.trim();
  const gp       = document.getElementById('nf_gp').value.trim() || '—';
  const type     = document.getElementById('nf_type').value;
  const currency = document.getElementById('nf_currency').value || 'USD';
  const size    = parseFloat(document.getElementById('nf_size').value) || 0;
  const vintage = parseInt(document.getElementById('nf_vintage').value) || new Date().getFullYear();
  const license = document.getElementById('nf_license').value.trim() || '—';
  const desc    = document.getElementById('nf_desc').value.trim();
  const mfee    = parseFloat(document.getElementById('nf_mfee').value) || 2;
  const carry   = parseFloat(document.getElementById('nf_carry').value) || 20;
  const pref    = parseFloat(document.getElementById('nf_pref').value) || 8;
  const gpCEO       = document.getElementById('nf_gpCEO').value.trim();
  const gpTitle     = document.getElementById('nf_gpTitle').value.trim();
  const gpAddress   = document.getElementById('nf_gpAddress').value.trim();
  const gpBIN       = document.getElementById('nf_gpBIN').value.trim();
  const gpBankName  = document.getElementById('nf_gpBankName').value.trim();
  const gpBIC       = document.getElementById('nf_gpBIC').value.trim();
  const gpIBANkzt   = document.getElementById('nf_gpIBANkzt').value.trim();
  const gpIBANusd   = document.getElementById('nf_gpIBANusd').value.trim();

  if (!name) { alert('Введите название фонда'); return; }

  const isEdit = fundModalEditId != null;
  const colors = ['#3b82f6','#8b5cf6','#22c55e','#f97316','#14b8a6','#ef4444','#eab308'];

  const payload = {
    name,
    shortName: name.split(' ').map(w => w[0]).join('').substring(0,6).toUpperCase(),
    gp,
    license,
    type,
    targetSize: size,
    currency,
    vintage,
    status: isEdit ? undefined : 'fundraising',
    phase: isEdit ? undefined : 'Fundraising',
    phaseYear: isEdit ? undefined : 0,
    fundTerm: 10,
    investmentPeriod: 5,
    managementFee: mfee,
    carriedInterest: carry,
    preferredReturn: pref,
    targetIRR: '20–25%',
    targetMOIC: '2.5–3.5x',
    description: desc,
    color: colors[funds.length % colors.length],
    icon: 'fa-building',
    gpCEO, gpTitle, gpAddress, gpBIN, gpBankName, gpBIC, gpIBANkzt, gpIBANusd,
  };

  try {
    if (isEdit) {
      const updated = await apiFetch(`/api/funds/${fundModalEditId}`, { method: 'PUT', body: JSON.stringify(payload) });
      const idx = funds.findIndex(f => f.id === fundModalEditId);
      if (idx >= 0) funds[idx] = updated;
      showToast(`✅ Фонд обновлён: ${updated.shortName}`);
    } else {
      const created = await apiFetch('/api/funds', { method: 'POST', body: JSON.stringify(payload) });
      funds.push(created);
      showToast(`✅ Фонд создан: ${created.shortName}`);
    }
    renderFundSwitcher();
    closeModalSilent();
  } catch (err) {
    console.error('Failed to save fund:', err);
    showToast('⚠️ ' + err.message, 'red');
  }
}

// Soft alternative to delete when a fund has real activity — 'closed' is
// already a real status value in this app's vocabulary
// (getFundStatusLabel above), it just never had a UI action to set it.
async function closeFund(id) {
  const f = funds.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Закрыть фонд «${f.shortName}»? Статус изменится на "Закрыт".`)) return;
  try {
    const updated = await apiFetch(`/api/funds/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'closed' }) });
    const idx = funds.findIndex(x => x.id === id);
    if (idx >= 0) funds[idx] = updated;
    renderFundSwitcher();
    closeModalSilent();
    showToast(`✅ Фонд «${updated.shortName}» закрыт`, 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

async function deleteFund(id) {
  const f = funds.find(x => x.id === id);
  if (!f) return;
  if (!confirm(`Удалить фонд «${f.shortName}» без возможности восстановления? Возможно только если у фонда нет LP, сделок, портфельных компаний или capital calls.`)) return;
  try {
    await apiFetch(`/api/funds/${id}`, { method: 'DELETE' });
    funds = funds.filter(x => x.id !== id);
    if (activeFundId === id) activeFundId = funds[0] ? funds[0].id : null;
    renderFundSwitcher();
    closeModalSilent();
    const active = getActiveFund();
    if (active) switchFund(active.id);
    showToast('✅ Фонд удалён', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

function toggleFundDropdown() {
  const d = document.getElementById('fundSwitcherDropdown');
  if (d) d.classList.toggle('open');
}
document.addEventListener('click', e => {
  const dd = document.getElementById('fundSwitcherDropdown');
  const btn = document.getElementById('fundSwitcherBtn');
  if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) {
    dd.classList.remove('open');
  }
});
