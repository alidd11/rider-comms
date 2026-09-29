import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureErrorAlerts,
  ErrorAlerter,
  flushErrorAlerts,
  formatAlert,
  MAX_ALERT_SAMPLES,
  reportOperationalError,
} from '../src/errorAlerts.ts';
import type { AlertKind } from '../src/errorAlerts.ts';
import { sendOperationalEmail } from '../src/email.ts';

interface Sent { to: string; subject: string; text: string }

function harness(recipients: string[] = ['ops@example.com']) {
  const sent: Sent[] = [];
  let clock = 1_000_000;
  const alerter = new ErrorAlerter({
    recipients: async () => recipients,
    send: async (to, subject, text) => { sent.push({ to, subject, text }); return true; },
    intervalMs: 60_000,
    now: () => clock,
    environment: 'test',
  });
  return { alerter, sent, advance: (ms: number) => { clock += ms; } };
}

describe('ErrorAlerter', () => {
  it('emails the first error of a quiet period straight away', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { alerter, sent } = harness();
      alerter.record('request_failed', 'GET /rides/current (request abc): database unavailable');
      mock.timers.tick(0);
      await alerter.flush();
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, 'ops@example.com');
      assert.equal(sent[0].subject, '[Rider Comms test] 1 error reported');
      assert.match(sent[0].text, /Backend request failure \(HTTP 500\): 1/);
      assert.match(sent[0].text, /database unavailable/);
    } finally {
      mock.timers.reset();
    }
  });

  it('batches errors inside the interval into one follow-up email', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { alerter, sent, advance } = harness();
      alerter.record('client_error', 'ios: first');
      mock.timers.tick(0);
      await alerter.flush();
      assert.equal(sent.length, 1);

      advance(1_000);
      alerter.record('client_error', 'ios: second');
      alerter.record('request_failed', 'POST /presence: boom');
      mock.timers.tick(58_000);
      assert.equal(sent.length, 1, 'nothing more is sent before the interval ends');

      advance(59_000);
      mock.timers.tick(1_000);
      await alerter.flush();
      assert.equal(sent.length, 2);
      assert.equal(sent[1].subject, '[Rider Comms test] 2 errors reported');
      assert.match(sent[1].text, /ios: second/);
      assert.match(sent[1].text, /POST \/presence: boom/);
    } finally {
      mock.timers.reset();
    }
  });

  it('caps samples, counts the rest and collapses whitespace', () => {
    const counts = new Map<AlertKind, number>([['client_error', MAX_ALERT_SAMPLES + 5]]);
    const samples = Array.from({ length: MAX_ALERT_SAMPLES }, (_, i) => ({ kind: 'client_error' as const, summary: `e${i}`, at: 0 }));
    const { text } = formatAlert(samples, counts, 'test');
    assert.match(text, /\.\.\.and 5 more/);

    const captured: string[] = [];
    const capturing = new ErrorAlerter({ recipients: async () => ['a@example.com'], send: async (_to, _s, t) => { captured.push(t); return true; } });
    capturing.record('client_error', 'line one\n   line two');
    return capturing.flush().then(() => assert.match(captured[0], /line one line two/));
  });

  it('labels a backend crash in the subject', () => {
    const { subject } = formatAlert(
      [{ kind: 'uncaught_exception', summary: 'boom', at: 0 }],
      new Map([['uncaught_exception', 1]]),
      'production',
    );
    assert.equal(subject, '[Rider Comms production] Backend crashed');
  });

  it('skips sending without recipients and never throws when sending fails', async () => {
    const empty = harness([]);
    empty.alerter.record('client_error', 'x');
    await empty.alerter.flush();
    assert.equal(empty.sent.length, 0);

    const failing = new ErrorAlerter({ recipients: async () => { throw new Error('db down'); }, send: async () => true });
    failing.record('client_error', 'x');
    await failing.flush();
  });

  it('is a no-op until the production server configures it', async () => {
    configureErrorAlerts(undefined);
    reportOperationalError('client_error', 'ignored');
    await flushErrorAlerts();

    const sent: string[] = [];
    configureErrorAlerts(new ErrorAlerter({ recipients: async () => ['a@example.com'], send: async (_to, subject) => { sent.push(subject); return true; } }));
    try {
      reportOperationalError('uncaught_exception', 'boom');
      await flushErrorAlerts();
      assert.deepEqual(sent, ['[Rider Comms production] Backend crashed']);
    } finally {
      configureErrorAlerts(undefined);
    }
  });
});

describe('sendOperationalEmail', () => {
  it('sends plain text plus an escaped HTML copy through Resend', async () => {
    const previous = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'alerts@example.com';
    try {
      let body: Record<string, string> = {};
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      assert.equal(await sendOperationalEmail('ops@example.com', 'Subject', 'a <b> & c', fetchImpl), true);
      assert.equal(body.to, 'ops@example.com');
      assert.equal(body.text, 'a <b> & c');
      assert.match(body.html, /a &lt;b&gt; &amp; c/);
    } finally {
      if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
      if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = previous.from;
    }
  });
});
