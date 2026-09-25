import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type http from 'node:http';
import {
  applyCors,
  bearerToken,
  clientAddress,
  isCoordinate,
  rateLimitSubject,
  readJsonBody,
  requestId,
  routeCoordinate,
  sendEmpty,
  sendJson,
} from '../src/serverHttp.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

function fakeReq(headers: http.IncomingMessage['headers'] = {}, socket: { remoteAddress?: string } = {}): http.IncomingMessage {
  return { headers, socket } as unknown as http.IncomingMessage;
}

function fakeRes() {
  const headers: Record<string, string> = {};
  let statusCode: number | undefined;
  let body: string | undefined;
  let ended = false;
  const res = {
    setHeader(name: string, value: string) { headers[name] = value; },
    writeHead(status: number) { statusCode = status; },
    end(chunk?: string) { ended = true; if (chunk !== undefined) body = chunk; },
  } as unknown as http.ServerResponse;
  return { res, headers, status: () => statusCode, isEnded: () => ended, body: () => body };
}

function fakeBodyReq(chunks: string[], emitError?: Error): http.IncomingMessage {
  const emitter = new EventEmitter();
  queueMicrotask(() => {
    if (emitError) { emitter.emit('error', emitError); return; }
    for (const chunk of chunks) emitter.emit('data', Buffer.from(chunk, 'utf8'));
    emitter.emit('end');
  });
  return emitter as unknown as http.IncomingMessage;
}

describe('requestId', () => {
  it('reuses a caller-supplied id that matches the pattern', () => {
    assert.equal(requestId(fakeReq({ 'x-request-id': 'abc12345' }), REQUEST_ID_PATTERN), 'abc12345');
  });

  it('generates a fresh id when none is supplied or it fails the pattern', () => {
    assert.notEqual(requestId(fakeReq(), REQUEST_ID_PATTERN), '');
    assert.notEqual(requestId(fakeReq({ 'x-request-id': 'short' }), REQUEST_ID_PATTERN), 'short');
    assert.notEqual(requestId(fakeReq({ 'x-request-id': ['a', 'b'] }), REQUEST_ID_PATTERN), 'a');
  });
});

describe('clientAddress', () => {
  it('uses the socket address when trustProxy is false, even with a forwarded header', () => {
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.5' }, { remoteAddress: '10.0.0.1' });
    assert.equal(clientAddress(req, false), '10.0.0.1');
  });

  it('trusts the first forwarded IP when trustProxy is true', () => {
    const req = fakeReq({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, { remoteAddress: '10.0.0.1' });
    assert.equal(clientAddress(req, true), '203.0.113.5');
  });

  it('falls back to the socket address when the forwarded header is not a valid IP', () => {
    const req = fakeReq({ 'x-forwarded-for': 'not-an-ip' }, { remoteAddress: '10.0.0.1' });
    assert.equal(clientAddress(req, true), '10.0.0.1');
  });

  it('falls back to "unknown" when neither is available', () => {
    assert.equal(clientAddress(fakeReq(), false), 'unknown');
  });
});

describe('applyCors', () => {
  it('allows a request with no Origin header without setting CORS headers', () => {
    const { res, headers } = fakeRes();
    assert.equal(applyCors(fakeReq({}), res, new Set(['https://app.example.com'])), true);
    assert.equal(headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(headers.Vary, 'Origin');
  });

  it('rejects an origin not in the allow-list', () => {
    const { res, headers } = fakeRes();
    assert.equal(applyCors(fakeReq({ origin: 'https://evil.example.com' }), res, new Set(['https://app.example.com'])), false);
    assert.equal(headers['Access-Control-Allow-Origin'], undefined);
  });

  it('allows and echoes back an origin in the allow-list', () => {
    const { res, headers } = fakeRes();
    assert.equal(applyCors(fakeReq({ origin: 'https://app.example.com' }), res, new Set(['https://app.example.com'])), true);
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://app.example.com');
    assert.equal(headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, DELETE, OPTIONS');
  });
});

describe('sendJson / sendEmpty', () => {
  it('writes a JSON body with the given status', () => {
    const { res, status, body } = fakeRes();
    sendJson(res, 201, { ok: true });
    assert.equal(status(), 201);
    assert.equal(body(), JSON.stringify({ ok: true }));
  });

  it('sendEmpty ends the response with no body', () => {
    const { res, status, isEnded, body } = fakeRes();
    sendEmpty(res, 204);
    assert.equal(status(), 204);
    assert.equal(isEnded(), true);
    assert.equal(body(), undefined);
  });
});

describe('readJsonBody', () => {
  it('resolves an empty object for an empty body', async () => {
    assert.deepEqual(await readJsonBody(fakeBodyReq([])), {});
  });

  it('resolves the parsed object for a valid JSON body split across chunks', async () => {
    assert.deepEqual(await readJsonBody(fakeBodyReq(['{"a":1,', '"b":2}'])), { a: 1, b: 2 });
  });

  it('rejects with a 400 RequestError for invalid JSON', async () => {
    await assert.rejects(readJsonBody(fakeBodyReq(['not json'])), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { status?: number }).status, 400);
      return true;
    });
  });

  it('rejects with a 400 RequestError when the body is a JSON array, not an object', async () => {
    await assert.rejects(readJsonBody(fakeBodyReq(['[1,2,3]'])), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      return true;
    });
  });

  it('rejects with a 413 RequestError once the body exceeds the size limit', async () => {
    const oversized = 'a'.repeat(33 * 1024);
    await assert.rejects(readJsonBody(fakeBodyReq([oversized])), (error: unknown) => {
      assert.equal((error as { status?: number }).status, 413);
      return true;
    });
  });

  it('propagates a stream error', async () => {
    await assert.rejects(readJsonBody(fakeBodyReq([], new Error('socket blew up'))), /socket blew up/);
  });
});

describe('bearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    assert.equal(bearerToken(fakeReq({ authorization: 'Bearer abc123' })), 'abc123');
  });

  it('returns an empty string when the header is missing or malformed', () => {
    assert.equal(bearerToken(fakeReq()), '');
    assert.equal(bearerToken(fakeReq({ authorization: 'Basic abc123' })), '');
  });
});

describe('isCoordinate', () => {
  it('accepts in-range finite numbers', () => {
    assert.equal(isCoordinate(51.5, -0.1), true);
    assert.equal(isCoordinate(-90, -180), true);
    assert.equal(isCoordinate(90, 180), true);
  });

  it('rejects out-of-range, non-finite, or non-number values', () => {
    assert.equal(isCoordinate(91, 0), false);
    assert.equal(isCoordinate(0, 181), false);
    assert.equal(isCoordinate(Number.NaN, 0), false);
    assert.equal(isCoordinate('51.5', -0.1), false);
  });
});

describe('routeCoordinate', () => {
  it('parses a valid coordinate object', () => {
    assert.deepEqual(routeCoordinate({ lat: 51.5, lon: -0.1 }), { lat: 51.5, lon: -0.1 });
  });

  it('returns null for a non-object, array, or invalid coordinate', () => {
    assert.equal(routeCoordinate(null), null);
    assert.equal(routeCoordinate([51.5, -0.1]), null);
    assert.equal(routeCoordinate({ lat: 91, lon: -0.1 }), null);
    assert.equal(routeCoordinate({ lat: 51.5 }), null);
  });
});

describe('rateLimitSubject', () => {
  it('produces a stable, scope-distinguishing hash', () => {
    const first = rateLimitSubject('ip', '1.2.3.4');
    assert.equal(first, rateLimitSubject('ip', '1.2.3.4'));
    assert.notEqual(first, rateLimitSubject('rider', '1.2.3.4'));
    assert.match(first, /^[a-f0-9]{64}$/);
  });
});
