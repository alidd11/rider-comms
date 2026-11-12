import '@expo/metro-runtime';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, ImageBackground, Platform, ScrollView, StatusBar, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, s } from './src/styles';
import { rankForYou, rankFollowing, rankReels, rankClubs, rankEvents, rankMarketplace, explainReason, noViewer } from './src/recommendations';
import type { Content, Viewer, Topic, RankReason } from './src/recommendations';
import type { FeedMode, FollowingOrder, SocialPost } from './src/domain';
import { demoClubs, demoEvents, demoListings, demoPosts, demoStories, followingIds } from './src/sampleData';
import { DEFAULT_PROFILE, EMPTY_GARAGE_DRAFT, addGarageEntry, createGarageEntry, removeGarageEntry, updateGarageVisibility, validateProfile } from './src/garage';
import type { GarageDraft, GarageEntry, GarageKind, SocialProfileDraft } from './src/garage';
import { loadLocalDemo, saveLocalDemo } from './src/demoStorage';

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

const reels = [
  { id: 'r1', headline: 'The weekend edit', creator: '@nina', theme: '#66433D', icon: 'car-sport' as const, imageUrl: 'https://images.unsplash.com/photo-1625932197913-68755c94c51f?auto=format&fit=crop&w=1100&q=82' },
  { id: 'r2', headline: 'A road worth sharing', creator: '@alex', theme: '#1B5A63', icon: 'speedometer' as const, imageUrl: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1100&q=82' },
  { id: 'r3', headline: 'Ride together', creator: '@jules', theme: '#3B664A', icon: 'bicycle' as const, imageUrl: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1100&q=82' },
];

const reelCandidates: Content[] = reels.map((reel, index) => ({
  id: reel.id, authorId: reel.creator, privacy: 'public', authorPermitsDiscovery: true,
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

export default function App(): React.JSX.Element {
  const { width: screenWidth } = useWindowDimensions();
  const mediaHeight = Math.min(490, Math.max(330, Math.round(screenWidth * 0.94)));
  const [screen, setScreen] = useState<Screen>('Home');
  const [feedMode, setFeedMode] = useState<FeedMode>('forYou');
  const [feedPreferencesOpen, setFeedPreferencesOpen] = useState(false);
  const [activePostMenu, setActivePostMenu] = useState<string | null>(null);
  const [expandedCaptionId, setExpandedCaptionId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<'Post' | 'Story' | 'Reel'>('Post');
  const [draftPreview, setDraftPreview] = useState(false);
  const [personalisation, setPersonalisation] = useState(true);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenTopics, setHiddenTopics] = useState<Set<Topic>>(() => new Set());
  const [followingOrder, setFollowingOrder] = useState<FollowingOrder>('newest');
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [joined, setJoined] = useState<Set<string>>(() => new Set());
  const [going, setGoing] = useState<Set<string>>(() => new Set());
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [profile, setProfile] = useState<SocialProfileDraft>(DEFAULT_PROFILE);
  const [garage, setGarage] = useState<GarageEntry[]>([]);
  const [localReady, setLocalReady] = useState(false);
  const [profileEditor, setProfileEditor] = useState(false);
  const [profileDraft, setProfileDraft] = useState<SocialProfileDraft>(DEFAULT_PROFILE);
  const [garageEditor, setGarageEditor] = useState(false);
  const [garageDraft, setGarageDraft] = useState<GarageDraft>({ ...EMPTY_GARAGE_DRAFT });
  const [pendingGarageDelete, setPendingGarageDelete] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [reelIndex, setReelIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Preview-only, per-device data. Shared Rider Comms accounts and DMs are untouched.
  useEffect(() => {
    let mounted = true;
    void loadLocalDemo().then((saved) => {
      if (!mounted) return;
      setProfile(saved.profile);
      setGarage(saved.garage);
      setLocalReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!localReady) return;
    void saveLocalDemo({ profile, garage }).catch(() => {
      // Storage failures must not prevent the user from exploring the preview.
      // The UI always identifies saved entries as local device-only data.
    });
  }, [localReady, profile, garage]);

  const viewer = useMemo<Viewer>(() => ({
    ...noViewer, userId: 'demo-viewer', ageFloor: 18, followedAuthors: followingIds,
    interests: { cars: 0.8, motorcycles: 0.9, cycling: 0.7 },
    hiddenContentIds: hiddenPostIds, hiddenTopics,
    selectedRegion: 'London', personalisationEnabled: personalisation,
  }), [hiddenPostIds, hiddenTopics, personalisation]);

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
    setNotice(null);
    setSelectedClub(null);
    setSelectedEvent(null);
    setSelectedStory(null);
    setProfileEditor(false);
    setGarageEditor(false);
    setPendingGarageDelete(null);
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
        <View style={s.row}>
          <View style={[s.avatar, { backgroundColor: post.accent }]}><Text style={s.avatarText}>{post.author.split(' ').map(v=>v[0]).join('')}</Text></View>
          <View><Text style={s.cardHeading}>{post.author}</Text><Text style={s.small}>{post.handle} · {post.category.toLowerCase()}</Text></View>
        </View>
        <IconButton name="ellipsis-horizontal" label={'Post options for ' + post.author} onPress={() => setActivePostMenu(id => id === post.id ? null : post.id)}/>
      </View>
      {activePostMenu === post.id ? <View style={s.feedOptions}>
        <Pressable accessibilityRole="button" accessibilityLabel={'Why seeing post by ' + post.author} onPress={() => { setActivePostMenu(null); banner(explainReason(reason) + ' · Sample recommendation'); }}>
          <View style={s.row}><Ionicons name="information-circle-outline" color={C.accent} size={20}/><Text style={s.ghostText}>Why this post?</Text></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={'Not interested in post by ' + post.author} onPress={() => { setActivePostMenu(null); toggle(setHiddenPostIds, post.id); }}>
          <View style={s.row}><Ionicons name="eye-off-outline" color={C.muted} size={20}/><Text style={s.ghostText}>Not interested</Text></View>
        </Pressable>
      </View> : null}
      <ImageBackground testID={'post-media-' + post.id} source={{uri:post.imageUrl}} resizeMode="cover" accessibilityLabel={post.imageAlt}
        style={[s.feedMedia, { height:mediaHeight, backgroundColor:post.accent }]}>
        <View style={s.feedMediaTag}><Text style={s.feedMediaTagText}>{post.category}</Text></View>
      </ImageBackground>
      <View style={s.feedActions}>
        <View style={[s.row,{gap:20}]}>
          <Pressable accessibilityRole="button" accessibilityLabel={liked.has(post.id) ? 'Unlike post' : 'Like post'} onPress={() => toggle(setLiked, post.id)}>
            <Ionicons name={liked.has(post.id)?'heart':'heart-outline'} color={liked.has(post.id)?'#F18E99':C.ink} size={27}/>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open comments" onPress={() => banner('Comments are not live yet.')}><Ionicons name="chatbubble-outline" color={C.ink} size={25}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share post" onPress={() => banner('Sharing is not live yet.')}><Ionicons name="paper-plane-outline" color={C.ink} size={25}/></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={saved.has(post.id)?'Unsave post':'Save post'} onPress={() => toggle(setSaved,post.id)}>
          <Ionicons name={saved.has(post.id)?'bookmark':'bookmark-outline'} color={saved.has(post.id)?C.accent:C.ink} size={25}/>
        </Pressable>
      </View>
      <View style={s.feedCaption}>
        <Text style={[s.body,{fontWeight:'800'}]}>{post.heading}</Text>
        <Text style={s.muted} numberOfLines={expandedCaptionId === post.id ? undefined : 1}>{post.body}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={expandedCaptionId===post.id?'Show less caption':'Read full caption'}
          onPress={() => setExpandedCaptionId(id => id===post.id ? null : post.id)}>
          <Text style={[s.small,{color:C.accent}]}>{expandedCaptionId===post.id?'Less':'More'}</Text>
        </Pressable>
      </View>
    </View>;
  }

  function renderHome() {
    return <>
      <View style={s.feedSwitchBar}>
        <View style={s.row}>
          <Pill label="For You" selected={feedMode==='forYou'} onPress={() => setFeedMode('forYou')}/>
          <Pill label="Following" selected={feedMode==='following'} onPress={() => setFeedMode('following')}/>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Feed preferences" style={s.compactIcon} onPress={()=>setFeedPreferencesOpen(v=>!v)}>
          <Ionicons name="options-outline" size={22} color={feedPreferencesOpen?C.accent:C.ink}/>
        </Pressable>
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
      {visiblePosts.length ? visiblePosts.map(({post,reason})=>renderPost(post,reason))
        : <PreviewEmpty icon="sparkles-outline" heading="Nothing to show" body="Change your interests to see more."/>}
    </>;
  }

  function renderReels() {
    const reelRank=recommendedReels[reelIndex];
    const reel=reels.find(r=>r.id===reelRank?.item.id) ?? reels[0];
    return <>
      <View style={s.rowBetween}><Text style={s.sectionTitle}>Reels</Text><Text style={[s.small,{color:C.accent}]}>Preview</Text></View>
      <ImageBackground source={{uri:reel.imageUrl}} resizeMode="cover" style={[s.reel,{height:mediaHeight+75,backgroundColor:reel.theme}]}>
        <View style={s.reelTop}><Text style={s.feedMediaTagText}>SAMPLE</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Play sample Reel" onPress={()=>banner('Video playback is not connected yet.')} style={s.reelPlay}>
          <Ionicons name="play" color={C.ink} size={32}/>
        </Pressable>
        <View style={s.reelCaption}><Text style={[s.mediaTitle,{fontSize:24,textAlign:'left'}]}>{reel.headline}</Text>
          <Text style={[s.body,{color:C.ink}]}>{reel.creator}</Text></View>
      </ImageBackground>
      <View style={s.rowBetween}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous reel" disabled={reelIndex===0}
          style={[s.ghost,reelIndex===0&&{opacity:0.4}]} onPress={()=>setReelIndex(n=>Math.max(0,n-1))}><Text style={s.ghostText}>Previous</Text></Pressable>
        <Text style={s.small}>{Math.min(reelIndex+1,recommendedReels.length)} / {recommendedReels.length}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next reel" disabled={reelIndex>=recommendedReels.length-1}
          style={[s.ghost,reelIndex>=recommendedReels.length-1&&{opacity:0.4}]} onPress={()=>setReelIndex(n=>Math.min(recommendedReels.length-1,n+1))}><Text style={s.ghostText}>Next</Text></Pressable>
      </View>
    </>;
  }

  function renderCreate() {
    return <>
      <View style={s.rowBetween}><Text style={s.title}>Create</Text><Text style={[s.small,{color:C.accent}]}>Private draft</Text></View>
      <View style={s.row}>{(['Post','Story','Reel'] as const).map(kind=><Pill key={kind} label={kind} selected={createMode===kind} onPress={()=>{setCreateMode(kind);setDraftPreview(false);}}/>)}</View>
      <View style={[s.card,s.pad]}>
        <TextInput multiline value={draft} onChangeText={v=>{setDraft(v);setDraftPreview(false);}}
          placeholder="What's happening?" placeholderTextColor={C.muted} style={[s.input,{minHeight:125,textAlignVertical:'top'}]} accessibilityLabel="Post draft"/>
        <View style={s.rowBetween}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add media to draft" onPress={()=>banner('Media uploads will be added with the publishing service.')}>
            <View style={s.row}><Ionicons name="image-outline" size={22} color={C.accent}/><Text style={s.ghostText}>Media</Text></View>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!draft.trim()} onPress={()=>setDraftPreview(true)}
            style={[s.cta,!draft.trim()&&{opacity:0.5}]}><Text style={s.ctaText}>Preview {createMode.toLowerCase()}</Text></Pressable>
        </View>
      </View>
      {draftPreview ? <View style={[s.card,s.pad]}><Text style={s.small}>PRIVATE {createMode.toUpperCase()}</Text><Text style={s.body}>{draft}</Text></View> : null}
    </>;
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
          <Text style={s.small}>{club.privacy} community · demo membership state</Text>
          <Pressable accessibilityRole="button" style={s.cta} onPress={() => toggle(setJoined, club.id)}><Text style={s.ctaText}>{joined.has(club.id) ? 'Leave demo club' : 'Join demo club'}</Text></Pressable>
        </View>
        <PreviewEmpty icon="chatbubbles-outline" heading="Club feed and channels" body="Real club posts, permissions, subscriptions and discussions will appear here after the backend is integrated. Private club content remains protected." />
      </>
    );
    return (
      <>
        <Text style={s.title}>Clubs & events</Text>
        <HeaderLine heading="Explore clubs" />
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
              <View style={s.darkBadge}><Text style={s.badgeText}>{item.privacy.toUpperCase()}</Text></View>
              <Pressable accessibilityRole="button" style={s.ghost} onPress={() => setSelectedClub(item.id)}><Text style={s.ghostText}>View club</Text></Pressable>
            </View>
          </View>
        ))}
        <HeaderLine heading="Upcoming events" />
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
    return (
      <>
        <View style={s.rowBetween}>
          <Text style={s.title}>Marketplace</Text>
          <View style={s.row}><Ionicons name="shield-checkmark" color={C.accent} size={17} /><Text style={[s.small,{color:C.accent}]}>Verified only</Text></View>
        </View>
        <Text style={s.small}>Sample listings · checkout unavailable</Text>
        <TextInput value={search} onChangeText={setSearch} style={s.input} placeholderTextColor={C.muted} placeholder="Search example listings or businesses" accessibilityLabel="Search marketplace" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
          {['All', 'Accessories', 'Vehicles', 'Rentals'].map((option) => <Pill key={option} label={option} selected={marketFilter === option} onPress={() => setMarketFilter(option)} />)}
        </ScrollView>
        <HeaderLine heading="Discover" meta={String(filteredListings.length) + ' listings'} />
        {filteredListings.length ? filteredListings.map((item) => (
          <Pressable key={item.id} style={[s.card, { flexDirection:'row', minHeight:112 }]} accessibilityRole="button"
            accessibilityLabel={'View listing ' + item.name}
            onPress={() => banner('This is a preview listing. Purchases are not yet available.')}>
            <View style={{ width:105, backgroundColor:item.accent, alignItems:'center', justifyContent:'center' }}>
              <Ionicons name={item.icon} color="#E3F7F2" size={38}/>
            </View>
            <View style={[s.pad,{ flex:1, gap:5 }]}>
              <Text style={s.cardHeading}>{item.name}</Text>
              <Text style={s.small}>{item.merchant} · {item.category}</Text>
              <View style={s.rowBetween}><Text style={[s.cardHeading,{color:C.accent}]}>{item.price}</Text>
                <Ionicons name="chevron-forward" color={C.muted} size={18}/>
              </View>
            </View>
          </Pressable>
        )) : <PreviewEmpty icon="search-outline" heading="No matching listings" body="Try a different term or marketplace category." />}
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <View style={s.rowBetween}><Text style={s.title}>Profile</Text><Text style={[s.small,{color:C.accent}]}>Device preview</Text></View>
        <View style={[s.card, s.pad]}>
          <View style={s.rowBetween}>
            <View style={[s.row, { flex: 1 }]}>
              <View style={[s.avatar, { width: 60, height: 60, borderRadius: 19 }]}><Ionicons name="person-outline" color={C.ink} size={30} /></View>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={s.cardHeading}>{profile.displayName}</Text>
                <Text style={s.small}>{profile.visibility === 'private' ? 'Private social profile' : 'Public social profile (preview)'}</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit social profile" style={s.ghost} onPress={openProfileEditor}>
              <Text style={s.ghostText}>Edit</Text>
            </Pressable>
          </View>
          <Text style={s.body}>{profile.bio}</Text>
          <View style={s.row}><Ionicons name="lock-closed-outline" size={16} color={C.accent} /><Text style={s.small}>Saved on this device</Text></View>
        </View>
        {profileEditor ? (
          <View style={[s.card, s.pad]}>
            <Text style={s.cardHeading}>Edit your social profile</Text>
            <Text style={s.small}>Display name · 2–40 characters</Text>
            <TextInput accessibilityLabel="Social display name" style={s.input} value={profileDraft.displayName} maxLength={40} onChangeText={(displayName) => setProfileDraft((p) => ({ ...p, displayName }))} placeholder="Display name" placeholderTextColor={C.muted}/>
            <Text style={s.small}>Bio · up to 160 characters</Text>
            <TextInput accessibilityLabel="Social bio" style={[s.input, { minHeight: 85, textAlignVertical: 'top' }]} multiline maxLength={160} value={profileDraft.bio} onChangeText={(bio) => setProfileDraft((p) => ({ ...p, bio }))} placeholder="Tell your community about yourself" placeholderTextColor={C.muted}/>
            <Text style={s.small}>Profile visibility (preview only)</Text>
            <View style={s.row}>
              <Pill label="Private profile" selected={profileDraft.visibility === 'private'} onPress={() => setProfileDraft((p) => ({ ...p, visibility: 'private' }))}/>
              <Pill label="Public profile" selected={profileDraft.visibility === 'public'} onPress={() => setProfileDraft((p) => ({ ...p, visibility: 'public' }))}/>
            </View>
            <View style={s.twoCol}>
              <Pressable accessibilityRole="button" style={[s.ghost, s.split]} onPress={() => setProfileEditor(false)}><Text style={s.ghostText}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" style={[s.cta, s.split]} onPress={saveProfile}><Text style={s.ctaText}>Save profile</Text></Pressable>
            </View>
          </View>
        ) : null}
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
            <Text style={s.small}>Vehicle visibility</Text>
            <View style={s.row}>
              <Pill label="Private vehicle" selected={garageDraft.visibility === 'private'} onPress={() => setGarageDraft((p) => ({ ...p, visibility: 'private' }))}/>
              <Pill label="Public vehicle" selected={garageDraft.visibility === 'public'} onPress={() => setGarageDraft((p) => ({ ...p, visibility: 'public' }))}/>
            </View>
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
              <Pressable accessibilityRole="button" accessibilityLabel={'Toggle privacy for ' + entry.make + ' ' + entry.model} style={s.ghost} onPress={() => setGarage((items) => updateGarageVisibility(items, entry.id, entry.visibility === 'private' ? 'public' : 'private'))}>
                <Text style={s.ghostText}>{entry.visibility === 'private' ? 'Make public (demo)' : 'Make private (demo)'}</Text>
              </Pressable>
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
        <Text style={s.small}>Preview data stays on this device. Clearing site data removes it.</Text>
      </>
    );
  }

  function renderMessages() {
    return (
      <>
        <Text style={s.title}>Messages</Text>
        <PreviewEmpty icon="chatbox-ellipses-outline" heading="No conversations yet" body="Messages will sync with Rider Comms after account integration." />
        <Pressable accessibilityRole="button" style={s.ghost} onPress={() => navigate('Home')}><Text style={s.ghostText}>Back to feed</Text></Pressable>
      </>
    );
  }

  const story = demoStories.find((item) => item.id === selectedStory);

  return (
    <SafeAreaProvider>
    <SafeAreaView nativeID="social-screen" edges={Platform.OS === 'web' ? [] : ['top', 'left', 'right']} style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go to home" style={{ gap: 2 }} onPress={() => navigate('Home')}>
            <Text style={[s.brandTitle, {fontSize:25}]}>Social<Text style={{ color: C.accent }}>.</Text></Text>
            <Text style={[s.wordmark, {fontSize:8,letterSpacing:1.2}]}>EARLY PREVIEW</Text>
          </Pressable>
          <View style={s.headerTools}>
            <IconButton name="chatbubble-ellipses-outline" label="Open messages" onPress={() => navigate('Messages')} />
            <IconButton name="person-circle-outline" label="Open profile" onPress={() => navigate('Profile')} />
          </View>
        </View>
        {notice ? (
          <Pressable style={s.notice} accessibilityRole="button" accessibilityLabel="Dismiss notice" onPress={() => setNotice(null)}>
            <View style={s.rowBetween}><Text style={[s.body, { color: '#C4FFEC', flex: 1 }]}>{notice}</Text><Ionicons name="close" size={17} color={C.accent} /></View>
          </Pressable>
        ) : null}
        {story ? (
          <View style={{ flex: 1, padding: 20, gap: 16 }}>
            <View style={s.rowBetween}><Text style={s.sectionTitle}>{story.name}'s Story</Text><IconButton name="close" label="Close story" onPress={() => setSelectedStory(null)} /></View>
            <View style={[s.reel, { flex: 1, backgroundColor: story.color }]}>
              <Ionicons name="images-outline" size={74} color={C.ink} />
              <Text style={s.mediaTitle}>{story.category} story preview</Text>
              <Text style={[s.body, { textAlign: 'center' }]}>Real Stories will expire after 24 hours and respect viewer permissions.</Text>
            </View>
          </View>
        ) : (
          <>
            <ScrollView style={s.scroll} contentContainerStyle={screen === 'Home' ? { paddingBottom: 24 } : s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} key={screen}>
              {screen === 'Home' ? renderHome() : null}
              {screen === 'Reels' ? renderReels() : null}
              {screen === 'Create' ? renderCreate() : null}
              {screen === 'Clubs' ? renderClubs() : null}
              {screen === 'Shop' ? renderShop() : null}
              {screen === 'Profile' ? renderProfile() : null}
              {screen === 'Messages' ? renderMessages() : null}
            </ScrollView>
            <BottomTabs screen={screen} onNavigate={navigate} />
          </>
        )}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}
