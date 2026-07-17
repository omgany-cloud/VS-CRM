// Shared row <-> frontend-object mapping for `portfolio`.
// Unlike deals (many small parallel lists), each portfolio company has a
// handful of large nested sections (financials/monitoring/documents/
// compliance/exit/history) — those are stored as ONE JSON column each
// rather than split field-by-field. Same PoC tradeoff as deals: fine
// unless something needs to query *inside* those sections.

const SCALAR_FIELDS = [
  // NB: fundId (which fund made this investment) is distinct from the
  // pre-existing fundShare (ownership % of the portfolio company) below.
  'fundId',
  'name', 'sector', 'stage', 'bin', 'invested', 'value', 'date',
  'exitStrategy', 'exitYear', 'moic', 'fundShare', 'manager', 'status',
  'nextAction', 'nextActionDate', 'lastUpdated',
];

const JSON_SECTIONS = ['financials', 'monitoring', 'documents', 'compliance', 'exit', 'history'];

function portfolioToParams(p) {
  const out = {};
  for (const f of SCALAR_FIELDS) out[f] = p[f] != null ? p[f] : null;
  out.archived = p.archived ? 1 : 0;
  out.archivedAt = p.archivedAt || null;
  out.archivedBy = p.archivedBy || null;
  out.financialsJson = JSON.stringify(p.financials || {});
  out.monitoringJson = JSON.stringify(p.monitoring || {});
  out.documentsJson = JSON.stringify(p.documents || {});
  out.complianceJson = JSON.stringify(p.compliance || {});
  out.exitJson = JSON.stringify(p.exit || {});
  out.historyJson = JSON.stringify(p.history || []);
  return out;
}

function rowToPortfolio(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    name: r.name, sector: r.sector, stage: r.stage, bin: r.bin,
    invested: r.invested, value: r.value, date: r.date,
    exitStrategy: r.exit_strategy, exitYear: r.exit_year, moic: r.moic, fundShare: r.fund_share,
    manager: r.manager, status: r.status, nextAction: r.next_action, nextActionDate: r.next_action_date,
    lastUpdated: r.last_updated,
    archived: !!r.archived,
    archivedAt: r.archived_at,
    archivedBy: r.archived_by,
    financials: JSON.parse(r.financials_json || '{}'),
    monitoring: JSON.parse(r.monitoring_json || '{}'),
    documents: JSON.parse(r.documents_json || '{}'),
    compliance: JSON.parse(r.compliance_json || '{}'),
    exit: JSON.parse(r.exit_json || '{}'),
    history: JSON.parse(r.history_json || '[]'),
  };
}

const INSERT_SQL = `
  INSERT INTO portfolio
    (tenant_id, fund_id, name, sector, stage, bin, invested, value, date, exit_strategy, exit_year, moic, fund_share,
     manager, status, next_action, next_action_date, last_updated, archived, archived_at, archived_by,
     financials_json, monitoring_json, documents_json, compliance_json, exit_json, history_json)
  VALUES
    (@tenantId, @fundId, @name, @sector, @stage, @bin, @invested, @value, @date, @exitStrategy, @exitYear, @moic, @fundShare,
     @manager, @status, @nextAction, @nextActionDate, @lastUpdated, @archived, @archivedAt, @archivedBy,
     @financialsJson, @monitoringJson, @documentsJson, @complianceJson, @exitJson, @historyJson)
`;

const UPDATE_SQL = `
  UPDATE portfolio SET
    fund_id=@fundId, name=@name, sector=@sector, stage=@stage, bin=@bin, invested=@invested, value=@value, date=@date,
    exit_strategy=@exitStrategy, exit_year=@exitYear, moic=@moic, fund_share=@fundShare,
    manager=@manager, status=@status, next_action=@nextAction, next_action_date=@nextActionDate,
    last_updated=@lastUpdated, archived=@archived, archived_at=@archivedAt, archived_by=@archivedBy,
    financials_json=@financialsJson, monitoring_json=@monitoringJson,
    documents_json=@documentsJson, compliance_json=@complianceJson, exit_json=@exitJson, history_json=@historyJson
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { portfolioToParams, rowToPortfolio, INSERT_SQL, UPDATE_SQL };
