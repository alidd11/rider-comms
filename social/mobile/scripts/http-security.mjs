import { createHash } from 'node:crypto';

// The web preview holds Rider Comms session tokens in tab sessionStorage.
// A hash allowlist for the known inline bootstrap scripts reduces XSS/token
// exfiltration exposure without enabling arbitrary third-party JavaScript.
export function inlineScriptHashes(html) {
  if (typeof html !== 'string') return [];
  const hashes = [];
  for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(tag[1]) || !tag[2].trim()) continue;
    hashes.push("'sha256-" + createHash('sha256').update(tag[2], 'utf8').digest('base64') + "'");
  }
  return [...new Set(hashes)];
}

export function securityHeaders(html = '') {
  const scripts = inlineScriptHashes(html);
  const policy = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self'" + (scripts.length ? ' ' + scripts.join(' ') : ''),
    // React Native Web uses style attributes for layout; limit this exception
    // to styles, not scripts.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "media-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://backend-production-7fa0.up.railway.app",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  return {
    'Content-Security-Policy': policy,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(self), microphone=(self), payment=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cache-Control': 'no-store',
  };
}
