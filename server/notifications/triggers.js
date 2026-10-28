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
const { workflowVisibleToUser } = require('../workflowAccess');
const { assertContractAccess, ContractError } = require('../contractDocuments');
const { rowToPermissions } = require('../rolesMapping');

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
  // The chain's name may reveal a closed FM record: only those who can open it hear about it.
  const row = db.prepare('SELECT * FROM workflow_instances WHERE tenant_id = ? AND id = ?').get(tenantId, instance.id);
  for (const user of recipients) {
    if (!user.email || !row || !workflowVisibleToUser(tenantId, user, row)) continue;
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

// Hedge Fund module (docs/TZ_Hedge_Fund_Module.md) Stage 4 — the two
// instant triggers the TZ's §6 asks for. "Your turn" for the CFO/CEO steps
// of the nav_publish workflow itself already comes free from
// notifyWorkflowStepAssigned above (it's generic over every workflow
// type) — these two are the LP-facing ones that only make sense once a
// NAV is actually Published / a redemption is actually Processed.

// Fired once, right after PUT /api/hf/nav/:id/publish commits. Every LP
// with a real position (units_held > 0) in that fund gets their new
// position value — same "resolve recipients from the entity, not from
// whoever happened to call the route" shape as notifyCapitalCallCreated.
async function notifyHfNavPublished(tenantId, nav) {
  const positions = db.prepare(`
    SELECT p.units_held, lp.name AS lp_name, lp.email AS lp_email
    FROM hf_investor_positions p JOIN lp_register lp ON lp.id = p.lp_id
    WHERE p.tenant_id = ? AND p.fund_id = ? AND p.units_held > 0
  `).all(tenantId, nav.fundId);
  for (const pos of positions) {
    if (!pos.lp_email) continue;
    const value = pos.units_held * nav.navPerUnit;
    await notifyOnce({
      tenantId, eventType: 'hf_nav_published', entityType: 'hf_nav_history', entityId: nav.id,
      to: pos.lp_email,
      subject: `Опубликован NAV на ${nav.asOfDate}`,
      html: `<p>Уважаемый(ая) ${esc(pos.lp_name)},</p>
        <p>Опубликован расчёт NAV на ${esc(nav.asOfDate)}: ${nav.navPerUnit} за юнит.</p>
        <p>Текущая стоимость вашей позиции: ${value.toFixed(2)} (${pos.units_held} юнитов).</p>`,
    });
  }
}

// Fired once a redemption transitions to Processed (server/index.js's
// PUT /api/hf/redemptions/:id) — a Queued outcome does NOT fire this, the
// LP hasn't actually been paid out yet.
async function notifyHfRedemptionProcessed(tenantId, redemption) {
  const lp = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(redemption.lpId, tenantId);
  if (!lp || !lp.email) return;
  await notifyOnce({
    tenantId, eventType: 'hf_redemption_processed', entityType: 'hf_redemptions', entityId: redemption.id,
    to: lp.email,
    subject: `Погашение ${redemption.redemptionNumber} обработано`,
    html: `<p>Уважаемый(ая) ${esc(lp.name)},</p>
      <p>Ваша заявка на погашение №${esc(redemption.redemptionNumber)} обработана: ${redemption.unitsRequested} юнитов по NAV ${redemption.navPerUnitAtExit} на сумму ${redemption.amount}.</p>`,
  });
}

// Optional public address of the CRM (CRM_PUBLIC_URL): emails then link straight
// to the contract task; without it they say where to find it.
function contractTaskLink(contractId, where = '«Задачи» → «Жду моего решения»') {
  const base = (process.env.CRM_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(base)
    ? `<p><a href="${esc(base)}/index.html?contract=${contractId}">Открыть задачу договора в CRM</a></p>`
    : `<p>В CRM: ${where}.</p>`;
}
function contractReader(tenantId, userId, contract) {
  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ? AND active = 1').get(tenantId, userId);
  const role = user && db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(tenantId, user.role);
  if (!user?.email || !role) return null;
  try { assertContractAccess({ tenantId, user: { ...user, permissions: rowToPermissions(role) } }, contract); return user; }
  catch (err) { if (err instanceof ContractError) return null; throw err; }
}

// Fired after a contract is sent for review and after each decision: every
// reviewer whose turn it now is learns which contract, from whom and by when.
// One email per review step, so a later reviewer in a sequential route is
// written to when their turn comes, not before.
async function notifyContractReview(tenantId, cycleId) {
  const cycle = db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND id = ?').get(tenantId, cycleId);
  if (cycle?.status !== 'active') return;
  const contract = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(tenantId, cycle.engagement_id);
  if (!contract) return;
  const steps = db.prepare("SELECT * FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND status = 'pending'").all(tenantId, cycle.id);
  const name = `${contract.contract_num || 'без номера'} · ${contract.client_name || ''}`;
  for (const step of steps) {
    const reviewer = contractReader(tenantId, step.assignee_id, contract);
    if (!reviewer) continue;
    const due = step.due_at ? new Date(step.due_at).toLocaleDateString('ru-RU', { timeZone: 'Asia/Qyzylorda' }) : null;
    await notifyOnce({
      tenantId, eventType: 'contract_review_assigned', entityType: 'contract_approval_steps', entityId: step.id,
      to: reviewer.email,
      subject: `Договор на согласование: ${contract.contract_num || 'без номера'}`,
      html: `<p>${esc(reviewer.name || reviewer.email)},</p>
        <p>${esc(cycle.initiator_name)} отправил(а) вам на согласование договор «${esc(name)}»${due ? `; срок решения — ${esc(due)}` : ''}.</p>
        <p>Решение («Согласовать», «Вернуть на доработку», «Отклонить») принимается в задаче договора, под полем сообщения.</p>
        ${contractTaskLink(contract.id)}`,
    });
  }
}

// Fired after a contract review is returned or rejected (TZ M3): the author of
// the submission learns it came back and why — only while they can still open
// the contract, since its number and client may sit behind the FM wall.
async function notifyContractReturned(tenantId, cycleId) {
  const cycle = db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND id = ?').get(tenantId, cycleId);
  if (!cycle || !['returned', 'rejected'].includes(cycle.status)) return;
  const contract = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? AND id = ?').get(tenantId, cycle.engagement_id);
  const author = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND id = ? AND active = 1').get(tenantId, cycle.initiator_id);
  const role = author && db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(tenantId, author.role);
  if (!contract || !author?.email || !role) return;
  try { assertContractAccess({ tenantId, user: { ...author, permissions: rowToPermissions(role) } }, contract); }
  catch (err) { if (err instanceof ContractError) return; throw err; }
  const remark = db.prepare("SELECT assignee_name, comment FROM contract_approval_steps WHERE tenant_id = ? AND cycle_id = ? AND status IN ('returned','rejected') ORDER BY decided_at DESC LIMIT 1").get(tenantId, cycle.id);
  const returned = cycle.status === 'returned', name = `${contract.contract_num || 'без номера'} · ${contract.client_name || ''}`;
  await notifyOnce({
    tenantId, eventType: 'contract_returned', entityType: 'contract_approval_cycles', entityId: cycle.id,
    to: author.email,
    subject: `${returned ? 'Договор возвращён на доработку' : 'Договор отклонён'}: ${contract.contract_num || 'без номера'}`,
    html: `<p>${esc(author.name || author.email)},</p>
      <p>Договор «${esc(name)}» ${returned ? 'возвращён на доработку' : 'отклонён'}${remark ? ` — ${esc(remark.assignee_name)}: «${esc(remark.comment)}»` : ''}.</p>
      ${contractTaskLink(contract.id, '«Задачи» → «На доработке»')}`,
  });
}

module.exports = {
  notifyCapitalCallCreated, notifyWorkflowStepAssigned,
  notifyHfNavPublished, notifyHfRedemptionProcessed, notifyContractReturned, notifyContractReview, contractTaskLink, contractReader,
};
