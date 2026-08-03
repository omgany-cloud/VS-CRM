# Backend — multi-tenant CRM API

Express + `node:sqlite` API backing the whole app: the CRM (`index.html`),
the LP self-service portal (`portal.html`), and the public marketing site
(`company.html`/`about.html`/`funds.html`/`team.html`/`contact.html`).

## Stack
- **Express** (API + serves the static frontend from the parent folder)
- **SQLite via `node:sqlite`** (Node's built-in module — no native compile
  toolchain needed; requires Node ≥ 24, see the parent `DEPLOYMENT.md`)
- **JWT auth**, tenant-scoped via a `tenant_id` column enforced on every
  query (`server/auth.js` → `req.tenantId`, never taken from client input)

## Run it
```
cd server
npm install
npm run seed     # only for a fresh demo instance — see warning below
npm start         # http://localhost:4000
```
Open **http://localhost:4000** (not `index.html` directly — the app needs
to be served over HTTP so `fetch()` calls work).

**Demo login:** `admin@turancapital.kz` / `TuranDemo2025!` (pre-filled in
the login form on a freshly seeded database)

⚠️ **Don't run `npm run seed` against a database that already has real
data.** It repopulates fictional demo records (LPs, deals, portfolio
companies) — only meant for spinning up a brand-new demo/dev instance from
scratch, not for topping up or resetting a live one.

## What's real vs. what's still a placeholder

This used to be a single-page vertical slice (LP Register only) proving
out the stack end-to-end; it isn't anymore. Every business-data page in
the app is backed by a real table + API, confirmed against the actual
route table in `server/index.js`:

| Domain | Table(s) | Notes |
|---|---|---|
| Funds | `funds` | Includes per-fund GP identity/banking fields (CEO, address, BIN, bank details) — used to fill in generated LP documents. |
| LP Register | `lp_register` | The original slice; still the most heavily used. |
| Capital Calls | `capital_calls`, `capital_call_line_items` | |
| Deal Pipeline | `deals` | |
| Portfolio | `portfolio` | Includes archive/restore (soft-close), not just hard delete. |
| Onboarding clients | `ob_clients`, `ob_tasks`, `ob_task_comments` | |
| Engagements (CF&A) | `engagements` | |
| Conflict approvals / Restricted List / COI | `conflict_approvals`, `restricted_list`, `coi_registry` | |
| IC memos + voting | `ic_memos` | Server derives `status`/`resolution`/`quorumMet` from the votes array — never trusts a client-supplied value. |
| Approval workflows | `workflow_instances` | KYC CO→MLRO→CEO, IC review, Capital Call/SA sign-off. Step templates are server-derived (`server/wfDefinitions.js`); a caller can't hand itself every step's role. |
| First Closing | `first_closing` | |
| AFSA/compliance reports | `afsa_reports` | |
| Documents (file register) | `documents`, `uploaded_files` | Real disk storage via `POST /api/uploads`, not just a metadata row. |
| Users / Roles | `users`, `roles` | Roles are DB-backed with boolean capability flags, editable at runtime — not hardcoded role-name checks. |
| API keys (external integrations) | `api_keys` | Scoped read-only keys, see `server/externalApi.js`. |
| Tenants (company settings) | `tenants` | Company display name is editable from the UI, not fixed at signup. |
| LP portal (self-service) | reuses `portfolio`/`documents` | Separate login space, BIN + per-company password, not a `users` row. |

**Not real** (and not pretending to be): the pricing page (`js/subscription.js`)
is a static marketing display, not a billing integration — there's no
payment provider wired up. A handful of fund-economics fields not yet
migrated off the original hardcoded constant (`FUND_PARAMS` in
`js/data.js` — e.g. `lockInPeriod`, `extensionYears`) still fall back to
that constant's defaults if a fund doesn't have its own value set; this is
a known, narrow gap, not a hidden one — see `js/funds.js`'s `fundParamsFor()`.

77 API routes, 22 tables — verified by grepping the actual route/schema
definitions, not by re-reading old docs. If this table and the code drift
apart again, trust `server/index.js` and `server/db.js`, not this file.

## Multi-tenancy model
Shared DB, shared tables, `tenant_id` column enforced on every
tenant-scoped query (`server/db.js`, `server/auth.js`). This is **not**
schema-per-tenant — for a large-scale deployment handling regulated
KYC/AML data across many independent management companies, schema-per-tenant
(or database-per-tenant) on Postgres remains the stronger long-term
architecture, and migrating to it is a legitimate future step, not an
urgent one.

The row-level model here isn't untested, though: `server/test/tenant-isolation.test.js`
is a standing regression suite (part of `npm test`) that spins up two
tenants and asserts, per entity, that tenant B's list never contains
tenant A's records and that tenant B's direct-id PUT/DELETE against
tenant A's row 404s rather than leaking or succeeding (the IDOR check).
Covers LP, deals, portfolio, engagements, capital calls, onboarding
clients, users, funds, API keys, and tenant rename — re-run it any time
someone touches a tenant-scoped query to confirm the guarantee still
holds.

## Extending further
To wire up a new entity end-to-end:
1. Add a table + `tenant_id` column in `server/db.js` (and a guarded
   `ALTER TABLE` below the `CREATE TABLE` block if adding a column to an
   existing table — see the comment there for why).
2. Add `GET/POST/PUT/DELETE` routes in `server/index.js`, scoped by
   `req.tenantId` on every query.
3. In `js/api-auth.js`, add a `loadXFromApi()` function (mirror an
   existing one, e.g. `loadDealsFromApi()`) and call it from
   `loadAllApiData()`.
4. Add isolation test coverage in `server/test/tenant-isolation.test.js`
   (`assertEntityIsolation()` is a reusable helper — see existing entries)
   and, if the entity should support delete, guard-test coverage in
   `server/test/delete-guards.test.js`.
