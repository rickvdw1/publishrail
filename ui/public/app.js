/* global EventSource */
'use strict';

// ── Auth ───────────────────────────────────────────────────────────────────

function getStoredToken() { return sessionStorage.getItem('pipeline_token') || ''; }
function setStoredToken(t) { sessionStorage.setItem('pipeline_token', t); }
function clearStoredToken() { sessionStorage.removeItem('pipeline_token'); }

function showLoginModal() {
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-token').value = '';
  document.getElementById('login-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('login-token').focus(), 50);
}

async function initAuth() {
  const { required } = await fetch('/api/auth-check').then((r) => r.json()).catch(() => ({ required: false }));
  if (!required) return;
  if (!getStoredToken()) { showLoginModal(); return; }
  // Verify the stored token is still valid
  const check = await fetch('/api/env-status', {
    headers: { Authorization: `Bearer ${getStoredToken()}` },
  });
  if (check.status === 401) { clearStoredToken(); showLoginModal(); }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const token = document.getElementById('login-token').value.trim();
  if (!token) return;
  const res = await fetch('/api/env-status', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    setStoredToken(token);
    document.getElementById('login-modal').style.display = 'none';
    showPage('home');
  } else {
    document.getElementById('login-error').style.display = '';
  }
});

document.getElementById('login-token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-btn').click();
});

// ── API helpers ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getStoredToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) { clearStoredToken(); showLoginModal(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}`);
  return res.json();
}

const get  = (p)    => api('GET',    p);
const post = (p, b) => api('POST',   p, b);
const put  = (p, b) => api('PUT',    p, b);
const del  = (p)    => api('DELETE', p);

// ── Navigation ─────────────────────────────────────────────────────────────

let currentPage = 'home';

function showPage(name) {
  document.querySelectorAll('.page').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('#nav a').forEach((a) => a.classList.remove('active'));
  const page = document.getElementById(`page-${name}`);
  const link = document.querySelector(`#nav a[data-page="${name}"]`);
  if (page) page.classList.add('active');
  if (link) link.classList.add('active');
  currentPage = name;
  onPageEnter(name);
}

function onPageEnter(name) {
  if (name === 'home')       loadDashboard();
  if (name === 'sources')    loadSources();
  if (name === 'knowledge')  loadContextPage();
  if (name === 'prompts')    loadPromptsPage();
  if (name === 'queue')      loadArticles();
  if (name === 'outputs')    loadOutputs();
  if (name === 'publishers') loadPublishers();
  if (name === 'settings')   loadSettings();
  if (name === 'generate')   updateOutputTargetWarnings();
}

document.querySelectorAll('#nav a').forEach((a) => {
  a.addEventListener('click', () => showPage(a.dataset.page));
});

// ── Env status cache ───────────────────────────────────────────────────────

let _envStatus = null;

async function getEnvStatus() {
  if (_envStatus) return _envStatus;
  try {
    _envStatus = await get('/env-status');
  } catch (e) {
    console.error('Failed to load env status:', e);
    _envStatus = {};
  }
  return _envStatus;
}

function refreshEnvStatus() {
  _envStatus = null;
}

// ── Dashboard / Home ───────────────────────────────────────────────────────

async function loadDashboard() {
  const errEl = document.getElementById('dashboard-error');
  if (errEl) errEl.remove();
  try {
    const [queue, outputs, cfg, envStatus] = await Promise.all([
      get('/articles').catch(() => []),
      get('/outputs').catch(() => []),
      get('/config').catch(() => ({})),
      getEnvStatus(),
    ]);

    const queued = queue.filter((r) => !r.article_status || r.article_status === 'not_started').length;
    document.getElementById('stat-queued').textContent  = queued;
    document.getElementById('stat-outputs').textContent = outputs.length;
    document.getElementById('stat-provider').textContent = cfg.ai?.provider || 'anthropic';
    document.getElementById('stat-model').textContent = cfg.generation?.writerModel
      ? `writer: ${cfg.generation.writerModel}` : 'model: opus';

    // Pipeline rail
    const sourceType = cfg.source?.type || 'json';
    const aiModel    = cfg.generation?.writerModel || 'opus';
    const targets    = cfg.output?.targets || ['markdown'];
    document.getElementById('pipe-source-val').textContent   = sourceType;
    document.getElementById('pipe-ai-val').textContent       = aiModel;
    document.getElementById('pipe-publish-val').textContent  = targets.join(', ');
    document.getElementById('pipe-generate-val').textContent = cfg.generation?.enableJudge ? 'judge on' : 'ready';

    // Source node status
    const hasSource = sourceType !== 'nocodb' ||
      (envStatus['NOCODB_API_TOKEN'] && envStatus['NOCODB_BASE_URL']);
    document.getElementById('pipe-source').className = `pipe-node ${hasSource ? 'ready' : 'warn'}`;

    // Publisher readiness
    const outputDir  = cfg.output?.markdown?.outputDir || 'outputs/markdown';
    const githubReady = envStatus['GITHUB_TOKEN'] && cfg.output?.github?.enabled &&
      envStatus['GITHUB_OWNER'] && envStatus['GITHUB_REPO'];
    const framerReady = envStatus['FRAMER_TOKEN'] && cfg.output?.framer?.enabled &&
      envStatus['FRAMER_COLLECTION_ID'];

    const readyBadge = (ok) => ok
      ? '<span class="badge badge-green">Ready</span>'
      : '<span class="badge badge-gray">Not configured</span>';

    const pubBody = document.getElementById('publisher-status-body');
    pubBody.innerHTML = `<table style="width:100%"><thead><tr>
      <th>Publisher</th><th>Status</th><th>Notes</th>
    </tr></thead><tbody>
      <tr class="publisher-status-row">
        <td><strong>Markdown</strong></td>
        <td>${readyBadge(true)}</td>
        <td class="text-muted text-sm">${esc(outputDir)}</td>
      </tr>
      <tr class="publisher-status-row">
        <td><strong>GitHub</strong></td>
        <td>${readyBadge(!!githubReady)}</td>
        <td class="text-muted text-sm">${envStatus['GITHUB_TOKEN'] ? 'Token set' : 'GITHUB_TOKEN missing'}${cfg.output?.github?.enabled ? '' : ' · disabled in config'}</td>
      </tr>
      <tr class="publisher-status-row">
        <td><strong>Framer</strong></td>
        <td>${readyBadge(!!framerReady)}</td>
        <td class="text-muted text-sm">${envStatus['FRAMER_TOKEN'] ? 'Token set' : 'FRAMER_TOKEN missing'}${cfg.output?.framer?.enabled ? '' : ' · disabled in config'}</td>
      </tr>
    </tbody></table>`;

    // Recent outputs
    const recent = outputs.slice(0, 5);
    const body = document.getElementById('recent-outputs-body');
    if (recent.length === 0) {
      body.innerHTML = `<div class="empty-state">
        <div class="empty-icon">&#9672;</div>
        <h4>No outputs yet</h4>
        <p>Run the pipeline to generate your first article.</p>
        <button class="btn btn-primary btn-sm" onclick="showPage('generate')">Go to Generate</button>
      </div>`;
    } else {
      body.innerHTML = `<table style="width:100%"><thead><tr>
        <th>Title</th><th>Type</th><th>Score</th><th>Generated</th>
      </tr></thead><tbody>${recent.map((o) => `<tr>
        <td class="truncate">${esc(o.article_title || o.filename)}</td>
        <td>${badge(o.article_type)}</td>
        <td>${scoreBadge(o.quality_score)}</td>
        <td class="text-muted text-sm">${fmtDate(o.generated_at)}</td>
      </tr>`).join('')}</tbody></table>`;
    }
  } catch (e) {
    const main = document.getElementById('page-home');
    const errDiv = document.createElement('div');
    errDiv.id = 'dashboard-error';
    errDiv.className = 'notice warn mt-2';
    errDiv.textContent = `Dashboard error: ${e.message}`;
    main.prepend(errDiv);
    console.error(e);
  }
}

// ── Sources ────────────────────────────────────────────────────────────────

async function loadSources() {
  try {
    const cfg = await get('/config');
    const src = cfg.source?.type || 'json';
    document.getElementById('cfg-source-type').value = src;
    selectSource(src, false);

    if (src === 'nocodb') {
      document.getElementById('cfg-nocodb-base-url-env').value = cfg.source?.baseUrlEnv   || 'NOCODB_BASE_URL';
      document.getElementById('cfg-nocodb-token-env').value    = cfg.source?.apiTokenEnv  || 'NOCODB_API_TOKEN';
      document.getElementById('cfg-nocodb-table-env').value    = cfg.source?.tableIdEnv   || 'NOCODB_TABLE_ID';
    }
  } catch (e) { console.error(e); }
}

function selectSource(type, save) {
  document.querySelectorAll('.source-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.source === type);
  });
  document.getElementById('cfg-source-type').value = type;
  document.getElementById('nocodb-config').style.display = type === 'nocodb' ? '' : 'none';
  if (save !== false) {
    // auto-update hidden field; user must still click Save
  }
}
window.selectSource = selectSource;

document.getElementById('save-sources-btn').addEventListener('click', async () => {
  const status = document.getElementById('save-sources-status');
  try {
    const cfg = await get('/config');
    const srcType = document.getElementById('cfg-source-type').value;
    cfg.source = { ...cfg.source, type: srcType };
    if (srcType === 'nocodb') {
      cfg.source.baseUrlEnv  = document.getElementById('cfg-nocodb-base-url-env').value.trim() || 'NOCODB_BASE_URL';
      cfg.source.apiTokenEnv = document.getElementById('cfg-nocodb-token-env').value.trim()    || 'NOCODB_API_TOKEN';
      cfg.source.tableIdEnv  = document.getElementById('cfg-nocodb-table-env').value.trim()    || 'NOCODB_TABLE_ID';
    }
    await post('/config', cfg);
    status.textContent = 'Saved!';
    status.style.color = 'var(--success)';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.style.color = 'var(--danger)';
  }
});

// ── Settings ───────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const cfg = await get('/config');
    document.getElementById('cfg-company-name').value  = cfg.company?.name || '';
    document.getElementById('cfg-project-name').value  = cfg.projectName || '';
    document.getElementById('cfg-product-desc').value  = cfg.company?.productDescription || '';
    document.getElementById('cfg-ai-provider').value   = cfg.ai?.provider || 'anthropic';
    document.getElementById('cfg-article-type').value  = cfg.articleType || 'comparison';
    document.getElementById('cfg-writer-model').value  = cfg.generation?.writerModel || 'opus';
    document.getElementById('cfg-judge-model').value   = cfg.generation?.judgeModel || 'sonnet';
    updateOpenAIHint();
  } catch (e) {
    console.error(e);
  }
}

function updateOpenAIHint() {
  const el = document.getElementById('openai-hint');
  if (!el) return;
  const provider = document.getElementById('cfg-ai-provider').value;
  el.style.display = provider === 'openai' ? '' : 'none';
}
document.getElementById('cfg-ai-provider').addEventListener('change', updateOpenAIHint);

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const status = document.getElementById('save-settings-status');
  try {
    const cfg = await get('/config');
    cfg.projectName = document.getElementById('cfg-project-name').value;
    cfg.company = {
      name:               document.getElementById('cfg-company-name').value,
      productDescription: document.getElementById('cfg-product-desc').value,
    };
    cfg.ai = { provider: document.getElementById('cfg-ai-provider').value };
    cfg.articleType = document.getElementById('cfg-article-type').value;
    cfg.generation  = {
      ...cfg.generation,
      writerModel: document.getElementById('cfg-writer-model').value,
      judgeModel:  document.getElementById('cfg-judge-model').value,
    };

    const apiKey = document.getElementById('cfg-api-key').value;
    const baseUrl = document.getElementById('cfg-base-url').value;
    const model   = document.getElementById('cfg-model').value;
    if (apiKey || baseUrl || model) {
      status.textContent = 'Tip: API key / base URL / model override go in your .env file, not config.';
      status.style.color = 'var(--warning)';
    }

    await post('/config', cfg);
    refreshEnvStatus();
    if (!apiKey && !baseUrl && !model) {
      status.textContent = 'Saved!';
      status.style.color = 'var(--success)';
      setTimeout(() => { status.textContent = ''; }, 2500);
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.style.color = 'var(--danger)';
  }
});

// ── Publishers ─────────────────────────────────────────────────────────────

async function loadPublishers() {
  try {
    const [cfg, envStatus] = await Promise.all([get('/config'), getEnvStatus()]);

    // Markdown
    const md = cfg.output?.markdown || {};
    document.getElementById('cfg-markdown-dir').value = md.outputDir || 'outputs/markdown';

    // GitHub
    const gh = cfg.output?.github || {};
    document.getElementById('cfg-github-enabled').checked   = !!gh.enabled;
    document.getElementById('cfg-github-token-env').value   = gh.tokenEnv || 'GITHUB_TOKEN';
    document.getElementById('cfg-github-owner-env').value   = gh.ownerEnv || 'GITHUB_OWNER';
    document.getElementById('cfg-github-repo-env').value    = gh.repoEnv  || 'GITHUB_REPO';
    document.getElementById('cfg-github-branch').value      = gh.branch   || 'main';
    document.getElementById('cfg-github-folder').value      = gh.folder   || 'content/articles';
    document.getElementById('cfg-github-overwrite').checked = !!gh.overwriteExisting;
    document.getElementById('github-token-warning').style.display = envStatus['GITHUB_TOKEN'] ? 'none' : '';

    // Framer
    const fr = cfg.output?.framer || {};
    document.getElementById('cfg-framer-enabled').checked         = !!fr.enabled;
    document.getElementById('cfg-framer-token-env').value         = fr.tokenEnv        || 'FRAMER_TOKEN';
    document.getElementById('cfg-framer-collection-env').value    = fr.collectionIdEnv || 'FRAMER_COLLECTION_ID';
    const fm = fr.fieldMapping || { title: 'title', slug: 'slug', body: 'content', description: 'description' };
    document.getElementById('cfg-framer-field-mapping').value     = JSON.stringify(fm, null, 2);
    document.getElementById('framer-token-warning').style.display = envStatus['FRAMER_TOKEN'] ? 'none' : '';

    const frMode = fr.mode || 'single-body';
    document.getElementById('cfg-framer-mode').value              = frMode;
    document.getElementById('cfg-framer-body-field').value        = fr.bodyField || 'content';
    document.getElementById('cfg-framer-intro-field').value       = fr.introField || '';
    document.getElementById('cfg-framer-section-matching').value  = fr.sectionMatching || 'exact';
    document.getElementById('cfg-framer-unmapped-sections').value = fr.unmappedSections || 'ignore';
    document.getElementById('cfg-framer-require-mapped').checked  = !!fr.requireMappedSections;
    const sm = fr.sectionMapping || {};
    document.getElementById('cfg-framer-section-mapping').value   = Object.keys(sm).length ? JSON.stringify(sm, null, 2) : '';
    document.getElementById('framer-section-options').style.display = frMode === 'section-mapped' ? '' : 'none';
  } catch (e) {
    console.error(e);
  }
}

function updateFramerModeUI() {
  const mode = document.getElementById('cfg-framer-mode').value;
  document.getElementById('framer-section-options').style.display = mode === 'section-mapped' ? '' : 'none';
}
document.getElementById('cfg-framer-mode').addEventListener('change', updateFramerModeUI);

document.getElementById('save-publishers-btn').addEventListener('click', async () => {
  const status = document.getElementById('save-publishers-status');
  try {
    const cfg = await get('/config');

    // Parse Framer field mapping
    let framerFieldMapping = { title: 'title', slug: 'slug', body: 'content', description: 'description' };
    try {
      framerFieldMapping = JSON.parse(document.getElementById('cfg-framer-field-mapping').value || '{}');
    } catch {
      status.textContent = 'Framer field mapping is not valid JSON.';
      status.style.color = 'var(--danger)';
      return;
    }

    // Parse Framer section mapping
    let framerSectionMapping = {};
    const rawSectionMapping = document.getElementById('cfg-framer-section-mapping').value.trim();
    if (rawSectionMapping) {
      try {
        framerSectionMapping = JSON.parse(rawSectionMapping);
      } catch {
        status.textContent = 'Framer section mapping is not valid JSON.';
        status.style.color = 'var(--danger)';
        return;
      }
    }

    const framerMode       = document.getElementById('cfg-framer-mode').value;
    const framerIntroField = document.getElementById('cfg-framer-intro-field').value.trim();

    cfg.output = {
      ...(cfg.output || {}),
      markdown: {
        enabled:        true,
        outputDir:      document.getElementById('cfg-markdown-dir').value.trim() || 'outputs/markdown',
        metadataFormat: 'frontmatter',
      },
      github: {
        enabled:           document.getElementById('cfg-github-enabled').checked,
        tokenEnv:          document.getElementById('cfg-github-token-env').value.trim() || 'GITHUB_TOKEN',
        ownerEnv:          document.getElementById('cfg-github-owner-env').value.trim() || 'GITHUB_OWNER',
        repoEnv:           document.getElementById('cfg-github-repo-env').value.trim()  || 'GITHUB_REPO',
        branch:            document.getElementById('cfg-github-branch').value.trim()    || 'main',
        folder:            document.getElementById('cfg-github-folder').value.trim()    || 'content/articles',
        overwriteExisting: document.getElementById('cfg-github-overwrite').checked,
      },
      framer: {
        enabled:               document.getElementById('cfg-framer-enabled').checked,
        tokenEnv:              document.getElementById('cfg-framer-token-env').value.trim()      || 'FRAMER_TOKEN',
        collectionIdEnv:       document.getElementById('cfg-framer-collection-env').value.trim() || 'FRAMER_COLLECTION_ID',
        mode:                  framerMode,
        fieldMapping:          framerFieldMapping,
        sectionMapping:        framerSectionMapping,
        bodyField:             document.getElementById('cfg-framer-body-field').value.trim()  || 'content',
        introField:            framerIntroField || null,
        sectionMatching:       document.getElementById('cfg-framer-section-matching').value,
        unmappedSections:      document.getElementById('cfg-framer-unmapped-sections').value,
        requireMappedSections: document.getElementById('cfg-framer-require-mapped').checked,
      },
    };

    await post('/config', cfg);
    refreshEnvStatus();
    status.textContent = 'Saved!';
    status.style.color = 'var(--success)';
    setTimeout(() => { status.textContent = ''; }, 2500);
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.style.color = 'var(--danger)';
  }
});

// ── Context files ──────────────────────────────────────────────────────────

const CTX_KEYS = ['positioning', 'messaging', 'glossary', 'evaluationCriteria'];
let ctxLoaded = {};

async function loadContextPage() {
  for (const key of CTX_KEYS) {
    if (ctxLoaded[key]) continue;
    try {
      const data = await get(`/context/${key}`);
      const ta = document.querySelector(`.ctx-editor[data-key="${key}"]`);
      if (ta && !ta.dataset.type) ta.value = data.content || '';
      if (ta) ta._example = data.example || '';
      ctxLoaded[key] = true;
    } catch (e) { console.error(e); }
  }
}

// Context tabs
document.querySelectorAll('#context-tabs .tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#context-tabs .tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('#context-panes .tab-pane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(`ctx-${t.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('.ctx-save').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const key    = btn.dataset.key;
    const ta     = document.querySelector(`.ctx-editor[data-key="${key}"]`);
    const status = btn.parentElement.querySelector('.ctx-status');
    try {
      await post(`/context/${key}`, { content: ta.value });
      ctxLoaded[key] = false;
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
    }
  });
});

document.querySelectorAll('.ctx-example').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    const ta  = document.querySelector(`.ctx-editor[data-key="${key}"]`);
    if (ta && ta._example) ta.value = ta._example;
  });
});

// ── Prompt files ───────────────────────────────────────────────────────────

const PROMPT_KEYS = ['writer', 'blogPost', 'landingPage', 'judge', 'rewrite', 'research'];
let promptsLoaded = {};

async function loadPromptsPage() {
  for (const key of PROMPT_KEYS) {
    if (promptsLoaded[key]) continue;
    try {
      const data = await get(`/prompts/${key}`);
      const ta = document.querySelector(`#prompt-${key} .ctx-editor`);
      if (ta) ta.value = data.content || '';
      promptsLoaded[key] = true;
    } catch (e) { console.error(e); }
  }
}

document.querySelectorAll('#prompt-tabs .tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#prompt-tabs .tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('#prompt-panes .tab-pane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(`prompt-${t.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('.prompt-save').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const key    = btn.dataset.key;
    const ta     = document.querySelector(`#prompt-${key} .ctx-editor`);
    const status = btn.parentElement.querySelector('.prompt-status');
    try {
      await post(`/prompts/${key}`, { content: ta.value });
      promptsLoaded[key] = false;
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
    }
  });
});

// ── Article queue ──────────────────────────────────────────────────────────

let articles = [];
let editingId = null;

async function loadArticles() {
  try {
    articles = await get('/articles');
    renderArticles();
  } catch (e) {
    const tbody = document.getElementById('articles-tbody');
    tbody.innerHTML = `<tr><td colspan="7"><div class="notice warn">Failed to load articles: ${esc(e.message)}</div></td></tr>`;
    console.error(e);
  }
}

function renderArticles() {
  const tbody = document.getElementById('articles-tbody');
  if (articles.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-icon">&#9776;</div>
      <h4>No articles queued</h4>
      <p>Click "+ Add article" to stage your first article for generation.</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = articles.map((a) => `<tr>
    <td class="text-muted text-sm">${a.Id}</td>
    <td class="truncate">${esc(a.article_title || '(untitled)')}</td>
    <td>${badge(a.article_type || 'comparison')}</td>
    <td>${esc(a.competitor_name || '—')}</td>
    <td class="text-mono truncate">${esc(a.primary_keyword || '—')}</td>
    <td>${statusBadge(a.article_status)}</td>
    <td>
      <div class="flex gap-2">
        <button class="btn btn-secondary btn-sm" onclick="editArticle(${a.Id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteArticle(${a.Id})">Delete</button>
      </div>
    </td>
  </tr>`).join('');
}

document.getElementById('new-article-btn').addEventListener('click', () => openArticleModal(null));
document.getElementById('article-modal-close').addEventListener('click', closeArticleModal);
document.getElementById('article-modal-cancel').addEventListener('click', closeArticleModal);

function openArticleModal(id) {
  editingId = id;
  const a = id ? articles.find((x) => x.Id === id) : null;
  document.getElementById('article-modal-title').textContent = id ? 'Edit article' : 'Add article';

  document.getElementById('art-title').value            = a?.article_title || '';
  document.getElementById('art-slug').value             = a?.article_slug || '';
  document.getElementById('art-type').value             = a?.article_type || 'comparison';
  document.getElementById('art-status').value           = a?.article_status || 'not_started';
  document.getElementById('art-description').value      = a?.description || '';
  document.getElementById('art-competitor').value       = a?.competitor_name || '';
  document.getElementById('art-category').value         = a?.competitor_category || '';
  document.getElementById('art-angle').value            = a?.comparison_angle || '';
  document.getElementById('art-personas').value         = a?.target_personas || '';
  document.getElementById('art-strengths').value        = a?.competitor_strengths || '';
  document.getElementById('art-limitations').value      = a?.competitor_limitations || '';
  document.getElementById('art-differentiators').value  = a?.product_differentiators || '';
  document.getElementById('art-keyword').value          = a?.primary_keyword || '';
  document.getElementById('art-secondary').value        = a?.secondary_keywords || '';

  // Reset to basic tab
  document.querySelectorAll('#article-modal-tabs .tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.atab-pane').forEach((p) => p.style.display = 'none');
  document.querySelector('#article-modal-tabs .tab[data-atab="basic"]').classList.add('active');
  document.getElementById('atab-basic').style.display = '';

  document.getElementById('article-modal').style.display = 'flex';
}

function closeArticleModal() {
  document.getElementById('article-modal').style.display = 'none';
  editingId = null;
}

document.querySelectorAll('#article-modal-tabs .tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#article-modal-tabs .tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.atab-pane').forEach((p) => p.style.display = 'none');
    t.classList.add('active');
    document.getElementById(`atab-${t.dataset.atab}`).style.display = '';
  });
});

document.getElementById('article-modal-save').addEventListener('click', async () => {
  const title = document.getElementById('art-title').value.trim();
  if (!title) { alert('Article title is required.'); return; }

  const row = {
    article_title:           title,
    article_slug:            document.getElementById('art-slug').value.trim(),
    article_type:            document.getElementById('art-type').value,
    article_status:          document.getElementById('art-status').value,
    description:             document.getElementById('art-description').value.trim(),
    competitor_name:         document.getElementById('art-competitor').value.trim(),
    competitor_category:     document.getElementById('art-category').value.trim(),
    comparison_angle:        document.getElementById('art-angle').value.trim(),
    target_personas:         document.getElementById('art-personas').value.trim(),
    competitor_strengths:    document.getElementById('art-strengths').value.trim(),
    competitor_limitations:  document.getElementById('art-limitations').value.trim(),
    product_differentiators: document.getElementById('art-differentiators').value.trim(),
    primary_keyword:         document.getElementById('art-keyword').value.trim(),
    secondary_keywords:      document.getElementById('art-secondary').value.trim(),
  };

  Object.keys(row).forEach((k) => { if (row[k] === '') delete row[k]; });

  try {
    if (editingId) {
      await put(`/articles/${editingId}`, row);
    } else {
      await post('/articles', row);
    }
    closeArticleModal();
    await loadArticles();
  } catch (e) {
    alert(`Error saving: ${e.message}`);
  }
});

window.editArticle   = (id) => openArticleModal(id);
window.deleteArticle = async (id) => {
  if (!confirm('Delete this article?')) return;
  try {
    await del(`/articles/${id}`);
    await loadArticles();
  } catch (e) { alert(`Error: ${e.message}`); }
};

// ── Generate ───────────────────────────────────────────────────────────────

let genEventSource = null;

const logBox  = document.getElementById('log-box');
const genBtn  = document.getElementById('gen-btn');
const stopBtn = document.getElementById('gen-stop-btn');

document.getElementById('clear-log-btn').addEventListener('click', () => {
  logBox.textContent = 'Ready. Press "Run pipeline" to start.';
});

function appendLog(text) {
  logBox.textContent += text;
  logBox.scrollTop = logBox.scrollHeight;
}

// Dry-run badge toggle
document.getElementById('gen-dry-run').addEventListener('change', function () {
  document.getElementById('dry-run-badge').style.display = this.checked ? '' : 'none';
});

// Output target warnings
function getSelectedTargets() {
  return Array.from(document.querySelectorAll('input[name="output-target"]:checked'))
    .map((el) => el.value);
}

async function updateOutputTargetWarnings() {
  const envStatus = await getEnvStatus();
  const targets   = getSelectedTargets();
  document.getElementById('gen-github-warning').style.display =
    (targets.includes('github') && !envStatus['GITHUB_TOKEN']) ? '' : 'none';
  document.getElementById('gen-framer-warning').style.display =
    (targets.includes('framer') && !envStatus['FRAMER_TOKEN']) ? '' : 'none';
}

document.querySelectorAll('input[name="output-target"]').forEach((cb) => {
  cb.addEventListener('change', updateOutputTargetWarnings);
});

genBtn.addEventListener('click', () => {
  if (genEventSource) genEventSource.close();

  const source  = document.getElementById('gen-source').value;
  const limit   = document.getElementById('gen-limit').value;
  const dryRun  = document.getElementById('gen-dry-run').checked ? '1' : '0';
  const targets = getSelectedTargets();
  const output  = targets.length > 0 ? targets.join(',') : 'markdown';

  logBox.textContent = '';
  genBtn.disabled  = true;
  stopBtn.disabled = false;

  const qs = new URLSearchParams({ source, limit, dry_run: dryRun, output });
  genEventSource = new EventSource(`/api/generate?${qs}`);

  genEventSource.onmessage = (e) => {
    try { appendLog(JSON.parse(e.data)); } catch { appendLog(e.data); }
  };
  genEventSource.addEventListener('done', (e) => {
    try {
      const { code } = JSON.parse(e.data);
      appendLog(`\n── Finished (exit code ${code})\n`);
    } catch { appendLog('\n── Finished\n'); }
    genEventSource.close();
    genEventSource = null;
    genBtn.disabled  = false;
    stopBtn.disabled = true;
  });
  genEventSource.onerror = () => {
    appendLog('\n[connection closed]\n');
    genBtn.disabled  = false;
    stopBtn.disabled = true;
  };
});

stopBtn.addEventListener('click', () => {
  if (genEventSource) {
    genEventSource.close();
    genEventSource = null;
    appendLog('\n[stopped by user]\n');
  }
  genBtn.disabled  = false;
  stopBtn.disabled = true;
});

// ── Outputs ────────────────────────────────────────────────────────────────

async function loadOutputs() {
  const tbody = document.getElementById('outputs-tbody');
  try {
    const outputs = await get('/outputs');
    if (outputs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
        <div class="empty-icon">&#9672;</div>
        <h4>No outputs yet</h4>
        <p>Run the pipeline in the Generate tab to create your first article.</p>
        <button class="btn btn-primary btn-sm" onclick="showPage('generate')">Go to Generate</button>
      </div></td></tr>`;
      return;
    }
    tbody.innerHTML = outputs.map((o) => `<tr>
      <td class="truncate">${esc(o.article_title || o.filename)}</td>
      <td>${badge(o.article_type)}</td>
      <td>${scoreBadge(o.quality_score)}</td>
      <td class="text-muted text-sm">${fmtDate(o.generated_at)}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="previewOutput('${esc(o.filename)}')">Preview</button></td>
    </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="notice warn">Failed to load outputs: ${esc(e.message)}</div></td></tr>`;
    console.error(e);
  }
}

window.previewOutput = async (filename) => {
  try {
    const data = await get(`/outputs/${encodeURIComponent(filename)}`);
    document.getElementById('output-modal-title').textContent = data.article_title || filename;
    const body = document.getElementById('output-modal-body');

    const scoreRows = data.quality_score
      ? `<div class="field"><label>Quality score</label>
           <div style="font-size:20px;font-weight:700">${data.quality_score}/10</div>
           <div class="score-bar"><div class="score-bar-fill" style="width:${data.quality_score * 10}%"></div></div>
         </div>`
      : '';

    body.innerHTML = `
      ${scoreRows}
      <div class="form-row">
        <div class="field"><label>Type</label><div>${badge(data.article_type)}</div></div>
        <div class="field"><label>Slug</label><div class="text-mono">${esc(data.article_slug || '')}</div></div>
      </div>
      <div class="field"><label>Meta title</label><div>${esc(data.meta_title || '—')}</div></div>
      <div class="field"><label>Meta description</label><div class="text-muted text-sm">${esc(data.meta_description || '—')}</div></div>
      <div class="field">
        <label>Article body (preview)</label>
        <textarea readonly rows="12" style="min-height:220px">${esc((data.article_body_markdown || '').slice(0, 2000))}${data.article_body_markdown?.length > 2000 ? '\n…' : ''}</textarea>
      </div>
      <div class="field"><label>Generated</label><div class="text-muted text-sm">${esc(data.generated_at || '—')}</div></div>
    `;
    document.getElementById('output-modal').style.display = 'flex';
  } catch (e) {
    document.getElementById('output-modal-title').textContent = 'Error loading output';
    document.getElementById('output-modal-body').innerHTML = `<div class="notice warn">Could not load output: ${esc(e.message)}</div>`;
    document.getElementById('output-modal').style.display = 'flex';
    console.error(e);
  }
};

document.getElementById('output-modal-close').addEventListener('click', () => {
  document.getElementById('output-modal').style.display = 'none';
});

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(type) {
  const map = {
    comparison:   'badge-blue',
    blog_post:    'badge-green',
    landing_page: 'badge-amber',
  };
  return `<span class="badge ${map[type] || 'badge-gray'}">${esc(type || '—')}</span>`;
}

function statusBadge(s) {
  const map = {
    not_started:       'badge-gray',
    researching:       'badge-blue',
    generating:        'badge-blue',
    rewriting:         'badge-amber',
    ready_for_export:  'badge-green',
    failed:            'badge-red',
    skip:              'badge-gray',
  };
  return `<span class="badge ${map[s] || 'badge-gray'}">${esc(s || 'not_started')}</span>`;
}

function scoreBadge(score) {
  if (!score) return '<span class="text-muted text-sm">—</span>';
  const cls = score >= 8 ? 'badge-green' : score >= 6 ? 'badge-amber' : 'badge-red';
  return `<span class="badge ${cls}">${score}/10</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// ── Init ───────────────────────────────────────────────────────────────────

initAuth().then(() => showPage('home'));
