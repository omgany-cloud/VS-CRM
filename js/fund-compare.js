// ============================================================
//  fund-compare.js — side-by-side comparison of the tenant's OWN
//  funds: key metrics (paid-in/distributed/DPI/RVPI/TVPI/IRR, via
//  the existing GET /api/funds/:id/metrics — no new backend route)
//  plus an overlaid cumulative J-curve built client-side from the
//  same capitalCallsLog/distributionsLog arrays the single-fund
//  dashboard J-curve already uses (js/app.js's buildRealJCurveData).
//
//  v1 scope deliberately excludes industry benchmarks — there is no
//  external/reference dataset anywhere in this system to source them
//  from; adding real peer benchmarks needs a licensed data source and
//  is left as a future, separate feature.
// ============================================================

let _fundCompareSelectedIds = [];
let fundCompareChart = null;

function renderFundComparePage() {
  const el = document.getElementById('fundCompareContent');
  if (!el) return;

  if (typeof funds === 'undefined' || funds.length < 2) {
    el.innerHTML = `<div class="card"><div style="text-align:center;padding:40px;color:#4a5568">
      <i class="fas fa-scale-balanced" style="font-size:28px;margin-bottom:10px;display:block"></i>
      Для сравнения нужно минимум 2 фонда — сейчас в системе ${typeof funds !== 'undefined' ? funds.length : 0}.
    </div></div>`;
    return;
  }

  // Default selection: every fund the first time the page is opened;
  // once the user has touched the checkboxes, keep whatever they chose
  // even if it doesn't cover every fund.
  if (!_fundCompareSelectedIds.length) {
    _fundCompareSelectedIds = funds.map(f => f.id);
  } else {
    _fundCompareSelectedIds = _fundCompareSelectedIds.filter(id => funds.some(f => f.id === id));
  }

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-check-double" style="color:#8b5cf6;margin-right:6px"></i>Фонды для сравнения</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:4px 0">
        ${funds.map(f => `
          <label style="display:flex;align-items:center;gap:8px;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:12.5px;color:#e2e8f0">
            <input type="checkbox" onchange="toggleFundCompareSelection(${f.id}, this.checked)" ${_fundCompareSelectedIds.includes(f.id) ? 'checked' : ''} />
            <span style="width:8px;height:8px;border-radius:50%;background:${f.color || '#0f9488'};display:inline-block"></span>
            ${escapeHtml(f.shortName || f.name)} <span style="color:#5a8a85">· ${f.vintage || '—'} · ${escapeHtml(f.currency || 'USD')}</span>
          </label>
        `).join('')}
      </div>
    </div>
    <div id="fundCompareResults"></div>`;

  renderFundCompareResults();
}

function toggleFundCompareSelection(id, checked) {
  if (checked) {
    if (!_fundCompareSelectedIds.includes(id)) _fundCompareSelectedIds.push(id);
  } else {
    _fundCompareSelectedIds = _fundCompareSelectedIds.filter(x => x !== id);
  }
  renderFundCompareResults();
}

// Real per-year cumulative net cash flow for one fund — same convention
// as js/app.js's buildRealJCurveData (Draft calls/distributions don't
// count, amounts in millions of the fund's OWN currency; this app has no
// FX conversion anywhere, so an overlay across funds in different
// currencies is only directionally comparable, same caveat the existing
// single-fund J-curve already carries).
function _fundCompareCashflowByYear(fundId) {
  const calls = (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : [])
    .filter(cc => cc.fundId === fundId && cc.noticeDate && cc.status !== 'Draft');
  const dists = (typeof distributionsLog !== 'undefined' ? distributionsLog : [])
    .filter(d => d.fundId === fundId && (d.paymentDate || d.noticeDate) && d.status !== 'Draft');
  const byYear = {};
  calls.forEach(cc => { const y = cc.noticeDate.slice(0, 4); byYear[y] = (byYear[y] || 0) - (cc.totalAmount || 0) / 1e6; });
  dists.forEach(d => { const date = d.paymentDate || d.noticeDate; const y = date.slice(0, 4); byYear[y] = (byYear[y] || 0) + (d.totalAmount || 0) / 1e6; });
  const years = Object.keys(byYear).sort();
  let cum = 0;
  const cumByYear = {};
  years.forEach(y => { cum += byYear[y]; cumByYear[y] = Math.round(cum * 100) / 100; });
  return { years, cumByYear };
}

async function renderFundCompareResults() {
  const el = document.getElementById('fundCompareResults');
  if (!el) return;

  if (!_fundCompareSelectedIds.length) {
    el.innerHTML = `<div class="card"><div style="text-align:center;padding:32px;color:#4a5568">Выберите хотя бы один фонд выше</div></div>`;
    return;
  }

  el.innerHTML = `<div class="card"><div style="text-align:center;padding:32px;color:#4a5568">Загрузка метрик...</div></div>`;

  const selectedFunds = _fundCompareSelectedIds
    .map(id => funds.find(f => f.id === id))
    .filter(Boolean);

  const results = await Promise.all(selectedFunds.map(f =>
    apiFetch(`/api/funds/${f.id}/metrics`).then(m => ({ fund: f, metrics: m })).catch(() => ({ fund: f, metrics: null }))
  ));

  const fmtRatio = (v) => v == null ? '—' : v.toFixed(2) + 'x';
  const fmtPct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const rows = [
    { label: 'Vintage', get: r => r.fund.vintage || '—' },
    { label: 'Тип', get: r => escapeHtml(r.fund.type || '—') },
    { label: 'Целевой размер', get: r => r.fund.targetSize ? `${escapeHtml(r.fund.currency || 'USD')} ${r.fund.targetSize}M` : '—' },
    { label: 'Статус', get: r => typeof getFundStatusLabel === 'function' ? getFundStatusLabel(r.fund.status) : (r.fund.status || '—') },
    { label: 'Paid-in', get: r => r.metrics ? fmtCurrency(r.metrics.paidIn, r.fund.currency) : '—' },
    { label: 'Distributed', get: r => r.metrics ? fmtCurrency(r.metrics.distributed, r.fund.currency) : '—' },
    { label: 'Residual Value', get: r => r.metrics ? fmtCurrency(r.metrics.residualValue, r.fund.currency) : '—' },
    { label: 'DPI', get: r => r.metrics ? fmtRatio(r.metrics.dpi) : '—' },
    { label: 'RVPI', get: r => r.metrics ? fmtRatio(r.metrics.rvpi) : '—' },
    { label: 'TVPI', get: r => r.metrics ? fmtRatio(r.metrics.tvpi) : '—' },
    { label: 'IRR', get: r => r.metrics ? fmtPct(r.metrics.irr) : '—' },
  ];

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-table" style="color:#8b5cf6;margin-right:6px"></i>Метрики фондов</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Показатель</th>
              ${results.map(r => `<th>
                <span style="width:8px;height:8px;border-radius:50%;background:${r.fund.color || '#0f9488'};display:inline-block;margin-right:6px"></span>
                ${escapeHtml(r.fund.shortName || r.fund.name)}
              </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td style="color:#94a3b8;font-weight:600">${row.label}</td>
                ${results.map(r => `<td style="color:#e2e8f0">${row.get(r)}</td>`).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-chart-line" style="color:#8b5cf6;margin-right:6px"></i>Накопленный денежный поток (J-curve)</span>
        <span style="font-size:11px;color:#5a8a85">Млн, собственная валюта каждого фонда — без конвертации</span>
      </div>
      <div style="height:320px;padding:8px 4px">
        <canvas id="chartFundCompare"></canvas>
      </div>
    </div>`;

  renderFundCompareChart(results.map(r => r.fund));
}

function renderFundCompareChart(selectedFundObjs) {
  const ctx = document.getElementById('chartFundCompare');
  if (!ctx) return;
  if (fundCompareChart) fundCompareChart.destroy();

  const perFund = selectedFundObjs.map(f => ({ fund: f, ..._fundCompareCashflowByYear(f.id) }));
  const allYears = Array.from(new Set(perFund.flatMap(f => f.years))).sort();

  if (!allYears.length) {
    fundCompareChart = null;
    ctx.parentElement.innerHTML = `<div style="text-align:center;padding:32px;color:#4a5568">Нет данных о capital calls / distributions для выбранных фондов</div>`;
    return;
  }

  const datasets = perFund.map((f, i) => {
    let lastVal = null;
    const data = allYears.map(y => {
      if (f.cumByYear[y] != null) { lastVal = f.cumByYear[y]; return lastVal; }
      return (f.years.length && y >= f.years[0]) ? lastVal : null;
    });
    const color = f.fund.color || getColor(i);
    return {
      label: f.fund.shortName || f.fund.name,
      data,
      borderColor: color,
      backgroundColor: 'transparent',
      tension: 0.3,
      pointRadius: 3,
      borderWidth: 2,
      spanGaps: false,
    };
  });

  fundCompareChart = new Chart(ctx, {
    type: 'line',
    data: { labels: allYears, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#8abfbb', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#5a8a85' }, grid: { color: '#2a4846' } },
        y: { ticks: { color: '#5a8a85', callback: v => v + 'M' }, grid: { color: '#2a4846' } },
      },
    },
  });
}
