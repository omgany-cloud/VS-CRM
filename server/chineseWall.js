// AFSA information-barrier (Chinese Wall) between FM (Fund Management) and
// CF&A (Corporate Finance & Advisory) — any role without the `accessFM`
// permission must not see FM-direction onboarding clients or anything
// scoped to them (tasks, engagements). Shared by both the GET filter and
// the write guards in server/index.js so the rule lives in exactly one
// place.

const RESTRICTED_DIRECTION = 'FM';

function blocksPermissions(permissions, direction) {
  return !permissions.accessFM && direction === RESTRICTED_DIRECTION;
}

function filterClientsForPermissions(clients, permissions) {
  if (permissions.accessFM) return clients;
  return clients.filter(c => c.direction !== RESTRICTED_DIRECTION);
}

// Documents (server/db.js's `documents` table) have no direction column of
// their own — unlike ob_clients/engagements/conflict_approvals, one flat
// list is shared by both business lines, distinguished only by the
// `category` a user picked at upload time (index.html's docUploadCategory
// select — the full fixed set is KYC/AML, First Closing, Сделки, Портфель,
// Capital Calls, Distributions, Отчёты, Прочее). The categories that mirror
// FM-only data elsewhere (deals/portfolio/capital-calls/LP fund closing are
// all already accessFM-gated as whole endpoints) get the same wall here;
// KYC/AML, Отчёты and Прочее are left visible to everyone with internal
// access since KYC/AML applies to CF&A clients too and the other two are
// generic catch-alls, not FM-specific.
const FM_ONLY_DOCUMENT_CATEGORIES = ['Сделки', 'Портфель', 'Capital Calls', 'Distributions', 'First Closing'];

function blocksDocumentCategory(permissions, category) {
  return !permissions.accessFM && FM_ONLY_DOCUMENT_CATEGORIES.includes(category);
}

function filterDocumentsForPermissions(documents, permissions) {
  if (permissions.accessFM) return documents;
  return documents.filter(d => !FM_ONLY_DOCUMENT_CATEGORIES.includes(d.category));
}

module.exports = {
  blocksPermissions, filterClientsForPermissions, RESTRICTED_DIRECTION,
  FM_ONLY_DOCUMENT_CATEGORIES, blocksDocumentCategory, filterDocumentsForPermissions,
};
