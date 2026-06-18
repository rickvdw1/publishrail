// Publisher registry — the single call site for all output targets.
//
// Usage:
//   const { publishArticle, parseTargets } = require('./publishers/publisherRegistry');
//   const results = await publishArticle(article, { targets: ['markdown', 'github'], config, dryRun: true });

const VALID_TARGETS = new Set(['markdown', 'github', 'framer']);

// parseTargets('markdown,github') → ['markdown', 'github']
// parseTargets('none') or parseTargets('dry-run') → []
// parseTargets(undefined) → reads from config.output.targets, falls back to ['markdown']
function parseTargets(raw, config) {
  if (raw !== undefined) {
    if (raw === 'none' || raw === 'dry-run') return [];
    return raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => {
        if (!VALID_TARGETS.has(t)) {
          console.warn(`[publish] Unknown output target "${t}" — ignored. Valid: ${[...VALID_TARGETS].join(', ')}`);
          return false;
        }
        return true;
      });
  }

  // Fall back to config
  const cfgTargets = config?.output?.targets;
  if (Array.isArray(cfgTargets) && cfgTargets.length > 0) {
    return cfgTargets.filter((t) => VALID_TARGETS.has(t));
  }

  return ['markdown']; // safe default
}

// Validate the article before publishing.
// Throws if required fields are missing; logs warnings for soft issues.
function prePublishValidate(article) {
  const required = ['article_title', 'article_slug', 'article_body_markdown'];
  const missing = required.filter((f) => !article[f] || !String(article[f]).trim());
  if (missing.length > 0) {
    throw new Error(`Article cannot be published — missing required fields: ${missing.join(', ')}`);
  }

  if (!article.meta_title) console.warn('[publish] Warning: meta_title is missing');
  if (!article.meta_description) console.warn('[publish] Warning: meta_description is missing');
}

// publishArticle sends an article to one or more output targets.
//
// @param {object} article — the generated article object from the pipeline
// @param {object} opts
//   @param {string[]} opts.targets — list of output targets
//   @param {object}   opts.config  — loaded app config
//   @param {boolean}  opts.dryRun  — if true, all publishers run in dry-run mode
//
// @returns {Promise<PublishResult[]>}
//   PublishResult: { target, ok, message, url?, path?, dryRun }
async function publishArticle(article, { targets, config, dryRun = false }) {
  if (!targets || targets.length === 0) {
    if (dryRun) {
      console.log('[publish] Dry run — no output targets selected; article saved to outputs/ only');
    } else {
      console.log('[publish] No output targets — article saved to outputs/ only');
    }
    return [];
  }

  prePublishValidate(article);

  const results = [];

  for (const target of targets) {
    const label = `[publish:${target}]`;
    try {
      let result;
      if (target === 'markdown') {
        const { publish } = require('./markdownPublisher');
        result = await publish(article, config, { dryRun });
      } else if (target === 'github') {
        const { publish } = require('./githubPublisher');
        result = await publish(article, config, { dryRun });
      } else if (target === 'framer') {
        const { publish } = require('./framerPublisher');
        result = await publish(article, config, { dryRun });
      } else {
        result = { ok: false, message: `Unknown target: ${target}` };
      }
      results.push({ target, dryRun, ...result });
      const icon = result.ok ? '✓' : '✗';
      const mode = dryRun ? ' [dry run]' : '';
      console.log(`${label} ${icon} ${result.message}${mode}`);
    } catch (err) {
      results.push({ target, ok: false, dryRun, message: err.message });
      console.error(`${label} ✗ ${err.message}`);
    }
  }

  return results;
}

module.exports = { publishArticle, parseTargets, VALID_TARGETS };
