// server/metricsEngine.js
//
// Real fund/LP performance metrics — DPI, RVPI, TVPI, IRR — the reason the
// Distributions module was built in the first place. Previously the
// dashboard's "Текущий IRR" tile deliberately showed "Расчёт недоступен"
// (js/app.js) rather than a fake number, because there was no real,
// dated capital-call/distribution history to compute it from. Now there is.
//
// Definitions (standard LP-facing PE metrics, net of GP carry — i.e. what
// an LP actually paid in and actually received, not the fund's gross
// economics):
//   Paid-in    = cumulative capital actually called and paid by the LP(s).
//   Distributed = cumulative cash actually received by the LP(s) (net of
//                 any GP carry carved out of their share).
//   Residual value = current unrealized value attributable to the LP(s) —
//                 sum(portfolio.value) for the fund, same NAV proxy the
//                 dashboard's existing MOIC tile already uses (funds.nav
//                 is a separate, currently-unused column — see js/app.js's
//                 MOIC calc, which reads portfolio.value, not funds.nav).
//   DPI  = Distributed / Paid-in            ("cash-on-cash" so far)
//   RVPI = Residual value / Paid-in         (what's left, unrealized)
//   TVPI = DPI + RVPI                       (total value multiple)
//   IRR  = the annualized rate that discounts every dated paid-in (-) and
//          distributed (+) cash flow, plus residual value as a final (+)
//          cash flow on asOfDate, to a net present value of zero (XIRR —
//          real dates, not a fixed period assumption, since capital calls
//          and distributions never land on a neat annual schedule).
//
// All four are `null` (not 0, not NaN) when there isn't enough data to
// mean anything — e.g. DPI/RVPI/TVPI need Paid-in > 0; IRR needs at least
// one negative and one positive cash flow, and the bisection solver itself
// can fail to converge for a pathological cash-flow shape. A null metric
// must render as "no data" in the UI, never as 0% or 0.00x — those are
// real, different answers.

const MS_PER_DAY = 86400000;

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / MS_PER_DAY;
}

// Net present value of a set of dated cash flows at annual rate `rate`,
// discounted from `d0` (the earliest cash flow's date).
function xnpv(rate, cashflows, d0) {
  return cashflows.reduce((sum, cf) => sum + cf.amount / Math.pow(1 + rate, daysBetween(d0, cf.date) / 365), 0);
}

// Bisection, not Newton-Raphson: guaranteed to converge given a sign
// change in the search range, with no risk of diverging or oscillating
// near an inflection in the NPV curve the way Newton-Raphson can — worth
// the extra iterations for a metric real investors will read as fact.
// Returns null (not an error, not a guess) if no real IRR exists for
// these cash flows (all same sign) or the solver can't bracket one within
// a generous [-99.99%, +10000%] annual range.
function xirr(cashflows) {
  if (!cashflows || cashflows.length < 2) return null;
  const sorted = cashflows.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const d0 = sorted[0].date;
  const hasNeg = sorted.some((cf) => cf.amount < 0);
  const hasPos = sorted.some((cf) => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  let lo = -0.9999, hi = 100;
  let fLo = xnpv(lo, sorted, d0);
  let fHi = xnpv(hi, sorted, d0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) {
    hi = 10000; // very rare (e.g. a near-instant multi-bagger) — one more try before giving up
    fHi = xnpv(hi, sorted, d0);
    if (!Number.isFinite(fHi) || fLo * fHi > 0) return null;
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid, sorted, d0);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-6) return mid;
    if ((fLo < 0) === (fMid < 0)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// paidInEvents/distributedEvents: [{amount, date}] (amount > 0 in both —
// sign is applied here, callers don't need to think about IRR sign
// convention). residualValue: current unrealized value, as of asOfDate.
function computeMetrics({ paidInEvents, distributedEvents, residualValue, asOfDate }) {
  const paidIn = paidInEvents.reduce((s, e) => s + e.amount, 0);
  const distributed = distributedEvents.reduce((s, e) => s + e.amount, 0);

  const dpi = paidIn > 0 ? distributed / paidIn : null;
  const rvpi = paidIn > 0 ? residualValue / paidIn : null;
  const tvpi = paidIn > 0 ? (distributed + residualValue) / paidIn : null;

  // IRR is the only one of these four that actually needs a date per
  // event — DPI/RVPI/TVPI just need the amount, so an event with no known
  // date still counts toward those totals above; it's only left out of
  // the XIRR cash-flow list here (an undated dollar can't be placed on a
  // timeline, but it indisputably still moved).
  const cashflows = [
    ...paidInEvents.filter((e) => e.date).map((e) => ({ date: e.date, amount: -e.amount })),
    ...distributedEvents.filter((e) => e.date).map((e) => ({ date: e.date, amount: e.amount })),
  ];
  if (residualValue > 0) cashflows.push({ date: asOfDate, amount: residualValue });
  const irr = xirr(cashflows);

  return { paidIn, distributed, residualValue, dpi, rvpi, tvpi, irr };
}

// Fund-level (all LPs pooled) — db is the caller's already-open node:sqlite
// handle, tenantId/fundId scope every query, asOfDate defaults to today.
function computeFundMetrics(db, tenantId, fundId, asOfDate = new Date().toISOString().slice(0, 10)) {
  const paidInEvents = db.prepare(`
    SELECT li.paid AS amount, li.payment_date AS date
    FROM capital_call_line_items li JOIN capital_calls cc ON cc.id = li.call_id
    WHERE li.tenant_id = ? AND cc.fund_id = ? AND cc.status != 'Draft' AND li.paid > 0
  `).all(tenantId, fundId);
  const distributedEvents = db.prepare(`
    SELECT dli.net_amount AS amount, COALESCE(dli.payment_date, d.payment_date, d.notice_date) AS date
    FROM distribution_line_items dli JOIN distributions d ON d.id = dli.distribution_id
    WHERE dli.tenant_id = ? AND d.fund_id = ? AND d.status != 'Draft' AND dli.net_amount > 0
  `).all(tenantId, fundId);
  const residualValue = db.prepare(`
    SELECT COALESCE(SUM(value), 0) AS s FROM portfolio WHERE tenant_id = ? AND fund_id = ? AND archived = 0
  `).get(tenantId, fundId).s;

  return computeMetrics({ paidInEvents, distributedEvents, residualValue, asOfDate });
}

// LP-level — same shape, scoped to one LP's own contributions/
// distributions, with the fund's residual value allocated pro-rata by
// commitment (the same pooled-by-commitment convention already used for
// ROC and the waterfall — see waterfallEngine.js).
function computeLpMetrics(db, tenantId, lpId, asOfDate = new Date().toISOString().slice(0, 10)) {
  const lp = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(lpId, tenantId);
  if (!lp) return null;

  const paidInEvents = db.prepare(`
    SELECT li.paid AS amount, li.payment_date AS date
    FROM capital_call_line_items li JOIN capital_calls cc ON cc.id = li.call_id
    WHERE li.tenant_id = ? AND li.lp_id = ? AND cc.status != 'Draft' AND li.paid > 0
  `).all(tenantId, lpId);
  const distributedEvents = db.prepare(`
    SELECT dli.net_amount AS amount, COALESCE(dli.payment_date, d.payment_date, d.notice_date) AS date
    FROM distribution_line_items dli JOIN distributions d ON d.id = dli.distribution_id
    WHERE dli.tenant_id = ? AND dli.lp_id = ? AND d.status != 'Draft' AND dli.net_amount > 0
  `).all(tenantId, lpId);

  let residualValue = 0;
  if (lp.fund_id) {
    const fundResidual = db.prepare(`
      SELECT COALESCE(SUM(value), 0) AS s FROM portfolio WHERE tenant_id = ? AND fund_id = ? AND archived = 0
    `).get(tenantId, lp.fund_id).s;
    const totalCommit = db.prepare(`
      SELECT COALESCE(SUM(commitment), 0) AS s FROM lp_register WHERE tenant_id = ? AND fund_id = ? AND status = 'Active'
    `).get(tenantId, lp.fund_id).s;
    residualValue = totalCommit > 0 ? fundResidual * (lp.commitment / totalCommit) : 0;
  }

  return computeMetrics({ paidInEvents, distributedEvents, residualValue, asOfDate });
}

module.exports = { xirr, computeMetrics, computeFundMetrics, computeLpMetrics };
