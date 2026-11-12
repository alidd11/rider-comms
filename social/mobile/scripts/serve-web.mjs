/* global process, URL */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf'
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const requested = decodeURIComponent(url.pathname);
    if (requested.includes('\0')) throw new Error('invalid path');
    const target = resolve(dist, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
    if (target !== dist && !target.startsWith(dist + sep)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    let file = target;
    try {
      if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html');
    } catch {
      if (extname(requested)) { res.writeHead(404).end('Not found'); return; }
      file = resolve(dist, 'index.html');
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }).end(bytes);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '0.0.0.0');
