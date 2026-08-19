// Extracted from server/index.js (was defined inline, unlike every other
// entity which already has its own <entity>Mapping.js) so
// server/externalApi.js can reuse the exact same row-mapping function
// instead of duplicating it.
function rowToLp(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    registerId: r.register_id,
    name: r.name,
    type: r.type,
    lpType: r.lp_type,
    country: r.country,
    address: r.address,
    taxId: r.tax_id,
    contact: r.contact,
    email: r.email,
    phone: r.phone,
    commitment: r.commitment,
    calledAmount: r.called_amount,
    paidAmount: r.paid_amount,
    distributions: r.distributions,
    fundClass: r.fund_class,
    ownershipPct: r.ownership_pct,
    professionalClient: r.professional_client,
    kycStatus: r.kyc_status,
    kycDate: r.kyc_date,
    kycNextReview: r.kyc_next_review,
    riskRating: r.risk_rating,
    admissionDate: r.admission_date,
    saNumber: r.sa_number,
    afsaNotified: !!r.afsa_notified,
    lpacMember: !!r.lpac_member,
    status: r.status,
    exitDate: r.exit_date,
    notes: r.notes,
    obClientId: r.ob_client_id,
    rm: r.rm,
    lpaUrl: r.lpa_url,
    saUrl: r.sa_url,
    identityVerified: !!r.identity_verified,
    proofAddressVerified: !!r.proof_address_verified,
    sofVerified: !!r.sof_verified,
    taxIdVerified: !!r.tax_id_verified,
    pepCheckCleared: !!r.pep_check_cleared,
    amlScreeningCleared: !!r.aml_screening_cleared,
    uboVerified: !!r.ubo_verified,
  };
}

// Curated subset for the LP's own self-service view (lp-portal.html) —
// deliberately NOT the full rowToLp(): an LP should see their own
// commercial/investment position, not internal-only fields like staff
// notes, the assigned RM's name, the internal risk rating, or the
// granular KYC-checklist booleans (that's an audit trail for compliance
// staff, not something to expose to the person being checked).
function rowToLpPortalView(r) {
  return {
    registerId: r.register_id,
    name: r.name,
    fundClass: r.fund_class,
    commitment: r.commitment,
    calledAmount: r.called_amount,
    paidAmount: r.paid_amount,
    distributions: r.distributions,
    ownershipPct: r.ownership_pct,
    admissionDate: r.admission_date,
    status: r.status,
    kycStatus: r.kyc_status,
    kycNextReview: r.kyc_next_review,
    lpacMember: !!r.lpac_member,
    lpaUrl: r.lpa_url,
    saUrl: r.sa_url,
    contractNum: r.contract_num,
  };
}

// lp_register.calledAmount/paidAmount/distributions are all leftover
// columns from before capital_call_line_items/distribution_line_items
// existed as the real ledgers (see lp_register's own creation comment in
// db.js). js/lp-register.js used to keep calledAmount/paidAmount in sync
// with a client-side write-back PUT after every Capital Call approval and
// payment ("best-effort, doesn't block... " per its own comments — an
// explicit admission it could silently drift), and nothing ever wrote to
// distributions at all. Same "compute live, never risk a stale
// denormalized number" principle already applied to
// funds.lpCount/deployed — every caller of rowToLp()/rowToLpPortalView()
// should override all three with these live sums instead of trusting the
// columns, so there is exactly one source of truth for each figure.
// Takes `db` and `lpId` explicitly (rather than reading `lp.id` off the
// mapped object) since rowToLpPortalView()'s curated shape deliberately
// has no `id` field at all — the caller always has the real id from the
// raw DB row, before mapping narrows it.
function withLiveFinancials(db, tenantId, lpId, lp) {
  // Only non-Draft Capital Calls count — a Draft was never actually sent
  // to any LP yet (server/index.js's own "Only now does each LP's
  // calledAmount actually count this call" comment, formerly enforced
  // only by a client-side write-back).
  const called = db.prepare(`
    SELECT COALESCE(SUM(li.called), 0) AS s
    FROM capital_call_line_items li JOIN capital_calls cc ON cc.id = li.call_id
    WHERE li.tenant_id = ? AND li.lp_id = ? AND cc.status != 'Draft'
  `).get(tenantId, lpId);
  const paid = db.prepare(`
    SELECT COALESCE(SUM(li.paid), 0) AS s
    FROM capital_call_line_items li JOIN capital_calls cc ON cc.id = li.call_id
    WHERE li.tenant_id = ? AND li.lp_id = ? AND cc.status != 'Draft'
  `).get(tenantId, lpId);
  const distributed = db.prepare(`
    SELECT COALESCE(SUM(dli.net_amount), 0) AS s
    FROM distribution_line_items dli JOIN distributions d ON d.id = dli.distribution_id
    WHERE dli.tenant_id = ? AND dli.lp_id = ? AND d.status != 'Draft'
  `).get(tenantId, lpId);
  lp.calledAmount = called.s;
  lp.paidAmount = paid.s;
  lp.distributions = distributed.s;
  return lp;
}

module.exports = { rowToLp, rowToLpPortalView, withLiveFinancials };
