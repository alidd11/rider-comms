import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent, ScrollViewInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';
import type { GalleryItem } from './domain';

export function FeedMedia({
  id, images, height, liked, onDoubleTap,
}: {
  id: string;
  images: readonly GalleryItem[];
  height: number;
  liked: boolean;
  onDoubleTap: () => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const showDesktopArrows = viewportWidth >= 720;
  const scroller = useRef<ScrollViewInstance>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const priorWidth = useRef(0);

  useEffect(() => {
    if (width <= 0) return;
    const page = Math.min(index, Math.max(0, images.length - 1));
    // A Home Screen PWA can change width on rotation, split view or resume.
    // Recalculate the existing photo's pixel position instead of leaving a
    // partially visible image and an incorrect gallery counter.
    if (priorWidth.current !== width || page !== index) {
      priorWidth.current = width;
      if (page !== index) setIndex(page);
      scroller.current?.scrollTo({ x: page * width, animated: false });
    }
  }, [width, images.length, index]);
  const lastTap = useRef(0);
  const [heart, setHeart] = useState(false);
  useEffect(() => {
    if (!heart) return;
    const timer = setTimeout(() => setHeart(false), 700);
    return () => clearTimeout(timer);
  }, [heart]);
  const tapImage = () => {
    const now = Date.now();
    if (now - lastTap.current < 350) {
      if (!liked) onDoubleTap();
      setHeart(true);
    } else {
      setHeart(false);
    }
    lastTap.current = now;
  };
  const move = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(images.length - 1, index + direction));
    setIndex(next);
    scroller.current?.scrollTo({ x: next * width, animated: true });
  };
  const scrolled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setIndex(Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / width))));
  };
  return <View testID={'post-media-' + id} onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))}
    style={{ width: '100%', height, backgroundColor: C.panel, overflow: 'hidden' }}>
    {width > 0 ? <ScrollView ref={scroller} nativeID={'social-post-gallery-' + id}
      testID={'post-gallery-' + id} horizontal pagingEnabled
      showsHorizontalScrollIndicator={false} bounces={false}
      onScroll={scrolled} onMomentumScrollEnd={scrolled} onScrollEndDrag={scrolled}
      scrollEventThrottle={16}
      style={{ flex: 1 }}>
      {images.map((item, i) =>
        <Pressable key={item.uri + '-' + i} accessibilityRole="button"
          accessibilityLabel={'Double tap to like photo ' + String(i + 1) + ' of ' + String(images.length)}
          onPress={tapImage} style={{ width, height, backgroundColor: C.panel }}>
          <Image source={{ uri: item.uri }} resizeMode="cover" accessibilityLabel={item.alt}
            style={{ width, height }}/>
        </Pressable>)}
    </ScrollView> : null}
    {heart ? <View pointerEvents="none" style={{
      position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center',
    }}><Ionicons name="heart" size={67} color={C.ink}/></View> : null}
    {images.length > 1 ? <>
      <View style={{
        position: 'absolute', right: 12, top: 12, backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 13, paddingHorizontal: 10, paddingVertical: 5,
      }}><Text style={{ color: C.ink, fontSize: 11, fontWeight: '800' }}>{index + 1}/{images.length}</Text></View>
      {showDesktopArrows && index > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={'Previous photo in post ' + id}
        onPress={() => move(-1)} style={{
          position: 'absolute', top: '48%', left: 9, backgroundColor: 'rgba(0,0,0,0.54)',
          borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
        }}><Ionicons name="chevron-back" size={22} color={C.ink}/></Pressable> : null}
      {showDesktopArrows && index < images.length - 1 ? <Pressable accessibilityRole="button" accessibilityLabel={'Next photo in post ' + id}
        onPress={() => move(1)} style={{
          position: 'absolute', top: '48%', right: 9, backgroundColor: 'rgba(0,0,0,0.54)',
          borderRadius: 20, width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
        }}><Ionicons name="chevron-forward" size={22} color={C.ink}/></Pressable> : null}
    </> : null}
  </View>;
}
