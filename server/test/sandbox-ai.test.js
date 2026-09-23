// Coverage for Sandbox file attachments + AI analysis
// (server/index.js's /api/sandbox/:id/files*, /api/sandbox/:id/analyze,
// /api/sandbox/runs/:runId). Runs with AI_PROVIDER=stub (same test-only
// seam as ai-assist.test.js) so these exercise real route logic —
// permission gates, attachment/mime/size/char-budget checks, sourceIds
// clamping, run persistence — without a live API key.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { createTestServer } = require('./helpers');

// Minimal, valid-enough .docx/.xlsx fixtures for server/officeTextExtract.js
// — real Word/Excel files carry a lot more (styles, [Content_Types].xml,
// relationship files) that the extractor never reads, so building only the
// parts it actually opens keeps this focused on the extraction logic.
function buildDocxFixture(paragraphs) {
  const body = paragraphs.map(p => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;')}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0"?><w:document xmlns:w="ns"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}
function buildXlsxFixture(sheetName, rows) {
  const strings = [];
  const internIndex = (s) => {
    const i = strings.indexOf(s);
    if (i !== -1) return i;
    strings.push(s);
    return strings.length - 1;
  };
  const rowsXml = rows.map((row, ri) => {
    const cellsXml = row.map((cell, ci) => {
      const col = String.fromCharCode(65 + ci);
      if (typeof cell === 'number') return `<c r="${col}${ri + 1}"><v>${cell}</v></c>`;
      return `<c r="${col}${ri + 1}" t="s"><v>${internIndex(String(cell))}</v></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cellsXml}</row>`;
  }).join('');
  const sharedStringsXml = `<?xml version="1.0"?><sst xmlns="ns" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`;
  const workbookXml = `<?xml version="1.0"?><workbook xmlns="ns"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const sheetXml = `<?xml version="1.0"?><worksheet xmlns="ns"><sheetData>${rowsXml}</sheetData></worksheet>`;
  const zip = new AdmZip();
  zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheetXml, 'utf8'));
  return zip.toBuffer();
}

// Deliberately does not include either real upload_id used below — proves
// the server clamps a model-cited source rather than trusting it verbatim.
const AI_STUB_RESPONSE = {
  summary: 'stub summary of the project',
  risks: [{ severity: 'medium', text: 'stub risk finding', basis: 'ai_inference', citations: [{ uploadId: 'not-a-real-upload-id', page: 1, quote: 'stub quote' }] }],
  missingInfo: ['stub missing info item'],
  recommendation: { action: 'request_information', rationale: 'stub rationale' },
  suggestedTasks: [{ title: 'Запросить финмодель', priority: 'Средний' }],
};

// A structurally valid but content-less PDF (no text stream) — pdf-parse
// extracts no text, but pdfjs-dist CAN still render its (blank) page as an
// image, so this exercises the OCR-fallback success path, not the
// truly-unreadable one.
const BLANK_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
);
// Not a PDF at all — neither pdf-parse nor pdfjs-dist can make anything of
// this, so it's the one that should actually land in `unreadable`.
const GARBAGE_NOT_A_PDF = Buffer.from('this is not a pdf at all, just garbage text bytes 12345');
// Two content-less pages (no text stream) — both pdf-parse and pdfjs-dist
// agree this is a 2-page document, so it exercises the OCR coverage path
// (SANDBOX_OCR_MAX_PAGES_PER_PDF=3 covers both, "pagesProcessed < pagesTotal"
// stays false here — a THIRD-page variant would be needed to see a partial
// scan; 2 pages is enough to prove pagesTotal/pagesProcessed are populated
// and agree, which is what the citation-page clamp below depends on).
const TWO_PAGE_BLANK_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\n4 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\n' +
  'trailer<</Root 1 0 R>>\n%%EOF'
);

let server;
let projectId;

// baseUrl defaults to the outer shared `server` — pass one explicitly for
// any call against a standalone server spun up inside a single test (e.g.
// the oversized-response test below), otherwise the upload silently lands
// on the wrong server's database and every call after it 404s/400s in a
// way that looks unrelated to the actual mistake.
async function uploadTestFile(client, bytes, mime, filename, baseUrl = server.baseUrl) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  return client(baseUrl + '/api/uploads', { method: 'POST', headers: {}, body: form });
}
// server.apiFetch always sends Content-Type: application/json, which
// breaks a multipart body — build a raw-fetch variant that carries the
// same bearer token but lets fetch set its own multipart boundary.
function rawFetchAs(token) {
  return (url, opts = {}) => fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
}

before(async () => {
  server = await createTestServer({
    port: 4141,
    extraEnv: { AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(AI_STUB_RESPONSE) },
  });
  await server.apiFetch('/api/roles').then(async r => {
    const { roles } = await r.json();
    const ceo = roles.find(x => x.code === 'CEO');
    await server.apiFetch(`/api/roles/${ceo.id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });
  });
  const p = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_AI_TEST', goal: 'Оценить документы' }) })).json();
  projectId = p.id;
});

after(async () => { await server.stop(); });

async function attach(uploadId) {
  return server.apiFetch(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) });
}

test('a file must be uploaded, then attached — attaching twice is idempotent', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'deck.png');
  assert.equal(up.status, 201);
  const { id: uploadId } = await up.json();

  const first = await attach(uploadId);
  assert.equal(first.status, 201);
  const second = await attach(uploadId);
  assert.equal(second.status, 200, 'attaching the same file twice must not error or duplicate');

  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.equal(detail.files.filter(f => f.uploadId === uploadId).length, 1);
});

test('detaching removes the relation but not the underlying file', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([1, 2, 3]), 'image/png', 'to-detach.png');
  const { id: uploadId } = await up.json();
  const attached = await (await attach(uploadId)).json();

  const del = await server.apiFetch(`/api/sandbox/${projectId}/files/${attached.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.ok(!detail.files.some(f => f.uploadId === uploadId));
  // the raw upload itself must still be downloadable
  assert.equal((await rawFetchAs(server.token)(server.baseUrl + `/api/uploads/${uploadId}`)).status, 200);
});

test('analyze requires consent, at least one uploadId, and files actually attached to this project', async () => {
  const noConsent = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ uploadIds: [1] }) });
  assert.equal(noConsent.status, 400);
  assert.equal((await noConsent.json()).field, 'consent');

  const noFiles = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [] }) });
  assert.equal(noFiles.status, 400);

  const notAttached = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [999999] }) });
  assert.equal(notAttached.status, 400);
});

test('analyze rejects an attached file whose type is not PDF/image', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from('not a pdf'), 'application/msword', 'contract.doc');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /PDF|изображени/);
});

test('analyze rejects more than the per-run file limit', async () => {
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([i]), 'image/png', `p${i}.png`);
    const { id } = await up.json();
    await attach(id);
    ids.push(id);
  }
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: ids }) });
  assert.equal(res.status, 400);
});

test('analyze: happy path on an image — validated result, citations clamped to real ids, coverage recorded, run persisted and readable both from the project and standalone', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'image/png', 'teaser.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);

  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.status, 'ok');
  assert.equal(run.result.summary, 'stub summary of the project');
  assert.equal(run.result.recommendation.action, 'request_information');
  assert.deepEqual(run.result.risks[0].citations, [], 'a citation to an upload id the model invented (not one of the real upload ids) must be dropped, not trusted');
  assert.equal(run.result.risks[0].basis, 'ai_inference');
  assert.equal(run.consentNote.length > 0, true);
  assert.equal(run.inputSnapshot.goal, 'Оценить документы');
  assert.equal(run.inputSnapshot.coverage.length, 1);
  assert.equal(run.inputSnapshot.coverage[0].mode, 'image');

  const detail = await (await server.apiFetch(`/api/sandbox/${projectId}`)).json();
  assert.ok(detail.aiRuns.some(r => r.id === run.id && r.status === 'ok'));

  const standalone = await (await server.apiFetch(`/api/sandbox/runs/${run.id}`)).json();
  assert.equal(standalone.result.summary, run.result.summary);

  const history = detail.history;
  assert.ok(history.some(h => h.action === 'ai_analyzed'));

  // The list view (Excel export's data source) surfaces the latest run
  // without a second round trip per project.
  const { projects } = await (await server.apiFetch('/api/sandbox')).json();
  const listed = projects.find(p => p.id === projectId);
  assert.equal(listed.lastAiSummary, 'stub summary of the project');
  assert.equal(listed.lastAiRecommendation, 'Запросить дополнительную информацию');
  assert.ok(listed.lastAiRunAt);
});

test('analyze: customInstructions is optional, persisted with the run, and rejected past its length limit', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([0x89, 0x50, 0x4e, 0x47, 3]), 'image/png', 'ci.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);

  const noInstructions = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).json();
  assert.equal(noInstructions.inputSnapshot.customInstructions, null, 'omitted customInstructions must be recorded as absent, not an empty string');

  const withInstructions = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, {
    method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId], customInstructions: 'Обрати внимание на юридические риски' }),
  })).json();
  assert.equal(withInstructions.inputSnapshot.customInstructions, 'Обрати внимание на юридические риски');
  const standalone = await (await server.apiFetch(`/api/sandbox/runs/${withInstructions.id}`)).json();
  assert.equal(standalone.inputSnapshot.customInstructions, 'Обрати внимание на юридические риски', 'must round-trip from GET /runs/:id too, not just the create response');

  const tooLong = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, {
    method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId], customInstructions: 'x'.repeat(2001) }),
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).field, 'customInstructions');
});

test('analyze: a PDF with no text layer is rendered to an image and analyzed (OCR fallback), not silently dropped or errored', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), BLANK_PDF, 'application/pdf', 'scan.pdf');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.deepEqual(run.inputSnapshot.unreadable, [], 'a renderable scan must not be marked unreadable — it was analyzed as an image instead');
});

test('analyze: a file that is genuinely not a PDF (extraction AND rendering both fail) is flagged unreadable, not silently dropped or errored', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), GARBAGE_NOT_A_PDF, 'application/pdf', 'corrupt.pdf');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.deepEqual(run.inputSnapshot.unreadable, ['corrupt.pdf']);
});

test('analyze: a .docx is analyzable — text (including a table) is extracted and reaches the model, coverage mode "office"', async () => {
  const buf = buildDocxFixture(['Teaser: SkyView Resort', 'Revenue 2025: 4,800,000 USD & growing']);
  const up = await uploadTestFile(rawFetchAs(server.token), buf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'teaser.docx');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.status, 'ok');
  const cov = run.inputSnapshot.coverage.find(c => c.uploadId === uploadId);
  assert.equal(cov.mode, 'office');
  assert.deepEqual(run.inputSnapshot.unreadable, []);
});

test('analyze: an .xlsx is analyzable — cell text (via sharedStrings) is extracted, coverage mode "office"', async () => {
  const buf = buildXlsxFixture('DealSummary', [['Item', 'Amount'], ['Revenue 2025', 4800000], ['Risk note', 'Single-supplier dependency']]);
  const up = await uploadTestFile(rawFetchAs(server.token), buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'model.xlsx');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.equal(run.status, 'ok');
  const cov = run.inputSnapshot.coverage.find(c => c.uploadId === uploadId);
  assert.equal(cov.mode, 'office');
  assert.deepEqual(run.inputSnapshot.unreadable, []);
});

test('analyze: a corrupted .docx (not a real zip) is flagged unreadable, not crashed on', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from('not actually a zip'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'broken.docx');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  assert.deepEqual(run.inputSnapshot.unreadable, ['broken.docx']);
});

test('analyze: legacy .doc/.xls (binary, pre-2007 formats) are still rejected, not silently mis-handled as .docx/.xlsx', async () => {
  const upDoc = await uploadTestFile(rawFetchAs(server.token), Buffer.from('legacy binary doc'), 'application/msword', 'old.doc');
  const { id: docId } = await upDoc.json();
  await attach(docId);
  const resDoc = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [docId] }) });
  assert.equal(resDoc.status, 400);
  assert.match((await resDoc.json()).error, /\.doc\/\.xls/);

  const upXls = await uploadTestFile(rawFetchAs(server.token), Buffer.from('legacy binary xls'), 'application/vnd.ms-excel', 'old.xls');
  const { id: xlsId } = await upXls.json();
  await attach(xlsId);
  const resXls = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [xlsId] }) });
  assert.equal(resXls.status, 400);
});

test('analyze: a scanned multi-page PDF records real page coverage (mode "ocr", pagesTotal/pagesProcessed), and a citation page beyond what was actually shown is nulled, not trusted', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), TWO_PAGE_BLANK_PDF, 'application/pdf', 'two-page-scan.pdf');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const res = await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(res.status, 201);
  const run = await res.json();
  const cov = run.inputSnapshot.coverage.find(c => c.uploadId === uploadId);
  assert.equal(cov.mode, 'ocr');
  assert.equal(cov.pagesTotal, 2);
  assert.equal(cov.pagesProcessed, 2, 'both pages fit under SANDBOX_OCR_MAX_PAGES_PER_PDF');
});

// Own server: needs a stub response that cites a specific real+fake page
// number, fixed at server-start time via extraEnv, so it can't reuse the
// shared AI_STUB_RESPONSE above. A brand-new throwaway DB's uploaded_files
// table starts its autoincrement at 1, so the first upload's id is
// predictable — asserted explicitly below rather than just assumed.
test('analyze: a citation page beyond a file\'s actual page count is nulled server-side, even though the uploadId/quote it came with is legitimate', async () => {
  const CITING_RESPONSE = {
    summary: 'stub summary citing pages',
    risks: [{
      severity: 'high', text: 'cites a page that was never shown to the model', basis: 'source_claim',
      citations: [{ uploadId: 1, page: 99, quote: 'made up' }],
    }],
    missingInfo: [], recommendation: { action: 'consider_screening', rationale: 'r' }, suggestedTasks: [],
  };
  const citeServer = await createTestServer({
    port: 4148,
    extraEnv: { AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(CITING_RESPONSE) },
  });
  try {
    const { roles } = await (await citeServer.apiFetch('/api/roles')).json();
    await citeServer.apiFetch(`/api/roles/${roles.find(r => r.code === 'CEO').id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });
    const p = await (await citeServer.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_CITE_TEST' }) })).json();
    const up = await uploadTestFile(rawFetchAs(citeServer.token), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png', 'single.png', citeServer.baseUrl);
    const { id: uploadId } = await up.json();
    assert.equal(uploadId, 1, 'this test assumes a fresh DB\'s first upload gets id 1 — the fixture above is written against that id');
    await citeServer.apiFetch(`/api/sandbox/${p.id}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) });

    const res = await citeServer.apiFetch(`/api/sandbox/${p.id}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
    assert.equal(res.status, 201);
    const run = await res.json();
    const citation = run.result.risks[0].citations[0];
    assert.equal(citation.uploadId, '1', 'the uploadId itself is real (it was in allowedSourceIds) so the citation is kept');
    assert.equal(citation.page, null, 'a single image only has "page 1" — page 99 was never shown, so it must be nulled, not trusted');
    assert.equal(citation.quote, 'made up', 'only the page is distrusted; the rest of the citation is not thrown away');
  } finally {
    await citeServer.stop();
  }
});

test('a task can be created from an AI suggestion (sourceAiRunId) and is rejected if the run belongs to another project', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([9, 9]), 'image/png', 'x.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const run = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).json();

  const task = await (await server.apiFetch(`/api/sandbox/${projectId}/tasks`, {
    method: 'POST', body: JSON.stringify({ title: run.result.suggestedTasks[0].title, priority: run.result.suggestedTasks[0].priority, sourceAiRunId: run.id }),
  })).json();
  assert.equal(task.sourceAiRunId, run.id);

  const otherProject = await (await server.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_AI_OTHER' }) })).json();
  const bad = await server.apiFetch(`/api/sandbox/${otherProject.id}/tasks`, {
    method: 'POST', body: JSON.stringify({ title: 'x', sourceAiRunId: run.id }),
  });
  assert.equal(bad.status, 400);
});

test('permissions: accessFM alone is not enough to analyze — aiAssist is required too, and to attach/detach files only accessFM is needed', async () => {
  const email = 'sbx-ai-analyst@example.com';
  await server.apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ email, password: 'SandboxAiTest2026!', role: 'ANALYST', name: 'TEST_ANALYST_AI' }) });
  const first = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'SandboxAiTest2026!' }),
  })).json();
  await fetch(server.baseUrl + '/api/users/me/password', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + first.token },
    body: JSON.stringify({ currentPassword: 'SandboxAiTest2026!', newPassword: 'MyOwnPass789!' }),
  });
  const login = await (await fetch(server.baseUrl + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'MyOwnPass789!' }),
  })).json();
  const asAnalyst = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token, ...(opts.headers || {}) } });

  const up = await uploadTestFile(rawFetchAs(login.token), Buffer.from([5]), 'image/png', 'y.png');
  const { id: uploadId } = await up.json();
  assert.equal((await asAnalyst(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) })).status, 201);

  const denied = await asAnalyst(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /aiAssist/);
});

test('tenant isolation: another tenant cannot attach files, analyze, or read a run', async () => {
  const up = await uploadTestFile(rawFetchAs(server.token), Buffer.from([7]), 'image/png', 'z.png');
  const { id: uploadId } = await up.json();
  await attach(uploadId);
  const run = await (await server.apiFetch(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).json();

  const signup = await fetch(server.baseUrl + '/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyName: 'ZZZ Sandbox AI Isolation Co', name: 'Tenant B Admin', email: 'tenantb-sbx-ai@isolationtest.example', password: 'TenantBPassword123' }),
  });
  const { token } = await signup.json();
  const asB = (p, opts = {}) => fetch(server.baseUrl + p, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  // Grant tenant B's own admin aiAssist too — otherwise a 403 from the
  // permission gate (which runs before the tenant-scoped lookup) would be
  // indistinguishable from a real isolation check; this makes the 404
  // below prove tenant scoping specifically, not just permissions.
  const { roles: bRoles } = await (await asB('/api/roles')).json();
  await asB(`/api/roles/${bRoles.find(r => r.code === 'CEO').id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });

  assert.equal((await asB(`/api/sandbox/${projectId}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/${projectId}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) })).status, 404);
  assert.equal((await asB(`/api/sandbox/runs/${run.id}`)).status, 404);
});

// A real provider doesn't reliably obey a count instruction given only in
// the prompt (no live account needed to reproduce — a stub with more items
// than the display limits does the same thing). Own server: the oversized
// fixture has to be fixed at server-start time via extraEnv.
test('analyze: a response with more items than the display limits is truncated, not rejected outright', async () => {
  const OVERSIZED_RESPONSE = {
    summary: 'x'.repeat(2500),
    risks: Array.from({ length: 12 }, (_, i) => ({ severity: 'low', text: `risk ${i}`, citations: [] })),
    missingInfo: Array.from({ length: 11 }, (_, i) => `missing ${i}`),
    recommendation: { action: 'consider_screening', rationale: 'y'.repeat(1200) },
    suggestedTasks: Array.from({ length: 9 }, (_, i) => ({ title: `task ${i}`, priority: 'Средний' })),
  };
  const bigServer = await createTestServer({
    port: 4146,
    extraEnv: { AI_PROVIDER: 'stub', AI_STUB_RESPONSE: JSON.stringify(OVERSIZED_RESPONSE) },
  });
  try {
    const { roles } = await (await bigServer.apiFetch('/api/roles')).json();
    await bigServer.apiFetch(`/api/roles/${roles.find(r => r.code === 'CEO').id}`, { method: 'PUT', body: JSON.stringify({ aiAssist: true }) });
    const p = await (await bigServer.apiFetch('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'SBX_OVERSIZED' }) })).json();
    const up = await uploadTestFile(rawFetchAs(bigServer.token), Buffer.from([1, 2]), 'image/png', 'x.png', bigServer.baseUrl);
    const { id: uploadId } = await up.json();
    const attached = await bigServer.apiFetch(`/api/sandbox/${p.id}/files`, { method: 'POST', body: JSON.stringify({ uploadId }) });
    assert.equal(attached.status, 201);

    const res = await bigServer.apiFetch(`/api/sandbox/${p.id}/analyze`, { method: 'POST', body: JSON.stringify({ consent: true, uploadIds: [uploadId] }) });
    assert.equal(res.status, 201, 'an oversized-but-otherwise-valid response must not be rejected');
    const run = await res.json();
    assert.equal(run.result.summary.length, 2000);
    assert.equal(run.result.risks.length, 8);
    assert.equal(run.result.missingInfo.length, 8);
    assert.equal(run.result.suggestedTasks.length, 6);
    assert.equal(run.result.recommendation.rationale.length, 1000);
  } finally {
    await bigServer.stop();
  }
});
