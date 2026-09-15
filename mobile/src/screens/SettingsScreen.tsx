// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Switch, Alert, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { SocialVisibility, ZoneTier } from '@rider-comms/shared';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useSettings } from '../settings/SettingsContext';
import type { UnitSystem } from '../settings/SettingsContext';
import { AVATAR_PRESETS, getAvatarPreset } from '../settings/avatars';
import { PLAN_INFO } from '../settings/plans';
import { RideBar } from '../ride/RideBar';
import type { RootStackParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';

const UNIT_LABELS: Record<UnitSystem, { name: string; blurb: string }> = {
  mi: { name: 'Miles', blurb: 'Distances and zone radius shown in miles.' },
  km: { name: 'Kilometers', blurb: 'Distances and zone radius shown in kilometers.' },
};
const UNIT_ORDER: UnitSystem[] = ['mi', 'km'];

const TIER_LABELS: Record<ZoneTier, { name: string; blurb: string }> = {
  free: { name: 'Free', blurb: 'The default — good for a stoplight-to-stoplight ride.' },
  premium: { name: 'Premium', blurb: 'Wider net for group rides that spread out on the highway.' },
  premium_plus: { name: 'Premium+', blurb: 'Widest range — for a convoy that has stretched way out.' },
};

function UnitRow({
  unit,
  selected,
  onSelect,
}: {
  unit: UnitSystem;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { name, blurb } = UNIT_LABELS[unit];
  return (
    <Pressable
      style={({ pressed }) => [styles.tierRow, selected && styles.tierRowSelected, pressed && styles.tierRowPressed]}
      onPress={onSelect}
    >
      <View style={styles.tierRadio}>{selected && <View style={styles.tierRadioDot} />}</View>
      <View style={styles.tierInfo}>
        <Text style={styles.tierName}>{name}</Text>
        <Text style={styles.tierBlurb}>{blurb}</Text>
      </View>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
  caption,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  caption?: string;
}): React.JSX.Element {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={20} color={colors.textSecondary} style={styles.toggleIcon} />
      <View style={styles.toggleInfo}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {caption && <Text style={styles.toggleCaption}>{caption}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

function SocialRow({ label, icon, username, visibility, onUsername, onVisibility }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; username: string; visibility: SocialVisibility; onUsername: (value: string) => void; onVisibility: (value: SocialVisibility) => void }): React.JSX.Element {
  const [draft, setDraft] = React.useState(username);
  React.useEffect(() => setDraft(username), [username]);
  const options: SocialVisibility[] = ['public', 'friends', 'private'];
  return <View style={styles.socialRow}>
    <View style={styles.socialHeading}><Ionicons name={icon} size={20} color={colors.textSecondary}/><Text style={styles.toggleLabel}>{label}</Text></View>
    <TextInput style={styles.socialInput} value={draft} onChangeText={setDraft} onBlur={() => onUsername(draft)} onSubmitEditing={() => onUsername(draft)} autoCapitalize="none" autoCorrect={false} maxLength={31} placeholder="username" placeholderTextColor={colors.textMuted}/>
    <View style={styles.visibilityRow}>{options.map((option) => <Pressable key={option} onPress={() => onVisibility(option)} style={[styles.visibilityChoice, visibility === option && styles.visibilityChoiceActive]}><Text style={[styles.visibilityText, visibility === option && styles.visibilityTextActive]}>{option === 'friends' ? 'Friends only' : option[0].toUpperCase() + option.slice(1)}</Text></Pressable>)}</View>
  </View>;
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
  const {
    zoneTier,
    avatarId,
    setAvatarId,
    displayName,
    setDisplayName,
    handle,
    setHandle,
    unitSystem,
    setUnitSystem,
    notifyNearby,
    setNotifyNearby,
    notifyInvites,
    setNotifyInvites,
    notifyChat,
    setNotifyChat,
    shareLocation,
    setShareLocation,
    instagramUsername,
    setInstagramUsername,
    instagramVisibility,
    setInstagramVisibility,
    tiktokUsername,
    setTiktokUsername,
    tiktokVisibility,
    setTiktokVisibility,
    resetAll,
    loaded,
  } = useSettings();
  const { riderId, emailVerified, logOut, deleteAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(displayName);
  const [editingName, setEditingName] = React.useState(false);
  const [handleDraft, setHandleDraft] = React.useState(handle);
  const [editingHandle, setEditingHandle] = React.useState(false);

  React.useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  React.useEffect(() => {
    setHandleDraft(handle);
  }, [handle]);

  const avatar = getAvatarPreset(avatarId);

  function commitName() {
    setDisplayName(nameDraft);
    setEditingName(false);
  }

  function commitHandle() {
    setHandle(handleDraft);
    setEditingHandle(false);
  }

  function confirmReset() {
    Alert.alert(
      'Reset app data?',
      'This clears your profile, avatar, and all settings on this device and puts everything back to its defaults.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => resetAll() },
      ]
    );
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your Rider Comms account and associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => {
          void deleteAccount().catch(() => Alert.alert('Couldn’t delete account', 'Please check your connection and try again.'));
        } },
      ]
    );
  }

  function confirmLogOut() {
    Alert.alert(
      'Log out?',
      'You’ll need your username and password to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log out', onPress: () => {
          void logOut().catch(() => Alert.alert('Logged out on this device', 'Rider Comms could not contact the server to revoke the session, but it has been removed from this device.'));
        } },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}>
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

          {editingHandle ? (
            <TextInput
              style={styles.handleInput}
              value={handleDraft}
              onChangeText={setHandleDraft}
              onSubmitEditing={commitHandle}
              onBlur={commitHandle}
              autoFocus
              maxLength={24}
              autoCapitalize="none"
              returnKeyType="done"
              placeholder="@handle"
              placeholderTextColor={colors.textMuted}
            />
          ) : (
            <Pressable onPress={() => setEditingHandle(true)} style={styles.handleRow}>
              <Text style={styles.handle}>{handle}</Text>
              <Ionicons name="pencil" size={12} color={colors.textMuted} />
            </Pressable>
          )}

          <Text style={styles.caption}>{emailVerified ? 'Email verified' : 'Email verification pending'}</Text>
          <Text selectable style={styles.riderId}>Rider ID: {riderId}</Text>
        </View>

        <View style={styles.sectionLabelRow}>
          <MaterialCommunityIcons name="road-variant" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Zone Radius</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          {loaded && (
            <View style={styles.currentTierRow}>
              <View style={styles.currentTierBadge}>
                <MaterialCommunityIcons name="road-variant" size={18} color={colors.accent} />
              </View>
              <View style={styles.tierInfo}>
                <View style={styles.tierNameRow}>
                  <Text style={styles.tierName}>{TIER_LABELS[zoneTier].name}</Text>
                  <Text style={styles.tierRadius}>{TIER_RADIUS_MILES[zoneTier]} mi</Text>
                </View>
                <Text style={styles.tierBlurb}>{TIER_LABELS[zoneTier].blurb}</Text>
              </View>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.manageTierRow, pressed && styles.tierRowPressed]}
            onPress={() => navigation.navigate('Billing')}
          >
            <Text style={styles.manageTierText}>Manage in Billing</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.sectionLabelRow}>
          <Ionicons name="share-social-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Social profiles</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          <SocialRow label="Instagram" icon="logo-instagram" username={instagramUsername} visibility={instagramVisibility} onUsername={setInstagramUsername} onVisibility={setInstagramVisibility}/>
          <SocialRow label="TikTok" icon="logo-tiktok" username={tiktokUsername} visibility={tiktokVisibility} onUsername={setTiktokUsername} onVisibility={setTiktokVisibility}/>
        </View>

        <View style={styles.sectionLabelRow}>
          <Ionicons name="card-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Billing</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.section, styles.billingRow, elevation.raised, pressed && styles.tierRowPressed]}
          onPress={() => navigation.navigate('Billing')}
        >
          <View style={styles.billingPlanBadge}>
            <MaterialCommunityIcons name="motorbike" size={18} color={colors.accent} />
          </View>
          <View style={styles.billingInfo}>
            <Text style={styles.billingPlanName}>{PLAN_INFO[zoneTier].name} plan</Text>
            <Text style={styles.billingPlanPrice}>
              {PLAN_INFO[zoneTier].priceLabel === 'Free' ? 'No card on file' : `${PLAN_INFO[zoneTier].priceLabel}/mo`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Pressable>

        <View style={styles.sectionLabelRow}>
          <MaterialCommunityIcons name="ruler" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Units</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          {loaded &&
            UNIT_ORDER.map((unit) => (
              <UnitRow key={unit} unit={unit} selected={unitSystem === unit} onSelect={() => setUnitSystem(unit)} />
            ))}
        </View>

        <View style={styles.sectionLabelRow}>
          <Ionicons name="notifications-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Notifications</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          <ToggleRow
            icon="people-outline"
            label="Nearby riders"
            value={notifyNearby}
            onValueChange={setNotifyNearby}
          />
          <ToggleRow
            icon="mail-open-outline"
            label="Ride invites"
            value={notifyInvites}
            onValueChange={setNotifyInvites}
          />
          <ToggleRow
            icon="chatbubble-ellipses-outline"
            label="Group chat messages"
            value={notifyChat}
            onValueChange={setNotifyChat}
          />
        </View>

        <View style={styles.sectionLabelRow}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Privacy</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          <ToggleRow
            icon="location-outline"
            label="Share my location while riding"
            value={shareLocation}
            onValueChange={setShareLocation}
            caption="Other riders in your zone can see your position on the map."
          />
        </View>

        <Pressable style={styles.legalRow} onPress={() => navigation.navigate('Legal')}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent}/>
          <View style={styles.legalInfo}><Text style={styles.aboutLabel}>Privacy, safety & terms</Text><Text style={styles.aboutValue}>Data choices, community rules and riding safety</Text></View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted}/>
        </Pressable>

        <Text style={styles.sectionLabel}>Advanced</Text>
        <View style={styles.section}>
          <Pressable
            style={({ pressed }) => [styles.dangerButton, pressed && styles.dangerButtonPressed]}
            onPress={confirmReset}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.dangerButtonText}>Reset app data</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.dangerButton, styles.deleteAccountButton, pressed && styles.dangerButtonPressed]}
            onPress={confirmLogOut}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.dangerButtonText}>Log out</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.dangerButton, styles.deleteAccountButton, pressed && styles.dangerButtonPressed]}
            onPress={confirmDeleteAccount}
          >
            <Ionicons name="person-remove-outline" size={18} color={colors.danger} />
            <Text style={styles.dangerButtonText}>Delete account</Text>
          </Pressable>
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
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  handle: { ...type.body, color: colors.textSecondary },
  handleInput: {
    ...type.body,
    color: colors.textSecondary,
    minWidth: 120,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
  caption: { ...type.caption, textAlign: 'center', paddingHorizontal: spacing.lg },
  riderId: { ...type.caption, color: colors.textPrimary, marginTop: spacing.xs },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
  sectionLabel: {
    ...type.label,
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
  currentTierRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  currentTierBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
  },
  manageTierText: { ...type.body, color: colors.accent, fontWeight: '700' },
  billingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  billingPlanBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billingInfo: { flex: 1, gap: spacing.xs },
  billingPlanName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  billingPlanPrice: { ...type.caption },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleIcon: { width: 20 },
  toggleInfo: { flex: 1, gap: spacing.xs, paddingVertical: spacing.sm },
  toggleLabel: { ...type.body, color: colors.textPrimary },
  toggleCaption: { ...type.caption },
  socialRow: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  socialHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  socialInput: { ...type.body, color: colors.textPrimary, minHeight: MIN_TOUCH_TARGET, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingHorizontal: spacing.md },
  visibilityRow: { flexDirection: 'row', gap: spacing.xs },
  visibilityChoice: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  visibilityChoiceActive: { backgroundColor: colors.accent },
  visibilityText: { ...type.caption, fontSize: 11 },
  visibilityTextActive: { color: colors.accentText, fontWeight: '700' },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.dangerSurface,
  },
  dangerButtonPressed: { opacity: 0.85 },
  deleteAccountButton: { borderTopWidth: 1, borderTopColor: colors.border },
  dangerButtonText: { ...type.button, color: colors.danger },
  legalRow: { marginTop: spacing.lg, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg },
  legalInfo: { flex: 1, gap: spacing.xs },
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
