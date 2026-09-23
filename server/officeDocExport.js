// Builds a real .docx (Word) from one Sandbox AI-analysis run, for the
// "Скачать в Word" button next to a run's result — sharing/printing
// outside the CRM (email to IC members, attach to a memo). Hand-rolled
// OOXML on adm-zip, same reasoning as server/officeTextExtract.js's
// read-side: this is a small, well-understood, narrow amount of XML, not
// worth a whole docx-generation library for one export button.
const AdmZip = require('adm-zip');
const { SANDBOX_ANALYZE_ACTION_LABELS_RU } = require('./sandboxMapping');

const SEVERITY_LABELS_RU = { low: 'низкий', medium: 'средний', high: 'высокий' };
const BASIS_LABELS_RU = {
  source_claim: 'из документа', ai_inference: 'вывод ИИ', no_data: 'данных нет', conflicting: 'источники расходятся',
};
const COVERAGE_MODE_LABELS_RU = { text: 'текст', ocr: 'скан (OCR)', image: 'изображение', office: 'Word/Excel', unreadable: 'не распознан' };

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // XML 1.0 disallows these even escaped
}

// One <w:r> run. Bold/color/size (half-points) as needed; a literal '\n'
// in `text` becomes a line break within the same paragraph (<w:br/>),
// not a new paragraph — used for multi-line citation quotes.
function run(text, { bold, italic, color, size } = {}) {
  const props = [];
  if (bold) props.push('<w:b/>');
  if (italic) props.push('<w:i/>');
  if (color) props.push(`<w:color w:val="${color}"/>`);
  if (size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const lines = esc(text).split('\n');
  const body = lines.map((line, i) => (i > 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${line}</w:t>`).join('');
  return `<w:r>${rPr}${body}</w:r>`;
}

// One <w:p> paragraph, one or more runs (mixed styling within a line —
// e.g. a bold label followed by plain text — via `runs: [[text, opts]]`).
function para(runsOrText, opts = {}) {
  const runsList = Array.isArray(runsOrText) ? runsOrText : [[runsOrText, opts]];
  const pPr = [];
  pPr.push(`<w:spacing w:before="${opts.spacingBefore ?? 0}" w:after="${opts.spacingAfter ?? 120}"/>`);
  if (opts.indent) pPr.push(`<w:ind w:left="${opts.indent}"/>`);
  const body = runsList.map(([t, o]) => run(t, o || opts)).join('');
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${body}</w:p>`;
}
function heading(text, level = 1) {
  const size = level === 1 ? 32 : level === 2 ? 24 : 20; // half-points: 16pt / 12pt / 10pt
  return para(text, { bold: true, size, spacingBefore: 280, spacingAfter: 140 });
}
function bullet(runsOrText, opts = {}) {
  return para(Array.isArray(runsOrText) ? [['• ', {}], ...runsOrText] : [['• ' + runsOrText, opts]], { ...opts, indent: 340, spacingAfter: 80 });
}

function buildSandboxAnalysisDocx(run_, project) {
  const r = run_.result || {};
  const inputSnapshot = run_.inputSnapshot || {};
  const coverage = inputSnapshot.coverage || [];
  const parts = [];

  parts.push(heading(`ИИ-анализ: ${project ? project.name : 'проект'}`, 1));
  parts.push(para([
    [`Запуск от ${esc(String(run_.createdAt).slice(0, 16))} · ${esc(run_.createdBy || '')}`, { italic: true, size: 18, color: '595959' }],
  ]));
  if (run_.provider || run_.model) {
    parts.push(para([[`Провайдер: ${run_.provider || '—'} · Модель: ${run_.model || '—'}`, { italic: true, size: 18, color: '595959' }]]));
  }
  if (inputSnapshot.customInstructions) {
    parts.push(heading('Запрос пользователя', 3));
    parts.push(para(`«${inputSnapshot.customInstructions}»`, { italic: true }));
  }

  parts.push(heading('Резюме', 2));
  parts.push(para(r.summary || '—'));

  parts.push(heading('Рекомендация', 2));
  const actionLabel = SANDBOX_ANALYZE_ACTION_LABELS_RU[r.recommendation?.action] || r.recommendation?.action || '—';
  parts.push(para([[actionLabel, { bold: true }]]));
  if (r.recommendation?.rationale) parts.push(para(r.recommendation.rationale));

  if (r.risks && r.risks.length) {
    parts.push(heading('Риски', 2));
    for (const risk of r.risks) {
      const sev = SEVERITY_LABELS_RU[risk.severity] || risk.severity;
      const basis = risk.basis ? (BASIS_LABELS_RU[risk.basis] || risk.basis) : null;
      parts.push(bullet([
        [`[${sev}${basis ? ' · ' + basis : ''}] `, { bold: true, size: 18 }],
        [risk.text || '', {}],
      ]));
      for (const c of (risk.citations || [])) {
        const fileEntry = coverage.find(cv => String(cv.uploadId) === String(c.uploadId));
        const label = (fileEntry ? fileEntry.name : c.uploadId) + (c.page ? `, стр. ${c.page}` : '');
        parts.push(para([
          [`   ↳ ${label}`, { italic: true, size: 18, color: '595959' }],
          c.quote ? [`: «${c.quote}»`, { italic: true, size: 18, color: '595959' }] : ['', {}],
        ], { spacingAfter: 60 }));
      }
    }
  }

  if (r.missingInfo && r.missingInfo.length) {
    parts.push(heading('Не хватает информации', 2));
    for (const m of r.missingInfo) parts.push(bullet(m));
  }

  if (r.suggestedTasks && r.suggestedTasks.length) {
    parts.push(heading('Предлагаемые задачи', 2));
    for (const t of r.suggestedTasks) parts.push(bullet([[`${t.title} `, {}], [`(${t.priority})`, { italic: true, color: '595959' }]]));
  }

  if (coverage.length) {
    parts.push(heading('Охват документов', 3));
    for (const c of coverage) {
      const mode = COVERAGE_MODE_LABELS_RU[c.mode] || c.mode;
      const pages = c.mode === 'ocr' ? ` — ${c.pagesProcessed}${c.pagesTotal ? ' из ' + c.pagesTotal : ''} стр.`
        : c.mode === 'text' && c.pagesTotal ? ` — ${c.pagesTotal} стр.` : '';
      parts.push(bullet(`${c.name}: ${mode}${pages}`, { size: 18, color: '595959' }));
    }
  }

  if (run_.consentNote) {
    parts.push(para([[run_.consentNote, { italic: true, size: 16, color: '8c8c8c' }]], { spacingBefore: 240 }));
  }
  parts.push(para([['Это консультативный ИИ-анализ, не решение о переходе проекта в Скрининг.', { italic: true, size: 16, color: '8c8c8c' }]]));

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${parts.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  return zip.toBuffer();
}

module.exports = { buildSandboxAnalysisDocx };
