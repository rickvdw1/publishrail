require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { updateRow } = require('./sources/nocodbSource');
const { validateArticle } = require('./validateArticle');

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith('--file='));
const filePath = fileArg ? fileArg.split('=').slice(1).join('=') : null;

if (!filePath) {
  console.error('Usage: node syncOutputToNocodb.js --file=outputs/<filename>.json');
  process.exit(1);
}

async function main() {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, filePath);

  console.log(`\n=== Sync Article Output → NocoDB ===`);
  console.log(`File: ${resolvedPath}\n`);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`[error] File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    console.error(`[error] Could not parse JSON: ${err.message}`);
    process.exit(1);
  }

  const meta = raw._meta;
  // Support both source_row_id (new) and nocodb_row_id (legacy)
  const rowId = meta?.source_row_id ?? meta?.nocodb_row_id;
  if (!meta || !rowId) {
    console.error('[error] Missing _meta.source_row_id (or legacy _meta.nocodb_row_id) in output file.');
    process.exit(1);
  }
  console.log(`[sync]  NocoDB row ID: ${rowId}`);

  const { _meta, ...articleFields } = raw;

  const validation = validateArticle(articleFields);
  if (!validation.success) {
    console.error('[error] Validation failed:');
    validation.errors.forEach((e) => console.error(`  - ${e}`));
    try {
      await updateRow(rowId, {
        article_status: 'failed',
        error_message: `Validation errors: ${validation.errors.join(' | ')}`,
      });
      console.log(`[nocodb] Row ${rowId} → failed`);
    } catch (err) {
      console.error(`[error] Could not update NocoDB: ${err.message}`);
    }
    process.exit(1);
  }

  console.log('[validate] Passed validation');

  const { quality_score: _qualityScore, ...syncFields } = validation.data;
  try {
    await updateRow(rowId, {
      ...syncFields,
      article_status: 'ready_for_export',
      generated_at: syncFields.generated_at || new Date().toISOString(),
    });
    console.log(`[nocodb] Row ${rowId} → ready_for_export`);
  } catch (err) {
    console.error(`[error] NocoDB sync failed: ${err.message}`);
    if (err.response) {
      console.error(`        HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    process.exit(1);
  }

  console.log('\n=== Sync complete ===\n');
}

main();
