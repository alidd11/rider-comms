import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AccountApiError, accountErrorMessage } from './authClient';
import type { RiderAccountClient, RiderProfile, SocialFeedScope, SocialPost } from './authClient';
import { C, s } from './styles';
import { IdentityAvatar } from './IdentityAvatar';
import { PostActions } from './PostActions';
import type { PostAction } from './PostActions';

type FeedClient = Pick<RiderAccountClient, 'socialFeed' | 'riderSocialPosts' | 'riderProfiles' | 'deleteSocialPost' |
  'reportSocialPost' | 'blockRider' | 'socialMediaUrl' | 'socialPost'>;

/** Media links last at least 20 minutes; reload well before then. */
export const MEDIA_LINK_REFRESH_MS = 15 * 60_000;

/** "5 min", "3 h", "2 d", or the date. */
export function postAge(createdAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} d`;
  return new Date(createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Feed media keeps its shape, within Instagram-like limits (4:5 to 1.91:1). */
export function mediaAspect(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 1;
  return Math.min(1.91, Math.max(0.8, width / height));
}

/** A rider's name for a post: their display name and @handle, or a fallback. */
function authorLabel(profile: RiderProfile | undefined): { name: string; handle: string } {
  if (!profile) return { name: 'Rider', handle: '' };
  const handle = profile.handle.startsWith('@') ? profile.handle : '@' + profile.handle;
  return { name: profile.displayName || handle, handle };
}

export function LivePostCard({ post, profile, mine, client, onOpenReel, onRemoved, onNotice, onStaleMedia }: {
  post: SocialPost; profile?: RiderProfile; mine: boolean; client: FeedClient;
  onOpenReel?: (postId: string) => void;
  /** A photo didn't load, most likely because its link expired: fetch the post again. */
  onStaleMedia?: (postId: string) => void;
  onRemoved: (postId: string, why: PostAction) => void;
  onNotice: (message: string) => void;
}) {
  const [panel, setPanel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const author = authorLabel(profile);
  const first = post.media[0];
  // A fresh URL can still fail. Retry each item once until it loads.
  const retriedMedia = useRef(new Set<string>());
  const mediaFailed = (mediaId: string) => {
    if (retriedMedia.current.has(mediaId)) return;
    retriedMedia.current.add(mediaId);
    onStaleMedia?.(post.id);
  };
  const aspect = first ? mediaAspect(first.width, first.height) : 1;

  return <View testID={'live-post-' + post.id} style={{ marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
    <View style={[s.rowBetween, { paddingHorizontal: 14, paddingVertical: 9 }]}>
      <View style={[s.row, { flex: 1 }]}>
        <IdentityAvatar name={author.name} avatarId={profile?.avatarId} size={38}/>
        <View style={{ flex: 1 }}>
          <Text style={[s.body, { fontWeight: '800' }]} numberOfLines={1}>{author.name}</Text>
          <Text style={s.small} numberOfLines={1}>{[author.handle, postAge(post.createdAt)].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={'Post options for ' + (author.handle || author.name)}
        onPress={() => setPanel(current => !current)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="ellipsis-horizontal" size={22} color={C.ink}/>
      </Pressable>
    </View>

    {post.hidden ? <View style={{ marginHorizontal: 14, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: C.card }}>
      <Text style={[s.small, { color: C.warning }]}>Hidden from others while we review reports about it.</Text>
    </View> : null}

    {post.kind === 'reel' && first ? <Pressable accessibilityRole="button" accessibilityLabel={'Watch Reel by ' + (author.handle || author.name)}
      onPress={() => onOpenReel?.(post.id)}
      style={{ width: '100%', aspectRatio: 0.8, backgroundColor: '#000' }}>
      {first.posterUrl ? <Image source={{ uri: client.socialMediaUrl(first.posterUrl) }} resizeMode="cover"
        onError={() => mediaFailed(first.id)} onLoad={() => { retriedMedia.current.delete(first.id); }}
        accessibilityLabel={'Reel cover: ' + (post.caption || 'video')} style={{ flex: 1 }}/> : null}
      <View style={{ position: 'absolute', top: 12, right: 12 }}><Ionicons name="play-circle" size={34} color="#fff"/></View>
    </Pressable> : <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: aspect, backgroundColor: '#000' }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => width && setPage(Math.round(event.nativeEvent.contentOffset.x / width))}>
        {post.media.map((item, index) => <Image key={item.id} source={{ uri: client.socialMediaUrl(item.url) }} resizeMode="cover"
          onError={() => mediaFailed(item.id)} onLoad={() => { retriedMedia.current.delete(item.id); }}
          accessibilityLabel={`Photo ${index + 1} of ${post.media.length}` + (post.caption ? ': ' + post.caption.slice(0, 80) : '')}
          style={{ width: width || 1, height: '100%' }}/>)}
      </ScrollView>
      {post.media.length > 1 ? <View style={{ position: 'absolute', top: 10, right: 10, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{page + 1}/{post.media.length}</Text>
      </View> : null}
    </View>}

    {post.caption ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Show less caption' : 'Read full caption'}
      onPress={() => setExpanded(value => !value)} style={{ paddingHorizontal: 14, paddingTop: 10 }}>
      <Text style={s.body} numberOfLines={expanded ? undefined : 2}>
        <Text style={{ fontWeight: '800' }}>{author.handle || author.name} </Text>{post.caption}
      </Text>
    </Pressable> : null}

    {panel ? <View testID="post-options" style={[s.card, { marginHorizontal: 14, marginTop: 10, padding: 6 }]}>
      <PostActions postId={post.id} authorId={post.authorId} handle={author.handle} mine={mine} client={client}
        onRemoved={why => onRemoved(post.id, why)} onNotice={onNotice} onClose={() => setPanel(false)}/>
    </View> : null}
  </View>;
}

/** Loads a feed page by page, and the riders' names for it. */
export function useLiveFeed(client: FeedClient, source: SocialFeedScope | { riderId: string }, refreshKey = 0) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [profiles, setProfiles] = useState<Record<string, RiderProfile>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const request = useRef(0);
  const key = typeof source === 'string' ? source : 'rider:' + source.riderId;

  const load = useCallback(async (after: string | null) => {
    const id = ++request.current;
    if (!after) setState('loading');
    try {
      const page = typeof source === 'string'
        ? await client.socialFeed(source, after)
        : await client.riderSocialPosts(source.riderId, after);
      if (id !== request.current) return;
      const authorIds = [...new Set(page.posts.map(post => post.authorId))];
      const names = authorIds.length ? await client.riderProfiles(authorIds).catch(() => ({})) : {};
      if (id !== request.current) return;
      setProfiles(current => ({ ...current, ...names }));
      setPosts(current => after ? [...current, ...page.posts.filter(post => !current.some(old => old.id === post.id))] : page.posts);
      setCursor(page.nextCursor);
      setStorageUnavailable(false);
      if (!after) setTotal(typeof page.total === 'number' ? page.total : null);
      setState('ready');
    } catch (failure) {
      if (id !== request.current) return;
      // A server without Social's media storage has no posts to show: that's
      // an empty feed (Home shows Rider Comms' own posts), not an error.
      if (failure instanceof AccountApiError && failure.code === 'social_media_not_configured') {
        setPosts([]);
        setCursor(null);
        setTotal(0);
        setStorageUnavailable(true);
        setState('ready');
        return;
      }
      setError(accountErrorMessage(failure));
      setState('error');
    }
  }, [client, key]);

  useEffect(() => { void load(null); }, [load, refreshKey]);

  // Swaps in a post with fresh media links; a post that's gone is dropped.
  const refreshPost = useCallback((postId: string) => {
    void client.socialPost(postId).then(
      fresh => setPosts(current => current.map(post => post.id === postId ? fresh : post)),
      () => setPosts(current => current.filter(post => post.id !== postId)),
    );
  }, [client]);

  const remove = useCallback((postId: string) => {
    setPosts(current => current.filter(post => post.id !== postId));
    setTotal(count => count === null ? null : Math.max(0, count - 1));
  }, []);

  return { posts, profiles, total, state, error, storageUnavailable, hasMore: Boolean(cursor), reload: () => void load(null), loadMore: () => void load(cursor), remove, refreshPost };
}

/** Home's real feed: For you (everyone in the test) and Following (friends). */
export function LiveFeed({ client, riderId, scope, refreshKey, empty, onOpenReel, onNotice, onRemoved, isVisible }: {
  client: FeedClient; riderId: string; scope: 'for-you' | 'following'; refreshKey: number; empty: React.ReactNode;
  onOpenReel: (postId: string) => void; onNotice: (message: string) => void;
  onRemoved: (postId: string, authorId: string, why: PostAction) => void;
  isVisible: (post: SocialPost) => boolean;
}) {
  const feed = useLiveFeed(client, scope, refreshKey);
  const visiblePosts = feed.posts.filter(isVisible);
  return <View testID="live-feed">
    {feed.state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading posts" color={C.accent} style={{ margin: 30 }}/> : null}
    {feed.state === 'error' ? <View style={[s.card, s.pad, { marginHorizontal: 16 }]}>
      <Text style={s.body}>{feed.error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try loading posts again" style={s.ghost} onPress={feed.reload}>
        <Text style={s.ghostText}>Try again</Text>
      </Pressable>
    </View> : null}
    {feed.state === 'ready' && visiblePosts.length === 0 ? (scope === 'following'
      ? <Text style={[s.muted, { padding: 18, textAlign: 'center' }]}>Posts from your Rider Comms friends will show here.</Text>
      : empty) : null}
    {visiblePosts.map(post => <LivePostCard key={post.id} post={post} profile={feed.profiles[post.authorId]}
      mine={post.authorId === riderId} client={client} onOpenReel={onOpenReel} onNotice={onNotice} onStaleMedia={feed.refreshPost}
      onRemoved={(postId, why) => onRemoved(postId, post.authorId, why)}/>)}
    {feed.hasMore && feed.state === 'ready' ? <Pressable accessibilityRole="button" accessibilityLabel="Load more posts"
      style={[s.ghost, { marginHorizontal: 16, marginBottom: 20 }]} onPress={feed.loadMore}>
      <Text style={s.ghostText}>More posts</Text>
    </Pressable> : null}
  </View>;
}

/** A Reel from the server, in the shape the Reels player takes. */
export function reelPreviewFromPost(post: SocialPost, profile: RiderProfile | undefined, client: Pick<FeedClient, 'socialMediaUrl'>) {
  const video = post.media[0];
  const author = authorLabel(profile);
  return {
    id: post.id,
    published: true,
    authorId: post.authorId,
    handle: author.handle || author.name,
    title: post.caption || 'Reel',
    imageUrl: video?.posterUrl ? client.socialMediaUrl(video.posterUrl) : '',
    videoUrl: video ? client.socialMediaUrl(video.url) : undefined,
    theme: '#0B0F14',
    category: 'MOTORCYCLES' as const,
  };
}

type LiveReel = ReturnType<typeof reelPreviewFromPost>;
const emptyReels: { forYou: LiveReel[]; following: LiveReel[] } = { forYou: [], following: [] };

/** Real Reels for the Reels tab: everyone's, and friends'. */
export function useLiveReels(client: FeedClient, enabled: boolean, refreshKey = 0) {
  const [reels, setReels] = useState<typeof emptyReels | null>(null);
  // Video links expire, so the Reels are fetched again before they do.
  const [linkRound, setLinkRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setLinkRound(round => round + 1), MEDIA_LINK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Promise.all([client.socialFeed('reels'), client.socialFeed('following')]).then(async ([everyone, friends]) => {
      const followingReels = friends.posts.filter(post => post.kind === 'reel');
      const ids = [...new Set([...everyone.posts, ...followingReels].map(post => post.authorId))];
      const names = ids.length ? await client.riderProfiles(ids).catch(() => ({} as Record<string, RiderProfile>)) : {};
      if (!live) return;
      setReels({
        forYou: everyone.posts.map(post => reelPreviewFromPost(post, names[post.authorId], client)),
        following: followingReels.map(post => reelPreviewFromPost(post, names[post.authorId], client)),
      });
    }, () => {
      if (live) setReels(current => current ?? emptyReels);
    });
    return () => { live = false; };
  }, [client, enabled, refreshKey, linkRound]);
  return { ...(reels ?? emptyReels), loading: enabled && reels === null };
}

/** The rider's own posts on their profile, or only their Reels, where they can also delete them. */
export function OwnPosts({ client, riderId, refreshKey, only, canPublish, onCount, onNotice, onOpenReel, onCreate, onDeleted }: {
  client: FeedClient; riderId: string; refreshKey: number; only?: 'reel'; canPublish: boolean;
  onDeleted: (postId: string, authorId: string, why: PostAction) => void;
  /** Told the rider's post count once it's known, and again after a delete. */
  onCount?: (count: number) => void;
  onNotice: (message: string) => void; onOpenReel: (postId: string) => void; onCreate: () => void;
}) {
  const feed = useLiveFeed(client, { riderId }, refreshKey);
  useEffect(() => { if (feed.total !== null) onCount?.(feed.total); }, [feed.total, onCount]);
  const shown = only ? feed.posts.filter(post => post.kind === only) : feed.posts;
  if (feed.state === 'loading') return <ActivityIndicator accessibilityLabel="Loading your posts" color={C.accent} style={{ margin: 30 }}/>;
  if (feed.state === 'error') return <View style={[s.card, s.pad]}>
    <Text style={s.body}>{feed.error}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Try loading your posts again" style={s.ghost} onPress={feed.reload}>
      <Text style={s.ghostText}>Try again</Text>
    </Pressable>
  </View>;
  if (!shown.length && !feed.hasMore) return <View style={{ alignItems: 'center', paddingVertical: 44, gap: 12 }}>
    <Ionicons name={only ? 'play-circle-outline' : 'images-outline'} size={33} color={C.accent}/>
    <Text style={s.cardHeading}>{only ? 'Your Reels will appear here' : 'Your posts will appear here'}</Text>
    {feed.storageUnavailable || !canPublish ? <Text style={s.muted}>
      {feed.storageUnavailable ? 'Social media is unavailable.' : 'Publishing is currently paused.'}
    </Text> : <Pressable accessibilityRole="button" accessibilityLabel={only ? 'Create first Reel' : 'Create first post'} style={s.cta} onPress={onCreate}>
      <Text style={s.ctaText}>{only ? 'Create Reel' : 'Create post'}</Text>
    </Pressable>}
  </View>;
  return <View testID={only ? 'own-reels' : 'own-posts'} style={{ marginHorizontal: -16 }}>
    {shown.map(post => <LivePostCard key={post.id} post={post} profile={feed.profiles[post.authorId]} mine
      client={client} onOpenReel={onOpenReel} onNotice={onNotice} onStaleMedia={feed.refreshPost} onRemoved={(postId, why) => {
        feed.remove(postId);
        onDeleted(postId, post.authorId, why);
      }}/>)}
    {feed.hasMore ? <Pressable accessibilityRole="button" accessibilityLabel="Load more of your posts"
      style={[s.ghost, { marginHorizontal: 16 }]} onPress={feed.loadMore}>
      <Text style={s.ghostText}>More posts</Text>
    </Pressable> : null}
  </View>;
}
