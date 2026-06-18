require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { loadConfig } = require('./config');
const { callAI } = require('./aiClient');
const { buildArticlePrompt, buildSlug } = require('./articlePrompt');
const { validateArticle } = require('./validateArticle');
const { runJudge, runRewrite, runTargetedRewrite } = require('./articleJudge');
const { runResearch } = require('./articleResearch');
const { extractJsonObject } = require('./jsonUtils');
const { validateLocal, deterministicCleanup } = require('./localValidators');
const { MODELS, resolveModel, modelLabel } = require('./models');
const { publishArticle, parseTargets } = require('./publishers/publisherRegistry');

// --- CLI args -----------------------------------------------------------------

const args = process.argv.slice(2);

// --from-file=inputs/foo.json — run against a local JSON row, skip all source reads/writes
const fromFileArg = args.find((a) => a.startsWith('--from-file='));
const FROM_FILE = fromFileArg ? fromFileArg.split('=').slice(1).join('=') : null;
const LOCAL_MODE = Boolean(FROM_FILE);

const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

const rowIdArg = args.find((a) => a.startsWith('--row-id=') || a.startsWith('--id='));
const targetRowId = rowIdArg ? parseInt(rowIdArg.split('=')[1], 10) : null;

// --source=nocodb|csv|json  (overrides config source.type)
const sourceArg = args.find((a) => a.startsWith('--source='));
const SOURCE_TYPE_ARG = sourceArg ? sourceArg.split('=')[1].toLowerCase() : null;

const DRY_RUN = args.includes('--dry-run');

// --output=markdown,github,framer  (comma-separated; "none" or "dry-run" = no publishing)
const outputArg = args.find((a) => a.startsWith('--output='));
const OUTPUT_ARG = outputArg ? outputArg.split('=').slice(1).join('=') : undefined;

if (!LOCAL_MODE) {
  if (targetRowId !== null && (isNaN(targetRowId) || targetRowId < 1)) {
    console.error('Usage: node index.js --row-id=<positive integer>');
    process.exit(1);
  }
  if (targetRowId === null && (isNaN(limit) || limit < 1)) {
    console.error('Usage: node index.js --limit=<number>  |  node index.js --row-id=<id>  |  node index.js --from-file=inputs/X.json');
    process.exit(1);
  }
}

const modeArg = args.find((a) => a.startsWith('--mode='));
const MODE = (modeArg ? modeArg.split('=')[1] : 'production').toLowerCase();
if (!['production', 'debug'].includes(MODE)) {
  console.error('Usage: --mode=production | --mode=debug');
  process.exit(1);
}

const writerModelArg  = args.find((a) => a.startsWith('--writer-model='));
const judgeModelArg   = args.find((a) => a.startsWith('--judge-model='));
const rewriteModelArg = args.find((a) => a.startsWith('--rewrite-model='));

const config = loadConfig();
const genConfig = config.generation || {};

let WRITER_MODEL, JUDGE_MODEL, REWRITE_MODEL;
try {
  WRITER_MODEL  = resolveModel(writerModelArg  ? writerModelArg.split('=')[1]  : (genConfig.writerModel  || 'opus'));
  JUDGE_MODEL   = resolveModel(judgeModelArg   ? judgeModelArg.split('=')[1]   : (genConfig.judgeModel   || 'sonnet'));
  REWRITE_MODEL = resolveModel(rewriteModelArg ? rewriteModelArg.split('=')[1] : (genConfig.rewriteModel || 'opus'));
} catch (err) {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}
const TARGETED_REWRITE_MODEL = MODELS.sonnet;

const QUIET = args.includes('--quiet');
const SHOW_ARTICLE = args.includes('--show-article');

const SOURCE_TYPE = SOURCE_TYPE_ARG || config.source?.type || 'nocodb';

if (DRY_RUN) console.log('[mode] DRY RUN — no writes to source or external publishers');
const _logTargets = parseTargets(OUTPUT_ARG, config);
console.log(`[mode] ${MODE}${QUIET ? ' | quiet' : ''} | source: ${SOURCE_TYPE} | output: ${_logTargets.length ? _logTargets.join(',') : 'none'}`);
console.log(`[models] writer: ${modelLabel(WRITER_MODEL)} | judge: ${modelLabel(JUDGE_MODEL)} | rewrite: ${modelLabel(REWRITE_MODEL)}`);

// --- Dirs ---------------------------------------------------------------------

const INPUTS_DIR  = path.join(__dirname, 'inputs');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
fs.mkdirSync(INPUTS_DIR,  { recursive: true });
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// --- Source adapter -----------------------------------------------------------

// Returns { fetchNotStarted, fetchById, updateRow } for the active source.
// CSV and JSON sources are read-only; updateRow is a no-op.
function getSourceAdapter() {
  switch (SOURCE_TYPE) {
    case 'csv': {
      const { loadNotStartedCSVRows } = require('./sources/csvSource');
      const csvPath = process.env.INPUT_CSV_PATH || config.source?.csvPath || 'inputs/articles.csv';
      return {
        fetchNotStarted: (n) => Promise.resolve(loadNotStartedCSVRows(csvPath, n)),
        fetchById: async (id) => {
          const { loadCSVRows } = require('./sources/csvSource');
          const all = loadCSVRows(csvPath);
          return all.find((r) => String(r.Id) === String(id)) || null;
        },
        updateRow: async () => {},
        readonly: true,
      };
    }

    case 'json': {
      const { loadNotStartedJSONRows } = require('./sources/jsonSource');
      const jsonPath = process.env.INPUT_JSON_PATH || config.source?.jsonPath || 'inputs/articles.json';
      return {
        fetchNotStarted: (n) => Promise.resolve(loadNotStartedJSONRows(jsonPath, n)),
        fetchById: async (id) => {
          const { loadJSONRows } = require('./sources/jsonSource');
          const all = loadJSONRows(jsonPath);
          return all.find((r) => String(r.Id) === String(id)) || null;
        },
        updateRow: async () => {},
        readonly: true,
      };
    }

    case 'google-sheets': {
      const { loadNotStartedGoogleSheetsRows, loadGoogleSheetsRows } = require('./sources/googleSheetsSource');
      return {
        fetchNotStarted: (n) => loadNotStartedGoogleSheetsRows(n),
        fetchById: async (id) => {
          const all = await loadGoogleSheetsRows();
          return all.find((r) => String(r.Id) === String(id)) || null;
        },
        updateRow: async () => {},
        readonly: true,
      };
    }

    default: {
      // nocodb
      const { fetchNotStartedRows, fetchRowById, updateRow } = require('./sources/nocodbSource');
      return {
        fetchNotStarted: fetchNotStartedRows,
        fetchById: fetchRowById,
        updateRow,
        readonly: false,
      };
    }
  }
}

// --- Helpers ------------------------------------------------------------------

async function safeUpdateRow(adapter, id, fields) {
  if (LOCAL_MODE || adapter.readonly || DRY_RUN) return;
  try {
    await adapter.updateRow(id, fields);
  } catch (err) {
    const body = err.response?.data;
    const detail = body ? ` — ${JSON.stringify(body)}` : '';
    console.warn(`  [warn] Source update failed (row ${id}): ${err.message}${detail}`);
  }
}

function rowId(row) { return row.Id ?? row.id; }

function buildFilename(row) { return `${rowId(row)}_${buildSlug(row)}.json`; }

function saveInputFile(row) {
  const filename = buildFilename(row);
  const filepath = path.join(INPUTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(row, null, 2));
  console.log(`  [input]  Saved → inputs/${filename}`);
  return filepath;
}

function saveOutputTemplate(row, inputFilename) {
  const filename  = buildFilename(row);
  const filepath  = path.join(OUTPUTS_DIR, filename);
  const articleType = row.article_type || 'article';
  const template = {
    _meta: {
      source_row_id: rowId(row),
      article_title_source: row.article_title || '',
      article_type: articleType,
      competitor_name: row.competitor_name || '',
      input_file: `inputs/${inputFilename}`,
    },
    article_title: row.article_title || '',
    article_slug: buildSlug(row),
    meta_title: '', meta_description: '', excerpt: '',
    article_body_markdown: '',
    faq_json: [],
    schema_jsonld: {},
    canonical_url: '',
    internal_links: [],
    quality_score: 0,
    claude_prompt_version: `v1-${articleType}`,
    generated_at: '',
  };
  fs.writeFileSync(filepath, JSON.stringify(template, null, 2));
  console.log(`  [output] Template → outputs/${filename}`);
  return filepath;
}

// callAI is async — all callers must await it
const runClaude = (prompt, model) => callAI(prompt, model);

function logTransition(slug, status, note = '') {
  const ts = new Date().toISOString().slice(11, 19);
  const n = note ? ` — ${note}` : '';
  console.log(`  [${slug}] → ${status}${n} (${ts})`);
}

function logJudgeScores(slug, j, label = 'judge') {
  const s = j.scores || {};
  const line = Object.entries(s).map(([k, v]) => `${k}=${v}`).concat([`overall=${j.overall_score}`]).join(' ');
  console.log(`  [${slug}] ${label} scores: ${line}`);
  console.log(`  [${slug}] decision: ${j.decision} | publish_ready: ${j.publish_ready}`);
  const blocking = j.blocking_issues || [];
  if (blocking.length > 0) console.log(`  [${slug}] blocking issues: ${blocking.join(' | ')}`);
  if (QUIET) return;
  const recommended = j.recommended_fixes || [];
  if (recommended.length > 0) console.log(`  [${slug}] recommended fixes: ${recommended.join(' | ')}`);
}

function majorScoreFailures(judge, localHardFailures, hardAllMechanical) {
  if (!judge || judge.decision !== 'rewrite') return [];
  const s = judge.scores || {};
  const lowScores = Object.entries(s).filter(([, v]) => (v ?? 10) < 5).map(([k, v]) => `${k}<5(${v})`);
  if (lowScores.length > 0) return lowScores;
  if (localHardFailures.length > 0 && hardAllMechanical) return [];
  return judge.blocking_issues?.length ? judge.blocking_issues : ['decision=rewrite'];
}

function readyAfterMechanicalFix(judge, localAfter) {
  if (!localAfter.hardOk) return false;
  if (judge?.publish_ready) return true;
  const dims = Object.values(judge?.scores || {});
  return dims.length > 0 && dims.every((v) => (v ?? 0) >= 7) && (judge?.overall_score ?? 0) >= 8;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const JUDGE_RETRY_DELAYS_MS = [15_000, 25_000];
async function runJudgeWithRetry(article, sourceRow, competitorKey, mode, model, calls, counterKey, label) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const judge = await runJudge(article, sourceRow, competitorKey, mode, model);
      calls[counterKey]++;
      return judge;
    } catch (err) {
      calls[counterKey]++;
      if (attempt < maxRetries) {
        const delayMs = JUDGE_RETRY_DELAYS_MS[attempt];
        console.warn(`  [warn] ${label} parse failed, retrying ${attempt + 1}/${maxRetries} in ${delayMs / 1000}s… (${err.message.slice(0, 120)})`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
}

function logCalls(slug, c, m) {
  const total = c.research + c.writer + c.judge + c.rewrite + c.secondJudge;
  const yn = (n, model) => (n > 0 ? `yes(${n},${model})` : 'no');
  console.log(`  [${slug}] AI calls: ${total} — research:${yn(c.research, m.judge)} writer:${yn(c.writer, m.writer)} judge:${yn(c.judge, m.judge)} rewrite:${yn(c.rewrite, m.rewrite)} 2nd-judge:${yn(c.secondJudge, m.judge)}`);
}

// --- Pipeline core ------------------------------------------------------------

async function processRow(row, adapter) {
  const calls = { research: 0, writer: 0, judge: 0, rewrite: 0, secondJudge: 0 };
  const callModels = {
    writer:  modelLabel(WRITER_MODEL),
    judge:   modelLabel(JUDGE_MODEL),
    rewrite: modelLabel(REWRITE_MODEL),
  };
  const id = rowId(row);
  const slug = buildSlug(row);
  const articleType = row.article_type || 'comparison';
  const competitorKey = row.competitor_name || slug;
  const validationConfig = config.validation || {};

  console.log(`\n── Processing row ${id}: "${row.article_title || slug}" [${articleType}]${row.competitor_name ? ` (vs. ${row.competitor_name})` : ''}`);

  const inputPath = saveInputFile(row);
  const inputFilename = path.basename(inputPath);
  const outputPath = saveOutputTemplate(row, inputFilename);
  const outputFilename = path.basename(outputPath);

  // ── Research pass (comparison articles or when research fields missing) ──────

  const enableResearch = genConfig.enableResearch !== false;
  const needsResearch = enableResearch && (
    !String(row.competitor_strengths || '').trim() ||
    !String(row.product_differentiators || row.next_differentiators || '').trim()
  );

  if (needsResearch && row.competitor_name) {
    await safeUpdateRow(adapter, id, { article_status: 'researching' });
    logTransition(slug, 'researching');
    console.log(`  [research] Calling AI (${modelLabel(JUDGE_MODEL)})…`);
    try {
      const research = await runResearch(row, JUDGE_MODEL);
      calls.research++;
      // Merge research fields — normalize product_differentiators
      row = { ...row, ...research };
      if (row.product_differentiators && !row.next_differentiators) {
        row.next_differentiators = row.product_differentiators;
      }
      console.log(`  [research] Done`);
    } catch (err) {
      console.error(`  [error] Research failed: ${err.message}`);
      await safeUpdateRow(adapter, id, { article_status: 'failed', error_message: `Research: ${err.message}` });
      return;
    }
  }

  // ── Writer pass ─────────────────────────────────────────────────────────────

  await safeUpdateRow(adapter, id, { article_status: 'generating' });
  logTransition(slug, 'generating');
  console.log(`  [writer] Calling AI (${modelLabel(WRITER_MODEL)})…`);

  let firstArticle;
  try {
    const prompt = buildArticlePrompt(row, MODE);
    const raw = await runClaude(prompt, WRITER_MODEL);
    calls.writer++;
    try {
      firstArticle = extractJsonObject(raw);
    } catch (_) {
      console.warn(`  [warn] Writer response not JSON — retrying with repair prompt`);
      const repairRaw = await runClaude(
        `Return ONLY the valid JSON object. No explanation, no markdown fences, no preamble.\n\n${raw}`,
        WRITER_MODEL,
      );
      calls.writer++;
      firstArticle = extractJsonObject(repairRaw);
    }
  } catch (err) {
    console.error(`  [error] Writer failed: ${err.message}`);
    await safeUpdateRow(adapter, id, { article_status: 'failed', error_message: `Writer: ${err.message}` });
    return;
  }

  // Ensure article_type is stored on the output
  if (!firstArticle.article_type) firstArticle.article_type = articleType;

  if (SHOW_ARTICLE) {
    console.log('\n── First article body (first 800 chars):');
    console.log((firstArticle.article_body_markdown || '').slice(0, 800));
    console.log('──');
  }

  const runPath = outputPath.replace('.json', '.run.json');
  fs.writeFileSync(runPath, JSON.stringify({ draft: firstArticle }, null, 2));

  // ── Local validation + deterministic cleanup ─────────────────────────────────

  const { article: cleanedArticle, changed: cleanupChanged, notes: cleanupNotes } = deterministicCleanup(firstArticle);
  if (cleanupChanged) {
    console.log(`  [cleanup] Applied ${cleanupNotes.length} fix(es): ${cleanupNotes.join('; ')}`);
    firstArticle = cleanedArticle;
  }

  const localBefore = validateLocal(firstArticle, articleType, validationConfig);
  if (!localBefore.hardOk) {
    console.log(`  [local] Hard failures: ${localBefore.hardFailures.map((c) => c.id).join(', ')}`);
  }

  const zod = validateArticle(firstArticle);
  if (!zod.success) {
    console.warn(`  [warn] Schema validation errors: ${zod.errors.join(' | ')}`);
  }

  // ── Judge pass ───────────────────────────────────────────────────────────────

  const enableJudge = genConfig.enableJudge !== false;
  let judge;

  if (enableJudge) {
    console.log(`  [judge] Calling AI (${modelLabel(JUDGE_MODEL)})…`);
    try {
      judge = await runJudgeWithRetry(firstArticle, row, competitorKey, MODE, JUDGE_MODEL, calls, 'judge', 'judge');
    } catch (err) {
      console.error(`  [error] Judge failed: ${err.message}`);
      await safeUpdateRow(adapter, id, { article_status: 'failed', error_message: `Judge: ${err.message}` });
      return;
    }
    logJudgeScores(slug, judge);
  } else {
    console.log(`  [judge] Skipped (enableJudge=false in config)`);
    judge = { decision: 'needs_revision', publish_ready: false, overall_score: 0, scores: {}, blocking_issues: [], recommended_fixes: [] };
  }

  // ── Decide: publish / needs_revision / rewrite ───────────────────────────────

  const majorFails = majorScoreFailures(judge, localBefore.hardFailures, localBefore.hardAllMechanical);

  if (majorFails.length > 0) {
    console.log(`  [rewrite] Major failures: ${majorFails.join(', ')} — triggering full rewrite`);
    logTransition(slug, 'rewriting');

    let rewritten;
    try {
      rewritten = await runRewrite(row, firstArticle, judge, competitorKey, MODE, REWRITE_MODEL);
      calls.rewrite++;
    } catch (err) {
      console.error(`  [error] Rewrite failed: ${err.message}`);
      await safeUpdateRow(adapter, id, { article_status: 'failed', error_message: `Rewrite: ${err.message}` });
      return;
    }

    rewritten.rewrite_triggered = true;
    const { article: cleanedRewrite, changed: rChanged, notes: rNotes } = deterministicCleanup(rewritten);
    if (rChanged) console.log(`  [cleanup] Post-rewrite fixes: ${rNotes.join('; ')}`);
    firstArticle = cleanedRewrite;

    if (enableJudge) {
      console.log(`  [judge2] Calling AI (${modelLabel(JUDGE_MODEL)})…`);
      try {
        judge = await runJudgeWithRetry(firstArticle, row, competitorKey, MODE, JUDGE_MODEL, calls, 'secondJudge', 'judge2');
      } catch (err) {
        console.error(`  [warn] Second judge failed: ${err.message} — using rewritten article as-is`);
      }
      if (judge) logJudgeScores(slug, judge, 'judge2');
    }

  } else if (judge.decision === 'rewrite' && localBefore.hardAllMechanical) {
    const issues = localBefore.hardFailures.map((c) => c.detail).filter(Boolean);
    console.log(`  [targeted-rewrite] Mechanical fixes: ${issues.join(' | ')}`);
    try {
      const targeted = await runTargetedRewrite(firstArticle, issues, TARGETED_REWRITE_MODEL);
      calls.rewrite++;
      targeted.rewrite_triggered = true;
      const { article: cleanedTargeted } = deterministicCleanup(targeted);
      firstArticle = cleanedTargeted;

      const localAfter = validateLocal(firstArticle, articleType, validationConfig);
      if (readyAfterMechanicalFix(judge, localAfter)) {
        judge = { ...judge, decision: 'publish', publish_ready: true };
        console.log(`  [targeted-rewrite] All mechanical issues resolved — marking publish_ready`);
      }
    } catch (err) {
      console.warn(`  [warn] Targeted rewrite failed: ${err.message}`);
    }
  }

  // ── Save final article ────────────────────────────────────────────────────────

  const finalZod = validateArticle(firstArticle);
  const overallScore = judge?.overall_score ?? 0;
  const qualityScore = Math.max(1, Math.min(10, Math.round(overallScore)));
  const publishReady = judge?.publish_ready ?? false;

  const outputData = {
    _meta: {
      source_row_id: id,
      article_title_source: row.article_title || '',
      article_type: articleType,
      competitor_name: row.competitor_name || '',
      input_file: `inputs/${inputFilename}`,
    },
    ...firstArticle,
    quality_score: qualityScore,
  };
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`  [output] Saved → outputs/${outputFilename}`);

  if (!finalZod.success) {
    console.warn(`  [warn] Final schema errors: ${finalZod.errors.join(' | ')}`);
  }

  // ── Publish to output targets ─────────────────────────────────────────────────

  const targets = parseTargets(OUTPUT_ARG, config);
  if (targets.length > 0) {
    await publishArticle(outputData, { targets, config, dryRun: DRY_RUN });
  }

  // ── Source update (NocoDB only; CSV/JSON sources are read-only) ───────────────

  const finalStatus = publishReady ? 'ready_for_export' : 'needs_review';
  const sourceFields = {
    article_title: firstArticle.article_title,
    article_slug: firstArticle.article_slug,
    meta_title: firstArticle.meta_title,
    meta_description: firstArticle.meta_description,
    excerpt: firstArticle.excerpt,
    article_body_markdown: firstArticle.article_body_markdown,
    faq_json: JSON.stringify(firstArticle.faq_json),
    schema_jsonld: JSON.stringify(firstArticle.schema_jsonld),
    canonical_url: firstArticle.canonical_url,
    internal_links: JSON.stringify(firstArticle.internal_links || []),
    quality_score: qualityScore,
    claude_prompt_version: firstArticle.claude_prompt_version || `v1-${articleType}`,
    generated_at: firstArticle.generated_at || new Date().toISOString(),
    error_message: finalZod.success ? '' : finalZod.errors.join(' | '),
    article_status: finalStatus,
  };

  await safeUpdateRow(adapter, id, sourceFields);
  logTransition(slug, finalStatus, `score=${overallScore}`);
  logCalls(slug, calls, callModels);
}

// --- Main ---------------------------------------------------------------------

async function main() {
  const adapter = getSourceAdapter();
  let rows;

  if (LOCAL_MODE) {
    const resolved = path.isAbsolute(FROM_FILE) ? FROM_FILE : path.join(__dirname, FROM_FILE);
    console.log(`\n[local] Reading row from ${resolved}`);
    rows = [JSON.parse(fs.readFileSync(resolved, 'utf8'))];
    rows[0].Id = rows[0].Id ?? 0;
  } else if (targetRowId !== null) {
    console.log(`\n[target] Single-row mode: row ${targetRowId}`);
    const row = await adapter.fetchById(targetRowId);
    if (!row) { console.error(`[error] Row ${targetRowId} not found`); process.exit(1); }
    rows = [row];
  } else {
    console.log(`\n[fetch] Fetching up to ${limit} not_started row(s) from source: ${SOURCE_TYPE}…`);
    rows = await adapter.fetchNotStarted(limit);
    if (rows.length === 0) { console.log('[done] No not_started rows found.'); return; }
    console.log(`[fetch] Found ${rows.length} row(s)`);
  }

  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await processRow(row, adapter);
      processed++;
    } catch (err) {
      failed++;
      console.error(`\n[error] Row ${rowId(row)} failed unexpectedly: ${err.message}`);
      await safeUpdateRow(adapter, rowId(row), { article_status: 'failed', error_message: err.message });
    }
  }

  console.log(`\n[done] ${processed} processed, ${failed} failed`);
}

main().catch((err) => {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
});
