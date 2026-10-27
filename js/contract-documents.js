// Contract revision storage (M1A). Collaborative editing is specified in M1B.
// Form inputs survive
// a failed request or history refresh so users do not lose their selected file.
let contractDocumentsState = null;
const CONTRACT_METADATA_LABELS = { contractNum: 'Номер', clientName: 'Клиент', date: 'Дата договора', dealRef: 'Ссылка на сделку',
  serviceType: 'Услуга', feeType: 'Тип вознаграждения', feeAmount: 'Гонорар', currency: 'Валюта', successFee: 'Success fee',
  retainer: 'Retainer', feeRate: 'Ставка', dealValue: 'Стоимость сделки', payTerms: 'Условия оплаты', startDate: 'Начало срока', endDate: 'Окончание срока' };

function renderClientContracts(client) {
  const linked = engagements.filter(e => e.clientId === client.id);
  const canCreate = client.direction !== 'FM' && !currentUserPermission('readOnly');
  return `<section class="contract-versions" aria-label="Договоры клиента">
    <div class="contract-versions-heading"><div><h3>Договоры клиента</h3><p>Подготовка документов идёт параллельно с онбордингом. Каждый договор хранится отдельно.</p></div></div>
    ${linked.length ? linked.map(e => `<div class="contract-version"><div class="contract-version-top">
      <strong>${escapeHtml(e.contractNum || e.engId || String(e.id))}</strong>
      <button type="button" class="contract-secondary" onclick="openContractFromClient(${e.id})">Открыть договор</button></div>
      <p class="contract-version-meta">${escapeHtml(e.serviceType || '')} · Статус услуги: ${escapeHtml(statusLabel(e.status))} · ${e.documentVersion ? 'Редакция ' + e.documentVersion : 'Файл не загружен'}</p>
    </div>`).join('') : '<p class="contract-empty">Связанных договоров пока нет.</p>'}
    ${canCreate ? `<div class="contract-versions-actions">
      <button type="button" class="contract-primary" onclick="openContractTemplateLibrary(${client.id})">Договор по Word-шаблону</button>
      <button type="button" class="contract-secondary" onclick="createContractFromClient(${client.id})">Пустой черновик</button></div>` : ''}
    <p class="contract-empty">Маршрут и решения доступны в карточке каждого договора. Статус услуги и завершение онбординга не являются одобрением текста.</p>
  </section>`;
}

function openContractFromClient(engagementId) {
  closeObClientModal();
  engEditMode = false;
  openEngagementModal(engagementId);
}

function createContractFromClient(clientId) {
  closeObClientModal();
  openNewEngagementModal(null, clientId);
}

async function openClientFromContract(clientId) {
  try {
    const data = await apiFetch('/api/onboarding');
    if (!data.obClients.some(c => c.id === clientId)) throw new Error('Карточка клиента недоступна');
    obClients.length = 0; obClients.push(...data.obClients);
    obTasks.length = 0; obTasks.push(...data.obTasks);
    engagements.length = 0; engagements.push(...data.engagements);
    closeEngagementModal();
    navigateTo('ob-clients');
    openObClientModal(clientId);
  } catch (err) { showToast('Не удалось открыть клиента: ' + err.message, 'red'); }
}

function contractProcessPanel(engagementId) {
  return `<section id="contractProcessPanel" class="contract-versions" data-engagement-id="${engagementId}">
    <div class="contract-versions-heading"><div><h3>Клиент и онбординг</h3><p>Подготовка договора доступна до завершения проверок клиента.</p></div>
    <button type="button" class="contract-secondary" onclick="loadContractProcess(${engagementId})">Обновить</button></div>
    <div id="contractProcessContent" aria-live="polite"><p class="contract-empty">Загрузка связанных этапов…</p></div>
  </section>`;
}

async function loadContractProcess(engagementId) {
  const panel = document.getElementById('contractProcessPanel');
  if (!panel || Number(panel.dataset.engagementId) !== engagementId) return;
  const request = panel._processRequest = (panel._processRequest || 0) + 1;
  const content = panel.querySelector('#contractProcessContent');
  try {
    const data = await apiFetch(`/api/engagements/${engagementId}/process`);
    if (document.getElementById('contractProcessPanel') !== panel || panel._processRequest !== request) return;
    if (!data.client) { content.innerHTML = '<p class="contract-metadata-warning">У этого договора нет связи с карточкой клиента. Этапы онбординга не определены.</p>'; return; }
    const steps = [['1.1', 'Предварительная проверка конфликтов'], ['2.1', 'Документы клиента'], ['2.2', 'Проверка KYC / AML'],
      ['3.1', 'Классификация / квалификация'], ['3.2', 'Оценка клиента'], ['4.1', 'Условия и документы'], ['5.1', 'Активация клиента']];
    const labels = { locked: 'Ещё не открыт', open: 'Ожидает выполнения', in_progress: 'В работе', completed: 'Задача завершена', escalated: 'На эскалации', rejected: 'Отклонено' };
    content.innerHTML = `<div class="contract-version-top"><p>${escapeHtml(data.client.name)}</p>
      <button type="button" class="contract-secondary" onclick="openClientFromContract(${data.client.id})">Открыть онбординг</button></div>
      <p class="contract-message">${data.client.activated ? 'В карточке клиента зарегистрирована активация.' : 'Клиент проходит онбординг. Черновик договора можно готовить параллельно.'}</p>
      <div class="contract-process-steps">${steps.map(([num, label]) => {
        const task = data.tasks.find(t => t.number === num);
        return `<div class="contract-process-step"><span>${num} · ${label}</span><span>${escapeHtml(task ? labels[task.status] || task.status : 'Задача не создана')}</span></div>`;
      }).join('')}</div>
      <p class="contract-empty">Это состояние задач онбординга, а не автоматический допуск к подписанию или началу работы. Решение по тексту договора учитывается отдельно.</p>`;
  } catch (err) {
    if (document.getElementById('contractProcessPanel') === panel && panel._processRequest === request) {
      content.textContent = 'Не удалось загрузить связь с онбордингом: ' + err.message;
    }
  }
}

function contractDocumentsPanel(engagementId) {
  return `${contractApprovalPanel(engagementId)}${contractProcessPanel(engagementId)}<section id="contractVersionsPanel" class="contract-versions" data-engagement-id="${engagementId}">
    <div class="contract-versions-heading">
      <div><h3>Версии документа</h3><p>Исходный файл и сохранённые редакции договора.</p></div>
      <button type="button" class="contract-secondary" onclick="loadContractDocuments(${engagementId})">Обновить</button>
    </div>
    <p id="contractVersionsMessage" role="status" aria-live="polite">Загрузка истории…</p>
    <div id="contractVersionsList"></div>
    <form id="contractVersionForm" hidden onsubmit="event.preventDefault();uploadContractVersion(${engagementId})">
      <label for="contractVersionFile">Новая редакция · DOCX или PDF, до 20 МиБ</label>
      <input id="contractVersionFile" type="file" accept=".docx,.pdf" required />
      <label for="contractVersionNote">Причина изменения</label>
      <textarea id="contractVersionNote" maxlength="2000" rows="2" required placeholder="Что изменилось в этой редакции?"></textarea>
      <button id="contractVersionSubmit" type="submit" class="contract-primary">Сохранить новую версию</button>
    </form>
  </section>`;
}

function contractVersionMessage(text, error = false) {
  const el = document.getElementById('contractVersionsMessage');
  if (el) { el.textContent = text; el.className = error ? 'contract-message-error' : 'contract-message'; }
}

function contractVersionDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}

function contractVersionSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КиБ` : `${(bytes / 1024 / 1024).toFixed(1)} МиБ`;
}

function renderContractVersionList(state) {
  const list = state.panel.querySelector('#contractVersionsList');
  const versions = state.data.versions;
  const labels = CONTRACT_METADATA_LABELS;
  const renderVersion = (v, current) => `<article class="contract-version${current ? ' contract-version-current' : ''}">
    <div class="contract-version-top"><strong>Версия ${v.version}${current ? ' · текущая' : ''}</strong>
      <button type="button" class="contract-secondary" onclick="downloadContractVersion(${state.engagementId},${v.id},this)">Скачать</button></div>
    <div class="contract-version-name">${escapeHtml(v.name)} <span>· ${contractVersionSize(v.size)}</span></div>
    <div class="contract-version-meta">${escapeHtml(v.author)} · ${escapeHtml(contractVersionDate(v.createdAt))}</div>
    <p class="contract-version-note">${escapeHtml(v.changeNote)}</p>
    ${v.templateSource ? `<p class="contract-version-meta">Источник: шаблон «${escapeHtml(v.templateSource.name)}», редакция ${v.templateSource.version}</p>` : ''}
    <details class="contract-version-snapshot"><summary>Реквизиты карточки на момент загрузки</summary>
      <p>Снимок данных CRM. Содержимое файла автоматически не проверялось.</p>
      <dl>${Object.entries(v.metadata).filter(([, value]) => value != null && value !== '').map(([key, value]) =>
        `<div><dt>${escapeHtml(labels[key] || key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}</dl>
    </details>
  </article>`;
  list.innerHTML = versions.length
    ? `${state.data.metadataChanged ? '<p class="contract-metadata-warning">Снимок этой редакции не подтверждает все текущие реквизиты карточки. Проверьте текст и сохраните новую редакцию перед согласованием.</p>' : ''}
      ${renderVersion(versions[0], true)}
      ${versions.length > 1 ? `<details class="contract-version-history"><summary>Предыдущие версии (${versions.length - 1})</summary>${versions.slice(1).map(v => renderVersion(v, false)).join('')}</details>` : ''}`
    : '<p class="contract-empty">История пока пуста. Загрузите первую редакцию договора. Ранее прикреплённая ссылка остаётся отдельно в карточке.</p>';
}

async function loadContractDocuments(engagementId) {
  const panel = document.getElementById('contractVersionsPanel');
  if (!panel || Number(panel.dataset.engagementId) !== engagementId) return;
  if (!contractDocumentsState || contractDocumentsState.panel !== panel) {
    contractDocumentsState = { engagementId, panel, data: null, busy: false, request: 0 };
  }
  const state = contractDocumentsState;
  if (state.busy) return;
  const request = ++state.request;
  try {
    const data = await apiFetch(`/api/engagements/${engagementId}/versions`);
    if (contractDocumentsState !== state || document.getElementById('contractVersionsPanel') !== panel || request !== state.request) return;
    state.data = data;
    renderContractVersionList(state);
    const form = panel.querySelector('#contractVersionForm');
    form.hidden = !data.canUpload;
    const note = panel.querySelector('#contractVersionNote');
    if (!data.currentVersion && !note.value) note.value = 'Первоначальная редакция';
    const engagement = engagements.find(e => e.id === engagementId);
    if (engagement) engagement.documentVersion = data.currentVersion;
    contractVersionMessage(data.frozen ? 'Редакция зафиксирована для согласования. Для изменения используйте «Вернуть в доработку» ниже.' : data.canUpload ? 'Каждая загрузка сохраняется отдельно. Предыдущие редакции остаются в истории.' : 'Режим просмотра: доступны история и скачивание.');
  } catch (err) {
    if (contractDocumentsState === state && document.getElementById('contractVersionsPanel') === panel && request === state.request) {
      contractVersionMessage('Не удалось загрузить историю: ' + err.message + '. Нажмите «Обновить».', true);
    }
  }
}

async function contractDocumentFetch(url, options = {}) {
  const auth = getAuth();
  const response = await fetch(API_BASE + url, { ...options, headers: auth ? { Authorization: 'Bearer ' + auth.token } : {} });
  if (response.status === 401) {
    clearAuth();
    showLoginOverlay('Сессия истекла, войдите снова.');
    throw new Error('Сессия истекла');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Ошибка ${response.status}`);
  }
  return response;
}

async function uploadContractVersion(engagementId) {
  const state = contractDocumentsState;
  if (!state || state.engagementId !== engagementId || !state.data || state.busy) return;
  if (currentUserPermission('readOnly')) { contractVersionMessage('Изменения недоступны в режиме просмотра', true); return; }
  const fileInput = state.panel.querySelector('#contractVersionFile');
  const noteInput = state.panel.querySelector('#contractVersionNote');
  const button = state.panel.querySelector('#contractVersionSubmit');
  const file = fileInput.files[0];
  const note = noteInput.value.trim();
  if (!file || !note) { contractVersionMessage('Выберите файл и укажите причину изменения', true); return; }
  if (!/\.(docx|pdf)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
    contractVersionMessage('Нужен непустой файл DOCX или PDF размером до 20 МиБ', true); return;
  }
  state.busy = true;
  ++state.request; // An older history response must not overwrite this upload.
  button.disabled = fileInput.disabled = noteInput.disabled = true;
  button.textContent = 'Сохранение…';
  contractVersionMessage('Загружаем документ…');
  let uploaded = false;
  try {
    const form = new FormData();
    form.append('expectedVersion', String(state.data.currentVersion));
    form.append('changeNote', note);
    form.append('file', file);
    const response = await contractDocumentFetch(`/api/engagements/${engagementId}/versions`, { method: 'POST', body: form });
    const data = await response.json();
    const engagement = engagements.find(e => e.id === engagementId);
    if (engagement) engagement.documentVersion = data.currentVersion;
    uploaded = true;
    if (document.getElementById('contractVersionsPanel') === state.panel) {
      fileInput.value = ''; noteInput.value = '';
    }
    if (typeof renderEngagementsPage === 'function') renderEngagementsPage();
    showToast(`Версия ${data.currentVersion} сохранена`, 'green');
  } catch (err) {
    if (document.getElementById('contractVersionsPanel') === state.panel) contractVersionMessage(err.message, true);
    else showToast('Не удалось сохранить версию: ' + err.message, 'red');
  } finally {
    state.busy = false;
    button.disabled = fileInput.disabled = noteInput.disabled = false;
    button.textContent = 'Сохранить новую версию';
  }
  if (uploaded && document.getElementById('contractVersionsPanel') === state.panel) {
    await Promise.all([loadContractDocuments(engagementId), loadContractApprovals(engagementId)]);
  }
}

async function downloadContractVersion(engagementId, versionId, button) {
  const state = contractDocumentsState;
  const version = (state?.engagementId === engagementId && state.data?.versions.find(v => v.id === versionId)) ||
    (contractApprovalUI?.engagementId === engagementId && contractApprovalUI.chat?.documents.find(v => v.id === versionId));
  if (!version || button.disabled) return;
  button.disabled = true;
  try {
    const response = await contractDocumentFetch(`/api/engagements/${engagementId}/versions/${versionId}/file`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = version.name || version.filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { showToast('Не удалось скачать документ: ' + err.message, 'red'); }
  finally { button.disabled = false; }
}
