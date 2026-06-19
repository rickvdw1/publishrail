#!/usr/bin/env node
// Creates all required columns in the PublishRail NocoDB table.
// Run once: node setup-nocodb-table.js
// Safe to re-run — skips columns that already exist.

require('dotenv').config();
const axios = require('axios');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

function resolveApiBase() {
  const raw = process.env.NOCODB_API_URL || process.env.NOCODB_BASE_URL;
  if (!raw) throw new Error('NOCODB_BASE_URL is not set in .env');
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    throw new Error(`Cannot parse NOCODB_BASE_URL: "${raw}"`);
  }
}

function getTableId() {
  const id = process.env.NOCODB_TABLE_ID;
  if (!id) throw new Error('NOCODB_TABLE_ID is not set in .env');
  return id;
}

function makeClient(base) {
  return axios.create({
    baseURL: base,
    headers: {
      'xc-token': process.env.NOCODB_API_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
    httpAgent,
    httpsAgent,
  });
}

// Columns to create. Order matters — NocoDB appends them in order.
// uidt values: SingleLineText, LongText, Number, Checkbox, DateTime
const COLUMNS = [
  // --- Input fields (filled by user before running pipeline) ---
  { title: 'article_title',            uidt: 'SingleLineText' },
  { title: 'article_slug',             uidt: 'SingleLineText' },
  { title: 'article_type',             uidt: 'SingleLineText' }, // comparison, blog_post, landing_page, etc.
  { title: 'description',              uidt: 'LongText' },       // editor notes / brief
  { title: 'article_status',           uidt: 'SingleLineText' },

  // --- Comparison article fields (optional for other article types) ---
  { title: 'competitor_name',          uidt: 'SingleLineText' },
  { title: 'competitor_category',      uidt: 'SingleLineText' },
  { title: 'comparison_angle',         uidt: 'SingleLineText' },
  { title: 'competitor_strengths',     uidt: 'LongText' },
  { title: 'competitor_limitations',   uidt: 'LongText' },
  { title: 'product_differentiators',  uidt: 'LongText' },
  { title: 'complementary_positioning', uidt: 'LongText' },

  // --- General article fields ---
  { title: 'primary_keyword',          uidt: 'SingleLineText' },
  { title: 'secondary_keywords',       uidt: 'LongText' },
  { title: 'target_personas',          uidt: 'LongText' },

  // --- Output fields (filled by pipeline) ---
  { title: 'meta_title',               uidt: 'SingleLineText' },
  { title: 'meta_description',         uidt: 'LongText' },
  { title: 'excerpt',                  uidt: 'LongText' },
  { title: 'canonical_url',            uidt: 'SingleLineText' },
  { title: 'article_body_markdown',    uidt: 'LongText' },
  { title: 'faq_json',                 uidt: 'LongText' },
  { title: 'schema_jsonld',            uidt: 'LongText' },
  { title: 'internal_links',           uidt: 'LongText' },
  { title: 'quality_score',            uidt: 'Number' },
  { title: 'claude_prompt_version',    uidt: 'SingleLineText' },
  { title: 'generated_at',             uidt: 'SingleLineText' },
  { title: 'error_message',            uidt: 'LongText' },
];

async function fetchExistingColumns(client, tableId) {
  try {
    const res = await client.get(`/api/v1/db/meta/tables/${tableId}`);
    return (res.data?.columns ?? []).map((f) => f.title);
  } catch {
    console.warn('[warn] Could not fetch existing columns — will attempt to create all.');
    return [];
  }
}

async function createColumn(client, tableId, col) {
  // Try v2 meta endpoint first, fall back to v1
  try {
    await client.post(`/api/v2/meta/tables/${tableId}/fields`, col);
    return 'v2';
  } catch {
    await client.post(`/api/v1/db/meta/tables/${tableId}/columns`, col);
    return 'v1';
  }
}

async function main() {
  const base = resolveApiBase();
  const tableId = getTableId();
  const client = makeClient(base);

  console.log(`\n=== PublishRail — NocoDB Table Setup ===`);
  console.log(`Base: ${base}`);
  console.log(`Table: ${tableId}\n`);

  const existing = await fetchExistingColumns(client, tableId);
  if (existing.length > 0) {
    console.log(`Existing columns (${existing.length}): ${existing.join(', ')}\n`);
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const col of COLUMNS) {
    if (existing.includes(col.title)) {
      console.log(`[skip]   ${col.title} (already exists)`);
      skipped++;
      continue;
    }
    try {
      const via = await createColumn(client, tableId, col);
      console.log(`[create] ${col.title} (${col.uidt}) via ${via}`);
      created++;
    } catch (err) {
      const detail = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
      console.error(`[error]  ${col.title}: ${detail}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${created} created, ${skipped} skipped, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
