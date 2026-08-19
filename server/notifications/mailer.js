// server/notifications/mailer.js
//
// Thin wrapper over nodemailer. If SMTP_HOST isn't set in .env, every call
// logs to the console instead of attempting a real send — the same
// "safe default, never crash a misconfigured deploy" philosophy already
// used for JWT_SECRET (server/auth.js, auto-generates one) and AI_PROVIDER
// (server/aiProvider.js, returns a clear "not configured" error instead of
// silently no-op-ing). Here the safe default is "log and carry on" rather
// than either of those, because a notification is inherently best-effort —
// nothing in the app should ever fail *because* email isn't set up yet.
//
// SMTP_HOST/PORT/USER/PASS/EMAIL_FROM are generic — every mainstream
// provider (a corporate Exchange/Postfix relay, SendGrid, Postmark, AWS
// SES) exposes a standard SMTP endpoint nodemailer speaks identically, so
// this file doesn't need to know or care which one a given deployment uses.
const nodemailer = require('nodemailer');

// Read lazily (not at module load) and cached after first real use, so a
// test process that sets SMTP_HOST via extraEnv still gets picked up —
// this module is required once per process, before any env var from a
// spawned child's env block would exist yet if read eagerly at the top.
let cachedTransport = null;
function getTransport() {
  if (cachedTransport) return cachedTransport;
  if (!process.env.SMTP_HOST) return null;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cachedTransport;
}

// Returns { sent: true, mode: 'smtp' } on a real send, or
// { sent: true, mode: 'console' } when SMTP isn't configured. Only throws
// on an actual SMTP-level failure (bad credentials, host unreachable, ...)
// — callers (notify.js) catch that and log it without letting it break
// whatever business action triggered the notification.
async function sendMail({ to, subject, html, text }) {
  if (!to) throw new Error('sendMail: "to" is required');
  const transport = getTransport();
  const from = process.env.EMAIL_FROM || 'Turan Capital Fund CRM <noreply@localhost>';
  const plainText = text || String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (!transport) {
    console.log(`[mailer] SMTP not configured — logging instead of sending. To: ${to} | Subject: ${subject}`);
    return { sent: true, mode: 'console' };
  }
  await transport.sendMail({ from, to, subject, html, text: plainText });
  return { sent: true, mode: 'smtp' };
}

module.exports = { sendMail };
