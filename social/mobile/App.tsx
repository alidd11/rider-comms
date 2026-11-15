import '@expo/metro-runtime';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StatusBar, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, s } from './src/styles';
import { rankForYou, rankFollowing, rankReels, rankClubs, rankEvents, rankMarketplace, explainReason, noViewer } from './src/recommendations';
import type { Content, Viewer, Topic, RankReason } from './src/recommendations';
import type { SocialPost } from './src/domain';
import { demoClubs as fixtureClubs, demoEvents as fixtureEvents, demoListings as fixtureListings, demoPosts as fixturePosts, demoStories as fixtureStories, followingIds as fixtureFollowingIds } from './src/sampleData';
import { socialFixturesEnabled } from './src/testFixtureMode';
import { clearLocalDemo } from './src/demoStorage';
import { clearAccountTextDraft } from './src/textDraftStorage';
import { CreateComposer } from './src/CreateComposer';
import { LiveFeed, OwnPosts, useLiveReels } from './src/LiveFeed';
import { IdentityAvatar } from './src/IdentityAvatar';
import { publishDraft } from './src/publishPost';
import { prepareMediaForUpload } from './src/prepareMedia';
import { canPublish, useSocialAccess } from './src/socialAccess';
import { ShopScreen } from './src/ShopScreen';
import { ReelsScreen } from './src/ReelsScreen';
import { StoriesViewer } from './src/StoriesViewer';
import type { ReelPreview } from './src/ReelsScreen';
import { FeedMedia } from './src/FeedMedia';
import { CommentsSheet } from './src/CommentsSheet';
import type { CommentPreview } from './src/CommentsSheet';
import { demoCreators, publicGallery } from './src/demoCreators';
import { ProfileSummary } from './src/ProfileSummary';
import { RiderBrandPage, RiderBrandHome } from './src/RiderBrandPage';
import { RIDER_BRAND_ID, brandStories, brandReels } from './src/brandEditorial';
import { ProfileEditor } from './src/ProfileEditor';
import type { ProfileFields } from './src/profileFields';
import { DEFAULT_AVATAR_ID } from '../../shared/src/avatars.ts';
import { SocialSettings } from './src/SocialSettings';
import type { ProfileContentTab } from './src/ProfileSummary';
import { ProfileConnectionsSheet } from './src/ProfileConnectionsSheet';
import { SocialAuthGate, useSocialAccount } from './src/SocialAuthGate';
import { SharedMessagesScreen } from './src/SharedMessagesScreen';
import { AccountApiError, accountErrorMessage } from './src/authClient';
import type { SharedFriend, SharedConversation, RiderProfile } from './src/authClient';
import type { ConnectionKind } from './src/ProfileConnectionsSheet';

type Screen = 'Home' | 'Reels' | 'Create' | 'Clubs' | 'Shop' | 'Profile' | 'Messages';
type Icon = React.ComponentProps<typeof Ionicons>['name'];

const primaryTabs: { name: Screen; icon: Icon; activeIcon: Icon }[] = [
  { name: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'Reels', icon: 'play-circle-outline', activeIcon: 'play-circle' },
  { name: 'Create', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { name: 'Clubs', icon: 'people-outline', activeIcon: 'people' },
  { name: 'Shop', icon: 'bag-outline', activeIcon: 'bag' },
];
const topics: { topic: Topic; label: string }[] = [
  { topic: 'cars', label: 'Cars' },
  { topic: 'motorcycles', label: 'Motorcycles' },
  { topic: 'cycling', label: 'Cycling' },
];

// Production ships with no fictional accounts, social proof, merchant listings or posts.
// CI enables isolated fixtures only in its browser-test export.
const demoClubs = socialFixturesEnabled ? fixtureClubs : [];
const demoEvents = socialFixturesEnabled ? fixtureEvents : [];
const demoListings = socialFixturesEnabled ? fixtureListings : [];
const demoPosts = socialFixturesEnabled ? fixturePosts : [];
const demoStories = socialFixturesEnabled ? fixtureStories : [];
const followingIds = socialFixturesEnabled ? fixtureFollowingIds : new Set<string>();
const previewNow = Math.floor(Date.now() / 1000);
const contentCandidates: Content[] = demoPosts.map((post, index) => ({
  id: post.id, authorId: post.authorId,
  clubId: post.clubAccess ? 'demo-private-club' : undefined,
  clubPrivacy: post.clubAccess,
  privacy: post.audience === 'members' ? 'members' : 'public',
  authorPermitsDiscovery: post.audience === 'public',
  state: 'published', minAge: 16, createdAt: previewNow - (index + 1) * 3600,
  topics: [post.category === 'CARS' ? 'cars' : post.category === 'CYCLING' ? 'cycling' : 'motorcycles'],
  quality: 0.8, likeCount: 12 + index, commentCount: 3, saveCount: 5,
  impressions: 250, negativeFeedbackCount: 0, authorTotalImpressions: index * 250,
}));

const reels = socialFixturesEnabled ? [
  { id: 'r1', headline: 'The weekend edit', creator: '@nina', theme: '#66433D', icon: 'car-sport' as const, imageUrl: 'https://images.unsplash.com/photo-1625932197913-68755c94c51f?auto=format&fit=crop&w=1100&q=82' },
  { id: 'r2', headline: 'A road worth sharing', creator: '@alex', theme: '#1B5A63', icon: 'speedometer' as const, imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1100&q=82' },
  { id: 'r3', headline: 'Ride together', creator: '@jules', theme: '#3B664A', icon: 'bicycle' as const, imageUrl: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1100&q=82' },
] : [];

const reelCandidates: Content[] = reels.map((reel, index) => ({
  id: reel.id, authorId: reel.creator.replace(/^@/, ''), privacy: 'public', authorPermitsDiscovery: true,
  state: 'published', minAge: 16, createdAt: previewNow - index * 4800,
  topics: [reel.id === 'r1' ? 'cars' : reel.id === 'r2' ? 'motorcycles' : 'cycling'],
  quality: 0.8, likeCount: 150, commentCount: 20, saveCount: 30,
  impressions: 1000, negativeFeedbackCount: 1, authorTotalImpressions: index * 800,
  completionRate: 0.7,
}));

const clubCandidates = demoClubs.map((club) => ({
  id: club.id, name: club.name,
  topics: [club.category === 'Cars' ? 'cars' : club.category === 'Cycling' ? 'cycling' : 'motorcycles'] as Topic[],
  privacy: (club.privacy === 'Approval' ? 'approval' : 'public') as 'public' | 'approval',
  state: 'active' as const, memberCount: club.members,
  monthlyActiveMembers: Math.round(club.members * 0.3),
  sharedConnectionCount: 3, minAge: 16 as const, region: club.city,
}));

const eventCandidates = demoEvents.map((event, index) => ({
  id: event.id, title: event.title, topics: [index === 0 ? 'cars' : 'motorcycles'] as Topic[],
  visibility: 'public' as const, state: 'active' as const,
  startAt: previewNow + (index + 7) * 86400,
  minAge: 16 as const, region: index === 0 ? 'London' : 'Sussex',
  interestedCount: 40 + index * 12, organiserId: event.organiser,
}));

const listingCandidates = demoListings.map((listing) => ({
  id: listing.id, merchantId: listing.merchant, title: listing.name,
  topics: [listing.name.toLowerCase().includes('bicycle') ? 'cycling' : 'motorcycles'] as Topic[],
  category: listing.category, available: true, state: 'active' as const,
  merchant: { verified: true, approved: true, payoutsEnabled: true, suspended: false },
  relevanceTerms: [listing.category, listing.type, listing.merchant], quality: 0.8, popularity: 100,
}));

function IconButton({ name, label, onPress }: { name: Icon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.iconButton}>
      <Ionicons name={name} size={20} color={C.ink} />
    </Pressable>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[s.pill, selected && s.pillActive]}>
      <Text style={[s.pillText, selected && s.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function HeaderLine({ heading, meta }: { heading: string; meta?: string }) {
  return (
    <View style={s.rowBetween}>
      <Text style={s.sectionTitle}>{heading}</Text>
      {meta ? <Text style={s.small}>{meta}</Text> : null}
    </View>
  );
}

function HomeEmpty({ onCreate, onReels, onMessages, live = false }: {
  onCreate: () => void; onReels: () => void; onMessages: () => void; live?: boolean;
}) {
  return <View testID="home-empty-onboarding" style={{
    marginHorizontal: 16, marginTop: 12, marginBottom: 10, padding: 20,
    borderRadius: 22, backgroundColor: '#12171D', gap: 17,
    borderWidth: 1, borderColor: '#232C33',
  }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
      <View style={{ width: 49, height: 49, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentDark }}>
        <Ionicons name="images-outline" color={C.accent} size={25} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: C.ink, fontSize: 20, fontWeight: '900',
          lineHeight: 25, letterSpacing: -0.5 }}>Share your first ride</Text>
        <Text style={[s.small, { fontSize: 12 }]}>Photos and Reels from riders you know.</Text>
      </View>
    </View>
    <Text style={[s.muted, { fontSize: 13, lineHeight: 20 }]}>
      {live
        ? 'Nobody in the Social test has posted yet. Share a photo or a Reel and you’ll be the first.'
        : 'Posting isn’t open yet. You can start a post now and keep it as a draft on this device.'}
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Open studio"
      onPress={onCreate} style={[s.cta, { minHeight: 50, flexDirection: 'row', gap: 9 }]}>
      <Ionicons name="camera-outline" size={19} color={C.bg} />
      <Text style={s.ctaText}>Open studio</Text>
    </Pressable>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Browse Reels from Home"
        onPress={onReels} style={{ flex: 1, minHeight: 46, flexDirection: 'row',
          justifyContent: 'center', alignItems: 'center', gap: 7,
          borderWidth: 1, borderColor: C.border, borderRadius: 13 }}>
        <Ionicons name="play-circle-outline" size={18} color={C.ink} />
        <Text style={[s.small, { color: C.ink, fontWeight: '800' }]}>Reels</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Go to inbox from Home"
        onPress={onMessages} style={{ flex: 1, minHeight: 46, flexDirection: 'row',
          justifyContent: 'center', alignItems: 'center', gap: 7,
          borderWidth: 1, borderColor: C.border, borderRadius: 13 }}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color={C.ink} />
        <Text style={[s.small, { color: C.ink, fontWeight: '800' }]}>Messages</Text>
      </Pressable>
    </View>
  </View>;
}

function PreviewEmpty({ icon, heading, body, actionLabel, onAction, featured = false }: {
  icon: Icon; heading: string; body: string;
  actionLabel?: string; onAction?: () => void; featured?: boolean;
}) {
  return (
    <View style={[s.empty, featured && {
      minHeight: 300, marginHorizontal: 15, marginTop: 13, paddingVertical: 39,
      overflow: 'hidden', backgroundColor: '#12171D',
    }]}>
      {featured ? <View pointerEvents="none" style={{
        position: 'absolute', top: -88, right: -66,
        width: 225, height: 225, borderRadius: 113,
        backgroundColor: '#193B35', opacity: 0.33,
      }}/> : null}
      <View style={{ width: featured ? 66 : 52, height: featured ? 66 : 52,
        borderRadius: featured ? 23 : 18, backgroundColor: C.accentDark,
        alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={featured ? 29 : 25} color={C.accent}/>
      </View>
      <Text style={[s.cardHeading,{
        fontSize: featured ? 23 : 18, letterSpacing: featured ? -0.7 : -0.3,
        lineHeight: featured ? 29 : 24, textAlign: 'center',
      }]}>{heading}</Text>
      <Text style={[s.muted, { textAlign: 'center', maxWidth: 300,
        fontSize: featured ? 14 : 13, lineHeight: 21 }]}>{body}</Text>
      {actionLabel && onAction ? <Pressable accessibilityRole="button"
        accessibilityLabel={actionLabel} onPress={onAction}
        style={[s.cta,{marginTop:11,minWidth:186,minHeight:49}]}>
        <Text style={s.ctaText}>{actionLabel}</Text>
      </Pressable> : null}
    </View>
  );
}


/**
 * The dark tab-bar background fills the iPhone home-indicator area.
 * Safe-area spacing keeps navigation controls above the indicator.
 * The web CSS handles env(safe-area-inset-bottom) because a standalone
 * Safari PWA can report zero insets through the JS provider.
 */
function BottomTabs({ screen, onNavigate }: { screen: Screen; onNavigate: (next: Screen) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View nativeID="social-bottom-tabs" accessibilityRole="tablist" accessibilityLabel="Main navigation" style={[
      s.tabBar,
      { paddingBottom: Platform.OS === 'web' ? 12 : Math.max(12, insets.bottom) }
    ]}>
      {primaryTabs.map((tab) => (
        <Pressable key={tab.name} accessibilityRole="tab"
          aria-selected={tab.name === screen}
          accessibilityLabel={tab.name} style={s.tab} onPress={() => onNavigate(tab.name)}>
          {tab.name === 'Create' ? <View testID="social-create-tab-symbol" style={{
            width: 49, height: 33, borderRadius: 11, backgroundColor: C.ink,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="add" size={27} color={C.bg}/>
          </View> : <Ionicons name={tab.name === screen ? tab.activeIcon : tab.icon} size={24}
            color={tab.name === screen ? C.ink : C.muted} />}
          <Text style={[s.tabLabel, tab.name === screen && { color: C.ink }]}>{tab.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AuthenticatedSocialApp(): React.JSX.Element {
  const { identity, client, logout, deleteAccount, resendVerification } = useSocialAccount();
  const { width: screenWidth } = useWindowDimensions();
  const mediaHeight = Math.min(620, Math.max(330, Math.round(Math.min(screenWidth,620)*1.25)));
  const [screen, setScreen] = useState<Screen>('Home');
  const pageScrollEnabled = screen === 'Home' || screen === 'Clubs' || screen === 'Shop' || screen === 'Profile';
  const [feedPreferencesOpen, setFeedPreferencesOpen] = useState(false);
  const [homeScope, setHomeScope] = useState<'for-you' | 'following'>('for-you');
  const [activePostMenu, setActivePostMenu] = useState<string | null>(null);
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<'Post' | 'Story' | 'Reel'>('Post');
  // The pilot may be accessed by 16–17-year-olds. No behavioural
  // recommendations opt-in is assumed; default to contextual ranking until
  // the user explicitly enables personalisation (UK Children's Code).
  const [personalisation, setPersonalisation] = useState(false);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenTopics, setHiddenTopics] = useState<Set<Topic>>(() => new Set());
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [followed, setFollowed] = useState<Set<string>>(() => new Set(followingIds));
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  // A private, in-memory preview: never place a rider's saved-video history in
  // plaintext AsyncStorage/localStorage or pretend it has synced to the server.
  const [savedReelIds, setSavedReelIds] = useState<Set<string>>(() => new Set());
  // Shop selections are session-only, but must survive navigating to Home,
  // Profile or Messages and back; ShopScreen itself unmounts between tabs.
  const [shopSaved, setShopSaved] = useState<Set<string>>(() => new Set());
  const [shopBasket, setShopBasket] = useState<Set<string>>(() => new Set());
  const [joined, setJoined] = useState<Set<string>>(() => new Set());
  const [going, setGoing] = useState<Set<string>>(() => new Set());
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [profileEditor, setProfileEditor] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileContentTab>('Posts');
  const [reelStartId, setReelStartId] = useState<string | null>(null);
  const access = useSocialAccess();
  // Real posts once the server has media storage; the screenshot build keeps its fixtures.
  const liveSocial = !socialFixturesEnabled && access.mediaUpload;
  const [feedRefresh, setFeedRefresh] = useState(0);
  const publishedNotice = useRef<string | null>(null);
  // Existing Reels remain readable when new uploads are paused.
  const liveReels = useLiveReels(client, !socialFixturesEnabled && (liveSocial || screen === 'Reels'), feedRefresh);
  const [connectionSheet, setConnectionSheet] = useState<ConnectionKind | null>(null);
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [brandPageOpen, setBrandPageOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<{ id: string; title: string } | null>(null);
  const [localComments, setLocalComments] = useState<Record<string, CommentPreview[]>>({});
  const [sharedFriends, setSharedFriends] = useState<SharedFriend[]>([]);
  const [sharedConversations, setSharedConversations] = useState<SharedConversation[]>([]);
  const [ownProfile, setOwnProfile] = useState<RiderProfile | null>(null);
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, RiderProfile>>({});
  const [sharedLoading, setSharedLoading] = useState(false);
  const sharedRefreshInFlight = useRef(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  // The rider's real post count, once their posts have loaded.
  const [ownPostCount, setOwnPostCount] = useState<number | null>(null);

  // The name, bio and avatar are the rider's Rider Comms profile, shared by both apps.
  useEffect(() => {
    let mounted = true;
    void client.ownProfile().then(result => {
      if (mounted) setOwnProfile(result);
    }).catch(() => {
      // Preserve the authenticated /auth/me username if profile API is temporarily offline.
    });
    return () => { mounted = false; };
  }, [client, identity.riderId]);

  const viewer = useMemo<Viewer>(() => ({
    ...noViewer, userId: identity.riderId, ageFloor: 16, followedAuthors: followed,
    interests: { cars: 0.8, motorcycles: 0.9, cycling: 0.7 },
    hiddenContentIds: hiddenPostIds, hiddenTopics,
    // Broad-area discovery requires the rider's explicit choice, not a guessed home region.
    ...(socialFixturesEnabled ? { selectedRegion: 'London' } : {}),
    personalisationEnabled: personalisation,
  }), [identity.riderId, hiddenPostIds, hiddenTopics, personalisation, followed]);

  const visiblePosts = useMemo(() => {
    // Home is one photo-and-story community feed. For You / Following selection
    // belongs exclusively to the immersive Reels viewer; don't duplicate it here.
    const ranked = rankForYou(contentCandidates, viewer, previewNow);
    return ranked.flatMap(({ item, reason }) => {
      const post = demoPosts.find((p) => p.id === item.id);
      return post ? [{ post, reason }] : [];
    });
  }, [viewer]);

  const recommendedReels = useMemo(() => rankReels(reelCandidates, viewer, previewNow), [viewer]);
  const reelPreviews = useMemo<ReelPreview[]>(() => [...recommendedReels.flatMap(({ item }) => {
    const reel = reels.find(candidate => candidate.id === item.id);
    if (!reel) return [];
    return [{
      id: reel.id,
      authorId: reel.creator.replace(/^@/, ''),
      handle: reel.creator,
      title: reel.headline,
      imageUrl: reel.imageUrl,
      theme: reel.theme,
      category: (reel.id === 'r1' ? 'CARS' : reel.id === 'r2' ? 'MOTORCYCLES' : 'CYCLING') as ReelPreview['category'],
    }];
  }), ...(socialFixturesEnabled ? [] : brandReels.map(reel => ({
    id: reel.id, authorId: RIDER_BRAND_ID, handle: '@ridercomms',
    title: reel.title, imageUrl: reel.imageUrl, theme: reel.theme,
    category: reel.category, editorialPreview: true,
    videoUrl: reel.videoUrl, hasAudio: reel.hasAudio, clipSourceUrl: reel.sourceUrl, clipCredit: reel.credit,
  })))], [recommendedReels]);
  // Following is a separate, access-filtered video timeline, not the For You
  // order with cosmetic labels. Server-side follows/visibility must replace
  // these fixture candidates before public UGC is permitted.
  const followingReelPreviews = useMemo<ReelPreview[]>(() =>
    rankFollowing(reelCandidates, viewer, previewNow, 'newest')
      .flatMap(({ item }) => {
        // Following must not depend on public-discovery eligibility: a future
        // follower-only Reel is shown only after the privacy check in rankFollowing.
        const reel = reels.find(candidate => candidate.id === item.id);
        if (!reel) return [];
        return [{
          id: reel.id, authorId: reel.creator.replace(/^@/, ''), handle: reel.creator,
          title: reel.headline, imageUrl: reel.imageUrl, theme: reel.theme,
          category: (reel.id === 'r1' ? 'CARS' : reel.id === 'r2' ? 'MOTORCYCLES' : 'CYCLING') as ReelPreview['category'],
        }];
      }), [viewer]);
  const savedReelPreviews = useMemo(() => {
    const available = new Map(
      [...reelPreviews, ...liveReels.following, ...liveReels.forYou].map(reel => [reel.id, reel]),
    );
    return [...savedReelIds].reverse().flatMap(id => {
      const reel = available.get(id);
      return reel ? [reel] : [];
    });
  }, [liveReels.following, liveReels.forYou, reelPreviews, savedReelIds]);
  // Deep-linking from Saved puts the selected eligible Reel first for that
  // viewing session. A pixel scroll on the first WebKit layout is unreliable
  // and can clamp to zero before the virtualised content has sized itself.
  const viewingReelPreviews = useMemo(() => {
    const all = [...liveReels.forYou, ...reelPreviews];
    if (!reelStartId) return all;
    const selected = all.find(reel => reel.id === reelStartId) ??
      liveReels.following.find(reel => reel.id === reelStartId);
    return selected
      ? [selected, ...all.filter(reel => reel.id !== reelStartId)]
      : all;
  }, [liveReels.following, liveReels.forYou, reelPreviews, reelStartId]);
  const recommendedClubs = useMemo(() =>
    rankClubs(clubCandidates, viewer).flatMap(({item}) => {
      const club = demoClubs.find((c) => c.id === item.id);
      return club ? [club] : [];
    }), [viewer]);
  const recommendedEvents = useMemo(() =>
    rankEvents(eventCandidates, viewer, previewNow).flatMap(({item}) => {
      const event = demoEvents.find((e) => e.id === item.id);
      return event ? [event] : [];
    }), [viewer]);
  // Saved items and preview basket must not disappear when discovery search/category changes.
  // Keep the same merchant/policy eligibility checks as the discovery ranking.
  const availableListings = useMemo(() =>
    rankMarketplace(listingCandidates, viewer, '').flatMap(({ item }) => {
      const listing = demoListings.find(candidate => candidate.id === item.id);
      return listing ? [listing] : [];
    }), [viewer]);
  const filteredListings = useMemo(() =>
    rankMarketplace(listingCandidates, viewer, search).map(({ item }) => item.id)
      .flatMap((id) => {
        const listing = demoListings.find((item) => item.id === id);
        return listing && (marketFilter === 'All' || listing.category === marketFilter) ? [listing] : [];
      }), [viewer, search, marketFilter]);

  function toggle<T extends string>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function navigate(to: Screen) {
    // Leaving the saved-video player restores normal For You ranking on the
    // next ordinary Reels visit. A fresh Saved deep link sets its own target.
    if (screen === 'Reels' && to !== 'Reels') setReelStartId(null);
    setScreen(to);
    if (to === 'Create') setCreateMode('Post');
    // Opening another section dismisses the Home feed settings panel.
    if (to !== 'Home') setFeedPreferencesOpen(false);
    setNotice(null);
    setSelectedClub(null);
    setSelectedEvent(null);
    setSelectedStory(null);
    setSelectedCreator(null);
    setBrandPageOpen(false);
    setCommentsFor(null);
    setProfileEditor(false);
    setSettingsOpen(false);
    setConnectionSheet(null);
  }

  function toggleFollow(authorId: string) { toggle(setFollowed, authorId); }
  function openComments(id: string, title: string) { setCommentsFor({ id, title }); }
  function addComment(id: string, value: string) {
    setLocalComments(current => ({
      ...current,
      [id]: [...(current[id] ?? []), { id: 'local-' + Date.now() + '-' + String((current[id] ?? []).length), text: value }].slice(-50),
    }));
  }
  async function loadSharedReadOnly(): Promise<void> {
    // A state-based guard can be stale during rapid navigation or repeated
    // taps. Never run overlapping account-scoped refreshes.
    if (sharedRefreshInFlight.current) return;
    sharedRefreshInFlight.current = true;
    setSharedLoading(true);
    setSharedError(null);
    try {
      const [friends, conversations] = await Promise.all([client.friends(), client.conversations()]);
      setSharedFriends(friends.friends);
      setSharedConversations(conversations.conversations);
      const peerIds = [...new Set([
        ...friends.friends.map(item => item.riderId),
        ...conversations.conversations.map(item => item.friend.riderId),
      ])].filter(Boolean);
      if (peerIds.length) {
        try { setSharedProfiles(await client.riderProfiles(peerIds.slice(0, 100))); }
        catch {
          // A failed profile lookup must not retain names from an earlier
          // friendship graph; the current friend API remains authoritative.
          setSharedProfiles({});
        }
      } else {
        setSharedProfiles({});
      }
    } catch (cause) {
      // Do not keep rendering stale conversation previews after refresh fails.
      // The friendship graph may have changed while the client was offline.
      setSharedFriends([]);
      setSharedConversations([]);
      setSharedProfiles({});
      setSharedError(cause instanceof Error && 'status' in cause && cause.status === 403
        ? 'Verify your email to message riders.'
        : 'Can’t load your Rider Comms conversations. Try again.');
    } finally {
      sharedRefreshInFlight.current = false;
      setSharedLoading(false);
    }
  }
  useEffect(() => {
    if (screen !== 'Messages' && screen !== 'Profile') return;
    void loadSharedReadOnly();
    // Only request on screen entry; explicit refresh action reloads.
  }, [screen, client]);
  function openCreator(id: string) {
    if (id === RIDER_BRAND_ID) {
      navigate('Home');
      setBrandPageOpen(true);
      return;
    }
    setSelectedCreator(id);
    setScreen('Home');
    setNotice(null);
  }


  function banner(message: string) {
    setNotice(message);
  }

  async function saveProfile(changes: Partial<ProfileFields>): Promise<void> {
    if (Object.keys(changes).length) {
      try {
        setOwnProfile(await client.updateOwnProfile(changes));
      } catch (failure) {
        throw new Error(failure instanceof AccountApiError && failure.code === 'objectionable_content'
          ? 'That name or bio isn’t allowed. Try something else.'
          : accountErrorMessage(failure));
      }
      banner('Profile saved.');
    }
    setProfileEditor(false);
  }

  function renderPost(post: SocialPost, reason: RankReason) {
    return <View key={post.id} style={s.feedCard}>
      <View style={s.feedAuthorRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={'View creator ' + post.handle}
          style={s.row} onPress={() => openCreator(post.authorId)}>
          <View style={[s.avatar, { backgroundColor: post.accent }]}><Text style={s.avatarText}>{post.author.split(' ').map(v=>v[0]).join('')}</Text></View>
          <View><Text style={s.cardHeading}>{post.author}</Text><Text style={s.small}>{post.handle} · {post.category.toLowerCase()}</Text></View>
        </Pressable>
        <View style={[s.row,{gap:9}]}>
          {!followed.has(post.authorId) ? <Pressable accessibilityRole="button"
            accessibilityLabel={'Follow '+post.handle}
            onPress={() => toggleFollow(post.authorId)}>
            <Text style={{color:C.accent,fontSize:12,fontWeight:'800'}}>Follow</Text>
          </Pressable> : null}
          <IconButton name="ellipsis-horizontal" label={'Post options for ' + post.author}
            onPress={() => setActivePostMenu(id => id === post.id ? null : post.id)}/>
        </View>
      </View>
      {activePostMenu === post.id ? <View style={s.feedOptions}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Why seeing post by ' + post.author} onPress={() => { setActivePostMenu(null); banner(explainReason(reason) + ' · Sample recommendation'); }}>
          <View style={s.row}><Ionicons name="information-circle-outline" color={C.accent} size={20}/><Text style={s.ghostText}>Why this post?</Text></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={'Not interested in post by ' + post.author} onPress={() => { setActivePostMenu(null); toggle(setHiddenPostIds, post.id); }}>
          <View style={s.row}><Ionicons name="eye-off-outline" color={C.muted} size={20}/><Text style={s.ghostText}>Not interested</Text></View>
        </Pressable>
      </View> : null}
      <FeedMedia id={post.id} images={publicGallery(post)} height={mediaHeight}
        liked={liked.has(post.id)} onDoubleTap={() => { if (!liked.has(post.id)) toggle(setLiked, post.id); }}/>
      <View style={s.feedActions}>
        <View style={[s.row,{gap:20}]}>
          <Pressable accessibilityRole="button" accessibilityLabel={liked.has(post.id) ? 'Unlike post' : 'Like post'} onPress={() => toggle(setLiked, post.id)}>
            <Ionicons name={liked.has(post.id)?'heart':'heart-outline'} color={liked.has(post.id)?'#F18E99':C.ink} size={27}/>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open comments" onPress={() => openComments(post.id, post.heading)}><Ionicons name="chatbubble-outline" color={C.ink} size={25}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share post" onPress={() => banner('Sharing is not live yet.')}><Ionicons name="paper-plane-outline" color={C.ink} size={25}/></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={saved.has(post.id)?'Unsave post':'Save post'} onPress={() => toggle(setSaved,post.id)}>
          <Ionicons name={saved.has(post.id)?'bookmark':'bookmark-outline'} color={saved.has(post.id)?C.accent:C.ink} size={25}/>
        </Pressable>
      </View>
      <View style={s.feedCaption}>
        <Text style={[s.body,{fontWeight:'800'}]}>{post.heading}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={'View profile for ' + post.handle}
          onPress={() => openCreator(post.authorId)}>
          <Text style={[s.small, { color: C.accent }]}>View profile</Text>
        </Pressable>
        <Text style={s.muted} numberOfLines={expandedCaptionId === post.id ? undefined : 1}>{post.body}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={expandedCaptionId===post.id?'Show less caption':'Read full caption'}
          onPress={() => setExpandedCaptionId(id => id===post.id ? null : post.id)}>
          <Text style={[s.small,{color:C.accent}]}>{expandedCaptionId===post.id?'Less':'More'}</Text>
        </Pressable>
      </View>
    </View>;
  }

  function renderHome() {
    if (brandPageOpen) return <View style={{ paddingHorizontal: 15, paddingTop: 5 }}>
      <RiderBrandPage onBack={() => setBrandPageOpen(false)}
        onStory={() => setSelectedStory(brandStories[0].id)}
        onReel={(id) => { navigate('Reels'); setReelStartId(id); }} />
    </View>;
    const creator = selectedCreator ? demoCreators[selectedCreator] : undefined;
    if (creator) return <View style={{ padding: 18, gap: 14 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Home feed" onPress={() => setSelectedCreator(null)}>
        <View style={s.row}><Ionicons name="arrow-back" size={22} color={C.ink}/><Text style={s.ghostText}>Feed</Text></View>
      </Pressable>
      <View style={[s.card, s.pad, { gap: 15 }]}>
        <View style={s.row}>
          <View style={[s.avatar, { width: 58, height: 58, borderRadius: 29 }]}>
            <Ionicons name={creator.kind === 'Car' ? 'car-sport' : creator.kind === 'Bicycle' ? 'bicycle' : 'speedometer'} size={27} color={C.accent}/>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.title}>{creator.displayName}</Text>
            <Text style={s.small}>{creator.handle} · Sample creator</Text>
          </View>
        </View>
        <Text style={s.body}>{creator.about}</Text>
        <View style={s.rowBetween}>
          <Text style={s.cardHeading}>Rides</Text>
        </View>
        <Text style={s.cardHeading}>{creator.vehicle}</Text>
        <View style={s.row}>
          {creator.gallery.map(photo => <Image key={photo.uri} source={{ uri: photo.uri }}
            accessibilityLabel={photo.alt} resizeMode="cover"
            style={{ flex: 1, height: 120, borderRadius: 10, backgroundColor: C.bg }}/>)}
        </View>
        <Text style={s.small}>{creator.modifications.join(' · ')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Explore creator club" style={s.cta}
          onPress={() => { navigate('Clubs'); setSelectedClub(creator.clubId); }}>
          <Text style={s.ctaText}>Explore their club</Text>
        </Pressable>
        <Pressable accessibilityRole="button"
          accessibilityLabel={(followed.has(creator.id) ? 'Unfollow ' : 'Follow ') + creator.handle}
          style={s.ghost} onPress={() => toggleFollow(creator.id)}>
          <Text style={s.ghostText}>{followed.has(creator.id) ? 'Following ✓' : 'Follow creator'}</Text>
        </Pressable>
      </View>
      <Text style={s.small}>Fictional demo creator and example vehicle details. No Rider Comms personal data is accessed.</Text>
    </View>;
    return <View style={{width:'100%',maxWidth:640,alignSelf:'center'}}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.storyRail}>
        <Pressable accessibilityRole="button" accessibilityLabel="Create story"
          style={s.storyItem} onPress={()=>{navigate('Create');setCreateMode('Story');}}>
          <View style={[s.storyCircle, { borderColor: 'transparent' }]}>
            <IdentityAvatar name={ownProfile?.displayName || identity.username} avatarId={ownProfile?.avatarId} size={54}/>
            <View style={{ position: 'absolute', right: 0, bottom: 0, width: 21, height: 21,
              borderRadius: 11, borderWidth: 2, borderColor: C.bg, backgroundColor: C.ink,
              alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add" color={C.bg} size={14}/>
            </View>
          </View>
          <Text style={s.storyLabel}>Your story</Text>
        </Pressable>
        {(socialFixturesEnabled ? demoStories : brandStories.slice(0, 1)).map(story=><Pressable key={story.id} accessibilityRole="button"
          accessibilityLabel={'View story by '+story.name}
          onPress={()=>setSelectedStory(story.id)} style={s.storyItem}>
          <View style={s.storyCircle}><Image source={{uri:story.imageUrl}}
            style={{width:54,height:54,borderRadius:27,backgroundColor:story.color}}/></View>
          <Text style={s.storyLabel}>{story.name}</Text>
        </Pressable>)}
      </ScrollView>

      {feedPreferencesOpen ? <View testID="home-feed-preferences"
        style={[s.card,s.pad,{marginHorizontal:16,marginTop:9,marginBottom:12,gap:13}]}>
        <View style={s.rowBetween}>
          <Text style={[s.cardHeading,{fontSize:16}]}>Feed preferences</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close feed settings"
            onPress={()=>setFeedPreferencesOpen(false)}
            style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center'}}>
            <Ionicons name="close" color={C.muted} size={21}/>
          </Pressable>
        </View>
        {!socialFixturesEnabled ? <View accessibilityRole="tablist" accessibilityLabel="Home feed" style={s.row}>
          {([['for-you', 'Home'], ['following', 'Following']] as const).map(([value, label]) =>
            <Pressable key={value} accessibilityRole="tab" aria-selected={homeScope === value}
              onPress={() => { setHomeScope(value); setFeedPreferencesOpen(false); }}
              style={[s.ghost, { flex: 1, minHeight: 44, backgroundColor: homeScope === value ? C.accentDark : 'transparent' }]}>
              <Text style={s.ghostText}>{label}</Text>
            </Pressable>)}
        </View> : null}
        <View style={s.rowBetween}>
          <Text style={[s.body,{flex:1}]}>Personalised recommendations</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Toggle personalised recommendations"
            accessibilityState={{checked:personalisation}}
            onPress={()=>setPersonalisation(value=>!value)}
            style={{minHeight:44,justifyContent:'center',paddingHorizontal:4}}>
            <Text style={{color:C.accent,fontWeight:'800',fontSize:13}}>{personalisation?'On':'Off'}</Text>
          </Pressable>
        </View>
        <Text style={s.small}>Community topics</Text>
        <View style={[s.row,{flexWrap:'wrap'}]}>
          {topics.map(({topic,label})=><Pill key={topic} label={label}
            selected={!hiddenTopics.has(topic)} onPress={()=>toggle(setHiddenTopics,topic)}/>)}
        </View>
      </View> : null}
      {!socialFixturesEnabled ? <>
        <LiveFeed client={client} riderId={identity.riderId} scope={homeScope} refreshKey={feedRefresh}
          onOpenReel={(id) => { setReelStartId(id); navigate('Reels'); }} onNotice={banner}
          empty={<HomeEmpty live={liveSocial}
            onCreate={() => { setCreateMode('Post'); navigate('Create'); }}
            onReels={() => navigate('Reels')}
            onMessages={() => navigate('Messages')}/>}/>
        <RiderBrandHome onOpen={() => setBrandPageOpen(true)} />
      </> : visiblePosts.length ? visiblePosts.map(({post,reason})=>renderPost(post,reason))
        : <HomeEmpty
            onCreate={() => { setCreateMode('Post'); navigate('Create'); }}
            onReels={() => navigate('Reels')}
            onMessages={() => navigate('Messages')}/>}
    </View>;
  }

  function renderClubs() {
    if (!socialFixturesEnabled) return <View style={{ gap: 14 }}>
      <View style={[s.card, s.pad, { gap: 12 }]}>
        <Ionicons name="people-outline" color={C.accent} size={27}/>
        <Text style={s.cardHeading}>Clubs and meets haven’t opened yet</Text>
        <Text style={s.muted}>You can still message riders you’re friends with on Rider Comms.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open messages from Clubs"
          onPress={() => navigate('Messages')} style={s.ghost}>
          <Text style={s.ghostText}>Open messages</Text>
        </Pressable>
      </View>
    </View>;

    const event = demoEvents.find((item) => item.id === selectedEvent);
    if (event) return (
      <>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to clubs and events" style={s.row} onPress={() => setSelectedEvent(null)}>
          <Ionicons name="arrow-back" size={20} color={C.ink} /><Text style={s.ghostText}>Clubs & events</Text>
        </Pressable>
        <View style={s.card}>
          <View style={[s.media, { height: 175, backgroundColor: event.accent }]}>
            <Ionicons name="calendar-clear-outline" size={48} color={C.ink} />
            <Text style={s.mediaCategory}>EVENT PREVIEW</Text>
          </View>
          <View style={s.pad}>
            <Text style={s.title}>{event.title}</Text>
            <Text style={s.muted}>{event.category} · {event.date}</Text>
            <View style={s.row}><Ionicons name="people-outline" size={19} color={C.accent}/><Text style={s.body}>Organised by {event.organiser}</Text></View>
            <View style={s.row}><Ionicons name="location-outline" size={19} color={C.accent}/><Text style={s.body}>{event.place}</Text></View>
            <Text style={s.small}>Preview event · private details stay protected</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={going.has(event.id) ? 'Remove demo RSVP interest' : 'Mark interested in demo event'} style={s.cta} onPress={() => toggle(setGoing, event.id)}>
              <Text style={s.ctaText}>{going.has(event.id) ? 'Interested ✓ — demo' : 'Mark interested — demo'}</Text>
            </Pressable>
          </View>
        </View>
        <PreviewEmpty icon="chatbox-outline" heading="Event chat and RSVPs" body="Guest lists and event chat are coming later." />
      </>
    );

    const club = demoClubs.find((item) => item.id === selectedClub);
    if (club) return (
      <>
        <Pressable accessibilityRole="button" style={s.row} onPress={() => setSelectedClub(null)}><Ionicons name="arrow-back" size={20} color={C.ink} /><Text style={s.ghostText}>All clubs</Text></Pressable>
        <View style={[s.card, s.pad, { gap: 15 }]}>
          <View style={{ height: 120, backgroundColor: club.accent, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="people" color="#ECFFF7" size={56} /></View>
          <Text style={s.title}>{club.name}</Text>
          <Text style={s.muted}>{club.category} · {club.city} · {club.members.toLocaleString()} members</Text>
          <Text style={s.body}>{club.description}</Text>
          <Text style={s.small}>{club.privacy === 'Approval' ? 'Request to join' : 'Open to all'} · sample club</Text>
          <Pressable accessibilityRole="button" style={s.cta} onPress={() => toggle(setJoined, club.id)}><Text style={s.ctaText}>{joined.has(club.id) ? 'Leave demo club' : 'Join demo club'}</Text></Pressable>
        </View>
        <PreviewEmpty icon="chatbubbles-outline" heading="Club posts and chat" body="Club posts and chat are coming later." />
      </>
    );
    return (
      <>
        <View style={{ gap: 5, paddingBottom: 1 }}>
          <Text style={[s.title, { fontSize: 28, letterSpacing: -0.75 }]}>Clubs & events</Text>
          <Text style={[s.muted, { fontSize: 14, lineHeight: 21 }]}>
            Riding clubs and meets are coming to Rider Social.
          </Text>
        </View>
        {recommendedClubs.map((item) => (
          <View style={[s.card, s.pad]} key={item.id}>
            <View style={s.row}>
              <View style={[s.avatar, { backgroundColor: item.accent, width: 52, height: 52, borderRadius: 15 }]}><Ionicons name="people" color={C.ink} size={25} /></View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={s.cardHeading}>{item.name}</Text>
                <Text style={s.small}>{item.category} · {item.members.toLocaleString()} members</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={'Open ' + item.name} onPress={() => setSelectedClub(item.id)}><Ionicons name="chevron-forward" color={C.ink} size={20} /></Pressable>
            </View>
            <Text style={s.muted}>{item.description}</Text>
            <View style={s.rowBetween}>
              <View style={s.darkBadge}><Text style={s.badgeText}>{item.privacy === 'Approval' ? 'Request to join' : 'Open to all'}</Text></View>
              <Pressable accessibilityRole="button" style={s.ghost} onPress={() => setSelectedClub(item.id)}><Text style={s.ghostText}>View club</Text></Pressable>
            </View>
          </View>
        ))}
        {!recommendedClubs.length ? <PreviewEmpty icon="people-outline" heading="Clubs are coming soon"
          body="You’ll be able to join riding clubs and find meets here."/> : null}
        <HeaderLine heading="Upcoming events" />
        {!recommendedEvents.length ? <View testID="clubs-empty-events"
          style={{ flexDirection: 'row', gap: 13, alignItems: 'center',
            backgroundColor: C.panel, borderRadius: 18, padding: 17 }}>
          <View style={{ width: 48, height: 48, borderRadius: 15,
            backgroundColor: C.accentDark, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="calendar-outline" color={C.accent} size={23}/>
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={[s.cardHeading, { fontSize: 15 }]}>No upcoming events.</Text>
            <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
              Meets from clubs will show here.
            </Text>
          </View>
        </View> : null}
        {recommendedEvents.map((event) => (
          <View style={[s.card, s.pad]} key={event.id}>
            <View style={s.row}>
              <View style={[s.avatar, { width: 50, height: 50, borderRadius: 12, backgroundColor: event.accent }]}><Ionicons name="calendar-outline" color={C.ink} size={25} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardHeading}>{event.title}</Text>
                <Text style={s.small}>{event.date} · {event.category}</Text>
              </View>
            </View>
            <Text style={s.muted}>{event.place} · {event.organiser}</Text>
            <View style={s.rowBetween}>
              <Text style={s.small}>{going.has(event.id) ? 'Interest saved for this session' : 'No RSVP submitted'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={'View event ' + event.title} style={s.ghost} onPress={() => setSelectedEvent(event.id)}><Text style={s.ghostText}>Event details</Text></Pressable>
            </View>
          </View>
        ))}
      </>
    );
  }

  function renderShop() {
    return <ShopScreen items={filteredListings} collectionItems={availableListings} search={search} onSearch={setSearch}
      category={marketFilter} onCategory={setMarketFilter}
      saved={shopSaved} basket={shopBasket}
      onToggleSaved={(id) => toggle(setShopSaved, id)}
      onAddBasket={(id) => setShopBasket(current => new Set(current).add(id))}
      onBrowseReels={() => navigate('Reels')}/>;
  }

  async function clearDeviceDrafts(): Promise<void> {
    // The same rider's pending saves are serialised by demoStorage.
    await clearLocalDemo(identity.riderId);
    await clearAccountTextDraft(identity.riderId);
  }

  function renderProfile() {
    if (settingsOpen) return <SocialSettings username={identity.username}
      emailVerified={identity.emailVerified}
      onClose={() => setSettingsOpen(false)}
      onClearDrafts={clearDeviceDrafts}
      onSignOut={logout}
      onDeleteAccount={deleteAccount}/>;
    if (profileEditor) return <ProfileEditor
      initial={{
        displayName: ownProfile?.displayName || identity.username,
        bio: ownProfile?.bio ?? '',
        avatarId: ownProfile?.avatarId || DEFAULT_AVATAR_ID,
      }}
      onCancel={() => setProfileEditor(false)}
      onSave={saveProfile}/>;
    return (
      <View style={{ gap: 16 }}>
        <ProfileSummary accountProfile={ownProfile} tab={profileTab} username={identity.username}
          postCount={liveSocial ? ownPostCount : 0}
          friendCount={sharedFriends.length}
          followingCount={socialFixturesEnabled ? [...followed].filter(id => Boolean(demoCreators[id])).length : undefined}
          onTab={setProfileTab} onConnections={setConnectionSheet} onEdit={() => setProfileEditor(true)}
          onSettings={() => { setNotice(null); setSettingsOpen(true); }}/>
        {profileTab === 'Posts' && liveSocial ? <OwnPosts client={client} riderId={identity.riderId} refreshKey={feedRefresh}
          onCount={setOwnPostCount} onNotice={banner} onOpenReel={(id) => { setReelStartId(id); navigate('Reels'); }}
          onCreate={() => { navigate('Create'); setCreateMode('Post'); }}/> : null}
        {profileTab === 'Posts' && !liveSocial ? <View style={{ alignItems: 'center', paddingVertical: 44, gap: 12 }}>
          <Ionicons name="images-outline" size={33} color={C.accent}/>
          <Text style={s.cardHeading}>Your posts will appear here</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Create first post" style={s.cta}
            onPress={() => { navigate('Create'); setCreateMode('Post'); }}>
            <Text style={s.ctaText}>Create post</Text>
          </Pressable>
        </View> : null}
        {profileTab === 'Reels' && liveSocial ? <OwnPosts client={client} riderId={identity.riderId} refreshKey={feedRefresh}
          only="reel" onNotice={banner} onOpenReel={(id) => { setReelStartId(id); navigate('Reels'); }}
          onCreate={() => { navigate('Create'); setCreateMode('Reel'); }}/> : null}
        {profileTab === 'Reels' && !liveSocial ? <View style={{ alignItems: 'center', paddingVertical: 44, gap: 12 }}>
          <Ionicons name="play-circle-outline" size={33} color={C.accent}/>
          <Text style={s.cardHeading}>Your Reels will appear here</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Create first Reel" style={s.cta}
            onPress={() => { navigate('Create'); setCreateMode('Reel'); }}>
            <Text style={s.ctaText}>Create Reel</Text>
          </Pressable>
        </View> : null}
        {profileTab === 'Saved' ? <View testID="profile-saved-reels" style={{ gap: 13, paddingVertical: 12 }}>
          <Text style={[s.sectionTitle, { fontSize: 20 }]}>Saved Reels</Text>
          <Text style={[s.small, { lineHeight: 19 }]}>
            Only you can see these. They’re kept until you close the app.
          </Text>
          {savedReelPreviews.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {savedReelPreviews.map(reel => <Pressable key={reel.id}
              accessibilityRole="button" accessibilityLabel={'Watch saved Reel ' + reel.id}
              onPress={() => { setReelStartId(reel.id); navigate('Reels'); }}
              style={{ width: '47%', minHeight: 225, backgroundColor: C.panel,
                borderRadius: 16, overflow: 'hidden' }}>
              <Image source={{ uri: reel.imageUrl }} accessibilityLabel={reel.title}
                resizeMode="cover" style={{ width: '100%', height: 174, backgroundColor: reel.theme }}/>
              <Text numberOfLines={2} style={{ color: C.ink, fontSize: 13,
                fontWeight: '800', lineHeight: 18, padding: 9 }}>{reel.title}</Text>
            </Pressable>)}
          </View> : <Pressable accessibilityRole="button"
            accessibilityLabel="Explore Reels from Saved"
            onPress={() => { setReelStartId(null); navigate('Reels'); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 13,
              backgroundColor: C.panel, borderRadius: 16,
              paddingHorizontal: 15, paddingVertical: 14, minHeight: 78 }}>
            <View style={{ width: 48, height: 48, borderRadius: 15,
              backgroundColor: C.accentDark, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="bookmark-outline" size={26} color={C.accent}/>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.cardHeading, { fontSize: 15 }]}>No saved Reels yet</Text>
              <Text style={[s.small, { fontSize: 12, lineHeight: 18 }]}>
                Explore videos and bookmark them for later.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={C.accent}/>
          </Pressable>}
        </View> : null}
        <View style={{ gap: 10, paddingVertical: 13 }}>
          {!identity.emailVerified ? <Pressable accessibilityRole="button"
            accessibilityLabel="Resend verification email"
            onPress={() => { void resendVerification().then(
              () => setVerificationNotice('Verification email requested. Check your inbox.'),
              () => setVerificationNotice('Could not resend verification. Please try again later.'),
            ); }} style={s.ghost}>
            <Text style={s.ghostText}>Resend verification email</Text>
          </Pressable> : null}
          {verificationNotice ? <Text accessibilityRole="alert" style={s.small}>{verificationNotice}</Text> : null}
        </View>
      </View>
    );
  }

  function renderMessages() {
    return <SharedMessagesScreen ownRiderId={identity.riderId}
      emailVerified={identity.emailVerified} client={client}
      conversations={sharedConversations} friends={sharedFriends} profiles={sharedProfiles}
      loading={sharedLoading} error={sharedError}
      onRefresh={loadSharedReadOnly}/>;
  }

  const activeStories = socialFixturesEnabled ? demoStories : brandStories;
  const story = activeStories.find((item) => item.id === selectedStory);

  return (
    <SafeAreaView nativeID="social-screen"
      edges={Platform.OS === 'web' ? [] : screen === 'Reels' && !story ? ['left', 'right'] : ['top', 'left', 'right']}
      style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        {!story && screen !== 'Reels' && screen !== 'Create' &&
          !(screen === 'Profile' && profileEditor) ? <View style={[s.header, screen !== 'Home' && { minHeight: 52, justifyContent: 'flex-end' }]}>
          {screen === 'Home' ? <Pressable accessibilityRole="button" accessibilityLabel="Go to home" onPress={() => navigate('Home')}>
            <Text style={s.brandTitle}>Social<Text style={{ color: C.accent }}>.</Text></Text>
          </Pressable> : screen === 'Shop' || (screen === 'Clubs' && !socialFixturesEnabled) ?
            <Text accessibilityRole="header" style={[s.cardHeading, { marginRight: 'auto' }]}>
              {screen === 'Shop' ? 'Shop' : 'Clubs & events'}
            </Text> : <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
          <View style={s.headerTools}>
            {screen === 'Home' && !selectedCreator ?
              <IconButton name="options-outline" label="Feed preferences"
                onPress={() => setFeedPreferencesOpen(value => !value)} /> : null}
            <IconButton name="chatbubble-ellipses-outline" label="Open messages" onPress={() => navigate('Messages')} />
            <IconButton name="person-circle-outline" label="Open profile" onPress={() => navigate('Profile')} />
          </View>
        </View> : null}
        {notice && screen !== 'Reels' ? (
          <Pressable style={s.notice} accessibilityRole="button" accessibilityLabel="Dismiss notice" onPress={() => setNotice(null)}>
            <View style={s.rowBetween}><Text style={[s.body, { color: '#C4FFEC', flex: 1 }]}>{notice}</Text><Ionicons name="close" size={17} color={C.accent} /></View>
          </Pressable>
        ) : null}
        {story ? (
          <StoriesViewer stories={activeStories} initialId={story.id} onClose={() => setSelectedStory(null)} />
        ) : (
          <>
            {pageScrollEnabled ? (
              <ScrollView nativeID="social-page-scroll" style={s.scroll}
                contentContainerStyle={screen === 'Home' ? { paddingBottom: 24 } :
                  screen === 'Shop' ? { paddingBottom: 28 } : s.content}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                overScrollMode="never" bounces={false}
                key={screen === 'Home' ? 'Home-' + (brandPageOpen ? 'brand' : selectedCreator ?? 'feed') +
                  (feedPreferencesOpen ? '-preferences' : '-content') :
                  screen === 'Profile' ? 'Profile-' + (settingsOpen ? 'settings' : profileEditor ? 'edit' : profileTab) : screen}>
                {screen === 'Home' ? renderHome() : null}
                {screen === 'Clubs' ? renderClubs() : null}
                {screen === 'Shop' ? renderShop() : null}
                {screen === 'Profile' ? renderProfile() : null}
              </ScrollView>
            ) : screen === 'Create' ? (
              <CreateRecoveryBoundary key={createMode} onClose={() => navigate('Home')}>
                <CreateComposer initialMode={createMode} riderId={identity.riderId}
                  onClose={() => {
                    navigate('Home');
                    // Shown once the composer has closed: navigating clears notices.
                    if (publishedNotice.current) banner(publishedNotice.current);
                    publishedNotice.current = null;
                  }}
                  onPublish={liveSocial && canPublish(access) ? async (draft, progress) => {
                    await publishDraft(client, draft, prepareMediaForUpload, progress);
                    setFeedRefresh(n => n + 1);
                    publishedNotice.current = draft.mode === 'Reel' ? 'Your Reel is live.' : 'Your post is live.';
                  } : undefined} />
              </CreateRecoveryBoundary>
            ) : screen === 'Reels' ? (
              <View testID="fixed-reels-screen" style={{ flex: 1, minHeight: 0, width: '100%', backgroundColor: '#020406' }}>
                {liveReels.loading && !reelStartId ?
                  <ActivityIndicator accessibilityLabel="Loading Reels" color={C.accent}
                    style={{ flex: 1 }}/> : <ReelsScreen items={viewingReelPreviews} followingItems={[...liveReels.following, ...followingReelPreviews]}
                  initialReelId={reelStartId} followedAuthors={followed}
                  savedReelIds={savedReelIds} onToggleSavedReel={(id) => toggle(setSavedReelIds, id)}
                  onToggleFollow={toggleFollow}
                  onOpenComments={(id, title) => openComments('reel:' + id, title)}
                  onOpenCreator={openCreator}
                  onCreateReel={() => { navigate('Create'); setCreateMode('Reel'); }} />}
              </View>
            ) : (
              <View testID="fixed-messages-screen" style={[s.content,{flex:1,minHeight:0}]}>
                {renderMessages()}
              </View>
            )}
            {screen !== 'Create' && !(screen === 'Profile' && profileEditor) ?
              <BottomTabs screen={screen} onNavigate={navigate} /> : null}
          </>
        )}
        {commentsFor ? <CommentsSheet key={commentsFor.id} title={commentsFor.title}
          comments={localComments[commentsFor.id] ?? []}
          onSubmit={value => addComment(commentsFor.id, value)}
          onClose={() => setCommentsFor(null)}/> : null}
        {connectionSheet ? <ProfileConnectionsSheet kind={connectionSheet}
          followed={followed} friends={sharedFriends} onToggleFollow={toggleFollow}
          onClose={() => setConnectionSheet(null)}/> : null}
      </View>
    </SafeAreaView>
  );
}

/**
 * A single Create-screen exception must not unmount the entire authenticated
 * PWA. Safari may throw during media permission or browser API setup, and a
 * blank full-screen app offers no way to exit or report the problem.
 */
class CreateRecoveryBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View testID="create-recovery" style={{
      flex: 1, minHeight: 0, backgroundColor: '#050709',
      alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 17,
    }}>
      <Ionicons name="camera-outline" color="#FFFFFF" size={45}/>
      <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800',
        textAlign: 'center' }}>Couldn’t open Create</Text>
      <Text style={{ color: '#B4BBC4', fontSize: 14, lineHeight: 21,
        textAlign: 'center' }}>
        The camera screen encountered a problem. You can try again or return home.
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry Create"
        onPress={() => this.setState({ failed: false })}
        style={{ minHeight: 46, paddingHorizontal: 26, borderRadius: 24,
          backgroundColor: '#FFFFFF', justifyContent: 'center' }}>
        <Text style={{ color: '#050709', fontWeight: '800' }}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Return Home"
        onPress={this.props.onClose}
        style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Return home</Text>
      </Pressable>
    </View>;
  }
}

/**
 * Final safety net for account, navigation, profile and feed render errors.
 * A failed feature must never leave the whole PWA as a blank dark canvas.
 * This does not hide failures from the browser smoke suite, which checks
 * that the recovery UI is absent on every normal route.
 */
class SocialAppRecoveryBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View testID="social-app-recovery" style={{
      flex: 1, backgroundColor: '#080D13', justifyContent: 'center',
      alignItems: 'center', gap: 17, paddingHorizontal: 28,
    }}>
      <Ionicons name="alert-circle-outline" size={44} color="#FFFFFF"/>
      <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800',
        textAlign: 'center' }}>Social couldn't open this screen</Text>
      <Text style={{ color: '#B4BBC4', fontSize: 14, lineHeight: 21,
        textAlign: 'center' }}>
        This screen encountered a problem. You can restart the Social app without
        deleting your account or local drafts.
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Restart Social"
        onPress={() => this.setState({ failed: false })}
        style={{ minHeight: 48, borderRadius: 25, backgroundColor: '#FFFFFF',
          paddingHorizontal: 26, justifyContent: 'center' }}>
        <Text style={{ color: '#050709', fontWeight: '800' }}>Restart Social</Text>
      </Pressable>
    </View>;
  }
}

export default function App(): React.JSX.Element {
  return <SocialAppRecoveryBoundary>
    <SafeAreaProvider>
      <SocialAuthGate>
        <AuthenticatedSocialApp/>
      </SocialAuthGate>
    </SafeAreaProvider>
  </SocialAppRecoveryBoundary>;
}
