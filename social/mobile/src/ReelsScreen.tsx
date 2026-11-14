import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImageBackground, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';
import { useVideoPlayer, VideoView } from 'expo-video';

export type ReelPreview = {
  id: string;
  authorId: string;
  handle: string;
  title: string;
  imageUrl: string;
  videoUrl?: string;
  theme: string;
  category: 'CARS' | 'MOTORCYCLES' | 'CYCLING';
};

type ReelAction = 'share' | 'sound' | 'options';

// Keep the image unobscured: caption legibility is provided by glyph shadows,
// not a translucent rectangle that darkens the bottom third of each Reel.
const reelTextShadow = {
  textShadowColor: 'rgba(0,0,0,0.8)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;
type Props = {
  items: readonly ReelPreview[];
  followingItems: readonly ReelPreview[];
  initialReelId?: string | null;
  savedReelIds: ReadonlySet<string>;
  onToggleSavedReel: (id: string) => void;
  followedAuthors: ReadonlySet<string>;
  onToggleFollow: (authorId: string) => void;
  onOpenComments: (id: string, title: string) => void;
  onOpenCreator: (authorId: string) => void;
  onCreateReel: () => void;
};

function ReelActionButton({
  icon, label, onPress, active = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={{ alignItems: 'center', gap: 4, minWidth: 43, minHeight: 46, justifyContent: 'center' }}>
    <Ionicons name={icon} size={27} color={active ? '#5CE4C1' : '#F7F8F9'} style={reelTextShadow} />
  </Pressable>;
}

/** Video capability is active only when a verified media URL is supplied.
 * Current demo Reels are stills and never imply a video is playing. */
function ReelVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => {
    instance.loop = true;
    instance.muted = true; // iOS / browser autoplay policy
  });
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    player.play();
    return () => player.pause();
  }, [player]);
  const togglePlayback = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying(!playing);
  };
  return <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
    <VideoView player={player} style={{ flex: 1 }} contentFit="cover" nativeControls={false} playsInline/>
    <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause Reel' : 'Play Reel'}
      onPress={togglePlayback} style={{
        position: 'absolute', top: '25%', left: 50, right: 50, bottom: '28%',
        alignItems: 'center', justifyContent: 'center',
      }}>
      {!playing ? <Ionicons name="play-circle" color="#FFFFFF" size={52}/> : null}
    </Pressable>
  </View>;
}

export function ReelsScreen({ items, followingItems, initialReelId, savedReelIds, onToggleSavedReel,
  followedAuthors, onToggleFollow, onOpenComments, onOpenCreator, onCreateReel }: Props) {
  const insets = useSafeAreaInsets();
  // The image intentionally extends behind the status bar, but controls do not.
  // For installed web PWAs the CSS env() inset is authoritative, not JS insets.
  const safeTop = Platform.OS === 'web' ? 0 : insets.top;
  const controlsTop = 13 + safeTop;
  const [height, setHeight] = useState(0);
  const [feedMode, setFeedMode] = useState<'forYou' | 'following'>('forYou');
  const activeItems = feedMode === 'forYou' ? items : followingItems;
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, items.findIndex(reel => reel.id === initialReelId)));
  const [likes, setLikes] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<ScrollViewInstance>(null);
  const lastPageHeight = useRef(0);

  useEffect(() => {
    if (!height || !activeItems.length) return;
    const safeIndex = Math.min(activeIndex, activeItems.length - 1);
    // WebKit can resize the available viewport after a PWA resume, orientation
    // change or keyboard dismissal. Pixel scroll offsets from the old page
    // height otherwise leave the reader between Reels or on the wrong item.
    if (lastPageHeight.current !== height || safeIndex !== activeIndex) {
      lastPageHeight.current = height;
      if (safeIndex !== activeIndex) setActiveIndex(safeIndex);
      scroller.current?.scrollTo({ y: safeIndex * height, animated: false });
    }
  }, [activeIndex, height, activeItems.length, feedMode]);

  const toggle = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const changeFeed = (next: 'forYou' | 'following') => {
    if (feedMode === next) return;
    setFeedMode(next);
    setActiveIndex(0);
    lastPageHeight.current = 0;
    setNotice(null);
  };
  const feedTabs = <View testID="reels-feed-tabs" style={{
    minHeight: 44, flexDirection: 'row', gap: 18, alignItems: 'center',
    justifyContent: 'center',
  }}>
    {([{mode:'following',label:'Following reels',text:'Following'},
       {mode:'forYou',label:'For You reels',text:'For You'}] as const).map(tab =>
      <Pressable key={tab.mode} accessibilityRole="tab" accessibilityLabel={tab.label}
        accessibilityState={{ selected: feedMode === tab.mode }}
        onPress={() => changeFeed(tab.mode)} style={{
          minHeight: 44, justifyContent: 'center', paddingHorizontal: 2,
          borderBottomWidth: 2, borderBottomColor: feedMode === tab.mode ? '#FFFFFF' : 'transparent',
        }}>
        <Text style={[{ fontSize: 16, fontWeight: feedMode === tab.mode ? '900' : '700',
          color: feedMode === tab.mode ? '#FFFFFF' : '#B8C1C7' }, reelTextShadow]}>
          {tab.text}
        </Text>
      </Pressable>)}
  </View>;
  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(activeItems.length - 1, index));
    // Buttons should land on the next complete card immediately on web.
    // Touch gestures remain paginated and animated by the scroll view.
    scroller.current?.scrollTo({ y: next * height, animated: Platform.OS !== 'web' });
    setActiveIndex(next);
    setNotice(null);
  };

  const trackSwipe = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const next = Math.min(activeItems.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.y / height)));
    if (next !== activeIndex) {
      setActiveIndex(next);
      setNotice(null);
    }
  };

  const explain = (action: ReelAction) => {
    if (action === 'sound') setNotice('This sample is a photo. Sound controls become available for real videos.');
    if (action === 'share') setNotice('Sharing is not connected in the development preview.');
    if (action === 'options') setNotice('Reel reporting and preferences require the moderation service.');
  };

  if (!activeItems.length) {
    // A new account has no published videos. Give this full-screen route a
    // usable exit to Create instead of a nearly empty dark viewport.
    return <View testID="reels-empty-state" style={{
      flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center',
      backgroundColor: '#05070A', paddingHorizontal: 24, paddingVertical: 16, gap: 11,
      overflow: 'hidden',
    }}>
      <View pointerEvents="none" style={{
        position: 'absolute', width: 360, height: 360, borderRadius: 180,
        backgroundColor: '#102C28', opacity: 0.34,
      }}/>
      <View testID="reels-empty-studio-art" accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 210, height: 218, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 126, height: 184,
          left: 13, top: 24, transform: [{ rotate: '-13deg' }],
          borderRadius: 20, backgroundColor: '#142025', borderWidth: 1,
          borderColor: '#284139' }}/>
        <View style={{ position: 'absolute', width: 126, height: 186,
          right: 12, top: 17, transform: [{ rotate: '12deg' }],
          borderRadius: 20, backgroundColor: '#1A2329', borderWidth: 1,
          borderColor: '#2A363B' }}/>
        <View style={{ width: 132, height: 194, borderRadius: 22,
          backgroundColor: '#202A30', borderWidth: 1, borderColor: '#4A615C',
          alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <View style={{ width: 66, height: 66, borderRadius: 33,
            backgroundColor: '#F7F9FA', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={31} color="#080A0E" style={{ marginLeft: 4 }}/>
          </View>
          <Text style={{ color: '#CDE8DE', fontSize: 9, fontWeight: '800',
            letterSpacing: 1.3 }}>YOUR REEL</Text>
        </View>
      </View>
      <Text style={{ color: C.ink, fontWeight: '900', fontSize: 25,
        letterSpacing: -0.6, textAlign: 'center' }}>
        {feedMode === 'following' ? 'No followed Reels yet' : 'No Reels yet'}
      </Text>
      <Text style={{ color: '#ABB6BE', fontSize: 14, textAlign: 'center',
        lineHeight: 21, maxWidth: 310 }}>
        {feedMode === 'following'
          ? 'Reels from creators you follow will appear here when they are shared. Nothing is published yet.'
          : 'Choose a video to preview it in your Reel studio. Nothing is published yet.'}
      </Text>
      <Pressable accessibilityRole="button"
        accessibilityLabel={feedMode === 'following' ? 'Explore For You Reels' : 'Create Reel'}
        onPress={feedMode === 'following' ? () => changeFeed('forYou') : onCreateReel}
        style={{ minHeight: 50, minWidth: 193, paddingHorizontal: 23,
          borderRadius: 999, backgroundColor: '#FFFFFF', alignItems: 'center',
          justifyContent: 'center', marginTop: 10, flexDirection: 'row', gap: 9 }}>
        <Ionicons name={feedMode === 'following' ? 'compass-outline' : 'add'} size={21} color="#080A0E"/>
        <Text style={{ color: '#080A0E', fontWeight: '900', fontSize: 15 }}>
          {feedMode === 'following' ? 'Explore For You' : 'Create a Reel'}
        </Text>
      </Pressable>
      <View pointerEvents="box-none" style={{
        position: 'absolute', left: 0, right: 0, top: controlsTop,
        alignItems: 'center',
      }}>{feedTabs}</View>
    </View>;
  }

  return (
    <View nativeID="social-reels-viewport" testID="reels-viewport"
      onLayout={event => {
        const next = Math.floor(event.nativeEvent.layout.height);
        if (next !== height && next > 0) setHeight(next);
      }}
      style={{ flex: 1, minHeight: 0, width: '100%', backgroundColor: '#020406', position: 'relative' }}>
      {height > 0 ? (
        <ScrollView key={feedMode} nativeID="social-reels-feed" testID="reels-swipe-feed"
          ref={scroller}
          style={{ flex: 1 }}
          pagingEnabled snapToInterval={height} decelerationRate="fast"
          showsVerticalScrollIndicator={false} bounces={false}
          scrollEventThrottle={16} onScroll={trackSwipe}>
          {activeItems.map((reel, index) => (
            <View key={reel.id} nativeID={'social-reel-panel-' + reel.id}
              testID={'reel-slide-' + index} style={{
                height, width: '100%', backgroundColor: reel.theme, position: 'relative', overflow: 'hidden',
              }}>
              <ImageBackground source={{ uri: reel.imageUrl }} resizeMode="cover" accessibilityLabel={reel.title}
                style={{ width: '100%', height: '100%', justifyContent: 'flex-end' }}>
                {reel.videoUrl && index === activeIndex ? <ReelVideo uri={reel.videoUrl}/> : null}
                <View testID={'reel-caption-' + reel.id}
                  style={{ position: 'absolute', left: 16, bottom: 26, right: 80, gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <View style={{
                      width: 36, height: 36, borderRadius: 18, backgroundColor: reel.theme,
                      borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name={reel.category === 'CYCLING' ? 'bicycle' : reel.category === 'CARS' ? 'car-sport' : 'speedometer'}
                        size={19} color={C.ink} />
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={'View creator ' + reel.handle}
                      onPress={() => onOpenCreator(reel.authorId)}>
                      <Text style={[{ color: '#FFFFFF', fontSize: 15, fontWeight: '900' }, reelTextShadow]}>{reel.handle}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={(followedAuthors.has(reel.authorId) ? 'Unfollow ' : 'Follow ') + reel.handle}
                      onPress={() => onToggleFollow(reel.authorId)}
                      style={{
                        paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1,
                        borderColor: '#F4F6F7', borderRadius: 9,
                        backgroundColor: followedAuthors.has(reel.authorId) ? 'rgba(255,255,255,0.2)' : 'transparent',
                      }}>
                      <Text style={[{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }, reelTextShadow]}>
                        {followedAuthors.has(reel.authorId) ? 'Following' : 'Follow'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text numberOfLines={expanded.has(reel.id) ? undefined : 2}
                    style={[{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', lineHeight: 20 }, reelTextShadow]}>
                    {reel.title} · {reel.category.toLowerCase()}
                  </Text>
                  {(reel.title + ' · ' + reel.category.toLowerCase()).length > 82 ? (
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={expanded.has(reel.id) ? 'Collapse Reel caption' : 'Expand Reel caption'}
                      onPress={() => toggle(setExpanded, reel.id)}>
                      <Text style={[{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }, reelTextShadow]}>{expanded.has(reel.id) ? 'Less' : 'More'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable accessibilityRole="button" accessibilityLabel={'View garage for ' + reel.handle}
                    onPress={() => onOpenCreator(reel.authorId)}>
                    <Text style={[{ color: '#D7FFF3', fontWeight: '800', fontSize: 12 }, reelTextShadow]}>View garage & build</Text>
                  </Pressable>
                  {!reel.videoUrl ? <Text style={[{ color: '#E8ECEF', fontSize: 11 }, reelTextShadow]}>Sample photo</Text> : null}
                </View>
                <View style={{ position: 'absolute', right: 9, bottom: 23, gap: 13, alignItems: 'center' }}>
                  <ReelActionButton label={'Like Reel ' + reel.id} icon={likes.has(reel.id) ? 'heart' : 'heart-outline'}
                    active={likes.has(reel.id)} onPress={() => toggle(setLikes, reel.id)} />
                  <ReelActionButton label={'Comment on Reel ' + reel.id} icon="chatbubble-outline"
                    onPress={() => onOpenComments(reel.id, reel.title)} />
                  <ReelActionButton label={'Share Reel ' + reel.id} icon="paper-plane-outline"
                    onPress={() => explain('share')} />
                  <ReelActionButton label={'Save Reel ' + reel.id} icon={savedReelIds.has(reel.id) ? 'bookmark' : 'bookmark-outline'}
                    active={savedReelIds.has(reel.id)} onPress={() => onToggleSavedReel(reel.id)} />
                  <ReelActionButton label={'Reel options ' + reel.id} icon="ellipsis-horizontal"
                    onPress={() => explain('options')} />
                </View>
              </ImageBackground>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View nativeID="social-reels-top-controls" pointerEvents="box-none" style={{
        position: 'absolute', top: 0, right: 0, left: 0,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 18, paddingTop: controlsTop, paddingBottom: 13,
      }}>
        <View style={{ width: 40 }}/>
        {feedTabs}
        <Pressable accessibilityRole="button" accessibilityLabel="Create Reel"
          onPress={onCreateReel} style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="camera-outline" size={26} color="#FFFFFF" style={reelTextShadow} />
        </Pressable>
      </View>
      {notice ? <Pressable nativeID="social-reels-notice" accessibilityRole="button" accessibilityLabel="Dismiss Reel notice"
        onPress={() => setNotice(null)}
        style={{
          position: 'absolute', top: 71 + safeTop, left: 12, right: 12,
          paddingHorizontal: 15, paddingVertical: 13, borderRadius: 12,
          backgroundColor: 'rgba(9,24,29,0.94)', borderWidth: 1, borderColor: '#27564F',
        }}>
        <Text style={{ color: '#EAFDF5', fontSize: 13 }}>{notice}</Text>
      </Pressable> : null}
      {Platform.OS === 'web' ? <View nativeID="social-reels-swipe-buttons" pointerEvents="box-none" style={{
        position: 'absolute', right: 10, top: 72, gap: 3,
      }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous Reel" disabled={activeIndex <= 0}
          onPress={() => moveTo(activeIndex - 1)}
          style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center', opacity: activeIndex <= 0 ? 0.3 : 0.82 }}>
          <Ionicons name="chevron-up" size={22} color="#FFFFFF" style={reelTextShadow} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next Reel" disabled={activeIndex >= activeItems.length - 1}
          onPress={() => moveTo(activeIndex + 1)}
          style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center', opacity: activeIndex >= items.length - 1 ? 0.3 : 0.82 }}>
          <Ionicons name="chevron-down" size={22} color="#FFFFFF" style={reelTextShadow} />
        </Pressable>
      </View> : null}
    </View>
  );
}
