#!/usr/bin/env node
// Syncs a locally-generated article (produced with --from-file) into NocoDB.
// Creates the input row if it doesn't already exist, then patches all output fields.
//
// Usage:
//   node sync-local-article.js --input=inputs/<file>.json --output=outputs/<file>.json

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { createRow, updateRow } = require('./sources/nocodbSource');
const { validateArticle } = require('./validateArticle');

// Fields copied from the input row into the NocoDB source row.
// Covers both comparison articles and other article types.
const INPUT_FIELDS = [
  'article_title', 'article_slug', 'article_type',
  'description', 'article_status',
  // Comparison fields (optional)
  'competitor_name', 'competitor_category', 'comparison_angle',
  'competitor_strengths', 'competitor_limitations',
  'product_differentiators', 'complementary_positioning',
  // General fields
  'primary_keyword', 'secondary_keywords', 'target_personas',
];

const args = process.argv.slice(2);
const inputArg = args.find((a) => a.startsWith('--input='));
const outputArg = args.find((a) => a.startsWith('--output='));

if (!inputArg || !outputArg) {
  console.error('Usage: node sync-local-article.js --input=inputs/<file>.json --output=outputs/<file>.json');
  process.exit(1);
}

function resolve(p) {
  return path.isAbsolute(p) ? p : path.join(__dirname, p);
}

async function main() {
  const inputPath = resolve(inputArg.split('=').slice(1).join('='));
  const outputPath = resolve(outputArg.split('=').slice(1).join('='));

  console.log('\n=== Sync Local Article → NocoDB ===');
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}\n`);

  const inputRow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const outputRaw = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const { _meta, ...articleFields } = outputRaw;

  // Step 1: validate article output
  const validation = validateArticle(articleFields);
  if (!validation.success) {
    console.error('[error] Validation failed:');
    validation.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('[validate] Passed validation');

  // Step 2: create the input row in NocoDB
  const inputPayload = {};
  for (const f of INPUT_FIELDS) {
    if (inputRow[f] != null) inputPayload[f] = inputRow[f];
  }
  inputPayload.article_status = 'in_progress';

  const rowId = await createRow(inputPayload);

  // Step 3: patch output fields onto the new row
  await updateRow(rowId, {
    ...validation.data,
    article_status: 'ready_for_export',
    generated_at: validation.data.generated_at || new Date().toISOString(),
  });
  console.log(`[nocodb] Row ${rowId} → ready_for_export`);

  // Step 4: stamp the NocoDB row ID into the output JSON so future syncs work
  outputRaw._meta = { ...(_meta || {}), source_row_id: rowId };
  fs.writeFileSync(outputPath, JSON.stringify(outputRaw, null, 2));
  console.log(`[file]   Updated _meta.source_row_id = ${rowId} in ${path.basename(outputPath)}`);

  console.log('\n=== Sync complete ===\n');
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
