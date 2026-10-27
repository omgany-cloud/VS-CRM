// Explicit adapters: linking a process never grants access to that process.
const { db } = require('./db');
const { assertContractAccess, ContractError } = require('./contractDocuments');
const SOURCES = {
  contract: { table: 'engagements', label: 'Договор', title: r => `${r.contract_num || 'Без номера'} · ${r.client_name}`, status: 'status', path: 'engagements' },
  client: { table: 'ob_clients', label: 'Онбординг', title: r => r.name, status: 'onboarding_status', path: 'ob-clients' },
  workflow: { table: 'workflow_instances', label: 'Согласование / KYC', title: r => r.entity_name, status: 'status', path: 'workflow' },
  deal: { table: 'deals', label: 'Сделка', title: r => r.company, status: 'stage', fm: true, path: 'deals' },
  ic: { table: 'ic_memos', label: 'Инвесткомитет', title: r => r.company, status: 'status', fm: true, path: 'ic-memos' },
  'capital-call': { table: 'capital_calls', label: 'Capital Call', title: r => `${r.cc_number} · ${r.purpose || ''}`, status: 'status', fm: true, path: 'capital-calls' },
  distribution: { table: 'distributions', label: 'Распределение', title: r => r.dist_number, status: 'status', fm: true, path: 'distributions' },
  nav: { table: 'hf_nav_history', label: 'NAV', title: r => `NAV · ${r.as_of_date}`, status: 'status', fm: true, path: 'hf/nav' },
  conflict: { table: 'conflict_approvals', label: 'Конфликт / Одобрение', title: r => r.deal_ref || r.decision_type, status: 'status', path: 'conflict-approvals' },
  report: { table: 'afsa_reports', label: 'Отчёт регулятору', title: r => `${r.period} · ${r.report_type}`, status: 'status', fm: true, path: 'afsa-reports' },
  sandbox: { table: 'sandbox_projects', label: 'Песочница', title: r => r.name, status: 'status', fm: true, path: 'sandbox' },
  lp: { table: 'lp_register', label: 'LP Register', title: r => `${r.register_id} · ${r.name}`, status: 'status', fm: true, path: 'lp' },
  portfolio: { table: 'portfolio', label: 'Портфель', title: r => r.name, status: 'status', fm: true, path: 'portfolio' },
  spv: { table: 'spvs', label: 'SPV', title: r => r.name, status: 'status', fm: true, path: 'spvs' },
  fund: { table: 'funds', label: 'Фонд', title: r => r.name, status: 'status', fm: true, path: 'funds' },
  // Closing is a process of a fund even before its checklist is first saved.
  closing: { table: 'funds', label: 'First Closing', title: r => r.name, status: 'status', fm: true, path: 'funds' },
  subscription: { table: 'hf_subscriptions', label: 'Подписка', title: r => r.sub_number, status: 'status', fm: true, path: 'hf/subscriptions' },
  redemption: { table: 'hf_redemptions', label: 'Погашение', title: r => r.redemption_number, status: 'status', fm: true, path: 'hf/redemptions' },
  restricted: { table: 'restricted_list', label: 'Restricted List', title: r => r.company, status: 'restriction_type', fm: true, path: 'restricted-list' },
  coi: { table: 'coi_registry', label: 'Реестр COI', title: r => r.coi_id || r.description, status: 'status', path: 'coi-registry' },
};
const CATEGORIES = [
  ['client', 'Онбординг', 'fa-user-plus', 'ob-clients', 'Клиенты и договоры'],
  ['contract', 'Договоры', 'fa-file-signature', 'engagements', 'Клиенты и договоры'],
  ['conflict', 'Конфликты / Одобрения', 'fa-scale-balanced', 'conflict-approvals', 'Клиенты и договоры'],
  ['sandbox', 'Песочница', 'fa-flask', 'sandbox', 'Инвестиции'],
  ['deal', 'Сделки / Pipeline', 'fa-handshake', 'deals', 'Инвестиции'],
  ['ic', 'Инвесткомитет', 'fa-users', 'ic', 'Инвестиции'],
  ['portfolio', 'Портфель', 'fa-briefcase', 'portfolio', 'Инвестиции'],
  ['spv', 'SPV', 'fa-sitemap', 'spvs', 'Инвестиции'],
  ['lp', 'LP Register', 'fa-address-book', 'lp-register', 'Фонды и инвесторы'],
  ['capital-call', 'Capital Calls', 'fa-money-bill-transfer', 'lp-capital-calls', 'Фонды и инвесторы'],
  ['distribution', 'Distributions', 'fa-coins', 'lp-distributions', 'Фонды и инвесторы'],
  ['closing', 'First Closing', 'fa-flag-checkered', 'closing', 'Фонды и инвесторы'],
  ['fund', 'Фонды', 'fa-landmark', 'fund-compare', 'Фонды и инвесторы'],
  ['subscription', 'Подписки', 'fa-arrow-right-to-bracket', 'hf-subscriptions', 'Фонды и инвесторы'],
  ['redemption', 'Погашения', 'fa-arrow-right-from-bracket', 'hf-subscriptions', 'Фонды и инвесторы'],
  ['nav', 'NAV', 'fa-chart-line', 'hf-nav', 'Фонды и инвесторы'],
  ['workflow', 'Согласования / KYC', 'fa-check-double', 'workflow', 'Контроль и отчётность'],
  ['restricted', 'Restricted List', 'fa-shield-halved', 'ob-restricted', 'Контроль и отчётность'],
  ['coi', 'Реестр COI', 'fa-triangle-exclamation', 'ob-restricted', 'Контроль и отчётность'],
  ['report', 'Отчётность регулятору', 'fa-calendar-check', 'calendar', 'Контроль и отчётность'],
];
function sourceCategories(req, items) {
  return CATEGORIES.filter(([kind]) => !SOURCES[kind].fm || req.user.permissions.accessFM)
    .map(([kind, title, icon, page, group]) => ({ kind, title, icon, page, group, count: items.filter(s => s.kind === kind).length }));
}
function getSource(req, kind, id) {
  const def = Object.hasOwn(SOURCES, kind) ? SOURCES[kind] : null;
  if (!def || !Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new ContractError(404, 'Процесс не найден');
  const row = db.prepare(`SELECT * FROM ${def.table} WHERE tenant_id = ? AND id = ?`).get(req.tenantId, Number(id));
  if (!row) throw new ContractError(404, 'Процесс не найден');
  if (!req.user.permissions.internal || (def.fm && !req.user.permissions.accessFM)) throw new ContractError(403, 'Нет доступа к процессу');
  if (kind === 'contract') assertContractAccess(req, row);
  if (kind === 'client' && row.direction === 'FM' && !req.user.permissions.accessFM) throw new ContractError(403, 'Нет доступа к клиенту FM');
  if (kind === 'conflict') {
    if (row.client_id) getSource(req, 'client', row.client_id);
    if (row.engagement_id) getSource(req, 'contract', row.engagement_id);
  }
  if (kind === 'coi' && row.linked_client_id) getSource(req, 'client', row.linked_client_id);
  // The legacy workflow listing is broader; discussions deliberately respect
  // the underlying FM boundary even for these historical entries.
  if (kind === 'workflow' && row.type !== 'kyc_cfa' && !req.user.permissions.accessFM) throw new ContractError(403, 'Нет доступа к процессу FM');
  if (kind === 'workflow' && row.type === 'kyc_cfa' && row.entity_id) getSource(req, 'client', row.entity_id);
  return { kind, id: row.id, label: def.label, title: String(def.title(row) || def.label), status: row[def.status] || '', row };
}
function sourceView(source) {
  const { row, ...view } = source;
  const fundId = ['fund', 'closing'].includes(source.kind) ? row.id : row.fund_id || null;
  const fund = fundId && db.prepare('SELECT name FROM funds WHERE id = ? AND tenant_id = ?').get(fundId, row.tenant_id);
  return { ...view, fundId, fundName: fund?.name || '' };
}
function listSources(req) {
  const items = [];
  for (const [kind, def] of Object.entries(SOURCES)) {
    if (def.fm && !req.user.permissions.accessFM) continue;
    for (const row of db.prepare(`SELECT id FROM ${def.table} WHERE tenant_id = ? ORDER BY id DESC`).all(req.tenantId)) {
      try { items.push(sourceView(getSource(req, kind, row.id))); }
      catch (err) { if (!(err instanceof ContractError)) throw err; }
    }
  }
  return items;
}
module.exports = { SOURCES, getSource, sourceView, listSources, sourceCategories };
