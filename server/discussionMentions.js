const { db } = require('./db');
const { ContractError } = require('./contractDocuments');
const { rowToPermissions } = require('./rolesMapping');

function mentionRefs(value, text) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new ContractError(400, 'Выберите до 50 сотрудников в сообщении');
  const trim = text.length - text.trimStart().length, length = text.trim().length;
  const refs = value.map(m => {
    if (!m || !Number.isSafeInteger(m.userId) || m.userId < 1 || !Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.end)) throw new ContractError(400, 'Проверьте выбранных сотрудников');
    return { userId: m.userId, start: m.start - trim, end: m.end - trim };
  }).sort((a,b) => a.start-b.start);
  const trimmed = text.trim();
  if (refs.some((m,i) => m.start < 0 || m.end <= m.start || m.end > length || (i && m.start < refs[i-1].end) ||
    /[\p{L}\p{N}_]/u.test(trimmed[m.start - 1] || '') || /[\p{L}\p{N}_]/u.test(trimmed[m.end] || ''))) throw new ContractError(400, 'Имя сотрудника изменено в тексте. Выберите его из подсказки снова');
  return refs;
}
function mentionPerson(req, id) {
  const u = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.active FROM users u WHERE u.tenant_id = ? AND u.id = ?`).get(req.tenantId, id);
  const role = u && db.prepare('SELECT * FROM roles WHERE tenant_id = ? AND code = ?').get(req.tenantId, u.role);
  if (!u?.active || !role?.internal) throw new ContractError(400, 'Выбранный сотрудник недоступен. Выберите имя из подсказки снова');
  return { ...u, name: u.name || u.email, label: role.label, permissions: rowToPermissions(role) };
}
function resolveMentions(req, refs, text, assertAccess) {
  return refs.map(ref => {
    const person = mentionPerson(req, ref.userId);
    const label = text.slice(ref.start, ref.end);
    if (label !== person.name && label !== '@' + person.name) throw new ContractError(409, 'Имя сотрудника изменилось. Выберите его из подсказки снова');
    assertAccess({ tenantId: req.tenantId, user: person });
    return { ...ref, name: person.name };
  });
}
function mentionPeople(req, assertAccess, isMember) {
  const people = [];
  for (const row of db.prepare('SELECT id FROM users WHERE tenant_id = ? AND active = 1 AND id != ? ORDER BY name, id').all(req.tenantId, req.user.id)) {
    try {
      const person = mentionPerson(req, row.id), asPerson = { tenantId: req.tenantId, user: person };
      assertAccess(asPerson);
      people.push({ id: person.id, name: person.name, role: person.label, member: !!isMember(asPerson) });
    } catch (err) { if (!(err instanceof ContractError)) throw err; }
  }
  return people;
}
module.exports = { mentionRefs, resolveMentions, mentionPeople };
