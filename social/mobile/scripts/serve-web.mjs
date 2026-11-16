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
// Every photo and clip in the shipped app is either bundled or comes from the
// API. Only the screenshot build, which shows sample photos, may load Unsplash.
const fixtureBuild = await stat(resolve(dist, '.fixture-build')).then(() => true, () => false);
const sampleImageHost = fixtureBuild ? ' https://images.unsplash.com' : '';
const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' " + inlineScriptHashes.join(' '),
    "style-src 'self' 'unsafe-inline'",
    // Rider Social photos and Reels come from the API through short-lived signed links.
    "img-src 'self' blob: data: https://backend-production-7fa0.up.railway.app" + sampleImageHost,
    "font-src 'self' data:",
    // blob:/data: let the app read a photo or video the rider picked before uploading it.
    "connect-src 'self' blob: data: https://backend-production-7fa0.up.railway.app",
    "media-src 'self' blob: data: https://backend-production-7fa0.up.railway.app",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  // This deployment is a private-testing preview, not a searchable product.
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cross-Origin-Resource-Policy': 'same-origin',
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
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
    const headers = {
      ...securityHeaders,
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    // Bundled photos and clips have a content hash in their name, so a
    // browser may keep them; everything else stays uncached.
    if (requested.startsWith('/assets/') && /\.[0-9a-f]{16,}\.[a-z0-9]+$/i.test(requested)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    // Safari plays video only from a server that answers byte ranges.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const size = bytes.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + size }).end(); return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
        .end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404, securityHeaders).end('Not found');
  }
}).listen(port, '0.0.0.0');
