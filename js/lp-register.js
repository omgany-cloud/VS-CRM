// ============================================================
//  LP Register + Capital Call Module + Unfunded Commitment
//  Turan Capital Fund LP — Golden Leaves Ltd (GP)
//  Конституция §3.8, §3.9, §3.6 | AFSA AIFC CIS Rules
//  Version: 5.4
// ============================================================

/* ═══════════════════════════════════════════════════════════
   DATA STORES
═══════════════════════════════════════════════════════════ */

/**
 * lpRegister[] — Official Register of Limited Partners
 * Per Constitution §3.8.2 — must contain: name, address,
 * commitment, admission date, % ownership, professional
 * client status, exit date (if applicable).
 * Retention: 6 years after LP exit.
 */
let lpRegister = [];  // populated at runtime by js/api-auth.js via GET /api/lp (see server/index.js)
let lpRegisterIdCounter = 7;

/**
 * capitalCallsLog[] — Capital Call Journal
 * Per Constitution §3.9.1 — notice 10 business days before payment
 * Each CC has line items per LP (pro-rata)
 */
let capitalCallsLog = [];  // populated at runtime by js/api-auth.js via GET /api/capital-calls (see server/index.js)

/* ── Utility ─────────────────────────────────────────── */
// Deprecated shim — kept so any call site this currency sweep missed
// degrades to today's USD behavior instead of throwing. Every fund-scoped
// render site below now calls fmtCurrency(amount, currency) directly
// (js/currency.js), deriving the currency from the amount's own fund
// instead of hardcoding '$'.
function fmtUSD(n) {
  return fmtCurrency(n, DEFAULT_CURRENCY);
}
function fmtPctLP(n) { return (n||0).toFixed(1) + '%'; }

function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function lpRegStatusBadge(s) {
  const cfg = {
    'Active':    { bg:'rgba(34,197,94,0.12)',  c:'#22c55e', icon:'fa-check-circle' },
    'Exited':    { bg:'rgba(100,116,139,0.12)',c:'#94a3b8', icon:'fa-sign-out-alt' },
    'Suspended': { bg:'rgba(239,68,68,0.12)',  c:'#ef4444', icon:'fa-pause-circle' },
    'Pending':   { bg:'rgba(249,115,22,0.12)', c:'#f97316', icon:'fa-clock'        },
  }[s] || { bg:'rgba(100,116,139,0.12)', c:'#94a3b8', icon:'fa-circle' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg};color:${cfg.c}">
    <i class="fas ${cfg.icon}" style="margin-right:3px;font-size:9px"></i>${s}</span>`;
}

function ccStatusBadge(s) {
  const cfg = {
    'Completed': { bg:'rgba(34,197,94,0.12)',  c:'#22c55e' },
    'Pending':   { bg:'rgba(249,115,22,0.12)', c:'#f97316' },
    'Overdue':   { bg:'rgba(239,68,68,0.12)',  c:'#ef4444' },
    'Draft':     { bg:'rgba(100,116,139,0.12)',c:'#94a3b8' },
    'Paid':      { bg:'rgba(34,197,94,0.12)',  c:'#22c55e' },
    'Default':   { bg:'rgba(239,68,68,0.12)',  c:'#ef4444' },
  }[s] || { bg:'rgba(100,116,139,0.12)', c:'#94a3b8' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg};color:${cfg.c}">${s}</span>`;
}

function kycBadge(s) {
  const cfg = {
    'Одобрен':         { bg:'rgba(34,197,94,0.12)',   c:'#22c55e' },
    'Одобрен (EDD)':   { bg:'rgba(234,179,8,0.12)',   c:'#eab308' },
    'В процессе':      { bg:'rgba(249,115,22,0.12)',  c:'#f97316' },
    'Отклонён':        { bg:'rgba(239,68,68,0.12)',   c:'#ef4444' },
    'Не начат':        { bg:'rgba(100,116,139,0.12)', c:'#94a3b8' },
  }[s] || { bg:'rgba(100,116,139,0.12)', c:'#94a3b8' };
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg};color:${cfg.c}">${s||'—'}</span>`;
}

function riskBadge(r) {
  const cfg = { Low:{ bg:'rgba(34,197,94,0.12)', c:'#22c55e' }, Medium:{ bg:'rgba(249,115,22,0.12)', c:'#f97316' }, High:{ bg:'rgba(239,68,68,0.12)', c:'#ef4444' } }[r] || {};
  return `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cfg.bg||'#1c2333'};color:${cfg.c||'#94a3b8'}">${r||'—'}</span>`;
}

/* ═══════════════════════════════════════════════════════════
   COMPUTED HELPERS
═══════════════════════════════════════════════════════════ */

function getLPUnfunded(lp) {
  return Math.max(0, lp.commitment - lp.calledAmount);
}

function getLPCallRate(lp) {
  if (!lp.commitment) return 0;
  return (lp.calledAmount / lp.commitment * 100);
}

// fundId is REQUIRED, no all-funds fallback — summing LPs across different
// funds is not just a currency-label bug once funds can differ in
// currency, it's a real arithmetic error (adding $ and ₸ into one number
// is meaningless). Forcing every caller to pass a fundId (normally
// activeFundId) makes that scoping decision visible and unskippable.
function getTotalCommitments(fundId) {
  return lpRegister.filter(l => l.status === 'Active' && l.fundId === fundId).reduce((s, l) => s + l.commitment, 0);
}

function getTotalCalled(fundId) {
  return lpRegister.filter(l => l.status === 'Active' && l.fundId === fundId).reduce((s, l) => s + l.calledAmount, 0);
}

function getTotalUnfunded(fundId) {
  return lpRegister.filter(l => l.status === 'Active' && l.fundId === fundId).reduce((s, l) => s + getLPUnfunded(l), 0);
}

function getTotalDistributions(fundId) {
  return lpRegister.filter(l => l.status === 'Active' && l.fundId === fundId).reduce((s, l) => s + (l.distributions||0), 0);
}

/** Compute pro-rata called amount for a given LP and pct */
function proRata(lp, pct) {
  return Math.round(lp.commitment * pct / 100);
}

/* ═══════════════════════════════════════════════════════════
   LP REGISTER PAGE
═══════════════════════════════════════════════════════════ */

let lpRegFilter = '';   // search string
let lpRegStatus = '';   // status filter
let activeLpId  = null; // for detail modal

function renderLPRegisterPage() {
  const el = document.getElementById('lpRegisterContent');
  if (!el) return;

  const fundLps = typeof activeFundId !== 'undefined' && activeFundId != null
    ? lpRegister.filter(l => l.fundId === activeFundId)
    : lpRegister;

  // Shadow the global fmtUSD for the rest of this render pass — every LP
  // on this page belongs to the same activeFundId, so one currency lookup
  // covers every fmtUSD(...) call below without touching each call site.
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));

  // AFSA triggers
  const activeCount  = fundLps.filter(l => l.status === 'Active').length;
  const totalCommit  = fundLps.filter(l => l.status === 'Active').reduce((s, l) => s + l.commitment, 0);
  const totalCalled  = fundLps.filter(l => l.status === 'Active').reduce((s, l) => s + l.calledAmount, 0);
  const totalUnfund  = fundLps.filter(l => l.status === 'Active').reduce((s, l) => s + getLPUnfunded(l), 0);
  const custodianTrigger = activeCount >= 20 || totalCommit >= 50000000;
  const afsaPending  = fundLps.filter(l => l.ownershipPct > 20 && !l.afsaNotified).length;

  let filtered = fundLps.filter(l => {
    if (lpRegStatus && l.status !== lpRegStatus) return false;
    if (lpRegFilter && !l.name.toLowerCase().includes(lpRegFilter.toLowerCase()) &&
        !l.registerId.toLowerCase().includes(lpRegFilter.toLowerCase())) return false;
    return true;
  });

  el.innerHTML = `
    <!-- AFSA Triggers Alert -->
    ${custodianTrigger ? `
    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:18px;flex-shrink:0"></i>
      <div>
        <div style="font-size:13px;font-weight:700;color:#ef4444">⚠ AFSA Custodian Trigger</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">LP count = ${activeCount} / AUM = ${fmtUSD(totalCommit)} — Обязан назначить независимого Кастодиана в течение 90 дней (Constitution §7.1)</div>
      </div>
    </div>` : ''}
    ${afsaPending > 0 ? `
    <div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <i class="fas fa-bell" style="color:#eab308;font-size:18px;flex-shrink:0"></i>
      <div>
        <div style="font-size:13px;font-weight:700;color:#eab308">AFSA Уведомление требуется</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${afsaPending} LP с долей >20% — уведомление AFSA не отправлено (10 рабочих дней)</div>
      </div>
    </div>` : ''}

    <!-- KPI Row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        { label:'Активных LP', val: activeCount, sub:`${fundLps.length} всего в реестре`, color:'#3b82f6', icon:'fa-users' },
        { label:'Общий Commitment', val: fmtUSD(totalCommit), sub:`Цель: ${fmtUSD(FUND_PARAMS.targetSize*1e6)}`, color:'#22c55e', icon:'fa-dollar-sign' },
        { label:'Вызвано (Called)', val: fmtUSD(totalCalled), sub:`${fmtPctLP(totalCommit?totalCalled/totalCommit*100:0)} от commitment`, color:'#f97316', icon:'fa-coins' },
        { label:'Остаток (Unfunded)', val: fmtUSD(totalUnfund), sub:`Доступно к вызову`, color:'#8b5cf6', icon:'fa-piggy-bank' },
      ].map(k => `
        <div style="background:#1c2333;border-radius:10px;padding:14px 16px;border-top:3px solid ${k.color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:30px;height:30px;background:${k.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <i class="fas ${k.icon}" style="color:${k.color};font-size:13px"></i>
            </div>
            <span style="font-size:11px;color:#8a9bbf;font-weight:700;text-transform:uppercase">${k.label}</span>
          </div>
          <div style="font-size:20px;font-weight:800;color:#f1f5f9;margin-bottom:2px">${k.val}</div>
          <div style="font-size:11px;color:#64748b">${k.sub}</div>
        </div>`).join('')}
    </div>

    <!-- Fund Commitment Bar -->
    <div style="background:#1c2333;border-radius:10px;padding:14px 16px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:12px;font-weight:700;color:#e2e8f0">
          <i class="fas fa-chart-bar" style="color:#3b82f6;margin-right:6px"></i>Capital Call Progress — ${fmtUSD(totalCalled)} из ${fmtUSD(totalCommit)}
        </span>
        <span style="font-size:11px;color:#64748b">${fmtPctLP(totalCommit ? totalCalled/totalCommit*100 : 0)} вызвано</span>
      </div>
      <div style="height:10px;background:#0f1623;border-radius:5px;overflow:hidden">
        <div style="height:100%;width:${totalCommit ? Math.min(100, totalCalled/totalCommit*100) : 0}%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:5px;transition:width 0.5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#64748b">
        <span>$0</span><span>Первое Закрытие: ${fmtUSD(FUND_PARAMS.firstClosingMin*1e6)}</span><span>Цель: ${fmtUSD(FUND_PARAMS.targetSize*1e6)}</span>
      </div>
    </div>

    <!-- Info banner: LP enters register via Onboarding only -->
    <div style="background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:10px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <i class="fas fa-info-circle" style="color:#3b82f6;font-size:15px;flex-shrink:0"></i>
      <div style="font-size:12px;color:#94a3b8;flex:1">
        LP попадает в реестр <b style="color:#e2e8f0">автоматически</b> после завершения онбординга
        (<b style="color:#e2e8f0">Задача 5.1 — LP Activation</b>).
        Прямое добавление в обход KYC/AML не допускается — Constitution §3.1, §8.
      </div>
      <button onclick="navigateTo('ob-clients')"
        style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;flex-shrink:0">
        <i class="fas fa-user-check" style="margin-right:5px"></i>Перейти в Онбординг
      </button>
    </div>

    <!-- Toolbar (search + filter only) -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px">
      <div style="position:relative;flex:1;min-width:200px">
        <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#4a5568;font-size:12px"></i>
        <input type="text" placeholder="Поиск LP..." value="${lpRegFilter}"
          oninput="lpRegFilter=this.value;renderLPRegisterPage()"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px 8px 32px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>
      <select onchange="lpRegStatus=this.value;renderLPRegisterPage()"
        style="background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px">
        <option value="">Все статусы</option>
        <option value="Active"    ${lpRegStatus==='Active'?'selected':''}>✅ Active</option>
        <option value="Exited"    ${lpRegStatus==='Exited'?'selected':''}>🚪 Exited</option>
        <option value="Suspended" ${lpRegStatus==='Suspended'?'selected':''}>⏸ Suspended</option>
      </select>
      <button onclick="renderLPRegisterPage()"
        style="background:#1c2333;border:1px solid #2a3448;color:#94a3b8;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px"
        title="Обновить">
        <i class="fas fa-sync-alt"></i>
      </button>
    </div>

    <!-- LP Register Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-book" style="color:#3b82f6;margin-right:6px"></i>Реестр ограниченных партнёров (LP Register)</span>
        <span style="font-size:12px;color:#8a9bbf">${filtered.length} LP · Constitution §3.8.2 · Хранение 6 лет</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Рег. №</th>
              <th>Наименование LP</th>
              <th>Тип / Страна</th>
              <th>Commitment</th>
              <th>Вызвано</th>
              <th>Unfunded</th>
              <th>% Фонда</th>
              <th>KYC / Риск</th>
              <th>Prof. Client</th>
              <th>Дата вступления</th>
              <th>AFSA</th>
              <th>Статус</th>
              <th style="text-align:center">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="13" style="text-align:center;padding:32px;color:#4a5568"><i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>LP не найдено</td></tr>` :
              filtered.map(lp => {
                const unfunded  = getLPUnfunded(lp);
                const callRate  = getLPCallRate(lp);
                const isAfsaWarn = lp.ownershipPct > 20 && !lp.afsaNotified;
                const kycWarn  = (() => {
                  if (!lp.kycNextReview) return false;
                  const d = new Date(lp.kycNextReview), now = new Date();
                  return (d - now) / 86400000 < 60;
                })();
                return `
                <tr onclick="openLPDetail(${lp.id})" style="cursor:pointer" data-lp-id="${lp.id}">
                  <td style="font-size:11px;color:#8b5cf6;font-weight:700">${lp.registerId}</td>
                  <td>
                    <div style="font-weight:700;color:#e2e8f0;font-size:13px">${lp.name}</div>
                    <div style="font-size:10px;color:${lp.type==='Corporate'?'#3b82f6':'#f97316'}">${lp.lpType||lp.type}</div>
                    ${lp.lpacMember ? '<div style="font-size:9px;color:#8b5cf6;font-weight:700">★ LPAC</div>' : ''}
                    ${lp.saNumber ? `<div style="font-size:10px;color:#64748b">${lp.saNumber}</div>` : ''}
                  </td>
                  <td>
                    <div style="font-size:12px;color:#e2e8f0">${lp.type}</div>
                    <div style="font-size:11px;color:#64748b">${lp.country}</div>
                  </td>
                  <td>
                    <div style="font-size:13px;font-weight:700;color:#22c55e">${fmtUSD(lp.commitment)}</div>
                    <div style="font-size:10px;color:#64748b">Class ${lp.fundClass||'—'}</div>
                  </td>
                  <td>
                    <div style="font-size:12px;font-weight:700;color:#f97316">${fmtUSD(lp.calledAmount)}</div>
                    <div style="width:60px;height:4px;background:#2a3448;border-radius:2px;margin-top:3px">
                      <div style="width:${Math.min(100,callRate)}%;height:4px;background:#f97316;border-radius:2px"></div>
                    </div>
                    <div style="font-size:10px;color:#64748b;margin-top:2px">${fmtPctLP(callRate)}</div>
                  </td>
                  <td style="font-size:13px;font-weight:700;color:#8b5cf6">${fmtUSD(unfunded)}</td>
                  <td>
                    <div style="font-size:13px;font-weight:700;color:${lp.ownershipPct>20?'#ef4444':'#e2e8f0'}">${fmtPctLP(lp.ownershipPct)}</div>
                    ${lp.ownershipPct > 20 ? '<div style="font-size:9px;color:#ef4444">⚠ >20%</div>' : ''}
                  </td>
                  <td>
                    ${kycBadge(lp.kycStatus)}
                    <div style="margin-top:3px">${riskBadge(lp.riskRating)}</div>
                    ${kycWarn ? `<div style="font-size:9px;color:#ef4444;margin-top:2px">⚠ Обновить KYC</div>` : `<div style="font-size:10px;color:#64748b;margin-top:2px">До: ${lp.kycNextReview||'—'}</div>`}
                  </td>
                  <td style="font-size:10px;color:#94a3b8;max-width:120px;white-space:normal">${lp.professionalClient||'—'}</td>
                  <td style="font-size:12px;color:#8a9bbf">${lp.admissionDate||'—'}</td>
                  <td>
                    ${isAfsaWarn
                      ? `<span style="font-size:9px;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.12);padding:2px 6px;border-radius:4px">⚠ Ожидает</span>`
                      : lp.afsaNotified
                        ? `<span style="font-size:9px;color:#22c55e;background:rgba(34,197,94,0.1);padding:2px 6px;border-radius:4px">✓ Уведомлён</span>`
                        : `<span style="font-size:9px;color:#64748b">N/A</span>`}
                  </td>
                  <td>${lpRegStatusBadge(lp.status)}</td>
                  <td style="text-align:center">
                    <button onclick="event.stopPropagation();openLPDetail(${lp.id})"
                      style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-right:4px">
                      <i class="fas fa-eye"></i>
                    </button>
                    <button onclick="event.stopPropagation();openCapitalAccountStatement(${lp.id})"
                      style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;margin-right:4px">
                      <i class="fas fa-file-invoice-dollar"></i>
                    </button>
                    ${lp.lpaUrl ? `<button onclick="event.stopPropagation();_obOpenPreviewModal('${lp.lpaUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${lp.lpaUrl.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')"
                      title="Открыть LP Agreement"
                      style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#c4b5fd;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
                      <i class="fas fa-file-contract"></i>
                    </button>` : ''}
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   LP DETAIL MODAL
═══════════════════════════════════════════════════════════ */

function openLPDetail(lpId) {
  activeLpId = lpId;
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));

  // Build CC history for this LP
  const ccHistory = capitalCallsLog.flatMap(cc =>
    cc.lineItems.filter(li => li.lpId === lpId).map(li => ({ ...li, ccNumber: cc.ccNumber, noticeDate: cc.noticeDate, purpose: cc.purpose, purposeType: cc.purposeType }))
  );

  const totalCalled = ccHistory.reduce((s, li) => s + (li.called||0), 0);
  const totalPaid   = ccHistory.reduce((s, li) => s + (li.paid||0), 0);
  const unfunded    = getLPUnfunded(lp);
  const callRate    = getLPCallRate(lp);

  const modal = document.getElementById('modal-lp-detail');
  const overlay = document.getElementById('lpDetailOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('lpDetailContent').innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #2a3448">
      <div style="width:52px;height:52px;border-radius:14px;background:rgba(59,130,246,0.15);
        display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#3b82f6;flex-shrink:0">
        ${lp.name.slice(0,2).toUpperCase()}
      </div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <span style="font-size:17px;font-weight:800;color:#f1f5f9">${lp.name}</span>
          ${lpRegStatusBadge(lp.status)}
          ${lp.lpacMember ? '<span style="font-size:11px;background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.3);border-radius:6px;padding:2px 8px;font-weight:700">★ LPAC Member</span>' : ''}
          ${lp.afsaNotified ? '<span style="font-size:11px;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.25);border-radius:6px;padding:2px 8px">AFSA ✓</span>' : ''}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#8a9bbf">
          <span style="color:#8b5cf6;font-weight:700">${lp.registerId}</span>
          <span>${lp.type} · ${lp.lpType}</span>
          <span>${lp.country}</span>
          <span>${lp.saNumber||'—'}</span>
        </div>
      </div>
    </div>

    <!-- Capital Account Summary -->
    <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-wallet" style="margin-right:5px"></i>Capital Account — Лицевой счёт LP
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
      ${[
        { label:'Total Commitment', val:fmtUSD(lp.commitment), color:'#22c55e' },
        { label:'Called to Date',   val:fmtUSD(totalPaid),     color:'#f97316' },
        { label:'Unfunded',         val:fmtUSD(unfunded),      color:'#8b5cf6' },
        { label:'Distributions',    val:fmtUSD(lp.distributions||0), color:'#3b82f6' },
      ].map(k => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px;border-left:3px solid ${k.color}">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:4px">${k.label}</div>
          <div style="font-size:16px;font-weight:800;color:${k.color}">${k.val}</div>
        </div>`).join('')}
    </div>
    <!-- Call Rate Bar -->
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:5px">
        <span>Capital Call Rate</span><span>${fmtPctLP(callRate)} вызвано</span>
      </div>
      <div style="height:8px;background:#1e293b;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,callRate)}%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:4px"></div>
      </div>
    </div>

    <!-- Info Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px">
      ${[
        ['Контакт',         lp.contact],
        ['Email',           lp.email],
        ['Tax ID / TIN',    lp.taxId],
        ['Адрес',           lp.address],
        ['KYC Статус',      lp.kycStatus],
        ['Следующий KYC',   lp.kycNextReview],
        ['Риск-рейтинг',    lp.riskRating],
        ['Prof. Client',    lp.professionalClient],
        ['Дата вступления', lp.admissionDate],
        ['Fund Class',      'Class ' + (lp.fundClass||'—')],
        ['Доля в фонде',    fmtPctLP(lp.ownershipPct)],
        ['AFSA (>20%)',     lp.ownershipPct > 20 ? (lp.afsaNotified ? '✅ Уведомлён' : '⚠ Ожидает') : 'N/A'],
        ['Contract №',      lp.contractNum || '—'],
      ].map(([k,v]) => `
        <div style="background:#0f1623;border-radius:8px;padding:8px 12px">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">${k}</div>
          <div style="font-size:12px;color:#e2e8f0;font-weight:600">${v||'—'}</div>
        </div>`).join('')}
    ${lp.lpaUrl ? `
    <div style="background:#0f1623;border-radius:8px;padding:8px 12px;margin-top:4px;display:flex;align-items:center;gap:10px;border-left:3px solid #8b5cf6">
      <div style="flex:1">
        <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">LP Agreement (LPA)</div>
        <div style="font-size:11px;color:#a78bfa;word-break:break-all;font-weight:600">${lp.lpaUrl.length > 55 ? lp.lpaUrl.slice(0,55)+'…' : lp.lpaUrl}</div>
      </div>
      <button onclick="event.stopPropagation();_obOpenPreviewModal('${lp.lpaUrl}','${lp.lpaUrl}')"
        style="background:rgba(139,92,246,0.18);border:1px solid rgba(139,92,246,0.4);color:#c4b5fd;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap;flex-shrink:0">
        <i class="fas fa-file-contract" style="margin-right:4px"></i>Открыть LPA
      </button>
    </div>` : ''}
    </div>

    <!-- Capital Call History for this LP -->
    <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-history" style="margin-right:5px"></i>История Capital Calls (${ccHistory.length})
    </div>
    ${ccHistory.length === 0 ? `<div style="padding:20px;text-align:center;color:#4a5568;font-size:12px"><i class="fas fa-inbox" style="margin-right:5px"></i>Capital Calls не найдено</div>` : `
    <div style="margin-bottom:18px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="font-size:10px;font-weight:700;color:#5a6b8a;text-transform:uppercase">
            <th style="padding:6px 8px;text-align:left">CC №</th>
            <th style="padding:6px 8px;text-align:left">Дата уведомл.</th>
            <th style="padding:6px 8px;text-align:left">Цель</th>
            <th style="padding:6px 8px;text-align:right">Вызвано</th>
            <th style="padding:6px 8px;text-align:right">Оплачено</th>
            <th style="padding:6px 8px;text-align:center">AML</th>
            <th style="padding:6px 8px;text-align:center">Статус</th>
          </tr>
        </thead>
        <tbody>
          ${ccHistory.map(li => `
            <tr style="border-top:1px solid #1e293b">
              <td style="padding:7px 8px;font-size:11px;font-weight:700;color:#8b5cf6">${li.ccNumber}</td>
              <td style="padding:7px 8px;font-size:11px;color:#94a3b8">${li.noticeDate}</td>
              <td style="padding:7px 8px;font-size:11px;color:#e2e8f0;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${li.purpose}</td>
              <td style="padding:7px 8px;font-size:12px;font-weight:700;color:#f97316;text-align:right">${fmtUSD(li.called)}</td>
              <td style="padding:7px 8px;font-size:12px;font-weight:700;color:${li.paid===li.called?'#22c55e':'#ef4444'};text-align:right">${fmtUSD(li.paid)}</td>
              <td style="padding:7px 8px;text-align:center">
                ${li.amlOk === true ? '<i class="fas fa-check-circle" style="color:#22c55e;font-size:12px" title="AML OK"></i>'
                : li.amlOk === false ? '<i class="fas fa-exclamation-circle" style="color:#ef4444;font-size:12px" title="AML Flag"></i>'
                : '<i class="fas fa-clock" style="color:#94a3b8;font-size:12px" title="Ожидает"></i>'}
              </td>
              <td style="padding:7px 8px;text-align:center">${ccStatusBadge(li.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`}

    ${lp.notes ? `<div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#94a3b8;border-left:3px solid #3b82f6"><i class="fas fa-sticky-note" style="margin-right:6px;color:#3b82f6"></i>${lp.notes}</div>` : ''}

    <!-- Footer actions -->
    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a3448">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="openCapitalAccountStatement(${lp.id})"
          style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-file-invoice-dollar"></i> Capital Account Statement
        </button>
        <button onclick="generateLPWelcomeLetter(${lp.id})"
          style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-envelope-open-text"></i> Welcome Letter
        </button>
        ${lp.lpaUrl ? `<button onclick="event.stopPropagation();_obOpenPreviewModal('${lp.lpaUrl}','${lp.lpaUrl}')"
          style="background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.3);color:#c4b5fd;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-file-contract"></i> Открыть LPA
        </button>` : ''}
        ${lp.ownershipPct > 20 && !lp.afsaNotified ? `
        <button onclick="markAfsaNotified(${lp.id})"
          style="background:rgba(234,179,8,0.12);border:1px solid rgba(234,179,8,0.3);color:#eab308;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700">
          <i class="fas fa-bell"></i> Отметить AFSA уведомлён
        </button>` : ''}
      </div>
      <button onclick="closeLPDetail()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        Закрыть
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function closeLPDetail() {
  const modal   = document.getElementById('modal-lp-detail');
  const overlay = document.getElementById('lpDetailOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

function markAfsaNotified(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  lp.afsaNotified = true;
  showToast(`✅ AFSA уведомлён — ${lp.name} (${lp.registerId})`, 'green');
  openLPDetail(lpId);
  renderLPRegisterPage();
}

/* ═══════════════════════════════════════════════════════════
   CAPITAL ACCOUNT STATEMENT MODAL
═══════════════════════════════════════════════════════════ */

function openCapitalAccountStatement(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));

  // Build full call history
  const ccHistory = capitalCallsLog.flatMap(cc =>
    cc.lineItems.filter(li => li.lpId === lpId).map(li => ({
      ...li,
      ccNumber: cc.ccNumber,
      noticeDate: cc.noticeDate,
      paymentDateActual: li.paymentDate,
      purpose: cc.purpose,
      purposeType: cc.purposeType,
    }))
  );

  const totalCalled   = ccHistory.reduce((s, li) => s + (li.called||0), 0);
  const totalPaid     = ccHistory.reduce((s, li) => s + (li.paid||0), 0);
  const unfunded      = Math.max(0, lp.commitment - totalPaid);
  const distributions = lp.distributions || 0;
  const navPerUnit    = 1.0; // placeholder — would come from valuation module
  const statementDate = today();

  const modal = document.getElementById('modal-capital-statement');
  const overlay = document.getElementById('capitalStatementOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('capitalStatementContent').innerHTML = `
    <!-- Statement Header -->
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #2a3448">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Capital Account Statement</div>
      <div style="font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:4px">Turan Capital Fund LP</div>
      <div style="font-size:12px;color:#8a9bbf">Golden Leaves Ltd · GP · AFSA-A-LA-2024-0038</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px">Дата выписки: <b>${statementDate}</b></div>
    </div>

    <!-- LP Identity -->
    <div style="background:#0f1623;border-radius:10px;padding:14px 16px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${[
          ['Наименование LP', lp.name],
          ['Рег. № LP',       lp.registerId],
          ['Тип',             `${lp.type} · ${lp.lpType}`],
          ['Fund Class',      'Class ' + (lp.fundClass||'—')],
          ['SA №',            lp.saNumber||'—'],
          ['Дата вступления', lp.admissionDate||'—'],
          ['Доля в фонде',    fmtPctLP(lp.ownershipPct)],
          ['Tax ID / TIN',    lp.taxId||'—'],
        ].map(([k,v]) => `
          <div>
            <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">${k}</div>
            <div style="font-size:12px;color:#e2e8f0;font-weight:600">${v||'—'}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Account Summary Table -->
    <div style="font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-table" style="margin-right:5px"></i>Сводка лицевого счёта
    </div>
    <div style="background:#0f1623;border-radius:10px;overflow:hidden;margin-bottom:18px">
      ${[
        { label:'Total Capital Commitment',       val:fmtUSD(lp.commitment),       color:'#e2e8f0', bold:false },
        { label:'Capital Called to Date',         val:fmtUSD(totalPaid),            color:'#f97316', bold:true  },
        { label:'Unfunded Commitment (Remaining)',val:fmtUSD(unfunded),             color:'#8b5cf6', bold:true  },
        { label:'Distributions Received to Date', val:fmtUSD(distributions),        color:'#22c55e', bold:false },
        { label:'NAV per Unit (последняя оценка)',val:'$1.00 (2024-12-31)',          color:'#3b82f6', bold:false },
        { label:'Fund Term Remaining',            val:`${10 - FUND_PARAMS.currentYear} лет`, color:'#eab308', bold:false },
      ].map((row, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;${i%2===0?'background:#0f1623':'background:#131c2e'};border-bottom:1px solid #1e293b">
          <span style="font-size:12px;color:#94a3b8">${row.label}</span>
          <span style="font-size:${row.bold?'14':'13'}px;font-weight:${row.bold?'800':'600'};color:${row.color}">${row.val}</span>
        </div>`).join('')}
    </div>

    <!-- Call Rate Visual -->
    <div style="background:#1c2333;border-radius:10px;padding:14px 16px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:8px">
        <span><i class="fas fa-coins" style="color:#f97316;margin-right:4px"></i>Capital Call Progress</span>
        <span>${fmtPctLP(lp.commitment ? totalPaid/lp.commitment*100 : 0)} от Commitment</span>
      </div>
      <div style="height:12px;background:#0f1623;border-radius:6px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;width:${lp.commitment ? Math.min(100, totalPaid/lp.commitment*100) : 0}%;background:linear-gradient(90deg,#f97316,#eab308);border-radius:6px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#4a5568">
        <span>${fmtUSD(totalPaid)} вызвано</span>
        <span>${fmtUSD(unfunded)} остаток</span>
      </div>
    </div>

    <!-- Detailed Transaction Log -->
    <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-list" style="margin-right:5px"></i>Транзакционный журнал Capital Calls
    </div>
    ${ccHistory.length === 0 ? `<div style="padding:20px;text-align:center;color:#4a5568;font-size:12px">Транзакций нет</div>` : `
    <div style="margin-bottom:18px;border-radius:10px;overflow:hidden;border:1px solid #2a3448">
      <table style="width:100%;border-collapse:collapse">
        <thead style="background:#131c2e">
          <tr style="font-size:10px;font-weight:700;color:#5a6b8a;text-transform:uppercase">
            <th style="padding:8px 10px;text-align:left">CC №</th>
            <th style="padding:8px 10px;text-align:left">Дата уведомл.</th>
            <th style="padding:8px 10px;text-align:left">Дата платежа</th>
            <th style="padding:8px 10px;text-align:left">Цель</th>
            <th style="padding:8px 10px;text-align:right">Вызвано</th>
            <th style="padding:8px 10px;text-align:right">Оплачено</th>
            <th style="padding:8px 10px;text-align:center">Wire Ref</th>
            <th style="padding:8px 10px;text-align:center">AML</th>
            <th style="padding:8px 10px;text-align:center">Статус</th>
          </tr>
        </thead>
        <tbody>
          ${ccHistory.map((li, i) => `
            <tr style="border-top:1px solid #1e293b;${i%2===0?'':'background:rgba(255,255,255,0.01)'}">
              <td style="padding:8px 10px;font-size:11px;font-weight:700;color:#8b5cf6">${li.ccNumber}</td>
              <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${li.noticeDate}</td>
              <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${li.paymentDateActual||'—'}</td>
              <td style="padding:8px 10px;font-size:11px;color:#e2e8f0">${li.purpose}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#f97316;text-align:right">${fmtUSD(li.called)}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:${li.paid===li.called?'#22c55e':'#ef4444'};text-align:right">${fmtUSD(li.paid)}</td>
              <td style="padding:8px 10px;font-size:10px;color:#64748b;text-align:center">${li.wireRef||'—'}</td>
              <td style="padding:8px 10px;text-align:center">
                ${li.amlOk===true ? '<i class="fas fa-check-circle" style="color:#22c55e"></i>'
                : li.amlOk===false ? '<i class="fas fa-exclamation-circle" style="color:#ef4444"></i>'
                : '<i class="fas fa-clock" style="color:#94a3b8"></i>'}
              </td>
              <td style="padding:8px 10px;text-align:center">${ccStatusBadge(li.status)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot style="background:#131c2e">
          <tr>
            <td colspan="4" style="padding:8px 10px;font-size:11px;font-weight:700;color:#8a9bbf">ИТОГО</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#f97316;text-align:right">${fmtUSD(totalCalled)}</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#22c55e;text-align:right">${fmtUSD(totalPaid)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>
      </table>
    </div>`}

    <!-- ── ИТОГОВАЯ СТРОКА ── -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px">
      ${[
        { icon:'fa-coins',        label:'Вызвано (Called)',       val:fmtUSD(totalCalled), color:'#f97316' },
        { icon:'fa-check-circle', label:'Оплачено (Paid)',        val:fmtUSD(totalPaid),   color:'#22c55e' },
        { icon:'fa-hourglass-half',label:'Не оплачено',           val:fmtUSD(Math.max(0, totalCalled - totalPaid)), color: totalCalled > totalPaid ? '#ef4444' : '#22c55e' },
        { icon:'fa-wallet',       label:'Остаток Commitment',     val:fmtUSD(unfunded),    color:'#8b5cf6' },
      ].map(k => `
        <div style="background:#0f1623;border-radius:9px;padding:10px 12px;text-align:center">
          <div style="font-size:18px;margin-bottom:4px;color:${k.color}"><i class="fas ${k.icon}"></i></div>
          <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:3px">${k.label}</div>
          <div style="font-size:13px;font-weight:800;color:${k.color}">${k.val}</div>
        </div>`).join('')}
    </div>

    <!-- Legal Note -->
    <div style="background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:10px 14px;font-size:10px;color:#64748b;margin-bottom:16px">
      <i class="fas fa-info-circle" style="color:#3b82f6;margin-right:6px"></i>
      Выписка подготовлена: ${statementDate} · Golden Leaves Ltd (GP) · Turan Capital Fund LP · AFSA-A-LA-2024-0038 ·
      Конфиденциально. Только для авторизованных получателей. Хранение: 6 лет (Constitution §8.5).
    </div>

    <!-- Footer -->
    <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid #2a3448;flex-wrap:wrap">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="closeCapitalAccountStatement()"
          style="background:#1c2333;border:1px solid #2a3448;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">
          Закрыть
        </button>
        ${totalCalled > totalPaid ? `
        <button onclick="closeCapitalAccountStatement();setTimeout(()=>openIndividualCCModal(${lpId}),200)"
          title="LP имеет задолженность ${fmtUSD(totalCalled - totalPaid)} — создать Individual Capital Call"
          style="background:linear-gradient(135deg,#f97316,#dc2626);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
          <i class="fas fa-plus" style="margin-right:6px"></i>Доп. CC
          <span style="background:rgba(255,255,255,0.2);border-radius:5px;padding:1px 7px;font-size:11px;margin-left:4px">${fmtUSD(totalCalled - totalPaid)}</span>
        </button>` : unfunded > 0 ? `
        <button onclick="closeCapitalAccountStatement();setTimeout(()=>openIndividualCCModal(${lpId}),200)"
          title="Создать Individual Capital Call — Unfunded: ${fmtUSD(unfunded)}"
          style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.35);color:#fb923c;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
          <i class="fas fa-plus" style="margin-right:6px"></i>Доп. CC
        </button>` : ''}
      </div>
      <button onclick="printCapitalAccountStatement(${lpId})"
        style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-file-pdf" style="margin-right:6px"></i>Скачать PDF
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function closeCapitalAccountStatement() {
  const modal   = document.getElementById('modal-capital-statement');
  const overlay = document.getElementById('capitalStatementOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

/* ═══════════════════════════════════════════════════════════
   LP WELCOME LETTER — Admission Notification (print → PDF)
═══════════════════════════════════════════════════════════ */
function generateLPWelcomeLetter(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));
  const fp  = FUND_PARAMS;
  const dt  = today();
  const letterNum = 'GL-' + new Date().getFullYear() + '-LP-' + String(lp.id).padStart(3,'0');

  const docStyle = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #111; padding: 40px 60px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1a365d; padding-bottom:14px; margin-bottom:28px; }
  .logo-block { }
  .logo-name { font-size:16pt; font-weight:700; color:#1a365d; letter-spacing:0.5px; }
  .logo-sub  { font-size:9pt; color:#4a5568; margin-top:2px; }
  .ref-block { text-align:right; font-size:9.5pt; color:#4a5568; }
  .ref-block b { color:#111; }
  h1 { font-size:14pt; font-weight:700; color:#1a365d; text-transform:uppercase; letter-spacing:0.5px; text-align:center; margin:24px 0 20px; }
  .salutation { margin-bottom:14px; font-size:11pt; }
  p { margin-bottom:10px; line-height:1.6; text-align:justify; }
  .key-terms { width:100%; border-collapse:collapse; margin:18px 0; }
  .key-terms th { background:#1a365d; color:#fff; padding:7px 12px; font-size:10pt; text-align:left; }
  .key-terms td { padding:7px 12px; font-size:10.5pt; border-bottom:1px solid #e2e8f0; }
  .key-terms tr:nth-child(even) td { background:#f8fafc; }
  .key-terms td:first-child { font-weight:600; color:#2d3748; width:42%; }
  .obligations { background:#f0fff4; border-left:4px solid #38a169; padding:12px 16px; margin:16px 0; }
  .obligations ul { padding-left:20px; }
  .obligations li { margin-bottom:5px; font-size:10.5pt; line-height:1.55; }
  .signature-block { margin-top:40px; display:flex; justify-content:space-between; }
  .sig-col { width:45%; }
  .sig-line { border-top:1px solid #333; margin-top:48px; padding-top:5px; font-size:10pt; }
  .footer { margin-top:36px; padding-top:10px; border-top:1px solid #cbd5e0; font-size:8.5pt; color:#718096; text-align:center; }
  @media print { body { padding:20px 40px; } }
  `;

  const body = `
  <div class="header">
    <div class="logo-block">
      <div class="logo-name">${fp.gp}</div>
      <div class="logo-sub">General Partner · ${fp.name}</div>
      <div class="logo-sub">AFSA License: ${fp.license}</div>
    </div>
    <div class="ref-block">
      <div><b>Ref:</b> ${letterNum}</div>
      <div><b>Date:</b> ${dt}</div>
      <div><b>Confidential</b></div>
    </div>
  </div>

  <p>
    <b>${lp.contact || lp.name}</b><br>
    ${lp.address ? lp.address + '<br>' : ''}
    ${lp.email ? lp.email : ''}
  </p>

  <h1>Notice of Admission as Limited Partner<br>
  <span style="font-size:11pt;font-weight:400;text-transform:none">(Уведомление о принятии в качестве Ограниченного Партнёра)</span></h1>

  <p class="salutation">Dear ${lp.contact || lp.name},</p>

  <p>We are pleased to confirm that <b>${fp.gp}</b>, acting as General Partner of <b>${fp.name}</b> (the <b>"Fund"</b>), has formally admitted you as a <b>Limited Partner</b> of the Fund, effective <b>${lp.admissionDate || dt}</b>, pursuant to the terms of the Limited Partnership Agreement and your executed Subscription Agreement.</p>

  <p>Your participation in the Fund is subject to the Constitution of the Fund, the Limited Partnership Agreement (LPA), and all applicable regulations of the Astana International Financial Centre (AIFC).</p>

  <table class="key-terms">
    <thead><tr><th colspan="2">Key Terms of Your LP Interest / Ключевые условия участия</th></tr></thead>
    <tbody>
      <tr><td>LP Register №</td><td><b>${lp.registerId}</b></td></tr>
      <tr><td>Subscription Agreement №</td><td>${lp.saNumber || '—'}</td></tr>
      <tr><td>Fund Class / Класс паёв</td><td>Class ${lp.fundClass || '—'}</td></tr>
      <tr><td>Total Commitment / Обязательство</td><td><b>${fmtUSD(lp.commitment)}</b></td></tr>
      <tr><td>Ownership Interest / Доля</td><td>${fmtPctLP(lp.ownershipPct)}</td></tr>
      <tr><td>Admission Date / Дата вступления</td><td>${lp.admissionDate || dt}</td></tr>
      <tr><td>Management Fee / Вознаграждение</td><td>${fp.managementFee}% p.a. of AUM (${fp.managementFeeFreq})</td></tr>
      <tr><td>Preferred Return / Hurdle Rate</td><td>${fp.preferredReturn}% per annum</td></tr>
      <tr><td>Carried Interest</td><td>${fp.carriedInterest}% (after Preferred Return)</td></tr>
      <tr><td>Fund Term / Срок фонда</td><td>${fp.fundTerm} years + up to ${fp.extensionYears}×1-year extensions</td></tr>
      <tr><td>Lock-in Period</td><td>${fp.lockInPeriod} years</td></tr>
      <tr><td>Early Exit Fee</td><td>${fp.earlyExitFeeMin}%–${fp.earlyExitFeeMax}% of Commitment</td></tr>
      <tr><td>KYC Status</td><td>${lp.kycStatus} · Next Review: ${lp.kycNextReview || '—'}</td></tr>
      <tr><td>Professional Client Status</td><td>${lp.professionalClient || '—'}</td></tr>
    </tbody>
  </table>

  <div class="obligations">
    <b>Your Key Obligations as Limited Partner:</b>
    <ul>
      <li>Fund Capital Calls within <b>10 business days</b> of receiving a Capital Call Notice (Constitution §3.9.1)</li>
      <li>Maintain up-to-date KYC documentation; next scheduled review: <b>${lp.kycNextReview || '—'}</b></li>
      <li>Notify the GP of any material change in beneficial ownership, tax residency, or PEP status within 5 business days</li>
      <li>Keep all Fund information strictly confidential (LPA §14)</li>
      ${lp.lpacMember ? '<li><b>LPAC Membership:</b> You are invited to participate in the Limited Partners Advisory Committee (Commitment ≥ $3M)</li>' : ''}
    </ul>
  </div>

  <p>Please retain this letter and your copy of the LPA${lp.lpaUrl ? ` (available at: <u>${lp.lpaUrl}</u>)` : ''} for your records. All future Capital Call Notices, financial statements, and LP reports will be sent to the contact details provided in your Subscription Agreement.</p>

  <p>Should you have any questions, please contact your Relationship Manager or the Compliance Officer at <b>${fp.gp}</b>.</p>

  <p>We welcome you as a valued partner in <b>${fp.name}</b> and look forward to a successful long-term relationship.</p>

  <p>Yours sincerely,</p>

  <div class="signature-block">
    <div class="sig-col">
      <div class="sig-line">
        <div>${fp.gpCEO}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gpTitle}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gp} (General Partner)</div>
      </div>
    </div>
    <div class="sig-col">
      <div class="sig-line">
        <div>_______________________</div>
        <div style="color:#4a5568;font-size:9.5pt">Compliance Officer / MLRO</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gp}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    ${fp.gp} · ${fp.gpAddress} · BIN: ${fp.gpBIN} · AFSA: ${fp.license} ·
    Bank: ${fp.gpBankName} · BIC: ${fp.gpBIC} · IBAN USD: ${fp.gpIBANusd}<br>
    CONFIDENTIAL — For authorised recipient only. Retention: 6 years (Constitution §8.5)
  </div>

  `;

  const win = openPrintableDocument(body, {
    title: `LP Admission Letter — ${lp.name}`,
    features: 'width=900,height=700',
    extraStyle: docStyle,
  });
  if (win) showToast(`📧 Welcome Letter для ${lp.name} сформирован`, 'green');
}

/* ═══════════════════════════════════════════════════════════
   CAPITAL CALL NOTICE — per-LP notice letter (print → PDF)
═══════════════════════════════════════════════════════════ */
function generateCCNotice(ccId, lpId) {
  const cc = capitalCallsLog.find(c => c.id === ccId);
  if (!cc) return;
  const li = cc.lineItems.find(l => l.lpId === lpId);
  if (!li) return;
  const lp = lpRegister.find(l => l.id === lpId);
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(cc));
  const fp = FUND_PARAMS;
  const noticeNum = cc.ccNumber + '-' + String(lpId).padStart(3,'0');
  const payDue    = cc.paymentDate || '—';

  const docStyle = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Times New Roman', serif; font-size:11pt; color:#111; padding:40px 60px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #92400e; padding-bottom:14px; margin-bottom:28px; }
  .logo-name { font-size:15pt; font-weight:700; color:#92400e; }
  .logo-sub  { font-size:9pt; color:#4a5568; margin-top:2px; }
  .ref-block { text-align:right; font-size:9.5pt; color:#4a5568; }
  h1 { font-size:13pt; font-weight:700; color:#92400e; text-transform:uppercase; text-align:center; margin:22px 0 18px; }
  p  { margin-bottom:10px; line-height:1.6; text-align:justify; }
  .alert-box { background:#fffbeb; border:2px solid #f59e0b; border-radius:6px; padding:14px 18px; margin:18px 0; }
  .alert-box .amount { font-size:22pt; font-weight:800; color:#b45309; text-align:center; margin:8px 0 4px; }
  .alert-box .due    { font-size:11pt; text-align:center; color:#92400e; font-weight:600; }
  .terms-table { width:100%; border-collapse:collapse; margin:16px 0; }
  .terms-table th { background:#92400e; color:#fff; padding:7px 12px; font-size:10pt; text-align:left; }
  .terms-table td { padding:7px 12px; border-bottom:1px solid #e2e8f0; font-size:10.5pt; }
  .terms-table tr:nth-child(even) td { background:#fef3c7; }
  .terms-table td:first-child { font-weight:600; color:#2d3748; width:44%; }
  .bank-box { background:#f0f9ff; border-left:4px solid #0369a1; padding:12px 16px; margin:16px 0; }
  .bank-box h3 { font-size:10.5pt; font-weight:700; color:#0369a1; margin-bottom:8px; }
  .bank-row { display:flex; justify-content:space-between; font-size:10pt; margin-bottom:4px; }
  .bank-row span:first-child { color:#4a5568; min-width:160px; }
  .bank-row span:last-child  { font-weight:600; color:#111; }
  .warn { background:#fff1f2; border-left:4px solid #e11d48; padding:10px 14px; margin:14px 0; font-size:10.5pt; }
  .signature-block { margin-top:36px; display:flex; justify-content:space-between; }
  .sig-col { width:45%; }
  .sig-line { border-top:1px solid #333; margin-top:44px; padding-top:5px; font-size:10pt; }
  .footer { margin-top:32px; padding-top:10px; border-top:1px solid #cbd5e0; font-size:8.5pt; color:#718096; text-align:center; }
  `;

  const body = `
  <div class="header">
    <div>
      <div class="logo-name">${fp.gp}</div>
      <div class="logo-sub">General Partner · ${fp.name}</div>
      <div class="logo-sub">AFSA: ${fp.license}</div>
    </div>
    <div class="ref-block">
      <div><b>Notice Ref:</b> ${noticeNum}</div>
      <div><b>Issue Date:</b> ${cc.noticeDate}</div>
      <div><b>STRICTLY CONFIDENTIAL</b></div>
    </div>
  </div>

  <p>
    <b>${lp ? (lp.contact || lp.name) : li.lpName}</b><br>
    ${lp && lp.address ? lp.address + '<br>' : ''}
    ${lp && lp.email ? lp.email : ''}
  </p>

  <h1>Capital Call Notice № ${cc.ccNumber}<br>
  <span style="font-size:10pt;font-weight:400;text-transform:none">(Уведомление о Capital Call)</span></h1>

  <p>Dear ${lp ? (lp.contact || lp.name) : li.lpName},</p>

  <p>Pursuant to Section 3.9 of the <b>${fp.name}</b> Constitution and your Subscription Agreement, <b>${fp.gp}</b>, as General Partner, hereby issues this Capital Call Notice requiring your pro-rata contribution to the Fund.</p>

  <div class="alert-box">
    <div style="text-align:center;font-size:10.5pt;color:#92400e;font-weight:600;margin-bottom:4px">YOUR REQUIRED CONTRIBUTION / СУММА К ПЕРЕЧИСЛЕНИЮ</div>
    <div class="amount">${fmtUSD(li.called)}</div>
    <div class="due">⏰ Payment Due: <b>${payDue}</b> (10 business days from notice date)</div>
  </div>

  <table class="terms-table">
    <thead><tr><th colspan="2">Capital Call Details / Детали Capital Call</th></tr></thead>
    <tbody>
      <tr><td>Capital Call №</td><td><b>${cc.ccNumber}</b></td></tr>
      <tr><td>Notice Date / Дата уведомления</td><td>${cc.noticeDate}</td></tr>
      <tr><td>Payment Due Date / Срок оплаты</td><td><b style="color:#b45309">${payDue}</b></td></tr>
      <tr><td>Purpose / Цель</td><td>${cc.purpose}</td></tr>
      <tr><td>Type</td><td>${cc.purposeType || '—'}${cc.managementFee ? ' · Management Fee' : ''}</td></tr>
      <tr><td>Your Total Commitment</td><td>${fmtUSD(li.commitment)}</td></tr>
      <tr><td>Call % of Commitment</td><td>${li.pct}%</td></tr>
      <tr><td><b>Your Required Amount</b></td><td><b style="font-size:12pt;color:#b45309">${fmtUSD(li.called)}</b></td></tr>
      <tr><td>Fund Class</td><td>${lp ? 'Class ' + (lp.fundClass || '—') : '—'}</td></tr>
      <tr><td>Your LP Register №</td><td>${lp ? lp.registerId : '—'}</td></tr>
      ${cc.bankRef ? `<tr><td>Fund Bank Reference</td><td><b>${cc.bankRef}</b></td></tr>` : ''}
      ${cc.notes   ? `<tr><td>Notes</td><td>${cc.notes}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="bank-box">
    <h3>🏦 Wire Transfer Instructions / Реквизиты для перечисления</h3>
    <div class="bank-row"><span>Beneficiary / Получатель:</span><span>${fp.gp} — ${fp.name}</span></div>
    <div class="bank-row"><span>Bank / Банк:</span><span>${fp.gpBankName}</span></div>
    <div class="bank-row"><span>BIC / SWIFT:</span><span>${fp.gpBIC}</span></div>
    <div class="bank-row"><span>IBAN (USD):</span><span>${fp.gpIBANusd}</span></div>
    <div class="bank-row"><span>IBAN (KZT):</span><span>${fp.gpIBANkzt}</span></div>
    <div class="bank-row"><span>BIN:</span><span>${fp.gpBIN}</span></div>
    <div class="bank-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed #bae6fd"><span><b>Payment Reference:</b></span><span><b>${cc.ccNumber}-${lp ? lp.registerId : li.lpName.replace(/\s/g,'-').slice(0,12)}</b></span></div>
  </div>

  <div class="warn">
    <b>⚠ Important:</b> Failure to fund within 10 business days may result in default penalties as outlined in the LPA and Constitution §3.9.3. Please ensure your wire reference exactly matches the Payment Reference above to enable correct allocation.
  </div>

  <p>Please confirm receipt of this notice by contacting your Relationship Manager. Upon receipt of funds, a payment confirmation will be issued.</p>

  <div class="signature-block">
    <div class="sig-col">
      <div class="sig-line">
        <div>${fp.gpCEO}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gpTitle}</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gp} (General Partner)</div>
      </div>
    </div>
    <div class="sig-col">
      <div class="sig-line">
        <div>_______________________</div>
        <div style="color:#4a5568;font-size:9.5pt">CFO / Finance Officer</div>
        <div style="color:#4a5568;font-size:9.5pt">${fp.gp}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    ${fp.gp} · ${fp.gpAddress} · BIN: ${fp.gpBIN} · AFSA: ${fp.license}<br>
    STRICTLY CONFIDENTIAL — For authorised recipient only. Retention: 6 years (Constitution §8.5)
  </div>

  `;

  const win = openPrintableDocument(body, {
    title: `Capital Call Notice — ${cc.ccNumber} — ${li.lpName}`,
    features: 'width=900,height=700',
    extraStyle: docStyle,
  });
  if (win) showToast(`📨 Capital Call Notice ${cc.ccNumber} для ${li.lpName} сформирован`, 'green');
}

/* ═══════════════════════════════════════════════════════════
   CAPITAL ACCOUNT STATEMENT — PDF print button
   (Adds print capability to existing statement modal)
═══════════════════════════════════════════════════════════ */
function printCapitalAccountStatement(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));
  const fp  = FUND_PARAMS;
  const dt  = today();

  /* ── Build full call history ── */
  const ccHistory = capitalCallsLog.flatMap(cc =>
    cc.lineItems.filter(li => li.lpId === lpId).map(li => ({
      ...li,
      ccNumber:          cc.ccNumber,
      noticeDate:        cc.noticeDate,
      paymentDateActual: li.paymentDate,
      purpose:           cc.purpose,
      ccStatus:          cc.status,
    }))
  );

  /* ── Financials ── */
  const totalCalled = ccHistory.reduce((s, li) => s + (li.called || 0), 0);
  const totalPaid   = ccHistory.reduce((s, li) => s + (li.paid   || 0), 0);
  const unfunded    = Math.max(0, lp.commitment - totalPaid);
  const callRate    = lp.commitment ? totalPaid / lp.commitment * 100 : 0;
  const distributions = lp.distributions || 0;
  const navPerUnit  = 1.00; // placeholder — valuation module
  const fundYears   = fp.fundTerm || 10;
  const startYear   = 2024;
  const yearsPassed = new Date().getFullYear() - startYear;
  const termRemain  = Math.max(0, fundYears - yearsPassed);

  /* ── Risk badge label ── */
  const riskLabel = lp.riskRating === 'High'   ? '⚠ High'
                  : lp.riskRating === 'Medium' ? '● Medium'
                  : '✓ Low';

  /* ── AML cell helper ── */
  const amlCell = (v) => v === true  ? '✓ Pass'
                       : v === false ? '✗ Fail'
                       : '— Pending';

  /* ── Status label ── */
  const liStatusLabel = (s) => s === 'Paid' ? '✓ Paid' : s === 'Pending' ? '○ Pending' : s || '—';

  /* ── Transaction rows HTML ── */
  const rowsHTML = ccHistory.length === 0
    ? `<tr><td colspan="9" style="text-align:center;padding:16px;color:#718096;font-style:italic">Транзакций нет</td></tr>`
    : ccHistory.map((li, i) => `
      <tr style="${i % 2 === 0 ? '' : 'background:#f7fafc'}">
        <td style="font-weight:700;color:#2b4591">${li.ccNumber}</td>
        <td>${li.noticeDate}</td>
        <td>${li.paymentDateActual || '—'}</td>
        <td>${li.purpose}</td>
        <td style="text-align:right;font-weight:700;color:#c05621">${fmtUSD(li.called)}</td>
        <td style="text-align:right;font-weight:700;color:${li.paid === li.called ? '#276749' : li.paid > 0 ? '#b7791f' : '#c53030'}">${fmtUSD(li.paid)}</td>
        <td style="text-align:center;font-size:9pt;color:#4a5568">${li.wireRef || '—'}</td>
        <td style="text-align:center;font-size:9pt;color:${li.amlOk === true ? '#276749' : li.amlOk === false ? '#c53030' : '#718096'};font-weight:600">${amlCell(li.amlOk)}</td>
        <td style="text-align:center;font-size:9pt;font-weight:600;color:${li.status === 'Paid' ? '#276749' : '#c05621'}">${liStatusLabel(li.status)}</td>
      </tr>`).join('');

  const docStyle = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size:10pt; color:#111; padding:32px 48px; }

  /* ── Header ── */
  .hdr { display:flex; justify-content:space-between; align-items:flex-start;
         border-bottom:3px solid #1a365d; padding-bottom:12px; margin-bottom:22px; }
  .hdr-left .gp-name  { font-size:14pt; font-weight:700; color:#1a365d; }
  .hdr-left .gp-sub   { font-size:8.5pt; color:#4a5568; margin-top:2px; }
  .hdr-right          { text-align:right; font-size:9pt; color:#4a5568; line-height:1.7; }
  .hdr-right b        { color:#1a365d; }
  .confidential       { display:inline-block; background:#fff0f0; border:1px solid #fc8181;
                        color:#c53030; font-weight:700; font-size:8pt; padding:1px 7px;
                        border-radius:3px; letter-spacing:0.5px; margin-top:2px; }

  /* ── Title ── */
  h1 { font-size:12pt; font-weight:700; color:#1a365d; text-align:center;
       text-transform:uppercase; letter-spacing:0.8px; margin:0 0 18px; }
  .doc-id { text-align:center; font-size:9pt; color:#718096; margin-bottom:20px; }

  /* ── Section header ── */
  .sec-title { font-size:9pt; font-weight:700; color:#1a365d; text-transform:uppercase;
               letter-spacing:0.5px; border-left:3px solid #1a365d; padding-left:8px;
               margin:20px 0 10px; }

  /* ── LP Identity grid ── */
  .id-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0;
             border:1px solid #cbd5e0; border-radius:6px; overflow:hidden; margin-bottom:6px; }
  .id-cell { padding:8px 12px; border-right:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; }
  .id-cell:nth-child(3n) { border-right:none; }
  .id-cell label { font-size:7.5pt; color:#718096; text-transform:uppercase; font-weight:700;
                   display:block; margin-bottom:2px; }
  .id-cell span  { font-size:10pt; font-weight:600; color:#1a202c; }
  .id-cell.full  { grid-column:1/-1; }

  /* ── Account summary ── */
  .sum-table { width:100%; border-collapse:collapse; }
  .sum-table tr { border-bottom:1px solid #e2e8f0; }
  .sum-table tr:last-child { border-bottom:none; }
  .sum-table td { padding:9px 12px; font-size:10pt; }
  .sum-table .lbl { color:#4a5568; }
  .sum-table .val { text-align:right; font-weight:700; }
  .sum-table tr.total-row td { background:#ebf4ff; font-size:10.5pt; }

  /* ── Progress bar ── */
  .pbar-wrap { margin:10px 0 4px; }
  .pbar-bg   { height:11px; background:#e2e8f0; border-radius:6px; overflow:hidden; }
  .pbar-fill { height:100%; border-radius:6px;
               background:linear-gradient(90deg,#c05621 0%,#d97706 60%,#38a169 100%); }
  .pbar-labels { display:flex; justify-content:space-between; font-size:8pt; color:#718096; margin-top:3px; }

  /* ── KYC / Compliance ── */
  .kyc-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0;
              border:1px solid #c3dafe; border-radius:6px; overflow:hidden; }
  .kyc-cell { padding:8px 12px; background:#ebf4ff; border-right:1px solid #c3dafe;
              border-bottom:1px solid #c3dafe; }
  .kyc-cell:nth-child(3n) { border-right:none; }
  .kyc-cell label { font-size:7.5pt; color:#4a5568; text-transform:uppercase; font-weight:700;
                    display:block; margin-bottom:2px; }
  .kyc-cell span  { font-size:10pt; font-weight:600; color:#1a202c; }

  /* ── Transaction table ── */
  .tx-table { width:100%; border-collapse:collapse; font-size:9pt; }
  .tx-table thead tr { background:#1a365d; color:#fff; }
  .tx-table th { padding:7px 9px; text-align:left; font-size:8.5pt; font-weight:700; white-space:nowrap; }
  .tx-table td { padding:7px 9px; border-bottom:1px solid #e2e8f0; }
  .tx-table tbody tr:nth-child(even) td { background:#f7fafc; }
  .tx-table tfoot td { background:#ebf4ff; font-weight:700; font-size:9.5pt; }
  .tx-table .no-data { text-align:center; color:#718096; font-style:italic; padding:16px; }

  /* ── Signature block ── */
  .sig-wrap { display:flex; justify-content:space-between; margin-top:36px; }
  .sig-col { width:44%; }
  .sig-line { border-top:1px solid #333; margin-top:52px; padding-top:5px;
              font-size:9pt; color:#4a5568; }
  .sig-name { font-size:10pt; font-weight:700; color:#1a202c; margin-top:2px; }

  /* ── Legal & footer ── */
  .legal { background:#f8fafc; border:1px solid #cbd5e0; border-radius:5px;
           padding:10px 14px; font-size:8pt; color:#718096; margin-top:20px; line-height:1.55; }
  .doc-footer { margin-top:14px; padding-top:10px; border-top:1px solid #cbd5e0;
                font-size:7.5pt; color:#a0aec0; text-align:center; line-height:1.6; }

  @media print {
    body   { padding:14px 28px; }
  }
  `;

  const body = `
  <!-- ══════════════════ HEADER ══════════════════ -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="gp-name">${fp.gp}</div>
      <div class="gp-sub">General Partner · ${fp.name}</div>
      <div class="gp-sub">AFSA License: ${fp.license}</div>
      <div class="gp-sub">${fp.gpAddress}</div>
    </div>
    <div class="hdr-right">
      <div><b>Дата выписки:</b> ${dt}</div>
      <div><b>LP Register №:</b> ${lp.registerId}</div>
      <div><b>SA №:</b> ${lp.saNumber || '—'}</div>
      <div><b>Fund Class:</b> Class ${lp.fundClass || '—'}</div>
      <div class="confidential">CONFIDENTIAL</div>
    </div>
  </div>

  <h1>Сводка лицевого счёта LP<br>Capital Account Statement</h1>
  <div class="doc-id">Документ № CAS-${lp.registerId}-${dt.replace(/-/g,'')} · Подготовлен: ${fp.gpCEO} (${fp.gpTitle || 'CEO'})</div>

  <!-- ══════════════════ 1. LP IDENTITY ══════════════════ -->
  <div class="sec-title">1. Идентификация инвестора (LP Profile)</div>
  <div class="id-grid">
    <div class="id-cell full">
      <label>Полное наименование / Full Name</label>
      <span style="font-size:11pt;color:#1a365d">${lp.name}</span>
    </div>
    <div class="id-cell"><label>Тип</label><span>${lp.type}</span></div>
    <div class="id-cell"><label>Категория LP</label><span>${lp.lpType || '—'}</span></div>
    <div class="id-cell"><label>Страна</label><span>${lp.country || '—'}</span></div>
    <div class="id-cell full"><label>Адрес / Address</label><span>${lp.address || '—'}</span></div>
    <div class="id-cell"><label>ИИН / БИН / TIN</label><span>${lp.taxId || '—'}</span></div>
    <div class="id-cell"><label>Контактное лицо</label><span>${lp.contact || '—'}</span></div>
    <div class="id-cell"><label>Телефон</label><span>${lp.phone || '—'}</span></div>
    <div class="id-cell full"><label>Email</label><span>${lp.email || '—'}</span></div>
    <div class="id-cell"><label>Professional Client</label><span>${lp.professionalClient || '—'}</span></div>
    <div class="id-cell"><label>Дата вступления</label><span>${lp.admissionDate || '—'}</span></div>
    <div class="id-cell"><label>Доля в фонде</label><span>${fmtPctLP(lp.ownershipPct)}</span></div>
  </div>

  <!-- ══════════════════ 2. ACCOUNT SUMMARY ══════════════════ -->
  <div class="sec-title">2. Сводка лицевого счёта (Account Summary)</div>
  <table class="sum-table" style="border:1px solid #cbd5e0;border-radius:6px;overflow:hidden">
    <tbody>
      <tr>
        <td class="lbl">Total Capital Commitment</td>
        <td class="val" style="color:#1a365d;font-size:11pt">${fmtUSD(lp.commitment)}</td>
      </tr>
      <tr>
        <td class="lbl">Capital Called to Date</td>
        <td class="val" style="color:#c05621">${fmtUSD(totalCalled)}</td>
      </tr>
      <tr>
        <td class="lbl">Capital Paid to Date</td>
        <td class="val" style="color:#c05621">${fmtUSD(totalPaid)}</td>
      </tr>
      <tr>
        <td class="lbl">Unfunded Commitment (остаток)</td>
        <td class="val" style="color:#6b46c1">${fmtUSD(unfunded)}</td>
      </tr>
      <tr>
        <td class="lbl">Distributions Received to Date</td>
        <td class="val" style="color:#276749">${fmtUSD(distributions)}</td>
      </tr>
      <tr>
        <td class="lbl">NAV per Unit (последняя оценка)</td>
        <td class="val" style="color:#2b6cb0">$${navPerUnit.toFixed(2)} <span style="font-size:8.5pt;font-weight:400;color:#718096">(${startYear}-12-31)</span></td>
      </tr>
      <tr>
        <td class="lbl">Capital Call Rate</td>
        <td class="val" style="color:#c05621">${fmtPctLP(callRate)}</td>
      </tr>
      <tr>
        <td class="lbl">Fund Term Remaining</td>
        <td class="val" style="color:#b7791f">${termRemain} лет (из ${fundYears})</td>
      </tr>
      <tr class="total-row">
        <td class="lbl" style="font-weight:700;color:#1a365d">Net Position (Paid − Distributions)</td>
        <td class="val" style="color:${totalPaid - distributions >= 0 ? '#c05621' : '#276749'}">${fmtUSD(totalPaid - distributions)}</td>
      </tr>
    </tbody>
  </table>

  <!-- Progress bar -->
  <div class="pbar-wrap">
    <div class="pbar-bg">
      <div class="pbar-fill" style="width:${Math.min(100, callRate)}%"></div>
    </div>
    <div class="pbar-labels">
      <span>0%</span>
      <span style="font-weight:700;color:#c05621">${fmtPctLP(callRate)} вызвано · ${fmtUSD(totalPaid)}</span>
      <span>${fmtUSD(unfunded)} остаток · 100%</span>
    </div>
  </div>

  <!-- ══════════════════ 3. KYC / COMPLIANCE ══════════════════ -->
  <div class="sec-title">3. KYC / AML / Compliance</div>
  <div class="kyc-grid">
    <div class="kyc-cell">
      <label>KYC Status</label>
      <span style="color:${lp.kycStatus==='Одобрен'?'#276749':'#c05621'}">${lp.kycStatus || '—'}</span>
    </div>
    <div class="kyc-cell">
      <label>Дата KYC</label>
      <span>${lp.kycDate || '—'}</span>
    </div>
    <div class="kyc-cell">
      <label>Следующий KYC Review</label>
      <span>${lp.kycNextReview || '—'}</span>
    </div>
    <div class="kyc-cell">
      <label>Risk Rating</label>
      <span style="color:${lp.riskRating==='High'?'#c53030':lp.riskRating==='Medium'?'#b7791f':'#276749'}">${riskLabel}</span>
    </div>
    <div class="kyc-cell">
      <label>AFSA Уведомление (&gt;20%)</label>
      <span>${lp.afsaNotified ? '✓ Уведомлён' : '— Не требуется'}</span>
    </div>
    <div class="kyc-cell">
      <label>LPAC Member</label>
      <span>${lp.lpacMember ? '✓ Участник LPAC' : '— Не участник'}</span>
    </div>
  </div>

  <!-- ══════════════════ 4. TRANSACTION LOG ══════════════════ -->
  <div class="sec-title page-break">4. Транзакционный журнал Capital Calls</div>
  <table class="tx-table">
    <thead>
      <tr>
        <th>CC №</th>
        <th>Дата уведомл.</th>
        <th>Дата платежа</th>
        <th>Назначение / Purpose</th>
        <th style="text-align:right">Вызвано (Called)</th>
        <th style="text-align:right">Оплачено (Paid)</th>
        <th style="text-align:center">Wire Ref</th>
        <th style="text-align:center">AML</th>
        <th style="text-align:center">Статус</th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="padding:8px 9px">ИТОГО / TOTAL</td>
        <td style="text-align:right;color:#c05621;padding:8px 9px">${fmtUSD(totalCalled)}</td>
        <td style="text-align:right;color:#276749;padding:8px 9px">${fmtUSD(totalPaid)}</td>
        <td colspan="3" style="padding:8px 9px;font-size:9pt;color:#718096;text-align:center">
          ${ccHistory.filter(l => l.amlOk===true).length} из ${ccHistory.length} AML ✓
        </td>
      </tr>
    </tfoot>
  </table>

  <!-- ══════════════════ 5. SIGNATURE ══════════════════ -->
  <div class="sig-wrap">
    <div class="sig-col">
      <div class="sig-line">Подпись / Signature</div>
      <div class="sig-name">${fp.gpCEO}</div>
      <div style="font-size:9pt;color:#4a5568">${fp.gpTitle || 'Chief Executive Officer'}</div>
      <div style="font-size:9pt;color:#4a5568">${fp.gp}</div>
    </div>
    <div class="sig-col">
      <div class="sig-line">Печать / Stamp</div>
      <div style="height:52px;border:1px dashed #cbd5e0;border-radius:50%;width:100px;margin-top:0;
                  display:flex;align-items:center;justify-content:center;color:#a0aec0;font-size:8pt;text-align:center;line-height:1.3">
        M.P.<br>Печать
      </div>
    </div>
  </div>

  <!-- ══════════════════ LEGAL & FOOTER ══════════════════ -->
  <div class="legal">
    <b>Legal Notice / Юридическое уведомление:</b> Настоящая выписка подготовлена по состоянию на ${dt}
    компанией <b>${fp.gp}</b> как General Partner фонда <b>${fp.name}</b>.
    Все суммы указаны в долларах США (USD), если не указано иное. Документ является строго конфиденциальным
    и предназначен исключительно для поимённого Limited Partner. Воспроизведение, распространение или
    передача третьим лицам без письменного согласия GP запрещены.
    Срок хранения: 6 лет (Constitution §8.5).
    По вопросам обращаться: <b>${fp.gpCEO}</b> · ${fp.gp} · ${fp.gpAddress}
  </div>

  <div class="doc-footer">
    ${fp.gp} · BIN: ${fp.gpBIN} · Банк: ${fp.gpBankName} · BIC: ${fp.gpBIC} ·
    IBAN USD: ${fp.gpIBANusd} · IBAN KZT: ${fp.gpIBANkzt}<br>
    AFSA License: ${fp.license} · Документ сформирован автоматически CRM-системой · ${dt}
  </div>

  `;

  const win = openPrintableDocument(body, {
    title: `Capital Account Statement — ${lp.name}`,
    features: 'width=1020,height=820',
    extraStyle: docStyle,
  });
  if (win) showToast(`📊 Capital Account Statement для ${lp.name} открыт`, 'green');
}

/* ═══════════════════════════════════════════════════════════
   ADD NEW LP (simple modal form)
═══════════════════════════════════════════════════════════ */

/** Удалена ручная форма добавления LP.
 *  LP попадает в реестр автоматически через:
 *  Онбординг (FM) → Задача 5.1 LP Activation → registerLPFromOnboarding()
 *  Навигация: navigateTo('ob-clients')
 */
function openNewLPModal() {
  showToast('LP добавляется через Онбординг → Задача 5.1 (LP Activation)', 'blue');
  navigateTo('ob-clients');
}

function closeNewLPModal() {
  const modal   = document.getElementById('modal-lp-new');
  const overlay = document.getElementById('lpNewOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}
/** saveNewLP — отключена, LP регистрируется через onboarding activation */

function saveNewLP_DISABLED() {
  const name       = document.getElementById('lp_name')?.value?.trim();
  const commitment = parseFloat(document.getElementById('lp_commitment')?.value);
  if (!name) { showToast('⚠ Укажите наименование LP', 'red'); return; }
  if (!commitment || commitment < 500000) { showToast('⚠ Минимальный Commitment $500,000', 'red'); return; }

  const totalCommit = getTotalCommitments(activeFundId);
  if (totalCommit + commitment > FUND_PARAMS.targetSize * 1e6) {
    showToast('⚠ Превышает целевой размер фонда $' + FUND_PARAMS.targetSize + 'M', 'red'); return;
  }

  const seq  = String(lpRegisterIdCounter).padStart(3,'0');
  const year = new Date().getFullYear();
  const riskRating = document.getElementById('lp_risk')?.value || 'Low';
  const kycNextMap = { Low: 24, Medium: 12, High: 6 };
  const kycDate = today();
  const kycNext = new Date(kycDate);
  kycNext.setMonth(kycNext.getMonth() + (kycNextMap[riskRating] || 24));

  const totalNew   = totalCommit + commitment;
  const ownershipPct = totalNew > 0 ? commitment / totalNew * 100 : 0;

  const newLP = {
    id:               lpRegisterIdCounter++,
    registerId:       `LP-${year}-${seq}`,
    name,
    type:             document.getElementById('lp_type')?.value || 'Corporate',
    lpType:           document.getElementById('lp_lpType')?.value || 'Institution',
    country:          document.getElementById('lp_country')?.value || '',
    address:          document.getElementById('lp_address')?.value || '',
    taxId:            document.getElementById('lp_taxId')?.value || '',
    contact:          document.getElementById('lp_contact')?.value || '',
    email:            document.getElementById('lp_email')?.value || '',
    phone:            '',
    commitment,
    calledAmount:     0,
    paidAmount:       0,
    distributions:    0,
    fundClass:        document.getElementById('lp_fundClass')?.value || 'A',
    ownershipPct:     parseFloat(ownershipPct.toFixed(2)),
    professionalClient: document.getElementById('lp_profClient')?.value || 'Assessed Professional Client',
    kycStatus:        document.getElementById('lp_kycStatus')?.value || 'В процессе',
    kycDate,
    kycNextReview:    kycNext.toISOString().slice(0,10),
    riskRating,
    admissionDate:    document.getElementById('lp_admDate')?.value || today(),
    saNumber:         document.getElementById('lp_saNum')?.value || '',
    afsaNotified:     false,
    lpacMember:       commitment >= 3000000,
    status:           'Active',
    exitDate:         null,
    notes:            document.getElementById('lp_notes')?.value || '',
    obClientId:       null,
  };

  lpRegister.push(newLP);

  // Recalculate ownership %s for all LP
  recalcOwnershipPcts(activeFundId);

  closeNewLPModal();
  showToast(`✅ LP ${newLP.registerId} добавлен в реестр`, 'green');
  if (newLP.ownershipPct > 20) {
    showToast(`⚠ ${name} — доля >20%. Требуется уведомление AFSA (10 р.д.)`, 'yellow');
  }
  renderLPRegisterPage();
}

// fundId required — ownership % is only meaningful relative to LPs of the
// SAME fund. This was previously unscoped (recalculated every LP in every
// fund off one grand total), which would have silently corrupted other
// funds' ownership percentages the moment a second fund existed.
function recalcOwnershipPcts(fundId) {
  const totalC = getTotalCommitments(fundId);
  if (!totalC) return;
  lpRegister.filter(lp => lp.fundId === fundId).forEach(lp => {
    lp.ownershipPct = parseFloat((lp.commitment / totalC * 100).toFixed(2));
  });
}

/* ═══════════════════════════════════════════════════════════
   CAPITAL CALLS PAGE (full module)
═══════════════════════════════════════════════════════════ */

let ccFilter = '';     // search
let ccStatusF = '';    // status filter
let activeCCId = null;

function renderCapitalCallsPage() {
  const el = document.getElementById('capitalCallsContent');
  if (!el) return;

  const fundScoped = typeof activeFundId !== 'undefined' && activeFundId != null;
  const fundCCs = fundScoped ? capitalCallsLog.filter(cc => cc.fundId === activeFundId) : capitalCallsLog;
  const totalCommit  = (fundScoped ? lpRegister.filter(l => l.fundId === activeFundId) : lpRegister)
    .filter(l => l.status === 'Active').reduce((s, l) => s + l.commitment, 0);
  const totalCalled  = fundCCs.reduce((s, cc) => s + cc.lineItems.reduce((ss, li) => ss + (li.paid||0), 0), 0);
  const pendingCCs   = fundCCs.filter(cc => cc.status === 'Pending').length;
  const overdueCCs   = fundCCs.filter(cc => {
    if (cc.status !== 'Pending') return false;
    return new Date(cc.paymentDate) < new Date();
  }).length;
  const totalMgmtFee = fundCCs.filter(cc => cc.managementFee)
    .reduce((s, cc) => s + cc.totalAmount, 0);
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));

  let filtered = fundCCs.filter(cc => {
    if (ccStatusF && cc.status !== ccStatusF) return false;
    if (ccFilter && !cc.ccNumber.toLowerCase().includes(ccFilter.toLowerCase()) &&
        !cc.purpose.toLowerCase().includes(ccFilter.toLowerCase())) return false;
    return true;
  }).sort((a,b) => new Date(b.noticeDate) - new Date(a.noticeDate));

  el.innerHTML = `
    <!-- Overdue Alert -->
    ${overdueCCs > 0 ? `
    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <i class="fas fa-exclamation-triangle" style="color:#ef4444;font-size:18px;flex-shrink:0"></i>
      <div>
        <div style="font-size:13px;font-weight:700;color:#ef4444">⚠ ${overdueCCs} Просроченный Capital Call</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">Дата платежа прошла — проверьте поступления</div>
      </div>
    </div>` : ''}

    <!-- KPI Row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      ${[
        { label:'Capital Calls (всего)', val: fundCCs.length,    sub:`${pendingCCs} ожидают оплаты`,  color:'#3b82f6', icon:'fa-coins'           },
        { label:'Всего вызвано',         val: fmtUSD(totalCalled),        sub:`из ${fmtUSD(totalCommit)}`,     color:'#22c55e', icon:'fa-arrow-up'         },
        { label:'Management Fee',        val: fmtUSD(totalMgmtFee),       sub:`2% p.a. от AUM (полугодовые)`, color:'#f97316', icon:'fa-percentage'       },
        { label:'Просроченных',          val: overdueCCs,                  sub:`требуют проверки`,             color: overdueCCs>0?'#ef4444':'#22c55e', icon:'fa-clock' },
      ].map(k => `
        <div style="background:#1c2333;border-radius:10px;padding:14px 16px;border-top:3px solid ${k.color}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <div style="width:30px;height:30px;background:${k.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <i class="fas ${k.icon}" style="color:${k.color};font-size:13px"></i>
            </div>
            <span style="font-size:11px;color:#8a9bbf;font-weight:700;text-transform:uppercase">${k.label}</span>
          </div>
          <div style="font-size:20px;font-weight:800;color:#f1f5f9;margin-bottom:2px">${k.val}</div>
          <div style="font-size:11px;color:#64748b">${k.sub}</div>
        </div>`).join('')}
    </div>

    <!-- Toolbar -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px">
      <div style="position:relative;flex:1;min-width:180px">
        <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#4a5568;font-size:12px"></i>
        <input type="text" placeholder="Поиск Capital Call..." value="${ccFilter}"
          oninput="ccFilter=this.value;renderCapitalCallsPage()"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px 8px 32px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
      </div>
      <select onchange="ccStatusF=this.value;renderCapitalCallsPage()"
        style="background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px">
        <option value="">Все статусы</option>
        <option value="Completed" ${ccStatusF==='Completed'?'selected':''}>✅ Completed</option>
        <option value="Pending"   ${ccStatusF==='Pending'?'selected':''}>⏳ Pending</option>
        <option value="Overdue"   ${ccStatusF==='Overdue'?'selected':''}>🔴 Overdue</option>
        <option value="Draft"     ${ccStatusF==='Draft'?'selected':''}>📝 Draft</option>
      </select>

    </div>

    <!-- Capital Calls Table -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-coins" style="color:#f97316;margin-right:6px"></i>Журнал Capital Calls</span>
        <span style="font-size:12px;color:#8a9bbf">${filtered.length} записей · Constitution §3.9.1 · 10 рабочих дней уведомление</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>CC №</th>
              <th>Дата уведомления</th>
              <th>Дата платежа</th>
              <th>Сумма</th>
              <th>% от Commit</th>
              <th>Цель</th>
              <th>Тип</th>
              <th>Получено</th>
              <th>Не оплачено</th>
              <th>Статус</th>
              <th style="text-align:center">LP</th>
              <th style="text-align:center">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `<tr><td colspan="12" style="text-align:center;padding:32px;color:#4a5568">Capital Calls не найдено</td></tr>` :
              filtered.map(cc => {
                const received = cc.lineItems.reduce((s, li) => s + (li.paid||0), 0);
                const expected = cc.totalAmount;
                const unpaid   = Math.max(0, expected - received);
                const isOverdue = cc.status === 'Pending' && new Date(cc.paymentDate) < new Date();
                const displayStatus = isOverdue ? 'Overdue' : cc.status;
                return `
                <tr onclick="openCCDetail(${cc.id})" style="cursor:pointer">
                  <td style="font-size:11px;color:#f97316;font-weight:700">${cc.ccNumber}</td>
                  <td style="font-size:12px;color:#94a3b8">${cc.noticeDate}</td>
                  <td style="font-size:12px;color:${isOverdue?'#ef4444':'#94a3b8'};font-weight:${isOverdue?'700':'400'}">
                    ${cc.paymentDate}${isOverdue ? ' <i class="fas fa-exclamation-circle" style="color:#ef4444"></i>' : ''}
                  </td>
                  <td style="font-size:13px;font-weight:700;color:#22c55e">${fmtUSD(cc.totalAmount)}</td>
                  <td style="font-size:12px;color:#e2e8f0">${cc.pctOfCommit}%</td>
                  <td style="font-size:11px;color:#e2e8f0;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${cc.purpose}</td>
                  <td>
                    <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${cc.managementFee?'rgba(234,179,8,0.12)':'rgba(59,130,246,0.12)'};color:${cc.managementFee?'#eab308':'#3b82f6'}">
                      ${cc.managementFee ? 'Mgmt Fee' : 'Investment'}
                    </span>
                    ${cc.lineItems.length === 1 ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:5px;background:rgba(249,115,22,0.15);color:#fb923c;margin-left:4px">IND</span>` : ''}
                  </td>
                  <td style="font-size:12px;font-weight:700;color:${received===expected?'#22c55e':'#f97316'}">${fmtUSD(received)}</td>
                  <td style="font-size:12px;font-weight:700;color:${unpaid>0?'#ef4444':'#22c55e'}">${unpaid>0?fmtUSD(unpaid):'✓'}</td>
                  <td>${ccStatusBadge(displayStatus)}</td>
                  <td style="text-align:center">
                    <div style="display:flex;flex-direction:column;gap:2px;align-items:center">
                      <div style="font-size:11px;font-weight:700;color:#e2e8f0">${cc.lineItems.length} LP</div>
                      <div style="font-size:10px;color:${cc.lineItems.filter(li=>li.status==='Paid').length===cc.lineItems.length?'#22c55e':'#f97316'}">
                        ${cc.lineItems.filter(li=>li.status==='Paid').length}/${cc.lineItems.length} оплатили
                      </div>
                    </div>
                  </td>
                  <td style="text-align:center">
                    <button onclick="event.stopPropagation();openCCDetail(${cc.id})"
                      style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:#fb923c;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700">
                      <i class="fas fa-list-ul"></i>
                    </button>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#0f1623;border-top:2px solid #2a3448">
              <td colspan="3" style="padding:10px 12px;font-size:11px;font-weight:700;color:#8a9bbf;text-transform:uppercase">ИТОГО по журналу</td>
              <td style="padding:10px 12px;font-size:14px;font-weight:800;color:#22c55e">${fmtUSD(filtered.reduce((s,c)=>s+c.totalAmount,0))}</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b">—</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b">${filtered.length} CC</td>
              <td style="padding:10px 12px"></td>
              <td style="padding:10px 12px;font-size:14px;font-weight:800;color:#22c55e">${fmtUSD(filtered.reduce((s,c)=>s+c.lineItems.reduce((ss,li)=>ss+(li.paid||0),0),0))}</td>
              <td style="padding:10px 12px;font-size:14px;font-weight:800;color:${filtered.reduce((s,c)=>s+Math.max(0,c.totalAmount-c.lineItems.reduce((ss,li)=>ss+(li.paid||0),0)),0)>0?'#ef4444':'#22c55e'}">${(()=>{const u=filtered.reduce((s,c)=>s+Math.max(0,c.totalAmount-c.lineItems.reduce((ss,li)=>ss+(li.paid||0),0)),0);return u>0?fmtUSD(u):'✓ Все оплатили';})()}</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b">${filtered.filter(c=>c.status==='Completed').length} / ${filtered.length} закрыто</td>
              <td style="padding:10px 12px;font-size:11px;color:#64748b;text-align:center">${filtered.reduce((s,c)=>s+c.lineItems.length,0)} LP-строк</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Unfunded Commitment Summary Table -->
    ${renderUnfundedSummaryTable()}`;
}

/* ── Unfunded Commitment Summary ──────────────────────── */
function renderUnfundedSummaryTable() {
  const totalC = getTotalCommitments(activeFundId);
  const totalCalled = getTotalCalled(activeFundId);
  const totalUF = getTotalUnfunded(activeFundId);
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));

  return `
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-piggy-bank" style="color:#8b5cf6;margin-right:6px"></i>Unfunded Commitment — Остаток к вызову</span>
        <span style="font-size:12px;color:#8a9bbf">Итого: ${fmtUSD(totalUF)} · ${fmtPctLP(totalC ? totalUF/totalC*100 : 0)} от общего Commitment</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Рег. №</th>
              <th>LP</th>
              <th>Fund Class</th>
              <th>Total Commitment</th>
              <th>Called</th>
              <th>Paid</th>
              <th>Unfunded</th>
              <th>Call Rate</th>
              <th>Доля %</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            ${lpRegister.filter(lp => lp.status === 'Active' && lp.fundId === activeFundId).map(lp => {
              const unfunded = getLPUnfunded(lp);
              const callRate = getLPCallRate(lp);
              return `
              <tr onclick="openLPDetail(${lp.id})" style="cursor:pointer">
                <td style="font-size:11px;color:#8b5cf6;font-weight:700">${lp.registerId}</td>
                <td>
                  <div style="font-weight:700;color:#e2e8f0;font-size:13px">${lp.name}</div>
                  <div style="font-size:10px;color:#64748b">${lp.type} · ${lp.country}</div>
                </td>
                <td style="font-size:12px;color:#e2e8f0;text-align:center">Class ${lp.fundClass||'—'}</td>
                <td style="font-size:13px;font-weight:700;color:#22c55e">${fmtUSD(lp.commitment)}</td>
                <td style="font-size:12px;font-weight:700;color:#f97316">${fmtUSD(lp.calledAmount)}</td>
                <td style="font-size:12px;font-weight:700;color:${lp.paidAmount===lp.calledAmount?'#22c55e':'#ef4444'}">${fmtUSD(lp.paidAmount||lp.calledAmount)}</td>
                <td style="font-size:13px;font-weight:700;color:${unfunded>0?'#8b5cf6':'#22c55e'}">${unfunded>0?fmtUSD(unfunded):'✓ Fully Called'}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:6px;background:#1e293b;border-radius:3px;overflow:hidden;min-width:60px">
                      <div style="height:100%;width:${Math.min(100,callRate)}%;background:${callRate>=100?'#22c55e':'#f97316'};border-radius:3px"></div>
                    </div>
                    <span style="font-size:11px;font-weight:700;color:${callRate>=100?'#22c55e':'#f97316'}">${fmtPctLP(callRate)}</span>
                  </div>
                </td>
                <td style="font-size:12px;font-weight:700;color:${lp.ownershipPct>20?'#ef4444':'#e2e8f0'}">${fmtPctLP(lp.ownershipPct)}</td>
                <td>${lpRegStatusBadge(lp.status)}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#131c2e">
              <td colspan="3" style="padding:10px 12px;font-size:12px;font-weight:700;color:#8a9bbf">ИТОГО (Active LP)</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#22c55e">${fmtUSD(totalC)}</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#f97316">${fmtUSD(totalCalled)}</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#22c55e">${fmtUSD(totalCalled)}</td>
              <td style="padding:10px 12px;font-size:13px;font-weight:800;color:#8b5cf6">${fmtUSD(totalUF)}</td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   CAPITAL CALL DETAIL MODAL
═══════════════════════════════════════════════════════════ */

function openCCDetail(ccId) {
  const cc = capitalCallsLog.find(c => c.id === ccId);
  if (!cc) return;
  activeCCId = ccId;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(cc));

  const received = cc.lineItems.reduce((s, li) => s + (li.paid||0), 0);
  const unpaid   = Math.max(0, cc.totalAmount - received);
  const isOverdue = cc.status === 'Pending' && new Date(cc.paymentDate) < new Date();

  const modal   = document.getElementById('modal-cc-detail');
  const overlay = document.getElementById('ccDetailOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('ccDetailContent').innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #2a3448">
      <div style="width:46px;height:46px;background:rgba(249,115,22,0.15);border-radius:12px;display:flex;align-items:center;justify-content:center">
        <i class="fas fa-coins" style="color:#f97316;font-size:18px"></i>
      </div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:17px;font-weight:800;color:#f1f5f9">${cc.ccNumber}</span>
          ${ccStatusBadge(isOverdue?'Overdue':cc.status)}
          ${cc.managementFee ? '<span style="font-size:11px;background:rgba(234,179,8,0.12);color:#eab308;border:1px solid rgba(234,179,8,0.3);border-radius:6px;padding:2px 8px;font-weight:700">Management Fee</span>' : ''}
          ${cc.lineItems.length === 1 ? '<span style="font-size:11px;background:rgba(249,115,22,0.15);color:#fb923c;border:1px solid rgba(249,115,22,0.35);border-radius:6px;padding:2px 8px;font-weight:700"><i class="fas fa-user" style="margin-right:3px"></i>Individual LP</span>' : ''}
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">${cc.purpose}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:800;color:#22c55e">${fmtUSD(cc.totalAmount)}</div>
        <div style="font-size:11px;color:#64748b">${cc.pctOfCommit}% от Commitment</div>
      </div>
    </div>

    <!-- Summary Row -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
      ${[
        { label:'Дата уведомления',   val:cc.noticeDate,    color:'#94a3b8' },
        { label:'Дата платежа (+ 10 р.д.)', val:cc.paymentDate, color: isOverdue?'#ef4444':'#22c55e' },
        { label:'Bank Reference',      val:cc.bankRef||'—',  color:'#8b5cf6' },
        { label:'Получено',            val:fmtUSD(received), color:'#22c55e' },
        { label:'Не оплачено',         val:unpaid>0?fmtUSD(unpaid):'✓ Все оплатили', color:unpaid>0?'#ef4444':'#22c55e' },
        { label:'Создал',              val:cc.createdBy||'CFO', color:'#94a3b8' },
      ].map(k => `
        <div style="background:#0f1623;border-radius:8px;padding:8px 12px">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:2px">${k.label}</div>
          <div style="font-size:12px;font-weight:700;color:${k.color}">${k.val}</div>
        </div>`).join('')}
    </div>

    <!-- LP Line Items -->
    <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:10px">
      <i class="fas fa-users" style="margin-right:5px"></i>Pro-Rata по LP (${cc.lineItems.length} участников)
    </div>
    <div style="border-radius:10px;overflow:hidden;border:1px solid #2a3448;margin-bottom:16px">
      <table style="width:100%;border-collapse:collapse">
        <thead style="background:#131c2e">
          <tr style="font-size:10px;font-weight:700;color:#5a6b8a;text-transform:uppercase">
            <th style="padding:8px 10px;text-align:left">LP</th>
            <th style="padding:8px 10px;text-align:right">Commitment</th>
            <th style="padding:8px 10px;text-align:right">К оплате (${cc.pctOfCommit}%)</th>
            <th style="padding:8px 10px;text-align:right">Оплачено</th>
            <th style="padding:8px 10px;text-align:left">Дата платежа</th>
            <th style="padding:8px 10px;text-align:left">Wire Ref</th>
            <th style="padding:8px 10px;text-align:center">AML ✓</th>
            <th style="padding:8px 10px;text-align:center">Статус</th>
            <th style="padding:8px 10px;text-align:center">Notice</th>
          </tr>
        </thead>
        <tbody>
          ${cc.lineItems.map((li, i) => `
            <tr style="border-top:1px solid #1e293b;${i%2===0?'':'background:rgba(255,255,255,0.01)'}">
              <td style="padding:8px 10px">
                <div style="font-size:12px;font-weight:700;color:#e2e8f0">${li.lpName}</div>
                <div style="font-size:10px;color:#64748b">LP-ID: ${li.lpId}</div>
              </td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#22c55e;text-align:right">${fmtUSD(li.commitment)}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:#f97316;text-align:right">${fmtUSD(li.called)}</td>
              <td style="padding:8px 10px;font-size:12px;font-weight:700;color:${li.paid===li.called?'#22c55e':li.paid>0?'#eab308':'#ef4444'};text-align:right">${fmtUSD(li.paid)}</td>
              <td style="padding:8px 10px;font-size:11px;color:#94a3b8">${li.paymentDate||'—'}</td>
              <td style="padding:8px 10px;font-size:10px;color:#64748b">${li.wireRef||'—'}</td>
              <td style="padding:8px 10px;text-align:center">
                ${li.amlOk===true ? '<i class="fas fa-check-circle" style="color:#22c55e;font-size:14px" title="AML подтверждён"></i>'
                : li.amlOk===false ? '<i class="fas fa-exclamation-circle" style="color:#ef4444;font-size:14px" title="AML Flag"></i>'
                : `<i class="fas fa-clock" style="color:#64748b;font-size:14px;cursor:pointer" onclick="markLpAmlOk(${ccId}, ${li.lpId})" title="AML ещё не подтверждён — нажмите, чтобы подтвердить"></i>`}
              </td>
              <td style="padding:8px 10px;text-align:center">
                ${li.status==='Pending' && cc.status!=='Completed' ? `
                  <button onclick="markLPPayment(${ccId}, ${li.lpId})"
                    style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700">
                    Получено ✓
                  </button>` : ccStatusBadge(li.status)}
              </td>
              <td style="padding:8px 10px;text-align:center">
                <button onclick="generateCCNotice(${ccId}, ${li.lpId})"
                  title="Сформировать Capital Call Notice для ${li.lpName}"
                  style="background:rgba(139,92,246,0.13);border:1px solid rgba(139,92,246,0.35);color:#a78bfa;padding:3px 9px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap">
                  <i class="fas fa-paper-plane" style="margin-right:3px"></i>Notice
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
        <tfoot style="background:#131c2e">
          <tr>
            <td colspan="2" style="padding:8px 10px;font-size:11px;font-weight:700;color:#8a9bbf">ИТОГО</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#f97316;text-align:right">${fmtUSD(cc.totalAmount)}</td>
            <td style="padding:8px 10px;font-size:13px;font-weight:800;color:#22c55e;text-align:right">${fmtUSD(received)}</td>
            <td colspan="5"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${cc.notes ? `<div style="background:#1c2333;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:#94a3b8;border-left:3px solid #f97316"><i class="fas fa-sticky-note" style="margin-right:6px;color:#f97316"></i>${cc.notes}</div>` : ''}

    <!-- Footer -->
    <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="closeCCDetail()"
        style="background:#3b82f6;border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">Закрыть</button>
    </div>`;

  modal.style.display = 'flex';
}

function closeCCDetail() {
  const modal   = document.getElementById('modal-cc-detail');
  const overlay = document.getElementById('ccDetailOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function markLPPayment(ccId, lpId) {
  const cc = capitalCallsLog.find(c => c.id === ccId);
  if (!cc) return;
  const li = cc.lineItems.find(l => l.lpId === lpId);
  if (!li) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(cc));

  if (!confirm(`Подтвердить получение платежа от ${li.lpName} на сумму ${fmtUSD(li.called)}?`)) return;

  // NB: AML clearance is a separate, deliberate check — see markLpAmlOk() —
  // not implied by payment receipt. A wire arriving doesn't mean AML/SoF was
  // actually verified for it.
  const lpName = li.lpName, called = li.called;
  try {
    const updatedCC = await apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
      method: 'PUT',
      body: JSON.stringify({ paid: called, status: 'Paid', paymentDate: today() }),
    });
    Object.assign(cc, updatedCC);

    // Update LP Register calledAmount + paidAmount — best-effort, doesn't
    // block the payment's own success if this second call fails.
    const lp = lpRegister.find(l => l.id === lpId);
    if (lp) {
      const totalPaidForLP = capitalCallsLog.flatMap(c => c.lineItems.filter(x => x.lpId === lpId && x.status === 'Paid')).reduce((s, x) => s + x.paid, 0);
      lp.calledAmount = totalPaidForLP;
      lp.paidAmount   = totalPaidForLP;
      apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ calledAmount: totalPaidForLP, paidAmount: totalPaidForLP }) })
        .catch(err => showToast('⚠️ Платёж сохранён, но не обновлён итог LP: ' + err.message, 'orange'));
    }

    // Авто-закрытие CC если все LP оплатили
    const allPaid = cc.lineItems.every(l => l.status === 'Paid');
    if (allPaid) {
      const closedCC = await apiFetch(`/api/capital-calls/${ccId}`, { method: 'PUT', body: JSON.stringify({ status: 'Completed' }) });
      Object.assign(cc, closedCC);
      showToast(`✅ Платёж от ${lpName} · ${fmtUSD(called)} · CC ${cc.ccNumber} закрыт — все LP оплатили`, 'green');
    } else {
      const stillPending = cc.lineItems.filter(l => l.status === 'Paid').length;
      const total        = cc.lineItems.length;
      showToast(`✅ Платёж получен от ${lpName} · ${fmtUSD(called)} · ${stillPending}/${total} LP оплатили`, 'green');
    }
  } catch (err) {
    showToast('⚠️ Не удалось сохранить платёж: ' + err.message, 'red');
    return;
  }
  openCCDetail(ccId);
  renderCapitalCallsPage();
}

// AML clearance for one LP's capital-call line item — a separate, deliberate
// action from payment receipt (see markLPPayment's comment above).
async function markLpAmlOk(ccId, lpId) {
  const cc = capitalCallsLog.find(c => c.id === ccId);
  if (!cc) return;
  const li = cc.lineItems.find(l => l.lpId === lpId);
  if (!li) return;
  if (li.amlOk === true) return;

  if (!confirm(`Подтвердить, что AML/Source-of-Funds проверка для ${li.lpName} по этому Capital Call пройдена?`)) return;

  const lpName = li.lpName;
  try {
    const updatedCC = await apiFetch(`/api/capital-calls/${ccId}/line-items/${lpId}`, {
      method: 'PUT', body: JSON.stringify({ amlOk: true }),
    });
    Object.assign(cc, updatedCC);
    showToast(`✅ AML подтверждён для ${lpName}`, 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить AML-подтверждение: ' + err.message, 'red');
    return;
  }
  openCCDetail(ccId);
  renderCapitalCallsPage();
}

function completeCCIfAllPaid(ccId) {
  const cc = capitalCallsLog.find(c => c.id === ccId);
  if (!cc) return;
  const allPaid = cc.lineItems.every(li => li.status === 'Paid');
  if (!allPaid) {
    const pending = cc.lineItems.filter(li => li.status !== 'Paid').map(li => li.lpName).join(', ');
    showToast(`⚠ Ещё не оплатили: ${pending}`, 'red'); return;
  }
  cc.status = 'Completed';
  showToast(`✅ Capital Call ${cc.ccNumber} закрыт — все платежи получены`, 'green');
  closeCCDetail();
  renderCapitalCallsPage();
}

/* ═══════════════════════════════════════════════════════════
   NEW CAPITAL CALL MODAL
═══════════════════════════════════════════════════════════ */

function openNewCCModal() {
  const modal   = document.getElementById('modal-cc-new');
  const overlay = document.getElementById('ccNewOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  const activeLP = lpRegister.filter(lp => lp.status === 'Active' && lp.fundId === activeFundId);
  const totalC   = getTotalCommitments(activeFundId);
  const inpStyle = `width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box`;
  const lblStyle = `font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase`;
  const grpStyle = `margin-bottom:14px`;
  const noticeDate = today();
  const payDate  = addBusinessDays(noticeDate, 10);

  document.getElementById('ccNewContent').innerHTML = `
    <div style="font-size:16px;font-weight:800;color:#f1f5f9;margin-bottom:20px;display:flex;align-items:center;gap:10px">
      <i class="fas fa-coins" style="color:#f97316"></i> Новый Capital Call Notice
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="${grpStyle}"><label style="${lblStyle}">Дата уведомления *</label>
        <input type="date" id="cc_noticeDate" value="${noticeDate}" style="${inpStyle}" onchange="updateCCPayDate()" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Дата платежа (+10 р.д.) *</label>
        <input type="date" id="cc_payDate" value="${payDate}" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">% от Commitment (pro-rata) *</label>
        <input type="number" id="cc_pct" min="0.1" max="100" step="0.5" value="5" style="${inpStyle}"
          oninput="updateCCProRata()" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Тип</label>
        <select id="cc_type" style="${inpStyle}" onchange="updateCCType()">
          <option value="Investment">Investment</option>
          <option value="Management Fee">Management Fee</option>
        </select></div>

      <div style="${grpStyle};grid-column:1/-1"><label style="${lblStyle}">Цель / Назначение *</label>
        <input type="text" id="cc_purpose" style="${inpStyle}" placeholder="Инвестиция в PortCo X / Management Fee H1 2026" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Bank Reference</label>
        <input type="text" id="cc_bankRef" style="${inpStyle}" placeholder="CC-2026-XXX-TCF" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Примечание</label>
        <input type="text" id="cc_notes" style="${inpStyle}" placeholder="Доп. информация..." /></div>
    </div>

    <!-- Pro-Rata Preview -->
    <div style="background:#0f1623;border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;color:#f97316;text-transform:uppercase;margin-bottom:10px">
        <i class="fas fa-calculator" style="margin-right:5px"></i>Pro-Rata распределение по LP (${activeLP.length} участников)
      </div>
      <div id="cc_proRataPreview">
        ${renderCCProRataPreview(5, activeLP)}
      </div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeNewCCModal()"
        style="background:#1c2333;border:1px solid #2a3448;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewCC()"
        style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-paper-plane" style="margin-right:6px"></i>Создать Capital Call
      </button>
    </div>`;

  modal.style.display = 'flex';
}

function renderCCProRataPreview(pct, activeLP) {
  if (!activeLP || !activeLP.length) return '<div style="color:#64748b;font-size:12px">Нет активных LP</div>';
  const total = activeLP.reduce((s, lp) => s + proRata(lp, pct), 0);
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));
  return `
    <div style="font-size:11px;color:#22c55e;font-weight:700;margin-bottom:8px">Итого: ${fmtUSD(total)} (${pct}% от ${fmtUSD(getTotalCommitments(activeFundId))})</div>
    ${activeLP.map(lp => `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;font-size:11px">
        <span style="color:#94a3b8">${lp.name}</span>
        <span style="color:#f97316;font-weight:700">${fmtUSD(proRata(lp, pct))}</span>
      </div>`).join('')}`;
}

function updateCCProRata() {
  const pct = parseFloat(document.getElementById('cc_pct')?.value || 5);
  const el  = document.getElementById('cc_proRataPreview');
  if (el) el.innerHTML = renderCCProRataPreview(pct, lpRegister.filter(l => l.status === 'Active' && l.fundId === activeFundId));
}

function updateCCPayDate() {
  const nd = document.getElementById('cc_noticeDate')?.value;
  if (nd) {
    const pd = addBusinessDays(nd, 10);
    const el = document.getElementById('cc_payDate');
    if (el) el.value = pd;
  }
}

function updateCCType() {
  const type = document.getElementById('cc_type')?.value;
  const purposeEl = document.getElementById('cc_purpose');
  if (type === 'Management Fee' && purposeEl && !purposeEl.value) {
    const year = new Date().getFullYear();
    const half = new Date().getMonth() < 6 ? 'H1' : 'H2';
    purposeEl.value = `Management Fee ${half} ${year} (2% p.a. от AUM × 0.5)`;
  }
}

function closeNewCCModal() {
  const modal   = document.getElementById('modal-cc-new');
  const overlay = document.getElementById('ccNewOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
}

async function saveNewCC() {
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));
  const pct     = parseFloat(document.getElementById('cc_pct')?.value);
  const purpose = document.getElementById('cc_purpose')?.value?.trim();
  if (!purpose)           { showToast('⚠ Укажите цель Capital Call', 'red'); return; }
  if (!pct || pct <= 0)  { showToast('⚠ Укажите % от Commitment', 'red'); return; }

  const noticeDate = document.getElementById('cc_noticeDate')?.value || today();
  const payDate    = document.getElementById('cc_payDate')?.value || addBusinessDays(noticeDate, 10);
  const ccType     = document.getElementById('cc_type')?.value || 'Investment';
  const bankRef    = document.getElementById('cc_bankRef')?.value || '';
  const notes      = document.getElementById('cc_notes')?.value || '';

  const activeLP   = lpRegister.filter(l => l.status === 'Active' && l.fundId === activeFundId);
  const lineItems  = activeLP.map(lp => ({
    lpId:        lp.id,
    lpName:      lp.name,
    commitment:  lp.commitment,
    pct,
    called:      proRata(lp, pct),
    paid:        0,
    paymentDate: payDate,
    status:      'Pending',
    wireRef:     '',
    amlOk:       null,
  }));
  const totalAmount = lineItems.reduce((s, li) => s + li.called, 0);

  const newCC = {
    fundId:       typeof activeFundId !== 'undefined' ? activeFundId : null,
    noticeDate,
    paymentDate:  payDate,
    totalAmount,
    pctOfCommit:  pct,
    purpose,
    purposeType:  ccType,
    status:       'Pending',
    managementFee: ccType === 'Management Fee',
    bankRef,
    createdBy:    currentUserDisplayName(),
    notes,
    lineItems,
  };

  try {
    const created = await apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify(newCC) });
    capitalCallsLog.push(created);

    // Sync each LP's calledAmount — best-effort, doesn't block the CC's own
    // success (the call is already safely saved either way).
    created.lineItems.forEach(li => {
      const lp = lpRegister.find(l => l.id === li.lpId);
      if (!lp) return;
      lp.calledAmount = (lp.calledAmount || 0) + li.called;
      apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ calledAmount: lp.calledAmount }) })
        .catch(err => showToast(`⚠️ CC сохранён, но не обновлён итог LP ${lp.name}: ` + err.message, 'orange'));
    });

    closeNewCCModal();
    showToast(`✅ Capital Call ${created.ccNumber} создан · ${fmtUSD(created.totalAmount)} · 10 р.д. уведомление`, 'green');
    renderCapitalCallsPage();
  } catch (err) {
    showToast('⚠️ Не удалось создать Capital Call: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════════════
   INDIVIDUAL CAPITAL CALL — CC на конкретного LP
   Используется когда LP не оплатил предыдущий CC
   или когда требуется отдельный вызов только для одного LP
═══════════════════════════════════════════════════════════ */

function openIndividualCCModal(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));

  /* Считаем задолженность: сколько вызвано, но не оплачено по всем CC */
  const pendingItems = capitalCallsLog.flatMap(cc =>
    cc.lineItems.filter(li => li.lpId === lpId && li.status === 'Pending')
  );
  const totalDebt = pendingItems.reduce((s, li) => s + Math.max(0, li.called - li.paid), 0);
  const unfunded  = Math.max(0, lp.commitment - (lp.paidAmount || 0));

  const noticeDate = today();
  const payDate    = addBusinessDays(noticeDate, 10);
  const inpStyle   = `width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box`;
  const lblStyle   = `font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase`;
  const grpStyle   = `margin-bottom:14px`;

  const modal   = document.getElementById('modal-cc-new');
  const overlay = document.getElementById('ccNewOverlay');
  if (!modal) return;
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';

  document.getElementById('ccNewContent').innerHTML = `
    <div style="font-size:16px;font-weight:800;color:#f1f5f9;margin-bottom:6px;display:flex;align-items:center;gap:10px">
      <i class="fas fa-user-circle" style="color:#fb923c"></i> Доп. Capital Call — Один LP
    </div>
    <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.25);border-radius:8px;padding:10px 14px;margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;color:#fb923c;margin-bottom:4px">
        <i class="fas fa-user" style="margin-right:6px"></i>${lp.name}
        <span style="background:rgba(249,115,22,0.15);border-radius:5px;padding:1px 8px;font-size:10px;margin-left:8px">${lp.registerId}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">
        <div>
          <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700">Commitment</div>
          <div style="font-size:12px;font-weight:700;color:#22c55e">${fmtUSD(lp.commitment)}</div>
        </div>
        <div>
          <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700">Unfunded</div>
          <div style="font-size:12px;font-weight:700;color:#8b5cf6">${fmtUSD(unfunded)}</div>
        </div>
        <div>
          <div style="font-size:9px;color:#5a6b8a;text-transform:uppercase;font-weight:700">Задолженность</div>
          <div style="font-size:12px;font-weight:700;color:${totalDebt > 0 ? '#ef4444' : '#22c55e'}">${totalDebt > 0 ? fmtUSD(totalDebt) : '✓ Нет'}</div>
        </div>
      </div>
      ${pendingItems.length > 0 ? `
        <div style="margin-top:8px;font-size:10px;color:#94a3b8">
          <i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-right:4px"></i>
          Неоплаченных позиций: <b style="color:#f59e0b">${pendingItems.length}</b>
          (${pendingItems.map(li => capitalCallsLog.find(cc => cc.lineItems.includes(li))?.ccNumber || '?').join(', ')})
        </div>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="${grpStyle}"><label style="${lblStyle}">Дата уведомления *</label>
        <input type="date" id="icc_noticeDate" value="${noticeDate}" style="${inpStyle}"
          onchange="(function(){const nd=document.getElementById('icc_noticeDate').value;if(nd){const el=document.getElementById('icc_payDate');if(el)el.value=addBusinessDays(nd,10);}})()" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Дата платежа (+10 р.д.) *</label>
        <input type="date" id="icc_payDate" value="${payDate}" style="${inpStyle}" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Сумма к вызову (USD) *</label>
        <input type="number" id="icc_amount" min="1000" step="1000"
          value="${totalDebt > 0 ? totalDebt : Math.round(lp.commitment * 0.05)}"
          style="${inpStyle}" oninput="updateICCPctPreview(${lp.commitment})" />
        <div id="icc_pct_preview" style="font-size:10px;color:#64748b;margin-top:4px"></div></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Тип</label>
        <select id="icc_type" style="${inpStyle}">
          <option value="Investment">Investment</option>
          <option value="Management Fee">Management Fee</option>
          <option value="Penalty">Penalty / Просрочка</option>
        </select></div>

      <div style="${grpStyle};grid-column:1/-1"><label style="${lblStyle}">Цель / Назначение *</label>
        <input type="text" id="icc_purpose" style="${inpStyle}"
          value="${totalDebt > 0 ? 'Погашение задолженности по предыдущим Capital Calls' : ''}"
          placeholder="Инвестиция / Management Fee / Погашение задолженности" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Bank Reference</label>
        <input type="text" id="icc_bankRef" style="${inpStyle}" placeholder="CC-IND-${new Date().getFullYear()}-XXX" /></div>

      <div style="${grpStyle}"><label style="${lblStyle}">Примечание</label>
        <input type="text" id="icc_notes" style="${inpStyle}"
          value="${totalDebt > 0 ? 'Индивидуальный CC — LP не оплатил предыдущий вызов' : ''}"
          placeholder="Доп. информация..." /></div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closeNewCCModal()"
        style="background:#1c2333;border:1px solid #2a3448;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveIndividualCC(${lp.id})"
        style="background:linear-gradient(135deg,#f97316,#dc2626);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-paper-plane" style="margin-right:6px"></i>Создать Individual CC
      </button>
    </div>`;

  /* Инициализируем % превью */
  updateICCPctPreview(lp.commitment);
  modal.style.display = 'flex';
}

function updateICCPctPreview(commitment) {
  const amt = parseFloat(document.getElementById('icc_amount')?.value || 0);
  const el  = document.getElementById('icc_pct_preview');
  if (!el) return;
  if (commitment && amt > 0) {
    const pct = (amt / commitment * 100).toFixed(2);
    el.textContent = `≈ ${pct}% от Commitment LP`;
    el.style.color = amt > commitment ? '#ef4444' : '#64748b';
  } else {
    el.textContent = '';
  }
}

async function saveIndividualCC(lpId) {
  const lp = lpRegister.find(l => l.id === lpId);
  if (!lp) return;
  const fmtUSD = (n) => fmtCurrency(n, currencyForEntity(lp));

  const amount     = parseFloat(document.getElementById('icc_amount')?.value);
  const purpose    = document.getElementById('icc_purpose')?.value?.trim();
  if (!purpose)          { showToast('⚠ Укажите назначение CC', 'red'); return; }
  if (!amount || amount <= 0) { showToast('⚠ Укажите сумму к вызову', 'red'); return; }
  if (amount > lp.commitment) { showToast('⚠ Сумма превышает Commitment LP', 'red'); return; }

  const noticeDate = document.getElementById('icc_noticeDate')?.value || today();
  const payDate    = document.getElementById('icc_payDate')?.value    || addBusinessDays(noticeDate, 10);
  const ccType     = document.getElementById('icc_type')?.value       || 'Investment';
  const bankRef    = document.getElementById('icc_bankRef')?.value    || '';
  const notes      = document.getElementById('icc_notes')?.value      || '';

  const pct = lp.commitment ? +(amount / lp.commitment * 100).toFixed(4) : 0;

  // "Individual" nature is now derived from lineItems.length === 1 at render
  // time (js/lp-register.js badge sites) rather than a stored flag — no
  // ccNumber suffix needed either, the server auto-numbers uniformly.
  const lineItems = [{
    lpId:        lp.id,
    lpName:      lp.name,
    commitment:  lp.commitment,
    pct,
    called:      amount,
    paid:        0,
    paymentDate: payDate,
    status:      'Pending',
    wireRef:     '',
    amlOk:       null,
  }];

  const newCC = {
    fundId:       lp.fundId != null ? lp.fundId : null,
    noticeDate,
    paymentDate:  payDate,
    totalAmount:  amount,
    pctOfCommit:  +pct.toFixed(2),
    purpose,
    purposeType:  ccType,
    status:       'Pending',
    managementFee: ccType === 'Management Fee',
    bankRef,
    createdBy:    currentUserDisplayName(),
    notes,
    lineItems,
  };

  try {
    const created = await apiFetch('/api/capital-calls', { method: 'POST', body: JSON.stringify(newCC) });
    capitalCallsLog.push(created);

    lp.calledAmount = (lp.calledAmount || 0) + amount;
    apiFetch(`/api/lp/${lp.id}`, { method: 'PUT', body: JSON.stringify({ calledAmount: lp.calledAmount }) })
      .catch(err => showToast('⚠️ CC сохранён, но не обновлён итог LP: ' + err.message, 'orange'));

    closeNewCCModal();
    showToast(`✅ Individual CC ${created.ccNumber} создан для ${lp.name} · ${fmtUSD(amount)}`, 'green');
    renderCapitalCallsPage();
  } catch (err) {
    showToast('⚠️ Не удалось создать Individual CC: ' + err.message, 'red');
  }
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD WIDGET — LP Register + Capital Calls
═══════════════════════════════════════════════════════════ */

function renderDashboardLPWidget() {
  const el = document.getElementById('dashLPWidget');
  if (!el) return;

  const activeLP     = lpRegister.filter(l => l.status === 'Active' && l.fundId === activeFundId);
  const totalC       = getTotalCommitments(activeFundId);
  const totalCalled  = getTotalCalled(activeFundId);
  const totalUnfund  = getTotalUnfunded(activeFundId);
  const callRate     = totalC ? totalCalled / totalC * 100 : 0;
  const pendingCC    = capitalCallsLog.filter(cc => cc.status === 'Pending' && cc.fundId === activeFundId).length;
  const overdueCC    = capitalCallsLog.filter(cc => cc.status === 'Pending' && cc.fundId === activeFundId && new Date(cc.paymentDate) < new Date()).length;
  const kycDueSoon   = lpRegister.filter(lp => {
    if (!lp.kycNextReview) return false;
    const d = new Date(lp.kycNextReview), now = new Date();
    return (d - now) / 86400000 < 60 && lp.status === 'Active' && lp.fundId === activeFundId;
  }).length;
  const fmtUSD = (n) => fmtCurrency(n, currencyForFundId(activeFundId));

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      ${[
        { label:'Активных LP',    val:activeLP.length, color:'#3b82f6', sub:`из ${lpRegister.length} в реестре`  },
        { label:'Total Commit',   val:fmtUSD(totalC),  color:'#22c55e', sub:`Unfunded: ${fmtUSD(totalUnfund)}`   },
        { label:'Pending CC',     val:pendingCC,        color:overdueCC>0?'#ef4444':'#f97316', sub:overdueCC>0?`${overdueCC} просрочено`:'Ожидают оплаты' },
      ].map(k => `
        <div style="background:#0f1623;border-radius:8px;padding:10px 12px;border-left:3px solid ${k.color}">
          <div style="font-size:10px;color:#5a6b8a;text-transform:uppercase;font-weight:700;margin-bottom:4px">${k.label}</div>
          <div style="font-size:16px;font-weight:800;color:${k.color}">${k.val}</div>
          <div style="font-size:10px;color:#64748b">${k.sub}</div>
        </div>`).join('')}
    </div>

    <!-- Capital Call Progress Bar -->
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:5px">
        <span><i class="fas fa-coins" style="color:#f97316;margin-right:4px"></i>Capital Called</span>
        <span>${fmtUSD(totalCalled)} / ${fmtUSD(totalC)} (${fmtPctLP(callRate)})</span>
      </div>
      <div style="height:8px;background:#1e293b;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${Math.min(100,callRate)}%;background:linear-gradient(90deg,#f97316,#eab308);border-radius:4px;transition:width 0.5s"></div>
      </div>
    </div>

    <!-- LP Quick List -->
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
      ${activeLP.slice(0,4).map(lp => {
        const uf = getLPUnfunded(lp);
        const cr = getLPCallRate(lp);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:#0f1623;border-radius:8px;cursor:pointer"
          onclick="navigateTo('lp-register');setTimeout(()=>openLPDetail(${lp.id}),200)">
          <div style="width:28px;height:28px;background:rgba(59,130,246,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#3b82f6;flex-shrink:0">${lp.name.slice(0,2).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lp.name}</div>
            <div style="font-size:10px;color:#64748b">${fmtUSD(lp.commitment)} · ${lp.lpType}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:11px;font-weight:700;color:${uf>0?'#8b5cf6':'#22c55e'}">${uf>0?fmtUSD(uf)+' unfunded':'Fully Called'}</div>
            <div style="width:50px;height:3px;background:#1e293b;border-radius:2px;margin-top:3px;margin-left:auto">
              <div style="width:${Math.min(100,cr)}%;height:3px;background:${cr>=100?'#22c55e':'#f97316'};border-radius:2px"></div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>

    ${kycDueSoon > 0 ? `
    <div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:8px;padding:8px 12px;font-size:11px;color:#eab308">
      <i class="fas fa-clock" style="margin-right:5px"></i>${kycDueSoon} LP требуют обновления KYC в ближайшие 60 дней
    </div>` : ''}

    <div style="display:flex;gap:8px;margin-top:10px">
      <button onclick="navigateTo('lp-register')"
        style="flex:1;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700">
        <i class="fas fa-book" style="margin-right:4px"></i>LP Register
      </button>
      <button onclick="navigateTo('lp-capital-calls')"
        style="flex:1;background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);color:#fb923c;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700">
        <i class="fas fa-coins" style="margin-right:4px"></i>Capital Calls
      </button>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   AUTO-REGISTER FROM ONBOARDING ACTIVATION
   Called by submitObTask() when formKey === 'activation'
   and client.direction === 'FM'
═══════════════════════════════════════════════════════════ */

async function registerLPFromOnboarding(client, saTask, actTask) {
  // Avoid duplicates
  if (lpRegister.some(l => l.obClientId === client.id)) {
    showToast(`ℹ LP ${client.name} уже есть в реестре`, 'blue');
    return null;
  }

  const saFormData = saTask?.formData || {};
  const riskRating = (() => {
    const ddTask = (typeof obTasks !== 'undefined' ? obTasks : [])
      .find(t => t.clientId === client.id && t.taskNum === '2.2');
    return ddTask?.formData?.f_riskTotal || 'Medium';
  })();
  const kycNextMap = { Low:24, Medium:12, High:6, Unacceptable:6 };
  const kycMos     = kycNextMap[riskRating] || 12;
  const kycNext    = new Date();
  kycNext.setMonth(kycNext.getMonth() + kycMos);

  const totalC     = getTotalCommitments(activeFundId);
  const commitment = client.commitment || parseFloat(saFormData.f_subCommitment) || 0;
  const ownershipPct = (totalC + commitment) > 0 ? commitment / (totalC + commitment) * 100 : 0;

  const year  = new Date().getFullYear();

  const newLP = {
    fundId:          typeof activeFundId !== 'undefined' ? activeFundId : null,
    name:            client.name,
    type:            client.type,
    lpType:          client.lpType || 'HNWI',
    country:         client.country || 'Казахстан',
    address:         client.address || '',
    taxId:           client.taxId || '',
    contact:         client.name,
    email:           client.email || '',
    phone:           client.phone || '',
    commitment,
    calledAmount:    0,
    paidAmount:      0,
    distributions:   0,
    fundClass:       saFormData.f_fundClass || 'B',
    ownershipPct:    parseFloat(ownershipPct.toFixed(2)),
    professionalClient: client.classification || 'Qualified Investor',
    kycStatus:       'Одобрен',
    kycDate:         today(),
    kycNextReview:   kycNext.toISOString().slice(0,10),
    riskRating,
    admissionDate:   today(),
    saNumber:        saFormData.f_subNum || `SA-${year}-${String(client.id).padStart(3,'0')}`,
    afsaNotified:    false,
    lpacMember:      commitment >= 3000000,
    status:          'Active',
    exitDate:        null,
    notes:           `[Онбординг] ${client.onboardingStatus} · RM: ${client.rm}`,
    obClientId:      client.id,
    lpaUrl:          (actTask?.formData?.f_lpaUrl) || '',
    contractNum:     (actTask?.formData?.f_contractNum) || '',
  };

  let created;
  try {
    created = await apiFetch('/api/lp', { method: 'POST', body: JSON.stringify(newLP) });
  } catch (err) {
    showToast('⚠️ Не удалось сохранить LP в реестре: ' + err.message, 'red');
    return null;
  }

  const savedLP = { ...newLP, ...created };
  lpRegister.push(savedLP);
  recalcOwnershipPcts(activeFundId);

  showToast(`📋 LP ${savedLP.registerId} (${client.name}) добавлен в Реестр LP`, 'green');

  if (savedLP.ownershipPct > 20) {
    showToast(`⚠ ${client.name} — доля >20%. Требуется уведомление AFSA (10 р.д.)`, 'yellow');
  }
  if (savedLP.lpacMember) {
    showToast(`★ ${client.name} — Commitment ≥$3M. Предложить участие в LPAC`, 'blue');
  }
  return savedLP;
}
