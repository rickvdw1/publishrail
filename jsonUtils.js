function extractJsonObject(rawText) {
  let text = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch (_) {}

  const start = text.indexOf('{');
  if (start !== -1) {
    try {
      return JSON.parse(text.slice(start));
    } catch (_) {}

    const end = text.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }
  }

  throw new Error(`No valid JSON object in response. First 300 chars: ${rawText.slice(0, 300)}`);
}

module.exports = { extractJsonObject };
