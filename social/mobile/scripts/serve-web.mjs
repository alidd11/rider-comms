/* global process, URL */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
// The PWA has a single trusted inline viewport bootstrap. Hash the exact
// compiled inline scripts instead of allowing arbitrary inline JavaScript.
const entryHtml = await readFile(resolve(dist, 'index.html'), 'utf8');
const inlineScriptHashes = [...entryHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(Boolean)
  .map(script => "'sha256-" + createHash('sha256').update(script, 'utf8').digest('base64') + "'");
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' " + inlineScriptHashes.join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://images.unsplash.com",
    "font-src 'self' data:",
    "connect-src 'self' https://backend-production-7fa0.up.railway.app",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Cache-Control': 'no-store',
};
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
    // No request logging, query logging, cookies or public credentials in URLs.
    // The static host must never become an authenticated API proxy.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...securityHeaders, Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const requested = decodeURIComponent(url.pathname);
    if (requested.includes('\0')) throw new Error('invalid path');
    const target = resolve(dist, '.' + (requested.endsWith('/') ? requested + 'index.html' : requested));
    if (target !== dist && !target.startsWith(dist + sep)) {
      res.writeHead(403, securityHeaders).end('Forbidden'); return;
    }
    let file = target;
    try {
      if (!(await stat(file)).isFile()) file = resolve(dist, 'index.html');
    } catch {
      if (extname(requested)) { res.writeHead(404, securityHeaders).end('Not found'); return; }
      file = resolve(dist, 'index.html');
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
    }).end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404, securityHeaders).end('Not found');
  }
}).listen(port, '0.0.0.0');
