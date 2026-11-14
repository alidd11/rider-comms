import React, { useState } from 'react';
import { ImageBackground, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';

export type StoryPreview = {
  id: string;
  name: string;
  color: string;
  category: string;
  imageUrl: string;
};

export function StoriesViewer({
  stories, initialId, onClose,
}: {
  stories: readonly StoryPreview[];
  initialId: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.max(0, stories.findIndex(story => story.id === initialId)));
  const story = stories[index];
  if (!story) {
    return <Pressable accessibilityRole="button" accessibilityLabel="Close story" onPress={onClose}
      style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.ink }}>No story available</Text>
    </Pressable>;
  }

  function advance(direction: -1 | 1) {
    const next = index + direction;
    if (next >= stories.length) onClose();
    else if (next >= 0) setIndex(next);
  }

  return <View testID="story-viewport" style={{ flex: 1, minHeight: 0, width: '100%', backgroundColor: '#020406' }}>
    <ImageBackground source={{ uri: story.imageUrl }} resizeMode="cover"
      accessibilityLabel={story.name + ' sample story'}
      style={{ flex: 1, justifyContent: 'space-between', backgroundColor: story.color }}>
      <View style={{
        paddingTop: 12, paddingHorizontal: 12, paddingBottom: 17,
        backgroundColor: 'rgba(0,0,0,0.58)', gap: 12,
      }}>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {stories.map((preview, i) => <View key={preview.id} style={{
            flex: 1, height: 3, borderRadius: 4,
            backgroundColor: i <= index ? '#FFFFFF' : 'rgba(255,255,255,0.38)',
          }}/>)}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 38, height: 38, borderRadius: 19, borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.6)', backgroundColor: story.color,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name="images-outline" color="#FFFFFF" size={20}/>
            </View>
            <View style={{ gap: 2 }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>{story.name}</Text>
              <Text style={{ color: '#DFE8EE', fontSize: 11 }}>Sample story · {story.category}</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close story" onPress={onClose}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={28} color="#FFFFFF"/>
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous story"
          onPress={() => advance(-1)} style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 12 }}>
          <Ionicons name="chevron-back" color={index === 0 ? 'transparent' : 'rgba(255,255,255,0.85)'} size={25}/>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next story"
          onPress={() => advance(1)} style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-end', paddingRight: 12 }}>
          <Ionicons name="chevron-forward" color="rgba(255,255,255,0.85)" size={25}/>
        </Pressable>
      </View>
      <View style={{
        paddingHorizontal: 17, paddingTop: 24, paddingBottom: 30,
        backgroundColor: 'rgba(0,0,0,0.58)',
      }}>
        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>
          {story.category}
        </Text>
        <Text style={{ color: '#DEE8EB', fontSize: 12, marginTop: 4 }}>
          Preview photo · Replies are not enabled
        </Text>
      </View>
    </ImageBackground>
  </View>;
}
