import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientErrorReport } from '../src/clientErrors.ts';
import { startTestServer } from './httpTestUtils.ts';

describe('parseClientErrorReport', () => {
  it('accepts a minimal report and fills bounded defaults', () => {
    assert.deepEqual(parseClientErrorReport({ platform: 'ios', message: '  TypeError: x is undefined  ' }), {
      platform: 'ios',
      message: 'TypeError: x is undefined',
      stack: '',
      fatal: false,
      appVersion: '',
      context: '',
    });
  });

  it('rejects unknown platforms and empty messages', () => {
    assert.equal(parseClientErrorReport({ platform: 'desktop', message: 'boom' }), null);
    assert.equal(parseClientErrorReport({ platform: 'web', message: '   ' }), null);
    assert.equal(parseClientErrorReport({ platform: 'web' }), null);
  });

  it('truncates long fields and strips control characters that could forge log lines', () => {
    const report = parseClientErrorReport({
      platform: 'android',
      message: `boom\n{"level":"info","event":"fake"}${'x'.repeat(600)}`,
      stack: 'at a\nat b' + 'y'.repeat(5000),
      fatal: true,
      appVersion: '1.2.3\r\n',
      context: 'MapScreen',
    });
    assert.ok(report);
    assert.equal(report.message.length, 500);
    assert.equal(report.message.includes('\n'), false);
    assert.equal(report.stack.length, 4000);
    // Newlines in a stack are kept: they are escaped by JSON.stringify when logged.
    assert.equal(report.stack.startsWith('at a\nat b'), true);
    assert.equal(report.appVersion, '1.2.3');
    assert.equal(report.fatal, true);
  });
});

describe('POST /client-errors', () => {
  async function post(ctx: ReturnType<typeof startTestServer>, body: unknown) {
    return fetch(`${ctx.baseUrl()}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('logs a valid report without authentication and rejects invalid ones', async () => {
    const ctx = startTestServer();
    await ctx.ready;
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (line: unknown) => { logged.push(String(line)); };
    try {
      const ok = await post(ctx, { platform: 'web', message: 'ReferenceError: foo', fatal: true, context: 'boot' });
      assert.equal(ok.status, 202);
      assert.deepEqual(await ok.json(), { received: true });
      const bad = await post(ctx, { platform: 'web' });
      assert.equal(bad.status, 400);
    } finally {
      console.error = originalError;
      await ctx.close();
    }
    const entry = JSON.parse(logged.find((line) => line.includes('client_error'))!);
    assert.equal(entry.event, 'client_error');
    assert.equal(entry.level, 'fatal');
    assert.equal(entry.platform, 'web');
    assert.equal(entry.message, 'ReferenceError: foo');
    assert.equal(entry.context, 'boot');
  });

  it('logs an opaque cross-origin "Script error." as a warning, not a fatal error', async () => {
    const ctx = startTestServer();
    await ctx.ready;
    const errors: string[] = [];
    const warnings: string[] = [];
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (line: unknown) => { errors.push(String(line)); };
    console.warn = (line: unknown) => { warnings.push(String(line)); };
    try {
      const res = await post(ctx, { platform: 'web', message: 'Script error.', fatal: true, context: 'window.error' });
      assert.equal(res.status, 202);
    } finally {
      console.error = originalError;
      console.warn = originalWarn;
      await ctx.close();
    }
    assert.equal(errors.some((line) => line.includes('client_error')), false);
    const entry = JSON.parse(warnings.find((line) => line.includes('client_error'))!);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.fatal, false);
  });

  it('is rate-limited per client address', async () => {
    const actions: string[] = [];
    const ctx = startTestServer({
      rateLimitStore: {
        consume: async (_subject, action) => {
          actions.push(action);
          return action === 'client_error' ? { allowed: false, retryAfterSeconds: 30 } : { allowed: true, retryAfterSeconds: 0 };
        },
      },
    });
    await ctx.ready;
    try {
      const res = await post(ctx, { platform: 'ios', message: 'boom' });
      assert.equal(res.status, 429);
      assert.deepEqual(actions, ['client_error']);
    } finally {
      await ctx.close();
    }
  });
});
