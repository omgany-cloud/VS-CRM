// ============================================================
//  Team / Users / Roles — admin page for real login accounts and
//  the role constructor. Backed by /api/users and /api/roles
//  (server/index.js), loaded via loadUsersFromApi()/loadRolesFromApi()
//  in js/api-auth.js. Reuses the generic #modal-ob-new overlay for
//  create/edit forms (same pattern as the Conflict Approvals page
//  in js/onboarding.js).
// ============================================================

let crmUsers = [];
let usersActiveTab = 'users';

// Every value rendered on this page can originate from an admin-entered
// form (user name/email, custom role code/label/icon) — none of it is
// sanitized server-side, so every interpolation into innerHTML here must
// go through this first.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PERMISSION_DEFS = [
  { key: 'internal', label: 'Internal', hint: 'Доступ к внутренним данным (не внешний участник IC)' },
  { key: 'manageUsers', label: 'Управление пользователями', hint: 'Создание/деактивация/удаление аккаунтов' },
  { key: 'manageRoles', label: 'Управление ролями', hint: 'Создание и настройка ролей' },
  { key: 'accessFM', label: 'Доступ к FM', hint: 'Исключение из Китайской стены (FM-направление)' },
  { key: 'decideConflicts', label: 'Решения по конфликтам', hint: 'Restricted List + Conflict Approvals' },
  { key: 'authorICMemo', label: 'Авторство IC-меморандумов', hint: 'Создание новых меморандумов IC' },
  { key: 'riskVeto', label: 'Risk Manager вето', hint: 'Заключение/вето по IC-меморандумам' },
  { key: 'readOnly', label: 'Только просмотр', hint: 'Блокирует создание/редактирование/удаление данных для этой роли' },
];

function switchUsersTab(tab) {
  usersActiveTab = tab;
  const btnUsers = document.getElementById('usersTabUsers');
  const btnRoles = document.getElementById('usersTabRoles');
  if (btnUsers) { btnUsers.style.background = tab === 'users' ? '#3b82f6' : 'transparent'; btnUsers.style.border = tab === 'users' ? 'none' : '1px solid #2a3448'; btnUsers.style.color = tab === 'users' ? '#fff' : '#8a9bbf'; btnUsers.setAttribute('aria-selected', String(tab === 'users')); }
  if (btnRoles) { btnRoles.style.background = tab === 'roles' ? '#3b82f6' : 'transparent'; btnRoles.style.border = tab === 'roles' ? 'none' : '1px solid #2a3448'; btnRoles.style.color = tab === 'roles' ? '#fff' : '#8a9bbf'; btnRoles.setAttribute('aria-selected', String(tab === 'roles')); }
  const content = document.getElementById('usersContent');
  if (content) content.setAttribute('aria-labelledby', tab === 'roles' ? 'usersTabRoles' : 'usersTabUsers');
  if (tab === 'roles') renderRolesPage(); else renderUsersPage();
}

function roleOptionsHtml(selected) {
  return ROLE_CODES.map(code =>
    `<option value="${escapeHtml(code)}" ${code === selected ? 'selected' : ''}>${escapeHtml(roleLabel(code))}</option>`
  ).join('');
}

/* ===== Users tab ===== */

function renderUsersPage() {
  const el = document.getElementById('usersContent');
  if (!el) return;
  const btnRoles = document.getElementById('usersTabRoles');
  if (btnRoles) btnRoles.style.display = currentUserPermission('manageRoles') ? '' : 'none';

  const cntActive = crmUsers.filter(u => u.active).length;
  const cntExternal = crmUsers.filter(u => ROLES[u.role] && !ROLES[u.role].internal).length;

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-users"></i></div>
        <div class="kpi-body"><span class="kpi-label">Аккаунтов</span>
          <span class="kpi-value">${crmUsers.length}</span>
          <span class="kpi-delta">${cntActive} активных</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon purple"><i class="fas fa-user-shield"></i></div>
        <div class="kpi-body"><span class="kpi-label">Внешние участники IC</span>
          <span class="kpi-value">${cntExternal}</span>
          <span class="kpi-delta">Independent Member / LP Rep</span></div>
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button onclick="openNewUserModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">
        <i class="fas fa-user-plus"></i> Новый пользователь</button>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-users-cog" style="color:#3b82f6;margin-right:6px"></i>Пользователи тенанта</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th><th>Создан</th><th></th></tr></thead>
          <tbody>
            ${crmUsers.length === 0 ? `<tr><td colspan="6" style="text-align:center;padding:30px;color:#4a5568">Нет пользователей</td></tr>` :
            crmUsers.map(u => {
              const cfg = ROLES[u.role] || { color: '#64748b', icon: 'fa-user' };
              return `
              <tr>
                <td>${u.name ? escapeHtml(u.name) : '<span style="color:#4a5568">—</span>'}</td>
                <td>${escapeHtml(u.email)}</td>
                <td><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${escapeHtml(cfg.color)}22;color:${escapeHtml(cfg.color)}"><i class="fas ${escapeHtml(cfg.icon)}"></i> ${escapeHtml(roleLabel(u.role))}</span></td>
                <td>${u.active
                  ? `<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(34,197,94,0.12);color:#4ade80">Активен</span>`
                  : `<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(239,68,68,0.12);color:#f87171">Отключён</span>`}
                </td>
                <td style="color:#8a9bbf;font-size:12px">${u.createdAt ? u.createdAt.slice(0, 10) : '—'}</td>
                <td style="white-space:nowrap">
                  <button onclick="openEditUserModal(${u.id})" title="Редактировать"
                    style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:4px"><i class="fas fa-edit"></i></button>
                  <button onclick="toggleUserActive(${u.id}, ${!u.active})" title="${u.active ? 'Деактивировать' : 'Активировать'}"
                    style="background:transparent;border:1px solid #2a3448;color:${u.active ? '#f87171' : '#4ade80'};padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:4px">
                    <i class="fas ${u.active ? 'fa-user-slash' : 'fa-user-check'}"></i></button>
                  <button onclick="deleteUser(${u.id})" title="Удалить (только если нет истории действий)"
                    style="background:transparent;border:1px solid #2a3448;color:#f87171;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewUserModal() {
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('obNewModalTitle').innerHTML = '<i class="fas fa-user-plus" style="color:#3b82f6;margin-right:8px"></i>Новый пользователь';
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Имя</label>
        <input type="text" id="u_name" placeholder="Иванов И.И."
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Email *</label>
        <input type="email" id="u_email" placeholder="user@turancapital.kz"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Пароль *</label>
        <input type="password" id="u_password" placeholder="мин. 8 символов"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Роль *</label>
        <select id="u_role" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${roleOptionsHtml('ANALYST')}
        </select></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewUser()" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Создать</button>
    </div>`;
  modal.style.display = 'flex';
}

async function saveNewUser() {
  const email = document.getElementById('u_email')?.value?.trim();
  const password = document.getElementById('u_password')?.value;
  const role = document.getElementById('u_role')?.value;
  const name = document.getElementById('u_name')?.value?.trim();
  if (!email) { showToast('⚠️ Введите email', 'red'); return; }
  if (!password || password.length < 8) { showToast('⚠️ Пароль минимум 8 символов', 'red'); return; }

  try {
    await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email, password, role, name }) });
    await loadUsersFromApi();
    closeObNewModal();
    renderUsersPage();
    showToast('✅ Пользователь создан', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось создать: ' + err.message, 'red');
  }
}

function openEditUserModal(id) {
  const u = crmUsers.find(x => x.id === id);
  if (!u) return;
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('obNewModalTitle').innerHTML = `<i class="fas fa-user-edit" style="color:#3b82f6;margin-right:8px"></i>${escapeHtml(u.email)}`;
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Имя</label>
        <input type="text" id="u_editName" value="${escapeHtml(u.name || '')}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Email</label>
        <input type="email" id="u_editEmail" value="${escapeHtml(u.email)}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Роль</label>
        <select id="u_editRole" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${roleOptionsHtml(u.role)}
        </select></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Новый пароль (опционально)</label>
        <input type="password" id="u_editPassword" placeholder="Оставьте пустым, чтобы не менять"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448;margin-top:16px">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveUserEdit(${u.id})" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Сохранить</button>
    </div>`;
  modal.style.display = 'flex';
}

async function saveUserEdit(id) {
  const name = document.getElementById('u_editName')?.value?.trim();
  const email = document.getElementById('u_editEmail')?.value?.trim();
  const role = document.getElementById('u_editRole')?.value;
  const password = document.getElementById('u_editPassword')?.value;
  if (!email) { showToast('⚠️ Email не может быть пустым', 'red'); return; }
  try {
    await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ name, email, role }) });
    if (password) {
      if (password.length < 8) { showToast('⚠️ Пароль минимум 8 символов, остальные изменения сохранены', 'red'); }
      else await apiFetch(`/api/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
    }
    await loadUsersFromApi();
    closeObNewModal();
    renderUsersPage();
    showToast('✅ Изменения сохранены', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

async function toggleUserActive(id, nextActive) {
  if (!nextActive) {
    const u = crmUsers.find(x => x.id === id);
    if (!u) return;
    if (!confirm(`Деактивировать «${u.name || u.email}»? Доступ к системе будет заблокирован немедленно.`)) return;
  }
  try {
    await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ active: nextActive }) });
    await loadUsersFromApi();
    renderUsersPage();
    showToast(nextActive ? '✅ Пользователь активирован' : '✅ Пользователь деактивирован', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось изменить статус: ' + err.message, 'red');
  }
}

// Hybrid delete: the server only allows this for "empty" accounts (no
// footprint in the audit trail — server/userFootprint.js). Anyone with
// real history gets a 409 telling the caller to deactivate instead.
async function deleteUser(id) {
  const u = crmUsers.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Удалить «${u.name || u.email}» без возможности восстановления? Возможно только если у пользователя нет истории действий в системе.`)) return;
  try {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    await loadUsersFromApi();
    renderUsersPage();
    showToast('✅ Пользователь удалён', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}

/* ===== Roles tab (role constructor) ===== */

function renderRolesPage() {
  const el = document.getElementById('usersContent');
  if (!el) return;
  const roles = Object.values(ROLES).sort((a, b) => a.id - b.id);

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button onclick="openNewRoleModal()"
        style="background:#3b82f6;border:none;color:#fff;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">
        <i class="fas fa-shield-halved"></i> Новая роль</button>
    </div>
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-shield-halved" style="color:#3b82f6;margin-right:6px"></i>Роли тенанта</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Роль</th><th>Код</th><th>Права</th><th>Место в IC</th><th></th></tr></thead>
          <tbody>
            ${roles.map(r => `
              <tr>
                <td><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${escapeHtml(r.color)}22;color:${escapeHtml(r.color)}"><i class="fas ${escapeHtml(r.icon)}"></i> ${escapeHtml(r.label)}</span>
                  ${r.isSystem ? '<span style="margin-left:6px;font-size:9px;color:#5a6b8a;border:1px solid #2a3448;border-radius:4px;padding:1px 5px">system</span>' : ''}</td>
                <td style="font-family:monospace;font-size:11px;color:#8a9bbf">${escapeHtml(r.code)}</td>
                <td>${PERMISSION_DEFS.filter(p => r[p.key]).map(p =>
                  `<span title="${p.hint}" style="display:inline-block;margin:1px 3px 1px 0;font-size:9px;font-weight:700;padding:2px 6px;border-radius:5px;background:rgba(59,130,246,0.12);color:#60a5fa">${p.label}</span>`
                ).join('') || '<span style="color:#4a5568;font-size:11px">—</span>'}</td>
                <td style="font-size:11px;color:#8a9bbf">${r.icSeat || '—'}</td>
                <td style="white-space:nowrap">
                  <button onclick="openEditRoleModal(${r.id})" title="Редактировать"
                    style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:4px"><i class="fas fa-edit"></i></button>
                  <button onclick="deleteRole(${r.id})" title="${r.isSystem ? 'Системная роль — удаление недоступно' : 'Удалить'}" ${r.isSystem ? 'disabled' : ''}
                    style="background:transparent;border:1px solid #2a3448;color:${r.isSystem ? '#3d4a63' : '#f87171'};padding:5px 9px;border-radius:6px;cursor:${r.isSystem ? 'not-allowed' : 'pointer'};font-size:11px"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function permissionCheckboxesHtml(idPrefix, role) {
  return PERMISSION_DEFS.map(p => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;cursor:pointer">
      <input type="checkbox" id="${idPrefix}_${p.key}" ${role && role[p.key] ? 'checked' : ''}
        style="accent-color:#3b82f6;width:14px;height:14px" />
      <span title="${p.hint}">${p.label}</span>
    </label>`).join('');
}

function icSeatOptionsHtml(idPrefix, role) {
  const current = role ? role.icSeat : null;
  const options = IC_SEATS.map(seat => {
    const holder = roleForIcSeat(seat);
    const takenByOther = holder && (!role || holder.code !== role.code);
    const label = takenByOther ? `${seat} (занято: ${escapeHtml(holder.label)})` : seat;
    return `<option value="${seat}" ${current === seat ? 'selected' : ''}>${label}</option>`;
  }).join('');
  return `<select id="${idPrefix}_icSeat" onchange="warnIcSeatTaken('${idPrefix}')"
      style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
      <option value="">— нет —</option>${options}
    </select>
    <div id="${idPrefix}_icSeatWarning" style="font-size:11px;color:#f97316;margin-top:4px"></div>`;
}

function warnIcSeatTaken(idPrefix) {
  const select = document.getElementById(idPrefix + '_icSeat');
  const warning = document.getElementById(idPrefix + '_icSeatWarning');
  if (!select || !warning) return;
  const seat = select.value;
  const holder = seat ? roleForIcSeat(seat) : null;
  const codeInput = document.getElementById(idPrefix + '_code');
  const editingCode = codeInput ? codeInput.value : null;
  warning.textContent = (holder && holder.code !== editingCode)
    ? `⚠ Уже занято ролью «${holder.label}» — назначение здесь заменит их`
    : '';
}

function openNewRoleModal() {
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('obNewModalTitle').innerHTML = '<i class="fas fa-shield-halved" style="color:#3b82f6;margin-right:8px"></i>Новая роль';
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Код *</label>
        <input type="text" id="r_new_code" placeholder="JUNIOR_RM"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box;text-transform:uppercase" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Название *</label>
        <input type="text" id="r_new_label" placeholder="Junior RM"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Иконка (FontAwesome класс)</label>
        <input type="text" id="r_new_icon" value="fa-user" placeholder="fa-user"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Цвет</label>
        <input type="color" id="r_new_color" value="#64748b"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:4px;height:38px;box-sizing:border-box" /></div>
    </div>
    <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:10px;text-transform:uppercase">Права</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${permissionCheckboxesHtml('r_new', null)}</div>
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Место в Investment Committee</label>
      ${icSeatOptionsHtml('r_new', null)}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveNewRole()" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Создать</button>
    </div>`;
  modal.style.display = 'flex';
}

function collectPermissionFields(idPrefix) {
  const out = {};
  for (const p of PERMISSION_DEFS) out[p.key] = !!document.getElementById(`${idPrefix}_${p.key}`)?.checked;
  const icSeat = document.getElementById(idPrefix + '_icSeat')?.value || null;
  out.icSeat = icSeat || null;
  return out;
}

async function saveNewRole() {
  const code = document.getElementById('r_new_code')?.value?.trim().toUpperCase();
  const label = document.getElementById('r_new_label')?.value?.trim();
  const icon = document.getElementById('r_new_icon')?.value?.trim() || 'fa-user';
  const color = document.getElementById('r_new_color')?.value || '#64748b';
  if (!code || !/^[A-Z][A-Z0-9_]*$/.test(code)) { showToast('⚠️ Код обязателен: заглавные буквы/цифры/подчёркивание, начинается с буквы', 'red'); return; }
  if (!label) { showToast('⚠️ Введите название роли', 'red'); return; }

  const payload = { code, label, icon, color, ...collectPermissionFields('r_new') };
  try {
    await apiFetch('/api/roles', { method: 'POST', body: JSON.stringify(payload) });
    await loadRolesFromApi();
    closeObNewModal();
    renderRolesPage();
    showToast('✅ Роль создана', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось создать: ' + err.message, 'red');
  }
}

function openEditRoleModal(id) {
  const r = Object.values(ROLES).find(x => x.id === id);
  if (!r) return;
  const modal = document.getElementById('modal-ob-new');
  if (!modal) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('obNewModalTitle').innerHTML = `<i class="fas fa-shield-halved" style="color:#3b82f6;margin-right:8px"></i>${escapeHtml(r.label)}`;
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Код (неизменяем после создания)</label>
        <input type="text" id="r_edit_code" value="${escapeHtml(r.code)}" readonly
          style="width:100%;background:#0a0f18;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#5a6b8a;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Название</label>
        <input type="text" id="r_edit_label" value="${escapeHtml(r.label)}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Иконка (FontAwesome класс)</label>
        <input type="text" id="r_edit_icon" value="${escapeHtml(r.icon)}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Цвет</label>
        <input type="color" id="r_edit_color" value="${escapeHtml(r.color)}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:4px;height:38px;box-sizing:border-box" /></div>
    </div>
    <div style="background:#1c2333;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:#8a9bbf;margin-bottom:10px;text-transform:uppercase">Права</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${permissionCheckboxesHtml('r_edit', r)}</div>
    </div>
    <div style="margin-bottom:14px">
      <label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Место в Investment Committee</label>
      ${icSeatOptionsHtml('r_edit', r)}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:14px;border-top:1px solid #2a3448">
      <button onclick="closeObNewModal()" style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px">Отмена</button>
      <button onclick="saveRoleEdit(${r.id})" style="background:linear-gradient(135deg,#3b82f6,#2563eb);border:none;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">
        <i class="fas fa-save" style="margin-right:6px"></i>Сохранить</button>
    </div>`;
  modal.style.display = 'flex';
}

async function saveRoleEdit(id) {
  const label = document.getElementById('r_edit_label')?.value?.trim();
  const icon = document.getElementById('r_edit_icon')?.value?.trim() || 'fa-user';
  const color = document.getElementById('r_edit_color')?.value || '#64748b';
  if (!label) { showToast('⚠️ Введите название роли', 'red'); return; }

  const payload = { label, icon, color, ...collectPermissionFields('r_edit') };
  try {
    const result = await apiFetch(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    await loadRolesFromApi();
    closeObNewModal();
    renderRolesPage();
    if (result && result.warnings && result.warnings.pendingMemosAffected) {
      showToast(`✅ Роль обновлена. ⚠ Затронуто IC-меморандумов на голосовании: ${result.warnings.pendingMemosAffected}`, 'blue');
    } else {
      showToast('✅ Роль обновлена', 'green');
    }
  } catch (err) {
    showToast('⚠️ Не удалось сохранить: ' + err.message, 'red');
  }
}

async function deleteRole(id) {
  const r = Object.values(ROLES).find(x => x.id === id);
  if (!r) return;
  if (r.isSystem) { showToast('⚠️ Системную роль нельзя удалить', 'red'); return; }
  if (!confirm(`Удалить роль «${r.label}»? Возможно только если ни один пользователь её не использует.`)) return;
  try {
    await apiFetch(`/api/roles/${id}`, { method: 'DELETE' });
    await loadRolesFromApi();
    renderRolesPage();
    showToast('✅ Роль удалена', 'green');
  } catch (err) {
    showToast('⚠️ ' + err.message, 'red');
  }
}
