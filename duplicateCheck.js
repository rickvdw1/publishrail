// Lightweight near-duplicate warning for newly-generated articles.
//
// Run once per generated article, after its fingerprint has been extracted but
// before it is written into corpus-memory.json. Flags two kinds of overlap:
//
//   (A) KNOWN_OVERLAP_CLUSTERS — a configurable list of topic clusters that are
//       structurally adjacent enough that two articles in the same cluster usually
//       mean "merge, rename, or deliberately keep both". Matched against
//       article_title, case-insensitive.
//
//   (B) Generic topic similarity — an IDF-weighted overlap score between the new
//       fingerprint and every existing corpus entry, computed over key_phrases,
//       operational_patterns, failure_mode_labels, downstream_effects,
//       named_artifacts, and sample_output_type.
//
// This is a HEURISTIC WARNING, not a gate: it never blocks generation.

function normalizePhrase(s) {
  return String(s || '').toLowerCase().trim();
}

// ── (A) Known overlap clusters ───────────────────────────────────────────────
// Add entries here as you discover structurally-adjacent article pairs in your corpus.
// `re` is matched against article_title (case-insensitive).
const KNOWN_OVERLAP_CLUSTERS = [
  // Example:
  // {
  //   id: 'onboarding_activation',
  //   label: 'onboarding vs. activation articles',
  //   re: /\bonboard(ing)?\b|\bactivat(ion|e)\b/i,
  // },
];

function clusterMatches(articleTitle, corpus, excludeSlug) {
  const title = normalizePhrase(articleTitle);
  const matches = [];
  for (const cluster of KNOWN_OVERLAP_CLUSTERS) {
    if (!cluster.re.test(title)) continue;
    for (const entry of corpus) {
      if (entry.article_slug === excludeSlug) continue;
      if (cluster.re.test(normalizePhrase(entry.article_title))) {
        matches.push({
          slug: entry.article_slug,
          title: entry.article_title,
          score: null,
          level: 'warn',
          reason: `known overlap cluster: ${cluster.label}`,
        });
      }
    }
  }
  return matches;
}

// ── (B) IDF-weighted topic similarity ────────────────────────────────────────

const BAG_FIELDS = [
  'key_phrases', 'operational_patterns', 'failure_mode_labels',
  'downstream_effects', 'named_artifacts', 'sample_output_type',
];

function fingerprintBag(fp) {
  const bag = new Set();
  for (const field of BAG_FIELDS) {
    const val = fp?.[field];
    const items = Array.isArray(val) ? val : (val ? [val] : []);
    for (const item of items) {
      const norm = normalizePhrase(item);
      if (norm) bag.add(norm);
    }
  }
  return bag;
}

function buildDocFrequencies(corpus) {
  const df = new Map();
  for (const entry of corpus) {
    for (const phrase of fingerprintBag(entry.fingerprint)) {
      df.set(phrase, (df.get(phrase) || 0) + 1);
    }
  }
  return df;
}

function idf(df, n, phrase) {
  return Math.log(1 + n / ((df.get(phrase) || 0) + 1));
}

function topicSimilarity(fpA, fpB, df, n) {
  const bagA = fingerprintBag(fpA);
  const bagB = fingerprintBag(fpB);
  if (bagA.size === 0 || bagB.size === 0) return 0;
  let totalA = 0, totalB = 0, overlap = 0;
  for (const p of bagA) totalA += idf(df, n, p);
  for (const p of bagB) totalB += idf(df, n, p);
  for (const p of bagA) if (bagB.has(p)) overlap += idf(df, n, p);
  const denom = Math.min(totalA, totalB);
  return denom > 0 ? overlap / denom : 0;
}

const TOPIC_WARN_THRESHOLD = 0.2;
const TOPIC_EXTREME_THRESHOLD = 0.35;

function topicMatches(fingerprint, corpus, excludeSlug) {
  const others = corpus.filter((e) => e.article_slug !== excludeSlug);
  const df = buildDocFrequencies(others);
  const n = others.length || 1;
  const matches = [];
  for (const entry of others) {
    const score = topicSimilarity(fingerprint, entry.fingerprint, df, n);
    if (score >= TOPIC_WARN_THRESHOLD) {
      matches.push({
        slug: entry.article_slug,
        title: entry.article_title,
        score,
        level: score >= TOPIC_EXTREME_THRESHOLD ? 'extreme' : 'warn',
        reason: 'topic similarity',
      });
    }
  }
  return matches;
}

// Returns an array of { slug, title, score, level, reason } for corpus entries
// that look similar to the given fingerprint/title, 'extreme' matches first.
function findNearDuplicates(fingerprint, articleTitle, corpus, { excludeSlug, limit = 3 } = {}) {
  const matches = [
    ...clusterMatches(articleTitle, corpus, excludeSlug),
    ...topicMatches(fingerprint, corpus, excludeSlug),
  ];

  const seen = new Set();
  const deduped = [];
  for (const m of matches) {
    if (seen.has(m.slug)) continue;
    seen.add(m.slug);
    deduped.push(m);
  }

  return deduped
    .sort((a, b) => (b.level === 'extreme' ? 1 : 0) - (a.level === 'extreme' ? 1 : 0))
    .slice(0, limit);
}

module.exports = {
  findNearDuplicates, KNOWN_OVERLAP_CLUSTERS, topicSimilarity, fingerprintBag,
  TOPIC_WARN_THRESHOLD, TOPIC_EXTREME_THRESHOLD,
};
