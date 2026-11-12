/**
 * Social discovery ranking v0: deterministic, side-effect-free candidate ranking.
 * These helpers are NOT authentication, authorisation, moderation or payments.
 * The future backend MUST apply equivalent filters BEFORE delivering candidates.
 *
 * No precise locations, ride traces, message text or private-club content are inputs.
 * Advertisements are separate from organic search/discovery rankings.
 */
export type Topic = 'cars' | 'motorcycles' | 'cycling' | 'events' | 'parts' | 'other';
export type Privacy = 'public' | 'followers' | 'members' | 'private';
export type CandidateState = 'published' | 'pending' | 'removed';
export type ClubPrivacy = 'public' | 'approval' | 'private';
export type RankReason = 'interest' | 'following' | 'community' | 'popular' | 'recent' | 'discover';
export type Ranked<T> = { item: T; score: number; reason: RankReason };

export type Viewer = {
  userId: string;
  ageFloor: 0 | 16 | 18;
  followedAuthors: ReadonlySet<string>;
  clubMemberIds: ReadonlySet<string>;
  blockedAuthors: ReadonlySet<string>;
  mutedAuthors: ReadonlySet<string>;
  hiddenContentIds: ReadonlySet<string>;
  hiddenTopics: ReadonlySet<Topic>;
  interests: Readonly<Partial<Record<Topic, number>>>;
  selectedRegion?: string; // Voluntary broad-area selection, never passive GPS
  personalisationEnabled: boolean;
};

export type Content = {
  id: string;
  authorId: string;
  clubId?: string;
  clubPrivacy?: ClubPrivacy;
  privacy: Privacy;
  authorPermitsDiscovery: boolean;
  state: CandidateState;
  minAge: 16 | 18;
  createdAt: number; // Unix seconds
  topics: readonly Topic[];
  quality: number; // 0..1, moderated content-quality metric (not pay-to-rank)
  likeCount: number;
  commentCount: number;
  saveCount: number;
  impressions: number;
  negativeFeedbackCount: number;
  authorTotalImpressions: number; // capped small-creator opportunity signal
  completionRate?: number; // Reels only, 0..1
};

export type Club = {
  id: string;
  name: string;
  topics: readonly Topic[];
  privacy: ClubPrivacy;
  state: 'active' | 'suspended';
  memberCount: number;
  monthlyActiveMembers: number;
  region?: string;
  sharedConnectionCount: number;
  minAge: 16 | 18;
};

export type Event = {
  id: string;
  title: string;
  topics: readonly Topic[];
  visibility: 'public' | 'private';
  state: 'active' | 'cancelled';
  startAt: number;
  minAge: 16 | 18;
  region?: string;
  interestedCount: number;
  slotsRemaining?: number; // undefined = unlimited
  organiserId: string;
};

export type MarketplaceListing = {
  id: string;
  merchantId: string;
  title: string;
  topics: readonly Topic[];
  category: string;
  available: boolean;
  state: 'active' | 'removed';
  merchant: {
    verified: boolean;
    approved: boolean;
    payoutsEnabled: boolean;
    suspended: boolean;
  };
  relevanceTerms: readonly string[];
  quality: number; // fulfilment and catalogue quality, NOT subscription tier
  popularity: number;
  // Paid merchant subscriptions intentionally cannot influence organic ranking.
};

export type Advertisement = {
  id: string;
  advertiserId: string;
  state: 'approved' | 'pending' | 'rejected';
  businessVerified: boolean;
  targetTopics: readonly Topic[];
  allowedRegions: readonly string[];
  minAge: 16 | 18;
  bid: number;
  quality: number;
  remainingBudget: number;
  impressionsToViewer: number;
};

export const noViewer: Viewer = {
  userId: '',
  ageFloor: 0,
  followedAuthors: new Set(),
  clubMemberIds: new Set(),
  blockedAuthors: new Set(),
  mutedAuthors: new Set(),
  hiddenContentIds: new Set(),
  hiddenTopics: new Set(),
  interests: {},
  personalisationEnabled: false,
};

function bounded(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function interestAffinity(topics: readonly Topic[], viewer: Viewer): number {
  if (!viewer.personalisationEnabled || !topics.length) return 0;
  const available = topics.filter((topic) => !viewer.hiddenTopics.has(topic));
  if (!available.length) return 0;
  return Math.max(...available.map((topic) => bounded(viewer.interests[topic] ?? 0, 0, 1)));
}

function ageAllowed(viewer: Viewer, minAge: 16 | 18): boolean {
  return viewer.ageFloor >= minAge;
}

function authorAllowed(viewer: Viewer, authorId: string): boolean {
  return authorId !== viewer.userId && !viewer.blockedAuthors.has(authorId) && !viewer.mutedAuthors.has(authorId);
}

export function mayViewContent(content: Content, viewer: Viewer, surface: 'discovery' | 'following'): boolean {
  if (!ageAllowed(viewer, content.minAge)
      || content.state !== 'published'
      || !authorAllowed(viewer, content.authorId)
      || viewer.hiddenContentIds.has(content.id)
      || content.topics.some((t) => viewer.hiddenTopics.has(t))) return false;

  // A public-looking post from a private/approval club is never eligible to escape it.
  // The only public discovery route for club content is a PUBLIC club + creator consent.
  if (surface === 'discovery') {
    return content.privacy === 'public'
      && content.authorPermitsDiscovery
      && (!content.clubId || content.clubPrivacy === 'public');
  }

  if (!viewer.followedAuthors.has(content.authorId)) return false;
  if (content.privacy === 'private') return false;
  if (content.clubId && content.clubPrivacy !== 'public'
      && !viewer.clubMemberIds.has(content.clubId)) return false;
  if (content.privacy === 'members') return Boolean(content.clubId && viewer.clubMemberIds.has(content.clubId));
  return content.privacy === 'public' || content.privacy === 'followers';
}

function recentScore(createdAt: number, now: number, horizonHours: number): number {
  // Future timestamps should not earn a ranking bonus.
  const elapsedHours = Math.max(0, now - createdAt) / 3600;
  return 1 / (1 + elapsedHours / horizonHours);
}

function engagementQuality(item: Content): number {
  const views = Math.max(10, item.impressions);
  const positive = (item.likeCount + 2 * item.commentCount + 3 * item.saveCount) / views;
  const negative = item.negativeFeedbackCount / views;
  return bounded(positive, 0, 0.4) / 0.4 - 1.2 * bounded(negative, 0, 1);
}

function scoreContent(item: Content, viewer: Viewer, now: number, kind: 'post' | 'reel'): number {
  const topic = interestAffinity(item.topics, viewer);
  const following = viewer.personalisationEnabled && viewer.followedAuthors.has(item.authorId) ? 1 : 0;
  const smallCreator = item.authorTotalImpressions < 1000 ? 0.18 : 0;
  const completion = kind === 'reel' ? 0.5 * bounded(item.completionRate ?? 0, 0, 1) : 0;
  // Engagement is deliberately bounded to avoid huge accounts dominating by volume.
  return 2.1 * topic + 0.85 * following + 1.25 * recentScore(item.createdAt, now, kind === 'reel' ? 48 : 72)
    + 1.2 * bounded(item.quality, 0, 1) + 0.8 * engagementQuality(item)
    + smallCreator + completion;
}

function reasonForContent(item: Content, viewer: Viewer, now: number): RankReason {
  if (interestAffinity(item.topics, viewer) >= 0.4) return 'interest';
  if (viewer.personalisationEnabled && viewer.followedAuthors.has(item.authorId)) return 'following';
  if (item.clubId && viewer.clubMemberIds.has(item.clubId)) return 'community';
  if (recentScore(item.createdAt, now, 72) >= 0.65) return 'recent';
  return 'discover';
}

function byScoreThenId<T extends { id: string }>(a: Ranked<T>, b: Ranked<T>): number {
  return b.score - a.score || a.item.id.localeCompare(b.item.id);
}

function diversifyCreators(entries: Ranked<Content>[], limit: number): Ranked<Content>[] {
  if (limit <= 0) return [];
  // First pass allows a single item per creator, then backfills remaining slots.
  // An author can still appear multiple times when variety is scarce.
  const result: Ranked<Content>[] = [];
  const usedIds = new Set<string>();
  const authors = new Set<string>();
  for (const entry of entries) {
    if (result.length >= limit) break;
    if (authors.has(entry.item.authorId)) continue;
    authors.add(entry.item.authorId);
    usedIds.add(entry.item.id);
    result.push(entry);
  }
  for (const entry of entries) {
    if (result.length >= limit) break;
    if (!usedIds.has(entry.item.id)) result.push(entry);
  }
  return result;
}

export function rankForYou(
  candidates: readonly Content[], viewer: Viewer, now: number, limit = 30
): Ranked<Content>[] {
  const ranked = candidates.filter((item) => mayViewContent(item, viewer, 'discovery'))
    .map((item) => ({ item, score: scoreContent(item, viewer, now, 'post'), reason: reasonForContent(item, viewer, now) }))
    .sort(byScoreThenId);
  return diversifyCreators(ranked, limit);
}

export function rankReels(
  candidates: readonly Content[], viewer: Viewer, now: number, limit = 30
): Ranked<Content>[] {
  const ranked = candidates.filter((item) => mayViewContent(item, viewer, 'discovery'))
    .map((item) => ({ item, score: scoreContent(item, viewer, now, 'reel'), reason: reasonForContent(item, viewer, now) }))
    .sort(byScoreThenId);
  return diversifyCreators(ranked, limit);
}

export function rankFollowing(
  candidates: readonly Content[], viewer: Viewer, now: number, order: 'newest' | 'relevant', limit = 30
): Ranked<Content>[] {
  const visible = candidates.filter((item) => mayViewContent(item, viewer, 'following'));
  const ranked = visible.map((item) => ({
    item,
    score: order === 'newest' ? item.createdAt : scoreContent(item, viewer, now, 'post'),
    reason: 'following' as RankReason,
  }));
  return ranked.sort(order === 'newest'
    ? (a, b) => b.item.createdAt - a.item.createdAt || a.item.id.localeCompare(b.item.id)
    : byScoreThenId).slice(0, Math.max(0, limit));
}

function topicReason(topics: readonly Topic[], viewer: Viewer): RankReason {
  return interestAffinity(topics, viewer) > 0 ? 'interest' : 'discover';
}

export function rankClubs(clubs: readonly Club[], viewer: Viewer, limit = 20): Ranked<Club>[] {
  return clubs.filter((club) => club.state === 'active' && club.privacy !== 'private' && ageAllowed(viewer, club.minAge))
    .map((club) => ({
      item: club,
      score: 2.5 * interestAffinity(club.topics, viewer)
        + bounded(club.monthlyActiveMembers / Math.max(10, club.memberCount), 0, 1)
        + 0.12 * Math.log1p(Math.max(0, club.sharedConnectionCount))
        + (viewer.selectedRegion && viewer.selectedRegion === club.region ? 0.4 : 0)
        + (club.memberCount < 150 ? 0.18 : 0),
      reason: topicReason(club.topics, viewer),
    }))
    .sort(byScoreThenId).slice(0, Math.max(0, limit));
}

export function rankEvents(events: readonly Event[], viewer: Viewer, now: number, limit = 20): Ranked<Event>[] {
  return events.filter((event) =>
    event.visibility === 'public' && event.state === 'active'
    && event.startAt >= now && ageAllowed(viewer, event.minAge)
    && (event.slotsRemaining === undefined || event.slotsRemaining > 0)
    && authorAllowed(viewer, event.organiserId)
  ).map((event) => ({
    item: event,
    score: 2 * interestAffinity(event.topics, viewer)
      + 1 / (1 + Math.max(0, event.startAt - now) / (7 * 86400))
      + (viewer.selectedRegion && viewer.selectedRegion === event.region ? 0.8 : 0)
      + bounded(Math.log1p(Math.max(0, event.interestedCount)) / 10, 0, 0.5),
    reason: topicReason(event.topics, viewer),
  })).sort(byScoreThenId).slice(0, Math.max(0, limit));
}

function merchantAllowed(merchant: MarketplaceListing['merchant']): boolean {
  return merchant.verified && merchant.approved && merchant.payoutsEnabled && !merchant.suspended;
}

export function rankMarketplace(
  listings: readonly MarketplaceListing[], viewer: Viewer, query = '', limit = 30
): Ranked<MarketplaceListing>[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return listings.filter((listing) =>
    merchantAllowed(listing.merchant) && listing.available && listing.state === 'active'
    && !viewer.blockedAuthors.has(listing.merchantId)
    && !viewer.mutedAuthors.has(listing.merchantId)
    && !viewer.hiddenContentIds.has(listing.id)
    && !listing.topics.some((t) => viewer.hiddenTopics.has(t))
    && terms.every((term) =>
      [listing.title, listing.category, ...listing.relevanceTerms].some((v) => v.toLowerCase().includes(term))
    )
  ).map((listing) => ({
    item: listing,
    score: 2 * interestAffinity(listing.topics, viewer)
      + 1.2 * bounded(listing.quality, 0, 1)
      + 0.2 * bounded(Math.log1p(Math.max(0, listing.popularity)) / 10, 0, 1)
      + terms.length * 1.5,
    reason: topicReason(listing.topics, viewer),
  })).sort(byScoreThenId).slice(0, Math.max(0, limit));
}

export type RankedAd = { item: Advertisement; score: number; label: 'Ad' };
export function selectEligibleAds(
  ads: readonly Advertisement[], viewer: Viewer, maxPerPage = 1
): RankedAd[] {
  // Separate placement inventory: advertisements never enter organic lists.
  return ads.filter((ad) =>
    ad.state === 'approved' && ad.businessVerified && ad.remainingBudget > 0
    && ad.impressionsToViewer < 3 && ageAllowed(viewer, ad.minAge)
    && !viewer.blockedAuthors.has(ad.advertiserId)
    && (ad.allowedRegions.length === 0 || Boolean(viewer.selectedRegion && ad.allowedRegions.includes(viewer.selectedRegion)))
    && !ad.targetTopics.some((topic) => viewer.hiddenTopics.has(topic))
  ).map((ad) => ({
    item: ad,
    score: bounded(ad.bid, 0, 10) * bounded(ad.quality, 0, 1)
      + (viewer.personalisationEnabled ? interestAffinity(ad.targetTopics, viewer) : 0),
    label: 'Ad' as const,
  })).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, Math.max(0, maxPerPage));
}

export function explainReason(reason: RankReason): string {
  switch (reason) {
    case 'interest': return 'Matches interests you chose';
    case 'following': return 'From an account you follow';
    case 'community': return 'Related to your communities';
    case 'recent': return 'Recently posted';
    case 'popular': return 'Engaging community content';
    default: return 'Discover something new';
  }
}
