// Canonical role catalogue for the frontend.
// Mirrored in server/roles.js for the backend (no shared module system in this codebase — keep both in sync manually).
const ROLES = {
  CEO:                   { code: 'CEO',                   label: 'CEO',                        internal: true,  icon: 'fa-crown',      color: '#eab308' },
  CFO:                   { code: 'CFO',                   label: 'CFO',                         internal: true,  icon: 'fa-coins',      color: '#f59e0b' },
  CIO:                   { code: 'CIO',                   label: 'CIO',                         internal: true,  icon: 'fa-chess-king', color: '#0ea5e9' },
  RELATIONSHIP_MANAGER:  { code: 'RELATIONSHIP_MANAGER',  label: 'RM (Relationship Manager)',   internal: true,  icon: 'fa-handshake',  color: '#3b82f6' },
  COMPLIANCE_OFFICER:    { code: 'COMPLIANCE_OFFICER',    label: 'CO (Compliance Officer)',     internal: true,  icon: 'fa-shield-alt', color: '#8b5cf6' },
  MLRO:                  { code: 'MLRO',                  label: 'MLRO',                        internal: true,  icon: 'fa-search',     color: '#ef4444' },
  ANALYST:               { code: 'ANALYST',               label: 'Analyst',                     internal: true,  icon: 'fa-chart-bar',  color: '#14b8a6' },
  RISK_MANAGER:          { code: 'RISK_MANAGER',          label: 'Risk Manager',                internal: true,  icon: 'fa-triangle-exclamation', color: '#dc2626' },
  IC_INDEPENDENT:        { code: 'IC_INDEPENDENT',        label: 'Independent Member (IC)',      internal: false, icon: 'fa-user-check', color: '#64748b' },
  IC_LP_REP:             { code: 'IC_LP_REP',             label: 'LP Representative (IC)',       internal: false, icon: 'fa-user-tie',   color: '#64748b' },
};

const ROLE_CODES = Object.keys(ROLES);

function roleLabel(code) {
  return (ROLES[code] && ROLES[code].label) || code || '—';
}
