// Shared row <-> frontend-object mapping for `documents` (formerly
// js/documents.js's docFiles[] — see the comment above the `documents`
// table in db.js for why vault.js's other two sources aren't here too).

function documentToParams(d) {
  return {
    fundId: d.fundId || null,
    name: d.name,
    category: d.category || null,
    size: d.size || null,
    date: d.date || null,
    uploader: d.uploader || null,
    commentsJson: JSON.stringify(d.comments || []),
    documentUrl: d.documentUrl || null,
    archived: d.archived ? 1 : 0,
    archivedAt: d.archivedAt || null,
    archivedBy: d.archivedBy || null,
    historyJson: JSON.stringify(d.history || []),
  };
}

function rowToDocument(row) {
  return {
    // `documents.fund_id` is declared TEXT (unlike every other table's
    // `fund_id INTEGER`) — node:sqlite binds a JS number as SQLite REAL,
    // and TEXT column affinity then stores it as "1.0", not "1". Reading
    // it back through Number(...) normalizes that (old rows already
    // stored as "1.0" included) so `d.fundId === activeFundId` comparisons
    // client-side actually match instead of silently never matching.
    id: row.id, fundId: row.fund_id != null ? Number(row.fund_id) : null, name: row.name, category: row.category,
    size: row.size, date: row.date, uploader: row.uploader,
    comments: JSON.parse(row.comments_json || '[]'),
    documentUrl: row.document_url,
    archived: !!row.archived,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    history: JSON.parse(row.history_json || '[]'),
  };
}

const INSERT_SQL = `
  INSERT INTO documents
    (tenant_id, fund_id, name, category, size, date, uploader, comments_json,
     document_url, archived, archived_at, archived_by, history_json)
  VALUES
    (@tenantId, @fundId, @name, @category, @size, @date, @uploader, @commentsJson,
     @documentUrl, @archived, @archivedAt, @archivedBy, @historyJson)
`;

const UPDATE_SQL = `
  UPDATE documents SET
    fund_id=@fundId, name=@name, category=@category, size=@size, date=@date, uploader=@uploader,
    comments_json=@commentsJson, document_url=@documentUrl, archived=@archived,
    archived_at=@archivedAt, archived_by=@archivedBy, history_json=@historyJson
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { documentToParams, rowToDocument, INSERT_SQL, UPDATE_SQL };
