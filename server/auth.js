const jwt = require('jsonwebtoken');
const { db, at } = require('./db');
const { INTERNAL_ROLES } = require('./roles');

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

// Express middleware: verifies the Bearer token and attaches
// req.tenantId / req.user — every tenant-scoped route reads
// req.tenantId from here, never from a client-supplied param.
// This is the enforcement point for tenant isolation.
//
// req.user.role/active/name are re-read from the DB on every request rather
// than trusted from the JWT claim, so a role change or deactivation takes
// effect on the user's very next request instead of waiting out the 12h
// token expiry. The JWT's `role` claim is otherwise vestigial after login.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = db.prepare('SELECT id, email, name, role, active FROM users WHERE id = @id AND tenant_id = @tenantId')
      .get(at({ id: payload.sub, tenantId: payload.tenantId }));
    if (!row || !row.active) return res.status(401).json({ error: 'Account inactive or not found' });
    req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
    req.tenantId = payload.tenantId;
    req.tenantSlug = payload.tenantSlug;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// 403 unless req.user.role is one of the given codes.
function requireRole(...codes) {
  const allowed = new Set(codes);
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Missing bearer token' });
    if (!allowed.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: requires role ' + codes.join('/') });
    }
    next();
  };
}

// 403 for the external IC-only seats (Independent Member, LP Rep) — used on
// routes that internal GP staff need but external committee members don't.
function requireInternal(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Missing bearer token' });
  if (!INTERNAL_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden: external roles cannot access this resource' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireRole, requireInternal, JWT_SECRET };
