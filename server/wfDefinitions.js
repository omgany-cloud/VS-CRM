// Authoritative workflow step templates — mirrors js/workflow.js's
// WF_DEFINITIONS (label/icon/color are display-only and stay duplicated,
// same tradeoff as IC_SEATS/PERMISSION_DEFS elsewhere in this codebase).
// POST /api/workflow derives a new instance's `steps` from here, NEVER
// from client input — a caller must not be able to hand itself every
// step's role by supplying its own steps array (the same class of bug
// fixed in PUT /api/ic-memos/:id).
const WF_DEFINITIONS = {
  kyc_lp: {
    label: 'KYC/AML — LP Onboarding',
    steps: [
      { role: 'COMPLIANCE_OFFICER', label: 'CO проверка документов', action: 'review' },
      { role: 'MLRO', label: 'MLRO — AML скрининг', action: 'approve' },
      { role: 'CEO', label: 'CEO — финальное одобрение', action: 'approve' },
    ],
  },
  kyc_cfa: {
    label: 'KYC/AML — CF&A Client',
    steps: [
      { role: 'COMPLIANCE_OFFICER', label: 'CO проверка документов', action: 'review' },
      { role: 'MLRO', label: 'MLRO — AML скрининг', action: 'approve' },
      { role: 'CEO', label: 'CEO — финальное одобрение', action: 'approve' },
    ],
  },
  // Historical only — no call site anywhere creates a new 'deal_ic'
  // instance (confirmed: startWorkflow() is only ever invoked with
  // 'kyc_lp'/'kyc_cfa'). Kept because 5 seeded workflow_instances rows
  // (server/seed.js) already use this type for deals whose IC decision
  // predates the js/modules.js icMemos system — deleting the definition
  // would break WF_DEFINITIONS[w.type] lookups for those real historical
  // records. Going forward, an IC decision is tracked by icMemos (richer:
  // 4-seat quorum voting + independent Risk Manager veto), not this
  // generic 3-step chain — the two aren't meant to coexist for new deals.
  deal_ic: {
    label: 'Инвестиционный комитет',
    steps: [
      { role: 'ANALYST', label: 'Analyst — Investment Memo', action: 'review' },
      { role: 'RELATIONSHIP_MANAGER', label: 'RM — коммерческая оценка', action: 'review' },
      { role: 'CEO', label: 'IC — решение комитета', action: 'approve' },
    ],
  },
};

function freshSteps(type) {
  const def = WF_DEFINITIONS[type];
  if (!def) return null;
  return def.steps.map(s => ({ ...s, completedAt: null, completedBy: null, decision: null, comment: '' }));
}

module.exports = { WF_DEFINITIONS, freshSteps };
