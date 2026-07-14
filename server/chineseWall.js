// AFSA information-barrier (Chinese Wall) between FM (Fund Management) and
// CF&A (Corporate Finance & Advisory) — RM role must not see FM-direction
// onboarding clients or anything scoped to them (tasks, engagements).
// Shared by both the GET filter and the write guards in server/index.js so
// the rule lives in exactly one place.

const RM_BLOCKED_DIRECTION = 'FM';

function blocksRole(role, direction) {
  return role === 'RELATIONSHIP_MANAGER' && direction === RM_BLOCKED_DIRECTION;
}

function filterClientsForRole(clients, role) {
  if (role !== 'RELATIONSHIP_MANAGER') return clients;
  return clients.filter(c => c.direction !== RM_BLOCKED_DIRECTION);
}

module.exports = { blocksRole, filterClientsForRole, RM_BLOCKED_DIRECTION };
