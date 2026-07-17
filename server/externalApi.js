// Curated external API for future machine callers (AI agents, other
// integrations) — deliberately kept in its own file, physically separate
// from the 70+ internal routes in server/index.js, so the whole surface
// a non-human caller can reach stays small and auditable at a glance.
// Every route here uses requireApiKey (server/auth.js), never the human
// requireAuth/JWT path — the two identity spaces don't overlap, same
// deliberate separation as the existing portal-token vs internal-user
// split.
//
// Read-only for now (see docs/openapi-external.yaml and the P2 plan this
// was built from) — no concrete AI use case exists yet to design write
// scopes against, so this starts with the lowest-risk, most obviously
// useful data and can grow incrementally once a real need shows up.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('./db');
const { requireApiKey } = require('./auth');
const { logApiCall } = require('./logger');
const { rowToLp } = require('./lpMapping');
const { rowToDeal } = require('./dealMapping');
const { rowToPortfolio } = require('./portfolioMapping');
const { rowToFund } = require('./fundMapping');

const router = express.Router();

// Independent of the human-facing authRateLimit in server/index.js —
// keyed by API key id. Applied AFTER requireApiKey on each route (not as
// blanket router-level middleware) specifically so req.apiKey is already
// set when keyGenerator runs — rate-limiting has to follow authentication
// here, not precede it, or every unauthenticated request would collapse
// onto the same IP-based bucket instead of being cut off by requireApiKey
// itself first.
const apiKeyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `key:${req.apiKey.id}`,
  message: { error: 'Rate limit exceeded for this API key.' },
});

// Logs every call (200s included, not just failures) so staff can see
// exactly what an integration has been doing.
router.use((req, res, next) => {
  res.on('finish', () => {
    logApiCall({
      method: req.method,
      path: req.originalUrl,
      keyId: req.apiKey ? req.apiKey.id : null,
      keyName: req.apiKey ? req.apiKey.name : null,
      status: res.statusCode,
    });
  });
  next();
});

router.get('/lp', requireApiKey('read:lp'), apiKeyRateLimit, (req, res) => {
  const rows = db.prepare('SELECT * FROM lp_register WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ lp: rows.map(rowToLp) });
});

router.get('/portfolio', requireApiKey('read:portfolio'), apiKeyRateLimit, (req, res) => {
  const rows = db.prepare('SELECT * FROM portfolio WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ portfolio: rows.map(rowToPortfolio) });
});

router.get('/deals', requireApiKey('read:deals'), apiKeyRateLimit, (req, res) => {
  const rows = db.prepare('SELECT * FROM deals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ deals: rows.map(rowToDeal) });
});

router.get('/funds', requireApiKey('read:funds'), apiKeyRateLimit, (req, res) => {
  const rows = db.prepare('SELECT * FROM funds WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ funds: rows.map(rowToFund) });
});

module.exports = router;
