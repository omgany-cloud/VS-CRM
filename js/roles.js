// Runtime role catalogue for the frontend. `ROLES`/`ROLE_CODES` are `let`,
// not `const` — this data now lives in the DB (server/db.js's `roles`
// table, server/rolesRepo.js), not hardcoded here. The object below is
// only a pre-login fallback (so the login screen itself has something to
// render before an API call is possible); loadRolesFromApi() in
// js/api-auth.js overwrites it with the live catalogue right after login.
let ROLES = {
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

let ROLE_CODES = Object.keys(ROLES);

// The 4 fixed IC voting seats — a regulatory constant, not configurable.
// Only which role occupies each seat is.
const IC_SEATS = ['GP Rep 1', 'GP Rep 2', 'Independent Member', 'LP Rep'];

function roleLabel(code) {
  return (ROLES[code] && ROLES[code].label) || code || '—';
}

// Which role (if any) currently holds a given IC seat — used to render the
// new-memo seat checklist (js/modules.js) without hardcoding person names.
function roleForIcSeat(seat) {
  return Object.values(ROLES).find(r => r.icSeat === seat) || null;
}
