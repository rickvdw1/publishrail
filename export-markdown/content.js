const yaml = require('js-yaml');

function cleanScalar(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/\\(["'])/g, '$1')
    .trim();
}

function getRowId(row) {
  return row?.Id ?? row?.id;
}

function validateRow(row) {
  const rowId = getRowId(row);
  if (!rowId) throw new Error('Row is missing Id');
  if (!row.article_slug) throw new Error(`Row ${rowId} is missing article_slug`);
  if (!row.article_title) throw new Error(`Row ${rowId} is missing article_title`);
  if (!row.article_body_markdown || !row.article_body_markdown.trim()) {
    throw new Error(`Row ${rowId} is missing article_body_markdown`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMarkdownBody(markdown, title) {
  let body = String(markdown || '').replace(/\r\n/g, '\n');

  // Strip literal backslash-escaped quote characters (JSON-escaping artifacts).
  body = body.replace(/\\(["'])/g, '$1');

  // Strip HTML comments such as embedded metadata and build notes.
  body = body.replace(/<!--[\s\S]*?-->/g, '');

  // Drop a leading H1 when it duplicates the frontmatter title.
  const trimmedTitle = String(title || '').trim();
  if (trimmedTitle) {
    const titlePattern = new RegExp(`^\\s*#\\s+${escapeRegExp(trimmedTitle)}\\s*\\n+`, 'i');
    body = body.replace(titlePattern, '');
  }

  // Normalize extra whitespace left behind by removed comments/title blocks.
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return `${body}\n`;
}

function buildFrontmatter(row) {
  const data = {
    title: cleanScalar(row.article_title),
    slug: cleanScalar(row.article_slug),
    excerpt: cleanScalar(row.excerpt),
    meta_title: cleanScalar(row.meta_title),
    meta_description: cleanScalar(row.meta_description),
    canonical_url: cleanScalar(row.canonical_url),
  };

  // Include optional fields only when present
  if (row.article_type) data.article_type = cleanScalar(row.article_type);
  if (row.competitor_name) data.competitor_name = cleanScalar(row.competitor_name);
  if (row.primary_keyword) data.primary_keyword = cleanScalar(row.primary_keyword);
  if (row.secondary_keywords) data.secondary_keywords = cleanScalar(row.secondary_keywords);

  // lineWidth: -1 disables line wrapping so each field stays on one line.
  // js-yaml only quotes values where plain scalars would be invalid or ambiguous.
  return yaml.dump(data, { lineWidth: -1 }).trim();
}

function buildMarkdown(row) {
  validateRow(row);

  const body = cleanMarkdownBody(row.article_body_markdown, row.article_title);
  return `---\n${buildFrontmatter(row)}\n---\n\n${body}`;
}

function buildTargetRelativePath(slug) {
  return `${slug}.md`;
}

module.exports = {
  cleanScalar,
  getRowId,
  validateRow,
  cleanMarkdownBody,
  buildFrontmatter,
  buildMarkdown,
  buildTargetRelativePath,
};
