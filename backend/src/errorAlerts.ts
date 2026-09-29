// Emails staff when the backend or a client reports an error, so crashes are
// noticed without a paid monitoring vendor. Alerts are batched: the first
// error in a quiet period is emailed at once, and anything after it within
// ALERT_INTERVAL_MS is collected into the next email. Nothing is persisted:
// the buffer lives in memory and is flushed before a crash exit.

export type AlertKind = 'request_failed' | 'client_error' | 'unhandled_rejection' | 'uncaught_exception';

export interface AlertEntry {
  kind: AlertKind;
  summary: string;
  at: number;
}

export interface ErrorAlerterOptions {
  /** Resolves who receives alerts. An empty list skips sending. */
  recipients: () => Promise<string[]>;
  send: (to: string, subject: string, text: string) => Promise<boolean>;
  intervalMs?: number;
  now?: () => number;
  /** Label for the subject line, e.g. the Railway environment name. */
  environment?: string;
}

/** At most one alert email per this interval. */
export const ALERT_INTERVAL_MS = 15 * 60_000;
/** Individual entries kept per email; the rest are only counted. */
export const MAX_ALERT_SAMPLES = 20;
const MAX_SUMMARY_LENGTH = 300;

const KIND_LABELS: Record<AlertKind, string> = {
  uncaught_exception: 'Backend crash (process restarted)',
  unhandled_rejection: 'Backend unhandled rejection',
  request_failed: 'Backend request failure (HTTP 500)',
  client_error: 'App crash/error report',
};

export class ErrorAlerter {
  private readonly options: ErrorAlerterOptions;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private samples: AlertEntry[] = [];
  private counts = new Map<AlertKind, number>();
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private timer?: NodeJS.Timeout;
  private flushing?: Promise<void>;

  constructor(options: ErrorAlerterOptions) {
    this.options = options;
    this.intervalMs = options.intervalMs ?? ALERT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  record(kind: AlertKind, summary: string): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    if (this.samples.length < MAX_ALERT_SAMPLES) {
      this.samples.push({ kind, summary: summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_LENGTH), at: this.now() });
    }
    if (this.timer) return;
    const delay = Math.max(0, this.lastSentAt + this.intervalMs - this.now());
    this.timer = setTimeout(() => { void this.flush(); }, delay);
    this.timer.unref();
  }

  /** Sends whatever is buffered now. Never throws. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.counts.size === 0) return this.flushing ?? Promise.resolve();
    const samples = this.samples;
    const counts = this.counts;
    this.samples = [];
    this.counts = new Map();
    this.lastSentAt = this.now();
    const previous = this.flushing ?? Promise.resolve();
    this.flushing = previous.then(() => this.send(samples, counts)).finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async send(samples: AlertEntry[], counts: Map<AlertKind, number>): Promise<void> {
    try {
      const recipients = await this.options.recipients();
      if (recipients.length === 0) {
        console.warn(JSON.stringify({ level: 'warn', event: 'error_alert_skipped', reason: 'no_recipients' }));
        return;
      }
      const { subject, text } = formatAlert(samples, counts, this.options.environment);
      const results = await Promise.all(recipients.map((to) => this.options.send(to, subject, text)));
      console.log(JSON.stringify({ level: 'info', event: 'error_alert_sent', recipients: recipients.length, delivered: results.filter(Boolean).length }));
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'error_alert_failed', message: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export function formatAlert(samples: AlertEntry[], counts: Map<AlertKind, number>, environment = 'production'): { subject: string; text: string } {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const crashed = counts.has('uncaught_exception');
  const subject = `[Rider Comms ${environment}] ${crashed ? 'Backend crashed' : `${total} error${total === 1 ? '' : 's'} reported`}`;
  const lines = [`${total} error${total === 1 ? '' : 's'} since the last alert:`, ''];
  for (const kind of Object.keys(KIND_LABELS) as AlertKind[]) {
    const n = counts.get(kind);
    if (n) lines.push(`- ${KIND_LABELS[kind]}: ${n}`);
  }
  lines.push('', 'Examples (newest last):');
  for (const entry of samples) lines.push(`- ${new Date(entry.at).toISOString()} [${entry.kind}] ${entry.summary}`);
  if (total > samples.length) lines.push(`- ...and ${total - samples.length} more`);
  lines.push('', 'Full details, including stack traces, are in the Railway logs: search for the event names above.');
  return { subject, text: lines.join('\n') };
}

let activeAlerter: ErrorAlerter | undefined;

/** Called once by the production server. Tests and local runs never alert. */
export function configureErrorAlerts(alerter: ErrorAlerter | undefined): void {
  activeAlerter = alerter;
}

export function reportOperationalError(kind: AlertKind, summary: string): void {
  activeAlerter?.record(kind, summary);
}

/** Flushes pending alerts, giving up after timeoutMs (used before a crash exit). */
export async function flushErrorAlerts(timeoutMs = 3_000): Promise<void> {
  if (!activeAlerter) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    activeAlerter.flush(),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
}
