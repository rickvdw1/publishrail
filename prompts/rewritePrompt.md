You are rewriting a {{COMPANY_NAME}} comparison article per editorial feedback. Fix every blocking issue without degrading sections that already scored well. Preserve all facts, table rows, competitor assessments, and the overall structure.

Apply these where flagged:

- **accuracy**: Revise any claim about {{COMPETITOR}} that is false, overstated, or unfair. Every limitation stated must be genuinely true for that product category. Competitor strengths must be substantive, not token acknowledgments.
- **positioning**: Clarify the structural/architectural distinction per the positioning guide. Explain WHY the gap matters operationally, not just that it exists. Ensure the "advantage compounds over time" section makes the flywheel clear.
- **structure**: Ensure all required sections are present in order: intro → "## What [Competitor] does well" → gap section → comparison table section → use guidance section → advantage section → bottom line → "## FAQ". Article ends after FAQ — no CTA.
- **comparison table**: Must have 12+ rows, 3 columns (Criteria | Competitor | {{COMPANY_NAME}}), {{COMPANY_NAME}} last. Expand if fewer than 12 rows.
- **depth**: Add specific structural/architectural reasons for gaps. Replace feature-list comparisons with explanations of WHY the difference matters. Cover at least 3 distinct gap dimensions.
- **FAQ format (hard fail 2)**: If any FAQ answer is on the same line as its ### heading, split it so the heading contains only the question and the answer begins on the next paragraph.
- **CTA (hard fail 6)**: Remove ALL CTAs and sales lines. Article ends after FAQ — do NOT replace with another CTA or softer demo line.
- **tone/overclaim**: Replace superlatives, slogans, and marketing phrases with dry operator-to-operator language. Replace broad outcome claims with narrow operational ones.
- **format compliance**: Remove banned vocabulary (transform, leverage, actionable insights, seamless, delve, underscore, pivotal). Replace with plain language consistent with the positioning guide.
- **H2 sections (hard fail 4)**: If any main section is a bold paragraph instead of a ## heading, convert it. If FAQ questions use ## instead of ###, fix them.
- **schema_jsonld / FAQ alignment**: Regenerate schema_jsonld as {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[...]} matching faq_json exactly.
- **word count**: Target 2,000–2,500 words. Trim repetitive sections; expand thin sections with specific reasoning.
- **NO internal links**: Keep internal_links as [].

## Source row
{{SOURCE_ROW}}

## Competitor: {{COMPETITOR}}

## Article (first pass)
```json
{{ARTICLE}}
```

## Editor scores (0–10)
{{SCORES}}
Overall: {{OVERALL}} / 10  |  decision: {{DECISION}}  |  publish_ready: {{PUBLISH_READY}}

## Blocking issues (must all be addressed)
{{BLOCKING_ISSUES}}

## Recommended fixes (apply where they don't conflict with high-scoring sections)
{{RECOMMENDED_FIXES}}

## Output — return the SAME JSON structure. Set "claude_prompt_version" to "v1-comparison-rewrite" and include "rewrite_triggered": true. Respond with ONLY the JSON object (no fences, no commentary).
