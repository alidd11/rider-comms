import '@expo/metro-runtime';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StatusBar, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, s } from './src/styles';
import { rankForYou, rankFollowing, rankReels, rankClubs, rankEvents, rankMarketplace, explainReason, noViewer } from './src/recommendations';
import type { Content, Viewer, Topic, RankReason } from './src/recommendations';
import type { FeedMode, FollowingOrder, SocialPost } from './src/domain';
import { demoClubs as fixtureClubs, demoEvents as fixtureEvents, demoListings as fixtureListings, demoPosts as fixturePosts, demoStories as fixtureStories, followingIds as fixtureFollowingIds } from './src/sampleData';
import { socialFixturesEnabled } from './src/testFixtureMode';
import { DEFAULT_PROFILE, EMPTY_GARAGE_DRAFT, addGarageEntry, createGarageEntry, removeGarageEntry, updateGarageVisibility, validateProfile } from './src/garage';
import type { GarageDraft, GarageEntry, GarageKind, SocialProfileDraft } from './src/garage';
import { loadLocalDemo, saveLocalDemo, clearLocalDemo } from './src/demoStorage';
import { accountTextDraftKey } from './src/createDraftKey';
import { CreateComposer } from './src/CreateComposer';
import { ShopScreen } from './src/ShopScreen';
import { ReelsScreen } from './src/ReelsScreen';
import { StoriesViewer } from './src/StoriesViewer';
import type { ReelPreview } from './src/ReelsScreen';
import { FeedMedia } from './src/FeedMedia';
import { CommentsSheet } from './src/CommentsSheet';
import type { CommentPreview } from './src/CommentsSheet';
import { demoCreators, publicGallery } from './src/demoCreators';
import { ProfileSummary } from './src/ProfileSummary';
import { SocialSettings } from './src/SocialSettings';
import { profileForRider } from './src/profileDisplay';
import type { ProfileContentTab } from './src/ProfileSummary';
import { ProfileConnectionsSheet } from './src/ProfileConnectionsSheet';
import { SocialAuthGate, useSocialAccount } from './src/SocialAuthGate';
import { SharedMessagesScreen } from './src/SharedMessagesScreen';
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

function PreviewEmpty({ icon, heading, body }: { icon: Icon; heading: string; body: string }) {
  return (
    <View style={s.empty}>
      <Ionicons name={icon} size={32} color={C.accent} />
      <Text style={s.cardHeading}>{heading}</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{body}</Text>
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
    <View nativeID="social-bottom-tabs" style={[
      s.tabBar,
      { paddingBottom: Platform.OS === 'web' ? 12 : Math.max(12, insets.bottom) }
    ]}>
      {primaryTabs.map((tab) => (
        <Pressable key={tab.name} accessibilityRole="tab"
          accessibilityState={{ selected: tab.name === screen }}
          accessibilityLabel={tab.name} style={s.tab} onPress={() => onNavigate(tab.name)}>
          <Ionicons name={tab.name === screen ? tab.activeIcon : tab.icon} size={23}
            color={tab.name === screen ? C.accent : C.muted} />
          <Text style={[s.tabLabel, tab.name === screen && { color: C.accent }]}>{tab.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function AuthenticatedSocialApp(): React.JSX.Element {
  const { identity, client, logout, resendVerification } = useSocialAccount();
  const { width: screenWidth } = useWindowDimensions();
  const mediaHeight = Math.min(620, Math.max(330, Math.round(Math.min(screenWidth,620)*1.25)));
  const [screen, setScreen] = useState<Screen>('Home');
  const pageScrollEnabled = screen === 'Home' || screen === 'Clubs' || screen === 'Shop' || screen === 'Profile';
  const [feedMode, setFeedMode] = useState<FeedMode>('forYou');
  const [feedPreferencesOpen, setFeedPreferencesOpen] = useState(false);
  const [activePostMenu, setActivePostMenu] = useState<string | null>(null);
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<'Post' | 'Story' | 'Reel'>('Post');
  const [personalisation, setPersonalisation] = useState(true);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenTopics, setHiddenTopics] = useState<Set<Topic>>(() => new Set());
  const [followingOrder, setFollowingOrder] = useState<FollowingOrder>('newest');
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [followed, setFollowed] = useState<Set<string>>(() => new Set(followingIds));
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [joined, setJoined] = useState<Set<string>>(() => new Set());
  const [going, setGoing] = useState<Set<string>>(() => new Set());
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [profile, setProfile] = useState<SocialProfileDraft>(DEFAULT_PROFILE);
  const [garage, setGarage] = useState<GarageEntry[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [profileEditor, setProfileEditor] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileContentTab>('Posts');
  const [connectionSheet, setConnectionSheet] = useState<ConnectionKind | null>(null);
  const [profileDraft, setProfileDraft] = useState<SocialProfileDraft>(DEFAULT_PROFILE);
  const [garageEditor, setGarageEditor] = useState(false);
  const [garageDraft, setGarageDraft] = useState<GarageDraft>({ ...EMPTY_GARAGE_DRAFT });
  const [pendingGarageDelete, setPendingGarageDelete] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null);
  const [commentsFor, setCommentsFor] = useState<{ id: string; title: string } | null>(null);
  const [localComments, setLocalComments] = useState<Record<string, CommentPreview[]>>({});
  const [sharedFriends, setSharedFriends] = useState<SharedFriend[]>([]);
  const [sharedConversations, setSharedConversations] = useState<SharedConversation[]>([]);
  const [ownProfile, setOwnProfile] = useState<RiderProfile | null>(null);
  const [sharedProfiles, setSharedProfiles] = useState<Record<string, RiderProfile>>({});
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [localDraftOwner, setLocalDraftOwner] = useState<string | null>(null);

  // Rider Comms controls the real name, handle and avatar identity. Local
  // Social edits never replace authoritative account profile values.
  useEffect(() => {
    let mounted = true;
    void client.ownProfile().then(result => {
      if (mounted) setOwnProfile(result);
    }).catch(() => {
      // Preserve the authenticated /auth/me username if profile API is temporarily offline.
    });
    return () => { mounted = false; };
  }, [client, identity.riderId]);

  // Preview-only, per-device data. Shared Rider Comms accounts and DMs are untouched.
  useEffect(() => {
    let mounted = true;
    void loadLocalDemo(identity.riderId).then((saved) => {
      if (!mounted) return;
      setProfile(profileForRider(saved.profile, identity.username, socialFixturesEnabled));
      setGarage(saved.garage);
      setLocalDraftOwner(identity.riderId);
      setLocalReady(true);
    });
    return () => { mounted = false; };
  }, [identity.riderId]);

  useEffect(() => {
    if (!localReady || localDraftOwner !== identity.riderId) return;
    void saveLocalDemo(identity.riderId, { profile, garage }).catch(() => {
      // Storage failures must not prevent the user from exploring the preview.
      // The UI always identifies saved entries as local device-only data.
    });
  }, [identity.riderId, localReady, localDraftOwner, profile, garage]);

  const viewer = useMemo<Viewer>(() => ({
    ...noViewer, userId: identity.riderId, ageFloor: 16, followedAuthors: followed,
    interests: { cars: 0.8, motorcycles: 0.9, cycling: 0.7 },
    hiddenContentIds: hiddenPostIds, hiddenTopics,
    // Broad-area discovery requires the rider's explicit choice, not a guessed home region.
    ...(socialFixturesEnabled ? { selectedRegion: 'London' } : {}),
    personalisationEnabled: personalisation,
  }), [identity.riderId, hiddenPostIds, hiddenTopics, personalisation, followed]);

  const visiblePosts = useMemo(() => {
    const ranked = feedMode === 'forYou'
      ? rankForYou(contentCandidates, viewer, previewNow)
      : rankFollowing(contentCandidates, viewer, previewNow, followingOrder);
    return ranked.flatMap(({ item, reason }) => {
      const post = demoPosts.find((p) => p.id === item.id);
      return post ? [{ post, reason }] : [];
    });
  }, [viewer, feedMode, followingOrder]);

  const recommendedReels = useMemo(() => rankReels(reelCandidates, viewer, previewNow), [viewer]);
  const reelPreviews = useMemo<ReelPreview[]>(() => recommendedReels.flatMap(({ item }) => {
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
  }), [recommendedReels]);
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
    setScreen(to);
    if (to === 'Create') setCreateMode('Post');
    setNotice(null);
    setSelectedClub(null);
    setSelectedEvent(null);
    setSelectedStory(null);
    setSelectedCreator(null);
    setCommentsFor(null);
    setProfileEditor(false);
    setSettingsOpen(false);
    setConnectionSheet(null);
    setGarageEditor(false);
    setPendingGarageDelete(null);
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
    if (sharedLoading) return;
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
        catch { /* Conversation identity remains available from the existing friend API. */ }
      }
    } catch (cause) {
      setSharedError(cause instanceof Error && 'status' in cause && cause.status === 403
        ? 'Verify your email to message riders.'
        : 'Can’t load your Rider Comms conversations. Try again.');
    } finally { setSharedLoading(false); }
  }
  useEffect(() => {
    if (screen !== 'Messages' && screen !== 'Profile') return;
    void loadSharedReadOnly();
    // Only request on screen entry; explicit refresh action reloads.
  }, [screen, client]);
  function openCreator(id: string) {
    setSelectedCreator(id);
    setScreen('Home');
    setNotice(null);
  }


  function banner(message: string) {
    setNotice(message);
  }

  function openProfileEditor() {
    setProfileDraft({ ...profile });
    setProfileEditor(true);
  }

  function saveProfile() {
    const result = validateProfile(profileDraft);
    if (!result.ok) { banner(result.error); return; }
    setProfile(result.value);
    setProfileEditor(false);
    banner('Social profile preview saved on this device only.');
  }

  function openGarageEditor() {
    setGarageDraft({ ...EMPTY_GARAGE_DRAFT });
    setGarageEditor(true);
  }

  function saveGarage() {
    const parsed = createGarageEntry(garageDraft, 'preview-' + String(Date.now()), new Date().getFullYear());
    if (!parsed.ok) { banner(parsed.error); return; }
    const updated = addGarageEntry(garage, parsed.value);
    if (!updated.ok) { banner(updated.error); return; }
    setGarage(updated.value);
    setGarageEditor(false);
    banner('Vehicle added to your private/local preview garage.');
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
        <Pressable accessibilityRole="button" accessibilityLabel={'View garage for ' + post.handle}
          onPress={() => openCreator(post.authorId)}>
          <Text style={[s.small, { color: C.accent }]}>View build & garage</Text>
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
          <Text style={s.cardHeading}>Garage</Text>
          <Text style={s.small}>Public preview</Text>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.storyRail}>
        <Pressable accessibilityRole="button" accessibilityLabel="Create story" style={s.storyItem} onPress={()=>{navigate('Create');setCreateMode('Story');}}>
          <View style={[s.storyCircle,{borderColor:C.border}]}><Ionicons name="add" color={C.accent} size={23}/></View>
          <Text style={s.storyLabel}>Your story</Text>
        </Pressable>
        {demoStories.map(story=><Pressable key={story.id} accessibilityRole="button" accessibilityLabel={'View story by '+story.name}
          onPress={()=>setSelectedStory(story.id)} style={s.storyItem}>
          <View style={s.storyCircle}><Image source={{uri:story.imageUrl}} style={{width:49,height:49,borderRadius:17,backgroundColor:story.color}}/></View>
          <Text style={s.storyLabel}>{story.name}</Text>
        </Pressable>)}
      </ScrollView>
      <View style={s.feedSwitchBar}>
        <View style={s.row}>
          <Pill label="For You" selected={feedMode==='forYou'} onPress={() => setFeedMode('forYou')}/>
          <Pill label="Following" selected={feedMode==='following'} onPress={() => setFeedMode('following')}/>
        </View>
        <View style={[s.row, { gap: 4 }]}>
          {socialFixturesEnabled ? <Text style={[s.small, { fontSize: 10 }]}>Sample feed</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Feed preferences" style={s.compactIcon} onPress={()=>setFeedPreferencesOpen(v=>!v)}>
            <Ionicons name="options-outline" size={22} color={feedPreferencesOpen?C.accent:C.ink}/>
          </Pressable>
        </View>
      </View>
      {feedPreferencesOpen ? <View style={[s.card,s.pad,{marginHorizontal:15,marginBottom:8}]}>
        <View style={s.rowBetween}><Text style={s.cardHeading}>Feed preferences</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Toggle personalised recommendations" onPress={()=>setPersonalisation(v=>!v)}>
            <Text style={{color:C.accent,fontWeight:'800'}}>{personalisation?'Personalised':'Not personalised'}</Text>
          </Pressable>
        </View>
        <View style={[s.row,{flexWrap:'wrap'}]}>{topics.map(({topic,label})=><Pill key={topic} label={label} selected={!hiddenTopics.has(topic)} onPress={()=>toggle(setHiddenTopics,topic)}/>)}</View>
      </View> : null}
      {feedMode==='following' ? <View style={[s.row,{paddingHorizontal:16,paddingBottom:8}]}>
        <Pill label="Newest" selected={followingOrder==='newest'} onPress={()=>setFollowingOrder('newest')}/>
        <Pill label="Relevant" selected={followingOrder==='relevant'} onPress={()=>setFollowingOrder('relevant')}/>
      </View> : null}
      {visiblePosts.length ? visiblePosts.map(({post,reason})=>renderPost(post,reason))
        : <PreviewEmpty icon="images-outline" heading="No posts yet" body="Posts will appear here when sharing is available."/>}
    </View>;
  }

  function renderClubs() {
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
        <PreviewEmpty icon="chatbox-outline" heading="Event chat & RSVP" body="Guest lists, approval, capacity, notifications and event discussions will become real once safe backend services are integrated." />
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
        <PreviewEmpty icon="chatbubbles-outline" heading="Club feed and channels" body="Real club posts, permissions, subscriptions and discussions will appear here after the backend is integrated. Private club content remains protected." />
      </>
    );
    return (
      <>
        <Text style={s.title}>Clubs & events</Text>
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
        {!recommendedClubs.length ? <PreviewEmpty icon="people-outline" heading="No clubs yet"
          body="Clubs will appear here when the community is ready."/> : null}
        <HeaderLine heading="Upcoming events" />
        {!recommendedEvents.length ? <Text style={s.muted}>No upcoming events.</Text> : null}
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
      category={marketFilter} onCategory={setMarketFilter}/>;
  }

  async function clearDeviceDrafts(): Promise<void> {
    // The same rider's pending saves are serialised by demoStorage.
    await clearLocalDemo(identity.riderId);
    await AsyncStorage.removeItem(accountTextDraftKey(identity.riderId));
    const empty = profileForRider(DEFAULT_PROFILE, identity.username, socialFixturesEnabled);
    setProfile(empty);
    setProfileDraft(empty);
    setGarage([]);
    setGarageDraft({ ...EMPTY_GARAGE_DRAFT });
    setPendingGarageDelete(null);
  }

  function renderProfile() {
    if (settingsOpen) return <SocialSettings username={identity.username}
      emailVerified={identity.emailVerified}
      onClose={() => setSettingsOpen(false)}
      onClearDrafts={clearDeviceDrafts}
      onSignOut={logout}/>;
    return (
      <View style={{ gap: 16 }}>
        <ProfileSummary profile={profile} accountProfile={ownProfile} tab={profileTab} username={identity.username}
          friendCount={sharedFriends.length}
          followingCount={[...followed].filter(id => Boolean(demoCreators[id])).length}
          onTab={setProfileTab} onConnections={setConnectionSheet} onEdit={openProfileEditor}
          onSettings={() => { setNotice(null); setSettingsOpen(true); }}/>
        {profileEditor ? (
          <View style={[s.card, s.pad]}>
            <Text style={s.cardHeading}>Edit your social profile</Text>
            <Text style={s.small}>Display name · 2–40 characters</Text>
            <TextInput accessibilityLabel="Social display name" style={s.input} value={profileDraft.displayName} maxLength={40} onChangeText={(displayName) => setProfileDraft((p) => ({ ...p, displayName }))} placeholder="Display name" placeholderTextColor={C.muted}/>
            <Text style={s.small}>Bio · up to 160 characters</Text>
            <TextInput accessibilityLabel="Social bio" style={[s.input, { minHeight: 85, textAlignVertical: 'top' }]} multiline maxLength={160} value={profileDraft.bio} onChangeText={(bio) => setProfileDraft((p) => ({ ...p, bio }))} placeholder="Tell your community about yourself" placeholderTextColor={C.muted}/>
            <Text style={s.small}>Changes stay on this device. Public profile visibility isn’t available yet.</Text>
            <View style={s.twoCol}>
              <Pressable accessibilityRole="button" style={[s.ghost, s.split]} onPress={() => setProfileEditor(false)}><Text style={s.ghostText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" style={[s.cta, s.split]} onPress={saveProfile}><Text style={s.ctaText}>Save profile</Text></Pressable>
            </View>
          </View>
        ) : null}
        {profileTab === 'Posts' ? <View style={{ alignItems: 'center', paddingVertical: 34, gap: 11 }}>
          <Ionicons name="images-outline" size={33} color={C.accent}/>
          <Text style={s.cardHeading}>Your posts will appear here</Text>
          <Text style={[s.small, { textAlign: 'center' }]}>Photos and videos you share will appear on your profile</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Create first post" style={s.cta}
            onPress={() => { navigate('Create'); setCreateMode('Post'); }}>
            <Text style={s.ctaText}>Create post</Text>
          </Pressable>
        </View> : null}
        {profileTab === 'Reels' ? <View style={{ alignItems: 'center', paddingVertical: 34, gap: 11 }}>
          <Ionicons name="play-circle-outline" size={33} color={C.accent}/>
          <Text style={s.cardHeading}>Your Reels will appear here</Text>
          <Text style={[s.small, { textAlign: 'center' }]}>Short videos you share will appear here</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Create first Reel" style={s.cta}
            onPress={() => { navigate('Create'); setCreateMode('Reel'); }}>
            <Text style={s.ctaText}>Create Reel</Text>
          </Pressable>
        </View> : null}
        {profileTab === 'Garage' ? <>
        <View style={s.rowBetween}>
          <HeaderLine heading="Personal garage" meta={String(garage.length) + ' / 12'} />
          <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle to garage" style={s.ghost} onPress={openGarageEditor}>
            <View style={s.row}><Ionicons name="add" size={16} color={C.accent}/><Text style={s.ghostText}>Add</Text></View>
          </Pressable>
        </View>
        <Text style={s.small}>Cars · Motorcycles · Bicycles · Private by default</Text>
        {garageEditor ? (
          <View style={[s.card, s.pad]}>
            <Text style={s.cardHeading}>Add to your garage</Text>
            <Text style={s.small}>Vehicle type</Text>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {(['Car', 'Motorcycle', 'Bicycle'] as GarageKind[]).map((kind) =>
                <Pill key={kind} label={kind} selected={garageDraft.kind === kind} onPress={() => setGarageDraft((p) => ({ ...p, kind }))}/>)}
            </View>
            <TextInput accessibilityLabel="Vehicle make" style={s.input} maxLength={50} value={garageDraft.make} onChangeText={(make) => setGarageDraft((p) => ({ ...p, make }))} placeholder="Make · e.g. Honda" placeholderTextColor={C.muted}/>
            <TextInput accessibilityLabel="Vehicle model" style={s.input} maxLength={60} value={garageDraft.model} onChangeText={(model) => setGarageDraft((p) => ({ ...p, model }))} placeholder="Model · e.g. PCX" placeholderTextColor={C.muted}/>
            <TextInput accessibilityLabel="Vehicle year" style={s.input} maxLength={4} keyboardType="numeric" value={garageDraft.year} onChangeText={(year) => setGarageDraft((p) => ({ ...p, year }))} placeholder="Year (optional)" placeholderTextColor={C.muted}/>
            <TextInput accessibilityLabel="Vehicle notes" multiline style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} maxLength={240} value={garageDraft.notes} onChangeText={(notes) => setGarageDraft((p) => ({ ...p, notes }))} placeholder="Modifications or build notes (optional)" placeholderTextColor={C.muted}/>
            <Text style={s.small}>Saved privately on this device. Public sharing isn’t available yet.</Text>
            <View style={s.twoCol}>
              <Pressable accessibilityRole="button" style={[s.ghost, s.split]} onPress={() => setGarageEditor(false)}><Text style={s.ghostText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" style={[s.cta, s.split]} onPress={saveGarage}><Text style={s.ctaText}>Save vehicle</Text></Pressable>
            </View>
          </View>
        ) : null}
        {garage.length ? garage.map((entry) => (
          <View key={entry.id} style={[s.card, s.pad]}>
            <View style={s.rowBetween}>
              <View style={s.row}>
                <View style={[s.avatar, { width: 48, height: 48 }]}>
                  <Ionicons name={entry.kind === 'Car' ? 'car-sport' : entry.kind === 'Bicycle' ? 'bicycle' : 'speedometer'} size={25} color={C.accent}/>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.cardHeading}>{entry.make} {entry.model}</Text>
                  <Text style={s.small}>{entry.kind}{entry.year ? ' · ' + String(entry.year) : ''}</Text>
                </View>
              </View>
              <View style={s.darkBadge}><Text style={s.badgeText}>{entry.visibility.toUpperCase()}</Text></View>
            </View>
            {entry.notes ? <Text style={s.muted}>{entry.notes}</Text> : null}
            <View style={s.rowBetween}>
              {socialFixturesEnabled ? <Pressable accessibilityRole="button"
                accessibilityLabel={'Toggle privacy for ' + entry.make + ' ' + entry.model}
                style={s.ghost}
                onPress={() => setGarage((items) => updateGarageVisibility(items, entry.id,
                  entry.visibility === 'private' ? 'public' : 'private'))}>
                <Text style={s.ghostText}>{entry.visibility === 'private' ? 'Make public (demo)' : 'Make private (demo)'}</Text>
              </Pressable> : <Text style={s.small}>On this device only</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={'Remove ' + entry.make + ' ' + entry.model} onPress={() => setPendingGarageDelete(entry.id)}>
                <Text style={[s.small, { color: '#F3A1A1' }]}>Remove</Text>
              </Pressable>
            </View>
            {pendingGarageDelete === entry.id ? (
              <View style={[s.card, s.pad, { backgroundColor: C.bg }]}>
                <Text style={s.body}>Remove this vehicle from this device?</Text>
                <View style={s.twoCol}>
                  <Pressable accessibilityRole="button" style={[s.ghost, s.split]} onPress={() => setPendingGarageDelete(null)}><Text style={s.ghostText}>Keep vehicle</Text></Pressable>
                  <Pressable accessibilityRole="button" style={[s.cta, s.split]} onPress={() => { setGarage((items) => removeGarageEntry(items, entry.id)); setPendingGarageDelete(null); }}><Text style={s.ctaText}>Confirm remove</Text></Pressable>
                </View>
              </View>
            ) : null}
          </View>
        )) : <PreviewEmpty icon="car-sport-outline" heading="Your garage starts here" body="Add a car, motorcycle or bicycle to preview how your builds will appear. All entries are private by default." />}
        <Text style={s.small}>Garage entries remain on this device.</Text>
        </> : null}
        <View style={{ gap: 10, paddingVertical: 13 }}>
          <Text style={s.small}>Signed in as @{identity.username.replace(/^@/, '')} with your Rider Comms account.</Text>
          {!identity.emailVerified ? <Pressable accessibilityRole="button"
            accessibilityLabel="Resend verification email"
            onPress={() => { void resendVerification().then(
              () => setVerificationNotice('Verification email requested. Check your inbox.'),
              () => setVerificationNotice('Could not resend verification. Please try again later.'),
            ); }} style={s.ghost}>
            <Text style={s.ghostText}>Resend verification email</Text>
          </Pressable> : null}
          {verificationNotice ? <Text accessibilityRole="alert" style={s.small}>{verificationNotice}</Text> : null}
          <Text style={s.small}>Profile and garage drafts stay on this device. Open Settings & privacy to manage drafts or sign out.</Text>
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

  const story = demoStories.find((item) => item.id === selectedStory);

  return (
    <SafeAreaView nativeID="social-screen"
      edges={Platform.OS === 'web' ? [] : screen === 'Reels' && !story ? ['left', 'right'] : ['top', 'left', 'right']}
      style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        {!story && screen !== 'Reels' && screen !== 'Create' ? <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go to home" onPress={() => navigate('Home')}>
            <Text style={s.brandTitle}>Social<Text style={{ color: C.accent }}>.</Text></Text>
          </Pressable>
          <View style={s.headerTools}>
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
          <StoriesViewer stories={demoStories} initialId={story.id} onClose={() => setSelectedStory(null)} />
        ) : (
          <>
            {pageScrollEnabled ? (
              <ScrollView nativeID="social-page-scroll" style={s.scroll}
                contentContainerStyle={screen === 'Home' ? { paddingBottom: 24 } : s.content}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                overScrollMode="never" bounces={false}
                key={screen === 'Home' ? 'Home-' + (selectedCreator ?? 'feed') :
                  screen === 'Profile' ? 'Profile-' + (settingsOpen ? 'settings' : profileTab) : screen}>
                {screen === 'Home' ? renderHome() : null}
                {screen === 'Clubs' ? renderClubs() : null}
                {screen === 'Shop' ? renderShop() : null}
                {screen === 'Profile' ? renderProfile() : null}
              </ScrollView>
            ) : screen === 'Create' ? (
              <CreateRecoveryBoundary key={createMode} onClose={() => navigate('Home')}>
                <CreateComposer initialMode={createMode} riderId={identity.riderId} onClose={() => navigate('Home')} />
              </CreateRecoveryBoundary>
            ) : screen === 'Reels' ? (
              <View testID="fixed-reels-screen" style={{ flex: 1, minHeight: 0, width: '100%', backgroundColor: '#020406' }}>
                <ReelsScreen items={reelPreviews} followedAuthors={followed}
                  onToggleFollow={toggleFollow}
                  onOpenComments={(id, title) => openComments('reel:' + id, title)}
                  onOpenCreator={openCreator}
                  onCreateReel={() => { navigate('Create'); setCreateMode('Reel'); }} />
              </View>
            ) : (
              <View testID="fixed-messages-screen" style={[s.content,{flex:1,minHeight:0}]}>
                {renderMessages()}
              </View>
            )}
            {screen !== 'Create' ? <BottomTabs screen={screen} onNavigate={navigate} /> : null}
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

export default function App(): React.JSX.Element {
  return <SafeAreaProvider>
    <SocialAuthGate>
      <AuthenticatedSocialApp/>
    </SocialAuthGate>
  </SafeAreaProvider>;
}
