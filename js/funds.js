// ============================================================
//  funds.js — Multi-Fund Management
//  Golden Leaves Ltd — GP
// ============================================================

let funds = [
  {
    id: 'TCF1',
    name: 'Turan Capital Fund I LP',
    shortName: 'TCF-I',
    gp: 'Golden Leaves Ltd',
    license: 'AFSA-A-LA-2024-0038',
    type: 'Private Equity',
    targetSize: 50,
    currency: 'USD',
    vintage: 2024,
    status: 'active',         // active | fundraising | harvesting | closed
    phase: 'Investment Period',
    phaseYear: 2,
    fundTerm: 10,
    investmentPeriod: 5,
    managementFee: 2,
    carriedInterest: 20,
    preferredReturn: 8,
    targetIRR: '20–25%',
    targetMOIC: '2.5–3.5x',
    description: 'Первый фонд под управлением Golden Leaves Ltd. Инвестирует в компании среднего бизнеса в Казахстане и ЦА.',
    color: '#3b82f6',
    icon: 'fa-landmark',
    lp_count: 4,
    deployed: 15,
    nav: 48,
  },
  {
    id: 'TCF2',
    name: 'Turan Capital Fund II LP',
    shortName: 'TCF-II',
    gp: 'Golden Leaves Ltd',
    license: 'AFSA-A-LA-2025-XXXX',
    type: 'Growth Equity',
    targetSize: 100,
    currency: 'USD',
    vintage: 2026,
    status: 'fundraising',
    phase: 'Fundraising',
    phaseYear: 0,
    fundTerm: 10,
    investmentPeriod: 5,
    managementFee: 2,
    carriedInterest: 20,
    preferredReturn: 8,
    targetIRR: '22–28%',
    targetMOIC: '3.0–4.0x',
    description: 'Второй фонд. Фокус на Growth Equity в технологических компаниях ЦА и MENA.',
    color: '#8b5cf6',
    icon: 'fa-rocket',
    lp_count: 0,
    deployed: 0,
    nav: 0,
  },
];

let activeFundId = 'TCF1';

function getActiveFund() {
  return funds.find(f => f.id === activeFundId) || funds[0];
}

function switchFund(id) {
  activeFundId = id;
  const f = getActiveFund();
  renderFundSwitcher();
  updateFundBranding(f);
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof renderOnboardingTable === 'function') renderOnboardingTable(lpList);
  if (typeof renderPipeline === 'function') renderPipeline(deals);
  if (typeof renderPortfolio === 'function') renderPortfolio(portfolio);
  showToast(`✅ ${f.shortName} — ${t('all_funds')}`);
}

function renderFundSwitcher() {
  const container = document.getElementById('fundSwitcherDropdown');
  if (!container) return;
  container.innerHTML = funds.map(f => `
    <div class="fund-switch-item ${f.id === activeFundId ? 'active' : ''}" onclick="switchFund('${f.id}')">
      <div class="fsi-dot" style="background:${f.color}"></div>
      <div class="fsi-body">
        <div class="fsi-name">${f.shortName}</div>
        <div class="fsi-type">${f.type} · $${f.targetSize}M</div>
      </div>
      <span class="fsi-status ${f.status}">${getFundStatusLabel(f.status)}</span>
    </div>
  `).join('') + `
    <div class="fund-switch-divider"></div>
    <div class="fund-switch-item add-fund" onclick="openModal('addFund')">
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

function saveFund() {
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

  const colors = ['#3b82f6','#8b5cf6','#22c55e','#f97316','#14b8a6','#ef4444','#eab308'];
  const newFund = {
    id: 'FUND_' + Date.now(),
    name,
    shortName: name.split(' ').map(w => w[0]).join('').substring(0,6).toUpperCase(),
    gp: 'Golden Leaves Ltd',
    license,
    type,
    targetSize: size,
    currency: 'USD',
    vintage,
    status: 'fundraising',
    phase: 'Fundraising',
    phaseYear: 0,
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
    lp_count: 0, deployed: 0, nav: 0,
  };
  funds.push(newFund);
  renderFundSwitcher();
  closeModal();
  showToast(`✅ ${currentLang === 'ru' ? 'Фонд создан' : 'Fund created'}: ${newFund.shortName}`);
  ['nf_name','nf_size','nf_license','nf_desc'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
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
