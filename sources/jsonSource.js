const fs = require('fs');
const path = require('path');

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function loadJSONRows(filePath) {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`JSON file not found: ${resolved}`);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse JSON file at ${resolved}: ${err.message}`);
  }

  // Accept either an array of rows or an object with a top-level "rows" key
  const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : null);
  if (!rows) {
    throw new Error('JSON file must contain an array of rows, or an object with a "rows" array');
  }

  const normalized = rows.map((row, index) => ({
    ...row,
    Id: row.Id ?? row.id ?? index + 1,
    article_status: row.article_status || 'not_started',
  }));

  console.log(`[source:json] Loaded ${normalized.length} row(s) from ${resolved}`);
  return normalized;
}

function loadNotStartedJSONRows(filePath, limit = 10) {
  const all = loadJSONRows(filePath);
  return all
    .filter((r) => !r.article_status || r.article_status === 'not_started')
    .slice(0, limit);
}

module.exports = { loadJSONRows, loadNotStartedJSONRows };
