// server/notifications/scheduler.js
//
// Drives Stage 2 (digest) triggers — KYC renewal, overdue Capital Call
// payments, ID document expiry, regulator deadlines, pending conflict
// decisions (server/notifications/digestChecks.js). Stage 1's two instant
// triggers still fire directly from their own route handlers in
// server/index.js, not from here.
//
// No new dependency: a plain hourly setInterval is enough, since this
// server already runs as a long-lived process under systemd (see
// deploy/crm.service) rather than needing a real cron daemon — same
// reasoning and the same undecorated setInterval already used by
// scheduleBackups() (server/backup.js). DIGEST_HOUR gates when digests
// actually fire so nobody gets emailed at 3am local server time; it's a
// single system-wide setting for now, not per-tenant (see the
// Notifications roadmap doc's open question about tenant timezones) — a
// deliberate MVP simplification, not an oversight.
const { db } = require('../db');
const {
  checkKycRenewals, checkCapitalCallOverdue, checkAfsaDeadlines,
  checkConflictDecisionsPending, checkDocumentExpiry,
  checkHfLockupEnding, checkHfRedemptionNoticeExpiring, checkHfFeeCrystallizationDue,
} = require('./digestChecks');

const DIGEST_HOUR = Number(process.env.DIGEST_HOUR) || 8; // 24h, local server time

// Each entry: async (tenantId) => void.
const DIGEST_CHECKS = [
  checkKycRenewals, checkCapitalCallOverdue, checkAfsaDeadlines,
  checkConflictDecisionsPending, checkDocumentExpiry,
  checkHfLockupEnding, checkHfRedemptionNoticeExpiring, checkHfFeeCrystallizationDue,
];

// Shared by the hourly tick below and the manual POST
// /api/notifications/run-digest route (server/index.js) — ops shouldn't
// have to wait for DIGEST_HOUR to confirm a digest actually fires, and a
// manual run for one tenant must never touch any other tenant's data.
async function runDigestChecksForTenant(tenantId) {
  for (const check of DIGEST_CHECKS) {
    try {
      await check(tenantId);
    } catch (err) {
      // One check's failure must never block the rest — same
      // "best-effort side-effect" reasoning as notify.js.
      console.error('[scheduler] digest check failed:', err.message);
    }
  }
}

async function runDigestChecksForAllTenants() {
  const tenants = db.prepare('SELECT id FROM tenants').all();
  for (const t of tenants) {
    await runDigestChecksForTenant(t.id);
  }
}

let intervalHandle = null;
function start() {
  if (intervalHandle) return; // idempotent — a second start() is a no-op
  intervalHandle = setInterval(() => {
    if (new Date().getHours() !== DIGEST_HOUR) return;
    runDigestChecksForAllTenants();
  }, 60 * 60 * 1000);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { start, stop, DIGEST_CHECKS, runDigestChecksForAllTenants, runDigestChecksForTenant };
