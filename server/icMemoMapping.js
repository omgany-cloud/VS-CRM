// Shared row <-> frontend-object mapping for `icMemos`.

// Fixed IC voting roster (Constitution Section 7: 2 GP Reps + 1 Independent
// Member + 1 LP Rep) — each seat maps 1:1 to a real account role, so vote
// ownership can be checked by comparing the caller's role to this map
// instead of threading a separate userId through every vote entry. Mirrors
// IC_ROLE_DEFS in js/modules.js.
const IC_SEAT_ROLE_CODES = {
  'GP Rep 1': 'CEO',
  'GP Rep 2': 'CFO',
  'Independent Member': 'IC_INDEPENDENT',
  'LP Rep': 'IC_LP_REP',
};

const SCALAR_FIELDS = [
  'dealId', 'company', 'sector', 'amount', 'type', 'stage', 'author',
  'createdAt', 'status', 'meetingDate', 'thesis', 'risks', 'financials',
  'exitPlan', 'resolution', 'riskConclusion',
];

function icMemoToParams(m) {
  const out = {};
  for (const f of SCALAR_FIELDS) out[f] = m[f] != null ? m[f] : null;
  out.votesJson = JSON.stringify(m.votes || []);
  out.quorumMet = m.quorumMet ? 1 : 0;
  out.riskVeto = m.riskVeto ? 1 : 0;
  return out;
}

function rowToIcMemo(row) {
  return {
    id: row.id, dealId: row.deal_id, company: row.company, sector: row.sector,
    amount: row.amount, type: row.type, stage: row.stage, author: row.author,
    createdAt: row.memo_created_at, status: row.status, meetingDate: row.meeting_date,
    thesis: row.thesis, risks: row.risks, financials: row.financials, exitPlan: row.exit_plan,
    votes: JSON.parse(row.votes_json || '[]'), resolution: row.resolution,
    quorumMet: !!row.quorum_met, riskVeto: !!row.risk_veto, riskConclusion: row.risk_conclusion,
  };
}

const INSERT_SQL = `
  INSERT INTO ic_memos
    (tenant_id, deal_id, company, sector, amount, type, stage, author, memo_created_at,
     status, meeting_date, thesis, risks, financials, exit_plan, votes_json, resolution,
     quorum_met, risk_veto, risk_conclusion)
  VALUES
    (@tenantId, @dealId, @company, @sector, @amount, @type, @stage, @author, @createdAt,
     @status, @meetingDate, @thesis, @risks, @financials, @exitPlan, @votesJson, @resolution,
     @quorumMet, @riskVeto, @riskConclusion)
`;

const UPDATE_SQL = `
  UPDATE ic_memos SET
    deal_id=@dealId, company=@company, sector=@sector, amount=@amount, type=@type, stage=@stage,
    author=@author, memo_created_at=@createdAt, status=@status, meeting_date=@meetingDate,
    thesis=@thesis, risks=@risks, financials=@financials, exit_plan=@exitPlan,
    votes_json=@votesJson, resolution=@resolution,
    quorum_met=@quorumMet, risk_veto=@riskVeto, risk_conclusion=@riskConclusion
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { icMemoToParams, rowToIcMemo, INSERT_SQL, UPDATE_SQL, IC_SEAT_ROLE_CODES };
