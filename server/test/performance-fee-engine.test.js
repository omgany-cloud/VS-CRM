// Pure-function unit tests for server/performanceFeeEngine.js — no
// server/DB needed, same reasoning as waterfall-engine.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFeeCrystallization } = require('../performanceFeeEngine');

function closeTo(actual, expected, tolerance = 0.01, msg) {
  assert.ok(Math.abs(actual - expected) <= tolerance, msg || `expected ${actual} to be close to ${expected}`);
}

// docs/TZ_Hedge_Fund_Module.md §3's own required test case, run as one
// continuous sequence of crystallizations against a standing HWM.
test('drawdown then partial recovery then new high: fee only ever charges the slice above the STANDING high-water mark', () => {
  let hwm = 100; // entry NAV

  // Crystallization 1: NAV drops to 90 — a loss, no fee, HWM unchanged.
  let r = computeFeeCrystallization({ navPerUnitEnd: 90, hwmBefore: hwm, unitsHeld: 1000, performanceFeePct: 20 });
  assert.equal(r.gainPerUnit, 0);
  assert.equal(r.feeAmount, 0);
  assert.equal(r.hwmAfter, 100, 'a loss must never lower the HWM');
  hwm = r.hwmAfter;

  // Crystallization 2: NAV recovers to 95 — still below the 100 HWM, so
  // still no fee, DESPITE growing from 90 to 95. This is the case a naive
  // "gain since last crystallization" implementation gets wrong.
  r = computeFeeCrystallization({ navPerUnitEnd: 95, hwmBefore: hwm, unitsHeld: 1000, performanceFeePct: 20 });
  assert.equal(r.gainPerUnit, 0, 'growth from 90->95 must not be treated as gain — still below the 100 HWM');
  assert.equal(r.feeAmount, 0);
  assert.equal(r.hwmAfter, 100);
  hwm = r.hwmAfter;

  // Crystallization 3: NAV rises to 110 — fee charges ONLY on (110-100)=10
  // per unit, never on (110-95)=15 (the naive-recovery-inclusive delta).
  r = computeFeeCrystallization({ navPerUnitEnd: 110, hwmBefore: hwm, unitsHeld: 1000, performanceFeePct: 20 });
  assert.equal(r.gainPerUnit, 10);
  closeTo(r.feeAmount, 2000, 0.01, '20% of (10 gain/unit * 1000 units) = 2000');
  assert.equal(r.hwmAfter, 110, 'HWM now advances to the new high');
});

test('fee is deducted in units, priced at the NAV that triggered it', () => {
  const r = computeFeeCrystallization({ navPerUnitEnd: 200, hwmBefore: 100, unitsHeld: 500, performanceFeePct: 20 });
  // gain/unit = 100, fee = 20% * 100 * 500 = 10000, units deducted = 10000/200 = 50
  closeTo(r.feeAmount, 10000, 0.01);
  closeTo(r.unitsDeductedForFee, 50, 0.01);
});

test('zero units held never produces a fee, even with real gain', () => {
  const r = computeFeeCrystallization({ navPerUnitEnd: 150, hwmBefore: 100, unitsHeld: 0, performanceFeePct: 20 });
  assert.equal(r.feeAmount, 0);
  assert.equal(r.unitsDeductedForFee, 0);
});

test('a hurdle rate carves out the first slice of gain from fee — GP earns nothing below the accrued hurdle', () => {
  // HWM=100, hurdle 10%/year, exactly 1 year elapsed -> hurdle accrual =
  // 100 * 0.10 * 1 = 10/unit. NAV rises to 108 -> raw gain 8/unit, entirely
  // inside the 10/unit hurdle -> zero fee, despite real (unhurdled) gain.
  const r = computeFeeCrystallization({
    navPerUnitEnd: 108, hwmBefore: 100, unitsHeld: 1000, performanceFeePct: 20,
    hurdleRatePct: 10, periodDays: 365,
  });
  closeTo(r.hurdleAccrued, 10, 0.01);
  assert.equal(r.gainPerUnit, 0, 'gain of 8/unit is fully inside the 10/unit hurdle');
  assert.equal(r.feeAmount, 0);
  // HWM still advances to the new NAV regardless of the hurdle carving out
  // the fee — the hurdle affects what the GP is PAID this round, not where
  // the investor's own mark sits afterward.
  assert.equal(r.hwmAfter, 108);
});

test('a hurdle rate only exempts the hurdle-sized slice — fee still applies to gain above it', () => {
  // Same setup, but NAV rises to 115 -> raw gain 15/unit, hurdle carves out
  // 10/unit, fee applies to the remaining 5/unit only.
  const r = computeFeeCrystallization({
    navPerUnitEnd: 115, hwmBefore: 100, unitsHeld: 1000, performanceFeePct: 20,
    hurdleRatePct: 10, periodDays: 365,
  });
  closeTo(r.hurdleAccrued, 10, 0.01);
  closeTo(r.gainPerUnit, 5, 0.01);
  closeTo(r.feeAmount, 1000, 0.01, '20% of (5/unit * 1000 units) = 1000');
});

test('a hurdle rate is prorated by the elapsed period, not applied as a flat full-year amount for a short period', () => {
  // Half a year elapsed -> hurdle accrual halved: 100 * 0.10 * (182.5/365) = 5/unit.
  const r = computeFeeCrystallization({
    navPerUnitEnd: 108, hwmBefore: 100, unitsHeld: 1000, performanceFeePct: 20,
    hurdleRatePct: 10, periodDays: 182.5,
  });
  closeTo(r.hurdleAccrued, 5, 0.01);
  closeTo(r.gainPerUnit, 3, 0.01, '8/unit raw gain - 5/unit hurdle = 3/unit taxable gain');
});

test('no hurdle configured (0%) behaves exactly like the no-hurdle case', () => {
  const withZeroHurdle = computeFeeCrystallization({ navPerUnitEnd: 110, hwmBefore: 100, unitsHeld: 1000, performanceFeePct: 20, hurdleRatePct: 0, periodDays: 365 });
  const withNoHurdleArg = computeFeeCrystallization({ navPerUnitEnd: 110, hwmBefore: 100, unitsHeld: 1000, performanceFeePct: 20 });
  assert.equal(withZeroHurdle.feeAmount, withNoHurdleArg.feeAmount);
  assert.equal(withZeroHurdle.hurdleAccrued, 0);
});
