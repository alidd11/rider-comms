import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { accountErrorMessage, SOCIAL_REPORT_REASONS } from './authClient';
import type { RiderAccountClient, RiderProfile, SocialFeedScope, SocialPost, SocialReportReason } from './authClient';
import { C, s } from './styles';

type FeedClient = Pick<RiderAccountClient, 'socialFeed' | 'riderSocialPosts' | 'riderProfiles' | 'deleteSocialPost' |
  'reportSocialPost' | 'blockRider' | 'socialMediaUrl' | 'socialPost'>;

/** Media links last at least 20 minutes; reload well before then. */
export const MEDIA_LINK_REFRESH_MS = 15 * 60_000;

const REASON_LABELS: Record<SocialReportReason, string> = {
  harassment: 'Bullying or harassment',
  unsafe: 'Dangerous riding or a safety risk',
  spam: 'Spam or scam',
  sexual: 'Nudity or sexual content',
  other: 'Something else',
};

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

type Panel = { postId: string; view: 'menu' | 'report' | 'confirm-delete' | 'confirm-block' };

export function LivePostCard({ post, profile, mine, client, onOpenReel, onRemoved, onNotice, onStaleMedia }: {
  post: SocialPost; profile?: RiderProfile; mine: boolean; client: FeedClient;
  onOpenReel?: (postId: string) => void;
  /** A photo didn't load, most likely because its link expired: fetch the post again. */
  onStaleMedia?: (postId: string) => void;
  onRemoved: (postId: string, why: 'deleted' | 'reported' | 'blocked') => void;
  onNotice: (message: string) => void;
}) {
  const [panel, setPanel] = useState<Panel['view'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const author = authorLabel(profile);
  const first = post.media[0];
  // Ask for fresh links once per set of links, never in a loop.
  const staleReported = useRef<string | null>(null);
  const mediaFailed = () => {
    const linkSet = post.media.map(item => item.url).join(' ');
    if (staleReported.current === linkSet) return;
    staleReported.current = linkSet;
    onStaleMedia?.(post.id);
  };
  const aspect = first ? mediaAspect(first.width, first.height) : 1;

  async function run(action: () => Promise<void>, why: 'deleted' | 'reported' | 'blocked', done: string) {
    setBusy(true);
    try {
      await action();
      onNotice(done);
      onRemoved(post.id, why);
    } catch (error) {
      onNotice(accountErrorMessage(error));
      setBusy(false);
    }
  }

  return <View testID={'live-post-' + post.id} style={{ marginBottom: 18 }}>
    <View style={[s.rowBetween, { paddingHorizontal: 14, paddingVertical: 9 }]}>
      <View style={[s.row, { flex: 1 }]}>
        <View style={s.avatar}><Text style={{ color: C.ink, fontWeight: '800' }}>{author.name.slice(0, 1).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.body, { fontWeight: '800' }]} numberOfLines={1}>{author.name}</Text>
          <Text style={s.small} numberOfLines={1}>{[author.handle, postAge(post.createdAt)].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={'Post options for ' + (author.handle || author.name)}
        onPress={() => setPanel(current => current ? null : 'menu')}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="ellipsis-horizontal" size={22} color={C.ink}/>
      </Pressable>
    </View>

    {post.hidden ? <View style={{ marginHorizontal: 14, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: '#2B2414' }}>
      <Text style={[s.small, { color: C.warning }]}>Hidden from others while we review reports about it.</Text>
    </View> : null}

    {post.kind === 'reel' && first ? <Pressable accessibilityRole="button" accessibilityLabel={'Watch Reel by ' + (author.handle || author.name)}
      onPress={() => onOpenReel?.(post.id)}
      style={{ width: '100%', aspectRatio: 0.8, backgroundColor: '#000' }}>
      {first.posterUrl ? <Image source={{ uri: client.socialMediaUrl(first.posterUrl) }} resizeMode="cover" onError={mediaFailed}
        accessibilityLabel={'Reel cover: ' + (post.caption || 'video')} style={{ flex: 1 }}/> : null}
      <View style={{ position: 'absolute', top: 12, right: 12 }}><Ionicons name="play-circle" size={34} color="#fff"/></View>
    </Pressable> : <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: aspect, backgroundColor: '#000' }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => width && setPage(Math.round(event.nativeEvent.contentOffset.x / width))}>
        {post.media.map((item, index) => <Image key={item.id} source={{ uri: client.socialMediaUrl(item.url) }} resizeMode="cover" onError={mediaFailed}
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
      {busy ? <ActivityIndicator color={C.accent} style={{ margin: 14 }}/> : null}
      {!busy && panel === 'menu' && mine ? <PanelButton icon="trash-outline" label="Delete post" danger onPress={() => setPanel('confirm-delete')}/> : null}
      {!busy && panel === 'menu' && !mine ? <>
        <PanelButton icon="flag-outline" label="Report post" onPress={() => setPanel('report')}/>
        <PanelButton icon="ban-outline" label={'Block ' + (author.handle || 'this rider')} danger onPress={() => setPanel('confirm-block')}/>
      </> : null}
      {!busy && panel === 'report' ? <>
        <Text style={[s.small, { padding: 10 }]}>Why are you reporting this post? It’s hidden from you straight away.</Text>
        {SOCIAL_REPORT_REASONS.map(reason => <PanelButton key={reason} icon="chevron-forward" label={REASON_LABELS[reason]}
          onPress={() => void run(() => client.reportSocialPost(post.id, reason), 'reported', 'Thanks. We’ll review this post.')}/>)}
      </> : null}
      {!busy && panel === 'confirm-delete' ? <>
        <Text style={[s.small, { padding: 10 }]}>Delete this post? Its photos or video are removed too. This can’t be undone.</Text>
        <PanelButton icon="trash" label="Delete" danger onPress={() => void run(() => client.deleteSocialPost(post.id), 'deleted', 'Post deleted.')}/>
      </> : null}
      {!busy && panel === 'confirm-block' ? <>
        <Text style={[s.small, { padding: 10 }]}>Block {author.handle || 'this rider'}? You won’t see each other’s posts, and they can’t message you, in Social or Rider Comms.</Text>
        <PanelButton icon="ban" label="Block" danger onPress={() => void run(() => client.blockRider(post.authorId), 'blocked', 'Blocked.')}/>
      </> : null}
      {!busy ? <PanelButton icon="close" label="Cancel" onPress={() => setPanel(null)}/> : null}
    </View> : null}
  </View>;
}

function PanelButton({ icon, label, danger = false, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; danger?: boolean; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={[s.row, { minHeight: 46, paddingHorizontal: 10 }]}>
    <Ionicons name={icon} size={20} color={danger ? '#F18E99' : C.ink}/>
    <Text style={[s.body, danger ? { color: '#F18E99' } : null]}>{label}</Text>
  </Pressable>;
}

/** Loads a feed page by page, and the riders' names for it. */
export function useLiveFeed(client: FeedClient, source: SocialFeedScope | { riderId: string }, refreshKey = 0) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [profiles, setProfiles] = useState<Record<string, RiderProfile>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
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
      setState('ready');
    } catch (failure) {
      if (id !== request.current) return;
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

  const remove = useCallback((postId: string, authorId?: string) => {
    setPosts(current => current.filter(post => post.id !== postId && (!authorId || post.authorId !== authorId)));
  }, []);

  return { posts, profiles, state, error, hasMore: Boolean(cursor), reload: () => void load(null), loadMore: () => void load(cursor), remove, refreshPost };
}

/** Home's real feed: For you (everyone in the test) and Following (friends). */
export function LiveFeed({ client, riderId, refreshKey, empty, onOpenReel, onNotice }: {
  client: FeedClient; riderId: string; refreshKey: number; empty: React.ReactNode;
  onOpenReel: (postId: string) => void; onNotice: (message: string) => void;
}) {
  const [scope, setScope] = useState<'for-you' | 'following'>('for-you');
  const feed = useLiveFeed(client, scope, refreshKey);
  const tabs = useMemo(() => [['for-you', 'For you'], ['following', 'Following']] as const, []);
  return <View testID="live-feed">
    <View accessibilityRole="tablist" style={[s.row, { paddingHorizontal: 16, paddingVertical: 8, gap: 22 }]}>
      {tabs.map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={label}
        accessibilityState={{ selected: scope === value }} onPress={() => setScope(value)} style={{ minHeight: 40, justifyContent: 'center' }}>
        <Text style={{ color: scope === value ? C.ink : C.muted, fontWeight: '800', fontSize: 15 }}>{label}</Text>
        <View style={{ height: 2, marginTop: 4, borderRadius: 1, backgroundColor: scope === value ? C.accent : 'transparent' }}/>
      </Pressable>)}
    </View>
    {feed.state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading posts" color={C.accent} style={{ margin: 30 }}/> : null}
    {feed.state === 'error' ? <View style={[s.card, s.pad, { marginHorizontal: 16 }]}>
      <Text style={s.body}>{feed.error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try loading posts again" style={s.ghost} onPress={feed.reload}>
        <Text style={s.ghostText}>Try again</Text>
      </Pressable>
    </View> : null}
    {feed.state === 'ready' && feed.posts.length === 0 ? (scope === 'following'
      ? <Text style={[s.muted, { padding: 18, textAlign: 'center' }]}>Posts from your Rider Comms friends will show here.</Text>
      : empty) : null}
    {feed.posts.map(post => <LivePostCard key={post.id} post={post} profile={feed.profiles[post.authorId]}
      mine={post.authorId === riderId} client={client} onOpenReel={onOpenReel} onNotice={onNotice} onStaleMedia={feed.refreshPost}
      onRemoved={(postId, why) => feed.remove(postId, why === 'blocked' ? post.authorId : undefined)}/>)}
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
    authorId: post.authorId,
    handle: author.handle || author.name,
    title: post.caption || 'Reel',
    imageUrl: video?.posterUrl ? client.socialMediaUrl(video.posterUrl) : '',
    videoUrl: video ? client.socialMediaUrl(video.url) : undefined,
    theme: '#0B0F14',
    category: 'MOTORCYCLES' as const,
  };
}

/** Real Reels for the Reels tab: everyone's, and friends'. */
export function useLiveReels(client: FeedClient, enabled: boolean, refreshKey = 0) {
  const [reels, setReels] = useState<{ forYou: ReturnType<typeof reelPreviewFromPost>[]; following: ReturnType<typeof reelPreviewFromPost>[] }>({ forYou: [], following: [] });
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
    }, () => undefined);
    return () => { live = false; };
  }, [client, enabled, refreshKey, linkRound]);
  return reels;
}

/** The rider's own posts on their profile, where they can also delete them. */
export function OwnPosts({ client, riderId, refreshKey, onNotice, onOpenReel, onCreate }: {
  client: FeedClient; riderId: string; refreshKey: number;
  onNotice: (message: string) => void; onOpenReel: (postId: string) => void; onCreate: () => void;
}) {
  const feed = useLiveFeed(client, { riderId }, refreshKey);
  if (feed.state === 'loading') return <ActivityIndicator accessibilityLabel="Loading your posts" color={C.accent} style={{ margin: 30 }}/>;
  if (feed.state === 'error') return <View style={[s.card, s.pad]}>
    <Text style={s.body}>{feed.error}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Try loading your posts again" style={s.ghost} onPress={feed.reload}>
      <Text style={s.ghostText}>Try again</Text>
    </Pressable>
  </View>;
  if (!feed.posts.length) return <View style={{ alignItems: 'center', paddingVertical: 44, gap: 12 }}>
    <Ionicons name="images-outline" size={33} color={C.accent}/>
    <Text style={s.cardHeading}>Your posts will appear here</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Create first post" style={s.cta} onPress={onCreate}>
      <Text style={s.ctaText}>Create post</Text>
    </Pressable>
  </View>;
  return <View testID="own-posts" style={{ marginHorizontal: -16 }}>
    {feed.posts.map(post => <LivePostCard key={post.id} post={post} profile={feed.profiles[post.authorId]} mine
      client={client} onOpenReel={onOpenReel} onNotice={onNotice} onStaleMedia={feed.refreshPost} onRemoved={(postId) => feed.remove(postId)}/>)}
    {feed.hasMore ? <Pressable accessibilityRole="button" accessibilityLabel="Load more of your posts"
      style={[s.ghost, { marginHorizontal: 16 }]} onPress={feed.loadMore}>
      <Text style={s.ghostText}>More posts</Text>
    </Pressable> : null}
  </View>;
}
