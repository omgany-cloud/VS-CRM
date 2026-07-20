// ============================================================
//  vault.js — Global File Vault (Просмотр всех загруженных файлов)
//  Real cross-module aggregator: every field in the app backed by the
//  shared /api/uploads infrastructure (pickFile()+uploadFile(), or
//  docUploadBtn()) — deals, portfolio, first closing, capital calls,
//  regulatory reports, onboarding contracts/amendments — plus the Документы
//  library itself. Every entry here is a real, downloadable file, not
//  a metadata placeholder.
// ============================================================

/* ── File-preview modal (inline lightbox) ──────────────────── */
let vaultFilterModule = '';
let vaultFilterType   = '';
let vaultSearch       = '';

// Populated by renderVaultPage() (async — needs one bulk metadata fetch
// for every cross-module upload id) and read synchronously by every
// filter/search/preview/download/goToSource interaction afterward, so
// those stay instant without re-fetching on every keystroke.
let _vaultFilesCache = [];

/* ─────────────────────────────────────────────────────────────
   AGGREGATOR — collect files from every module with a real upload
───────────────────────────────────────────────────────────── */
function vaultFormatBytes(n) {
  if (!n) return '—';
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

async function vaultCollectAllFiles() {
  const files = [];

  // Документы already tracks real name/size/date/uploader itself — no
  // metadata lookup needed for these.
  (typeof docFiles !== 'undefined' ? docFiles.filter(d => !d.archived) : []).forEach(f => {
    files.push({
      key: 'doc_' + f.id, module: 'Документы', moduleColor: '#3b82f6', moduleIcon: 'fa-folder-open',
      client: f.category || '—', name: f.name, size: f.size || '—', date: f.date || '—', uploader: f.uploader || '—',
      documentUrl: f.documentUrl || null, goToSource: () => navigateTo('documents'),
    });
  });

  // Every other source only has the /api/uploads/:id URL — the real
  // filename/uploader/date live in uploaded_files, fetched in bulk below
  // rather than once per file.
  const pending = [];
  function addPending(url, label, module, moduleColor, moduleIcon, client, goToSource) {
    if (!url || !url.startsWith('/api/uploads/')) return;
    const urlId = parseInt(url.split('/').pop(), 10);
    if (!Number.isInteger(urlId)) return;
    pending.push({ key: `${module}_${urlId}_${label}`, urlId, url, label, module, moduleColor, moduleIcon, client, goToSource });
  }

  // One unexpected shape in any single source (a field that's a JSON
  // string instead of an array, a record missing a field entirely, ...)
  // shouldn't take down the whole aggregator — each source collects
  // independently, logging and moving on rather than throwing.
  function vaultSafe(label, fn) {
    try { fn(); } catch (err) { console.error(`Vault: failed to collect files from ${label}:`, err); }
  }

  vaultSafe('deals', () => (typeof deals !== 'undefined' ? deals : []).forEach(d => {
    const goTo = () => { navigateTo('deals'); setTimeout(() => openDealDetailModal(d.id), 200); };
    addPending(d.pitchDeckUrl, 'Питч-дек', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo);
    addPending(d.icMemoUrl, 'Investment Memo', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo);
    addPending(d.icMinutesUrl, 'IC Minutes', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo);
    addPending(d.wireConfirmUrl, 'Wire Confirm', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo);
    addPending(d.dataRoomUrl, 'Data Room', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo);
    (d.tsVersions || []).forEach(v => addPending(v.url, `TS ${v.v || ''}`.trim(), 'Сделки', '#f97316', 'fa-handshake', d.company, goTo));
    (d.signedDocsUrls || []).forEach(v => addPending(v.url, v.name || 'Signed Doc', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo));
    (d.otherDocs || []).forEach(v => addPending(v.url, v.name || 'Other Doc', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo));
    (d.ddConclusions || []).forEach(c => (c.documents || []).forEach(doc =>
      addPending(doc.url, doc.name || 'DD Document', 'Сделки', '#f97316', 'fa-handshake', d.company, goTo)));
  }));

  vaultSafe('portfolio', () => (typeof portfolio !== 'undefined' ? portfolio : []).forEach(p => {
    const goTo = () => { navigateTo('portfolio'); setTimeout(() => openPortfolioModal(p.id), 200); };
    addPending(p.documents?.driveUrl, 'Google Drive', 'Портфель', '#22c55e', 'fa-briefcase', p.name, goTo);
    (p.documents?.files || []).forEach(f => addPending(f.url, f.name || 'Документ', 'Портфель', '#22c55e', 'fa-briefcase', p.name, goTo));
  }));

  vaultSafe('firstClosing', () => (typeof firstClosingList !== 'undefined' ? firstClosingList : []).forEach(fc => {
    const fund = (typeof funds !== 'undefined' ? funds.find(x => x.id === fc.fundId) : null);
    const label = fund ? fund.name : 'Fund';
    const goTo = () => navigateTo('closing');
    addPending(fc.boardResolutionUrl, 'Board Resolution', 'First Closing', '#8b5cf6', 'fa-file-signature', label, goTo);
    addPending(fc.closingCertUrl, 'Closing Certificate', 'First Closing', '#8b5cf6', 'fa-file-signature', label, goTo);
    addPending(fc.afsaConfirmUrl, 'Regulator Confirmation', 'First Closing', '#8b5cf6', 'fa-file-signature', label, goTo);
  }));

  vaultSafe('capitalCalls', () => (typeof capitalCallsLog !== 'undefined' ? capitalCallsLog : []).forEach(cc => {
    const goTo = () => { navigateTo('lp-capital-calls'); setTimeout(() => openCCDetail(cc.id), 200); };
    (cc.lineItems || []).forEach(li => addPending(li.wireConfirmUrl, `Wire — ${li.lpName}`, 'Capital Calls', '#eab308', 'fa-coins', `CC ${cc.ccNumber}`, goTo));
  }));

  vaultSafe('afsaReports', () => (typeof afsaReports !== 'undefined' ? afsaReports : []).forEach(r => {
    addPending(r.documentUrl, `${r.period} (${r.reportType})`, 'Отчётность регулятору', '#0ea5e9', 'fa-landmark', r.period, () => navigateTo('calendar'));
  }));

  vaultSafe('obClients', () => (typeof obClients !== 'undefined' ? obClients : []).forEach(c => {
    const goTo = () => navigateTo('ob-clients');
    addPending(c.contractUrl, 'Договор CF&A', 'Онбординг', '#a78bfa', 'fa-user-check', c.name, goTo);
    addPending(c.lpaUrl, 'LPA / FM договор', 'Онбординг', '#a78bfa', 'fa-user-check', c.name, goTo);
  }));

  vaultSafe('engagements', () => (typeof engagements !== 'undefined' ? engagements : []).forEach(e => {
    const goTo = () => navigateTo('engagements');
    // Stored as a JSON string on the engagement record, not a real array —
    // same parse-defensively pattern as js/onboarding.js:5463.
    let amendArr = [];
    try { amendArr = e.amendments ? (typeof e.amendments === 'string' ? JSON.parse(e.amendments) : e.amendments) : []; } catch (err) { amendArr = []; }
    if (Array.isArray(amendArr)) {
      amendArr.forEach((a, i) => addPending(a.url, `Amendment #${a.num || i + 1}`, 'Онбординг', '#a78bfa', 'fa-user-check', e.clientName, goTo));
    }
  }));

  const ids = [...new Set(pending.map(p => p.urlId))];
  let metaById = {};
  if (ids.length) {
    try {
      const data = await apiFetch('/api/uploads/meta?ids=' + ids.join(','));
      (data.files || []).forEach(f => { metaById[f.id] = f; });
    } catch (err) {
      console.error('Failed to load upload metadata for Vault:', err);
    }
  }

  pending.forEach(p => {
    const meta = metaById[p.urlId];
    files.push({
      key: p.key, module: p.module, moduleColor: p.moduleColor, moduleIcon: p.moduleIcon,
      client: p.client, name: meta ? meta.originalName : p.label,
      size: meta ? vaultFormatBytes(meta.sizeBytes) : '—',
      date: meta && meta.uploadedAt ? meta.uploadedAt.slice(0, 10) : '—',
      uploader: meta ? meta.uploadedBy || '—' : '—',
      documentUrl: p.url, goToSource: p.goToSource,
    });
  });

  return files;
}

/* ─────────────────────────────────────────────────────────────
   RENDER VAULT PAGE
───────────────────────────────────────────────────────────── */
async function renderVaultPage() {
  const el = document.getElementById('vaultContent');
  if (!el) return;
  el.innerHTML = `<div style="padding:60px;text-align:center;color:#8a9bbf"><i class="fas fa-spinner fa-spin" style="font-size:22px;margin-bottom:10px;display:block"></i>Загрузка файлов из всех модулей...</div>`;

  _vaultFilesCache = await vaultCollectAllFiles();
  const allFiles  = _vaultFilesCache;
  const modules   = [...new Set(allFiles.map(f => f.module))];

  // KPIs
  const totalCount = allFiles.length;
  const byModule = {};
  allFiles.forEach(f => { byModule[f.module] = (byModule[f.module] || 0) + 1; });
  const previewable = allFiles.filter(f => vaultCanPreview(f)).length;

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-file-alt"></i></div>
        <div class="kpi-body">
          <span class="kpi-label">Всего файлов</span>
          <span class="kpi-value">${totalCount}</span>
          <span class="kpi-delta up">во всех модулях CRM</span>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-shapes"></i></div>
        <div class="kpi-body">
          <span class="kpi-label">Модулей-источников</span>
          <span class="kpi-value">${modules.length}</span>
          <span class="kpi-delta">${modules.join(', ')}</span>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon green"><i class="fas fa-eye"></i></div>
        <div class="kpi-body">
          <span class="kpi-label">С предпросмотром</span>
          <span class="kpi-value">${previewable}</span>
          <span class="kpi-delta up">PDF / Image</span>
        </div>
      </div>
    </div>

    <!-- Search & Filters toolbar -->
    <div class="card" style="margin-bottom:16px">
      <div style="padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        <!-- Search -->
        <div style="position:relative;flex:1;min-width:180px">
          <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#4a5568;font-size:12px"></i>
          <input id="vaultSearchInput" type="text" placeholder="Поиск по имени файла или клиенту..."
            value="${vaultSearch}"
            oninput="vaultSearch=this.value;renderVaultTable()"
            style="width:100%;background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px 8px 32px;color:#e2e8f0;font-size:13px;box-sizing:border-box" />
        </div>

        <!-- Module filter -->
        <select id="vaultModuleFilter" onchange="vaultFilterModule=this.value;renderVaultTable()"
          style="background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;min-width:160px">
          <option value="">Все модули</option>
          ${modules.map(m => `<option value="${m}" ${vaultFilterModule===m?'selected':''}>${m} (${byModule[m]})</option>`).join('')}
        </select>

        <!-- Type filter -->
        <select id="vaultTypeFilter" onchange="vaultFilterType=this.value;renderVaultTable()"
          style="background:#0f1623;border:1px solid #2a3448;border-radius:8px;padding:8px 12px;color:#e2e8f0;font-size:13px;min-width:130px">
          <option value="">Все типы</option>
          <option value="pdf" ${vaultFilterType==='pdf'?'selected':''}>PDF</option>
          <option value="excel" ${vaultFilterType==='excel'?'selected':''}>Excel</option>
          <option value="word" ${vaultFilterType==='word'?'selected':''}>Word</option>
          <option value="image" ${vaultFilterType==='image'?'selected':''}>Изображение</option>
          <option value="other" ${vaultFilterType==='other'?'selected':''}>Прочее</option>
        </select>

        <!-- Upload shortcut -->
        <button onclick="navigateTo('documents')"
          style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;white-space:nowrap">
          <i class="fas fa-upload" style="margin-right:5px"></i>Загрузить файл
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-database" style="color:#3b82f6;margin-right:6px"></i>Все файлы CRM</span>
        <span id="vaultFileCount" style="font-size:12px;color:#8a9bbf">...</span>
      </div>
      <div id="vaultTableWrap"></div>
    </div>`;

  renderVaultTable();
}

function vaultCanPreview(f) {
  if (!f.documentUrl) return false;
  const ext = (f.name || '').split('.').pop().toLowerCase();
  return ext === 'pdf' || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
}

/* ─────────────────────────────────────────────────────────────
   RENDER TABLE (filtered) — synchronous, filters _vaultFilesCache
───────────────────────────────────────────────────────────── */
function renderVaultTable() {
  const wrap = document.getElementById('vaultTableWrap');
  const countEl = document.getElementById('vaultFileCount');
  if (!wrap) return;

  let files = _vaultFilesCache;

  if (vaultFilterModule) files = files.filter(f => f.module === vaultFilterModule);
  if (vaultSearch) {
    const q = vaultSearch.toLowerCase();
    files = files.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.client || '').toLowerCase().includes(q) ||
      f.module.toLowerCase().includes(q)
    );
  }
  if (vaultFilterType) {
    files = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      if (vaultFilterType === 'pdf')   return ext === 'pdf';
      if (vaultFilterType === 'excel') return ['xls','xlsx'].includes(ext);
      if (vaultFilterType === 'word')  return ['doc','docx'].includes(ext);
      if (vaultFilterType === 'image') return ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
      if (vaultFilterType === 'other') return !['pdf','xls','xlsx','doc','docx','jpg','jpeg','png','gif','webp','svg'].includes(ext);
      return true;
    });
  }

  if (countEl) countEl.textContent = `${files.length} файл(ов)`;

  if (!files.length) {
    wrap.innerHTML = `
      <div style="padding:50px;text-align:center;color:#4a5568">
        <i class="fas fa-folder-open" style="font-size:40px;margin-bottom:12px;display:block;opacity:.4"></i>
        <div style="font-size:14px;margin-bottom:6px">Файлы не найдены</div>
        <div style="font-size:12px">Загрузите файлы в разделе Документы, или в любом модуле, где есть кнопка загрузки</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px"></th>
            <th>Файл</th>
            <th>Модуль</th>
            <th>Клиент / Категория</th>
            <th>Размер</th>
            <th>Дата</th>
            <th style="text-align:center">Действия</th>
          </tr>
        </thead>
        <tbody>
          ${files.map(f => vaultFileRow(f)).join('')}
        </tbody>
      </table>
    </div>`;
}

function vaultFileRow(f) {
  const ext  = f.name.split('.').pop().toLowerCase();
  const icon = vaultGetFileIcon(ext);
  const iconColor = vaultGetFileColor(ext);
  const canPreview = vaultCanPreview(f);

  const previewBtn = canPreview
    ? `<button onclick="vaultPreview('${escapeAttr(f.key)}')"
         title="Предпросмотр"
         style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
         <i class="fas fa-eye"></i>
       </button>`
    : `<button disabled title="Предпросмотр недоступен для этого типа файла"
         style="background:rgba(255,255,255,0.03);border:1px solid #1e293b;color:#374151;padding:5px 9px;border-radius:6px;cursor:not-allowed;font-size:11px">
         <i class="fas fa-eye-slash"></i>
       </button>`;

  const downloadBtn = f.documentUrl
    ? `<button onclick="vaultDownload('${escapeAttr(f.key)}')"
         title="Открыть / скачать"
         style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
         <i class="fas fa-download"></i>
       </button>`
    : '';

  const goBtn = `<button onclick="vaultGoToSource('${escapeAttr(f.key)}')"
      title="Открыть в модуле"
      style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);color:#a78bfa;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
      <i class="fas fa-external-link-alt"></i>
    </button>`;

  return `
    <tr>
      <td>
        <div style="width:30px;height:30px;border-radius:8px;background:${iconColor}18;display:flex;align-items:center;justify-content:center">
          <i class="fas ${icon}" style="color:${iconColor};font-size:13px"></i>
        </div>
      </td>
      <td>
        <div style="font-size:13px;font-weight:600;color:#e2e8f0;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.name}">${f.name}</div>
        <div style="font-size:10px;color:#4a5568;text-transform:uppercase">${ext}</div>
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:5px;background:${f.moduleColor}18;border:1px solid ${f.moduleColor}40;color:${f.moduleColor};padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700">
          <i class="fas ${f.moduleIcon}"></i> ${f.module}
        </span>
      </td>
      <td style="font-size:12px;color:#94a3b8;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.client}">${f.client}</td>
      <td style="font-size:12px;color:#8a9bbf;white-space:nowrap">${f.size}</td>
      <td style="font-size:12px;color:#8a9bbf;white-space:nowrap">${f.date}</td>
      <td>
        <div style="display:flex;gap:5px;justify-content:center;align-items:center">
          ${previewBtn}
          ${downloadBtn}
          ${goBtn}
        </div>
      </td>
    </tr>`;
}

/* ─────────────────────────────────────────────────────────────
   PREVIEW MODAL
───────────────────────────────────────────────────────────── */
function vaultPreview(key) {
  const f = _vaultFilesCache.find(x => x.key === key);
  if (!f || !f.documentUrl) { showToast('Нет файла для предпросмотра', 'red'); return; }

  const ext = f.name.split('.').pop().toLowerCase();
  const url = resolveDocUrl(f.documentUrl);

  const modal   = document.getElementById('vaultPreviewModal');
  const overlay = document.getElementById('vaultPreviewOverlay');
  const body    = document.getElementById('vaultPreviewBody');
  const title   = document.getElementById('vaultPreviewTitle');
  const dlBtn   = document.getElementById('vaultPreviewDlBtn');

  if (!modal) return;

  if (title) title.textContent = f.name;
  if (dlBtn) dlBtn.onclick = () => vaultDownload(key);

  let html = '';
  if (ext === 'pdf') {
    html = `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:8px;background:#fff"></iframe>`;
  } else if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
    html = `<div style="text-align:center;padding:20px">
      <img src="${url}" alt="${f.name}"
        style="max-width:100%;max-height:70vh;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.5);object-fit:contain" />
    </div>`;
  } else {
    html = `<div style="padding:40px;text-align:center;color:#8a9bbf">
      <i class="fas fa-file-alt" style="font-size:48px;margin-bottom:12px;display:block;color:#3b82f6"></i>
      <div style="font-size:14px;margin-bottom:8px">${f.name}</div>
      <div style="font-size:12px">Предпросмотр недоступен для этого типа файла</div>
    </div>`;
  }
  if (body) body.innerHTML = html;

  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
  modal.style.display = 'flex';
}

function vaultClosePreview() {
  const modal   = document.getElementById('vaultPreviewModal');
  const overlay = document.getElementById('vaultPreviewOverlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  const body = document.getElementById('vaultPreviewBody');
  if (body) body.innerHTML = '';  // free memory (especially for PDFs)
}

/* ─────────────────────────────────────────────────────────────
   DOWNLOAD / OPEN
───────────────────────────────────────────────────────────── */
function vaultDownload(key) {
  const f = _vaultFilesCache.find(x => x.key === key);
  if (!f || !f.documentUrl) { showToast('Нет файла для скачивания', 'red'); return; }
  window.open(resolveDocUrl(f.documentUrl), '_blank');
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATE TO SOURCE — each entry carries its own real navigation
   closure (set in vaultCollectAllFiles()); dispatched by key rather
   than serialized into the onclick attribute, since a closure can't
   survive being turned into a string (same pattern as js/workflow.js's
   runPendingApprovalAction / js/modules.js's runCalendarEventAction).
───────────────────────────────────────────────────────────── */
function vaultGoToSource(key) {
  const f = _vaultFilesCache.find(x => x.key === key);
  if (f && f.goToSource) f.goToSource();
}

/* ─────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────── */
function vaultGetFileIcon(ext) {
  if (ext === 'pdf')               return 'fa-file-pdf';
  if (['doc','docx'].includes(ext)) return 'fa-file-word';
  if (['xls','xlsx'].includes(ext)) return 'fa-file-excel';
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return 'fa-file-image';
  if (['zip','rar','7z'].includes(ext)) return 'fa-file-archive';
  if (['mp4','mov','avi'].includes(ext)) return 'fa-file-video';
  return 'fa-file-alt';
}

function vaultGetFileColor(ext) {
  if (ext === 'pdf')               return '#ef4444';
  if (['doc','docx'].includes(ext)) return '#3b82f6';
  if (['xls','xlsx'].includes(ext)) return '#22c55e';
  if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) return '#f97316';
  if (['zip','rar','7z'].includes(ext)) return '#eab308';
  return '#8b5cf6';
}

function escapeAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
