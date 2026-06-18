const { callAI } = require('./aiClient');
const { extractJsonObject } = require('./jsonUtils');
const { getCompanyName, loadContextFile, loadPromptFile } = require('./config');

function loadPositioningGuide() {
  const guide = loadContextFile('positioning', 'positioning guide');
  if (!guide.startsWith('(')) return guide;

  // Legacy fallback: look for old root-level files
  const fs = require('fs');
  const path = require('path');
  for (const f of ['positioning-judge-ref.md', 'positioning-guide.md']) {
    try {
      const txt = fs.readFileSync(path.join(__dirname, f), 'utf8').trim();
      if (txt) return txt;
    } catch {}
  }

  return guide;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

function buildResearchPrompt(row) {
  const tpl = loadPromptFile('research');
  const companyName = getCompanyName();
  const positioning = loadPositioningGuide();

  if (tpl) {
    return fillTemplate(tpl, {
      COMPANY_NAME: companyName,
      COMPETITOR_NAME: row.competitor_name || '',
      COMPETITOR_CATEGORY: row.competitor_category || '',
      COMPARISON_ANGLE: row.comparison_angle || '',
      DESCRIPTION: row.description || '(none provided)',
      POSITIONING_GUIDE: positioning,
    });
  }

  return `You are a competitive intelligence analyst for ${companyName}. Analyse this competitor and return a JSON object with exactly 5 fields:

competitor_strengths, competitor_limitations, product_differentiators, target_personas, complementary_positioning.

Competitor: ${row.competitor_name || '(unknown)'}
Category: ${row.competitor_category || '(unknown)'}
Angle: ${row.comparison_angle || '(none)'}
Notes: ${row.description || '(none)'}

Positioning guide for ${companyName}:
${positioning}

Return ONLY the JSON object.`;
}

async function runResearch(row, model = null) {
  const prompt = buildResearchPrompt(row);
  const raw = await callAI(prompt, model);
  const parsed = extractJsonObject(raw);

  // Normalize: accept `product_differentiators` OR legacy `next_differentiators`
  if (!parsed.product_differentiators && parsed.next_differentiators) {
    parsed.product_differentiators = parsed.next_differentiators;
    delete parsed.next_differentiators;
  }

  return parsed;
}

module.exports = { runResearch };
