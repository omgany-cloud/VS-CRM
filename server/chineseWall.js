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

module.exports = { blocksPermissions, filterClientsForPermissions, RESTRICTED_DIRECTION };
