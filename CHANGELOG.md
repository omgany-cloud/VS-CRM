# Changelog

Version and date are updated here on every push to GitHub.

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
