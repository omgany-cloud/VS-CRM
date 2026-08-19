# Changelog

Version and date are updated here on every push to GitHub.

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
