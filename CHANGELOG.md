# Changelog

Version and date are updated here on every push to GitHub.

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
