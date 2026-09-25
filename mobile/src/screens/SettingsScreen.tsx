// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Switch, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import type { SocialVisibility } from '@rider-comms/shared';
import { colors, spacing } from '../theme';
import { styles } from './SettingsScreen.styles';
import { useSettings } from '../settings/SettingsContext';
import type { UnitSystem } from '../settings/SettingsContext';
import { AVATAR_FAMILIES, AVATAR_PRESETS, getAvatarFamily, getAvatarPreset, type AvatarFamily } from '../settings/avatars';
import { PLAN_INFO } from '../settings/plans';
import { RideBar } from '../ride/RideBar';
import type { RootStackParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RiderAvatar } from '../components/RiderAvatar';
import type { AccountSessionSummary } from '../api/client';
import { NAVIGATION_PROVIDER_OPTIONS, type NavigationProvider } from '../navigationPreference';

const UNIT_LABELS: Record<UnitSystem, { name: string; blurb: string }> = {
  mi: { name: 'Miles', blurb: 'Use miles and mph.' },
  km: { name: 'Kilometres', blurb: 'Use kilometres and km/h.' },
};
const UNIT_ORDER: UnitSystem[] = ['mi', 'km'];

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
      accessibilityRole="radio"
      accessibilityState={{ selected }}
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

function NavigationProviderRow({
  provider,
  selected,
  onSelect,
}: {
  provider: NavigationProvider;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const option = NAVIGATION_PROVIDER_OPTIONS.find((item) => item.id === provider)!;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.tierRow, selected && styles.tierRowSelected, pressed && styles.tierRowPressed]}
      onPress={onSelect}
    >
      <View style={styles.tierRadio}>{selected && <View style={styles.tierRadioDot} />}</View>
      <View style={styles.tierInfo}>
        <Text style={styles.tierName}>{option.label}</Text>
        <Text style={styles.tierBlurb}>{option.description}</Text>
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
        accessibilityLabel={label}
        accessibilityHint={caption}
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
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setDraft(username);
    setError(null);
  }, [username]);
  const options: SocialVisibility[] = ['public', 'friends', 'private'];

  function commitUsername() {
    const normalized = draft.trim().replace(/^@/, '');
    if (!/^[a-z0-9._]{0,30}$/i.test(normalized)) {
      setError('Use up to 30 letters, numbers, dots or underscores.');
      return;
    }
    setError(null);
    setDraft(normalized);
    if (normalized !== username) onUsername(normalized);
  }

  return <View style={styles.socialRow}>
    <View style={styles.socialHeading}><Ionicons name={icon} size={20} color={colors.textSecondary}/><Text style={styles.toggleLabel}>{label}</Text></View>
    <TextInput style={styles.socialInput} value={draft} onChangeText={(value) => { setDraft(value); setError(null); }} onBlur={commitUsername} onSubmitEditing={commitUsername} autoCapitalize="none" autoCorrect={false} maxLength={31} placeholder="username" placeholderTextColor={colors.textMuted}/>
    {error ? <Text accessibilityRole="alert" style={styles.socialError}>{error}</Text> : null}
    <View style={styles.visibilityRow} accessibilityRole="radiogroup">{options.map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: visibility === option }} onPress={() => onVisibility(option)} style={[styles.visibilityChoice, visibility === option && styles.visibilityChoiceActive]}><Text style={[styles.visibilityText, visibility === option && styles.visibilityTextActive]}>{option === 'friends' ? 'Friends only' : option[0].toUpperCase() + option.slice(1)}</Text></Pressable>)}</View>
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
  const insets = useSafeAreaInsets();
  const [family, setFamily] = React.useState<AvatarFamily>(() => getAvatarFamily(currentId));

  React.useEffect(() => {
    if (visible) setFamily(getAvatarFamily(currentId));
  }, [currentId, visible]);

  const visiblePresets = AVATAR_PRESETS.filter((preset) => preset.family === family);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>Choose an avatar</Text>
              <Text style={styles.modalSubtitle}>Choose how you appear in Rider Comms and on authorised live ride maps.</Text>
            </View>
            <Pressable style={styles.modalClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close avatar picker">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.avatarFamilyTabs} accessibilityRole="tablist">
            {AVATAR_FAMILIES.map((item) => {
              const active = family === item.id;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setFamily(item.id)}
                  style={[styles.avatarFamilyTab, active && styles.avatarFamilyTabActive]}
                >
                  <Ionicons
                    name={item.id === 'helmet' ? 'shield-outline' : item.id === 'motorbike' ? 'speedometer-outline' : 'car-sport-outline'}
                    size={16}
                    color={active ? colors.accentText : colors.textSecondary}
                  />
                  <Text style={[styles.avatarFamilyTabText, active && styles.avatarFamilyTabTextActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            style={styles.avatarPickerScroll}
            contentContainerStyle={styles.avatarGrid}
            showsVerticalScrollIndicator={false}
          >
            {visiblePresets.map((preset) => {
              const selected = preset.id === currentId;
              return (
                <Pressable
                  key={preset.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={preset.label + ' avatar'}
                  style={[styles.avatarGridItem, selected && styles.avatarGridItemSelected]}
                  onPress={() => {
                    onSelect(preset.id);
                    onClose();
                  }}
                >
                  <RiderAvatar avatarId={preset.id} size={58} selected={selected} />
                  <Text numberOfLines={1} style={styles.avatarGridLabel}>{preset.label}</Text>
                  {selected && (
                    <View style={styles.avatarCheck}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable style={styles.modalDone} onPress={onClose}>
            <Text style={styles.modalDoneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


type SettingsSheetKey = 'accountHub' | 'communication' | 'mapNavigation' | 'offlineMaps' | 'unitsPreferences' | 'help' | 'about' | 'profile' | 'sessions' | 'account' | 'map' | 'navigation' | 'units' | 'notifications' | 'privacy' | 'safety';

const SETTINGS_SHEET_TITLES: Record<SettingsSheetKey, string> = {
  accountHub: 'Account',
  communication: 'Communication',
  mapNavigation: 'Map & Navigation',
  offlineMaps: 'Offline Maps',
  unitsPreferences: 'Units & Preferences',
  help: 'Help & Support',
  about: 'About',
  profile: 'Edit profile',
  sessions: 'Signed-in devices',
  account: 'Account and data',
  map: 'Location and map',
  navigation: 'Navigation',
  units: 'Distance units',
  notifications: 'Notifications',
  privacy: 'Privacy controls',
  safety: 'Safety',
};

function SettingsRow({ icon, title, subtitle, right, danger = false, showChevron = true, last = false, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  right?: string;
  danger?: boolean;
  showChevron?: boolean;
  last?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.settingRow, last && styles.settingRowLast, pressed && styles.settingRowPressed]}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.textPrimary} style={styles.settingRowIcon} />
      <View style={styles.settingRowCopy}>
        <Text style={[styles.settingRowTitle, danger && styles.settingRowDanger]}>{title}</Text>
        {subtitle ? <Text style={styles.settingRowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <Text numberOfLines={1} style={styles.settingRowValue}>{right}</Text> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={14} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

function SettingsSheet({ visible, title, onClose, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.settingsSheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.modalHandle} />
          <View style={styles.settingsSheetHeader}>
            <Text style={styles.settingsSheetTitle}>{title}</Text>
            <Pressable style={styles.modalClose} onPress={onClose} accessibilityRole="button" accessibilityLabel={'Close ' + title}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.settingsSheetBody} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
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
    navigationProvider,
    setNavigationProvider,
    rideSafeEnabled,
    setRideSafeEnabled,
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
    saving,
    profileError,
    clearProfileError,
  } = useSettings();
  const { riderId, emailVerified, client, logOut, deleteAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [activeSheet, setActiveSheet] = React.useState<SettingsSheetKey | null>(null);
  const [nameDraft, setNameDraft] = React.useState(displayName);
  const [handleDraft, setHandleDraft] = React.useState(handle);
  const [profileDraftError, setProfileDraftError] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<AccountSessionSummary[]>([]);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [verificationConfirmed, setVerificationConfirmed] = React.useState(emailVerified);
  const [verificationSending, setVerificationSending] = React.useState(false);

  const loadSessions = React.useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const result = await client.getSessions();
      setSessions(result.sessions);
    } catch {
      setSessionsError('Could not load signed-in devices.');
    } finally {
      setSessionsLoading(false);
    }
  }, [client]);

  React.useEffect(() => {
    if (activeSheet === 'sessions') void loadSessions();
  }, [activeSheet, loadSessions]);

  async function revokeSession(id: string) {
    try {
      await client.revokeSession(id);
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch {
      Alert.alert('Couldn’t revoke session', 'Please check your connection and try again.');
    }
  }

  React.useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  React.useEffect(() => {
    setHandleDraft(handle);
  }, [handle]);

  React.useEffect(() => {
    setVerificationConfirmed(emailVerified);
  }, [emailVerified]);

  async function resendVerificationEmail() {
    if (verificationSending) return;
    setVerificationSending(true);
    try {
      const identity = await client.getMe();
      if (identity.emailVerified) {
        setVerificationConfirmed(true);
        Alert.alert('Email verified', 'Your Rider Comms email is already verified. Nearby Voice is available.');
        return;
      }
      const result = await client.resendVerification();
      Alert.alert(
        result.sent ? 'Verification email sent' : 'Verification email unavailable',
        result.sent
          ? 'Open the new verification link in your email, then return to Rider Comms.'
          : 'Rider Comms could not send a verification email because email delivery is not configured or temporarily unavailable. Nearby Voice remains unavailable until your email is verified.',
      );
    } catch {
      Alert.alert('Couldn’t resend verification', 'Please check your connection, wait a moment if you recently requested another email, and try again.');
    } finally {
      setVerificationSending(false);
    }
  }

  const avatar = getAvatarPreset(avatarId);

  function commitName() {
    const next = nameDraft.trim();
    if (!next) {
      setProfileDraftError('Add a display name.');
      return;
    }
    setProfileDraftError(null);
    setNameDraft(next);
    if (next !== displayName) setDisplayName(next);
  }

  function commitHandle() {
    const raw = handleDraft.trim();
    const next = raw.startsWith('@') ? raw : `@${raw}`;
    if (!/^@[a-z0-9_]{3,24}$/i.test(next)) {
      setProfileDraftError('Use 3–24 letters, numbers or underscores for your handle.');
      return;
    }
    setProfileDraftError(null);
    setHandleDraft(next);
    if (next !== handle) setHandle(next);
  }

  function confirmReset() {
    Alert.alert(
      'Reset Rider Comms settings?',
      'This resets your Rider Comms profile and synced preferences to their defaults, and clears this device’s saved navigation and Ride Safe preferences.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset settings', style: 'destructive', onPress: () => resetAll() },
      ]
    );
  }

  function changeRideSafePreference(enabled: boolean) {
    if (enabled) {
      setRideSafeEnabled(true);
      return;
    }
    Alert.alert(
      'Turn off Automatic Ride Safe?',
      'Distracting controls will no longer lock automatically while this device is moving. Only change this while safely stopped.',
      [
        { text: 'Keep on', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => setRideSafeEnabled(false) },
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
      'Sign out?',
      'You’ll need your username and password to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => {
          void logOut().catch(() => Alert.alert('Signed out on this device', 'Rider Comms could not contact the server to revoke the session, but it has been removed from this device.'));
        } },
      ]
    );
  }


  const navigationLabel = NAVIGATION_PROVIDER_OPTIONS.find((option) => option.id === navigationProvider)?.label ?? 'Rider Comms';
  const sheetTitle = activeSheet ? SETTINGS_SHEET_TITLES[activeSheet] : '';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Settings" />

        <Pressable style={styles.profileCard} onPress={() => setActiveSheet('profile')} accessibilityRole="button" accessibilityLabel="Open profile settings">
          <RiderAvatar avatarId={avatarId} size={72} />
          <View style={styles.profileCopy}>
            <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
            <Text numberOfLines={1} style={styles.handle}>{handle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </Pressable>

        {profileError ? (
          <View style={styles.profileSaveStatus} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={17} color={colors.danger} />
            <Text style={styles.profileSaveError}>{profileError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss settings error" onPress={clearProfileError} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable>
          </View>
        ) : null}

        <View style={styles.settingsGroup}>
          <SettingsRow icon="person-outline" title="Account" onPress={() => setActiveSheet('accountHub')} />
          <SettingsRow icon="chatbubble-ellipses-outline" title="Communication" onPress={() => setActiveSheet('communication')} />
          <SettingsRow icon="map-outline" title="Map & Navigation" onPress={() => setActiveSheet('mapNavigation')} />
          <SettingsRow icon="cloud-download-outline" title="Offline Maps" subtitle="Online only · downloads unavailable" onPress={() => setActiveSheet('offlineMaps')} />
          <SettingsRow icon="apps-outline" title="Units & Preferences" last onPress={() => setActiveSheet('unitsPreferences')} />
        </View>

        <View style={[styles.settingsGroup, styles.secondarySettingsGroup]}>
          <SettingsRow icon="help-circle-outline" title="Help & Support" onPress={() => setActiveSheet('help')} />
          <SettingsRow icon="information-circle-outline" title="About" last onPress={() => setActiveSheet('about')} />
        </View>

        <View style={[styles.settingsGroup, styles.signOutGroup]}>
          <SettingsRow icon="log-out-outline" title="Sign Out" danger showChevron={false} last onPress={confirmLogOut} />
        </View>
      </ScrollView>

      <SettingsSheet visible={activeSheet !== null} title={sheetTitle} onClose={() => setActiveSheet(null)}>
        {activeSheet === 'accountHub' ? (
          <View style={styles.settingsSheetSection}>
            <SettingsRow icon="person-outline" title="Profile" subtitle="Name, handle and connected profiles" onPress={() => setActiveSheet('profile')} />
            <SettingsRow
              icon="card-outline"
              title="Plan and billing"
              subtitle={PLAN_INFO[zoneTier].name + ' plan · ' + (PLAN_INFO[zoneTier].priceLabel === 'Free' ? 'No card on file' : PLAN_INFO[zoneTier].priceLabel + '/mo')}
              right={PLAN_INFO[zoneTier].name}
              onPress={() => { setActiveSheet(null); navigation.navigate('Billing'); }}
            />
            <SettingsRow icon="phone-portrait-outline" title="Signed-in devices" subtitle="Review and revoke account sessions" onPress={() => setActiveSheet('sessions')} />
            <SettingsRow icon="shield-checkmark-outline" title="Account and data" subtitle="Account deletion and local data" last onPress={() => setActiveSheet('account')} />
          </View>
        ) : null}

        {activeSheet === 'communication' ? (
          <View style={styles.settingsSheetSection}>
            <SettingsRow icon="notifications-outline" title="Notifications" subtitle="Nearby riders, ride invites and group chat" onPress={() => setActiveSheet('notifications')} />
            <SettingsRow icon="shield-checkmark-outline" title="Privacy controls" subtitle="Location visibility and connected profiles" last onPress={() => setActiveSheet('privacy')} />
          </View>
        ) : null}

        {activeSheet === 'mapNavigation' ? (
          <View style={styles.settingsSheetSection}>
            <SettingsRow icon="location-outline" title="Location and map" subtitle="Location sharing and nearby riders" onPress={() => setActiveSheet('map')} />
            <SettingsRow icon="navigate-outline" title="Navigation" subtitle={navigationLabel} last onPress={() => setActiveSheet('navigation')} />
          </View>
        ) : null}

        {activeSheet === 'offlineMaps' ? (
          <View style={styles.sheetNote}>
            <Text style={styles.sheetNoteTitle}>Online maps only</Text>
            <Text style={styles.sheetNoteCopy}>Offline map downloads are not available in this build yet. Rider Comms currently needs a data connection for map tiles and route calculation.</Text>
          </View>
        ) : null}

        {activeSheet === 'unitsPreferences' ? (
          <View style={styles.settingsSheetSection}>
            <SettingsRow icon="swap-horizontal-outline" title="Distance units" subtitle={UNIT_LABELS[unitSystem].name} last onPress={() => setActiveSheet('units')} />
          </View>
        ) : null}

        {activeSheet === 'help' ? (
          <View style={styles.settingsSheetSection}>
            <SettingsRow icon="information-circle-outline" title="Safety guidance" subtitle="Low-distraction and emergency guidance" onPress={() => setActiveSheet('safety')} />
            <SettingsRow icon="document-text-outline" title="Privacy, safety & terms" subtitle="Read Rider Comms legal and safety information" last onPress={() => { setActiveSheet(null); navigation.navigate('Legal'); }} />
          </View>
        ) : null}

        {activeSheet === 'about' ? (
          <View style={styles.settingsSheetSection}>
            <View style={styles.aboutSummary}>
              <Text style={styles.aboutTitle}>Rider Comms</Text>
              <Text style={styles.aboutSummaryValue}>Version {appVersion} · Native</Text>
              <Text style={styles.aboutSummaryValue}>Signed in as {riderId}</Text>
            </View>
          </View>
        ) : null}

        {activeSheet === 'profile' ? (
          <>
            <View style={styles.settingsSheetSection}>
              <Text style={styles.sheetEyebrow}>Identity</Text>
              <Text style={styles.fieldLabel}>Avatar</Text>
              <Pressable
                style={styles.sheetAvatarRow}
                onPress={() => {
                  setActiveSheet(null);
                  setPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Change profile avatar"
              >
                <RiderAvatar avatarId={avatarId} size={54} />
                <View style={styles.sheetAvatarCopy}>
                  <Text style={styles.sheetProfileName}>{avatar.label}</Text>
                  <Text style={styles.sheetMeta}>{avatar.tagline} · Tap to choose another.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
              <Text style={styles.fieldLabel}>Display name</Text>
              <TextInput style={styles.sheetInput} value={nameDraft} onChangeText={(value) => { setNameDraft(value); setProfileDraftError(null); }} onSubmitEditing={commitName} onBlur={commitName} maxLength={50} returnKeyType="done" placeholder="Rider name" placeholderTextColor={colors.textMuted} />
              <Text style={styles.fieldLabel}>Rider handle</Text>
              <TextInput style={styles.sheetInput} value={handleDraft} onChangeText={(value) => { setHandleDraft(value); setProfileDraftError(null); }} onSubmitEditing={commitHandle} onBlur={commitHandle} maxLength={25} autoCapitalize="none" autoCorrect={false} returnKeyType="done" placeholder="@handle" placeholderTextColor={colors.textMuted} />
              <Text style={styles.sheetMetaBlock}>{verificationConfirmed ? 'Email verified' : 'Email verification pending · Nearby Voice requires verification'} · {riderId}</Text>
              {!verificationConfirmed ? (
                <Pressable
                  disabled={verificationSending}
                  style={[styles.sheetSecondaryAction, verificationSending && styles.sheetActionDisabled]}
                  onPress={() => void resendVerificationEmail()}
                  accessibilityRole="button"
                  accessibilityLabel="Resend verification email"
                >
                  <Text style={styles.sheetSecondaryActionText}>{verificationSending ? 'Sending…' : 'Resend verification email'}</Text>
                </Pressable>
              ) : null}
              {(saving || profileDraftError || profileError) ? (
                <View style={styles.sheetSaveStatus} accessibilityLiveRegion="polite">
                  {saving ? <><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.profileSavingText}>Saving profile…</Text></> : null}
                  {profileDraftError || profileError ? <Text accessibilityRole="alert" style={styles.profileSaveError}>{profileDraftError ?? profileError}</Text> : null}
                </View>
              ) : null}
            </View>
            <View style={styles.settingsSheetSection}>
              <Text style={styles.sheetEyebrow}>Connected profiles</Text>
              <SocialRow label="Instagram" icon="logo-instagram" username={instagramUsername} visibility={instagramVisibility} onUsername={setInstagramUsername} onVisibility={setInstagramVisibility}/>
              <SocialRow label="TikTok" icon="logo-tiktok" username={tiktokUsername} visibility={tiktokVisibility} onUsername={setTiktokUsername} onVisibility={setTiktokVisibility}/>
            </View>
          </>
        ) : null}

        {activeSheet === 'sessions' ? (
          <View style={styles.settingsSheetSection}>
            {sessions.map((session) => (
              <View key={session.id} style={styles.sessionRow}>
                <View style={styles.sessionInfo}>
                  <Text style={styles.aboutLabel}>{session.deviceName}</Text>
                  <Text style={styles.aboutValue}>{session.current ? 'This device' : 'Active ' + new Date(session.lastSeenAt).toLocaleDateString()}</Text>
                </View>
                {!session.current ? <Pressable accessibilityRole="button" accessibilityLabel={'Sign out ' + session.deviceName} onPress={() => void revokeSession(session.id)} style={styles.sessionRevoke}><Text style={styles.sessionRevokeText}>Sign out</Text></Pressable> : null}
              </View>
            ))}
            {sessionsLoading && sessions.length === 0 ? (
              <View style={styles.sessionLoading} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.sessionEmpty}>Loading signed-in devices…</Text>
              </View>
            ) : null}
            {!sessionsLoading && sessions.length === 0 ? <Text style={styles.sessionEmpty}>{sessionsError ?? 'No account sessions found.'}</Text> : null}
            {sessionsError && sessions.length > 0 ? <Text style={styles.sessionEmpty}>{sessionsError}</Text> : null}
            <Pressable disabled={sessionsLoading} style={[styles.sheetSecondaryAction, sessionsLoading && styles.sheetActionDisabled]} onPress={() => void loadSessions()}><Text style={styles.sheetSecondaryActionText}>{sessionsLoading ? 'Refreshing…' : 'Refresh devices'}</Text></Pressable>
          </View>
        ) : null}

        {activeSheet === 'account' ? (
          <View style={styles.settingsSheetSection}>
            <Text style={styles.sheetBodyCopy}>Delete your Rider Comms account and associated data, or reset your Rider Comms profile and preferences to their defaults.</Text>
            <Pressable style={styles.sheetSecondaryAction} onPress={confirmReset}><Text style={styles.sheetSecondaryActionText}>Reset settings</Text></Pressable>
            <Pressable style={styles.sheetDangerAction} onPress={confirmDeleteAccount}><Text style={styles.sheetDangerActionText}>Delete account</Text></Pressable>
          </View>
        ) : null}

        {activeSheet === 'map' ? (
          <>
            <View style={styles.settingsSheetSection}>
              <ToggleRow icon="location-outline" label="Nearby rider visibility" value={shareLocation} onValueChange={setShareLocation} caption="Share your position only after you choose to go live." />
            </View>
            <View style={styles.sheetNote}>
              <Text style={styles.sheetNoteTitle}>Location stays in your control</Text>
              <Text style={styles.sheetNoteCopy}>Private-ride location is controlled separately inside each ride and remains off unless you explicitly enable it.</Text>
            </View>
          </>
        ) : null}

        {activeSheet === 'navigation' ? (
          <View accessibilityRole="radiogroup" style={styles.settingsSheetSection}>
            {NAVIGATION_PROVIDER_OPTIONS.map((option) => <NavigationProviderRow key={option.id} provider={option.id} selected={navigationProvider === option.id} onSelect={() => setNavigationProvider(option.id)} />)}
          </View>
        ) : null}

        {activeSheet === 'units' ? (
          <View style={styles.settingsSheetSection}>
            {loaded ? UNIT_ORDER.map((unit) => <UnitRow key={unit} unit={unit} selected={unitSystem === unit} onSelect={() => setUnitSystem(unit)} />) : <ActivityIndicator style={styles.sheetLoader} color={colors.accent} />}
          </View>
        ) : null}

        {activeSheet === 'notifications' ? (
          <View style={styles.settingsSheetSection}>
            <ToggleRow icon="people-outline" label="Nearby riders" value={notifyNearby} onValueChange={setNotifyNearby} />
            <ToggleRow icon="mail-open-outline" label="Ride invites" value={notifyInvites} onValueChange={setNotifyInvites} />
            <ToggleRow icon="chatbubble-ellipses-outline" label="Group chat messages" value={notifyChat} onValueChange={setNotifyChat} />
          </View>
        ) : null}

        {activeSheet === 'privacy' ? (
          <>
            <View style={styles.settingsSheetSection}>
              <ToggleRow icon="location-outline" label="Live location" value={shareLocation} onValueChange={setShareLocation} caption="Visible to nearby riders only while you are live." />
            </View>
            <View style={styles.settingsSheetSection}>
              <Text style={styles.sheetEyebrow}>Connected profile visibility</Text>
              <SocialRow label="Instagram" icon="logo-instagram" username={instagramUsername} visibility={instagramVisibility} onUsername={setInstagramUsername} onVisibility={setInstagramVisibility}/>
              <SocialRow label="TikTok" icon="logo-tiktok" username={tiktokUsername} visibility={tiktokVisibility} onUsername={setTiktokUsername} onVisibility={setTiktokVisibility}/>
            </View>
          </>
        ) : null}

        {activeSheet === 'safety' ? (
          <>
            <View style={styles.settingsSheetSection}>
              <ToggleRow
                icon="shield-checkmark-outline"
                label="Automatic Ride Safe"
                value={rideSafeEnabled}
                onValueChange={changeRideSafePreference}
                caption="Uses motion from this device to lock distracting controls at 8 mph and above. Recommended while riding."
              />
            </View>
            <View style={styles.sheetNote}>
              <Text style={styles.sheetNoteTitle}>Device-only safety preference</Text>
              <Text style={styles.sheetNoteCopy}>When off, Rider Comms stops its dedicated Ride Safe location watcher. Map, navigation and optional ride-location features request location separately. Only change this while safely stopped.</Text>
            </View>
            <View style={styles.settingsSheetSection}>
              <View style={styles.safetyRow}><Ionicons name="speedometer-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Set up while stationary</Text><Text style={styles.safetyCopy}>Complete profile, route and group controls before moving.</Text></View></View>
              <View style={styles.safetyRow}><Ionicons name="location-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Control your location</Text><Text style={styles.safetyCopy}>Nearby visibility and private-ride sharing can be stopped independently.</Text></View></View>
              <View style={styles.safetyRow}><Ionicons name="warning-outline" size={21} color={colors.warning} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Not an emergency service</Text><Text style={styles.safetyCopy}>Use the appropriate emergency service when urgent help is needed.</Text></View></View>
            </View>
            <Pressable style={styles.sheetSecondaryActionStandalone} onPress={() => { setActiveSheet(null); navigation.navigate('Legal'); }}><Text style={styles.sheetSecondaryActionText}>Privacy, safety & terms</Text></Pressable>
          </>
        ) : null}
      </SettingsSheet>

      <AvatarPickerModal visible={pickerOpen} currentId={avatarId} onSelect={setAvatarId} onClose={() => setPickerOpen(false)} />
      <RideBar />
    </View>
  );
}

