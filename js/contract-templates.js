let contractTemplateUI = null;
let contractTemplateClientId = null;

function openContractTemplateLibrary(clientId = null) {
  contractTemplateClientId = clientId;
  closeObClientModal();
  navigateTo('contract-templates');
}

function contractTemplateRequestKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

function contractTemplateMessage(text, error = false) {
  const el = document.getElementById('contractTemplateMessage');
  if (el) { el.textContent = text; el.className = error ? 'contract-message-error' : 'contract-message'; }
}

async function renderContractTemplatesPage() {
  const root = document.getElementById('contractTemplatesContent');
  if (!root) return;
  const state = contractTemplateUI = { root, data: null, detail: null, busy: false, request: 0, clientId: contractTemplateClientId };
  root.innerHTML = `<div class="contract-versions contract-template-library">
    <div class="contract-versions-heading"><div><h3>Шаблоны Word</h3><p>Выберите редакцию шаблона — договор получит собственную копию. Заполнение текста и совместный редактор будут подключены следующим этапом.</p></div>
      <div class="contract-versions-actions"><button class="contract-secondary" onclick="renderContractTemplatesPage()">Обновить библиотеку</button>
      <button class="contract-secondary" onclick="navigateTo('engagements')">К договорам</button></div></div>
    <p id="contractTemplateMessage" role="status" aria-live="polite">Загрузка шаблонов…</p>
    <details id="contractTemplateUpload" hidden><summary>Загрузить Word-шаблон</summary>
      <form id="newContractTemplateForm" onsubmit="event.preventDefault();saveNewContractTemplate()">
        <div class="contract-template-fields">
          <div><label for="templateName">Название шаблона</label><input id="templateName" maxlength="160" required placeholder="Договор консультационных услуг" /></div>
          <div><label for="templateType">Тип договора</label><input id="templateType" maxlength="120" required placeholder="Engagement Letter, NDA…" /></div>
          <div><label for="templateDirection">Направление</label><select id="templateDirection"><option value="CF&A">CF&A</option>${currentUserPermission('accessFM') ? '<option value="FM">FM</option>' : ''}</select></div>
          <div><label for="templateFile">Файл DOCX, до 20 МиБ</label><input id="templateFile" type="file" accept=".docx" required /></div>
        </div>
        <label for="templateNote">Описание редакции</label><textarea id="templateNote" rows="2" maxlength="2000" required>Первоначальная редакция</textarea>
        <button type="submit" class="contract-primary">Сохранить шаблон</button>
      </form>
    </details>
    <div class="contract-template-filters"><label for="templateSearch">Поиск по названию или типу</label>
      <input id="templateSearch" oninput="renderContractTemplateList()" placeholder="Найти шаблон…" />
      <label class="contract-template-archive"><input type="checkbox" id="templateShowArchive" onchange="renderContractTemplateList()" /> Показывать архив</label>
    </div>
    <div class="contract-template-layout"><div id="contractTemplateList"></div><div id="contractTemplateDetail"><p class="contract-empty">Выберите шаблон из списка.</p></div></div>
  </div>`;
  try {
    const [data, onboarding] = await Promise.all([apiFetch('/api/contract-templates'), apiFetch('/api/onboarding')]);
    if (contractTemplateUI !== state) return;
    state.data = data;
    state.engagements = onboarding.engagements;
    obClients.length = 0; obClients.push(...onboarding.obClients);
    engagements.length = 0; engagements.push(...onboarding.engagements);
    if (state.clientId && !obClients.some(c => c.id === state.clientId && c.direction !== 'FM')) state.clientId = null;
    root.querySelector('#contractTemplateUpload').hidden = !data.canManage;
    renderContractTemplateList();
    contractTemplateMessage(data.canManage ? 'Шаблоны можно обновлять и архивировать. Созданные договоры сохраняют свои документы.' :
      data.canUse ? 'Вы можете использовать доступные шаблоны. Управление библиотекой задаётся правами роли.' : 'Режим просмотра: доступны список шаблонов, история и скачивание.');
  } catch (err) {
    if (contractTemplateUI === state) contractTemplateMessage('Не удалось загрузить библиотеку: ' + err.message, true);
  }
}

function renderContractTemplateList() {
  const state = contractTemplateUI;
  if (!state?.data) return;
  const query = state.root.querySelector('#templateSearch').value.toLocaleLowerCase('ru');
  const showArchive = state.root.querySelector('#templateShowArchive').checked;
  const items = state.data.templates.filter(t => (showArchive || !t.archived) &&
    (t.name + ' ' + t.contractType).toLocaleLowerCase('ru').includes(query));
  state.root.querySelector('#contractTemplateList').innerHTML = items.length ? items.map(t =>
    `<button class="contract-template-item${state.detail?.template.id === t.id ? ' selected' : ''}" onclick="openContractTemplate(${t.id})">
      <strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.contractType)} · ${escapeHtml(t.direction)}</span>
      <span>Редакция ${t.latestVersion}${t.archived ? ' · в архиве' : ''}</span></button>`).join('') :
    '<p class="contract-empty">Шаблоны не найдены.</p>';
}

async function openContractTemplate(id) {
  const state = contractTemplateUI;
  if (!state?.data || state.busy) return;
  const request = ++state.request;
  try {
    const detail = await apiFetch(`/api/contract-templates/${id}`);
    if (contractTemplateUI !== state || request !== state.request) return;
    state.detail = detail;
    const found = state.data.templates.find(t => t.id === id);
    if (found) Object.assign(found, detail.template);
    renderContractTemplateList(); renderContractTemplateDetail();
  } catch (err) { if (contractTemplateUI === state) contractTemplateMessage(err.message, true); }
}

function renderContractTemplateDetail() {
  const state = contractTemplateUI, { template: t, versions } = state.detail;
  const eligible = state.engagements.filter(e => e.status === 'Draft' && !e.documentVersion && !e.contractUrl && !e.lpaUrl && !e.signedDate && !e.lpSignedDate &&
    (e.direction === 'FM' || e.serviceType === 'LP Investment (FM)' ? 'FM' : 'CF&A') === t.direction);
  state.root.querySelector('#contractTemplateDetail').innerHTML = `<div class="contract-version">
    <div class="contract-version-top"><strong>${escapeHtml(t.name)}</strong>${state.data.canManage ?
      `<button class="contract-secondary" onclick="setContractTemplateArchived(${t.id},${!t.archived})">${t.archived ? 'Восстановить' : 'В архив'}</button>` : ''}</div>
    <p class="contract-version-meta">${escapeHtml(t.contractType)} · ${escapeHtml(t.direction)}${t.archived ? ' · архив' : ''}</p>
    <p class="contract-empty">Это шаблон. Создайте по нему договор или добавьте документ в пустой черновик. Затем выберите маршрут в карточке договора и отправьте редакцию на согласование. Сама загрузка не запускает рассмотрение.</p>
    <label for="templateSelectedVersion">Редакция для копирования</label><select id="templateSelectedVersion">${versions.map(v =>
      `<option value="${v.id}">Редакция ${v.version} · ${escapeHtml(contractVersionDate(v.createdAt))}</option>`).join('')}</select>
    ${!t.archived && state.data.canUse ? `<div class="contract-template-actions">
      ${t.direction === 'CF&A' ? '<button class="contract-primary" onclick="newContractFromTemplate()">Создать договор по шаблону</button>' : '<p class="contract-empty">Договор FM создаётся в онбординге. Здесь можно добавить документ к его пустому черновику.</p>'}
      <label for="templateTargetContract">Или выбрать существующий пустой черновик</label>
      <select id="templateTargetContract"><option value="">— Выберите договор —</option>${eligible.map(e => `<option value="${e.id}">${escapeHtml(e.contractNum || e.engId || String(e.id))} · ${escapeHtml(e.clientName)}</option>`).join('')}</select>
      <button class="contract-secondary" onclick="applyContractTemplate()"${eligible.length ? '' : ' disabled'}>Добавить документ в черновик</button>
    </div>` : ''}
    <details class="contract-version-history"><summary>История редакций (${versions.length})</summary>${versions.map(v =>
      `<article class="contract-version"><div class="contract-version-top"><strong>Редакция ${v.version}</strong>
        <button class="contract-secondary" onclick="downloadContractTemplate(${t.id},${v.id},this)">Скачать</button></div>
        <p class="contract-version-name">${escapeHtml(v.name)} · ${contractVersionSize(v.size)}</p>
        <p class="contract-version-meta">${escapeHtml(v.author)} · ${escapeHtml(contractVersionDate(v.createdAt))}</p>
        <p class="contract-version-note">${escapeHtml(v.changeNote)}</p></article>`).join('')}</details>
    ${state.data.canManage && !t.archived ? `<details><summary>Загрузить новую редакцию шаблона</summary>
      <form onsubmit="event.preventDefault();saveContractTemplateVersion()">
        <label for="templateRevisionFile">Файл DOCX, до 20 МиБ</label><input id="templateRevisionFile" type="file" accept=".docx" required />
        <label for="templateRevisionNote">Что изменилось</label><textarea id="templateRevisionNote" rows="2" maxlength="2000" required></textarea>
        <button class="contract-primary" type="submit">Сохранить редакцию</button>
      </form></details>` : ''}</div>`;
}

async function contractTemplateAction(action) {
  const state = contractTemplateUI;
  if (!state?.data || state.busy) return;
  state.busy = true;
  const controls = [...state.root.querySelectorAll('button, input, select, textarea')];
  const disabledBefore = controls.map(el => el.disabled);
  controls.forEach(el => { el.disabled = true; });
  let value;
  try { value = await action(state); }
  catch (err) { if (contractTemplateUI === state) contractTemplateMessage(err.message, true); }
  finally { state.busy = false; controls.forEach((el, i) => { el.disabled = disabledBefore[i]; }); }
  return value;
}

function checkedTemplateFile(id) {
  const file = document.getElementById(id)?.files[0];
  if (!file || !/\.docx$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Выберите непустой DOCX размером до 20 МиБ');
  return file;
}

async function saveNewContractTemplate() {
  const created = await contractTemplateAction(async state => {
    const form = new FormData();
    for (const [key, id] of [['name', 'templateName'], ['contractType', 'templateType'], ['direction', 'templateDirection'], ['changeNote', 'templateNote']]) form.append(key, document.getElementById(id).value.trim());
    form.append('file', checkedTemplateFile('templateFile'));
    const result = await (await contractDocumentFetch('/api/contract-templates', { method: 'POST', body: form })).json();
    if (contractTemplateUI !== state) return;
    state.data.templates.push(result.template);
    state.root.querySelector('#newContractTemplateForm').reset();
    renderContractTemplateList();
    contractTemplateMessage('Шаблон сохранён. Можно создать договор.');
    return result.template.id;
  });
  if (created) await openContractTemplate(created);
}

async function saveContractTemplateVersion() {
  const id = await contractTemplateAction(async state => {
    const form = new FormData();
    form.append('expectedVersion', String(state.detail.template.latestVersion));
    form.append('changeNote', document.getElementById('templateRevisionNote').value.trim());
    form.append('file', checkedTemplateFile('templateRevisionFile'));
    await contractDocumentFetch(`/api/contract-templates/${state.detail.template.id}/versions`, { method: 'POST', body: form });
    if (contractTemplateUI !== state) return;
    contractTemplateMessage('Новая редакция сохранена. Созданные ранее договоры не изменились.');
    return state.detail.template.id;
  });
  if (id) await openContractTemplate(id);
}

async function setContractTemplateArchived(id, archived) {
  const changed = await contractTemplateAction(async state => {
    const result = await apiFetch(`/api/contract-templates/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived, expectedRevision: state.detail.template.revision }) });
    if (contractTemplateUI !== state) return;
    Object.assign(state.data.templates.find(t => t.id === id), result.template);
    contractTemplateMessage(archived ? 'Шаблон помещён в архив. История и договоры сохранены.' : 'Шаблон восстановлен.');
    return id;
  });
  if (changed) await openContractTemplate(changed);
}

function newContractFromTemplate() {
  const state = contractTemplateUI;
  if (!state?.detail || !state.data.canUse || state.busy || state.detail.template.archived) return;
  const version = state.detail.versions.find(v => v.id === Number(document.getElementById('templateSelectedVersion').value));
  if (!version) return;
  openNewEngagementModal({ id: state.detail.template.id, name: state.detail.template.name, versionId: version.id, version: version.version }, state.clientId);
}

async function applyContractTemplate() {
  const result = await contractTemplateAction(async state => {
    const engagementId = Number(document.getElementById('templateTargetContract').value);
    if (!engagementId) throw new Error('Выберите пустой черновик');
    const versionId = Number(document.getElementById('templateSelectedVersion').value);
    await apiFetch(`/api/contract-templates/${state.detail.template.id}/versions/${versionId}/apply`, {
      method: 'POST', body: JSON.stringify({ engagementId, expectedVersion: 0 }),
    });
    const e = engagements.find(e => e.id === engagementId);
    if (e) e.documentVersion = 1;
    return engagementId;
  });
  if (result) { navigateTo('engagements'); openEngagementModal(result); showToast('Копия шаблона добавлена в договор', 'green'); }
}

async function downloadContractTemplate(templateId, versionId, button) {
  const version = contractTemplateUI?.detail?.versions.find(v => v.id === versionId);
  if (!version || button.disabled) return;
  button.disabled = true;
  try {
    const response = await contractDocumentFetch(`/api/contract-templates/${templateId}/versions/${versionId}/file`);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = version.name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) { contractTemplateMessage(err.message, true); }
  finally { button.disabled = false; }
}
