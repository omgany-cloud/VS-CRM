// Conditions of a conflict decision «Одобрено с условиями» (server/conflictConditions.js):
// the decider lists what to do, the executor and the deadline; the executor
// confirms with what was done. Open "before start" conditions hold the start
// of work on the client's contract.
let conflictConditionsForm = null;

function conflictConditionDay(day) { return day ? day.slice(0, 10).split('-').reverse().join('.') : '—'; }
function conflictConditionToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function conflictConditionOverdue(c) { return c.status === 'open' && c.dueDate < conflictConditionToday(); }
function conflictMissingConditions(a) { return a.status === 'Approved with conditions' && !(a.conditions || []).length; }
function myOpenConflictConditions(list) {
  const me = getAuth()?.user?.id;
  return list.reduce((n, a) => n + (a.conditions || []).filter(c => c.status === 'open' && c.assigneeId === me).length, 0);
}
function conflictHasOpenConditions(a) { return conflictMissingConditions(a) || (a.conditions || []).some(c => c.status === 'open'); }

// Registry cell: "done of active", overdue ones and a decision whose conditions were never recorded.
function conflictConditionsCell(a) {
  if (conflictMissingConditions(a)) return '<span class="conflict-cond-warn">не внесены</span>';
  const active = (a.conditions || []).filter(c => c.status !== 'cancelled');
  if (!active.length) return '—';
  const done = active.filter(c => c.status === 'done').length, late = active.filter(conflictConditionOverdue).length;
  return `<span class="${done === active.length ? 'conflict-cond-done' : ''}">${done} из ${active.length}</span>${late ? ` <span class="conflict-cond-warn">· просрочено ${late}</span>` : ''}`;
}

function conflictConditionStatus(c) {
  if (c.status === 'done') return `<p class="conflict-cond-result"><i class="fas fa-check" aria-hidden="true"></i> Выполнено ${conflictConditionDay(c.closedAt)} · ${escapeHtml(c.closedByName || '')}: ${escapeHtml(c.closeNote)}</p>`;
  if (c.status === 'cancelled') return `<p class="conflict-cond-result"><i class="fas fa-ban" aria-hidden="true"></i> Отменено ${conflictConditionDay(c.closedAt)} · ${escapeHtml(c.closedByName || '')}: ${escapeHtml(c.closeNote)}</p>`;
  return '';
}
function conflictConditionsPanel(a) {
  const list = a.conditions || [];
  if (a.status !== 'Approved with conditions' && !list.length) return '';
  const canAdd = a.status === 'Approved with conditions' && currentUserPermission('decideConflicts') && !currentUserPermission('readOnly');
  return `<section class="conflict-conditions" aria-labelledby="conflictConditionsTitle">
    <h4 id="conflictConditionsTitle">Условия решения</h4>
    <p class="conflict-cond-hint">Пока условия с отметкой «до начала работы» не выполнены, работу по договору клиента начать нельзя.</p>
    ${conflictMissingConditions(a) ? '<p class="conflict-cond-alert">Условия не внесены. Добавьте их с исполнителем и сроком — без них работа по договору не начнётся.</p>' : ''}
    ${list.map(c => `<article class="conflict-condition conflict-condition-${c.status}${conflictConditionOverdue(c) ? ' overdue' : ''}">
      <p class="conflict-cond-text">${escapeHtml(c.text)}</p>
      <p class="conflict-cond-meta">Исполнитель: ${escapeHtml(c.assigneeName || '—')} · Срок: ${conflictConditionDay(c.dueDate)}${conflictConditionOverdue(c) ? ' (просрочено)' : ''} · ${c.beforeStart ? 'до начала работы' : 'в ходе работы'}${c.status === 'open' ? ' · <strong>в работе</strong>' : ''}</p>
      ${conflictConditionStatus(c)}
      ${c.canComplete || c.canCancel ? `<div class="conflict-cond-actions">
        ${c.canComplete ? `<button type="button" class="contract-primary" onclick="showConflictConditionClose(${a.id},${c.id},'done')">Отметить выполненным</button>` : ''}
        ${c.canCancel ? `<button type="button" class="contract-secondary" onclick="showConflictConditionClose(${a.id},${c.id},'cancel')">Отменить условие</button>` : ''}
      </div><div id="conflictConditionClose-${c.id}"></div>` : ''}
    </article>`).join('')}
    ${canAdd ? `<button type="button" class="contract-secondary" onclick="showConflictConditionsForm(${a.id},'add')"><i class="fas fa-plus" aria-hidden="true"></i> Добавить условие</button>` : ''}
  </section>`;
}

function showConflictConditionClose(approvalId, conditionId, action) {
  const box = document.getElementById('conflictConditionClose-' + conditionId);
  if (!box) return;
  const done = action === 'done';
  box.innerHTML = `<form class="conflict-cond-close" onsubmit="event.preventDefault();closeConflictCondition(${approvalId},${conditionId},'${done ? 'done' : 'cancel'}',this)">
    <label for="conflictCondNote-${conditionId}">${done ? 'Что сделано' : 'Причина отмены'}</label>
    <textarea id="conflictCondNote-${conditionId}" rows="2" maxlength="${done ? 2000 : 1000}" required placeholder="${done ? 'Например: барьер установлен, приказ № 12 от 30.10' : 'Например: условие больше не требуется'}"></textarea>
    <div class="conflict-cond-actions"><button type="submit" class="contract-primary">${done ? 'Подтвердить выполнение' : 'Отменить условие'}</button>
      <button type="button" class="contract-secondary" onclick="this.closest('form').remove()">Назад</button></div>
    <p class="conflict-cond-status" role="status"></p>
  </form>`;
  document.getElementById('conflictCondNote-' + conditionId)?.focus();
}
async function closeConflictCondition(approvalId, conditionId, action, form) {
  const note = form.querySelector('textarea').value.trim(), status = form.querySelector('.conflict-cond-status'), button = form.querySelector('button[type=submit]');
  if (!note) { status.textContent = action === 'done' ? 'Опишите, что сделано' : 'Укажите причину отмены'; return; }
  if (button.disabled) return;
  button.disabled = true;
  try {
    await apiFetch(`/api/conflict-approvals/${approvalId}/conditions/${conditionId}/${action === 'done' ? 'complete' : 'cancel'}`, {
      method: 'POST', body: JSON.stringify(action === 'done' ? { note } : { reason: note }) });
    await loadConflictApprovalsFromApi();
    openConflictApprovalDetail(approvalId);
    showToast(action === 'done' ? '✅ Условие отмечено выполненным' : 'Условие отменено', 'green');
  } catch (err) { status.textContent = err.message; button.disabled = false; }
}

// One form serves the decision «Одобрить с условиями» and adding conditions later.
function conflictConditionBlankRow() { return { text: '', assigneeId: '', dueDate: '', beforeStart: true }; }
async function showConflictConditionsForm(approvalId, mode) {
  const content = document.getElementById('obNewModalContent');
  if (!content) return;
  content.innerHTML = '<p class="conflict-cond-hint">Загрузка списка сотрудников…</p>';
  try {
    const { people } = await apiFetch(`/api/conflict-approvals/${approvalId}/condition-assignees`);
    conflictConditionsForm = { approvalId, mode, people, rows: [conflictConditionBlankRow()] };
    renderConflictConditionsForm();
  } catch (err) {
    content.innerHTML = `<p class="conflict-cond-alert">${escapeHtml(err.message)}</p><button type="button" class="contract-secondary" onclick="openConflictApprovalDetail(${approvalId})">Назад</button>`;
  }
}
function renderConflictConditionsForm() {
  const form = conflictConditionsForm, content = document.getElementById('obNewModalContent');
  if (!form || !content) return;
  const today = conflictConditionToday(), decide = form.mode === 'decide';
  content.innerHTML = `<form class="conflict-cond-form" onsubmit="event.preventDefault();submitConflictConditions(this)">
    <p class="conflict-cond-hint">${decide ? 'Решение «Одобрено с условиями» фиксируется вместе с условиями. ' : ''}У каждого условия — исполнитель и срок; исполнитель получит письмо и отметит выполнение здесь же.</p>
    ${form.rows.map((r, i) => `<fieldset class="conflict-cond-row"><legend>Условие ${i + 1}</legend>
      <label for="ccText-${i}">Что нужно сделать</label>
      <textarea id="ccText-${i}" rows="2" maxlength="1000" required oninput="conflictConditionsForm.rows[${i}].text=this.value">${escapeHtml(r.text)}</textarea>
      <div class="conflict-cond-grid">
        <div><label for="ccAssignee-${i}">Исполнитель</label><select id="ccAssignee-${i}" required onchange="conflictConditionsForm.rows[${i}].assigneeId=this.value">
          <option value="">— Выберите —</option>${form.people.map(p => `<option value="${p.id}"${String(p.id) === String(r.assigneeId) ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div><label for="ccDue-${i}">Срок</label><input id="ccDue-${i}" type="date" min="${today}" required value="${r.dueDate}" onchange="conflictConditionsForm.rows[${i}].dueDate=this.value" /></div>
      </div>
      <label class="conflict-cond-check"><input type="checkbox"${r.beforeStart ? ' checked' : ''} onchange="conflictConditionsForm.rows[${i}].beforeStart=this.checked" /> Выполнить до начала работы по договору</label>
      ${form.rows.length > 1 ? `<button type="button" class="contract-secondary" onclick="removeConflictConditionRow(${i})">Убрать условие</button>` : ''}
    </fieldset>`).join('')}
    <button type="button" class="contract-secondary" onclick="addConflictConditionRow()"><i class="fas fa-plus" aria-hidden="true"></i> Ещё условие</button>
    <p class="conflict-cond-status" role="status"></p>
    <div class="conflict-cond-actions conflict-cond-submit">
      <button type="button" class="contract-secondary" onclick="openConflictApprovalDetail(${form.approvalId})">Назад</button>
      <button type="submit" class="contract-primary">${decide ? 'Зафиксировать решение с условиями' : 'Добавить условия'}</button>
    </div>
  </form>`;
}
function addConflictConditionRow() {
  if (!conflictConditionsForm || conflictConditionsForm.rows.length >= 20) return;
  conflictConditionsForm.rows.push(conflictConditionBlankRow()); renderConflictConditionsForm();
  document.getElementById('ccText-' + (conflictConditionsForm.rows.length - 1))?.focus();
}
function removeConflictConditionRow(i) {
  if (!conflictConditionsForm || conflictConditionsForm.rows.length < 2) return;
  conflictConditionsForm.rows.splice(i, 1); renderConflictConditionsForm();
}
async function submitConflictConditions(formEl) {
  const form = conflictConditionsForm, status = formEl.querySelector('.conflict-cond-status'), button = formEl.querySelector('button[type=submit]');
  if (!form || button.disabled) return;
  const conditions = form.rows.map(r => ({ text: r.text.trim(), assigneeId: Number(r.assigneeId), dueDate: r.dueDate, beforeStart: r.beforeStart }));
  const incomplete = conditions.findIndex(c => !c.text || !c.assigneeId || !c.dueDate);
  if (incomplete >= 0) { status.textContent = `Условие ${incomplete + 1}: укажите, что сделать, исполнителя и срок`; return; }
  button.disabled = true;
  try {
    if (form.mode === 'decide') {
      await apiFetch(`/api/conflict-approvals/${form.approvalId}`, { method: 'PUT', body: JSON.stringify({ status: 'Approved with conditions', conditions }) });
    } else {
      await apiFetch(`/api/conflict-approvals/${form.approvalId}/conditions`, { method: 'POST', body: JSON.stringify({ conditions }) });
    }
    conflictConditionsForm = null;
    await loadConflictApprovalsFromApi();
    openConflictApprovalDetail(form.approvalId);
    showToast(form.mode === 'decide' ? '✅ Решение зафиксировано с условиями' : '✅ Условия добавлены', 'green');
  } catch (err) { status.textContent = err.message; button.disabled = false; }
}

// From a contract's next step: the decision that holds its start of work.
async function openConflictApprovalPage(approvalId) {
  navigateTo('conflict-approvals');
  await loadConflictApprovalsFromApi();
  if (approvalId && conflictApprovals.some(a => a.id === approvalId)) openConflictApprovalDetail(approvalId);
}
