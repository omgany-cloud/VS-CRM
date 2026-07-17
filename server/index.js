// ============================================================
//  Turan CRM — vertical-slice backend (proof of concept)
//  Serves the existing static frontend + a real API for the
//  LP Register page (the rest of the app still runs on its
//  original in-memory demo data — see README-VERTICAL-SLICE.md).
// ============================================================

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, at } = require('./db');
const { signToken, signPortalToken, requireAuth, requirePortalAuth, requirePermission, requireInternal, JWT_SECRET } = require('./auth');
const { getRoleRowByCode, isValidRole, listRoleRows, IC_SEATS } = require('./rolesRepo');
const { rowToRole, rowToPermissions, roleToParams, INSERT_SQL: ROLE_INSERT_SQL, UPDATE_SQL: ROLE_UPDATE_SQL } = require('./rolesMapping');
const { rowToUser } = require('./usersMapping');
const { computeUserFootprint } = require('./userFootprint');
const {
  blocksPermissions: chineseWallBlocks, filterClientsForPermissions,
  blocksDocumentCategory, filterDocumentsForPermissions,
} = require('./chineseWall');
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
const { upsertTenant, upsertUser, seedSystemRoles } = require('./tenantProvisioning');
const { fundToParams, rowToFund, INSERT_SQL: FUND_INSERT_SQL, UPDATE_SQL: FUND_UPDATE_SQL } = require('./fundMapping');
const { rowToFirstClosing, firstClosingToParams, INSERT_SQL: FIRST_CLOSING_INSERT_SQL, UPDATE_SQL: FIRST_CLOSING_UPDATE_SQL } = require('./firstClosingMapping');
const { rowToAfsaReport, afsaReportToParams, INSERT_SQL: AFSA_REPORT_INSERT_SQL, UPDATE_SQL: AFSA_REPORT_UPDATE_SQL } = require('./afsaReportMapping');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

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

// Deliberately NOT behind requireAuth — this route accepts the JWT via
// either the normal Authorization header OR a ?token= query param, so a
// plain <a href>/window.open/iframe (no way to attach a header) can open
// it directly, the same way every other document link in this app just
// works when clicked. Same trust level as those external Drive/SharePoint
// links already are — the file is reachable by anyone holding a valid
// token for the right tenant, not by the general public, and tenant_id
// is still checked against the row before anything is served.
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
  const filePath = path.join(UPLOADS_DIR, row.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_name)}"`);
  res.sendFile(filePath);
});

/* ===== Auth ===== */
app.post('/api/auth/login', (req, res) => {
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
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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
    user: { id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role },
    permissions: req.user.permissions,
  });
});

/* ===== Portal (portal.html) — LP / portfolio-company self-service =====
   A separate identity space from the internal users/roles above: a portal
   "account" is a row in the existing `portfolio` table, not a `users` row.
   Per explicit product decision, there is no per-company password —
   every portfolio company authenticates with its own BIN plus this one
   shared demo password. That's a real limitation (anyone who knows a
   company's BIN and this password can act as that company), acceptable
   only because this whole app is a PoC; a production version would need
   real per-company credentials before going live. */
const PORTAL_DEMO_PASSWORD = process.env.PORTAL_DEMO_PASSWORD || 'PortalDemo2025!';

app.post('/api/portal/login', (req, res) => {
  const { bin, password } = req.body || {};
  if (!bin || !password) return res.status(400).json({ error: 'bin and password are required' });
  const row = db.prepare('SELECT * FROM portfolio WHERE bin = ?').get(String(bin).trim());
  if (!row || password !== PORTAL_DEMO_PASSWORD) {
    return res.status(401).json({ error: 'Неверный BIN или пароль' });
  }
  const token = signPortalToken(row);
  res.json({ token, company: rowToPortfolio(row) });
});

// Lets an already-logged-in portal session refresh its own company record
// (e.g. after another tab/device submitted a document) without re-login —
// same purpose as GET /api/auth/me for internal users.
app.get('/api/portal/me', requirePortalAuth, (req, res) => {
  res.json({ company: rowToPortfolio(req.portalCompany) });
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
      INSERT INTO uploaded_files (tenant_id, stored_name, original_name, mime_type, size_bytes, uploaded_by)
      VALUES (@tenantId, @storedName, @originalName, @mimeType, @sizeBytes, @uploadedBy)
    `).run(at({
      tenantId: req.tenantId, storedName: req.file.filename, originalName: req.file.originalname,
      mimeType: req.file.mimetype, sizeBytes: req.file.size, uploadedBy: 'Портал: ' + req.portalCompany.name,
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
      INSERT INTO users (tenant_id, email, password_hash, role, name, active)
      VALUES (@tenantId, @email, @passwordHash, @role, @name, 1)
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
app.put('/api/users/me/password', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.user.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !bcrypt.compareSync(currentPassword, existing.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
  }
  db.prepare('UPDATE users SET password_hash=@passwordHash WHERE id=@id AND tenant_id=@tenantId')
    .run(at({ passwordHash: bcrypt.hashSync(newPassword, 10), id: existing.id, tenantId: req.tenantId }));
  res.json({ ok: true });
});

app.put('/api/users/:id/password', requireAuth, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'User not found in this tenant' });
  const { password } = req.body || {};
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash=@passwordHash WHERE id=@id AND tenant_id=@tenantId')
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

/* ===== LP Register API — tenant-scoped ===== */
function rowToLp(r) {
  return {
    id: r.id,
    fundId: r.fund_id,
    registerId: r.register_id,
    name: r.name,
    type: r.type,
    lpType: r.lp_type,
    country: r.country,
    address: r.address,
    taxId: r.tax_id,
    contact: r.contact,
    email: r.email,
    phone: r.phone,
    commitment: r.commitment,
    calledAmount: r.called_amount,
    paidAmount: r.paid_amount,
    distributions: r.distributions,
    fundClass: r.fund_class,
    ownershipPct: r.ownership_pct,
    professionalClient: r.professional_client,
    kycStatus: r.kyc_status,
    kycDate: r.kyc_date,
    kycNextReview: r.kyc_next_review,
    riskRating: r.risk_rating,
    admissionDate: r.admission_date,
    saNumber: r.sa_number,
    afsaNotified: !!r.afsa_notified,
    lpacMember: !!r.lpac_member,
    status: r.status,
    exitDate: r.exit_date,
    notes: r.notes,
    obClientId: r.ob_client_id,
    rm: r.rm,
    identityVerified: !!r.identity_verified,
    proofAddressVerified: !!r.proof_address_verified,
    sofVerified: !!r.sof_verified,
    taxIdVerified: !!r.tax_id_verified,
    pepCheckCleared: !!r.pep_check_cleared,
    amlScreeningCleared: !!r.aml_screening_cleared,
    uboVerified: !!r.ubo_verified,
  };
}

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

app.post('/api/funds', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  // nav has NOT NULL DEFAULT 0 at the schema level, but fundToParams() binds
  // an explicit NULL for any field the caller omits — which overrides a
  // column's SQL-level DEFAULT (SQLite/node:sqlite only applies DEFAULT when
  // the column is left out of the statement entirely, not when NULL is
  // explicitly bound). The fund-creation form never sends nav, so default it
  // here first, same pattern already used by POST /api/deals and /api/portfolio.
  const info = db.prepare(FUND_INSERT_SQL).run(at({ tenantId: req.tenantId, ...fundToParams({ nav: 0, ...b }) }));
  const row = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  const f = rowToFund(row);
  f.lpCount = 0;
  f.deployed = 0;
  res.status(201).json(f);
});

app.put('/api/funds/:id', requireAuth, requireInternal, requirePermission('manageUsers'), (req, res) => {
  const existing = db.prepare('SELECT * FROM funds WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Fund not found in this tenant' });
  const merged = { ...rowToFund(existing), ...(req.body || {}) };
  db.prepare(FUND_UPDATE_SQL).run(at({ id: existing.id, tenantId: req.tenantId, ...fundToParams(merged) }));
  const row = db.prepare('SELECT * FROM funds WHERE id = ?').get(existing.id);
  const f = rowToFund(row);
  const lpCount = db.prepare('SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ? AND fund_id = ?').get(req.tenantId, f.id).c;
  const deployed = db.prepare("SELECT COALESCE(SUM(invested), 0) AS s FROM portfolio WHERE tenant_id = ? AND fund_id = ?").get(req.tenantId, f.id).s;
  f.lpCount = lpCount;
  f.deployed = deployed;
  res.json(f);
});

app.get('/api/lp', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const rows = db.prepare('SELECT * FROM lp_register WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, lp: rows.map(rowToLp) });
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
       tax_id_verified, pep_check_cleared, aml_screening_cleared, ubo_verified, updated_at)
    VALUES
      (@tenantId, @fundId, @registerId, @name, @type, @lpType, @country, @address, @taxId, @contact, @email, @phone,
       @commitment, @calledAmount, @paidAmount, @distributions, @fundClass, @ownershipPct, @professionalClient,
       @kycStatus, @kycDate, @kycNextReview, @riskRating, @admissionDate, @saNumber, @afsaNotified, @lpacMember,
       @status, @exitDate, @notes, @obClientId, @rm, @identityVerified, @proofAddressVerified, @sofVerified,
       @taxIdVerified, @pepCheckCleared, @amlScreeningCleared, @uboVerified, datetime('now'))
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
  }));

  const row = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToLp(row));
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
      updated_at=datetime('now')
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
    id: existing.id, tenantId: req.tenantId,
  }));

  const row = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToLp(row));
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
    res.status(201).json(cc);
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: err.message });
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
  res.json(cc);
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
  // confirmation) rather than a bare status flip. Only enforced on the
  // transition INTO Paid — editing an already-paid item's other fields
  // later doesn't re-trigger this.
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

  const row = db.prepare('SELECT * FROM capital_calls WHERE id = ?').get(call.id);
  const cc = rowToCC(row);
  cc.lineItems = lineItemsStmt.all(call.id, req.tenantId).map(rowToLineItem);
  res.json(cc);
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
  if (!existing) return res.status(404).json({ error: 'AFSA report not found in this tenant' });
  const b = req.body || {};
  if (b.status === 'Отправлен' && existing.status !== 'Отправлен') {
    if (!req.user.permissions.afsaSubmit) {
      return res.status(403).json({ error: 'Forbidden: only CEO/CFO/Compliance Officer/MLRO may mark an AFSA report as submitted' });
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
  res.json(rowToDeal(row));
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
  res.status(201).json(rowToPortfolio(row));
});

app.put('/api/portfolio/:id', requireAuth, requireInternal, requirePermission('accessFM'), (req, res) => {
  const existing = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Portfolio company not found in this tenant' });
  const merged = Object.assign(rowToPortfolio(existing), req.body || {});
  const params = portfolioToParams(merged);
  db.prepare(PORTFOLIO_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToPortfolio(row));
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
  res.json(rowToEngagement(row));
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

app.post('/api/conflict-approvals', requireAuth, requirePermission('decideConflicts'), (req, res) => {
  const b = req.body || {};
  if (!b.decisionType) return res.status(400).json({ error: 'decisionType is required' });
  const params = conflictApprovalToParams({ riskLevel: 'Low', status: 'Pending', currency: 'USD', ...b });
  const info = db.prepare(CONFLICT_APPROVAL_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToConflictApproval(row));
});

app.put('/api/conflict-approvals/:id', requireAuth, requirePermission('decideConflicts'), (req, res) => {
  const existing = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Conflict approval not found in this tenant' });
  const merged = Object.assign(rowToConflictApproval(existing), req.body || {});
  const params = conflictApprovalToParams(merged);
  db.prepare(CONFLICT_APPROVAL_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
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
  // or once quorum (which requires the Independent Member's actual vote per
  // Constitution Section 7) is met, does a decisive majority finalize the
  // memo. Otherwise 3 non-Independent-Member votes could lock the memo
  // before that mandatory seat ever gets to vote. 'defer' (request
  // additional/external DD before deciding) only resolves via allVoted,
  // same as reject — no early-exit fast path for it either.
  if (!(allVoted || (quorumMet && approveN > votes.length / 2))) {
    return { quorumMet, status: 'pending', resolution: memo.resolution };
  }
  const quorumNote = quorumMet ? '' : ' Кворум по Constitution Section 7 не набран — решение носит предварительный характер.';
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

app.post('/api/workflow', requireAuth, requireInternal, (req, res) => {
  const b = req.body || {};
  if (!b.type || !WF_DEFINITIONS[b.type]) {
    return res.status(400).json({ error: 'type must be one of: ' + Object.keys(WF_DEFINITIONS).join(', ') });
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
  res.status(201).json(rowToWfInstance(row));
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
  res.json(rowToWfInstance(row));
});

app.post('/api/workflow/:id/withdraw', requireAuth, requireInternal, (req, res) => {
  const existing = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Workflow instance not found in this tenant' });
  if (existing.status !== 'active') return res.status(409).json({ error: 'This workflow is already resolved' });
  db.prepare("UPDATE workflow_instances SET status='withdrawn' WHERE id=? AND tenant_id=?").run(existing.id, req.tenantId);
  const row = db.prepare('SELECT * FROM workflow_instances WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToWfInstance(row));
});

/* ===== Static frontend ===== */
const FRONTEND_ROOT = path.join(__dirname, '..');
app.use(express.static(FRONTEND_ROOT));

app.listen(PORT, () => {
  console.log(`Turan CRM vertical-slice server listening on http://localhost:${PORT}`);
});
