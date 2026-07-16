// The 10 built-in roles, seeded once per tenant as is_system=1 rows in the
// `roles` table (server/db.js). This is the one-time seed-default data that
// used to live in the static server/roles.js catalogue — after seeding,
// server/rolesRepo.js reads the live DB rows, never this file, so editing
// permissions here has no effect on an already-seeded tenant (use the
// Roles admin UI / API for that).
const SYSTEM_ROLES = [
  { code: 'CEO', label: 'CEO', icon: 'fa-crown', color: '#eab308',
    internal: true, manageUsers: true, manageRoles: true, accessFM: true,
    decideConflicts: true, authorICMemo: true, riskVeto: false, amlClear: false, icSeat: 'GP Rep 1' },
  { code: 'CFO', label: 'CFO', icon: 'fa-coins', color: '#f59e0b',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, amlClear: false, icSeat: 'GP Rep 2' },
  { code: 'CIO', label: 'CIO', icon: 'fa-chess-king', color: '#0ea5e9',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, amlClear: false, icSeat: null },
  { code: 'RELATIONSHIP_MANAGER', label: 'RM (Relationship Manager)', icon: 'fa-handshake', color: '#3b82f6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, amlClear: false, icSeat: null },
  // AML/SoF clearance on a capital-call payment is restricted to the
  // compliance-function roles (see server/db.js's aml_clear comment) —
  // an RM confirming their own client's AML check would defeat the
  // point of it being an independent check.
  { code: 'COMPLIANCE_OFFICER', label: 'CO (Compliance Officer)', icon: 'fa-shield-alt', color: '#8b5cf6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: true, authorICMemo: false, riskVeto: false, amlClear: true, icSeat: null },
  { code: 'MLRO', label: 'MLRO', icon: 'fa-search', color: '#ef4444',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: true, authorICMemo: false, riskVeto: false, amlClear: true, icSeat: null },
  { code: 'ANALYST', label: 'Analyst', icon: 'fa-chart-bar', color: '#14b8a6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, amlClear: false, icSeat: null },
  { code: 'RISK_MANAGER', label: 'Risk Manager', icon: 'fa-triangle-exclamation', color: '#dc2626',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: false, riskVeto: true, amlClear: false, icSeat: null },
  { code: 'IC_INDEPENDENT', label: 'Independent Member (IC)', icon: 'fa-user-check', color: '#64748b',
    internal: false, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, amlClear: false, icSeat: 'Independent Member' },
  { code: 'IC_LP_REP', label: 'LP Representative (IC)', icon: 'fa-user-tie', color: '#64748b',
    internal: false, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, amlClear: false, icSeat: 'LP Rep' },
  // View-everything, change-nothing: internal + accessFM + manageUsers/manageRoles
  // cover every GET route this app has (see server/auth.js's readOnly enforcement,
  // which blocks every mutating request regardless of these flags).
  { code: 'AUDITOR', label: 'Внутренний аудитор', icon: 'fa-clipboard-check', color: '#06b6d4',
    internal: true, manageUsers: true, manageRoles: true, accessFM: true,
    decideConflicts: false, authorICMemo: false, riskVeto: false, amlClear: false, icSeat: null, readOnly: true },
];

module.exports = { SYSTEM_ROLES };
