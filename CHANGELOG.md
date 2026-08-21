# Changelog

Version and date are updated here on every push to GitHub.

## [1.38.0] - 2026-08-21

### Added
- Optimistic locking (opt-in) for `deals`/`lp_register`/`portfolio`: new
  `version` column, incremented on every successful `PUT`. When the
  caller supplies `version` in the body, a mismatch against the
  current row now returns 409 with the current record instead of
  silently overwriting it. Every existing granular partial-update
  call site (none of which send `version`) is unaffected — this only
  activates for callers that opt in. QA Data Integrity audit finding.
- `POST /api/lp` now validates `obClientId` when one is supplied: it
  must reference a real onboarding client in this tenant with
  `activated=1`, closing the gap between what the LP Register banner
  claimed ("direct entry never bypasses KYC/AML") and what the server
  actually enforced (nothing). LPs created with no `obClientId` (tests,
  external API/MCP, manual entry) are unaffected. Also fixed a race in
  `submitObTask()` where the client-activation PUT and the LP-creation
  POST fired without guaranteed ordering — the activation PUT is now
  awaited first. QA Security/Data Integrity audit finding.

## [1.37.0] - 2026-08-21

### Fixed
- `exportLPRegister()` dumped `lpRegister` unfiltered (the whole
  tenant, every fund's LPs) into one Excel file with no fund column
  to tell them apart. Now scoped to `activeFundId`, matching every
  other on-screen LP view's `fundScoped` filter.
- The "Инвестировано ($M)" column in that same export literally
  duplicated "Commitment ($M)" — both were `lp.commitment`. Now uses
  `lp.paidAmount`, the actual live-computed paid-in figure. QA Data
  Integrity audit finding.

## [1.36.0] - 2026-08-21

### Fixed
- `DELETE /api/lp/:id` only checked `capital_call_line_items` before
  allowing a hard delete — an LP that had already received real
  distributions (but never a capital call) could be deleted, orphaning
  its `distribution_line_items`. Now checks both tables and reports
  both counts in the 409 footprint. QA Data Integrity audit finding.
- Double-click / repeat-submit could create duplicate Fund/Deal/
  Portfolio-company/Individual Capital Call records — none of those
  save functions guarded against a second click firing while the
  first `await apiFetch(...)` was still in flight. Added an in-flight
  guard to `saveFund()`, `saveDeal()`, `savePortfolio()`, and
  `saveIndividualCC()`. Server-side Idempotency-Key support and
  UNIQUE constraints on business entities remain open — the latter
  needs a business decision on what counts as a duplicate, not a
  guess. QA Data Integrity audit finding.

## [1.35.0] - 2026-08-21

### Fixed
- `ownership_pct` on `lp_register` was never validated server-side —
  the sum across a fund's LPs could silently exceed 100%. New
  `validateFundOwnershipPct()` rejects `POST /api/lp` and
  `PUT /api/lp/:id` with 400 when the fund's total would go over 100%
  (excluding the LP's own prior value on update); LPs with no
  `fundId` are unaffected. QA Data Integrity audit finding.

## [1.34.0] - 2026-08-21

### Fixed
- Capital Call line-item payments never validated `paid` against the
  line item's own `called` amount — a negative, non-numeric, or
  simply too-large value would be written as-is. Both the fund-level
  route and the SPV mirror now require `paid` to be a finite,
  non-negative number that doesn't exceed `called`. QA Data Integrity
  audit finding.

## [1.33.0] - 2026-08-21

### Added
- Account-level login lockout: 5 wrong passwords locks the account for
  15 minutes (`users.failed_login_attempts`/`locked_until`), on top of
  (not instead of) the existing IP-based rate limit — the IP limiter
  alone did nothing to stop repeated guesses against one specific
  account spread across many IPs. A successful login resets the
  counter. QA Security audit finding.

## [1.32.0] - 2026-08-21

### Fixed
- Neither logout nor a password change/reset ever invalidated an
  already-issued JWT — it kept working until its own 12h expiry
  regardless. New `users.token_version` column, embedded in the JWT
  and checked on every request; bumped by the new
  `POST /api/auth/logout`, self password-change, and admin password
  reset (logout-everywhere, since there's no per-device session table
  — still a strict improvement over nothing being invalidated at all).
  Self password-change returns a fresh token so that session isn't
  logged out by its own action. Backward compatible with
  already-issued tokens (no `tokenVersion` claim = treated as version
  0). QA Security audit finding.

## [1.31.0] - 2026-08-21

### Fixed
- Waterfall retroactivity: `replayWaterfallState()` rebuilt
  cross-distribution carry-tier state by replaying every prior
  distribution against the fund's/SPV's CURRENT
  preferredReturn/carriedInterest/catchUpPct, not the terms actually
  in effect when each prior distribution was created — changing a
  fund's carry terms after distributions had already gone out silently
  shifted where the next distribution's tiers start from. New
  nullable snapshot columns on `distributions`/`spv_distributions`
  (populated at creation time) fix this; legacy rows with no snapshot
  fall back to the fund's current terms unchanged. QA Data Integrity
  audit finding.

## [1.30.0] - 2026-08-21

### Fixed
- `PUT /api/capital-calls/:id/line-items/:lpId` (and its SPV mirror,
  `PUT /api/spv-capital-calls/:id/line-items/:investorId`) gated
  `paymentConfirm` + wire evidence only on confirming a payment, never
  on reversing one — an already-`Paid` line item could be silently
  reverted to `Pending` by anyone with `accessFM`, no evidence, no
  trace. Both routes now require `paymentConfirm` plus a non-empty
  `reason` on any transition OUT of `Paid`, and both directions
  (confirm/reverse) are now recorded in `audit_log` (this route had no
  audit entry at all before). QA Data Integrity audit finding.

## [1.29.0] - 2026-08-21

### Fixed
- Four `POST` routes (`/api/capital-calls`, `/api/distributions`,
  `/api/portfolio/:id/rounds`, `/api/spvs/:id/distributions`) forwarded
  raw SQLite error text straight into the client-facing error message
  on any transaction failure (e.g. `NOT NULL constraint failed:
  capital_call_line_items.lp_id`), leaking real table/column names.
  Real error still goes to `console.error` for the operator; the
  client now gets a generic, human-readable message. Found during a
  repo-wide QA audit (`docs/QA_AUDIT_STATUS.md`).

## [1.28.0] - 2026-08-21

### Fixed
- `switchFund()` never reset `js/lp-register.js`'s `lpRegFilter`/
  `lpRegStatus` module state, so a text/status filter typed while
  viewing one fund's LP Register silently kept applying after
  switching to a different fund. Deals had the milder cousin: the
  `#searchDeals`/`#filterDealStage` inputs kept showing stale text
  with no actual effect on the (correctly unfiltered) list. Both now
  reset on fund switch. QA audit finding.

## [1.27.0] - 2026-08-21

### Fixed
- Second stored-XSS cluster: LPA/SA/pitch-deck document-link URLs
  (`lp.lpaUrl` and deal document fields) were inserted unescaped into
  `onclick="_obOpenPreviewModal('...')"` and `value="..."` attributes
  in `js/lp-register.js` and `js/app.js` — a URL containing a single
  quote breaks out of the `onclick` JS string literal and executes
  arbitrary JS for any staff member opening that record, not just
  injecting markup. Also hardened the shared sink itself
  (`_obOpenPreviewModal()`'s `href`/iframe `src` in `js/onboarding.js`)
  as defense in depth. QA security audit finding.

## [1.26.0] - 2026-08-21

### Fixed
- Stored XSS in the onboarding client create/edit modal
  (`openNewObClientModal()`, `js/onboarding.js`): `client.name` was
  inserted unescaped into the modal title (`innerHTML`) and into the
  name input's `value="..."` attribute. Combined with the JWT sitting
  in `localStorage` in plaintext, this was a real session-theft path
  for any staff member opening a maliciously-named client's record.
  Both sites now go through the existing `escapeHtml()`. QA security
  audit finding.

## [1.25.0] - 2026-08-21

### Fixed
- `GET /api/uploads/:id` accepted ANY valid tenant token — internal
  staff, portfolio-company portal, or LP portal — to fetch ANY file in
  the tenant by id, including other companies'/LPs' KYC/AML documents,
  since `uploaded_files` never recorded which portfolio company a
  portal-uploaded file actually belongs to. New nullable
  `uploaded_files.portal_portfolio_id` column, set on
  `POST /api/portal/uploads`; the download route now scopes a
  portfolio-portal token to its own files only, rejects LP-portal
  tokens outright (never legitimately used this route), and re-checks
  that an internal user is still active (a deactivated account's
  unexpired 12h JWT could previously keep downloading). 5 new
  regression tests (`server/test/uploads-security.test.js`). Found
  during a repo-wide QA audit.

## [1.24.0] - 2026-08-21

### Added
- VC module: cap table dilution tracking + SPV co-investment vehicles,
  the second closed-end `asset_class` alongside PE
  (`docs/TZ_VC_Module.md`, mirrors the Hedge Fund module's build
  pattern). `capital_calls`/`distributions`/`waterfallEngine.js` are
  already asset-class-agnostic and needed no changes — this adds only
  what's genuinely new: `portfolio_rounds`/`portfolio_round_investors`
  for multi-round cap table tracking with server-computed,
  correctly-diluted `ownership_pct_post`; `spvs`/`spv_investors` plus a
  mirrored capital-call/distribution ledger (fund LPs or external
  co-investors, own carry/preferred-return terms, reusing
  `waterfallEngine.js`/`metricsEngine.js` unmodified for
  carry/IRR/DPI/TVPI computed from the SPV's own terms, not the parent
  fund's). `js/vc.js`: SPV list/detail UI, a cap-table section spliced
  into the portfolio company modal, nav item shown only for
  `assetClass:'vc'` funds. 27 new tests. Verified end-to-end via a
  headless-Chrome scenario against the real dev server.

## [1.23.0] - 2026-08-20

### Added
- Hedge Fund module, Stage 5 (final) of `docs/TZ_Hedge_Fund_Module.md`:
  the frontend. Nav-item and dashboard branching by `operatingModel`
  (`js/hf.js`'s `updateDashboardForOperatingModel()`, hooked into the
  existing `switchFund()`/`updateFundBranding()` flow): an open-end fund
  shows new "Подписки / Погашения" and "NAV" nav items and a dashboard KPI
  row (AUM, NAV/unit, MTD/YTD/since-inception returns, via new
  `GET /api/funds/:id/hf-metrics`) instead of the closed-end lifecycle
  bar/IRR-DPI-TVPI cards/J-curve — and hides Capital Calls/Distributions/
  First Closing, which hedge funds never populate at all.
  - New internal pages: Подписки/Погашения (create + process subscriptions
    and redemptions, with lock-up/gate feedback surfaced from the Stage 2
    API) and NAV (create Draft entries, submit for the `nav_publish`
    workflow via the existing `startWorkflow()`).
  - LP portal (`lp-portal.html`): an open-end LP now sees a position
    statement (units, current value, unrealized P&L off a real weighted-
    average cost basis, fees paid — new `GET /api/lp/:id/hf-position` /
    `GET /api/portal/lp/hf-position`) instead of the Capital Account
    Statement, plus real subscribe/redeem request forms
    (`POST /api/portal/lp/hf-{subscription,redemption}-request` — lands as
    a normal Pending/Requested row, reviewed through the existing internal
    Stage 2 routes, same "self-service submission, staff decides" pattern
    already used for the portfolio-company portal's payment
    confirmations) and its own lock-up-status note.
  - 11 new tests (metrics/position reads, LP-portal reads + writes +
    identity isolation + request-forgery rejection) — 143/143 total.
    Verified end-to-end on the real dev server: real NAV publish through
    the real workflow UI trigger, real subscription/redemption processing
    via the new pages' own buttons, real portal login + redemption
    request whose effect (90 units remaining, $9,000 value) matched
    exactly.

## [1.22.0] - 2026-08-20

### Added
- Hedge Fund module, Stage 4 of `docs/TZ_Hedge_Fund_Module.md`:
  notifications, added to the existing `triggers.js`/`digestChecks.js`
  rather than a separate module (per the TZ's own instruction).
  - Instant (LP-facing): NAV published → every LP with a real position
    (`units_held > 0`) gets their new position value; a redemption reaching
    `Processed` (not `Queued`) → the LP is notified. "Your turn" for the
    CFO/CEO steps of the `nav_publish` workflow itself already came free
    from the existing generic `notifyWorkflowStepAssigned`.
  - Digest (officer-facing, `payment_confirm` = CEO/CFO, same gate as the
    processing routes themselves): an LP's lock-up ending soon (only while
    still upcoming — already-ended isn't actionable); a redemption's
    notice period expiring, including already-overdue ones (mirrors
    `checkCapitalCallOverdue`'s shape); a fund's next performance-fee
    crystallization approaching, one notification per fund keyed on the
    earliest due date across its positions (not one per LP, which would
    spam).
  - 8 new tests (3 instant-trigger, 5 digest, run through the real routes
    including `POST /api/notifications/run-digest`, same style as the
    existing `notifications.test.js`/`digest.test.js`) — 132/132 total.

## [1.21.0] - 2026-08-20

### Added
- Hedge Fund module, Stage 3 of `docs/TZ_Hedge_Fund_Module.md`: performance
  fee crystallization. New `server/performanceFeeEngine.js` (pure
  functions, own test file — same split as `waterfallEngine.js`) computes,
  per investor position: `gainPerUnit = max(0, navPerUnitEnd - hwmBefore)`
  against the STANDING high-water mark (never last period's NAV — the
  distinction the TZ's own required test case exists to catch), an
  optional annualized hurdle rate prorated over the elapsed period and
  carved out of the gain before fee applies, and the resulting fee
  expressed in units deducted at the triggering NAV. New
  `POST /api/hf/fee-crystallization/run` (CEO/CFO only) runs it for every
  position with real units in a fund against its latest Published NAV,
  guards against double-crystallizing the same NAV date, and updates each
  position's `units_held`/`high_water_mark_per_unit` for next time. New
  `GET /api/hf/fee-crystallizations` for history. 12 new tests (7 pure-
  function incl. the mandatory drawdown → partial-recovery → new-high
  case, 5 integration) — 124/124 total. Verified end-to-end against the
  real dev server with real workflow approvals: entry NAV 100 → drawdown
  to 90 (fee 0) → recovery to 95, still below the 100 HWM (fee 0) → new
  high of 110 (fee charged only on the 10 of gain above the HWM, never the
  15 from the recovery low).

## [1.20.0] - 2026-08-20

### Added
- Hedge Fund module, Stage 2 of `docs/TZ_Hedge_Fund_Module.md`: real
  processing against the fund's latest Published NAV.
  - New workflow type `nav_publish` (CFO reviews → CEO approves,
    `server/wfDefinitions.js` + `js/workflow.js`). NAV `Draft → Published`
    only happens through the new `PUT /api/hf/nav/:id/publish`, which
    re-verifies server-side that a resolved `approved` `nav_publish`
    workflow instance actually exists for that exact NAV record — a
    direct call without going through Согласования is rejected (409), not
    just discouraged by the UI.
  - `PUT /api/hf/subscriptions/:id` with `status:'Processed'` now computes
    `unitsIssued`/`navPerUnitAtEntry` from the latest Published NAV and
    `lockupUntil` from the fund's `lockupMonths` — never trusting those
    fields from the client for this transition. Creates/updates the
    investor's `hf_investor_positions` row; a second (top-up) subscription
    blends the high-water mark by a units-weighted average (documented
    simplification — true per-series HWM tracking is out of scope until
    performanceFeeEngine.js, Stage 3).
  - `PUT /api/hf/redemptions/:id` with `status:'Processed'` now runs a
    lock-up check (blocks with 409 + `lockupOk:false` if still within the
    LP's lock-up) and a gate check (redemptions sharing the same
    `effectiveDate` are processed FIFO up to `gate_pct` of the fund's NAV
    total; anything past the limit gets `status:'Queued'` instead of
    partially filled — this schema has no partial-fill field).
  - 7 new tests (`hf-processing.test.js`) covering the no-NAV-yet
    rejection, the publish-without-workflow rejection, the full
    CFO→CEO→publish path, unit/lockup computation, HWM blending, the
    lock-up block, and the gate's Processed/Queued split — 112/112 total.

## [1.19.0] - 2026-08-20

### Added
- Hedge Fund module, Stage 1 of `docs/TZ_Hedge_Fund_Module.md`: schema +
  plain CRUD for the open-end engine, no business logic yet. New tables
  `hf_subscriptions`, `hf_redemptions`, `hf_nav_history`,
  `hf_investor_positions` (unused until Stage 2/3), `hf_fee_crystallizations`
  (unused until Stage 3). New fund-level settings
  (`performanceFeePct`/`hfHurdleRate`/`lockupMonths`/`gatePct`/etc.,
  `docs/TZ_Hedge_Fund_Module.md` §2.1), auto-defaulted on a fund created
  with `assetClass: 'hedge_fund'`. New routes: `GET/POST/PUT/DELETE
  /api/hf/subscriptions`, `/api/hf/redemptions`, `/api/hf/nav` — every
  status transition is a plain field write the caller controls directly;
  no auto-computed units/NAV-matching, no lockup/gate checks, no NAV
  publish workflow (all Stage 2). `POST`/`PUT /api/hf/nav` do compute
  `navTotal`/`navPerUnit` from the raw inputs — that's arithmetic, not the
  business logic Stage 1 is deferring. 11 new tests
  (`hf-crud.test.js`) plus 7 from Stage 0 — 105/105 total.

### Fixed
- `PUT /api/hf/subscriptions/:id` and `/api/hf/redemptions/:id` 500'd on
  every call (`Unknown named parameter '@createdBy'`) — caught by the new
  tests before shipping, not a real-world regression.

## [1.18.0] - 2026-08-20

### Added
- Multi-strategy foundation, Stage 0 of the Hedge Fund module
  (`docs/TZ_Hedge_Fund_Module.md`, `docs/ARCHITECTURE_Multi_Strategy_Roadmap.md`
  — both added to `docs/` for future VC/REIT tracks to reference too).
  `funds.assetClass` (`pe`/`vc`/`reit`/`hedge_fund`, client-settable, "Класс
  активов" selector in the fund modal) and `funds.operatingModel`
  (`closed-end`/`open-end`, always server-derived from `assetClass` —
  never trusted from the request body) — every existing fund defaults to
  `pe`/`closed-end`, no behavior change for current PE funds. Lays the
  groundwork for the hedge fund open-end engine (subscriptions/
  redemptions/NAV/performance fee) in upcoming stages.

### Fixed
- `POST /api/funds` could 500 with `NOT NULL constraint failed:
  funds.currency` for any caller that omitted `currency` — the explicit-
  defaults list covered `nav`/`status`/`color`/`icon` but missed
  `currency`, which is also `NOT NULL DEFAULT 'USD'` at the schema level.
  Found by the new test suite's minimal POST body, not by a real user
  (the actual fund-creation form always sends `currency`).

## [1.17.0] - 2026-08-20

### Added
- "Сравнение фондов" — a new page (Обзор → Сравнение фондов,
  `accessFM` permission, same gate as fund metrics) for comparing the
  tenant's own funds side by side: DPI/RVPI/TVPI/IRR/Paid-in/
  Distributed/Residual Value per fund (via the existing
  `GET /api/funds/:id/metrics`, called once per selected fund — no new
  backend route) plus an overlaid cumulative J-curve chart built from
  the same in-memory `capitalCallsLog`/`distributionsLog` arrays the
  single-fund dashboard J-curve already uses. Checkbox fund picker,
  live re-render on selection change. v1 deliberately excludes
  industry/peer benchmarks — there is no external or reference dataset
  anywhere in this system to source them from; that's left as a
  separate future feature requiring a real data source.

## [1.16.0] - 2026-08-20

### Added
- Bank reconciliation for Capital Calls — "Сверка с выпиской" button on
  the Capital Calls page (CFO/CEO only, `paymentConfirm` permission).
  Upload a bank-statement CSV (EN or RU column headers, comma- or
  semicolon-delimited, auto-detected); `js/bank-reconciliation.js`
  parses transactions and scores them against every open Capital Call
  line item (exact/tolerant amount match, CC-number/LP-name substring
  match in the transaction reference, payment-date proximity), then
  greedily assigns each transaction to at most one line item. High-
  confidence matches are pre-checked in a review table; the user
  confirms which to apply. Confirming reuses the existing
  `PUT /api/capital-calls/:id/line-items/:lpId` payment-confirmation
  route unchanged — the uploaded statement becomes the `wireConfirmUrl`
  evidence and each transaction's own reference becomes `wireRef` — and
  replicates the existing auto-close-to-`Completed` rule once every
  line item on a touched Capital Call is paid. No new backend endpoint;
  purely a client-side matching layer on top of existing, unweakened
  server-side rules.

## [1.15.0] - 2026-08-19

### Added
- Global search — a search box in the topbar (previously search was
  fragmented into 7 independent page-scoped filter boxes with zero
  cross-entity search: LP Register, Capital Calls, Distributions, Deal
  Pipeline, Portfolio, Vault, Onboarding). `js/global-search.js` searches
  LP Register, Deal Pipeline, Portfolio, Engagements, Capital Calls,
  Distributions, and Documents (reusing `vault.js`'s own cross-module
  file aggregator) all at once, purely client-side against data already
  resident in memory — no new backend endpoint. Results grouped by
  module; clicking one navigates to and opens that record's own existing
  detail view.

## [1.14.0] - 2026-08-19

### Added
- Unified "Журнал изменений" (Audit Log) — a real cross-module who/what/
  when event feed, replacing what used to be fragmented, per-entity
  history (`portfolio.history_json`, never even rendered in the UI;
  `documents.history_json`, scoped to one document). New `audit_log`
  table + `server/auditLog.js`'s `recordAudit()`, wired into every
  mutating route across the 7 modules that already function as a
  governance/regulatory record: LP Register, Capital Calls,
  Distributions, Portfolio, Deals, Conflict Approvals, Engagements.
  v1 scope deliberately: event-only (who/what/when + a summary sentence),
  no per-field old→new diff, and limited to these 7 modules rather than
  a blanket middleware over every route. New `GET /api/audit-log`
  (optional `entityType`/`entityId` filters), gated on `manageUsers`
  (CEO/Auditor). New `js/audit-log.js` page under Система → Журнал
  изменений.

## [1.13.0] - 2026-08-19

### Added
- `server/test/waterfall-engine.test.js`: a multi-LP + `profitAmount > 0`
  test — the existing multi-LP coverage was ROC-only, and the profit/
  catch-up coverage was single-LP-only, so the combination (the same
  carry ratio applied per-LP, per-LP breakdown reconciling exactly to the
  total across the array) was never directly verified until now.

## [1.12.0] - 2026-08-19

### Added
- `exportDistributions()` (`js/export.js`) — a Distributions Excel report
  (journal + per-LP breakdown), same shape as the existing
  `exportCapitalCalls()`, with its own card on the Reports page.
- Full CRM Export now has a 10th sheet ("Distributions", between Capital
  Calls and Portfolio) — ROC/profit/carry/status per record. Cover sheet's
  sheet list and the report card's subtitle/description updated to match.

## [1.11.0] - 2026-08-19

### Added
- LP self-service portal (`lp-portal.html`) — a "Capital Account
  Statement" section showing the LP's own Called/Distributed/DPI/RVPI/
  TVPI/IRR, previously only visible to internal staff (CRM's LP detail
  page) or via raw API access. New `GET /api/portal/lp/metrics` runs the
  exact same `computeLpMetrics()` (`server/metricsEngine.js`) as the
  internal `GET /api/lp/:id/metrics`, scoped only to the authenticated LP
  — never a client-supplied id. Same "null, not a fake 0" convention as
  the CRM dashboard's IRR tile for a position with no real cash-flow
  history yet.

## [1.10.0] - 2026-08-19

### Fixed
- Dashboard J-curve chart (`buildRealJCurveData()`, `js/app.js`) only ever
  plotted the descending leg (capital calls called = cash out) — the
  distributions module existed but was never wired in, so the chart could
  never show the real eventual upturn. Now sums both Capital Calls (out)
  and Distributions (in) per year, both filtered to non-Draft records
  only, so a fund with real distributed cash actually renders the J
  shape instead of a flat decline. `kpiIrrCurrent`/`kpiMoicCurrent`
  (dashboard "Текущий IRR"/"Текущий MOIC") were checked and confirmed
  already correctly wired to real data (fixed earlier this session) —
  they show "нет данных" honestly for a fund with no real cash-flow
  history yet, which is correct behavior, not a stub.

## [1.9.0] - 2026-08-19

### Added
- `js/distributions.js` — the Distributions module finally has a CRM page
  (previously API-only): a "Distributions" nav item, list page (KPIs,
  search/status filter, table), detail modal (per-LP computed split —
  ROC pro-rata, profit through the real waterfall — payment
  confirmation with wire reference + uploaded evidence, same bar as
  Capital Calls' `markLPPayment()`), and a fund-scoped "new distribution"
  form (ROC/profit amounts only — the server always computes the line
  items, never entered by hand). Status lifecycle mirrors Capital Calls:
  Draft → Sent (`ccApprove`) → Paid (auto-set once every LP confirms).

### Fixed
- `server/test/notifications.test.js`: `waitFor()` stopped polling as
  soon as *any* row appeared, but `notifyCapitalCallCreated()` writes the
  LP's and the officer's notification rows via two sequential awaits —
  under real system load the test could observe the first row and stop
  before the second one landed, intermittently failing a passing test.
  Now polls until the *expected count* of rows appears.

## [1.8.0] - 2026-08-19

### Fixed
- `lp_register.calledAmount`/`paidAmount`/`distributions` were all
  leftover columns from before `capital_call_line_items`/
  `distribution_line_items` existed as the real ledgers — the same
  "risking a stale denormalized number" problem `funds.lpCount`/`deployed`
  was deliberately built to avoid. `calledAmount`/`paidAmount` were kept
  "in sync" by a client-side write-back PUT after every Capital Call
  approval/payment (`js/lp-register.js`, explicitly commented
  "best-effort, doesn't block" — an admission it could silently drift);
  `distributions` was never written to at all. Every place that returns
  an LP (internal API, LP self-service portal, external API, MCP tools)
  now overrides all three with a live `SUM()` from the real line items
  instead of trusting the stored columns — one source of truth per
  figure, not two. The client-side write-back is gone; `approveCC()`/
  `markLPPayment()` now just refresh from the API. Caught in the process:
  a real 500 on LP portal login and `/me` (`rowToLpPortalView()`'s curated
  shape has no `id` field, which the first version of this fix assumed
  was there).
- `server/metricsEngine.js`: a paid-in or distributed amount with no
  recorded date was being dropped from DPI/RVPI/TVPI entirely, not just
  excluded from the IRR calculation — real money that moved was vanishing
  from the totals just because its date wasn't known. Now only the IRR
  cash-flow list requires a date; the DPI/RVPI/TVPI totals count every
  real amount regardless.

## [1.7.0] - 2026-08-19

### Added
- `server/metricsEngine.js` — real DPI/RVPI/TVPI/IRR, the actual point of
  the Distributions module: `GET /api/funds/:id/metrics` and
  `GET /api/lp/:id/metrics`, computed from a fund's/LP's real dated
  capital-call and distribution history plus current portfolio value
  (same NAV proxy the dashboard's existing MOIC tile already uses). IRR
  is XIRR (real dates, not a fixed-period assumption) via a bisection
  solver — bounded and guaranteed to converge given a real solution
  exists, never a numerically unstable guess. Every metric is `null`
  (never a fake 0%/0.00x) when there isn't enough data yet — paid-in
  capital of 0, or cash flows that can't produce a real IRR.
- Dashboard's "Текущий IRR" tile (`js/app.js`) — previously a deliberate
  "Расчёт недоступен" placeholder with no real distributions data to
  compute from — now shows the real figure for the active fund.

## [1.6.0] - 2026-08-19

### Added
- `server/waterfallEngine.js` — the real distribution waterfall the
  Distributions module was missing since Stage 1: return-of-capital stays
  a straight pro-rata split (unchanged), and a distribution's profit
  portion now runs through LP preferred-return catch-up (simple,
  non-compounding interest on unreturned capital — `funds.preferredReturn`)
  → GP catch-up (`funds.catchUpPct`, full by default) → final carry split
  (`funds.carriedInterest`). `POST /api/distributions` no longer rejects a
  `profitAmount` submitted without explicit `lineItems`; it computes the
  split automatically instead. Correctness across a fund's 2nd+
  distribution comes from replaying prior (non-Draft) distributions
  through the same tiers rather than a stored running balance, so it can
  never drift out of sync with the fund's actual recorded history.

### Fixed
- `funds.catchUpPct` existed in the schema (Distributions Stage 1) but was
  never wired into `fundMapping.js`, so it could never actually be set via
  the API — every fund was silently stuck at the DB default. Now a real,
  settable field.

## [1.5.0] - 2026-08-19

### Added
- Proactive email notifications, Stage 2 — daily digest triggers:
  `server/notifications/digestChecks.js` covers KYC review coming due,
  overdue Capital Call payments, upcoming regulator (AFSA) report
  deadlines, pending conflict-of-interest decisions, and an LP/client's
  identity document nearing expiry. Each re-notifies once per calendar day
  while the underlying condition stays true (`notification_log`'s
  `scope: 'daily'`), instead of firing once and going silent. New
  `ob_clients.id_document_expiry` column plus a matching date field in the
  DD Outcome (2.2) task form feed the document-expiry check. New
  `POST /api/notifications/run-digest` (CEO-only) lets ops force a digest
  run for their own tenant without waiting for `DIGEST_HOUR`.

## [1.4.0] - 2026-08-19

### Added
- Proactive email notifications: new `server/notifications/` module
  (mailer/recipients/notify/triggers/scheduler) with a `notification_log`
  dedup ledger so the same event never re-notifies the same recipient
  twice. SMTP is optional — if `SMTP_HOST` is unset, notifications log to
  the console instead of sending, same "safe default" as the JWT secret.
  Two starter instant triggers wired in: a Capital Call moving Draft →
  Pending emails the LP and CEO/CFO; a workflow instance being created or
  advancing to its next step emails whoever holds that step's role.
  Digest-style triggers (KYC renewal, overdue payments, ...) are scoped
  for a later round — `scheduler.js` ships as infrastructure only for now.
  `.env.example`/`DEPLOYMENT.md` document the new `SMTP_*`/`EMAIL_FROM`/
  `DIGEST_HOUR` variables.

## [1.3.0] - 2026-08-19

### Added
- Distributions module, Stage 1 (data + API, no waterfall math yet): new
  `distributions`/`distribution_line_items` tables mirroring Capital
  Calls, full CRUD API (`/api/distributions`, `.../line-items/:lpId`)
  with the same permission gates and hybrid-delete rules, and
  `funds.catch_up_pct`/`waterfall_type` columns for the upcoming
  waterfall engine. Pure return-of-capital distributions auto pro-rate
  by LP ownership; profit-split distributions require explicit line
  items until the waterfall engine exists (rejected otherwise, rather
  than guessing). Wired into the frontend's data-loading cycle.

## [1.2.2] - 2026-08-18

### Fixed
- Uploaded contract documents in the Engagements Registry couldn't be
  previewed (external links like Google Drive worked, masking the bug).
  Uploaded-file links need an auth token appended before they'll load;
  the registry's preview buttons were skipping that step. Fixed by
  routing both preview buttons through the same token-resolving helper
  every other document-preview button in the app already uses.

## [1.2.1] - 2026-08-18

### Changed
- "Инвойсировано" and "Остаток" KPI cards in the Engagements Registry no
  longer show a "$" (these totals mix engagements in different
  currencies, so a single symbol was misleading). Values now use a
  thousands separator plus a clear K/M suffix (e.g. "45,2K" / "2,45M")
  instead of always showing "K" regardless of actual magnitude.

## [1.2.0] - 2026-08-18

### Added
- Contracts in the Engagements Registry (Реестр договоров) can now be
  edited after creation — contract number, signed date, service type,
  fee type, status, amount, currency, contract dates, document link,
  and notes. Previously the detail view was read-only aside from a
  payment quick-update.
- "New contract" form now has a document-link field (with the paperclip
  file-upload button, same as elsewhere in the app) so a Drive/SharePoint
  link can be attached at creation time, not just after the fact.

### Fixed
- Removed the dollar-sign icon from the "Инвойсировано" KPI card at the
  top of the Engagements Registry.

## [1.1.2] - 2026-08-17

### Changed
- Header logo simplified to icon-only, with "Managing & Advising Company"
  shown large next to it instead of the "Golden Leaves Ltd" name line.
  Mobile breakpoint that hides this text raised from 560px to 760px to
  stop the MYCRM button wrapping at intermediate widths.

## [1.1.1] - 2026-08-17

### Changed
- Landing page typography unified: Fraunces (serif) now used for team
  member names and the footer/header wordmark, IBM Plex Mono for role
  labels, IBM Plex Sans for bio text — previously only the hero and
  services sections had the editorial font pairing.
- Removed the "team size" stat from the hero stats row; only founding
  year and licensed-activities count remain.

## [1.1.0] - 2026-08-17

### Changed
- CRM app (post-login: dashboard, pipeline, portfolio, LP register, etc.)
  recolored from a navy/blue accent to teal across `css/style.css`,
  `index.html`, and all `js/*.js` inline styles — buttons, active states,
  badges, charts, and form focus rings. File-type brand colors (Word blue,
  PDF red, Excel green) were left as-is.
- Landing page hero and "Licensed Activities" sections redesigned with a
  serif/mono editorial look (Fraunces + IBM Plex), a decorative vein motif,
  a license-PDF button, and real stats (founding year, licensed activities,
  team size).
- Company logo redesigned as a hand-verified symmetric vector icon (four
  identical rotated leaves) with a visible teal wordmark badge in the header.

### Fixed
- Public site header no longer overflows on mobile widths (≤560px).

## [1.0.0] - 2026-08-17

### Added
- Public company landing page (`company.html`), also served at the bare
  domain root, replacing the old separate about/funds/team/contact pages.
- Real team roster with photos and bios, bilingual RU/EN copy
  (`js/landing-i18n.js`), and a vector recreation of the company logo
  (`img/logo-golden-leaves.svg`).
- Real AFSA license PDF (`docs/AFSA-License-Golden-Leaves.pdf`), rotation-corrected
  for proper on-screen display.
