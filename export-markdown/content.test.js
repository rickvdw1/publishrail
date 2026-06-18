const test = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');

const {
  buildFrontmatter,
  buildMarkdown,
  buildTargetRelativePath,
  cleanMarkdownBody,
  cleanScalar,
  validateRow,
} = require('./content');

test('buildMarkdown composes YAML frontmatter and preserves markdown body', () => {
  const row = {
    Id: 42,
    article_title: 'TaskFlow vs Linear: Better for engineering teams?',
    article_slug: 'taskflow-vs-linear',
    excerpt: 'Short summary',
    competitor_name: 'Linear',
    meta_title: 'TaskFlow vs Linear | TaskFlow',
    meta_description: 'A comparison of TaskFlow and Linear for engineering teams.',
    canonical_url: '/compare/taskflow-vs-linear',
    article_body_markdown: '## How it works\n\nUse **routing** rules.',
  };

  const result = buildMarkdown(row);
  assert.ok(result.startsWith('---\n'), 'should start with YAML frontmatter');
  assert.ok(result.includes('taskflow-vs-linear'), 'should include the slug');
  assert.ok(result.includes('## How it works'), 'should include the article body');
});

test('cleanScalar collapses newlines and trims surrounding whitespace', () => {
  assert.equal(cleanScalar('  Hello\r\nworld  '), 'Hello world');
  assert.equal(cleanScalar(undefined), '');
  assert.equal(cleanScalar(null), '');
});

test('cleanScalar strips literal backslash-escaped quote characters', () => {
  assert.equal(cleanScalar('She said \\"hello\\" to the team'), 'She said "hello" to the team');
  assert.equal(cleanScalar("It\\'s fine"), "It's fine");
});

test('buildFrontmatter only quotes values where plain YAML would be invalid or ambiguous', () => {
  const row = {
    Id: 1,
    article_title: 'TaskFlow vs Rival: A Comparison',
    article_slug: 'taskflow-vs-rival',
    excerpt: '',
    competitor_name: 'Rival',
    meta_title: 'TaskFlow vs Rival | TaskFlow',
    meta_description: 'A comparison.',
    canonical_url: '/compare/taskflow-vs-rival',
    article_body_markdown: 'Body',
  };

  const frontmatter = buildFrontmatter(row);

  // Plain values stay unquoted for readability...
  assert.match(frontmatter, /^competitor_name: Rival$/m);
  assert.match(frontmatter, /^canonical_url: \/compare\/taskflow-vs-rival$/m);
  // ...but values that would otherwise break YAML get quoted.
  assert.match(frontmatter, /^title: 'TaskFlow vs Rival: A Comparison'$/m);

  // The result is always valid YAML that round-trips to the cleaned values.
  const parsed = yaml.load(frontmatter);
  assert.equal(parsed.title, 'TaskFlow vs Rival: A Comparison');
  assert.equal(parsed.competitor_name, 'Rival');
});

test('cleanMarkdownBody removes HTML comments and duplicated title heading', () => {
  const body = cleanMarkdownBody(
    [
      '<!--',
      'metadata',
      '-->',
      '',
      '# My Title',
      '',
      'Intro paragraph.',
      '',
      '<!-- build notes -->',
      '',
      '## Section',
      '',
      'Body.',
    ].join('\n'),
    'My Title'
  );

  assert.equal(
    body,
    [
      'Intro paragraph.',
      '',
      '## Section',
      '',
      'Body.',
      '',
    ].join('\n')
  );
});

test('cleanMarkdownBody strips literal backslash-escaped quote characters', () => {
  const body = cleanMarkdownBody(
    `Reps heard \\"native AI included, no add-on fee\\" in three deals.\n\nIt\\'s a recurring claim.`,
    ''
  );

  assert.equal(
    body,
    `Reps heard "native AI included, no add-on fee" in three deals.\n\nIt's a recurring claim.\n`
  );
});

test('cleanMarkdownBody strips a realistic multi-clause build-notes comment', () => {
  const body = cleanMarkdownBody(
    [
      '## FAQ',
      '',
      '### How is TaskFlow different from Rival?',
      '',
      'Different architecture.',
      '',
      '<!-- build-notes: Word count target 2,000-2,500; verify on publish. No CTA present. -->',
    ].join('\n'),
    ''
  );

  assert.equal(
    body,
    [
      '## FAQ',
      '',
      '### How is TaskFlow different from Rival?',
      '',
      'Different architecture.',
      '',
    ].join('\n')
  );
});

test('buildTargetRelativePath maps slug to markdown filename', () => {
  assert.equal(buildTargetRelativePath('taskflow-vs-linear'), 'taskflow-vs-linear.md');
});

test('validateRow rejects rows missing required markdown fields', () => {
  assert.throws(
    () => validateRow({ Id: 3, article_title: 'Title', article_slug: 'slug', article_body_markdown: '   ' }),
    /Row 3 is missing article_body_markdown/
  );
});
