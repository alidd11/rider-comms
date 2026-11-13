import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';
import { demoCreators } from './demoCreators';
import type { SharedFriend } from './authClient';

export type ConnectionKind = 'Followers' | 'Following' | 'Friends';

type Props = {
  kind: ConnectionKind;
  followed: ReadonlySet<string>;
  friends: readonly SharedFriend[];
  onToggleFollow: (id: string) => void;
  onClose: () => void;
};

/**
 * Relationship boundaries are deliberate:
 * - following is an in-memory social-only sample;
 * - followers require the Social account service;
 * - friends must come from the shared Rider Comms friendship service.
 * Never manufacture real counts, names or cross-app relationships.
 */
export function ProfileConnectionsSheet({ kind, followed, friends, onToggleFollow, onClose }: Props) {
  const people = Object.values(demoCreators).filter(person => followed.has(person.id));
  const isFollowing = kind === 'Following';
  return <View testID="profile-connections-sheet" style={{
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    zIndex: 50, justifyContent: 'flex-end',
  }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss connections"
      onPress={onClose} style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
      }}/>
    <View style={{
      height: '68%', backgroundColor: C.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22,
      borderTopWidth: 1, borderColor: C.border, overflow: 'hidden',
    }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 19, paddingVertical: 14, borderBottomColor: C.border, borderBottomWidth: 1,
      }}>
        <View style={{ gap: 4 }}>
          <Text style={{ color: C.ink, fontWeight: '900', fontSize: 19 }}>{kind}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>
            {isFollowing ? 'Example Social follows' : kind === 'Friends' ? 'Shared Rider Comms friends' : 'Your Social followers'}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close connections"
          onPress={onClose} style={{ width: 43, height: 43, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={25} color={C.ink}/>
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 19, gap: 15 }}>
        {kind === 'Friends' && friends.length > 0 ? friends.map(friend => <View
          key={friend.riderId} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 49 }}>
          <Ionicons name="person-circle-outline" size={32} color={C.accent}/>
          <View style={{ gap: 3 }}>
            <Text style={{ color: C.ink, fontWeight: '800' }}>{friend.displayName}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{friend.handle}</Text>
          </View>
        </View>) : isFollowing && people.length > 0 ? people.map(person => (
          <View key={person.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56,
          }}>
            <View style={{
              backgroundColor: C.accentDark, width: 45, height: 45, borderRadius: 23,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Ionicons name={person.kind === 'Car' ? 'car-sport-outline'
                : person.kind === 'Bicycle' ? 'bicycle-outline' : 'speedometer-outline'}
                size={23} color={C.accent}/>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.ink, fontWeight: '800', fontSize: 14 }}>{person.displayName}</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>{person.handle} · Sample</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={'Unfollow ' + person.handle}
              onPress={() => onToggleFollow(person.id)} style={{
                borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
                borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9,
              }}>
              <Text style={{ color: C.ink, fontWeight: '800', fontSize: 12 }}>Following</Text>
            </Pressable>
          </View>
        )) : <View style={{ alignItems: 'center', paddingVertical: 35, gap: 12 }}>
          <Ionicons name={kind === 'Friends' ? 'people-outline'
            : kind === 'Followers' ? 'person-add-outline' : 'person-outline'}
            size={36} color={C.accent}/>
          <Text style={{ color: C.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>
            {kind === 'Friends' ? 'No friends found'
              : kind === 'Followers' ? 'Followers are not connected yet' : 'No example follows'}
          </Text>
          <Text style={{ color: C.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
            {kind === 'Friends'
              ? 'Your Rider Comms friends appear here. You can manage friendships from Rider Comms.'
              : kind === 'Followers'
                ? 'Followers and incoming follow requests will appear after Social accounts are connected.'
                : 'Follow a sample creator from the Home feed to see them here.'}
          </Text>
        </View>}
        {isFollowing ? <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
          These are sample Social follows on this device. They do not create or change Rider Comms friendships.
        </Text> : null}
      </ScrollView>
    </View>
  </View>;
}
