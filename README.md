# PublishRail

An open-source, configurable article-generation pipeline. Feed it rows from NocoDB, a CSV, or a JSON file; it generates editorial-quality articles using Claude AI, validates and judges them, and exports the results as Markdown. Optionally publish directly to Framer CMS.

**Supported article types:** comparison pages, SEO blog posts, AEO answer articles, landing pages, use case pages, thought leadership, glossary pages, and more.

---

## Features

- Generate articles using any AI provider — Anthropic, OpenAI, Fireworks, Together, OpenRouter, or any OpenAI-compatible endpoint
- Two-pass write → judge → optional rewrite loop
- Deterministic cleanup (escaped quotes, CTA removal, FAQ formatting)
- Local validators (FAQ format, heading levels, word count, banned vocabulary)
- Schema validation (Zod)
- Corpus memory and near-duplicate detection
- Markdown export with YAML frontmatter
- Optional Framer CMS publishing (disabled by default)
- Four input sources: NocoDB, CSV, JSON, Google Sheets
- Web UI for configuration, article queue management, and generation (`npm run ui`)
- Fully configurable via `config/project.config.json` and `.env`

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up your environment

```bash
cp .env.example .env
# Fill in your values — never commit .env
```

### 3. Configure your AI provider

Copy `.env.example` to `.env` and fill in your API key:

```bash
AI_PROVIDER=anthropic          # or: openai
AI_API_KEY=your_key_here       # or: ANTHROPIC_API_KEY / OPENAI_API_KEY
# AI_BASE_URL=                 # optional: Fireworks / Together / OpenRouter / local
# AI_MODEL=                    # optional: override default model
```

### 4. Copy the example config

```bash
cp config/example.config.json config/project.config.json
```

Edit `config/project.config.json` to set your company name, article type, source, and output directory.

### 5. Add your context files

```bash
cp context/positioning.example.md context/positioning.md
cp context/messaging.example.md context/messaging.md
cp context/glossary.example.md context/glossary.md
cp context/evaluation-criteria.example.md context/evaluation-criteria.md
```

Edit each file to describe your company, product, and editorial standards.

### 6. Launch the UI (optional)

```bash
npm run ui
# Opens at http://localhost:3737
```

The UI lets you configure your AI provider, edit context files and prompts, manage the article queue, trigger generation with live logs, and browse outputs — all in a browser.

### 7. Run one article (CLI)

Using a local JSON file (no database required):

```bash
npm run generate:json -- --limit=1
```

Using NocoDB:

```bash
npm run generate:nocodb -- --limit=1
```

Using a CSV file:

```bash
npm run generate:csv -- --limit=1
```

---

## Required environment variables

| Variable | Used when |
|---|---|
| `AI_PROVIDER` | Always — `anthropic` (default) or `openai` |
| `AI_API_KEY` | Always — master key (or use `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) |
| `AI_BASE_URL` | Optional — for Fireworks, Together, OpenRouter, or local LLMs |
| `AI_MODEL` | Optional — overrides the model for all pipeline stages |
| `NOCODB_BASE_URL` | Source is NocoDB |
| `NOCODB_API_TOKEN` | Source is NocoDB |
| `NOCODB_TABLE_ID` | Source is NocoDB |
| `INPUT_CSV_PATH` | Source is CSV (default: `inputs/articles.csv`) |
| `INPUT_JSON_PATH` | Source is JSON (default: `inputs/articles.json`) |
| `EXPORT_MARKDOWN_DIR` | Markdown export (default: `outputs/markdown`) |
| `GITHUB_TOKEN` | GitHub publishing (disabled by default) |
| `GITHUB_OWNER` | GitHub publishing — repository owner (user or org) |
| `GITHUB_REPO` | GitHub publishing — repository name |
| `GITHUB_BRANCH` | GitHub publishing (default: `main`) |
| `GITHUB_FOLDER` | GitHub publishing (default: `content/articles`) |
| `FRAMER_TOKEN` | Framer publishing (disabled by default) |
| `FRAMER_COLLECTION_ID` | Framer publishing (disabled by default) |

---

## Input source options

### NocoDB

Set `source.type = "nocodb"` in your config. Required env vars: `NOCODB_BASE_URL`, `NOCODB_API_TOKEN`, `NOCODB_TABLE_ID`.

```bash
node index.js --source nocodb --limit 1
```

See `setup-nocodb-table.js` for a one-time table setup script.

### CSV

Set `source.type = "csv"` in your config, or pass `--source csv`. Point `INPUT_CSV_PATH` to your file.

```bash
node index.js --source csv --limit 1
```

See `inputs/articles.example.csv` for the expected column format.

### JSON

Set `source.type = "json"` in your config, or pass `--source json`. Point `INPUT_JSON_PATH` to your file.

```bash
node index.js --source json --limit 1
```

See `inputs/articles.example.json` for the expected format.

### Google Sheets

Set `source.type = "google-sheets"` in your config, or pass `--source google-sheets`.

Required env vars:

```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=  # absolute path to service account credentials JSON
GOOGLE_SPREADSHEET_ID=            # from the spreadsheet URL
GOOGLE_SHEET_NAME=Sheet1          # tab name (default: Sheet1)
```

Prerequisites: enable the Google Sheets API, create a service account, and share the spreadsheet with its email. Then: `npm install googleapis`.

The first row of the sheet is treated as headers. Column names must match the article field names in the table above.

---

## Required article fields

The pipeline reads these fields from your input source:

| Field | Required | Description |
|---|---|---|
| `article_title` | Yes | The H1 and output filename base |
| `article_slug` | Recommended | URL slug (auto-generated from title if missing) |
| `article_type` | Recommended | `comparison`, `blog_post`, `landing_page`, etc. |
| `competitor_name` | For comparisons | The product being compared against |
| `competitor_category` | For comparisons | Category of the competitor |
| `comparison_angle` | For comparisons | The framing of the comparison |
| `description` | Recommended | Editor notes for the writer |
| `competitor_strengths` | Optional | Pre-filled or generated by research pass |
| `competitor_limitations` | Optional | Pre-filled or generated by research pass |
| `product_differentiators` | Optional | Pre-filled or generated by research pass |
| `target_personas` | Optional | Job titles this article addresses |
| `complementary_positioning` | Optional | How to frame product coexistence or replacement |
| `primary_keyword` | Optional | Primary SEO keyword |
| `secondary_keywords` | Optional | Additional keywords |
| `article_status` | Yes | Set to `not_started` to queue for generation |

---

## How to provide context files

The pipeline loads four context files that shape every generated article. These are your configuration — not code.

### `context/positioning.md`
Describes your product, what problem it solves, and how it is positioned against its category. The writer and judge read this on every call.

### `context/messaging.md`
Your brand voice guidelines: tone, things to avoid, writing style.

### `context/glossary.md`
Your product's terminology. Ensures Claude uses the right vocabulary and avoids competitor-branded terms to describe your features.

### `context/evaluation-criteria.md`
What a good article looks like for your brand. The AI judge reads this when scoring articles.

Start by copying the `.example.md` files and filling them in:

```bash
cp context/positioning.example.md context/positioning.md
# etc.
```

---

## How to generate one article locally

```bash
# From a JSON file, dry run (no source writes)
node index.js --source json --limit 1 --dry-run

# From a CSV file
node index.js --source csv --limit 1

# From NocoDB, targeting a specific row
node index.js --source nocodb --row-id 5

# From a local JSON file (skips source entirely)
node index.js --from-file inputs/my-row.json
```

Output is saved to `outputs/<id>_<slug>.json`. A verbose `.run.json` log is also written.

---

## Output targets

After generation, articles can be sent to one or more output targets. Control this with `--output` on the CLI or `output.targets` in your config.

| Target | Description |
|---|---|
| `markdown` | Write a `.md` file to a local folder (default) |
| `github` | Commit the `.md` file to a GitHub repository via the Contents API |
| `framer` | Publish to a Framer CMS collection |
| `none` / `dry-run` | Generate only — save JSON to `outputs/`, no publishing |

```bash
# Local Markdown only (default)
node index.js --source csv --output markdown --limit 1

# Markdown + dry-run GitHub preview
node index.js --source csv --output markdown,github --limit 1 --dry-run

# All three targets, dry-run
node index.js --source csv --output markdown,github,framer --limit 1 --dry-run

# Generate only — no publishing
node index.js --source csv --output none --limit 1
```

Or in `config/project.config.json`:

```json
{
  "output": {
    "targets": ["markdown", "github"]
  }
}
```

The `--output` CLI flag always overrides `output.targets` from config.

---

### Markdown publisher

Writes YAML-frontmatter Markdown files to a local folder.

**Config (`config/project.config.json`):**
```json
{
  "output": {
    "markdown": {
      "enabled": true,
      "outputDir": "outputs/markdown",
      "metadataFormat": "frontmatter"
    }
  }
}
```

**Env var (optional override):**
```
EXPORT_MARKDOWN_DIR=outputs/markdown
```

**Output format:**
```markdown
---
title: Article Title
slug: article-slug
meta_title: SEO Title
meta_description: SEO description
canonical_url: /articles/article-slug
---

## Introduction

Article body here…
```

---

### GitHub publisher

Commits a Markdown file to a folder in a GitHub repository using the GitHub Contents API. No local `git` checkout required.

GitHub publishing is **disabled by default**.

**Setup:**

1. Create a fine-grained personal access token at <https://github.com/settings/tokens> with **Contents: Read and write** on the target repository.
2. Add to `.env`:
   ```
   GITHUB_TOKEN=your_token
   GITHUB_OWNER=your-org-or-username
   GITHUB_REPO=your-repo-name
   GITHUB_BRANCH=main
   GITHUB_FOLDER=content/articles
   ```
3. Enable in `config/project.config.json`:
   ```json
   {
     "output": {
       "github": {
         "enabled": true,
         "dryRunDefault": true,
         "folder": "content/articles",
         "commitMessageTemplate": "Add article: {{title}}",
         "overwriteExisting": false
       }
     }
   }
   ```

**Always test with `--dry-run` first:**

```bash
node index.js --source csv --output github --limit 1 --dry-run
```

**Notes:**
- Set `overwriteExisting: true` to update files that already exist in the repo.
- The token is read from env and **never logged** — not even in dry-run output.
- Files are committed directly to `GITHUB_BRANCH`; open a PR if you prefer a review step.

---

### Framer CMS publisher

Publishes articles to a Framer CMS collection via the Framer API.

Framer publishing is **disabled by default**.

Two publishing modes are available:

#### Mode 1 — Single body (default)

Sends the full cleaned article body to one configured Framer field.

```json
{
  "output": {
    "framer": {
      "enabled": true,
      "dryRunDefault": true,
      "mode": "single-body",
      "fieldMapping": {
        "title": "title",
        "slug": "slug",
        "body": "content",
        "description": "description",
        "primaryKeyword": "primaryKeyword"
      }
    }
  }
}
```

#### Mode 2 — Section mapped

Splits the article by `##` H2 headings and sends each section body to a separate Framer CMS field. Useful when your Framer CMS schema has individual fields for each content section.

```json
{
  "output": {
    "framer": {
      "enabled": true,
      "dryRunDefault": true,
      "mode": "section-mapped",
      "fieldMapping": {
        "title": "title",
        "slug": "slug",
        "description": "description"
      },
      "sectionMapping": {
        "What the output looks like": "outputSection",
        "How it works":               "howItWorksSection",
        "Why this matters":           "whyItMattersSection",
        "FAQ":                        "faqSection"
      },
      "bodyField":             "body",
      "introField":            "intro",
      "sectionMatching":       "exact",
      "unmappedSections":      "append_to_body",
      "requireMappedSections": false
    }
  }
}
```

**Section mapping options:**

| Option | Values | Description |
|---|---|---|
| `mode` | `single-body` \| `section-mapped` | Publishing mode |
| `sectionMapping` | `{ "H2 heading": "framerField" }` | Maps H2 heading text to Framer field names |
| `bodyField` | string | Field to receive unmapped sections when `unmappedSections: "append_to_body"` |
| `introField` | string \| null | Field to receive content before the first H2 |
| `sectionMatching` | `exact` \| `normalized` | `normalized` ignores case and punctuation differences |
| `unmappedSections` | `ignore` \| `append_to_body` \| `warn` \| `error` | Behaviour for H2 sections not in `sectionMapping` |
| `requireMappedSections` | boolean | If `true`, fail if a configured H2 heading is not found in the article |

**Normalized matching** lets headings like `"FAQ?"` or `"how it works"` match the configured `"FAQ"` / `"How it works"` without an exact string. Useful when articles vary slightly in capitalization or trailing punctuation.

**Setup:**

1. Get your API token from Framer → Settings → CMS → API.
2. Get your Collection ID from Framer → CMS → Collections.
3. Add to `.env`:
   ```
   FRAMER_TOKEN=your_token
   FRAMER_COLLECTION_ID=your_collection_id
   ```

**Always test with `--dry-run` first:**

```bash
node index.js --source csv --output framer --limit 1 --dry-run
```

Dry-run output shows each mapped section, its character count, and any missing or unmapped headings — without calling the Framer API.

**Troubleshooting:**

| Problem | Fix |
|---|---|
| Section not found for `"My Heading"` | Check for exact match (case, punctuation). Switch to `sectionMatching: "normalized"` to relax. |
| Article has no H2 sections | Check the generated body — ensure the writer prompt produces `##` headings. |
| Field name mismatch | Copy field names from Framer CMS → Collections → field slug, not the display label. |
| Token or collection ID not set | Add `FRAMER_TOKEN` and `FRAMER_COLLECTION_ID` to `.env`. |

**Notes:**
- Items are created as published entries in Framer CMS — review in the Framer dashboard.
- Framer does not expose a "create as draft" API endpoint.
- The token is read from env and **never logged**, even in dry-run output.
- H3 (`###`) headings inside an H2 section are preserved as section content (e.g., FAQ questions).

---

## CLI reference

```bash
node index.js [options]

--source=nocodb|csv|json|google-sheets  Input source (overrides config)
--output=markdown,github,framer         Output targets (comma-separated)
                                        Special: "none" or "dry-run" = skip publishing
--limit=N                               Max rows to process (default: 5)
--row-id=N                              Process a single row by ID
--from-file=path                        Load a row from a local JSON file
--mode=production|debug                 Prompt mode (default: production)
--writer-model=opus|sonnet              Model for writing (default: opus)
--judge-model=opus|sonnet               Model for judging (default: sonnet)
--rewrite-model=opus|sonnet             Model for rewriting (default: opus)
--dry-run                               Skip all source writes and publisher API calls
--quiet                                 Suppress recommended fixes in output
--show-article                          Print first 800 chars of draft body
```

---

## How to customize prompts

Edit the files in `prompts/`:

| File | Article type | Purpose |
|---|---|---|
| `prompts/writerPrompt.md` | comparison | Comparison article writer |
| `prompts/blogPostPrompt.md` | blog_post | Blog post writer |
| `prompts/landingPagePrompt.md` | landing_page | Landing page writer |
| `prompts/judgePrompt.md` | all | Editorial judge scoring rubric |
| `prompts/rewritePrompt.md` | all | Rewriter instructions |
| `prompts/researchPrompt.md` | comparison | Competitive research |

Prompts use `{{VARIABLE}}` placeholders filled at runtime from the row data and context files. The pipeline selects the writer prompt by `row.article_type`; override with `prompts.writer` in your config.

---

## How validation and judging work

### Local validators (deterministic, no Claude)

Run before and after the Claude judge. Check:

- No CTA or sales language in the article body
- FAQ questions use ### (H3) headings, not ## (H2)
- FAQ answers are NOT on the same line as the heading
- No long inline bold blocks (>120 chars)
- Required sections present (for comparison articles)
- Comparison table present with ≥10 rows (for comparison articles)
- Minimum word count
- No banned vocabulary
- No empty sections
- No duplicate headings
- schema_jsonld matches faq_json

### AI judge

Scores 7 dimensions (0–10 each):
- `accuracy_score` — factual claims about competitors
- `positioning_score` — how clearly your advantage is explained
- `structure_score` — sections present and correctly formatted
- `depth_score` — architectural depth, not just feature lists
- `seo_aeo_score` — keyword placement and FAQ quality
- `tone_score` — professional and fair
- `format_compliance_score` — no CTAs, no banned vocab

Decision: `publish` (overall ≥8, all ≥7) / `needs_revision` / `rewrite`.

A rewrite is triggered automatically on the first pass if the decision is `rewrite`.

---

## Directory structure

```
/config
  example.config.json        # Template — copy to project.config.json
/context
  positioning.example.md     # Your positioning guide template
  messaging.example.md       # Your brand voice template
  glossary.example.md        # Your terminology template
  evaluation-criteria.example.md  # Your judge criteria template
/prompts
  writerPrompt.md            # Comparison article writer
  blogPostPrompt.md          # Blog post writer
  landingPagePrompt.md       # Landing page writer
  judgePrompt.md             # Judge scoring rubric
  rewritePrompt.md           # Rewriter instructions
  researchPrompt.md          # Competitive research (comparison)
/sources
  nocodbSource.js            # NocoDB adapter
  csvSource.js               # CSV adapter
  jsonSource.js              # JSON adapter
  googleSheetsSource.js      # Google Sheets adapter (read-only)
/publishers
  markdownPublisher.js       # Markdown export
  framerPublisher.js         # Framer CMS (disabled by default)
/inputs
  articles.example.json      # Example JSON input
  articles.example.csv       # Example CSV input
/outputs
  (generated article JSON files)
index.js                     # Pipeline orchestrator
config.js                    # Config loader
articlePrompt.js             # Writer prompt builder
articleResearch.js           # Research prompt builder
articleJudge.js              # Judge and rewrite prompt builders
localValidators.js           # Deterministic validators
validateArticle.js           # Zod schema validation
models.js                    # Claude model routing
jsonUtils.js                 # JSON extraction helpers
corpusMemory.js              # Corpus tracking (duplicate detection)
duplicateCheck.js            # Near-duplicate detection
extractFingerprint.js        # Article fingerprint extraction
```

---

## Roadmap / planned features

- Glossary page prompt template
- Thought leadership / opinion article prompt template
- Configurable banned vocabulary lists
- Structured logging (JSON logs to `logs/`)
- Unit tests for validators
- Corpus management CLI

---

## Security

See `SECURITY.md` for guidance on credentials, secrets, and safe operation.

**Never commit `.env`.** It is already in `.gitignore`, but be careful if you use `git add -A` without reviewing what you are staging.
