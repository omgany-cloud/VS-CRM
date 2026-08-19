// Pure-function unit tests for server/metricsEngine.js — same "no
// server/DB needed" shape as waterfall-engine.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { xirr, computeMetrics } = require('../metricsEngine');

function closeTo(actual, expected, tolerance, msg) {
  assert.ok(Math.abs(actual - expected) <= tolerance, msg || `expected ${actual} to be close to ${expected}`);
}

test('xirr: a single -1000 now / +1100 in exactly one year is 10%, hand-verifiable', () => {
  const rate = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  closeTo(rate, 0.10, 0.0005);
});

test('xirr: null when every cash flow has the same sign — no real rate solves it', () => {
  assert.equal(xirr([{ date: '2025-01-01', amount: 100 }, { date: '2026-01-01', amount: 200 }]), null);
  assert.equal(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: -200 }]), null);
});

test('xirr: null with fewer than 2 cash flows', () => {
  assert.equal(xirr([]), null);
  assert.equal(xirr([{ date: '2025-01-01', amount: -100 }]), null);
});

test('xirr: irregular, real-world-shaped cash flows (two calls, one distribution, unrealized tail) still converges', () => {
  const rate = xirr([
    { date: '2024-01-01', amount: -600 },
    { date: '2024-07-01', amount: -400 },
    { date: '2025-06-01', amount: 300 },
    { date: '2026-01-01', amount: 900 }, // residual value, as a terminal cash flow
  ]);
  assert.notEqual(rate, null);
  assert.ok(rate > 0, 'this scenario returns more than it called, IRR should be positive');
});

test('computeMetrics: DPI/RVPI/TVPI are null (not 0) when nothing has been paid in yet', () => {
  const m = computeMetrics({ paidInEvents: [], distributedEvents: [], residualValue: 0, asOfDate: '2026-01-01' });
  assert.equal(m.dpi, null);
  assert.equal(m.rvpi, null);
  assert.equal(m.tvpi, null);
  assert.equal(m.irr, null);
});

test('computeMetrics: DPI/RVPI/TVPI compute correctly once capital is paid in, distributed, and residual value exists', () => {
  const m = computeMetrics({
    paidInEvents: [{ amount: 1000, date: '2025-01-01' }],
    distributedEvents: [{ amount: 200, date: '2025-06-01' }],
    residualValue: 1000,
    asOfDate: '2026-01-01',
  });
  closeTo(m.dpi, 0.2, 0.001, 'distributed $200 / paid-in $1000');
  closeTo(m.rvpi, 1.0, 0.001, 'residual $1000 / paid-in $1000');
  closeTo(m.tvpi, 1.2, 0.001, 'DPI + RVPI');
  assert.notEqual(m.irr, null);
});

test('computeMetrics: zero residual value never adds a phantom terminal cash flow (IRR stays realized-only)', () => {
  const m = computeMetrics({
    paidInEvents: [{ amount: 1000, date: '2025-01-01' }],
    distributedEvents: [{ amount: 1100, date: '2026-01-01' }],
    residualValue: 0,
    asOfDate: '2026-06-01', // well after the last real cash flow
  });
  closeTo(m.irr, 0.10, 0.0005, 'must match the pure -1000/+1100-in-a-year case exactly, unaffected by asOfDate');
});

test('computeMetrics: an event with no known date still counts toward DPI/RVPI/TVPI, just not toward IRR', () => {
  const m = computeMetrics({
    paidInEvents: [{ amount: 1000, date: '2025-01-01' }],
    distributedEvents: [{ amount: 200, date: null }], // e.g. a real paid distribution whose payment_date was never recorded
    residualValue: 0,
    asOfDate: '2026-01-01',
  });
  closeTo(m.distributed, 200, 0.001, 'a dateless distribution is still real money that moved — it must not vanish from the total');
  closeTo(m.dpi, 0.2, 0.001);
  // IRR genuinely can't place an undated cash flow on a timeline — with
  // only the one dated (negative) paid-in event left, there's no positive
  // cash flow to solve against, so it must come back null, not garbage.
  assert.equal(m.irr, null);
});
