// ============================================================
//  sandbox-xmind.js — "Импорт из XMind" для Песочницы.
//  Backed by /api/sandbox/xmind/upload и /api/sandbox/xmind/import
//  (server/xmindImport.js). Односторонний импорт файла — у XMind нет
//  открытого API для настоящей синхронизации, поэтому это "прочитать
//  карту и завести/обновить проекты", а не живой синк. Повторный импорт
//  той же (дополненной) карты не плодит дубли — сервер сопоставляет по
//  внутреннему ID темы XMind, не по названию.
// ============================================================

let _xmindUpload = null;      // { uploadId, sheets: [{id, title, root}] }
let _xmindSheetIndex = 0;
let _xmindSelected = new Set();     // topicId -> отмечен галочкой
let _xmindExpanded = new Set();     // topicId -> раскрыт (показывать детей)

function openSandboxXmindImport() {
  _xmindUpload = null;
  _xmindSelected = new Set();
  _xmindExpanded = new Set();
  showSandboxModal(`
    ${sbxModalHeader('Импорт из XMind', '<span style="font-size:12px;color:#94a3b8">Один раз загружаешь .xmind — дальше можно повторять, дубли не появятся</span>')}
    <div style="padding:24px;text-align:center">
      <i class="fas fa-sitemap" style="font-size:32px;color:#8b5cf6;margin-bottom:12px;display:block"></i>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 16px">Выбери файл карты (.xmind). Он останется на сервере, сама карта никуда не публикуется.</p>
      <button class="btn-primary" onclick="xmindPickAndUpload()"><i class="fas fa-upload"></i> Выбрать файл</button>
    </div>`);
}

async function xmindPickAndUpload() {
  const file = await pickFile('.xmind');
  if (!file) return;
  showSandboxModal(`
    ${sbxModalHeader('Импорт из XMind')}
    <div style="padding:32px;text-align:center;color:#94a3b8;font-size:12px"><i class="fas fa-spinner fa-spin" style="font-size:20px;margin-bottom:10px;display:block"></i>Разбираем карту...</div>`);
  try {
    const auth = getAuth();
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(API_BASE + '/api/sandbox/xmind/upload', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth.token } : {}, body: formData,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    _xmindUpload = body;
    _xmindSheetIndex = 0;
    // Раскрыть верхний уровень по умолчанию, чтобы сразу было видно карту,
    // но не всё дерево целиком — оно может уйти на 8 уровней вглубь.
    for (const child of body.sheets[0].root.children) _xmindExpanded.add(child.id);
    xmindRenderTreeModal();
  } catch (err) {
    showSandboxModal(`
      ${sbxModalHeader('Импорт из XMind')}
      <div style="padding:24px">
        <div style="font-size:12px;color:#ef4444;margin-bottom:14px">⚠️ ${escapeHtml(err.message)}</div>
        <button class="btn-ghost" onclick="openSandboxXmindImport()">Попробовать снова</button>
      </div>`);
  }
}

function xmindCurrentSheet() { return _xmindUpload.sheets[_xmindSheetIndex]; }

function xmindNodeRowHtml(node) {
  const hasChildren = node.children.length > 0;
  const expanded = _xmindExpanded.has(node.id);
  const checked = _xmindSelected.has(node.id);
  const toggle = hasChildren
    ? `<button type="button" onclick="xmindToggleExpand('${node.id}')" aria-label="${expanded ? 'Свернуть' : 'Развернуть'}"
        style="background:none;border:none;color:#8abfbb;cursor:pointer;width:16px;flex-shrink:0;padding:0"><i class="fas fa-chevron-${expanded ? 'down' : 'right'}" style="font-size:9px"></i></button>`
    : '<span style="width:16px;flex-shrink:0"></span>';
  const badges = [
    node.isPlaceholder ? '<span style="color:#64748b;font-size:10px">(шаблон, пусто)</span>' : '',
    node.hasAttachment ? `<span title="${escapeAttr(node.attachmentName || 'файл')}" style="color:#5eead4"><i class="fas fa-paperclip" style="font-size:10px"></i></span>` : '',
    node.sourceUrl ? `<span title="${escapeAttr(node.sourceUrl)}" style="color:#64748b"><i class="fas fa-link" style="font-size:10px"></i></span>` : '',
    node.linkedEntityType === 'project' ? '<span title="Уже импортирован как проект" style="color:#22c55e"><i class="fas fa-check-circle" style="font-size:10px"></i></span>' : '',
  ].filter(Boolean).join(' ');
  const childrenHtml = (hasChildren && expanded)
    ? `<div style="margin-left:22px">${node.children.map(xmindNodeRowHtml).join('')}</div>` : '';
  return `
    <div>
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;margin-left:${Math.max(0, node.depth - 1) * 16}px">
        ${toggle}
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="xmindToggleSelect('${node.id}', this.checked)" style="width:14px;height:14px;flex-shrink:0" />
        <span onclick="${hasChildren ? `xmindToggleExpand('${node.id}')` : ''}" style="${hasChildren ? 'cursor:pointer;' : ''}font-size:12px;color:#e2e8f0;overflow-wrap:anywhere">${escapeHtml(node.title || '(без названия)')}</span>
        ${badges}
      </div>
      ${childrenHtml}
    </div>`;
}

function xmindRenderTreeModal() {
  const sheet = xmindCurrentSheet();
  const sheetSelect = _xmindUpload.sheets.length > 1
    ? `<select onchange="xmindSwitchSheet(this.value)" style="margin-bottom:10px">
        ${_xmindUpload.sheets.map((s, i) => `<option value="${i}" ${i === _xmindSheetIndex ? 'selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}
      </select>` : '';
  showSandboxModal(`
    ${sbxModalHeader('Импорт из XMind', `<span style="font-size:12px;color:#94a3b8">${escapeHtml(sheet.title)} · выбрано: <span id="xmind_selected_count">${_xmindSelected.size}</span></span>`)}
    <div style="padding:20px 24px">
      ${sheetSelect}
      <p style="font-size:11px;color:#64748b;margin:0 0 10px">Отметь темы, которые должны стать проектами в Песочнице. Задачи и приложенные файлы под ними перенесутся автоматически; заготовки-«подтемы» пропускаются.</p>
      <div class="form-group" style="margin-bottom:14px">
        <label style="${SBX_LABEL}">Фонд для всех выбранных проектов <span style="font-weight:400;color:#64748b">(необязательно, можно назначить позже)</span></label>
        <select id="xmind_fund">${sbxFundOptions(typeof activeFundId !== 'undefined' ? activeFundId : null, '— пока не выбран —')}</select>
      </div>
      <div id="xmind_tree" style="max-height:340px;overflow-y:auto;background:#0f1623;border:1px solid #2a4846;border-radius:8px;padding:10px 12px">
        ${sheet.root.children.map(xmindNodeRowHtml).join('') || '<div style="font-size:12px;color:#64748b">В карте нет тем</div>'}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
        <button class="btn-ghost" onclick="closeSandboxModal()">Отмена</button>
        <button class="btn-primary" onclick="xmindSubmitImport()"><i class="fas fa-download"></i> Импортировать выбранное</button>
      </div>
    </div>`);
}

function xmindToggleExpand(topicId) {
  if (_xmindExpanded.has(topicId)) _xmindExpanded.delete(topicId); else _xmindExpanded.add(topicId);
  xmindRenderTreeModal();
}

function xmindToggleSelect(topicId, checked) {
  if (checked) _xmindSelected.add(topicId); else _xmindSelected.delete(topicId);
  const counter = document.getElementById('xmind_selected_count');
  if (counter) counter.textContent = String(_xmindSelected.size);
}

function xmindSwitchSheet(index) {
  _xmindSheetIndex = Number(index);
  _xmindSelected = new Set();
  _xmindExpanded = new Set();
  for (const child of xmindCurrentSheet().root.children) _xmindExpanded.add(child.id);
  xmindRenderTreeModal();
}

async function xmindSubmitImport() {
  if (_sandboxBusy) return;
  if (!_xmindSelected.size) { showToast('⚠️ Отметь хотя бы одну тему', 'orange'); return; }
  const fundVal = document.getElementById('xmind_fund').value;
  const fundId = fundVal ? Number(fundVal) : undefined;
  const selections = Array.from(_xmindSelected).map(topicId => ({ topicId, fundId }));
  _sandboxBusy = true;
  showSandboxModal(`
    ${sbxModalHeader('Импорт из XMind')}
    <div style="padding:32px;text-align:center;color:#94a3b8;font-size:12px"><i class="fas fa-spinner fa-spin" style="font-size:20px;margin-bottom:10px;display:block"></i>Импортируем...</div>`);
  try {
    const result = await apiFetch('/api/sandbox/xmind/import', {
      method: 'POST', body: JSON.stringify({ uploadId: _xmindUpload.uploadId, sheetId: xmindCurrentSheet().id, selections }),
    });
    const s = result.summary;
    showSandboxModal(`
      ${sbxModalHeader('Импорт из XMind — готово')}
      <div style="padding:24px">
        <div style="font-size:12px;color:#e2e8f0;line-height:1.8">
          <div>Проектов создано: <b style="color:#22c55e">${s.projectsCreated}</b></div>
          <div>Проектов обновлено: <b>${s.projectsUpdated}</b></div>
          ${s.projectsSkippedPromoted ? `<div>Пропущено (уже в скрининге): ${s.projectsSkippedPromoted}</div>` : ''}
          <div>Новых задач: <b style="color:#22c55e">${s.tasksCreated}</b>${s.tasksSkipped ? ` <span style="color:#64748b">(уже были: ${s.tasksSkipped})</span>` : ''}</div>
          <div>Новых файлов: <b style="color:#22c55e">${s.filesImported}</b>${s.filesSkipped ? ` <span style="color:#64748b">(уже были: ${s.filesSkipped})</span>` : ''}</div>
        </div>
        ${s.fieldsKeptFromCrm && s.fieldsKeptFromCrm.length ? `
          <div style="margin-top:14px;padding:10px 12px;background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.3);border-radius:8px;font-size:11px;color:#fde68a">
            <div style="font-weight:700;margin-bottom:4px">Не перезаписано (изменено в CRM после прошлого импорта):</div>
            ${s.fieldsKeptFromCrm.map(f => `<div>· ${escapeHtml(f)}</div>`).join('')}
          </div>` : ''}
        <div style="display:flex;justify-content:flex-end;margin-top:18px">
          <button class="btn-primary" onclick="closeSandboxModal(); renderSandboxPage();">Готово</button>
        </div>
      </div>`);
  } catch (err) {
    showSandboxModal(`
      ${sbxModalHeader('Импорт из XMind')}
      <div style="padding:24px">
        <div style="font-size:12px;color:#ef4444;margin-bottom:14px">⚠️ ${escapeHtml(err.message)}</div>
        <button class="btn-ghost" onclick="xmindRenderTreeModal()">Назад к выбору</button>
      </div>`);
  } finally {
    _sandboxBusy = false;
  }
}
