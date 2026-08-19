// server/notifications/scheduler.js
//
// Drives Stage 2 (digest) triggers — KYC renewal, overdue payments,
// document expiry, regulator deadlines, ... — none of which exist yet;
// Stage 1 only shipped the two instant triggers (fired directly from
// their own route handlers in server/index.js, not from here). This file
// exists now so adding the first digest check later is just pushing a
// function onto DIGEST_CHECKS, not new plumbing.
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

const DIGEST_HOUR = Number(process.env.DIGEST_HOUR) || 8; // 24h, local server time

// Each entry: async (tenantId) => void. Stage 2 populates this, e.g.
// DIGEST_CHECKS.push(checkKycRenewals) once that function exists.
const DIGEST_CHECKS = [];

async function runDigestChecksForAllTenants() {
  const tenants = db.prepare('SELECT id FROM tenants').all();
  for (const check of DIGEST_CHECKS) {
    for (const t of tenants) {
      try {
        await check(t.id);
      } catch (err) {
        // One tenant's/check's failure must never block the rest — same
        // "best-effort side-effect" reasoning as notify.js.
        console.error('[scheduler] digest check failed:', err.message);
      }
    }
  }
}

let intervalHandle = null;
function start() {
  if (intervalHandle) return; // idempotent — a second start() is a no-op
  intervalHandle = setInterval(() => {
    if (new Date().getHours() !== DIGEST_HOUR) return;
    if (DIGEST_CHECKS.length === 0) return; // nothing to run yet (Stage 1)
    runDigestChecksForAllTenants();
  }, 60 * 60 * 1000);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { start, stop, DIGEST_CHECKS, runDigestChecksForAllTenants };
