import React from 'react';
import { Text, View } from 'react-native';
import { initialsForName } from './identityDisplay';
import { C } from './styles';

export function IdentityAvatar({ name, size = 44 }: { name: string; size?: number }) {
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
