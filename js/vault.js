// ============================================================
//  vault.js — Global File Vault (Просмотр всех загруженных файлов)
//  Aggregates: Documents module (docFiles) + any file uploaded
//  anywhere in CRM
// ============================================================

/* ── File-preview modal (inline lightbox) ──────────────────── */
let vaultPreviewUrl   = null;
let vaultPreviewName  = '';
let vaultFilterModule = '';
let vaultFilterType   = '';
let vaultSearch       = '';

/* ─────────────────────────────────────────────────────────────
   AGGREGATOR — collect files from ALL modules
───────────────────────────────────────────────────────────── */
function vaultGetAllFiles() {
  const all = [];

  // ── 1. Documents module (docFiles[]) ──────────────────────
  if (typeof docFiles !== 'undefined') {
    docFiles.forEach(f => {
      all.push({
        key:      'doc_' + f.id,
        module:   'Документы',
        moduleColor: '#3b82f6',
        moduleIcon:  'fa-folder-open',
        client:   f.category || '—',
        name:     f.name,
        size:     f.size || '—',
        date:     f.date || '—',
        uploader: f.uploader || '—',
        dataUrl:  null,        // documents.js stores metadata only
        comments: f.comments?.length || 0,
        canPreview: false,
        source:   'docs',
        sourceId: f.id,
      });
    });
  }

  return all;
}

/* ─────────────────────────────────────────────────────────────
   RENDER VAULT PAGE
───────────────────────────────────────────────────────────── */
function renderVaultPage() {
  const el = document.getElementById('vaultContent');
  if (!el) return;

  const allFiles  = vaultGetAllFiles();
  const modules   = [...new Set(allFiles.map(f => f.module))];

  // KPIs
  const totalCount = allFiles.length;
  const docCount   = allFiles.filter(f => f.source === 'docs').length;
  const previewable= allFiles.filter(f => f.canPreview).length;

  el.innerHTML = `
    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-file-alt"></i></div>
        <div class="kpi-body">
          <span class="kpi-label">Всего файлов</span>
          <span class="kpi-value">${totalCount}</span>
          <span class="kpi-delta up">в CRM</span>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon blue"><i class="fas fa-folder-open"></i></div>
        <div class="kpi-body">
          <span class="kpi-label">Документы CRM</span>
          <span class="kpi-value">${docCount}</span>
          <span class="kpi-delta">файлов</span>
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
          ${modules.map(m => `<option value="${m}" ${vaultFilterModule===m?'selected':''}>${m}</option>`).join('')}
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

/* ─────────────────────────────────────────────────────────────
   RENDER TABLE (filtered)
───────────────────────────────────────────────────────────── */
function renderVaultTable() {
  const wrap = document.getElementById('vaultTableWrap');
  const countEl = document.getElementById('vaultFileCount');
  if (!wrap) return;

  let files = vaultGetAllFiles();

  // Apply filters
  if (vaultFilterModule) files = files.filter(f => f.module === vaultFilterModule);
  if (vaultSearch) {
    const q = vaultSearch.toLowerCase();
    files = files.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.client.toLowerCase().includes(q) ||
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
        <div style="font-size:12px">Загрузите файлы в разделе Документы</div>
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

  const previewBtn = f.canPreview && f.dataUrl
    ? `<button onclick="vaultPreview('${escapeAttr(f.key)}')"
         title="Предпросмотр"
         style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
         <i class="fas fa-eye"></i>
       </button>`
    : `<button disabled title="Предпросмотр недоступен"
         style="background:rgba(255,255,255,0.03);border:1px solid #1e293b;color:#374151;padding:5px 9px;border-radius:6px;cursor:not-allowed;font-size:11px">
         <i class="fas fa-eye-slash"></i>
       </button>`;

  const downloadBtn = f.dataUrl
    ? `<button onclick="vaultDownload('${escapeAttr(f.key)}')"
         title="Скачать"
         style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.25);color:#4ade80;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
         <i class="fas fa-download"></i>
       </button>`
    : `<button onclick="showToast('Файл хранится как метаданные — скачать нельзя','red')" title="Нет данных файла"
         style="background:rgba(255,255,255,0.03);border:1px solid #1e293b;color:#374151;padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px">
         <i class="fas fa-download"></i>
       </button>`;

  const goBtn = `<button onclick="vaultGoToModule('${escapeAttr(f.module)}')"
      title="Открыть модуль"
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
  const allFiles = vaultGetAllFiles();
  const f = allFiles.find(x => x.key === key);
  if (!f || !f.dataUrl) { showToast('Нет данных для предпросмотра', 'red'); return; }

  const ext = f.name.split('.').pop().toLowerCase();

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
    html = `<iframe src="${f.dataUrl}" style="width:100%;height:70vh;border:none;border-radius:8px;background:#fff"></iframe>`;
  } else if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
    html = `<div style="text-align:center;padding:20px">
      <img src="${f.dataUrl}" alt="${f.name}"
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
   DOWNLOAD
───────────────────────────────────────────────────────────── */
function vaultDownload(key) {
  const allFiles = vaultGetAllFiles();
  const f = allFiles.find(x => x.key === key);
  if (!f || !f.dataUrl) { showToast('Нет данных файла для скачивания', 'red'); return; }
  const a = document.createElement('a');
  a.href     = f.dataUrl;
  a.download = f.name;
  a.click();
  showToast(`📥 Скачивание: ${f.name}`, 'green');
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATE TO MODULE
───────────────────────────────────────────────────────────── */
function vaultGoToModule(moduleName) {
  const MAP = {
    'Документы':  'documents',
  };
  const page = MAP[moduleName];
  if (page) navigateTo(page);
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
