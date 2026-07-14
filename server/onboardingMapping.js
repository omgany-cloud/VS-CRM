// Shared row <-> frontend-object mapping for the 5 onboarding entities:
// restrictedList, coiRegistry, obClients, obTasks, engagements.

/* ===== restrictedList ===== */
function restrictedToParams(r) {
  return {
    company: r.company, sector: r.sector || null, fund: r.fund || null,
    ownershipPct: r.ownershipPct != null ? r.ownershipPct : null,
    restrictionType: r.restrictionType || null,
    cfaAllowed: r.cfaAllowed ? 1 : 0, requiresApproval: r.requiresApproval ? 1 : 0,
    addedAt: r.addedAt || null, addedBy: r.addedBy || null,
  };
}
function rowToRestricted(row) {
  return {
    id: row.id, company: row.company, sector: row.sector, fund: row.fund,
    ownershipPct: row.ownership_pct, restrictionType: row.restriction_type,
    cfaAllowed: !!row.cfa_allowed, requiresApproval: !!row.requires_approval,
    addedAt: row.added_at, addedBy: row.added_by,
  };
}
const RESTRICTED_INSERT_SQL = `
  INSERT INTO restricted_list
    (tenant_id, company, sector, fund, ownership_pct, restriction_type, cfa_allowed, requires_approval, added_at, added_by)
  VALUES
    (@tenantId, @company, @sector, @fund, @ownershipPct, @restrictionType, @cfaAllowed, @requiresApproval, @addedAt, @addedBy)
`;

/* ===== coiRegistry ===== */
function coiToParams(c) {
  return {
    coiId: c.coiId || null, date: c.date || null, conflictType: c.conflictType || null,
    parties: c.parties || null, severity: c.severity || null, status: c.status || 'Open',
    description: c.description || null, measures: c.measures || null, responsible: c.responsible || null,
    reviewDate: c.reviewDate || null, resolution: c.resolution || null,
    linkedClientId: c.linkedClientId != null ? c.linkedClientId : null,
  };
}
function rowToCoi(row) {
  return {
    id: row.id, coiId: row.coi_id, date: row.date, conflictType: row.conflict_type,
    parties: row.parties, severity: row.severity, status: row.status, description: row.description,
    measures: row.measures, responsible: row.responsible, reviewDate: row.review_date,
    resolution: row.resolution, linkedClientId: row.linked_client_id,
  };
}
const COI_INSERT_SQL = `
  INSERT INTO coi_registry
    (tenant_id, coi_id, date, conflict_type, parties, severity, status, description, measures, responsible, review_date, resolution, linked_client_id)
  VALUES
    (@tenantId, @coiId, @date, @conflictType, @parties, @severity, @status, @description, @measures, @responsible, @reviewDate, @resolution, @linkedClientId)
`;

/* ===== obClients ===== */
const OB_CLIENT_SCALARS = [
  'clientId', 'name', 'type', 'classification', 'serviceType', 'lpType', 'commitment',
  'direction', 'rm', 'phase', 'onboardingStatus', 'riskRating', 'startDate', 'targetDate',
  'nextAction', 'notes', 'contractUrl', 'activatedBy', 'lpaUrl', 'amlReviewDate', 'reClassDate',
  'internalPortfolioId', 'pepStatus', 'sanctionsCheckedAt',
];
function obClientToParams(c) {
  const out = {};
  for (const f of OB_CLIENT_SCALARS) out[f] = c[f] != null ? c[f] : null;
  out.restrictedMatch = c.restrictedMatch ? 1 : 0;
  out.activated = c.activated ? 1 : 0;
  out.isInternalClient = c.isInternalClient ? 1 : 0;
  out.identityVerified = c.identityVerified ? 1 : 0;
  out.sofVerified = c.sofVerified ? 1 : 0;
  out.sowVerified = c.sowVerified ? 1 : 0;
  out.sanctionsCleared = c.sanctionsCleared ? 1 : 0;
  out.professionalClientVerified = c.professionalClientVerified ? 1 : 0;
  return out;
}
function rowToObClient(row) {
  return {
    id: row.id, clientId: row.client_id, name: row.name, type: row.type,
    classification: row.classification, serviceType: row.service_type, lpType: row.lp_type,
    commitment: row.commitment, direction: row.direction, rm: row.rm, phase: row.phase,
    onboardingStatus: row.onboarding_status, riskRating: row.risk_rating,
    startDate: row.start_date, targetDate: row.target_date, nextAction: row.next_action,
    notes: row.notes, restrictedMatch: !!row.restricted_match, activated: !!row.activated,
    contractUrl: row.contract_url, activatedBy: row.activated_by, lpaUrl: row.lpa_url,
    amlReviewDate: row.aml_review_date, reClassDate: row.re_class_date,
    isInternalClient: !!row.is_internal_client, internalPortfolioId: row.internal_portfolio_id,
    identityVerified: !!row.identity_verified, sofVerified: !!row.sof_verified,
    sowVerified: !!row.sow_verified, pepStatus: row.pep_status,
    sanctionsCleared: !!row.sanctions_cleared, sanctionsCheckedAt: row.sanctions_checked_at,
    professionalClientVerified: !!row.professional_client_verified,
  };
}
const OB_CLIENT_INSERT_SQL = `
  INSERT INTO ob_clients
    (tenant_id, client_id, name, type, classification, service_type, lp_type, commitment, direction, rm,
     phase, onboarding_status, risk_rating, start_date, target_date, next_action, notes,
     restricted_match, activated, contract_url, activated_by, lpa_url, aml_review_date, re_class_date,
     is_internal_client, internal_portfolio_id, identity_verified, sof_verified, sow_verified,
     pep_status, sanctions_cleared, sanctions_checked_at, professional_client_verified)
  VALUES
    (@tenantId, @clientId, @name, @type, @classification, @serviceType, @lpType, @commitment, @direction, @rm,
     @phase, @onboardingStatus, @riskRating, @startDate, @targetDate, @nextAction, @notes,
     @restrictedMatch, @activated, @contractUrl, @activatedBy, @lpaUrl, @amlReviewDate, @reClassDate,
     @isInternalClient, @internalPortfolioId, @identityVerified, @sofVerified, @sowVerified,
     @pepStatus, @sanctionsCleared, @sanctionsCheckedAt, @professionalClientVerified)
`;
const OB_CLIENT_UPDATE_SQL = `
  UPDATE ob_clients SET
    client_id=@clientId, name=@name, type=@type, classification=@classification, service_type=@serviceType,
    lp_type=@lpType, commitment=@commitment, direction=@direction, rm=@rm, phase=@phase,
    onboarding_status=@onboardingStatus, risk_rating=@riskRating, start_date=@startDate, target_date=@targetDate,
    next_action=@nextAction, notes=@notes, restricted_match=@restrictedMatch, activated=@activated,
    contract_url=@contractUrl, activated_by=@activatedBy, lpa_url=@lpaUrl, aml_review_date=@amlReviewDate,
    re_class_date=@reClassDate, is_internal_client=@isInternalClient, internal_portfolio_id=@internalPortfolioId,
    identity_verified=@identityVerified, sof_verified=@sofVerified, sow_verified=@sowVerified,
    pep_status=@pepStatus, sanctions_cleared=@sanctionsCleared, sanctions_checked_at=@sanctionsCheckedAt,
    professional_client_verified=@professionalClientVerified
  WHERE id=@id AND tenant_id=@tenantId
`;

/* ===== obTasks ===== */
function obTaskToParams(t) {
  return {
    clientId: t.clientId, taskNum: t.taskNum, title: t.title || null, phase: t.phase != null ? t.phase : null,
    role: t.role || null, formKey: t.formKey || null, dueDate: t.dueDate || null,
    status: t.status || 'locked', formDataJson: JSON.stringify(t.formData || {}),
    completedAt: t.completedAt || null, completedBy: t.completedBy || null,
  };
}
function rowToObTask(row) {
  return {
    id: row.id, clientId: row.client_id, taskNum: row.task_num, title: row.title, phase: row.phase,
    role: row.role, formKey: row.form_key, dueDate: row.due_date, status: row.status,
    formData: JSON.parse(row.form_data_json || '{}'),
    completedAt: row.completed_at, completedBy: row.completed_by, comments: [],
  };
}
const OB_TASK_INSERT_SQL = `
  INSERT INTO ob_tasks
    (tenant_id, client_id, task_num, title, phase, role, form_key, due_date, status, form_data_json, completed_at, completed_by)
  VALUES
    (@tenantId, @clientId, @taskNum, @title, @phase, @role, @formKey, @dueDate, @status, @formDataJson, @completedAt, @completedBy)
`;
const OB_TASK_UPDATE_SQL = `
  UPDATE ob_tasks SET
    title=@title, phase=@phase, role=@role, form_key=@formKey, due_date=@dueDate, status=@status,
    form_data_json=@formDataJson, completed_at=@completedAt, completed_by=@completedBy
  WHERE id=@id AND tenant_id=@tenantId
`;

/* ===== engagements ===== */
const ENGAGEMENT_SCALARS = [
  'engId', 'clientId', 'clientName', 'serviceType', 'contractNum', 'date', 'signedDate', 'status',
  'feeType', 'feeAmount', 'successFee', 'retainer', 'payTerms', 'invoiced', 'paid', 'startDate',
  'endDate', 'rm', 'notes', 'direction', 'activationDate', 'activatedBy', 'lpaUrl', 'lpSignedDate',
  'capitalCallDate', 'contractUrl', 'dealValue', 'feeRate', 'dealRef',
];
function engagementToParams(e) {
  const out = {};
  for (const f of ENGAGEMENT_SCALARS) out[f] = e[f] != null ? e[f] : null;
  // amendments is a JSON-stringified array in the original frontend already;
  // normalize so both a raw array and a pre-stringified value work.
  out.amendmentsJson = typeof e.amendments === 'string' ? e.amendments : JSON.stringify(e.amendments || []);
  return out;
}
function rowToEngagement(row) {
  return {
    id: row.id, engId: row.eng_id, clientId: row.client_id, clientName: row.client_name,
    serviceType: row.service_type, contractNum: row.contract_num, date: row.date, signedDate: row.signed_date,
    status: row.status, feeType: row.fee_type, feeAmount: row.fee_amount, successFee: row.success_fee,
    retainer: row.retainer, payTerms: row.pay_terms, invoiced: row.invoiced, paid: row.paid,
    startDate: row.start_date, endDate: row.end_date, rm: row.rm, notes: row.notes, direction: row.direction,
    activationDate: row.activation_date, activatedBy: row.activated_by, lpaUrl: row.lpa_url,
    lpSignedDate: row.lp_signed_date, capitalCallDate: row.capital_call_date,
    amendments: row.amendments_json, contractUrl: row.contract_url, dealValue: row.deal_value, feeRate: row.fee_rate,
    dealRef: row.deal_ref,
  };
}
const ENGAGEMENT_INSERT_SQL = `
  INSERT INTO engagements
    (tenant_id, eng_id, client_id, client_name, service_type, contract_num, date, signed_date, status,
     fee_type, fee_amount, success_fee, retainer, pay_terms, invoiced, paid, start_date, end_date,
     rm, notes, direction, activation_date, activated_by, lpa_url, lp_signed_date, capital_call_date,
     amendments_json, contract_url, deal_value, fee_rate, deal_ref)
  VALUES
    (@tenantId, @engId, @clientId, @clientName, @serviceType, @contractNum, @date, @signedDate, @status,
     @feeType, @feeAmount, @successFee, @retainer, @payTerms, @invoiced, @paid, @startDate, @endDate,
     @rm, @notes, @direction, @activationDate, @activatedBy, @lpaUrl, @lpSignedDate, @capitalCallDate,
     @amendmentsJson, @contractUrl, @dealValue, @feeRate, @dealRef)
`;
const ENGAGEMENT_UPDATE_SQL = `
  UPDATE engagements SET
    eng_id=@engId, client_id=@clientId, client_name=@clientName, service_type=@serviceType,
    contract_num=@contractNum, date=@date, signed_date=@signedDate, status=@status, fee_type=@feeType,
    fee_amount=@feeAmount, success_fee=@successFee, retainer=@retainer, pay_terms=@payTerms,
    invoiced=@invoiced, paid=@paid, start_date=@startDate, end_date=@endDate, rm=@rm, notes=@notes,
    direction=@direction, activation_date=@activationDate, activated_by=@activatedBy, lpa_url=@lpaUrl,
    lp_signed_date=@lpSignedDate, capital_call_date=@capitalCallDate, amendments_json=@amendmentsJson,
    contract_url=@contractUrl, deal_value=@dealValue, fee_rate=@feeRate, deal_ref=@dealRef
  WHERE id=@id AND tenant_id=@tenantId
`;

/* ===== conflictApprovals ===== */
const CONFLICT_APPROVAL_SCALARS = [
  'clientId', 'engagementId', 'dealRef', 'decisionType', 'riskLevel', 'feeAmount',
  'decisionMaker', 'escalatedTo', 'requiredTimeline', 'status', 'description', 'rationale', 'decidedAt',
];
function conflictApprovalToParams(a) {
  const out = {};
  for (const f of CONFLICT_APPROVAL_SCALARS) out[f] = a[f] != null ? a[f] : null;
  return out;
}
function rowToConflictApproval(row) {
  return {
    id: row.id, clientId: row.client_id, engagementId: row.engagement_id, dealRef: row.deal_ref,
    decisionType: row.decision_type, riskLevel: row.risk_level, feeAmount: row.fee_amount,
    decisionMaker: row.decision_maker, escalatedTo: row.escalated_to, requiredTimeline: row.required_timeline,
    status: row.status, description: row.description, rationale: row.rationale, decidedAt: row.decided_at,
  };
}
const CONFLICT_APPROVAL_INSERT_SQL = `
  INSERT INTO conflict_approvals
    (tenant_id, client_id, engagement_id, deal_ref, decision_type, risk_level, fee_amount,
     decision_maker, escalated_to, required_timeline, status, description, rationale, decided_at)
  VALUES
    (@tenantId, @clientId, @engagementId, @dealRef, @decisionType, @riskLevel, @feeAmount,
     @decisionMaker, @escalatedTo, @requiredTimeline, @status, @description, @rationale, @decidedAt)
`;
const CONFLICT_APPROVAL_UPDATE_SQL = `
  UPDATE conflict_approvals SET
    client_id=@clientId, engagement_id=@engagementId, deal_ref=@dealRef, decision_type=@decisionType,
    risk_level=@riskLevel, fee_amount=@feeAmount, decision_maker=@decisionMaker, escalated_to=@escalatedTo,
    required_timeline=@requiredTimeline, status=@status, description=@description, rationale=@rationale,
    decided_at=@decidedAt
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = {
  restrictedToParams, rowToRestricted, RESTRICTED_INSERT_SQL,
  coiToParams, rowToCoi, COI_INSERT_SQL,
  obClientToParams, rowToObClient, OB_CLIENT_INSERT_SQL, OB_CLIENT_UPDATE_SQL,
  obTaskToParams, rowToObTask, OB_TASK_INSERT_SQL, OB_TASK_UPDATE_SQL,
  engagementToParams, rowToEngagement, ENGAGEMENT_INSERT_SQL, ENGAGEMENT_UPDATE_SQL,
  conflictApprovalToParams, rowToConflictApproval,
  CONFLICT_APPROVAL_INSERT_SQL, CONFLICT_APPROVAL_UPDATE_SQL,
};
