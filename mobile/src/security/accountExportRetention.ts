/** Recognition is deliberately narrow: only files created by the private
 * account export flow are eligible for automatic cache eviction.
 * Keep the file available for external preview apps until the TTL passes. */
export const ACCOUNT_EXPORT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

const EXPORT_NAME = /^rider-comms-data-(\d{13})-([a-z0-9]{8})\.json$/;

export function isExpiredAccountExportFile(filename: string, nowMs: number): boolean {
  const match = EXPORT_NAME.exec(filename);
  if (!match || !Number.isFinite(nowMs)) return false;
  const createdAt = Number(match[1]);
  // Never delete unknown files or entries with malformed/future timestamps.
  return Number.isSafeInteger(createdAt) && createdAt > 0 &&
    createdAt <= nowMs && nowMs - createdAt >= ACCOUNT_EXPORT_MAX_CACHE_AGE_MS;
}
