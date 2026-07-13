// ============================================================
//  documents.js — File Upload & Comments Module
// ============================================================

// Document categories
const DOC_CATEGORIES = {
  ru: ['KYC/AML', 'First Closing', 'Сделки', 'Портфель', 'Capital Calls', 'Distributions', 'Отчёты', 'Прочее'],
  en: ['KYC/AML', 'First Closing', 'Deals', 'Portfolio', 'Capital Calls', 'Distributions', 'Reports', 'Other'],
};

// In-memory storage for uploaded files (metadata only, no actual binary storage)
let docFiles = [
  { id: 1, fundId: 'TCF1', name: 'KYC_Checklist_Template.pdf',        category: 'KYC/AML',        size: '328 KB', date: '2024-10-01', uploader: 'CCO', comments: [ { id:1, author:'CCO', date:'2024-10-02', text:'Шаблон утверждён для всех физических лиц.' } ] },
  { id: 2, fundId: 'TCF1', name: 'First_Closing_Templates.pdf',        category: 'First Closing',  size: '199 KB', date: '2024-11-01', uploader: 'CEO', comments: [ { id:2, author:'CEO', date:'2024-11-02', text:'Все шаблоны готовы к использованию на Closing Day.' } ] },
  { id: 3, fundId: 'TCF1', name: 'Investment_Harvesting_Templates.pdf',category: 'Сделки',          size: '261 KB', date: '2024-11-15', uploader: 'CFO', comments: [] },
  { id: 4, fundId: 'TCF1', name: 'Full_Business_Process_Guide.pdf',    category: 'Прочее',          size: '444 KB', date: '2024-12-01', uploader: 'GP', comments: [ { id:3, author:'GP', date:'2024-12-02', text:'Полный регламент бизнес-процессов, версия 1.0. Обязателен к изучению.' } ] },
];

let docFilterCategory = '';
let docNextId = 100;

function renderDocumentsPage() {
  renderDocStats();
  renderDocList(docFiles.filter(d => d.fundId === activeFundId));
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

function handleFileUpload(input) {
  const files = input.files;
  if (!files || !files.length) return;
  const category = document.getElementById('docUploadCategory').value;
  Array.from(files).forEach(file => {
    const sizeKB = Math.round(file.size / 1024);
    docFiles.push({
      id: ++docNextId,
      fundId: activeFundId,
      name: file.name,
      category,
      size: sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB',
      date: new Date().toISOString().split('T')[0],
      uploader: 'Менеджер',
      comments: [],
    });
  });
  renderDocumentsPage();
  showToast(`✅ ${currentLang === 'ru' ? 'Загружено' : 'Uploaded'}: ${files.length} ${currentLang === 'ru' ? 'файл(ов)' : 'file(s)'}`);
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
