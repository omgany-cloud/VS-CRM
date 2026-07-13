// Small helper: extracts a top-level `let <name> = [ ... ];` array literal
// from one of the frontend's plain-<script> JS files (js/data.js etc.) so
// seed scripts can reuse the existing demo data instead of hand-retyping
// hundreds of lines. Safe here because we only ever point it at our own
// source files, never user input.
const fs = require('fs');

function extractArrayLiteral(filePath, varName) {
  const src = fs.readFileSync(filePath, 'utf8');
  const marker = `let ${varName} = [`;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${marker}" in ${filePath}`);
  const arrayStart = start + marker.length - 1; // position of the opening '['

  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`Could not find matching "]" for ${varName} in ${filePath}`);

  const literal = src.slice(arrayStart, end + 1);
  // eslint-disable-next-line no-eval
  return eval('(' + literal + ')');
}

module.exports = { extractArrayLiteral };
