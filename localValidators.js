// Local (no-Claude) validators for generated article shape.
// Each check returns { id, ok, severity, detail }.
// severity: 'hard' = must fix before publish; 'soft' = recommendation only.
//
// Comparison-specific checks (comparison_table, required_sections) are only
// hard fails when the article type is "comparison". Pass articleType to validateLocal()
// to enable them; they default to 'soft' for other article types.

function stripComments(md) {
  return (md || '').replace(/<!--[\s\S]*?-->/g, '');
}

function visibleBody(article) {
  return stripComments(article.article_body_markdown || '').trim();
}

function faqCount(article) {
  const f = article.faq_json;
  if (Array.isArray(f)) return f.length;
  if (typeof f === 'string') { try { const p = JSON.parse(f); return Array.isArray(p) ? p.length : 0; } catch { return 0; } }
  return 0;
}

function parseFaqJson(article) {
  const f = article.faq_json;
  if (Array.isArray(f)) return f;
  if (typeof f === 'string') { try { const p = JSON.parse(f); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

const ESCAPED_QUOTE_RE = /\\(["'])/g;
function stripEscapedQuotes(s) {
  return String(s ?? '').replace(ESCAPED_QUOTE_RE, '$1');
}

// ── CTA check ────────────────────────────────────────────────────────────────
const CTA_PATTERNS = [
  /book a demo/i, /request a demo/i, /\boffers? a demo\b/i,
  /talk to sales/i, /get started today/i, /sign up/i, /→\s*book/i,
  /see (it|this) on your own data/i,
];
const CTA_LINE_MAX_LEN = 100;

function ctaLineHits(body) {
  const hits = new Set();
  for (const line of (body || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > CTA_LINE_MAX_LEN) continue;
    for (const p of CTA_PATTERNS) {
      if (p.test(trimmed)) hits.add(p.source);
    }
  }
  return [...hits];
}

function checkCTA(body) {
  const hits = ctaLineHits(body);
  return { id: 'cta', ok: hits.length === 0, severity: 'hard', detail: hits.length ? `CTA/sales language: ${hits.join(', ')}` : '' };
}

// ── Comparison table presence (comparison articles only) ─────────────────────
function checkComparisonTable(body, articleType) {
  const isComparison = !articleType || articleType === 'comparison';
  const tableMatch = body.match(/\|[^\n]+\|\n\|[-:| ]+\|\n((?:\|[^\n]+\|\n?)+)/);
  if (!tableMatch) {
    return { id: 'comparison_table', ok: false, severity: isComparison ? 'hard' : 'soft', detail: 'no markdown comparison table found' };
  }
  const dataRows = (tableMatch[1].match(/\|[^\n]+\|/g) || []).length;
  const ok = dataRows >= 10;
  return {
    id: 'comparison_table',
    ok,
    severity: isComparison ? 'hard' : 'soft',
    detail: ok ? '' : `comparison table has only ${dataRows} data rows (minimum 10 required)`,
    value: dataRows,
  };
}

// ── Required sections (comparison articles only) ──────────────────────────────
function checkRequiredSections(body, articleType) {
  const isComparison = !articleType || articleType === 'comparison';

  // For comparison articles, validate structural section headings.
  // For other article types, only FAQ is required.
  const required = isComparison
    ? [
        { re: /^#{2}\s+.*does well/im, label: 'competitor strengths section (e.g. "## What [Competitor] does well")' },
        { re: /^#{2}\s+.*\bvs\.?\b/im, label: 'comparison section (e.g. "## [Your product] vs. [Competitor] comparison")' },
        { re: /^#{2}\s+(The bottom line|Summary|Verdict|Conclusion)/im, label: 'conclusion section (e.g. "## The bottom line on [Competitor]")' },
        { re: /^#{2}\s+FAQ/im, label: '"## FAQ" section' },
      ]
    : [
        { re: /^#{2}\s+FAQ/im, label: '"## FAQ" section' },
      ];

  const missing = required.filter(({ re }) => !re.test(body)).map(({ label }) => label);
  const ok = missing.length === 0;
  return {
    id: 'required_sections',
    ok,
    severity: isComparison ? 'hard' : 'soft',
    detail: ok ? '' : `missing required sections: ${missing.join(', ')}`,
  };
}

// ── FAQ count ─────────────────────────────────────────────────────────────────
function checkFaqCount(article) {
  const n = faqCount(article);
  const ok = n >= 4 && n <= 7;
  return { id: 'faq_count', ok, severity: 'soft', detail: ok ? '' : `FAQ count ${n} (target 5–6)`, value: n };
}

// ── FAQ inline format ─────────────────────────────────────────────────────────
function checkFaqInlineFormat(body) {
  const inlineH = /^#{2,3}[ \t]+[^?\n]*\?[ \t]+[A-Za-z][^\n]{5,}/m;
  const ok = !inlineH.test(body);
  return {
    id: 'faq_inline_format',
    ok,
    severity: 'hard',
    detail: ok ? '' : 'FAQ question and answer are on the same line — answer must start on a new paragraph below the heading',
  };
}

// ── FAQ heading level ─────────────────────────────────────────────────────────
function checkFaqHeadingLevel(body) {
  const lines = body.split('\n');
  const faqIdx = lines.findIndex((l) => /^##\s+FAQ\b/i.test(l.trim()));
  if (faqIdx === -1) return { id: 'faq_heading_level', ok: true, severity: 'hard', detail: '' };
  const bad = [];
  for (let i = faqIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+(.*\?)\s*$/);
    if (m && m[1].length === 2) bad.push(m[2].trim());
  }
  const ok = bad.length === 0;
  return {
    id: 'faq_heading_level',
    ok,
    severity: 'hard',
    detail: ok ? '' : `FAQ question(s) use ## (H2) instead of ###: ${bad.map((q) => `"${q}"`).join(', ')}`,
  };
}

// ── H2 count ──────────────────────────────────────────────────────────────────
function checkH2Presence(body) {
  const h2Matches = (body.match(/^#{2}(?!#)\s+\S/gm) || []);
  const ok = h2Matches.length >= 3;
  return {
    id: 'h2_presence',
    ok,
    severity: 'hard',
    detail: ok ? '' : `only ${h2Matches.length} H2 section(s) — articles need at least 3`,
    value: h2Matches.length,
  };
}

// ── Long inline bold ──────────────────────────────────────────────────────────
function checkLongInlineBold(body) {
  const longBoldRe = /\*\*[^*\n]{120,}\*\*/g;
  const matches = body.match(longBoldRe) || [];
  const ok = matches.length === 0;
  return {
    id: 'long_inline_bold',
    ok,
    severity: 'hard',
    detail: ok ? '' : `${matches.length} long inline bold block(s) (>120 chars)`,
  };
}

// ── Word count ────────────────────────────────────────────────────────────────
function checkWordCount(body, { minWordCount = 1800, maxWordCount = 2800 } = {}) {
  const words = body.split(/\s+/).filter(Boolean).length;
  const ok = words >= minWordCount && words <= maxWordCount;
  return {
    id: 'word_count',
    ok,
    severity: 'soft',
    detail: ok ? '' : `body is ${words} words (target 2,000–2,500; range ${minWordCount}–${maxWordCount})`,
    value: words,
  };
}

// ── Escaped quotes ────────────────────────────────────────────────────────────
function checkEscapedQuotes(article) {
  const body = article.article_body_markdown || '';
  const m = body.match(/\\["']/);
  return {
    id: 'escaped_quotes',
    ok: !m,
    severity: 'hard',
    detail: m ? `literal escaped quote characters found (e.g. ${m[0]}) — use plain " or ' characters` : '',
  };
}

// ── Banned vocabulary ─────────────────────────────────────────────────────────
const BANNED_VOCAB_PATTERNS = [
  /\bdelves?\b/i, /\bdelving\b/i, /\bunderscores?\b/i, /\bintricate\b/i,
  /\bmeticulous(ly)?\b/i, /\bpivotal\b/i, /it'?s worth noting/i,
  /when it comes to/i, /\bseamless(ly)?\b/i, /actionable insights?/i,
  /\bleverages?\b/i, /\bleveraging\b/i, /\btransforms?\b/i, /\btransforming\b/i,
];

function checkBannedVocabulary(body) {
  const found = new Set();
  for (const re of BANNED_VOCAB_PATTERNS) {
    const m = body.match(re);
    if (m) found.add(m[0].toLowerCase());
  }
  const ok = found.size === 0;
  return {
    id: 'banned_vocabulary',
    ok,
    severity: 'soft',
    detail: ok ? '' : `banned/AI-tell vocabulary: ${[...found].join(', ')}`,
  };
}

// ── Empty sections ────────────────────────────────────────────────────────────
function checkEmptySections(body) {
  const lines = body.split('\n');
  const empty = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,3})\s+(.*)$/);
    if (!m) continue;
    const level = m[1].length;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const next = j < lines.length ? lines[j].match(/^(#{1,6})\s+/) : null;
    if (j >= lines.length || (next && next[1].length <= level)) {
      empty.push(m[2].trim());
    }
  }
  const ok = empty.length === 0;
  return {
    id: 'empty_sections',
    ok,
    severity: 'hard',
    detail: ok ? '' : `${empty.length} heading(s) with no body content: ${empty.map((h) => `"${h}"`).join(', ')}`,
  };
}

// ── Duplicate headings ────────────────────────────────────────────────────────
function checkDuplicateHeadings(body) {
  const counts = new Map();
  for (const line of body.split('\n')) {
    const m = line.match(/^#{2,3}\s+(.*)$/);
    if (!m) continue;
    const text = m[1].trim().toLowerCase().replace(/[*_`]/g, '');
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t);
  const ok = dups.length === 0;
  return {
    id: 'duplicate_headings',
    ok,
    severity: 'hard',
    detail: ok ? '' : `repeated headings: ${dups.map((d) => `"${d}"`).join(', ')}`,
  };
}

// ── JSON-LD alignment ─────────────────────────────────────────────────────────
function checkJsonLd(article) {
  const val = article.schema_jsonld;
  if (!val) return { id: 'json_ld', ok: true, severity: 'soft', detail: '' };
  let parsed;
  try {
    parsed = typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return { id: 'json_ld', ok: false, severity: 'hard', detail: 'schema_jsonld is not valid JSON' };
  }
  const mainEntity = parsed && parsed['@type'] === 'FAQPage' ? parsed.mainEntity : null;

  if (!Array.isArray(mainEntity)) {
    return { id: 'json_ld', ok: false, severity: 'hard', detail: 'schema_jsonld does not contain a FAQPage with mainEntity' };
  }

  const faq = parseFaqJson(article);
  const norm = (s) => (s || '').trim().toLowerCase();
  const schemaQs = mainEntity.map((q) => norm(q?.name));
  const faqQs = faq.map((q) => norm(q?.question));
  const ok = schemaQs.length === faqQs.length && schemaQs.every((q, i) => q === faqQs[i]);
  return {
    id: 'json_ld',
    ok,
    severity: 'hard',
    detail: ok ? '' : `schema_jsonld FAQPage questions (${schemaQs.length}) don't match faq_json (${faqQs.length})`,
  };
}

// ── Mechanical hard checks ────────────────────────────────────────────────────
const MECHANICAL_HARD = new Set([
  'cta', 'faq_inline_format', 'long_inline_bold', 'json_ld',
  'empty_sections', 'duplicate_headings', 'escaped_quotes', 'faq_heading_level',
]);

// articleType: "comparison" | "blog_post" | "landing_page" | "thought_leadership" | etc.
// validationConfig: optional overrides from project config validation settings
function validateLocal(article, articleType, validationConfig = {}) {
  const body = visibleBody(article);
  const wordCountOpts = {
    minWordCount: validationConfig.minWordCount || 1800,
    maxWordCount: validationConfig.maxWordCount || 2800,
  };

  const checks = [
    checkCTA(body),
    checkComparisonTable(body, articleType),
    checkRequiredSections(body, articleType),
    checkFaqCount(article),
    checkFaqInlineFormat(body),
    checkFaqHeadingLevel(body),
    checkH2Presence(body),
    checkLongInlineBold(body),
    checkWordCount(body, wordCountOpts),
    checkBannedVocabulary(body),
    checkEmptySections(body),
    checkDuplicateHeadings(body),
    checkJsonLd(article),
    checkEscapedQuotes(article),
  ];

  const failed = checks.filter((c) => !c.ok);
  const hardFailures = failed.filter((c) => c.severity === 'hard');
  const softFailures = failed.filter((c) => c.severity === 'soft');
  return {
    ok: failed.length === 0,
    hardOk: hardFailures.length === 0,
    checks,
    hardFailures,
    softFailures,
    failedIds: failed.map((c) => c.id),
    hardAllMechanical: hardFailures.length > 0 && hardFailures.every((c) => MECHANICAL_HARD.has(c.id)),
  };
}

// ── schema_jsonld regeneration ────────────────────────────────────────────────
function regenerateSchemaJsonLd(faqJson) {
  const faq = Array.isArray(faqJson) ? faqJson : [];
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

// ── Deterministic cleanup ─────────────────────────────────────────────────────
function deterministicCleanup(article) {
  const notes = [];
  const out = { ...article };

  // 1) Strip escaped quotes from body
  const originalMd = article.article_body_markdown || '';
  let md = originalMd.replace(ESCAPED_QUOTE_RE, '$1');
  if (md !== originalMd) notes.push('stripped escaped quote characters from article body');

  // 2) Remove standalone CTA lines
  md = md.split('\n').filter((line) => {
    if (/^\s*<!--/.test(line) || /-->/.test(line)) return true;
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= CTA_LINE_MAX_LEN && CTA_PATTERNS.some((p) => p.test(trimmed))) {
      notes.push(`removed CTA line: "${trimmed.slice(0, 60)}"`);
      return false;
    }
    return true;
  }).join('\n');

  md = md.replace(/\n{3,}/g, '\n\n');
  if (md !== originalMd) out.article_body_markdown = md;

  // 3) Strip escaped quotes from metadata fields
  for (const f of ['excerpt', 'meta_title', 'meta_description']) {
    const val = article[f];
    if (typeof val === 'string') {
      const cleaned = val.replace(ESCAPED_QUOTE_RE, '$1');
      if (cleaned !== val) { out[f] = cleaned; notes.push(`stripped escaped quotes from ${f}`); }
    }
  }

  // 4) Strip escaped quotes from faq_json
  let faq = parseFaqJson(article);
  if (faq.length > 0) {
    let faqChanged = false;
    const cleanedFaq = faq.map((f) => {
      const question = typeof f?.question === 'string' ? f.question.replace(ESCAPED_QUOTE_RE, '$1') : f?.question;
      const answer = typeof f?.answer === 'string' ? f.answer.replace(ESCAPED_QUOTE_RE, '$1') : f?.answer;
      if (question !== f?.question || answer !== f?.answer) faqChanged = true;
      return { ...f, question, answer };
    });
    if (faqChanged) { out.faq_json = cleanedFaq; faq = cleanedFaq; notes.push('stripped escaped quotes from faq_json'); }
  }

  // 5) Sync schema_jsonld from faq_json
  if (faq.length > 0) {
    const regenerated = regenerateSchemaJsonLd(faq);
    if (JSON.stringify(article.schema_jsonld) !== JSON.stringify(regenerated)) {
      out.schema_jsonld = regenerated;
      notes.push('regenerated schema_jsonld from faq_json');
    }
  }

  const changed = notes.length > 0;
  return { article: out, changed, notes };
}

module.exports = {
  validateLocal, deterministicCleanup, faqCount, visibleBody,
  MECHANICAL_HARD, regenerateSchemaJsonLd, stripEscapedQuotes,
};
