import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendVerificationEmail } from '../src/email.ts';

// Same fake-fetch shape as mobile/tests/places.test.ts's fakeFetch: never
// touches the network, and hands the handler the URL + init so it can
// assert on exactly what was sent to Resend.
function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body ?? {} } as Response;
  }) as typeof fetch;
}

describe('sendVerificationEmail', () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM_EMAIL;
  const originalPublicAppUrl = process.env.PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = originalFrom;
    if (originalPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = originalPublicAppUrl;
  });

  it('skips sending and returns false, without calling the network, when RESEND_API_KEY is unset', async () => {
    process.env.RESEND_FROM_EMAIL = 'noreply@example.com';
    let called = false;
    const fetchImpl = (async () => { called = true; return { ok: true, json: async () => ({}) } as Response; }) as typeof fetch;

    const sent = await sendVerificationEmail('rider@example.com', 'sometoken', { fetchImpl });
    assert.equal(sent, false);
    assert.equal(called, false);
  });

  it('skips sending when RESEND_FROM_EMAIL is unset, even with an API key present', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    let called = false;
    const fetchImpl = (async () => { called = true; return { ok: true, json: async () => ({}) } as Response; }) as typeof fetch;

    const sent = await sendVerificationEmail('rider@example.com', 'sometoken', { fetchImpl });
    assert.equal(sent, false);
    assert.equal(called, false);
  });

  it('posts to the Resend API with the token in the link and body when configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'noreply@example.com';

    const sent = await sendVerificationEmail(
      'rider@example.com',
      'sometoken123',
      {
        fetchImpl: fakeFetch((url, init) => {
          assert.equal(url, 'https://api.resend.com/emails');
          assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
          const body = JSON.parse(init.body as string);
          assert.equal(body.from, 'noreply@example.com');
          assert.equal(body.to, 'rider@example.com');
          assert.match(body.text, /sometoken123/);
          assert.match(body.html, /sometoken123/);
          assert.match(body.text, /https:\/\/alidd11\.github\.io\/rider-comms\/\?verifyToken=sometoken123/);
          return { status: 200 };
        }),
      }
    );
    assert.equal(sent, true);
  });

  it('returns false without throwing on a non-2xx response from Resend', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'noreply@example.com';

    const sent = await sendVerificationEmail('rider@example.com', 'sometoken', {
      fetchImpl: fakeFetch(() => ({ status: 422 })),
    });
    assert.equal(sent, false);
  });

  it('returns false without throwing when the fetch implementation itself throws', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'noreply@example.com';
    const throwingFetch = (async () => { throw new Error('network down'); }) as typeof fetch;

    const sent = await sendVerificationEmail('rider@example.com', 'sometoken', { fetchImpl: throwingFetch });
    assert.equal(sent, false);
  });
});
