// Shared row <-> frontend-object mapping for `afsa_reports`.

function rowToAfsaReport(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    reportType: r.report_type,
    period: r.period,
    deadline: r.deadline,
    status: r.status,
    resp: r.resp,
    submittedAt: r.submitted_at,
    submittedBy: r.submitted_by,
    documentUrl: r.document_url,
    notes: r.notes,
  };
}

function afsaReportToParams(rep) {
  return {
    fundId: rep.fundId != null ? rep.fundId : null,
    reportType: rep.reportType,
    period: rep.period,
    deadline: rep.deadline,
    status: rep.status || 'Ожидается',
    resp: rep.resp || null,
    submittedAt: rep.submittedAt || null,
    submittedBy: rep.submittedBy || null,
    documentUrl: rep.documentUrl || null,
    notes: rep.notes || null,
  };
}

const INSERT_SQL = `
  INSERT INTO afsa_reports
    (tenant_id, fund_id, report_type, period, deadline, status, resp, submitted_at, submitted_by, document_url, notes)
  VALUES
    (@tenantId, @fundId, @reportType, @period, @deadline, @status, @resp, @submittedAt, @submittedBy, @documentUrl, @notes)
`;

const UPDATE_SQL = `
  UPDATE afsa_reports SET
    fund_id=@fundId, report_type=@reportType, period=@period, deadline=@deadline,
    status=@status, resp=@resp, submitted_at=@submittedAt, submitted_by=@submittedBy,
    document_url=@documentUrl, notes=@notes
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { rowToAfsaReport, afsaReportToParams, INSERT_SQL, UPDATE_SQL };
