import React from 'react';
import { Text, View } from 'react-native';
import { initialsForName } from './identityDisplay';
import { RiderAvatar } from './RiderAvatar';
import { C } from './styles';

/** A rider's Rider Comms avatar; their initials only until the profile has loaded. */
export function IdentityAvatar({ name, avatarId, size = 44 }: { name: string; avatarId?: string; size?: number }) {
  if (avatarId) {
    return <View accessible accessibilityRole="image" accessibilityLabel={'Avatar for ' + name}>
      <RiderAvatar avatarId={avatarId} size={size}/>
    </View>;
  }
  return <View accessibilityLabel={'Avatar for ' + name} style={{
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: '#2B363D', borderWidth: 1, borderColor: '#46505A',
    alignItems: 'center', justifyContent: 'center',
  }}>
    <Text style={{ color: C.ink, fontSize: Math.max(12, size * 0.32), fontWeight: '800' }}>
      {initialsForName(name)}
    </Text>
  </View>;
}
