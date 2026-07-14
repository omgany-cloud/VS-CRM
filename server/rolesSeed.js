// The 10 built-in roles, seeded once per tenant as is_system=1 rows in the
// `roles` table (server/db.js). This is the one-time seed-default data that
// used to live in the static server/roles.js catalogue — after seeding,
// server/rolesRepo.js reads the live DB rows, never this file, so editing
// permissions here has no effect on an already-seeded tenant (use the
// Roles admin UI / API for that).
const SYSTEM_ROLES = [
  { code: 'CEO', label: 'CEO', icon: 'fa-crown', color: '#eab308',
    internal: true, manageUsers: true, manageRoles: true, accessFM: true,
    decideConflicts: true, authorICMemo: true, riskVeto: false, icSeat: 'GP Rep 1' },
  { code: 'CFO', label: 'CFO', icon: 'fa-coins', color: '#f59e0b',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, icSeat: 'GP Rep 2' },
  { code: 'CIO', label: 'CIO', icon: 'fa-chess-king', color: '#0ea5e9',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, icSeat: null },
  { code: 'RELATIONSHIP_MANAGER', label: 'RM (Relationship Manager)', icon: 'fa-handshake', color: '#3b82f6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, icSeat: null },
  { code: 'COMPLIANCE_OFFICER', label: 'CO (Compliance Officer)', icon: 'fa-shield-alt', color: '#8b5cf6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: true, authorICMemo: false, riskVeto: false, icSeat: null },
  { code: 'MLRO', label: 'MLRO', icon: 'fa-search', color: '#ef4444',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: true, authorICMemo: false, riskVeto: false, icSeat: null },
  { code: 'ANALYST', label: 'Analyst', icon: 'fa-chart-bar', color: '#14b8a6',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: true, riskVeto: false, icSeat: null },
  { code: 'RISK_MANAGER', label: 'Risk Manager', icon: 'fa-triangle-exclamation', color: '#dc2626',
    internal: true, manageUsers: false, manageRoles: false, accessFM: true,
    decideConflicts: false, authorICMemo: false, riskVeto: true, icSeat: null },
  { code: 'IC_INDEPENDENT', label: 'Independent Member (IC)', icon: 'fa-user-check', color: '#64748b',
    internal: false, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, icSeat: 'Independent Member' },
  { code: 'IC_LP_REP', label: 'LP Representative (IC)', icon: 'fa-user-tie', color: '#64748b',
    internal: false, manageUsers: false, manageRoles: false, accessFM: false,
    decideConflicts: false, authorICMemo: false, riskVeto: false, icSeat: 'LP Rep' },
];

module.exports = { SYSTEM_ROLES };
