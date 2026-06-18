// Parses a Markdown body into structured H2 sections.
//
// Returns:
// {
//   intro:    string,          // content before the first ## heading
//   sections: Array<{
//     heading: string,         // H2 heading text, without leading "## "
//     level:   2,
//     markdown: string,        // body of the section (H3+ preserved inside)
//   }>
// }

// Removes escaped quotes and HTML comment build notes before parsing.
function preClean(markdown) {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\(["'])/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// parseMarkdownSections splits by ## H2 headings only.
// H3 headings (###) are kept as content inside their enclosing H2 section.
function parseMarkdownSections(markdown) {
  const src = preClean(markdown);
  const lines = src.split('\n');

  const intro = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    // Match ## but not ### (three or more hashes)
    const h2Match = /^## (.+)$/.exec(line);
    if (h2Match) {
      if (current) {
        sections.push(finalise(current));
      }
      current = { heading: h2Match[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  if (current) sections.push(finalise(current));

  return {
    intro:    trimBlock(intro.join('\n')),
    sections,
  };
}

function finalise(raw) {
  return {
    heading:  raw.heading,
    level:    2,
    markdown: trimBlock(raw.lines.join('\n')),
  };
}

function trimBlock(text) {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// normalizeHeading — makes heading comparison case- and punctuation-insensitive.
// Used when sectionMatching = "normalized".
function normalizeHeading(heading) {
  return String(heading || '')
    .toLowerCase()
    .replace(/[?!.,;:'"()\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// findSection — looks up a section by heading text.
// matching: "exact" (default) | "normalized"
// Returns the first matching section or null.
function findSection(sections, targetHeading, matching) {
  if (!matching || matching === 'exact') {
    return sections.find((s) => s.heading === targetHeading) || null;
  }
  const norm = normalizeHeading(targetHeading);
  return sections.find((s) => normalizeHeading(s.heading) === norm) || null;
}

module.exports = { parseMarkdownSections, normalizeHeading, findSection };
