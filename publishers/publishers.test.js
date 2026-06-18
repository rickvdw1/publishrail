// Tests for the publisher layer.
// Run: node --test publishers/publishers.test.js
//
// These tests do NOT call any external APIs. All network-dependent tests
// run in dry-run mode to verify behaviour without side effects.

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArticle(overrides = {}) {
  return {
    Id: 1,
    article_title:         'Best Project Management Tools',
    article_slug:          'best-project-management-tools',
    article_body_markdown: '## Why tools matter\n\nContent here.\n\n## FAQ\n\n### Q: Which is best?\n\nA: Depends on needs.',
    excerpt:               'A guide to project management tools.',
    meta_title:            'Best Project Management Tools 2025',
    meta_description:      'Compare the top project management tools.',
    canonical_url:         'https://example.com/best-project-management-tools',
    ...overrides,
  };
}

function makeConfig(outputOverrides = {}) {
  return {
    output: {
      targets: ['markdown'],
      markdown: { enabled: true, outputDir: os.tmpdir(), metadataFormat: 'frontmatter' },
      github:  { enabled: false, dryRunDefault: true },
      framer:  { enabled: false, dryRunDefault: true },
      ...outputOverrides,
    },
  };
}

// ── parseTargets ──────────────────────────────────────────────────────────────

test('parseTargets — parses comma-separated targets', () => {
  const { parseTargets } = require('./publisherRegistry');
  const cfg = makeConfig();
  assert.deepEqual(parseTargets('markdown,github', cfg), ['markdown', 'github']);
});

test('parseTargets — single target', () => {
  const { parseTargets } = require('./publisherRegistry');
  assert.deepEqual(parseTargets('markdown', makeConfig()), ['markdown']);
});

test('parseTargets — "none" returns empty array', () => {
  const { parseTargets } = require('./publisherRegistry');
  assert.deepEqual(parseTargets('none', makeConfig()), []);
});

test('parseTargets — "dry-run" returns empty array', () => {
  const { parseTargets } = require('./publisherRegistry');
  assert.deepEqual(parseTargets('dry-run', makeConfig()), []);
});

test('parseTargets — unknown target is filtered out with warning', () => {
  const { parseTargets } = require('./publisherRegistry');
  assert.deepEqual(parseTargets('markdown,unknown_target', makeConfig()), ['markdown']);
});

test('parseTargets — falls back to config.output.targets', () => {
  const { parseTargets } = require('./publisherRegistry');
  const cfg = makeConfig({ targets: ['markdown', 'github'] });
  assert.deepEqual(parseTargets(undefined, cfg), ['markdown', 'github']);
});

test('parseTargets — defaults to ["markdown"] when config has no targets', () => {
  const { parseTargets } = require('./publisherRegistry');
  const cfg = { output: {} };
  assert.deepEqual(parseTargets(undefined, cfg), ['markdown']);
});

// ── Pre-publish validation ────────────────────────────────────────────────────

test('publishArticle — throws when article_slug is missing', async () => {
  const { publishArticle } = require('./publisherRegistry');
  const article = makeArticle({ article_slug: '' });
  await assert.rejects(
    () => publishArticle(article, { targets: ['markdown'], config: makeConfig(), dryRun: true }),
    /missing required fields/,
  );
});

test('publishArticle — throws when article_body_markdown is missing', async () => {
  const { publishArticle } = require('./publisherRegistry');
  const article = makeArticle({ article_body_markdown: '' });
  await assert.rejects(
    () => publishArticle(article, { targets: ['markdown'], config: makeConfig(), dryRun: true }),
    /missing required fields/,
  );
});

// ── Markdown publisher ────────────────────────────────────────────────────────

test('markdownPublisher — dry-run returns ok without writing', async () => {
  const { publish } = require('./markdownPublisher');
  const article = makeArticle();
  const cfg     = makeConfig();
  const result  = await publish(article, cfg, { dryRun: true });
  assert.equal(result.ok, true);
  assert.match(result.message, /[Dd]ry run/);
});

test('markdownPublisher — writes file and returns path', async () => {
  const { publish } = require('./markdownPublisher');
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'md-test-'));
  const cfg     = makeConfig({ markdown: { enabled: true, outputDir: tmpDir, metadataFormat: 'frontmatter' } });
  const article = makeArticle();

  const result = await publish(article, cfg, { dryRun: false });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path), 'file should exist on disk');
  const content = fs.readFileSync(result.path, 'utf8');
  assert.match(content, /^---\n/);
  assert.match(content, /slug: best-project-management-tools/);
  assert.match(content, /## Why tools matter/);

  fs.rmSync(tmpDir, { recursive: true });
});

test('markdownPublisher — disabled in config returns ok: false', async () => {
  const { publish } = require('./markdownPublisher');
  const cfg = makeConfig({ markdown: { enabled: false, outputDir: os.tmpdir() } });
  const result = await publish(makeArticle(), cfg, { dryRun: false });
  assert.equal(result.ok, false);
  assert.match(result.message, /disabled/);
});

test('buildMarkdown — frontmatter contains required fields', () => {
  const { buildMarkdown } = require('./markdownPublisher');
  const md = buildMarkdown(makeArticle(), makeConfig());
  assert.match(md, /^---\n/);
  assert.match(md, /title: Best Project Management Tools/);
  assert.match(md, /slug: best-project-management-tools/);
  assert.match(md, /meta_description:/);
  assert.match(md, /---\n\n/);
});

test('buildMarkdown — strips escaped quotes from body', () => {
  const { buildMarkdown } = require('./markdownPublisher');
  const article = makeArticle({ article_body_markdown: 'He said \\"hello\\"\n\n## Section\n\nContent.' });
  const md = buildMarkdown(article, makeConfig());
  assert.doesNotMatch(md, /\\"/);
  assert.match(md, /"hello"/);
});

test('buildMarkdown — strips HTML comments from body', () => {
  const { buildMarkdown } = require('./markdownPublisher');
  const article = makeArticle({ article_body_markdown: '<!-- BUILD NOTE: draft -->\n\n## Section\n\nContent.' });
  const md = buildMarkdown(article, makeConfig());
  assert.doesNotMatch(md, /BUILD NOTE/);
});

test('buildMarkdown — removes duplicate leading H1', () => {
  const { buildMarkdown } = require('./markdownPublisher');
  const article = makeArticle({
    article_title:         'My Title',
    article_body_markdown: '# My Title\n\n## Section\n\nContent.',
  });
  const md = buildMarkdown(article, makeConfig());
  const bodyPart = md.split('---\n\n')[1] || '';
  assert.doesNotMatch(bodyPart, /^# My Title/);
});

// ── GitHub publisher ──────────────────────────────────────────────────────────

test('githubPublisher — disabled returns ok: false without network call', async () => {
  const { publish } = require('./githubPublisher');
  const cfg = makeConfig({ github: { enabled: false } });
  const result = await publish(makeArticle(), cfg, { dryRun: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /disabled/);
});

test('githubPublisher — dry-run returns ok without network call', async () => {
  const { publish } = require('./githubPublisher');
  const cfg = makeConfig({
    github: {
      enabled:  true,
      tokenEnv: 'GITHUB_TEST_TOKEN',
      ownerEnv: 'GITHUB_TEST_OWNER',
      repoEnv:  'GITHUB_TEST_REPO',
      branch:   'main',
      folder:   'content/articles',
    },
  });
  // Set env vars in-process for this test
  process.env.GITHUB_TEST_TOKEN = 'test-token-dry-run';
  process.env.GITHUB_TEST_OWNER = 'test-owner';
  process.env.GITHUB_TEST_REPO  = 'test-repo';

  const result = await publish(makeArticle(), cfg, { dryRun: true });

  delete process.env.GITHUB_TEST_TOKEN;
  delete process.env.GITHUB_TEST_OWNER;
  delete process.env.GITHUB_TEST_REPO;

  assert.equal(result.ok, true);
  assert.match(result.message, /[Dd]ry run/);
});

test('githubPublisher — throws when token env var is missing', async () => {
  const { publish } = require('./githubPublisher');
  const cfg = makeConfig({
    github: { enabled: true, tokenEnv: 'GITHUB_MISSING_TOKEN', ownerEnv: 'GITHUB_OWNER', repoEnv: 'GITHUB_REPO' },
  });
  delete process.env.GITHUB_MISSING_TOKEN;
  await assert.rejects(
    () => publish(makeArticle(), cfg, { dryRun: false }),
    /token not set/i,
  );
});

test('githubPublisher — dry-run log does not contain token value', async () => {
  const { publish } = require('./githubPublisher');
  const cfg = makeConfig({
    github: {
      enabled:  true,
      tokenEnv: 'GITHUB_TEST_TOKEN2',
      ownerEnv: 'GITHUB_TEST_OWNER2',
      repoEnv:  'GITHUB_TEST_REPO2',
      branch:   'main',
      folder:   'content',
    },
  });
  process.env.GITHUB_TEST_TOKEN2 = 'secret-gh-token-abc123';
  process.env.GITHUB_TEST_OWNER2 = 'testowner';
  process.env.GITHUB_TEST_REPO2  = 'testrepo';

  const captured = [];
  const origLog  = console.log;
  console.log = (...args) => { captured.push(args.join(' ')); origLog(...args); };

  await publish(makeArticle(), cfg, { dryRun: true });

  console.log = origLog;
  delete process.env.GITHUB_TEST_TOKEN2;
  delete process.env.GITHUB_TEST_OWNER2;
  delete process.env.GITHUB_TEST_REPO2;

  for (const line of captured) {
    assert.doesNotMatch(line, /secret-gh-token-abc123/, 'Token must never appear in logs');
  }
});

test('buildFilePath — sanitises slug for safe file paths', () => {
  const { buildFilePath } = require('./githubPublisher');
  const article = makeArticle({ article_slug: 'My Article / Slug!?' });
  const fp = buildFilePath('content/articles', article);
  assert.doesNotMatch(fp, /[!?]/);
  assert.match(fp, /content\/articles\//);
  assert.match(fp, /\.md$/);
});

test('buildCommitMessage — interpolates title and slug', () => {
  const { buildCommitMessage } = require('./githubPublisher');
  const article = makeArticle();
  const msg = buildCommitMessage('docs: {{title}} ({{slug}})', article);
  assert.equal(msg, 'docs: Best Project Management Tools (best-project-management-tools)');
});

// ── Framer publisher ──────────────────────────────────────────────────────────

test('framerPublisher — disabled returns ok: false without network call', async () => {
  const { publish } = require('./framerPublisher');
  const cfg = makeConfig({ framer: { enabled: false } });
  const result = await publish(makeArticle(), cfg, { dryRun: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /disabled/);
});

test('framerPublisher — dry-run returns ok without network call', async () => {
  const { publish } = require('./framerPublisher');
  const cfg = makeConfig({
    framer: {
      enabled:         true,
      tokenEnv:        'FRAMER_TEST_TOKEN',
      collectionIdEnv: 'FRAMER_TEST_COLLECTION_ID',
      fieldMapping:    { title: 'title', slug: 'slug', body: 'content' },
    },
  });
  process.env.FRAMER_TEST_TOKEN         = 'test-framer-token';
  process.env.FRAMER_TEST_COLLECTION_ID = 'col_123';

  const result = await publish(makeArticle(), cfg, { dryRun: true });

  delete process.env.FRAMER_TEST_TOKEN;
  delete process.env.FRAMER_TEST_COLLECTION_ID;

  assert.equal(result.ok, true);
  assert.match(result.message, /[Dd]ry run/);
});

test('framerPublisher — dry-run log does not contain token', async () => {
  const { publish } = require('./framerPublisher');
  const cfg = makeConfig({
    framer: {
      enabled:         true,
      tokenEnv:        'FRAMER_LOG_TEST_TOKEN',
      collectionIdEnv: 'FRAMER_LOG_TEST_COLLECTION',
      fieldMapping:    { title: 'title', body: 'content' },
    },
  });
  process.env.FRAMER_LOG_TEST_TOKEN      = 'secret-framer-token-xyz';
  process.env.FRAMER_LOG_TEST_COLLECTION = 'col_abc';

  const captured = [];
  const origLog  = console.log;
  console.log = (...args) => { captured.push(args.join(' ')); origLog(...args); };

  await publish(makeArticle(), cfg, { dryRun: true });

  console.log = origLog;
  delete process.env.FRAMER_LOG_TEST_TOKEN;
  delete process.env.FRAMER_LOG_TEST_COLLECTION;

  for (const line of captured) {
    assert.doesNotMatch(line, /secret-framer-token-xyz/, 'Token must never appear in logs');
  }
});

test('mapArticleToFramerFields — maps article fields to Framer field names', () => {
  const { mapArticleToFramerFields } = require('./framerPublisher');
  const mapping = { title: 'Name', slug: 'urlSlug', body: 'richText', description: 'teaser' };
  const fields  = mapArticleToFramerFields(makeArticle(), mapping);
  assert.equal(fields.Name,     'Best Project Management Tools');
  assert.equal(fields.urlSlug,  'best-project-management-tools');
  // meta_description takes priority over excerpt when both are present
  assert.equal(fields.teaser,   'Compare the top project management tools.');
  assert.ok(fields.richText,    'body should be mapped');
});

// ── Multi-target ──────────────────────────────────────────────────────────────

test('publishArticle — multi-target runs all enabled publishers in dry-run', async () => {
  const { publishArticle } = require('./publisherRegistry');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-test-'));

  const cfg = makeConfig({
    targets:  ['markdown', 'github', 'framer'],
    markdown: { enabled: true, outputDir: tmpDir, metadataFormat: 'frontmatter' },
    github:   { enabled: false },
    framer:   { enabled: false },
  });

  const results = await publishArticle(makeArticle(), { targets: ['markdown', 'github', 'framer'], config: cfg, dryRun: true });

  fs.rmSync(tmpDir, { recursive: true });

  assert.equal(results.length, 3);
  const byTarget = Object.fromEntries(results.map((r) => [r.target, r]));
  assert.equal(byTarget.markdown.ok, true);  // enabled — dry-run succeeds
  assert.equal(byTarget.github.ok,   false); // disabled → ok: false
  assert.equal(byTarget.framer.ok,   false); // disabled → ok: false
});

test('publishArticle — empty targets returns empty results', async () => {
  const { publishArticle } = require('./publisherRegistry');
  const results = await publishArticle(makeArticle(), { targets: [], config: makeConfig(), dryRun: true });
  assert.equal(results.length, 0);
});

test('publishArticle — publisher error does not crash the registry', async () => {
  const { publishArticle } = require('./publisherRegistry');
  // framer enabled but no token → should throw inside publish, registry catches it
  const cfg = makeConfig({
    framer: {
      enabled:  true,
      tokenEnv: 'FRAMER_MISSING_TOKEN',
      collectionIdEnv: 'FRAMER_MISSING_COLL',
    },
  });
  delete process.env.FRAMER_MISSING_TOKEN;
  delete process.env.FRAMER_MISSING_COLL;

  const results = await publishArticle(makeArticle(), { targets: ['framer'], config: cfg, dryRun: false });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].message, /token not set/i);
});

// ── markdownSections ──────────────────────────────────────────────────────────

const MULTI_SECTION_BODY = `
Intro text before any heading.

## What the output looks like

Output section content here. Very detailed.

## How it works

Works by doing things step by step.

### Sub-step one

First sub-step detail.

### Sub-step two

Second sub-step detail.

## FAQ

### Q: Does it work?

A: Yes.

### Q: Is it fast?

A: Yes, very.
`.trim();

test('parseMarkdownSections — splits into H2 sections only', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  assert.equal(parsed.sections.length, 3);
  assert.equal(parsed.sections[0].heading, 'What the output looks like');
  assert.equal(parsed.sections[1].heading, 'How it works');
  assert.equal(parsed.sections[2].heading, 'FAQ');
  assert.equal(parsed.sections[0].level, 2);
});

test('parseMarkdownSections — preserves intro before first H2', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  assert.match(parsed.intro, /Intro text/);
});

test('parseMarkdownSections — preserves H3 questions inside FAQ section', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  const faq = parsed.sections.find((s) => s.heading === 'FAQ');
  assert.ok(faq, 'FAQ section should exist');
  assert.match(faq.markdown, /### Q: Does it work/);
  assert.match(faq.markdown, /### Q: Is it fast/);
});

test('parseMarkdownSections — preserves H3 sub-steps inside their parent section', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  const howItWorks = parsed.sections.find((s) => s.heading === 'How it works');
  assert.ok(howItWorks, '"How it works" should exist');
  assert.match(howItWorks.markdown, /### Sub-step one/);
  assert.match(howItWorks.markdown, /### Sub-step two/);
});

test('parseMarkdownSections — handles body with no H2 sections', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const parsed = parseMarkdownSections('Just some text.\n\n### Only H3\n\nContent.');
  assert.equal(parsed.sections.length, 0);
  assert.match(parsed.intro, /Just some text/);
});

test('parseMarkdownSections — strips build notes before parsing', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const body = '<!-- BUILD NOTE: draft -->\n\n## Real section\n\nContent.';
  const parsed = parseMarkdownSections(body);
  assert.equal(parsed.sections.length, 1);
  assert.doesNotMatch(parsed.sections[0].markdown, /BUILD NOTE/);
});

test('parseMarkdownSections — strips escaped quotes', () => {
  const { parseMarkdownSections } = require('./markdownSections');
  const body = '## My Section\n\nHe said \\"hello\\"';
  const parsed = parseMarkdownSections(body);
  assert.doesNotMatch(parsed.sections[0].markdown, /\\"/);
  assert.match(parsed.sections[0].markdown, /"hello"/);
});

test('findSection — exact match', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  const s = findSection(parsed.sections, 'FAQ', 'exact');
  assert.ok(s);
  assert.equal(s.heading, 'FAQ');
});

test('findSection — exact match returns null for near-miss', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  assert.equal(findSection(parsed.sections, 'faq', 'exact'), null);
});

test('findSection — normalized match ignores case', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  const s = findSection(parsed.sections, 'FAQ', 'normalized');
  assert.ok(s);
  assert.equal(s.heading, 'FAQ');
});

test('findSection — normalized match ignores punctuation', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  // "What the output looks like?" should match "What the output looks like"
  const s = findSection(parsed.sections, 'What the output looks like?', 'normalized');
  assert.ok(s);
  assert.equal(s.heading, 'What the output looks like');
});

test('findSection — normalized match ignores extra spaces', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  const s = findSection(parsed.sections, '  How it works  ', 'normalized');
  assert.ok(s);
  assert.equal(s.heading, 'How it works');
});

test('findSection — returns null when no section matches', () => {
  const { parseMarkdownSections, findSection } = require('./markdownSections');
  const parsed = parseMarkdownSections(MULTI_SECTION_BODY);
  assert.equal(findSection(parsed.sections, 'Nonexistent section', 'normalized'), null);
});

// ── Section-mapped Framer publisher ──────────────────────────────────────────

function makeSectionCfg(overrides = {}) {
  return makeConfig({
    framer: {
      enabled:         true,
      tokenEnv:        'FRAMER_SECT_TOKEN',
      collectionIdEnv: 'FRAMER_SECT_COLL',
      mode:            'section-mapped',
      fieldMapping:    { title: 'title', slug: 'slug' },
      sectionMapping:  {
        'What the output looks like': 'outputSection',
        'How it works':               'howItWorksSection',
        'FAQ':                        'faqSection',
      },
      bodyField:       'body',
      unmappedSections: 'ignore',
      sectionMatching: 'exact',
      requireMappedSections: false,
      ...overrides,
    },
  });
}

function setSectionEnv() {
  process.env.FRAMER_SECT_TOKEN = 'test-section-token';
  process.env.FRAMER_SECT_COLL  = 'col_section_test';
}
function clearSectionEnv() {
  delete process.env.FRAMER_SECT_TOKEN;
  delete process.env.FRAMER_SECT_COLL;
}

test('framerPublisher — section-mapped dry-run returns ok', async () => {
  const { publish } = require('./framerPublisher');
  setSectionEnv();
  const result = await publish(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    makeSectionCfg(),
    { dryRun: true },
  );
  clearSectionEnv();
  assert.equal(result.ok, true);
  assert.match(result.message, /section-mapped/i);
});

test('framerPublisher — section-mapped dry-run does not log token', async () => {
  const { publish } = require('./framerPublisher');
  setSectionEnv();

  const captured = [];
  const origLog = console.log;
  console.log = (...args) => { captured.push(args.join(' ')); origLog(...args); };

  await publish(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    makeSectionCfg(),
    { dryRun: true },
  );

  console.log = origLog;
  clearSectionEnv();

  for (const line of captured) {
    assert.doesNotMatch(line, /test-section-token/, 'Token must never appear in logs');
  }
});

test('buildSectionMappedPayload — maps H2 sections to Framer fields', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg());
  const { fields } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.ok(fields.outputSection,    'outputSection should be populated');
  assert.ok(fields.howItWorksSection, 'howItWorksSection should be populated');
  assert.ok(fields.faqSection,        'faqSection should be populated');
  assert.match(fields.faqSection, /### Q: Does it work/);
});

test('buildSectionMappedPayload — maps metadata fields alongside sections', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg());
  const { fields } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.equal(fields.title, 'Best Project Management Tools');
  assert.equal(fields.slug,  'best-project-management-tools');
});

test('buildSectionMappedPayload — warns for missing section, does not fail', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    sectionMapping: {
      'What the output looks like': 'outputSection',
      'Nonexistent section':         'missingField',
    },
    requireMappedSections: false,
  }));
  const warned = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warned.push(args.join(' ')); origWarn(...args); };

  const { missing } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );

  console.warn = origWarn;
  clearSectionEnv();

  assert.equal(missing.length, 1);
  assert.equal(missing[0].heading, 'Nonexistent section');
  assert.ok(warned.some((w) => w.includes('Nonexistent section')));
});

test('buildSectionMappedPayload — throws for missing section when requireMappedSections is true', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    sectionMapping:       { 'Missing heading': 'missingField' },
    requireMappedSections: true,
  }));
  assert.throws(
    () => buildSectionMappedPayload(
      makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
      cfg,
    ),
    /missing required sections/i,
  );
  clearSectionEnv();
});

test('buildSectionMappedPayload — unmapped sections are ignored by default', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    // Only map one of the three sections — others are unmapped
    sectionMapping:  { 'What the output looks like': 'outputSection' },
    unmappedSections: 'ignore',
  }));
  const { fields, unmappedSections } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.equal(unmappedSections.length, 2); // "How it works" and "FAQ" are unmapped
  // They should not appear as extra keys
  assert.equal(fields.howItWorksSection, undefined);
  assert.equal(fields.faqSection, undefined);
});

test('buildSectionMappedPayload — unmapped sections appended to bodyField', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    sectionMapping:  { 'What the output looks like': 'outputSection' },
    unmappedSections: 'append_to_body',
    bodyField:        'body',
  }));
  const { fields } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.ok(fields.body, 'body field should be populated with unmapped sections');
  assert.match(fields.body, /## How it works/);
  assert.match(fields.body, /## FAQ/);
});

test('buildSectionMappedPayload — throws when unmapped sections and mode is error', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    sectionMapping:  { 'What the output looks like': 'outputSection' },
    unmappedSections: 'error',
  }));
  assert.throws(
    () => buildSectionMappedPayload(
      makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
      cfg,
    ),
    /Unmapped sections/i,
  );
  clearSectionEnv();
});

test('buildSectionMappedPayload — intro sent to introField when configured', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({ introField: 'intro' }));
  const { fields } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.ok(fields.intro, 'intro field should be populated');
  assert.match(fields.intro, /Intro text/);
});

test('buildSectionMappedPayload — normalized matching finds case-insensitive heading', () => {
  const { buildSectionMappedPayload, getFramerConfig } = require('./framerPublisher');
  setSectionEnv();
  const cfg = getFramerConfig(makeSectionCfg({
    sectionMapping:  { 'what the output looks like': 'outputSection' },
    sectionMatching: 'normalized',
  }));
  const { fields, missing } = buildSectionMappedPayload(
    makeArticle({ article_body_markdown: MULTI_SECTION_BODY }),
    cfg,
  );
  clearSectionEnv();
  assert.equal(missing.length, 0, 'Should match despite case difference');
  assert.ok(fields.outputSection);
});

test('framerPublisher — throws for section-mapped with no H2 sections', async () => {
  const { publish } = require('./framerPublisher');
  setSectionEnv();
  const cfg = makeSectionCfg();
  const article = makeArticle({ article_body_markdown: 'No headings here at all.' });
  await assert.rejects(
    () => publish(article, cfg, { dryRun: true }),
    /H2 sections/i,
  );
  clearSectionEnv();
});

test('framerPublisher — single-body mode still works after refactor', async () => {
  const { publish } = require('./framerPublisher');
  process.env.FRAMER_SINGLE_TOKEN = 'single-body-test-token';
  process.env.FRAMER_SINGLE_COLL  = 'col_single';
  const cfg = makeConfig({
    framer: {
      enabled:         true,
      mode:            'single-body',
      tokenEnv:        'FRAMER_SINGLE_TOKEN',
      collectionIdEnv: 'FRAMER_SINGLE_COLL',
      fieldMapping:    { title: 'title', slug: 'slug', body: 'content' },
    },
  });
  const result = await publish(makeArticle(), cfg, { dryRun: true });
  delete process.env.FRAMER_SINGLE_TOKEN;
  delete process.env.FRAMER_SINGLE_COLL;
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.message, /section-mapped/i);
});
