const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { getCompanyName, loadContextFile, loadPromptFile, getPromptFilePath } = require('./config');

// Maps article_type to the prompt config key used to locate the template file.
// Falls back to 'writer' (comparison) when the type has no dedicated template.
const PROMPT_KEY_BY_TYPE = {
  comparison:    'writer',
  blog_post:     'blogPost',
  landing_page:  'landingPage',
};

function buildSlug(row) {
  if (row.article_slug && row.article_slug.trim()) return row.article_slug.trim();
  return slugify(row.article_title || 'untitled', { lower: true, strict: true });
}

const field = (v) => (v && String(v).trim()) ? String(v).trim() : '(not provided)';

// `product_differentiators` is the generic field name.
// `next_differentiators` is accepted as a legacy alias so existing NocoDB tables keep working.
function getProductDifferentiators(row) {
  return field(row.product_differentiators || row.next_differentiators);
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

function buildArticlePromptFromTemplate(row, slug, articleType, now) {
  const promptKey = PROMPT_KEY_BY_TYPE[articleType] || 'writer';
  const tpl = loadPromptFile(promptKey);
  if (!tpl) return null;

  const companyName = getCompanyName();
  const isComparison = articleType === 'comparison';
  const canonical = isComparison ? `/compare/${slug}` : `/${slug}`;

  const vars = {
    COMPANY_NAME: companyName,
    PRODUCT_DESCRIPTION: loadContextFile('positioning', 'positioning guide').split('\n').slice(0, 5).join('\n'),
    POSITIONING_GUIDE: loadContextFile('positioning', 'positioning guide'),
    BRAND_VOICE: loadContextFile('messaging', 'brand voice / messaging'),
    GLOSSARY: loadContextFile('glossary', 'glossary'),
    ARTICLE_TITLE: field(row.article_title),
    ARTICLE_SLUG: slug,
    PRIMARY_KEYWORD: field(row.primary_keyword),
    SECONDARY_KEYWORDS: field(row.secondary_keywords),
    TARGET_PERSONAS: field(row.target_personas),
    DESCRIPTION: field(row.description),
    // Comparison-specific fields (blank for other article types)
    COMPETITOR_NAME: field(row.competitor_name),
    COMPETITOR_CATEGORY: field(row.competitor_category),
    COMPARISON_ANGLE: field(row.comparison_angle),
    COMPETITOR_STRENGTHS: field(row.competitor_strengths),
    COMPETITOR_LIMITATIONS: field(row.competitor_limitations),
    PRODUCT_DIFFERENTIATORS: getProductDifferentiators(row),
    COMPLEMENTARY_POSITIONING: field(row.complementary_positioning),
    CANONICAL: canonical,
    NOW: now,
    META_TITLE_PLACEHOLDER: isComparison
      ? `${companyName} vs ${field(row.competitor_name)}: [Short Angle] | ${companyName}`
      : `[60-char meta title] | ${companyName}`,
    META_DESC_PLACEHOLDER: `[120–155 char meta description]`,
    DATE_PLACEHOLDER: now.slice(0, 10),
  };

  return fillTemplate(tpl, vars);
}

function buildArticlePrompt(row, mode = 'production') {
  const slug = buildSlug(row);
  const now = new Date().toISOString();
  const companyName = getCompanyName();

  const articleType = row.article_type || 'comparison';
  console.log(`  [${slug}] article_type: ${articleType}`);
  if (row.competitor_name) console.log(`  [${slug}] competitor: ${row.competitor_name}`);

  if (mode === 'production') {
    const fromTemplate = buildArticlePromptFromTemplate(row, slug, articleType, now);
    if (fromTemplate) return fromTemplate;
  }

  // Inline fallback — works for any article type without a prompt template
  const canonical = `/compare/${slug}`;
  return `You are an expert content strategist writing for ${companyName}.

Write a ${articleType} article with the following inputs:
- article_title: ${field(row.article_title)}
- article_type: ${articleType}
- competitor_name: ${field(row.competitor_name)}
- competitor_category: ${field(row.competitor_category)}
- comparison_angle: ${field(row.comparison_angle)}
- description: ${field(row.description)}
- competitor_strengths: ${field(row.competitor_strengths)}
- competitor_limitations: ${field(row.competitor_limitations)}
- product_differentiators: ${getProductDifferentiators(row)}
- target_personas: ${field(row.target_personas)}
- complementary_positioning: ${field(row.complementary_positioning)}
- primary_keyword: ${field(row.primary_keyword)}
- secondary_keywords: ${field(row.secondary_keywords)}

Write 2,000–2,500 words. Use ## for main sections, ### for FAQ questions. No CTAs. Return ONLY valid JSON with fields: article_title, article_slug, meta_title, meta_description, excerpt, article_body_markdown, faq_json (5–6 items), schema_jsonld (FAQPage), canonical_url, internal_links, quality_score, claude_prompt_version, generated_at.

article_slug: ${slug}
canonical_url: ${canonical}
generated_at: ${now}
claude_prompt_version: v1-${articleType}`;
}

module.exports = { buildArticlePrompt, buildSlug };
