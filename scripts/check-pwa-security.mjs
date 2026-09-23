import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, app] = await Promise.all([
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
]);

const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
assert.ok(cspMatch, 'PWA must declare a Content Security Policy before loading external resources');
const policy = cspMatch[1];

function directive(name) {
  const entry = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  assert.ok(entry, `PWA CSP is missing ${name}`);
  return entry;
}

assert.ok(
  html.indexOf('http-equiv="Content-Security-Policy"') < html.indexOf('<link rel="preconnect"'),
  'PWA CSP must be parsed before external resource hints and stylesheets',
);

assert.equal(directive('default-src'), "default-src 'self'");
assert.equal(directive('base-uri'), "base-uri 'self'");
assert.equal(directive('object-src'), "object-src 'none'");
assert.equal(directive('form-action'), "form-action 'self'");

const scriptSrc = directive('script-src');
for (const source of [
  "'self'",
  "'unsafe-eval'",
  'https://*.googleapis.com',
  'https://*.gstatic.com',
  'https://*.google.com',
  'https://*.ggpht.com',
  'https://*.googleusercontent.com',
  'https://cdn.jsdelivr.net',
  'blob:',
]) {
  assert.ok(scriptSrc.includes(source), `PWA script-src must allow required source: ${source}`);
}
assert.equal(
  scriptSrc.includes("'unsafe-inline'"),
  false,
  'PWA scripts must not permit arbitrary inline JavaScript',
);

const connectSrc = directive('connect-src');
for (const source of [
  "'self'",
  'https://backend-production-7fa0.up.railway.app',
  'https://*.googleapis.com',
  'https://*.gstatic.com',
  'https://*.google.com',
  'wss:',
]) {
  assert.ok(connectSrc.includes(source), `PWA connect-src must allow required source: ${source}`);
}

const imageSrc = directive('img-src');
for (const source of [
  "'self'",
  'data:',
  'blob:',
  'https://images.unsplash.com',
  'https://upload.wikimedia.org',
  'https://thumb.wikimedia.org',
]) {
  assert.ok(imageSrc.includes(source), `PWA img-src must allow required source: ${source}`);
}

for (const required of [
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
]) {
  assert.ok(policy.includes(required), `PWA CSP contract missing: ${required}`);
}

for (const forbidden of [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /document\.write\s*\(/,
  /insertAdjacentHTML\s*\(/,
]) {
  assert.doesNotMatch(app, forbidden, `PWA source contains prohibited dynamic-code/HTML API: ${forbidden}`);
}

const stripStart = app.indexOf('function stripHtml(html)');
const stripEnd = app.indexOf('const navigationGuidance', stripStart);
assert.ok(stripStart >= 0 && stripEnd > stripStart, 'Could not inspect navigation provider text sanitizer');
const stripHtml = app.slice(stripStart, stripEnd);
assert.equal(stripHtml.includes('.innerHTML'), false, 'Provider navigation HTML must never be parsed through innerHTML');
assert.equal(stripHtml.includes('DOMParser'), false, 'Provider navigation HTML must not be parsed as a DOM document');
assert.ok(stripHtml.includes(".replace(/<[^>]+>/g, '')"), 'Provider navigation sanitizer must strip markup as text');
assert.ok(stripHtml.includes('NAVIGATION_HTML_ENTITIES'), 'Provider navigation sanitizer must explicitly decode its allowed entity set');

for (const escapedExternalValue of [
  'escapeHtml(message.text)',
  'escapeHtml(prediction.structured_formatting?.main_text || prediction.description)',
  'escapeHtml(place.name)',
  'escapeHtml(place.address || \'Address unavailable\')',
  'escapeHtml(person.displayName)',
  'escapeHtml(hideout.name)',
]) {
  assert.ok(app.includes(escapedExternalValue), `PWA external text escaping contract missing: ${escapedExternalValue}`);
}

assert.ok(
  app.includes("https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js"),
  'PWA LiveKit runtime must remain pinned to an exact CDN version',
);
assert.ok(
  app.includes('https://maps.googleapis.com/maps/api/js?key='),
  'PWA Maps runtime must load over HTTPS from the CSP-allowed Google Maps origin',
);

console.log('PWA CSP and XSS safety contracts valid');
