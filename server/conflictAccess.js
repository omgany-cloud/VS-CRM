// Conflict decisions follow the client and contract they concern (TZ 13.1 п. 7).
// Links must point to records of this company the user can open, a contract
// must belong to the linked client, and a decided conflict keeps its links:
// the start-of-work check counts it for exactly that client and contract (M2.2).
const { getSource } = require('./discussionSources');
const { ContractError } = require('./contractDocuments');

const DECIDED = new Set(['Approved', 'Approved with conditions', 'Rejected']);

function linkId(value, label) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ContractError(400, `Некорректная ссылка на ${label}`);
  return id;
}

function conflictVisible(req, row) {
  for (const [kind, id] of [['client', row.client_id], ['contract', row.engagement_id]]) {
    if (id == null) continue;
    // A removed record leaves the decision visible as history.
    try { getSource(req, kind, id); } catch (err) { if (!(err instanceof ContractError)) throw err; if (err.status !== 404) return false; }
  }
  return true;
}

function conflictLinks(req, body, existing = null) {
  const pick = (key, column) => Object.hasOwn(body, key) ? body[key] : existing?.[column];
  const clientId = linkId(pick('clientId', 'client_id'), 'клиента'), engagementId = linkId(pick('engagementId', 'engagement_id'), 'договор');
  const changed = !existing || clientId !== existing.client_id || engagementId !== existing.engagement_id;
  if (!changed) return { clientId, engagementId };
  if (existing && DECIDED.has(existing.status)) {
    throw new ContractError(409, 'Решение по конфликту уже принято: клиента и договор изменить нельзя. Заведите новое решение.');
  }
  const client = clientId == null ? null : getSource(req, 'client', clientId).row;
  const contract = engagementId == null ? null : getSource(req, 'contract', engagementId).row;
  if (client && contract && contract.client_id !== client.id) throw new ContractError(400, 'Договор относится к другому клиенту');
  return { clientId, engagementId };
}

module.exports = { conflictVisible, conflictLinks };
