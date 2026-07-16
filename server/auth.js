const jwt = require('jsonwebtoken');
const { db, at } = require('./db');
const { getRoleRowByCode } = require('./rolesRepo');
const { rowToPermissions, NO_PERMISSIONS } = require('./rolesMapping');

// PoC only — in production this must come from a real secret manager,
// be per-environment, and be rotated.
const JWT_SECRET = process.env.JWT_SECRET || 'poc-dev-secret-do-not-use-in-production';

function signToken(user, tenant) {
  return jwt.sign(
    { sub: user.id, tenantId: tenant.id, tenantSlug: tenant.slug, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// Portal tokens identify a portfolio company, not an internal user — there
// is no `sub` pointing at a `users` row, just `portal: true` plus the
// portfolio row's own id/tenant. Kept structurally close to signToken()
// (same secret, same 12h expiry) so GET /api/uploads/:id's generic
// jwt.verify + tenantId check (server/index.js) already works against a
// portal token with no changes needed there.
function signPortalToken(portfolioRow) {
  return jwt.sign(
    { portal: true, portfolioId: portfolioRow.id, tenantId: portfolioRow.tenant_id, bin: portfolioRow.bin },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// Any request whose role has the readOnly permission is blocked here,
// regardless of which other permission flags it holds or which per-route
// check (permission flag or literal role-code match) would otherwise have
// allowed it through — see requireAuth below.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Express middleware: verifies the Bearer token and attaches
// req.tenantId / req.user — every tenant-scoped route reads
// req.tenantId from here, never from a client-supplied param.
// This is the enforcement point for tenant isolation (and, via
// MUTATING_METHODS above, for read-only roles).
//
// req.user.role/active/name are re-read from the DB on every request rather
// than trusted from the JWT claim, so a role change or deactivation takes
// effect on the user's very next request instead of waiting out the 12h
// token expiry. The JWT's `role` claim is otherwise vestigial after login.
//
// req.user.permissions is resolved from the live `roles` table in the same
// request — a role's permissions are DATA (server/rolesRepo.js), not code,
// so editing them via the Roles admin UI takes effect on every holder's
// very next request, same latency as the role/active re-check above.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT id, email, name, role, active FROM users WHERE id = @id AND tenant_id = @tenantId')
      .get(at({ id: payload.sub, tenantId: payload.tenantId }));
    if (!row || !row.active) return res.status(401).json({ error: 'Account inactive or not found' });
    const roleRow = getRoleRowByCode(payload.tenantId, row.role);
    req.user = {
      id: row.id, email: row.email, name: row.name, role: row.role,
      permissions: roleRow ? rowToPermissions(roleRow) : NO_PERMISSIONS,
    };
    req.tenantId = payload.tenantId;
    req.tenantSlug = payload.tenantSlug;
    if (req.user.permissions.readOnly && MUTATING_METHODS.has(req.method)) {
      return res.status(403).json({ error: 'Forbidden: read-only role cannot modify data' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Express middleware for the LP/portfolio-company self-service portal
// (portal.html) — a completely separate identity space from requireAuth's
// internal users/roles above. Verifies a portal token, then re-reads the
// portfolio row live (same "never trust the JWT for anything but identity"
// reasoning as requireAuth re-reading role/active) so a company whose
// record was deleted mid-session is rejected on its very next request.
function requirePortalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.portal) return res.status(401).json({ error: 'Not a portal token' });
    const row = db.prepare('SELECT * FROM portfolio WHERE id = @id AND tenant_id = @tenantId')
      .get(at({ id: payload.portfolioId, tenantId: payload.tenantId }));
    if (!row) return res.status(401).json({ error: 'Portfolio company not found' });
    req.portalCompany = row;
    req.tenantId = payload.tenantId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// 403 unless req.user.permissions[key] is truthy.
function requirePermission(key) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Missing bearer token' });
    if (!req.user.permissions || !req.user.permissions[key]) {
      return res.status(403).json({ error: 'Forbidden: requires permission ' + key });
    }
    next();
  };
}

// 403 for the external IC-only seats (Independent Member, LP Rep) — used on
// routes that internal GP staff need but external committee members don't.
const requireInternal = requirePermission('internal');

module.exports = { signToken, signPortalToken, requireAuth, requirePortalAuth, requirePermission, requireInternal, JWT_SECRET };
