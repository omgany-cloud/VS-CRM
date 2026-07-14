// Canonical role catalogue for backend auth/authorization.
// Mirrored in js/roles.js for the frontend (no shared module system in this codebase — keep both in sync manually).
const ROLES = {
  CEO:                   { code: 'CEO',                   label: 'CEO',                        internal: true },
  CFO:                   { code: 'CFO',                   label: 'CFO',                         internal: true },
  CIO:                   { code: 'CIO',                   label: 'CIO',                         internal: true },
  RELATIONSHIP_MANAGER:  { code: 'RELATIONSHIP_MANAGER',  label: 'RM (Relationship Manager)',   internal: true },
  COMPLIANCE_OFFICER:    { code: 'COMPLIANCE_OFFICER',    label: 'CO (Compliance Officer)',     internal: true },
  MLRO:                  { code: 'MLRO',                  label: 'MLRO',                        internal: true },
  ANALYST:               { code: 'ANALYST',               label: 'Analyst',                     internal: true },
  RISK_MANAGER:          { code: 'RISK_MANAGER',          label: 'Risk Manager',                internal: true },
  IC_INDEPENDENT:        { code: 'IC_INDEPENDENT',        label: 'Independent Member (IC)',      internal: false },
  IC_LP_REP:             { code: 'IC_LP_REP',             label: 'LP Representative (IC)',       internal: false },
};

const ROLE_CODES = Object.keys(ROLES);
const INTERNAL_ROLES = new Set(ROLE_CODES.filter(c => ROLES[c].internal));

function isValidRole(code) {
  return Object.prototype.hasOwnProperty.call(ROLES, code);
}

module.exports = { ROLES, ROLE_CODES, INTERNAL_ROLES, isValidRole };
