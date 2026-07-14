// Shared row <-> frontend-object mapping for `funds`.
// lpCount/deployed are NOT persisted columns — they're computed live by
// server/index.js's GET /api/funds handler and merged onto the object
// this returns, so rowToFund() alone never has them.

const SCALAR_FIELDS = [
  'name', 'shortName', 'gp', 'license', 'type', 'currency', 'targetSize', 'vintage',
  'status', 'phase', 'phaseYear', 'fundTerm', 'investmentPeriod',
  'managementFee', 'carriedInterest', 'preferredReturn', 'targetIRR', 'targetMOIC',
  'description', 'color', 'icon', 'nav',
];

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
    description: row.description,
    color: row.color,
    icon: row.icon,
    nav: row.nav,
    createdAt: row.created_at,
  };
}

const INSERT_SQL = `
  INSERT INTO funds
    (tenant_id, name, short_name, gp, license, type, currency, target_size, vintage,
     status, phase, phase_year, fund_term, investment_period,
     management_fee, carried_interest, preferred_return, target_irr, target_moic,
     description, color, icon, nav)
  VALUES
    (@tenantId, @name, @shortName, @gp, @license, @type, @currency, @targetSize, @vintage,
     @status, @phase, @phaseYear, @fundTerm, @investmentPeriod,
     @managementFee, @carriedInterest, @preferredReturn, @targetIRR, @targetMOIC,
     @description, @color, @icon, @nav)
`;

const UPDATE_SQL = `
  UPDATE funds SET
    name=@name, short_name=@shortName, gp=@gp, license=@license, type=@type,
    currency=@currency, target_size=@targetSize, vintage=@vintage,
    status=@status, phase=@phase, phase_year=@phaseYear, fund_term=@fundTerm,
    investment_period=@investmentPeriod, management_fee=@managementFee,
    carried_interest=@carriedInterest, preferred_return=@preferredReturn,
    target_irr=@targetIRR, target_moic=@targetMOIC, description=@description,
    color=@color, icon=@icon, nav=@nav
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { fundToParams, rowToFund, INSERT_SQL, UPDATE_SQL };
