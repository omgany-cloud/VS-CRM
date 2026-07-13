// ============================================================
//  trading.js — Excel Trading Report Parser & Analytics
//  Reads uploaded .xlsx/.xls/.csv files via SheetJS
//  Computes: P&L (open+closed), Return %, Drawdown, Sharpe, Win Rate
//  Supports: MT4/MT5, MOEX, Freedom Finance, Halyk Invest, Alpari,
//            Tinkoff, Interactive Brokers, custom formats
// ============================================================

/* ── state ── */
let tradingRawRows  = [];   // raw data from Excel
let tradingTrades   = [];   // normalised trade objects
let tradingCharts   = {};   // chart instances keyed by canvas id
let tradingFileName = '';   // last loaded file name

/* ────────────────────────────────────────────────────────────
   COLUMN MAP — flexible auto-detection
   Maps 80+ common broker column aliases → internal keys
────────────────────────────────────────────────────────────── */
const COL_ALIASES = {
  date: [
    'дата открытия','open time','open date','дата','date','trade date','open_date',
    'time','время','entry time','entry date','transaction date','deal time','сделка',
    'opened','dt','datetime','когда открыт','date/time','start date','start time'
  ],
  closeDate: [
    'дата закрытия','close time','close date','close_date','closed time','closed date',
    'exit time','exit date','закрыт','закрытие','end date','end time','время закрытия'
  ],
  ticker: [
    'инструмент','symbol','ticker','тикер','актив','asset','instrument','наименование',
    'name','наим','security','contract','pair','ccy pair','currency pair','описание',
    'underlying','item','товар','бумага','акция','share','stock','ценная бумага',
    'forex pair','product'
  ],
  side: [
    'тип','type','direction','side','buy/sell','операция','action','b/s','bs',
    'direction','trade type','transaction','вид','направление','order type',
    'buy sell','buy_sell','транзакция','deal type'
  ],
  qty: [
    'объём','объем','кол-во','кол.','количество','qty','quantity','volume','лот',
    'lots','size','shares','units','amount','pos size','position size',
    'vol','контрактов','контракты','лоты','число','amount'
  ],
  entryPrice: [
    'цена открытия','цена откр','open price','entry price','price','open','entry',
    'open_price','bid open','ask open','entry_price','цена входа','вход',
    'buy price','начальная цена','initial price','first price'
  ],
  exitPrice: [
    'цена закрытия','цена закр','close price','exit price','close','exit',
    'close_price','exit_price','цена выхода','выход','sell price','last price',
    'final price','closing price','closed at'
  ],
  pnl: [
    'прибыль','убыток','убыток/прибыль','прибыль/убыток','profit','p&l','pnl',
    'profit/loss','gain/loss','result','результат','net p&l','realized p&l',
    'gross p&l','net profit','gross profit','profit (usd)','profit (usd)',
    'финансовый результат','gain','loss','pl','доход','выручка','итог'
  ],
  pnlPct: [
    'доходность %','доходность','pnl %','p&l %','return %','return','% change',
    '%change','profit %','% profit','return pct','returns','yield %','рентабельность',
    'change %','прирост %','изменение %'
  ],
  commission: [
    'комиссия','commission','fee','fees','swap','своп','charges','tax','налог',
    'cost','spread cost','brokerage','broker fee','trading fee','overheads',
    'расходы','итого комиссия','total fee','net commission'
  ],
  status: [
    'статус','status','state','состояние','position status','trade status','тип позиции'
  ],
  currency: ['валюта','currency','ccy','cur','Валюта сделки'],
  market: ['биржа','рынок','market','exchange','venue','площадка','брокер'],
  comment: ['комментарий','comment','comments','notes','note','примечание','описание'],
};

function detectColumn(headers, aliases) {
  // Exact match first
  for (const alias of aliases) {
    const idx = headers.findIndex(h => String(h).toLowerCase().trim() === alias);
    if (idx !== -1) return idx;
  }
  // Contains match second
  for (const alias of aliases) {
    const idx = headers.findIndex(h => String(h).toLowerCase().trim().includes(alias));
    if (idx !== -1) return idx;
  }
  return -1;
}

/* ────────────────────────────────────────────────────────────
   EXCEL FILE HANDLER
────────────────────────────────────────────────────────────── */
function handleTradingFileUpload(input) {
  const file = input.files[0];
  if (!file) return;
  tradingFileName = file.name;

  showTradingStatus('loading', `⏳ Загружаем «${file.name}»…`);
  hideTradingResults();

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data  = new Uint8Array(e.target.result);
      const wb    = XLSX.read(data, { type: 'uint8array', cellDates: true, cellNF: true });

      // Try to find the best sheet: prefer sheet with most data rows
      let bestSheet = wb.SheetNames[0];
      let bestRows  = 0;
      for (const name of wb.SheetNames) {
        const s = wb.Sheets[name];
        const range = XLSX.utils.decode_range(s['!ref'] || 'A1:A1');
        const rows  = range.e.r - range.s.r + 1;
        if (rows > bestRows) { bestRows = rows; bestSheet = name; }
      }

      const sheet = wb.Sheets[bestSheet];
      const json  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

      if (!json || json.length < 2) {
        showTradingStatus('error', '❌ Файл пустой или не содержит данных.');
        return;
      }

      parseTradingData(json, file.name);
    } catch (err) {
      showTradingStatus('error', '❌ Ошибка чтения файла: ' + err.message);
    }
  };
  reader.onerror = () => showTradingStatus('error', '❌ Не удалось прочитать файл.');
  reader.readAsArrayBuffer(file);
  input.value = '';
}

/* ────────────────────────────────────────────────────────────
   PARSE & NORMALISE
────────────────────────────────────────────────────────────── */
function parseTradingData(rows, fileName) {
  // ── Find header row (scan first 10 rows)
  let headerRowIdx = 0;
  let maxScore = 0;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (!rows[i] || rows[i].length < 2) continue;
    const lower = rows[i].map(c => String(c).toLowerCase().trim());
    let score = 0;
    for (const aliases of Object.values(COL_ALIASES)) {
      for (const alias of aliases) {
        if (lower.some(h => h === alias || h.includes(alias))) { score++; break; }
      }
    }
    if (score > maxScore) { maxScore = score; headerRowIdx = i; }
  }

  const headers = rows[headerRowIdx].map(h => String(h).toLowerCase().trim());

  // ── Detect column indices
  const ci = {};
  for (const [key, aliases] of Object.entries(COL_ALIASES)) {
    ci[key] = detectColumn(headers, aliases);
  }

  // ── Diagnostic: log detected columns
  console.debug('[Trading] Headers:', headers);
  console.debug('[Trading] Detected cols:', ci);

  // ── Parse data rows
  tradingTrades = [];
  let skipped = 0;
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '' || c === null || c === undefined)) { skipped++; continue; }

    const get = idx => (idx !== -1 && idx < row.length) ? row[idx] : '';

    const rawPnl    = parseNumeric(get(ci.pnl));
    const entryPx   = parseNumeric(get(ci.entryPrice));
    const exitPx    = parseNumeric(get(ci.exitPrice));
    const qty       = parseNumeric(get(ci.qty));
    const comm      = parseNumeric(get(ci.commission));

    const sideStr   = String(get(ci.side)).toLowerCase();
    const isSellDir = sideStr.includes('sell') || sideStr.includes('short') ||
                      sideStr.includes('продаж') || sideStr.includes('шорт') ||
                      sideStr === 's' || sideStr === 'sell';

    // ── Calculate P&L if not provided directly
    let pnl = rawPnl;
    if (pnl === 0 && entryPx && exitPx && qty) {
      pnl = isSellDir
        ? (entryPx - exitPx) * qty - comm
        : (exitPx - entryPx) * qty - comm;
    }

    const pnlPct = parseNumeric(get(ci.pnlPct)) ||
                   (entryPx && qty ? (pnl / (entryPx * qty)) * 100 : 0);

    // ── Determine status: open vs closed
    const statusRaw   = String(get(ci.status)).toLowerCase();
    const exitPxRaw   = get(ci.exitPrice);
    const hasExitPx   = exitPx > 0;
    const closedWords = ['closed','закрыт','close','completed','исполн','done','fulfilled'];
    const openWords   = ['open','открыт','active','активн','running','live'];
    let isClosed      = hasExitPx || closedWords.some(w => statusRaw.includes(w));
    if (openWords.some(w => statusRaw.includes(w))) isClosed = false;

    const rawDate   = get(ci.date);
    const tradeDate = parseDate(rawDate);
    const closeDt   = parseDate(get(ci.closeDate));

    const ticker = String(get(ci.ticker)).trim().toUpperCase() || 'N/A';

    // Skip rows with no meaningful data
    if (ticker === 'N/A' && !tradeDate && pnl === 0 && !qty) { skipped++; continue; }

    tradingTrades.push({
      id:         i,
      date:       tradeDate,
      closeDate:  closeDt,
      ticker:     ticker,
      side:       normaliseSide(get(ci.side)),
      qty:        qty,
      entryPrice: entryPx,
      exitPrice:  exitPx,
      pnl:        +pnl.toFixed(4),
      pnlPct:     +pnlPct.toFixed(4),
      commission: comm,
      status:     isClosed ? 'closed' : 'open',
      currency:   String(get(ci.currency)).trim() || 'USD',
      market:     String(get(ci.market)).trim() || '—',
      comment:    String(get(ci.comment)).trim(),
    });
  }

  tradingRawRows = rows;
  const closedCount = tradingTrades.filter(t => t.status === 'closed').length;
  const openCount   = tradingTrades.filter(t => t.status === 'open').length;

  showTradingStatus('success',
    `✅ «${fileName}» — ${tradingTrades.length} сделок загружено ` +
    `(закрытых: ${closedCount}, открытых: ${openCount}, пропущено: ${skipped})`
  );
  renderTradingAnalytics();
}

/* ── Numeric parser: handles "1,234.56", "1 234,56", "−5.00", parentheses "(5.00)" ── */
function parseNumeric(val) {
  if (val === '' || val === null || val === undefined) return 0;
  let s = String(val).trim();
  // Parentheses → negative: (123.45) → -123.45
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  // Remove currency symbols and spaces
  s = s.replace(/[^\d.,\-+eE]/g, '');
  // Handle European decimal comma: "1.234,56" → "1234.56"
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g,'').replace(',','.');
  // Handle Russian space-thousands "1 234,56"
  s = s.replace(/,(\d{2})$/, '.$1');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* ── Date parser: handles Date objects, ISO strings, DD.MM.YYYY, YYYY-MM-DD, serial numbers ── */
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  const s = String(val).trim();
  if (!s || s === '0' || s === '') return null;

  // Already ISO / parseable by Date()
  const d = new Date(s);
  if (!isNaN(d)) return d;

  // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m1) {
    const year = m1[3].length === 2 ? '20'+m1[3] : m1[3];
    const dt = new Date(`${year}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}T${(m1[4]||'00').padStart(2,'0')}:${(m1[5]||'00').padStart(2,'0')}:00`);
    if (!isNaN(dt)) return dt;
  }

  // YYYY.MM.DD
  const m2 = s.match(/^(\d{4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
  if (m2) {
    const dt = new Date(`${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`);
    if (!isNaN(dt)) return dt;
  }

  return null;
}

function normaliseSide(raw) {
  const s = String(raw).toLowerCase().trim();
  if (s.includes('buy') || s.includes('long') || s.includes('покуп') || s.includes('лонг') || s === 'b' || s === 'bl') return 'BUY';
  if (s.includes('sell') || s.includes('short') || s.includes('продаж') || s.includes('шорт') || s === 's' || s === 'sl') return 'SELL';
  return s.toUpperCase() || '—';
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS ENGINE
────────────────────────────────────────────────────────────── */
function calcAnalytics(trades) {
  const closed = trades.filter(t => t.status === 'closed');
  const open   = trades.filter(t => t.status === 'open');

  const totalPnl  = trades.reduce((s, t) => s + t.pnl, 0);
  const closedPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const openPnl   = open.reduce((s, t) => s + t.pnl, 0);
  const totalComm = trades.reduce((s, t) => s + t.commission, 0);

  /* ── Win Rate ── */
  const winners = closed.filter(t => t.pnl > 0);
  const losers  = closed.filter(t => t.pnl < 0);
  const breakev = closed.filter(t => t.pnl === 0);
  const winRate = closed.length ? (winners.length / closed.length) * 100 : 0;

  const avgWin = winners.length ? winners.reduce((s,t)=>s+t.pnl,0) / winners.length : 0;
  const avgLoss= losers.length  ? losers.reduce((s,t)=>s+t.pnl,0)  / losers.length  : 0;
  const totalWinPnl = winners.reduce((s,t)=>s+t.pnl,0);
  const totalLossPnl= Math.abs(losers.reduce((s,t)=>s+t.pnl,0));
  const profitFactor= totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 0;

  /* ── Best / Worst 5 ── */
  const sortedPnl = [...closed].sort((a,b) => b.pnl - a.pnl);
  const best5     = sortedPnl.slice(0, 5);
  const worst5    = sortedPnl.slice(-5).reverse();

  /* ── Equity curve & Max Drawdown ── */
  let peak = 0, maxDD = 0, cumPnl = 0;
  let maxDDDollar = 0;
  const equity = [];
  const sortedByDate = [...closed].sort((a,b) => {
    const da = a.date ? a.date.getTime() : 0;
    const db = b.date ? b.date.getTime() : 0;
    return da - db;
  });

  for (const t of sortedByDate) {
    cumPnl += t.pnl;
    equity.push({ date: t.date, val: cumPnl, ticker: t.ticker });
    if (cumPnl > peak) peak = cumPnl;
    const ddDollar = peak - cumPnl;
    const ddPct    = peak > 0 ? (ddDollar / peak) * 100 : 0;
    if (ddDollar > maxDDDollar) maxDDDollar = ddDollar;
    if (ddPct    > maxDD)       maxDD       = ddPct;
  }

  /* ── Sharpe Ratio (annualised, √252 daily) ── */
  // Use per-trade pnlPct if available, else compute from pnl relative to invested
  const returns = sortedByDate.map(t => {
    if (t.pnlPct !== 0) return t.pnlPct;
    if (t.entryPrice && t.qty) return (t.pnl / (t.entryPrice * t.qty)) * 100;
    return 0;
  }).filter(r => r !== 0);

  const meanR = returns.length ? returns.reduce((s,r)=>s+r,0)/returns.length : 0;
  const stdR  = returns.length > 1
    ? Math.sqrt(returns.reduce((s,r)=>s+(r-meanR)**2,0)/(returns.length-1))
    : 0;
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(252) : 0;

  /* ── Monthly P&L (use closeDate if available, else openDate) ── */
  const monthly = {};
  for (const t of sortedByDate) {
    const dt = t.closeDate || t.date;
    if (!dt) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    monthly[key] = (monthly[key] || 0) + t.pnl;
  }

  /* ── Ticker P&L breakdown ── */
  const byTicker = {};
  for (const t of closed) {
    if (!byTicker[t.ticker]) byTicker[t.ticker] = { pnl:0, count:0, wins:0, losses:0 };
    byTicker[t.ticker].pnl   += t.pnl;
    byTicker[t.ticker].count += 1;
    if (t.pnl > 0) byTicker[t.ticker].wins++;
    if (t.pnl < 0) byTicker[t.ticker].losses++;
  }
  const tickerBreakdown = Object.entries(byTicker)
    .map(([ticker,v])=>({ticker,...v}))
    .sort((a,b)=>b.pnl-a.pnl);

  /* ── Return % (overall) ── */
  const totalInvested   = trades.reduce((s,t)=>s+(t.entryPrice*t.qty||0),0);
  const totalReturnPct  = totalInvested > 0 ? (totalPnl/totalInvested)*100 : 0;
  // Closed return %
  const closedInvested  = closed.reduce((s,t)=>s+(t.entryPrice*t.qty||0),0);
  const closedReturnPct = closedInvested > 0 ? (closedPnl/closedInvested)*100 : 0;
  // Open return %
  const openInvested    = open.reduce((s,t)=>s+(t.entryPrice*t.qty||0),0);
  const openReturnPct   = openInvested > 0 ? (openPnl/openInvested)*100 : 0;

  /* ── Longest streak ── */
  let curStreak = 0, maxWinStreak = 0, maxLossStreak = 0, lossStreak = 0;
  for (const t of sortedByDate) {
    if (t.pnl > 0) { curStreak++; lossStreak=0; maxWinStreak=Math.max(maxWinStreak,curStreak); }
    else if (t.pnl < 0) { lossStreak++; curStreak=0; maxLossStreak=Math.max(maxLossStreak,lossStreak); }
    else { curStreak=0; lossStreak=0; }
  }

  return {
    totalPnl, closedPnl, openPnl, totalComm,
    totalTrades:   trades.length,
    closedCount:   closed.length,
    openCount:     open.length,
    winners:       winners.length,
    losers:        losers.length,
    breakeven:     breakev.length,
    winRate, avgWin, avgLoss, profitFactor,
    best5, worst5,
    maxDrawdown:   maxDD,
    maxDDDollar,
    sharpe,
    equity, monthly, tickerBreakdown,
    totalReturnPct, closedReturnPct, openReturnPct,
    totalInvested, closedInvested, openInvested,
    maxWinStreak, maxLossStreak,
  };
}

/* ────────────────────────────────────────────────────────────
   RENDER ANALYTICS PAGE
────────────────────────────────────────────────────────────── */
function renderTradingAnalytics() {
  const a = calcAnalytics(tradingTrades);
  renderTradingKPIs(a);
  renderTradingCharts(a);
  renderBestWorst(a);
  renderTickerTable(a);
  renderTradeTable(tradingTrades);
  renderMonthlyTable(a);

  document.getElementById('tradingResults').style.display = 'block';
  document.getElementById('tradingEmpty').style.display   = 'none';
}

function hideTradingResults() {
  const el = document.getElementById('tradingResults');
  if (el) el.style.display = 'none';
  const em = document.getElementById('tradingEmpty');
  if (em) em.style.display = 'flex';
}

/* ── KPI Cards ── */
function renderTradingKPIs(a) {
  const cur    = tradingTrades[0]?.currency || 'USD';
  const fmtM   = v => (v >= 0 ? '+' : '') + fmtNum(v) + ' ' + cur;
  const fmtP   = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtX   = v => v.toFixed(2) + 'x';

  const kpis = [
    {
      label: 'Общий P&L',
      value: fmtM(a.totalPnl),
      delta: fmtP(a.totalReturnPct) + ' доходность',
      up:    a.totalPnl >= 0, icon: 'fa-dollar-sign', color: 'blue'
    },
    {
      label: 'P&L Закрытые',
      value: fmtM(a.closedPnl),
      delta: a.closedCount + ' сделок · ' + fmtP(a.closedReturnPct),
      up:    a.closedPnl >= 0, icon: 'fa-check-circle', color: 'green'
    },
    {
      label: 'P&L Открытые',
      value: fmtM(a.openPnl),
      delta: a.openCount + ' позиций · ' + fmtP(a.openReturnPct),
      up:    a.openPnl >= 0, icon: 'fa-clock', color: 'orange'
    },
    {
      label: 'Win Rate',
      value: a.winRate.toFixed(1) + '%',
      delta: a.winners + 'W / ' + a.losers + 'L / ' + a.breakeven + 'B',
      up:    a.winRate >= 50, icon: 'fa-trophy', color: 'purple'
    },
    {
      label: 'Max Drawdown',
      value: a.maxDrawdown.toFixed(2) + '%',
      delta: '−' + fmtNum(a.maxDDDollar) + ' ' + cur,
      up:    false, icon: 'fa-arrow-trend-down', color: 'red'
    },
    {
      label: 'Sharpe Ratio',
      value: a.sharpe.toFixed(2),
      delta: a.sharpe >= 2 ? '🔥 Отлично' : a.sharpe >= 1 ? '✅ Хорошо' : '⚠️ Низкий',
      up:    a.sharpe >= 1, icon: 'fa-chart-line', color: 'teal'
    },
    {
      label: 'Profit Factor',
      value: fmtX(a.profitFactor),
      delta: 'Ср.выигрыш / Ср.убыток',
      up:    a.profitFactor >= 1.5, icon: 'fa-scale-balanced', color: 'blue'
    },
    {
      label: 'Комиссии',
      value: '−' + fmtNum(a.totalComm) + ' ' + cur,
      delta: 'Streak: ' + a.maxWinStreak + 'W / ' + a.maxLossStreak + 'L',
      up:    false, icon: 'fa-receipt', color: 'orange'
    },
  ];

  const colorMap = {
    blue:   'var(--accent-blue)',
    green:  'var(--accent-green)',
    orange: 'var(--accent-orange)',
    red:    'var(--accent-red)',
    purple: 'var(--accent-purple)',
    teal:   'var(--accent-teal)',
  };

  document.getElementById('tradingKPIs').innerHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="kpi-icon ${k.color}"><i class="fas ${k.icon}"></i></div>
      <div class="kpi-body">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-value" style="font-size:19px;color:${k.up ? colorMap.green : colorMap.red}">${k.value}</span>
        <span class="kpi-delta ${k.up ? 'up' : 'down'}">${k.delta}</span>
      </div>
    </div>`).join('');
}

/* ── Charts ── */
function renderTradingCharts(a) {
  destroyTradingCharts();

  /* 1. Equity Curve (line, gradient fill) */
  const eqCtx = document.getElementById('chartEquity');
  if (eqCtx && a.equity.length > 1) {
    tradingCharts.equity = new Chart(eqCtx, {
      type: 'line',
      data: {
        labels: a.equity.map(e => e.date ? e.date.toLocaleDateString('ru-RU') : '—'),
        datasets: [{
          label: 'Equity Curve',
          data: a.equity.map(e => +e.val.toFixed(2)),
          borderColor: '#3b82f6',
          backgroundColor: ctx => {
            const { ctx: c, chartArea } = ctx.chart;
            if (!chartArea) return 'rgba(59,130,246,0.1)';
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, 'rgba(59,130,246,0.25)');
            g.addColorStop(1, 'rgba(59,130,246,0.01)');
            return g;
          },
          fill: true, tension: 0.35,
          pointRadius: a.equity.length > 100 ? 0 : 2,
          pointHoverRadius: 5, borderWidth: 2.5,
        }]
      },
      options: chartOpts()
    });
  }

  /* 2. Monthly P&L Bar */
  const mCtx = document.getElementById('chartMonthly');
  if (mCtx && Object.keys(a.monthly).length) {
    const months = Object.keys(a.monthly).sort();
    const vals   = months.map(m => +a.monthly[m].toFixed(2));
    tradingCharts.monthly = new Chart(mCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: 'P&L по месяцам',
          data: vals,
          backgroundColor: vals.map(v => v >= 0 ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)'),
          borderColor:     vals.map(v => v >= 0 ? '#22c55e' : '#ef4444'),
          borderWidth: 1.5, borderRadius: 5,
        }]
      },
      options: chartOpts()
    });
  }

  /* 3. Win / Loss / Breakeven Doughnut */
  const wlCtx = document.getElementById('chartWinLoss');
  if (wlCtx) {
    const a2 = calcAnalytics(tradingTrades);
    tradingCharts.winloss = new Chart(wlCtx, {
      type: 'doughnut',
      data: {
        labels: ['Прибыльные', 'Убыточные', 'В ноль'],
        datasets: [{
          data: [a2.winners, a2.losers, a2.breakeven],
          backgroundColor: [
            'rgba(34,197,94,0.85)',
            'rgba(239,68,68,0.85)',
            'rgba(100,116,139,0.6)'
          ],
          borderColor: '#1c2333', borderWidth: 2, hoverOffset: 8,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#8a9bbf', font: { size: 11 }, padding: 12 } },
          tooltip: {
            callbacks: {
              label: c => ` ${c.label}: ${c.raw} сделок (${a2.closedCount > 0 ? ((c.raw/a2.closedCount)*100).toFixed(1) : 0}%)`
            }
          }
        }
      }
    });
  }

  /* 4. Ticker P&L Horizontal Bar (top 10) */
  const tkCtx = document.getElementById('chartTickers');
  if (tkCtx && a.tickerBreakdown.length) {
    const top10 = a.tickerBreakdown.slice(0, 10);
    tradingCharts.tickers = new Chart(tkCtx, {
      type: 'bar',
      data: {
        labels: top10.map(t => t.ticker),
        datasets: [{
          label: 'P&L по инструменту',
          data: top10.map(t => +t.pnl.toFixed(2)),
          backgroundColor: top10.map(t => t.pnl >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)'),
          borderColor:     top10.map(t => t.pnl >= 0 ? '#22c55e' : '#ef4444'),
          borderWidth: 1.5, borderRadius: 4,
        }]
      },
      options: { ...chartOpts(), indexAxis: 'y' }
    });
  }
}

function chartOpts() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index', intersect: false,
        callbacks: { label: c => ` ${c.dataset.label}: ${fmtNum(c.raw)}` }
      }
    },
    scales: {
      x: { ticks: { color: '#5a6b8a', maxRotation: 45 }, grid: { color: '#2a3448' } },
      y: { ticks: { color: '#5a6b8a' }, grid: { color: '#2a3448' } }
    }
  };
}

function destroyTradingCharts() {
  Object.values(tradingCharts).forEach(c => { try { c.destroy(); } catch(e){} });
  tradingCharts = {};
}

/* ── Best / Worst 5 ── */
function renderBestWorst(a) {
  const cur = tradingTrades[0]?.currency || '';
  const fmt = (t, rank, type) => `
    <div class="bw-item ${type}">
      <div class="bw-rank">${rank}</div>
      <div class="bw-info">
        <div class="bw-ticker">${t.ticker}</div>
        <div class="bw-date">${t.date ? t.date.toLocaleDateString('ru-RU') : '—'} · ${t.side} · ×${t.qty || '—'}</div>
      </div>
      <div class="bw-pnl ${t.pnl >= 0 ? 'pos' : 'neg'}">${t.pnl >= 0 ? '+' : ''}${fmtNum(t.pnl)} <small style="font-size:10px;opacity:.7">${cur}</small></div>
    </div>`;

  document.getElementById('bestTradesList').innerHTML  = a.best5.length  ? a.best5.map((t,i)=>fmt(t,i+1,'best')).join('')  : noData();
  document.getElementById('worstTradesList').innerHTML = a.worst5.length ? a.worst5.map((t,i)=>fmt(t,i+1,'worst')).join('') : noData();
}

/* ── Ticker Breakdown Table ── */
function renderTickerTable(a) {
  const maxAbsPnl = Math.max(...a.tickerBreakdown.map(t => Math.abs(t.pnl)), 1);
  const cur = tradingTrades[0]?.currency || '';
  const tbody = document.getElementById('tickerTableBody');
  tbody.innerHTML = a.tickerBreakdown.slice(0, 25).map((t, i) => `
    <tr>
      <td style="color:var(--text-muted);font-size:11px;width:28px">${i+1}</td>
      <td><strong style="color:var(--text-primary)">${t.ticker}</strong></td>
      <td style="text-align:center">${t.count}</td>
      <td style="text-align:center;font-size:11px;color:var(--text-muted)">${t.count > 0 ? ((t.wins/t.count)*100).toFixed(0)+'%' : '—'}</td>
      <td class="${t.pnl >= 0 ? 'td-pos' : 'td-neg'}" style="text-align:right">${t.pnl >= 0 ? '+' : ''}${fmtNum(t.pnl)} <span style="font-size:10px;opacity:.6">${cur}</span></td>
      <td style="text-align:right;color:var(--text-secondary)">${fmtNum(t.pnl/t.count)}</td>
      <td style="min-width:80px;padding-right:12px">
        <div class="mini-bar-wrap">
          <div class="mini-bar" style="width:${((Math.abs(t.pnl)/maxAbsPnl)*100).toFixed(1)}%;background:${t.pnl>=0?'var(--accent-green)':'var(--accent-red)'}"></div>
        </div>
      </td>
    </tr>`).join('');
}

/* ── Full Trade Log ── */
let tradeTableSort   = { col: 'date', asc: false };
let tradeTableFilter = { status: '', side: '', ticker: '' };

function renderTradeTable(trades) {
  let data = [...trades];
  if (tradeTableFilter.status) data = data.filter(t => t.status === tradeTableFilter.status);
  if (tradeTableFilter.side)   data = data.filter(t => t.side   === tradeTableFilter.side);
  if (tradeTableFilter.ticker) data = data.filter(t => t.ticker.toLowerCase().includes(tradeTableFilter.ticker.toLowerCase()));

  data.sort((a,b) => {
    let va = a[tradeTableSort.col], vb = b[tradeTableSort.col];
    if (va instanceof Date) va = va.getTime() || 0;
    if (vb instanceof Date) vb = vb.getTime() || 0;
    if (va === null || va === undefined) va = 0;
    if (vb === null || vb === undefined) vb = 0;
    return tradeTableSort.asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const badge = document.getElementById('tradeCountBadge');
  if (badge) badge.textContent = data.length + ' сделок';

  const tbody = document.getElementById('tradeTableBody');
  tbody.innerHTML = data.slice(0, 300).map(t => `
    <tr>
      <td style="color:var(--text-muted);font-size:11px;white-space:nowrap">
        ${t.date ? t.date.toLocaleDateString('ru-RU') : '—'}
      </td>
      <td><strong style="color:var(--text-primary)">${t.ticker}</strong></td>
      <td>
        <span class="badge ${t.side==='BUY'?'badge-green':t.side==='SELL'?'badge-red':''}" style="font-size:10px;padding:2px 7px">
          ${t.side}
        </span>
      </td>
      <td style="color:var(--text-secondary);text-align:right">${t.qty || '—'}</td>
      <td style="color:var(--text-secondary);text-align:right">${t.entryPrice ? t.entryPrice.toFixed(4) : '—'}</td>
      <td style="color:var(--text-secondary);text-align:right">${t.exitPrice  ? t.exitPrice.toFixed(4)  : '—'}</td>
      <td class="${t.pnl!==0 ? (t.pnl>=0?'td-pos':'td-neg') : ''}" style="text-align:right">
        ${t.pnl !== 0 ? (t.pnl >= 0 ? '+' : '') + fmtNum(t.pnl) : '—'}
      </td>
      <td class="${t.pnlPct !== 0 ? (t.pnlPct>=0?'td-pos':'td-neg') : ''}" style="text-align:right;font-size:11px">
        ${t.pnlPct !== 0 ? (t.pnlPct>=0?'+':'') + t.pnlPct.toFixed(2) + '%' : '—'}
      </td>
      <td style="color:var(--text-muted);text-align:right;font-size:11px">
        ${t.commission ? fmtNum(t.commission) : '0'}
      </td>
      <td>
        ${t.status === 'closed'
          ? '<span class="badge badge-green" style="font-size:10px">Закрыта</span>'
          : '<span class="badge badge-orange" style="font-size:10px">Открыта</span>'}
      </td>
    </tr>`).join('')
    || `<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:30px">Нет данных</td></tr>`;
}

/* ── Monthly Table ── */
function renderMonthlyTable(a) {
  const cur  = tradingTrades[0]?.currency || '';
  const vals = Object.values(a.monthly).map(Math.abs);
  const maxV = Math.max(...vals, 1);
  const months = Object.keys(a.monthly).sort();
  let running = 0;
  document.getElementById('monthlyTableBody').innerHTML = months.map(m => {
    const pnl = a.monthly[m];
    running += pnl;
    return `
      <tr>
        <td style="font-weight:700">${m}</td>
        <td class="${pnl >= 0 ? 'td-pos' : 'td-neg'}" style="text-align:right">${pnl >= 0 ? '+' : ''}${fmtNum(pnl)} <span style="font-size:10px;opacity:.6">${cur}</span></td>
        <td class="${running >= 0 ? 'td-pos' : 'td-neg'}" style="text-align:right">${running >= 0 ? '+' : ''}${fmtNum(running)}</td>
        <td style="min-width:80px">
          <div class="mini-bar-wrap">
            <div class="mini-bar" style="width:${((Math.abs(pnl)/maxV)*100).toFixed(1)}%;background:${pnl>=0?'var(--accent-green)':'var(--accent-red)'}"></div>
          </div>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">Нет данных</td></tr>`;
}

/* ── Filters ── */
function setTradeFilter(key, val) {
  tradeTableFilter[key] = val;
  renderTradeTable(tradingTrades);
}
function searchTrades(q) {
  tradeTableFilter.ticker = q;
  renderTradeTable(tradingTrades);
}

/* ── Status message ── */
function showTradingStatus(type, msg) {
  const el = document.getElementById('tradingUploadStatus');
  if (!el) return;
  el.className   = 'upload-status ' + type;
  el.textContent = msg;
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ── Number formatter ── */
function fmtNum(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1_000_000) return sign + (abs/1_000_000).toFixed(2) + 'M';
  if (abs >= 1_000)     return sign + (abs/1_000).toFixed(1)     + 'K';
  return sign + abs.toFixed(2);
}

function noData() {
  return '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">—</div>';
}

/* ────────────────────────────────────────────────────────────
   DEMO DATA — 90 realistic closed + 6 open positions
────────────────────────────────────────────────────────────── */
function loadDemoData() {
  const tickers = [
    'AAPL','MSFT','TSLA','NVDA','AMZN','GOOGL','META',
    'SBER','YNDX','GAZP','LKOH','TCSG',
    'BTC/USD','ETH/USD','XAUUSD','EURUSD'
  ];
  const sides   = ['BUY','SELL'];
  const markets = ['NASDAQ','NYSE','MOEX','CRYPTO'];
  const now     = new Date();
  tradingTrades = [];

  // Closed trades (90 trades over past ~9 months)
  for (let i = 0; i < 90; i++) {
    const d      = new Date(now);
    d.setDate(d.getDate() - (90 - i) * 3);
    const ticker = tickers[Math.floor(Math.random() * tickers.length)];
    const isBuy  = Math.random() > 0.42;
    const qty    = Math.floor(Math.random() * 200) + 10;
    const price  = 20 + Math.random() * 800;
    // slight positive bias to simulate a decent strategy
    const move   = (Math.random() - 0.44) * price * 0.035;
    const pnl    = +(move * qty).toFixed(2);
    const comm   = +(qty * 0.005 + 0.5).toFixed(2);
    const closeD = new Date(d.getTime() + 86_400_000 * (1 + Math.floor(Math.random() * 4)));

    tradingTrades.push({
      id: i, date: d, closeDate: closeD,
      ticker, side: isBuy ? 'BUY' : 'SELL',
      qty, entryPrice: +price.toFixed(4), exitPrice: +(price + move).toFixed(4),
      pnl, pnlPct: +((pnl / (price * qty)) * 100).toFixed(3),
      commission: comm, status: 'closed',
      currency: ticker.includes('/') || ticker.includes('USD') ? 'USD' : (ticker.length === 4 ? 'RUB' : 'USD'),
      market: markets[Math.floor(Math.random() * markets.length)], comment: '',
    });
  }

  // Open positions (6 positions)
  for (let i = 0; i < 6; i++) {
    const d      = new Date(now);
    d.setDate(d.getDate() - i - 1);
    const ticker = tickers[Math.floor(Math.random() * 8)]; // NASDAQ/NYSE only
    const qty    = Math.floor(Math.random() * 100) + 10;
    const price  = 100 + Math.random() * 400;
    const float  = +((Math.random() - 0.38) * price * qty * 0.025).toFixed(2);
    tradingTrades.push({
      id: 100 + i, date: d, closeDate: null,
      ticker, side: 'BUY', qty,
      entryPrice: +price.toFixed(4), exitPrice: 0,
      pnl: float, pnlPct: +((float / (price * qty)) * 100).toFixed(3),
      commission: 0, status: 'open',
      currency: 'USD', market: 'NASDAQ', comment: '',
    });
  }

  tradingFileName = 'demo_data';
  showTradingStatus('success', `✅ Демо-данные загружены: ${tradingTrades.length} сделок (90 закрытых, 6 открытых)`);
  renderTradingAnalytics();
}
