const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, at } = require('./db');
const { getRoleRowByCode } = require('./rolesRepo');
const { rowToPermissions, NO_PERMISSIONS } = require('./rolesMapping');

// Resolution order: explicit env var (real deployments should set this,
// e.g. from a secret manager) > a secret persisted on first run at
// server/data/.jwt_secret (gitignored, same as crm.sqlite) > generated
// here and persisted for next time. This used to fall back to a literal
// hardcoded string ('poc-dev-secret-do-not-use-in-production') baked
// into this file — meaning anyone reading the (public) source knew the
// default and could forge a token for any tenant if the env var was ever
// left unset. Auto-generating + persisting a random secret keeps the
// zero-setup `node server/index.js` experience while making every
// install's secret unique and unguessable.
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretPath = path.join(__dirname, 'data', '.jwt_secret');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  const generated = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  console.log(`[auth] No JWT_SECRET set — generated and persisted a new one at ${secretPath}`);
  return generated;
}
const JWT_SECRET = resolveJwtSecret();

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

// Express middleware for the curated external API (server/externalApi.js)
// — a third, completely separate identity space from both requireAuth's
// internal users and requirePortalAuth's portfolio companies. Machine
// callers (future AI/integrations) present a long-lived API key instead
// of a short-lived JWT. Keys are SHA-256 hashed at rest (not bcrypt —
// already-high-entropy random strings don't need slow hashing the way
// human passwords do) and looked up by that hash, never decrypted.
//
// req.user is still populated, shaped identically to requireAuth's
// (id/email/name/role/permissions) even though no external route
// currently needs it — this is what lets this app's existing
// actor-stamping call sites (req.user.name || req.user.email, used by
// every archivedBy/decidedBy/etc. field) work unchanged if a write scope
// is ever added to the external API later, without those call sites
// needing to know or care whether the caller was a human or a key.
function requireApiKey(scope) {
  return function (req, res, next) {
    const header = req.headers.authorization || '';
    const key = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!key) return res.status(401).json({ error: 'Missing bearer API key' });
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL').get(keyHash);
    if (!row) return res.status(401).json({ error: 'Invalid or revoked API key' });
    let scopes = [];
    try { scopes = JSON.parse(row.scopes_json || '[]'); } catch (e) { /* malformed row, treat as no scopes */ }
    if (scope && !scopes.includes(scope)) {
      return res.status(403).json({ error: `Forbidden: this key does not have the '${scope}' scope` });
    }
    req.tenantId = row.tenant_id;
    req.apiKey = { id: row.id, name: row.name, scopes };
    req.user = { id: null, email: null, name: `API: ${row.name}`, role: 'API_KEY', permissions: NO_PERMISSIONS };
    // Fire-and-forget — not on the request's critical path, and a failed
    // write here must never block or fail the actual API call.
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    next();
  };
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

module.exports = { signToken, signPortalToken, requireAuth, requirePortalAuth, requireApiKey, requirePermission, requireInternal, JWT_SECRET };
