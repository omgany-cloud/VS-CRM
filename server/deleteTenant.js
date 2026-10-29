// Deletes ONE tenant (company) and every row it owns, across every
// tenant-scoped table — the safe replacement for "delete crm.sqlite and
// reseed" now that multiple real companies can share this database.
//
// Usage:  node deleteTenant.js <slug>
//
// Refuses to run without an explicit slug — there is no "delete
// everything" default. Every other tenant is completely untouched.
const { db } = require('./db');

const TENANT_SCOPED_TABLES = [
  'discussion_task_reads', 'discussion_task_commands', 'discussion_task_state',
  'discussion_files', 'discussion_messages', 'discussion_relations', 'discussion_links', 'discussion_members', 'discussion_rooms',
  'contract_discussion_members', 'contract_discussion_messages',
  'contract_payment_commands', 'contract_payments',
  'contract_signing_commands', 'contract_activations', 'contract_signatures',
  'contract_approval_commands', 'contract_approval_steps', 'contract_approval_cycles', 'contract_approval_routes',
  'contract_template_uses',
  'engagement_document_versions',
  'contract_template_versions', 'contract_templates',
  'users', 'roles',
  'lp_register', 'capital_calls', 'capital_call_line_items',
  'deals', 'portfolio',
  'conflict_conditions',
  'restricted_list', 'coi_registry', 'ob_clients', 'ob_tasks', 'engagements', 'conflict_approvals',
  'ic_memos', 'documents', 'workflow_instances',
];

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node deleteTenant.js <slug>');
    console.error('Run with no args on purpose to see this — pass the exact tenant slug to delete.');
    process.exit(1);
  }

  const tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (!tenant) {
    console.error(`No tenant found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Deleting tenant "${tenant.name}" (slug=${tenant.slug}, id=${tenant.id})...`);
  db.exec('BEGIN');
  try {
    for (const table of TENANT_SCOPED_TABLES) {
      const info = db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(tenant.id);
      if (info.changes) console.log(`  ${table}: ${info.changes} row(s) deleted`);
    }
    db.prepare('DELETE FROM tenants WHERE id = ?').run(tenant.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Failed, rolled back:', err.message);
    process.exit(1);
  }
  console.log(`Tenant "${slug}" and all its data deleted. Every other tenant is untouched.`);
}

main();
