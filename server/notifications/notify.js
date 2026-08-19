// server/notifications/notify.js
//
// The shared "check idempotency, send, log" wrapper every trigger funnels
// through — notification_log's dedup guarantee lives here, so no
// individual trigger function can accidentally skip it. Never lets a
// notification failure propagate to its caller: the business action that
// triggered this (creating a Capital Call, advancing a workflow step, ...)
// must succeed or fail entirely independently of whether the email
// actually went out — same "best-effort side-effect, never the main
// transaction" reasoning as logAiCall (server/logger.js).
const { db, at } = require('../db');
const { sendMail } = require('./mailer');

// scope: 'once' (default) — never re-notify this exact tenant+event+
// entity+recipient combination, ever; correct for instant triggers, which
// each only ever fire at one specific moment (a record being created, a
// workflow step being reached). 'daily' — same, but allowed to re-fire
// once per calendar day (Stage 2 digest triggers, not used yet — the
// underlying condition, e.g. "KYC expires in 14 days", legitimately stays
// true day after day until someone acts on it, so "once ever" would wrongly
// suppress every day after the first).
async function notifyOnce({ tenantId, eventType, entityType, entityId, to, subject, html, scope = 'once' }) {
  if (!to) return { sent: false, reason: 'no-recipient-email' };
  try {
    const dayClause = scope === 'daily' ? "AND date(sent_at) = date('now')" : '';
    const already = db.prepare(`
      SELECT id FROM notification_log
      WHERE tenant_id = ? AND event_type = ? AND entity_id = ? AND recipient_email = ? ${dayClause}
    `).get(tenantId, eventType, entityId, to);
    if (already) return { sent: false, reason: 'already-notified' };

    const result = await sendMail({ to, subject, html });

    db.prepare(`
      INSERT INTO notification_log (tenant_id, event_type, entity_type, entity_id, recipient_email)
      VALUES (@tenantId, @eventType, @entityType, @entityId, @recipientEmail)
    `).run(at({ tenantId, eventType, entityType, entityId, recipientEmail: to }));

    return { sent: true, mode: result.mode };
  } catch (err) {
    console.error(`[notify] Failed to send "${eventType}" to ${to}:`, err.message);
    return { sent: false, reason: 'error', error: err.message };
  }
}

module.exports = { notifyOnce };
