import React, { useCallback, useRef, useState } from 'react';
import { ImageBackground, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';

export type ReelPreview = {
  id: string;
  authorId: string;
  handle: string;
  title: string;
  imageUrl: string;
  theme: string;
  category: 'CARS' | 'MOTORCYCLES' | 'CYCLING';
};

type ReelAction = 'comments' | 'share' | 'sound' | 'options';
type Props = {
  items: readonly ReelPreview[];
  followedAuthors: ReadonlySet<string>;
  onToggleFollow: (authorId: string) => void;
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
    <Ionicons name={icon} size={27} color={active ? '#5CE4C1' : '#F7F8F9'} />
  </Pressable>;
}

export function ReelsScreen({ items, followedAuthors, onToggleFollow, onCreateReel }: Props) {
  const [height, setHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [likes, setLikes] = useState<Set<string>>(() => new Set());
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  const toggle = useCallback((setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    scroller.current?.scrollTo({ y: next * height, animated: true });
    setActiveIndex(next);
    setNotice(null);
  };

  const trackSwipe = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const next = Math.min(items.length - 1, Math.max(0, Math.round(event.nativeEvent.contentOffset.y / height)));
    if (next !== activeIndex) {
      setActiveIndex(next);
      setNotice(null);
    }
  };

  const explain = (action: ReelAction) => {
    if (action === 'sound') setNotice('This sample is a photo. Sound controls become available for real videos.');
    if (action === 'comments') setNotice('Comments are not connected in the development preview.');
    if (action === 'share') setNotice('Sharing is not connected in the development preview.');
    if (action === 'options') setNotice('Reel reporting and preferences require the moderation service.');
  };

  if (!items.length) {
    return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
      <Text style={{ color: C.ink, fontWeight: '800' }}>No Reels available</Text>
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
        <ScrollView nativeID="social-reels-feed" testID="reels-swipe-feed"
          ref={scroller}
          style={{ flex: 1 }}
          pagingEnabled snapToInterval={height} decelerationRate="fast"
          showsVerticalScrollIndicator={false} bounces={false}
          scrollEventThrottle={16} onScroll={trackSwipe}>
          {items.map((reel, index) => (
            <View key={reel.id} nativeID={'social-reel-panel-' + reel.id}
              testID={'reel-slide-' + index} style={{
                height, width: '100%', backgroundColor: reel.theme, position: 'relative', overflow: 'hidden',
              }}>
              <ImageBackground source={{ uri: reel.imageUrl }} resizeMode="cover" accessibilityLabel={reel.title}
                style={{ width: '100%', height: '100%', justifyContent: 'flex-end' }}>
                <View pointerEvents="none" style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 212,
                  backgroundColor: 'rgba(0,0,0,0.58)',
                }} />
                <View style={{ position: 'absolute', left: 16, bottom: 26, right: 80, gap: 9 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <View style={{
                      width: 36, height: 36, borderRadius: 18, backgroundColor: reel.theme,
                      borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name={reel.category === 'CYCLING' ? 'bicycle' : reel.category === 'CARS' ? 'car-sport' : 'speedometer'}
                        size={19} color={C.ink} />
                    </View>
                    <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '900' }}>{reel.handle}</Text>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={(followedAuthors.has(reel.authorId) ? 'Unfollow ' : 'Follow ') + reel.handle}
                      onPress={() => onToggleFollow(reel.authorId)}
                      style={{
                        paddingHorizontal: 11, paddingVertical: 5, borderWidth: 1,
                        borderColor: '#F4F6F7', borderRadius: 9,
                        backgroundColor: followedAuthors.has(reel.authorId) ? 'rgba(255,255,255,0.2)' : 'transparent',
                      }}>
                      <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>
                        {followedAuthors.has(reel.authorId) ? 'Following' : 'Follow'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text numberOfLines={expanded.has(reel.id) ? undefined : 2}
                    style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
                    {reel.title} · {reel.category.toLowerCase()}
                  </Text>
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={expanded.has(reel.id) ? 'Collapse Reel caption' : 'Expand Reel caption'}
                    onPress={() => toggle(setExpanded, reel.id)}>
                    <Text style={{ color: '#D7E5E7', fontSize: 12 }}>{expanded.has(reel.id) ? 'Less' : 'More'}</Text>
                  </Pressable>
                  <Text style={{ color: '#CFD8DE', fontSize: 11 }}>Preview photo · video coming soon</Text>
                </View>
                <View style={{ position: 'absolute', right: 9, bottom: 23, gap: 13, alignItems: 'center' }}>
                  <ReelActionButton label={'Like Reel ' + reel.id} icon={likes.has(reel.id) ? 'heart' : 'heart-outline'}
                    active={likes.has(reel.id)} onPress={() => toggle(setLikes, reel.id)} />
                  <ReelActionButton label={'Comment on Reel ' + reel.id} icon="chatbubble-outline"
                    onPress={() => explain('comments')} />
                  <ReelActionButton label={'Share Reel ' + reel.id} icon="paper-plane-outline"
                    onPress={() => explain('share')} />
                  <ReelActionButton label={'Save Reel ' + reel.id} icon={bookmarks.has(reel.id) ? 'bookmark' : 'bookmark-outline'}
                    active={bookmarks.has(reel.id)} onPress={() => toggle(setBookmarks, reel.id)} />
                  <ReelActionButton label={'Reel options ' + reel.id} icon="ellipsis-horizontal"
                    onPress={() => explain('options')} />
                </View>
              </ImageBackground>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View pointerEvents="box-none" style={{
        position: 'absolute', top: 0, right: 0, left: 0,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 18, paddingVertical: 13,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 24 }}>Reels</Text>
          <Text style={{ color: '#DDE5E9', fontWeight: '700', fontSize: 11 }}>DEMO</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Create Reel"
          onPress={onCreateReel} style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
        </Pressable>
      </View>
      {notice ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss Reel notice"
        onPress={() => setNotice(null)}
        style={{
          position: 'absolute', top: 68, left: 12, right: 12,
          paddingHorizontal: 15, paddingVertical: 13, borderRadius: 12,
          backgroundColor: 'rgba(9,24,29,0.94)', borderWidth: 1, borderColor: '#27564F',
        }}>
        <Text style={{ color: '#EAFDF5', fontSize: 13 }}>{notice}</Text>
      </Pressable> : null}
      {Platform.OS === 'web' ? <View pointerEvents="box-none" style={{
        position: 'absolute', right: 10, top: 53, gap: 3,
      }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous Reel" disabled={activeIndex <= 0}
          onPress={() => moveTo(activeIndex - 1)}
          style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center', opacity: activeIndex <= 0 ? 0.3 : 0.82 }}>
          <Ionicons name="chevron-up" size={22} color="#FFFFFF" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next Reel" disabled={activeIndex >= items.length - 1}
          onPress={() => moveTo(activeIndex + 1)}
          style={{ width: 34, height: 34, justifyContent: 'center', alignItems: 'center', opacity: activeIndex >= items.length - 1 ? 0.3 : 0.82 }}>
          <Ionicons name="chevron-down" size={22} color="#FFFFFF" />
        </Pressable>
      </View> : null}
    </View>
  );
}
