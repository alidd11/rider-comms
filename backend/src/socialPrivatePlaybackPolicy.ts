/**
 * Fail-closed, server-side authorization contract for future private Social
 * media playback. Pure policy only: callers must load fresh authoritative
 * database state inside their authenticated request, then re-check on every
 * playback/renewal request. No routes, signed URLs or storage reads here.
 */
export type SocialAudience = 'public' | 'followers' | 'private';
export type SocialMediaState = 'ready' | 'pending' | 'quarantined' | 'rejected' | 'deleted';
export type SocialAccountState = 'active' | 'suspended' | 'deleted';
export type SocialPlaybackContext = {
  viewerId: string | null;
  ownerId: string;
  mediaState: SocialMediaState;
  ownerState: SocialAccountState;
  viewerState: SocialAccountState;
  audience: SocialAudience;
  ownerAllowsViewer: boolean;
  viewerAllowsOwner: boolean;
  viewerFollowsOwner: boolean;
  viewerEmailVerified: boolean;
  viewerTermsCurrent: boolean;
  ownerAgeEligible: boolean;
  viewerAgeEligible: boolean;
  ownerModerationClear: boolean;
  mediaModerationClear: boolean;
  postDeleted: boolean;
  postExpired: boolean;
};
export type SocialPlaybackDecision =
  | { allowed: true }
  | { allowed: false; reason: 'unauthenticated' | 'forbidden' };

/**
 * Every field is mandatory; undefined, stale or incomplete DB projections
 * fail closed. An owner cannot bypass quarantine, expiry, account suspension,
 * moderation, or a block in either direction.
 *
 * IMPORTANT: This decision alone does not issue playback capability.
 * Future integration must enforce server-side durable rate limits, re-check
 * age/privacy and blocks against DB, use a short TTL bound to one media object,
 * and never return S3 credentials or reusable raw object URLs.
 */
export function authorizeSocialPrivatePlayback(
  ctx: SocialPlaybackContext,
): SocialPlaybackDecision {
  if (!ctx || typeof ctx.viewerId !== 'string' || ctx.viewerId.length === 0) {
    return { allowed: false, reason: 'unauthenticated' };
  }
  if (typeof ctx.ownerId !== 'string' || ctx.ownerId.length === 0 ||
      (!['public', 'followers', 'private'].includes(ctx.audience)) ||
      ctx.mediaState !== 'ready' || ctx.ownerState !== 'active' ||
      ctx.viewerState !== 'active' || ctx.viewerEmailVerified !== true ||
      ctx.viewerTermsCurrent !== true || ctx.ownerAgeEligible !== true ||
      ctx.viewerAgeEligible !== true || ctx.ownerModerationClear !== true ||
      ctx.mediaModerationClear !== true || ctx.postDeleted !== false ||
      ctx.postExpired !== false || ctx.ownerAllowsViewer !== true ||
      ctx.viewerAllowsOwner !== true || typeof ctx.viewerFollowsOwner !== 'boolean') {
    return { allowed: false, reason: 'forbidden' };
  }
  if (ctx.viewerId === ctx.ownerId) return { allowed: true };
  if (ctx.audience === 'public') return { allowed: true };
  if (ctx.audience === 'followers' && ctx.viewerFollowsOwner === true) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'forbidden' };
}
