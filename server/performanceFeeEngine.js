// server/performanceFeeEngine.js
//
// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 3 — crystallizes
// performance fee against a per-investor high-water mark (HWM), the
// Series-accounting-flavored approach this project committed to in
// docs/TZ_Hedge_Fund_Module.md §3 (option B: HWM lives on
// hf_investor_positions, one row per (fund, lp), not per-fund — see that
// file for why Equalization was rejected). Pure functions only, no DB
// access — same "pure math, unit-testable in isolation" split as
// waterfallEngine.js/metricsEngine.js; server/index.js's
// POST /api/hf/fee-crystallization/run is the only caller, and owns all
// the reading/writing.
//
// The one rule this whole file exists to get right (docs/TZ_Hedge_Fund_
// Module.md §3's own required test case): an investor who enters at
// NAV=100, sees a drawdown to 90 (no fee — loss), a partial recovery to 95
// (still below their 100 HWM — no fee, despite growing from 90 to 95), and
// finally a rise to 110 owes fee ONLY on the 10 of gain above their
// standing HWM (100), never on the 15 "recovery-inclusive" delta from
// their lowest point. gainPerUnit is always max(0, navPerUnitEnd -
// hwmBefore) — hwmBefore is the STANDING mark, never last period's NAV.

const MS_PER_DAY = 86400000;

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / MS_PER_DAY;
}

// One investor position's crystallization at a single point in time.
// hurdleRatePct is annualized (e.g. 5 = 5%/year); a hard hurdle applied
// only to the slice of gain that's actually above the HWM — the GP earns
// nothing on the first hurdleRatePct%/year (prorated over periodDays,
// accrued on the standing HWM as the base) of that gain, same convention
// as a fund-level hurdle in a closed-end waterfall (accrued simple
// interest, not compounded — see waterfallEngine.js's accruePreferredReturn
// for the same non-compounding choice and why it's easier to audit).
function computeFeeCrystallization({
  navPerUnitEnd,
  hwmBefore,
  unitsHeld,
  performanceFeePct,
  hurdleRatePct = 0,
  periodDays = 0,
}) {
  let gainPerUnit = Math.max(0, navPerUnitEnd - hwmBefore);
  let hurdleAccrued = 0;
  if (hurdleRatePct > 0 && gainPerUnit > 0 && periodDays > 0) {
    hurdleAccrued = hwmBefore * (hurdleRatePct / 100) * (periodDays / 365);
    gainPerUnit = Math.max(0, gainPerUnit - hurdleAccrued);
  }
  const feeAmount = gainPerUnit * unitsHeld * ((performanceFeePct || 0) / 100);
  // The investor "pays" in units (redeemed at the same NAV that triggered
  // the fee) rather than cash leaving the fund — the GP's economic
  // interest then shows up as a smaller units_held for this LP going
  // forward, same logic docs/TZ_Hedge_Fund_Module.md §3's pseudocode uses.
  const unitsDeductedForFee = navPerUnitEnd > 0 ? feeAmount / navPerUnitEnd : 0;
  // HWM only ever moves up, and only to navPerUnitEnd itself — never to
  // hwmBefore + gainPerUnit (which would double-count the hurdle carve-out
  // as if it were a permanent floor instead of a one-time discount on this
  // crystallization's fee).
  const hwmAfter = Math.max(hwmBefore, navPerUnitEnd);
  return { gainPerUnit, hurdleAccrued, feeAmount, unitsDeductedForFee, hwmAfter };
}

module.exports = { computeFeeCrystallization, daysBetween, MS_PER_DAY };
