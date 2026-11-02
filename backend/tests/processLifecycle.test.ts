import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createShutdown, errorMessage, installCrashHandlers, runMaintenance, scheduleMaintenance } from '../src/processLifecycle.ts';

function captureConsole(t: { after: (fn: () => void) => void }) {
  const lines: string[] = [];
  const log = mock.method(console, 'log', (line: string) => { lines.push(line); });
  const error = mock.method(console, 'error', (line: string) => { lines.push(line); });
  t.after(() => { log.mock.restore(); error.mock.restore(); });
  return () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('errorMessage', () => {
  it('uses an Error message and stringifies anything else', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(errorMessage('plain'), 'plain');
  });
});

describe('maintenance jobs', () => {
  it('logs a failed pass instead of throwing', async (t) => {
    const logs = captureConsole(t);
    await runMaintenance('job_failed', async () => { throw new Error('db down'); });
    await runMaintenance('job_failed', async () => 'fine');
    assert.deepEqual(logs(), [{ level: 'error', event: 'job_failed', message: 'db down' }]);
  });

  it('repeats on its interval without holding the process open', async () => {
    let runs = 0;
    const timer = scheduleMaintenance(1, 'job_failed', async () => { runs += 1; });
    assert.equal(timer.hasRef(), false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    clearInterval(timer);
    assert.ok(runs >= 1);
  });
});

function fakeServer(closeError?: Error) {
  let closes = 0;
  return {
    server: { close: (callback: (error?: Error) => void) => { closes += 1; callback(closeError); } },
    closes: () => closes,
  };
}

describe('createShutdown', () => {
  it('stops timers, drains the server and closes resources once', async (t) => {
    const logs = captureConsole(t);
    const { server, closes } = fakeServer();
    const timer = setInterval(() => undefined, 60_000);
    const beforeClose = mock.fn();
    const closeResources = mock.fn(async () => undefined);
    const setExitCode = mock.fn();
    const shutdown = createShutdown({ server, timers: [timer], beforeClose, closeResources, exit: mock.fn(), setExitCode });

    shutdown('SIGTERM');
    shutdown('SIGINT');
    await tick();

    assert.equal(closes(), 1);
    assert.equal(beforeClose.mock.callCount(), 1);
    assert.equal(closeResources.mock.callCount(), 1);
    assert.equal(setExitCode.mock.callCount(), 0);
    assert.deepEqual(logs().map((entry) => entry.event), ['shutdown_started', 'shutdown_complete']);
  });

  it('sets a failing exit code when the server or resources fail to close', async (t) => {
    const logs = captureConsole(t);
    const { server } = fakeServer(new Error('not running'));
    const setExitCode = mock.fn();
    const shutdown = createShutdown({
      server,
      timers: [],
      beforeClose: () => undefined,
      closeResources: async () => { throw new Error('pool busy'); },
      exit: mock.fn(),
      setExitCode,
    });

    shutdown('SIGTERM');
    await tick();

    assert.deepEqual(setExitCode.mock.calls.map((call) => call.arguments[0]), [1, 1]);
    assert.deepEqual(logs().filter((entry) => entry.level === 'error'), [
      { level: 'error', event: 'shutdown_failed', message: 'not running' },
      { level: 'error', event: 'database_shutdown_failed', message: 'pool busy' },
    ]);
  });

  it('forces an exit when draining takes too long', async (t) => {
    const logs = captureConsole(t);
    const exit = mock.fn();
    const shutdown = createShutdown({
      server: { close: () => undefined },
      timers: [],
      beforeClose: () => undefined,
      closeResources: async () => undefined,
      exit,
      setExitCode: mock.fn(),
      forceExitAfterMs: 1,
    });

    shutdown('SIGINT');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(exit.mock.calls.map((call) => call.arguments[0]), [1]);
    assert.ok(logs().some((entry) => entry.event === 'shutdown_timeout' && entry.signal === 'SIGINT'));
  });
});

describe('installCrashHandlers', () => {
  it('reports an unhandled rejection and keeps running', (t) => {
    const logs = captureConsole(t);
    const target = new EventEmitter();
    const report = mock.fn();
    const exit = mock.fn();
    installCrashHandlers(target, { report, flush: async () => undefined, exit });

    target.emit('unhandledRejection', new Error('lost promise'));
    target.emit('unhandledRejection', 'bare reason');

    assert.deepEqual(report.mock.calls.map((call) => call.arguments), [
      ['unhandled_rejection', 'lost promise'],
      ['unhandled_rejection', 'bare reason'],
    ]);
    assert.equal(exit.mock.callCount(), 0);
    assert.equal(logs()[0].event, 'unhandled_rejection');
  });

  it('reports an uncaught exception, flushes alerts, then exits', async (t) => {
    const logs = captureConsole(t);
    const target = new EventEmitter();
    const report = mock.fn();
    const exit = mock.fn();
    installCrashHandlers(target, { report, flush: async () => undefined, exit });

    target.emit('uncaughtException', new Error('broken state'));
    await tick();

    assert.deepEqual(report.mock.calls[0].arguments, ['uncaught_exception', 'broken state']);
    assert.deepEqual(exit.mock.calls.map((call) => call.arguments[0]), [1]);
    assert.equal(logs()[0].level, 'fatal');
  });
});
