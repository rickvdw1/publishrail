require('dotenv').config();
const http = require('http');
const https = require('https');
const axios = require('axios');

// Fresh agents per request — disables keep-alive so stale connections don't cause EPIPE
// after the Claude CLI spends several minutes generating an article.
const httpAgent  = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

function resolveApiBase() {
  const raw = process.env.NOCODB_API_URL || process.env.NOCODB_BASE_URL;
  if (!raw) throw new Error('NOCODB_BASE_URL (or NOCODB_API_URL) is not set in .env');
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    throw new Error(`Cannot parse NOCODB_BASE_URL as a URL: "${raw}"`);
  }
}

function getTableId() {
  const id = process.env.NOCODB_TABLE_ID;
  if (!id) throw new Error('NOCODB_TABLE_ID is not set in .env');
  return id;
}

function makeClient() {
  return axios.create({
    baseURL: resolveApiBase(),
    headers: {
      'xc-token': process.env.NOCODB_API_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
    httpAgent,
    httpsAgent,
  });
}

function recordsPath() {
  return `/api/v2/tables/${getTableId()}/records`;
}

async function fetchNotStartedRows(limit = 10) {
  const client = makeClient();
  const rpath = recordsPath();
  const base = resolveApiBase();
  console.log(`[source:nocodb] GET ${base}${rpath}  where=(article_status,eq,not_started)  limit=${limit}`);

  const response = await client.get(rpath, {
    params: {
      where: '(article_status,eq,not_started)~or(article_status,is,null)',
      limit,
    },
  });

  const rows = response.data?.list ?? [];
  console.log(`[source:nocodb] Fetched ${rows.length} row(s)`);
  return rows;
}

async function fetchRowsByArticleStatus(status, opts = {}) {
  const { limit = 10, offset = 0 } = typeof opts === 'number' ? { limit: opts } : opts;
  const client = makeClient();
  const rpath = recordsPath();
  const base = resolveApiBase();
  console.log(`[source:nocodb] GET ${base}${rpath}  where=(article_status,eq,${status})  limit=${limit} offset=${offset}`);

  const response = await client.get(rpath, {
    params: {
      where: `(article_status,eq,${status})`,
      limit,
      offset,
      sort: 'Id',
    },
  });

  const rows = response.data?.list ?? [];
  console.log(`[source:nocodb] Fetched ${rows.length} row(s)`);
  return rows;
}

async function fetchRowById(rowId) {
  const client = makeClient();
  const rpath = `${recordsPath()}/${rowId}`;
  const base = resolveApiBase();
  console.log(`[source:nocodb] GET ${base}${rpath}  (single row by Id)`);
  const response = await client.get(rpath);
  const row = response.data;
  if (!row || (row.Id == null && row.id == null)) return null;
  return row;
}

const JSON_FIELDS = ['faq_json', 'schema_jsonld'];

function serializeForNocodb(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    if (JSON_FIELDS.includes(key) && val !== null && typeof val === 'object') {
      out[key] = JSON.stringify(val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

async function updateRow(rowId, fields) {
  const client = makeClient();
  const rpath = recordsPath();
  const prepared = serializeForNocodb(fields);
  console.log(`[source:nocodb] PATCH row ${rowId} → fields: ${Object.keys(prepared).join(', ')}`);

  const response = await client.patch(rpath, [{ Id: rowId, ...prepared }]);
  return response.data;
}

async function createRow(fields) {
  const client = makeClient();
  const rpath = recordsPath();
  const prepared = serializeForNocodb(fields);
  console.log(`[source:nocodb] POST new row → fields: ${Object.keys(prepared).join(', ')}`);

  const response = await client.post(rpath, prepared);
  const id = response.data?.Id ?? response.data?.id;
  if (!id) throw new Error(`createRow: NocoDB did not return an Id. Response: ${JSON.stringify(response.data)}`);
  console.log(`[source:nocodb] Created row Id=${id}`);
  return id;
}

module.exports = { fetchNotStartedRows, fetchRowsByArticleStatus, fetchRowById, updateRow, createRow };
