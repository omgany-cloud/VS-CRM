// Shared row <-> frontend-object mapping for `roles`.

function rowToRole(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    internal: !!row.internal,
    manageUsers: !!row.manage_users,
    manageRoles: !!row.manage_roles,
    accessFM: !!row.access_fm,
    decideConflicts: !!row.decide_conflicts,
    authorICMemo: !!row.author_ic_memo,
    riskVeto: !!row.risk_veto,
    readOnly: !!row.read_only,
    amlClear: !!row.aml_clear,
    icSeat: row.ic_seat,
    isSystem: !!row.is_system,
  };
}

// The permission subset attached to req.user.permissions / inlined in the
// login response — same shape as rowToRole() minus display-only fields.
function rowToPermissions(row) {
  return {
    internal: !!row.internal,
    manageUsers: !!row.manage_users,
    manageRoles: !!row.manage_roles,
    accessFM: !!row.access_fm,
    decideConflicts: !!row.decide_conflicts,
    authorICMemo: !!row.author_ic_memo,
    riskVeto: !!row.risk_veto,
    readOnly: !!row.read_only,
    amlClear: !!row.aml_clear,
    icSeat: row.ic_seat,
  };
}

const NO_PERMISSIONS = {
  internal: false, manageUsers: false, manageRoles: false, accessFM: false,
  decideConflicts: false, authorICMemo: false, riskVeto: false, readOnly: false,
  amlClear: false, icSeat: null,
};

const INSERT_SQL = `
  INSERT INTO roles
    (tenant_id, code, label, icon, color, internal, manage_users, manage_roles,
     access_fm, decide_conflicts, author_ic_memo, risk_veto, read_only, aml_clear, ic_seat, is_system)
  VALUES
    (@tenantId, @code, @label, @icon, @color, @internal, @manageUsers, @manageRoles,
     @accessFM, @decideConflicts, @authorICMemo, @riskVeto, @readOnly, @amlClear, @icSeat, @isSystem)
`;

const UPDATE_SQL = `
  UPDATE roles SET
    label=@label, icon=@icon, color=@color, internal=@internal,
    manage_users=@manageUsers, manage_roles=@manageRoles, access_fm=@accessFM,
    decide_conflicts=@decideConflicts, author_ic_memo=@authorICMemo,
    risk_veto=@riskVeto, read_only=@readOnly, aml_clear=@amlClear, ic_seat=@icSeat
  WHERE id=@id AND tenant_id=@tenantId
`;

function roleToParams(r) {
  return {
    code: r.code,
    label: r.label,
    icon: r.icon || 'fa-user',
    color: r.color || '#64748b',
    internal: r.internal ? 1 : 0,
    manageUsers: r.manageUsers ? 1 : 0,
    manageRoles: r.manageRoles ? 1 : 0,
    accessFM: r.accessFM ? 1 : 0,
    decideConflicts: r.decideConflicts ? 1 : 0,
    authorICMemo: r.authorICMemo ? 1 : 0,
    riskVeto: r.riskVeto ? 1 : 0,
    readOnly: r.readOnly ? 1 : 0,
    amlClear: r.amlClear ? 1 : 0,
    icSeat: r.icSeat || null,
    isSystem: r.isSystem ? 1 : 0,
  };
}

module.exports = { rowToRole, rowToPermissions, roleToParams, NO_PERMISSIONS, INSERT_SQL, UPDATE_SQL };
