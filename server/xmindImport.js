// Parses a .xmind file (a ZIP archive; modern XMind — Zen/2020+ — stores
// its map as content.json, an array of "sheets" each with a rootTopic
// tree) into a plain tree the Sandbox "Импорт из XMind" routes and UI can
// work with. Deliberately does NOT support the old XMind 8 content.xml
// format — rejecting it with a clear error is safer than a half-correct
// parse of a format this was never tested against.
//
// This is read-only and offline: nothing here calls out to XMind, there
// is no live sync — see server/index.js's /api/sandbox/xmind/* routes for
// why (no third-party API for that exists) and docs/CHANGELOG for the
// real design conversation.
const AdmZip = require('adm-zip');

// Same reasoning as SANDBOX_ANALYZE_* limits elsewhere — a malicious or
// just-huge .xmind must fail fast and clearly rather than hang the
// request or exhaust memory. AdmZip reads the whole central directory
// into memory regardless, so the hard stop here is on what we then walk/
// extract, not on the raw file size (also capped, at upload time, by the
// caller via MAX_UPLOAD_BYTES-style checks).
const XMIND_MAX_TOPICS = 5000;
const XMIND_MAX_DEPTH = 50;

// Extension -> mime type for embedded resources (attachments a topic
// links to via href:"xap:resources/<hash>.<ext>") — intentionally the
// exact same allowlist as the server-folder import (server/index.js's
// LOCAL_FILE_EXTENSION_MIME), so "what file types Sandbox can attach"
// has one answer, not two slightly different ones.
const XMIND_RESOURCE_EXTENSION_MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

// XMind's own placeholder text for a topic added but never renamed/
// filled in ("Подтема 1", "Sub Topic 1", ...) — worth skipping on import
// rather than creating an empty-content task/project named "Подтема 6".
const PLACEHOLDER_TITLE_RE = /^(подтема|sub[\s-]?topic|central topic|главная тема)\s*\d*$/i;

function extOf(resourcePath) {
  const m = /\.[a-z0-9]+$/i.exec(resourcePath || '');
  return m ? m[0].toLowerCase() : '';
}

// Walks one topic's raw content.json shape into the flat-ish tree shape
// callers work with. Depth-first, iterative-safe via explicit recursion
// (XMind maps are shallow enough in practice — capped below regardless).
function normalizeTopic(raw, depth, counters) {
  counters.topics++;
  if (counters.topics > XMIND_MAX_TOPICS) {
    throw new Error(`Карта содержит больше ${XMIND_MAX_TOPICS} тем — слишком большая для импорта`);
  }
  if (depth > XMIND_MAX_DEPTH) {
    throw new Error(`Слишком глубокая вложенность (больше ${XMIND_MAX_DEPTH} уровней)`);
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const href = typeof raw.href === 'string' ? raw.href : null;
  let attachment = null;
  if (href && href.startsWith('xap:resources/')) {
    const resourcePath = href.slice('xap:'.length); // "resources/<hash>.<ext>"
    const ext = extOf(resourcePath);
    const mimeType = XMIND_RESOURCE_EXTENSION_MIME[ext];
    if (mimeType) attachment = { resourcePath, mimeType, name: title || resourcePath.split('/').pop() };
  }
  const rawChildren = (raw.children && raw.children.attached) || [];
  const node = {
    id: raw.id,
    title,
    depth,
    isPlaceholder: PLACEHOLDER_TITLE_RE.test(title),
    // An external (http/https) source link on an idea/task topic — kept
    // for the import to append as a citation, not treated as an attachment.
    sourceUrl: href && /^https?:\/\//i.test(href) ? href : null,
    attachment,
    children: rawChildren.map(c => normalizeTopic(c, depth + 1, counters)),
  };
  return node;
}

// buffer: the raw .xmind file bytes. Returns { sheets: [{ id, title, root }] }.
// Throws a clear, user-facing error (never a raw parser stack) for every
// rejection case — malformed zip, missing/legacy content, oversized map.
function parseXmindTree(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new Error('Не удалось открыть файл — это не похоже на настоящий .xmind (zip-архив)');
  }
  const contentEntry = zip.getEntry('content.json');
  if (!contentEntry) {
    throw new Error('Файл не содержит content.json — старый формат XMind 8 (content.xml) не поддерживается, пересохраните карту в текущей версии XMind');
  }
  let sheets;
  try {
    sheets = JSON.parse(zip.readAsText(contentEntry, 'utf8'));
  } catch (err) {
    throw new Error('content.json повреждён или не является валидным JSON');
  }
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('В карте не найдено ни одного листа');

  const result = [];
  for (const sheet of sheets) {
    if (!sheet.rootTopic) continue;
    const counters = { topics: 0 };
    result.push({ id: sheet.id, title: sheet.title || '(без названия)', root: normalizeTopic(sheet.rootTopic, 0, counters) });
  }
  if (!result.length) throw new Error('В карте не найдено ни одного листа с темами');
  return { sheets: result };
}

// Re-opens the same stored .xmind bytes to pull one embedded resource's
// raw bytes out by its zip path — called only for resourcePaths this
// module itself produced via parseXmindTree, never a caller-supplied
// string, so there is no path-traversal surface here (AdmZip resolves
// entries by exact name within its own archive, not the filesystem).
function extractResourceBytes(buffer, resourcePath) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(resourcePath);
  if (!entry) return null;
  return zip.readFile(entry);
}

module.exports = { parseXmindTree, extractResourceBytes, XMIND_MAX_TOPICS, XMIND_MAX_DEPTH };
