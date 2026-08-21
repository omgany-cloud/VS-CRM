// ============================================================
//  DB layer — SQLite via Node's built-in node:sqlite module
//  (no native compilation required — avoids the node-gyp/Python
//  toolchain that better-sqlite3 needs, which isn't available
//  in this environment).
//
//  Requires Node >= 24 (see package.json's engines field): node:sqlite
//  was still behind the --experimental-sqlite flag on some 22.x
//  releases, and this app passes no such flag anywhere — deploying
//  onto an older Node 22.x build could otherwise fail at startup with
//  no obvious explanation.
//
//  Tenancy model: shared DB, shared tables, `tenant_id` column
//  on every tenant-scoped table + enforced in every query.
//  This is the fastest strategy to stand up and is fine for a
//  vertical-slice PoC. For production with regulated (KYC/AML)
//  data, migrate to schema-per-tenant (Postgres) — see the
//  multi-tenancy roadmap discussed with the product owner.
// ============================================================

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Overridable so the test suite (server/test/) can point at a throwaway
// file instead of the real pilot database — everything else about this
// module is unchanged either way.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'crm.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'CEO',
  name           TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, email)
);

-- A management company (tenant) can run several funds. lp_register,
-- capital_calls, deals, portfolio, and ic_memos each carry a fund_id
-- (added further below) tying that record to one specific fund; the
-- sidebar fund switcher filters by it client-side (same pattern
-- documents.fund_id already used, informally, before this table existed).
-- lp_count/deployed are deliberately NOT stored here — computed live from
-- lp_register/capital_calls in GET /api/funds instead of risking a stale
-- denormalized number. nav has no other source in this app and stays a
-- manually-edited field, same as portfolio.value.
CREATE TABLE IF NOT EXISTS funds (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  name               TEXT NOT NULL,
  short_name         TEXT,
  gp                 TEXT,
  license            TEXT,
  type               TEXT,
  currency           TEXT NOT NULL DEFAULT 'USD',
  target_size        REAL,
  vintage            INTEGER,
  status             TEXT NOT NULL DEFAULT 'fundraising',
  phase              TEXT,
  phase_year         INTEGER,
  fund_term          INTEGER,
  investment_period  INTEGER,
  management_fee     REAL,
  carried_interest   REAL,
  preferred_return   REAL,
  target_irr         TEXT,
  target_moic        TEXT,
  description        TEXT,
  color              TEXT NOT NULL DEFAULT '#3b82f6',
  icon               TEXT NOT NULL DEFAULT 'fa-landmark',
  nav                REAL NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_funds_tenant ON funds(tenant_id);

CREATE TABLE IF NOT EXISTS lp_register (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  fund_id               INTEGER REFERENCES funds(id),
  register_id           TEXT NOT NULL,
  name                  TEXT NOT NULL,
  type                  TEXT NOT NULL,
  lp_type               TEXT NOT NULL,
  country               TEXT,
  address               TEXT,
  tax_id                TEXT,
  contact               TEXT,
  email                 TEXT,
  phone                 TEXT,
  commitment            REAL NOT NULL DEFAULT 0,
  called_amount         REAL NOT NULL DEFAULT 0,
  paid_amount           REAL NOT NULL DEFAULT 0,
  distributions         REAL NOT NULL DEFAULT 0,
  fund_class            TEXT,
  ownership_pct         REAL NOT NULL DEFAULT 0,
  professional_client   TEXT,
  kyc_status            TEXT,
  kyc_date              TEXT,
  kyc_next_review       TEXT,
  risk_rating           TEXT,
  admission_date        TEXT,
  sa_number             TEXT,
  afsa_notified         INTEGER NOT NULL DEFAULT 0,
  lpac_member           INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'Active',
  exit_date             TEXT,
  notes                 TEXT,
  ob_client_id          INTEGER,
  rm                    TEXT,
  -- Granular KYC checklist (Onboarding Templates package, Template 1/2)
  -- — same rationale as ob_clients' identity_verified/sof_verified/etc:
  -- kyc_status alone can't answer "which check is still open", these can.
  identity_verified     INTEGER NOT NULL DEFAULT 0,
  proof_address_verified INTEGER NOT NULL DEFAULT 0,
  sof_verified          INTEGER NOT NULL DEFAULT 0,
  tax_id_verified       INTEGER NOT NULL DEFAULT 0,
  pep_check_cleared     INTEGER NOT NULL DEFAULT 0,
  aml_screening_cleared INTEGER NOT NULL DEFAULT 0,
  ubo_verified          INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS capital_calls (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  fund_id               INTEGER REFERENCES funds(id),
  cc_number             TEXT NOT NULL,
  notice_date           TEXT,
  payment_date          TEXT,
  total_amount          REAL NOT NULL DEFAULT 0,
  pct_of_commit         REAL NOT NULL DEFAULT 0,
  purpose               TEXT,
  purpose_type          TEXT,
  status                TEXT NOT NULL DEFAULT 'Pending',
  management_fee        INTEGER NOT NULL DEFAULT 0,
  bank_ref              TEXT,
  created_by            TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS capital_call_line_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  call_id        INTEGER NOT NULL REFERENCES capital_calls(id),
  lp_id          INTEGER NOT NULL REFERENCES lp_register(id),
  commitment     REAL NOT NULL DEFAULT 0,
  pct            REAL NOT NULL DEFAULT 0,
  called         REAL NOT NULL DEFAULT 0,
  paid           REAL NOT NULL DEFAULT 0,
  payment_date   TEXT,
  status         TEXT NOT NULL DEFAULT 'Pending',
  wire_ref       TEXT,
  -- Proof of receipt (payment order / SWIFT confirmation link) — added
  -- alongside wire_ref because wire_ref existed as a column for a long
  -- time but no UI ever actually set it; both are now required together
  -- by PUT /api/capital-calls/:id/line-items/:lpId whenever a line item
  -- is first marked Paid, gated behind paymentConfirm (CFO/CEO).
  wire_confirm_url TEXT,
  aml_ok         INTEGER
);

-- Distributions: the reverse cash flow (fund -> LP), mirroring capital_calls/
-- capital_call_line_items above. roc_amount (return of capital) and
-- profit_amount are entered separately because they're taxed/carried
-- differently downstream: POST /api/distributions auto-splits roc_amount
-- pro-rata by ownership (no carry, no waterfall math needed) and runs
-- profit_amount through the real waterfall (server/waterfallEngine.js) —
-- unless the caller supplies lineItems verbatim instead.
CREATE TABLE IF NOT EXISTS distributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  fund_id             INTEGER REFERENCES funds(id),
  dist_number         TEXT NOT NULL,
  notice_date         TEXT,
  payment_date        TEXT,
  total_amount        REAL NOT NULL DEFAULT 0,
  source_type         TEXT,
  source_portfolio_id INTEGER REFERENCES portfolio(id),
  roc_amount          REAL NOT NULL DEFAULT 0,
  profit_amount       REAL NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'Draft',
  created_by          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distribution_line_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  distribution_id  INTEGER NOT NULL REFERENCES distributions(id),
  lp_id            INTEGER NOT NULL REFERENCES lp_register(id),
  pct              REAL NOT NULL DEFAULT 0,
  gross_amount     REAL NOT NULL DEFAULT 0,
  gp_carry_amount  REAL NOT NULL DEFAULT 0,
  net_amount       REAL NOT NULL DEFAULT 0,
  payment_date     TEXT,
  status           TEXT NOT NULL DEFAULT 'Pending',
  wire_ref         TEXT,
  wire_confirm_url TEXT
);

-- Deals: scalar/filterable fields as real columns; the deal detail modal's
-- list-shaped sub-sections (tags, founder contacts, DD checklists, IC votes,
-- comments, etc.) are stored as JSON text columns rather than fully
-- normalized into their own tables. That's a deliberate PoC simplification —
-- fine as long as nothing needs to query *inside* those lists (e.g. "find
-- deals where the CFO voted No"); if that need shows up, normalize then.
CREATE TABLE IF NOT EXISTS deals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  fund_id               INTEGER REFERENCES funds(id),
  company               TEXT NOT NULL,
  sector                TEXT,
  stage                 TEXT NOT NULL DEFAULT 'Скрининг',
  amount                REAL NOT NULL DEFAULT 0,
  type                  TEXT,
  priority              TEXT,
  manager               TEXT,
  ic                    TEXT,
  next_action           TEXT,
  next_action_date      TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  country               TEXT,
  company_stage         TEXT,
  pre_money             REAL,
  deal_source           TEXT,
  first_contact_date    TEXT,
  revenue               TEXT,
  round_size            TEXT,
  check_size            REAL,
  description           TEXT,
  pitch_deck_url        TEXT,
  ic_memo_url           TEXT,
  ic_minutes_url        TEXT,
  wire_confirm_url      TEXT,
  instrument            TEXT,
  co_investors          TEXT,
  ic_decision           TEXT,
  ic_date               TEXT,
  dd_deadline           TEXT,
  ts_fund_lawyer        TEXT,
  data_room_url         TEXT,
  reject_category       TEXT,
  can_return            TEXT,
  reject_follow_up_date TEXT,
  reject_decision_by    TEXT,
  reject_comment        TEXT,
  tags_json             TEXT NOT NULL DEFAULT '[]',
  founder_contacts_json TEXT NOT NULL DEFAULT '[]',
  ts_versions_json      TEXT NOT NULL DEFAULT '[]',
  signed_docs_urls_json TEXT NOT NULL DEFAULT '[]',
  other_docs_json       TEXT NOT NULL DEFAULT '[]',
  ic_votes_json         TEXT NOT NULL DEFAULT '[]',
  ic_risks_json         TEXT NOT NULL DEFAULT '[]',
  dd_legal_json         TEXT NOT NULL DEFAULT '[]',
  dd_financial_json     TEXT NOT NULL DEFAULT '[]',
  dd_tech_json          TEXT NOT NULL DEFAULT '[]',
  dd_commercial_json    TEXT NOT NULL DEFAULT '[]',
  -- Specialist sign-off tracks, same {item,status} shape as the 4 DD
  -- columns above — added so Risk/Compliance/MLRO each have their own
  -- checklist ahead of the IC memo, not just Legal/Financial/Tech/
  -- Commercial (see js/app.js's ddBlock()/cycleDDStatus()).
  dd_risk_json          TEXT NOT NULL DEFAULT '[]',
  dd_compliance_json    TEXT NOT NULL DEFAULT '[]',
  dd_mlro_json          TEXT NOT NULL DEFAULT '[]',
  dd_red_flags_json     TEXT NOT NULL DEFAULT '[]',
  dd_consultants_json   TEXT NOT NULL DEFAULT '[]',
  comments_json         TEXT NOT NULL DEFAULT '[]',
  -- One conclusion per DD category (Legal/Financial/Tech/Commercial/Risk/
  -- Compliance/MLRO — see js/app.js's DD_CONCLUSION_CATEGORIES), each
  -- {category, author, text, verdict, documents:[{name,url}], updatedAt}.
  -- These feed the auto-compiled "Заключение УК" document, which the
  -- responsible person (CEO/CIO — authorICMemo permission) formally
  -- signs below before an IC memo can be created for this deal.
  dd_conclusions_json    TEXT NOT NULL DEFAULT '[]',
  gp_conclusion_verdict  TEXT,
  gp_conclusion_summary  TEXT,
  gp_conclusion_signed_by TEXT,
  gp_conclusion_signed_at TEXT,
  -- Term Sheet / Переговоры / closed-deal fields — these rendered in the
  -- deal modal from the very first version of this app but never had a
  -- column, so every value in them was silently lost outside the current
  -- browser tab (js/app.js's dealField()/dealMoveStage() didn't persist
  -- at all until this migration — see server/dealMapping.js).
  ts_pre_money          REAL,
  ts_post_money         REAL,
  ts_fund_share         REAL,
  ts_rights             TEXT,
  ts_vesting            TEXT,
  ts_signed_date        TEXT,
  ts_status             TEXT,
  ts_company_lawyer     TEXT,
  wire_date             TEXT,
  neg_meetings_json     TEXT NOT NULL DEFAULT '[]',
  neg_disputed_items_json TEXT NOT NULL DEFAULT '[]',
  neg_blockers_json     TEXT NOT NULL DEFAULT '[]',
  closing_date_planned  TEXT,
  closed_date           TEXT,
  closed_amount         REAL,
  closed_valuation      REAL,
  first_board_meeting   TEXT,
  kpi_6m                TEXT,
  kpi_12m               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Portfolio companies: same JSON-blob-for-large-nested-sections tradeoff
-- as deals (see comment above deals table), but coarser-grained — each of
-- financials/monitoring/documents/compliance/exit/history is ONE JSON blob.
CREATE TABLE IF NOT EXISTS portfolio (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  fund_id           INTEGER REFERENCES funds(id),
  name              TEXT NOT NULL,
  sector            TEXT,
  stage             TEXT,
  bin               TEXT,
  invested          REAL NOT NULL DEFAULT 0,
  value             REAL NOT NULL DEFAULT 0,
  date              TEXT,
  exit_strategy     TEXT,
  exit_year         INTEGER,
  moic              REAL,
  fund_share        REAL,
  manager           TEXT,
  status            TEXT NOT NULL DEFAULT 'Active',
  next_action       TEXT,
  next_action_date  TEXT,
  last_updated      TEXT,
  financials_json   TEXT NOT NULL DEFAULT '{}',
  monitoring_json   TEXT NOT NULL DEFAULT '{}',
  documents_json    TEXT NOT NULL DEFAULT '{}',
  compliance_json   TEXT NOT NULL DEFAULT '{}',
  exit_json         TEXT NOT NULL DEFAULT '{}',
  history_json      TEXT NOT NULL DEFAULT '[]',
  archived          INTEGER NOT NULL DEFAULT 0,
  archived_at       TEXT,
  archived_by       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Onboarding / KYC-AML module (migrated from js/onboarding.js, ~404KB —
-- see audit notes: the file is ~96.5% client-side rendering/document-
-- generation logic that stays in the browser; only these 5 data
-- collections move server-side).
CREATE TABLE IF NOT EXISTS restricted_list (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  company            TEXT NOT NULL,
  sector             TEXT,
  fund               TEXT,
  ownership_pct      REAL,
  restriction_type   TEXT,
  cfa_allowed        INTEGER NOT NULL DEFAULT 0,
  requires_approval  INTEGER NOT NULL DEFAULT 0,
  added_at           TEXT,
  added_by           TEXT
);

CREATE TABLE IF NOT EXISTS coi_registry (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  coi_id             TEXT,
  date               TEXT,
  conflict_type      TEXT,
  parties            TEXT,
  severity           TEXT,
  status             TEXT NOT NULL DEFAULT 'Open',
  description        TEXT,
  measures           TEXT,
  responsible        TEXT,
  review_date        TEXT,
  resolution         TEXT,
  linked_client_id   INTEGER REFERENCES ob_clients(id)
);

CREATE TABLE IF NOT EXISTS ob_clients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  client_id          TEXT NOT NULL,
  name               TEXT NOT NULL,
  type               TEXT,
  classification     TEXT,
  service_type       TEXT,
  lp_type            TEXT,
  commitment         REAL,
  direction          TEXT NOT NULL,
  rm                 TEXT,
  phase              INTEGER NOT NULL DEFAULT 1,
  onboarding_status  TEXT,
  risk_rating        TEXT,
  start_date         TEXT,
  target_date        TEXT,
  next_action        TEXT,
  notes              TEXT,
  restricted_match   INTEGER NOT NULL DEFAULT 0,
  activated          INTEGER NOT NULL DEFAULT 0,
  contract_url       TEXT,
  activated_by       TEXT,
  lpa_url            TEXT,
  aml_review_date    TEXT,
  re_class_date      TEXT,
  -- "Internal Client" per COI Policy Addendum Section C: a CF&A client that
  -- is also a portfolio company of a fund managed by this GP (self-dealing
  -- risk — mandatory CF Deal Committee + Compliance pre-approval, 20%
  -- annual volume cap, independent valuation). Links to the FM-side
  -- portfolio table so both sides of the Chinese Wall can see the tie
  -- exists without either unit needing direct access to the other's data.
  is_internal_client   INTEGER NOT NULL DEFAULT 0,
  internal_portfolio_id INTEGER REFERENCES portfolio(id),
  -- Client-level KYC checklist summary (Onboarding Templates package,
  -- Templates 1/2/3/4/5/6/8). A queryable projection, not the source of
  -- truth — the full per-field detail (which sanctions list, which tool,
  -- adverse media notes, etc.) still lives in ob_tasks.form_data_json for
  -- the 2.2 (dd_outcome) and 3.1 (classification) tasks; these columns are
  -- set from that data when the task is completed (see submitObTask() in
  -- js/onboarding.js), replacing the old single free-text risk_rating as
  -- the only KYC signal on the client record. (No CRS Self-Certification
  -- column — that form isn't implemented anywhere in the app; see
  -- README's Future Work rather than adding a field nothing can set.)
  identity_verified            INTEGER NOT NULL DEFAULT 0,
  sof_verified                 INTEGER NOT NULL DEFAULT 0,
  sow_verified                 INTEGER NOT NULL DEFAULT 0,
  pep_status                   TEXT,
  sanctions_cleared            INTEGER NOT NULL DEFAULT 0,
  sanctions_checked_at         TEXT,
  professional_client_verified INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The granular per-step workflow tracker (7-step wizard). formData is a
-- genuinely schemaless per-formKey bag in the original app (built by
-- scraping every f_*-prefixed DOM field), so it stays JSON here too.
CREATE TABLE IF NOT EXISTS ob_tasks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  client_id          INTEGER NOT NULL REFERENCES ob_clients(id),
  task_num           TEXT NOT NULL,
  title              TEXT,
  phase              INTEGER,
  role               TEXT,
  form_key           TEXT,
  due_date           TEXT,
  status             TEXT NOT NULL DEFAULT 'locked',
  form_data_json     TEXT NOT NULL DEFAULT '{}',
  completed_at       TEXT,
  completed_by       TEXT
);

-- Free-text notes on a task, separate from form_data_json (the wizard's
-- own structured fields) — append-only, own table rather than a JSON blob
-- on ob_tasks so concurrent commenters can't race a read-modify-write of
-- the same column (the risk the amendments_json/comments_json blobs
-- elsewhere in this schema accept as a deliberate PoC tradeoff).
CREATE TABLE IF NOT EXISTS ob_task_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  task_id     INTEGER NOT NULL REFERENCES ob_tasks(id),
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ob_task_comments_task ON ob_task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_ob_task_comments_tenant ON ob_task_comments(tenant_id);

CREATE TABLE IF NOT EXISTS engagements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  eng_id              TEXT,
  client_id           INTEGER REFERENCES ob_clients(id),
  client_name         TEXT,
  service_type        TEXT,
  contract_num        TEXT,
  date                TEXT,
  signed_date         TEXT,
  status              TEXT NOT NULL DEFAULT 'Draft',
  fee_type            TEXT,
  fee_amount          REAL,
  success_fee         REAL,
  retainer            REAL,
  pay_terms           TEXT,
  invoiced            REAL,
  paid                REAL,
  start_date          TEXT,
  end_date            TEXT,
  rm                  TEXT,
  notes               TEXT,
  direction           TEXT,
  activation_date     TEXT,
  activated_by        TEXT,
  lpa_url             TEXT,
  lp_signed_date      TEXT,
  capital_call_date   TEXT,
  amendments_json     TEXT NOT NULL DEFAULT '[]',
  contract_url        TEXT,
  deal_value          REAL,
  fee_rate            REAL,
  -- Links multiple engagements to the same underlying transaction so a
  -- Dual-Mandate (Advising + Arranging on the SAME deal — COI Addendum
  -- Section D) can be detected: two engagement rows for the same client_id
  -- sharing a deal_ref is exactly that scenario, and per Section A.3 it
  -- requires mandatory CF Deal Committee unanimous review.
  deal_ref            TEXT,
  -- CF&A engagements aren't tied to any fund (a client may not even
  -- reference one), so unlike LP/fund economics this can't be derived
  -- from fund.currency — it's its own independent choice per engagement.
  currency            TEXT NOT NULL DEFAULT 'USD',
  -- Audit trail for updateEngPayment() (js/onboarding.js): who changed
  -- paid/invoiced/deal_ref and when, since those are otherwise silently
  -- overwritten with no history. Same JSON-array-in-a-column tradeoff as
  -- amendments_json above.
  payment_history_json TEXT NOT NULL DEFAULT '[]'
);

-- Digital record of the Decision Matrix (GL-ONB-CF&A-001 Section 4.7) and
-- Escalation Matrix (COI Addendum Section E.1): who decided/approved a
-- given conflict, classification, or engagement, at what risk level, and
-- whether/where it was escalated. One client or engagement can accumulate
-- many of these over time — this is the audit trail the regulator would
-- expect to see, rather than a single free-text status field.
CREATE TABLE IF NOT EXISTS conflict_approvals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL REFERENCES tenants(id),
  client_id          INTEGER REFERENCES ob_clients(id),
  engagement_id      INTEGER REFERENCES engagements(id),
  deal_ref           TEXT,
  decision_type      TEXT NOT NULL,
  -- e.g. 'Client Classification' | 'Routine Conflict' | 'Dual-Mandate' |
  -- 'Internal Client' | 'High-Risk Client' | 'Non-Standard Terms' |
  -- 'Complex/Extraordinary Conflict'
  risk_level         TEXT NOT NULL DEFAULT 'Low',
  -- 'Low' | 'Medium' | 'High' | 'Critical' per Addendum Section E.1
  fee_amount         REAL,
  decision_maker     TEXT,
  -- who actually decided: 'Relationship Manager' | 'Compliance Officer' |
  -- 'AML Officer (MLRO)' | 'CF Deal Committee' | 'SEO' | 'Board of Directors'
  escalated_to       TEXT,
  required_timeline  TEXT,
  -- e.g. 'Within 48 hours', 'Within 5 business days', 'Next quarterly meeting'
  status             TEXT NOT NULL DEFAULT 'Pending',
  -- 'Pending' | 'Approved' | 'Approved with conditions' | 'Rejected' | 'Escalated'
  -- ('Escalated' is now real: POST auto-sets it for High/Critical risk_level,
  -- and PUT requires the deciding user to actually be CEO for those rows —
  -- see the escalation comment on PUT /api/conflict-approvals/:id.)
  description        TEXT,
  rationale          TEXT,
  decided_at         TEXT,
  -- Server-stamped from the authenticated user at decision time, not
  -- client-trusted — decision_maker above is a free-text/role label the
  -- form author picks, not proof of who actually clicked Approve/Reject.
  decided_by         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  -- Same reasoning as engagements.currency — a conflict-approval fee
  -- isn't fund-scoped either.
  currency           TEXT NOT NULL DEFAULT 'USD'
);

CREATE INDEX IF NOT EXISTS idx_lp_register_tenant ON lp_register(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
-- Global, not just per-tenant: one email = one account across every
-- company sharing this database. Without this, two different tenants
-- could each register the same email and POST /api/auth/login's
-- no-tenant-given fallback (SELECT tenant_id FROM users WHERE email = ?)
-- would resolve to an arbitrary one of them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_global ON users(email);
CREATE INDEX IF NOT EXISTS idx_capital_calls_tenant ON capital_calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cc_line_items_call ON capital_call_line_items(call_id);
CREATE INDEX IF NOT EXISTS idx_cc_line_items_tenant ON capital_call_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_distributions_tenant ON distributions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dist_line_items_dist ON distribution_line_items(distribution_id);
CREATE INDEX IF NOT EXISTS idx_dist_line_items_tenant ON distribution_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_tenant ON portfolio(tenant_id);
CREATE INDEX IF NOT EXISTS idx_restricted_list_tenant ON restricted_list(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coi_registry_tenant ON coi_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ob_clients_tenant ON ob_clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ob_tasks_tenant ON ob_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ob_tasks_client ON ob_tasks(client_id);
CREATE INDEX IF NOT EXISTS idx_conflict_approvals_tenant ON conflict_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conflict_approvals_client ON conflict_approvals(client_id);
CREATE INDEX IF NOT EXISTS idx_engagements_deal_ref ON engagements(deal_ref);
-- votes_json holds an array of { role, name, vote }, where role is one of
-- 'GP Rep 1' | 'GP Rep 2' | 'Independent Member' | 'LP Rep' and vote is
-- 'Approve' | 'Reject' | 'Abstain' — mirrors the IC Minutes vote table
-- (Investment & Harvesting Package, Template 4).
--
-- quorum_met / risk_veto / risk_conclusion capture two distinct process
-- facts from the same package that a bare vote count can't: the fund's
-- governing documents require >=3 voting members INCLUDING at least
-- one Independent Member (not just >=3 votes present), and the Risk
-- Manager holds an independent veto separate from the IC vote itself
-- (Template 3 "Risk Manager Conclusion").
CREATE TABLE IF NOT EXISTS ic_memos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  fund_id       INTEGER REFERENCES funds(id),
  deal_id       INTEGER REFERENCES deals(id),
  company       TEXT NOT NULL,
  sector        TEXT,
  amount        REAL,
  type          TEXT,
  stage         TEXT,
  author        TEXT,
  memo_created_at TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  meeting_date  TEXT,
  thesis        TEXT,
  risks         TEXT,
  financials    TEXT,
  exit_plan     TEXT,
  votes_json    TEXT NOT NULL DEFAULT '[]',
  resolution    TEXT,
  quorum_met      INTEGER NOT NULL DEFAULT 0,
  risk_veto       INTEGER NOT NULL DEFAULT 0,
  risk_conclusion TEXT
);

-- Documents / File Vault: this table is the "merge" of what used to be
-- two separate frontend concepts — js/documents.js's docFiles[] (metadata-
-- only demo records) and js/vault.js's "aggregator" (which was never its
-- own data store, just a read-only view combining docFiles + empty task
-- attachments). docFiles is the one that actually holds seeded data, so
-- it becomes the one real backend-tracked entity; vault.js keeps merging
-- it with task attachments (still-empty, still client-side-only, real
-- binary upload storage is out of scope for this pass) at render time —
-- same behavior as today.
CREATE TABLE IF NOT EXISTS documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  fund_id        TEXT,
  name           TEXT NOT NULL,
  category       TEXT,
  size           TEXT,
  date           TEXT,
  uploader       TEXT,
  comments_json  TEXT NOT NULL DEFAULT '[]',
  -- The real file itself (/api/uploads/:id), added alongside the
  -- pre-existing metadata-only fields above once real binary storage
  -- (server/index.js's POST/GET /api/uploads) existed to point it at.
  document_url   TEXT,
  -- No hard delete for a regulated fund's document register — archiving
  -- keeps the row (and its audit trail below) forever; only the "active"
  -- filter changes. archived_by/archived_at are set server-side from the
  -- authenticated user, same as uploader.
  archived       INTEGER NOT NULL DEFAULT 0,
  archived_at    TEXT,
  archived_by    TEXT,
  -- Append-only log of {action, by, at, detail} — uploaded/commented/
  -- archived/restored — independent of comments_json, which is user-
  -- authored content rather than a system audit record.
  history_json   TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_engagements_tenant ON engagements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_engagements_client ON engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_ic_memos_tenant ON ic_memos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON documents(tenant_id);

-- Live, editable permission source of truth (replaces the old static
-- server/roles.js / js/roles.js catalogue). is_system=1 marks the 10
-- built-in roles seeded by server/rolesSeed.js -- their 'code' is immutable
-- and the row is undeletable (seed data / historical audit columns
-- reference these codes by literal string), but every permission flag
-- stays editable, same as on any custom role.
CREATE TABLE IF NOT EXISTS roles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  code              TEXT NOT NULL,
  label             TEXT NOT NULL,
  icon              TEXT NOT NULL DEFAULT 'fa-user',
  color             TEXT NOT NULL DEFAULT '#64748b',
  internal          INTEGER NOT NULL DEFAULT 1,
  manage_users      INTEGER NOT NULL DEFAULT 0,
  manage_roles      INTEGER NOT NULL DEFAULT 0,
  access_fm         INTEGER NOT NULL DEFAULT 1,
  decide_conflicts  INTEGER NOT NULL DEFAULT 0,
  author_ic_memo    INTEGER NOT NULL DEFAULT 0,
  risk_veto         INTEGER NOT NULL DEFAULT 0,
  read_only         INTEGER NOT NULL DEFAULT 0,
  -- AML/SoF clearance on a capital-call payment (markLpAmlOk, js/lp-
  -- register.js) is a compliance judgment, not an operational fact like
  -- recording that a wire arrived — restricted to Compliance
  -- Officer/MLRO by default, same reasoning as risk_veto being separate
  -- from ordinary IC voting.
  aml_clear         INTEGER NOT NULL DEFAULT 0,
  -- A Capital Call moving from Draft to Pending is the moment it becomes
  -- a real, live cash call on every LP of the fund — restricted to
  -- CEO/CFO by default so the person who drafted it (any accessFM
  -- staffer) can't also be the one who sends it.
  cc_approve        INTEGER NOT NULL DEFAULT 0,
  -- Confirming a Capital Call line item as actually Paid is a bank-
  -- reconciliation judgment (does the wire reference/amount on the
  -- statement really match this LP's call?), not something the person
  -- who created or approved the call should self-certify — restricted
  -- to CFO/CEO by default, same segregation-of-duties reasoning as
  -- cc_approve and aml_clear.
  payment_confirm   INTEGER NOT NULL DEFAULT 0,
  -- Marking a regulatory filing as actually submitted is a regulatory
  -- assertion ("this was really filed with the regulator"), same
  -- reasoning as payment_confirm — restricted by default to the roles
  -- who'd realistically be the one filing (CFO/CEO for financial
  -- reports, Compliance Officer/MLRO for the AML/compliance set).
  afsa_submit       INTEGER NOT NULL DEFAULT 0,
  -- Gates the onboarding AI-assist routes (server/aiProvider.js's
  -- completeJson, called from POST /api/ob-tasks/:id/ai-draft|ai-extract
  -- and POST /api/ob-clients/:id/ai-screen) — every one of those routes
  -- only ever fills a form field as an editable draft, never writes to
  -- ob_clients/ob_tasks itself, so this permission controls who can see
  -- AI suggestions, not who can approve anything.
  ai_assist         INTEGER NOT NULL DEFAULT 0,
  ic_seat           TEXT,
  is_system         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_icseat ON roles(tenant_id, ic_seat) WHERE ic_seat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- Real uploaded files (server/index.js's POST/GET /api/uploads) — every
-- document reference elsewhere in this app (pitchDeckUrl, closingCertUrl,
-- wireConfirmUrl, ...) is a plain "paste a link" TEXT field with no
-- actual file storage behind it; this is the one place that stores real
-- file bytes on disk (server/data/uploads/), keyed by an unguessable
-- stored_name so the original filename never becomes a path. A row's
-- @tenantId is checked on every download (GET /api/uploads/:id) so one
-- tenant can never fetch another's file by guessing an id.
CREATE TABLE IF NOT EXISTS uploaded_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  stored_name    TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  mime_type      TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  uploaded_by    TEXT,
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_tenant ON uploaded_files(tenant_id);

-- One row per fund tracking its First Closing checklist (js/app.js's
-- renderClosing()) -- this used to be a single hardcoded, never-
-- persisted, never-fund-scoped object (js/data.js's firstClosingState),
-- so every value on that whole page was fake and shared across every
-- fund in the tenant.
CREATE TABLE IF NOT EXISTS first_closing (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id               INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                 INTEGER NOT NULL REFERENCES funds(id),
  board_resolution_url    TEXT,
  closing_cert_url        TEXT,
  closing_date            TEXT,
  first_cc_id             INTEGER,
  afsa_notif_date         TEXT,
  afsa_notif_num          TEXT,
  afsa_confirm_url        TEXT,
  welcome_letter_log_json TEXT NOT NULL DEFAULT '[]',
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, fund_id)
);

-- Approval workflow engine (KYC CO->MLRO->CEO, IC deal review, Capital Call
-- and Subscription Agreement sign-off). steps_json holds the full ordered
-- step array (role/label/action/completedAt/completedBy/decision/comment)
-- as one blob, same tradeoff as ic_memos.votes_json -- steps are always
-- read/written as a whole, never queried individually across instances.
CREATE TABLE IF NOT EXISTS workflow_instances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  type          TEXT NOT NULL,
  entity_id     INTEGER,
  entity_name   TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  current_step  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  steps_json    TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_tenant ON workflow_instances(tenant_id);

-- Regulatory filings (quarterly/annual financial reports + the fixed
-- compliance set: AML/CTF report, breach notifications, annual compliance
-- report). Replaces the old js/data.js reportSchedule static array —
-- that had no backend at all, so a report's status could never actually
-- be updated from the UI. One row per filing obligation; report_type
-- values are 'Quarterly' | 'Annual' | 'AML/CTF' | 'Breach Notification' |
-- 'Annual Compliance'. Breach Notification rows aren't on any recurring
-- schedule (only created ad hoc if an actual breach happens), so none are
-- seeded by default.
CREATE TABLE IF NOT EXISTS afsa_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  fund_id           INTEGER REFERENCES funds(id),
  report_type       TEXT NOT NULL,
  period            TEXT NOT NULL,
  deadline          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Ожидается',
  resp              TEXT,
  submitted_at      TEXT,
  submitted_by      TEXT,
  document_url      TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_afsa_reports_tenant ON afsa_reports(tenant_id);

-- Machine-to-machine access (future AI/integration use) — a completely
-- separate identity space from internal users/roles above, same spirit
-- as the portal's own separate identity space. key_hash is SHA-256, not
-- bcrypt: API keys are already high-entropy random strings, not
-- human-guessable passwords, so they don't need slow hashing on every
-- request. key_prefix is stored in the clear so staff can identify a key
-- in the admin UI without the full value ever being retrievable again
-- after creation. scopes_json is a small, deliberately separate
-- vocabulary from the human permission keys in the roles table (read:lp,
-- read:portfolio, etc.) — those are fund-governance concepts (IC votes,
-- AML, Capital Call approval) that don't map onto "what can this
-- integration read".
CREATE TABLE IF NOT EXISTS api_keys (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  name              TEXT NOT NULL,
  key_prefix        TEXT NOT NULL,
  key_hash          TEXT NOT NULL,
  scopes_json       TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  created_by        TEXT,
  last_used_at      TEXT,
  revoked_at        TEXT,
  revoked_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Idempotency ledger for server/notifications/* — one row per email
-- actually sent (or console-logged, when SMTP isn't configured; see
-- mailer.js), so the same event never re-notifies the same person twice.
-- An instant trigger (e.g. "Capital Call created") checks for an existing
-- row with this exact (event_type, entity_id, recipient_email) before ever
-- sending; a digest trigger additionally scopes by day (see notify.js)
-- since the same underlying condition legitimately re-fires once per day
-- until resolved.
-- Keyed by recipient_email rather than a recipient_id FK on purpose: a
-- recipient can be a users row (CEO/CFO/Compliance) OR an lp_register
-- row (an LP being notified about their own Capital Call/Distribution) —
-- two different id spaces that would otherwise collide (LP #5 and User #5
-- are unrelated people). What actually matters for "don't double-email
-- someone" is the address itself, which every recipient has either way.
CREATE TABLE IF NOT EXISTS notification_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  event_type       TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        INTEGER NOT NULL,
  recipient_email  TEXT NOT NULL,
  sent_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_log_tenant ON notification_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_dedup ON notification_log(tenant_id, event_type, entity_id, recipient_email);

-- Cross-module "who/what/when" event log (server/auditLog.js) — v1 is
-- event-only by deliberate choice, no per-field old->new diff: fewer
-- places to accidentally leak a sensitive value (passwords, PII) into a
-- log line, and a summary sentence is enough to answer "who touched this
-- record and when" without needing a diff viewer. Scoped to the modules
-- that already function as a governance/regulatory record (LP register,
-- Capital Calls, Distributions, Portfolio, Deals, Conflict Approvals,
-- Engagements) rather than every mutating route in the app — see the
-- module's own header comment for why a blanket middleware was rejected.
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER NOT NULL,
  action        TEXT NOT NULL,
  actor_email   TEXT NOT NULL,
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(tenant_id, entity_type, entity_id);

-- Hedge Fund module (docs/TZ_Hedge_Fund_Module.md), Stage 1: schema + CRUD
-- only — no business logic yet. Only ever populated for funds with
-- asset_class='hedge_fund'/operating_model='open-end' (see the migration
-- below); a closed-end (PE/VC/REIT) fund never gets rows here, it uses
-- capital_calls/distributions/waterfallEngine.js instead (see
-- docs/ARCHITECTURE_Multi_Strategy_Roadmap.md §3 for why these are a
-- separate, non-overlapping track rather than an extension of the
-- closed-end tables).
--
-- nav_per_unit_at_entry/units_issued/lockup_until (subscriptions) and
-- notice_expires/nav_per_unit_at_exit/amount/lockup_ok/gate_applied/
-- gate_pct_applied (redemptions) are all SERVER-computed once the
-- Stage-2 processing logic exists — Stage 1 only stores whatever a
-- caller explicitly sends for them (usually null at creation), it does
-- not compute anything.
CREATE TABLE IF NOT EXISTS hf_subscriptions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                INTEGER REFERENCES funds(id),
  lp_id                  INTEGER NOT NULL REFERENCES lp_register(id),
  sub_number             TEXT NOT NULL,
  request_date           TEXT,
  amount                 REAL NOT NULL DEFAULT 0,
  nav_per_unit_at_entry  REAL,
  units_issued           REAL,
  effective_date         TEXT,
  lockup_until           TEXT,
  status                 TEXT NOT NULL DEFAULT 'Pending',
  created_by             TEXT,
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hf_subscriptions_tenant ON hf_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS hf_redemptions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                INTEGER REFERENCES funds(id),
  lp_id                  INTEGER NOT NULL REFERENCES lp_register(id),
  redemption_number      TEXT NOT NULL,
  request_date           TEXT,
  units_requested        REAL NOT NULL DEFAULT 0,
  notice_expires         TEXT,
  effective_date         TEXT,
  nav_per_unit_at_exit   REAL,
  amount                 REAL,
  lockup_ok              INTEGER,
  gate_applied           INTEGER NOT NULL DEFAULT 0,
  gate_pct_applied       REAL,
  status                 TEXT NOT NULL DEFAULT 'Requested',
  created_by             TEXT,
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hf_redemptions_tenant ON hf_redemptions(tenant_id);

-- nav_total/nav_per_unit ARE computed at write time even in Stage 1 (see
-- POST/PUT /api/hf/nav in server/index.js) — that's plain arithmetic
-- (gross_asset_value - liabilities, and division by units_outstanding),
-- not the risky "business logic" (lockup/gate/fee) Stage 1 is deliberately
-- deferring. units_outstanding itself is a manual input here — nothing
-- writes hf_investor_positions yet (that starts Stage 2), so there is no
-- live number to sum.
CREATE TABLE IF NOT EXISTS hf_nav_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  fund_id             INTEGER REFERENCES funds(id),
  as_of_date          TEXT NOT NULL,
  gross_asset_value   REAL NOT NULL DEFAULT 0,
  liabilities         REAL NOT NULL DEFAULT 0,
  nav_total           REAL,
  units_outstanding   REAL,
  nav_per_unit        REAL,
  status              TEXT NOT NULL DEFAULT 'Draft',
  entered_by          TEXT,
  published_by        TEXT,
  published_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hf_nav_history_tenant ON hf_nav_history(tenant_id, fund_id, as_of_date);

-- Not written to by anything yet in Stage 1 — units_held/high_water_mark
-- only start getting real values once Stage 2 (subscription/redemption
-- processing) and Stage 3 (performanceFeeEngine.js) exist. Table created
-- now so those stages are pure logic additions, not another migration.
CREATE TABLE IF NOT EXISTS hf_investor_positions (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                 INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                   INTEGER REFERENCES funds(id),
  lp_id                     INTEGER NOT NULL REFERENCES lp_register(id),
  units_held                REAL NOT NULL DEFAULT 0,
  high_water_mark_per_unit  REAL NOT NULL DEFAULT 0,
  last_fee_crystallization_date TEXT,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, fund_id, lp_id)
);
CREATE INDEX IF NOT EXISTS idx_hf_investor_positions_tenant ON hf_investor_positions(tenant_id);

CREATE TABLE IF NOT EXISTS hf_fee_crystallizations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                INTEGER REFERENCES funds(id),
  lp_id                  INTEGER NOT NULL REFERENCES lp_register(id),
  period_start           TEXT,
  period_end             TEXT,
  nav_per_unit_start     REAL,
  nav_per_unit_end       REAL,
  hwm_before             REAL,
  hwm_after              REAL,
  gain_per_unit          REAL,
  performance_fee_pct    REAL,
  fee_amount             REAL,
  units_deducted_for_fee REAL,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hf_fee_crystallizations_tenant ON hf_fee_crystallizations(tenant_id);

-- VC cap table + SPV module (docs/TZ_VC_Module.md), Stage 1: schema + CRUD
-- only — no business logic yet (ownership_pct_post computation and SPV
-- capital-call/distribution processing land in Stage 2). Only meaningful
-- for asset_class='vc' funds but harmless/unused for PE. Unlike Hedge
-- Fund, VC reuses capital_calls/distributions/waterfallEngine.js
-- unmodified for the fund's own economics (docs/ARCHITECTURE_Multi_
-- Strategy_Roadmap.md §3.1) — these new tables cover only what's
-- genuinely new: multi-round cap table dilution and SPV co-invest
-- vehicles, neither of which had any prior representation.
CREATE TABLE IF NOT EXISTS portfolio_rounds (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  portfolio_id      INTEGER NOT NULL REFERENCES portfolio(id),
  round_name        TEXT,
  round_date        TEXT,
  instrument        TEXT,
  pre_money         REAL,
  post_money        REAL,
  amount_raised     REAL,
  price_per_share   REAL,
  is_fund_round     INTEGER NOT NULL DEFAULT 0,
  source_deal_id    INTEGER REFERENCES deals(id),
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolio_rounds_tenant ON portfolio_rounds(tenant_id);

-- ownership_pct_post is SERVER-computed (cumulative dilution across all
-- rounds of the company) once Stage 2 exists — Stage 1 stores whatever a
-- caller sends (usually null at creation), it does not compute anything.
CREATE TABLE IF NOT EXISTS portfolio_round_investors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  round_id            INTEGER NOT NULL REFERENCES portfolio_rounds(id),
  investor_name       TEXT NOT NULL,
  investor_type       TEXT,
  is_own_fund         INTEGER NOT NULL DEFAULT 0,
  spv_id              INTEGER REFERENCES spvs(id),
  amount              REAL,
  shares              REAL,
  ownership_pct_post  REAL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portfolio_round_investors_tenant ON portfolio_round_investors(tenant_id);

CREATE TABLE IF NOT EXISTS spvs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  fund_id                INTEGER NOT NULL REFERENCES funds(id),
  portfolio_id           INTEGER REFERENCES portfolio(id),
  deal_id                INTEGER REFERENCES deals(id),
  name                   TEXT NOT NULL,
  legal_entity_name      TEXT,
  jurisdiction           TEXT,
  formation_date         TEXT,
  status                 TEXT NOT NULL DEFAULT 'Forming',
  target_size            REAL,
  currency               TEXT DEFAULT 'USD',
  management_fee_pct     REAL DEFAULT 0,
  carried_interest_pct   REAL DEFAULT 20,
  preferred_return_pct   REAL DEFAULT 0,
  catch_up_pct           REAL DEFAULT 100,
  gp_entity              TEXT,
  notes                  TEXT,
  created_by             TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spvs_tenant ON spvs(tenant_id);

CREATE TABLE IF NOT EXISTS spv_investors (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  spv_id           INTEGER NOT NULL REFERENCES spvs(id),
  lp_id            INTEGER REFERENCES lp_register(id),
  name             TEXT NOT NULL,
  investor_type    TEXT,
  email            TEXT,
  contact          TEXT,
  commitment       REAL NOT NULL DEFAULT 0,
  called_amount    REAL NOT NULL DEFAULT 0,
  paid_amount      REAL NOT NULL DEFAULT 0,
  distributions    REAL NOT NULL DEFAULT 0,
  kyc_status       TEXT DEFAULT 'Pending',
  status           TEXT NOT NULL DEFAULT 'Active',
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spv_investors_tenant ON spv_investors(tenant_id);

-- Column-for-column mirror of capital_calls/capital_call_line_items
-- above, scoped by spv_id/spv_investor_id instead of fund_id/lp_id — see
-- docs/TZ_VC_Module.md §2.3 for why this is a separate mirrored table
-- rather than a nullable spv_id on the real capital_calls table (lp_id
-- there is NOT NULL REFERENCES lp_register, and SPV investors are often
-- not fund LPs at all).
CREATE TABLE IF NOT EXISTS spv_capital_calls (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id             INTEGER NOT NULL REFERENCES tenants(id),
  spv_id                INTEGER NOT NULL REFERENCES spvs(id),
  cc_number             TEXT NOT NULL,
  notice_date           TEXT,
  payment_date          TEXT,
  total_amount          REAL NOT NULL DEFAULT 0,
  pct_of_commit         REAL NOT NULL DEFAULT 0,
  purpose               TEXT,
  purpose_type          TEXT,
  status                TEXT NOT NULL DEFAULT 'Draft',
  bank_ref              TEXT,
  created_by            TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spv_capital_calls_tenant ON spv_capital_calls(tenant_id);

CREATE TABLE IF NOT EXISTS spv_capital_call_line_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  call_id          INTEGER NOT NULL REFERENCES spv_capital_calls(id),
  spv_investor_id  INTEGER NOT NULL REFERENCES spv_investors(id),
  commitment       REAL NOT NULL DEFAULT 0,
  pct              REAL NOT NULL DEFAULT 0,
  called           REAL NOT NULL DEFAULT 0,
  paid             REAL NOT NULL DEFAULT 0,
  payment_date     TEXT,
  status           TEXT NOT NULL DEFAULT 'Pending',
  wire_ref         TEXT,
  wire_confirm_url TEXT,
  aml_ok           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spv_cc_line_items_tenant ON spv_capital_call_line_items(tenant_id);

CREATE TABLE IF NOT EXISTS spv_distributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  spv_id              INTEGER NOT NULL REFERENCES spvs(id),
  dist_number         TEXT NOT NULL,
  notice_date         TEXT,
  payment_date        TEXT,
  total_amount        REAL NOT NULL DEFAULT 0,
  source_type         TEXT,
  roc_amount          REAL NOT NULL DEFAULT 0,
  profit_amount       REAL NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'Draft',
  created_by          TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spv_distributions_tenant ON spv_distributions(tenant_id);

CREATE TABLE IF NOT EXISTS spv_distribution_line_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  distribution_id  INTEGER NOT NULL REFERENCES spv_distributions(id),
  spv_investor_id  INTEGER NOT NULL REFERENCES spv_investors(id),
  pct              REAL NOT NULL DEFAULT 0,
  gross_amount     REAL NOT NULL DEFAULT 0,
  gp_carry_amount  REAL NOT NULL DEFAULT 0,
  net_amount       REAL NOT NULL DEFAULT 0,
  payment_date     TEXT,
  status           TEXT NOT NULL DEFAULT 'Pending',
  wire_ref         TEXT,
  wire_confirm_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_spv_dist_line_items_tenant ON spv_distribution_line_items(tenant_id);
`);

// `CREATE TABLE IF NOT EXISTS` above only applies to a brand-new DB file —
// it silently no-ops against an existing crm.sqlite that predates a column
// addition. Any column added to an existing table after go-live needs an
// explicit guarded ALTER TABLE here.
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
if (!columnExists('users', 'name'))   db.exec("ALTER TABLE users ADD COLUMN name TEXT");
if (!columnExists('users', 'active')) db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
// Set to 1 whenever an admin sets a user's password for them (new account
// creation or an admin-triggered reset) — cleared back to 0 only once the
// user picks their own via PUT /api/users/me/password. requireAuth (server/
// auth.js) blocks every route except that self-service change route while
// this is set, so an admin-known temporary password can't be used past the
// first login.
if (!columnExists('users', 'must_change_password')) db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
for (const table of ['lp_register', 'capital_calls', 'deals', 'portfolio', 'ic_memos']) {
  if (!columnExists(table, 'fund_id')) db.exec(`ALTER TABLE ${table} ADD COLUMN fund_id INTEGER REFERENCES funds(id)`);
}
if (!columnExists('roles', 'read_only')) db.exec("ALTER TABLE roles ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
if (!columnExists('roles', 'aml_clear')) db.exec("ALTER TABLE roles ADD COLUMN aml_clear INTEGER NOT NULL DEFAULT 0");
// upsertRole() (server/tenantProvisioning.js) only inserts missing roles,
// never updates existing ones — so adding aml_clear to rolesSeed.js above
// has no effect on a tenant whose system roles were already seeded before
// this column existed. One-time backfill, idempotent via the WHERE guard.
db.exec("UPDATE roles SET aml_clear = 1 WHERE is_system = 1 AND code IN ('COMPLIANCE_OFFICER', 'MLRO') AND aml_clear = 0");
if (!columnExists('roles', 'cc_approve')) db.exec("ALTER TABLE roles ADD COLUMN cc_approve INTEGER NOT NULL DEFAULT 0");
db.exec("UPDATE roles SET cc_approve = 1 WHERE is_system = 1 AND code IN ('CEO', 'CFO') AND cc_approve = 0");
if (!columnExists('roles', 'payment_confirm')) db.exec("ALTER TABLE roles ADD COLUMN payment_confirm INTEGER NOT NULL DEFAULT 0");
db.exec("UPDATE roles SET payment_confirm = 1 WHERE is_system = 1 AND code IN ('CEO', 'CFO') AND payment_confirm = 0");
if (!columnExists('roles', 'afsa_submit')) db.exec("ALTER TABLE roles ADD COLUMN afsa_submit INTEGER NOT NULL DEFAULT 0");
db.exec("UPDATE roles SET afsa_submit = 1 WHERE is_system = 1 AND code IN ('CEO', 'CFO', 'COMPLIANCE_OFFICER', 'MLRO') AND afsa_submit = 0");
if (!columnExists('roles', 'ai_assist')) db.exec("ALTER TABLE roles ADD COLUMN ai_assist INTEGER NOT NULL DEFAULT 0");
db.exec("UPDATE roles SET ai_assist = 1 WHERE is_system = 1 AND code IN ('RELATIONSHIP_MANAGER', 'COMPLIANCE_OFFICER', 'MLRO') AND ai_assist = 0");
if (!columnExists('documents', 'document_url')) db.exec("ALTER TABLE documents ADD COLUMN document_url TEXT");
if (!columnExists('documents', 'archived')) db.exec("ALTER TABLE documents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
if (!columnExists('documents', 'archived_at')) db.exec("ALTER TABLE documents ADD COLUMN archived_at TEXT");
if (!columnExists('documents', 'archived_by')) db.exec("ALTER TABLE documents ADD COLUMN archived_by TEXT");
if (!columnExists('documents', 'history_json')) db.exec("ALTER TABLE documents ADD COLUMN history_json TEXT NOT NULL DEFAULT '[]'");
if (!columnExists('conflict_approvals', 'decided_by')) db.exec("ALTER TABLE conflict_approvals ADD COLUMN decided_by TEXT");
if (!columnExists('capital_call_line_items', 'wire_confirm_url')) db.exec("ALTER TABLE capital_call_line_items ADD COLUMN wire_confirm_url TEXT");
for (const table of ['engagements', 'conflict_approvals']) {
  if (!columnExists(table, 'currency')) db.exec(`ALTER TABLE ${table} ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`);
}
if (!columnExists('engagements', 'payment_history_json')) db.exec("ALTER TABLE engagements ADD COLUMN payment_history_json TEXT NOT NULL DEFAULT '[]'");
for (const col of ['dd_risk_json', 'dd_compliance_json', 'dd_mlro_json']) {
  if (!columnExists('deals', col)) db.exec(`ALTER TABLE deals ADD COLUMN ${col} TEXT NOT NULL DEFAULT '[]'`);
}
if (!columnExists('deals', 'dd_conclusions_json')) db.exec("ALTER TABLE deals ADD COLUMN dd_conclusions_json TEXT NOT NULL DEFAULT '[]'");
for (const col of ['gp_conclusion_verdict', 'gp_conclusion_summary', 'gp_conclusion_signed_by', 'gp_conclusion_signed_at']) {
  if (!columnExists('deals', col)) db.exec(`ALTER TABLE deals ADD COLUMN ${col} TEXT`);
}
for (const col of ['ts_rights', 'ts_vesting', 'ts_signed_date', 'ts_status', 'ts_company_lawyer',
  'wire_date', 'closing_date_planned', 'closed_date', 'first_board_meeting', 'kpi_6m', 'kpi_12m']) {
  if (!columnExists('deals', col)) db.exec(`ALTER TABLE deals ADD COLUMN ${col} TEXT`);
}
for (const col of ['ts_pre_money', 'ts_post_money', 'ts_fund_share', 'closed_amount', 'closed_valuation']) {
  if (!columnExists('deals', col)) db.exec(`ALTER TABLE deals ADD COLUMN ${col} REAL`);
}
for (const col of ['neg_meetings_json', 'neg_disputed_items_json', 'neg_blockers_json']) {
  if (!columnExists('deals', col)) db.exec(`ALTER TABLE deals ADD COLUMN ${col} TEXT NOT NULL DEFAULT '[]'`);
}
// Portfolio has no existing "closed" status concept (unlike LP's 'Exited' or
// engagements' 'Terminated'), so DELETE /api/portfolio/:id offers this as
// its soft alternative when hard-delete is blocked — same archive-not-delete
// shape as documents.archived* above.
if (!columnExists('portfolio', 'archived')) db.exec("ALTER TABLE portfolio ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
if (!columnExists('portfolio', 'archived_at')) db.exec("ALTER TABLE portfolio ADD COLUMN archived_at TEXT");
if (!columnExists('portfolio', 'archived_by')) db.exec("ALTER TABLE portfolio ADD COLUMN archived_by TEXT");
// Nullable: a company with no password set yet simply can't log into the
// portal (no fallback to anything guessable) until staff generates one —
// see PUT /api/portfolio/:id/portal-password (server/index.js).
if (!columnExists('portfolio', 'portal_password_hash')) db.exec("ALTER TABLE portfolio ADD COLUMN portal_password_hash TEXT");
// Management company (GP) identity/banking details for this fund — used
// to fill in generated LP-facing documents (welcome letters, capital call
// notices, capital account statements). Per-fund rather than per-tenant
// since a management company can run multiple funds under different GP
// entities/accounts; `gp` and `license` already existed as columns.
for (const col of ['gp_ceo', 'gp_title', 'gp_address', 'gp_bin', 'gp_bank_name', 'gp_bic', 'gp_iban_kzt', 'gp_iban_usd']) {
  if (!columnExists('funds', col)) db.exec(`ALTER TABLE funds ADD COLUMN ${col} TEXT`);
}
// LP self-service portal login (mirrors portfolio.portal_password_hash —
// a separate identity space from both, since an LP and a portfolio
// company are different stakeholders with different data to see).
if (!columnExists('lp_register', 'portal_password_hash')) db.exec("ALTER TABLE lp_register ADD COLUMN portal_password_hash TEXT");
// Document links for the LP's own governing paperwork — same "paste a
// link you already have" convention as pitchDeckUrl/closingCertUrl/etc.
// elsewhere in this app (no real binary storage for these). Previously
// the frontend displayed an `lp.lpaUrl` that was never actually backed
// by a lp_register column — it only ever existed as an in-memory copy
// from the onboarding activation task, so it silently vanished on the
// next page reload / API refetch. These two real columns fix that.
// contract_num has the exact same "displayed but never persisted" bug —
// registerLPFromOnboarding() (js/lp-register.js) has been sending it in
// the POST /api/lp body all along, silently dropped since there was no
// column to bind it to.
for (const col of ['lpa_url', 'sa_url', 'contract_num']) {
  if (!columnExists('lp_register', col)) db.exec(`ALTER TABLE lp_register ADD COLUMN ${col} TEXT`);
}
// Waterfall parameters (server/waterfallEngine.js, not yet built) — every
// fund gets a sane closed-end default (full catch-up, European/whole-fund
// hurdle) rather than NULL, so a fund created before this column existed
// doesn't silently compute as "no catch-up, no hurdle".
if (!columnExists('funds', 'catch_up_pct'))   db.exec("ALTER TABLE funds ADD COLUMN catch_up_pct REAL DEFAULT 100");
if (!columnExists('funds', 'waterfall_type')) db.exec("ALTER TABLE funds ADD COLUMN waterfall_type TEXT DEFAULT 'european'");

// Expiry of the primary identity document (passport / certificate of
// incorporation, ...) reviewed during DD Outcome (2.2) — set from
// f_idDocExpiry in that task's form, not required at client creation, so
// this stays nullable rather than backfilled to a fake default. Powers
// the document-expiry digest check (server/notifications/digestChecks.js).
if (!columnExists('ob_clients', 'id_document_expiry')) db.exec("ALTER TABLE ob_clients ADD COLUMN id_document_expiry TEXT");

// Multi-strategy foundation (docs/ARCHITECTURE_Multi_Strategy_Roadmap.md
// §3) — asset_class is the client-settable driver ('pe' | 'vc' | 'reit' |
// 'hedge_fund'); operating_model is DERIVED from it server-side (see
// fundMapping.js's operatingModelForAssetClass()) and stored so the rest
// of the app branches on one cheap column read instead of a string
// comparison against asset_class everywhere. Every existing fund defaults
// to 'pe'/'closed-end' — the only values this codebase has ever actually
// meant until now — so this migration changes no existing fund's behavior.
if (!columnExists('funds', 'asset_class'))     db.exec("ALTER TABLE funds ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'pe'");
if (!columnExists('funds', 'operating_model')) db.exec("ALTER TABLE funds ADD COLUMN operating_model TEXT NOT NULL DEFAULT 'closed-end'");

// Hedge Fund per-fund settings (docs/TZ_Hedge_Fund_Module.md §2.1) — only
// meaningful for operating_model='open-end' funds, but harmless (unused)
// on a closed-end one, same tolerance as catch_up_pct/waterfall_type
// above. hwm_scope is intentionally NOT exposed via fundMapping.js's
// SCALAR_FIELDS/API — this project committed to Series accounting (HWM
// lives per hf_investor_positions row, not per-fund), so 'fund' scope has
// no implemented behavior; only 'investor' does anything. Same "column
// exists, but only one value is real" precedent as waterfall_type.
// Security fix (uploads IDOR audit) — GET /api/uploads/:id previously
// trusted ANY valid tenant token (internal OR portal) to fetch ANY file
// in the tenant, because this table never recorded which portfolio
// company a portal-uploaded file actually belongs to (auth.js's
// signPortalToken comment explicitly documented this as a known
// simplification). NULL = uploaded by internal staff (not portal-owned,
// unaffected); set only by POST /api/portal/uploads. GET /api/uploads/:id
// now requires this to match the requesting portal token's own
// portfolioId — see server/index.js.
if (!columnExists('uploaded_files', 'portal_portfolio_id')) db.exec("ALTER TABLE uploaded_files ADD COLUMN portal_portfolio_id INTEGER REFERENCES portfolio(id)");

// Waterfall retroactivity fix (QA Data Integrity audit) — snapshots the
// fund's/SPV's carry terms onto each distribution AT CREATION TIME, so
// replayWaterfallState() (server/waterfallEngine.js) can replay a prior
// distribution against the terms that actually applied to it instead of
// whatever the fund's/SPV's terms happen to be today. NULL = distribution
// created before this column existed — replay falls back to the current
// fund/SPV terms for those (see waterfallEngine.js's own comment), same
// "no fake precision for old data" principle as elsewhere in this file.
for (const col of ['preferred_return_snapshot', 'carried_interest_snapshot', 'catch_up_pct_snapshot']) {
  if (!columnExists('distributions', col)) db.exec(`ALTER TABLE distributions ADD COLUMN ${col} REAL`);
  if (!columnExists('spv_distributions', col)) db.exec(`ALTER TABLE spv_distributions ADD COLUMN ${col} REAL`);
}

// Session invalidation (QA Security audit) — logout and password change/
// reset previously had no way to invalidate an already-issued JWT; it
// just kept working until its own 12h expiry regardless. Bumped by
// POST /api/auth/logout and both password-change/reset routes
// (server/index.js); embedded in the JWT at sign time and compared on
// every request in requireAuth() (server/auth.js) — a mismatch means
// this specific token was issued before the user's last logout/password
// change, so it's rejected even though it hasn't technically expired.
// A single per-user counter, not per-token: this is "invalidate every
// session for this user" (logout-everywhere), not single-device logout —
// there's no per-device session table in this app to do finer-grained
// revocation, and that's a strict improvement over the previous "nothing
// ever gets invalidated" behavior.
if (!columnExists('users', 'token_version')) db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");

// Account-level lockout (QA Security audit) — authRateLimit above only
// throttles by IP across ALL accounts; it does nothing to stop repeated
// guesses against ONE specific account from many different IPs. Reset to
// 0/NULL on a successful login; POST /api/auth/login (server/index.js)
// locks the account for LOCKOUT_DURATION_MS once failed_login_attempts
// reaches MAX_FAILED_LOGIN_ATTEMPTS.
if (!columnExists('users', 'failed_login_attempts')) db.exec("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0");
if (!columnExists('users', 'locked_until')) db.exec("ALTER TABLE users ADD COLUMN locked_until TEXT");

if (!columnExists('funds', 'performance_fee_pct'))  db.exec("ALTER TABLE funds ADD COLUMN performance_fee_pct REAL DEFAULT 20");
if (!columnExists('funds', 'hf_hurdle_rate'))        db.exec("ALTER TABLE funds ADD COLUMN hf_hurdle_rate REAL DEFAULT 0");
if (!columnExists('funds', 'hwm_scope'))             db.exec("ALTER TABLE funds ADD COLUMN hwm_scope TEXT DEFAULT 'investor'");
if (!columnExists('funds', 'subscription_frequency')) db.exec("ALTER TABLE funds ADD COLUMN subscription_frequency TEXT DEFAULT 'monthly'");
if (!columnExists('funds', 'redemption_frequency'))   db.exec("ALTER TABLE funds ADD COLUMN redemption_frequency TEXT DEFAULT 'quarterly'");
if (!columnExists('funds', 'redemption_notice_days')) db.exec("ALTER TABLE funds ADD COLUMN redemption_notice_days INTEGER DEFAULT 60");
if (!columnExists('funds', 'lockup_months'))          db.exec("ALTER TABLE funds ADD COLUMN lockup_months INTEGER DEFAULT 12");
if (!columnExists('funds', 'gate_pct'))               db.exec("ALTER TABLE funds ADD COLUMN gate_pct REAL DEFAULT 25");
if (!columnExists('funds', 'fee_crystallization_frequency')) db.exec("ALTER TABLE funds ADD COLUMN fee_crystallization_frequency TEXT DEFAULT 'annual'");

// node:sqlite's StatementSync binds named params as object keys that
// INCLUDE the sigil used in the SQL (e.g. SQL "@name" <-> key "@name").
// This helper lets the rest of the codebase pass plain camelCase keys.
function at(params) {
  const out = {};
  for (const k of Object.keys(params)) out['@' + k] = params[k];
  return out;
}

module.exports = { db, at };
