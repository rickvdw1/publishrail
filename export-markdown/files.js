const fs = require('fs');
const path = require('path');

const { buildMarkdown, buildTargetRelativePath, validateRow } = require('./content');

function writeMarkdownFile(outputDir, row) {
  validateRow(row);

  const relativePath = buildTargetRelativePath(row.article_slug);
  const filePath = path.join(outputDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const nextContent = buildMarkdown(row);
  const prevContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  fs.writeFileSync(filePath, nextContent);

  return {
    filePath,
    relativePath,
    changed: prevContent !== nextContent,
  };
}

module.exports = { writeMarkdownFile };
