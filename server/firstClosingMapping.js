// Shared row <-> frontend-object mapping for `first_closing` — one row
// per fund (server/db.js's UNIQUE(tenant_id, fund_id)).

function rowToFirstClosing(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    boardResolutionUrl: r.board_resolution_url,
    closingCertUrl: r.closing_cert_url,
    closingDate: r.closing_date,
    firstCCId: r.first_cc_id,
    afsaNotifDate: r.afsa_notif_date,
    afsaNotifNum: r.afsa_notif_num,
    afsaConfirmUrl: r.afsa_confirm_url,
    welcomeLetterLog: JSON.parse(r.welcome_letter_log_json || '[]'),
  };
}

// Frontend object -> flat params ready for `at()` binding. fundId/id are
// bound separately by the caller (create vs update need different keys).
function firstClosingToParams(f) {
  return {
    boardResolutionUrl: f.boardResolutionUrl || null,
    closingCertUrl: f.closingCertUrl || null,
    closingDate: f.closingDate || null,
    firstCCId: f.firstCCId != null ? f.firstCCId : null,
    afsaNotifDate: f.afsaNotifDate || null,
    afsaNotifNum: f.afsaNotifNum || null,
    afsaConfirmUrl: f.afsaConfirmUrl || null,
    welcomeLetterLogJson: JSON.stringify(f.welcomeLetterLog || []),
  };
}

const INSERT_SQL = `
  INSERT INTO first_closing
    (tenant_id, fund_id, board_resolution_url, closing_cert_url, closing_date, first_cc_id,
     afsa_notif_date, afsa_notif_num, afsa_confirm_url, welcome_letter_log_json, updated_at)
  VALUES
    (@tenantId, @fundId, @boardResolutionUrl, @closingCertUrl, @closingDate, @firstCCId,
     @afsaNotifDate, @afsaNotifNum, @afsaConfirmUrl, @welcomeLetterLogJson, datetime('now'))
`;

const UPDATE_SQL = `
  UPDATE first_closing SET
    board_resolution_url=@boardResolutionUrl, closing_cert_url=@closingCertUrl,
    closing_date=@closingDate, first_cc_id=@firstCCId, afsa_notif_date=@afsaNotifDate,
    afsa_notif_num=@afsaNotifNum, afsa_confirm_url=@afsaConfirmUrl,
    welcome_letter_log_json=@welcomeLetterLogJson, updated_at=datetime('now')
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { rowToFirstClosing, firstClosingToParams, INSERT_SQL, UPDATE_SQL };
