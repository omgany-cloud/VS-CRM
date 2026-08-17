// One-time seed: tenant (Turan Capital), system roles, and a single CEO
// admin account. No demo business data (funds, LPs, deals, portfolio,
// onboarding clients, IC memos, workflow instances, AFSA reports,
// documents) — this used to seed a full fictional dataset for demo
// purposes, but every real deployment (including this one) ends up
// manually clearing all of it before going live anyway (see
// DEPLOYMENT.md's "do not run npm run seed on a database with real data"
// warning). Create funds/LPs/deals/etc. for real through the app itself,
// same as any newly-registered tenant (POST /api/auth/signup) already
// starts with zero of everything.
const { SYSTEM_ROLES } = require('./rolesSeed');
const { upsertTenant, upsertRole, upsertUser } = require('./tenantProvisioning');

const SEED_EMAIL = 'admin@turancapital.kz';
const SEED_PASSWORD = 'TuranDemo2025!';

const tenant = upsertTenant('turan-capital', 'Turan Capital Holding Limited Partnership');
for (const r of SYSTEM_ROLES) upsertRole(tenant.id, r);
upsertUser(tenant.id, SEED_EMAIL, SEED_PASSWORD, 'CEO', 'Omirserikov Gaini');

console.log('--- Seed complete ---');
console.log('Tenant:', tenant.slug, '(id', tenant.id + ')');
console.log('Login:', SEED_EMAIL, '/', SEED_PASSWORD, '(CEO)');
