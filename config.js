const fs = require('fs');
const path = require('path');

const PROJECT_CONFIG_PATH = path.join(__dirname, 'config', 'project.config.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'config', 'example.config.json');

let _config = null;

function loadConfig() {
  if (_config) return _config;

  const configPath = fs.existsSync(PROJECT_CONFIG_PATH) ? PROJECT_CONFIG_PATH : EXAMPLE_CONFIG_PATH;

  try {
    _config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`[config] Loaded from ${path.relative(process.cwd(), configPath)}`);
  } catch (err) {
    throw new Error(`Failed to load config from ${configPath}: ${err.message}`);
  }

  return _config;
}

function getCompanyName() {
  return loadConfig().company?.name || process.env.COMPANY_NAME || 'Your Company';
}

function getContextFilePath(key) {
  const config = loadConfig();
  return config.contextFiles?.[key] || null;
}

function getPromptFilePath(key) {
  const config = loadConfig();
  return config.prompts?.[key] || null;
}

// Load a context file by config key. Returns a fallback string if not found.
function loadContextFile(key, fallbackLabel) {
  const filePath = getContextFilePath(key);
  const label = fallbackLabel || key;

  if (!filePath) return `(${label} not configured — set contextFiles.${key} in your project.config.json)`;

  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, filePath);

  try {
    const content = fs.readFileSync(fullPath, 'utf8').trim();
    return content || `(${label} is empty at ${filePath})`;
  } catch {
    return `(${label} not found at ${filePath} — copy context/*.example.md to context/*.md and fill in your details)`;
  }
}

// Load a prompt template by config key (writer/judge/rewrite/research).
function loadPromptFile(key) {
  const filePath = getPromptFilePath(key) || `prompts/${key}Prompt.md`;

  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(__dirname, filePath);

  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
}

module.exports = { loadConfig, getCompanyName, loadContextFile, loadPromptFile, getContextFilePath, getPromptFilePath };
