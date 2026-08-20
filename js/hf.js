// ============================================================
//  hf.js — Hedge Fund module frontend (Stage 5,
//  docs/TZ_Hedge_Fund_Module.md). Only ever relevant for a fund with
//  operatingModel === 'open-end' — nav items/pages are gated on that in
//  js/app.js, same pattern already used for Portfolio (internal-only) and
//  Audit Log (manageUsers-only) nav visibility.
//
//  hfSubscriptions/hfRedemptions/hfNavHistory are loaded tenant-wide
//  (js/api-auth.js) and filtered by activeFundId here at render time —
//  same convention as capitalCallsLog/distributionsLog.
// ============================================================

let hfSubscriptions = [];
let hfRedemptions = [];
let hfNavHistory = [];

// Called from js/funds.js's updateFundBranding() on every switchFund()/
// initial load — the single place that reacts to "which fund is active
// now" already existed, this just adds one more branch to it rather than
// inventing a parallel hook. docs/ARCHITECTURE_Multi_Strategy_Roadmap.md
// §4: an open-end fund's dashboard/nav needs a different shape, not just
// additional items — Capital Calls/Distributions/First Closing are
// closed-end-only (hedge funds never populate those tables at all), and
// the PE lifecycle bar/J-curve are meaningless for one.
function updateDashboardForOperatingModel(fund) {
  const isOpenEnd = !!fund && fund.operatingModel === 'open-end';

  const hfSubNav = document.querySelector('.nav-item[data-page="hf-subscriptions"]');
  const hfNavNav = document.querySelector('.nav-item[data-page="hf-nav"]');
  if (hfSubNav) hfSubNav.style.display = isOpenEnd ? '' : 'none';
  if (hfNavNav) hfNavNav.style.display = isOpenEnd ? '' : 'none';

  const ccNav = document.querySelector('.nav-item[data-page="lp-capital-calls"]');
  const distNav = document.querySelector('.nav-item[data-page="lp-distributions"]');
  const closingNav = document.querySelector('.nav-item[data-page="closing"]');
  if (ccNav) ccNav.style.display = isOpenEnd ? 'none' : '';
  if (distNav) distNav.style.display = isOpenEnd ? 'none' : '';
  if (closingNav) closingNav.style.display = isOpenEnd ? 'none' : '';

  const lifecycleBar = document.getElementById('lifecycleBar');
  const peKpiGrid = document.getElementById('peKpiGrid');
  const hfKpiGrid = document.getElementById('hfKpiGrid');
  const chartsRow = document.getElementById('dashboardChartsRow');
  if (lifecycleBar) lifecycleBar.style.display = isOpenEnd ? 'none' : '';
  if (peKpiGrid) peKpiGrid.style.display = isOpenEnd ? 'none' : '';
  if (hfKpiGrid) hfKpiGrid.style.display = isOpenEnd ? '' : 'none';
  if (chartsRow) chartsRow.style.display = isOpenEnd ? 'none' : '';

  if (isOpenEnd) renderHfDashboardKpis(fund);
}

// AUM/NAV-per-unit/MTD/YTD/since-inception — the open-end dashboard's
// replacement for the closed-end IRR/DPI/TVPI headline numbers, from the
// real GET /api/funds/:id/hf-metrics (never a fabricated 0 — see that
// route's own comment for why every field can come back null).
async function renderHfDashboardKpis(fund) {
  const curr = fund.currency || 'USD';
  const fmtU = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, curr) : n);
  const fmtPct = (n) => n == null ? '—' : (n * 100).toFixed(2) + '%';

  const scopedLps = (typeof lpRegister !== 'undefined' ? lpRegister : []).filter(l => l.fundId === fund.id && l.status === 'Active');
  const lpCountEl = document.getElementById('hfKpiLpCount');
  if (lpCountEl) lpCountEl.textContent = scopedLps.length;

  try {
    const m = await apiFetch(`/api/funds/${fund.id}/hf-metrics`);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('hfKpiAum', m.aum != null ? fmtU(m.aum) : 'Нет данных');
    set('hfKpiAumDelta', m.asOfDate ? `на ${m.asOfDate}` : 'NAV ещё не опубликован');
    set('hfKpiNavPerUnit', m.navPerUnit != null ? fmtU(m.navPerUnit) : '—');
    set('hfKpiNavDate', m.asOfDate || '—');
    set('hfKpiMtd', fmtPct(m.mtdReturn));
    set('hfKpiYtd', fmtPct(m.ytdReturn));
    set('hfKpiInception', fmtPct(m.sinceInceptionReturn));
  } catch (err) {
    console.error('Failed to load hedge fund dashboard metrics:', err);
  }
}

const HF_SUB_STATUS_LABELS = { Pending: 'Ожидает', Processed: 'Проведена', Cancelled: 'Отменена' };
const HF_RED_STATUS_LABELS = { Requested: 'Запрошено', Queued: 'В очереди (gate)', Processed: 'Проведено', Cancelled: 'Отменено' };

function hfStatusBadge(status, labels, colorMap) {
  const label = labels[status] || status;
  const color = colorMap[status] || '#94a3b8';
  return `<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;background:${color}18;color:${color}">${label}</span>`;
}

/* ===== Подписки / Погашения ===== */
function renderHfSubscriptionsPage() {
  const el = document.getElementById('hfSubscriptionsContent');
  if (!el) return;
  const fund = getActiveFund();
  const curr = fund ? fund.currency : 'USD';
  const fmtU = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, curr) : n);

  const subs = hfSubscriptions.filter(s => s.fundId === activeFundId).sort((a, b) => b.id - a.id);
  const reds = hfRedemptions.filter(r => r.fundId === activeFundId).sort((a, b) => b.id - a.id);
  const fundLps = (typeof lpRegister !== 'undefined' ? lpRegister : []).filter(l => l.fundId === activeFundId);
  const lpName = (id) => { const l = fundLps.find(x => x.id === id) || lpRegister.find(x => x.id === id); return l ? l.name : `LP #${id}`; };

  const totalRaised = subs.filter(s => s.status === 'Processed').reduce((s, x) => s + (x.amount || 0), 0);
  const pendingSubs = subs.filter(s => s.status === 'Pending').length;
  const queuedReds = reds.filter(r => r.status === 'Queued').length;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        { label: 'Привлечено (проведено)', val: fmtU(totalRaised), color: '#22c55e', icon: 'fa-arrow-up' },
        { label: 'Подписок ожидает', val: pendingSubs, color: '#f97316', icon: 'fa-hourglass-half' },
        { label: 'Погашений в очереди (gate)', val: queuedReds, color: '#eab308', icon: 'fa-layer-group' },
        { label: 'Всего заявок', val: subs.length + reds.length, color: '#14b8a6', icon: 'fa-list' },
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

    <div style="display:flex;gap:10px;margin-bottom:14px">
      <button onclick="openNewHfSubModal()" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Новая подписка
      </button>
      <button onclick="openNewHfRedModal()" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Новое погашение
      </button>
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-arrow-up" style="color:#22c55e;margin-right:6px"></i>Подписки</span>
        <span style="font-size:12px;color:#8abfbb">${subs.length} записей</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>№</th><th>LP</th><th>Дата заявки</th><th>Сумма</th><th>NAV/юнит</th><th>Юнитов выпущено</th><th>Lock-up до</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${subs.length === 0 ? `<tr><td colspan="9" style="text-align:center;padding:32px;color:#4a5568">Нет подписок</td></tr>` :
              subs.map(s => `
                <tr>
                  <td style="font-size:12px;color:#94a3b8">${escapeHtml(s.subNumber)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(lpName(s.lpId))}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(s.requestDate || '—')}</td>
                  <td style="font-size:12px;font-weight:700;color:#22c55e">${fmtU(s.amount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${s.navPerUnitAtEntry != null ? fmtU(s.navPerUnitAtEntry) : '—'}</td>
                  <td style="font-size:12px;color:#e2e8f0">${s.unitsIssued != null ? s.unitsIssued.toFixed(2) : '—'}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(s.lockupUntil || '—')}</td>
                  <td>${hfStatusBadge(s.status, HF_SUB_STATUS_LABELS, { Pending: '#f97316', Processed: '#22c55e', Cancelled: '#94a3b8' })}</td>
                  <td style="white-space:nowrap">
                    ${s.status === 'Pending' ? `
                      <button onclick="processHfSubscription(${s.id})" title="Обработать" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-right:4px">Обработать</button>
                      <button onclick="deleteHfSubscription(${s.id})" title="Удалить" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button>
                    ` : ''}
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-arrow-down" style="color:#ef4444;margin-right:6px"></i>Погашения</span>
        <span style="font-size:12px;color:#8abfbb">${reds.length} записей</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>№</th><th>LP</th><th>Дата заявки</th><th>Notice до</th><th>Юнитов</th><th>NAV/юнит</th><th>Сумма</th><th>Gate</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            ${reds.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:32px;color:#4a5568">Нет заявок на погашение</td></tr>` :
              reds.map(r => `
                <tr>
                  <td style="font-size:12px;color:#94a3b8">${escapeHtml(r.redemptionNumber)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(lpName(r.lpId))}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(r.requestDate || '—')}</td>
                  <td style="font-size:11px;color:#94a3b8">${escapeHtml(r.noticeExpires || '—')}</td>
                  <td style="font-size:12px;color:#e2e8f0">${r.unitsRequested}</td>
                  <td style="font-size:12px;color:#e2e8f0">${r.navPerUnitAtExit != null ? fmtU(r.navPerUnitAtExit) : '—'}</td>
                  <td style="font-size:12px;font-weight:700;color:#ef4444">${r.amount != null ? fmtU(r.amount) : '—'}</td>
                  <td style="font-size:11px;color:${r.gateApplied ? '#eab308' : '#64748b'}">${r.gateApplied ? (r.gatePctApplied != null ? r.gatePctApplied + '%' : 'да') : '—'}</td>
                  <td>${hfStatusBadge(r.status, HF_RED_STATUS_LABELS, { Requested: '#f97316', Queued: '#eab308', Processed: '#22c55e', Cancelled: '#94a3b8' })}</td>
                  <td style="white-space:nowrap">
                    ${(r.status === 'Requested' || r.status === 'Queued') ? `
                      <button onclick="processHfRedemption(${r.id})" title="Обработать" style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-right:4px">Обработать</button>
                      ${r.status === 'Requested' ? `<button onclick="deleteHfRedemption(${r.id})" title="Удалить" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button>` : ''}
                    ` : ''}
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewHfSubModal() {
  const fundLps = (typeof lpRegister !== 'undefined' ? lpRegister : []).filter(l => l.fundId === activeFundId && l.status === 'Active');
  const el = document.getElementById('hfSubNewContent');
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <label>LP *</label>
        <select id="hfsub_lpId">
          <option value="">— выберите LP —</option>
          ${fundLps.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full">
        <label>Сумма подписки *</label>
        <input type="number" id="hfsub_amount" placeholder="100000" />
      </div>
      <div class="form-group full">
        <label>Примечания</label>
        <textarea id="hfsub_notes" rows="2"></textarea>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewHfSubModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveHfSub()" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать</button>
    </div>`;
  const overlay = document.getElementById('hfSubNewOverlay');
  const modal = document.getElementById('modal-hf-sub-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeNewHfSubModal() {
  const overlay = document.getElementById('hfSubNewOverlay');
  const modal = document.getElementById('modal-hf-sub-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
async function saveHfSub() {
  const lpId = document.getElementById('hfsub_lpId').value;
  const amount = parseFloat(document.getElementById('hfsub_amount').value);
  const notes = document.getElementById('hfsub_notes').value.trim();
  if (!lpId) { showToast('⚠ Выберите LP', 'red'); return; }
  if (!amount || amount <= 0) { showToast('⚠ Укажите сумму подписки', 'red'); return; }
  try {
    await apiFetch('/api/hf/subscriptions', { method: 'POST', body: JSON.stringify({ fundId: activeFundId, lpId: parseInt(lpId, 10), amount, notes }) });
    await loadHfSubscriptionsFromApi();
    closeNewHfSubModal();
    showToast('✅ Подписка создана');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

function openNewHfRedModal() {
  const fundLps = (typeof lpRegister !== 'undefined' ? lpRegister : []).filter(l => l.fundId === activeFundId);
  const el = document.getElementById('hfRedNewContent');
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group full">
        <label>LP *</label>
        <select id="hfred_lpId">
          <option value="">— выберите LP —</option>
          ${fundLps.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full">
        <label>Количество юнитов *</label>
        <input type="number" id="hfred_units" placeholder="100" />
      </div>
      <div class="form-group full">
        <label>Примечания</label>
        <textarea id="hfred_notes" rows="2"></textarea>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewHfRedModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveHfRed()" style="background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать</button>
    </div>`;
  const overlay = document.getElementById('hfRedNewOverlay');
  const modal = document.getElementById('modal-hf-red-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeNewHfRedModal() {
  const overlay = document.getElementById('hfRedNewOverlay');
  const modal = document.getElementById('modal-hf-red-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
async function saveHfRed() {
  const lpId = document.getElementById('hfred_lpId').value;
  const unitsRequested = parseFloat(document.getElementById('hfred_units').value);
  const notes = document.getElementById('hfred_notes').value.trim();
  if (!lpId) { showToast('⚠ Выберите LP', 'red'); return; }
  if (!unitsRequested || unitsRequested <= 0) { showToast('⚠ Укажите количество юнитов', 'red'); return; }
  try {
    await apiFetch('/api/hf/redemptions', { method: 'POST', body: JSON.stringify({ fundId: activeFundId, lpId: parseInt(lpId, 10), unitsRequested, notes }) });
    await loadHfRedemptionsFromApi();
    closeNewHfRedModal();
    showToast('✅ Заявка на погашение создана');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function processHfSubscription(id) {
  const sub = hfSubscriptions.find(s => s.id === id);
  if (!sub) return;
  if (!confirm(`Обработать подписку ${sub.subNumber}? Юниты будут выпущены по последней опубликованной NAV фонда.`)) return;
  try {
    await apiFetch(`/api/hf/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed' }) });
    await loadHfSubscriptionsFromApi();
    showToast('✅ Подписка обработана');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function deleteHfSubscription(id) {
  if (!confirm('Удалить эту подписку?')) return;
  try {
    await apiFetch(`/api/hf/subscriptions/${id}`, { method: 'DELETE' });
    await loadHfSubscriptionsFromApi();
    showToast('✅ Подписка удалена');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function processHfRedemption(id) {
  const red = hfRedemptions.find(r => r.id === id);
  if (!red) return;
  if (!confirm(`Обработать погашение ${red.redemptionNumber}? Будет выполнена проверка lock-up и gate.`)) return;
  try {
    const result = await apiFetch(`/api/hf/redemptions/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'Processed' }) });
    await loadHfRedemptionsFromApi();
    if (result.status === 'Queued') {
      showToast('⏳ Погашение поставлено в очередь — превышен лимит gate в этом окне', 'orange');
    } else {
      showToast('✅ Погашение обработано');
    }
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

async function deleteHfRedemption(id) {
  if (!confirm('Удалить эту заявку на погашение?')) return;
  try {
    await apiFetch(`/api/hf/redemptions/${id}`, { method: 'DELETE' });
    await loadHfRedemptionsFromApi();
    showToast('✅ Заявка удалена');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

/* ===== NAV ===== */
function renderHfNavPage() {
  const el = document.getElementById('hfNavContent');
  if (!el) return;
  const fund = getActiveFund();
  const curr = fund ? fund.currency : 'USD';
  const fmtU = (n) => (typeof fmtCurrency === 'function' ? fmtCurrency(n, curr) : n);
  const navs = hfNavHistory.filter(n => n.fundId === activeFundId).sort((a, b) => (b.asOfDate || '').localeCompare(a.asOfDate || '') || b.id - a.id);

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button onclick="openNewHfNavModal()" style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.3);color:#a78bfa;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
        <i class="fas fa-plus" style="margin-right:6px"></i>Новая запись NAV
      </button>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-chart-line" style="color:#a78bfa;margin-right:6px"></i>История NAV</span>
        <span style="font-size:12px;color:#8abfbb">${navs.length} записей</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Дата</th><th>GAV</th><th>Обязательства</th><th>NAV</th><th>Юнитов</th><th>NAV/юнит</th><th>Статус</th><th>Опубликовано</th><th></th></tr></thead>
          <tbody>
            ${navs.length === 0 ? `<tr><td colspan="9" style="text-align:center;padding:32px;color:#4a5568">Нет записей NAV</td></tr>` :
              navs.map(n => `
                <tr>
                  <td style="font-size:12px;color:#e2e8f0">${escapeHtml(n.asOfDate)}</td>
                  <td style="font-size:12px;color:#94a3b8">${fmtU(n.grossAssetValue)}</td>
                  <td style="font-size:12px;color:#94a3b8">${fmtU(n.liabilities)}</td>
                  <td style="font-size:12px;font-weight:700;color:#e2e8f0">${n.navTotal != null ? fmtU(n.navTotal) : '—'}</td>
                  <td style="font-size:12px;color:#94a3b8">${n.unitsOutstanding}</td>
                  <td style="font-size:12px;font-weight:700;color:#a78bfa">${n.navPerUnit != null ? fmtU(n.navPerUnit) : '—'}</td>
                  <td>${hfStatusBadge(n.status, { Draft: 'Черновик', Published: 'Опубликован' }, { Draft: '#f97316', Published: '#22c55e' })}</td>
                  <td style="font-size:11px;color:#64748b">${n.publishedBy ? escapeHtml(n.publishedBy) : '—'}</td>
                  <td style="white-space:nowrap">
                    ${n.status === 'Draft' ? `
                      <button onclick="submitHfNavForPublish(${n.id})" title="Отправить на согласование" style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.3);color:#a78bfa;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-right:4px">На согласование</button>
                      <button onclick="deleteHfNav(${n.id})" title="Удалить" style="background:transparent;border:1px solid #2a4846;color:#94a3b8;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button>
                    ` : ''}
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewHfNavModal() {
  const el = document.getElementById('hfNavNewContent');
  if (!el) return;
  el.innerHTML = `
    <div class="form-grid">
      <div class="form-group">
        <label>Дата расчёта *</label>
        <input type="date" id="hfnav_asOfDate" value="${new Date().toISOString().slice(0, 10)}" />
      </div>
      <div class="form-group">
        <label>Юнитов в обращении *</label>
        <input type="number" id="hfnav_units" placeholder="10000" />
      </div>
      <div class="form-group">
        <label>Gross Asset Value *</label>
        <input type="number" id="hfnav_gav" placeholder="1000000" />
      </div>
      <div class="form-group">
        <label>Обязательства</label>
        <input type="number" id="hfnav_liabilities" placeholder="0" value="0" />
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
      <button onclick="closeNewHfNavModal()" style="background:#1c3332;border:1px solid #2a4846;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveHfNav()" style="background:linear-gradient(135deg,#a78bfa,#7c3aed);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Создать (черновик)</button>
    </div>`;
  const overlay = document.getElementById('hfNavNewOverlay');
  const modal = document.getElementById('modal-hf-nav-new');
  if (overlay) overlay.style.display = 'block';
  if (modal) modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeNewHfNavModal() {
  const overlay = document.getElementById('hfNavNewOverlay');
  const modal = document.getElementById('modal-hf-nav-new');
  if (overlay) overlay.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}
async function saveHfNav() {
  const asOfDate = document.getElementById('hfnav_asOfDate').value;
  const unitsOutstanding = parseFloat(document.getElementById('hfnav_units').value);
  const grossAssetValue = parseFloat(document.getElementById('hfnav_gav').value);
  const liabilities = parseFloat(document.getElementById('hfnav_liabilities').value) || 0;
  if (!asOfDate) { showToast('⚠ Укажите дату расчёта', 'red'); return; }
  if (!grossAssetValue || grossAssetValue <= 0) { showToast('⚠ Укажите Gross Asset Value', 'red'); return; }
  try {
    await apiFetch('/api/hf/nav', { method: 'POST', body: JSON.stringify({ fundId: activeFundId, asOfDate, grossAssetValue, liabilities, unitsOutstanding: unitsOutstanding || 0 }) });
    await loadHfNavFromApi();
    closeNewHfNavModal();
    showToast('✅ Черновик NAV создан');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}

function submitHfNavForPublish(id) {
  const nav = hfNavHistory.find(n => n.id === id);
  if (!nav) return;
  const fund = getActiveFund();
  startWorkflow('nav_publish', nav.id, `NAV ${fund ? fund.shortName : ''} на ${nav.asOfDate}`, 'HfNav');
}

async function deleteHfNav(id) {
  if (!confirm('Удалить эту запись NAV?')) return;
  try {
    await apiFetch(`/api/hf/nav/${id}`, { method: 'DELETE' });
    await loadHfNavFromApi();
    showToast('✅ Запись NAV удалена');
  } catch (err) { showToast('⚠️ ' + err.message, 'red'); }
}
