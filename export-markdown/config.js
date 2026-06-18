const path = require('path');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

function resolveExportConfig() {
  return {
    outputDir: path.resolve(requiredEnv('EXPORT_MARKDOWN_DIR')),
  };
}

module.exports = { resolveExportConfig };
