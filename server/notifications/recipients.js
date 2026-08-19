// server/notifications/recipients.js
//
// Recipient resolution for notification triggers — same principle as the
// permission checks in server/auth.js: select active=1 users of the
// tenant whose role has the needed flag/code, no separate subscription
// model. Two resolution shapes, matching how the app already distinguishes
// them elsewhere:
//   - usersByRoleCode: a literal role-code match (e.g. PUT /api/workflow/:id
//     checking `req.user.role !== step.role` — "this specific org-chart
//     role signs off here," not a capability).
//   - usersByPermissionFlag: a boolean capability column on `roles`
//     (cc_approve, payment_confirm, ...) — the same join every
//     requirePermission() check is built on.
const { db } = require('../db');

function usersByRoleCode(tenantId, roleCodes) {
  const codes = Array.isArray(roleCodes) ? roleCodes : [roleCodes];
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND active = 1 AND role IN (${placeholders})`)
    .all(tenantId, ...codes);
}

// flagColumn is always a hardcoded literal from trigger code in this
// codebase, never request input — interpolated directly since node:sqlite
// can't parameterize a column/identifier name.
function usersByPermissionFlag(tenantId, flagColumn) {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = u.role
    WHERE u.tenant_id = ? AND u.active = 1 AND r.${flagColumn} = 1
  `).all(tenantId);
}

module.exports = { usersByRoleCode, usersByPermissionFlag };
