const { fetchRowsByArticleStatus } = require('../sources/nocodbSource');

async function loadReadyRows(pageSize = 100) {
  const rows = [];
  let offset = 0;

  while (true) {
    const batch = await fetchRowsByArticleStatus('ready_for_export', { limit: pageSize, offset });
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return rows;
}

module.exports = { loadReadyRows };
