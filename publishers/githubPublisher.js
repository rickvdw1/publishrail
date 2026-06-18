// GitHub folder publisher.
//
// Commits a Markdown file to a configured GitHub repository folder via the GitHub Contents API.
// Disabled by default. Enable via config.output.github.enabled = true.
//
// Required env vars (when enabled):
//   GITHUB_TOKEN=            # personal access token or fine-grained token with repo write
//   GITHUB_OWNER=            # repository owner (user or org)
//   GITHUB_REPO=             # repository name
//
// Optional env vars (or set in config):
//   GITHUB_BRANCH=main
//   GITHUB_FOLDER=content/articles

const { buildMarkdown } = require('./markdownPublisher');

function getGithubConfig(config) {
  const cfg = config?.output?.github || {};
  return {
    enabled:              cfg.enabled === true,
    dryRunDefault:        cfg.dryRunDefault !== false,
    tokenEnv:             cfg.tokenEnv || 'GITHUB_TOKEN',
    ownerEnv:             cfg.ownerEnv || 'GITHUB_OWNER',
    repoEnv:              cfg.repoEnv  || 'GITHUB_REPO',
    token:                process.env[cfg.tokenEnv || 'GITHUB_TOKEN'],
    owner:                process.env[cfg.ownerEnv || 'GITHUB_OWNER'],
    repo:                 process.env[cfg.repoEnv  || 'GITHUB_REPO'],
    branch:               process.env.GITHUB_BRANCH || cfg.branch || 'main',
    folder:               process.env.GITHUB_FOLDER || cfg.folder || 'content/articles',
    commitTemplate:       cfg.commitMessageTemplate || 'Add article: {{title}}',
    overwriteExisting:    cfg.overwriteExisting === true,
    metadataFormat:       cfg.metadataFormat || 'frontmatter',
  };
}

function buildCommitMessage(template, article) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key === 'title') return article.article_title || article.article_slug || 'untitled';
    if (key === 'slug')  return article.article_slug || 'untitled';
    return '';
  });
}

function buildFilePath(folder, article) {
  const slug = article.article_slug || 'untitled';
  const safe = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${folder}/${safe}.md`.replace(/\/+/g, '/');
}

async function getExistingFile(cfg, filePath) {
  const axios = require('axios');
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(filePath)}`,
      {
        params: { ref: cfg.branch },
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 15_000,
      },
    );
    return { exists: true, sha: res.data.sha };
  } catch (err) {
    if (err.response?.status === 404) return { exists: false, sha: null };
    const status = err.response?.status;
    const body   = err.response?.data?.message || err.message;
    throw new Error(`GitHub API error checking file (HTTP ${status}): ${body}`);
  }
}

async function putFile(cfg, filePath, contentBase64, commitMessage, sha) {
  const axios = require('axios');
  const payload = {
    message: commitMessage,
    content: contentBase64,
    branch: cfg.branch,
  };
  if (sha) payload.sha = sha;

  const res = await axios.put(
    `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(filePath)}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    },
  );
  return res.data;
}

// publish(article, config, { dryRun }) → Promise<{ ok, message, url? }>
async function publish(article, config, { dryRun = true } = {}) {
  const cfg = getGithubConfig(config);

  if (!cfg.enabled) {
    return {
      ok: false,
      message: 'GitHub publishing is disabled. Set output.github.enabled = true in your config.',
    };
  }

  // Config validation
  if (!cfg.token) {
    throw new Error(
      `GitHub token not set. Add ${cfg.tokenEnv}=<your_token> to .env\n` +
      'Create a fine-grained token at https://github.com/settings/tokens with Contents: read+write',
    );
  }
  if (!cfg.owner) throw new Error(`GitHub owner not set. Add ${cfg.ownerEnv}=<owner> to .env`);
  if (!cfg.repo)  throw new Error(`GitHub repo not set. Add ${cfg.repoEnv}=<repo> to .env`);

  const filePath      = buildFilePath(cfg.folder, article);
  const fileContent   = buildMarkdown(article);
  const contentBase64 = Buffer.from(fileContent, 'utf8').toString('base64');
  const commitMsg     = buildCommitMessage(cfg.commitTemplate, article);
  const url           = `https://github.com/${cfg.owner}/${cfg.repo}/blob/${cfg.branch}/${filePath}`;

  if (dryRun) {
    console.log(`[github] DRY RUN — would commit:`);
    console.log(`  repo:    ${cfg.owner}/${cfg.repo}`);
    console.log(`  branch:  ${cfg.branch}`);
    console.log(`  path:    ${filePath}`);
    console.log(`  message: ${commitMsg}`);
    console.log(`  bytes:   ${fileContent.length}`);
    return { ok: true, message: `Dry run — would commit to ${filePath}`, url };
  }

  const { exists, sha } = await getExistingFile(cfg, filePath);

  if (exists && !cfg.overwriteExisting) {
    return {
      ok: false,
      message: `File already exists: ${filePath}. Set output.github.overwriteExisting = true to overwrite.`,
    };
  }

  const mode = exists ? 'Updated' : 'Created';
  await putFile(cfg, filePath, contentBase64, commitMsg, sha);
  return { ok: true, message: `${mode} ${filePath} in ${cfg.owner}/${cfg.repo}@${cfg.branch}`, url };
}

module.exports = { publish, getGithubConfig, buildFilePath, buildCommitMessage };
