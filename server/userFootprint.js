// Detects whether a user has ever done anything trackable in the system,
// to decide whether DELETE /api/users/:id may hard-delete them or must
// refuse in favor of deactivation (server/index.js).
//
// Only columns actually stamped from a real logged-in session are checked.
// Deliberately excluded as noise (verified against the code that writes
// them): lp_register.rm / ob_clients.rm / engagements.rm (an assignment
// label, not an actor), conflict_approvals.decision_maker /
// coi_registry.responsible (fixed role/body labels like 'CF Deal
// Committee', never a person), deals.comments_json[].author (free-typed,
// defaults to 'CEO' regardless of who's logged in), ic_memos.votes_json[].name
// (set once at memo creation, never rewritten per-cast — consistent with
// votes being per-seat, not per-user-id).
const { db, at } = require('./db');

const FOOTPRINT_SOURCES = [
  { table: 'ob_tasks', column: 'completed_by' },
  { table: 'capital_calls', column: 'created_by' },
  { table: 'restricted_list', column: 'added_by' },
  { table: 'engagements', column: 'activated_by' },
  { table: 'ic_memos', column: 'author' },
  { table: 'documents', column: 'uploader' },
];

// Matches by exact email or substring-in-name (case-insensitive) — some
// seed/legacy data embeds the name in a longer string, e.g.
// "CFO (Amankulov Zhanibek)", so a strict equality match would miss it.
function computeUserFootprint(tenantId, email, name) {
  const hits = [];
  for (const { table, column } of FOOTPRINT_SOURCES) {
    let sql = `SELECT id FROM ${table} WHERE tenant_id=@tenantId AND LOWER(TRIM(${column}))=LOWER(TRIM(@email))`;
    const params = { tenantId, email: email || '' };
    if (name && name.trim()) {
      sql += ` OR (tenant_id=@tenantId AND ${column} LIKE '%'||@name||'%' COLLATE NOCASE)`;
      params.name = name.trim();
    }
    const rows = db.prepare(sql).all(at(params));
    if (rows.length) hits.push({ table, column, count: rows.length, sampleIds: rows.slice(0, 5).map(r => r.id) });
  }
  return hits;
}

module.exports = { computeUserFootprint };
