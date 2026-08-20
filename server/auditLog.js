// server/auditLog.js
//
// Cross-module "who/what/when" event log — v1 scope (deliberately, per
// the user's own steer): key governance/regulatory modules only (LP
// register, Capital Calls, Distributions, Portfolio, Deals, Conflict
// Approvals, Engagements), not a blanket middleware over every mutating
// route in the app. A generic before/after-diffing wrapper around ~150
// routes was considered and rejected as too broad a change for a v1 —
// this file is the seam to grow from if/when that's actually wanted.
//
// Event-only, no per-field old->new diff (also a deliberate v1 choice):
// a diff means every call site has to remember to redact sensitive
// fields (passwords, portal tokens, PII) before logging, and get that
// right forever as new fields get added — a one-line summary sentence
// answers "who touched this record and when" without that ongoing risk.
const { at } = require('./db');

// Never lets a logging failure break the business action that triggered
// it — same "best-effort side-effect" reasoning as notify.js/logAiCall.
function recordAudit(db, { tenantId, entityType, entityId, action, actorEmail, summary }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (tenant_id, entity_type, entity_id, action, actor_email, summary)
      VALUES (@tenantId, @entityType, @entityId, @action, @actorEmail, @summary)
    `).run(at({ tenantId, entityType, entityId, action, actorEmail, summary }));
  } catch (err) {
    console.error('[auditLog] failed to record:', err.message);
  }
}

module.exports = { recordAudit };
