#!/usr/bin/env node
// PublishRail UI — local web server
// Usage: node ui/server.js  (or: npm run ui)
// Opens at http://localhost:3737

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.UI_PORT || 3737;
const ENV_PATH = path.join(ROOT, '.env');

// ── .env read/write ────────────────────────────────────────────────────────

const WRITABLE_ENV_KEYS = new Set([
  'AI_PROVIDER', 'AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'AI_BASE_URL', 'AI_MODEL',
  'NOCODB_BASE_URL', 'NOCODB_API_TOKEN', 'NOCODB_TABLE_ID',
  'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO',
  'FRAMER_TOKEN', 'FRAMER_COLLECTION_ID',
]);

const SECRET_ENV_KEYS = new Set([
  'AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'NOCODB_API_TOKEN', 'GITHUB_TOKEN', 'FRAMER_TOKEN',
]);

function readDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    result[t.slice(0, eq).trim()] = t.slice(eq + 1);
  }
  return result;
}

function writeDotEnv(updates) {
  const toWrite = {};
  const toDelete = new Set();
  for (const [k, v] of Object.entries(updates)) {
    if (v === '') toDelete.add(k); else toWrite[k] = v;
  }

  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split('\n') : [];
  const remaining = { ...toWrite };

  lines = lines
    .filter((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return true;
      const eq = t.indexOf('=');
      return eq === -1 || !toDelete.has(t.slice(0, eq).trim());
    })
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      const eq = t.indexOf('=');
      if (eq === -1) return line;
      const key = t.slice(0, eq).trim();
      if (key in remaining) { const v = remaining[key]; delete remaining[key]; return `${key}=${v}`; }
      return line;
    });

  for (const [k, v] of Object.entries(remaining)) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n'), 'utf8');

  for (const [k, v] of Object.entries(updates)) {
    if (v === '') delete process.env[k]; else process.env[k] = v;
  }
}

// ── Static file helpers ────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || 'text/plain';
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────

const AUTH_TOKEN = process.env.PIPELINE_AUTH_TOKEN || '';

function isAuthenticated(req) {
  if (!AUTH_TOKEN) return true; // no token set → open (local dev)
  const header = req.headers['authorization'] || '';
  return header === `Bearer ${AUTH_TOKEN}`;
}

// ── Safe path helpers ──────────────────────────────────────────────────────

const ALLOWED_CONTEXT_KEYS = ['positioning', 'messaging', 'glossary', 'evaluationCriteria'];
const CONTEXT_FILE_MAP = {
  positioning: 'context/positioning.md',
  messaging: 'context/messaging.md',
  glossary: 'context/glossary.md',
  evaluationCriteria: 'context/evaluation-criteria.md',
};

const ALLOWED_PROMPT_KEYS = ['writer', 'judge', 'rewrite', 'research', 'blogPost', 'landingPage'];
const PROMPT_FILE_MAP = {
  writer: 'prompts/writerPrompt.md',
  judge: 'prompts/judgePrompt.md',
  rewrite: 'prompts/rewritePrompt.md',
  research: 'prompts/researchPrompt.md',
  blogPost: 'prompts/blogPostPrompt.md',
  landingPage: 'prompts/landingPagePrompt.md',
};

function safeRootPath(...parts) {
  const resolved = path.resolve(ROOT, ...parts);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

// ── Body reader ────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── Config helpers ─────────────────────────────────────────────────────────

function loadConfig() {
  const projectPath = safeRootPath('config', 'project.config.json');
  const examplePath = safeRootPath('config', 'example.config.json');
  const p = fs.existsSync(projectPath) ? projectPath : examplePath;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveConfig(data) {
  const p = safeRootPath('config', 'project.config.json');
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ── Article queue (inputs/articles.json) ──────────────────────────────────

function queuePath() {
  const cfg = loadConfig();
  const p = process.env.INPUT_JSON_PATH || cfg.source?.jsonPath || 'inputs/articles.json';
  return safeRootPath(p);
}

function loadQueue() {
  const p = queuePath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.rows || []);
  } catch { return []; }
}

function saveQueue(rows) {
  const p = queuePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(rows, null, 2));
}

// ── Outputs ────────────────────────────────────────────────────────────────

function listOutputs() {
  const dir = safeRootPath('outputs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.run.json'))
    .sort((a, b) => {
      const ta = fs.statSync(path.join(dir, a)).mtimeMs;
      const tb = fs.statSync(path.join(dir, b)).mtimeMs;
      return tb - ta;
    })
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return {
          filename: f,
          article_title: data.article_title || data._meta?.article_title_source || f,
          article_type: data.article_type || data._meta?.article_type || '',
          quality_score: data.quality_score || 0,
          generated_at: data.generated_at || '',
        };
      } catch { return { filename: f }; }
    });
}

// ── JSON response ──────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Env-status endpoint ────────────────────────────────────────────────────

const ENV_VARS_TO_CHECK = [
  'AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'NOCODB_BASE_URL', 'NOCODB_API_TOKEN', 'NOCODB_TABLE_ID',
  'GOOGLE_SERVICE_ACCOUNT_KEY_PATH', 'GOOGLE_SPREADSHEET_ID',
  'FRAMER_TOKEN', 'FRAMER_COLLECTION_ID',
  'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO',
  'INPUT_CSV_PATH', 'INPUT_JSON_PATH',
  'EXPORT_MARKDOWN_DIR',
];

function getEnvStatus() {
  const status = {};
  for (const key of ENV_VARS_TO_CHECK) {
    status[key] = !!(process.env[key] && process.env[key].trim() !== '');
  }
  // Actual values (not just presence) so the UI can adapt to custom providers
  status._aiModel    = process.env.AI_MODEL    || '';
  status._aiProvider = process.env.AI_PROVIDER || 'anthropic';
  return status;
}

// ── SSE generation endpoint ────────────────────────────────────────────────

function handleGenerate(req, res, params) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const source  = params.get('source') || 'json';
  const limit   = params.get('limit')  || '1';
  const dryRun  = params.get('dry_run') === '1';
  const output  = params.get('output') || '';

  const args = ['index.js', `--source=${source}`, `--limit=${limit}`];
  if (dryRun) args.push('--dry-run');
  if (output) args.push(`--output=${output}`);

  const send = (text) => res.write(`data: ${JSON.stringify(text)}\n\n`);

  send(`[ui] Starting: node ${args.join(' ')}\n`);

  const child = spawn('node', args, { cwd: ROOT, env: { ...process.env } });

  child.stdout.on('data', (d) => send(d.toString()));
  child.stderr.on('data', (d) => send(d.toString()));
  child.on('close', (code) => {
    send(`\n[ui] Process exited with code ${code}\n`);
    res.write(`event: done\ndata: ${JSON.stringify({ code })}\n\n`);
    res.end();
  });

  req.on('close', () => child.kill('SIGTERM'));
}

// ── Router ─────────────────────────────────────────────────────────────────

async function router(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Auth check (unauthenticated — lets the client know if a token is required)
  if (pathname === '/api/auth-check' && method === 'GET') {
    return json(res, { required: !!AUTH_TOKEN });
  }

  // Protect all other API routes
  if (pathname.startsWith('/api/') && !isAuthenticated(req)) {
    return json(res, { error: 'Unauthorized' }, 401);
  }

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(PUBLIC, 'index.html'));
  }
  if (!pathname.startsWith('/api/')) {
    const filePath = path.join(PUBLIC, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStatic(res, filePath);
    }
    return serveStatic(res, path.join(PUBLIC, 'index.html'));
  }

  try {
    // ── Env status ───────────────────────────────────────────────────────────
    if (pathname === '/api/env-status' && method === 'GET') {
      return json(res, getEnvStatus());
    }

    // ── Config ──────────────────────────────────────────────────────────────
    if (pathname === '/api/config') {
      if (method === 'GET') return json(res, loadConfig());
      if (method === 'POST') {
        const body = await readBody(req);
        saveConfig(JSON.parse(body));
        return json(res, { ok: true });
      }
    }

    // ── Context files ────────────────────────────────────────────────────────
    const ctxMatch = pathname.match(/^\/api\/context\/(\w+)$/);
    if (ctxMatch) {
      const key = ctxMatch[1];
      if (!ALLOWED_CONTEXT_KEYS.includes(key)) return json(res, { error: 'Unknown context key' }, 400);
      const filePath = safeRootPath(CONTEXT_FILE_MAP[key]);
      if (method === 'GET') {
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const example = filePath.replace(/\.md$/, '.example.md');
        const exampleContent = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '';
        return json(res, { content, example: exampleContent });
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const { content } = JSON.parse(body);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return json(res, { ok: true });
      }
    }

    // ── Prompt files ─────────────────────────────────────────────────────────
    const promptMatch = pathname.match(/^\/api\/prompts\/(\w+)$/);
    if (promptMatch) {
      const key = promptMatch[1];
      if (!ALLOWED_PROMPT_KEYS.includes(key)) return json(res, { error: 'Unknown prompt key' }, 400);
      const filePath = safeRootPath(PROMPT_FILE_MAP[key]);
      if (method === 'GET') {
        const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const examplePath = filePath.replace(/\.md$/, '.example.md');
        const example = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
        return json(res, { content, example });
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const { content } = JSON.parse(body);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return json(res, { ok: true });
      }
    }

    // ── Article queue ─────────────────────────────────────────────────────────
    if (pathname === '/api/articles') {
      if (method === 'GET') return json(res, loadQueue());
      if (method === 'POST') {
        const body = await readBody(req);
        const article = JSON.parse(body);
        const rows = loadQueue();
        const maxId = rows.reduce((m, r) => Math.max(m, r.Id || 0), 0);
        article.Id = maxId + 1;
        if (!article.article_status) article.article_status = 'not_started';
        rows.push(article);
        saveQueue(rows);
        return json(res, article);
      }
    }

    const articleMatch = pathname.match(/^\/api\/articles\/(\d+)$/);
    if (articleMatch) {
      const id = parseInt(articleMatch[1], 10);
      if (method === 'PUT') {
        const body = await readBody(req);
        const updated = JSON.parse(body);
        const rows = loadQueue();
        const idx = rows.findIndex((r) => r.Id === id);
        if (idx === -1) return json(res, { error: 'Not found' }, 404);
        rows[idx] = { ...rows[idx], ...updated, Id: id };
        saveQueue(rows);
        return json(res, rows[idx]);
      }
      if (method === 'DELETE') {
        const rows = loadQueue().filter((r) => r.Id !== id);
        saveQueue(rows);
        return json(res, { ok: true });
      }
    }

    // ── Outputs ───────────────────────────────────────────────────────────────
    if (pathname === '/api/outputs') {
      return json(res, listOutputs());
    }

    const outputMatch = pathname.match(/^\/api\/outputs\/(.+)$/);
    if (outputMatch) {
      const filename = decodeURIComponent(outputMatch[1]);
      if (filename.includes('..') || filename.includes('/')) {
        return json(res, { error: 'Invalid filename' }, 400);
      }
      const filePath = safeRootPath('outputs', filename);
      if (!fs.existsSync(filePath)) return json(res, { error: 'Not found' }, 404);
      return json(res, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    }

    // ── Env vars (read/write .env) ────────────────────────────────────────────
    if (pathname === '/api/env' && method === 'GET') {
      const dotenv = readDotEnv();
      const result = {};
      for (const key of WRITABLE_ENV_KEYS) {
        const val = dotenv[key] ?? '';
        result[key] = (SECRET_ENV_KEYS.has(key) && val) ? '__set__' : val;
      }
      return json(res, result);
    }

    if (pathname === '/api/env' && method === 'POST') {
      const body = await readBody(req);
      const incoming = JSON.parse(body);
      const safe = {};
      for (const [key, val] of Object.entries(incoming)) {
        if (WRITABLE_ENV_KEYS.has(key) && val !== '__set__') safe[key] = String(val);
      }
      if (Object.keys(safe).length) writeDotEnv(safe);
      return json(res, { ok: true });
    }

    // ── File upload ───────────────────────────────────────────────────────────
    if (pathname === '/api/upload' && method === 'POST') {
      const type = url.searchParams.get('type');
      if (!['json', 'csv'].includes(type)) return json(res, { error: 'Invalid type' }, 400);
      const body = await readBody(req);
      if (!body.trim()) return json(res, { error: 'Empty file' }, 400);
      const cfg  = loadConfig();
      const dest = type === 'json'
        ? safeRootPath(process.env.INPUT_JSON_PATH || cfg.source?.jsonPath || 'inputs/articles.json')
        : safeRootPath(process.env.INPUT_CSV_PATH  || cfg.source?.csvPath  || 'inputs/articles.csv');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body, 'utf8');
      return json(res, { ok: true });
    }

    // ── Generate (SSE) ────────────────────────────────────────────────────────
    if (pathname === '/api/generate' && method === 'GET') {
      return handleGenerate(req, res, url.searchParams);
    }

    json(res, { error: 'Not found' }, 404);

  } catch (err) {
    console.error('[server error]', err);
    json(res, { error: err.message }, 500);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────

const server = http.createServer(router);
server.listen(PORT, () => {
  console.log(`\n  PublishRail UI`);
  console.log(`  Running at http://localhost:${PORT}\n`);
});
