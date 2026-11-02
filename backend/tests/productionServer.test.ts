import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

// Boots the real production entry point (src/server.ts run as a script) and
// drives it through startup, a request and graceful shutdown.

const SERVER = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface Run { logs: Array<Record<string, unknown>>; code: Promise<number | null>; kill: (signal: NodeJS.Signals) => void; waitFor: (event: string) => Promise<Record<string, unknown>> }

function startServer(env: Record<string, string | undefined>): Run {
  const child = spawn(process.execPath, ['--experimental-strip-types', SERVER], {
    env: { ...process.env, PUBLIC_APP_URL: 'http://127.0.0.1:9/', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: Array<Record<string, unknown>> = [];
  const listeners: Array<() => void> = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try { logs.push(JSON.parse(line) as Record<string, unknown>); } catch { continue; }
      for (const listener of listeners) listener();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const code = new Promise<number | null>((resolve) => child.once('exit', (exitCode) => resolve(exitCode)));
  const waitFor = (event: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const check = () => {
      const found = logs.find((entry) => entry.event === event);
      if (found) resolve(found);
    };
    listeners.push(check);
    check();
    void code.then(() => { check(); reject(new Error(`exited before ${event}: ${JSON.stringify(logs)}`)); });
  });
  return { logs, code, kill: (signal) => child.kill(signal), waitFor };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

describe('production entry point', () => {
  it('logs a startup failure and exits non-zero for an invalid PORT', async () => {
    const run = startServer({ PORT: 'not-a-port' });
    assert.equal(await run.code, 1);
    assert.equal((await run.waitFor('startup_failed')).message, 'PORT must be an integer from 1 to 65535');
  });

  it('refuses to start without a database', async () => {
    const run = startServer({ PORT: String(await freePort()), DATABASE_URL: '' });
    assert.equal(await run.code, 1);
    assert.match(String((await run.waitFor('startup_failed')).message), /DATABASE_URL is not set/);
  });

  it('cleans up, serves requests and shuts down gracefully on SIGTERM', { skip: !hasDatabase && 'DATABASE_URL not set' }, async () => {
    const port = await freePort();
    const run = startServer({ PORT: String(port), HOST: '127.0.0.1', ADMIN_RIDER_IDS: 'prod-boot-admin' });
    const started = await run.waitFor('server_started');
    assert.equal(started.port, port);
    for (const event of ['auth_records_cleaned', 'rate_limit_events_cleaned', 'social_rate_events_cleaned', 'social_state_cleaned', 'retention_sweep_completed', 'billing_configured']) {
      assert.ok(run.logs.some((entry) => entry.event === event), `missing ${event}`);
    }

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    await run.waitFor('http_request');

    run.kill('SIGTERM');
    await run.waitFor('shutdown_complete');
    assert.equal(await run.code, 0);
  });
});
