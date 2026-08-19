// Pure-function unit tests for server/waterfallEngine.js — no server/DB
// needed, unlike every other test\*.js in this project, since this module
// takes plain objects/arrays and returns plain numbers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  accruePreferredReturn, applyProfitTiers, replayWaterfallState, computeDistributionSplit,
} = require('../waterfallEngine');

function closeTo(actual, expected, tolerance = 0.01, msg) {
  assert.ok(Math.abs(actual - expected) <= tolerance, msg || `expected ${actual} to be close to ${expected}`);
}

test('accruePreferredReturn: simple (non-compounding) interest on outstanding capital over one year', () => {
  const accrued = accruePreferredReturn(10, [{ date: '2025-01-01', delta: 1000 }], '2026-01-01');
  closeTo(accrued, 100, 0.5, '10% simple interest on $1000 over 1 year = $100');
});

test('accruePreferredReturn: a return-of-capital repayment stops accrual on the returned portion', () => {
  const events = [
    { date: '2025-01-01', delta: 1000 },
    { date: '2025-07-01', delta: -1000 }, // fully returned halfway through the year
  ];
  const accrued = accruePreferredReturn(10, events, '2026-01-01');
  // ~10% on $1000 for ~6 months only, nothing accrues on the other 6
  // months since outstanding capital was 0 by then.
  closeTo(accrued, 50, 1, 'accrual must stop once the underlying capital is returned');
});

test('applyProfitTiers: preferred owed fully satisfied and enough profit to complete GP catch-up — GP lands exactly at carriedInterestPct of total profit', () => {
  const result = applyProfitTiers({
    profitAmount: 2000, prefAccruedToDate: 1000, carriedInterestPct: 20, catchUpPct: 100,
    state: { cumLpPrefPaid: 0, cumGpCatchupPaid: 0 },
  });
  assert.equal(result.lpTotal + result.gpTotal, 2000, 'no leakage: every dollar of profit is allocated');
  closeTo(result.gpTotal, 400, 0.01, 'GP should land at exactly 20% of the $2000 profit once catch-up completes');
  closeTo(result.lpTotal, 1600, 0.01);
});

test('applyProfitTiers: not enough profit to complete catch-up — GP gets less than its full target carry ratio', () => {
  const result = applyProfitTiers({
    profitAmount: 1100, prefAccruedToDate: 1000, carriedInterestPct: 20, catchUpPct: 100,
    state: { cumLpPrefPaid: 0, cumGpCatchupPaid: 0 },
  });
  assert.equal(result.lpTotal + result.gpTotal, 1100);
  closeTo(result.lpTotal, 1000, 0.01, 'all $1000 owed preferred goes to LPs first');
  closeTo(result.gpTotal, 100, 0.01, 'the remaining $100 all goes to GP catch-up, which is still short of its $250 target');
  closeTo(result.newState.cumGpCatchupPaid, 100, 0.01);
});

test('applyProfitTiers: a partial (50%) catch-up fraction reaches GP\'s target more slowly than a 100% catch-up', () => {
  const full = applyProfitTiers({
    profitAmount: 2000, prefAccruedToDate: 1000, carriedInterestPct: 20, catchUpPct: 100,
    state: { cumLpPrefPaid: 0, cumGpCatchupPaid: 0 },
  });
  const partial = applyProfitTiers({
    profitAmount: 2000, prefAccruedToDate: 1000, carriedInterestPct: 20, catchUpPct: 50,
    state: { cumLpPrefPaid: 0, cumGpCatchupPaid: 0 },
  });
  assert.equal(partial.lpTotal + partial.gpTotal, 2000, 'no leakage: every dollar of profit is allocated');
  // Half of each catch-up-tier dollar now goes to LPs instead of GP, so
  // for the SAME total profit, GP ends up with less than in the full
  // (100%) catch-up case — it needs more total distributed dollars to
  // reach the same target, not just more of this one.
  assert.ok(partial.gpTotal < full.gpTotal, `partial catch-up ($${partial.gpTotal}) must yield GP less than full catch-up ($${full.gpTotal}) for the same profit amount`);
  closeTo(partial.gpTotal, 350, 0.01, 'hand-verified: tier1 $1000 (0 carry) -> tier2 $500 total ($250 GP/$250 LP) -> tier3 $500 remaining (20/80 split, $100 GP/$400 LP) = $350 GP');
});

test('replayWaterfallState + computeDistributionSplit: state threads correctly across two distributions, converging on the target carry ratio', () => {
  // $10,000 contributed 2025-01-01, 10% simple preferred — accrues to
  // exactly $1000 by 2026-01-01 (365 days), matching the applyProfitTiers
  // tests above so the arithmetic is hand-verifiable.
  const fund = { preferredReturn: 10, carriedInterest: 20, catchUpPct: 100 };
  const activeLps = [{ id: 1, commitment: 1000 }];
  const ledgerEvents = [{ date: '2025-01-01', delta: 10000 }];

  // First distribution: same "not enough profit to complete catch-up" case
  // as the standalone applyProfitTiers test above, now through the full
  // replay/split path — GP should land at exactly $100.
  const first = computeDistributionSplit({
    fund, activeLps, ledgerEvents, priorDistributions: [],
    rocAmount: 0, profitAmount: 1100, distDate: '2026-01-01',
  });
  closeTo(first.waterfall.gpCarryTotal, 100, 0.01);

  // Second distribution, same date (no further accrual between the two,
  // isolating the cross-distribution state-threading from the date-based
  // accrual math already covered separately) — must resume catch-up from
  // where the first left off ($250 target, $100 already paid = $150 more
  // needed) before the final carry-split tier can run.
  const priorDistributions = [{ status: 'Sent', profitAmount: 1100, rocAmount: 0, date: '2026-01-01' }];
  const second = computeDistributionSplit({
    fund, activeLps, ledgerEvents, priorDistributions,
    rocAmount: 0, profitAmount: 1000, distDate: '2026-01-01',
  });
  closeTo(second.waterfall.gpCarryTotal, 150 + 850 * 0.2, 0.01, '$150 finishes catch-up, remaining $850 splits 20/80');

  // Across both distributions combined, GP's total share of all profit
  // ever distributed should now sit at exactly the target 20% — the whole
  // point of a catch-up tier.
  const totalProfit = 1100 + 1000;
  const totalGp = first.waterfall.gpCarryTotal + second.waterfall.gpCarryTotal;
  closeTo(totalGp / totalProfit, 0.20, 0.001, 'cumulative GP carry ratio must converge on the fund\'s target carriedInterestPct');
});

test('computeDistributionSplit: pure ROC (profitAmount 0) carries zero GP carry and splits by commitment only', () => {
  const fund = { preferredReturn: 8, carriedInterest: 20, catchUpPct: 100 };
  const activeLps = [{ id: 1, commitment: 3000 }, { id: 2, commitment: 1000 }];
  const { lineItems } = computeDistributionSplit({
    fund, activeLps, ledgerEvents: [], priorDistributions: [],
    rocAmount: 400, profitAmount: 0, distDate: '2026-01-01',
  });
  const a = lineItems.find(li => li.lpId === 1);
  const b = lineItems.find(li => li.lpId === 2);
  assert.equal(a.gpCarryAmount, 0);
  assert.equal(b.gpCarryAmount, 0);
  closeTo(a.netAmount, 300, 0.01);
  closeTo(b.netAmount, 100, 0.01);
});

test('computeDistributionSplit: multiple LPs + profitAmount > 0 — the same carry ratio applies to every LP\'s profit share, and the per-LP breakdown reconciles exactly to the total', () => {
  // preferredReturn: 0 and an empty ledger deliberately isolate the
  // pro-rata/carry-ratio math from the date-based accrual already covered
  // by the accruePreferredReturn/applyProfitTiers tests above — nothing
  // is owed, so profit runs straight to the final 20/80 carry-split tier.
  const fund = { preferredReturn: 0, carriedInterest: 20, catchUpPct: 100 };
  const activeLps = [{ id: 1, commitment: 3000 }, { id: 2, commitment: 1000 }]; // 75% / 25%
  const rocAmount = 400, profitAmount = 1000;
  const { lineItems } = computeDistributionSplit({
    fund, activeLps, ledgerEvents: [], priorDistributions: [],
    rocAmount, profitAmount, distDate: '2026-01-01',
  });
  const a = lineItems.find(li => li.lpId === 1); // 75%: $300 ROC + $750 profit
  const b = lineItems.find(li => li.lpId === 2); // 25%: $100 ROC + $250 profit

  // Hand-verified: profit's carry ratio is a flat 20% (no preferred/
  // catch-up in play), applied to EACH LP's own profit share individually.
  closeTo(a.gpCarryAmount, 150, 0.01, '20% of LP A\'s $750 profit share');
  closeTo(b.gpCarryAmount, 50, 0.01, '20% of LP B\'s $250 profit share');
  closeTo(a.netAmount, 900, 0.01, '$300 ROC + $750 profit - $150 carry');
  closeTo(b.netAmount, 300, 0.01, '$100 ROC + $250 profit - $50 carry');

  // Reconciliation across the whole LP array — the same guarantee
  // POST /api/distributions enforces server-side (server/index.js), now
  // verified at the engine level directly, independent of the HTTP layer.
  const sumNet   = lineItems.reduce((s, li) => s + li.netAmount, 0);
  const sumCarry = lineItems.reduce((s, li) => s + li.gpCarryAmount, 0);
  closeTo(sumNet + sumCarry, rocAmount + profitAmount, 0.01, 'sum(net) + sum(carry) across all LPs must equal the total distributed');
});
