export type FeedMode = 'forYou' | 'following';
export type FollowingOrder = 'relevant' | 'newest';
export type Audience = 'public' | 'members';
export type ClubAccess = 'public' | 'approval' | 'private';

export type SocialPost = {
  id: string;
  authorId: string;
  author: string;
  handle: string;
  heading: string;
  body: string;
  category: string;
  icon: 'car-sport' | 'bicycle' | 'speedometer' | 'images';
  accent: string;
  publishedAt: number;
  discoveryScore: number;
  audience: Audience;
  clubAccess?: ClubAccess;
};

export type MerchantStatus = {
  businessVerified: boolean;
  commerceApproved: boolean;
  payoutsEnabled: boolean;
  suspended: boolean;
};

export function canEnterPublicDiscovery(post: Pick<SocialPost, 'audience' | 'clubAccess'>): boolean {
  return post.audience === 'public' && (post.clubAccess === undefined || post.clubAccess === 'public');
}

export function canSell(status: MerchantStatus): boolean {
  return status.businessVerified && status.commerceApproved && status.payoutsEnabled && !status.suspended;
}

// This is a transparent DEMO ranking, not a real recommendation algorithm.
export function selectDemoFeed(
  posts: readonly SocialPost[],
  mode: FeedMode,
  followingIds: ReadonlySet<string>,
  followingOrder: FollowingOrder
): SocialPost[] {
  const eligible = posts.filter(canEnterPublicDiscovery);
  if (mode === 'following') {
    const followed = eligible.filter((post) => followingIds.has(post.authorId));
    return followed.sort((a, b) => followingOrder === 'newest'
      ? b.publishedAt - a.publishedAt
      : b.discoveryScore - a.discoveryScore || b.publishedAt - a.publishedAt);
  }
  return eligible.sort((a, b) => b.discoveryScore - a.discoveryScore || b.publishedAt - a.publishedAt);
}
