import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_RETENTION_MS,
  RetentionStore,
  RIDE_LOCATION_RETENTION_MS,
  RIDE_RETENTION_MS,
} from '../src/retentionStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const NOW = 5_000_000_000_000;

async function count(table: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]!.n);
}

async function ids(sql: string): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(sql);
  return rows.map((row) => row.id).sort();
}

async function insertPresence(riderId: string, updatedAt: number): Promise<void> {
  await getPool().query(
    `INSERT INTO rider_presence (rider_id, lat, lon, radius_miles, accuracy_meters, updated_at)
     VALUES ($1, 51.5, -0.1, 1, 5, $2)`,
    [riderId, updatedAt],
  );
}

async function insertRide(rideId: string, createdAt: number, members: string[]): Promise<void> {
  await getPool().query('INSERT INTO rides (id, created_by, created_at) VALUES ($1, $2, $3)', [rideId, members[0], createdAt]);
  for (const member of members) {
    await getPool().query(
      'INSERT INTO ride_members (ride_id, rider_id, location_sharing_enabled) VALUES ($1, $2, TRUE)',
      [rideId, member],
    );
  }
}

describe('RetentionStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed retention tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE rider_presence, presence_zone_pairs, ride_locations, ride_codes, ride_members, rides, hazard_reports, hazard_report_votes',
    );
  });

  after(async () => {
    await resetDbForTests();
  });

  it('removes stale presence and its zone pairs but keeps recent presence', async () => {
    await insertPresence('rider-a', NOW - PRESENCE_RETENTION_MS - 1);
    await insertPresence('rider-b', NOW - 1_000);
    await insertPresence('rider-c', NOW - 2_000);
    await getPool().query(
      `INSERT INTO presence_zone_pairs (rider_a, rider_b, created_at) VALUES ('rider-a', 'rider-b', 0), ('rider-b', 'rider-c', 0)`,
    );

    const counts = await new RetentionStore().sweep(NOW);

    assert.equal(counts.presence, 1);
    assert.deepEqual(await ids('SELECT rider_id AS id FROM rider_presence'), ['rider-b', 'rider-c']);
    assert.deepEqual(await ids(`SELECT rider_a || '-' || rider_b AS id FROM presence_zone_pairs`), ['rider-b-rider-c']);
  });

  it('removes old ride locations, expired ride codes and abandoned rides', async () => {
    await insertRide('ride-active', NOW - 60_000, ['host-1', 'guest-1']);
    await insertRide('ride-abandoned', NOW - RIDE_RETENTION_MS - 1, ['host-2']);
    await getPool().query(
      `INSERT INTO ride_locations (ride_id, rider_id, lat, lon, updated_at) VALUES
         ('ride-active', 'host-1', 51.5, -0.1, $1),
         ('ride-active', 'guest-1', 51.5, -0.1, $2),
         ('ride-abandoned', 'host-2', 51.5, -0.1, $2)`,
      [NOW - 5_000, NOW - RIDE_LOCATION_RETENTION_MS - 1],
    );
    await getPool().query(
      `INSERT INTO ride_codes (code, ride_id, created_at, expires_at) VALUES
         ('LIVE01', 'ride-active', $1, $2),
         ('OLD001', 'ride-active', $1, $3)`,
      [NOW - 60_000, NOW + 60_000, NOW - 1],
    );

    const counts = await new RetentionStore().sweep(NOW);

    assert.equal(counts.rideLocations, 2);
    assert.equal(counts.rideCodes, 1);
    assert.equal(counts.rides, 1);
    assert.deepEqual(await ids('SELECT id FROM rides'), ['ride-active']);
    assert.deepEqual(await ids('SELECT rider_id AS id FROM ride_members'), ['guest-1', 'host-1']);
    assert.deepEqual(await ids(`SELECT ride_id || ':' || rider_id AS id FROM ride_locations`), ['ride-active:host-1']);
    assert.deepEqual(await ids('SELECT code AS id FROM ride_codes'), ['LIVE01']);
  });

  it('removes expired hazard reports along with their votes', async () => {
    await getPool().query(
      `INSERT INTO hazard_reports (id, type, lat, lon, reported_by, created_at, expires_at) VALUES
         ('live', 'police', 51.5, -0.1, 'r1', $1, $2),
         ('expired', 'camera', 51.5, -0.1, 'r1', $1, $3)`,
      [NOW - 60_000, NOW + 60_000, NOW],
    );
    await getPool().query(
      `INSERT INTO hazard_report_votes (report_id, rider_id, vote) VALUES
         ('live', 'r2', 'confirm'), ('expired', 'r2', 'confirm'), ('expired', 'r3', 'deny')`,
    );

    const counts = await new RetentionStore().sweep(NOW);

    assert.equal(counts.hazardReports, 1);
    assert.deepEqual(await ids('SELECT id FROM hazard_reports'), ['live']);
    assert.deepEqual(await ids('SELECT report_id AS id FROM hazard_report_votes'), ['live']);
  });

  it('is a no-op on an already clean database', async () => {
    await insertPresence('rider-fresh', NOW);
    const counts = await new RetentionStore().sweep(NOW);
    assert.deepEqual(counts, { presence: 0, rideLocations: 0, rideCodes: 0, rides: 0, hazardReports: 0 });
    assert.equal(await count('rider_presence'), 1);
  });
});
