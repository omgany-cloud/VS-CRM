// ============================================================
//  Turan CRM — vertical-slice backend (proof of concept)
//  Serves the existing static frontend + a real API for the
//  LP Register page (the rest of the app still runs on its
//  original in-memory demo data — see README-VERTICAL-SLICE.md).
// ============================================================

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, at } = require('./db');
const { signToken, requireAuth } = require('./auth');
const { dealToParams, rowToDeal, INSERT_SQL: DEAL_INSERT_SQL, UPDATE_SQL: DEAL_UPDATE_SQL } = require('./dealMapping');
const { portfolioToParams, rowToPortfolio, INSERT_SQL: PORTFOLIO_INSERT_SQL, UPDATE_SQL: PORTFOLIO_UPDATE_SQL } = require('./portfolioMapping');
const {
  restrictedToParams, rowToRestricted, RESTRICTED_INSERT_SQL,
  coiToParams, rowToCoi, COI_INSERT_SQL,
  obClientToParams, rowToObClient, OB_CLIENT_INSERT_SQL, OB_CLIENT_UPDATE_SQL,
  obTaskToParams, rowToObTask, OB_TASK_INSERT_SQL, OB_TASK_UPDATE_SQL,
  engagementToParams, rowToEngagement, ENGAGEMENT_INSERT_SQL, ENGAGEMENT_UPDATE_SQL,
  conflictApprovalToParams, rowToConflictApproval, CONFLICT_APPROVAL_INSERT_SQL, CONFLICT_APPROVAL_UPDATE_SQL,
} = require('./onboardingMapping');
const { icMemoToParams, rowToIcMemo, INSERT_SQL: IC_MEMO_INSERT_SQL, UPDATE_SQL: IC_MEMO_UPDATE_SQL } = require('./icMemoMapping');
const { documentToParams, rowToDocument, INSERT_SQL: DOCUMENT_INSERT_SQL, UPDATE_SQL: DOCUMENT_UPDATE_SQL } = require('./documentMapping');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

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

  const token = signToken(user, tenantRow);
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
    tenant: { id: tenantRow.id, slug: tenantRow.slug, name: tenantRow.name },
  });
});

/* ===== LP Register API — tenant-scoped ===== */
function rowToLp(r) {
  return {
    id: r.id,
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

app.get('/api/lp', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM lp_register WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, lp: rows.map(rowToLp) });
});

app.post('/api/lp', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM lp_register WHERE tenant_id = ?').get(req.tenantId);
  const registerId = b.registerId || `LP-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;

  const info = db.prepare(`
    INSERT INTO lp_register
      (tenant_id, register_id, name, type, lp_type, country, address, tax_id, contact, email, phone,
       commitment, called_amount, paid_amount, distributions, fund_class, ownership_pct, professional_client,
       kyc_status, kyc_date, kyc_next_review, risk_rating, admission_date, sa_number, afsa_notified, lpac_member,
       status, exit_date, notes, ob_client_id, rm, identity_verified, proof_address_verified, sof_verified,
       tax_id_verified, pep_check_cleared, aml_screening_cleared, ubo_verified, updated_at)
    VALUES
      (@tenantId, @registerId, @name, @type, @lpType, @country, @address, @taxId, @contact, @email, @phone,
       @commitment, @calledAmount, @paidAmount, @distributions, @fundClass, @ownershipPct, @professionalClient,
       @kycStatus, @kycDate, @kycNextReview, @riskRating, @admissionDate, @saNumber, @afsaNotified, @lpacMember,
       @status, @exitDate, @notes, @obClientId, @rm, @identityVerified, @proofAddressVerified, @sofVerified,
       @taxIdVerified, @pepCheckCleared, @amlScreeningCleared, @uboVerified, datetime('now'))
  `).run(at({
    tenantId: req.tenantId,
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

app.put('/api/lp/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM lp_register WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'LP not found in this tenant' });

  const b = req.body || {};
  const merged = { ...rowToLp(existing), ...b };

  db.prepare(`
    UPDATE lp_register SET
      name=@name, type=@type, lp_type=@lpType, country=@country, address=@address, tax_id=@taxId,
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

app.get('/api/capital-calls', requireAuth, (req, res) => {
  const calls = db.prepare('SELECT * FROM capital_calls WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  const result = calls.map(c => {
    const cc = rowToCC(c);
    cc.lineItems = lineItemsStmt.all(c.id, req.tenantId).map(rowToLineItem);
    return cc;
  });
  res.json({ tenant: req.tenantSlug, capitalCalls: result });
});

app.post('/api/capital-calls', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.purpose) return res.status(400).json({ error: 'purpose is required' });

  const countRow = db.prepare('SELECT COUNT(*) AS c FROM capital_calls WHERE tenant_id = ?').get(req.tenantId);
  const ccNumber = b.ccNumber || `CC-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(3, '0')}`;

  // Auto-build pro-rata line items across all Active LPs if the caller didn't supply its own.
  const totalAmount = b.totalAmount || 0;
  let lineItems = b.lineItems;
  if (!lineItems) {
    const activeLps = db.prepare("SELECT * FROM lp_register WHERE tenant_id = ? AND status = 'Active'").all(req.tenantId);
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
        (tenant_id, cc_number, notice_date, payment_date, total_amount, pct_of_commit, purpose, purpose_type,
         status, management_fee, bank_ref, created_by, notes)
      VALUES
        (@tenantId, @ccNumber, @noticeDate, @paymentDate, @totalAmount, @pctOfCommit, @purpose, @purposeType,
         @status, @managementFee, @bankRef, @createdBy, @notes)
    `).run(at({
      tenantId: req.tenantId, ccNumber,
      noticeDate: b.noticeDate || null, paymentDate: b.paymentDate || null,
      totalAmount, pctOfCommit, purpose: b.purpose, purposeType: b.purposeType || 'Investment',
      status: b.status || 'Pending', managementFee: b.managementFee ? 1 : 0,
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

app.put('/api/capital-calls/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Capital call not found in this tenant' });
  const b = req.body || {};
  const merged = Object.assign(rowToCC(existing), b);
  db.prepare(`
    UPDATE capital_calls SET
      cc_number=@ccNumber, notice_date=@noticeDate, payment_date=@paymentDate, total_amount=@totalAmount,
      pct_of_commit=@pctOfCommit, purpose=@purpose, purpose_type=@purposeType, status=@status,
      management_fee=@managementFee, bank_ref=@bankRef, created_by=@createdBy, notes=@notes, updated_at=datetime('now')
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
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
app.put('/api/capital-calls/:id/line-items/:lpId', requireAuth, (req, res) => {
  const call = db.prepare('SELECT * FROM capital_calls WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!call) return res.status(404).json({ error: 'Capital call not found in this tenant' });
  const item = db.prepare('SELECT * FROM capital_call_line_items WHERE call_id = ? AND lp_id = ? AND tenant_id = ?')
    .get(call.id, req.params.lpId, req.tenantId);
  if (!item) return res.status(404).json({ error: 'Line item not found' });

  const b = req.body || {};
  db.prepare(`
    UPDATE capital_call_line_items SET
      paid=@paid, payment_date=@paymentDate, status=@status, wire_ref=@wireRef, aml_ok=@amlOk
    WHERE id=@id AND tenant_id=@tenantId
  `).run(at({
    id: item.id, tenantId: req.tenantId,
    paid: b.paid != null ? b.paid : item.paid,
    paymentDate: b.paymentDate || item.payment_date,
    status: b.status || item.status,
    wireRef: b.wireRef != null ? b.wireRef : item.wire_ref,
    amlOk: b.amlOk != null ? (b.amlOk ? 1 : 0) : item.aml_ok,
  }));

  const row = db.prepare('SELECT * FROM capital_calls WHERE id = ?').get(call.id);
  const cc = rowToCC(row);
  cc.lineItems = lineItemsStmt.all(call.id, req.tenantId).map(rowToLineItem);
  res.json(cc);
});

/* ===== Deals (Deal Pipeline) API — tenant-scoped ===== */
app.get('/api/deals', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM deals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, deals: rows.map(rowToDeal) });
});

app.post('/api/deals', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  const now = new Date().toISOString().slice(0, 10);
  const params = dealToParams({
    stage: 'Скрининг', ic: 'Не подано', updatedAt: now, ...b,
  });
  const info = db.prepare(DEAL_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToDeal(row));
});

app.put('/api/deals/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Deal not found in this tenant' });
  const merged = Object.assign(rowToDeal(existing), req.body || {});
  const params = dealToParams(merged);
  db.prepare(DEAL_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM deals WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToDeal(row));
});

/* ===== Portfolio API — tenant-scoped ===== */
app.get('/api/portfolio', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM portfolio WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, portfolio: rows.map(rowToPortfolio) });
});

app.post('/api/portfolio', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const params = portfolioToParams({ status: 'Active', ...b });
  const info = db.prepare(PORTFOLIO_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM portfolio WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToPortfolio(row));
});

app.put('/api/portfolio/:id', requireAuth, (req, res) => {
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
app.get('/api/onboarding', requireAuth, (req, res) => {
  const restrictedList = db.prepare('SELECT * FROM restricted_list WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToRestricted);
  const coiRegistry = db.prepare('SELECT * FROM coi_registry WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToCoi);
  const obClients = db.prepare('SELECT * FROM ob_clients WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToObClient);
  const obTasks = db.prepare('SELECT * FROM ob_tasks WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToObTask);
  const engagements = db.prepare('SELECT * FROM engagements WHERE tenant_id = ? ORDER BY id').all(req.tenantId).map(rowToEngagement);
  res.json({ tenant: req.tenantSlug, restrictedList, coiRegistry, obClients, obTasks, engagements });
});

app.post('/api/ob-clients', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const params = obClientToParams({ phase: 1, onboardingStatus: 'On Track', ...b });
  const info = db.prepare(OB_CLIENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToObClient(row));
});

app.put('/api/ob-clients/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Onboarding client not found in this tenant' });
  const merged = Object.assign(rowToObClient(existing), req.body || {});
  const params = obClientToParams(merged);
  db.prepare(OB_CLIENT_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ob_clients WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToObClient(row));
});

// The common day-to-day write: update a task's status/formData as the
// RM/CO works through the wizard.
app.put('/api/ob-tasks/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Onboarding task not found in this tenant' });
  const merged = Object.assign(rowToObTask(existing), req.body || {});
  const params = obTaskToParams(merged);
  db.prepare(OB_TASK_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ob_tasks WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToObTask(row));
});

app.post('/api/restricted-list', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  const params = restrictedToParams({ addedAt: new Date().toISOString().slice(0, 10), addedBy: req.user.role || req.user.email, ...b });
  const info = db.prepare(RESTRICTED_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM restricted_list WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToRestricted(row));
});

app.post('/api/coi-registry', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: 'description is required' });
  const params = coiToParams(b);
  const info = db.prepare(COI_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM coi_registry WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToCoi(row));
});

app.post('/api/engagements', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.clientName) return res.status(400).json({ error: 'clientName is required' });
  const params = engagementToParams(b);
  const info = db.prepare(ENGAGEMENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToEngagement(row));
});

// Lets an RM/CO update an existing engagement — e.g. flip status to
// Completed, or set deal_ref once a matter is tied to a specific deal —
// so a client can be tracked across all of its engagements over time.
app.put('/api/engagements/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM engagements WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Engagement not found in this tenant' });
  const merged = Object.assign(rowToEngagement(existing), req.body || {});
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
app.get('/api/conflict-approvals', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM conflict_approvals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, conflictApprovals: rows.map(rowToConflictApproval) });
});

app.post('/api/conflict-approvals', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.decisionType) return res.status(400).json({ error: 'decisionType is required' });
  const params = conflictApprovalToParams({ riskLevel: 'Low', status: 'Pending', ...b });
  const info = db.prepare(CONFLICT_APPROVAL_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToConflictApproval(row));
});

app.put('/api/conflict-approvals/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Conflict approval not found in this tenant' });
  const merged = Object.assign(rowToConflictApproval(existing), req.body || {});
  const params = conflictApprovalToParams(merged);
  db.prepare(CONFLICT_APPROVAL_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM conflict_approvals WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToConflictApproval(row));
});

/* ===== IC Memos API — tenant-scoped ===== */
app.get('/api/ic-memos', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM ic_memos WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, icMemos: rows.map(rowToIcMemo) });
});

app.post('/api/ic-memos', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.company) return res.status(400).json({ error: 'company is required' });
  const params = icMemoToParams({ status: 'pending', ...b });
  const info = db.prepare(IC_MEMO_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToIcMemo(row));
});

app.put('/api/ic-memos/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'IC memo not found in this tenant' });
  const merged = Object.assign(rowToIcMemo(existing), req.body || {});
  const params = icMemoToParams(merged);
  db.prepare(IC_MEMO_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM ic_memos WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToIcMemo(row));
});

/* ===== Documents API — tenant-scoped =====
   The merged docFiles/vault entity — see the comment on the `documents`
   table in db.js for why vault.js's other source (task attachments)
   isn't part of this migration. */
app.get('/api/documents', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM documents WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
  res.json({ tenant: req.tenantSlug, documents: rows.map(rowToDocument) });
});

app.post('/api/documents', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const params = documentToParams(b);
  const info = db.prepare(DOCUMENT_INSERT_SQL).run(at({ tenantId: req.tenantId, ...params }));
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(info.lastInsertRowid, req.tenantId);
  res.status(201).json(rowToDocument(row));
});

app.put('/api/documents/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!existing) return res.status(404).json({ error: 'Document not found in this tenant' });
  const merged = Object.assign(rowToDocument(existing), req.body || {});
  const params = documentToParams(merged);
  db.prepare(DOCUMENT_UPDATE_SQL).run(at({ ...params, id: existing.id, tenantId: req.tenantId }));
  const row = db.prepare('SELECT * FROM documents WHERE id = ? AND tenant_id = ?').get(existing.id, req.tenantId);
  res.json(rowToDocument(row));
});

/* ===== Static frontend ===== */
const FRONTEND_ROOT = path.join(__dirname, '..');
app.use(express.static(FRONTEND_ROOT));

app.listen(PORT, () => {
  console.log(`Turan CRM vertical-slice server listening on http://localhost:${PORT}`);
});
