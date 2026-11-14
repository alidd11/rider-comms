/**
 * Rider Social is a separate preview product. Shared Rider Comms routes such
 * as /social/events remain available to ordinary riders; new Social product
 * endpoints use this reserved path boundary and require a server entitlement.
 *
 * A missing, malformed, or partially invalid configuration DENIES everyone.
 * Never put the invited rider IDs in a web/native bundle or response body.
 */
const RIDER_ID = /^rider_[A-Za-z0-9_-]{4,100}$/;

/** Explicit opt-in for an authenticated, open testing beta. Never inferred from a missing allowlist. */
export function isSocialOpenBetaEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function parseSocialPilotRiderIds(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) return new Set();
  const ids = value.split(',').map(id => id.trim());
  if (ids.some(id => !RIDER_ID.test(id))) return new Set();
  return new Set(ids);
}

export function isReservedSocialAppPath(pathname: string): boolean {
  // Legacy Rider Comms social event polling is NOT a Rider Social product API.
  // Other /social paths are reserved fail-closed until explicitly implemented.
  return pathname === '/social' ||
    (pathname.startsWith('/social/') && pathname !== '/social/events');
}

export const SOCIAL_PILOT_CAPABILITIES = Object.freeze({
  mediaUpload: false,
  privatePosting: false,
  publicPosting: false,
  liveStreaming: false,
  marketplaceCheckout: false,
  creatorPayouts: false,
});
