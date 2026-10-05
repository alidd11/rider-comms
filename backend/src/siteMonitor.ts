// Watches the public web app (GitHub Pages) from the backend, which runs
// around the clock. The GitHub uptime workflow is scheduled every 10 minutes,
// but GitHub delays scheduled runs by hours, so it slept through a 20-minute
// outage on 2026-10-05 when the repository was briefly made private.
//
// A page counts as down after `failuresBeforeAlert` failed checks in a row,
// so one dropped request doesn't page anyone. Each outage alerts once; the
// recovery is logged.

export const SITE_CHECK_INTERVAL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface SiteMonitorOptions {
  urls: string[];
  report: (summary: string) => void;
  fetchImpl?: typeof fetch;
  failuresBeforeAlert?: number;
  timeoutMs?: number;
  log?: (entry: Record<string, unknown>) => void;
}

export class SiteMonitor {
  private readonly options: SiteMonitorOptions;
  private readonly failures = new Map<string, number>();
  private readonly down = new Set<string>();

  constructor(options: SiteMonitorOptions) {
    this.options = options;
  }

  async check(): Promise<void> {
    await Promise.all(this.options.urls.map((url) => this.checkOne(url)));
  }

  private async checkOne(url: string): Promise<void> {
    const status = await this.probe(url);
    const log = this.options.log ?? (() => {});
    if (status === 200) {
      if (this.down.delete(url)) log({ level: 'info', event: 'site_recovered', url });
      this.failures.set(url, 0);
      return;
    }
    const failures = (this.failures.get(url) ?? 0) + 1;
    this.failures.set(url, failures);
    log({ level: 'warn', event: 'site_check_failed', url, status, failures });
    if (failures >= (this.options.failuresBeforeAlert ?? 2) && !this.down.has(url)) {
      this.down.add(url);
      this.options.report(`${url} returned ${status === 0 ? 'no response' : `HTTP ${status}`} on ${failures} checks in a row`);
    }
  }

  private async probe(url: string): Promise<number> {
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: { 'User-Agent': 'rider-comms-site-monitor' },
      });
      await response.body?.cancel().catch(() => {});
      return response.status;
    } catch {
      return 0;
    }
  }
}
