# Changelog

Version and date are updated here on every push to GitHub.

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
