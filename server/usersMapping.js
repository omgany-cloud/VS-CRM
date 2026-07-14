// Shared row <-> frontend-object mapping for `users` (Team/Users admin page).
// Never include password_hash here — this mapping is for API responses.

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

module.exports = { rowToUser };
