const fs = require('fs');
const path = require('path');

const CORPUS_PATH = path.join(__dirname, 'corpus-memory.json');

// Known signature phrases that tend to repeat across articles.
// Update this list as you run the pipeline to capture overused openers/closers
// that appear in 2+ recent articles. The pipeline uses this to build an avoid-list
// injected into the writer prompt.
const KNOWN_SIGNATURE_PHRASES = [
  // Add phrases that appear too often in your generated articles here.
  // Examples:
  // 'No one assembled this by hand',
  // 'A faster dashboard is still a dashboard',
];

function readCorpus() {
  try {
    if (!fs.existsSync(CORPUS_PATH)) return [];
    const raw = fs.readFileSync(CORPUS_PATH, 'utf8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error(`  [corpus] Read error: ${err.message}`);
    return [];
  }
}

function writeFingerprint(slug, articleTitle, archetype, fingerprint) {
  const corpus = readCorpus();

  const entry = {
    article_slug:      slug,
    article_title:     articleTitle,
    workflow_archetype: archetype,
    finalized_at:      new Date().toISOString(),
    fingerprint,
  };

  const existingIndex = corpus.findIndex((e) => e.article_slug === slug);
  if (existingIndex !== -1) {
    corpus[existingIndex] = entry;
  } else {
    corpus.push(entry);
  }

  fs.writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2));
}

function getCorpusSize() {
  return readCorpus().length;
}

// Scans recent output JSON files and returns the most overused signature phrases
// (those appearing in 2+ of the last `maxArticles` articles), capped at `maxPhrases`.
// Used to build a short avoid-list that can be injected into the writer prompt.
function buildCorpusAvoidList(outputsDir, { maxArticles = 15, maxPhrases = 6 } = {}) {
  if (!fs.existsSync(outputsDir)) return [];
  if (KNOWN_SIGNATURE_PHRASES.length === 0) return [];

  let files;
  try {
    files = fs.readdirSync(outputsDir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.run.json'))
      .map((f) => {
        const full = path.join(outputsDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxArticles)
      .map((x) => x.full);
  } catch {
    return [];
  }

  const counts = Object.fromEntries(KNOWN_SIGNATURE_PHRASES.map((p) => [p, 0]));

  for (const file of files) {
    try {
      const art = JSON.parse(fs.readFileSync(file, 'utf8'));
      const lower = (art.article_body_markdown || '').toLowerCase();
      for (const p of KNOWN_SIGNATURE_PHRASES) {
        if (lower.includes(p.toLowerCase())) counts[p]++;
      }
    } catch { /* ignore corrupt or in-progress files */ }
  }

  return Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxPhrases)
    .map(([phrase]) => phrase);
}

module.exports = { readCorpus, writeFingerprint, getCorpusSize, buildCorpusAvoidList, KNOWN_SIGNATURE_PHRASES };
