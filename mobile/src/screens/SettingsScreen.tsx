// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Switch, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import type { SocialVisibility } from '@rider-comms/shared';
import { colors, spacing, radii, type, MIN_TOUCH_TARGET } from '../theme';
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
  mi: { name: 'Miles', blurb: 'Distances and zone radius shown in miles.' },
  km: { name: 'Kilometers', blurb: 'Distances and zone radius shown in kilometers.' },
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
      <Ionicons name={icon} size={21} color={danger ? colors.danger : colors.textSecondary} style={styles.settingRowIcon} />
      <View style={styles.settingRowCopy}>
        <Text style={[styles.settingRowTitle, danger && styles.settingRowDanger]}>{title}</Text>
        {subtitle ? <Text style={styles.settingRowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <Text style={styles.settingRowValue}>{right}</Text> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
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
  const [sessions, setSessions] = React.useState<AccountSessionSummary[]>([]);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);

  const loadSessions = React.useCallback(async () => {
    try {
      const result = await client.getSessions();
      setSessions(result.sessions);
      setSessionsError(null);
    } catch {
      setSessionsError('Could not load signed-in devices.');
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

  const avatar = getAvatarPreset(avatarId);

  function commitName() {
    setDisplayName(nameDraft);
  }

  function commitHandle() {
    setHandle(handleDraft);
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
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Settings" />

        <Pressable style={styles.profileCard} onPress={() => setActiveSheet('profile')} accessibilityRole="button" accessibilityLabel="Open profile settings">
          <RiderAvatar avatarId={avatarId} size={50} />
          <View style={styles.profileCopy}>
            <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
            <Text numberOfLines={1} style={styles.handle}>{handle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
        </Pressable>

        {(saving || profileError) ? (
          <View style={styles.profileSaveStatus} accessibilityLiveRegion="polite">
            {saving ? <><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.profileSavingText}>Saving profile…</Text></> : null}
            {profileError ? <><Ionicons name="alert-circle" size={17} color={colors.danger} /><Text style={styles.profileSaveError}>{profileError}</Text><Pressable onPress={clearProfileError} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable></> : null}
          </View>
        ) : null}

        <View style={styles.settingsGroup}>
          <SettingsRow icon="person-outline" title="Account" onPress={() => setActiveSheet('accountHub')} />
          <SettingsRow icon="chatbubble-ellipses-outline" title="Communication" onPress={() => setActiveSheet('communication')} />
          <SettingsRow icon="map-outline" title="Map & Navigation" onPress={() => setActiveSheet('mapNavigation')} />
          <SettingsRow icon="cloud-download-outline" title="Offline Maps" onPress={() => setActiveSheet('offlineMaps')} />
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
              right={PLAN_INFO[zoneTier].priceLabel === 'Free' ? 'Free' : undefined}
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
              <TextInput style={styles.sheetInput} value={nameDraft} onChangeText={setNameDraft} onSubmitEditing={commitName} onBlur={commitName} maxLength={24} returnKeyType="done" placeholder="Rider name" placeholderTextColor={colors.textMuted} />
              <Text style={styles.fieldLabel}>Rider handle</Text>
              <TextInput style={styles.sheetInput} value={handleDraft} onChangeText={setHandleDraft} onSubmitEditing={commitHandle} onBlur={commitHandle} maxLength={24} autoCapitalize="none" returnKeyType="done" placeholder="@handle" placeholderTextColor={colors.textMuted} />
              <Text style={styles.sheetMetaBlock}>{emailVerified ? 'Email verified' : 'Email verification pending'} · {riderId}</Text>
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
            {sessions.length === 0 ? <Text style={styles.sessionEmpty}>{sessionsError ?? 'No account sessions found.'}</Text> : null}
            {sessionsError && sessions.length > 0 ? <Text style={styles.sessionEmpty}>{sessionsError}</Text> : null}
            <Pressable style={styles.sheetSecondaryAction} onPress={() => void loadSessions()}><Text style={styles.sheetSecondaryActionText}>Refresh devices</Text></Pressable>
          </View>
        ) : null}

        {activeSheet === 'account' ? (
          <View style={styles.settingsSheetSection}>
            <Text style={styles.sheetBodyCopy}>Delete your Rider Comms account and associated data, or reset local app preferences on this device.</Text>
            <Pressable style={styles.sheetSecondaryAction} onPress={confirmReset}><Text style={styles.sheetSecondaryActionText}>Reset app data</Text></Pressable>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: spacing.md, paddingTop: spacing.lg },
  profileCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  profileSaveStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: -spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  profileSavingText: { ...type.caption, color: colors.textSecondary },
  profileSaveError: { ...type.caption, color: colors.danger, flex: 1 },
  profileCopy: { flex: 1, minWidth: 0, gap: 3 },
  avatarTapArea: { flexShrink: 0 },
  avatarRing: {
    width: 54,
    height: 54,
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', maxWidth: '100%' },
  name: { ...type.subheading, color: colors.textPrimary, flexShrink: 1, fontSize: 15, lineHeight: 19 },
  nameInput: {
    ...type.heading,
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', maxWidth: '100%' },
  handle: { ...type.caption, color: colors.textSecondary, flexShrink: 1, fontSize: 11, lineHeight: 15 },
  handleInput: {
    ...type.body,
    color: colors.textSecondary,
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: spacing.xs,
  },
  caption: { ...type.caption, marginTop: spacing.xs },
  riderId: { ...type.caption, color: colors.textPrimary, marginTop: 2 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
  sectionLabel: {
    ...type.label,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
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
  tierName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  tierBlurb: { ...type.caption },
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
  visibilityChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
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
  sessionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  sessionInfo: { flex: 1, gap: spacing.xs },
  sessionRevoke: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  sessionRevokeText: { ...type.button, color: colors.danger },
  sessionEmpty: { ...type.caption, padding: spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalTitle: { ...type.heading, textAlign: 'left', marginBottom: spacing.xs },
  modalSubtitle: { ...type.caption, textAlign: 'left', lineHeight: 19 },
  modalClose: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatarFamilyTabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.md,
    padding: 4,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatarFamilyTab: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radii.sm,
  },
  avatarFamilyTabActive: { backgroundColor: colors.accent },
  avatarFamilyTabText: { ...type.caption, color: colors.textSecondary, fontWeight: '700', fontSize: 10 },
  avatarFamilyTabTextActive: { color: colors.accentText },
  avatarPickerScroll: { maxHeight: 330 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md, paddingBottom: spacing.xs },
  avatarGridItem: {
    width: '23%',
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  avatarGridItemSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceRaised,
  },
  avatarGridLabel: { ...type.caption, color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
  avatarCheck: { position: 'absolute', right: 3, top: 3 },
  modalDone: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  modalDoneText: { ...type.button, color: colors.accentText },
  profileAvatar: { width: 58, height: 58, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  profileEdit: { ...type.button, color: colors.accent, fontSize: 14 },
  settingsGroup: { overflow: 'hidden', backgroundColor: colors.surface, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  secondarySettingsGroup: { marginTop: 12 },
  signOutGroup: { marginTop: 12 },
  settingRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  settingRowLast: { borderBottomWidth: 0 },
  settingRowPressed: { backgroundColor: colors.surfaceRaised },
  settingRowIcon: { width: 22 },
  settingRowCopy: { flex: 1, minWidth: 0, paddingVertical: 7 },
  settingRowTitle: { ...type.body, color: colors.textPrimary, fontWeight: '600', fontSize: 13.5, lineHeight: 18 },
  settingRowSubtitle: { ...type.caption, color: colors.textSecondary, marginTop: 2, fontSize: 10 },
  settingRowValue: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  settingRowDanger: { color: colors.danger },
  versionText: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: 12, fontSize: 10 },
  aboutSummary: { padding: spacing.md, gap: 4 },
  aboutTitle: { ...type.subheading, color: colors.textPrimary },
  aboutSummaryValue: { ...type.caption, color: colors.textSecondary },
  settingsSheet: { width: '100%', maxHeight: '86%', backgroundColor: colors.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: colors.border, padding: spacing.md },
  settingsSheetHeader: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  settingsSheetTitle: { ...type.heading, color: colors.textPrimary, flex: 1 },
  settingsSheetBody: { gap: spacing.md, paddingBottom: spacing.sm },
  settingsSheetSection: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  sheetEyebrow: { ...type.label, color: colors.textMuted, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  fieldLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sheetInput: { ...type.body, color: colors.textPrimary, minHeight: MIN_TOUCH_TARGET, marginHorizontal: spacing.md, marginTop: spacing.xs, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background },
  sheetAvatarRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.xs, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.background },
  sheetAvatar: { width: 52, height: 52, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  sheetAvatarCopy: { flex: 1, minWidth: 0 },
  sheetProfileName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  sheetMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  sheetMetaBlock: { ...type.caption, color: colors.textMuted, margin: spacing.md },
  sheetBodyCopy: { ...type.body, color: colors.textSecondary, padding: spacing.md, lineHeight: 22 },
  sheetNote: { padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  sheetNoteTitle: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  sheetNoteCopy: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },
  sheetSecondaryAction: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', margin: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  sheetSecondaryActionStandalone: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  sheetSecondaryActionText: { ...type.button, color: colors.textPrimary },
  sheetDangerAction: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.md, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger, borderRadius: radii.md, backgroundColor: colors.dangerSurface },
  sheetDangerActionText: { ...type.button, color: colors.danger },
  sheetLoader: { margin: spacing.lg },
  safetyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  safetyCopyWrap: { flex: 1, minWidth: 0 },
  safetyTitle: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  safetyCopy: { ...type.caption, color: colors.textSecondary, marginTop: 2 },

});
