// server/waterfallEngine.js
//
// European (whole-fund) waterfall with a simple, non-compounding preferred
// return — deliberately not IRR/XIRR: an LPA-style flat annual accrual on
// unreturned capital is far easier to audit line-by-line than a numerical
// IRR solver, and is a real, common formulation (not a shortcut invented
// for this codebase). Only handles the PROFIT portion of a distribution —
// return-of-capital (rocAmount) never carries GP carry and needs no
// waterfall math, so it stays a straight pro-rata-by-commitment split
// exactly as it always has been (this file just centralizes that alongside
// the new profit math so callers get one combined per-LP line-item split).
//
// Tiers, in order, for a given distribution's profitAmount:
//   1. LP preferred return catch-up — 100% to LPs (pro-rata by commitment)
//      until they've collectively received the preferred return accrued
//      on their unreturned capital to date (funds.preferred_return, % p.a.,
//      simple interest).
//   2. GP catch-up — catchUpPct% of each dollar to GP (rest to LPs), until
//      GP's cumulative catch-up equals carriedInterestPct% of (LP
//      preferred paid + GP catch-up paid) so far — the standard formula
//      for a GP to "catch up" to its target carry ratio. catchUpPct=100
//      (funds.catch_up_pct's default) is a full catch-up, the common case.
//   3. Final carry split — remaining profit split carriedInterestPct% to
//      GP, the rest to LPs (pro-rata by commitment).
//
// Because there's no separate column tracking which historical dollar
// went to which tier (distribution_line_items only stores the net
// gross/carry/net result), correctness for a fund's 2nd+ distribution
// requires REPLAYING every prior distribution through these same tiers in
// chronological order to rebuild the running state (cumulative LP
// preferred paid, cumulative GP catch-up paid) — see replayWaterfallState
// below. This is a pure function of recorded facts (capital calls +
// distributions), so it's always re-derivable and never drifts, at the
// cost of being O(distributions) per call — fine at fund-administration
// volumes (tens of distributions over a fund's life, not thousands).

const MS_PER_DAY = 86400000;

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / MS_PER_DAY;
}

// Simple-interest preferred return accrued on a fund's outstanding
// (unreturned) contributed capital, from the earliest ledger event up to
// `uptoDate`. ledgerEvents: [{date, delta}], delta > 0 for a contribution
// (capital in), delta < 0 for a return-of-capital repayment (capital back
// out) — profit/preferred/carry payouts do NOT reduce outstanding, since
// they're a return ON capital, not OF capital.
function accruePreferredReturn(prefRatePct, ledgerEvents, uptoDate) {
  const rate = (prefRatePct || 0) / 100;
  const sorted = ledgerEvents.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  let outstanding = 0;
  let accrued = 0;
  let prevDate = null;
  for (const ev of sorted) {
    if (prevDate) {
      const days = daysBetween(prevDate, ev.date);
      if (days > 0) accrued += outstanding * rate * (days / 365);
    }
    outstanding += ev.delta;
    prevDate = ev.date;
  }
  if (prevDate) {
    const days = daysBetween(prevDate, uptoDate);
    if (days > 0) accrued += outstanding * rate * (days / 365);
  }
  return accrued;
}

// One distribution's profit run through the three tiers above, given the
// running state from every prior distribution. Returns the dollar amounts
// per tier plus the updated state for the next distribution to replay
// against.
function applyProfitTiers({ profitAmount, prefAccruedToDate, carriedInterestPct, catchUpPct, state }) {
  const targetGpShare = (carriedInterestPct || 0) / 100;
  const catchUpGpFraction = Math.min(1, Math.max(0, (catchUpPct != null ? catchUpPct : 100) / 100));
  let remaining = profitAmount;

  // Tier 1: LP preferred catch-up.
  const prefOutstanding = Math.max(0, prefAccruedToDate - state.cumLpPrefPaid);
  const tier1Lp = Math.min(remaining, prefOutstanding);
  remaining -= tier1Lp;
  const cumLpPrefPaid = state.cumLpPrefPaid + tier1Lp;

  // Tier 2: GP catch-up — GP's cumulative catch-up should reach
  // targetGpShare/(1-targetGpShare) of cumulative LP preferred paid (the
  // standard 100%-catchup formula; catchUpGpFraction<1 just spreads the
  // same target more slowly across more distributed dollars).
  let tier2Gp = 0, tier2Lp = 0;
  if (targetGpShare > 0 && targetGpShare < 1 && catchUpGpFraction > 0) {
    const gpCatchUpTarget = (targetGpShare / (1 - targetGpShare)) * cumLpPrefPaid;
    const gpCatchUpNeeded = Math.max(0, gpCatchUpTarget - state.cumGpCatchupPaid);
    const tier2Total = Math.min(remaining, gpCatchUpNeeded / catchUpGpFraction);
    tier2Gp = tier2Total * catchUpGpFraction;
    tier2Lp = tier2Total - tier2Gp;
    remaining -= tier2Total;
  }
  const cumGpCatchupPaid = state.cumGpCatchupPaid + tier2Gp;

  // Tier 3: final carry split on whatever profit remains.
  const tier3Gp = remaining * targetGpShare;
  const tier3Lp = remaining - tier3Gp;

  return {
    lpTotal: tier1Lp + tier2Lp + tier3Lp,
    gpTotal: tier2Gp + tier3Gp,
    newState: { cumLpPrefPaid, cumGpCatchupPaid },
  };
}

// Replays every prior (non-Draft) distribution through applyProfitTiers,
// in chronological order, to rebuild the {cumLpPrefPaid, cumGpCatchupPaid}
// state as of just before the new distribution being created — see the
// file header for why this can't just be a stored running total.
//
// Each prior distribution `d` is replayed against the terms actually in
// effect WHEN IT WAS CREATED (d.preferredReturn/carriedInterest/
// catchUpPct, snapshotted onto the row at creation time — see
// server/index.js's POST /api/distributions), not the fund's CURRENT
// terms. Retroactivity bug fixed here (QA Data Integrity audit): if a
// fund's carry/preferred-return/catch-up changed after several
// distributions had already gone out, the old code replayed ALL of them
// as if the new terms had always applied, shifting where the running
// tier state — and therefore the NEXT distribution's split — actually
// starts from. `d.preferredReturn`/etc. fall back to the passed-in
// `fund`'s current terms only for legacy distributions created before
// this snapshot existed (their own values are null) — there is no way
// to recover what terms actually applied to those, so this is the
// closest honest answer, not a silent behavior change for old data.
function replayWaterfallState({ fund, ledgerEvents, priorDistributions }) {
  let state = { cumLpPrefPaid: 0, cumGpCatchupPaid: 0 };
  const ordered = priorDistributions
    .filter((d) => d.status !== 'Draft' && (d.profitAmount || 0) > 0)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const d of ordered) {
    const preferredReturn = d.preferredReturn != null ? d.preferredReturn : fund.preferredReturn;
    const carriedInterestPct = d.carriedInterest != null ? d.carriedInterest : fund.carriedInterest;
    const catchUpPct = d.catchUpPct != null ? d.catchUpPct : fund.catchUpPct;
    const prefAccruedToDate = accruePreferredReturn(preferredReturn, ledgerEvents, d.date);
    const result = applyProfitTiers({
      profitAmount: d.profitAmount, prefAccruedToDate,
      carriedInterestPct, catchUpPct, state,
    });
    state = result.newState;
  }
  return state;
}

// The single entry point callers use: given a fund, its Active LPs, the
// full paid-contribution + prior-ROC ledger, and this new distribution's
// rocAmount/profitAmount/date, returns one combined per-LP line-item split
// (pct/grossAmount/gpCarryAmount/netAmount — the exact shape
// distribution_line_items expects). rocAmount is split pro-rata by
// commitment with zero carry, unchanged from the original Stage-1
// behavior; profitAmount runs through the tiers above and is allocated
// pro-rata by commitment within each tier (correct under a pooled
// European/whole-fund waterfall, where every LP shares the same carry
// ratio on their slice of the profit pool).
function computeDistributionSplit({ fund, activeLps, ledgerEvents, priorDistributions, rocAmount, profitAmount, distDate }) {
  const totalCommit = activeLps.reduce((s, l) => s + (l.commitment || 0), 0);

  let lpProfitTotal = 0, gpCarryTotal = 0;
  if (profitAmount > 0) {
    const state = replayWaterfallState({ fund, ledgerEvents, priorDistributions });
    const prefAccruedToDate = accruePreferredReturn(fund.preferredReturn, ledgerEvents, distDate);
    const result = applyProfitTiers({
      profitAmount, prefAccruedToDate,
      carriedInterestPct: fund.carriedInterest, catchUpPct: fund.catchUpPct, state,
    });
    lpProfitTotal = result.lpTotal;
    gpCarryTotal = result.gpTotal;
  }
  // Same ratio applies to every LP's profit slice (pooled waterfall) — see
  // file header. profitAmount is 0-safe: carryRatio stays 0, matching the
  // old pure-ROC behavior exactly.
  const carryRatio = profitAmount > 0 ? gpCarryTotal / profitAmount : 0;

  const lineItems = activeLps.map((l) => {
    const share = totalCommit ? (l.commitment || 0) / totalCommit : 0;
    const rocShare = rocAmount * share;
    const profitShare = profitAmount * share;
    const gross = rocShare + profitShare;
    const carry = profitShare * carryRatio;
    return {
      lpId: l.id, pct: share * 100,
      grossAmount: gross, gpCarryAmount: carry, netAmount: gross - carry,
    };
  });

  return { lineItems, waterfall: { lpProfitTotal, gpCarryTotal } };
}

module.exports = { computeDistributionSplit, accruePreferredReturn, applyProfitTiers, replayWaterfallState };
