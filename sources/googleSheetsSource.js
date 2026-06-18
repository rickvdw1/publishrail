// Google Sheets source adapter.
//
// Prerequisites:
//   1. Enable the Google Sheets API in Google Cloud Console.
//   2. Create a service account and download its JSON credentials.
//   3. Share your spreadsheet with the service account email.
//   4. npm install googleapis
//
// Required env vars:
//   GOOGLE_SERVICE_ACCOUNT_KEY_PATH=  # absolute path to credentials JSON
//   GOOGLE_SPREADSHEET_ID=            # from the spreadsheet URL
//   GOOGLE_SHEET_NAME=Sheet1          # tab name (default: Sheet1)
//
// The first row of the sheet is treated as headers.
// Column names must match the article field names in README.md.
// The "article_status" column is required; rows where it is not "not_started" are skipped.

const fs = require('fs');
const path = require('path');

function getConfig() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  if (!keyPath) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set in .env');
  if (!spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID is not set in .env');
  return {
    keyPath: path.resolve(keyPath),
    spreadsheetId,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',
  };
}

function loadAuth(keyPath) {
  try {
    // eslint-disable-next-line node/no-unpublished-require
    const { google } = require('googleapis');
    const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    return new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'googleapis package is not installed. Run: npm install googleapis'
      );
    }
    throw err;
  }
}

async function fetchAllRows() {
  const { google } = require('googleapis');
  const cfg = getConfig();
  const auth = loadAuth(cfg.keyPath);
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: cfg.sheetName,
  });

  const [headers, ...dataRows] = res.data.values ?? [];
  if (!headers || dataRows.length === 0) return [];

  return dataRows.map((row, i) => {
    const obj = { Id: i + 2 }; // row 1 = headers, row 2 = first data row
    headers.forEach((h, j) => {
      obj[h] = row[j] ?? '';
    });
    return obj;
  });
}

async function loadNotStartedGoogleSheetsRows(limit = 10) {
  const rows = await fetchAllRows();
  return rows
    .filter((r) => !r.article_status || r.article_status === 'not_started')
    .slice(0, limit);
}

async function loadGoogleSheetsRows() {
  return fetchAllRows();
}

module.exports = { loadGoogleSheetsRows, loadNotStartedGoogleSheetsRows };
