import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AVATAR_PRESETS, DEFAULT_AVATAR_ID } from '../../../shared/src/avatars.ts';
import { MAX_PROFILE_BIO_LENGTH } from '../../../shared/src/social.ts';
import { MAX_DISPLAY_NAME_LENGTH, profileChanges } from './profileFields';
import type { ProfileFields } from './profileFields';
import { RiderAvatar } from './RiderAvatar';
import { C, s } from './styles';

/**
 * Edits the rider's Rider Comms profile: the same name, bio and avatar show
 * in both apps. The screen replaces the profile rather than sitting under it.
 */
export function ProfileEditor({ initial, onCancel, onSave }: {
  initial: ProfileFields;
  onCancel: () => void;
  /** Resolves once the account has the changes; rejects with a message to show. */
  onSave: (changes: Partial<ProfileFields>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ProfileFields>({
    ...initial, avatarId: initial.avatarId || DEFAULT_AVATAR_ID,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingAvatar, setChoosingAvatar] = useState(false);

  async function save() {
    const result = profileChanges(initial, draft);
    if (!result.ok) { setError(result.error); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(result.changes);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your profile wasn’t saved. Try again.');
      setSaving(false);
    }
  }

  return <View testID="profile-editor" style={{ gap: 25, paddingTop: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 47 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving}
        onPress={onCancel} style={{ width: 44, height: 44, borderRadius: 22,
          justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="arrow-back" size={24} color={C.ink} />
      </Pressable>
      <Text style={{ color: C.ink, fontSize: 22, fontWeight: '900', letterSpacing: -0.6 }}>Edit profile</Text>
    </View>

    {/* The current avatar first, with the full set a tap away, so the name
        and bio stay on screen. */}
    <View style={{ alignItems: 'center', gap: 12 }}>
      <RiderAvatar avatarId={draft.avatarId} size={88}/>
      <Pressable accessibilityRole="button" aria-expanded={choosingAvatar}
        accessibilityLabel={choosingAvatar ? 'Done choosing avatar' : 'Change avatar'}
        onPress={() => setChoosingAvatar(open => !open)} style={[s.ghost, { minHeight: 40, paddingVertical: 8 }]}>
        <Text style={s.ghostText}>{choosingAvatar ? 'Done' : 'Change avatar'}</Text>
      </Pressable>
      {choosingAvatar ? <View accessibilityRole="radiogroup" accessibilityLabel="Avatar"
        style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
        {AVATAR_PRESETS.map(preset => {
          const selected = preset.id === draft.avatarId;
          return <Pressable key={preset.id} accessibilityRole="radio"
            accessibilityLabel={preset.label + ' avatar'} accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => setDraft(current => ({ ...current, avatarId: preset.id }))}
            style={{ width: 50, height: 50, borderRadius: 25, borderWidth: 2,
              borderColor: selected ? C.accent : 'transparent',
              alignItems: 'center', justifyContent: 'center' }}>
            <RiderAvatar avatarId={preset.id} size={42}/>
          </Pressable>;
        })}
      </View> : null}
    </View>

    <View style={{ gap: 9 }}>
      <View style={s.rowBetween}>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Name</Text>
        <Text style={s.small}>{draft.displayName.length}/{MAX_DISPLAY_NAME_LENGTH}</Text>
      </View>
      <TextInput accessibilityLabel="Display name"
        autoCapitalize="words" autoCorrect={false}
        style={[s.input, { minHeight: 52, fontSize: 16 }]}
        value={draft.displayName} maxLength={MAX_DISPLAY_NAME_LENGTH}
        onChangeText={displayName => setDraft(current => ({ ...current, displayName }))}
        placeholder="Your name" placeholderTextColor={C.muted}/>
    </View>

    <View style={{ gap: 9 }}>
      <View style={s.rowBetween}>
        <Text style={{ color: C.ink, fontSize: 14, fontWeight: '800' }}>Bio</Text>
        <Text style={s.small}>{draft.bio.length}/{MAX_PROFILE_BIO_LENGTH}</Text>
      </View>
      <TextInput accessibilityLabel="Bio" multiline
        style={[s.input, { minHeight: 105, textAlignVertical: 'top', fontSize: 16 }]}
        maxLength={MAX_PROFILE_BIO_LENGTH} value={draft.bio}
        onChangeText={bio => setDraft(current => ({ ...current, bio }))}
        placeholder="What do you ride?" placeholderTextColor={C.muted}/>
    </View>

    <Text style={[s.small, { lineHeight: 19 }]}>
      Your name, bio and avatar are the same in Rider Comms.
    </Text>
    {error ? <Text accessibilityRole="alert" style={{ color: C.warning, fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Save profile" disabled={saving}
      style={[s.cta, { minHeight: 52, opacity: saving ? 0.7 : 1 }]}
      onPress={() => { void save(); }}>
      {saving ? <ActivityIndicator accessibilityLabel="Saving profile" color={C.accentText}/>
        : <Text style={[s.ctaText, { fontSize: 15 }]}>Save profile</Text>}
    </Pressable>
  </View>;
}
