import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from './styles';
import type { SocialProfileDraft } from './garage';
import type { ConnectionKind } from './ProfileConnectionsSheet';
import type { RiderProfile } from './authClient';
import { handleWithAt } from './identityDisplay';
import { IdentityAvatar } from './IdentityAvatar';

export type ProfileContentTab = 'Posts' | 'Reels' | 'Saved' | 'Garage';

/**
 * Own profile only. Auth identity comes from Rider Comms; name/bio are
 * private Social device drafts until the backend profile exists.
 * Never invent a follower count or expose rider location/ride activity.
 */
export function ProfileSummary({
  profile, accountProfile, username, tab, friendCount, followingCount,
  onTab, onConnections, onEdit, onSettings,
}: {
  profile: SocialProfileDraft;
  accountProfile: RiderProfile | null;
  username: string;
  friendCount: number;
  tab: ProfileContentTab;
  followingCount: number;
  onTab: (next: ProfileContentTab) => void;
  onConnections: (kind: ConnectionKind) => void;
  onEdit: () => void;
  onSettings: () => void;
}) {
  const handle = handleWithAt(accountProfile?.handle || username);
  const name = profile.displayName.trim();
  const showDisplayName = Boolean(name) &&
    name.toLowerCase() !== handle.replace(/^@/, '').toLowerCase();
  const stats = [
    { name: 'View posts', value: '0', label: 'Posts', action: () => onTab('Posts') },
    { name: 'View following', value: String(followingCount), label: 'Following',
      action: () => onConnections('Following') },
    { name: 'View friends', value: String(friendCount), label: 'Friends',
      action: () => onConnections('Friends') },
  ];
  const tabs: { name: ProfileContentTab; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { name: 'Posts', icon: 'grid-outline' },
    { name: 'Reels', icon: 'play-outline' },
    { name: 'Saved', icon: 'bookmark-outline' },
    { name: 'Garage', icon: 'car-sport-outline' },
  ];

  return <View testID="social-profile-summary" style={{ gap: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', minHeight: 48, marginBottom: 16 }}>
      <Text numberOfLines={1} style={{ color: C.ink, fontSize: 22,
        flex: 1, fontWeight: '800', letterSpacing: -0.8 }}>{handle}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Open settings and privacy"
        onPress={onSettings} style={{ width: 44, height: 44,
          alignItems: 'center', justifyContent: 'center', borderRadius: 13 }}>
        <Ionicons name="menu-outline" size={27} color={C.ink} />
      </Pressable>
    </View>

    <View style={{ flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 17, gap: 12 }}>
      <View style={{ width: 85, height: 85, borderRadius: 43,
        borderWidth: 2, borderColor: '#376E61', padding: 3,
        alignItems: 'center', justifyContent: 'center' }}>
        <IdentityAvatar name={accountProfile?.displayName || username} size={75} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: 3,
        justifyContent: 'space-around', alignItems: 'center' }}>
        {stats.map(stat => <Pressable key={stat.name} accessibilityRole="button"
          accessibilityLabel={stat.name} onPress={stat.action}
          style={{ flex: 1, minHeight: 54, justifyContent: 'center',
            alignItems: 'center', gap: 4 }}>
          <Text style={{ color: C.ink, fontSize: 20, letterSpacing: -0.5,
            fontWeight: '900' }}>{stat.value}</Text>
          <Text style={{ color: C.muted, fontSize: 11,
            fontWeight: '600' }}>{stat.label}</Text>
        </Pressable>)}
      </View>
    </View>

    {showDisplayName || profile.bio ? <View style={{ gap: 4, marginBottom: 16 }}>
      {showDisplayName ? <Text testID="profile-display-name"
        style={{ color: C.ink, fontSize: 15, fontWeight: '800' }}>{name}</Text> : null}
      {profile.bio ? <Text style={{ color: '#D6DADE', fontSize: 13,
        lineHeight: 19 }}>{profile.bio}</Text> : null}
    </View> : null}

    <Pressable accessibilityRole="button" accessibilityLabel="Edit social profile"
      onPress={onEdit} style={{ width: '100%', height: 45,
        borderRadius: 12, backgroundColor: '#222830',
        justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink }}>Edit profile</Text>
    </Pressable>

    <View style={{ flexDirection: 'row', borderTopWidth: 1,
      borderBottomWidth: 1, borderColor: C.border }}>
      {tabs.map(item => <Pressable key={item.name} accessibilityRole="tab"
        accessibilityLabel={item.name + ' profile tab'}
        accessibilityState={{ selected: tab === item.name }}
        onPress={() => onTab(item.name)}
        style={{ flex: 1, minHeight: 57, alignItems: 'center',
          justifyContent: 'center', borderBottomWidth: 2,
          borderBottomColor: tab === item.name ? C.ink : 'transparent' }}>
        <Ionicons name={item.icon} color={tab === item.name ? C.ink : C.muted} size={25} />
      </Pressable>)}
    </View>
  </View>;
}
