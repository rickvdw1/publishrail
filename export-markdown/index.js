#!/usr/bin/env node

require('dotenv').config();

const { resolveExportConfig } = require('./config');
const { getRowId } = require('./content');
const { writeMarkdownFile } = require('./files');
const { loadReadyRows } = require('./rows');

async function main() {
  const { outputDir } = resolveExportConfig();

  console.log('\n=== Article → Markdown Export ===');
  console.log(`Output dir: ${outputDir}`);
  console.log('');

  const rows = await loadReadyRows();
  if (rows.length === 0) {
    console.log('No rows found with article_status=ready_for_export.');
    return;
  }

  const written = rows.map((row) => writeMarkdownFile(outputDir, row));
  written.forEach((entry, index) => {
    const row = rows[index];
    const verb = entry.changed ? 'wrote' : 'unchanged';
    console.log(`[export] Row ${getRowId(row)} (${row.article_slug}) → ${verb} ${entry.relativePath}`);
  });

  const changedCount = written.filter((entry) => entry.changed).length;
  console.log(`\nExport complete. ${written.length} file(s), ${changedCount} changed.\n`);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
