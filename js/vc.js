// ============================================================
//  vc.js — VC module frontend (docs/TZ_VC_Module.md): SPV / co-investment
//  vehicles + the cap table section spliced into the portfolio company
//  modal (js/app.js's _renderPortfolioModal()). Only ever relevant for a
//  fund with assetClass === 'vc' — nav visibility gated on that below,
//  same duck-typed-hook pattern js/hf.js already established for
//  operatingModel === 'open-end'.
//
//  spvs is loaded tenant-wide (js/api-auth.js) and filtered by
//  activeFundId here at render time — same convention as
//  hfSubscriptions/capitalCallsLog. Cap table data (portfolio_rounds) is
//  per-company and fetched on demand when a portfolio company's modal
//  opens, cached in vcCapTableCache keyed by portfolioId.
// ============================================================

let spvs = [];
let vcCapTableCache = {}; // portfolioId -> { rounds, fundOwnershipPct }
let spvDetailId = null;   // which SPV modal-spv-detail is currently showing

// Called from js/funds.js's updateFundBranding() on every switchFund() —
// see the comment there. operatingModel can't distinguish VC from PE
// (both 'closed-end'), so this checks assetClass directly rather than
// piggybacking on js/hf.js's hook.
function updateDashboardForAssetClass(fund) {
  const isVc = !!fund && fund.assetClass === 'vc';
  const spvNav = document.querySelector('.nav-item[data-page="spvs"]');
  if (spvNav) spvNav.style.display = isVc ? '' : 'none';
}

/* ===== SPV list page ===== */
function renderSpvsPage() {
  const el = document.getElementById('spvsContent');
  if (!el) return;
  const fund = getActiveFund();
  const curr = fund ? fund.currency : 'USD';
  const fmtU = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, curr) : n);

  const list = spvs.filter(s => s.fundId === activeFundId).sort((a, b) => b.id - a.id);
  const totalCommitted = list.reduce((s, x) => s + (x.totalCommitment || 0), 0);
  const totalCalled = list.reduce((s, x) => s + (x.totalCalled || 0), 0);
  const activeCount = list.filter(s => s.status === 'Open' || s.status === 'Forming').length;

  const statusColors = { Forming: '#f97316', Open: '#22c55e', Closed: '#a78bfa', 'Fully Called': '#38bdf8', 'Wound Down': '#94a3b8' };

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        { label: 'Всего SPV', val: list.length, color: '#38bdf8', icon: 'fa-sitemap' },
        { label: 'Активных', val: activeCount, color: '#22c55e', icon: 'fa-check-circle' },
        { label: 'Committed', val: fmtU(totalCommitted), color: '#a78bfa', icon: 'fa-handshake' },
        { label: 'Called', val: fmtU(totalCalled), color: '#f97316', icon: 'fa-arrow-up' },
      ].map(k => `
        <div style="background:#1c3332;border-radius:10px;padding:14px 16px;border-top:3px solid ${k.color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:30px;height:30px;background:${k.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <i class="fas ${k.icon}" style="color:${k.color};font-size:13px"></i>
            </div>
            <span style="font-size:11px;color:#8abfbb;font-weight:700;text-transform:uppercase">${k.label}</span>
          </div>
          <div style="font-size:20px;font-weight:800;color:#f1f5f9">${k.val}</div>
        </div>`).join('')}
    </div>

    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button onclick="openNewSpvModal()" style="background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Новый SPV
      </button>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-sitemap" style="color:#38bdf8;margin-right:6px"></i>SPV</span>
        <span style="font-size:12px;color:#8abfbb">${list.length} записей</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Название</th><th>Компания</th><th>Инвесторов</th><th>Committed</th><th>Called</th><th>Carry</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${list.length === 0 ? `<tr><td colspan="8" style="text-align:center;padding:32px;color:#4a5568">Нет SPV</td></tr>` :
              list.map(s => {
                const co = (typeof portfolio !== 'undefined' ? portfolio : []).find(p => p.id === s.portfolioId);
                const color = statusColors[s.status] || '#94a3b8';
                return `
                <tr style="cursor:pointer" onclick="openSpvDetailModal(${s.id})">
                  <td style="font-size:12px;font-weight:700;color:#e2e8f0">${escapeHtml(s.name)}</td>
                  <td style="font-size:12px;color:#94a3b8">${co ? escapeHtml(co.name) : '—'}</td>
                  <td style="font-size:12px;color:#e2e8f0">${s.investorCount || 0}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(s.totalCommitment || 0)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(s.totalCalled || 0)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${s.carriedInterestPct}%</td>
                  <td><span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;background:${color}18;color:${color}">${escapeHtml(s.status)}</span></td>
                  <td style="white-space:nowrap" onclick="event.stopPropagation()">
                    <button onclick="deleteSpv(${s.id})" title="Удалить" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewSpvModal() {
  const el = document.getElementById('spvNewContent');
  if (!el) return;
  const scopedPortfolio = (typeof portfolio !== 'undefined' ? portfolio : []).filter(p => p.fundId === activeFundId);
  const scopedDeals = (typeof deals !== 'undefined' ? deals : []).filter(d => d.fundId === activeFundId);
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <label>Название SPV *</label>
        <input type="text" id="spv_name" placeholder="Project Falcon SPV" />
      </div>
      <div class="form-group">
        <label>Портфельная компания</label>
        <select id="spv_portfolioId">
          <option value="">— не выбрано —</option>
          ${scopedPortfolio.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Сделка</label>
        <select id="spv_dealId">
          <option value="">— не выбрано —</option>
          ${scopedDeals.map(d => `<option value="${d.id}">${escapeHtml(d.company)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Carried Interest, %</label>
        <input type="number" id="spv_carry" value="20" />
      </div>
      <div class="form-group">
        <label>Preferred Return, %</label>
        <input type="number" id="spv_pref" value="0" />
      </div>
      <div class="form-group full">
        <label>Юрисдикция</label>
        <input type="text" id="spv_jurisdiction" placeholder="AIFC" />
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewSpvModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveSpv()" style="background:linear-gradient(135deg,#38bdf8,#0284c7);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать</button>
    </div>`;
  const overlay = document.getElementById('spvNewOverlay');
  const modal = document.getElementById('modal-spv-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeNewSpvModal() {
  const overlay = document.getElementById('spvNewOverlay');
  const modal = document.getElementById('modal-spv-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
async function saveSpv() {
  const name = document.getElementById('spv_name').value.trim();
  if (!name) { showToast('⚠ Укажите название SPV', 'red'); return; }
  try {
    await apiFetch('/api/spvs', {
      method: 'POST', body: JSON.stringify({
        fundId: activeFundId, name,
        portfolioId: document.getElementById('spv_portfolioId').value || null,
        dealId: document.getElementById('spv_dealId').value || null,
        carriedInterestPct: parseFloat(document.getElementById('spv_carry').value) || 0,
        preferredReturnPct: parseFloat(document.getElementById('spv_pref').value) || 0,
        jurisdiction: document.getElementById('spv_jurisdiction').value.trim(),
      }),
    });
    await loadSpvsFromApi();
    closeNewSpvModal();
    showToast('✅ SPV создан');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function deleteSpv(id) {
  if (!confirm('Удалить этот SPV?')) return;
  try {
    await apiFetch(`/api/spvs/${id}`, { method: 'DELETE' });
    await loadSpvsFromApi();
    showToast('✅ SPV удалён');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

/* ===== SPV detail modal ===== */
async function openSpvDetailModal(id) {
  spvDetailId = id;
  const overlay = document.getElementById('spvDetailOverlay');
  const modal = document.getElementById('modal-spv-detail');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  await renderSpvDetailModal();
}
function closeSpvDetailModal() {
  spvDetailId = null;
  const overlay = document.getElementById('spvDetailOverlay');
  const modal = document.getElementById('modal-spv-detail');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

async function renderSpvDetailModal() {
  if (!spvDetailId) return;
  const el = document.getElementById('spvDetailContent');
  const title = document.getElementById('spvDetailTitle');
  if (!el) return;
  let spv, metrics;
  try {
    spv = await apiFetch(`/api/spvs/${spvDetailId}`);
    metrics = await apiFetch(`/api/spvs/${spvDetailId}/metrics`);
  } catch (err) {
    el.innerHTML = `<div style="color:#f87171">⚠️ ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (title) title.innerHTML = `<i class="fas fa-sitemap" style="color:#38bdf8;margin-right:8px"></i>${escapeHtml(spv.name)}`;

  const curr = spv.currency || 'USD';
  const fmtU = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, curr) : n);
  const fmtPct = (n) => n == null ? '—' : (n * 100).toFixed(1) + '%';
  const fmtX = (n) => n == null ? '—' : n.toFixed(2) + 'x';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        ['DPI', fmtX(metrics.dpi), '#22c55e'], ['TVPI', fmtX(metrics.tvpi), '#38bdf8'],
        ['IRR', fmtPct(metrics.irr), '#a78bfa'], ['Carry', spv.carriedInterestPct + '%', '#f97316'],
      ].map(([l, v, c]) => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px;border-top:2px solid ${c}">
          <div style="font-size:10px;color:#8abfbb;text-transform:uppercase;font-weight:700">${l}</div>
          <div style="font-size:16px;font-weight:800;color:#f1f5f9">${v}</div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <span class="card-title">Инвесторы</span>
        <button onclick="openNewSpvInvestorModal(${spv.id})" style="background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700"><i class="fas fa-plus" style="margin-right:4px"></i>Инвестор</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Имя</th><th>Тип</th><th>Commitment</th><th>Called</th><th>Paid</th><th>KYC</th><th></th></tr></thead>
          <tbody>
            ${spv.investors.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:20px;color:#4a5568">Нет инвесторов</td></tr>` :
              spv.investors.map(i => `
                <tr>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(i.name)}${i.lpId ? ' <span style="color:#64748b;font-size:10px">(LP фонда)</span>' : ''}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(i.investorType || '—')}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(i.commitment)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(i.calledAmount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(i.paidAmount)}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(i.kycStatus || '—')}</td>
                  <td><button onclick="deleteSpvInvestor(${i.id})" title="Удалить" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button></td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <span class="card-title">Капитал-коллы</span>
        <button onclick="openNewSpvCcModal(${spv.id})" style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:#f97316;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700"><i class="fas fa-plus" style="margin-right:4px"></i>Капитал-колл</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>№</th><th>Назначение</th><th>Сумма</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${spv.capitalCalls.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:20px;color:#4a5568">Нет капитал-коллов</td></tr>` :
              spv.capitalCalls.map(cc => `
                <tr>
                  <td style="font-size:12px;color:#94a3b8">${escapeHtml(cc.ccNumber)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(cc.purpose || '—')}</td>
                  <td style="font-size:12px;font-weight:700;color:#f97316">${fmtU(cc.totalAmount)}</td>
                  <td><span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;background:#f9731618;color:#f97316">${escapeHtml(cc.status)}</span></td>
                  <td style="white-space:nowrap">
                    ${cc.status === 'Draft' ? `<button onclick="sendSpvCc(${cc.id})" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">Отправить</button>` :
                      cc.lineItems.map(li => li.status !== 'Paid' ? `<button onclick="paySpvCcLineItem(${cc.id},${li.spvInvestorId},'${escapeHtml(li.investorName).replace(/'/g, "\\'")}')" style="background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;margin:1px">${escapeHtml(li.investorName)}: оплата</button>` : '').join('')}
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title">Дистрибьюции</span>
        <button onclick="openNewSpvDistModal(${spv.id})" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700"><i class="fas fa-plus" style="margin-right:4px"></i>Дистрибьюция</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>№</th><th>ROC</th><th>Profit</th><th>Carry (всего)</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${spv.distributions.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:#4a5568">Нет дистрибьюций</td></tr>` :
              spv.distributions.map(d => `
                <tr>
                  <td style="font-size:12px;color:#94a3b8">${escapeHtml(d.distNumber)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(d.rocAmount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${fmtU(d.profitAmount)}</td>
                  <td style="font-size:12px;color:#f97316">${fmtU(d.lineItems.reduce((s, li) => s + (li.gpCarryAmount || 0), 0))}</td>
                  <td><span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;background:#22c55e18;color:#22c55e">${escapeHtml(d.status)}</span></td>
                  <td>${d.status === 'Draft' ? `<button onclick="sendSpvDist(${d.id})" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">Отправить</button>` : ''}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewSpvInvestorModal(spvId) {
  const el = document.getElementById('spvInvestorNewContent');
  if (!el) return;
  const fundLps = (typeof lpRegister !== 'undefined' ? lpRegister : []).filter(l => l.fundId === activeFundId);
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <label>LP фонда (опционально, для co-invest)</label>
        <select id="spvinv_lpId" onchange="onSpvInvestorLpChange(this.value)">
          <option value="">— внешний инвестор —</option>
          ${fundLps.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full">
        <label>Имя инвестора *</label>
        <input type="text" id="spvinv_name" placeholder="Angel Investor LLC" />
      </div>
      <div class="form-group">
        <label>Тип</label>
        <select id="spvinv_type">
          <option value="External">External</option>
          <option value="Fund LP">Fund LP</option>
          <option value="Founder">Founder</option>
          <option value="GP Co-invest">GP Co-invest</option>
        </select>
      </div>
      <div class="form-group">
        <label>Commitment *</label>
        <input type="number" id="spvinv_commitment" placeholder="100000" />
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewSpvInvestorModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveSpvInvestor(${spvId})" style="background:linear-gradient(135deg,#38bdf8,#0284c7);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Добавить</button>
    </div>`;
  const overlay = document.getElementById('spvInvestorNewOverlay');
  const modal = document.getElementById('modal-spv-investor-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
}
function onSpvInvestorLpChange(lpId) {
  if (!lpId) return;
  const l = (typeof lpRegister !== 'undefined' ? lpRegister : []).find(x => String(x.id) === String(lpId));
  const nameEl = document.getElementById('spvinv_name');
  if (l && nameEl) nameEl.value = l.name;
}
function closeNewSpvInvestorModal() {
  const overlay = document.getElementById('spvInvestorNewOverlay');
  const modal = document.getElementById('modal-spv-investor-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
}
async function saveSpvInvestor(spvId) {
  const name = document.getElementById('spvinv_name').value.trim();
  const commitment = parseFloat(document.getElementById('spvinv_commitment').value);
  if (!name) { showToast('⚠ Укажите имя инвестора', 'red'); return; }
  if (!commitment || commitment <= 0) { showToast('⚠ Укажите commitment', 'red'); return; }
  try {
    const lpId = document.getElementById('spvinv_lpId').value;
    await apiFetch(`/api/spvs/${spvId}/investors`, {
      method: 'POST', body: JSON.stringify({ name, lpId: lpId || null, investorType: document.getElementById('spvinv_type').value, commitment }),
    });
    closeNewSpvInvestorModal();
    await renderSpvDetailModal();
    await loadSpvsFromApi();
    showToast('✅ Инвестор добавлен');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
async function deleteSpvInvestor(id) {
  if (!confirm('Удалить этого инвестора?')) return;
  try {
    await apiFetch(`/api/spv-investors/${id}`, { method: 'DELETE' });
    await renderSpvDetailModal();
    await loadSpvsFromApi();
    showToast('✅ Инвестор удалён');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

function openNewSpvCcModal(spvId) {
  const el = document.getElementById('spvCcNewContent');
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <label>Назначение *</label>
        <input type="text" id="spvcc_purpose" placeholder="Investment" value="Investment" />
      </div>
      <div class="form-group full">
        <label>Сумма *</label>
        <input type="number" id="spvcc_amount" placeholder="100000" />
      </div>
    </div>
    <div style="font-size:11px;color:#8abfbb;margin-top:6px">Распределяется пропорционально commitment активных инвесторов.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewSpvCcModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveSpvCc(${spvId})" style="background:linear-gradient(135deg,#f97316,#c2410c);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать (черновик)</button>
    </div>`;
  const overlay = document.getElementById('spvCcNewOverlay');
  const modal = document.getElementById('modal-spv-cc-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
}
function closeNewSpvCcModal() {
  const overlay = document.getElementById('spvCcNewOverlay');
  const modal = document.getElementById('modal-spv-cc-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
}
async function saveSpvCc(spvId) {
  const purpose = document.getElementById('spvcc_purpose').value.trim();
  const totalAmount = parseFloat(document.getElementById('spvcc_amount').value);
  if (!purpose) { showToast('⚠ Укажите назначение', 'red'); return; }
  if (!totalAmount || totalAmount <= 0) { showToast('⚠ Укажите сумму', 'red'); return; }
  try {
    await apiFetch(`/api/spvs/${spvId}/capital-calls`, { method: 'POST', body: JSON.stringify({ purpose, totalAmount }) });
    closeNewSpvCcModal();
    await renderSpvDetailModal();
    await loadSpvsFromApi();
    showToast('✅ Капитал-колл создан (черновик)');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
async function sendSpvCc(id) {
  if (!confirm('Отправить этот капитал-колл инвесторам?')) return;
  try {
    await apiFetch(`/api/spv-capital-calls/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Pending' }) });
    await renderSpvDetailModal();
    showToast('✅ Капитал-колл отправлен');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
async function paySpvCcLineItem(ccId, investorId, investorName) {
  const wireRef = prompt(`Референс платежа для ${investorName}:`);
  if (!wireRef) return;
  const wireConfirmUrl = prompt('Ссылка на подтверждение платежа (SWIFT/платёжное поручение):');
  if (!wireConfirmUrl) return;
  try {
    await apiFetch(`/api/spv-capital-calls/${ccId}/line-items/${investorId}`, {
      method: 'PUT', body: JSON.stringify({ status: 'Paid', wireRef, wireConfirmUrl }),
    });
    await renderSpvDetailModal();
    await loadSpvsFromApi();
    showToast('✅ Оплата подтверждена');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

function openNewSpvDistModal(spvId) {
  const el = document.getElementById('spvDistNewContent');
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>Return of Capital</label>
        <input type="number" id="spvdist_roc" placeholder="0" value="0" />
      </div>
      <div class="form-group">
        <label>Profit (carry применяется)</label>
        <input type="number" id="spvdist_profit" placeholder="0" value="0" />
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewSpvDistModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveSpvDist(${spvId})" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать (черновик)</button>
    </div>`;
  const overlay = document.getElementById('spvDistNewOverlay');
  const modal = document.getElementById('modal-spv-dist-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
}
function closeNewSpvDistModal() {
  const overlay = document.getElementById('spvDistNewOverlay');
  const modal = document.getElementById('modal-spv-dist-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
}
async function saveSpvDist(spvId) {
  const rocAmount = parseFloat(document.getElementById('spvdist_roc').value) || 0;
  const profitAmount = parseFloat(document.getElementById('spvdist_profit').value) || 0;
  if (rocAmount <= 0 && profitAmount <= 0) { showToast('⚠ Укажите сумму ROC или Profit', 'red'); return; }
  try {
    await apiFetch(`/api/spvs/${spvId}/distributions`, { method: 'POST', body: JSON.stringify({ rocAmount, profitAmount }) });
    closeNewSpvDistModal();
    await renderSpvDetailModal();
    showToast('✅ Дистрибьюция создана (черновик)');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
async function sendSpvDist(id) {
  if (!confirm('Отправить эту дистрибьюцию?')) return;
  try {
    await apiFetch(`/api/spv-distributions/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Sent' }) });
    await renderSpvDetailModal();
    showToast('✅ Дистрибьюция отправлена');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

/* ===== Cap table section, spliced into the portfolio company modal
   (js/app.js's _renderPortfolioModal()) — see the call site there. ===== */
function renderVcCapTableSection(p) {
  const fund = typeof getFundById === 'function' ? getFundById(p.fundId) : null;
  if (!fund || fund.assetClass !== 'vc') return '';

  const cached = vcCapTableCache[p.id];
  if (!cached) {
    loadCapTableForPortfolio(p.id);
    return `<div style="margin-top:18px;padding:14px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:10px;color:#8abfbb;font-size:12px">Загрузка cap table…</div>`;
  }

  const { rounds, fundOwnershipPct } = cached;
  const iS = `background:#0f1623;border:1px solid #2a4846;border-radius:7px;padding:7px 10px;color:#e2e8f0;font-size:12px;width:100%;box-sizing:border-box`;

  return `
    <div style="margin-top:18px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div style="font-size:10px;font-weight:700;color:#7dd3fc;text-transform:uppercase">
          <i class="fas fa-layer-group" style="margin-right:5px"></i>Cap Table
          ${fundOwnershipPct != null ? `<span style="color:#38bdf8;margin-left:8px">Наша доля сейчас: ${fundOwnershipPct.toFixed(2)}%</span>` : ''}
        </div>
        <button onclick="toggleAddRoundForm(${p.id})" style="background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.4);color:#7dd3fc;padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700">
          <i class="fas fa-plus" style="margin-right:5px"></i>Добавить раунд
        </button>
      </div>

      <div id="addRoundForm_${p.id}" style="display:none;background:#0f1623;border-radius:8px;padding:12px;margin-bottom:12px">
        <div class="form-grid">
          <div class="form-group"><label>Название раунда *</label><input type="text" id="round_name_${p.id}" placeholder="Series A" style="${iS}" /></div>
          <div class="form-group"><label>Дата</label><input type="date" id="round_date_${p.id}" style="${iS}" /></div>
          <div class="form-group"><label>Pre-money</label><input type="number" id="round_pre_${p.id}" style="${iS}" /></div>
          <div class="form-group"><label>Post-money</label><input type="number" id="round_post_${p.id}" style="${iS}" /></div>
        </div>
        <div id="roundInvestorRows_${p.id}" style="margin-top:10px"></div>
        <button onclick="addRoundInvestorRow(${p.id})" style="background:transparent;border:1px dashed #2a4846;color:#8abfbb;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;margin-top:6px">+ строка инвестора</button>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
          <button onclick="toggleAddRoundForm(${p.id})" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px">Отмена</button>
          <button onclick="saveNewRound(${p.id})" style="background:linear-gradient(135deg,#38bdf8,#0284c7);border:none;color:#fff;padding:6px 18px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700">Сохранить раунд</button>
        </div>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Раунд</th><th>Дата</th><th>Pre/Post-money</th><th>Инвесторы</th><th></th></tr></thead>
          <tbody>
            ${rounds.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:16px;color:#4a5568">Нет раундов</td></tr>` :
              rounds.map(r => `
                <tr>
                  <td style="font-size:12px;font-weight:700;color:#e2e8f0">${escapeHtml(r.roundName || '—')}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(r.roundDate || '—')}</td>
                  <td style="font-size:11px;color:#94a3b8">${r.preMoney != null ? r.preMoney.toLocaleString() : '—'} / ${r.postMoney != null ? r.postMoney.toLocaleString() : '—'}</td>
                  <td style="font-size:11px;color:#e2e8f0">${r.investors.map(i => `${escapeHtml(i.investorName)}${i.ownershipPctPost != null ? ` (${i.ownershipPctPost.toFixed(1)}%)` : ''}`).join(', ') || '—'}</td>
                  <td><button onclick="deleteRound(${r.id},${p.id})" title="Удалить раунд" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button></td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function loadCapTableForPortfolio(portfolioId) {
  try {
    const data = await apiFetch(`/api/portfolio/${portfolioId}/rounds`);
    vcCapTableCache[portfolioId] = data;
    // Only re-render if this company's modal is still the one open.
    if (typeof portfolio !== 'undefined' && document.getElementById('modal-port-detail') && document.getElementById('modal-port-detail').style.display !== 'none') {
      const p = portfolio.find(x => x.id === portfolioId);
      if (p && typeof _renderPortfolioModal === 'function') _renderPortfolioModal(p);
    }
  } catch (err) {
    console.error('Failed to load cap table:', err);
  }
}

function toggleAddRoundForm(portfolioId) {
  const form = document.getElementById(`addRoundForm_${portfolioId}`);
  if (!form) return;
  const willShow = form.style.display === 'none';
  form.style.display = willShow ? 'block' : 'none';
  if (willShow && !document.getElementById(`roundInvestorRows_${portfolioId}`).children.length) {
    addRoundInvestorRow(portfolioId);
  }
}

function addRoundInvestorRow(portfolioId) {
  const container = document.getElementById(`roundInvestorRows_${portfolioId}`);
  if (!container) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  row.innerHTML = `
    <input type="text" placeholder="Имя инвестора" class="round-inv-name" style="flex:2;background:#1c3332;border:1px solid #2a4846;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px" />
    <input type="number" placeholder="Сумма" class="round-inv-amount" style="flex:1;background:#1c3332;border:1px solid #2a4846;border-radius:6px;padding:5px 8px;color:#e2e8f0;font-size:11px" />
    <label style="font-size:10px;color:#8abfbb;white-space:nowrap"><input type="checkbox" class="round-inv-own" /> наш фонд</label>
    <button onclick="this.parentElement.remove()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:11px"><i class="fas fa-times"></i></button>`;
  container.appendChild(row);
}

async function saveNewRound(portfolioId) {
  const roundName = document.getElementById(`round_name_${portfolioId}`).value.trim();
  if (!roundName) { showToast('⚠ Укажите название раунда', 'red'); return; }
  const rows = document.querySelectorAll(`#roundInvestorRows_${portfolioId} > div`);
  const investors = Array.from(rows).map(row => ({
    investorName: row.querySelector('.round-inv-name').value.trim(),
    amount: parseFloat(row.querySelector('.round-inv-amount').value) || null,
    isOwnFund: row.querySelector('.round-inv-own').checked,
  })).filter(i => i.investorName);
  try {
    await apiFetch(`/api/portfolio/${portfolioId}/rounds`, {
      method: 'POST', body: JSON.stringify({
        roundName, roundDate: document.getElementById(`round_date_${portfolioId}`).value || null,
        preMoney: parseFloat(document.getElementById(`round_pre_${portfolioId}`).value) || null,
        postMoney: parseFloat(document.getElementById(`round_post_${portfolioId}`).value) || null,
        investors,
      }),
    });
    delete vcCapTableCache[portfolioId];
    toggleAddRoundForm(portfolioId);
    await loadCapTableForPortfolio(portfolioId);
    showToast('✅ Раунд добавлен');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function deleteRound(roundId, portfolioId) {
  if (!confirm('Удалить этот раунд?')) return;
  try {
    await apiFetch(`/api/portfolio/rounds/${roundId}`, { method: 'DELETE' });
    delete vcCapTableCache[portfolioId];
    await loadCapTableForPortfolio(portfolioId);
    showToast('✅ Раунд удалён');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
