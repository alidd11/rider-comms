import '@expo/metro-runtime';
import React, { useMemo, useState } from 'react';
import { ScrollView, StatusBar, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { C, s } from './src/styles';
import { rankForYou, rankFollowing, rankReels, rankClubs, rankEvents, rankMarketplace, explainReason, noViewer } from './src/recommendations';
import type { Content, Viewer, Topic, RankReason } from './src/recommendations';
import type { FeedMode, FollowingOrder, SocialPost } from './src/domain';
import { demoClubs, demoEvents, demoListings, demoPosts, demoStories, followingIds } from './src/sampleData';

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
  { id: 'r1', headline: 'The weekend edit', creator: '@nina', theme: '#66433D', icon: 'car-sport' as const },
  { id: 'r2', headline: 'A road worth sharing', creator: '@alex', theme: '#1B5A63', icon: 'speedometer' as const },
  { id: 'r3', headline: 'Ride together', creator: '@jules', theme: '#3B664A', icon: 'bicycle' as const },
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

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('Home');
  const [feedMode, setFeedMode] = useState<FeedMode>('forYou');
  const [personalisation, setPersonalisation] = useState(true);
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(() => new Set());
  const [hiddenTopics, setHiddenTopics] = useState<Set<Topic>>(() => new Set());
  const [followingOrder, setFollowingOrder] = useState<FollowingOrder>('newest');
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [joined, setJoined] = useState<Set<string>>(() => new Set());
  const [going, setGoing] = useState<Set<string>>(() => new Set());
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<string | null>(null);
  const [reelIndex, setReelIndex] = useState(0);
  const [marketFilter, setMarketFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

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
    setSelectedStory(null);
  }

  function banner(message: string) {
    setNotice(message);
  }

  function renderPost(post: SocialPost, reason: RankReason) {
    return (
      <View key={post.id} style={s.card}>
        <View style={s.pad}>
          <View style={s.rowBetween}>
            <View style={s.row}>
              <View style={s.avatar}><Text style={s.avatarText}>{post.author.split(' ').map((v) => v[0]).join('')}</Text></View>
              <View>
                <Text style={s.cardHeading}>{post.author}</Text>
                <Text style={s.small}>{post.handle} · {post.category.toLowerCase()}</Text>
              </View>
            </View>
            <IconButton name="ellipsis-horizontal" label="Post options" onPress={() => banner('Demo preview: moderation and post options are not connected yet.')} />
          </View>
        </View>
        <View style={[s.media, { backgroundColor: post.accent }]}>
          <Ionicons name={post.icon} color="#C5F0E5" size={58} />
          <Text style={s.mediaCategory}>{post.category}</Text>
          <Text style={s.mediaTitle}>{post.heading}</Text>
          <Text style={[s.small, { color: '#D3E7E9' }]}>Visual placeholder · media integration pending</Text>
        </View>
        <View style={s.pad}>
          <View style={s.rowBetween}>
            <View style={s.actions}>
              <Pressable onPress={() => toggle(setLiked, post.id)} accessibilityRole="button" accessibilityLabel={liked.has(post.id) ? 'Unlike post' : 'Like post'} style={s.row}>
                <Ionicons name={liked.has(post.id) ? 'heart' : 'heart-outline'} color={liked.has(post.id) ? '#FF8192' : C.ink} size={21} />
                <Text style={s.actionText}>{liked.has(post.id) ? 'Liked' : 'Like'}</Text>
              </Pressable>
              <Pressable onPress={() => banner('Comment threads are planned; not connected to a server.')} accessibilityRole="button" accessibilityLabel="Open comments" style={s.row}>
                <Ionicons name="chatbubble-outline" color={C.ink} size={20} /><Text style={s.actionText}>Discuss</Text>
              </Pressable>
              <Pressable onPress={() => banner('Post sharing is not connected in this prototype.')} accessibilityRole="button" accessibilityLabel="Share post">
                <Ionicons name="paper-plane-outline" color={C.ink} size={20} />
              </Pressable>
            </View>
            <Pressable onPress={() => toggle(setSaved, post.id)} accessibilityRole="button" accessibilityLabel={saved.has(post.id) ? 'Unsave post' : 'Save post'}>
              <Ionicons name={saved.has(post.id) ? 'bookmark' : 'bookmark-outline'} color={saved.has(post.id) ? C.accent : C.ink} size={21} />
            </Pressable>
          </View>
          <Text style={s.body}>{post.body}</Text>
          <View style={s.rowBetween}>
            <Pressable accessibilityRole="button" accessibilityLabel={'Why seeing post by ' + post.author} onPress={() => banner(explainReason(reason) + ' · Demo recommendation, no personal data collected.')}>
              <Text style={[s.small, { color: C.accent }]}>Why am I seeing this?</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={'Not interested in post by ' + post.author} onPress={() => toggle(setHiddenPostIds, post.id)}>
              <Text style={s.small}>Not interested</Text>
            </Pressable>
          </View>
          <Text style={s.small}>Example content · not published by real users</Text>
        </View>
      </View>
    );
  }

  function renderHome() {
    return (
      <>
        <View style={{ gap: 6 }}>
          <Text style={s.eyebrow}>THE COMMUNITY STARTS HERE</Text>
          <Text style={s.title}>Your world, in motion.</Text>
          <Text style={s.muted}>Cars, motorcycles, cycling and the people behind them.</Text>
        </View>
        <View style={s.rowBetween}>
          <Text style={s.sectionTitle}>Stories</Text>
          <Text style={s.small}>24-hour format · demo</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 17 }}>
          {demoStories.map((story) => (
            <Pressable key={story.id} accessibilityRole="button" accessibilityLabel={'View story by ' + story.name} onPress={() => setSelectedStory(story.id)} style={{ gap: 7, alignItems: 'center' }}>
              <View style={s.storyCircle}><View style={[s.avatar, { backgroundColor: story.color }]}><Text style={s.avatarText}>{story.initials}</Text></View></View>
              <Text style={s.small}>{story.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={s.rowBetween}>
          <View style={s.row}>
            <Pill label="For You" selected={feedMode === 'forYou'} onPress={() => setFeedMode('forYou')} />
            <Pill label="Following" selected={feedMode === 'following'} onPress={() => setFeedMode('following')} />
          </View>
          <Ionicons name="options-outline" color={C.muted} size={20} />
        </View>
        {feedMode === 'following' ? (
          <View style={s.row}>
            <Text style={s.small}>Sort:</Text>
            <Pill label="Newest" selected={followingOrder === 'newest'} onPress={() => setFollowingOrder('newest')} />
            <Pill label="Relevant" selected={followingOrder === 'relevant'} onPress={() => setFollowingOrder('relevant')} />
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          <View style={s.rowBetween}>
            <Text style={s.small}>YOUR INTERESTS · DEMO</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Toggle personalised recommendations" onPress={() => setPersonalisation((p) => !p)}>
              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800' }}>{personalisation ? 'Personalisation on' : 'Personalisation off'}</Text>
            </Pressable>
          </View>
          <View style={s.row}>
            {topics.map(({topic, label}) => <Pill key={topic} label={label} selected={!hiddenTopics.has(topic)} onPress={() => toggle(setHiddenTopics, topic)} />)}
          </View>
        </View>
        {visiblePosts.length
          ? visiblePosts.map(({post, reason}) => renderPost(post, reason))
          : <PreviewEmpty icon="sparkles-outline" heading="No posts match these preferences" body="Try re-enabling an interest or changing your feed." />}
      </>
    );
  }

  function renderReels() {
    const reelRank = recommendedReels[reelIndex];
    const reel = reels.find((r) => r.id === reelRank?.item.id) ?? reels[0];
    return (
      <>
        <HeaderLine heading="Reels" meta="Full-screen video concept" />
        <View style={[s.reel, { backgroundColor: reel.theme }]}>
          <View style={[s.row, { alignSelf: 'flex-start' }]}>
            <Ionicons name="radio-button-on" color="#F6E7E4" size={10} />
            <Text style={[s.mediaCategory, { letterSpacing: 1.2 }]}>REEL PREVIEW</Text>
          </View>
          <Ionicons name={reel.icon} color="#D6F4EF" size={90} />
          <Text style={[s.mediaTitle, { fontSize: 29 }]}>{reel.headline}</Text>
          <Text style={[s.body, { textAlign: 'center', color: '#DDEAE8' }]}>{reel.creator}</Text>
          <Text style={[s.small, { color: '#DDEAE8' }]}>{reelRank ? explainReason(reelRank.reason) : 'No eligible Reel'}</Text>
          <Text style={[s.small, { color: '#DDEAE8', textAlign: 'center' }]}>Video playback and uploads will be implemented with licensed, moderated media infrastructure.</Text>
        </View>
        <View style={s.rowBetween}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous reel" disabled={reelIndex === 0} style={[s.ghost, reelIndex === 0 && { opacity: 0.4 }]} onPress={() => setReelIndex((n) => Math.max(0, n - 1))}><Text style={s.ghostText}>Previous</Text></Pressable>
          <Text style={s.small}>{Math.min(reelIndex + 1, recommendedReels.length)} / {recommendedReels.length}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next reel" disabled={reelIndex >= recommendedReels.length - 1} style={[s.ghost, reelIndex >= recommendedReels.length - 1 && { opacity: 0.4 }]} onPress={() => setReelIndex((n) => Math.min(recommendedReels.length - 1, n + 1))}><Text style={s.ghostText}>Next</Text></Pressable>
        </View>
      </>
    );
  }

  function renderCreate() {
    return (
      <>
        <Text style={s.eyebrow}>CREATE</Text>
        <Text style={s.title}>Tell your story.</Text>
        <Text style={s.muted}>Posts, Reels, Stories and livestreams will share a permission-aware media pipeline. This screen is a local-only draft demonstration.</Text>
        <View style={[s.card, s.pad]}>
          <Text style={s.cardHeading}>Draft a post</Text>
          <TextInput multiline value={draft} onChangeText={setDraft} placeholder="What's happening in your community?" placeholderTextColor={C.muted} style={[s.input, { minHeight: 115, textAlignVertical: 'top' }]} accessibilityLabel="Post draft" />
          <View style={s.row}>
            <Ionicons name="image-outline" color={C.muted} size={20} />
            <Ionicons name="videocam-outline" color={C.muted} size={20} />
            <Ionicons name="calendar-outline" color={C.muted} size={20} />
            <Text style={s.small}>Media attachments planned</Text>
          </View>
          <Pressable style={[s.cta, !draft.trim() && { opacity: 0.5 }]} accessibilityRole="button" disabled={!draft.trim()} onPress={() => banner('Local preview only. Posting requires authentication, moderation and storage integration.')}>
            <Text style={s.ctaText}>Preview draft</Text>
          </Pressable>
        </View>
        <PreviewEmpty icon="shield-checkmark-outline" heading="Built for safer sharing" body="Publishing, creator eligibility, reporting and age-aware privacy will be verified before enabling uploads." />
      </>
    );
  }

  function renderClubs() {
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
        <Text style={s.eyebrow}>FIND YOUR PEOPLE</Text>
        <Text style={s.title}>Clubs & events</Text>
        <Text style={s.muted}>Car culture, two wheels and the communities worth joining.</Text>
        <HeaderLine heading="Explore clubs" meta="Example communities" />
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
        <HeaderLine heading="Upcoming events" meta="Example dates" />
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
            <Pressable accessibilityRole="button" style={s.ghost} onPress={() => toggle(setGoing, event.id)}><Text style={s.ghostText}>{going.has(event.id) ? 'Interested (demo)' : 'Interested · preview'}</Text></Pressable>
          </View>
        ))}
      </>
    );
  }

  function renderShop() {
    return (
      <>
        <Text style={s.eyebrow}>VERIFIED BUSINESSES ONLY</Text>
        <Text style={s.title}>Marketplace</Text>
        <Text style={s.muted}>Explore accessories, vehicles and rentals. Only approved merchants will be allowed to transact.</Text>
        <View style={[s.card, s.pad, { backgroundColor: C.accentDark }]}>
          <View style={s.row}><Ionicons name="shield-checkmark" color={C.accent} size={22} /><Text style={s.cardHeading}>Merchant-first trust</Text></View>
          <Text style={s.muted}>Private sellers are not permitted. All listings below are fictional examples; checkout, reservations and payments are disabled.</Text>
        </View>
        <TextInput value={search} onChangeText={setSearch} style={s.input} placeholderTextColor={C.muted} placeholder="Search example listings or businesses" accessibilityLabel="Search marketplace" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
          {['All', 'Accessories', 'Vehicles', 'Rentals'].map((option) => <Pill key={option} label={option} selected={marketFilter === option} onPress={() => setMarketFilter(option)} />)}
        </ScrollView>
        <HeaderLine heading="Discover" meta={String(filteredListings.length) + ' demo listings'} />
        {filteredListings.length ? filteredListings.map((item) => (
          <View key={item.id} style={s.card}>
            <View style={[s.media, { backgroundColor: item.accent, height: 155 }]}>
              <Ionicons name={item.icon} color="#E3F7F2" size={49} />
              <Text style={s.mediaCategory}>{item.category.toUpperCase()}</Text>
            </View>
            <View style={s.pad}>
              <Text style={s.cardHeading}>{item.name}</Text>
              <View style={s.row}><Ionicons name="checkmark-circle" color={C.accent} size={16} /><Text style={s.small}>{item.merchant} · Demo merchant</Text></View>
              <View style={s.rowBetween}><Text style={[s.cardHeading, { color: C.accent }]}>{item.price}</Text><Pressable style={s.ghost} accessibilityRole="button" onPress={() => banner('Demo listing only. Commerce requires merchant verification, consumer protections and payment integration.')}><Text style={s.ghostText}>View details</Text></Pressable></View>
            </View>
          </View>
        )) : <PreviewEmpty icon="search-outline" heading="No matching listings" body="Try a different term or marketplace category." />}
      </>
    );
  }

  function renderProfile() {
    return (
      <>
        <Text style={s.eyebrow}>SOCIAL PROFILE</Text>
        <Text style={s.title}>Make it yours.</Text>
        <View style={[s.card, s.pad]}>
          <View style={s.row}>
            <View style={[s.avatar, { width: 66, height: 66, borderRadius: 22 }]}><Ionicons name="person-outline" color={C.ink} size={32} /></View>
            <View style={{ flex: 1, gap: 4 }}><Text style={s.cardHeading}>Your social profile</Text><Text style={s.small}>Separate from your Rider Comms riding profile</Text></View>
          </View>
          <Text style={s.muted}>A permanent ecosystem ID and @username will connect both apps. Profile photos, bios, garages and social privacy will remain independent.</Text>
        </View>
        <HeaderLine heading="Personal garage" meta="Cars · Motorcycles · Bicycles" />
        <View style={s.twoCol}>
          <View style={[s.card, s.pad, s.split]}><Ionicons name="car-sport" color={C.accent} size={30} /><Text style={s.cardHeading}>Your builds</Text><Text style={s.small}>Photos, upgrades and linked posts</Text></View>
          <View style={[s.card, s.pad, s.split]}><Ionicons name="bicycle" color={C.accent} size={30} /><Text style={s.cardHeading}>Your rides</Text><Text style={s.small}>Specifications and progress</Text></View>
        </View>
        <PreviewEmpty icon="person-add-outline" heading="Account integration comes next" body="This is a demo profile. No live account, garage record or friend relationship is being created." />
      </>
    );
  }

  function renderMessages() {
    return (
      <>
        <Text style={s.eyebrow}>ECOSYSTEM CONVERSATIONS</Text>
        <Text style={s.title}>Messages</Text>
        <PreviewEmpty icon="chatbox-ellipses-outline" heading="Your conversations, across both apps" body="The same direct-message threads will sync with Rider Comms. Social-only group chats, club channels and event discussions will live here. Integration is not active yet." />
        <Pressable accessibilityRole="button" style={s.ghost} onPress={() => navigate('Home')}><Text style={s.ghostText}>Back to feed</Text></Pressable>
      </>
    );
  }

  const story = demoStories.find((item) => item.id === selectedStory);

  return (
    <SafeAreaProvider>
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go to home" style={{ gap: 2 }} onPress={() => navigate('Home')}>
            <Text style={s.wordmark}>RIDER COMMS ECOSYSTEM</Text>
            <Text style={s.brandTitle}>Social<Text style={{ color: C.accent }}>.</Text></Text>
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
            <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} key={screen}>
              {screen === 'Home' ? renderHome() : null}
              {screen === 'Reels' ? renderReels() : null}
              {screen === 'Create' ? renderCreate() : null}
              {screen === 'Clubs' ? renderClubs() : null}
              {screen === 'Shop' ? renderShop() : null}
              {screen === 'Profile' ? renderProfile() : null}
              {screen === 'Messages' ? renderMessages() : null}
            </ScrollView>
            <View style={s.tabBar}>
              {primaryTabs.map((tab) => (
                <Pressable key={tab.name} accessibilityRole="tab" accessibilityState={{ selected: tab.name === screen }} accessibilityLabel={tab.name} style={s.tab} onPress={() => navigate(tab.name)}>
                  <Ionicons name={tab.name === screen ? tab.activeIcon : tab.icon} size={23} color={tab.name === screen ? C.accent : C.muted} />
                  <Text style={[s.tabLabel, tab.name === screen && { color: C.accent }]}>{tab.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}
