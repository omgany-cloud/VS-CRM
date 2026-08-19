// server/notifications/triggers.js
//
// One function per event from the Notifications roadmap doc — each
// resolves its own recipients and content, then funnels through
// notifyOnce() for the actual dedup+send+log. Stage 1 (this file): the two
// instant triggers recommended to ship first (cheapest to verify by hand —
// no waiting for a scheduled tick). Digest triggers (KYC renewal, overdue
// payments, regulator deadlines, ...) are Stage 2, driven by scheduler.js
// on an hourly tick instead of firing synchronously from a route handler.
const { db } = require('../db');
const { notifyOnce } = require('./notify');
const { usersByRoleCode, usersByPermissionFlag } = require('./recipients');
const { WF_DEFINITIONS } = require('../wfDefinitions');

// Every value passed into an email's html is either a fixed label (safe)
// or free-text the tenant's own staff/LP entered (company name, LP name,
// ...) — escape it the same way js/users.js's escapeHtml() does client-side,
// since nothing server-side did this before notifications existed.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fired once, right after POST /api/capital-calls commits. `call` is the
// already-built rowToCC() result with .lineItems attached (each line item
// carries lpId) — no need to re-derive anything the route already has.
async function notifyCapitalCallCreated(tenantId, call) {
  const lpIds = [...new Set((call.lineItems || []).map((li) => li.lpId))];
  for (const lpId of lpIds) {
    const lp = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(lpId, tenantId);
    if (!lp || !lp.email) continue;
    await notifyOnce({
      tenantId, eventType: 'capital_call_created', entityType: 'capital_calls', entityId: call.id,
      to: lp.email,
      subject: `Уведомление о взносе капитала ${call.ccNumber}`,
      html: `<p>Уважаемый(ая) ${esc(lp.name)},</p>
        <p>Объявлен взнос капитала №${esc(call.ccNumber)} на сумму ${call.totalAmount} ${esc(call.currency || '')}.</p>
        ${call.paymentDate ? `<p>Срок оплаты: ${esc(call.paymentDate)}</p>` : ''}`,
    });
  }

  // Copy to CEO/CFO — the same capability (cc_approve) that gates
  // actually sending a Capital Call in the first place.
  const officers = usersByPermissionFlag(tenantId, 'cc_approve');
  for (const officer of officers) {
    if (!officer.email) continue;
    await notifyOnce({
      tenantId, eventType: 'capital_call_created', entityType: 'capital_calls', entityId: call.id,
      to: officer.email,
      subject: `Создан Capital Call ${call.ccNumber}`,
      html: `<p>Создан новый Capital Call №${esc(call.ccNumber)} на сумму ${call.totalAmount} ${esc(call.currency || '')}.</p>`,
    });
  }
}

// Fired whenever a workflow instance is created (step 0) or advances to
// its next step on approval — "your turn" for whoever holds that step's
// role. eventType is scoped per-step (not just per-instance) because the
// same instance legitimately re-notifies as it moves through several
// steps, including to the same person if they happen to hold two of the
// roles on the same chain — a plain per-instance dedup key would wrongly
// suppress every step after the first for that person.
async function notifyWorkflowStepAssigned(tenantId, instance) {
  if (instance.status !== 'active') return;
  const step = instance.steps[instance.currentStep];
  if (!step) return;
  const def = WF_DEFINITIONS[instance.type];
  const chainLabel = (def && def.label) || instance.type;

  const recipients = usersByRoleCode(tenantId, step.role);
  for (const user of recipients) {
    if (!user.email) continue;
    await notifyOnce({
      tenantId,
      eventType: `workflow_step_assigned:${instance.currentStep}`,
      entityType: 'workflow_instances', entityId: instance.id,
      to: user.email,
      subject: `Ваш шаг в согласовании: ${chainLabel}`,
      html: `<p>${esc(user.name || user.email)},</p>
        <p>На вас назначен шаг «${esc(step.label || step.role)}» в согласовании «${esc(chainLabel)}»${instance.entityName ? ' для ' + esc(instance.entityName) : ''}.</p>`,
    });
  }
}

module.exports = { notifyCapitalCallCreated, notifyWorkflowStepAssigned };
