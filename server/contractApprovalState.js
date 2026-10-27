const { db } = require('./db');

class ContractError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function contractMetadata(row) {
  return {
    contractNum: row.contract_num, clientName: row.client_name, date: row.date, dealRef: row.deal_ref,
    serviceType: row.service_type, feeType: row.fee_type, feeAmount: row.fee_amount,
    currency: row.currency, successFee: row.success_fee, retainer: row.retainer,
    feeRate: row.fee_rate, dealValue: row.deal_value, payTerms: row.pay_terms,
    startDate: row.start_date, endDate: row.end_date,
  };
}

function latestCycle(tenantId, engagementId) {
  return db.prepare('SELECT * FROM contract_approval_cycles WHERE tenant_id = ? AND engagement_id = ? ORDER BY cycle_number DESC LIMIT 1').get(tenantId, engagementId);
}

function approvalMatches(cycle, contract) {
  if (!cycle || cycle.invalidated_at || cycle.metadata_json !== JSON.stringify(contractMetadata(contract))) return false;
  const version = db.prepare('SELECT id FROM engagement_document_versions WHERE tenant_id = ? AND engagement_id = ? AND version_number = ?')
    .get(contract.tenant_id, contract.id, contract.document_version);
  return version?.id === cycle.document_version_id;
}

function documentFrozen(contract) {
  const cycle = latestCycle(contract.tenant_id, contract.id);
  return !!cycle && !cycle.invalidated_at && ['active', 'approved'].includes(cycle.status);
}

function assertApprovalEditable(contract) {
  if (documentFrozen(contract)) throw new ContractError(409, 'Редакция находится на согласовании или уже согласована. Сначала верните договор в доработку в блоке «Согласование».');
}

function approvalSummary(contract) {
  const cycle = latestCycle(contract.tenant_id, contract.id);
  return { available: true, status: !cycle ? 'draft' :
    cycle.invalidated_at || (['active', 'approved'].includes(cycle.status) && !approvalMatches(cycle, contract)) ? 'needs_revision' : cycle.status,
    cycleId: cycle?.id || null, frozen: documentFrozen(contract) };
}

module.exports = { ContractError, contractMetadata, latestCycle, approvalMatches, documentFrozen, assertApprovalEditable, approvalSummary };
