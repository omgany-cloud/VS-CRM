// Runtime, DB-backed role lookups — replaces the old static server/roles.js
// catalogue now that `roles` is a real per-tenant table (server/db.js).
const { db, at } = require('./db');

// Fixed IC voting composition (Constitution Section 7: 2 GP Reps + 1
// Independent Member + 1 LP Rep) — the 4 seats themselves are a regulatory
// constant, not configurable; only WHICH role occupies each seat is.
const IC_SEATS = ['GP Rep 1', 'GP Rep 2', 'Independent Member', 'LP Rep'];

function getRoleRowByCode(tenantId, code) {
  return db.prepare('SELECT * FROM roles WHERE tenant_id = @tenantId AND code = @code').get(at({ tenantId, code }));
}

function isValidRole(tenantId, code) {
  return !!getRoleRowByCode(tenantId, code);
}

function listRoleRows(tenantId) {
  return db.prepare('SELECT * FROM roles WHERE tenant_id = ? ORDER BY id').all(tenantId);
}

module.exports = { IC_SEATS, getRoleRowByCode, isValidRole, listRoleRows };
