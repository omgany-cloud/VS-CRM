// M2.2: signed PDF of the approved revision and the server-checked start of
// work. Forms are static in the panel so a refresh never drops a chosen file,
// date or void reason; only the status blocks are re-rendered.
let contractSigningUI = null;
const CONTRACT_CONDITION_STATES = {
  done: ['fa-circle-check', 'Выполнено'], pending: ['fa-hourglass-half', 'Ожидается'],
  rejected: ['fa-circle-xmark', 'Отклонено'], unknown: ['fa-circle-question', 'Нет данных'],
  expired: ['fa-clock-rotate-left', 'Истекло'],
};

function contractSigningPanel(engagementId) {
  return `<section id="contractSigningPanel" class="contract-versions" data-engagement-id="${engagementId}">
    <div class="contract-versions-heading"><div><h3>Подписание и начало работы</h3>
      <p>Подписанный обеими сторонами PDF согласованной редакции. Это регистрация факта подписания, а не электронная подпись.</p></div>
      <button type="button" class="contract-secondary" onclick="loadContractSigning(${engagementId})">Обновить</button></div>
    <p id="contractSigningMessage" class="contract-message" role="status" aria-live="polite">Загрузка…</p>
    <div id="contractSigningStatus"></div>
    <form id="contractSigningForm" hidden onsubmit="event.preventDefault();registerContractSignature(${engagementId})">
      <label for="contractSigningFile">Подписанный PDF · до 20 МиБ</label>
      <input id="contractSigningFile" type="file" accept=".pdf,application/pdf" required />
      <label for="contractSigningDate">Дата подписания</label>
      <input id="contractSigningDate" type="date" required />
      <p id="contractSigningHint" class="contract-empty"></p>
      <button id="contractSigningSubmit" type="submit" class="contract-primary">Зарегистрировать подписание</button>
    </form>
    <details id="contractSigningVoid" class="contract-version-history" hidden><summary>Аннулировать регистрацию</summary>
      <form onsubmit="event.preventDefault();voidContractSignature(${engagementId})">
        <label for="contractSigningVoidReason">Причина</label>
        <textarea id="contractSigningVoidReason" maxlength="1000" rows="2" required placeholder="Например: загружен не тот файл"></textarea>
        <button type="submit" class="contract-secondary">Аннулировать</button>
      </form>
    </details>
    <div id="contractSigningConditions"></div>
    <div id="contractCounterparty" hidden>
      <h4 id="contractCounterpartyTitle" class="contract-subheading"></h4>
      <div id="contractCounterpartyCurrent"></div>
      <form id="contractCounterpartyForm" hidden onsubmit="event.preventDefault();recordCounterpartyDecision(${engagementId})">
        <label for="contractCounterpartyResult">Решение</label>
        <select id="contractCounterpartyResult" required></select>
        <label id="contractCounterpartyNoteLabel" for="contractCounterpartyNote">Обоснование</label>
        <textarea id="contractCounterpartyNote" maxlength="2000" rows="2" required></textarea>
        <button id="contractCounterpartySubmit" type="submit" class="contract-primary">Записать решение</button>
      </form>
      <div id="contractCounterpartyHistory"></div>
    </div>
    <div id="contractSigningHistory"></div>
  </section>`;
}

function contractSigningMessage(text, error = false) {
  const el = document.getElementById('contractSigningMessage');
  if (el) { el.textContent = text; el.className = error ? 'contract-message-error' : 'contract-message'; }
}
function contractSigningDay(value) {
  const date = new Date(value + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU');
}
function contractSigningOpen(state) {
  return contractSigningUI === state && document.getElementById('contractSigningPanel') === state.panel;
}

function renderContractSignature(signature, engagementId, current) {
  return `<article class="contract-version${current ? ' contract-version-current' : ''}">
    <div class="contract-version-top"><strong>${current ? 'Подписанный договор' : 'Аннулированная регистрация'} · редакция ${signature.version ?? '—'}</strong>
      <button type="button" class="contract-secondary" onclick="downloadContractSignature(${engagementId},${signature.id},this)">Скачать</button></div>
    <div class="contract-version-name">${escapeHtml(signature.name)} <span>· ${contractVersionSize(signature.size)}</span></div>
    <p class="contract-version-meta">Дата подписания: ${escapeHtml(contractSigningDay(signature.signedDate))} · зарегистрировал ${escapeHtml(signature.recordedBy)}, ${escapeHtml(contractVersionDate(signature.recordedAt))}</p>
    ${current ? '' : `<p class="contract-version-note">${escapeHtml(signature.voidedBy || '')} · ${escapeHtml(contractVersionDate(signature.voidedAt))}: ${escapeHtml(signature.voidReason)}</p>`}
  </article>`;
}

function renderContractSigning(state) {
  const data = state.data, panel = state.panel;
  const headline = data.activation && data.serviceStatus === 'Active'
    ? `Работа начата ${contractSigningDay(data.activation.date)} · ${data.activation.by}`
    : data.signature ? `Подписан ${contractSigningDay(data.signature.signedDate)} · редакция ${data.signature.version}`
    : data.approvedVersion ? `Согласован · ожидает подписания (редакция ${data.approvedVersion.version})`
    : 'Подписание станет доступно после согласования текущей редакции';
  panel.querySelector('#contractSigningStatus').innerHTML = `<p><strong>${escapeHtml(headline)}</strong></p>
    ${data.signature ? renderContractSignature(data.signature, data.engagementId, true) : ''}`;

  const form = panel.querySelector('#contractSigningForm');
  form.hidden = !data.canRegister;
  const date = panel.querySelector('#contractSigningDate');
  date.max = data.today;
  if (data.approvedVersion) {
    panel.querySelector('#contractSigningHint').textContent =
      `Файл будет привязан к согласованной редакции ${data.approvedVersion.version}. CRM не сверяет текст скана с редакцией — проверьте его перед загрузкой.`;
  }
  panel.querySelector('#contractSigningVoid').hidden = !data.canVoid;

  const conditions = data.readiness.conditions.map(c => {
    const [icon, label] = CONTRACT_CONDITION_STATES[c.state] || CONTRACT_CONDITION_STATES.unknown;
    return `<div class="contract-process-step contract-condition-${c.state}"><span>${escapeHtml(c.label)}</span>
      <span><i class="fas ${icon}" aria-hidden="true"></i> ${label} · ${escapeHtml(c.detail)}</span></div>`;
  }).join('');
  const canManage = currentUserPermission('manageContracts') && !currentUserPermission('readOnly');
  const action = data.serviceStatus === 'Active'
    ? (data.activation ? '' : '<p class="contract-empty">Статус «Активен» был установлен до появления проверок начала работы.</p>')
    : data.serviceStatus !== 'Draft' ? `<p class="contract-empty">Статус услуги: ${escapeHtml(statusLabel(data.serviceStatus))}. Начать работу можно только по черновику.</p>`
    : data.canActivate ? `<button type="button" class="contract-primary" onclick="activateContractWork(${data.engagementId})">Начать работу</button>`
    : canManage ? '<p class="contract-empty">«Начать работу» станет доступно, когда все условия выполнены.</p>' : '';
  panel.querySelector('#contractSigningConditions').innerHTML = `<h4 class="contract-subheading">Условия начала работы</h4>${conditions}${action}`;
  renderCounterpartyDecision(panel, data.counterparty);

  panel.querySelector('#contractSigningHistory').innerHTML = data.voided.length
    ? `<details class="contract-version-history"><summary>Аннулированные регистрации (${data.voided.length})</summary>${data.voided.map(s => renderContractSignature(s, data.engagementId, false)).join('')}</details>` : '';
}

// A contract without a client card: the exemption from onboarding or the
// supplier's ADATA check (server/contractKinds.js). The form keeps its input.
function renderCounterpartyDecision(panel, party) {
  const box = panel.querySelector('#contractCounterparty');
  box.hidden = !party;
  if (!party) return;
  const exemption = party.check === 'exemption';
  const decision = (d, current) => `<article class="contract-version${current ? ' contract-version-current' : ''}">
    <div class="contract-version-top"><strong>${escapeHtml(d.resultLabel)}</strong></div>
    <p class="contract-version-meta">${escapeHtml(d.decidedBy)} · ${escapeHtml(contractVersionDate(d.decidedAt))}</p>
    <p class="contract-version-note">${escapeHtml(d.note)}</p></article>`;
  panel.querySelector('#contractCounterpartyTitle').textContent = party.label;
  panel.querySelector('#contractCounterpartyCurrent').innerHTML = party.current ? decision(party.current, true)
    : `<p class="contract-empty">${exemption ? 'Решение ещё не принято' : 'Проверка ещё не записана'}. ${exemption ? 'Принимают' : 'Проверяют'}: ${escapeHtml(party.who)}.</p>`;
  panel.querySelector('#contractCounterpartyForm').hidden = !party.canDecide;
  const select = panel.querySelector('#contractCounterpartyResult'), options = party.results.map(r => r.value).join();
  if (select.dataset.options !== options) {
    select.innerHTML = '<option value="">— выберите —</option>' + party.results.map(r => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`).join('');
    select.dataset.options = options;
  }
  panel.querySelector('#contractCounterpartyNoteLabel').textContent = exemption ? 'Обоснование: почему услуга вне лицензии' : 'Результат проверки в ADATA или причина, по которой она не нужна';
  panel.querySelector('#contractCounterpartySubmit').textContent = party.current ? 'Изменить решение' : 'Записать решение';
  panel.querySelector('#contractCounterpartyHistory').innerHTML = party.history.length
    ? `<details class="contract-version-history"><summary>Предыдущие решения (${party.history.length})</summary>${party.history.map(d => decision(d, false)).join('')}</details>` : '';
}

function recordCounterpartyDecision(engagementId) {
  const state = contractSigningUI, party = state?.data?.counterparty;
  if (!party?.canDecide) return;
  const result = state.panel.querySelector('#contractCounterpartyResult').value;
  const note = state.panel.querySelector('#contractCounterpartyNote').value.trim();
  if (!result || !note) return contractSigningMessage(party.check === 'exemption' ? 'Выберите решение и укажите обоснование' : 'Выберите результат и опишите проверку', true);
  const expectedDecisionId = party.current?.id || 0;
  const requestKey = contractSigningKey(state, 'counterparty', JSON.stringify([result, note, expectedDecisionId]));
  return runContractSigningAction(engagementId, 'Сохраняем решение…', async () => {
    await apiFetch(`/api/engagements/${engagementId}/counterparty-decisions`, { method: 'POST', body: JSON.stringify({ result, note, expectedDecisionId, requestKey }) });
    showToast('Решение записано', 'green');
    return apiFetch(`/api/engagements/${engagementId}/signing`);
  });
}

// Keep the cached registry row in step with server-owned fields.
function syncContractSigningRecord(data) {
  const engagement = engagements.find(e => e.id === data.engagementId);
  if (!engagement) return;
  engagement.status = data.serviceStatus;
  engagement.signedDate = data.signature?.signedDate || null;
  if (data.activation && data.serviceStatus === 'Active') {
    engagement.activationDate = data.activation.date; engagement.activatedBy = data.activation.by;
  }
}

async function loadContractSigning(engagementId) {
  const panel = document.getElementById('contractSigningPanel');
  if (!panel || Number(panel.dataset.engagementId) !== engagementId) return;
  if (!contractSigningUI || contractSigningUI.panel !== panel) contractSigningUI = { engagementId, panel, data: null, busy: false, request: 0, keys: {} };
  const state = contractSigningUI;
  if (state.busy) return;
  const request = ++state.request;
  try {
    const data = await apiFetch(`/api/engagements/${engagementId}/signing`);
    if (!contractSigningOpen(state) || request !== state.request) return;
    state.data = data;
    syncContractSigningRecord(data);
    renderContractSigning(state);
    contractSigningMessage(data.canRegister ? 'Загрузите PDF с подписями обеих сторон и укажите дату подписания.' : '');
  } catch (err) {
    if (contractSigningOpen(state) && request === state.request) contractSigningMessage('Не удалось загрузить подписание: ' + err.message + '. Нажмите «Обновить».', true);
  }
}

// A retried request reuses its key, so a lost response cannot register twice.
function contractSigningKey(state, action, fingerprint) {
  if (state.keys[action]?.fingerprint !== fingerprint) state.keys[action] = { fingerprint, key: contractTemplateRequestKey() };
  return state.keys[action].key;
}

async function runContractSigningAction(engagementId, pending, request) {
  const state = contractSigningUI;
  if (!state || state.engagementId !== engagementId || !state.data || state.busy) return;
  const controls = [...state.panel.querySelectorAll('button, input, textarea')];
  const before = controls.map(c => c.disabled);
  state.busy = true; ++state.request;
  controls.forEach(c => { c.disabled = true; });
  contractSigningMessage(pending);
  let data = null, error = '';
  try { data = await request(); }
  catch (err) { error = err.message; }
  finally { state.busy = false; controls.forEach((c, i) => { c.disabled = before[i]; }); }
  if (!data) {
    // Refresh the conditions, then keep the refusal visible; the form keeps its file and date.
    if (!contractSigningOpen(state)) return showToast(error, 'red');
    await loadContractSigning(engagementId);
    if (contractSigningOpen(state)) contractSigningMessage(error, true);
    return;
  }
  state.keys = {};
  syncContractSigningRecord(data);
  if (typeof renderEngagementsPage === 'function') renderEngagementsPage();
  // Reopen so the card header shows the server-confirmed status and dates.
  if (contractSigningOpen(state) && activeEngId === engagementId && !engEditMode) openEngagementModal(engagementId);
  else if (contractSigningOpen(state)) await loadContractSigning(engagementId);
  return data;
}

function registerContractSignature(engagementId) {
  const state = contractSigningUI, data = state?.data;
  if (!data?.canRegister) return;
  const file = state.panel.querySelector('#contractSigningFile').files[0];
  const signedDate = state.panel.querySelector('#contractSigningDate').value;
  if (!file || !signedDate) return contractSigningMessage('Выберите PDF и укажите дату подписания', true);
  if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) return contractSigningMessage('Нужен непустой PDF размером до 20 МиБ', true);
  if (signedDate > data.today) return contractSigningMessage('Дата подписания не может быть позже сегодняшнего дня', true);
  const requestKey = contractSigningKey(state, 'sign', JSON.stringify([file.name, file.size, file.lastModified, signedDate, data.approvedVersion.cycleId]));
  return runContractSigningAction(engagementId, 'Сохраняем подписанный договор…', async () => {
    const form = new FormData();
    form.append('signedDate', signedDate);
    form.append('expectedCycleId', String(data.approvedVersion.cycleId));
    form.append('requestKey', requestKey);
    form.append('file', file);
    const result = await (await contractDocumentFetch(`/api/engagements/${engagementId}/signatures`, { method: 'POST', body: form })).json();
    showToast(`Подписание от ${contractSigningDay(signedDate)} зарегистрировано`, 'green');
    return result;
  });
}

function voidContractSignature(engagementId) {
  const state = contractSigningUI, data = state?.data;
  if (!data?.canVoid) return;
  const reason = state.panel.querySelector('#contractSigningVoidReason').value.trim();
  if (!reason) return contractSigningMessage('Укажите причину аннулирования', true);
  if (!confirm('Аннулировать регистрацию подписания? Файл останется в истории, договор снова будет ожидать подписания.')) return;
  const requestKey = contractSigningKey(state, 'void', JSON.stringify([data.signature.id, reason]));
  return runContractSigningAction(engagementId, 'Аннулируем регистрацию…', async () => {
    const result = await apiFetch(`/api/engagements/${engagementId}/signatures/${data.signature.id}/void`, { method: 'POST', body: JSON.stringify({ reason, requestKey }) });
    showToast('Регистрация подписания аннулирована', 'orange');
    return result;
  });
}

function activateContractWork(engagementId) {
  const state = contractSigningUI, data = state?.data;
  if (!data?.canActivate) return;
  const requestKey = contractSigningKey(state, 'activate', String(data.signature.id));
  return runContractSigningAction(engagementId, 'Проверяем условия и начинаем работу…', async () => {
    const result = await apiFetch(`/api/engagements/${engagementId}/activation`, { method: 'POST', body: JSON.stringify({ expectedSignatureId: data.signature.id, requestKey }) });
    showToast('Работа по договору начата', 'green');
    return result;
  });
}

async function downloadContractSignature(engagementId, signatureId, button) {
  const signature = [contractSigningUI?.data?.signature, ...(contractSigningUI?.data?.voided || [])].find(s => s?.id === signatureId);
  if (!signature || button.disabled) return;
  button.disabled = true;
  try {
    const response = await contractDocumentFetch(`/api/engagements/${engagementId}/signatures/${signatureId}/file`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = signature.name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { showToast('Не удалось скачать файл: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}
