// ============================================================
//  funds.js — Multi-Fund Management
//  Golden Leaves Ltd — GP
//  Populated at runtime by js/api-auth.js via GET /api/funds
//  (see server/index.js) — no hardcoded demo funds here anymore.
// ============================================================

let funds = [];
let activeFundId = null;
let fundModalEditId = null; // null = creating a new fund, else editing this fund's id

function getActiveFund() {
  return funds.find(f => f.id === activeFundId) || funds[0];
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
  if (f) showToast(`✅ ${f.shortName} — ${t('all_funds')}`);
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
      <span class="fsi-edit" onclick="event.stopPropagation();openEditFundModal(${f.id})" title="${currentLang === 'ru' ? 'Редактировать' : 'Edit'}">
        <i class="fas fa-pen" style="font-size:10px"></i>
      </span>
    </div>
  `).join('') + `
    <div class="fund-switch-divider"></div>
    <div class="fund-switch-item add-fund" onclick="openNewFundModal()">
      <div class="fsi-dot" style="background:var(--text-muted)"><i class="fas fa-plus" style="font-size:9px"></i></div>
      <div class="fsi-body"><div class="fsi-name" data-i18n="btn_add_fund_modal">${t('btn_add_fund_modal')}</div></div>
    </div>
  `;
}

function getFundStatusLabel(status) {
  const map = {
    active: currentLang === 'ru' ? 'Активный' : 'Active',
    fundraising: currentLang === 'ru' ? 'Фандрайзинг' : 'Fundraising',
    harvesting: currentLang === 'ru' ? 'Harvesting' : 'Harvesting',
    closed: currentLang === 'ru' ? 'Закрыт' : 'Closed',
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
}

// Opens the "Add Fund" modal in create mode.
function openNewFundModal() {
  fundModalEditId = null;
  ['nf_name','nf_size','nf_license','nf_desc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const mfeeEl = document.getElementById('nf_mfee'); if (mfeeEl) mfeeEl.value = 2;
  const carryEl = document.getElementById('nf_carry'); if (carryEl) carryEl.value = 20;
  const prefEl = document.getElementById('nf_pref'); if (prefEl) prefEl.value = 8;
  const titleEl = document.getElementById('fundModalTitleText'); if (titleEl) titleEl.textContent = t('btn_add_fund_modal');
  openModal('addFund');
}

// Opens the same modal pre-filled, in edit mode.
function openEditFundModal(id) {
  const f = funds.find(x => x.id === id);
  if (!f) return;
  fundModalEditId = id;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val != null ? val : ''; };
  set('nf_name', f.name);
  set('nf_type', f.type);
  set('nf_size', f.targetSize);
  set('nf_vintage', f.vintage);
  set('nf_license', f.license);
  set('nf_desc', f.description);
  set('nf_mfee', f.managementFee);
  set('nf_carry', f.carriedInterest);
  set('nf_pref', f.preferredReturn);
  const titleEl = document.getElementById('fundModalTitleText');
  if (titleEl) titleEl.textContent = currentLang === 'ru' ? 'Редактировать фонд' : 'Edit fund';
  openModal('addFund');
}

async function saveFund() {
  const name    = document.getElementById('nf_name').value.trim();
  const type    = document.getElementById('nf_type').value;
  const size    = parseFloat(document.getElementById('nf_size').value) || 0;
  const vintage = parseInt(document.getElementById('nf_vintage').value) || new Date().getFullYear();
  const license = document.getElementById('nf_license').value.trim() || '—';
  const desc    = document.getElementById('nf_desc').value.trim();
  const mfee    = parseFloat(document.getElementById('nf_mfee').value) || 2;
  const carry   = parseFloat(document.getElementById('nf_carry').value) || 20;
  const pref    = parseFloat(document.getElementById('nf_pref').value) || 8;

  if (!name) { alert(currentLang === 'ru' ? 'Введите название фонда' : 'Enter fund name'); return; }

  const isEdit = fundModalEditId != null;
  const colors = ['#3b82f6','#8b5cf6','#22c55e','#f97316','#14b8a6','#ef4444','#eab308'];

  const payload = {
    name,
    shortName: name.split(' ').map(w => w[0]).join('').substring(0,6).toUpperCase(),
    gp: 'Golden Leaves Ltd',
    license,
    type,
    targetSize: size,
    currency: 'USD',
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
  };

  try {
    if (isEdit) {
      const updated = await apiFetch(`/api/funds/${fundModalEditId}`, { method: 'PUT', body: JSON.stringify(payload) });
      const idx = funds.findIndex(f => f.id === fundModalEditId);
      if (idx >= 0) funds[idx] = updated;
      showToast(`✅ ${currentLang === 'ru' ? 'Фонд обновлён' : 'Fund updated'}: ${updated.shortName}`);
    } else {
      const created = await apiFetch('/api/funds', { method: 'POST', body: JSON.stringify(payload) });
      funds.push(created);
      showToast(`✅ ${currentLang === 'ru' ? 'Фонд создан' : 'Fund created'}: ${created.shortName}`);
    }
    renderFundSwitcher();
    closeModal();
  } catch (err) {
    console.error('Failed to save fund:', err);
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
