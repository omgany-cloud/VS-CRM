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

module.exports = {
  checkKycRenewals, checkCapitalCallOverdue, checkAfsaDeadlines,
  checkConflictDecisionsPending, checkDocumentExpiry,
};
