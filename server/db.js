// ============================================================
//  DB layer — SQLite via Node's built-in node:sqlite module
//  (no native compilation required — avoids the node-gyp/Python
//  toolchain that better-sqlite3 needs, which isn't available
//  in this environment).
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

const DB_PATH = path.join(__dirname, 'data', 'crm.sqlite');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

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
-- many of these over time — this is the audit trail the regulator (AFSA)
-- would expect to see, rather than a single free-text status field.
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
-- facts from the same package that a bare vote count can't: quorum per
-- Constitution Section 7 requires >=3 voting members INCLUDING at least
-- one Independent Member (not just >=3 votes present), and the Risk
-- Manager holds an independent veto separate from the IC vote itself
-- (Constitution Section 7.7, Template 3 "Risk Manager Conclusion").
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
  -- Marking an AFSA filing as actually submitted is a regulatory
  -- assertion ("this was really filed with the regulator"), same
  -- reasoning as payment_confirm — restricted by default to the roles
  -- who'd realistically be the one filing (CFO/CEO for financial
  -- reports, Compliance Officer/MLRO for the AML/compliance set).
  afsa_submit       INTEGER NOT NULL DEFAULT 0,
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

-- AFSA regulatory filings (quarterly/annual financial reports + the fixed
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

// node:sqlite's StatementSync binds named params as object keys that
// INCLUDE the sigil used in the SQL (e.g. SQL "@name" <-> key "@name").
// This helper lets the rest of the codebase pass plain camelCase keys.
function at(params) {
  const out = {};
  for (const k of Object.keys(params)) out['@' + k] = params[k];
  return out;
}

module.exports = { db, at };
