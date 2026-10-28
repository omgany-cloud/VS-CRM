// Generic approval chains (KYC, NAV) are only as visible as the record they
// approve (TZ 13.1 п. 7): an FM chain needs FM access, a CF&A KYC follows its
// client card. Creation checks that the record exists in this company and is
// open to the requester; the record, not the request, names the chain.
const { db } = require('./db');
const { SOURCES, getSource } = require('./discussionSources');
const { ContractError } = require('./contractDocuments');
const { rowToPermissions } = require('./rolesMapping');

const WF_ENTITIES = {
  kyc_lp: { kind: 'lp', entityType: 'LP' },
  kyc_cfa: { kind: 'client', entityType: 'CF&A' },
  nav_publish: { kind: 'nav', entityType: 'HfNav' },
  deal_ic: { kind: 'deal', entityType: 'Deal' },
};

function denied(err) { if (err instanceof ContractError) return true; throw err; }

function workflowVisible(req, row) {
  const def = WF_ENTITIES[row.type];
  // Unknown historical types are treated like the FM chains they came from.
  if ((!def || SOURCES[def.kind].fm) && !req.user.permissions.accessFM) return false;
  if (!def || row.entity_id == null) return true;
  const entity = db.prepare(`SELECT id FROM ${SOURCES[def.kind].table} WHERE tenant_id = ? AND id = ?`).get(req.tenantId, row.entity_id);
  // A removed record leaves its chain as history behind the type's own boundary.
  if (!entity) return true;
  try { getSource(req, def.kind, entity.id); return true; } catch (err) { return !denied(err); }
}

function workflowTarget(req, type, entityId) {
  const def = WF_ENTITIES[type], id = Number(entityId);
  if (!Number.isSafeInteger(id) || id < 1) throw new ContractError(400, 'Укажите объект согласования');
  const { row } = getSource(req, def.kind, id);
  if (type === 'kyc_cfa' && row.direction !== 'CF&A') throw new ContractError(400, 'KYC CF&A запускается только для клиента CF&A');
  let name = row.name;
  if (type === 'nav_publish') {
    const fund = db.prepare('SELECT name, short_name FROM funds WHERE tenant_id = ? AND id = ?').get(req.tenantId, row.fund_id);
    name = `NAV ${fund?.short_name || fund?.name || ''} на ${row.as_of_date}`.replace('  ', ' ');
  }
  return { id, entityType: def.entityType, entityName: name || '' };
}

// Step holders are notified only when they can open the chain themselves.
function workflowVisibleToUser(tenantId, user, row) {
  const role = db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(tenantId, user.role);
  if (!role) return false;
  const permissions = rowToPermissions(role);
  return !!permissions.internal && workflowVisible({ tenantId, user: { ...user, permissions } }, row);
}

module.exports = { WF_ENTITIES, workflowVisible, workflowTarget, workflowVisibleToUser };
