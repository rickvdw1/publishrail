const fs = require('fs');
const path = require('path');

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function loadCSVRows(filePath) {
  const resolved = resolvePath(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`CSV file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || (values.length === 1 && !values[0])) continue;

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    row.article_status = row.article_status || 'not_started';
    row.Id = row.Id ? parseInt(row.Id, 10) : i;

    rows.push(row);
  }

  console.log(`[source:csv] Loaded ${rows.length} row(s) from ${resolved}`);
  return rows;
}

function loadNotStartedCSVRows(filePath, limit = 10) {
  const all = loadCSVRows(filePath);
  return all
    .filter((r) => !r.article_status || r.article_status === 'not_started')
    .slice(0, limit);
}

module.exports = { loadCSVRows, loadNotStartedCSVRows };
