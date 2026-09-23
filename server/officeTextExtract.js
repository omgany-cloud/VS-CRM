// Plain-text extraction for modern (zip+XML) Office documents, for Sandbox
// AI analysis (server/index.js's runSandboxAnalysis). Deliberately narrow:
// pulls out readable text only, not formatting/formulas/charts, and
// DELIBERATELY does not support the legacy binary .doc/.xls formats (pre
// Office 2007 — a different, much harder to parse, OLE-based format).
//
// Why a hand-rolled parser instead of a library: the obvious npm package
// for .xlsx (`xlsx`, i.e. SheetJS) has two unpatched CVEs (prototype
// pollution + ReDoS, no fix published to npm) sitting directly in the path
// of untrusted user-uploaded files — exactly the attack surface those bugs
// target. `.docx`/`.xlsx` are both just a zip of XML, and `adm-zip` is
// already a dependency (used by xmindImport.js), so a small, bomb-guarded
// regex-based extractor covers the real need (readable text for an AI
// summary, not a faithful spreadsheet/document model) without adding that
// risk. Same reasoning as xmindImport.js choosing adm-zip + a custom
// parser over a third-party XMind-specific package.
const AdmZip = require('adm-zip');

const OFFICE_MAX_OUTPUT_CHARS = 200000; // matches this module's job (rough context for AI), not a faithful export
const XLSX_MAX_SHEETS = 20;
const XLSX_MAX_ROWS_PER_SHEET = 2000;

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // last — must not re-decode entities the above already produced
}

// Concatenates every text node inside a chunk of XML — <t> (xlsx's default
// namespace) or <w:t> (docx's w: prefix; matched via an optional namespace
// prefix so this one regex covers both) — handling both a bare node and a
// rich-text run like <w:r><w:rPr>...</w:rPr><w:t>...</w:t></w:r>
// uniformly, since either way we just want every text node, in order.
function joinTNodes(xmlChunk) {
  const parts = [];
  const re = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g;
  let m;
  while ((m = re.exec(xmlChunk))) parts.push(decodeXmlEntities(m[1]));
  return parts.join('');
}

// .docx: word/document.xml, paragraphs separated by </w:p>, table cells by
// </w:tc> (so a table doesn't read as one run-on line), everything else
// stripped. Reasonable approximation of reading order, not a real layout
// engine — the AI just needs the words, in roughly the right groups.
// One pass, in document order: joinTNodes() alone can't do this (it only
// keeps the substrings that match <t>, dropping everything between them —
// including a paragraph/row boundary that isn't inside a <t> tag), so this
// walks text nodes AND boundary tags together in a single regex instead.
function extractDocxText(buf) {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('word/document.xml not found — not a valid .docx');
  const xml = entry.getData().toString('utf8');
  const parts = [];
  const re = /<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>|<\/(?:[\w.-]+:)?tc>|<\/(?:[\w.-]+:)?tr>|<\/(?:[\w.-]+:)?p>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]));
    else if (m[0].includes('tc>')) parts.push('\t');
    else parts.push('\n'); // </...tr> or </...p>
  }
  return parts.join('').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, OFFICE_MAX_OUTPUT_CHARS);
}

// .xlsx: xl/sharedStrings.xml (string pool, referenced by index from cells
// with t="s") + one xl/worksheets/sheetN.xml per sheet. Cell types per
// OOXML: no `t` attribute (or t="n") = number in <v>, t="s" = index into
// sharedStrings, t="str" = literal formula-result string in <v>, t="b" =
// boolean 0/1, t="inlineStr" = text directly in <is><t>. Formulas
// themselves (<f>) are skipped — only the computed <v> value is read.
function extractXlsxText(buf) {
  const zip = new AdmZip(buf);
  const sheetEntries = zip.getEntries()
    .filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  if (!sheetEntries.length) throw new Error('no xl/worksheets/sheetN.xml found — not a valid .xlsx');

  const sharedStringsEntry = zip.getEntry('xl/sharedStrings.xml');
  const sharedStrings = [];
  if (sharedStringsEntry) {
    const xml = sharedStringsEntry.getData().toString('utf8');
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) sharedStrings.push(joinTNodes(m[1]));
  }

  // Sheet display names (xl/workbook.xml) are a nice-to-have label, not
  // required for the text to be useful — best-effort only.
  let sheetNames = [];
  const workbookEntry = zip.getEntry('xl/workbook.xml');
  if (workbookEntry) {
    const wbXml = workbookEntry.getData().toString('utf8');
    const nameRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*>/g;
    let m;
    while ((m = nameRe.exec(wbXml))) sheetNames.push(decodeXmlEntities(m[1]));
  }

  const out = [];
  let totalLen = 0;
  sheetEntries.slice(0, XLSX_MAX_SHEETS).forEach((entry, i) => {
    if (totalLen >= OFFICE_MAX_OUTPUT_CHARS) return;
    const xml = entry.getData().toString('utf8');
    const label = sheetNames[i] || entry.entryName;
    out.push(`[Лист: ${label}]`);
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm, rowCount = 0;
    while ((rm = rowRe.exec(xml)) && rowCount < XLSX_MAX_ROWS_PER_SHEET && totalLen < OFFICE_MAX_OUTPUT_CHARS) {
      rowCount++;
      const rowXml = rm[1];
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      const cells = [];
      let cm;
      while ((cm = cellRe.exec(rowXml))) {
        const attrs = cm[1] || '';
        const body = cm[2] || '';
        const typeMatch = /\bt="([^"]*)"/.exec(attrs);
        const type = typeMatch ? typeMatch[1] : 'n';
        let value = '';
        if (type === 's') {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          const idx = vm ? parseInt(vm[1], 10) : NaN;
          value = Number.isInteger(idx) ? (sharedStrings[idx] || '') : '';
        } else if (type === 'inlineStr') {
          value = joinTNodes(body);
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
          value = vm ? decodeXmlEntities(vm[1]) : '';
        }
        if (value !== '') cells.push(value);
      }
      if (cells.length) {
        const line = cells.join('\t');
        out.push(line);
        totalLen += line.length;
      }
    }
    out.push('');
  });
  return out.join('\n').trim().slice(0, OFFICE_MAX_OUTPUT_CHARS);
}

module.exports = { extractDocxText, extractXlsxText };
