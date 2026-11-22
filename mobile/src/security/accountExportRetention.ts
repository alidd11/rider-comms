/** Recognition is deliberately narrow: only files created by the private
 * account export flow are eligible for automatic cache eviction.
 * Keep the file available for external preview apps until the TTL passes. */
export const ACCOUNT_EXPORT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

const EXPORT_NAME = /^rider-comms-data-(\d{13})-([a-z0-9]{8})\.json$/;

function managedExportTimestamp(filename: string): number | null {
  const match = EXPORT_NAME.exec(filename);
  if (!match) return null;
  const createdAt = Number(match[1]);
  return Number.isSafeInteger(createdAt) && createdAt > 0 ? createdAt : null;
}

/** Only files created by this feature can be removed at account boundaries. */
export function isManagedAccountExportFile(filename: string): boolean {
  return managedExportTimestamp(filename) !== null;
}

export function isExpiredAccountExportFile(filename: string, nowMs: number): boolean {
  const createdAt = managedExportTimestamp(filename);
  // Ignore unrelated, malformed and future-dated files.
  return createdAt !== null && Number.isFinite(nowMs) &&
    createdAt <= nowMs && nowMs - createdAt >= ACCOUNT_EXPORT_MAX_CACHE_AGE_MS;
}
