// Article Pipeline — Marketing site server
// Serves the marketing site at http://localhost:3738
// Usage: node ui/marketing-server.js
// Or:    npm run marketing

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.MARKETING_PORT || 3738;
const MARKETING_DIR = path.join(__dirname, 'marketing');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath;

  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(MARKETING_DIR, 'index.html');
  } else {
    filePath = path.join(MARKETING_DIR, urlPath);
  }

  // Safety: restrict to marketing directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(MARKETING_DIR))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Marketing site running at http://localhost:${PORT}`);
  console.log(`Serving files from: ${MARKETING_DIR}`);
  console.log('Press Ctrl+C to stop.');
});
