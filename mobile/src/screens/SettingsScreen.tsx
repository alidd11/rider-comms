// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { ZoneTier } from '@rider-comms/shared';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import { AVATAR_PRESETS, getAvatarPreset } from '../settings/avatars';
import { RideBar } from '../ride/RideBar';

const TIER_LABELS: Record<ZoneTier, { name: string; blurb: string }> = {
  free: { name: 'Free', blurb: 'The default — good for a stoplight-to-stoplight ride.' },
  premium: { name: 'Premium', blurb: 'Wider net for group rides that spread out on the highway.' },
  premium_plus: { name: 'Premium+', blurb: 'Widest range — for a convoy that has stretched way out.' },
};
const TIER_ORDER: ZoneTier[] = ['free', 'premium', 'premium_plus'];

function TierRow({ tier, selected, onSelect }: { tier: ZoneTier; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const { name, blurb } = TIER_LABELS[tier];
  return (
    <Pressable
      style={({ pressed }) => [styles.tierRow, selected && styles.tierRowSelected, pressed && styles.tierRowPressed]}
      onPress={onSelect}
    >
      <View style={styles.tierRadio}>
        {selected && <View style={styles.tierRadioDot} />}
      </View>
      <View style={styles.tierInfo}>
        <View style={styles.tierNameRow}>
          <Text style={styles.tierName}>{name}</Text>
          <Text style={styles.tierRadius}>{TIER_RADIUS_MILES[tier]} mi</Text>
        </View>
        <Text style={styles.tierBlurb}>{blurb}</Text>
      </View>
    </Pressable>
  );
}

function AvatarPickerModal({
  visible,
  currentId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Choose an avatar</Text>
          <Text style={styles.modalSubtitle}>Pick how other riders will see you on the road.</Text>

          <View style={styles.avatarGrid}>
            {AVATAR_PRESETS.map((preset) => {
              const selected = preset.id === currentId;
              return (
                <Pressable
                  key={preset.id}
                  style={styles.avatarGridItem}
                  onPress={() => {
                    onSelect(preset.id);
                    onClose();
                  }}
                >
                  <View
                    style={[
                      styles.avatarSwatch,
                      { backgroundColor: preset.bg },
                      selected && styles.avatarSwatchSelected,
                    ]}
                  >
                    <MaterialCommunityIcons name={preset.icon} size={30} color={colors.textPrimary} />
                  </View>
                  {selected && (
                    <View style={styles.avatarCheck}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable style={styles.modalDone} onPress={onClose}>
            <Text style={styles.modalDoneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SettingsScreen(): React.JSX.Element {
  const { zoneTier, setZoneTier, avatarId, setAvatarId, displayName, setDisplayName, loaded } = useSettings();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(displayName);
  const [editingName, setEditingName] = React.useState(false);

  React.useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  const avatar = getAvatarPreset(avatarId);

  function commitName() {
    setDisplayName(nameDraft);
    setEditingName(false);
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileCard}>
          <Pressable onPress={() => setPickerOpen(true)} style={styles.avatarTapArea}>
            <View style={[styles.avatarRing, { backgroundColor: avatar.bg }, elevation.raised]}>
              <MaterialCommunityIcons name={avatar.icon} size={40} color={colors.textPrimary} />
            </View>
            <View style={styles.avatarEditBadge}>
              <Ionicons name="pencil" size={13} color={colors.accentText} />
            </View>
          </Pressable>

          {editingName ? (
            <TextInput
              style={styles.nameInput}
              value={nameDraft}
              onChangeText={setNameDraft}
              onSubmitEditing={commitName}
              onBlur={commitName}
              autoFocus
              maxLength={24}
              returnKeyType="done"
              placeholder="Rider name"
              placeholderTextColor={colors.textMuted}
            />
          ) : (
            <Pressable onPress={() => setEditingName(true)} style={styles.nameRow}>
              <Text style={styles.name}>{displayName}</Text>
              <Ionicons name="pencil" size={14} color={colors.textMuted} />
            </Pressable>
          )}
          <Text style={styles.caption}>Accounts aren't built yet — this profile is local to this device.</Text>
        </View>

        <View style={styles.sectionLabelRow}>
          <MaterialCommunityIcons name="road-variant" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Zone Radius</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          {loaded &&
            TIER_ORDER.map((tier) => (
              <TierRow key={tier} tier={tier} selected={zoneTier === tier} onSelect={() => setZoneTier(tier)} />
            ))}
        </View>

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.section}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>{appVersion}</Text>
          </View>
        </View>
      </ScrollView>

      <AvatarPickerModal
        visible={pickerOpen}
        currentId={avatarId}
        onSelect={setAvatarId}
        onClose={() => setPickerOpen(false)}
      />

      <RideBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  profileCard: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  avatarTapArea: { marginBottom: spacing.sm },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { ...type.heading },
  nameInput: {
    ...type.heading,
    minWidth: 160,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
  caption: { ...type.caption, textAlign: 'center', paddingHorizontal: spacing.lg },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
  sectionLabel: {
    ...type.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tierRowSelected: { backgroundColor: colors.surfaceRaised },
  tierRowPressed: { opacity: 0.85 },
  tierRadio: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  tierRadioDot: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.accent },
  tierInfo: { flex: 1, gap: spacing.xs },
  tierNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tierName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  tierRadius: { ...type.caption, color: colors.accent, fontWeight: '700' },
  tierBlurb: { ...type.caption },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  aboutLabel: { ...type.body, color: colors.textPrimary },
  aboutValue: { ...type.caption },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { ...type.heading, textAlign: 'center', marginBottom: spacing.xs },
  modalSubtitle: { ...type.caption, textAlign: 'center', marginBottom: spacing.lg },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  avatarGridItem: { width: '22%', alignItems: 'center' },
  avatarSwatch: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarSwatchSelected: { borderColor: colors.textPrimary },
  avatarCheck: { position: 'absolute', right: -2, bottom: -2 },
  modalDone: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  modalDoneText: { ...type.button, color: colors.accentText },
});
