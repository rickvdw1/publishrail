require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { callAI } = require('./aiClient');
const { extractJsonObject } = require('./jsonUtils');
const { getCompanyName, loadContextFile, loadPromptFile } = require('./config');

function loadEvaluationCriteria() {
  const criteria = loadContextFile('evaluationCriteria', 'evaluation criteria');
  if (!criteria.startsWith('(')) return criteria;

  // Legacy fallback: positioning-judge-ref.md or positioning-guide.md
  for (const f of ['positioning-judge-ref.md', 'positioning-guide.md']) {
    try {
      const txt = fs.readFileSync(path.join(__dirname, f), 'utf8').trim();
      if (txt) return txt;
    } catch {}
  }

  return criteria;
}

const SOURCE_ROW_FIELDS = [
  'article_title', 'article_type', 'competitor_name', 'competitor_category', 'comparison_angle',
  'description', 'competitor_strengths', 'competitor_limitations',
  'product_differentiators', 'next_differentiators',
  'target_personas', 'complementary_positioning',
  'primary_keyword', 'secondary_keywords',
];

function cleanSourceRow(row) {
  const out = {};
  for (const f of SOURCE_ROW_FIELDS) {
    if (row[f] != null) out[f] = row[f];
  }
  return out;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

function buildJudgePrompt(article, sourceRow) {
  const tpl = loadPromptFile('judge');
  const companyName = getCompanyName();
  const evaluationCriteria = loadEvaluationCriteria();

  const articleForJudge = {
    article_title: article.article_title,
    article_slug: article.article_slug,
    meta_title: article.meta_title,
    meta_description: article.meta_description,
    excerpt: article.excerpt,
    article_body_markdown: article.article_body_markdown,
    schema_jsonld: article.schema_jsonld,
    canonical_url: article.canonical_url,
    internal_links: article.internal_links,
  };

  if (tpl) {
    return fillTemplate(tpl, {
      COMPANY_NAME: companyName,
      COMPETITOR: sourceRow.competitor_name || '(no competitor)',
      EVALUATION_CRITERIA: evaluationCriteria,
      SOURCE_ROW: JSON.stringify(cleanSourceRow(sourceRow), null, 2),
      ARTICLE: JSON.stringify(articleForJudge, null, 2),
    });
  }

  return `Judge this ${sourceRow.article_type || 'comparison'} article for ${companyName}${sourceRow.competitor_name ? ` vs ${sourceRow.competitor_name}` : ''}.

Evaluation criteria:
${evaluationCriteria}

Source row:
${JSON.stringify(cleanSourceRow(sourceRow), null, 2)}

Article:
${JSON.stringify(articleForJudge, null, 2)}

Score 7 dimensions 0–10: accuracy_score, positioning_score, structure_score, depth_score, seo_aeo_score, tone_score, format_compliance_score.
Return ONLY JSON with: scores, overall_score, publish_ready, decision, blocking_issues, recommended_fixes.`;
}

function buildRewritePrompt(sourceRow, firstArticle, judgeOutput) {
  const tpl = loadPromptFile('rewrite');
  const companyName = getCompanyName();

  const scoreLines = Object.entries(judgeOutput.scores || {})
    .map(([k, v]) => `  ${k}: ${v}/10`).join('\n');

  if (tpl) {
    return fillTemplate(tpl, {
      COMPANY_NAME: companyName,
      SOURCE_ROW: JSON.stringify(cleanSourceRow(sourceRow), null, 2),
      COMPETITOR: sourceRow.competitor_name || '(no competitor)',
      ARTICLE: JSON.stringify(firstArticle, null, 2),
      SCORES: scoreLines,
      OVERALL: judgeOutput.overall_score,
      DECISION: judgeOutput.decision,
      PUBLISH_READY: judgeOutput.publish_ready,
      BLOCKING_ISSUES: (judgeOutput.blocking_issues || []).map((f, i) => `${i + 1}. ${f}`).join('\n') || 'None listed.',
      RECOMMENDED_FIXES: (judgeOutput.recommended_fixes || []).map((f, i) => `${i + 1}. ${f}`).join('\n') || 'None listed.',
    });
  }

  return `Rewrite this ${sourceRow.article_type || 'comparison'} article for ${companyName} based on editorial feedback.

Scores:
${scoreLines}

Blocking issues:
${(judgeOutput.blocking_issues || []).join('\n')}

Article:
${JSON.stringify(firstArticle, null, 2)}

Return ONLY the same JSON structure with rewrite_triggered: true and claude_prompt_version: "v1-${sourceRow.article_type || 'comparison'}-rewrite".`;
}

function buildTargetedRewritePrompt(article, issues) {
  const companyName = getCompanyName();
  const articleJson = JSON.stringify({
    article_title: article.article_title,
    article_slug: article.article_slug,
    meta_title: article.meta_title,
    meta_description: article.meta_description,
    excerpt: article.excerpt,
    article_body_markdown: article.article_body_markdown,
    faq_json: article.faq_json,
    schema_jsonld: article.schema_jsonld,
    canonical_url: article.canonical_url,
    internal_links: article.internal_links,
    quality_score: article.quality_score,
    claude_prompt_version: article.claude_prompt_version,
    generated_at: article.generated_at,
  }, null, 2);

  return `You are doing a SURGICAL mechanical fix to a ${companyName} article. Fix ONLY these issues and change NOTHING else — preserve every fact, all table rows, and the overall structure:

${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Rules for the fixes:
- Remove any CTA / demo / sales line. Article ends after FAQ.
- Remove banned vocabulary (transform, leverage, actionable insights, seamless, delve, etc.).
- FAQ inline format: if any answer is on the same line as its ### heading, split it to next paragraph.
- Long inline bold: reformat as one **Bold label** per line with value on next paragraph.
- schema_jsonld / FAQ alignment: regenerate schema_jsonld as {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[...]} matching faq_json exactly.
- Keep internal_links as [].

Return ONLY the same JSON object with the corrected fields. No code fences, no commentary.

${articleJson}`;
}

async function runJudge(article, sourceRow, _competitorKey, mode = 'production', model = null) {
  const prompt = buildJudgePrompt(article, sourceRow);
  const raw = await callAI(prompt, model);
  return extractJsonObject(raw);
}

async function runRewrite(sourceRow, firstArticle, judgeOutput, _competitorKey, mode = 'production', model = null) {
  const prompt = buildRewritePrompt(sourceRow, firstArticle, judgeOutput);
  const raw = await callAI(prompt, model);
  return extractJsonObject(raw);
}

async function runTargetedRewrite(article, issues, model = null) {
  const raw = await callAI(buildTargetedRewritePrompt(article, issues), model);
  return extractJsonObject(raw);
}

module.exports = {
  runJudge,
  runRewrite,
  runTargetedRewrite,
  buildJudgePrompt,
  buildRewritePrompt,
  buildTargetedRewritePrompt,
};
