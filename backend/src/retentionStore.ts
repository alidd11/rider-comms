import { ensureMigrated, getPool } from './db.ts';

// Scheduled retention sweep for data that request paths only prune lazily.
// Presence, ride locations and expired hazard reports are otherwise removed
// only when some rider happens to query nearby data, so without this sweep a
// quiet deployment would keep stale coordinates indefinitely. Every window
// here is deliberately far longer than the product's own freshness window
// (30s for presence/ride locations), so the sweep only removes rows the API
// can no longer serve. RETENTION.md documents the full schedule.

/** Public nearby-presence rows older than this are deleted (zone pairs
 * cascade). Presence is ignored by the API after 30 seconds. */
export const PRESENCE_RETENTION_MS = 60 * 60 * 1000;
/** Private-ride coordinates older than this are deleted. The API only serves
 * ride locations updated in the last 30 seconds. */
export const RIDE_LOCATION_RETENTION_MS = 60 * 60 * 1000;
/** Rides (with their members, codes and locations, via cascade) are deleted
 * this long after creation. Rides are short-lived group sessions; a ride
 * still open after this long has been abandoned. */
export const RIDE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface RetentionSweepCounts {
  presence: number;
  rideLocations: number;
  rideCodes: number;
  rides: number;
  hazardReports: number;
}

export class RetentionStore {
  async sweep(now = Date.now()): Promise<RetentionSweepCounts> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const presence = await client.query(
        'DELETE FROM rider_presence WHERE updated_at < $1',
        [now - PRESENCE_RETENTION_MS],
      );
      const rideLocations = await client.query(
        'DELETE FROM ride_locations WHERE updated_at < $1',
        [now - RIDE_LOCATION_RETENTION_MS],
      );
      const rideCodes = await client.query('DELETE FROM ride_codes WHERE expires_at <= $1', [now]);
      const rides = await client.query('DELETE FROM rides WHERE created_at < $1', [now - RIDE_RETENTION_MS]);
      // Votes cascade with their report (hazard_report_votes_report_fk).
      const hazardReports = await client.query('DELETE FROM hazard_reports WHERE expires_at <= $1', [now]);
      await client.query('COMMIT');
      return {
        presence: presence.rowCount ?? 0,
        rideLocations: rideLocations.rowCount ?? 0,
        rideCodes: rideCodes.rowCount ?? 0,
        rides: rides.rowCount ?? 0,
        hazardReports: hazardReports.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
