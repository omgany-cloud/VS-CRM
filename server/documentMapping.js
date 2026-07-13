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
  };
}

function rowToDocument(row) {
  return {
    id: row.id, fundId: row.fund_id, name: row.name, category: row.category,
    size: row.size, date: row.date, uploader: row.uploader,
    comments: JSON.parse(row.comments_json || '[]'),
  };
}

const INSERT_SQL = `
  INSERT INTO documents (tenant_id, fund_id, name, category, size, date, uploader, comments_json)
  VALUES (@tenantId, @fundId, @name, @category, @size, @date, @uploader, @commentsJson)
`;

const UPDATE_SQL = `
  UPDATE documents SET
    fund_id=@fundId, name=@name, category=@category, size=@size, date=@date, uploader=@uploader, comments_json=@commentsJson
  WHERE id=@id AND tenant_id=@tenantId
`;

module.exports = { documentToParams, rowToDocument, INSERT_SQL, UPDATE_SQL };
