import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SiteMonitor } from '../src/siteMonitor.ts';

function fetchReturning(statuses: Record<string, number[]>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const queue = statuses[String(input)]!;
    const status = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (status === 0) throw new Error('network down');
    return new Response(null, { status });
  }) as typeof fetch;
}

describe('SiteMonitor', () => {
  it('alerts once after two failed checks in a row, then logs the recovery', async () => {
    const reports: string[] = [];
    const logs: Array<Record<string, unknown>> = [];
    const url = 'https://example.test/app/';
    const monitor = new SiteMonitor({
      urls: [url],
      report: (summary) => reports.push(summary),
      log: (entry) => logs.push(entry),
      fetchImpl: fetchReturning({ [url]: [404, 404, 404, 200] }),
    });

    await monitor.check();
    assert.deepEqual(reports, []);
    await monitor.check();
    assert.deepEqual(reports, [`${url} returned HTTP 404 on 2 checks in a row`]);
    await monitor.check();
    assert.equal(reports.length, 1, 'one alert per outage');
    await monitor.check();
    assert.ok(logs.some((entry) => entry.event === 'site_recovered' && entry.url === url));
  });

  it('ignores a single failure between successes', async () => {
    const reports: string[] = [];
    const url = 'https://example.test/privacy.html';
    const monitor = new SiteMonitor({
      urls: [url],
      report: (summary) => reports.push(summary),
      fetchImpl: fetchReturning({ [url]: [200, 0, 200, 0, 200] }),
    });
    for (let i = 0; i < 5; i += 1) await monitor.check();
    assert.deepEqual(reports, []);
  });

  it('reports a network failure as no response', async () => {
    const reports: string[] = [];
    const url = 'https://example.test/';
    const monitor = new SiteMonitor({ urls: [url], report: (summary) => reports.push(summary), fetchImpl: fetchReturning({ [url]: [0] }) });
    await monitor.check();
    await monitor.check();
    assert.deepEqual(reports, [`${url} returned no response on 2 checks in a row`]);
  });
});
