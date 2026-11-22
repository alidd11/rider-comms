// Black-box HTTP probes intentionally restricted to a disposable GitHub runner.
import assert from 'node:assert/strict';

const target = new URL(process.env.SECURITY_API_BASE_URL ?? '');
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.SECURITY_ISOLATED_RUN !== '1' ||
    target.href !== 'http://127.0.0.1:4186/') {
  throw new Error('refusing_non_loopback_security_probe');
}
const request = (path, init) => fetch(new URL(path, target), { redirect: 'error', cache: 'no-store', ...init });
const health = await request('/health');
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });
assert.equal(health.headers.get('cache-control'), 'no-store');
assert.equal(health.headers.get('x-frame-options'), 'DENY');
assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
assert.match(health.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);

assert.equal((await request('/ready')).status, 200);
const openapi = await request('/openapi.json');
assert.equal(openapi.status, 200);
assert.match(openapi.headers.get('content-type') ?? '', /application\/json/);
assert.ok(await openapi.json());
const cfg = await request('/config');
assert.equal(cfg.status, 200);
assert.deepEqual(await cfg.json(), { googleMapsApiKey: '' });

for (const path of [
  '/auth/me', '/admin/me', '/admin/overview', '/admin/security-events',
  '/messages?withRiderId=unrelated', '/conversations', '/rides/current',
  '/social/events?waitMs=0', '/social/bootstrap',
]) {
  const response = await request(path, {
    headers: { Authorization: 'Bearer invalid-synthetic-token', 'X-Rider-Id': 'admin', 'X-Staff-Role': 'admin' },
  });
  assert.equal(response.status, 401, path + ': must require actual authentication');
}
const forged = await request('/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Rider-Id': 'admin' },
  body: JSON.stringify({ toRiderId: 'victim', text: '<img src=x onerror=alert(1)>' }),
});
assert.equal(forged.status, 401);

const evilOrigin = await request('/health', { headers: { Origin: 'https://attacker.example' } });
assert.equal(evilOrigin.status, 403);
assert.equal(evilOrigin.headers.get('access-control-allow-origin'), null);
const localOrigin = await request('/health', { headers: { Origin: 'http://localhost:4186' } });
assert.equal(localOrigin.status, 200);
assert.equal(localOrigin.headers.get('access-control-allow-origin'), 'http://localhost:4186');
const hostileHeader = await request('/health', { headers: { 'X-Request-ID': '<script>alert(1)</script>' } });
assert.equal(hostileHeader.status, 200);
assert.match(hostileHeader.headers.get('x-request-id') ?? '', /^[A-Za-z0-9._-]{8,128}$/);
assert.notEqual(hostileHeader.headers.get('x-request-id'), '<script>alert(1)</script>');

const malformed = await request('/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":',
});
assert.equal(malformed.status, 400);
const tooLarge = await request('/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x'.repeat(33000), password: 'synthetic' }),
});
assert.equal(tooLarge.status, 413);
console.log('Isolated API security probes passed: localhost target only; no live riders.');
