// server/notifications/digestChecks.js
//
// Stage 2 — the daily digest triggers scheduler.js drives. Unlike Stage 1's
// instant triggers, none of these fire from a route handler: the condition
// they check ("KYC review due", "report deadline approaching") isn't a
// single moment in time, it's a fact that stays true day after day until
// someone acts on it — which is exactly what notifyOnce()'s scope:'daily'
// is for (re-fires once per calendar day, doesn't require the caller to
// track "did I already send this" itself).
//
// LOOKAHEAD_DAYS: how far ahead of a review/deadline date to start warning
// — early enough to actually act on, not so early it's noise. Applies only
// to the three date-approaching checks below; the overdue-payment and
// pending-conflict checks have no lookahead because their condition is
// already true today, not merely approaching.
const { db } = require('../db');
const { notifyOnce } = require('./notify');
const { usersByPermissionFlag } = require('./recipients');

const LOOKAHEAD_DAYS = 14;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// KYC review coming due (or overdue) on an Active LP — same amlClear
// capability that gates AML clearance elsewhere (CO/MLRO).
async function checkKycRenewals(tenantId) {
  const lps = db.prepare(`
    SELECT * FROM lp_register
    WHERE tenant_id = ? AND status = 'Active' AND kyc_next_review IS NOT NULL
      AND date(kyc_next_review) <= date('now', '+${LOOKAHEAD_DAYS} days')
  `).all(tenantId);
  if (!lps.length) return;
  const officers = usersByPermissionFlag(tenantId, 'aml_clear');
  for (const lp of lps) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'kyc_renewal_due', entityType: 'lp_register', entityId: lp.id,
        to: officer.email, scope: 'daily',
        subject: `KYC-пересмотр: ${lp.name}`,
        html: `<p>По LP «${esc(lp.name)}» подошёл срок планового KYC-пересмотра: ${esc(lp.kyc_next_review)}.</p>`,
      });
    }
  }
}

// A Capital Call line item still unpaid past its own payment_date — the
// same ccApprove capability that gates sending the call in the first
// place (CEO/CFO), since chasing an overdue LP payment is their call, not
// an automated dunning email to the LP itself. cc.status = 'Pending' only
// — matches the frontend's own isOverdue definition (js/lp-register.js):
// a Draft call was never sent to any LP yet, and a Completed one is
// already resolved, so neither counts as "overdue".
async function checkCapitalCallOverdue(tenantId) {
  const overdue = db.prepare(`
    SELECT li.*, lp.name AS lp_name, cc.cc_number
    FROM capital_call_line_items li
    JOIN capital_calls cc ON cc.id = li.call_id
    JOIN lp_register lp ON lp.id = li.lp_id
    WHERE li.tenant_id = ? AND cc.status = 'Pending' AND li.status != 'Paid'
      AND li.payment_date IS NOT NULL AND date(li.payment_date) < date('now')
  `).all(tenantId);
  if (!overdue.length) return;
  const officers = usersByPermissionFlag(tenantId, 'cc_approve');
  for (const li of overdue) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'capital_call_payment_overdue', entityType: 'capital_call_line_items', entityId: li.id,
        to: officer.email, scope: 'daily',
        subject: `Просрочена оплата Capital Call ${li.cc_number}`,
        html: `<p>LP «${esc(li.lp_name)}» не оплатил Capital Call №${esc(li.cc_number)} к сроку ${esc(li.payment_date)}.</p>`,
      });
    }
  }
}

// A regulator report not yet submitted, deadline approaching — the same
// afsaSubmit capability that gates actually filing it (CEO/CFO/CO/MLRO).
async function checkAfsaDeadlines(tenantId) {
  const reports = db.prepare(`
    SELECT * FROM afsa_reports
    WHERE tenant_id = ? AND status != 'Отправлен'
      AND date(deadline) <= date('now', '+${LOOKAHEAD_DAYS} days')
  `).all(tenantId);
  if (!reports.length) return;
  const officers = usersByPermissionFlag(tenantId, 'afsa_submit');
  for (const r of reports) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'afsa_deadline_approaching', entityType: 'afsa_reports', entityId: r.id,
        to: officer.email, scope: 'daily',
        subject: `Дедлайн отчёта регулятору: ${r.report_type}`,
        html: `<p>Отчёт «${esc(r.report_type)}» за период ${esc(r.period)} должен быть подан к ${esc(r.deadline)}.</p>`,
      });
    }
  }
}

// A conflict/COI decision still awaiting a call — the same decideConflicts
// capability that gates actually deciding it (CEO/CO/MLRO).
async function checkConflictDecisionsPending(tenantId) {
  const pending = db.prepare(`
    SELECT * FROM conflict_approvals WHERE tenant_id = ? AND status = 'Pending'
  `).all(tenantId);
  if (!pending.length) return;
  const officers = usersByPermissionFlag(tenantId, 'decide_conflicts');
  for (const c of pending) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'conflict_decision_pending', entityType: 'conflict_approvals', entityId: c.id,
        to: officer.email, scope: 'daily',
        subject: `Решение по конфликту интересов ожидается: ${c.decision_type}`,
        html: `<p>Решение по «${esc(c.decision_type)}» (риск: ${esc(c.risk_level)}) всё ещё не принято.</p>`,
      });
    }
  }
}

// A client's primary identity document (passport / certificate of
// incorporation, set from f_idDocExpiry on the DD Outcome task, 2.2)
// expiring soon — same amlClear capability as the KYC-renewal check above,
// since re-verifying an expiring ID document is the same compliance job.
async function checkDocumentExpiry(tenantId) {
  const clients = db.prepare(`
    SELECT * FROM ob_clients
    WHERE tenant_id = ? AND id_document_expiry IS NOT NULL
      AND date(id_document_expiry) <= date('now', '+${LOOKAHEAD_DAYS} days')
  `).all(tenantId);
  if (!clients.length) return;
  const officers = usersByPermissionFlag(tenantId, 'aml_clear');
  for (const c of clients) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'document_expiry_approaching', entityType: 'ob_clients', entityId: c.id,
        to: officer.email, scope: 'daily',
        subject: `Истекает документ клиента: ${c.name}`,
        html: `<p>Основной удостоверяющий документ клиента «${esc(c.name)}» истекает ${esc(c.id_document_expiry)}.</p>`,
      });
    }
  }
}

// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 4's three digest
// triggers — all go to the same officers who'd act on them (payment_confirm
// = CEO/CFO, same gate as POST /api/hf/fee-crystallization/run and the
// redemption/subscription processing routes themselves), never to the LP
// directly: every other digest check in this file is internal-only, the
// LP-facing notifications are the two INSTANT triggers in triggers.js.

// An investor's lock-up ending soon — not yet actionable by the LP (they
// can't redeem until it's over), but the fund team benefits from
// anticipating the liquidity request that becomes possible. Only fires
// while still upcoming (>= today) — once it's already passed there's
// nothing to "approach" anymore, unlike an overdue payment.
async function checkHfLockupEnding(tenantId) {
  const subs = db.prepare(`
    SELECT s.*, lp.name AS lp_name, f.short_name AS fund_name
    FROM hf_subscriptions s
    JOIN lp_register lp ON lp.id = s.lp_id
    JOIN funds f ON f.id = s.fund_id
    WHERE s.tenant_id = ? AND s.status = 'Processed' AND s.lockup_until IS NOT NULL
      AND date(s.lockup_until) <= date('now', '+${LOOKAHEAD_DAYS} days')
      AND date(s.lockup_until) >= date('now')
  `).all(tenantId);
  if (!subs.length) return;
  const officers = usersByPermissionFlag(tenantId, 'payment_confirm');
  for (const s of subs) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'hf_lockup_ending', entityType: 'hf_subscriptions', entityId: s.id,
        to: officer.email, scope: 'daily',
        subject: `Скоро заканчивается lock-up: ${s.lp_name}`,
        html: `<p>Lock-up период инвестора «${esc(s.lp_name)}» в фонде «${esc(s.fund_name)}» заканчивается ${esc(s.lockup_until)} — с этой даты возможна заявка на погашение.</p>`,
      });
    }
  }
}

// A redemption's notice period expiring — unlike lock-up above, this IS
// actionable once already past (the redemption should be processed), same
// "also catches already-overdue" shape as checkCapitalCallOverdue.
async function checkHfRedemptionNoticeExpiring(tenantId) {
  const reds = db.prepare(`
    SELECT r.*, lp.name AS lp_name, f.short_name AS fund_name
    FROM hf_redemptions r
    JOIN lp_register lp ON lp.id = r.lp_id
    JOIN funds f ON f.id = r.fund_id
    WHERE r.tenant_id = ? AND r.status = 'Requested' AND r.notice_expires IS NOT NULL
      AND date(r.notice_expires) <= date('now', '+${LOOKAHEAD_DAYS} days')
  `).all(tenantId);
  if (!reds.length) return;
  const officers = usersByPermissionFlag(tenantId, 'payment_confirm');
  for (const r of reds) {
    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'hf_redemption_notice_expiring', entityType: 'hf_redemptions', entityId: r.id,
        to: officer.email, scope: 'daily',
        subject: `Истекает notice period по погашению: ${r.lp_name}`,
        html: `<p>Notice period по заявке на погашение №${esc(r.redemption_number)} инвестора «${esc(r.lp_name)}» (фонд «${esc(r.fund_name)}») истекает ${esc(r.notice_expires)} — заявку пора обработать.</p>`,
      });
    }
  }
}

const HF_FREQUENCY_MONTHS = { quarterly: 3, annual: 12 };

// Approaching performance-fee crystallization date for a hedge fund — one
// notification per FUND (not per position, which would spam one email per
// LP for the same fund), keyed on the EARLIEST upcoming due date among its
// positions. A position's own "next due" date is its last crystallization
// date (or, if it's never crystallized, its own earliest Processed
// subscription's effective date — matching the same "first period starts
// at entry" rule server/index.js's fee-crystallization route itself uses)
// plus the fund's fee_crystallization_frequency.
async function checkHfFeeCrystallizationDue(tenantId) {
  const funds = db.prepare(`SELECT * FROM funds WHERE tenant_id = ? AND operating_model = 'open-end'`).all(tenantId);
  if (!funds.length) return;
  const officers = usersByPermissionFlag(tenantId, 'payment_confirm');
  const lookaheadDate = new Date(Date.now() + LOOKAHEAD_DAYS * 86400000).toISOString().slice(0, 10);

  for (const fund of funds) {
    const months = HF_FREQUENCY_MONTHS[fund.fee_crystallization_frequency] || 12;
    const positions = db.prepare(`SELECT * FROM hf_investor_positions WHERE tenant_id = ? AND fund_id = ? AND units_held > 0`).all(tenantId, fund.id);
    if (!positions.length) continue;

    let earliestDue = null;
    for (const pos of positions) {
      let baseline = pos.last_fee_crystallization_date;
      if (!baseline) {
        const earliestSub = db.prepare(`
          SELECT MIN(effective_date) AS d FROM hf_subscriptions
          WHERE tenant_id = ? AND fund_id = ? AND lp_id = ? AND status = 'Processed'
        `).get(tenantId, fund.id, pos.lp_id);
        baseline = earliestSub && earliestSub.d ? earliestSub.d : null;
      }
      if (!baseline) continue;
      const due = new Date(baseline + 'T00:00:00Z');
      due.setUTCMonth(due.getUTCMonth() + months);
      const dueStr = due.toISOString().slice(0, 10);
      if (!earliestDue || dueStr < earliestDue) earliestDue = dueStr;
    }
    if (!earliestDue || earliestDue > lookaheadDate) continue;

    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'hf_fee_crystallization_due', entityType: 'funds', entityId: fund.id,
        to: officer.email, scope: 'daily',
        subject: `Приближается кристаллизация performance fee: ${fund.short_name || fund.name}`,
        html: `<p>По фонду «${esc(fund.short_name || fund.name)}» приближается плановая дата кристаллизации performance fee: ${esc(earliestDue)}.</p>`,
      });
    }
  }
}

// A portfolio company with an overdue payment on its own
// financials.paymentSchedule — QA Portfolio Monitoring audit finding:
// portAutoStatus() (js/app.js) derives a "Problem"/"Monitoring" BADGE
// from exactly this same data, but purely client-side, at render time —
// nobody who hasn't personally opened that one company's page ever finds
// out. This surfaces the same underlying fact (an overdue payment
// exists) as a real notification, without touching portfolio.status
// itself — confirmed with the user: the stored status stays a manual
// field, this is strictly an additional signal, never an override.
// financials/monitoring are free-form JSON blobs (no query-able columns,
// same PoC tradeoff as elsewhere in this schema), so this reads every
// non-archived row and parses in JS rather than a SQL-side JSON filter.
async function checkPortfolioOverdue(tenantId) {
  const rows = db.prepare(`
    SELECT * FROM portfolio WHERE tenant_id = ? AND (archived IS NULL OR archived = 0)
  `).all(tenantId);
  if (!rows.length) return;
  const officers = usersByPermissionFlag(tenantId, 'access_fm');
  if (!officers.length) return;

  for (const row of rows) {
    let financials;
    try { financials = JSON.parse(row.financials_json || '{}'); } catch { continue; }
    if (!(financials.overdueAmount > 0)) continue;
    const oldest = (financials.paymentSchedule || []).find(s => s.status === 'Просрочен');
    const sinceDate = oldest ? oldest.date : null;

    for (const officer of officers) {
      if (!officer.email) continue;
      await notifyOnce({
        tenantId, eventType: 'portfolio_payment_overdue', entityType: 'portfolio', entityId: row.id,
        to: officer.email, scope: 'daily',
        subject: `Просроченный платёж по портфельной компании: ${row.name}`,
        html: `<p>По компании «${esc(row.name)}» есть просроченная сумма ${esc(financials.overdueAmount)}${sinceDate ? ` (с ${esc(sinceDate)})` : ''}.</p>`,
      });
    }
  }
}

module.exports = {
  checkKycRenewals, checkCapitalCallOverdue, checkAfsaDeadlines,
  checkConflictDecisionsPending, checkDocumentExpiry,
  checkHfLockupEnding, checkHfRedemptionNoticeExpiring, checkHfFeeCrystallizationDue,
  checkPortfolioOverdue,
};
