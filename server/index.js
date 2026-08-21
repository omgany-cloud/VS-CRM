// ============================================================
//  Turan CRM — vertical-slice backend (proof of concept)
//  Serves the existing static frontend + a real API for the
//  LP Register page (the rest of the app still runs on its
//  original in-memory demo data — see README-VERTICAL-SLICE.md).
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, at } = require('./db');
const { runBackup, scheduleBackups } = require('./backup');
const { logError, logAiCall } = require('./logger');
const { z } = require('zod');
const { completeJson } = require('./aiProvider');
const externalApiRouter = require('./externalApi');
const { signToken, signPortalToken, signLpPortalToken, requireAuth, requirePortalAuth, requireLpPortalAuth, requirePermission, requireInternal, JWT_SECRET } = require('./auth');
const { getRoleRowByCode, isValidRole, listRoleRows, IC_SEATS } = require('./rolesRepo');
const { rowToRole, rowToPermissions, roleToParams, INSERT_SQL: ROLE_INSERT_SQL, UPDATE_SQL: ROLE_UPDATE_SQL } = require('./rolesMapping');
const { rowToUser } = require('./usersMapping');
const { computeUserFootprint } = require('./userFootprint');
const {
  blocksPermissions: chineseWallBlocks, filterClientsForPermissions,
  blocksDocumentCategory, filterDocumentsForPermissions,
} = require('./chineseWall');
const { rowToLp, rowToLpPortalView, withLiveFinancials } = require('./lpMapping');
const { dealToParams, rowToDeal, INSERT_SQL: DEAL_INSERT_SQL, UPDATE_SQL: DEAL_UPDATE_SQL } = require('./dealMapping');
const { portfolioToParams, rowToPortfolio, INSERT_SQL: PORTFOLIO_INSERT_SQL, UPDATE_SQL: PORTFOLIO_UPDATE_SQL } = require('./portfolioMapping');
const {
  restrictedToParams, rowToRestricted, RESTRICTED_INSERT_SQL,
  coiToParams, rowToCoi, COI_INSERT_SQL,
  obClientToParams, rowToObClient, OB_CLIENT_INSERT_SQL, OB_CLIENT_UPDATE_SQL,
  obTaskToParams, rowToObTask, OB_TASK_INSERT_SQL, OB_TASK_UPDATE_SQL,
  rowToObTaskComment, OB_TASK_COMMENT_INSERT_SQL,
  engagementToParams, rowToEngagement, ENGAGEMENT_INSERT_SQL, ENGAGEMENT_UPDATE_SQL,
  conflictApprovalToParams, rowToConflictApproval, CONFLICT_APPROVAL_INSERT_SQL, CONFLICT_APPROVAL_UPDATE_SQL,
} = require('./onboardingMapping');
const { icMemoToParams, rowToIcMemo, INSERT_SQL: IC_MEMO_INSERT_SQL, UPDATE_SQL: IC_MEMO_UPDATE_SQL } = require('./icMemoMapping');
const { documentToParams, rowToDocument, INSERT_SQL: DOCUMENT_INSERT_SQL, UPDATE_SQL: DOCUMENT_UPDATE_SQL } = require('./documentMapping');
const { rowToWfInstance, INSERT_SQL: WF_INSERT_SQL, UPDATE_SQL: WF_UPDATE_SQL } = require('./workflowMapping');
const { WF_DEFINITIONS, freshSteps } = require('./wfDefinitions');
const { notifyCapitalCallCreated, notifyWorkflowStepAssigned, notifyHfNavPublished, notifyHfRedemptionProcessed } = require('./notifications/triggers');
const notificationsScheduler = require('./notifications/scheduler');
const { computeDistributionSplit } = require('./waterfallEngine');
const { computeFundMetrics, computeLpMetrics, computeMetrics } = require('./metricsEngine');
const { computeFeeCrystallization, daysBetween } = require('./performanceFeeEngine');
const { recordAudit } = require('./auditLog');
const { upsertTenant, upsertUser, seedSystemRoles } = require('./tenantProvisioning');
const { fundToParams, rowToFund, INSERT_SQL: FUND_INSERT_SQL, UPDATE_SQL: FUND_UPDATE_SQL, operatingModelForAssetClass } = require('./fundMapping');
const { rowToFirstClosing, firstClosingToParams, INSERT_SQL: FIRST_CLOSING_INSERT_SQL, UPDATE_SQL: FIRST_CLOSING_UPDATE_SQL } = require('./firstClosingMapping');
const { rowToAfsaReport, afsaReportToParams, INSERT_SQL: AFSA_REPORT_INSERT_SQL, UPDATE_SQL: AFSA_REPORT_UPDATE_SQL } = require('./afsaReportMapping');

const app = express();
const PORT = process.env.PORT || 4000;

// Only trust X-Forwarded-* headers when actually deployed behind a
// reverse proxy (nginx — see DEPLOYMENT.md step 7). Without a real proxy
// in front, blindly trusting them would let a client spoof its own IP via
// the X-Forwarded-For header and dodge authRateLimit entirely; with one,
// leaving trust proxy off makes every request look like it comes from the
// proxy's IP, so the first user to trip the limiter locks out everyone.
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// This app renders everything via inline onclick="..." handlers and
// inline style="..." attributes (its whole rendering architecture, no
// build step) — helmet's default CSP would block all of that and break
// the entire UI. Scoped down to what's actually needed: 'unsafe-inline'
// for script/style (structural requirement, not fixable without a much
// larger refactor away from inline handlers), everything else locked to
// 'self' plus the specific CDNs index.html/portal.html actually load
// from. Still gets the non-CSP protections (clickjacking via
// frame-ancestors, MIME-sniffing, etc.) for free.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      // helmet defaults scriptSrcAttr to 'none' independently of scriptSrc
      // above (CSP3 treats them as separate directives) — without this
      // override every onclick="..." attribute in the app (its entire
      // interaction model) would silently stop firing in any browser that
      // enforces script-src-attr.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// The public marketing page (company.html, also served at '/' — see the
// homepage route below) isn't part of the authenticated app — unlike
// index.html/portal.html it currently pulls team avatar photos from
// genspark.ai and its hero background from images.unsplash.com (temporary
// hosting until real assets are supplied), links out to the real AFSA
// licence PDF (docs/AFSA-License-*.pdf, a plain same-origin link, not
// embedded), and uses onclick="..." for its RU/EN toggle — none of which
// the CSP above allows. Scoped relaxation for just this page rather than
// loosening it for the whole app; runs after helmet so its res.setHeader
// overwrites helmet's CSP only for these paths, and before express.static
// so it's in effect by the time the response is actually sent.
const PUBLIC_SITE_PAGES = new Set(['/', '/company.html']);
app.use((req, res, next) => {
  if (PUBLIC_SITE_PAGES.has(req.path)) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      // The page's RU/EN language toggle uses onclick="..." attributes
      // (same inline-handler convention as the rest of this app) — CSP3
      // treats script-src-attr as a separate directive from script-src, so
      // without this the buttons would silently stop firing.
      "script-src-attr 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
      "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
      "img-src 'self' data: https://www.genspark.ai https://images.unsplash.com",
      "connect-src 'self'",
    ].join('; '));
  }
  next();
});

app.use(express.json());

// Without these, an exception thrown outside any request handler (e.g. in
// a setInterval callback, or a rejected promise nobody awaited) used to
// just crash the process with nothing but whatever happened to be in the
// terminal at the time — now it's logged first (server/logger.js).
// Deliberately still exits after logging: swallowing the crash and
// limping on in a possibly-corrupted state is worse than a clean restart.
process.on('uncaughtException', (err) => {
  logError(err, 'uncaughtException');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

// Changes on every server restart with zero manual bookkeeping (no build
// step in this app, so there's no bundle hash to key off) — the client
// (js/api-auth.js's startVersionCheckLoop()) polls this to notice a
// deploy happened and prompt a reload, since the SPA's script tags load
// once and never re-fetch on their own for as long as the tab stays open.
// Unauthenticated on purpose: cheap, reveals nothing sensitive, and a
// stale login screen should be able to prompt a reload too.
const SERVER_STARTED_AT = String(Date.now());
app.get('/api/version', (req, res) => res.json({ version: SERVER_STARTED_AT }));

/* ===== File uploads — real disk storage, unlike every other document
   field in this app (pitchDeckUrl, closingCertUrl, wireConfirmUrl, ...),
   which are all "paste a link you already have" TEXT fields with nothing
   stored server-side. Currently only wired up for Capital Call payment
   confirmation (js/lp-register.js's markLPPayment()), but the endpoints
   are generic so any other document field can start using them later.
   ===== */
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // The Документы page's file input accepts .zip client-side
  // (index.html) — without these, a zip upload there silently 400s
  // ("file type not allowed") despite the UI advertising it.
  'application/zip', 'application/x-zip-compressed',
]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — payment orders/scans, not video

const uploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    // The original filename is never used as a path component (it's
    // fully caller-controlled input) — a random name on disk, with the
    // real name kept only as a DB column for display, sidesteps path
    // traversal and filename-collision risk entirely.
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || '').slice(0, 20)),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)),
});

app.post('/api/uploads', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded, or file type not allowed (PDF, image, Word, Excel only)' });
    }
    const info = db.prepare(`
      INSERT INTO uploaded_files (tenant_id, stored_name, original_name, mime_type, size_bytes, uploaded_by)
      VALUES (@tenantId, @storedName, @originalName, @mimeType, @sizeBytes, @uploadedBy)
    `).run(at({
      tenantId: req.tenantId, storedName: req.file.filename, originalName: req.file.originalname,
      mimeType: req.file.mimetype, sizeBytes: req.file.size, uploadedBy: req.user.email,
    }));
    res.status(201).json({ id: info.lastInsertRowid, url: `/api/uploads/${info.lastInsertRowid}`, name: req.file.originalname });
  });
});

// Bulk, no-file-bytes lookup — Vault's cross-module aggregator (js/vault.js)
// links to dozens of /api/uploads/:id URLs scattered across deals,
// portfolio, capital calls, AFSA reports, etc., none of which know the
// real original filename/uploader/date of the file behind their own URL
// (only Documents' own docFiles[] tracks that). One request for however
// many ids the current page's aggregation touches, instead of Vault
// firing a separate full-file GET per row just to read a name. MUST be
// registered before the /:id route below, or Express would try to parse
// "meta" as an id.
app.get('/api/uploads/meta', requireAuth, requireInternal, (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n));
  if (!ids.length) return res.json({ files: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at FROM uploaded_files WHERE tenant_id = ? AND id IN (${placeholders})`
  ).all(req.tenantId, ...ids);
  res.json({
    files: rows.map(r => ({
      id: r.id, originalName: r.original_name, mimeType: r.mime_type,
      sizeBytes: r.size_bytes, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at,
    })),
  });
});

// Deliberately NOT behind requireAuth's middleware — this route accepts
// the JWT via either the normal Authorization header OR a ?token= query
// param, so a plain <a href>/window.open/iframe (no way to attach a
// header) can open it directly, the same way every other document link
// in this app just works when clicked.
//
// Ownership-scoped per token type (uploads-IDOR audit fix — this used to
// let ANY valid tenant token, internal or portal, fetch ANY file in the
// tenant, since uploaded_files never recorded who a portal file actually
// belongs to; auth.js's signPortalToken comment explicitly documented
// that as a known simplification):
//   - Internal token (payload.sub): re-checks the user is still active,
//     same re-verification requireAuth itself does — a deactivated
//     account's still-unexpired 12h JWT can no longer keep downloading.
//     No further per-file permission check (which internal role should
//     see which file needs real ownership modeling this table doesn't
//     have yet — same limitation as the portal case, not solved here).
//   - Portfolio-portal token (payload.portal): only files THIS portfolio
//     company itself uploaded (portal_portfolio_id match) — same trust
//     boundary the rest of the portal already has, not "every file in
//     the tenant".
//   - LP-portal token (payload.lpPortal): rejected outright — lp-portal.html
//     has no legitimate use of this route today (confirmed: it never
//     references /api/uploads), so there is nothing to regress.
app.get('/api/uploads/:id', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const row = db.prepare('SELECT * FROM uploaded_files WHERE id = ? AND tenant_id = ?').get(req.params.id, payload.tenantId);
  if (!row) return res.status(404).json({ error: 'File not found in this tenant' });

  if (payload.lpPortal) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (payload.portal) {
    if (row.portal_portfolio_id !== payload.portfolioId) return res.status(403).json({ error: 'Forbidden' });
  } else {
    const user = db.prepare('SELECT active FROM users WHERE id = ? AND tenant_id = ?').get(payload.sub, payload.tenantId);
    if (!user || !user.active) return res.status(401).json({ error: 'Account inactive or not found' });
  }

  const filePath = path.join(UPLOADS_DIR, row.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
  res.sendFile(filePath);
});

/* ===== Auth ===== */
// Applied to every route that checks or sets a password — the brute-force
// surface. Keyed by IP (express-rate-limit's default), not by the
// email/BIN in the request body, so it can't be bypassed by cycling
// through different accounts from the same machine.
const authRateLimit = rateLimit({
  // Overridable so the test suite (server/test/auth.test.js) can use a
  // short window instead of waiting out a real 15 minutes.
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

app.post('/api/auth/login', authRateLimit, (req, res) => {
  const { email, password, tenant } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const tenantRow = tenant
    ? db.prepare('SELECT * FROM tenants WHERE slug = ?').get(tenant)
    : db.prepare('SELECT * FROM tenants WHERE id = (SELECT tenant_id FROM users WHERE email = ? LIMIT 1)').get(email);

  if (!tenantRow) return res.status(401).json({ error: 'Unknown tenant or user' });

  const user = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantRow.id, email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.active) return res.status(401).json({ error: 'Account is deactivated' });

  const roleRow = getRoleRowByCode(tenantRow.id, user.role);
  const token = signToken(user, tenantRow);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: !!user.must_change_password },
    tenant: { id: tenantRow.id, slug: tenantRow.slug, name: tenantRow.name },
    permissions: roleRow ? rowToPermissions(roleRow) : null,
  });
});

// Lets an already-logged-in client re-sync its cached role/permissions
// without waiting out the 12h token or re-entering credentials. requireAuth
// already re-reads role/active/permissions live from the DB on every
// request (see its comment) — this route just surfaces that in a form the
// client can poll. Also doubles as the deactivation check: once
// user.active flips false, requireAuth's 401 fires here exactly like it
// would on any other route, which is what forces a stale client back to
// the login screen instead of leaving it running on cached permissions.
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role, mustChangePassword: req.user.mustChangePassword },
    permissions: req.user.permissions,
  });
});

/* ===== Portal (portal.html) — LP / portfolio-company self-service =====
   A separate identity space from the internal users/roles above: a portal
   "account" is a row in the existing `portfolio` table, not a `users` row.
   Each company now has its own real, hashed password (portal_password_hash)
   set by internal staff via PUT /api/portfolio/:id/portal-password below —
   replaces the previous shared-demo-password-for-every-company scheme.
   Note: the BIN lookup below still isn't tenant-scoped (no tenant is known
   yet at login time, and the portal login form has no tenant field) — a
   BIN collision across two different tenants could match the wrong
   company's row. Real Kazakhstani business registration numbers are
   globally unique in practice, so this is a low-probability, documented
   limitation rather than a fix attempted here. */
app.post('/api/portal/login', authRateLimit, (req, res) => {
  const { bin, password } = req.body || {};
  if (!bin || !password) return res.status(400).json({ error: 'bin and password are required' });
  const row = db.prepare('SELECT * FROM portfolio WHERE bin = ?').get(String(bin).trim());
  if (!row || !row.portal_password_hash || !bcrypt.compareSync(password, row.portal_password_hash)) {
    return res.status(401).json({ error: 'Неверный BIN или пароль' });
  }
  const token = signPortalToken(row);
  res.json({ token, company: rowToPortfolio(row) });
});

// Internal-staff action: (re)generates a random password for a portfolio
// company's portal login, returned ONCE in this response and never
// persisted or retrievable in plaintext again — matches the "shown once,
// staff relays it manually" flow (no email infrastructure exists to
// automate delivery).
app.put('/api/portfolio/:id/portal-password', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const password = crypto.randomBytes(9).toString('base64url');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE portfolio SET portal_password_hash = ? WHERE id = ? AND tenant_id = ?').run(hash, existing.id, req.tenantId);
  res.json({ password });
});

/* ===== LP self-service portal (lp-portal.html) =====
   Same shape as the portfolio-company portal above, but a completely
   separate identity space (requireLpPortalAuth, not requirePortalAuth) —
   an LP invests INTO the fund, a portfolio company is invested IN BY the
   fund, and they must never be able to authenticate into each other's
   data. Login is by email rather than BIN (an LP's internal register_id
   like "LP-2025-003" is sequential per tenant, not globally unique the
   way a real business registration number is — email is the more
   collision-resistant identifier available on this record). Same
   documented caveat as the portco login: this lookup isn't tenant-scoped
   (no tenant is known yet at login time), so an email collision across
   two different tenants could theoretically match the wrong LP's row. */
app.post('/api/portal/lp/login', authRateLimit, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  const row = db.prepare('SELECT * FROM lp_register WHERE email = ?').get(String(email).trim());
  if (!row || !row.portal_password_hash || !bcrypt.compareSync(password, row.portal_password_hash)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const token = signLpPortalToken(row);
  const fund = row.fund_id ? db.prepare('SELECT operating_model FROM funds WHERE id = ? AND tenant_id = ?').get(row.fund_id, row.tenant_id) : null;
  res.json({ token, lp: withLiveFinancials(db, row.tenant_id, row.id, rowToLpPortalView(row, fund)) });
});

// Internal-staff action: (re)generates a random password for an LP's
// portal login — same "shown once, relayed manually, never stored in
// plaintext" flow as the portfolio-company equivalent above. Requires the
// LP to already have an email on file (that's the login identifier).
app.put('/api/lp/:id/portal-password', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'LP not found in this tenant' });
  if (!existing.email) return res.status(409).json({ error: 'LP has no email on file — add one first, it doubles as the portal login' });
  const password = crypto.randomBytes(9).toString('base64url');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE lp_register SET portal_password_hash = ? WHERE id = ? AND tenant_id = ?').run(hash, existing.id, req.tenantId);
  res.json({ password });
});

app.get('/api/portal/lp/me', requireLpPortalAuth, (req, res) => {
  const fund = req.portalLp.fund_id ? db.prepare('SELECT operating_model FROM funds WHERE id = ? AND tenant_id = ?').get(req.portalLp.fund_id, req.tenantId) : null;
  res.json({ lp: withLiveFinancials(db, req.portalLp.tenant_id, req.portalLp.id, rowToLpPortalView(req.portalLp, fund)) });
});

// This LP's own DPI/RVPI/TVPI/IRR — the Capital Account Statement tab
// (lp-portal.html), same computeLpMetrics() as the internal
// GET /api/lp/:id/metrics (server/metricsEngine.js), scoped to the
// authenticated LP only (never a client-supplied id).
app.get('/api/portal/lp/metrics', requireLpPortalAuth, (req, res) => {
  res.json(computeLpMetrics(db, req.portalLp.tenant_id, req.portalLp.id));
});

// Read-only capital call history for the authenticated LP — line items
// only for THIS LP (req.portalLp.id, never a client-supplied id), joined
// with the parent call for context (notice date, purpose, the call's own
// status). No write routes here: capital call state changes only ever
// happen from the internal CRM side.
app.get('/api/portal/lp/capital-calls', requireLpPortalAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT cli.commitment, cli.pct, cli.called, cli.paid, cli.payment_date AS paid_date, cli.status, cli.wire_ref,
           cc.cc_number, cc.notice_date, cc.payment_date AS due_date, cc.purpose, cc.purpose_type, cc.status AS cc_status
    FROM capital_call_line_items cli
    JOIN capital_calls cc ON cc.id = cli.call_id AND cc.tenant_id = cli.tenant_id
    WHERE cli.tenant_id = ? AND cli.lp_id = ?
    ORDER BY cc.id
  `).all(req.tenantId, req.portalLp.id);
  const capitalCalls = rows.map(r => ({
    ccNumber: r.cc_number,
    noticeDate: r.notice_date,
    dueDate: r.due_date,
    purpose: r.purpose,
    purposeType: r.purpose_type,
    ccStatus: r.cc_status,
    commitment: r.commitment,
    pct: r.pct,
    called: r.called,
    paid: r.paid,
    paidDate: r.paid_date,
    status: r.status,
    wireRef: r.wire_ref,
  }));
  res.json({ capitalCalls });
});

// Reuses the same disk-storage multer instance as POST /api/uploads, just
// behind requirePortalAuth instead of requireAuth+requireInternal — a
// portal company is never an internal CRM user. GET /api/uploads/:id needs
// no changes: it already verifies any valid JWT's tenantId generically.
app.post('/api/portal/uploads', requirePortalAuth, (req, res) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded, or file type not allowed (PDF, image, Word, Excel only)' });
    }
    const info = db.prepare(`
      INSERT INTO uploaded_files (tenant_id, stored_name, original_name, mime_type, size_bytes, uploaded_by, portal_portfolio_id)
      VALUES (@tenantId, @storedName, @originalName, @mimeType, @sizeBytes, @uploadedBy, @portalPortfolioId)
    `).run(at({
      tenantId: req.tenantId, storedName: req.file.filename, originalName: req.file.originalname,
      mimeType: req.file.mimetype, sizeBytes: req.file.size, uploadedBy: 'Портал: ' + req.portalCompany.name,
      portalPortfolioId: req.portalCompany.id,
    }));
    res.status(201).json({ id: info.lastInsertRowid, url: `/api/uploads/${info.lastInsertRowid}`, name: req.file.originalname });
  });
});

// Persists a portal-submitted document into the same documents.files[]
// array the internal Portfolio Documents tab already reads (see
// js/app.js's requiredTypes/renderRequiredDocs equivalent) — a document
// uploaded here shows up as "present" in the CRM immediately, no separate
// approval step (documents are evidence, not a workflow gate; contrast
// with Capital Call payment confirmation, which IS gated, see ccApprove).
app.post('/api/portal/documents', requirePortalAuth, (req, res) => {
  const { type, name, period, expiry, url, comment } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const row = req.portalCompany;
  const documents = JSON.parse(row.documents_json || '{}');
  documents.files = documents.files || [];
  documents.files.push({
    type: type || 'Прочее', name, period: period || '',
    date: new Date().toISOString().slice(0, 10),
    uploadedBy: 'Портал: ' + row.name, expiryDate: expiry || '',
    status: 'OK', url: url || '', comment: comment || '',
  });
  db.prepare('UPDATE portfolio SET documents_json = @documentsJson, last_updated = @lastUpdated WHERE id = @id AND tenant_id = @tenantId')
    .run(at({ documentsJson: JSON.stringify(documents), lastUpdated: new Date().toISOString(), id: row.id, tenantId: req.tenantId }));
  const fresh = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(row.id);
  res.status(201).json({ company: rowToPortfolio(fresh) });
});

// Same evidence-only reasoning as above — recorded under financials for
// the fund team to review, but deliberately does NOT flip any
// paymentSchedule[] entry's status to "Оплачен" itself. Auto-trusting an
// unconfirmed claim from the paying counterparty is exactly the "phantom
// confirmation" gap Capital Call payment confirmation was built to close
// this same session (see paymentConfirm permission); a portfolio-company
// debt payment deserves the same internal-review step, which is a
// separate, not-yet-built CRM-side feature — this endpoint only makes the
// claim visible and durable, it doesn't adjudicate it.
app.post('/api/portal/payment-confirmations', requirePortalAuth, (req, res) => {
  const { date, amount, bank, ref, url } = req.body || {};
  if (!amount) return res.status(400).json({ error: 'amount is required' });
  if (!bank) return res.status(400).json({ error: 'bank is required' });
  const row = req.portalCompany;
  const financials = JSON.parse(row.financials_json || '{}');
  financials.paymentConfirmations = financials.paymentConfirmations || [];
  financials.paymentConfirmations.push({
    date: date || new Date().toISOString().slice(0, 10), amount: Number(amount) || 0,
    bank, ref: ref || '', url: url || '',
    submittedAt: new Date().toISOString(), submittedBy: 'Портал: ' + row.name,
  });
  db.prepare('UPDATE portfolio SET financials_json = @financialsJson, last_updated = @lastUpdated WHERE id = @id AND tenant_id = @tenantId')
    .run(at({ financialsJson: JSON.stringify(financials), lastUpdated: new Date().toISOString(), id: row.id, tenantId: req.tenantId }));
  const fresh = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(row.id);
  res.status(201).json({ company: rowToPortfolio(fresh) });
});

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
}

// Public, self-service: any company can create its own isolated tenant.
// The signer-upper always becomes that tenant's first CEO. New tenants get
// only the 10 system roles — no demo LPs/deals/IC memos/documents/workflow.
// Deliberately no invite code / email verification / rate limiting — same
// PoC-acceptable scope as the dev-only JWT secret; revisit before this is
// ever exposed on the open internet.
app.post('/api/auth/signup', (req, res) => {
  const { companyName, name, email, password } = req.body || {};
  if (!companyName || !name || !email || !password) {
    return res.status(400).json({ error: 'companyName, name, email and password are required' });
  }
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  let slug = slugify(companyName);
  let suffix = 1;
  while (db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug)) {
    suffix += 1;
    slug = slugify(companyName) + '-' + suffix;
  }

  let tenant, user;
  db.exec('BEGIN');
  try {
    tenant = upsertTenant(slug, companyName);
    seedSystemRoles(tenant.id);
    user = upsertUser(tenant.id, email, password, 'CEO', name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }
    return res.status(500).json({ error: err.message });
  }

  const roleRow = getRoleRowByCode(tenant.id, user.role);
  const token = signToken(user, tenant);
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    permissions: roleRow ? rowToPermissions(roleRow) : null,
  });
});

/* ===== User Management API ===== */
app.get('/api/users', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const rows = db.prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, users: rows.map(rowToUser) });
});

app.post('/api/users', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.password) return res.status(400).json({ error: 'email and password are required' });
  if (!b.role || !isValidRole(req.tenantId, b.role)) {
    return res.status(400).json({ error: 'role must be one of: ' + listRoleRows(req.tenantId).map(r => r.code).join(', ') });
  }
  if (String(b.password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  let info;
  try {
    info = db.prepare(`
      INSERT INTO users (tenant_id, email, password_hash, role, name, active, must_change_password)
      VALUES (@tenantId, @email, @passwordHash, @role, @name, 1, 1)
    `).run(at({
      tenantId: req.tenantId,
      email: b.email,
      passwordHash: bcrypt.hashSync(b.password, 10),
      role: b.role,
      name: b.name || null,
    }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A user with this email already exists in this tenant' });
    return res.status(500).json({ error: err.message });
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToUser(row));
});

app.put('/api/users/:id', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });

  const b = req.body || {};
  if (b.role != null && !isValidRole(req.tenantId, b.role)) {
    return res.status(400).json({ error: 'role must be one of: ' + listRoleRows(req.tenantId).map(r => r.code).join(', ') });
  }
  if (b.email != null && !String(b.email).trim()) {
    return res.status(400).json({ error: 'email cannot be empty' });
  }
  if (Number(req.params.id) === req.user.id && b.active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  // If this user currently holds a manageUsers-capable role and the change
  // would take it away (role reassignment, self or otherwise — deactivating
  // someone else never removes the acting admin's own access), refuse
  // unless another active user in the tenant would still have it.
  if (b.role !== undefined && b.role !== existing.role) {
    const oldRoleRow = getRoleRowByCode(req.tenantId, existing.role);
    const newRoleRow = getRoleRowByCode(req.tenantId, b.role);
    if (oldRoleRow && oldRoleRow.manage_users && !(newRoleRow && newRoleRow.manage_users)) {
      const remaining = db.prepare(`
        SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.tenant_id = u.tenant_id AND r.code = u.role
        WHERE u.tenant_id = @tenantId AND u.active = 1 AND r.manage_users = 1 AND u.id <> @id
      `).get(at({ tenantId: req.tenantId, id: existing.id })).c;
      if (remaining === 0) {
        return res.status(409).json({ error: 'Cannot reassign: this would leave the tenant with no active user able to manage users' });
      }
    }
  }

  const merged = {
    email: b.email !== undefined ? String(b.email).trim() : existing.email,
    name: b.name !== undefined ? b.name : existing.name,
    role: b.role !== undefined ? b.role : existing.role,
    active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
  };
  try {
    db.prepare('UPDATE users SET email=@email, name=@name, role=@role, active=@active WHERE id=@id AND tenant_id=@tenantId')
      .run(at({ ...merged, id: existing.id, tenantId: req.tenantId }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A user with this email already exists in this tenant' });
    return res.status(500).json({ error: err.message });
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToUser(row));
});

// Self-service password change — any authenticated user, no manageUsers
// permission required (this only ever touches the caller's own row).
// Registered before /api/users/:id/password so 'me' never falls through
// to the :id route and gets treated as a numeric user id.
app.put('/api/users/me/password', authRateLimit, requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.user.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !bcrypt.compareSync(currentPassword, existing.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  // The user picked this one themselves — the "admin knows a temporary
  // password" condition that must_change_password guards against is over.
  db.prepare('UPDATE users SET password_hash=@passwordHash, must_change_password=0 WHERE id=@id AND tenant_id=@tenantId')
    .run(at({ passwordHash: bcrypt.hashSync(newPassword, 10), id: existing.id, tenantId: req.tenantId }));
  res.json({ ok: true });
});

app.put('/api/users/:id/password', authRateLimit, requireAuth, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  // Admin-set password again, same as account creation — force a change on
  // this user's next login.
  db.prepare('UPDATE users SET password_hash=@passwordHash, must_change_password=1 WHERE id=@id AND tenant_id=@tenantId')
    .run(at({ passwordHash: bcrypt.hashSync(password, 10), id: existing.id, tenantId: req.tenantId }));
  res.json({ ok: true });
});

// Hybrid delete: hard-delete is only allowed for "empty" accounts (no
// footprint in the audit trail — see server/userFootprint.js). Anyone with
// real history must be deactivated instead (PUT .../active=false), which
// already revokes access immediately via requireAuth's live DB check.
app.delete('/api/users/:id', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const footprint = computeUserFootprint(req.tenantId, existing.email, existing.name);
  if (footprint.length) {
    const summary = footprint.map(f => `${f.table}.${f.column} ×${f.count}`).join(', ');
    return res.status(409).json({
      error: `Cannot delete: user has activity in the system (${summary}). Deactivate instead.`,
      footprint,
    });
  }
  db.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

// Company display name — the only tenant field an admin can rename from
// the UI. `slug` stays immutable: it's the tenant's stable identifier
// (portal company lookups, test fixtures, etc.), and renaming the
// business shouldn't require touching anything keyed off it.
app.put('/api/tenant', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(name, req.tenantId);
  res.json(db.prepare('SELECT id, slug, name FROM tenants WHERE id = ?').get(req.tenantId));
});

/* ===== Roles API =====
   GET is open to every authenticated user (everyone needs the catalogue to
   resolve role labels/icons/colors — same as the old fully-client-shipped
   static object). Mutations require the manageRoles permission, kept
   separate from manageUsers: day-to-day account admin shouldn't imply the
   power to redefine what every permission means. */
app.get('/api/roles', requireAuth, (req, res) => {
  const rows = listRoleRows(req.tenantId);
  res.json({ tenant: req.tenantSlug, roles: rows.map(rowToRole) });
});

function wouldZeroOutCapability(tenantId, capabilityCol, roleId, nextValue) {
  const remaining = db.prepare(
    `SELECT COUNT(*) AS c FROM roles WHERE tenant_id = ? AND ${capabilityCol} = 1 AND id <> ?`
  ).get(tenantId, roleId).c;
  return (remaining + (nextValue ? 1 : 0)) === 0;
}

app.post('/api/roles', requireAuth, requirePermission('manageRoles'), (req, res) => {
  const b = req.body || {};
  if (!b.code || !/^[A-Z][A-Z0-9_]*$/.test(b.code)) {
    return res.status(400).json({ error: 'code is required and must match /^[A-Z][A-Z0-9_]*$/' });
  }
  if (!b.label) return res.status(400).json({ error: 'label is required' });
  if (b.icSeat != null && !IC_SEATS.includes(b.icSeat)) {
    return res.status(400).json({ error: 'icSeat must be one of: ' + IC_SEATS.join(', ') });
  }
  const params = roleToParams({ ...b, isSystem: false });

  let info;
  try {
    db.exec('BEGIN');
    if (params.icSeat) {
      db.prepare('UPDATE roles SET ic_seat = NULL WHERE tenant_id = @tenantId AND ic_seat = @icSeat')
        .run(at({ tenantId: req.tenantId, icSeat: params.icSeat }));
    }
    info = db.prepare(ROLE_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'A role with this code already exists in this tenant' });
    return res.status(500).json({ error: err.message });
  }

  const row = db.prepare('SELECT * FROM roles WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToRole(row));
});

app.put('/api/roles/:id', requireAuth, requirePermission('manageRoles'), (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Role not found in this tenant' });

  const b = req.body || {};
  if (b.icSeat != null && !IC_SEATS.includes(b.icSeat)) {
    return res.status(400).json({ error: 'icSeat must be one of: ' + IC_SEATS.join(', ') });
  }
  const merged = { ...rowToRole(existing), ...b, code: existing.code, isSystem: !!existing.is_system };

  if (wouldZeroOutCapability(req.tenantId, 'manage_users', existing.id, merged.manageUsers)) {
    return res.status(409).json({ error: 'Cannot leave the tenant with no manageUsers-capable role' });
  }
  if (wouldZeroOutCapability(req.tenantId, 'manage_roles', existing.id, merged.manageRoles)) {
    return res.status(409).json({ error: 'Cannot leave the tenant with no manageRoles-capable role' });
  }

  // ROLE_UPDATE_SQL deliberately has no @code/@isSystem placeholders (both
  // are immutable via this route) — node:sqlite rejects bound params with
  // no matching placeholder in the SQL, so they must be stripped before binding.
  const { code: _unusedCode, isSystem: _unusedIsSystem, ...params } = roleToParams(merged);
  let pendingMemosAffected = 0;
  try {
    db.exec('BEGIN');
    if (params.icSeat && params.icSeat !== existing.ic_seat) {
      db.prepare('UPDATE roles SET ic_seat = NULL WHERE tenant_id = @tenantId AND ic_seat = @icSeat AND id <> @id')
        .run(at({ tenantId: req.tenantId, icSeat: params.icSeat, id: existing.id }));
    }
    db.prepare(ROLE_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  if (params.icSeat !== existing.ic_seat) {
    pendingMemosAffected = db.prepare("SELECT COUNT(*) AS c FROM ic_memos WHERE tenant_id = ? AND status = 'pending'").get(req.tenantId).c;
  }

  const row = db.prepare('SELECT * FROM roles WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json({ ...rowToRole(row), warnings: pendingMemosAffected ? { pendingMemosAffected } : undefined });
});

app.delete('/api/roles/:id', requireAuth, requirePermission('manageRoles'), (req, res) => {
  const existing = db.prepare('SELECT * FROM roles WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Role not found in this tenant' });
  if (existing.is_system) return res.status(400).json({ error: 'Cannot delete a built-in system role' });
  const usersInRole = db.prepare('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = ?').get(req.tenantId, existing.code).c;
  if (usersInRole > 0) {
    return res.status(409).json({ error: `Cannot delete: ${usersInRole} user(s) still hold this role. Reassign them first.`, usersInRole });
  }
  db.prepare('DELETE FROM roles WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

/* ===== API Keys — machine-to-machine access for the curated external
   API (server/externalApi.js). Managed by humans (requireAuth), used by
   machines (requireApiKey) — two different identity spaces, same split
   as everywhere else in this file (portal tokens vs internal users). */
const API_KEY_SCOPES = ['read:lp', 'read:portfolio', 'read:deals', 'read:funds'];

app.get('/api/api-keys', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  // Never returns key_hash or the raw key — key_prefix is the only
  // identifying information a key gives up after creation.
  const rows = db.prepare('SELECT id, name, key_prefix, scopes_json, created_at, created_by, last_used_at, revoked_at, revoked_by FROM api_keys WHERE tenant_id = ? ORDER BY id DESC').all(req.tenantId);
  res.json({
    apiKeys: rows.map(r => ({
      id: r.id, name: r.name, keyPrefix: r.key_prefix,
      scopes: JSON.parse(r.scopes_json || '[]'),
      createdAt: r.created_at, createdBy: r.created_by,
      lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by,
    })),
  });
});

app.post('/api/api-keys', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const scopes = Array.isArray(b.scopes) ? b.scopes.filter(s => API_KEY_SCOPES.includes(s)) : [];
  if (!scopes.length) return res.status(400).json({ error: 'at least one valid scope is required: ' + API_KEY_SCOPES.join(', ') });

  const rawKey = 'sk_live_' + crypto.randomBytes(32).toString('base64url');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 16);

  const info = db.prepare(`
    INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes_json, created_by)
    VALUES (@tenantId, @name, @keyPrefix, @keyHash, @scopesJson, @createdBy)
  `).run(at({
    tenantId: req.tenantId, name: b.name, keyPrefix, keyHash,
    scopesJson: JSON.stringify(scopes), createdBy: req.user.name || req.user.email,
  }));

  // The only time the raw key is ever returned — not stored anywhere in
  // plaintext, not retrievable again after this response (same "shown
  // once" pattern as PUT /api/portfolio/:id/portal-password above).
  res.status(201).json({ id: info.lastInsertRowid, name: b.name, keyPrefix, scopes, key: rawKey });
});

app.put('/api/api-keys/:id/revoke', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM api_keys WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'API key not found in this tenant' });
  if (existing.revoked_at) return res.status(409).json({ error: 'This key is already revoked' });
  db.prepare('UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), req.user.name || req.user.email, existing.id, req.tenantId);
  res.json({ ok: true, revoked: true });
});

/* ===== LP Register API — tenant-scoped ===== */
/* ===== Funds ===== */
app.get('/api/funds', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM funds WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const lpCountStmt = db.prepare("SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ? AND fund_id = ?");
  const deployedStmt = db.prepare("SELECT COALESCE(SUM(invested), 0) AS s FROM portfolio WHERE tenant_id = ? AND fund_id = ?");
  const funds = rows.map(row => {
    const f = rowToFund(row);
    f.lpCount = lpCountStmt.get(req.tenantId, f.id).c;
    f.deployed = deployedStmt.get(req.tenantId, f.id).s;
    return f;
  });
  res.json({ tenant: req.tenantSlug, funds });
});

const VALID_ASSET_CLASSES = ['pe', 'vc', 'reit', 'hedge_fund'];

app.post('/api/funds', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (b.assetClass != null && !VALID_ASSET_CLASSES.includes(b.assetClass)) {
    return res.status(400).json({ error: `assetClass must be one of ${VALID_ASSET_CLASSES.join(', ')}` });
  }
  // operatingModel is NEVER taken from the request body — it's derived
  // from assetClass here, server-side, so a caller can't set a 'pe' fund
  // to 'open-end' (or vice versa) and desync it from the engine that
  // actually applies (see fundMapping.js's operatingModelForAssetClass).
  const assetClass = b.assetClass || 'pe';
  // nav/status/color/icon/currency all have NOT NULL DEFAULTs at the
  // schema level, but fundToParams() binds an explicit NULL for any field
  // the caller omits — which overrides a column's SQL-level DEFAULT
  // (SQLite/node:sqlite only applies DEFAULT when the column is left out
  // of the statement entirely, not when NULL is explicitly bound). The
  // real fund-creation form (js/funds.js) always sends all five, so this
  // went unnoticed until a more minimal caller (the automated test suite)
  // hit it — same bug class as POST /api/deals and /api/portfolio already
  // guard against. currency was missing from this list entirely (a real
  // pre-existing gap, found by fund-asset-class.test.js's minimal POST
  // body — a caller sending no currency got a 500, not the documented
  // USD default).
  // Hedge fund settings columns are nullable (unlike currency/nav/etc.
  // above), so omitting them never 500s — but a freshly created
  // hedge_fund fund gets the TZ's suggested starting values here rather
  // than sitting on NULLs until someone visits a settings screen that
  // doesn't exist yet (Stage 5). A pe/vc/reit fund gets none of this —
  // these columns stay NULL for it, since no closed-end engine ever
  // reads them.
  const hfDefaults = assetClass === 'hedge_fund'
    ? { performanceFeePct: 20, hfHurdleRate: 0, subscriptionFrequency: 'monthly', redemptionFrequency: 'quarterly', redemptionNoticeDays: 60, lockupMonths: 12, gatePct: 25, feeCrystallizationFrequency: 'annual' }
    : {};
  const info = db.prepare(FUND_INSERT_SQL).run(at({ tenantId: req.tenantId, ...fundToParams({ nav: 0, status: 'fundraising', color: '#3b82f6', icon: 'fa-landmark', catchUpPct: 100, currency: 'USD', ...hfDefaults, ...b, assetClass, operatingModel: operatingModelForAssetClass(assetClass) }) }));
  const row = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  const f = rowToFund(row);
  f.lpCount = 0;
  f.deployed = 0;
  res.status(201).json(f);
});

app.put('/api/funds/:id', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Fund not found in this tenant' });
  if (req.body && req.body.assetClass != null && !VALID_ASSET_CLASSES.includes(req.body.assetClass)) {
    return res.status(400).json({ error: `assetClass must be one of ${VALID_ASSET_CLASSES.join(', ')}` });
  }
  const merged = { ...rowToFund(existing), ...(req.body || {}) };
  // Same rule as POST: operatingModel always re-derived from the final
  // assetClass, never taken from req.body directly, even on update.
  merged.operatingModel = operatingModelForAssetClass(merged.assetClass);
  db.prepare(FUND_UPDATE_SQL).run(at({ id: existing.id, tenantId: req.tenantId, ...fundToParams(merged) }));
  const row = db.prepare('SELECT * FROM funds WHERE id = ?').get(existing.id);
  const f = rowToFund(row);
  const lpCount = db.prepare('SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ? AND fund_id = ?').get(req.tenantId, f.id).c;
  const deployed = db.prepare("SELECT COALESCE(SUM(invested), 0) AS s FROM portfolio WHERE tenant_id = ? AND fund_id = ?").get(req.tenantId, f.id).s;
  f.lpCount = lpCount;
  f.deployed = deployed;
  res.json(f);
});

// Real DPI/RVPI/TVPI/IRR — see server/metricsEngine.js for definitions
// and why every field can come back null instead of a fake 0. Read-only,
// same accessFM gate as GET /api/funds and GET /api/lp.
app.get('/api/funds/:id/metrics', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const fund = db.prepare('SELECT id FROM funds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });
  res.json(computeFundMetrics(db, req.tenantId, fund.id));
});

// Hybrid delete (same shape as DELETE /api/users/:id and every other
// entity in this pass): hard-delete only if the fund has zero real
// footprint across every table that references it. Anything with real
// activity must be set to status 'closed' instead (already a real
// status value in this app's vocabulary — js/funds.js's
// getFundStatusLabel — just never had a UI action to set it before now).
const FUND_FOOTPRINT_TABLES = ['lp_register', 'capital_calls', 'distributions', 'deals', 'portfolio', 'ic_memos', 'first_closing', 'afsa_reports'];
app.delete('/api/funds/:id', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Fund not found in this tenant' });
  const footprint = [];
  for (const table of FUND_FOOTPRINT_TABLES) {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ? AND fund_id = ?`).get(req.tenantId, existing.id).c;
    if (count) footprint.push({ table, count });
  }
  if (footprint.length) {
    const summary = footprint.map(f => `${f.table} ×${f.count}`).join(', ');
    return res.status(409).json({ error: `Cannot delete: fund has real activity (${summary}). Set status to 'closed' instead.`, footprint });
  }
  db.prepare('DELETE FROM funds WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

app.get('/api/lp', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM lp_register WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, lp: rows.map(r => withLiveFinancials(db, req.tenantId, r.id, rowToLp(r))) });
});

app.post('/api/lp', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ?').get(req.tenantId);
  const registerId = b.registerId || `LP-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;

  const info = db.prepare(`
    INSERT INTO lp_register
      (tenant_id, fund_id, register_id, name, type, lp_type, country, address, tax_id, contact, email, phone,
       commitment, called_amount, paid_amount, distributions, fund_class, ownership_pct, professional_client,
       kyc_status, kyc_date, kyc_next_review, risk_rating, admission_date, sa_number, afsa_notified, lpac_member,
       status, exit_date, notes, ob_client_id, rm, identity_verified, proof_address_verified, sof_verified,
       tax_id_verified, pep_check_cleared, aml_screening_cleared, ubo_verified, lpa_url, sa_url, contract_num, updated_at)
    VALUES
      (@tenantId, @fundId, @registerId, @name, @type, @lpType, @country, @address, @taxId, @contact, @email, @phone,
       @commitment, @calledAmount, @paidAmount, @distributions, @fundClass, @ownershipPct, @professionalClient,
       @kycStatus, @kycDate, @kycNextReview, @riskRating, @admissionDate, @saNumber, @afsaNotified, @lpacMember,
       @status, @exitDate, @notes, @obClientId, @rm, @identityVerified, @proofAddressVerified, @sofVerified,
       @taxIdVerified, @pepCheckCleared, @amlScreeningCleared, @uboVerified, @lpaUrl, @saUrl, @contractNum, datetime('now'))
  `).run(at({
    tenantId: req.tenantId,
    fundId: b.fundId || null,
    registerId,
    name: b.name,
    type: b.type || 'Corporate',
    lpType: b.lpType || 'Institution',
    country: b.country || '',
    address: b.address || '',
    taxId: b.taxId || '',
    contact: b.contact || '',
    email: b.email || '',
    phone: b.phone || '',
    commitment: b.commitment || 0,
    calledAmount: b.calledAmount || 0,
    paidAmount: b.paidAmount || 0,
    distributions: b.distributions || 0,
    fundClass: b.fundClass || 'A',
    ownershipPct: b.ownershipPct || 0,
    professionalClient: b.professionalClient || '',
    kycStatus: b.kycStatus || 'Не начат',
    kycDate: b.kycDate || null,
    kycNextReview: b.kycNextReview || null,
    riskRating: b.riskRating || 'Medium',
    admissionDate: b.admissionDate || null,
    saNumber: b.saNumber || null,
    afsaNotified: b.afsaNotified ? 1 : 0,
    lpacMember: b.lpacMember ? 1 : 0,
    status: b.status || 'Onboarding',
    exitDate: b.exitDate || null,
    notes: b.notes || '',
    obClientId: b.obClientId || null,
    rm: b.rm || null,
    identityVerified: b.identityVerified ? 1 : 0,
    proofAddressVerified: b.proofAddressVerified ? 1 : 0,
    sofVerified: b.sofVerified ? 1 : 0,
    taxIdVerified: b.taxIdVerified ? 1 : 0,
    pepCheckCleared: b.pepCheckCleared ? 1 : 0,
    amlScreeningCleared: b.amlScreeningCleared ? 1 : 0,
    uboVerified: b.uboVerified ? 1 : 0,
    lpaUrl: b.lpaUrl || null,
    saUrl: b.saUrl || null,
    contractNum: b.contractNum || null,
  }));

  const row = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'lp_register', entityId: row.id, action: 'created', actorEmail: req.user.email, summary: `LP «${row.name}» создан` });
  res.status(201).json(withLiveFinancials(db, req.tenantId, row.id, rowToLp(row)));
});

app.put('/api/lp/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'LP not found in this tenant' });

  const b = req.body || {};
  const merged = { ...rowToLp(existing), ...b };

  db.prepare(`
    UPDATE lp_register SET
      fund_id=@fundId, name=@name, type=@type, lp_type=@lpType, country=@country, address=@address, tax_id=@taxId,
      contact=@contact, email=@email, phone=@phone, commitment=@commitment, called_amount=@calledAmount,
      paid_amount=@paidAmount, distributions=@distributions, fund_class=@fundClass, ownership_pct=@ownershipPct,
      professional_client=@professionalClient, kyc_status=@kycStatus, kyc_date=@kycDate,
      kyc_next_review=@kycNextReview, risk_rating=@riskRating, admission_date=@admissionDate, sa_number=@saNumber,
      afsa_notified=@afsaNotified, lpac_member=@lpacMember, status=@status, exit_date=@exitDate, notes=@notes,
      ob_client_id=@obClientId, rm=@rm, identity_verified=@identityVerified,
      proof_address_verified=@proofAddressVerified, sof_verified=@sofVerified, tax_id_verified=@taxIdVerified,
      pep_check_cleared=@pepCheckCleared, aml_screening_cleared=@amlScreeningCleared, ubo_verified=@uboVerified,
      lpa_url=@lpaUrl, sa_url=@saUrl, contract_num=@contractNum, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    fundId: merged.fundId || null,
    name: merged.name, type: merged.type, lpType: merged.lpType, country: merged.country, address: merged.address,
    taxId: merged.taxId, contact: merged.contact, email: merged.email, phone: merged.phone,
    commitment: merged.commitment, calledAmount: merged.calledAmount, paidAmount: merged.paidAmount,
    distributions: merged.distributions, fundClass: merged.fundClass, ownershipPct: merged.ownershipPct,
    professionalClient: merged.professionalClient, kycStatus: merged.kycStatus, kycDate: merged.kycDate,
    kycNextReview: merged.kycNextReview, riskRating: merged.riskRating, admissionDate: merged.admissionDate,
    saNumber: merged.saNumber, afsaNotified: merged.afsaNotified ? 1 : 0, lpacMember: merged.lpacMember ? 1 : 0,
    status: merged.status, exitDate: merged.exitDate, notes: merged.notes, obClientId: merged.obClientId,
    rm: merged.rm, identityVerified: merged.identityVerified ? 1 : 0,
    proofAddressVerified: merged.proofAddressVerified ? 1 : 0, sofVerified: merged.sofVerified ? 1 : 0,
    taxIdVerified: merged.taxIdVerified ? 1 : 0, pepCheckCleared: merged.pepCheckCleared ? 1 : 0,
    amlScreeningCleared: merged.amlScreeningCleared ? 1 : 0, uboVerified: merged.uboVerified ? 1 : 0,
    lpaUrl: merged.lpaUrl || null, saUrl: merged.saUrl || null, contractNum: merged.contractNum || null,
    id: existing.id, tenantId: req.tenantId,
  }));

  const row = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'lp_register', entityId: row.id, action: 'updated', actorEmail: req.user.email, summary: `LP «${row.name}» изменён` });
  res.json(withLiveFinancials(db, req.tenantId, row.id, rowToLp(row)));
});

// Hybrid delete (same shape as DELETE /api/users/:id): hard-delete only if
// no capital call has ever named this LP in a line item — once real money
// has moved, the record must survive for AFSA's 6-year retention rule
// (lp_register table comment), so the caller is told to mark the LP
// Exited (PUT above) instead.
app.delete('/api/lp/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'LP not found in this tenant' });
  const lineItems = db.prepare('SELECT id FROM capital_call_line_items WHERE tenant_id = ? AND lp_id = ?').all(req.tenantId, existing.id);
  if (lineItems.length) {
    return res.status(409).json({
      error: `Cannot delete: LP has ${lineItems.length} capital call line item(s). Set status to 'Exited' instead.`,
      footprint: [{ table: 'capital_call_line_items', column: 'lp_id', count: lineItems.length }],
    });
  }
  db.prepare('DELETE FROM lp_register WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'lp_register', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `LP «${existing.name}» удалён` });
  res.json({ ok: true, deleted: true });
});

// This LP's own DPI/RVPI/TVPI/IRR — see server/metricsEngine.js.
app.get('/api/lp/:id/metrics', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const metrics = computeLpMetrics(db, req.tenantId, req.params.id);
  if (!metrics) return res.status(404).json({ error: 'LP not found in this tenant' });
  res.json(metrics);
});

/* ===== Capital Calls API — tenant-scoped ===== */
function rowToCC(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    ccNumber: r.cc_number,
    noticeDate: r.notice_date,
    paymentDate: r.payment_date,
    totalAmount: r.total_amount,
    pctOfCommit: r.pct_of_commit,
    purpose: r.purpose,
    purposeType: r.purpose_type,
    status: r.status,
    managementFee: !!r.management_fee,
    bankRef: r.bank_ref,
    createdBy: r.created_by,
    notes: r.notes,
  };
}

function rowToLineItem(r) {
  return {
    lpId: r.lp_id,
    lpName: r.lp_name,
    commitment: r.commitment,
    pct: r.pct,
    called: r.called,
    paid: r.paid,
    paymentDate: r.payment_date,
    status: r.status,
    wireRef: r.wire_ref,
    wireConfirmUrl: r.wire_confirm_url,
    amlOk: r.aml_ok === null ? null : !!r.aml_ok,
  };
}

const lineItemsStmt = db.prepare(`
  SELECT li.*, lp.name AS lp_name
  FROM capital_call_line_items li
  JOIN lp_register lp ON lp.id = li.lp_id
  WHERE li.call_id = ? AND li.tenant_id = ?
  ORDER BY li.id
`);

app.get('/api/capital-calls', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const calls = db.prepare('SELECT * FROM capital_calls WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const result = calls.map(c => {
    const cc = rowToCC(c);
    cc.lineItems = lineItemsStmt.all(c.id, req.tenantId).map(rowToLineItem);
    return cc;
  });
  res.json({ tenant: req.tenantSlug, capitalCalls: result });
});

app.post('/api/capital-calls', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.purpose) return res.status(400).json({ error: 'purpose is required' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM capital_calls WHERE tenant_id = ?').get(req.tenantId);
  const ccNumber = b.ccNumber || `CC-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;

  // Auto-build pro-rata line items across that fund's Active LPs if the caller didn't supply its own.
  const totalAmount = b.totalAmount || 0;
  let lineItems = b.lineItems;
  if (!lineItems) {
    const activeLps = b.fundId
      ? db.prepare("SELECT * FROM lp_register WHERE tenant_id = ? AND fund_id = ? AND status = 'Active'").all(req.tenantId, b.fundId)
      : db.prepare("SELECT * FROM lp_register WHERE tenant_id = ? AND status = 'Active'").all(req.tenantId);
    const totalCommit = activeLps.reduce((s, l) => s + l.commitment, 0);
    lineItems = activeLps.map(l => {
      const pct = totalCommit ? (totalAmount / totalCommit) * 100 : 0;
      return { lpId: l.id, commitment: l.commitment, pct, called: totalCommit ? (l.commitment / totalCommit) * totalAmount : 0,
        paid: 0, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '', amlOk: null };
    });
  }
  const pctOfCommit = b.pctOfCommit != null ? b.pctOfCommit : (lineItems[0] ? lineItems[0].pct : 0);

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO capital_calls
        (tenant_id, fund_id, cc_number, notice_date, payment_date, total_amount, pct_of_commit, purpose, purpose_type,
         status, management_fee, bank_ref, created_by, notes)
      VALUES
        (@tenantId, @fundId, @ccNumber, @noticeDate, @paymentDate, @totalAmount, @pctOfCommit, @purpose, @purposeType,
         @status, @managementFee, @bankRef, @createdBy, @notes)
    `).run(at({
      tenantId: req.tenantId, fundId: b.fundId || null, ccNumber,
      noticeDate: b.noticeDate || null, paymentDate: b.paymentDate || null,
      totalAmount, pctOfCommit, purpose: b.purpose, purposeType: b.purposeType || 'Investment',
      // Always Draft on creation, regardless of what the caller sends —
      // a Capital Call is a real cash call on every LP the moment it's
      // Pending, so it can't be created pre-approved (same reasoning as
      // deals always starting at Скрининг/Не подано).
      status: 'Draft', managementFee: b.managementFee ? 1 : 0,
      bankRef: b.bankRef || '', createdBy: b.createdBy || req.user.email, notes: b.notes || '',
    }));
    const callId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO capital_call_line_items
        (tenant_id, call_id, lp_id, commitment, pct, called, paid, payment_date, status, wire_ref, aml_ok)
      VALUES
        (@tenantId, @callId, @lpId, @commitment, @pct, @called, @paid, @paymentDate, @status, @wireRef, @amlOk)
    `);
    for (const li of lineItems) {
      insertItem.run(at({
        tenantId: req.tenantId, callId, lpId: li.lpId,
        commitment: li.commitment || 0, pct: li.pct || 0, called: li.called || 0, paid: li.paid || 0,
        paymentDate: li.paymentDate || null, status: li.status || 'Pending', wireRef: li.wireRef || '',
        amlOk: li.amlOk === null || li.amlOk === undefined ? null : (li.amlOk ? 1 : 0),
      }));
    }
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM capital_calls WHERE id = ?').get(callId);
    const cc = rowToCC(row);
    cc.lineItems = lineItemsStmt.all(callId, req.tenantId).map(rowToLineItem);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'capital_calls', entityId: cc.id, action: 'created', actorEmail: req.user.email, summary: `Capital Call ${cc.ccNumber} создан (черновик)` });
    res.status(201).json(cc);
  } catch (err) {
    db.exec('ROLLBACK');
    // Never forward a raw SQLite error to the client (QA audit finding) —
    // a constraint failure ("NOT NULL constraint failed: capital_call_
    // line_items.lp_id") names real table/column identifiers, which is
    // an internal-schema leak, not an actionable message. Logged for the
    // server operator, not shown to the caller.
    console.error('[capital-calls] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create capital call — please try again' });
  }
});

app.put('/api/capital-calls/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Capital call not found in this tenant' });
  const b = req.body || {};
  // The Draft -> Pending transition is the moment this becomes a real,
  // live cash call on every LP of the fund — whoever drafted it (any
  // accessFM staffer) can't also be the one who sends it. Every other
  // status transition (e.g. auto-completing once all LPs paid) stays
  // open to any accessFM staffer, same as before.
  if (existing.status === 'Draft' && b.status === 'Pending' && !req.user.permissions.ccApprove) {
    return res.status(403).json({ error: 'Forbidden: only CEO/CFO may approve and send a Capital Call' });
  }
  const merged = Object.assign(rowToCC(existing), b);
  db.prepare(`
    UPDATE capital_calls SET
      fund_id=@fundId, cc_number=@ccNumber, notice_date=@noticeDate, payment_date=@paymentDate, total_amount=@totalAmount,
      pct_of_commit=@pctOfCommit, purpose=@purpose, purpose_type=@purposeType, status=@status,
      management_fee=@managementFee, bank_ref=@bankRef, created_by=@createdBy, notes=@notes, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    fundId: merged.fundId || null,
    ccNumber: merged.ccNumber, noticeDate: merged.noticeDate, paymentDate: merged.paymentDate,
    totalAmount: merged.totalAmount, pctOfCommit: merged.pctOfCommit, purpose: merged.purpose,
    purposeType: merged.purposeType, status: merged.status, managementFee: merged.managementFee ? 1 : 0,
    bankRef: merged.bankRef, createdBy: merged.createdBy, notes: merged.notes,
    id: existing.id, tenantId: req.tenantId,
  }));
  const row = db.prepare('SELECT * FROM capital_calls WHERE id = ?').get(existing.id);
  const cc = rowToCC(row);
  cc.lineItems = lineItemsStmt.all(existing.id, req.tenantId).map(rowToLineItem);
  const approvedNow = existing.status === 'Draft' && cc.status === 'Pending';
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'capital_calls', entityId: cc.id,
    action: approvedNow ? 'approved' : 'updated', actorEmail: req.user.email,
    summary: approvedNow ? `Capital Call ${cc.ccNumber} подтверждён и отправлен` : `Capital Call ${cc.ccNumber} изменён`,
  });
  res.json(cc);

  // Fired here (Draft -> Pending), not at creation: a Draft is still
  // freely editable/deletable and isn't a real cash call on any LP yet
  // (see the ccApprove gate just above) — emailing LPs about one would be
  // premature and confusing. Fire-and-forget after the response is
  // already sent; notifyOnce() never throws, but .catch defensively in
  // case something upstream of it does.
  if (existing.status === 'Draft' && cc.status === 'Pending') {
    notifyCapitalCallCreated(req.tenantId, cc).catch((err) => console.error('[notify] capital_call_created failed:', err.message));
  }
});

// Delete: unlike the other hybrid-delete routes, this isn't a cross-table
// footprint check — every Capital Call has line items by design (created
// together), so "has line items" is meaningless as a signal. What matters
// is whether it's still a Draft (never sent to any LP) and nothing has
// been paid yet. Once Pending/Approved/Completed, it's a permanent
// regulatory record (capitalCallDays/recordRetention, FUND_PARAMS) — there
// is no soft alternative to offer, it simply cannot be removed.
app.delete('/api/capital-calls/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Capital call not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot delete: call is ${existing.status}, not Draft. A sent Capital Call Notice is a permanent record.` });
  }
  const paidItems = db.prepare('SELECT id FROM capital_call_line_items WHERE tenant_id = ? AND call_id = ? AND paid > 0').all(req.tenantId, existing.id);
  if (paidItems.length) {
    return res.status(409).json({ error: `Cannot delete: ${paidItems.length} line item(s) already have payments recorded.`, footprint: [{ table: 'capital_call_line_items', column: 'paid', count: paidItems.length }] });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM capital_call_line_items WHERE tenant_id = ? AND call_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM capital_calls WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  recordAudit(db, { tenantId: req.tenantId, entityType: 'capital_calls', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `Capital Call ${existing.cc_number} удалён (черновик)` });
  res.json({ ok: true, deleted: true });
});

// Record a payment against one LP's line item within a call (the common day-to-day action).
app.put('/api/capital-calls/:id/line-items/:lpId', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const call = db.prepare('SELECT * FROM capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!call) return res.status(404).json({ error: 'Capital call not found in this tenant' });
  const item = db.prepare('SELECT * FROM capital_call_line_items WHERE call_id = ? AND lp_id = ? AND tenant_id = ?')
    .get(call.id, req.params.lpId, req.tenantId);
  if (!item) return res.status(404).json({ error: 'Line item not found' });
  // A Draft call was never actually sent to any LP — there's nothing
  // real to record a payment or AML clearance against yet.
  if (call.status === 'Draft') {
    return res.status(409).json({ error: 'This Capital Call is still a draft — approve it before recording payments' });
  }

  const b = req.body || {};
  // AML/SoF clearance is a compliance judgment — restricted to Compliance
  // Officer/MLRO (amlClear) so an RM can't confirm their own client's AML
  // check.
  if (Object.prototype.hasOwnProperty.call(b, 'amlOk') && !req.user.permissions.amlClear) {
    return res.status(403).json({ error: 'Forbidden: only Compliance/MLRO may confirm AML clearance' });
  }
  // Confirming receipt is a bank-reconciliation judgment, not something
  // the person who created/approved the call should self-certify —
  // restricted to CFO/CEO (paymentConfirm), and requires the actual
  // evidence (wire reference + a link to the payment order/SWIFT
  // confirmation) rather than a bare status flip.
  const confirmingPayment = b.status === 'Paid' && item.status !== 'Paid';
  if (confirmingPayment) {
    if (!req.user.permissions.paymentConfirm) {
      return res.status(403).json({ error: 'Forbidden: only CFO/CEO may confirm a Capital Call payment' });
    }
    if (!b.wireRef || !b.wireRef.trim()) {
      return res.status(400).json({ error: 'wireRef is required to confirm payment' });
    }
    if (!b.wireConfirmUrl || !b.wireConfirmUrl.trim()) {
      return res.status(400).json({ error: 'wireConfirmUrl (payment order document link) is required to confirm payment' });
    }
  }
  // Reversing a confirmed payment (Paid -> anything else) is the same
  // class of judgment as confirming one in the first place — QA audit
  // found this transition previously required nothing beyond generic
  // accessFM, so an already-confirmed payment could be silently
  // reverted with no evidence and no trace. Same permission as
  // confirming, plus a reason (there's no wire evidence to point to for
  // an *undo*, so the accountability trail is a written reason instead,
  // recorded below via recordAudit — this route had no audit entry at
  // all before now).
  const reversingPayment = item.status === 'Paid' && b.status !== undefined && b.status !== 'Paid';
  if (reversingPayment) {
    if (!req.user.permissions.paymentConfirm) {
      return res.status(403).json({ error: 'Forbidden: only CFO/CEO may reverse a confirmed Capital Call payment' });
    }
    if (!b.reason || !b.reason.trim()) {
      return res.status(400).json({ error: 'reason is required to reverse a confirmed payment' });
    }
  }
  db.prepare(`
    UPDATE capital_call_line_items SET
      paid=@paid, payment_date=@paymentDate, status=@status, wire_ref=@wireRef,
      wire_confirm_url=@wireConfirmUrl, aml_ok=@amlOk
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: item.id, tenantId: req.tenantId,
    paid: b.paid != null ? b.paid : item.paid,
    paymentDate: b.paymentDate || item.payment_date,
    status: b.status || item.status,
    wireRef: b.wireRef != null ? b.wireRef : item.wire_ref,
    wireConfirmUrl: b.wireConfirmUrl != null ? b.wireConfirmUrl : item.wire_confirm_url,
    amlOk: b.amlOk != null ? (b.amlOk ? 1 : 0) : item.aml_ok,
  }));

  const lpRow = db.prepare('SELECT name FROM lp_register WHERE id = ? AND tenant_id = ?').get(item.lp_id, req.tenantId);
  const lpName = lpRow ? lpRow.name : `LP #${item.lp_id}`;
  if (confirmingPayment) {
    recordAudit(db, { tenantId: req.tenantId, entityType: 'capital_calls', entityId: call.id, action: 'payment_confirmed', actorEmail: req.user.email, summary: `Capital Call ${call.cc_number}: платёж «${lpName}» подтверждён (wireRef: ${b.wireRef})` });
  } else if (reversingPayment) {
    recordAudit(db, { tenantId: req.tenantId, entityType: 'capital_calls', entityId: call.id, action: 'payment_reversed', actorEmail: req.user.email, summary: `Capital Call ${call.cc_number}: подтверждённый платёж «${lpName}» отменён — ${b.reason}` });
  }

  const row = db.prepare('SELECT * FROM capital_calls WHERE id = ?').get(call.id);
  const cc = rowToCC(row);
  cc.lineItems = lineItemsStmt.all(call.id, req.tenantId).map(rowToLineItem);
  res.json(cc);
});

/* ===== Distributions API — tenant-scoped =====
   The reverse cash flow (fund -> LP), mirroring Capital Calls above.
   A distribution's line items either come verbatim from the caller, or
   get computed automatically: a pure return-of-capital distribution
   (profitAmount === 0, which never carries GP carry) is auto pro-rated
   by LP ownership; profitAmount > 0 runs through the real waterfall
   (server/waterfallEngine.js — preferred return -> GP catch-up -> carry
   split), which needs fundId to look up that fund's terms. Frontend page:
   js/distributions.js. */
function rowToDist(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    distNumber: r.dist_number,
    noticeDate: r.notice_date,
    paymentDate: r.payment_date,
    totalAmount: r.total_amount,
    sourceType: r.source_type,
    sourcePortfolioId: r.source_portfolio_id,
    rocAmount: r.roc_amount,
    profitAmount: r.profit_amount,
    status: r.status,
    createdBy: r.created_by,
    notes: r.notes,
  };
}

function rowToDistLineItem(r) {
  return {
    lpId: r.lp_id,
    lpName: r.lp_name,
    pct: r.pct,
    grossAmount: r.gross_amount,
    gpCarryAmount: r.gp_carry_amount,
    netAmount: r.net_amount,
    paymentDate: r.payment_date,
    status: r.status,
    wireRef: r.wire_ref,
    wireConfirmUrl: r.wire_confirm_url,
  };
}

const distLineItemsStmt = db.prepare(`
  SELECT li.*, lp.name AS lp_name
  FROM distribution_line_items li
  JOIN lp_register lp ON lp.id = li.lp_id
  WHERE li.distribution_id = ? AND li.tenant_id = ?
  ORDER BY li.id
`);

app.get('/api/distributions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const dists = db.prepare('SELECT * FROM distributions WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const result = dists.map(d => {
    const dist = rowToDist(d);
    dist.lineItems = distLineItemsStmt.all(d.id, req.tenantId).map(rowToDistLineItem);
    return dist;
  });
  res.json({ tenant: req.tenantSlug, distributions: result });
});

app.post('/api/distributions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  const rocAmount = b.rocAmount || 0;
  const profitAmount = b.profitAmount || 0;
  const totalAmount = b.totalAmount != null ? b.totalAmount : (rocAmount + profitAmount);
  if (totalAmount <= 0) return res.status(400).json({ error: 'totalAmount (or rocAmount/profitAmount) must be greater than 0' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM distributions WHERE tenant_id = ?').get(req.tenantId);
  const distNumber = b.distNumber || `DIST-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(2, '0')}`;

  // Fetched once, up front, whenever fundId is given — used both to
  // auto-compute a profit split below AND to snapshot the terms actually
  // in effect onto this distribution row at INSERT time further down, so
  // a LATER fund term change can never retroactively change what THIS
  // distribution's carry was computed against when a future distribution
  // replays it (waterfallEngine.js's replayWaterfallState — QA Data
  // Integrity audit finding).
  let fund = null;
  if (b.fundId) {
    fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(b.fundId, req.tenantId);
    if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });
  }

  let lineItems = b.lineItems;
  if (!lineItems) {
    const activeLps = b.fundId
      ? db.prepare("SELECT * FROM lp_register WHERE tenant_id = ? AND fund_id = ? AND status = 'Active'").all(req.tenantId, b.fundId)
      : db.prepare("SELECT * FROM lp_register WHERE tenant_id = ? AND status = 'Active'").all(req.tenantId);

    if (profitAmount <= 0) {
      // Pure return-of-capital: no carry, so a straight pro-rata-by-commitment
      // split is always correct — no waterfall math needed.
      const totalCommit = activeLps.reduce((s, l) => s + l.commitment, 0);
      lineItems = activeLps.map(l => {
        const pct = totalCommit ? (l.commitment / totalCommit) * 100 : 0;
        const gross = totalCommit ? (l.commitment / totalCommit) * rocAmount : 0;
        return { lpId: l.id, pct, grossAmount: gross, gpCarryAmount: 0, netAmount: gross, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '' };
      });
    } else {
      // A profit split needs a specific fund's waterfall parameters
      // (preferred return / carry / catch-up) — can't run the waterfall
      // fund-agnostically the way pure ROC can.
      if (!fund) return res.status(400).json({ error: 'profitAmount requires fundId — the waterfall needs a specific fund\'s preferredReturn/carriedInterest/catchUpPct' });

      // Ledger for the preferred-return accrual: every paid, dated
      // contribution (capital in) from a non-Draft Capital Call, and every
      // non-Draft prior distribution's rocAmount (capital back out) —
      // profit/preferred/carry payouts never reduce outstanding capital,
      // see waterfallEngine.js's file header.
      const contributions = db.prepare(`
        SELECT li.paid AS amount, li.payment_date AS date
        FROM capital_call_line_items li JOIN capital_calls cc ON cc.id = li.call_id
        WHERE li.tenant_id = ? AND cc.fund_id = ? AND cc.status != 'Draft' AND li.paid > 0 AND li.payment_date IS NOT NULL
      `).all(req.tenantId, b.fundId);
      const priorDistRows = db.prepare(`
        SELECT status, profit_amount AS profitAmount, roc_amount AS rocAmount,
               COALESCE(payment_date, notice_date) AS date,
               preferred_return_snapshot AS preferredReturn, carried_interest_snapshot AS carriedInterest,
               catch_up_pct_snapshot AS catchUpPct
        FROM distributions WHERE tenant_id = ? AND fund_id = ?
      `).all(req.tenantId, b.fundId);
      const ledgerEvents = [
        ...contributions.map(c => ({ date: c.date, delta: c.amount })),
        ...priorDistRows.filter(d => d.status !== 'Draft' && d.date).map(d => ({ date: d.date, delta: -(d.rocAmount || 0) })),
      ];

      const { lineItems: split } = computeDistributionSplit({
        fund: { preferredReturn: fund.preferred_return, carriedInterest: fund.carried_interest, catchUpPct: fund.catch_up_pct },
        activeLps, ledgerEvents, priorDistributions: priorDistRows,
        rocAmount, profitAmount, distDate: b.paymentDate || b.noticeDate || new Date().toISOString().slice(0, 10),
      });
      lineItems = split.map(li => ({ ...li, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '' }));
    }
  }

  // Reconciliation guard (also the acceptance criterion waterfallEngine.js
  // is tested against): net + carry paid out to LPs/GP must equal what's
  // actually being distributed, whether the split was auto-generated
  // above (pure ROC, or the waterfall) or supplied by the caller.
  const sumNet   = lineItems.reduce((s, li) => s + (li.netAmount != null ? li.netAmount : (li.grossAmount || 0) - (li.gpCarryAmount || 0)), 0);
  const sumCarry = lineItems.reduce((s, li) => s + (li.gpCarryAmount || 0), 0);
  if (Math.abs((sumNet + sumCarry) - totalAmount) > 0.5) {
    return res.status(400).json({ error: `lineItems don't reconcile: sum(netAmount)+sum(gpCarryAmount) = ${(sumNet + sumCarry).toFixed(2)}, expected totalAmount = ${totalAmount.toFixed(2)}` });
  }

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO distributions
        (tenant_id, fund_id, dist_number, notice_date, payment_date, total_amount, source_type, source_portfolio_id,
         roc_amount, profit_amount, status, created_by, notes,
         preferred_return_snapshot, carried_interest_snapshot, catch_up_pct_snapshot)
      VALUES
        (@tenantId, @fundId, @distNumber, @noticeDate, @paymentDate, @totalAmount, @sourceType, @sourcePortfolioId,
         @rocAmount, @profitAmount, @status, @createdBy, @notes,
         @preferredReturnSnapshot, @carriedInterestSnapshot, @catchUpPctSnapshot)
    `).run(at({
      tenantId: req.tenantId, fundId: b.fundId || null, distNumber,
      noticeDate: b.noticeDate || null, paymentDate: b.paymentDate || null,
      totalAmount, sourceType: b.sourceType || 'other', sourcePortfolioId: b.sourcePortfolioId || null,
      rocAmount, profitAmount,
      // Always Draft on creation, same reasoning as Capital Calls always
      // starting Draft — it isn't a real payment commitment to LPs yet.
      status: 'Draft', createdBy: b.createdBy || req.user.email, notes: b.notes || '',
      preferredReturnSnapshot: fund ? fund.preferred_return : null,
      carriedInterestSnapshot: fund ? fund.carried_interest : null,
      catchUpPctSnapshot: fund ? fund.catch_up_pct : null,
    }));
    const distId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO distribution_line_items
        (tenant_id, distribution_id, lp_id, pct, gross_amount, gp_carry_amount, net_amount, payment_date, status, wire_ref)
      VALUES
        (@tenantId, @distId, @lpId, @pct, @grossAmount, @gpCarryAmount, @netAmount, @paymentDate, @status, @wireRef)
    `);
    for (const li of lineItems) {
      insertItem.run(at({
        tenantId: req.tenantId, distId, lpId: li.lpId,
        pct: li.pct || 0, grossAmount: li.grossAmount || 0, gpCarryAmount: li.gpCarryAmount || 0,
        netAmount: li.netAmount != null ? li.netAmount : (li.grossAmount || 0) - (li.gpCarryAmount || 0),
        paymentDate: li.paymentDate || null, status: li.status || 'Pending', wireRef: li.wireRef || '',
      }));
    }
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM distributions WHERE id = ?').get(distId);
    const dist = rowToDist(row);
    dist.lineItems = distLineItemsStmt.all(distId, req.tenantId).map(rowToDistLineItem);
    recordAudit(db, { tenantId: req.tenantId, entityType: 'distributions', entityId: dist.id, action: 'created', actorEmail: req.user.email, summary: `Распределение ${dist.distNumber} создано (черновик)` });
    res.status(201).json(dist);
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[distributions] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create distribution — please try again' });
  }
});

app.put('/api/distributions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM distributions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Distribution not found in this tenant' });
  const b = req.body || {};
  // Same reasoning as Capital Calls' Draft -> Pending gate: the moment a
  // distribution leaves Draft it becomes a real payment commitment to
  // every LP on it, so only CEO/CFO can send it.
  if (existing.status === 'Draft' && b.status === 'Sent' && !req.user.permissions.ccApprove) {
    return res.status(403).json({ error: 'Forbidden: only CEO/CFO may approve and send a Distribution' });
  }
  // Once Paid, a distribution is a closed, permanent record — same as a
  // sent Capital Call Notice; nothing left to edit on the header.
  if (existing.status === 'Paid') {
    return res.status(409).json({ error: 'Cannot edit: distribution is already Paid — this is a permanent record.' });
  }
  const merged = Object.assign(rowToDist(existing), b);
  db.prepare(`
    UPDATE distributions SET
      fund_id=@fundId, dist_number=@distNumber, notice_date=@noticeDate, payment_date=@paymentDate, total_amount=@totalAmount,
      source_type=@sourceType, source_portfolio_id=@sourcePortfolioId, roc_amount=@rocAmount, profit_amount=@profitAmount,
      status=@status, created_by=@createdBy, notes=@notes, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    fundId: merged.fundId || null,
    distNumber: merged.distNumber, noticeDate: merged.noticeDate, paymentDate: merged.paymentDate,
    totalAmount: merged.totalAmount, sourceType: merged.sourceType, sourcePortfolioId: merged.sourcePortfolioId || null,
    rocAmount: merged.rocAmount, profitAmount: merged.profitAmount, status: merged.status,
    createdBy: merged.createdBy, notes: merged.notes,
    id: existing.id, tenantId: req.tenantId,
  }));
  const row = db.prepare('SELECT * FROM distributions WHERE id = ?').get(existing.id);
  const dist = rowToDist(row);
  dist.lineItems = distLineItemsStmt.all(existing.id, req.tenantId).map(rowToDistLineItem);
  const distApprovedNow = existing.status === 'Draft' && dist.status === 'Sent';
  const distPaidNow = existing.status !== 'Paid' && dist.status === 'Paid';
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'distributions', entityId: dist.id,
    action: distApprovedNow ? 'approved' : distPaidNow ? 'paid' : 'updated', actorEmail: req.user.email,
    summary: distApprovedNow ? `Распределение ${dist.distNumber} подтверждено и отправлено`
      : distPaidNow ? `Распределение ${dist.distNumber} закрыто (все LP получили выплату)`
      : `Распределение ${dist.distNumber} изменено`,
  });
  res.json(dist);
});

// Delete: only while still Draft (never sent to any LP) and no line item
// has moved past Pending — same "permanent regulatory record once real"
// reasoning as DELETE /api/capital-calls/:id.
app.delete('/api/distributions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM distributions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Distribution not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot delete: distribution is ${existing.status}, not Draft. A sent Distribution is a permanent record.` });
  }
  const movedItems = db.prepare("SELECT id FROM distribution_line_items WHERE tenant_id = ? AND distribution_id = ? AND status != 'Pending'").all(req.tenantId, existing.id);
  if (movedItems.length) {
    return res.status(409).json({ error: `Cannot delete: ${movedItems.length} line item(s) already sent/confirmed.`, footprint: [{ table: 'distribution_line_items', column: 'status', count: movedItems.length }] });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM distribution_line_items WHERE tenant_id = ? AND distribution_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM distributions WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  recordAudit(db, { tenantId: req.tenantId, entityType: 'distributions', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `Распределение ${existing.dist_number} удалено (черновик)` });
  res.json({ ok: true, deleted: true });
});

// Confirm payment against one LP's line item within a distribution — the
// day-to-day action, mirroring PUT /api/capital-calls/:id/line-items/:lpId.
app.put('/api/distributions/:id/line-items/:lpId', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const dist = db.prepare('SELECT * FROM distributions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!dist) return res.status(404).json({ error: 'Distribution not found in this tenant' });
  const item = db.prepare('SELECT * FROM distribution_line_items WHERE distribution_id = ? AND lp_id = ? AND tenant_id = ?')
    .get(dist.id, req.params.lpId, req.tenantId);
  if (!item) return res.status(404).json({ error: 'Line item not found' });
  if (dist.status === 'Draft') {
    return res.status(409).json({ error: 'This Distribution is still a draft — approve it before recording payments' });
  }

  const b = req.body || {};
  // Confirming payment is a bank-reconciliation judgment, same restriction
  // and evidence requirement as Capital Call payment confirmation.
  const confirmingPayment = b.status === 'Confirmed' && item.status !== 'Confirmed';
  if (confirmingPayment) {
    if (!req.user.permissions.paymentConfirm) {
      return res.status(403).json({ error: 'Forbidden: only CFO/CEO may confirm a Distribution payment' });
    }
    if (!b.wireRef || !b.wireRef.trim()) {
      return res.status(400).json({ error: 'wireRef is required to confirm payment' });
    }
    if (!b.wireConfirmUrl || !b.wireConfirmUrl.trim()) {
      return res.status(400).json({ error: 'wireConfirmUrl (payment order document link) is required to confirm payment' });
    }
  }
  db.prepare(`
    UPDATE distribution_line_items SET
      status=@status, wire_ref=@wireRef, wire_confirm_url=@wireConfirmUrl, payment_date=@paymentDate
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: item.id, tenantId: req.tenantId,
    status: b.status || item.status,
    wireRef: b.wireRef != null ? b.wireRef : item.wire_ref,
    wireConfirmUrl: b.wireConfirmUrl != null ? b.wireConfirmUrl : item.wire_confirm_url,
    paymentDate: b.paymentDate || item.payment_date,
  }));

  const row = db.prepare('SELECT * FROM distributions WHERE id = ?').get(dist.id);
  const result = rowToDist(row);
  result.lineItems = distLineItemsStmt.all(dist.id, req.tenantId).map(rowToDistLineItem);
  res.json(result);
});

/* ===== Hedge Fund — open-end module (docs/TZ_Hedge_Fund_Module.md) =====
   Stage 1 (schema + plain CRUD) + Stage 2 (processing against the latest
   Published NAV) below. Still deliberately NOT doing:
     - hf_fee_crystallizations writes — performanceFeeEngine.js (Stage 3)
     - any frontend (Stage 5) — everything here is API-only so far
   Not wired into server/auditLog.js — that module's v1 scope is
   explicitly the 7 closed-end governance modules already agreed with the
   user; adding hedge fund tables there is a separate decision, not
   bundled into this stage.

   Stage 2 adds real computation at exactly two trigger points, both
   detected the same way capital_calls detects Draft->Pending
   ("approvedNow") — a specific status transition in the PUT body, not a
   separate action route:
     - hf_subscriptions PUT with status:'Processed' from 'Pending'
     - hf_redemptions PUT with status:'Processed' from 'Requested'
   Everything else (plain field edits, any other status value) still
   falls through to the Stage 1 plain-merge-and-update path unchanged. */

// docs/TZ_Hedge_Fund_Module.md §3 flags multiple subscriptions per LP
// (before any fee crystallization exists) as a real open question this
// project deferred to Stage 3's performanceFeeEngine.js — but
// hf_investor_positions still needs ONE internally-consistent row per
// (fund, lp) the moment a second subscription is processed, since that's
// Stage 2's job, not Stage 3's. This blends the new entry into the
// existing HWM by a units-weighted average — a standard, defensible
// approximation for a "top-up," not a claim that it's the final answer
// for true per-series HWM tracking (which would need a different schema
// entirely). Documented here so this doesn't read as an oversight.
function upsertHfPosition(tenantId, fundId, lpId, deltaUnits, entryNavPerUnit) {
  const existing = db.prepare('SELECT * FROM hf_investor_positions WHERE tenant_id = ? AND fund_id = ? AND lp_id = ?').get(tenantId, fundId, lpId);
  if (!existing) {
    // First position for this LP in this fund — their own entry price IS
    // their starting HWM (no fee owed until the fund grows past where
    // THEY personally bought in).
    db.prepare(`
      INSERT INTO hf_investor_positions (tenant_id, fund_id, lp_id, units_held, high_water_mark_per_unit)
      VALUES (@tenantId, @fundId, @lpId, @unitsHeld, @hwm)
    `).run(at({ tenantId, fundId, lpId, unitsHeld: deltaUnits, hwm: entryNavPerUnit != null ? entryNavPerUnit : 0 }));
    return;
  }
  let newUnits = existing.units_held + deltaUnits;
  if (newUnits < 0) newUnits = 0; // never let a redemption push this negative on a rounding edge
  let newHwm = existing.high_water_mark_per_unit;
  if (deltaUnits > 0 && entryNavPerUnit != null) {
    // Top-up: units-weighted average of the old HWM and this entry's price.
    const totalUnits = existing.units_held + deltaUnits;
    newHwm = totalUnits > 0 ? ((existing.units_held * existing.high_water_mark_per_unit) + (deltaUnits * entryNavPerUnit)) / totalUnits : existing.high_water_mark_per_unit;
  }
  db.prepare(`
    UPDATE hf_investor_positions SET units_held = @unitsHeld, high_water_mark_per_unit = @hwm, updated_at = datetime('now')
    WHERE tenant_id = @tenantId AND fund_id = @fundId AND lp_id = @lpId
  `).run(at({ tenantId, fundId, lpId, unitsHeld: newUnits, hwm: newHwm }));
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function latestPublishedNav(tenantId, fundId) {
  return db.prepare(`
    SELECT * FROM hf_nav_history WHERE tenant_id = ? AND fund_id = ? AND status = 'Published'
    ORDER BY as_of_date DESC, id DESC LIMIT 1
  `).get(tenantId, fundId);
}
function rowToHfSubscription(r) {
  return {
    id: r.id, fundId: r.fund_id, lpId: r.lp_id, subNumber: r.sub_number,
    requestDate: r.request_date, amount: r.amount,
    navPerUnitAtEntry: r.nav_per_unit_at_entry, unitsIssued: r.units_issued,
    effectiveDate: r.effective_date, lockupUntil: r.lockup_until,
    status: r.status, createdBy: r.created_by, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

app.get('/api/hf/subscriptions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = req.query.fundId
    ? db.prepare('SELECT * FROM hf_subscriptions WHERE tenant_id = ? AND fund_id = ? ORDER BY id').all(req.tenantId, req.query.fundId)
    : db.prepare('SELECT * FROM hf_subscriptions WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, subscriptions: rows.map(rowToHfSubscription) });
});

app.post('/api/hf/subscriptions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.lpId) return res.status(400).json({ error: 'lpId is required' });
  if (!b.amount || b.amount <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM hf_subscriptions WHERE tenant_id = ?').get(req.tenantId);
  const subNumber = b.subNumber || `SUB-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO hf_subscriptions
      (tenant_id, fund_id, lp_id, sub_number, request_date, amount,
       nav_per_unit_at_entry, units_issued, effective_date, lockup_until, status, created_by, notes)
    VALUES
      (@tenantId, @fundId, @lpId, @subNumber, @requestDate, @amount,
       @navPerUnitAtEntry, @unitsIssued, @effectiveDate, @lockupUntil, @status, @createdBy, @notes)
  `).run(at({
    tenantId: req.tenantId, fundId: b.fundId || null, lpId: b.lpId, subNumber,
    requestDate: b.requestDate || null, amount: b.amount,
    navPerUnitAtEntry: b.navPerUnitAtEntry || null, unitsIssued: b.unitsIssued || null,
    effectiveDate: b.effectiveDate || null, lockupUntil: b.lockupUntil || null,
    status: 'Pending', createdBy: b.createdBy || req.user.email, notes: b.notes || '',
  }));
  const row = db.prepare('SELECT * FROM hf_subscriptions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToHfSubscription(row));
});

app.put('/api/hf/subscriptions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_subscriptions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Subscription not found in this tenant' });
  const b = req.body || {};
  const processingNow = b.status === 'Processed' && existing.status === 'Pending';

  let navPerUnitAtEntry = b.navPerUnitAtEntry !== undefined ? b.navPerUnitAtEntry : existing.nav_per_unit_at_entry;
  let unitsIssued = b.unitsIssued !== undefined ? b.unitsIssued : existing.units_issued;
  let effectiveDate = b.effectiveDate || existing.effective_date;
  let lockupUntil = b.lockupUntil || existing.lockup_until;

  if (processingNow) {
    // Stage 2's one real computation for this route: never trust
    // navPerUnitAtEntry/unitsIssued/lockupUntil from the request body once
    // this specific transition fires — they're derived from the fund's
    // own latest Published NAV, same "server computes it" rule as
    // capital_calls' cc_number.
    const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(existing.fund_id, req.tenantId);
    const nav = latestPublishedNav(req.tenantId, existing.fund_id);
    if (!nav) {
      return res.status(409).json({ error: 'No Published NAV yet for this fund — cannot process a subscription without a reference NAV.' });
    }
    navPerUnitAtEntry = nav.nav_per_unit;
    unitsIssued = navPerUnitAtEntry > 0 ? existing.amount / navPerUnitAtEntry : 0;
    effectiveDate = b.effectiveDate || new Date().toISOString().slice(0, 10);
    lockupUntil = addMonths(effectiveDate, (fund && fund.lockup_months) || 0);
  }

  const merged = { ...rowToHfSubscription(existing), ...b, navPerUnitAtEntry, unitsIssued, effectiveDate, lockupUntil };
  // at() binds every key it's given as a named param, and node:sqlite
  // throws on any bound param the SQL string doesn't reference — so this
  // must pass exactly the fields the UPDATE below uses (createdBy is
  // deliberately immutable on edit and not in the SET clause).
  db.prepare(`
    UPDATE hf_subscriptions SET
      fund_id=@fundId, lp_id=@lpId, sub_number=@subNumber, request_date=@requestDate, amount=@amount,
      nav_per_unit_at_entry=@navPerUnitAtEntry, units_issued=@unitsIssued,
      effective_date=@effectiveDate, lockup_until=@lockupUntil, status=@status, notes=@notes,
      updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, fundId: merged.fundId || null, lpId: merged.lpId,
    subNumber: merged.subNumber, requestDate: merged.requestDate, amount: merged.amount,
    navPerUnitAtEntry: merged.navPerUnitAtEntry, unitsIssued: merged.unitsIssued,
    effectiveDate: merged.effectiveDate, lockupUntil: merged.lockupUntil, status: merged.status, notes: merged.notes,
  }));

  if (processingNow) {
    upsertHfPosition(req.tenantId, existing.fund_id, existing.lp_id, unitsIssued, navPerUnitAtEntry);
  }

  const row = db.prepare('SELECT * FROM hf_subscriptions WHERE id = ?').get(existing.id);
  res.json(rowToHfSubscription(row));
});

// Delete: only while still Pending — same "permanent record once real"
// reasoning as capital calls/distributions. A Processed subscription has
// already issued units against a real NAV; removing that silently would
// desync unit counts with no trace it ever happened.
app.delete('/api/hf/subscriptions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_subscriptions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Subscription not found in this tenant' });
  if (existing.status !== 'Pending') {
    return res.status(409).json({ error: `Cannot delete: subscription is ${existing.status}, not Pending.` });
  }
  db.prepare('DELETE FROM hf_subscriptions WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

function rowToHfRedemption(r) {
  return {
    id: r.id, fundId: r.fund_id, lpId: r.lp_id, redemptionNumber: r.redemption_number,
    requestDate: r.request_date, unitsRequested: r.units_requested, noticeExpires: r.notice_expires,
    effectiveDate: r.effective_date, navPerUnitAtExit: r.nav_per_unit_at_exit, amount: r.amount,
    lockupOk: r.lockup_ok === null ? null : !!r.lockup_ok, gateApplied: !!r.gate_applied,
    gatePctApplied: r.gate_pct_applied, status: r.status, createdBy: r.created_by, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

app.get('/api/hf/redemptions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = req.query.fundId
    ? db.prepare('SELECT * FROM hf_redemptions WHERE tenant_id = ? AND fund_id = ? ORDER BY id').all(req.tenantId, req.query.fundId)
    : db.prepare('SELECT * FROM hf_redemptions WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, redemptions: rows.map(rowToHfRedemption) });
});

app.post('/api/hf/redemptions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.lpId) return res.status(400).json({ error: 'lpId is required' });
  if (!b.unitsRequested || b.unitsRequested <= 0) return res.status(400).json({ error: 'unitsRequested must be greater than 0' });
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM hf_redemptions WHERE tenant_id = ?').get(req.tenantId);
  const redemptionNumber = b.redemptionNumber || `RED-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;
  const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(b.fundId, req.tenantId);
  const requestDate = b.requestDate || new Date().toISOString().slice(0, 10);
  // noticeExpires is server-computed from the fund's own notice period,
  // same "don't trust the client for a derived date" rule as
  // subscriptions' lockupUntil — the notice clock starts the moment the
  // LP requests it, independent of when it's later processed.
  const noticeExpires = (fund && fund.redemption_notice_days != null)
    ? new Date(new Date(requestDate + 'T00:00:00Z').getTime() + fund.redemption_notice_days * 86400000).toISOString().slice(0, 10)
    : null;
  const info = db.prepare(`
    INSERT INTO hf_redemptions
      (tenant_id, fund_id, lp_id, redemption_number, request_date, units_requested, notice_expires,
       effective_date, nav_per_unit_at_exit, amount, lockup_ok, gate_applied, gate_pct_applied, status, created_by, notes)
    VALUES
      (@tenantId, @fundId, @lpId, @redemptionNumber, @requestDate, @unitsRequested, @noticeExpires,
       @effectiveDate, @navPerUnitAtExit, @amount, @lockupOk, @gateApplied, @gatePctApplied, @status, @createdBy, @notes)
  `).run(at({
    tenantId: req.tenantId, fundId: b.fundId || null, lpId: b.lpId, redemptionNumber,
    requestDate, unitsRequested: b.unitsRequested, noticeExpires,
    effectiveDate: b.effectiveDate || null, navPerUnitAtExit: null, amount: null,
    lockupOk: null, gateApplied: 0,
    gatePctApplied: null, status: 'Requested', createdBy: b.createdBy || req.user.email, notes: b.notes || '',
  }));
  const row = db.prepare('SELECT * FROM hf_redemptions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToHfRedemption(row));
});

// Stage 2's real computation for this route: processing a Requested
// redemption (status:'Processed' in the body) runs the lockup check, then
// the gate check, against the fund's latest Published NAV — never taking
// navPerUnitAtExit/amount/lockupOk/gateApplied/gatePctApplied from the
// client for THIS transition. Everything else (plain edits to a still-
// Requested row, or any other status change) falls through unchanged.
//
// Gate design (docs/TZ_Hedge_Fund_Module.md §7's test case): this schema
// (Stage 1, mirrors the TZ verbatim) has one units_requested/amount pair
// per redemption, no separate "amount actually filled" field — so a
// redemption is either fully Processed or fully Queued for the next
// window, never partially filled. "Round" = every redemption sharing the
// same effectiveDate, checked FIFO against the fund's gate_pct of its
// current NAV total. gatePctApplied on a Queued row is informational (how
// much of the fund's remaining gate capacity this request would have
// consumed), not "how much of MY request was filled" — nothing was.
app.put('/api/hf/redemptions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_redemptions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Redemption not found in this tenant' });
  const b = req.body || {};
  const processingNow = b.status === 'Processed' && existing.status === 'Requested';

  if (processingNow) {
    const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(existing.fund_id, req.tenantId);
    const nav = latestPublishedNav(req.tenantId, existing.fund_id);
    if (!nav) {
      return res.status(409).json({ error: 'No Published NAV yet for this fund — cannot process a redemption without a reference NAV.' });
    }

    const effectiveDate = b.effectiveDate || existing.effective_date || new Date().toISOString().slice(0, 10);
    const maxLockupRow = db.prepare(`
      SELECT MAX(lockup_until) AS m FROM hf_subscriptions
      WHERE tenant_id = ? AND fund_id = ? AND lp_id = ? AND status = 'Processed'
    `).get(req.tenantId, existing.fund_id, existing.lp_id);
    const maxLockupUntil = maxLockupRow ? maxLockupRow.m : null;
    const lockupOk = !maxLockupUntil || effectiveDate >= maxLockupUntil;

    if (!lockupOk) {
      db.prepare("UPDATE hf_redemptions SET lockup_ok = 0, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(existing.id, req.tenantId);
      return res.status(409).json({ error: `Cannot process: this LP is still within lock-up (until ${maxLockupUntil})`, lockupUntil: maxLockupUntil });
    }

    const navPerUnitAtExit = nav.nav_per_unit;
    const amount = navPerUnitAtExit != null ? existing.units_requested * navPerUnitAtExit : null;
    const gateLimit = ((fund && fund.gate_pct != null ? fund.gate_pct : 25) / 100) * nav.nav_total;
    const alreadyThisRoundRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s FROM hf_redemptions
      WHERE tenant_id = ? AND fund_id = ? AND status = 'Processed' AND effective_date = ? AND id != ?
    `).get(req.tenantId, existing.fund_id, effectiveDate, existing.id);
    const alreadyThisRound = alreadyThisRoundRow.s;

    let finalStatus, gateApplied, gatePctApplied, finalAmount, finalNavPerUnit;
    if (amount != null && alreadyThisRound + amount <= gateLimit) {
      finalStatus = 'Processed'; gateApplied = false; gatePctApplied = null;
      finalAmount = amount; finalNavPerUnit = navPerUnitAtExit;
    } else {
      finalStatus = 'Queued'; gateApplied = true;
      const remainingCapacity = Math.max(0, gateLimit - alreadyThisRound);
      gatePctApplied = amount > 0 ? Math.round((remainingCapacity / amount) * 10000) / 100 : 0;
      finalAmount = null; finalNavPerUnit = null;
    }

    db.prepare(`
      UPDATE hf_redemptions SET
        effective_date = @effectiveDate, nav_per_unit_at_exit = @navPerUnitAtExit, amount = @amount,
        lockup_ok = 1, gate_applied = @gateApplied, gate_pct_applied = @gatePctApplied, status = @status,
        updated_at = datetime('now')
      WHERE id = @id AND tenant_id = @tenantId
    `).run(at({
      id: existing.id, tenantId: req.tenantId, effectiveDate,
      navPerUnitAtExit: finalNavPerUnit, amount: finalAmount,
      gateApplied: gateApplied ? 1 : 0, gatePctApplied, status: finalStatus,
    }));

    if (finalStatus === 'Processed') {
      upsertHfPosition(req.tenantId, existing.fund_id, existing.lp_id, -existing.units_requested, null);
    }

    const row = db.prepare('SELECT * FROM hf_redemptions WHERE id = ?').get(existing.id);
    const redemption = rowToHfRedemption(row);
    res.json(redemption);

    if (finalStatus === 'Processed') {
      notifyHfRedemptionProcessed(req.tenantId, redemption).catch((err) => console.error('[notify] hf_redemption_processed failed:', err.message));
    }
    return;
  }

  const merged = { ...rowToHfRedemption(existing), ...b };
  // Same at()-binds-exactly-what-it's-given rule as the subscriptions PUT
  // above — createdBy stays out of the SET clause on purpose.
  db.prepare(`
    UPDATE hf_redemptions SET
      fund_id=@fundId, lp_id=@lpId, redemption_number=@redemptionNumber, request_date=@requestDate,
      units_requested=@unitsRequested, notice_expires=@noticeExpires, effective_date=@effectiveDate,
      nav_per_unit_at_exit=@navPerUnitAtExit, amount=@amount, lockup_ok=@lockupOk,
      gate_applied=@gateApplied, gate_pct_applied=@gatePctApplied, status=@status, notes=@notes,
      updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, fundId: merged.fundId || null, lpId: merged.lpId,
    redemptionNumber: merged.redemptionNumber, requestDate: merged.requestDate, unitsRequested: merged.unitsRequested,
    noticeExpires: merged.noticeExpires, effectiveDate: merged.effectiveDate, navPerUnitAtExit: merged.navPerUnitAtExit,
    amount: merged.amount, status: merged.status, notes: merged.notes,
    lockupOk: merged.lockupOk == null ? null : (merged.lockupOk ? 1 : 0), gateApplied: merged.gateApplied ? 1 : 0,
    gatePctApplied: merged.gatePctApplied,
  }));
  const row = db.prepare('SELECT * FROM hf_redemptions WHERE id = ?').get(existing.id);
  res.json(rowToHfRedemption(row));
});

// Delete: only while still Requested — a Processed/Queued redemption has
// already been acted on (or is waiting its turn under a real gate), same
// "no silent removal of a real financial event" reasoning as subscriptions.
app.delete('/api/hf/redemptions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_redemptions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Redemption not found in this tenant' });
  if (existing.status !== 'Requested') {
    return res.status(409).json({ error: `Cannot delete: redemption is ${existing.status}, not Requested.` });
  }
  db.prepare('DELETE FROM hf_redemptions WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

function rowToHfNav(r) {
  return {
    id: r.id, fundId: r.fund_id, asOfDate: r.as_of_date,
    grossAssetValue: r.gross_asset_value, liabilities: r.liabilities,
    navTotal: r.nav_total, unitsOutstanding: r.units_outstanding, navPerUnit: r.nav_per_unit,
    status: r.status, enteredBy: r.entered_by, publishedBy: r.published_by, publishedAt: r.published_at,
    createdAt: r.created_at,
  };
}

app.get('/api/hf/nav', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = req.query.fundId
    ? db.prepare('SELECT * FROM hf_nav_history WHERE tenant_id = ? AND fund_id = ? ORDER BY as_of_date DESC, id DESC').all(req.tenantId, req.query.fundId)
    : db.prepare('SELECT * FROM hf_nav_history WHERE tenant_id = ? ORDER BY as_of_date DESC, id DESC').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, navHistory: rows.map(rowToHfNav) });
});

// nav_total/nav_per_unit ARE computed here — see the schema comment in
// server/db.js for why this is plain arithmetic, not the Stage-2/3
// business logic this file otherwise avoids. Always created as Draft;
// publishing (Draft -> Published) only happens through the dedicated
// PUT /api/hf/nav/:id/publish route below, gated on a resolved
// nav_publish workflow — never directly through this route or the
// plain-edit PUT.
app.post('/api/hf/nav', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.asOfDate) return res.status(400).json({ error: 'asOfDate is required' });
  const grossAssetValue = b.grossAssetValue || 0;
  const liabilities = b.liabilities || 0;
  const unitsOutstanding = b.unitsOutstanding || 0;
  const navTotal = grossAssetValue - liabilities;
  const navPerUnit = unitsOutstanding > 0 ? navTotal / unitsOutstanding : null;
  const info = db.prepare(`
    INSERT INTO hf_nav_history
      (tenant_id, fund_id, as_of_date, gross_asset_value, liabilities, nav_total, units_outstanding, nav_per_unit, status, entered_by)
    VALUES
      (@tenantId, @fundId, @asOfDate, @grossAssetValue, @liabilities, @navTotal, @unitsOutstanding, @navPerUnit, @status, @enteredBy)
  `).run(at({
    tenantId: req.tenantId, fundId: b.fundId || null, asOfDate: b.asOfDate,
    grossAssetValue, liabilities, navTotal, unitsOutstanding, navPerUnit,
    status: 'Draft', enteredBy: req.user.email,
  }));
  const row = db.prepare('SELECT * FROM hf_nav_history WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToHfNav(row));
});

// Edits only while Draft — once Published a NAV row is a historical
// record (every subscription/redemption effective before the next one
// may reference it), same immutability reasoning as a sent Capital Call.
app.put('/api/hf/nav/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_nav_history WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'NAV record not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot edit: NAV record is ${existing.status}, not Draft.` });
  }
  const b = req.body || {};
  const grossAssetValue = b.grossAssetValue != null ? b.grossAssetValue : existing.gross_asset_value;
  const liabilities = b.liabilities != null ? b.liabilities : existing.liabilities;
  const unitsOutstanding = b.unitsOutstanding != null ? b.unitsOutstanding : existing.units_outstanding;
  const navTotal = grossAssetValue - liabilities;
  const navPerUnit = unitsOutstanding > 0 ? navTotal / unitsOutstanding : null;
  db.prepare(`
    UPDATE hf_nav_history SET
      as_of_date=@asOfDate, gross_asset_value=@grossAssetValue, liabilities=@liabilities,
      nav_total=@navTotal, units_outstanding=@unitsOutstanding, nav_per_unit=@navPerUnit
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, asOfDate: b.asOfDate || existing.as_of_date,
    grossAssetValue, liabilities, navTotal, unitsOutstanding, navPerUnit,
  }));
  const row = db.prepare('SELECT * FROM hf_nav_history WHERE id = ?').get(existing.id);
  res.json(rowToHfNav(row));
});

// Draft -> Published, and ONLY through a resolved nav_publish workflow —
// this route re-verifies server-side that an 'approved' workflow_instances
// row of type='nav_publish'/entityType='HfNav'/entityId=this NAV's id
// actually exists before flipping anything. That's what makes "must go
// through the workflow" a real guarantee rather than a UI convention a
// direct API call could bypass (docs/TZ_Hedge_Fund_Module.md §4: "нельзя
// просто PUT status=Published напрямую, иначе смысла в согласовании
// нет"). The frontend calls this from syncWfToEntity (js/workflow.js)
// right after the workflow's last step resolves — see that file's
// entityType==='HfNav' branch.
app.put('/api/hf/nav/:id/publish', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_nav_history WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'NAV record not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot publish: NAV record is already ${existing.status}.` });
  }
  const approvedWf = db.prepare(`
    SELECT * FROM workflow_instances
    WHERE tenant_id = ? AND type = 'nav_publish' AND entity_type = 'HfNav' AND entity_id = ? AND status = 'approved'
  `).get(req.tenantId, existing.id);
  if (!approvedWf) {
    return res.status(409).json({ error: 'No approved nav_publish workflow found for this NAV record — publish it through Согласования first.' });
  }
  db.prepare(`
    UPDATE hf_nav_history SET status = 'Published', published_by = @publishedBy, published_at = @publishedAt
    WHERE id = @id AND tenant_id = @tenantId
  `).run(at({ id: existing.id, tenantId: req.tenantId, publishedBy: req.user.name || req.user.email, publishedAt: new Date().toISOString() }));
  const row = db.prepare('SELECT * FROM hf_nav_history WHERE id = ?').get(existing.id);
  const nav = rowToHfNav(row);
  res.json(nav);

  notifyHfNavPublished(req.tenantId, nav).catch((err) => console.error('[notify] hf_nav_published failed:', err.message));
});

app.delete('/api/hf/nav/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM hf_nav_history WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'NAV record not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot delete: NAV record is ${existing.status}, not Draft. A Published NAV is a permanent historical record.` });
  }
  db.prepare('DELETE FROM hf_nav_history WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

// Stage 3 (docs/TZ_Hedge_Fund_Module.md §3) — the real fee math lives in
// server/performanceFeeEngine.js (pure functions, its own test file);
// this route owns all the reading/writing around it: which positions to
// run, the double-crystallization guard, and applying the result back to
// hf_investor_positions. Only a manual run exists here — wiring this into
// server/notifications/scheduler.js by fee_crystallization_frequency is
// Stage 4, not this one.
function rowToHfFeeCrystallization(r) {
  return {
    id: r.id, fundId: r.fund_id, lpId: r.lp_id,
    periodStart: r.period_start, periodEnd: r.period_end,
    navPerUnitStart: r.nav_per_unit_start, navPerUnitEnd: r.nav_per_unit_end,
    hwmBefore: r.hwm_before, hwmAfter: r.hwm_after, gainPerUnit: r.gain_per_unit,
    performanceFeePct: r.performance_fee_pct, feeAmount: r.fee_amount,
    unitsDeductedForFee: r.units_deducted_for_fee, createdAt: r.created_at,
  };
}

app.get('/api/hf/fee-crystallizations', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = req.query.fundId
    ? db.prepare('SELECT * FROM hf_fee_crystallizations WHERE tenant_id = ? AND fund_id = ? ORDER BY id DESC').all(req.tenantId, req.query.fundId)
    : db.prepare('SELECT * FROM hf_fee_crystallizations WHERE tenant_id = ? ORDER BY id DESC').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, feeCrystallizations: rows.map(rowToHfFeeCrystallization) });
});

// CEO/CFO only (paymentConfirm — same dual-role gate already used for
// Capital Call/Distribution payment confirmation) since this moves real
// economic value from LP units to the GP, the same class of action.
app.post('/api/hf/fee-crystallization/run', requireAuth, requireInternal, requirePermission('paymentConfirm'), (req, res) => {
  const b = req.body || {};
  if (!b.fundId) return res.status(400).json({ error: 'fundId is required' });
  const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(b.fundId, req.tenantId);
  if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });

  const nav = latestPublishedNav(req.tenantId, fund.id);
  if (!nav) return res.status(409).json({ error: 'No Published NAV yet for this fund — cannot crystallize fee without a reference NAV.' });
  const asOfDate = nav.as_of_date;

  const positions = db.prepare('SELECT * FROM hf_investor_positions WHERE tenant_id = ? AND fund_id = ? AND units_held > 0').all(req.tenantId, fund.id);
  const results = [];
  for (const pos of positions) {
    // Guard: never crystallize the same NAV date twice for the same
    // position — running this route again against an unchanged Published
    // NAV must be a safe no-op, not a second fee charge.
    if (pos.last_fee_crystallization_date && pos.last_fee_crystallization_date >= asOfDate) continue;

    let periodStart = pos.last_fee_crystallization_date;
    if (!periodStart) {
      // First-ever crystallization for this position: the period starts
      // at the LP's own entry into the fund, not an arbitrary date.
      const earliest = db.prepare(`
        SELECT MIN(effective_date) AS d FROM hf_subscriptions
        WHERE tenant_id = ? AND fund_id = ? AND lp_id = ? AND status = 'Processed'
      `).get(req.tenantId, fund.id, pos.lp_id);
      periodStart = earliest && earliest.d ? earliest.d : asOfDate;
    }
    const periodDays = Math.max(0, daysBetween(periodStart, asOfDate));
    const navAtStart = db.prepare(`
      SELECT nav_per_unit FROM hf_nav_history
      WHERE tenant_id = ? AND fund_id = ? AND status = 'Published' AND as_of_date <= ?
      ORDER BY as_of_date DESC, id DESC LIMIT 1
    `).get(req.tenantId, fund.id, periodStart);

    const result = computeFeeCrystallization({
      navPerUnitEnd: nav.nav_per_unit, hwmBefore: pos.high_water_mark_per_unit,
      unitsHeld: pos.units_held, performanceFeePct: fund.performance_fee_pct,
      hurdleRatePct: fund.hf_hurdle_rate || 0, periodDays,
    });

    const info = db.prepare(`
      INSERT INTO hf_fee_crystallizations
        (tenant_id, fund_id, lp_id, period_start, period_end, nav_per_unit_start, nav_per_unit_end,
         hwm_before, hwm_after, gain_per_unit, performance_fee_pct, fee_amount, units_deducted_for_fee)
      VALUES
        (@tenantId, @fundId, @lpId, @periodStart, @periodEnd, @navPerUnitStart, @navPerUnitEnd,
         @hwmBefore, @hwmAfter, @gainPerUnit, @performanceFeePct, @feeAmount, @unitsDeductedForFee)
    `).run(at({
      tenantId: req.tenantId, fundId: fund.id, lpId: pos.lp_id,
      periodStart, periodEnd: asOfDate,
      navPerUnitStart: navAtStart ? navAtStart.nav_per_unit : null, navPerUnitEnd: nav.nav_per_unit,
      hwmBefore: pos.high_water_mark_per_unit, hwmAfter: result.hwmAfter, gainPerUnit: result.gainPerUnit,
      performanceFeePct: fund.performance_fee_pct, feeAmount: result.feeAmount, unitsDeductedForFee: result.unitsDeductedForFee,
    }));

    db.prepare(`
      UPDATE hf_investor_positions SET
        units_held = @unitsHeld, high_water_mark_per_unit = @hwm, last_fee_crystallization_date = @asOfDate, updated_at = datetime('now')
      WHERE tenant_id = @tenantId AND fund_id = @fundId AND lp_id = @lpId
    `).run(at({
      tenantId: req.tenantId, fundId: fund.id, lpId: pos.lp_id,
      unitsHeld: pos.units_held - result.unitsDeductedForFee, hwm: result.hwmAfter, asOfDate,
    }));

    const row = db.prepare('SELECT * FROM hf_fee_crystallizations WHERE id = ?').get(info.lastInsertRowid);
    results.push(rowToHfFeeCrystallization(row));
  }

  res.json({ asOfDate, crystallizations: results });
});

// Stage 5 (docs/TZ_Hedge_Fund_Module.md §4) — read views for the
// dashboard/LP-portal frontend. Both are pure aggregation over tables the
// earlier stages already own; neither writes anything.
function navAsOfOrBefore(tenantId, fundId, date) {
  return db.prepare(`
    SELECT * FROM hf_nav_history WHERE tenant_id = ? AND fund_id = ? AND status = 'Published' AND as_of_date <= ?
    ORDER BY as_of_date DESC, id DESC LIMIT 1
  `).get(tenantId, fundId, date);
}

// { aum, navPerUnit, mtdReturn, ytdReturn, sinceInceptionReturn } — the
// open-end dashboard's replacement for the closed-end IRR/DPI/TVPI cards.
// Every return field is a real % change between two actually-Published
// NAVs, null (never a fabricated 0) when there's no earlier NAV to
// compare against — same "null over a fake number" rule as
// metricsEngine.js's computeFundMetrics.
app.get('/api/funds/:id/hf-metrics', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });
  const latest = latestPublishedNav(req.tenantId, fund.id);
  if (!latest) return res.json({ aum: null, navPerUnit: null, asOfDate: null, mtdReturn: null, ytdReturn: null, sinceInceptionReturn: null });

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  const monthStartNav = navAsOfOrBefore(req.tenantId, fund.id, monthStart);
  const yearStartNav = navAsOfOrBefore(req.tenantId, fund.id, yearStart);
  const inceptionNav = db.prepare(`
    SELECT * FROM hf_nav_history WHERE tenant_id = ? AND fund_id = ? AND status = 'Published' ORDER BY as_of_date ASC, id ASC LIMIT 1
  `).get(req.tenantId, fund.id);
  const pctReturn = (base) => (base && base.nav_per_unit > 0) ? (latest.nav_per_unit / base.nav_per_unit - 1) : null;

  res.json({
    aum: latest.nav_total, navPerUnit: latest.nav_per_unit, asOfDate: latest.as_of_date,
    mtdReturn: pctReturn(monthStartNav), ytdReturn: pctReturn(yearStartNav), sinceInceptionReturn: pctReturn(inceptionNav),
  });
});

// Shared by the internal route below and the LP-portal one further down —
// { unitsHeld, currentValue, unrealizedGain, hwm, feesPaidToDate } or null
// if this LP has never held a position in this fund.
function hfPositionSummary(tenantId, fundId, lpId) {
  const pos = db.prepare('SELECT * FROM hf_investor_positions WHERE tenant_id = ? AND fund_id = ? AND lp_id = ?').get(tenantId, fundId, lpId);
  if (!pos) return null;
  const nav = latestPublishedNav(tenantId, fundId);
  const feesRow = db.prepare('SELECT COALESCE(SUM(fee_amount), 0) AS s FROM hf_fee_crystallizations WHERE tenant_id = ? AND fund_id = ? AND lp_id = ?').get(tenantId, fundId, lpId);
  const currentValue = nav ? pos.units_held * nav.nav_per_unit : null;
  // unrealizedGain needs a real cost basis, NOT the HWM — HWM tracks the
  // fee-relevant peak (it moves up to the current NAV every time a fee
  // crystallizes), which after even one crystallization no longer means
  // "what this LP paid in". A standard weighted-average cost basis from
  // every Processed subscription's own amount/units is the honest figure:
  // avg cost/unit * units still held (assumes redemptions reduce units at
  // that same average cost, the conventional average-cost-basis method).
  const costRow = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(units_issued), 0) AS units
    FROM hf_subscriptions WHERE tenant_id = ? AND fund_id = ? AND lp_id = ? AND status = 'Processed'
  `).get(tenantId, fundId, lpId);
  const avgCostPerUnit = costRow.units > 0 ? costRow.amt / costRow.units : null;
  const costBasisRemaining = avgCostPerUnit != null ? pos.units_held * avgCostPerUnit : null;
  const unrealizedGain = (currentValue != null && costBasisRemaining != null) ? currentValue - costBasisRemaining : null;
  return {
    unitsHeld: pos.units_held, navPerUnit: nav ? nav.nav_per_unit : null,
    currentValue, unrealizedGain, hwm: pos.high_water_mark_per_unit, feesPaidToDate: feesRow.s,
  };
}

app.get('/api/lp/:id/hf-position', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const lp = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!lp) return res.status(404).json({ error: 'LP not found in this tenant' });
  res.json({ position: lp.fund_id ? hfPositionSummary(req.tenantId, lp.fund_id, lp.id) : null });
});

/* ===== LP self-service portal — Hedge Fund (lp-portal.html) =====
   Same identity space as GET /api/portal/lp/me etc. (requireLpPortalAuth,
   scoped to req.portalLp — never a client-supplied id). Reads reuse the
   same helpers/row mappers the internal routes above already use. The two
   writes follow the exact same shape as POST /api/portal/payment-
   confirmations (portfolio-company portal): the LP's submission lands as
   a normal Pending/Requested row — the SAME state an internal-staff-
   created one starts in — reviewed and processed by staff through the
   existing internal hf_subscriptions/hf_redemptions routes (Stage 2).
   Nothing here bypasses lockup/gate/NAV computation; it only creates the
   request. */
app.get('/api/portal/lp/hf-position', requireLpPortalAuth, (req, res) => {
  res.json({ position: req.portalLp.fund_id ? hfPositionSummary(req.tenantId, req.portalLp.fund_id, req.portalLp.id) : null });
});

app.get('/api/portal/lp/hf-subscriptions', requireLpPortalAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM hf_subscriptions WHERE tenant_id = ? AND lp_id = ? ORDER BY id DESC').all(req.tenantId, req.portalLp.id);
  res.json({ subscriptions: rows.map(rowToHfSubscription) });
});

app.get('/api/portal/lp/hf-redemptions', requireLpPortalAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM hf_redemptions WHERE tenant_id = ? AND lp_id = ? ORDER BY id DESC').all(req.tenantId, req.portalLp.id);
  res.json({ redemptions: rows.map(rowToHfRedemption) });
});

app.post('/api/portal/lp/hf-subscription-request', requireLpPortalAuth, (req, res) => {
  const b = req.body || {};
  if (!b.amount || b.amount <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });
  const fundId = req.portalLp.fund_id;
  if (!fundId) return res.status(409).json({ error: 'This LP has no fund on record' });
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM hf_subscriptions WHERE tenant_id = ?').get(req.tenantId);
  const subNumber = `SUB-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;
  const info = db.prepare(`
    INSERT INTO hf_subscriptions (tenant_id, fund_id, lp_id, sub_number, request_date, amount, status, created_by, notes)
    VALUES (@tenantId, @fundId, @lpId, @subNumber, @requestDate, @amount, @status, @createdBy, @notes)
  `).run(at({
    tenantId: req.tenantId, fundId, lpId: req.portalLp.id, subNumber,
    requestDate: new Date().toISOString().slice(0, 10), amount: b.amount,
    status: 'Pending', createdBy: 'Портал: ' + req.portalLp.name, notes: b.notes || '',
  }));
  const row = db.prepare('SELECT * FROM hf_subscriptions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToHfSubscription(row));
});

app.post('/api/portal/lp/hf-redemption-request', requireLpPortalAuth, (req, res) => {
  const b = req.body || {};
  if (!b.unitsRequested || b.unitsRequested <= 0) return res.status(400).json({ error: 'unitsRequested must be greater than 0' });
  const fundId = req.portalLp.fund_id;
  if (!fundId) return res.status(409).json({ error: 'This LP has no fund on record' });
  const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(fundId, req.tenantId);
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM hf_redemptions WHERE tenant_id = ?').get(req.tenantId);
  const redemptionNumber = `RED-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;
  const requestDate = new Date().toISOString().slice(0, 10);
  const noticeExpires = (fund && fund.redemption_notice_days != null)
    ? new Date(new Date(requestDate + 'T00:00:00Z').getTime() + fund.redemption_notice_days * 86400000).toISOString().slice(0, 10)
    : null;
  const info = db.prepare(`
    INSERT INTO hf_redemptions (tenant_id, fund_id, lp_id, redemption_number, request_date, units_requested, notice_expires, status, created_by, notes)
    VALUES (@tenantId, @fundId, @lpId, @redemptionNumber, @requestDate, @unitsRequested, @noticeExpires, @status, @createdBy, @notes)
  `).run(at({
    tenantId: req.tenantId, fundId, lpId: req.portalLp.id, redemptionNumber,
    requestDate, unitsRequested: b.unitsRequested, noticeExpires,
    status: 'Requested', createdBy: 'Портал: ' + req.portalLp.name, notes: b.notes || '',
  }));
  const row = db.prepare('SELECT * FROM hf_redemptions WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToHfRedemption(row));
});

/* ===== VC module: cap table + SPV — tenant-scoped =====
   docs/TZ_VC_Module.md. Only meaningful for asset_class='vc' funds, but
   the API itself doesn't hard-gate on that (same tolerance as Hedge
   Fund's fund-level settings columns) — js/vc.js is what hides the SPV
   nav item for non-VC funds. Unlike Hedge Fund, the fund's own economics
   (capital_calls/distributions/waterfallEngine.js) are untouched; these
   tables cover only what's genuinely new — multi-round dilution and SPV
   co-invest vehicles. */

function rowToPortfolioRound(r) {
  return {
    id: r.id, portfolioId: r.portfolio_id, roundName: r.round_name, roundDate: r.round_date,
    instrument: r.instrument, preMoney: r.pre_money, postMoney: r.post_money,
    amountRaised: r.amount_raised, pricePerShare: r.price_per_share,
    isFundRound: !!r.is_fund_round, sourceDealId: r.source_deal_id,
    notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowToRoundInvestor(r) {
  return {
    id: r.id, roundId: r.round_id, investorName: r.investor_name, investorType: r.investor_type,
    isOwnFund: !!r.is_own_fund, spvId: r.spv_id, amount: r.amount, shares: r.shares,
    ownershipPctPost: r.ownership_pct_post,
  };
}

const roundInvestorsStmt = db.prepare('SELECT * FROM portfolio_round_investors WHERE tenant_id = ? AND round_id = ? ORDER BY id');

// Recomputes every round-investor's ownership_pct_post for a portfolio
// company from scratch (never trusts a stored value), and returns the
// company's CURRENT fund ownership % diluted through every later round.
// ownership_pct_post per round-investor row is that investor's stake
// purchased IN that specific round (amount / that round's post-money) —
// it deliberately does not retroactively change on later rounds (that's
// the standard "how big was my check, as % of the company then" reading
// of a cap table line). fundOwnershipPct is the separate, genuinely
// dilution-aware number: every is_own_fund/SPV round stake carried
// forward and multiplied by (pre_money/post_money) of each subsequent
// round — see docs/TZ_VC_Module.md §2.2. This avoids modeling an actual
// fully-diluted share ledger (option pools, exact share counts) while
// still answering the question that matters for a VC LP report: "what %
// of this company do we actually own right now".
function recomputeCapTable(tenantId, portfolioId) {
  const rounds = db.prepare(`
    SELECT * FROM portfolio_rounds WHERE tenant_id = ? AND portfolio_id = ?
    ORDER BY (round_date IS NULL), round_date, id
  `).all(tenantId, portfolioId);
  const updateInvestor = db.prepare('UPDATE portfolio_round_investors SET ownership_pct_post = @pct WHERE id = @id');
  let fundOwnershipPct = 0;
  let hasFundStake = false;
  for (const round of rounds) {
    const dilution = (round.pre_money > 0 && round.post_money > 0) ? round.pre_money / round.post_money : 1;
    fundOwnershipPct *= dilution;
    const investors = roundInvestorsStmt.all(tenantId, round.id);
    for (const inv of investors) {
      const pct = (round.post_money > 0 && inv.amount != null) ? (inv.amount / round.post_money) * 100 : null;
      updateInvestor.run(at({ id: inv.id, pct }));
      if (inv.is_own_fund) {
        hasFundStake = true;
        if (pct != null) fundOwnershipPct += pct;
      }
    }
  }
  return hasFundStake ? fundOwnershipPct : null;
}

app.get('/api/portfolio/:id/rounds', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const portfolio = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const rounds = db.prepare(`
    SELECT * FROM portfolio_rounds WHERE tenant_id = ? AND portfolio_id = ?
    ORDER BY (round_date IS NULL), round_date, id
  `).all(req.tenantId, portfolio.id).map(r => {
    const round = rowToPortfolioRound(r);
    round.investors = roundInvestorsStmt.all(req.tenantId, r.id).map(rowToRoundInvestor);
    return round;
  });
  const fundOwnershipPct = recomputeCapTable(req.tenantId, portfolio.id);
  res.json({ rounds, fundOwnershipPct });
});

app.post('/api/portfolio/:id/rounds', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const portfolio = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!portfolio) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const b = req.body || {};
  if (!b.roundName) return res.status(400).json({ error: 'roundName is required' });
  const investors = Array.isArray(b.investors) ? b.investors : [];

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO portfolio_rounds
        (tenant_id, portfolio_id, round_name, round_date, instrument, pre_money, post_money,
         amount_raised, price_per_share, is_fund_round, source_deal_id, notes, created_by)
      VALUES
        (@tenantId, @portfolioId, @roundName, @roundDate, @instrument, @preMoney, @postMoney,
         @amountRaised, @pricePerShare, @isFundRound, @sourceDealId, @notes, @createdBy)
    `).run(at({
      tenantId: req.tenantId, portfolioId: portfolio.id, roundName: b.roundName, roundDate: b.roundDate || null,
      instrument: b.instrument || null, preMoney: b.preMoney != null ? b.preMoney : null, postMoney: b.postMoney != null ? b.postMoney : null,
      amountRaised: b.amountRaised != null ? b.amountRaised : null, pricePerShare: b.pricePerShare != null ? b.pricePerShare : null,
      isFundRound: b.isFundRound ? 1 : 0, sourceDealId: b.sourceDealId || null, notes: b.notes || '',
      createdBy: b.createdBy || req.user.email,
    }));
    const roundId = info.lastInsertRowid;
    const insertInvestor = db.prepare(`
      INSERT INTO portfolio_round_investors (tenant_id, round_id, investor_name, investor_type, is_own_fund, spv_id, amount, shares)
      VALUES (@tenantId, @roundId, @investorName, @investorType, @isOwnFund, @spvId, @amount, @shares)
    `);
    for (const inv of investors) {
      if (!inv.investorName) continue;
      insertInvestor.run(at({
        tenantId: req.tenantId, roundId, investorName: inv.investorName, investorType: inv.investorType || null,
        isOwnFund: inv.isOwnFund ? 1 : 0, spvId: inv.spvId || null,
        amount: inv.amount != null ? inv.amount : null, shares: inv.shares != null ? inv.shares : null,
      }));
    }
    db.exec('COMMIT');
    const fundOwnershipPct = recomputeCapTable(req.tenantId, portfolio.id);
    const round = rowToPortfolioRound(db.prepare('SELECT * FROM portfolio_rounds WHERE id = ?').get(roundId));
    round.investors = roundInvestorsStmt.all(req.tenantId, roundId).map(rowToRoundInvestor);
    res.status(201).json({ round, fundOwnershipPct });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[portfolio-rounds] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create round — please try again' });
  }
});

app.put('/api/portfolio/rounds/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio_rounds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Round not found in this tenant' });
  const b = req.body || {};
  const merged = { ...rowToPortfolioRound(existing), ...b };

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE portfolio_rounds SET
        round_name=@roundName, round_date=@roundDate, instrument=@instrument, pre_money=@preMoney, post_money=@postMoney,
        amount_raised=@amountRaised, price_per_share=@pricePerShare, is_fund_round=@isFundRound,
        source_deal_id=@sourceDealId, notes=@notes, updated_at=datetime('now')
      WHERE id=@id AND tenant_id=@tenantId
    `).run(at({
      id: existing.id, tenantId: req.tenantId, roundName: merged.roundName, roundDate: merged.roundDate || null,
      instrument: merged.instrument || null, preMoney: merged.preMoney != null ? merged.preMoney : null,
      postMoney: merged.postMoney != null ? merged.postMoney : null, amountRaised: merged.amountRaised != null ? merged.amountRaised : null,
      pricePerShare: merged.pricePerShare != null ? merged.pricePerShare : null, isFundRound: merged.isFundRound ? 1 : 0,
      sourceDealId: merged.sourceDealId || null, notes: merged.notes || '',
    }));
    // Investors are replaced wholesale when supplied — same "delete-then-
    // reinsert" convention as elsewhere in this app for a list-shaped
    // sub-resource with no independent identity of its own.
    if (Array.isArray(b.investors)) {
      db.prepare('DELETE FROM portfolio_round_investors WHERE tenant_id = ? AND round_id = ?').run(req.tenantId, existing.id);
      const insertInvestor = db.prepare(`
        INSERT INTO portfolio_round_investors (tenant_id, round_id, investor_name, investor_type, is_own_fund, spv_id, amount, shares)
        VALUES (@tenantId, @roundId, @investorName, @investorType, @isOwnFund, @spvId, @amount, @shares)
      `);
      for (const inv of b.investors) {
        if (!inv.investorName) continue;
        insertInvestor.run(at({
          tenantId: req.tenantId, roundId: existing.id, investorName: inv.investorName, investorType: inv.investorType || null,
          isOwnFund: inv.isOwnFund ? 1 : 0, spvId: inv.spvId || null,
          amount: inv.amount != null ? inv.amount : null, shares: inv.shares != null ? inv.shares : null,
        }));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  const fundOwnershipPct = recomputeCapTable(req.tenantId, existing.portfolio_id);
  const round = rowToPortfolioRound(db.prepare('SELECT * FROM portfolio_rounds WHERE id = ?').get(existing.id));
  round.investors = roundInvestorsStmt.all(req.tenantId, existing.id).map(rowToRoundInvestor);
  res.json({ round, fundOwnershipPct });
});

app.delete('/api/portfolio/rounds/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio_rounds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Round not found in this tenant' });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM portfolio_round_investors WHERE tenant_id = ? AND round_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM portfolio_rounds WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  recomputeCapTable(req.tenantId, existing.portfolio_id);
  res.json({ ok: true, deleted: true });
});

/* ----- SPV / co-investment vehicles ----- */

function rowToSpv(r) {
  return {
    id: r.id, fundId: r.fund_id, portfolioId: r.portfolio_id, dealId: r.deal_id, name: r.name,
    legalEntityName: r.legal_entity_name, jurisdiction: r.jurisdiction, formationDate: r.formation_date,
    status: r.status, targetSize: r.target_size, currency: r.currency,
    managementFeePct: r.management_fee_pct, carriedInterestPct: r.carried_interest_pct,
    preferredReturnPct: r.preferred_return_pct, catchUpPct: r.catch_up_pct, gpEntity: r.gp_entity,
    notes: r.notes, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function rowToSpvInvestor(r) {
  return {
    id: r.id, spvId: r.spv_id, lpId: r.lp_id, name: r.name, investorType: r.investor_type,
    email: r.email, contact: r.contact, commitment: r.commitment, calledAmount: r.called_amount,
    paidAmount: r.paid_amount, distributions: r.distributions, kycStatus: r.kyc_status, status: r.status,
    notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const spvInvestorsStmt = db.prepare('SELECT * FROM spv_investors WHERE tenant_id = ? AND spv_id = ? ORDER BY id');

app.get('/api/spvs', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = req.query.fundId
    ? db.prepare('SELECT * FROM spvs WHERE tenant_id = ? AND fund_id = ? ORDER BY id').all(req.tenantId, req.query.fundId)
    : db.prepare('SELECT * FROM spvs WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const result = rows.map(r => {
    const spv = rowToSpv(r);
    const investors = spvInvestorsStmt.all(req.tenantId, r.id);
    spv.investorCount = investors.length;
    spv.totalCommitment = investors.reduce((s, i) => s + (i.commitment || 0), 0);
    spv.totalCalled = investors.reduce((s, i) => s + (i.called_amount || 0), 0);
    return spv;
  });
  res.json({ tenant: req.tenantSlug, spvs: result });
});

app.post('/api/spvs', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (!b.fundId) return res.status(400).json({ error: 'fundId is required' });
  const fund = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(b.fundId, req.tenantId);
  if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });

  const info = db.prepare(`
    INSERT INTO spvs
      (tenant_id, fund_id, portfolio_id, deal_id, name, legal_entity_name, jurisdiction, formation_date,
       status, target_size, currency, management_fee_pct, carried_interest_pct, preferred_return_pct,
       catch_up_pct, gp_entity, notes, created_by)
    VALUES
      (@tenantId, @fundId, @portfolioId, @dealId, @name, @legalEntityName, @jurisdiction, @formationDate,
       @status, @targetSize, @currency, @managementFeePct, @carriedInterestPct, @preferredReturnPct,
       @catchUpPct, @gpEntity, @notes, @createdBy)
  `).run(at({
    tenantId: req.tenantId, fundId: b.fundId, portfolioId: b.portfolioId || null, dealId: b.dealId || null,
    name: b.name, legalEntityName: b.legalEntityName || null, jurisdiction: b.jurisdiction || null,
    formationDate: b.formationDate || null, status: b.status || 'Forming',
    targetSize: b.targetSize != null ? b.targetSize : null, currency: b.currency || 'USD',
    managementFeePct: b.managementFeePct != null ? b.managementFeePct : 0,
    carriedInterestPct: b.carriedInterestPct != null ? b.carriedInterestPct : 20,
    preferredReturnPct: b.preferredReturnPct != null ? b.preferredReturnPct : 0,
    catchUpPct: b.catchUpPct != null ? b.catchUpPct : 100,
    gpEntity: b.gpEntity || null, notes: b.notes || '', createdBy: b.createdBy || req.user.email,
  }));
  const row = db.prepare('SELECT * FROM spvs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToSpv(row));
});

app.get('/api/spvs/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const spv = rowToSpv(existing);
  spv.investors = spvInvestorsStmt.all(req.tenantId, spv.id).map(rowToSpvInvestor);
  spv.capitalCalls = db.prepare('SELECT * FROM spv_capital_calls WHERE tenant_id = ? AND spv_id = ? ORDER BY id').all(req.tenantId, spv.id).map(r => {
    const cc = rowToSpvCC(r);
    cc.lineItems = spvCcLineItemsStmt.all(req.tenantId, r.id).map(rowToSpvCcLineItem);
    return cc;
  });
  spv.distributions = db.prepare('SELECT * FROM spv_distributions WHERE tenant_id = ? AND spv_id = ? ORDER BY id').all(req.tenantId, spv.id).map(r => {
    const d = rowToSpvDist(r);
    d.lineItems = spvDistLineItemsStmt.all(req.tenantId, r.id).map(rowToSpvDistLineItem);
    return d;
  });
  res.json(spv);
});

app.put('/api/spvs/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const b = req.body || {};
  const merged = { ...rowToSpv(existing), ...b };
  db.prepare(`
    UPDATE spvs SET
      fund_id=@fundId, portfolio_id=@portfolioId, deal_id=@dealId, name=@name, legal_entity_name=@legalEntityName,
      jurisdiction=@jurisdiction, formation_date=@formationDate, status=@status, target_size=@targetSize,
      currency=@currency, management_fee_pct=@managementFeePct, carried_interest_pct=@carriedInterestPct,
      preferred_return_pct=@preferredReturnPct, catch_up_pct=@catchUpPct, gp_entity=@gpEntity, notes=@notes,
      updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, fundId: merged.fundId, portfolioId: merged.portfolioId || null,
    dealId: merged.dealId || null, name: merged.name, legalEntityName: merged.legalEntityName || null,
    jurisdiction: merged.jurisdiction || null, formationDate: merged.formationDate || null, status: merged.status,
    targetSize: merged.targetSize != null ? merged.targetSize : null, currency: merged.currency || 'USD',
    managementFeePct: merged.managementFeePct, carriedInterestPct: merged.carriedInterestPct,
    preferredReturnPct: merged.preferredReturnPct, catchUpPct: merged.catchUpPct,
    gpEntity: merged.gpEntity || null, notes: merged.notes || '',
  }));
  const row = db.prepare('SELECT * FROM spvs WHERE id = ?').get(existing.id);
  res.json(rowToSpv(row));
});

// Blocked once there's any real financial footprint (a capital call ever
// issued, or an investor with money actually paid in) — same "permanent
// record once real" reasoning as capital_calls/distributions/hf_*.
app.delete('/api/spvs/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const calls = db.prepare('SELECT id FROM spv_capital_calls WHERE tenant_id = ? AND spv_id = ?').all(req.tenantId, existing.id);
  if (calls.length) {
    return res.status(409).json({
      error: `Cannot delete: SPV has ${calls.length} capital call(s). Set status to 'Wound Down' instead.`,
      footprint: [{ table: 'spv_capital_calls', column: 'spv_id', count: calls.length }],
    });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM spv_investors WHERE tenant_id = ? AND spv_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM spvs WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true, deleted: true });
});

app.post('/api/spvs/:id/investors', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare(`
    INSERT INTO spv_investors
      (tenant_id, spv_id, lp_id, name, investor_type, email, contact, commitment, called_amount, paid_amount, distributions, kyc_status, status, notes)
    VALUES
      (@tenantId, @spvId, @lpId, @name, @investorType, @email, @contact, @commitment, @calledAmount, @paidAmount, @distributions, @kycStatus, @status, @notes)
  `).run(at({
    tenantId: req.tenantId, spvId: spv.id, lpId: b.lpId || null, name: b.name, investorType: b.investorType || null,
    email: b.email || null, contact: b.contact || null, commitment: b.commitment != null ? b.commitment : 0,
    calledAmount: b.calledAmount != null ? b.calledAmount : 0, paidAmount: b.paidAmount != null ? b.paidAmount : 0,
    distributions: b.distributions != null ? b.distributions : 0, kycStatus: b.kycStatus || 'Pending',
    status: b.status || 'Active', notes: b.notes || '',
  }));
  const row = db.prepare('SELECT * FROM spv_investors WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToSpvInvestor(row));
});

app.put('/api/spv-investors/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_investors WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV investor not found in this tenant' });
  const b = req.body || {};
  const merged = { ...rowToSpvInvestor(existing), ...b };
  db.prepare(`
    UPDATE spv_investors SET
      lp_id=@lpId, name=@name, investor_type=@investorType, email=@email, contact=@contact,
      commitment=@commitment, called_amount=@calledAmount, paid_amount=@paidAmount, distributions=@distributions,
      kyc_status=@kycStatus, status=@status, notes=@notes, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, lpId: merged.lpId || null, name: merged.name,
    investorType: merged.investorType || null, email: merged.email || null, contact: merged.contact || null,
    commitment: merged.commitment || 0, calledAmount: merged.calledAmount || 0, paidAmount: merged.paidAmount || 0,
    distributions: merged.distributions || 0, kycStatus: merged.kycStatus || 'Pending', status: merged.status || 'Active',
    notes: merged.notes || '',
  }));
  const row = db.prepare('SELECT * FROM spv_investors WHERE id = ?').get(existing.id);
  res.json(rowToSpvInvestor(row));
});

app.delete('/api/spv-investors/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_investors WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV investor not found in this tenant' });
  const lineItems = db.prepare('SELECT id FROM spv_capital_call_line_items WHERE tenant_id = ? AND spv_investor_id = ?').all(req.tenantId, existing.id);
  if (lineItems.length) {
    return res.status(409).json({
      error: `Cannot delete: investor has ${lineItems.length} capital call line item(s). Set status to 'Exited' instead.`,
      footprint: [{ table: 'spv_capital_call_line_items', column: 'spv_investor_id', count: lineItems.length }],
    });
  }
  db.prepare('DELETE FROM spv_investors WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  res.json({ ok: true, deleted: true });
});

/* ----- SPV capital calls / distributions — mirrors Capital Calls/
   Distributions above (server/index.js), scoped by spv_id/spv_investor_id
   instead of fund_id/lp_id (see docs/TZ_VC_Module.md §2.3 for why these
   are separate mirrored tables rather than a nullable spv_id column on
   the real capital_calls/distributions tables). */

function rowToSpvCC(r) {
  return {
    id: r.id, spvId: r.spv_id, ccNumber: r.cc_number, noticeDate: r.notice_date, paymentDate: r.payment_date,
    totalAmount: r.total_amount, pctOfCommit: r.pct_of_commit, purpose: r.purpose, purposeType: r.purpose_type,
    status: r.status, bankRef: r.bank_ref, createdBy: r.created_by, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function rowToSpvCcLineItem(r) {
  return {
    id: r.id, callId: r.call_id, spvInvestorId: r.spv_investor_id, investorName: r.investor_name,
    commitment: r.commitment, pct: r.pct, called: r.called, paid: r.paid, paymentDate: r.payment_date,
    status: r.status, wireRef: r.wire_ref, wireConfirmUrl: r.wire_confirm_url,
    amlOk: r.aml_ok === null ? null : !!r.aml_ok,
  };
}
const spvCcLineItemsStmt = db.prepare(`
  SELECT li.*, inv.name AS investor_name
  FROM spv_capital_call_line_items li JOIN spv_investors inv ON inv.id = li.spv_investor_id
  WHERE li.tenant_id = ? AND li.call_id = ? ORDER BY li.id
`);

app.get('/api/spvs/:id/capital-calls', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const calls = db.prepare('SELECT * FROM spv_capital_calls WHERE tenant_id = ? AND spv_id = ? ORDER BY id').all(req.tenantId, spv.id).map(r => {
    const cc = rowToSpvCC(r);
    cc.lineItems = spvCcLineItemsStmt.all(req.tenantId, r.id).map(rowToSpvCcLineItem);
    return cc;
  });
  res.json({ capitalCalls: calls });
});

app.post('/api/spvs/:id/capital-calls', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const b = req.body || {};
  if (!b.purpose) return res.status(400).json({ error: 'purpose is required' });
  const totalAmount = b.totalAmount || 0;

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM spv_capital_calls WHERE tenant_id = ? AND spv_id = ?').get(req.tenantId, spv.id);
  const ccNumber = b.ccNumber || `SPV-CC-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;

  let lineItems = b.lineItems;
  if (!lineItems) {
    const investors = db.prepare("SELECT * FROM spv_investors WHERE tenant_id = ? AND spv_id = ? AND status = 'Active'").all(req.tenantId, spv.id);
    const totalCommit = investors.reduce((s, i) => s + (i.commitment || 0), 0);
    lineItems = investors.map(i => {
      const pct = totalCommit ? (i.commitment / totalCommit) * 100 : 0;
      return {
        spvInvestorId: i.id, commitment: i.commitment, pct,
        called: totalCommit ? (i.commitment / totalCommit) * totalAmount : 0,
        paid: 0, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '', amlOk: null,
      };
    });
  }
  const pctOfCommit = b.pctOfCommit != null ? b.pctOfCommit : (lineItems[0] ? lineItems[0].pct : 0);

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO spv_capital_calls
        (tenant_id, spv_id, cc_number, notice_date, payment_date, total_amount, pct_of_commit, purpose, purpose_type, status, bank_ref, created_by, notes)
      VALUES
        (@tenantId, @spvId, @ccNumber, @noticeDate, @paymentDate, @totalAmount, @pctOfCommit, @purpose, @purposeType, @status, @bankRef, @createdBy, @notes)
    `).run(at({
      tenantId: req.tenantId, spvId: spv.id, ccNumber, noticeDate: b.noticeDate || null, paymentDate: b.paymentDate || null,
      totalAmount, pctOfCommit, purpose: b.purpose, purposeType: b.purposeType || 'Investment',
      status: 'Draft', bankRef: b.bankRef || '', createdBy: b.createdBy || req.user.email, notes: b.notes || '',
    }));
    const callId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO spv_capital_call_line_items
        (tenant_id, call_id, spv_investor_id, commitment, pct, called, paid, payment_date, status, wire_ref, aml_ok)
      VALUES
        (@tenantId, @callId, @spvInvestorId, @commitment, @pct, @called, @paid, @paymentDate, @status, @wireRef, @amlOk)
    `);
    for (const li of lineItems) {
      insertItem.run(at({
        tenantId: req.tenantId, callId, spvInvestorId: li.spvInvestorId,
        commitment: li.commitment || 0, pct: li.pct || 0, called: li.called || 0, paid: li.paid || 0,
        paymentDate: li.paymentDate || null, status: li.status || 'Pending', wireRef: li.wireRef || '',
        amlOk: li.amlOk === null || li.amlOk === undefined ? null : (li.amlOk ? 1 : 0),
      }));
    }
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ?').get(callId);
    const cc = rowToSpvCC(row);
    cc.lineItems = spvCcLineItemsStmt.all(req.tenantId, callId).map(rowToSpvCcLineItem);
    res.status(201).json(cc);
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/spv-capital-calls/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV capital call not found in this tenant' });
  const b = req.body || {};
  const merged = { ...rowToSpvCC(existing), ...b };
  db.prepare(`
    UPDATE spv_capital_calls SET
      cc_number=@ccNumber, notice_date=@noticeDate, payment_date=@paymentDate, total_amount=@totalAmount,
      pct_of_commit=@pctOfCommit, purpose=@purpose, purpose_type=@purposeType, status=@status,
      bank_ref=@bankRef, notes=@notes, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, ccNumber: merged.ccNumber, noticeDate: merged.noticeDate,
    paymentDate: merged.paymentDate, totalAmount: merged.totalAmount, pctOfCommit: merged.pctOfCommit,
    purpose: merged.purpose, purposeType: merged.purposeType, status: merged.status,
    bankRef: merged.bankRef, notes: merged.notes,
  }));
  const row = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ?').get(existing.id);
  const cc = rowToSpvCC(row);
  cc.lineItems = spvCcLineItemsStmt.all(req.tenantId, existing.id).map(rowToSpvCcLineItem);
  res.json(cc);
});

app.delete('/api/spv-capital-calls/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV capital call not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot delete: call is ${existing.status}, not Draft.` });
  }
  const paidItems = db.prepare('SELECT id FROM spv_capital_call_line_items WHERE tenant_id = ? AND call_id = ? AND paid > 0').all(req.tenantId, existing.id);
  if (paidItems.length) {
    return res.status(409).json({ error: `Cannot delete: ${paidItems.length} line item(s) already have payments recorded.` });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM spv_capital_call_line_items WHERE tenant_id = ? AND call_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM spv_capital_calls WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true, deleted: true });
});

// Record a payment against one investor's line item — same evidence-
// required (wireRef + wireConfirmUrl) CFO/CEO gate as
// PUT /api/capital-calls/:id/line-items/:lpId above.
app.put('/api/spv-capital-calls/:id/line-items/:investorId', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const call = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!call) return res.status(404).json({ error: 'SPV capital call not found in this tenant' });
  const item = db.prepare('SELECT * FROM spv_capital_call_line_items WHERE call_id = ? AND spv_investor_id = ? AND tenant_id = ?')
    .get(call.id, req.params.investorId, req.tenantId);
  if (!item) return res.status(404).json({ error: 'Line item not found' });
  if (call.status === 'Draft') {
    return res.status(409).json({ error: 'This SPV capital call is still a draft — approve it before recording payments' });
  }
  const b = req.body || {};
  const confirmingPayment = b.status === 'Paid' && item.status !== 'Paid';
  if (confirmingPayment) {
    if (!req.user.permissions.paymentConfirm) {
      return res.status(403).json({ error: 'Forbidden: only CFO/CEO may confirm an SPV capital call payment' });
    }
    if (!b.wireRef || !b.wireRef.trim()) return res.status(400).json({ error: 'wireRef is required to confirm payment' });
    if (!b.wireConfirmUrl || !b.wireConfirmUrl.trim()) return res.status(400).json({ error: 'wireConfirmUrl is required to confirm payment' });
  }
  // Same reversal gate as the fund-level route above (QA audit finding) —
  // reversing an already-confirmed payment needs the same trust level as
  // confirming one, plus a recorded reason.
  const reversingPayment = item.status === 'Paid' && b.status !== undefined && b.status !== 'Paid';
  if (reversingPayment) {
    if (!req.user.permissions.paymentConfirm) {
      return res.status(403).json({ error: 'Forbidden: only CFO/CEO may reverse a confirmed SPV capital call payment' });
    }
    if (!b.reason || !b.reason.trim()) {
      return res.status(400).json({ error: 'reason is required to reverse a confirmed payment' });
    }
  }
  db.prepare(`
    UPDATE spv_capital_call_line_items SET
      paid=@paid, payment_date=@paymentDate, status=@status, wire_ref=@wireRef, wire_confirm_url=@wireConfirmUrl, aml_ok=@amlOk
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: item.id, tenantId: req.tenantId,
    paid: b.paid != null ? b.paid : item.paid, paymentDate: b.paymentDate || item.payment_date,
    status: b.status || item.status, wireRef: b.wireRef != null ? b.wireRef : item.wire_ref,
    wireConfirmUrl: b.wireConfirmUrl != null ? b.wireConfirmUrl : item.wire_confirm_url,
    amlOk: b.amlOk != null ? (b.amlOk ? 1 : 0) : item.aml_ok,
  }));
  const row = db.prepare('SELECT * FROM spv_capital_calls WHERE id = ?').get(call.id);
  const cc = rowToSpvCC(row);
  cc.lineItems = spvCcLineItemsStmt.all(req.tenantId, call.id).map(rowToSpvCcLineItem);
  res.json(cc);
});

function rowToSpvDist(r) {
  return {
    id: r.id, spvId: r.spv_id, distNumber: r.dist_number, noticeDate: r.notice_date, paymentDate: r.payment_date,
    totalAmount: r.total_amount, sourceType: r.source_type, rocAmount: r.roc_amount, profitAmount: r.profit_amount,
    status: r.status, createdBy: r.created_by, notes: r.notes,
  };
}
function rowToSpvDistLineItem(r) {
  return {
    id: r.id, distributionId: r.distribution_id, spvInvestorId: r.spv_investor_id, investorName: r.investor_name,
    pct: r.pct, grossAmount: r.gross_amount, gpCarryAmount: r.gp_carry_amount, netAmount: r.net_amount,
    paymentDate: r.payment_date, status: r.status, wireRef: r.wire_ref, wireConfirmUrl: r.wire_confirm_url,
  };
}
const spvDistLineItemsStmt = db.prepare(`
  SELECT li.*, inv.name AS investor_name
  FROM spv_distribution_line_items li JOIN spv_investors inv ON inv.id = li.spv_investor_id
  WHERE li.tenant_id = ? AND li.distribution_id = ? ORDER BY li.id
`);

app.get('/api/spvs/:id/distributions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const dists = db.prepare('SELECT * FROM spv_distributions WHERE tenant_id = ? AND spv_id = ? ORDER BY id').all(req.tenantId, spv.id).map(r => {
    const d = rowToSpvDist(r);
    d.lineItems = spvDistLineItemsStmt.all(req.tenantId, r.id).map(rowToSpvDistLineItem);
    return d;
  });
  res.json({ distributions: dists });
});

// Profit split reuses waterfallEngine.js's computeDistributionSplit —
// same tiers as the fund-level Distributions route above, parameterized
// by the SPV's OWN preferred_return_pct/carried_interest_pct/catch_up_pct
// (never the parent fund's — see docs/TZ_VC_Module.md §3 and the
// spv-metrics.test.js requirement that these never get confused).
app.post('/api/spvs/:id/distributions', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });
  const b = req.body || {};
  const rocAmount = b.rocAmount || 0;
  const profitAmount = b.profitAmount || 0;
  const totalAmount = b.totalAmount != null ? b.totalAmount : (rocAmount + profitAmount);
  if (totalAmount <= 0) return res.status(400).json({ error: 'totalAmount (or rocAmount/profitAmount) must be greater than 0' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM spv_distributions WHERE tenant_id = ? AND spv_id = ?').get(req.tenantId, spv.id);
  const distNumber = b.distNumber || `SPV-DIST-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(2, '0')}`;

  let lineItems = b.lineItems;
  if (!lineItems) {
    const investors = db.prepare("SELECT * FROM spv_investors WHERE tenant_id = ? AND spv_id = ? AND status = 'Active'").all(req.tenantId, spv.id);
    if (profitAmount <= 0) {
      const totalCommit = investors.reduce((s, i) => s + (i.commitment || 0), 0);
      lineItems = investors.map(i => {
        const pct = totalCommit ? (i.commitment / totalCommit) * 100 : 0;
        const gross = totalCommit ? (i.commitment / totalCommit) * rocAmount : 0;
        return { spvInvestorId: i.id, pct, grossAmount: gross, gpCarryAmount: 0, netAmount: gross, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '' };
      });
    } else {
      const contributions = db.prepare(`
        SELECT li.paid AS amount, li.payment_date AS date
        FROM spv_capital_call_line_items li JOIN spv_capital_calls cc ON cc.id = li.call_id
        WHERE li.tenant_id = ? AND cc.spv_id = ? AND cc.status != 'Draft' AND li.paid > 0 AND li.payment_date IS NOT NULL
      `).all(req.tenantId, spv.id);
      const priorDistRows = db.prepare(`
        SELECT status, profit_amount AS profitAmount, roc_amount AS rocAmount, COALESCE(payment_date, notice_date) AS date,
               preferred_return_snapshot AS preferredReturn, carried_interest_snapshot AS carriedInterest,
               catch_up_pct_snapshot AS catchUpPct
        FROM spv_distributions WHERE tenant_id = ? AND spv_id = ?
      `).all(req.tenantId, spv.id);
      const ledgerEvents = [
        ...contributions.map(c => ({ date: c.date, delta: c.amount })),
        ...priorDistRows.filter(d => d.status !== 'Draft' && d.date).map(d => ({ date: d.date, delta: -(d.rocAmount || 0) })),
      ];
      const { lineItems: split } = computeDistributionSplit({
        fund: { preferredReturn: spv.preferred_return_pct, carriedInterest: spv.carried_interest_pct, catchUpPct: spv.catch_up_pct },
        activeLps: investors.map(i => ({ id: i.id, commitment: i.commitment })),
        ledgerEvents, priorDistributions: priorDistRows,
        rocAmount, profitAmount, distDate: b.paymentDate || b.noticeDate || new Date().toISOString().slice(0, 10),
      });
      lineItems = split.map(li => ({ spvInvestorId: li.lpId, pct: li.pct, grossAmount: li.grossAmount, gpCarryAmount: li.gpCarryAmount, netAmount: li.netAmount, paymentDate: b.paymentDate || null, status: 'Pending', wireRef: '' }));
    }
  }

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO spv_distributions (tenant_id, spv_id, dist_number, notice_date, payment_date, total_amount, source_type, roc_amount, profit_amount, status, created_by, notes,
        preferred_return_snapshot, carried_interest_snapshot, catch_up_pct_snapshot)
      VALUES (@tenantId, @spvId, @distNumber, @noticeDate, @paymentDate, @totalAmount, @sourceType, @rocAmount, @profitAmount, @status, @createdBy, @notes,
        @preferredReturnSnapshot, @carriedInterestSnapshot, @catchUpPctSnapshot)
    `).run(at({
      tenantId: req.tenantId, spvId: spv.id, distNumber, noticeDate: b.noticeDate || null, paymentDate: b.paymentDate || null,
      totalAmount, sourceType: b.sourceType || null, rocAmount, profitAmount, status: 'Draft',
      createdBy: b.createdBy || req.user.email, notes: b.notes || '',
      // Snapshot the SPV's own carry terms at creation time — same
      // retroactivity fix as fund-level distributions above (QA Data
      // Integrity audit finding), applied here since this SPV route
      // reuses the exact same replayWaterfallState() engine.
      preferredReturnSnapshot: spv.preferred_return_pct, carriedInterestSnapshot: spv.carried_interest_pct, catchUpPctSnapshot: spv.catch_up_pct,
    }));
    const distId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO spv_distribution_line_items (tenant_id, distribution_id, spv_investor_id, pct, gross_amount, gp_carry_amount, net_amount, payment_date, status, wire_ref)
      VALUES (@tenantId, @distributionId, @spvInvestorId, @pct, @grossAmount, @gpCarryAmount, @netAmount, @paymentDate, @status, @wireRef)
    `);
    for (const li of lineItems) {
      insertItem.run(at({
        tenantId: req.tenantId, distributionId: distId, spvInvestorId: li.spvInvestorId,
        pct: li.pct || 0, grossAmount: li.grossAmount || 0, gpCarryAmount: li.gpCarryAmount || 0, netAmount: li.netAmount || 0,
        paymentDate: li.paymentDate || null, status: li.status || 'Pending', wireRef: li.wireRef || '',
      }));
    }
    db.exec('COMMIT');
    const row = db.prepare('SELECT * FROM spv_distributions WHERE id = ?').get(distId);
    const d = rowToSpvDist(row);
    d.lineItems = spvDistLineItemsStmt.all(req.tenantId, distId).map(rowToSpvDistLineItem);
    res.status(201).json(d);
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[spv-distributions] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create distribution — please try again' });
  }
});

app.put('/api/spv-distributions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_distributions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV distribution not found in this tenant' });
  const b = req.body || {};
  const merged = { ...rowToSpvDist(existing), ...b };
  db.prepare(`
    UPDATE spv_distributions SET
      dist_number=@distNumber, notice_date=@noticeDate, payment_date=@paymentDate, total_amount=@totalAmount,
      source_type=@sourceType, roc_amount=@rocAmount, profit_amount=@profitAmount, status=@status, notes=@notes,
      updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: existing.id, tenantId: req.tenantId, distNumber: merged.distNumber, noticeDate: merged.noticeDate,
    paymentDate: merged.paymentDate, totalAmount: merged.totalAmount, sourceType: merged.sourceType,
    rocAmount: merged.rocAmount, profitAmount: merged.profitAmount, status: merged.status, notes: merged.notes,
  }));
  const row = db.prepare('SELECT * FROM spv_distributions WHERE id = ?').get(existing.id);
  const d = rowToSpvDist(row);
  d.lineItems = spvDistLineItemsStmt.all(req.tenantId, existing.id).map(rowToSpvDistLineItem);
  res.json(d);
});

app.delete('/api/spv-distributions/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM spv_distributions WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'SPV distribution not found in this tenant' });
  if (existing.status !== 'Draft') {
    return res.status(409).json({ error: `Cannot delete: distribution is ${existing.status}, not Draft.` });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM spv_distribution_line_items WHERE tenant_id = ? AND distribution_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM spv_distributions WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true, deleted: true });
});

// IRR/DPI/RVPI/TVPI reusing metricsEngine.js's generic computeMetrics —
// same function the fund-level /api/funds/:id/metrics route uses, just
// fed the SPV's own ledger instead of a fund's. residualValue is
// necessarily an approximation (an SPV has no NAV of its own): the
// linked portfolio company's current value, prorated by the SPV's share
// of that company's total invested capital — reuses the same
// portfolio.value proxy computeFundMetrics already relies on for the
// same purpose (see metricsEngine.js's file header).
app.get('/api/spvs/:id/metrics', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const spv = db.prepare('SELECT * FROM spvs WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!spv) return res.status(404).json({ error: 'SPV not found in this tenant' });

  const paidInEvents = db.prepare(`
    SELECT li.paid AS amount, li.payment_date AS date
    FROM spv_capital_call_line_items li JOIN spv_capital_calls cc ON cc.id = li.call_id
    WHERE li.tenant_id = ? AND cc.spv_id = ? AND cc.status != 'Draft' AND li.paid > 0
  `).all(req.tenantId, spv.id);
  const distributedEvents = db.prepare(`
    SELECT dli.net_amount AS amount, COALESCE(dli.payment_date, d.payment_date, d.notice_date) AS date
    FROM spv_distribution_line_items dli JOIN spv_distributions d ON d.id = dli.distribution_id
    WHERE dli.tenant_id = ? AND d.spv_id = ? AND d.status != 'Draft' AND dli.net_amount > 0
  `).all(req.tenantId, spv.id);

  let residualValue = 0;
  if (spv.portfolio_id) {
    const portfolio = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(spv.portfolio_id, req.tenantId);
    if (portfolio && portfolio.invested > 0) {
      const spvInvested = paidInEvents.reduce((s, e) => s + e.amount, 0);
      residualValue = portfolio.value * (spvInvested / portfolio.invested);
    }
  }

  res.json(computeMetrics({ paidInEvents, distributedEvents, residualValue, asOfDate: new Date().toISOString().slice(0, 10) }));
});

/* ===== AFSA Regulatory Reports — tenant-scoped =====
   Replaces the old js/data.js `reportSchedule` static array (no backend
   at all, status could never really change). report_type is one of
   'Quarterly' | 'Annual' | 'AML/CTF' | 'Breach Notification' |
   'Annual Compliance' — the fixed set AFSA requires from a licensed
   fund. Marking a report as actually Отправлен (submitted) is gated
   behind afsaSubmit and requires a document link (the filed report
   itself), same evidence-required pattern as Capital Call payment
   confirmation. */
app.get('/api/afsa-reports', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM afsa_reports WHERE tenant_id = ? ORDER BY deadline').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, afsaReports: rows.map(rowToAfsaReport) });
});

app.post('/api/afsa-reports', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.reportType) return res.status(400).json({ error: 'reportType is required' });
  if (!b.period) return res.status(400).json({ error: 'period is required' });
  if (!b.deadline) return res.status(400).json({ error: 'deadline is required' });
  const params = afsaReportToParams({ ...b, status: 'Ожидается', submittedAt: null, submittedBy: null });
  const info = db.prepare(AFSA_REPORT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM afsa_reports WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToAfsaReport(row));
});

app.put('/api/afsa-reports/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM afsa_reports WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Regulatory report not found in this tenant' });
  const b = req.body || {};
  if (b.status === 'Отправлен' && existing.status !== 'Отправлен') {
    if (!req.user.permissions.afsaSubmit) {
      return res.status(403).json({ error: 'Forbidden: only CEO/CFO/Compliance Officer/MLRO may mark a regulatory report as submitted' });
    }
    if (!b.documentUrl || !b.documentUrl.trim()) {
      return res.status(400).json({ error: 'documentUrl (the filed report itself) is required to mark as submitted' });
    }
    b.submittedAt = new Date().toISOString().slice(0, 10);
    b.submittedBy = req.user.email;
  }
  const merged = Object.assign(rowToAfsaReport(existing), b);
  const params = afsaReportToParams(merged);
  db.prepare(AFSA_REPORT_UPDATE_SQL).run(at({ id: existing.id, tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM afsa_reports WHERE id = ?').get(existing.id);
  res.json(rowToAfsaReport(row));
});

/* ===== First Closing Checklist — tenant-scoped, one row per fund =====
   Used to be a single hardcoded js/data.js object with no backing store
   at all and no fund scoping (see server/db.js's first_closing comment).
   GET returns every fund's row (client finds its own by activeFundId,
   same convention as /api/deals); PUT upserts one fund's row, merging
   only the fields the caller sent (a fund with no row yet just gets one
   created on its first edit). */
app.get('/api/first-closing', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM first_closing WHERE tenant_id = ?').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, firstClosing: rows.map(rowToFirstClosing) });
});

app.put('/api/first-closing/:fundId', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const fundId = Number(req.params.fundId);
  const fund = db.prepare('SELECT id FROM funds WHERE id = ? AND tenant_id = ?').get(fundId, req.tenantId);
  if (!fund) return res.status(404).json({ error: 'Fund not found in this tenant' });

  const existing = db.prepare('SELECT * FROM first_closing WHERE tenant_id = ? AND fund_id = ?').get(req.tenantId, fundId);
  const b = req.body || {};
  const blank = { fundId, boardResolutionUrl: '', closingCertUrl: '', closingDate: '', firstCCId: null,
    afsaNotifDate: '', afsaNotifNum: '', afsaConfirmUrl: '', welcomeLetterLog: [] };
  const merged = Object.assign(existing ? rowToFirstClosing(existing) : blank, b);
  const params = firstClosingToParams(merged);

  if (existing) {
    db.prepare(FIRST_CLOSING_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  } else {
    db.prepare(FIRST_CLOSING_INSERT_SQL).run(at({ tenantId: req.tenantId, fundId, ...params }));
  }
  const row = db.prepare('SELECT * FROM first_closing WHERE tenant_id = ? AND fund_id = ?').get(req.tenantId, fundId);
  res.json(rowToFirstClosing(row));
});

// Server-side mirror of js/app.js's dealMoveStage() gates. The client
// checks stay for instant feedback, but relying on them alone means a
// raw PUT with a `stage` field skips every one of them — unlike
// ic/icDecision (blocked outright above/below), a legitimate stage
// change has to be allowed to land somewhere, so this validates against
// the trusted DB row (`existing`, snake_case columns) rather than
// blocking the field entirely. Kept in exact sync with dealMoveStage()
// by design — a gate added to one side without the other reopens
// exactly the bypass this closes.
function validateStageTransition(existing, newStage) {
  if (newStage === existing.stage) return null;
  const icApproved = existing.ic === 'Одобрено' || existing.ic_decision === 'Одобрено';
  const icRejected = existing.ic === 'Отклонено' || existing.ic_decision === 'Отклонено';

  if (newStage === 'Закрыта') {
    if (!icApproved) return 'Нельзя закрыть сделку без одобрения IC';
    const signedDocs = JSON.parse(existing.signed_docs_urls_json || '[]');
    if (!signedDocs.length) return 'Нельзя закрыть сделку без подписанных документов (SHA/SPA)';
  }
  if (newStage === 'IC Review' && existing.gp_conclusion_verdict !== 'Рекомендовано к IC') {
    return 'Сначала подпишите заключение УК со статусом "Рекомендовано к IC"';
  }
  if ((newStage === 'Term Sheet' || newStage === 'Переговоры') && !icApproved) {
    return `Нельзя перейти к «${newStage}» без одобрения IC`;
  }
  if (newStage === 'Переговоры' && existing.ts_status !== 'Подписан') {
    return 'Term Sheet ещё не подписан';
  }
  if (newStage === 'Отклонена' && ['IC Review', 'Term Sheet', 'Переговоры'].includes(existing.stage)) {
    return 'Сделка уже на рассмотрении IC — отклонить можно только через решение комитета («Отклонена IC»)';
  }
  if (newStage === 'Отклонена IC' && !icRejected) {
    return 'Нельзя пометить как «Отклонена IC» без решения комитета';
  }
  return null;
}

/* ===== Deals (Deal Pipeline) API — tenant-scoped ===== */
app.get('/api/deals', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM deals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, deals: rows.map(rowToDeal) });
});

app.post('/api/deals', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  const now = new Date().toISOString().slice(0, 10);
  // stage/ic are forced, not defaulted — they used to sit after ...b (a
  // default a caller could simply override), which combined with the
  // New Deal form's now-removed deal_stage/deal_ic selects to let anyone
  // creating a deal back-date it straight to Закрыта/Одобрено with zero
  // DD, zero signed GP conclusion, zero real IC vote. A brand new deal
  // has no history to have earned anything but Скрининг/Не подано.
  const params = dealToParams({
    ...b, stage: 'Скрининг', ic: 'Не подано', icDecision: 'Не подано', updatedAt: now,
  });
  const info = db.prepare(DEAL_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'deals', entityId: row.id, action: 'created', actorEmail: req.user.email, summary: `Сделка «${row.company}» создана` });
  res.status(201).json(rowToDeal(row));
});

app.put('/api/deals/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Deal not found in this tenant' });
  const b = req.body || {};
  // Signing the Management Company's own conclusion is a formal act, not a
  // field edit — only whoever is trusted to author/finalize an IC memo
  // (authorICMemo) may set it, same trust level as POST /api/ic-memos.
  const touchesGpConclusion = ['gpConclusionVerdict', 'gpConclusionSummary', 'gpConclusionSignedBy', 'gpConclusionSignedAt']
    .some(f => Object.prototype.hasOwnProperty.call(b, f));
  if (touchesGpConclusion && !req.user.permissions.authorICMemo) {
    return res.status(403).json({ error: 'Forbidden: only an IC memo author may sign the GP conclusion' });
  }
  // ic/icDecision assert an actual Investment Committee decision — the
  // only legitimate writer is the server-derived sync inside
  // PUT /api/ic-memos/:id (a resolved vote), which writes the deals
  // table directly rather than going through this route. There is no
  // longer any legitimate caller of this route that sets either field
  // (the New Deal form's ic dropdown that used to justify it is gone
  // too), so block it outright rather than gating it behind a
  // permission that would just move the bypass to whoever holds it.
  const touchesIcDecision = ['ic', 'icDecision'].some(f => Object.prototype.hasOwnProperty.call(b, f));
  if (touchesIcDecision) {
    return res.status(403).json({ error: 'Forbidden: ic/icDecision can only be set by a resolved IC vote' });
  }
  if (Object.prototype.hasOwnProperty.call(b, 'stage')) {
    const stageError = validateStageTransition(existing, b.stage);
    if (stageError) return res.status(409).json({ error: stageError });
  }
  const merged = Object.assign(rowToDeal(existing), b);
  const params = dealToParams(merged);
  db.prepare(DEAL_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  const stageChanged = Object.prototype.hasOwnProperty.call(b, 'stage') && b.stage !== existing.stage;
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'deals', entityId: row.id,
    action: stageChanged ? 'stage_changed' : 'updated', actorEmail: req.user.email,
    summary: stageChanged ? `Сделка «${row.company}»: стадия ${existing.stage} → ${row.stage}` : `Сделка «${row.company}» изменена`,
  });
  res.json(rowToDeal(row));
});

// Hybrid delete (same shape as DELETE /api/users/:id): hard-delete only if
// no IC memo was ever created for this deal — once the Investment
// Committee has a formal record tied to it, the deal itself must survive
// as governance history. Caller is told to move it to the Отклонена stage
// instead (validateStageTransition/dealMoveStage already support that).
app.delete('/api/deals/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Deal not found in this tenant' });
  const memos = db.prepare('SELECT id FROM ic_memos WHERE tenant_id = ? AND deal_id = ?').all(req.tenantId, existing.id);
  if (memos.length) {
    return res.status(409).json({
      error: `Cannot delete: deal has ${memos.length} IC memo(s). Move it to the "Отклонена" stage instead.`,
      footprint: [{ table: 'ic_memos', column: 'deal_id', count: memos.length }],
    });
  }
  db.prepare('DELETE FROM deals WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'deals', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `Сделка «${existing.company}» удалена` });
  res.json({ ok: true, deleted: true });
});

/* ===== Portfolio API — tenant-scoped ===== */
app.get('/api/portfolio', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM portfolio WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, portfolio: rows.map(rowToPortfolio) });
});

app.post('/api/portfolio', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const params = portfolioToParams({ status: 'Active', ...b });
  const info = db.prepare(PORTFOLIO_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'portfolio', entityId: row.id, action: 'created', actorEmail: req.user.email, summary: `Портфельная компания «${row.name}» добавлена` });
  res.status(201).json(rowToPortfolio(row));
});

app.put('/api/portfolio/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const existingCo = rowToPortfolio(existing);
  const b = req.body || {};
  // Snapshot pre-merge state — Object.assign below mutates existingCo in
  // place, so the "did archived actually change" check has to use this,
  // not existingCo, or it'd compare the new value against itself (same
  // bug class fixed for documents' archived_by/archived_at earlier).
  const wasArchived = existingCo.archived;
  const merged = Object.assign(existingCo, b);
  // archived_by/archived_at are stamped from the authenticated user on
  // every real transition, not trusted from the client — same reasoning
  // as PUT /api/documents/:id above.
  if (b.archived !== undefined && !!b.archived !== !!wasArchived) {
    if (b.archived) {
      merged.archivedAt = new Date().toISOString().slice(0, 10);
      merged.archivedBy = req.user.name || req.user.email;
    } else {
      merged.archivedAt = null;
      merged.archivedBy = null;
    }
  }
  const params = portfolioToParams(merged);
  db.prepare(PORTFOLIO_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  const archivedNow = b.archived !== undefined && !!b.archived !== !!wasArchived;
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'portfolio', entityId: row.id,
    action: archivedNow ? (b.archived ? 'archived' : 'restored') : 'updated', actorEmail: req.user.email,
    summary: archivedNow ? `Портфельная компания «${row.name}» ${b.archived ? 'архивирована' : 'восстановлена из архива'}` : `Портфельная компания «${row.name}» изменена`,
  });
  res.json(rowToPortfolio(row));
});

// Hybrid delete (same shape as DELETE /api/users/:id): hard-delete only if
// the company has zero real footprint — no onboarding client links to it,
// and no capital has actually been invested/marked. Anything with real
// financial or onboarding activity must be archived instead (PUT above),
// which preserves the record for AFSA retention.
app.delete('/api/portfolio/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const linkedClients = db.prepare('SELECT id FROM ob_clients WHERE tenant_id = ? AND internal_portfolio_id = ?').all(req.tenantId, existing.id);
  const footprint = [];
  if (linkedClients.length) footprint.push({ table: 'ob_clients', column: 'internal_portfolio_id', count: linkedClients.length });
  if (Number(existing.invested) > 0 || Number(existing.value) > 0) footprint.push({ table: 'portfolio', column: 'invested/value', count: 1 });
  if (footprint.length) {
    const summary = footprint.map(f => `${f.table}.${f.column} ×${f.count}`).join(', ');
    return res.status(409).json({ error: `Cannot delete: company has real activity (${summary}). Archive instead.`, footprint });
  }
  db.prepare('DELETE FROM portfolio WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'portfolio', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `Портфельная компания «${existing.name}» удалена` });
  res.json({ ok: true, deleted: true });
});

/* ===== Onboarding / KYC-AML API — tenant-scoped =====
   One combined GET (all 5 collections are small and always consumed
   together by the onboarding module) + focused write endpoints for the
   most common mutations. Business-logic side effects that the original
   client-side code performs on write (auto-generating the 7 obTasks for
   a new client, auto-registering an activated FM client as an LP, auto-
   checking the restricted list) are NOT replicated server-side in this
   pass — same scope decision as the other migrated modules: reads are
   fully API-backed, writes persist the given fields but don't fan out
   into other tables yet. */
app.get('/api/onboarding', requireAuth, requireInternal, (req, res) => {
  const coiRegistry = db.prepare('SELECT * FROM coi_registry WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToCoi);
  const allClients = db.prepare('SELECT * FROM ob_clients WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToObClient);
  const allTasks = db.prepare('SELECT * FROM ob_tasks WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToObTask);
  const allEngagements = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToEngagement);

  // Chinese Wall: any role without accessFM never sees FM-direction clients, or anything scoped to them.
  const obClients = filterClientsForPermissions(allClients, req.user.permissions);
  const visibleClientIds = new Set(obClients.map(c => c.id));
  const obTasks = allTasks.filter(t => visibleClientIds.has(t.clientId));
  const engagements = allEngagements.filter(e => !e.clientId || visibleClientIds.has(e.clientId));

  // Attach comments to each visible task — only for tasks that survived the
  // Chinese Wall filter above, so an FM task's comments never leak to a
  // non-accessFM caller either.
  const visibleTaskIds = new Set(obTasks.map(t => t.id));
  const commentsByTask = new Map();
  for (const row of db.prepare('SELECT * FROM ob_task_comments WHERE tenant_id = ? ORDER BY id').all(req.tenantId)) {
    const c = rowToObTaskComment(row);
    if (!visibleTaskIds.has(c.taskId)) continue;
    if (!commentsByTask.has(c.taskId)) commentsByTask.set(c.taskId, []);
    commentsByTask.get(c.taskId).push(c);
  }
  obTasks.forEach(t => { t.comments = commentsByTask.get(t.id) || []; });
  // Restricted List is FM-portfolio-company-only data with no CF&A client link — accessFM-less roles have no legitimate use for it.
  const restrictedList = !req.user.permissions.accessFM
    ? []
    : db.prepare('SELECT * FROM restricted_list WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToRestricted);

  res.json({ tenant: req.tenantSlug, restrictedList, coiRegistry, obClients, obTasks, engagements });
});

app.post('/api/ob-clients', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (chineseWallBlocks(req.user.permissions, b.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot create FM-direction clients' });
  const countRow = db.prepare('SELECT COUNT(*) AS c FROM ob_clients WHERE tenant_id = ?').get(req.tenantId);
  const clientId = b.clientId || `CL-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;
  const params = obClientToParams({ phase: 1, onboardingStatus: 'On Track', ...b, clientId });
  const info = db.prepare(OB_CLIENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToObClient(row));
});

app.put('/api/ob-clients/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Onboarding client not found in this tenant' });
  if (chineseWallBlocks(req.user.permissions, existing.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  const merged = Object.assign(rowToObClient(existing), req.body || {});
  if (chineseWallBlocks(req.user.permissions, merged.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  const params = obClientToParams(merged);
  db.prepare(OB_CLIENT_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToObClient(row));
});

// Only a never-activated client can be deleted — once activated, an LP
// register entry exists on its behalf (registerLPFromOnboarding,
// js/lp-register.js) and the onboarding record becomes governance history.
// Re-checked here server-side rather than trusted from the client-side
// !c.activated gate (js/onboarding.js). Cascades to its own owned rows
// (ob_tasks/ob_task_comments) — nothing else ever references an
// unactivated client, so this is always safe.
app.delete('/api/ob-clients/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Onboarding client not found in this tenant' });
  if (chineseWallBlocks(req.user.permissions, existing.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  if (existing.activated) {
    return res.status(409).json({ error: 'Cannot delete: client is already activated (has an LP register entry).' });
  }
  db.exec('BEGIN');
  try {
    const taskIds = db.prepare('SELECT id FROM ob_tasks WHERE tenant_id = ? AND client_id = ?').all(req.tenantId, existing.id).map(t => t.id);
    for (const taskId of taskIds) {
      db.prepare('DELETE FROM ob_task_comments WHERE tenant_id = ? AND task_id = ?').run(req.tenantId, taskId);
    }
    db.prepare('DELETE FROM ob_tasks WHERE tenant_id = ? AND client_id = ?').run(req.tenantId, existing.id);
    db.prepare('DELETE FROM ob_clients WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true, deleted: true });
});

// AI-assist Stage 3: fuzzy/alias flagging on top of the existing exact
// substring check (checkRestrictedList, js/onboarding.js) — a suggestion
// surfaced on the Conflict Pre-Check (1.1) form only. Never writes
// f_restrictedMatch or creates a COI itself; the human still answers
// "Да"/"Нет" and the existing checkRestrictedList()/COI-creation path is
// unchanged. Not a substitute for a licensed sanctions/PEP screening
// vendor — see the plan notes for this limitation.
const AI_SCREEN_SCHEMA = z.object({
  possibleMatch: z.boolean(),
  matchedEntries: z.array(z.string()),
  confidence: z.enum(['Низкая', 'Средняя', 'Высокая']),
  reasoning: z.string(),
});

app.post('/api/ob-clients/:id/ai-screen', requireAuth, requireInternal, requirePermission('aiAssist'), async (req, res) => {
  const client = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!client) return res.status(404).json({ error: 'Onboarding client not found in this tenant' });
  if (chineseWallBlocks(req.user.permissions, client.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }
  const restrictedRows = db.prepare('SELECT company, sector, fund, restriction_type FROM restricted_list WHERE tenant_id = ?').all(req.tenantId);
  const promptDigest = crypto.createHash('sha256').update(client.name).digest('hex').slice(0, 16);
  try {
    const { data, model } = await completeJson({
      system: 'You flag POSSIBLE fuzzy/alias name matches for a Compliance Officer — you never decide, you only flag for human review. Prefer a false positive over a missed match, but never claim possibleMatch=true without naming which restricted-list entry it resembles and why.',
      prompt: `Клиент для проверки: "${client.name}".\nRestricted List (JSON):\n${JSON.stringify(restrictedRows)}\n\nЕсть ли вероятное совпадение (включая транслитерацию, сокращения, дочерние компании)? Верни JSON: possibleMatch (bool), matchedEntries (список названий из списка, которые похожи), confidence, reasoning (на русском).`,
      schema: AI_SCREEN_SCHEMA,
    });
    logAiCall({ userEmail: req.user.email, entityType: 'ob_client_ai_screen', entityId: client.id, promptDigest, model, status: 'ok' });
    res.json(data);
  } catch (err) {
    logAiCall({ userEmail: req.user.email, entityType: 'ob_client_ai_screen', entityId: client.id, promptDigest, model: null, status: 'error: ' + err.message });
    res.status(502).json({ error: 'AI screening failed: ' + err.message });
  }
});

// The common day-to-day write: update a task's status/formData as the
// RM/CO works through the wizard.
app.put('/api/ob-tasks/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Onboarding task not found in this tenant' });
  const parentClient = db.prepare('SELECT direction FROM ob_clients WHERE id = ? AND tenant_id = ?').get(existing.client_id, req.tenantId);
  if (parentClient && chineseWallBlocks(req.user.permissions, parentClient.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }
  const merged = Object.assign(rowToObTask(existing), req.body || {});
  // Deliberately a literal role-code check, not a capability — this is a
  // narrow, single-purpose workflow-lock nothing else in the system checks,
  // not a general permission. A custom "RM-like" role won't inherit it.
  if (existing.status === 'completed' && merged.status !== 'completed' && req.user.role === 'RELATIONSHIP_MANAGER') {
    return res.status(403).json({ error: 'Forbidden: RM cannot reopen a completed onboarding task' });
  }
  // clientId/taskNum are immutable after creation — OB_TASK_UPDATE_SQL has
  // no @clientId/@taskNum placeholders, so both must be dropped before
  // binding (node:sqlite throws "Unknown named parameter" on any extra key
  // with no matching @ in the SQL text).
  const { clientId: _unusedClientId, taskNum: _unusedTaskNum, ...params } = obTaskToParams(merged);
  db.prepare(OB_TASK_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToObTask(row));
});

// AI-assist Stage 1: draft the DD Outcome (2.2) conclusion from whatever
// f_* fields the Compliance Officer has already filled in — the same
// "fill the form, human still reviews and submits" contract as
// draftGpConclusion() in js/app.js, just backed by a real model instead of
// fixed rules. Returns a suggestion only; never writes to the task itself
// (that still only happens via the existing PUT /api/ob-tasks/:id, driven
// by the human clicking submit in submitObTask()).
const DD_DRAFT_SCHEMA = z.object({
  riskJurisdiction: z.enum(['Low', 'Medium', 'High']),
  riskSanction: z.enum(['Low', 'Medium', 'High']),
  riskRep: z.enum(['Low', 'Medium', 'High']),
  riskBusiness: z.enum(['Low', 'Medium', 'High']),
  riskTotal: z.enum(['Low', 'Medium', 'High', 'Unacceptable']),
  conclusion: z.enum(['Одобрить — Approve', 'Отказать — Reject', 'Расширенная проверка (EDD)']),
  mlroNote: z.string(),
  rationale: z.string(),
});

app.post('/api/ob-tasks/:id/ai-draft', requireAuth, requireInternal, requirePermission('aiAssist'), async (req, res) => {
  const task = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!task) return res.status(404).json({ error: 'Onboarding task not found in this tenant' });
  if (task.form_key !== 'dd_outcome') return res.status(400).json({ error: 'AI draft is only available for the DD Outcome (2.2) task' });
  const client = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(task.client_id, req.tenantId);
  if (client && chineseWallBlocks(req.user.permissions, client.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }
  const fd = JSON.parse(task.form_data_json || '{}');
  const isFM = client && client.direction === 'FM';

  // Only the fields a human compliance officer has already screened —
  // never the client's full record, never raw documents (that's Stage 2).
  const facts = {
    clientType: client ? client.type : null,
    direction: client ? client.direction : null,
    identityVerified: fd.corpVerified || null,
    lpDocsVerified: fd.lpDocsVerified || null,
    uboVerified: fd.uboVerified || null,
    sanctionsHits: [0, 1, 2, 3].map(i => fd[`sanction_${i}`] || 'Не проверено'),
    sanctionsTotal: fd.sanctionTotal || null,
    pepClient: fd.pepClient || null,
    pepDirectors: fd.pepDirectors || null,
    sofVerified: isFM ? (fd.sofVerified || null) : undefined,
    sowVerified: isFM ? (fd.sowVerified || null) : undefined,
    bankRefOk: isFM ? (fd.bankRefOk || null) : undefined,
    adverseMedia: fd.adverseMedia || null,
    officerComments: fd.coComment || null,
  };

  const promptDigest = crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);
  try {
    const { data, model } = await completeJson({
      system: 'You are assisting a Compliance Officer at a fund manager by drafting (not deciding) a KYC/AML due-diligence conclusion in Russian, from fields the officer has already screened themselves. You never invent findings not present in the input — if a field is unscreened, treat it as unresolved and let that drive a more cautious, not more lenient, rating.',
      prompt: `Черновик заключения по due diligence на основе уже проверенных полей (JSON):\n${JSON.stringify(facts, null, 2)}\n\nВерни JSON строго по схеме: riskJurisdiction, riskSanction, riskRep, riskBusiness, riskTotal (Low/Medium/High, riskTotal может быть Unacceptable), conclusion (одно из трёх точных значений), mlroNote (краткое пояснение по рискам, 1-3 предложения, на русском), rationale (обоснование итогового решения, 1-3 предложения, на русском).`,
      schema: DD_DRAFT_SCHEMA,
    });
    logAiCall({ userEmail: req.user.email, entityType: 'ob_task_dd_draft', entityId: task.id, promptDigest, model, status: 'ok' });
    res.json(data);
  } catch (err) {
    logAiCall({ userEmail: req.user.email, entityType: 'ob_task_dd_draft', entityId: task.id, promptDigest, model: null, status: 'error: ' + err.message });
    res.status(502).json({ error: 'AI draft failed: ' + err.message });
  }
});

// AI-assist Stage 2: extract identity/SOF facts from an uploaded document
// (the DD Outcome form has no document upload fields of its own before
// this — js/onboarding.js's dd_outcome case adds one purely to feed this
// route). Reuses the exact same uploaded_files rows/disk storage as
// POST /api/uploads — no separate upload path. Returns a suggestion only;
// never sets any ob_clients/ob_tasks verification field itself.
const DD_EXTRACT_SCHEMA = z.object({
  documentType: z.string(),
  extractedName: z.string().nullable(),
  extractedIdNumber: z.string().nullable(),
  extractedAddress: z.string().nullable(),
  extractedDob: z.string().nullable(),
  statedSourceOfFunds: z.string().nullable(),
  nameMatchesClient: z.enum(['Да', 'Нет', 'Не удалось определить']),
  notes: z.string(),
});
const EXTRACTABLE_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif']);

app.post('/api/ob-tasks/:id/ai-extract', requireAuth, requireInternal, requirePermission('aiAssist'), async (req, res) => {
  const task = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!task) return res.status(404).json({ error: 'Onboarding task not found in this tenant' });
  if (task.form_key !== 'dd_outcome') return res.status(400).json({ error: 'AI extract is only available for the DD Outcome (2.2) task' });
  const client = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(task.client_id, req.tenantId);
  if (client && chineseWallBlocks(req.user.permissions, client.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }
  const uploadId = parseInt(req.body && req.body.uploadId, 10);
  if (!Number.isInteger(uploadId)) return res.status(400).json({ error: 'uploadId is required' });
  const file = db.prepare('SELECT * FROM uploaded_files WHERE id = ? AND tenant_id = ?').get(uploadId, req.tenantId);
  if (!file) return res.status(404).json({ error: 'Uploaded file not found in this tenant' });
  if (!EXTRACTABLE_MIME_TYPES.has(file.mime_type)) {
    return res.status(400).json({ error: 'AI extraction only supports PDF or image files' });
  }
  const filePath = path.join(UPLOADS_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });

  const promptDigest = crypto.createHash('sha256').update(String(file.id) + file.mime_type).digest('hex').slice(0, 16);
  const system = 'You are assisting a Compliance Officer by extracting facts visible on one onboarding document (ID, proof of address, bank reference, etc.) into structured fields. Extract only what the document actually shows — never infer, complete, or guess a missing value. Respond in Russian for free-text fields.';
  const clientHint = client ? `Ожидаемое имя клиента в системе: ${client.name}.` : '';

  try {
    let result;
    if (file.mime_type === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const parsed = await pdfParse(buf);
      result = await completeJson({
        system,
        prompt: `${clientHint}\nТекст документа (извлечён из PDF):\n${parsed.text.slice(0, 8000)}\n\nВерни JSON строго по схеме: documentType, extractedName, extractedIdNumber, extractedAddress, extractedDob, statedSourceOfFunds, nameMatchesClient (Да/Нет/Не удалось определить), notes.`,
        schema: DD_EXTRACT_SCHEMA,
      });
    } else {
      const base64 = fs.readFileSync(filePath).toString('base64');
      result = await completeJson({
        system,
        prompt: `${clientHint}\nИзображение документа приложено. Верни JSON строго по схеме: documentType, extractedName, extractedIdNumber, extractedAddress, extractedDob, statedSourceOfFunds, nameMatchesClient (Да/Нет/Не удалось определить), notes.`,
        schema: DD_EXTRACT_SCHEMA,
        images: [{ mimeType: file.mime_type, base64 }],
      });
    }
    logAiCall({ userEmail: req.user.email, entityType: 'ob_task_dd_extract', entityId: task.id, promptDigest, model: result.model, status: 'ok' });
    res.json(result.data);
  } catch (err) {
    logAiCall({ userEmail: req.user.email, entityType: 'ob_task_dd_extract', entityId: task.id, promptDigest, model: null, status: 'error: ' + err.message });
    res.status(502).json({ error: 'AI extraction failed: ' + err.message });
  }
});

// Bulk-creates the onboarding task checklist (7 tasks) for one client in a
// single transaction — mirrors POST /api/capital-calls' call+line-items
// pattern (create the parent's children atomically, one round trip).
app.post('/api/ob-tasks', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  const clientId = b.clientId;
  const tasks = b.tasks;
  if (!clientId || !Array.isArray(tasks) || !tasks.length) {
    return res.status(400).json({ error: 'clientId and a non-empty tasks[] are required' });
  }
  const client = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(clientId, req.tenantId);
  if (!client) return res.status(404).json({ error: 'Onboarding client not found in this tenant' });
  if (chineseWallBlocks(req.user.permissions, client.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }

  db.exec('BEGIN');
  try {
    const insert = db.prepare(OB_TASK_INSERT_SQL);
    const created = [];
    for (const t of tasks) {
      const params = obTaskToParams({ ...t, clientId });
      const info = insert.run(at({ tenantId: req.tenantId, ...params }));
      created.push(rowToObTask(db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId)));
    }
    db.exec('COMMIT');
    res.status(201).json({ obTasks: created });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ob-tasks/:id/comments', requireAuth, requireInternal, (req, res) => {
  const task = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!task) return res.status(404).json({ error: 'Onboarding task not found in this tenant' });
  const client = db.prepare('SELECT direction FROM ob_clients WHERE id = ? AND tenant_id = ?').get(task.client_id, req.tenantId);
  if (client && chineseWallBlocks(req.user.permissions, client.direction)) {
    return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction clients' });
  }
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  // Server-stamped, not client-trusted — same lesson as restricted_list.added_by.
  const info = db.prepare(OB_TASK_COMMENT_INSERT_SQL).run(at({
    tenantId: req.tenantId, taskId: task.id, author: req.user.name || req.user.email, text,
  }));
  const row = db.prepare('SELECT * FROM ob_task_comments WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToObTaskComment(row));
});

app.post('/api/restricted-list', requireAuth, requirePermission('decideConflicts'), requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  const params = restrictedToParams({ addedAt: new Date().toISOString().slice(0, 10), addedBy: req.user.name || req.user.email, ...b });
  const info = db.prepare(RESTRICTED_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM restricted_list WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToRestricted(row));
});

app.post('/api/coi-registry', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: 'description is required' });
  const params = coiToParams(b);
  const info = db.prepare(COI_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM coi_registry WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToCoi(row));
});

// invoiced/paid/feeAmount are all money — negative values here would only
// ever come from a malformed request (the frontend inputs are min="0"), not
// a legitimate business state, so reject them rather than storing garbage.
function engagementHasNegativeAmount(b) {
  return ['invoiced', 'paid', 'feeAmount', 'successFee', 'retainer'].some(f => b[f] != null && Number(b[f]) < 0);
}

app.post('/api/engagements', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.clientName) return res.status(400).json({ error: 'clientName is required' });
  if (engagementHasNegativeAmount(b)) return res.status(400).json({ error: 'amount fields cannot be negative' });
  if (chineseWallBlocks(req.user.permissions, b.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot create FM-direction engagements' });
  // currency has NOT NULL DEFAULT 'USD' at the schema level, but *ToParams()
  // binds an explicit NULL for any field the caller omits, which overrides
  // a column's SQL-level DEFAULT — same gotcha as funds.nav, same fix.
  const params = engagementToParams({ currency: 'USD', ...b });
  const info = db.prepare(ENGAGEMENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: row.id, action: 'created', actorEmail: req.user.email, summary: `Договор с «${row.client_name}» создан` });
  res.status(201).json(rowToEngagement(row));
});

// Lets an RM/CO update an existing engagement — e.g. flip status to
// Completed, or set deal_ref once a matter is tied to a specific deal —
// so a client can be tracked across all of its engagements over time.
app.put('/api/engagements/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Engagement not found in this tenant' });
  if (engagementHasNegativeAmount(req.body || {})) return res.status(400).json({ error: 'amount fields cannot be negative' });
  if (chineseWallBlocks(req.user.permissions, existing.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction engagements' });
  const merged = Object.assign(rowToEngagement(existing), req.body || {});
  if (chineseWallBlocks(req.user.permissions, merged.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction engagements' });
  const params = engagementToParams(merged);
  db.prepare(ENGAGEMENT_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  const statusChanged = Object.prototype.hasOwnProperty.call(req.body || {}, 'status') && row.status !== existing.status;
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'engagements', entityId: row.id,
    action: statusChanged ? 'status_changed' : 'updated', actorEmail: req.user.email,
    summary: statusChanged ? `Договор с «${row.client_name}»: статус ${existing.status} → ${row.status}` : `Договор с «${row.client_name}» изменён`,
  });
  res.json(rowToEngagement(row));
});

// Hybrid delete (same shape as DELETE /api/users/:id): hard-delete only if
// no conflict-approval record references this engagement and no money has
// actually moved on it. Anything with real activity must be set to status
// 'Terminated' instead (already an editable field on this entity).
app.delete('/api/engagements/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Engagement not found in this tenant' });
  if (chineseWallBlocks(req.user.permissions, existing.direction)) return res.status(403).json({ error: 'Forbidden: RM cannot access FM-direction engagements' });
  const linked = db.prepare('SELECT id FROM conflict_approvals WHERE tenant_id = ? AND engagement_id = ?').all(req.tenantId, existing.id);
  const footprint = [];
  if (linked.length) footprint.push({ table: 'conflict_approvals', column: 'engagement_id', count: linked.length });
  if (Number(existing.paid) > 0 || Number(existing.invoiced) > 0) footprint.push({ table: 'engagements', column: 'paid/invoiced', count: 1 });
  if (footprint.length) {
    const summary = footprint.map(f => `${f.table}.${f.column} ×${f.count}`).join(', ');
    return res.status(409).json({ error: `Cannot delete: engagement has real activity (${summary}). Set status to 'Terminated' instead.`, footprint });
  }
  db.prepare('DELETE FROM engagements WHERE id = ? AND tenant_id = ?').run(existing.id, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'engagements', entityId: existing.id, action: 'deleted', actorEmail: req.user.email, summary: `Договор с «${existing.client_name}» удалён` });
  res.json({ ok: true, deleted: true });
});

/* ===== Conflict Approvals API — tenant-scoped
   Digital Decision/Escalation Matrix audit trail (COI Addendum Section E /
   GL-ONB-CF&A-001 Section 4.7): one row per conflict decision, linkable to
   a client and/or a specific engagement via dealRef so Internal Client and
   Dual-Mandate approvals can be traced across a client's full contract
   history. ===== */
app.get('/api/conflict-approvals', requireAuth, requireInternal, (req, res) => {
  const rows = db.prepare('SELECT * FROM conflict_approvals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, conflictApprovals: rows.map(rowToConflictApproval) });
});

// High/Critical risk conflicts escalate automatically — 'Escalated' instead
// of 'Pending', routed to the CEO specifically rather than any of the three
// decideConflicts roles (CEO/Compliance Officer/MLRO). status/escalatedTo
// are always server-decided from riskLevel, never trusted from the client
// (same reasoning as Capital Call always starting at Draft).
const ESCALATING_RISK_LEVELS = new Set(['High', 'Critical']);

app.post('/api/conflict-approvals', requireAuth, requirePermission('decideConflicts'), (req, res) => {
  const b = req.body || {};
  if (!b.decisionType) return res.status(400).json({ error: 'decisionType is required' });
  const riskLevel = b.riskLevel || 'Low';
  const escalates = ESCALATING_RISK_LEVELS.has(riskLevel);
  const params = conflictApprovalToParams({
    ...b, riskLevel, currency: b.currency || 'USD',
    status: escalates ? 'Escalated' : 'Pending',
    escalatedTo: escalates ? 'CEO' : (b.escalatedTo || null),
  });
  const info = db.prepare(CONFLICT_APPROVAL_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  recordAudit(db, { tenantId: req.tenantId, entityType: 'conflict_approvals', entityId: row.id, action: 'created', actorEmail: req.user.email, summary: `Конфликт интересов «${row.decision_type}» зарегистрирован (риск: ${row.risk_level})` });
  res.status(201).json(rowToConflictApproval(row));
});

app.put('/api/conflict-approvals/:id', requireAuth, requirePermission('decideConflicts'), (req, res) => {
  const existing = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Conflict approval not found in this tenant' });
  const b = req.body || {};
  const DECIDED_STATUSES = new Set(['Approved', 'Approved with conditions', 'Rejected']);
  // An Escalated (High/Critical risk) conflict can only be resolved by the
  // CEO specifically — decideConflicts alone (which Compliance Officer and
  // MLRO also hold) isn't enough once it's escalated. Role-code match, same
  // pattern as the old deal_ic workflow steps' role === req.user.role check.
  if (existing.status === 'Escalated' && DECIDED_STATUSES.has(b.status) && req.user.role !== 'CEO') {
    return res.status(403).json({ error: 'Forbidden: this conflict is escalated — only the CEO may decide it' });
  }
  // decided_by is server-stamped from the authenticated user, not client-
  // trusted — decisionMaker is a free-text/role label the form author
  // picks when the record is created, not proof of who actually decided.
  if (DECIDED_STATUSES.has(b.status) && !DECIDED_STATUSES.has(existing.status)) {
    b.decidedBy = req.user.name || req.user.email;
    b.decidedAt = b.decidedAt || new Date().toISOString().slice(0, 10);
  }
  const merged = Object.assign(rowToConflictApproval(existing), b);
  const params = conflictApprovalToParams(merged);
  db.prepare(CONFLICT_APPROVAL_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  const decidedNow = DECIDED_STATUSES.has(row.status) && !DECIDED_STATUSES.has(existing.status);
  recordAudit(db, {
    tenantId: req.tenantId, entityType: 'conflict_approvals', entityId: row.id,
    action: decidedNow ? 'decided' : 'updated', actorEmail: req.user.email,
    summary: decidedNow ? `Конфликт интересов «${row.decision_type}» решён: ${row.status}` : `Конфликт интересов «${row.decision_type}» изменён`,
  });
  res.json(rowToConflictApproval(row));
});

/* ===== IC Memos API — tenant-scoped =====
   IC minutes are meant to be seen by the whole committee, including the two
   external seats (Independent Member, LP Rep) — so GET allows internal+FM
   roles AND external IC-seat holders, unlike the plain requireInternal gate
   used elsewhere. IC memos are deal/investment (FM-side) material, so an
   internal role also needs accessFM — an RM (accessFM=false) shouldn't see
   these any more than they should see the deal pipeline. Authoring a memo
   stays internal-GP-staff-only. */
app.get('/api/ic-memos', requireAuth, (req, res) => {
  const canView = (req.user.permissions.internal && req.user.permissions.accessFM) || req.user.permissions.icSeat;
  if (!canView) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const rows = db.prepare('SELECT * FROM ic_memos WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, icMemos: rows.map(rowToIcMemo) });
});

app.post('/api/ic-memos', requireAuth, requirePermission('authorICMemo'), requirePermission('accessFM'), (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  // A memo tied to a real deal may only be created once the Management
  // Company's own conclusion is signed off recommending it — enforced
  // here too (not just the js/modules.js UI gate) so it can't be
  // bypassed by calling this endpoint directly. Manual/standalone memos
  // (no dealId) skip this, same as the UI.
  if (b.dealId != null) {
    const linkedDeal = db.prepare('SELECT gp_conclusion_verdict FROM deals WHERE id = ? AND tenant_id = ?').get(b.dealId, req.tenantId);
    // A dealId that doesn't resolve in this tenant (typo, foreign id, a
    // deal that no longer exists) used to skip the check below entirely
    // instead of failing it — reject outright instead of silently
    // treating "no matching deal" as "no gate to enforce".
    if (!linkedDeal) {
      return res.status(400).json({ error: 'dealId does not reference a deal in this tenant' });
    }
    if (linkedDeal.gp_conclusion_verdict !== 'Рекомендовано к IC') {
      return res.status(409).json({ error: 'Заключение УК по сделке ещё не подписано со статусом "Рекомендовано к IC"' });
    }
  }
  const params = icMemoToParams({ status: 'pending', ...b });
  const info = db.prepare(IC_MEMO_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToIcMemo(row));
});

// Server-side mirror of js/modules.js's castICVote() auto-resolve logic —
// quorumMet/status/resolution must be DERIVED from the votes array, never
// trusted from the request body, or a single voter (including a low-trust
// external IC seat) could cast one legitimate vote and simultaneously
// declare the memo "approved" regardless of actual quorum/majority.
function deriveIcResolution(memo, votes) {
  const quorumMet = votes.filter(v => v.vote).length >= 3 && votes.some(v => v.role === 'Independent Member' && v.vote);
  const allVoted = votes.every(v => v.vote);
  const approveN = votes.filter(v => v.vote === 'approve').length;
  const rejectN = votes.filter(v => v.vote === 'reject').length;
  const deferN = votes.filter(v => v.vote === 'defer').length;
  // Majority alone must never resolve early — only once everyone has voted,
  // or once quorum (which requires the Independent Member's actual vote) is
  // met, does a decisive majority finalize the memo. Otherwise 3
  // non-Independent-Member votes could lock the memo
  // before that mandatory seat ever gets to vote. 'defer' (request
  // additional/external DD before deciding) only resolves via allVoted,
  // same as reject — no early-exit fast path for it either.
  if (!(allVoted || (quorumMet && approveN > votes.length / 2))) {
    return { quorumMet, status: 'pending', resolution: memo.resolution };
  }
  const quorumNote = quorumMet ? '' : ' Кворум не набран — решение носит предварительный характер.';
  let status, resolution;
  if (deferN > approveN && deferN > rejectN) {
    status = 'deferred';
    resolution = `Комитет запросил дополнительное due diligence перед повторным рассмотрением (${deferN}/${votes.length}).` + quorumNote;
  } else if (approveN >= rejectN) {
    status = 'approved';
    resolution = `Инвестиция одобрена большинством голосов (${approveN}/${votes.length}). Сумма: $${memo.amount}M.` + quorumNote;
  } else {
    status = 'rejected';
    resolution = `Инвестиция отклонена (${rejectN} против).` + quorumNote;
  }
  return { quorumMet, status, resolution };
}

// A single PUT covers three different mutations (vote casting, Risk
// Manager's veto/conclusion, general memo edits) — branch by which fields
// are present in the body rather than splitting into 3 routes, since every
// existing frontend call site already targets this one URL.
app.put('/api/ic-memos/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'IC memo not found in this tenant' });
  const b = req.body || {};
  const isVoteUpdate = Object.prototype.hasOwnProperty.call(b, 'votes');
  const isRiskUpdate = Object.prototype.hasOwnProperty.call(b, 'riskVeto') || Object.prototype.hasOwnProperty.call(b, 'riskConclusion');

  if (isRiskUpdate && !req.user.permissions.riskVeto) {
    return res.status(403).json({ error: 'Only Risk Manager can set risk veto/conclusion' });
  }
  // Same reasoning as the vote lock below: once the committee has
  // resolved the memo, the Risk Manager's conclusion is part of the
  // record that resolution was made against — changing it afterwards
  // would let the audit trail show a veto (or its absence) that the
  // actual vote never saw.
  if (isRiskUpdate && existing.status !== 'pending') {
    return res.status(409).json({ error: 'This memo is already resolved — the risk conclusion is final' });
  }
  if (isVoteUpdate) {
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'This memo is already resolved — votes are final' });
    }
    const existingVotes = JSON.parse(existing.votes_json || '[]');
    // Reject a resized array outright — the per-row diff below can't see
    // truncated trailing entries, and a shorter array would silently wipe
    // other members' votes on write.
    if (!Array.isArray(b.votes) || b.votes.length !== existingVotes.length) {
      return res.status(400).json({ error: 'votes array must match the existing vote roster' });
    }
    // A vote row may only change if the caller's own role currently holds
    // that seat (req.user.permissions.icSeat — server/rolesRepo.js).
    // Compare by field value, not JSON.stringify(v) === JSON.stringify(prev)
    // — that broke on any client that round-trips the JSON with different
    // key ordering (confirmed: PowerShell's ConvertTo-Json alone flipped
    // key order enough to make a legitimate, unmodified vote row register
    // as "changed" and get rejected).
    // role must never change via a vote update — it's the seat identity for
    // that row, not something the voter chose. Checked BEFORE the ownership
    // comparison, and the ownership check itself compares against the
    // trusted prev.role, not the caller-supplied v.role: authorizing off
    // v.role let any seat holder relabel a DIFFERENT (possibly unvoted)
    // row to their own role and inject a vote there, overwriting that
    // seat's real vote/identity and effectively casting a second vote.
    const illegalChange = b.votes.some((v, i) => {
      const prev = existingVotes[i] || {};
      if (v.role !== prev.role) return true;
      const unchanged = v.name === prev.name
        && v.vote === prev.vote && (v.comment || '') === (prev.comment || '');
      if (unchanged) return false;
      return req.user.permissions.icSeat !== prev.role;
    });
    if (illegalChange) return res.status(403).json({ error: 'You may only cast your own IC vote' });
  }
  // No UI reaches this branch today (the client only ever sends `votes`
  // or `riskVeto`/`riskConclusion` bodies) — but it's a real full-field
  // edit of an existing memo (status, amount, thesis, ...), so it should
  // require the same trust level as creating one (authorICMemo), not
  // just generic internal staff access.
  if (!isVoteUpdate && !isRiskUpdate && !req.user.permissions.authorICMemo) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Each mutation kind may only touch its own fields — merging the whole
  // request body here would let a vote-caster (including an external IC
  // seat with no other permission) smuggle arbitrary field overwrites
  // (status, resolution, amount, thesis...) through the vote-legality check.
  let merged = rowToIcMemo(existing);
  if (isVoteUpdate) {
    const derived = deriveIcResolution(merged, b.votes);
    merged = { ...merged, votes: b.votes, ...derived };

    // Sync the linked deal's IC-facing fields with the server's own
    // authority, as part of this same request — this can't be left to a
    // separate client-issued PUT /api/deals/:id the way it used to be:
    // an IC vote is very often cast by an external seat (Independent
    // Member, LP Rep — server/rolesSeed.js: internal:false, accessFM:
    // false) who could never legally call that endpoint themselves, and
    // a 'deferred' outcome also needs to clear gpConclusion* fields,
    // gated behind authorICMemo, which those seats don't have either.
    // Safe to apply directly because every value written below is
    // derived from the trusted vote tally above, never taken from the
    // request body.
    if (existing.status === 'pending' && derived.status !== 'pending' && merged.dealId != null) {
      const dealRow = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(merged.dealId, req.tenantId);
      if (dealRow) {
        const deal = rowToDeal(dealRow);
        if (derived.status === 'deferred') {
          // The prior GP conclusion recommended this deal based on DD the
          // committee just judged insufficient — it no longer stands.
          // Clear it and drop the deal back into Due Diligence so a fresh
          // sign-off (and a new memo) is required once the additional DD
          // is done.
          deal.ic = deal.icDecision = 'Доп. DD';
          deal.stage = 'Due Diligence';
          deal.gpConclusionVerdict = '';
          deal.gpConclusionSummary = '';
          deal.gpConclusionSignedBy = '';
          deal.gpConclusionSignedAt = '';
        } else {
          deal.ic = deal.icDecision = derived.status === 'approved' ? 'Одобрено' : 'Отклонено';
        }
        const dealParams = dealToParams(deal);
        db.prepare(DEAL_UPDATE_SQL).run(at({ ...dealParams, id: deal.id, tenantId: req.tenantId }));
      }
    }
  }
  if (isRiskUpdate) {
    merged = {
      ...merged,
      riskVeto: b.riskVeto !== undefined ? b.riskVeto : merged.riskVeto,
      riskConclusion: b.riskConclusion !== undefined ? b.riskConclusion : merged.riskConclusion,
    };
  }
  if (!isVoteUpdate && !isRiskUpdate) {
    // Only reached by requireInternal-equivalent callers (checked above) — a full edit.
    merged = { ...merged, ...b };
  }

  const params = icMemoToParams(merged);
  db.prepare(IC_MEMO_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToIcMemo(row));
});

/* ===== Documents API — tenant-scoped =====
   The merged docFiles/vault entity — see the comment on the `documents`
   table in db.js for why vault.js's other source (task attachments)
   isn't part of this migration. */
app.get('/api/documents', requireAuth, requireInternal, (req, res) => {
  const rows = db.prepare('SELECT * FROM documents WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const visible = filterDocumentsForPermissions(rows.map(rowToDocument), req.user.permissions);
  res.json({ tenant: req.tenantSlug, documents: visible });
});

app.post('/api/documents', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  if (blocksDocumentCategory(req.user.permissions, b.category)) return res.status(403).json({ error: 'Forbidden: CF&A staff cannot upload FM-category documents' });
  // Server-stamped, not client-trusted — same lesson as restricted_list.added_by.
  const uploader = req.user.name || req.user.email;
  const history = [{ action: 'uploaded', by: uploader, at: new Date().toISOString(), detail: b.name }];
  const params = documentToParams({ ...b, uploader, history });
  const info = db.prepare(DOCUMENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToDocument(row));
});

// No DELETE route — a regulated fund's document register doesn't support
// hard delete (see the archived/archived_at/archived_by/history_json
// comment on the `documents` table in db.js). PUT is the only mutation
// path; archiving/restoring is just a status flip through it, same as
// every other field, so no separate archive endpoint either.
app.put('/api/documents/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Document not found in this tenant' });
  const existingDoc = rowToDocument(existing);
  if (blocksDocumentCategory(req.user.permissions, existingDoc.category)) return res.status(403).json({ error: 'Forbidden: CF&A staff cannot access FM-category documents' });
  const b = req.body || {};
  const actor = req.user.name || req.user.email;
  const now = new Date().toISOString();
  // Snapshot pre-merge state — Object.assign below mutates existingDoc in
  // place, so every "what changed" comparison has to use these, not
  // existingDoc, or it'd be comparing the new value against itself.
  const wasArchived = existingDoc.archived;
  const prevCommentCount = existingDoc.comments.length;
  // History is built server-side only, from transitions the server itself
  // detects — never trusted as client-supplied entries, same reasoning as
  // archived_by/archived_at below. Comments stay separately authored
  // content (comment.author), but a new one still gets a history line too.
  const history = existingDoc.history.slice();
  const merged = Object.assign(existingDoc, b);
  if (blocksDocumentCategory(req.user.permissions, merged.category)) return res.status(403).json({ error: 'Forbidden: CF&A staff cannot access FM-category documents' });
  // archived_by/archived_at are stamped from the authenticated user on
  // every real transition, not trusted from the client — same reasoning
  // as uploader above and paymentConfirm/afsaSubmit elsewhere. A restore
  // (archived -> not archived) clears both; who/when it WAS archived
  // stays in history, which is append-only and never cleared.
  if (b.archived !== undefined && !!b.archived !== !!wasArchived) {
    if (b.archived) {
      merged.archivedAt = now.slice(0, 10);
      merged.archivedBy = actor;
      history.push({ action: 'archived', by: actor, at: now, detail: null });
    } else {
      merged.archivedAt = null;
      merged.archivedBy = null;
      history.push({ action: 'restored', by: actor, at: now, detail: null });
    }
  }
  if (Array.isArray(b.comments) && b.comments.length > prevCommentCount) {
    const added = b.comments.slice(prevCommentCount);
    for (const c of added) history.push({ action: 'commented', by: c.author || actor, at: now, detail: c.text });
  }
  merged.history = history;
  const params = documentToParams(merged);
  db.prepare(DOCUMENT_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToDocument(row));
});

/* ===== Workflow (approval chains) API — tenant-scoped, internal-staff only.
   No external IC seat has a role in any of these approval chains. */
app.get('/api/workflow', requireAuth, requireInternal, (req, res) => {
  const rows = db.prepare('SELECT * FROM workflow_instances WHERE tenant_id = ? ORDER BY id DESC').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, workflowInstances: rows.map(rowToWfInstance) });
});

// deal_ic is excluded here even though it's still a real key in
// WF_DEFINITIONS (see server/wfDefinitions.js — kept so the 5 historically
// seeded deal_ic rows still render correctly). No UI path creates new
// deal_ic instances; this blocks a direct API call from doing so either.
const CREATABLE_WF_TYPES = Object.keys(WF_DEFINITIONS).filter(t => t !== 'deal_ic');

app.post('/api/workflow', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.type || !CREATABLE_WF_TYPES.includes(b.type)) {
    return res.status(400).json({ error: 'type must be one of: ' + CREATABLE_WF_TYPES.join(', ') });
  }
  // Dedup: an active instance for the same type+entity already exists — hand it back instead of creating a duplicate.
  const existing = db.prepare(`
    SELECT * FROM workflow_instances WHERE tenant_id = ? AND type = ? AND entity_id = ? AND status = 'active'
  `).get(req.tenantId, b.type, b.entityId != null ? b.entityId : null);
  if (existing) return res.status(200).json(rowToWfInstance(existing));

  // steps are ALWAYS derived from the server-side template, never from the
  // request body — a caller must not be able to hand itself every step's
  // role by supplying its own steps array.
  const steps = freshSteps(b.type);
  const info = db.prepare(WF_INSERT_SQL).run(at({
    tenantId: req.tenantId,
    type: b.type,
    entityId: b.entityId != null ? b.entityId : null,
    entityName: b.entityName || '',
    entityType: b.entityType || '',
    createdAt: new Date().toISOString(),
    createdBy: req.user.name || req.user.email,
    currentStep: 0,
    status: 'active',
    stepsJson: JSON.stringify(steps),
  }));
  const row = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  const instance = rowToWfInstance(row);
  res.status(201).json(instance);

  // "Your turn" for whoever holds step 0's role — fire-and-forget after
  // the response is sent (see the matching call in PUT /api/workflow/:id
  // for why this never throws back into the request).
  notifyWorkflowStepAssigned(req.tenantId, instance).catch((err) => console.error('[notify] workflow_step_assigned failed:', err.message));
});

// The security-critical one: approve/reject the CURRENT step. Every
// derived field (completedBy/completedAt/currentStep/status) is computed
// server-side from the single `decision` input — none of it is trusted
// from the client, same lesson as PUT /api/ic-memos/:id.
app.put('/api/workflow/:id', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Workflow instance not found in this tenant' });
  if (existing.status !== 'active') return res.status(409).json({ error: 'This workflow is already resolved' });

  const b = req.body || {};
  const decision = b.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
  }
  const comment = (b.comment || '').trim();
  if (decision === 'rejected' && !comment) {
    return res.status(400).json({ error: 'comment is required when rejecting' });
  }

  const steps = JSON.parse(existing.steps_json || '[]');
  const step = steps[existing.current_step];
  if (!step) return res.status(500).json({ error: 'Workflow instance has no current step' });
  // Deliberately a literal role-code check, not a capability — workflow
  // step gating is "this specific org-chart role signs off here," the
  // same reasoning as the PUT /api/ob-tasks/:id reopen-guard.
  if (req.user.role !== step.role) {
    return res.status(403).json({ error: 'Не ваш шаг' });
  }

  step.completedAt = new Date().toISOString();
  step.completedBy = req.user.name || req.user.email;
  step.decision = decision;
  step.comment = comment;

  let currentStep = existing.current_step;
  let status = existing.status;
  if (decision === 'rejected') {
    status = 'rejected';
  } else {
    currentStep += 1;
    status = currentStep >= steps.length ? 'approved' : 'active';
  }

  db.prepare(WF_UPDATE_SQL).run(at({
    currentStep, status, stepsJson: JSON.stringify(steps),
    id: existing.id, tenantId: req.tenantId,
  }));
  const row = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  const instance = rowToWfInstance(row);
  res.json(instance);

  // Only meaningful if this approval advanced to a NEW step (still
  // active) — a rejection or the final approval has no next holder to
  // notify. notifyWorkflowStepAssigned itself also no-ops if status isn't
  // 'active', this check just avoids the wasted DB round-trips in the
  // common "chain just finished" case.
  if (instance.status === 'active') {
    notifyWorkflowStepAssigned(req.tenantId, instance).catch((err) => console.error('[notify] workflow_step_assigned failed:', err.message));
  }
});

app.post('/api/workflow/:id/withdraw', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Workflow instance not found in this tenant' });
  if (existing.status !== 'active') return res.status(409).json({ error: 'This workflow is already resolved' });
  db.prepare("UPDATE workflow_instances SET status='withdrawn' WHERE id=? AND tenant_id=?").run(existing.id, req.tenantId);
  const row = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToWfInstance(row));
});

// Manual digest run for the caller's own tenant only — lets ops confirm a
// digest actually fires without waiting for DIGEST_HOUR, and gives the
// digest checks (server/notifications/digestChecks.js) a real HTTP entry
// point to test against, same as every other route in this app. Gated on
// manageUsers (CEO) since there's no more specific "notifications admin"
// permission yet and this is an ops action, not a business one; Auditor
// also holds manageUsers but is blocked here anyway by the app-wide
// readOnly mutation gate (server/auth.js).
app.post('/api/notifications/run-digest', requireAuth, requireInternal, requirePermission('manageUsers'), async (req, res) => {
  await notificationsScheduler.runDigestChecksForTenant(req.tenantId);
  res.json({ ok: true });
});

// Cross-module "who/what/when" event feed — server/auditLog.js. Same
// manageUsers gate as run-digest above (CEO by default); Auditor also
// holds manageUsers and, unlike the POST above, isn't blocked here by the
// app-wide readOnly gate (server/auth.js only blocks mutating methods) —
// exactly the role that should be able to read this. Optional
// entityType/entityId filters for "show me this one record's history"
// (js/audit-log.js links here from a record's detail view); otherwise
// the most recent `limit` events across every logged module.
app.get('/api/audit-log', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const conditions = ['tenant_id = ?'];
  const params = [req.tenantId];
  if (req.query.entityType) { conditions.push('entity_type = ?'); params.push(req.query.entityType); }
  if (req.query.entityId) { conditions.push('entity_id = ?'); params.push(req.query.entityId); }
  const rows = db.prepare(`
    SELECT id, entity_type, entity_id, action, actor_email, summary, created_at
    FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?
  `).all(...params, limit);
  res.json({
    entries: rows.map(r => ({
      id: r.id, entityType: r.entity_type, entityId: r.entity_id, action: r.action,
      actorEmail: r.actor_email, summary: r.summary, createdAt: r.created_at,
    })),
  });
});

/* ===== Curated external API (machine callers — see server/externalApi.js) ===== */
app.use('/api/v1/external', externalApiRouter);

/* ===== Static frontend ===== */
const FRONTEND_ROOT = path.join(__dirname, '..');
// Public landing page at the bare domain, not the CRM login — DEPLOYMENT.md's
// "make the public site the homepage" option. Registered before
// express.static (which would otherwise serve index.html for '/' by
// default) so index.html itself is untouched and still reachable at its
// own URL exactly as before — every existing bookmark/internal link to it
// keeps working.
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_ROOT, 'company.html')));
app.use(express.static(FRONTEND_ROOT));

// Express only treats a 4-arg function as error-handling middleware, and
// only reaches it for errors passed to next(err) or thrown inside an
// async route — most routes above already catch their own errors and
// return a JSON response directly, so this is a backstop for whatever
// slips through, not the primary error path. Must be registered after
// every route (Express error middleware only catches errors from routes
// registered before it).
app.use((err, req, res, next) => {
  logError(err, `${req.method} ${req.path}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Immediate snapshot on every startup, then a recurring one for as long
// as the process stays up — see server/backup.js.
try { runBackup(); } catch (err) { console.error('[backup] startup backup failed:', err.message); }
scheduleBackups();

// Drives the Stage 2 digest checks (server/notifications/digestChecks.js)
// on an hourly tick, gated to DIGEST_HOUR — see scheduler.js.
notificationsScheduler.start();

// Plain HTTP unless TLS_CERT_PATH/TLS_KEY_PATH are both set (see
// .env.example / DEPLOYMENT.md) — there's no domain to get a real
// certificate for yet, so this just makes going live later a config
// change, not a code change, once one exists.
if (process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH) {
  const options = {
    cert: fs.readFileSync(process.env.TLS_CERT_PATH),
    key: fs.readFileSync(process.env.TLS_KEY_PATH),
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(`Turan CRM server listening on https://localhost:${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Turan CRM vertical-slice server listening on http://localhost:${PORT}`);
  });
}
