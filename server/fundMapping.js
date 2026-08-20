// Shared row <-> frontend-object mapping for `funds`.
// lpCount/deployed are NOT persisted columns — they're computed live by
// server/index.js's GET /api/funds handler and merged onto the object
// this returns, so rowToFund() alone never has them.

const SCALAR_FIELDS = [
  'name', 'shortName', 'gp', 'license', 'type', 'currency', 'targetSize', 'vintage',
  'status', 'phase', 'phaseYear', 'fundTerm', 'investmentPeriod',
  'managementFee', 'carriedInterest', 'preferredReturn', 'targetIRR', 'targetMOIC',
  // catchUpPct: waterfallEngine.js's GP catch-up fraction (100 = full
  // catch-up). waterfallType isn't listed here on purpose — the column
  // exists (default 'european') but only European/whole-fund is actually
  // implemented, so exposing it via the API would let a fund be set to
  // 'american' and silently have nothing change.
  'catchUpPct',
  // assetClass IS client-settable (the "Create fund" form picks it).
  // operatingModel is NOT — see operatingModelForAssetClass() below;
  // server/index.js's POST/PUT /api/funds derives it from assetClass
  // before ever calling fundToParams(), so a caller can't set it directly.
  'assetClass', 'operatingModel',
  // Hedge Fund settings (docs/TZ_Hedge_Fund_Module.md §2.1) — hwmScope
  // deliberately excluded, see the migration comment in server/db.js.
  'performanceFeePct', 'hfHurdleRate', 'subscriptionFrequency', 'redemptionFrequency',
  'redemptionNoticeDays', 'lockupMonths', 'gatePct', 'feeCrystallizationFrequency',
  'description', 'color', 'icon', 'nav',
  'gpCEO', 'gpTitle', 'gpAddress', 'gpBIN', 'gpBankName', 'gpBIC', 'gpIBANkzt', 'gpIBANusd',
];

// docs/ARCHITECTURE_Multi_Strategy_Roadmap.md §3: operating_model is
// derived from asset_class, never set independently — 'hedge_fund' is the
// only open-end asset class today; pe/vc/reit are all closed-end (they
// share capital_calls/distributions/waterfallEngine.js).
function operatingModelForAssetClass(assetClass) {
  return assetClass === 'hedge_fund' ? 'open-end' : 'closed-end';
}

function fundToParams(f) {
  const out = {};
  for (const field of SCALAR_FIELDS) out[field] = f[field] != null ? f[field] : null;
  return out;
}

function rowToFund(row) {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    gp: row.gp,
    license: row.license,
    type: row.type,
    currency: row.currency,
    targetSize: row.target_size,
    vintage: row.vintage,
    status: row.status,
    phase: row.phase,
    phaseYear: row.phase_year,
    fundTerm: row.fund_term,
    investmentPeriod: row.investment_period,
    managementFee: row.management_fee,
    carriedInterest: row.carried_interest,
    preferredReturn: row.preferred_return,
    targetIRR: row.target_irr,
    targetMOIC: row.target_moic,
    catchUpPct: row.catch_up_pct,
    assetClass: row.asset_class,
    operatingModel: row.operating_model,
    performanceFeePct: row.performance_fee_pct,
    hfHurdleRate: row.hf_hurdle_rate,
    subscriptionFrequency: row.subscription_frequency,
    redemptionFrequency: row.redemption_frequency,
    redemptionNoticeDays: row.redemption_notice_days,
    lockupMonths: row.lockup_months,
    gatePct: row.gate_pct,
    feeCrystallizationFrequency: row.fee_crystallization_frequency,
    description: row.description,
    color: row.color,
    icon: row.icon,
    nav: row.nav,
    gpCEO: row.gp_ceo,
    gpTitle: row.gp_title,
    gpAddress: row.gp_address,
    gpBIN: row.gp_bin,
    gpBankName: row.gp_bank_name,
    gpBIC: row.gp_bic,
    gpIBANkzt: row.gp_iban_kzt,
    gpIBANusd: row.gp_iban_usd,
    createdAt: row.created_at,
  };
}

const INSERT_SQL = `
  INSERT INTO funds
    (tenant_id, name, short_name, gp, license, type, currency, target_size, vintage,
     status, phase, phase_year, fund_term, investment_period,
     management_fee, carried_interest, preferred_return, target_irr, target_moic, catch_up_pct,
     asset_class, operating_model,
     performance_fee_pct, hf_hurdle_rate, subscription_frequency, redemption_frequency,
     redemption_notice_days, lockup_months, gate_pct, fee_crystallization_frequency,
     description, color, icon, nav,
     gp_ceo, gp_title, gp_address, gp_bin, gp_bank_name, gp_bic, gp_iban_kzt, gp_iban_usd)
  VALUES
    (@tenantId, @name, @shortName, @gp, @license, @type, @currency, @targetSize, @vintage,
     @status, @phase, @phaseYear, @fundTerm, @investmentPeriod,
     @managementFee, @carriedInterest, @preferredReturn, @targetIRR, @targetMOIC, @catchUpPct,
     @assetClass, @operatingModel,
     @performanceFeePct, @hfHurdleRate, @subscriptionFrequency, @redemptionFrequency,
     @redemptionNoticeDays, @lockupMonths, @gatePct, @feeCrystallizationFrequency,
     @description, @color, @icon, @nav,
     @gpCEO, @gpTitle, @gpAddress, @gpBIN, @gpBankName, @gpBIC, @gpIBANkzt, @gpIBANusd)
`;

const UPDATE_SQL = `
  UPDATE funds SET
    name=@name, short_name=@shortName, gp=@gp, license=@license, type=@type,
    currency=@currency, target_size=@targetSize, vintage=@vintage,
    status=@status, phase=@phase, phase_year=@phaseYear, fund_term=@fundTerm,
    investment_period=@investmentPeriod, management_fee=@managementFee,
    carried_interest=@carriedInterest, preferred_return=@preferredReturn,
    target_irr=@targetIRR, target_moic=@targetMOIC, catch_up_pct=@catchUpPct,
    asset_class=@assetClass, operating_model=@operatingModel,
    performance_fee_pct=@performanceFeePct, hf_hurdle_rate=@hfHurdleRate,
    subscription_frequency=@subscriptionFrequency, redemption_frequency=@redemptionFrequency,
    redemption_notice_days=@redemptionNoticeDays, lockup_months=@lockupMonths,
    gate_pct=@gatePct, fee_crystallization_frequency=@feeCrystallizationFrequency,
    description=@description,
    color=@color, icon=@icon, nav=@nav,
    gp_ceo=@gpCEO, gp_title=@gpTitle, gp_address=@gpAddress, gp_bin=@gpBIN,
    gp_bank_name=@gpBankName, gp_bic=@gpBIC, gp_iban_kzt=@gpIBANkzt, gp_iban_usd=@gpIBANusd
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { fundToParams, rowToFund, INSERT_SQL, UPDATE_SQL, operatingModelForAssetClass };
