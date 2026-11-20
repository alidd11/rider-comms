import { monitorEventLoopDelay } from 'node:perf_hooks';
type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

/**
 * In-process request metrics for the staff dashboard's System page: request
 * counts, error rates and response-time percentiles per route over the last
 * hour, plus process health. Each backend replica keeps its own figures; the
 * page says which replica answered. Nothing here identifies a rider.
 */

/** Upper bounds (ms) of the response-time buckets; the last bucket is open. */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const METRICS_WINDOW_MINUTES = 60;
/** Distinct routes tracked before the rest are counted as "other". */
export const MAX_TRACKED_ROUTES = 200;
const MINUTE_MS = 60_000;

/**
 * The route a path belongs to, with IDs replaced, so /riders/rider_ab12/profile
 * and /riders/rider_cd34/profile count together and no ID reaches the figures.
 */
export function routeKey(method: string, path: string): string {
  const parts = path.split('/').filter(Boolean).slice(0, 6).map((part) => {
    if (/^rider_[a-z0-9]+$/i.test(part)) return ':rider';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) return ':id';
    if (/^\d+$/.test(part)) return ':n';
    if (/^[A-Za-z0-9_-]{16,}$/.test(part) || /\d/.test(part) || part.includes('%') || part.startsWith('@')) return ':id';
    return part.length > 40 ? ':id' : part;
  });
  return `${method.toUpperCase()} /${parts.join('/')}`;
}

interface RouteBucket {
  count: number;
  clientErrors: number;
  serverErrors: number;
  /** 502/503: a provider refused (Google, storage) or a feature is off. */
  unavailable: number;
  totalMs: number;
  histogram: number[];
}

interface Minute {
  minute: number;
  routes: Map<string, RouteBucket>;
}

export interface RouteSummary {
  route: string;
  count: number;
  /** Share of requests our own code failed (500, 504 and up). */
  errorRate: number;
  /** Share answered 502/503: a provider refused, or a feature is switched off. */
  unavailableRate: number;
  clientErrorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface MetricsSnapshot {
  windowMinutes: number;
  replica: string;
  uptimeSeconds: number;
  totals: RouteSummary;
  /** Busiest routes first. */
  routes: RouteSummary[];
  /** Slowest routes (p95) with at least five requests. */
  slowest: RouteSummary[];
  /** Requests per minute, oldest first, for a sparkline. */
  perMinute: { minute: number; count: number; serverErrors: number }[];
  process: { rssMb: number; heapUsedMb: number; eventLoopDelayP99Ms: number | null };
  database: { total: number; idle: number; waiting: number; max: number } | null;
}

function emptyBucket(): RouteBucket {
  return { count: 0, clientErrors: 0, serverErrors: 0, unavailable: 0, totalMs: 0, histogram: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0) };
}

function merge(into: RouteBucket, from: RouteBucket): void {
  into.count += from.count;
  into.clientErrors += from.clientErrors;
  into.serverErrors += from.serverErrors;
  into.unavailable += from.unavailable;
  into.totalMs += from.totalMs;
  from.histogram.forEach((value, index) => { into.histogram[index]! += value; });
}

/** The bucket bound at or above the given share of requests (an upper estimate). */
export function percentile(histogram: readonly number[], share: number): number {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const target = Math.ceil(total * share);
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index]!;
    if (seen >= target) return LATENCY_BUCKETS_MS[index] ?? LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]! * 2;
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]! * 2;
}

function summarise(route: string, bucket: RouteBucket): RouteSummary {
  const rate = (part: number) => (bucket.count ? Math.round((part / bucket.count) * 10_000) / 10_000 : 0);
  return {
    route,
    count: bucket.count,
    errorRate: rate(bucket.serverErrors),
    unavailableRate: rate(bucket.unavailable),
    clientErrorRate: rate(bucket.clientErrors),
    avgMs: bucket.count ? Math.round(bucket.totalMs / bucket.count) : 0,
    p50Ms: percentile(bucket.histogram, 0.5),
    p95Ms: percentile(bucket.histogram, 0.95),
    p99Ms: percentile(bucket.histogram, 0.99),
  };
}

export interface PoolLike { totalCount: number; idleCount: number; waitingCount: number; options?: { max?: number } }

export class RequestMetrics {
  private readonly minutes: Minute[] = [];
  private readonly startedAt: number;
  private readonly loopDelay: IntervalHistogram | null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now, { watchEventLoop = true } = {}) {
    this.now = now;
    this.startedAt = now();
    this.loopDelay = watchEventLoop ? monitorEventLoopDelay({ resolution: 20 }) : null;
    this.loopDelay?.enable();
  }

  stop(): void {
    this.loopDelay?.disable();
  }

  record(method: string, path: string, status: number, durationMs: number): void {
    const minute = Math.floor(this.now() / MINUTE_MS);
    let current = this.minutes.at(-1);
    if (!current || current.minute !== minute) {
      current = { minute, routes: new Map() };
      this.minutes.push(current);
      while (this.minutes.length > 0 && this.minutes[0]!.minute <= minute - METRICS_WINDOW_MINUTES) this.minutes.shift();
    }
    let key = routeKey(method, path);
    if (!current.routes.has(key) && current.routes.size >= MAX_TRACKED_ROUTES) key = 'other';
    const bucket = current.routes.get(key) ?? emptyBucket();
    bucket.count += 1;
    // A provider refusing (Google, storage) or a feature switched off is not
    // our code failing; counted apart so real errors stand out.
    if (status === 502 || status === 503) bucket.unavailable += 1;
    else if (status >= 500) bucket.serverErrors += 1;
    else if (status >= 400) bucket.clientErrors += 1;
    const duration = Math.max(0, durationMs);
    bucket.totalMs += duration;
    const index = LATENCY_BUCKETS_MS.findIndex((bound) => duration <= bound);
    bucket.histogram[index === -1 ? LATENCY_BUCKETS_MS.length : index]! += 1;
    current.routes.set(key, bucket);
  }

  snapshot(pool?: PoolLike | null): MetricsSnapshot {
    const nowMinute = Math.floor(this.now() / MINUTE_MS);
    const recent = this.minutes.filter((entry) => entry.minute > nowMinute - METRICS_WINDOW_MINUTES);
    const byRoute = new Map<string, RouteBucket>();
    const totals = emptyBucket();
    for (const entry of recent) {
      for (const [route, bucket] of entry.routes) {
        const into = byRoute.get(route) ?? emptyBucket();
        merge(into, bucket);
        byRoute.set(route, into);
        merge(totals, bucket);
      }
    }
    const routes = [...byRoute].map(([route, bucket]) => summarise(route, bucket));
    const perMinute = recent.map((entry) => {
      let count = 0;
      let serverErrors = 0;
      for (const bucket of entry.routes.values()) { count += bucket.count; serverErrors += bucket.serverErrors; }
      return { minute: entry.minute * MINUTE_MS, count, serverErrors };
    });
    const memory = process.memoryUsage();
    const loopP99 = this.loopDelay && this.loopDelay.count > 0 ? Math.round(this.loopDelay.percentile(99) / 1e6) : null;
    return {
      windowMinutes: METRICS_WINDOW_MINUTES,
      replica: process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local',
      uptimeSeconds: Math.round((this.now() - this.startedAt) / 1000),
      totals: summarise('all', totals),
      routes: [...routes].sort((a, b) => b.count - a.count || a.route.localeCompare(b.route)).slice(0, 15),
      slowest: routes.filter((route) => route.count >= 5).sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count).slice(0, 5),
      perMinute,
      process: { rssMb: Math.round(memory.rss / 1_048_576), heapUsedMb: Math.round(memory.heapUsed / 1_048_576), eventLoopDelayP99Ms: loopP99 },
      database: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max ?? 0 } : null,
    };
  }
}
