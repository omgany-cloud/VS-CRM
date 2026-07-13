# Vertical slice: multi-tenant backend for LP Register

Proof of concept — proves the full stack (DB → tenant isolation → auth → API → frontend)
end-to-end on ONE page (LP Register). Every other page in the app still runs on its
original static demo data; this is intentional, not an oversight.

## Stack
- **Express** (API + serves the existing static frontend from the parent folder)
- **SQLite via `node:sqlite`** (Node's built-in module — no native compile toolchain needed)
- **JWT auth**, tenant-scoped via a `tenant_id` column enforced on every query
  (`server/auth.js` → `req.tenantId`, never taken from client input)

## Run it
```
cd server
npm install
npm run seed     # creates data/crm.sqlite, tenant "turan-capital", 1 user, 6 LP records
npm start         # http://localhost:4000
```
Open **http://localhost:4000** (not `index.html` directly — the app needs to be served
over HTTP so `fetch()` calls work).

**Demo login:** `admin@turancapital.kz` / `TuranDemo2025!` (pre-filled in the login form)

## What's real vs. what's still demo data
| Real (DB + API) | Still static (unchanged) |
|---|---|
| LP Register (`js/lp-register.js` `lpRegister[]`) | Deal Pipeline, Portfolio, Capital Calls journal, Distributions, everything else |

## Multi-tenancy model used here
Shared DB, shared tables, `tenant_id` column on every tenant-scoped table
(`server/db.js`). This is the fastest strategy to stand up a PoC — **not** the
recommendation for production with regulated KYC/AML data. For production,
migrate to schema-per-tenant (Postgres) per the roadmap discussed with the
product owner; the row-level model here is a stopgap to prove the concept.

## Extending the slice
To wire up another page (e.g. Capital Calls):
1. Add a table + `tenant_id` column in `server/db.js`.
2. Add `GET/POST/PUT` routes in `server/index.js`, scoped by `req.tenantId`.
3. In `js/api-auth.js`, add a `loadXFromApi()` function mirroring `loadLpRegisterFromApi()`,
   and extend the `navigateTo` wrapper to call it for that page's key.
4. Empty out the corresponding hardcoded array in its `js/*.js` file.
