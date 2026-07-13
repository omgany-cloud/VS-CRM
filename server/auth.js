const jwt = require('jsonwebtoken');

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
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.tenantId = payload.tenantId;
    req.tenantSlug = payload.tenantSlug;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, requireAuth, JWT_SECRET };
