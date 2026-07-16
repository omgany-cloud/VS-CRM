// Shared row <-> frontend-object mapping for `deals`, used by both
// seed.js and index.js so the two never drift apart.

const JSON_FIELDS = [
  ['tags', 'tagsJson'],
  ['founderContacts', 'founderContactsJson'],
  ['tsVersions', 'tsVersionsJson'],
  ['signedDocsUrls', 'signedDocsUrlsJson'],
  ['otherDocs', 'otherDocsJson'],
  ['icVotes', 'icVotesJson'],
  ['icRisks', 'icRisksJson'],
  ['ddLegal', 'ddLegalJson'],
  ['ddFinancial', 'ddFinancialJson'],
  ['ddTech', 'ddTechJson'],
  ['ddCommercial', 'ddCommercialJson'],
  ['ddRisk', 'ddRiskJson'],
  ['ddCompliance', 'ddComplianceJson'],
  ['ddMlro', 'ddMlroJson'],
  ['ddRedFlags', 'ddRedFlagsJson'],
  ['ddConsultants', 'ddConsultantsJson'],
  ['ddConclusions', 'ddConclusionsJson'],
  ['comments', 'commentsJson'],
  ['negMeetings', 'negMeetingsJson'],
  ['negDisputedItems', 'negDisputedItemsJson'],
  ['negBlockers', 'negBlockersJson'],
];

const SCALAR_FIELDS = [
  'fundId', 'company', 'sector', 'stage', 'amount', 'type', 'priority', 'manager', 'ic',
  'nextAction', 'nextActionDate', 'updatedAt', 'country', 'companyStage', 'preMoney',
  'dealSource', 'firstContactDate', 'revenue', 'roundSize', 'checkSize', 'description',
  'pitchDeckUrl', 'icMemoUrl', 'icMinutesUrl', 'wireConfirmUrl', 'instrument', 'coInvestors',
  'icDecision', 'icDate', 'ddDeadline', 'tsFundLawyer', 'dataRoomUrl',
  'rejectCategory', 'canReturn', 'rejectFollowUpDate', 'rejectDecisionBy', 'rejectComment',
  'gpConclusionVerdict', 'gpConclusionSummary', 'gpConclusionSignedBy', 'gpConclusionSignedAt',
  // Term Sheet / Переговоры / closed-deal fields — see server/db.js's
  // migration comment for why these were added separately from the rest.
  'tsPreMoney', 'tsPostMoney', 'tsFundShare', 'tsRights', 'tsVesting', 'tsSignedDate',
  'tsStatus', 'tsCompanyLawyer', 'wireDate', 'closingDatePlanned', 'closedDate',
  'closedAmount', 'closedValuation', 'firstBoardMeeting', 'kpi6m', 'kpi12m',
];

// Frontend deal object -> flat params object ready for `at()` binding.
function dealToParams(d) {
  const out = {};
  for (const f of SCALAR_FIELDS) out[f] = d[f] != null ? d[f] : null;
  for (const [frontendKey, paramKey] of JSON_FIELDS) out[paramKey] = JSON.stringify(d[frontendKey] || []);
  return out;
}

// DB row (snake_case) -> frontend deal object (camelCase), matching the
// exact shape js/app.js's deal-modal rendering expects.
function rowToDeal(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    company: r.company, sector: r.sector, stage: r.stage, amount: r.amount, type: r.type,
    priority: r.priority, manager: r.manager, ic: r.ic,
    nextAction: r.next_action, nextActionDate: r.next_action_date, updatedAt: r.updated_at,
    country: r.country, companyStage: r.company_stage, preMoney: r.pre_money,
    dealSource: r.deal_source, firstContactDate: r.first_contact_date, revenue: r.revenue,
    roundSize: r.round_size, checkSize: r.check_size, description: r.description,
    pitchDeckUrl: r.pitch_deck_url, icMemoUrl: r.ic_memo_url, icMinutesUrl: r.ic_minutes_url,
    wireConfirmUrl: r.wire_confirm_url, instrument: r.instrument, coInvestors: r.co_investors,
    icDecision: r.ic_decision, icDate: r.ic_date, ddDeadline: r.dd_deadline,
    tsFundLawyer: r.ts_fund_lawyer, dataRoomUrl: r.data_room_url,
    rejectCategory: r.reject_category, canReturn: r.can_return,
    rejectFollowUpDate: r.reject_follow_up_date, rejectDecisionBy: r.reject_decision_by,
    rejectComment: r.reject_comment,
    gpConclusionVerdict: r.gp_conclusion_verdict, gpConclusionSummary: r.gp_conclusion_summary,
    gpConclusionSignedBy: r.gp_conclusion_signed_by, gpConclusionSignedAt: r.gp_conclusion_signed_at,
    tsPreMoney: r.ts_pre_money, tsPostMoney: r.ts_post_money, tsFundShare: r.ts_fund_share,
    tsRights: r.ts_rights, tsVesting: r.ts_vesting, tsSignedDate: r.ts_signed_date,
    tsStatus: r.ts_status, tsCompanyLawyer: r.ts_company_lawyer, wireDate: r.wire_date,
    closingDatePlanned: r.closing_date_planned, closedDate: r.closed_date,
    closedAmount: r.closed_amount, closedValuation: r.closed_valuation,
    firstBoardMeeting: r.first_board_meeting, kpi6m: r.kpi_6m, kpi12m: r.kpi_12m,
    tags: JSON.parse(r.tags_json || '[]'),
    founderContacts: JSON.parse(r.founder_contacts_json || '[]'),
    tsVersions: JSON.parse(r.ts_versions_json || '[]'),
    signedDocsUrls: JSON.parse(r.signed_docs_urls_json || '[]'),
    otherDocs: JSON.parse(r.other_docs_json || '[]'),
    icVotes: JSON.parse(r.ic_votes_json || '[]'),
    icRisks: JSON.parse(r.ic_risks_json || '[]'),
    ddLegal: JSON.parse(r.dd_legal_json || '[]'),
    ddFinancial: JSON.parse(r.dd_financial_json || '[]'),
    ddTech: JSON.parse(r.dd_tech_json || '[]'),
    ddCommercial: JSON.parse(r.dd_commercial_json || '[]'),
    ddRisk: JSON.parse(r.dd_risk_json || '[]'),
    ddCompliance: JSON.parse(r.dd_compliance_json || '[]'),
    ddMlro: JSON.parse(r.dd_mlro_json || '[]'),
    ddRedFlags: JSON.parse(r.dd_red_flags_json || '[]'),
    ddConsultants: JSON.parse(r.dd_consultants_json || '[]'),
    ddConclusions: JSON.parse(r.dd_conclusions_json || '[]'),
    comments: JSON.parse(r.comments_json || '[]'),
    negMeetings: JSON.parse(r.neg_meetings_json || '[]'),
    negDisputedItems: JSON.parse(r.neg_disputed_items_json || '[]'),
    negBlockers: JSON.parse(r.neg_blockers_json || '[]'),
  };
}

const INSERT_SQL = `
  INSERT INTO deals
    (tenant_id, fund_id, company, sector, stage, amount, type, priority, manager, ic,
     next_action, next_action_date, updated_at, country, company_stage, pre_money,
     deal_source, first_contact_date, revenue, round_size, check_size, description,
     pitch_deck_url, ic_memo_url, ic_minutes_url, wire_confirm_url, instrument, co_investors,
     ic_decision, ic_date, dd_deadline, ts_fund_lawyer, data_room_url,
     reject_category, can_return, reject_follow_up_date, reject_decision_by, reject_comment,
     gp_conclusion_verdict, gp_conclusion_summary, gp_conclusion_signed_by, gp_conclusion_signed_at,
     ts_pre_money, ts_post_money, ts_fund_share, ts_rights, ts_vesting, ts_signed_date,
     ts_status, ts_company_lawyer, wire_date, closing_date_planned, closed_date,
     closed_amount, closed_valuation, first_board_meeting, kpi_6m, kpi_12m,
     tags_json, founder_contacts_json, ts_versions_json, signed_docs_urls_json, other_docs_json,
     ic_votes_json, ic_risks_json, dd_legal_json, dd_financial_json, dd_tech_json,
     dd_commercial_json, dd_risk_json, dd_compliance_json, dd_mlro_json,
     dd_red_flags_json, dd_consultants_json, dd_conclusions_json, comments_json,
     neg_meetings_json, neg_disputed_items_json, neg_blockers_json)
  VALUES
    (@tenantId, @fundId, @company, @sector, @stage, @amount, @type, @priority, @manager, @ic,
     @nextAction, @nextActionDate, @updatedAt, @country, @companyStage, @preMoney,
     @dealSource, @firstContactDate, @revenue, @roundSize, @checkSize, @description,
     @pitchDeckUrl, @icMemoUrl, @icMinutesUrl, @wireConfirmUrl, @instrument, @coInvestors,
     @icDecision, @icDate, @ddDeadline, @tsFundLawyer, @dataRoomUrl,
     @rejectCategory, @canReturn, @rejectFollowUpDate, @rejectDecisionBy, @rejectComment,
     @gpConclusionVerdict, @gpConclusionSummary, @gpConclusionSignedBy, @gpConclusionSignedAt,
     @tsPreMoney, @tsPostMoney, @tsFundShare, @tsRights, @tsVesting, @tsSignedDate,
     @tsStatus, @tsCompanyLawyer, @wireDate, @closingDatePlanned, @closedDate,
     @closedAmount, @closedValuation, @firstBoardMeeting, @kpi6m, @kpi12m,
     @tagsJson, @founderContactsJson, @tsVersionsJson, @signedDocsUrlsJson, @otherDocsJson,
     @icVotesJson, @icRisksJson, @ddLegalJson, @ddFinancialJson, @ddTechJson,
     @ddCommercialJson, @ddRiskJson, @ddComplianceJson, @ddMlroJson,
     @ddRedFlagsJson, @ddConsultantsJson, @ddConclusionsJson, @commentsJson,
     @negMeetingsJson, @negDisputedItemsJson, @negBlockersJson)
`;

const UPDATE_SQL = `
  UPDATE deals SET
    fund_id=@fundId, company=@company, sector=@sector, stage=@stage, amount=@amount, type=@type, priority=@priority,
    manager=@manager, ic=@ic, next_action=@nextAction, next_action_date=@nextActionDate,
    updated_at=@updatedAt, country=@country, company_stage=@companyStage, pre_money=@preMoney,
    deal_source=@dealSource, first_contact_date=@firstContactDate, revenue=@revenue,
    round_size=@roundSize, check_size=@checkSize, description=@description,
    pitch_deck_url=@pitchDeckUrl, ic_memo_url=@icMemoUrl, ic_minutes_url=@icMinutesUrl,
    wire_confirm_url=@wireConfirmUrl, instrument=@instrument, co_investors=@coInvestors,
    ic_decision=@icDecision, ic_date=@icDate, dd_deadline=@ddDeadline, ts_fund_lawyer=@tsFundLawyer,
    data_room_url=@dataRoomUrl, reject_category=@rejectCategory, can_return=@canReturn,
    reject_follow_up_date=@rejectFollowUpDate, reject_decision_by=@rejectDecisionBy,
    reject_comment=@rejectComment,
    gp_conclusion_verdict=@gpConclusionVerdict, gp_conclusion_summary=@gpConclusionSummary,
    gp_conclusion_signed_by=@gpConclusionSignedBy, gp_conclusion_signed_at=@gpConclusionSignedAt,
    ts_pre_money=@tsPreMoney, ts_post_money=@tsPostMoney, ts_fund_share=@tsFundShare,
    ts_rights=@tsRights, ts_vesting=@tsVesting, ts_signed_date=@tsSignedDate,
    ts_status=@tsStatus, ts_company_lawyer=@tsCompanyLawyer, wire_date=@wireDate,
    closing_date_planned=@closingDatePlanned, closed_date=@closedDate,
    closed_amount=@closedAmount, closed_valuation=@closedValuation,
    first_board_meeting=@firstBoardMeeting, kpi_6m=@kpi6m, kpi_12m=@kpi12m,
    tags_json=@tagsJson, founder_contacts_json=@founderContactsJson,
    ts_versions_json=@tsVersionsJson, signed_docs_urls_json=@signedDocsUrlsJson,
    other_docs_json=@otherDocsJson, ic_votes_json=@icVotesJson, ic_risks_json=@icRisksJson,
    dd_legal_json=@ddLegalJson, dd_financial_json=@ddFinancialJson, dd_tech_json=@ddTechJson,
    dd_commercial_json=@ddCommercialJson, dd_risk_json=@ddRiskJson,
    dd_compliance_json=@ddComplianceJson, dd_mlro_json=@ddMlroJson,
    dd_red_flags_json=@ddRedFlagsJson,
    dd_consultants_json=@ddConsultantsJson, dd_conclusions_json=@ddConclusionsJson, comments_json=@commentsJson,
    neg_meetings_json=@negMeetingsJson, neg_disputed_items_json=@negDisputedItemsJson, neg_blockers_json=@negBlockersJson
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { dealToParams, rowToDeal, INSERT_SQL, UPDATE_SQL };
