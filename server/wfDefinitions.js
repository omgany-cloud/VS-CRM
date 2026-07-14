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
  deal_ic: {
    label: 'Инвестиционный комитет',
    steps: [
      { role: 'ANALYST', label: 'Analyst — Investment Memo', action: 'review' },
      { role: 'RELATIONSHIP_MANAGER', label: 'RM — коммерческая оценка', action: 'review' },
      { role: 'CEO', label: 'IC — решение комитета', action: 'approve' },
    ],
  },
  capital_call: {
    label: 'Capital Call — согласование',
    steps: [
      { role: 'COMPLIANCE_OFFICER', label: 'CO — подготовка Notice', action: 'review' },
      { role: 'CEO', label: 'CEO — подписание Notice', action: 'sign' },
    ],
  },
  subscription: {
    label: 'Subscription Agreement',
    steps: [
      { role: 'COMPLIANCE_OFFICER', label: 'CO — проверка SA', action: 'review' },
      { role: 'CEO', label: 'CEO — подписание SA', action: 'sign' },
    ],
  },
};

function freshSteps(type) {
  const def = WF_DEFINITIONS[type];
  if (!def) return null;
  return def.steps.map(s => ({ ...s, completedAt: null, completedBy: null, decision: null, comment: '' }));
}

module.exports = { WF_DEFINITIONS, freshSteps };
