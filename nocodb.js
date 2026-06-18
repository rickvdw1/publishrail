// Backward-compatible re-export — the canonical source is sources/nocodbSource.js.
// This shim lets existing scripts (syncOutputToNocodb.js, sync-local-article.js,
// setup-nocodb-table.js) keep working without changes.
module.exports = require('./sources/nocodbSource');
