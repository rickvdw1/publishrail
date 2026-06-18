const { spawnSync } = require('child_process');
const { extractJsonObject } = require('./jsonUtils');

function buildFingerprintPrompt(articleBodyMarkdown) {
  return `You are extracting a semantic fingerprint from an article. This fingerprint will be used to detect redundancy across a large article corpus. Precision and normalization matter — the goal is comparison, not summary.

Extract the following fields. Return only a valid JSON object. No markdown fences, no explanation, no text before or after the JSON.

key_phrases
5–10 repeated wording patterns or memorable framings extracted verbatim or near-verbatim from the article.

operational_patterns
3–5 conceptual operational shifts described in the article. Normalize to a short phrase.

downstream_effects
3–5 organizational behaviors, meetings, or reports that change as a result of this article's subject.

named_artifacts
All concrete things or outputs described in the article.

opening_mechanism_summary
One normalized sentence describing what the article is fundamentally about.

architectural_enemy_pattern
The anti-pattern or failure mode this article argues against. Normalized short label.

failure_mode_labels
Normalized short labels from any breakdown or caveat section.

team_sections_covered
List of team names or audience segments mentioned.

rhetorical_structure
One normalized phrase describing the article's dominant structural pattern.

primary_reader
The job title or role the article directly addresses.

sample_output_type
What the concrete artifact or output is — the thing the article produces or describes.

comparison_targets
The alternatives named in any comparison table (the non-product rows).

Article to extract from:
${articleBodyMarkdown}`;
}

function extractFingerprint(articleBodyMarkdown, slug = 'unknown', model = null) {
  const prompt = buildFingerprintPrompt(articleBodyMarkdown);
  const args = model ? ['-p', prompt, '--model', model] : ['-p', prompt];

  let result;
  try {
    result = spawnSync('claude', args, {
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`  [fingerprint] Claude spawn error (${slug}): ${err.message}`);
    return null;
  }

  if (result.error) {
    const msg = result.error.code === 'ENOENT'
      ? 'claude CLI not found on PATH'
      : `claude CLI error: ${result.error.message}`;
    console.error(`  [fingerprint] ${msg} (${slug})`);
    return null;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').slice(0, 300);
    console.error(`  [fingerprint] claude CLI exited ${result.status} (${slug}): ${stderr}`);
    return null;
  }

  try {
    return extractJsonObject(result.stdout);
  } catch (err) {
    console.error(`  [fingerprint] JSON parse error (${slug}): ${err.message}`);
    return null;
  }
}

// ── Local fingerprint (no Claude call) ───────────────────────────────────────
// Heuristic extraction from the article markdown + source row. Cheaper and
// deterministic; sufficient for corpus redundancy detection.
function extractFingerprintLocal(articleBodyMarkdown, slug = 'unknown', row = {}) {
  const md = (articleBodyMarkdown || '').replace(/<!--[\s\S]*?-->/g, '');
  const lines = md.split('\n');
  const h2 = lines.filter((l) => /^##\s+\S/.test(l) && !/^###/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());

  const boldLeadIns = (md.match(/\*\*([^*]{3,60})\*\*/g) || []).map((s) => s.replace(/\*\*/g, '').trim());

  const breakIdx = lines.findIndex((l) => /^##\s*Where this breaks down/i.test(l));
  let failureLabels = [];
  if (breakIdx !== -1) {
    const nextH2 = lines.findIndex((l, i) => i > breakIdx && /^##\s/.test(l));
    const seg = lines.slice(breakIdx + 1, nextH2 === -1 ? undefined : nextH2).join('\n');
    failureLabels = (seg.match(/\*\*([^*]{3,60})\*\*/g) || []).map((s) => s.replace(/\*\*/g, '').replace(/[:.]$/, '').trim()).slice(0, 4);
  }

  let comparisonTargets = (row.comparison_targets || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (comparisonTargets.length === 0) {
    const tableRows = lines.filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/Approach\s*\|/i.test(l));
    comparisonTargets = tableRows.map((l) => l.split('|')[1]?.replace(/\*\*/g, '').trim()).filter(Boolean).slice(0, 4);
  }

  const artifactHeading = (h2.find((h) => /looks like/i.test(h)) || '').replace(/^What the\s*/i, '').replace(/\s*looks like$/i, '').trim();
  const sampleOutputType = artifactHeading || (row.sample_output || '').split(/[:.]/)[0].slice(0, 40).trim() || 'article';

  const personaHeading = (h2.find((h) => /^What changes for/i.test(h)) || '').replace(/^What changes for (the\s*)?/i, '').trim();
  const primaryReader = (row.primary_persona || personaHeading || row.primary_team || 'reader').trim();

  return {
    key_phrases: [...new Set(boldLeadIns)].slice(0, 8),
    operational_patterns: failureLabels.slice(0, 3),
    downstream_effects: (() => {
      const dIdx = lines.findIndex((l) => /^##\s*Downstream effects/i.test(l));
      if (dIdx === -1) return [];
      return (lines.slice(dIdx + 1, dIdx + 12).join('\n').match(/\*\*([^*]{3,70})\*\*/g) || []).map((s) => s.replace(/\*\*/g, '').replace(/[:.]$/, '').trim()).slice(0, 3);
    })(),
    named_artifacts: [sampleOutputType].filter(Boolean),
    opening_mechanism_summary: (lines.find((l) => l.length > 40 && !/^#/.test(l)) || '').trim().slice(0, 200),
    architectural_enemy_pattern: 'manual process / opinion-based decision',
    failure_mode_labels: failureLabels,
    team_sections_covered: [primaryReader],
    rhetorical_structure: 'answer-first, evidence-led',
    primary_reader: primaryReader,
    sample_output_type: sampleOutputType,
    comparison_targets: comparisonTargets,
    _source: 'local',
  };
}

module.exports = { extractFingerprint, extractFingerprintLocal };
