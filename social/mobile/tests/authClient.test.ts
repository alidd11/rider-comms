import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AccountApiError, AccountConnectionError, RiderAccountClient, accountErrorMessage, RESET_SENT_TEXT } from '../src/authClient.ts';
import type { TokenStorage } from '../src/authClient.ts';

function response(code: number, body: unknown) {
  if (code === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}
function environment(initial: string | null = null) {
  let stored = initial;
  let clears = 0;
  const calls: { pathname: string; body: unknown; method: string; authenticated: boolean }[] = [];
  const queue: Response[] = [];
  const storage: TokenStorage = {
    read: async () => stored,
    write: async value => { stored = value; },
    clear: async () => { stored = null; clears += 1; },
  };
  const transport = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      pathname: new URL(url).pathname,
      method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) as unknown : undefined,
      authenticated: Boolean((init.headers as Record<string, string>).Authorization),
    });
    const next = queue.shift();
    if (!next) throw Error('Mock request was not configured');
    return next;
  };
  const client = new RiderAccountClient(storage, transport);
  return { client, calls, queue, get stored() { return stored; }, get clears() { return clears; } };
}
function identity(overrides: Record<string, unknown> = {}) {
  return { riderId: randomUUID(), username: 'test-rider', emailVerified: false,
    termsAccepted: true, termsVersion: 'terms-test-version', ...overrides };
}
test('shared account login validates /auth/me and persists token only after full-account identity', async () => {
  const env = environment();
  const user = identity();
  const issued = randomUUID();
  const secret = randomUUID();
  env.queue.push(response(200, { riderId: user.riderId, token: issued, emailVerified: false, termsAccepted: true }),
    response(200, user));
  const result = await env.client.login('test-rider', secret, 'Rider Social on web');
  assert.equal(result.riderId, user.riderId);
  assert.equal(env.stored, issued);
  assert.deepEqual(env.calls.map(x => x.pathname), ['/auth/login', '/auth/me']);
  assert.equal(env.calls[0].authenticated, false);
  assert.equal(env.calls[1].authenticated, true);
  assert.equal((env.calls[0].body as Record<string, unknown>).deviceName, 'Rider Social on web');
  assert.equal((env.calls[0].body as Record<string, unknown>).password, secret);
});
test('failed browser connection is distinct from invalid credentials and never persists a token', async () => {
  let stored: string | null = null;
  const storage: TokenStorage = {
    read: async () => stored,
    write: async value => { stored = value; },
    clear: async () => { stored = null; },
  };
  let requests = 0;
  const client = new RiderAccountClient(storage, async () => {
    requests += 1;
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(client.login('sample-rider', randomUUID(), 'Test device'), error =>
    error instanceof AccountConnectionError && !(error instanceof AccountApiError));
  assert.equal(stored, null);
  assert.equal(requests, 1);
  assert.match(accountErrorMessage(new AccountConnectionError()), /can’t connect/i);
});
test('login errors map backend response codes, including rate limits and suspended accounts', async () => {
  const codes: Array<[number, string]> = [
    [401, 'invalid_credentials'], [403, 'account_suspended'], [429, 'rate_limited'],
    [409, 'username_taken'], [409, 'email_taken'], [400, 'invalid_username'],
    [400, 'invalid_email'], [400, 'weak_password'],
    [400, 'objectionable_username'], [400, 'terms_not_accepted'],
  ];
  for (const [status, code] of codes) {
    const env = environment();
    env.queue.push(response(status, { error: code }));
    await assert.rejects(env.client.login('rider', randomUUID(), 'Test device'),
      (error: unknown) => error instanceof AccountApiError && error.status === status && error.code === code);
    assert.equal(env.stored, null);
  }
  assert.equal(accountErrorMessage(new AccountApiError(429, 'rate_limited')),
    'Too many attempts. Try again in a few minutes.');
  assert.equal(accountErrorMessage(new AccountApiError(403, 'account_suspended')).includes('suspended'), true);
});
test('signup never submits acceptTerms without explicit consent', async () => {
  const env = environment();
  await assert.rejects(env.client.signup('rider', 'rider@example.invalid', randomUUID(), 'Test device', false),
    (error: unknown) => error instanceof AccountApiError && error.code === 'terms_not_accepted');
  assert.equal(env.calls.length, 0);
  const user = identity();
  env.queue.push(response(201, { riderId: user.riderId, token: randomUUID(), emailVerified: false, termsAccepted: true }),
    response(200, user));
  await env.client.signup('rider', 'rider@example.invalid', randomUUID(), 'Test device', true);
  assert.equal((env.calls[0].body as Record<string, unknown>).acceptTerms, true);
  assert.equal(env.calls[0].pathname, '/auth/signup');
});
test('cold launch rejects null-username guest and clears its token', async () => {
  const env = environment(randomUUID());
  env.queue.push(response(200, identity({ username: null })));
  assert.equal(await env.client.restore(), null);
  assert.equal(env.stored, null);
  assert.equal(env.client.identity, null);
  assert.equal(env.clears, 1);
});
test('a protected 401 clears the session, notifies the UI, and is not retried', async () => {
  const env = environment(randomUUID());
  const user = identity();
  let expired = 0;
  env.client.setSessionExpiredHandler(() => { expired += 1; });
  env.queue.push(response(200, user));
  assert.equal((await env.client.restore())?.username, user.username);
  env.queue.push(response(401, { error: 'invalid_session' }));
  await assert.rejects(env.client.friends(), (error: unknown) =>
    error instanceof AccountApiError && error.status === 401);
  assert.equal(env.stored, null);
  assert.equal(expired, 1);
  assert.deepEqual(env.calls.map(c => c.pathname), ['/auth/me', '/riders/' + user.riderId + '/friends']);
});
test('403 read-only feature errors never clear an otherwise valid session', async () => {
  const env = environment(randomUUID());
  const user = identity();
  env.queue.push(response(200, user), response(403, { error: 'not_verified' }));
  await env.client.restore();
  await assert.rejects(env.client.conversations(), (error: unknown) => error instanceof AccountApiError && error.status === 403);
  assert.notEqual(env.stored, null);
  assert.match(accountErrorMessage(new AccountApiError(403, 'not_verified')), /Verify your email/);
});
test('logout revokes server token and always deletes local token, including server errors', async () => {
  for (const status of [204, 500]) {
    const env = environment(randomUUID());
    env.queue.push(response(200, identity()));
    await env.client.restore();
    env.queue.push(response(status, status === 204 ? null : { error: 'unavailable' }));
    if (status === 204) await env.client.logout();
    else await assert.rejects(env.client.logout());
    assert.equal(env.stored, null);
    assert.equal(env.client.identity, null);
    assert.equal(env.calls.at(-1)?.pathname, '/auth/logout');
  }
});
test('password reset always displays the account-enumeration-safe message', async () => {
  const env = environment();
  env.queue.push(response(202, { accepted: true }));
  await env.client.requestPasswordReset(' person@example.invalid ');
  assert.equal(RESET_SENT_TEXT, "If that email has an account, we've sent a reset link.");
  assert.equal(env.calls[0].authenticated, false);
});
test('terms acceptance uses only current /auth/me termsVersion', async () => {
  const env = environment(randomUUID());
  const user = identity({ termsAccepted: false });
  env.queue.push(response(200, user));
  await env.client.restore();
  await assert.rejects(env.client.acceptTerms('outdated'), (error: unknown) =>
    error instanceof AccountApiError && error.status === 409);
  env.queue.push(response(200, { accepted: true }), response(200, identity({
    riderId: user.riderId, termsAccepted: true,
  })));
  const accepted = await env.client.acceptTerms('terms-test-version');
  assert.equal(accepted.termsAccepted, true);
  assert.deepEqual(env.calls.slice(-2).map(c => c.pathname), ['/auth/accept-terms', '/auth/me']);
});
