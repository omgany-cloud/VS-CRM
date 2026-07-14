// ============================================================
//  Team / Users — CEO-only admin page for real login accounts.
//  Backed by /api/users (server/index.js), loaded via
//  loadUsersFromApi() in js/api-auth.js. Reuses the generic
//  #modal-ob-new overlay for create/edit forms (same pattern as
//  the Conflict Approvals page in js/onboarding.js).
// ============================================================

let crmUsers = [];

function roleOptionsHtml(selected) {
  return ROLE_CODES.map(code =>
    `<option value="${code}" ${code === selected ? 'selected' : ''}>${roleLabel(code)}</option>`
  ).join('');
}

function renderUsersPage() {
  const el = document.getElementById('usersContent');
  if (!el) return;

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
                <td>${u.name || '<span style="color:#4a5568">—</span>'}</td>
                <td>${u.email}</td>
                <td><span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${cfg.color}22;color:${cfg.color}"><i class="fas ${cfg.icon}"></i> ${roleLabel(u.role)}</span></td>
                <td>${u.active
                  ? `<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(34,197,94,0.12);color:#4ade80">Активен</span>`
                  : `<span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(239,68,68,0.12);color:#f87171">Отключён</span>`}
                </td>
                <td style="color:#8a9bbf;font-size:12px">${u.createdAt ? u.createdAt.slice(0, 10) : '—'}</td>
                <td style="white-space:nowrap">
                  <button onclick="openEditUserModal(${u.id})" title="Редактировать"
                    style="background:transparent;border:1px solid #2a3448;color:#8a9bbf;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;margin-right:4px"><i class="fas fa-edit"></i></button>
                  <button onclick="toggleUserActive(${u.id}, ${!u.active})" title="${u.active ? 'Деактивировать' : 'Активировать'}"
                    style="background:transparent;border:1px solid #2a3448;color:${u.active ? '#f87171' : '#4ade80'};padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
                    <i class="fas ${u.active ? 'fa-user-slash' : 'fa-user-check'}"></i></button>
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
  document.getElementById('obNewModalTitle').innerHTML = `<i class="fas fa-user-edit" style="color:#3b82f6;margin-right:8px"></i>${u.email}`;
  document.getElementById('obNewModalContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Имя</label>
        <input type="text" id="u_editName" value="${u.name || ''}"
          style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box" /></div>
      <div><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Роль</label>
        <select id="u_editRole" style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:9px 12px;color:#e2e8f0;font-size:13px;box-sizing:border-box">
          ${roleOptionsHtml(u.role)}
        </select></div>
      <div style="grid-column:1/-1"><label style="font-size:11px;font-weight:700;color:#8a9bbf;display:block;margin-bottom:4px;text-transform:uppercase">Новый пароль (опционально)</label>
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
  const role = document.getElementById('u_editRole')?.value;
  const password = document.getElementById('u_editPassword')?.value;
  try {
    await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ name, role }) });
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
  try {
    await apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ active: nextActive }) });
    await loadUsersFromApi();
    renderUsersPage();
    showToast(nextActive ? '✅ Пользователь активирован' : '✅ Пользователь деактивирован', 'green');
  } catch (err) {
    showToast('⚠️ Не удалось изменить статус: ' + err.message, 'red');
  }
}
