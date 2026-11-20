/**
 * The last time each outside service answered, and the last time it refused
 * and why, for the staff System page. Kept in memory on each replica: it
 * shows what this server has seen since it started, never keys or riders.
 */
export type ProviderName = 'google_places' | 'google_routes' | 'google_vision' | 'media_storage';

export interface ProviderStatus {
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
}

export interface ContentCheckCounts {
  allowed: number;
  rejected: number;
  unavailable: number;
}

const PROVIDERS: readonly ProviderName[] = ['google_places', 'google_routes', 'google_vision', 'media_storage'];
const statuses = new Map<ProviderName, ProviderStatus>();
const contentCheck: ContentCheckCounts = { allowed: 0, rejected: 0, unavailable: 0 };

function status(name: ProviderName): ProviderStatus {
  let entry = statuses.get(name);
  if (!entry) {
    entry = { lastOkAt: null, lastErrorAt: null, lastError: null };
    statuses.set(name, entry);
  }
  return entry;
}

export function noteProviderOk(name: ProviderName, now = Date.now()): void {
  status(name).lastOkAt = now;
}

export function noteProviderError(name: ProviderName, reason: string, now = Date.now()): void {
  const entry = status(name);
  entry.lastErrorAt = now;
  entry.lastError = reason.slice(0, 300);
}

export function noteContentCheck(outcome: keyof ContentCheckCounts): void {
  contentCheck[outcome] += 1;
}

export function providerHealthSnapshot(): { providers: Record<ProviderName, ProviderStatus>; contentCheck: ContentCheckCounts } {
  return {
    providers: Object.fromEntries(PROVIDERS.map((name) => [name, { ...status(name) }])) as Record<ProviderName, ProviderStatus>,
    contentCheck: { ...contentCheck },
  };
}

/** Tests only. */
export function resetProviderHealth(): void {
  statuses.clear();
  contentCheck.allowed = 0;
  contentCheck.rejected = 0;
  contentCheck.unavailable = 0;
}
