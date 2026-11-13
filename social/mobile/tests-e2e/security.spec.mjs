/* global process */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

/**
 * Security-contract tests run only against the local Playwright static server.
 * No live credentials, production Rider Comms requests or session values.
 */
test('Social beta sends a strict static content policy and privacy headers', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['permissions-policy']).toContain('geolocation=()');
  expect(headers['permissions-policy']).toContain('camera=(self)');
  const policy = headers['content-security-policy'] ?? '';
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("connect-src 'self' https://backend-production-7fa0.up.railway.app");
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(policy).not.toContain("'unsafe-eval'");
  // Every trusted inline script in the exported PWA must be authorised by
  // its *exact* SHA-256 hash rather than all arbitrary inline scripts.
  const html = await response.text();
  expect(html).toContain('name="robots" content="noindex, nofollow, noarchive"');
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(Boolean);
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const script of inlineScripts) {
    const digest = createHash('sha256').update(script, 'utf8').digest('base64');
    expect(policy).toContain("'sha256-" + digest + "'");
  }
});

test('static Social server does not accept account writes or expose escaped filesystem paths', async ({ request }) => {
  const write = await request.post('/auth/login', { data: { username: 'fixture-user' } });
  expect(write.status()).toBe(405);
  expect(write.headers()['allow']).toBe('GET, HEAD');
  expect(write.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const traversal = await request.get('/%2E%2E%2F%2E%2E%2F%2E%2E%2Fetc%2Fpasswd');
  expect([403, 404]).toContain(traversal.status());
  const body = await traversal.text();
  expect(body).not.toContain('root:');
  expect(body).not.toContain('/bin/bash');
});
