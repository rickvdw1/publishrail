# Security

## Never commit `.env`

The `.env` file contains live API tokens. It is listed in `.gitignore`, but always verify before pushing:

```bash
git status  # confirm .env does not appear as a staged or modified file
git diff --cached --name-only  # confirm .env is not staged
```

If `.env` has ever been committed, revoke and rotate all credentials immediately, then remove it from history:

```bash
git filter-repo --path .env --invert-paths
```

## Credentials used by this pipeline

| Credential | Where it is used | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude CLI | https://console.anthropic.com |
| `NOCODB_API_TOKEN` | NocoDB API | NocoDB team settings → API tokens |
| `FRAMER_TOKEN` | Framer CMS API | Framer account settings → API |

## How to rotate tokens

1. Revoke the old token at the provider's dashboard
2. Generate a new token
3. Update `.env` with the new value
4. Never store tokens in code, prompts, or config files

## Context files may be proprietary

The files in `context/` (positioning.md, messaging.md, etc.) contain your company's internal strategy and brand voice. They are not in `.gitignore` by default, so they **will** be committed if you `git add` them. Consider:

- Adding `context/*.md` to `.gitignore` if your content is confidential
- Using a private repository for any deployment that includes proprietary context

## Outputs are not committed

`inputs/` and `outputs/` are in `.gitignore`. Generated articles contain the article body, metadata, and quality scores — do not commit them unless you intend to.

## Local paths

Do not hardcode absolute local paths (like `/Users/yourname/...`) in config files or prompts. Use environment variables for all paths:

```bash
EXPORT_MARKDOWN_DIR=outputs/markdown  # relative to repo root, or absolute
```

## `config/project.config.json` is gitignored

Your local project config (`config/project.config.json`) is excluded from git. Do not commit it if it contains local paths or references to private infrastructure.

## Running in CI

If running this pipeline in CI:

1. Store all secrets as CI environment secrets, not in files
2. Do not print `.env` contents in CI logs
3. Use a dedicated API token with the minimum required permissions
4. Never push to production Framer from CI without a manual approval step
