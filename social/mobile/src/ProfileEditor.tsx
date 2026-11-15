import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import type { SocialProfileDraft } from './garage';

/**
 * The edit journey replaces the profile screen, rather than inserting a form
 * below the media tabs. Fields are device-only until server-backed Social
 * profiles and visibility controls have been deployed and reviewed.
 */
export function ProfileEditor({
  draft, onName, onBio, onCancel, onSave,
}: {
  draft: SocialProfileDraft;
  onName: (value: string) => void;
  onBio: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return <View testID="profile-editor" style={{ gap: 25, paddingTop: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14,
      minHeight: 47 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel"
        onPress={onCancel} style={{ width: 44, height: 44, borderRadius: 22,
          justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="arrow-back" size={24} color={C.ink} />
      </Pressable>
      <Text style={{ color: C.ink, fontSize: 22, fontWeight: '900',
        letterSpacing: -0.6 }}>Edit profile</Text>
    </View>

    <View style={{ gap: 9 }}>
      <View style={s.rowBetween}>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Name</Text>
        <Text style={s.small}>{draft.displayName.length}/40</Text>
      </View>
      <TextInput accessibilityLabel="Social display name"
        autoCapitalize="words" autoCorrect={false}
        style={[s.input, { minHeight: 52, fontSize: 16 }]}
        value={draft.displayName} maxLength={40} onChangeText={onName}
        placeholder="Display name" placeholderTextColor={C.muted}/>
    </View>

    <View style={{ gap: 9 }}>
      <View style={s.rowBetween}>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Bio</Text>
        <Text style={s.small}>{draft.bio.length}/160</Text>
      </View>
      <TextInput accessibilityLabel="Social bio" multiline
        style={[s.input, { minHeight: 105, textAlignVertical: 'top', fontSize: 16 }]}
        maxLength={160} value={draft.bio} onChangeText={onBio}
        placeholder="Add a bio" placeholderTextColor={C.muted}/>
    </View>

    <Text style={[s.small, { lineHeight: 19 }]}>
      These edits are saved only on this device. They aren't visible to other riders.
    </Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Save profile"
      style={[s.cta, { minHeight: 52, borderRadius: 13 }]}
      onPress={onSave}>
      <Text style={[s.ctaText, { fontSize: 15 }]}>Save profile</Text>
    </Pressable>
  </View>;
}
