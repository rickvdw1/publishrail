const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadConfig } = require('../config');

function resolveOutputDir(config) {
  const cfg = config || loadConfig();
  const dir = process.env.EXPORT_MARKDOWN_DIR
    || cfg.output?.markdown?.outputDir
    || cfg.output?.markdownDir          // legacy key
    || 'outputs/markdown';
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

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
  if (!row.article_body_markdown?.trim()) {
    throw new Error(`Row ${rowId} is missing article_body_markdown`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMarkdownBody(markdown, title) {
  let body = String(markdown || '').replace(/\r\n/g, '\n');

  // Strip JSON-escaping artifacts
  body = body.replace(/\\(["'])/g, '$1');

  // Strip HTML comments (embedded metadata and build notes)
  body = body.replace(/<!--[\s\S]*?-->/g, '');

  // Drop a leading H1 that duplicates the frontmatter title
  const trimmedTitle = String(title || '').trim();
  if (trimmedTitle) {
    const titlePattern = new RegExp(`^\\s*#\\s+${escapeRegExp(trimmedTitle)}\\s*\\n+`, 'i');
    body = body.replace(titlePattern, '');
  }

  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return `${body}\n`;
}

function buildFrontmatter(row, config) {
  const cfg = config || loadConfig();
  const metaFormat = cfg.output?.markdown?.metadataFormat
    || cfg.output?.metadataFormat    // legacy key
    || 'frontmatter';

  if (metaFormat !== 'frontmatter') return null;

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

  return yaml.dump(data, { lineWidth: -1 }).trim();
}

function buildMarkdown(row, config) {
  validateRow(row);

  const body = cleanMarkdownBody(row.article_body_markdown, row.article_title);
  const frontmatter = buildFrontmatter(row, config);

  if (frontmatter) {
    return `---\n${frontmatter}\n---\n\n${body}`;
  }
  return body;
}

function writeMarkdownFile(row, outputDir, config) {
  const dir = outputDir || resolveOutputDir(config);
  validateRow(row);

  const relativePath = `${row.article_slug}.md`;
  const filePath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const nextContent = buildMarkdown(row, config);
  const prevContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  fs.writeFileSync(filePath, nextContent);

  return { filePath, relativePath, changed: prevContent !== nextContent };
}

function publishToMarkdown(rows, outputDir, config) {
  const dir = outputDir || resolveOutputDir(config);
  return rows.map((row) => writeMarkdownFile(row, dir, config));
}

// publish(article, config, { dryRun }) → Promise<{ ok, message, path? }>
async function publish(article, config, { dryRun = false } = {}) {
  const cfg = config || loadConfig();
  const markdownCfg = cfg.output?.markdown || {};

  if (markdownCfg.enabled === false) {
    return { ok: false, message: 'Markdown publishing is disabled in config.' };
  }

  const outputDir = resolveOutputDir(cfg);

  if (dryRun) {
    const slug = article.article_slug || 'untitled';
    const filePath = path.join(outputDir, `${slug}.md`);
    console.log(`[markdown] DRY RUN — would write: ${filePath}`);
    return { ok: true, message: `Dry run — would write ${slug}.md to ${outputDir}`, path: filePath };
  }

  const { filePath, relativePath, changed } = writeMarkdownFile(article, outputDir, cfg);
  const action = changed ? 'Written' : 'Unchanged';
  return { ok: true, message: `${action}: ${filePath}`, path: filePath };
}

module.exports = {
  publish,
  publishToMarkdown,
  writeMarkdownFile,
  buildMarkdown,
  buildFrontmatter,
  cleanMarkdownBody,
  resolveOutputDir,
  getRowId,
};
