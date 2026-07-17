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
    identityVerified: !!r.identity_verified,
    proofAddressVerified: !!r.proof_address_verified,
    sofVerified: !!r.sof_verified,
    taxIdVerified: !!r.tax_id_verified,
    pepCheckCleared: !!r.pep_check_cleared,
    amlScreeningCleared: !!r.aml_screening_cleared,
    uboVerified: !!r.ubo_verified,
  };
}

module.exports = { rowToLp };
