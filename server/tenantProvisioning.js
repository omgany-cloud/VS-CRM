// Tenant provisioning — shared by server/seed.js (demo data, run once via
// `node seed.js`) and POST /api/auth/signup (live, run per new company).
// All three functions are idempotent and side-effect-free beyond their own
// args + current DB state, so they're safe to call from either context.
const bcrypt = require('bcryptjs');
const { db, at } = require('./db');
const { SYSTEM_ROLES } = require('./rolesSeed');
const { roleToParams, INSERT_SQL: ROLE_INSERT_SQL } = require('./rolesMapping');

function upsertTenant(slug, name) {
  const existing = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO tenants (slug, name) VALUES (?, ?)').run(slug, name);
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(info.lastInsertRowid);
}

function upsertRole(tenantId, def) {
  const existing = db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(tenantId, def.code);
  if (existing) return existing;
  const params = roleToParams({ ...def, isSystem: true });
  const info = db.prepare(ROLE_INSERT_SQL).run(at({ tenantId, ...params }));
  return db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid);
}

function upsertUser(tenantId, email, password, role, name) {
  const existing = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantId, email);
  if (existing) return existing;
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, ?, ?)'
  ).run(tenantId, email, hash, role, name || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// Seeds all 10 built-in system roles for a tenant — the minimum needed for
// a brand-new company to be usable (no demo data).
function seedSystemRoles(tenantId) {
  for (const r of SYSTEM_ROLES) upsertRole(tenantId, r);
}

module.exports = { upsertTenant, upsertRole, upsertUser, seedSystemRoles };
