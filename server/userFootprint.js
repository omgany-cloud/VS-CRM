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
  { table: 'engagement_document_versions', column: 'author_email' },
  { table: 'contract_template_versions', column: 'author_email' },
];

// Matches by exact email or substring-in-name (case-insensitive) — some
// seed/legacy data embeds the name in a longer string, e.g.
// "CFO (Amankulov Zhanibek)", so a strict equality match would miss it.
function computeUserFootprint(tenantId, email, name, userId) {
  const hits = [];
  if (userId) {
    const memberships = db.prepare('SELECT room_id FROM discussion_members WHERE tenant_id = ? AND user_id = ?').all(tenantId, userId);
    if (memberships.length) hits.push({ table: 'discussion_members', column: 'user_id', count: memberships.length, sampleIds: memberships.slice(0, 5).map(r => r.room_id) });
    const routeAssignments = db.prepare(`SELECT id FROM contract_approval_routes r WHERE tenant_id = ? AND EXISTS
      (SELECT 1 FROM json_each(r.steps_json) s WHERE json_extract(s.value, '$.userId') = ?)`).all(tenantId, userId);
    if (routeAssignments.length) hits.push({ table: 'contract_approval_routes', column: 'steps_json.userId', count: routeAssignments.length, sampleIds: routeAssignments.slice(0, 5).map(r => r.id) });
    for (const [table, columns] of [
      ['discussion_task_state', ['updated_by','assignee_id']],
      ['discussion_task_commands', ['actor_id']],
      ['discussion_messages', ['author_id']],
      ['discussion_rooms', ['created_by']],
      ['discussion_relations', ['created_by']],
      ['contract_discussion_members', ['user_id', 'added_by']],
      ['contract_discussion_messages', ['author_id']],
      ['contract_approval_routes', ['created_by', 'updated_by']],
      ['contract_approval_cycles', ['initiator_id', 'invalidated_by', 'closed_by']],
      ['contract_approval_steps', ['assignee_id', 'decided_by']],
      ['contract_approval_commands', ['actor_id']],
      ['contract_signatures', ['recorded_by', 'voided_by']],
      ['contract_activations', ['activated_by']],
      ['contract_signing_commands', ['actor_id']],
    ]) {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE tenant_id = ? AND (${columns.map(c => c + ' = ?').join(' OR ')})`).all(tenantId, ...columns.map(() => userId));
      if (rows.length) hits.push({ table, column: columns.join('/'), count: rows.length, sampleIds: rows.slice(0, 5).map(r => r.id) });
    }
  }
  for (const { table, column } of FOOTPRINT_SOURCES) {
    // Document authors keep a stable user ID even after a profile is renamed.
    if (userId && ['engagement_document_versions', 'contract_template_versions'].includes(table)) {
      const rows = db.prepare(`SELECT id FROM ${table} WHERE tenant_id = ? AND created_by = ?`).all(tenantId, userId);
      if (rows.length) hits.push({ table, column: 'created_by', count: rows.length, sampleIds: rows.slice(0, 5).map(r => r.id) });
      continue;
    }
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
