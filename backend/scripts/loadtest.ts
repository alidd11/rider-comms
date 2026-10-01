// Load test: simulates a dense group-riding event against a running backend.
//
//   1. Start a backend against a disposable database, e.g.
//      DATABASE_URL=postgres://rc:rc@127.0.0.1:5432/rc PORT=4100 \
//        CORS_ALLOWED_ORIGINS=http://localhost node --experimental-strip-types backend/src/server.ts
//   2. In another process:
//      DATABASE_URL=... node --experimental-strip-types backend/scripts/loadtest.ts \
//        --base http://127.0.0.1:4100 --riders 300 --seconds 60
//
// It seeds verified test riders, sessions and private rides directly in the
// database (signing up through the API would hit the per-address signup
// limits), then runs each rider's real client cadence:
//   - ride members (groups of --group): POST ride location every 10 s,
//     GET /rides/current every 5 s
//   - Nearby riders (--nearby share): POST /presence every 8 s, clustered
//     within a mile of each other, moving at road speed
//   - everyone: friend activity every 30 s, hazards every 60 s and a
//     continuous /social/events long-poll
// and reports latency percentiles, errors and throughput per endpoint.
// Seeded rows all start with "lt_" and are removed at the end (--keep to
// skip). Never point it at production.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (key.startsWith('--')) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) { args.set(key.slice(2), next); i += 1; } else args.set(key.slice(2), 'true');
  }
}
const BASE = args.get('base') ?? 'http://127.0.0.1:4100';
const RIDERS = Number(args.get('riders') ?? 200);
const SECONDS = Number(args.get('seconds') ?? 60);
const GROUP = Number(args.get('group') ?? 10);
const NEARBY_SHARE = Number(args.get('nearby') ?? 0.5);
const KEEP = args.get('keep') === 'true';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (/railway|rlwy|amazonaws|supabase/i.test(process.env.DATABASE_URL) || /railway\.app/.test(BASE)) {
  throw new Error('Refusing to load-test what looks like a production database or API.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const RUN = randomBytes(3).toString('hex');

interface Rider { id: string; token: string; rideId?: string; nearby: boolean; lat: number; lon: number; heading: number }

async function seed(): Promise<Rider[]> {
  const riders: Rider[] = [];
  const nearbyCount = Math.round(RIDERS * NEARBY_SHARE);
  for (let i = 0; i < RIDERS; i += 1) {
    riders.push({
      id: `lt_${RUN}_${i}`,
      token: randomBytes(32).toString('base64url'),
      nearby: i < nearbyCount,
      // Everyone starts within ~1 mile of central London.
      lat: 51.5074 + (Math.random() - 0.5) * 0.02,
      lon: -0.1278 + (Math.random() - 0.5) * 0.03,
      heading: Math.random() * Math.PI * 2,
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of riders) {
      await client.query(
        `INSERT INTO users (id, username, email, password_hash, email_verified_at) VALUES ($1, $2, $3, 'load-test', now())`,
        [r.id, r.id, `${r.id}@loadtest.invalid`],
      );
      await client.query(
        `INSERT INTO account_sessions (id, token_hash, user_id, expires_at, device_name) VALUES ($1, $2, $3, now() + interval '1 day', 'load test')`,
        [randomUUID(), createHash('sha256').update(r.token).digest('hex'), r.id],
      );
      await client.query(
        `INSERT INTO rider_profiles (rider_id, display_name, handle, avatar_id, zone_tier, unit_system, notify_nearby, notify_invites, notify_chat, share_location, instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, updated_at)
         VALUES ($1, $2, $3, 'ridge', 'free', 'mi', false, false, false, true, '', 'friends', '', 'friends', 0)`,
        [r.id, `Load ${r.id}`, `@${r.id}`],
      );
    }
    // Ride members are the riders not on public Nearby, in groups.
    const members = riders.filter((r) => !r.nearby);
    for (let g = 0; g < members.length; g += GROUP) {
      const group = members.slice(g, g + GROUP);
      const rideId = `lt_${RUN}_ride_${g / GROUP}`;
      await client.query('INSERT INTO rides (id, created_by, created_at) VALUES ($1, $2, $3)', [rideId, group[0].id, Date.now()]);
      for (const r of group) {
        await client.query('INSERT INTO ride_members (ride_id, rider_id, location_sharing_enabled) VALUES ($1, $2, true)', [rideId, r.id]);
        r.rideId = rideId;
      }
    }
    // A few friendships so activity and social queries have real work.
    for (let i = 0; i + 1 < riders.length; i += 2) {
      await client.query('INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, 0), ($2, $1, 0)', [riders[i].id, riders[i + 1].id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return riders;
}

async function cleanup(): Promise<void> {
  const like = `lt_${RUN}_%`;
  for (const sql of [
    'DELETE FROM ride_members WHERE rider_id LIKE $1',
    'DELETE FROM ride_locations WHERE rider_id LIKE $1',
    'DELETE FROM rides WHERE id LIKE $1',
    'DELETE FROM friendships WHERE rider_id LIKE $1',
    'DELETE FROM rider_presence WHERE rider_id LIKE $1',
    'DELETE FROM presence_zone_pairs WHERE rider_a LIKE $1 OR rider_b LIKE $1',
    'DELETE FROM presence_movement_anchors WHERE rider_id LIKE $1',
    'DELETE FROM rider_activity WHERE rider_id LIKE $1',
    'DELETE FROM social_events WHERE rider_id LIKE $1',
    'DELETE FROM rate_limit_events WHERE subject_key LIKE $1',
    'DELETE FROM rider_profiles WHERE rider_id LIKE $1',
    'DELETE FROM account_sessions WHERE user_id LIKE $1',
    'DELETE FROM users WHERE id LIKE $1',
  ]) {
    const params = sql.includes('rate_limit_events') ? [`%${like}`] : [like];
    await pool.query(sql, params).catch((error: Error & { code?: string }) => {
      if (error.code === '40P01') throw error;
      console.error(`cleanup: ${error.message}`);
    });
  }
}

// ---------------------------------------------------------------- Metrics

interface Stat { latencies: number[]; errors: Map<string, number>; }
const stats = new Map<string, Stat>();
function record(name: string, ms: number, status: number | string): void {
  const stat = stats.get(name) ?? { latencies: [], errors: new Map() };
  stats.set(name, stat);
  if (typeof status === 'number' && status >= 200 && status < 300) stat.latencies.push(ms);
  else stat.errors.set(String(status), (stat.errors.get(String(status)) ?? 0) + 1);
}
function pct(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

let stopping = false;
async function call(name: string, rider: Rider, method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<unknown> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${rider.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    record(name, performance.now() - started, response.status);
    return json;
  } catch (error) {
    if (!stopping) record(name, performance.now() - started, (error as Error).name === 'AbortError' ? 'timeout' : 'network');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function every(ms: number, fn: () => Promise<unknown>): void {
  // Random phase so riders don't all fire in lockstep.
  const start = Math.random() * ms;
  const tick = async () => {
    if (stopping) return;
    await fn();
    if (!stopping) setTimeout(tick, ms);
  };
  setTimeout(tick, start);
}

function move(r: Rider, seconds: number, metresPerSecond: number): void {
  r.heading += (Math.random() - 0.5) * 0.4;
  const metres = metresPerSecond * seconds;
  r.lat += (metres * Math.cos(r.heading)) / 111_320;
  r.lon += (metres * Math.sin(r.heading)) / (111_320 * Math.cos((r.lat * Math.PI) / 180));
}

function simulate(r: Rider): void {
  if (r.rideId) {
    every(10_000, () => { move(r, 10, 25); return call('POST /rides/:id/location', r, 'POST', `/rides/${r.rideId}/location`, { lat: r.lat, lon: r.lon }); });
    every(5_000, () => call('GET /rides/current', r, 'GET', '/rides/current'));
  }
  if (r.nearby) {
    every(8_000, () => {
      move(r, 8, 15);
      return call('POST /presence', r, 'POST', '/presence', { lat: r.lat, lon: r.lon, accuracyMeters: 8, recordedAt: Date.now() });
    });
  }
  every(30_000, () => call('GET /friends/activity', r, 'GET', '/friends/activity'));
  every(60_000, () => call('GET /hazards/nearby', r, 'GET', `/hazards/nearby?lat=${r.lat}&lon=${r.lon}`));
  // Social events: establish a cursor, then long-poll continuously.
  void (async () => {
    let cursor: string | undefined;
    while (!stopping) {
      const query = cursor ? `?after=${encodeURIComponent(cursor)}&waitMs=25000` : '';
      const page = await call(cursor ? 'GET /social/events (long-poll)' : 'GET /social/events (cursor)', r, 'GET', `/social/events${query}`, undefined, 35_000) as { cursor?: string } | null;
      if (page?.cursor) cursor = page.cursor;
      else await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  })();
}

async function sampleServer(): Promise<{ rssMb: number } | null> {
  const pid = args.get('pid');
  if (!pid) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    return { rssMb: Math.round(rss / 1024) };
  } catch { return null; }
}

async function main(): Promise<void> {
  console.log(`Seeding ${RIDERS} riders (${Math.round(RIDERS * NEARBY_SHARE)} on Nearby, the rest in rides of ${GROUP})…`);
  const riders = await seed();
  console.log(`Running for ${SECONDS}s against ${BASE}…`);
  const started = Date.now();
  for (const r of riders) simulate(r);
  let peakRss = 0;
  const sampler = setInterval(async () => {
    const sample = await sampleServer();
    if (sample) peakRss = Math.max(peakRss, sample.rssMb);
  }, 2_000);
  await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
  stopping = true;
  clearInterval(sampler);
  const elapsed = (Date.now() - started) / 1000;

  const rows = [...stats.entries()].sort();
  let totalOk = 0;
  let totalErr = 0;
  console.log('\n| Endpoint | Requests/s | p50 ms | p95 ms | p99 ms | Errors |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [name, stat] of rows) {
    const errors = [...stat.errors.entries()].map(([code, n]) => `${code}×${n}`).join(' ') || '0';
    const errCount = [...stat.errors.values()].reduce((a, b) => a + b, 0);
    totalOk += stat.latencies.length;
    totalErr += errCount;
    const longPoll = name.includes('long-poll');
    console.log(`| ${name} | ${((stat.latencies.length + errCount) / elapsed).toFixed(1)} | ${longPoll ? '(held)' : pct(stat.latencies, 50).toFixed(0)} | ${longPoll ? '' : pct(stat.latencies, 95).toFixed(0)} | ${longPoll ? '' : pct(stat.latencies, 99).toFixed(0)} | ${errors} |`);
  }
  console.log(`\nTotal: ${totalOk} ok, ${totalErr} errors, ${((totalOk + totalErr) / elapsed).toFixed(0)} requests/s over ${elapsed.toFixed(0)}s${peakRss ? `, server peak RSS ${peakRss} MB` : ''}.`);
  if (!KEEP) {
    // Let in-flight long-polls finish before deleting their riders.
    // An overloaded server can still be finishing queued requests, which
    // may deadlock with the bulk delete; wait and retry.
    for (let attempt = 1; ; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
      try {
        await cleanup();
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== '40P01' || attempt === 5) throw error;
      }
    }
  }
  await pool.end();
  process.exit(0);
}

void main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  process.exit(1);
});
