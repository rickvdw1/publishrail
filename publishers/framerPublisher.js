// Framer CMS publisher.
//
// Publishes articles to a Framer CMS collection via the Framer API.
// Disabled by default. Enable via config.output.framer.enabled = true.
//
// Modes:
//   single-body    (default) — send full cleaned body to one configured field
//   section-mapped           — split article by H2 sections; send each to a named Framer field
//
// Required env vars (when enabled):
//   FRAMER_TOKEN=          # Framer API token
//   FRAMER_COLLECTION_ID=  # Collection ID from Framer CMS settings
//
// Framer items are created as published entries. Review in the Framer
// dashboard before pointing live traffic at the collection.

const { loadConfig } = require('../config');
const { cleanMarkdownBody } = require('./markdownPublisher');
const { parseMarkdownSections, findSection } = require('./markdownSections');

function getFramerConfig(config) {
  const root = config || loadConfig();
  const cfg = root.output?.framer
    || root.publishing?.framer    // legacy key — still supported
    || {};

  return {
    enabled:              cfg.enabled === true,
    dryRunDefault:        cfg.dryRunDefault !== false,
    tokenEnv:             cfg.tokenEnv || cfg.apiTokenEnv || 'FRAMER_TOKEN',
    collectionIdEnv:      cfg.collectionIdEnv || 'FRAMER_COLLECTION_ID',
    token:                process.env[cfg.tokenEnv || cfg.apiTokenEnv || 'FRAMER_TOKEN'],
    collectionId:         process.env[cfg.collectionIdEnv || 'FRAMER_COLLECTION_ID'],
    // Publishing mode
    mode:                 cfg.mode || 'single-body',
    // Metadata field mapping (always applied in both modes)
    fieldMapping:         cfg.fieldMapping || {
      title:          'title',
      slug:           'slug',
      body:           'content',
      description:    'description',
      primaryKeyword: 'primaryKeyword',
    },
    // Section-mapped mode options
    sectionMapping:       cfg.sectionMapping || {},
    bodyField:            cfg.bodyField || 'content',
    introField:           cfg.introField || null,
    sectionMatching:      cfg.sectionMatching || 'exact',
    unmappedSections:     cfg.unmappedSections || 'ignore',
    requireMappedSections: cfg.requireMappedSections === true,
  };
}

// Maps metadata fields using fieldMapping (title, slug, description, etc.).
// The "body" key is excluded from fieldMapping in section-mapped mode so it
// does not overwrite the composed body built from sections.
function mapMetadataFields(article, fieldMapping, excludeKeys = []) {
  const body = cleanMarkdownBody(article.article_body_markdown || '', article.article_title || '');

  const sourceToTarget = {
    title:          article.article_title,
    slug:           article.article_slug,
    body:           body,
    description:    article.meta_description || article.excerpt || '',
    primaryKeyword: article.primary_keyword || '',
    excerpt:        article.excerpt || '',
    meta_title:     article.meta_title || '',
    canonical_url:  article.canonical_url || '',
    secondaryKeywords: article.secondary_keywords || '',
  };

  const out = {};
  for (const [sourceKey, targetKey] of Object.entries(fieldMapping)) {
    if (excludeKeys.includes(sourceKey)) continue;
    if (sourceToTarget[sourceKey] !== undefined) {
      out[targetKey] = sourceToTarget[sourceKey];
    }
  }
  return out;
}

// Legacy name kept for backward compatibility and tests.
function mapArticleToFramerFields(article, fieldMapping) {
  return mapMetadataFields(article, fieldMapping);
}

// ── Single-body mode ──────────────────────────────────────────────────────────

async function publishSingleBody(article, cfg, { dryRun }) {
  const fields = mapMetadataFields(article, cfg.fieldMapping);
  const slug   = article.article_slug || 'untitled';

  if (dryRun) {
    console.log('[framer] DRY RUN (single-body) — would publish:');
    console.log(`  collection: ${cfg.collectionIdEnv} (set in env)`);
    console.log(`  slug:       ${slug}`);
    console.log(`  fields:     ${Object.keys(fields).join(', ')}`);
    return { ok: true, message: `Dry run — would publish "${slug}" to Framer CMS` };
  }

  const axios = require('axios');
  const response = await axios.post(
    `https://api.framer.com/store/api/v1/collections/${cfg.collectionId}/items`,
    { fieldData: fields },
    {
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );
  const itemId = response.data?.id;
  return { ok: true, message: `Published "${slug}" to Framer CMS (id: ${itemId})`, id: itemId };
}

// ── Section-mapped mode ───────────────────────────────────────────────────────

function buildSectionMappedPayload(article, cfg) {
  const slug   = article.article_slug || 'untitled';
  const parsed = parseMarkdownSections(article.article_body_markdown || '');

  if (parsed.sections.length === 0) {
    throw new Error(
      `Section-mapped Framer publishing requires H2 sections but none found in "${slug}". ` +
      'Check that the article body contains ## headings.',
    );
  }

  // Track which generated sections are mapped
  const unmappedHeadings = new Set(parsed.sections.map((s) => s.heading));
  const missing = [];
  const warnings = [];
  const fields = {};

  // 1. Metadata fields — exclude "body" key so we don't overwrite the composed body
  Object.assign(fields, mapMetadataFields(article, cfg.fieldMapping, ['body']));

  // 2. Intro field
  if (cfg.introField && parsed.intro) {
    fields[cfg.introField] = parsed.intro;
  }

  // 3. H2 section fields
  for (const [heading, framerField] of Object.entries(cfg.sectionMapping)) {
    const section = findSection(parsed.sections, heading, cfg.sectionMatching);
    if (section) {
      fields[framerField] = section.markdown;
      unmappedHeadings.delete(section.heading);
    } else {
      missing.push({ heading, framerField });
      warnings.push(`Section not found: "${heading}" → ${framerField}`);
    }
  }

  // 4. Fail fast if required sections are absent
  if (missing.length > 0 && cfg.requireMappedSections) {
    throw new Error(
      'Section-mapped Framer publishing failed — missing required sections:\n' +
      missing.map((m) => `  - "${m.heading}" → ${m.framerField}`).join('\n'),
    );
  }
  for (const w of warnings) console.warn(`[framer] ${w}`);

  // 5. Handle unmapped sections
  const unmappedSections = parsed.sections.filter((s) => unmappedHeadings.has(s.heading));
  if (unmappedSections.length > 0) {
    const mode = cfg.unmappedSections || 'ignore';
    if (mode === 'append_to_body') {
      const extra = unmappedSections.map((s) => `## ${s.heading}\n\n${s.markdown}`).join('\n\n');
      const bf = cfg.bodyField || 'content';
      fields[bf] = fields[bf] ? `${fields[bf]}\n\n${extra}` : extra;
    } else if (mode === 'warn') {
      unmappedSections.forEach((s) => console.warn(`[framer] Unmapped section: "${s.heading}"`));
    } else if (mode === 'error') {
      throw new Error(
        `Unmapped sections in "${slug}": ${unmappedSections.map((s) => `"${s.heading}"`).join(', ')}`,
      );
    }
    // 'ignore' — do nothing
  }

  return { fields, parsed, missing, unmappedSections, warnings };
}

async function publishSectionMapped(article, cfg, { dryRun }) {
  const slug = article.article_slug || 'untitled';
  const { fields, parsed, missing, unmappedSections } = buildSectionMappedPayload(article, cfg);

  if (dryRun) {
    console.log('[framer] DRY RUN (section-mapped) — payload preview:');
    console.log(`  collection: ${cfg.collectionIdEnv} (set in env)`);
    console.log(`  slug:       ${slug}`);
    console.log(`  matching:   ${cfg.sectionMatching}`);
    if (Object.keys(cfg.fieldMapping).length > 0) {
      const metaKeys = Object.keys(cfg.fieldMapping).filter((k) => k !== 'body');
      console.log(`  metadata:   ${metaKeys.join(', ') || '(none)'}`);
    }
    if (cfg.introField && parsed.intro) {
      console.log(`  intro:      "${parsed.intro.slice(0, 60).replace(/\n/g, ' ')}…" → ${cfg.introField}`);
    }
    for (const [heading, framerField] of Object.entries(cfg.sectionMapping)) {
      const isMissing = missing.some((m) => m.heading === heading);
      const chars = fields[framerField]?.length ?? 0;
      const status = isMissing ? '✗ (missing)' : `✓ (${chars} chars)`;
      console.log(`  section:    "${heading}" → ${framerField} ${status}`);
    }
    if (unmappedSections.length > 0) {
      console.log(`  unmapped:   ${unmappedSections.map((s) => `"${s.heading}"`).join(', ')} → ${cfg.unmappedSections}`);
    }
    return {
      ok: true,
      message: `Dry run — would publish "${slug}" to Framer CMS in section-mapped mode`,
    };
  }

  const axios = require('axios');
  const response = await axios.post(
    `https://api.framer.com/store/api/v1/collections/${cfg.collectionId}/items`,
    { fieldData: fields },
    {
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      timeout: 30_000,
    },
  );
  const itemId = response.data?.id;
  return {
    ok:      true,
    message: `Published "${slug}" to Framer CMS in section-mapped mode (id: ${itemId})`,
    id:      itemId,
  };
}

// ── Main publish entry point ──────────────────────────────────────────────────

// publish(article, config, { dryRun }) → Promise<{ ok, message, id? }>
async function publish(article, config, { dryRun = true } = {}) {
  const cfg = getFramerConfig(config);

  if (!cfg.enabled) {
    return {
      ok:      false,
      message: 'Framer publishing is disabled. Set output.framer.enabled = true in your config.',
    };
  }

  if (!cfg.token) {
    throw new Error(
      `Framer token not set. Add ${cfg.tokenEnv}=<your_token> to .env\n` +
      'Get your API token from Framer > Settings > CMS > API',
    );
  }
  if (!cfg.collectionId) {
    throw new Error(
      `Framer collection ID not set. Add ${cfg.collectionIdEnv}=<collection_id> to .env\n` +
      'Find your Collection ID in Framer > CMS > Collections',
    );
  }

  if (cfg.mode === 'section-mapped') {
    return publishSectionMapped(article, cfg, { dryRun });
  }
  return publishSingleBody(article, cfg, { dryRun });
}

// Legacy batch function — kept for backward compatibility.
async function publishToFramer(articles, { dryRun = true } = {}) {
  const results = [];
  for (const article of articles) {
    try {
      const res = await publish(article, null, { dryRun });
      results.push({ slug: article.article_slug, ...res });
    } catch (err) {
      results.push({ slug: article.article_slug, ok: false, message: err.message });
      console.error(`[framer] Failed: ${article.article_slug} — ${err.message}`);
    }
  }
  return results;
}

module.exports = {
  publish,
  publishToFramer,
  getFramerConfig,
  mapArticleToFramerFields,
  buildSectionMappedPayload,
};
