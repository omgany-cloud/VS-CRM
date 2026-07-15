// ============================================================
//  documents.js — File Upload & Comments Module
// ============================================================

// Document categories
const DOC_CATEGORIES = {
  ru: ['KYC/AML', 'First Closing', 'Сделки', 'Портфель', 'Capital Calls', 'Distributions', 'Отчёты', 'Прочее'],
  en: ['KYC/AML', 'First Closing', 'Deals', 'Portfolio', 'Capital Calls', 'Distributions', 'Reports', 'Other'],
};

// In-memory storage for uploaded files (metadata only, no actual binary storage)
let docFiles = [];  // populated at runtime by js/api-auth.js via GET /api/documents (see server/index.js)

let docFilterCategory = '';
let docNextId = 100;

function renderDocumentsPage() {
  applyDocCategoryVisibility();
  renderDocStats();
  renderDocList(docFiles.filter(d => d.fundId === activeFundId));
}

// Mirrors server/chineseWall.js's FM_ONLY_DOCUMENT_CATEGORIES — kept in
// sync by hand, there's no shared module between frontend and backend
// here. The server already rejects a POST/GET touching these categories
// for a non-accessFM user (403), so this is UX only: hides the categories
// they'd just get rejected for instead of letting them pick one and find
// out from an error toast.
const FM_ONLY_DOC_CATEGORIES = ['Сделки', 'Портфель', 'Capital Calls', 'Distributions', 'First Closing'];

function applyDocCategoryVisibility() {
  const hasAccessFM = currentUserPermission('accessFM');
  const uploadSelect = document.getElementById('docUploadCategory');
  if (uploadSelect) {
    Array.from(uploadSelect.options).forEach(o => {
      o.hidden = !hasAccessFM && FM_ONLY_DOC_CATEGORIES.includes(o.value);
    });
    if (uploadSelect.selectedOptions[0]?.hidden) {
      const firstVisible = Array.from(uploadSelect.options).find(o => !o.hidden);
      if (firstVisible) uploadSelect.value = firstVisible.value;
    }
  }
  document.querySelectorAll('.doc-cat-btn').forEach(b => {
    b.style.display = (!hasAccessFM && FM_ONLY_DOC_CATEGORIES.includes(b.dataset.cat)) ? 'none' : '';
  });
}

function renderDocStats() {
  const total = docFiles.filter(d => d.fundId === activeFundId).length;
  const totalComments = docFiles.filter(d => d.fundId === activeFundId).reduce((s, d) => s + d.comments.length, 0);
  const el = document.getElementById('docStats');
  if (el) el.innerHTML = `
    <div class="doc-stat-pill"><i class="fas fa-file"></i> ${total} ${currentLang === 'ru' ? 'файлов' : 'files'}</div>
    <div class="doc-stat-pill"><i class="fas fa-comment"></i> ${totalComments} ${currentLang === 'ru' ? 'комментариев' : 'comments'}</div>
  `;
}

function renderDocList(data) {
  const cats = DOC_CATEGORIES[currentLang];
  const container = document.getElementById('docListContainer');
  if (!container) return;

  if (!data.length) {
    container.innerHTML = `<div class="doc-empty"><i class="fas fa-folder-open"></i><p>${currentLang === 'ru' ? 'Нет загруженных файлов' : 'No uploaded files'}</p></div>`;
    return;
  }

  container.innerHTML = data.map(doc => `
    <div class="doc-file-card" id="docCard_${doc.id}">
      <div class="dfc-header">
        <div class="dfc-icon ${getDocIconClass(doc.name)}"><i class="${getDocIcon(doc.name)}"></i></div>
        <div class="dfc-meta">
          <div class="dfc-name">${doc.name}</div>
          <div class="dfc-info">
            <span class="badge badge-blue" style="font-size:10px">${doc.category}</span>
            <span>${doc.size}</span>
            <span>${formatDate(doc.date)}</span>
            <span>${currentLang === 'ru' ? 'Загрузил' : 'By'}: <strong>${doc.uploader}</strong></span>
          </div>
        </div>
        <div class="dfc-actions">
          <button class="act-btn" title="${currentLang === 'ru' ? 'Скачать' : 'Download'}" onclick="simulateDownload('${doc.name}')"><i class="fas fa-download"></i></button>
          <button class="act-btn del" title="${currentLang === 'ru' ? 'Удалить' : 'Delete'}" onclick="deleteDoc(${doc.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <!-- Comments -->
      <div class="dfc-comments">
        ${doc.comments.map(c => `
          <div class="comment-item">
            <div class="comment-avatar">${c.author.charAt(0)}</div>
            <div class="comment-body">
              <div class="comment-meta"><strong>${c.author}</strong> · ${formatDate(c.date)}</div>
              <div class="comment-text">${c.text}</div>
            </div>
          </div>
        `).join('')}
        <div class="comment-input-row">
          <input type="text" class="comment-input" id="commentInput_${doc.id}"
            placeholder="${t('doc_comment_ph')}"
            onkeydown="if(event.key==='Enter') addComment(${doc.id})" />
          <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick="addComment(${doc.id})">${t('doc_add_comment')}</button>
        </div>
      </div>
    </div>
  `).join('');
}

function filterDocs(category) {
  docFilterCategory = category;
  document.querySelectorAll('.doc-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === category));
  const filtered = docFiles.filter(d => d.fundId === activeFundId && (!category || d.category === category));
  renderDocList(filtered);
}

function addComment(docId) {
  const input = document.getElementById('commentInput_' + docId);
  const text = input ? input.value.trim() : '';
  if (!text) return;
  const doc = docFiles.find(d => d.id === docId);
  if (!doc) return;
  doc.comments.push({ id: Date.now(), author: 'Менеджер', date: new Date().toISOString().split('T')[0], text });
  input.value = '';
  renderDocumentsPage();
  showToast(currentLang === 'ru' ? '💬 Комментарий добавлен' : '💬 Comment added');
}

function deleteDoc(docId) {
  const msg = currentLang === 'ru' ? 'Удалить файл?' : 'Delete file?';
  if (!confirm(msg)) return;
  docFiles = docFiles.filter(d => d.id !== docId);
  renderDocumentsPage();
  showToast(currentLang === 'ru' ? '🗑️ Файл удалён' : '🗑️ File deleted', 'red');
}

function simulateDownload(name) {
  showToast(`📥 ${name}`);
}

async function handleFileUpload(input) {
  const files = input.files;
  if (!files || !files.length) return;
  const category = document.getElementById('docUploadCategory').value;
  let uploaded = 0;
  for (const file of Array.from(files)) {
    const sizeKB = Math.round(file.size / 1024);
    // uploader is server-stamped from the logged-in account (server/index.js)
    // — whatever's sent here is ignored, not trusted.
    const payload = {
      fundId: activeFundId,
      name: file.name,
      category,
      size: sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB',
      date: new Date().toISOString().split('T')[0],
    };
    try {
      const created = await apiFetch('/api/documents', { method: 'POST', body: JSON.stringify(payload) });
      docFiles.push(created);
      uploaded++;
    } catch (err) {
      showToast('⚠️ Не удалось загрузить ' + file.name + ': ' + err.message, 'red');
    }
  }
  renderDocumentsPage();
  if (uploaded) showToast(`✅ ${currentLang === 'ru' ? 'Загружено' : 'Uploaded'}: ${uploaded} ${currentLang === 'ru' ? 'файл(ов)' : 'file(s)'}`);
  input.value = '';
}

function getDocIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'fas fa-file-pdf';
  if (['doc','docx'].includes(ext)) return 'fas fa-file-word';
  if (['xls','xlsx'].includes(ext)) return 'fas fa-file-excel';
  if (['jpg','jpeg','png','gif'].includes(ext)) return 'fas fa-file-image';
  if (['zip','rar'].includes(ext)) return 'fas fa-file-archive';
  return 'fas fa-file-alt';
}

function getDocIconClass(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc','docx'].includes(ext)) return 'word';
  if (['xls','xlsx'].includes(ext)) return 'excel';
  return 'generic';
}
