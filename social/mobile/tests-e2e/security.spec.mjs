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
  expect(policy).toContain("connect-src 'self' blob: data: https://backend-production-7fa0.up.railway.app");
  // Posted photos and Reels come from the API.
  expect(policy).toContain("media-src 'self' blob: data: https://backend-production-7fa0.up.railway.app;");
  // Featured photos and clips ship with the app; no third-party media host.
  expect(policy).not.toContain('pexels.com');
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


test('Social web displays hostile profile text without executing HTML', async ({ page }) => {
  const api = 'https://backend-production-7fa0.up.railway.app';
  const riderId = 'rider_social_security_fixture';
  const hostile = '<img src=x onerror="window.__riderSocialXss=1">';
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
  };
  await page.route(api + '/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body;
    let status = 200;
    if (path === '/auth/me') body = { riderId, username: 'security-fixture', emailVerified: true, termsAccepted: true, termsVersion: 'terms-fixture' };
    else if (path === '/social/bootstrap') body = { entitlement: 'pilot', policyVersion: 'social-pilot-v1', capabilities: {
      mediaUpload: false, privatePosting: false, publicPosting: false, liveStreaming: false, marketplaceCheckout: false, creatorPayouts: false,
    } };
    else if (path === '/riders/' + riderId + '/profile') body = { riderId, displayName: hostile, handle: '@security_fixture', avatarId: 'ember', bio: hostile };
    else if (path === '/riders/' + riderId + '/friends') body = { friends: [], nextCursor: null };
    else if (path === '/conversations') body = { conversations: [], nextCursor: null };
    else { status = 404; body = { error: 'not_found' }; }
    return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript((id) => {
    window.sessionStorage.setItem('rider_social_account_session_v1', 'synthetic-security-test-token');
    window.sessionStorage.setItem('rider_social_age_ack_v1', id);
  }, riderId);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open profile' }).click();
  await expect(page.getByTestId('social-profile-summary')).toContainText(hostile);
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__riderSocialXss)).toBeUndefined();
});
