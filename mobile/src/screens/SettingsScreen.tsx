import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import type { SocialVisibility } from '@rider-comms/shared';
import { colors, spacing } from '../theme';
import { BlockedRidersList } from './BlockedRidersList';
import { LEGAL_LINKS } from '../legalLinks';
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
import { CategoryRow, PlainRow, SegmentedRow, SettingsGroup, SettingsHeader, SwitchRow, useSettingsPalette } from './SettingsListUi';

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

/** One connected profile on Edit profile: username and who can see it. Saved with the page. */
function SocialField({ label, icon, draft, error, visibility, onDraft, onVisibility }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; draft: string; error: string | null; visibility: SocialVisibility; onDraft: (value: string) => void; onVisibility: (value: SocialVisibility) => void }): React.JSX.Element {
  const options: SocialVisibility[] = ['public', 'friends', 'private'];
  return <View style={styles.socialRow}>
    <View style={styles.socialHeading}><Ionicons name={icon} size={20} color={colors.textSecondary}/><Text style={styles.toggleLabel}>{label}</Text></View>
    <TextInput accessibilityLabel={`${label} username`} style={styles.socialInput} value={draft} onChangeText={onDraft} autoCapitalize="none" autoCorrect={false} maxLength={31} placeholder="username" placeholderTextColor={colors.textMuted}/>
    {error ? <Text accessibilityRole="alert" style={styles.socialError}>{error}</Text> : null}
    <View style={styles.visibilityRow} accessibilityRole="radiogroup" accessibilityLabel={`${label} visibility`}>{options.map((option) => { const optionLabel = option === 'friends' ? 'Friends only' : option[0].toUpperCase() + option.slice(1); return <Pressable key={option} accessibilityRole="radio" accessibilityLabel={optionLabel} accessibilityState={{ selected: visibility === option }} onPress={() => onVisibility(option)} style={[styles.visibilityChoice, visibility === option && styles.visibilityChoiceActive]}><Text style={[styles.visibilityText, visibility === option && styles.visibilityTextActive]}>{optionLabel}</Text></Pressable>; })}</View>
  </View>;
}

/** Usernames for Instagram/TikTok: up to 30 letters, numbers, dots or underscores. */
function normalizeSocialUsername(draft: string): { value: string; error: string | null } {
  const value = draft.trim().replace(/^@/, '');
  return /^[a-z0-9._]{0,30}$/i.test(value) ? { value, error: null } : { value, error: 'Use up to 30 letters, numbers, dots or underscores.' };
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
      <Pressable accessible={false} style={styles.modalBackdrop} onPress={onClose}>
        <Pressable accessible={false} style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
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

          <Pressable accessibilityRole="button" style={styles.modalDone} onPress={onClose}>
            <Text style={styles.modalDoneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}


/** The pages a settings row opens (the Settings list itself holds the
 * switches). Keys match the PWA's page tokens, see
 * scripts/check-client-parity.mjs. */
export type SettingsPageKey = 'myProfile' | 'editProfile' | 'general' | 'mapNavigation' | 'rideSafe' | 'account' | 'privacy' | 'navigationApp' | 'distanceUnits' | 'blockedRiders' | 'email' | 'devices' | 'help' | 'about';

export const SETTINGS_PAGE_TITLES: Record<SettingsPageKey, string> = {
  myProfile: 'Profile',
  editProfile: 'Edit profile',
  general: 'General',
  mapNavigation: 'Map & navigation',
  rideSafe: 'Ride Safe',
  account: 'Account and login',
  privacy: 'Privacy',
  navigationApp: 'Navigation app',
  distanceUnits: 'Distance units',
  blockedRiders: 'Blocked riders',
  email: 'Email',
  devices: 'Signed-in devices',
  help: 'Help & Support',
  about: 'About',
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
    <Pressable
      accessibilityRole="button"
      // Only the words: otherwise screen readers also announce the icon glyphs.
      accessibilityLabel={[title, subtitle, right].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, last && styles.settingRowLast, pressed && styles.settingRowPressed]}
    >
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

/** One titled group on the Settings list, with an optional footnote. */
function SettingsSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.settingsSection}>
      <Text style={styles.pageSectionTitle} accessibilityRole="header">{title}</Text>
      <View style={styles.settingsGroup}>{children}</View>
      {note ? <Text style={styles.pageSectionNote}>{note}</Text> : null}
    </View>
  );
}

/** A titled group of controls on a settings page. */
function PageSection({ title, children, note }: { title?: string; children: React.ReactNode; note?: string }): React.JSX.Element {
  return (
    <View style={styles.pageSection}>
      {title ? <Text style={styles.pageSectionTitle} accessibilityRole="header">{title}</Text> : null}
      <View style={styles.settingsSheetSection}>{children}</View>
      {note ? <Text style={styles.pageSectionNote}>{note}</Text> : null}
    </View>
  );
}

// Pages reached from the Settings root get Waze's header (back, centred
// title, X to close Settings); the category pages are full-width groups.
const SETTINGS_CATEGORY_PAGES = new Set<SettingsPageKey>(['general', 'mapNavigation', 'rideSafe', 'account', 'privacy']);
const MENU_PAGES = new Set<SettingsPageKey>(['myProfile', 'editProfile', 'help']);

/** Full-screen settings page: header, then scrolling content. */
function SettingsPageLayout({ title, page, children }: { title: string; page: SettingsPageKey; children: React.ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const palette = useSettingsPalette();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (MENU_PAGES.has(page)) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={[styles.scroll, styles.pageScroll, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader title={title} onBack={() => navigation.goBack()} />
          {children}
        </ScrollView>
      </View>
    );
  }
  const fullWidth = SETTINGS_CATEGORY_PAGES.has(page);
  return (
    <View style={[styles.container, { backgroundColor: palette.page }]}>
      <SettingsHeader title={title} topInset={insets.top} onBack={() => navigation.goBack()} onClose={() => navigation.popTo('Settings')} />
      <ScrollView
        contentContainerStyle={fullWidth
          ? { paddingBottom: insets.bottom + spacing.xl }
          : [styles.scroll, styles.pageScroll, { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** The Settings root, Waze-style: categories only, each opening its own
 * page (the PWA's SETTINGS_CATEGORIES has the same rows and tints). */
export function SettingsScreen(): React.JSX.Element {
  const { profileError, clearProfileError } = useSettings();
  const insets = useSafeAreaInsets();
  const palette = useSettingsPalette();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openPage = (page: SettingsPageKey) => navigation.push('SettingsPage', { page });
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <View style={[styles.container, { backgroundColor: palette.page }]}>
      <SettingsHeader title="Settings" topInset={insets.top} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }} showsVerticalScrollIndicator={false}>
        {profileError ? (
          <View style={styles.profileSaveStatus} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={17} color={colors.danger} />
            <Text style={styles.profileSaveError}>{profileError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss settings error" onPress={clearProfileError} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable>
          </View>
        ) : null}

        <SettingsGroup>
          <CategoryRow first icon="settings" tint="#1FB6D9" title="General" onPress={() => openPage('general')} />
          <CategoryRow icon="map" tint="#2FB35F" title="Map & navigation" onPress={() => openPage('mapNavigation')} />
          <CategoryRow icon="shield-checkmark" tint="#F2802A" title="Ride Safe" onPress={() => openPage('rideSafe')} />
        </SettingsGroup>

        <SettingsGroup title="Account">
          <CategoryRow first icon="person" tint="#2A8196" title="Account and login" onPress={() => openPage('account')} />
          <CategoryRow icon="lock-closed" tint="#1E95E8" title="Privacy" onPress={() => openPage('privacy')} />
        </SettingsGroup>

        <SettingsGroup>
          <CategoryRow first icon="information" tint="#16A9D9" title="About" onPress={() => openPage('about')} />
        </SettingsGroup>

        <Text style={styles.settingsVersion}>Version {appVersion}</Text>
      </ScrollView>
      <RideBar />
    </View>
  );
}

/** General: distance units as a segmented control. */
function GeneralPage(): React.JSX.Element {
  const { unitSystem, setUnitSystem } = useSettings();
  return (
    <SettingsGroup>
      <SegmentedRow first title="Distance units" options={[['mi', 'Miles'], ['km', 'km']] as const} value={unitSystem} onChange={(unit) => setUnitSystem(unit)} />
    </SettingsGroup>
  );
}

/** Map & navigation: which app navigates, and route options. */
function MapNavigationPage(): React.JSX.Element {
  const { navigationProvider, routeAvoidance, setRouteAvoidance } = useSettings();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const navigationAppLabel = NAVIGATION_PROVIDER_OPTIONS.find((option) => option.id === navigationProvider)?.label ?? '';
  return (
    <SettingsGroup note="Route options apply to routes Rider Comms plans.">
      <PlainRow first title="Navigation app" value={navigationAppLabel} onPress={() => navigation.push('SettingsPage', { page: 'navigationApp' })} />
      <SwitchRow title="Avoid motorways" value={routeAvoidance.highways} onValueChange={(highways) => setRouteAvoidance({ ...routeAvoidance, highways })} />
      <SwitchRow title="Avoid tolls" value={routeAvoidance.tolls} onValueChange={(tolls) => setRouteAvoidance({ ...routeAvoidance, tolls })} />
    </SettingsGroup>
  );
}

/** Ride Safe: the automatic lock while moving. */
function RideSafePage(): React.JSX.Element {
  const { rideSafeEnabled, setRideSafeEnabled } = useSettings();
  function changeRideSafe(enabled: boolean) {
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
  return (
    <SettingsGroup note="Ride Safe locks distracting controls at 8 mph and above. Only change it while safely stopped.">
      <SwitchRow first title="Ride Safe auto-lock" value={rideSafeEnabled} onValueChange={changeRideSafe} />
    </SettingsGroup>
  );
}

/** Privacy: Nearby visibility and blocked riders. */
function PrivacyPage(): React.JSX.Element {
  const { shareLocation, setShareLocation } = useSettings();
  const { client } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Blocked riders shows how many; refreshed whenever this page comes back
  // into view (an unblock on its page changes it).
  const [blockedCount, setBlockedCount] = React.useState<number | null>(null);
  useFocusEffect(React.useCallback(() => {
    let active = true;
    client.getBlockedRiders().then(({ blocked }) => { if (active) setBlockedCount(blocked.length); }).catch(() => undefined);
    return () => { active = false; };
  }, [client]));
  return (
    <SettingsGroup note="Nearby riders see you only while you’re live. Group-ride location is chosen inside each ride.">
      <SwitchRow first title="Nearby rider visibility" value={shareLocation} onValueChange={setShareLocation} />
      <PlainRow title="Blocked riders" value={blockedCount ? String(blockedCount) : undefined} onPress={() => navigation.push('SettingsPage', { page: 'blockedRiders' })} />
    </SettingsGroup>
  );
}

/** Account and login: email, devices, then sign out, reset and delete. */
function AccountPage(): React.JSX.Element {
  const { resetAll } = useSettings();
  const { logOut, emailVerified, deleteAccount } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

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

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your Rider Comms account and associated data. This cannot be undone.\n\nIt doesn’t cancel a Premium subscription: cancel that in your App Store or Google Play subscription settings.',
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

  return (
    <>
      <SettingsGroup title="Login info">
        <PlainRow first title="Email" value={emailVerified ? 'Verified' : 'Not verified'} onPress={() => navigation.push('SettingsPage', { page: 'email' })} />
        <PlainRow title="Signed-in devices" onPress={() => navigation.push('SettingsPage', { page: 'devices' })} />
      </SettingsGroup>
      <SettingsGroup title="Advanced" note="Deleting your account permanently removes it and its data straight away.">
        <PlainRow first title="Sign out" chevron={false} onPress={confirmLogOut} />
        <PlainRow title="Reset settings" chevron={false} onPress={confirmReset} />
        <PlainRow title="Delete account" danger chevron={false} onPress={confirmDeleteAccount} />
      </SettingsGroup>
    </>
  );
}

const VISIBILITY_LABELS: Record<SocialVisibility, string> = { public: 'Everyone', friends: 'Friends only', private: 'Only me' };

/** View profile: how other riders see you, with Edit profile. */
function MyProfilePage(): React.JSX.Element {
  const { avatarId, displayName, handle, zoneTier, instagramUsername, instagramVisibility, tiktokUsername, tiktokVisibility } = useSettings();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const socials: Array<{ label: string; icon: React.ComponentProps<typeof Ionicons>['name']; username: string; visibility: SocialVisibility }> = [
    { label: 'Instagram', icon: 'logo-instagram', username: instagramUsername, visibility: instagramVisibility },
    { label: 'TikTok', icon: 'logo-tiktok', username: tiktokUsername, visibility: tiktokVisibility },
  ];
  return (
    <>
      <View style={styles.myProfileCard}>
        <RiderAvatar avatarId={avatarId} size={112} />
        <Text numberOfLines={1} style={styles.myProfileName}>{displayName}</Text>
        <Text numberOfLines={1} style={styles.myProfileHandle}>{handle}</Text>
        <Text style={styles.myProfilePlan}>{PLAN_INFO[zoneTier].name} plan</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.myProfileEdit, pressed && styles.settingRowPressed]}
        // push, not navigate: Profile is already a SettingsPage, and
        // navigate() to the same route name would replace it, so Back from
        // Edit profile would skip past your profile.
        onPress={() => navigation.push('SettingsPage', { page: 'editProfile' })}
        testID="edit-profile"
      >
        <Text style={styles.myProfileEditText}>Edit profile</Text>
      </Pressable>
      <PageSection title="Connected profiles" note="This is how riders see you. Each connected profile shows only to the people you choose.">
        {socials.map((social, index) => (
          <View key={social.label} style={[styles.myProfileSocial, index === socials.length - 1 && styles.settingRowLast]}>
            <Ionicons name={social.icon} size={20} color={colors.textSecondary} />
            <View style={styles.settingRowCopy}>
              <Text style={styles.settingRowTitle}>{social.label}</Text>
              <Text style={styles.settingRowSubtitle}>{social.username ? `@${social.username}` : 'Not added'}</Text>
            </View>
            {social.username ? <Text style={styles.settingRowValue}>{VISIBILITY_LABELS[social.visibility]}</Text> : null}
          </View>
        ))}
      </PageSection>
    </>
  );
}

/**
 * Edit profile: avatar, name, handle and connected profiles. Like the PWA,
 * fields are drafts until Save (the avatar applies as soon as it's picked);
 * Save sends only what changed, then returns to your profile.
 */
function EditProfilePage(): React.JSX.Element {
  const {
    avatarId, setAvatarId, displayName, setDisplayName, handle, setHandle,
    instagramUsername, setInstagramUsername, instagramVisibility, setInstagramVisibility,
    tiktokUsername, setTiktokUsername, tiktokVisibility, setTiktokVisibility,
    saving, profileError,
  } = useSettings();
  const navigation = useNavigation();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(displayName);
  const [handleDraft, setHandleDraft] = React.useState(handle);
  const [instagramDraft, setInstagramDraft] = React.useState(instagramUsername);
  const [tiktokDraft, setTiktokDraft] = React.useState(tiktokUsername);
  const [instagramVisibilityDraft, setInstagramVisibilityDraft] = React.useState(instagramVisibility);
  const [tiktokVisibilityDraft, setTiktokVisibilityDraft] = React.useState(tiktokVisibility);
  const [profileDraftError, setProfileDraftError] = React.useState<string | null>(null);
  const [instagramError, setInstagramError] = React.useState<string | null>(null);
  const [tiktokError, setTiktokError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  // Once the queued saves finish, go back to the profile unless one failed
  // (the error then shows here and the rider can try again).
  React.useEffect(() => {
    if (!submitted || saving) return;
    setSubmitted(false);
    if (!profileError) navigation.goBack();
  }, [navigation, profileError, saving, submitted]);

  const avatar = getAvatarPreset(avatarId);

  function save() {
    const name = nameDraft.trim();
    const rawHandle = handleDraft.trim();
    const nextHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
    const instagram = normalizeSocialUsername(instagramDraft);
    const tiktok = normalizeSocialUsername(tiktokDraft);
    setInstagramError(instagram.error);
    setTiktokError(tiktok.error);
    if (!name) {
      setProfileDraftError('Add a display name.');
      return;
    }
    if (!/^@[a-z0-9_]{3,24}$/i.test(nextHandle)) {
      setProfileDraftError('Use 3–24 letters, numbers or underscores for your handle.');
      return;
    }
    setProfileDraftError(null);
    if (instagram.error || tiktok.error) return;

    let changed = false;
    if (name !== displayName) { setDisplayName(name); changed = true; }
    if (nextHandle !== handle) { setHandle(nextHandle); changed = true; }
    if (instagram.value !== instagramUsername) { setInstagramUsername(instagram.value); changed = true; }
    if (instagramVisibilityDraft !== instagramVisibility) { setInstagramVisibility(instagramVisibilityDraft); changed = true; }
    if (tiktok.value !== tiktokUsername) { setTiktokUsername(tiktok.value); changed = true; }
    if (tiktokVisibilityDraft !== tiktokVisibility) { setTiktokVisibility(tiktokVisibilityDraft); changed = true; }
    if (changed) setSubmitted(true);
    else navigation.goBack();
  }

  return (
    <>
      <PageSection title="Avatar">
        <Pressable
          style={styles.sheetAvatarRow}
          onPress={() => setPickerOpen(true)}
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
      </PageSection>

      <PageSection title="Name">
        <Text style={styles.fieldLabel}>Display name</Text>
        <TextInput accessibilityLabel="Rider name" style={styles.sheetInput} value={nameDraft} onChangeText={(value) => { setNameDraft(value); setProfileDraftError(null); }} maxLength={50} returnKeyType="done" placeholder="Rider name" placeholderTextColor={colors.textMuted} />
        <Text style={styles.fieldLabel}>Rider handle</Text>
        <TextInput accessibilityLabel="Rider handle" style={styles.sheetInput} value={handleDraft} onChangeText={(value) => { setHandleDraft(value); setProfileDraftError(null); }} maxLength={25} autoCapitalize="none" autoCorrect={false} returnKeyType="done" placeholder="@handle" placeholderTextColor={colors.textMuted} />
      </PageSection>

      <PageSection title="Connected profiles" note="Choose who can see each one on your Rider Comms profile.">
        <SocialField label="Instagram" icon="logo-instagram" draft={instagramDraft} error={instagramError} visibility={instagramVisibilityDraft} onDraft={(value) => { setInstagramDraft(value); setInstagramError(null); }} onVisibility={setInstagramVisibilityDraft}/>
        <SocialField label="TikTok" icon="logo-tiktok" draft={tiktokDraft} error={tiktokError} visibility={tiktokVisibilityDraft} onDraft={(value) => { setTiktokDraft(value); setTiktokError(null); }} onVisibility={setTiktokVisibilityDraft}/>
      </PageSection>

      {(saving || profileDraftError || profileError) ? (
        <View style={styles.sheetSaveStatus} accessibilityLiveRegion="polite">
          {saving ? <><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.profileSavingText}>Saving profile…</Text></> : null}
          {profileDraftError || profileError ? <Text accessibilityRole="alert" style={styles.profileSaveError}>{profileDraftError ?? profileError}</Text> : null}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        style={({ pressed }) => [styles.myProfileEdit, (pressed || saving) && styles.sheetActionDisabled]}
        onPress={save}
        testID="save-profile"
      >
        <Text style={styles.myProfileEditText}>{saving ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>

      <AvatarPickerModal visible={pickerOpen} currentId={avatarId} onSelect={setAvatarId} onClose={() => setPickerOpen(false)} />
    </>
  );
}

/** Email: verification status, and a new verification email if needed. */
function EmailPage(): React.JSX.Element {
  const { emailVerified, client } = useAuth();
  const [verificationConfirmed, setVerificationConfirmed] = React.useState(emailVerified);
  const [verificationSending, setVerificationSending] = React.useState(false);
  React.useEffect(() => { setVerificationConfirmed(emailVerified); }, [emailVerified]);

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

  return (
    <>
      <PageSection>
        <Text style={styles.sheetProfileName}>{verificationConfirmed ? 'Email verified' : 'Email not verified yet'}</Text>
        <Text style={styles.sheetBodyCopy}>{verificationConfirmed ? 'Your email is verified, so Nearby Voice is available.' : 'Nearby Voice needs a verified email. Open the link we emailed you, or send a new one.'}</Text>
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
      </PageSection>

    </>
  );
}

/** Signed-in devices: every session on the account, and sign-out. */
function DevicesPage(): React.JSX.Element {
  const { client } = useAuth();
  const [sessions, setSessions] = React.useState<AccountSessionSummary[]>([]);
  const [sessionsError, setSessionsError] = React.useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

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

  React.useEffect(() => { void loadSessions(); }, [loadSessions]);

  async function revokeSession(id: string) {
    try {
      await client.revokeSession(id);
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch {
      Alert.alert('Couldn’t revoke session', 'Please check your connection and try again.');
    }
  }

  return (
    <>
      <PageSection note="Sign out any device you don’t recognise.">
        {sessions.map((session) => (
          <View key={session.id} style={styles.sessionRow}>
            <Ionicons name="phone-portrait-outline" size={20} color={colors.textSecondary} />
            <View style={styles.sessionInfo}>
              <Text style={styles.aboutLabel}>{session.deviceName}</Text>
              <Text style={styles.aboutValue}>{session.current ? 'This device' : 'Active ' + new Date(session.lastSeenAt).toLocaleDateString()}</Text>
            </View>
            {session.current ? <Text style={styles.settingRowValue}>Current</Text> : <Pressable accessibilityRole="button" accessibilityLabel={'Sign out ' + session.deviceName} onPress={() => void revokeSession(session.id)} style={styles.sessionRevoke}><Text style={styles.sessionRevokeText}>Sign out</Text></Pressable>}
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
        <Pressable accessibilityRole="button" disabled={sessionsLoading} style={[styles.sheetSecondaryAction, sessionsLoading && styles.sheetActionDisabled]} onPress={() => void loadSessions()}><Text style={styles.sheetSecondaryActionText}>{sessionsLoading ? 'Refreshing…' : 'Refresh devices'}</Text></Pressable>
      </PageSection>

    </>
  );
}

function BlockedRidersPage(): React.JSX.Element {
  const { client } = useAuth();
  return (
    <PageSection note="Blocked riders can’t message you, see your location or hear you on voice.">
      <BlockedRidersList client={client} />
    </PageSection>
  );
}

function NavigationAppPage(): React.JSX.Element {
  const { navigationProvider, setNavigationProvider } = useSettings();
  return (
    <View style={styles.pageSection}>
      <View accessibilityRole="radiogroup" style={styles.settingsSheetSection}>
        {NAVIGATION_PROVIDER_OPTIONS.map((option) => <NavigationProviderRow key={option.id} provider={option.id} selected={navigationProvider === option.id} onSelect={() => setNavigationProvider(option.id)} />)}
      </View>
      <Text style={styles.pageSectionNote}>Rider Comms navigation stays in the app. Google Maps, Waze and Apple Maps hand the destination to that app.</Text>
    </View>
  );
}

function DistanceUnitsPage(): React.JSX.Element {
  const { unitSystem, setUnitSystem, loaded } = useSettings();
  return (
    <View style={styles.pageSection}>
      <View accessibilityRole="radiogroup" style={styles.settingsSheetSection}>
        {loaded ? UNIT_ORDER.map((unit) => <UnitRow key={unit} unit={unit} selected={unitSystem === unit} onSelect={() => setUnitSystem(unit)} />) : <ActivityIndicator style={styles.sheetLoader} color={colors.accent} />}
      </View>
    </View>
  );
}

// Help & Support's common questions; the PWA has the same list
// (scripts/check-client-parity.mjs keeps them equal).
export const HELP_FAQ: ReadonlyArray<readonly [string, string]> = [
  ['I can’t sign in', 'Use Forgot password? on the sign-in screen. We’ll email a reset link and code to the address on your account.'],
  ['I didn’t get the verification email', 'Check your spam folder, then open Settings → Account and login → Email and send a new one.'],
  ['Voice isn’t connecting', 'Check that Rider Comms can use your microphone and that you have a data connection. Your map and ride keep working while voice reconnects.'],
  ['My location isn’t showing', 'Location is only shared when you turn it on: Go live for Nearby, or the location switch in a group ride. Check that location access is allowed for Rider Comms.'],
  ['Someone is bothering me', 'Report and block them from their profile, a chat, the ride roster or a friend request. Reports are reviewed within 24 hours.'],
  ['How do I delete my account?', 'Settings → Account and login → Delete account. It permanently deletes your account and its data straight away.'],
];

function FaqItem({ question, answer, last }: { question: string; answer: string; last: boolean }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={[styles.faqItem, last && styles.settingRowLast]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={question}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.faqQuestion, pressed && styles.settingRowPressed]}
      >
        <Text style={[styles.settingRowTitle, styles.faqQuestionText]}>{question}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textMuted} />
      </Pressable>
      {open ? <Text style={styles.faqAnswer}>{answer}</Text> : null}
    </View>
  );
}

function HelpPage(): React.JSX.Element {
  const open = (url: string) => { void Linking.openURL(url).catch(() => undefined); };
  return (
    <>
      <View style={styles.pageSection}>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.myProfileEdit, styles.helpContact, pressed && styles.sheetActionDisabled]} onPress={() => open(LEGAL_LINKS.support)}>
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.accentText} />
          <Text style={styles.myProfileEditText}>Contact support</Text>
        </Pressable>
        <Text style={styles.pageSectionNote}>We reply within 2 working days. Safety reports made in the app are reviewed within 24 hours.</Text>
      </View>
      <SettingsSection title="Common questions">
        {HELP_FAQ.map(([question, answer], index) => <FaqItem key={question} question={question} answer={answer} last={index === HELP_FAQ.length - 1} />)}
      </SettingsSection>
      <PageSection title="Riding safely">
        <View style={styles.safetyRow}><Ionicons name="speedometer-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Set up while stationary</Text><Text style={styles.safetyCopy}>Complete profile, route and group controls before moving.</Text></View></View>
        <View style={styles.safetyRow}><Ionicons name="location-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Control your location</Text><Text style={styles.safetyCopy}>Nearby visibility and private-ride sharing can be stopped independently.</Text></View></View>
        <View style={styles.safetyRow}><Ionicons name="warning-outline" size={21} color={colors.warning} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Not an emergency service</Text><Text style={styles.safetyCopy}>Use the appropriate emergency service when urgent help is needed.</Text></View></View>
      </PageSection>
      <SettingsSection title="Legal">
        <SettingsRow icon="lock-closed-outline" title="Privacy Policy" onPress={() => open(LEGAL_LINKS.privacy)} />
        <SettingsRow icon="document-text-outline" title="Terms of Service" onPress={() => open(LEGAL_LINKS.terms)} />
        <SettingsRow icon="people-outline" title="Community Guidelines" last onPress={() => open(LEGAL_LINKS.guidelines)} />
      </SettingsSection>
    </>
  );
}

function AboutPage(): React.JSX.Element {
  const { displayName, handle } = useSettings();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  return (
    <>
      <PageSection>
        <View style={styles.aboutSummary}>
          <Text style={styles.aboutTitle}>Rider Comms</Text>
          <Text style={styles.aboutSummaryValue}>Version {appVersion} · Native</Text>
          <Text style={styles.aboutSummaryValue}>Signed in as {displayName} ({handle})</Text>
        </View>
      </PageSection>
    </>
  );
}

type SettingsPageProps = NativeStackScreenProps<RootStackParamList, 'SettingsPage'>;

/** One full page per Settings option, everything for it shown directly. */
export function SettingsPageScreen({ route }: SettingsPageProps): React.JSX.Element {
  const { page } = route.params;
  return (
    <SettingsPageLayout title={SETTINGS_PAGE_TITLES[page]} page={page}>
      {page === 'myProfile' ? <MyProfilePage /> : null}
      {page === 'editProfile' ? <EditProfilePage /> : null}
      {page === 'general' ? <GeneralPage /> : null}
      {page === 'mapNavigation' ? <MapNavigationPage /> : null}
      {page === 'rideSafe' ? <RideSafePage /> : null}
      {page === 'account' ? <AccountPage /> : null}
      {page === 'privacy' ? <PrivacyPage /> : null}
      {page === 'navigationApp' ? <NavigationAppPage /> : null}
      {page === 'distanceUnits' ? <DistanceUnitsPage /> : null}
      {page === 'blockedRiders' ? <BlockedRidersPage /> : null}
      {page === 'email' ? <EmailPage /> : null}
      {page === 'devices' ? <DevicesPage /> : null}
      {page === 'help' ? <HelpPage /> : null}
      {page === 'about' ? <AboutPage /> : null}
    </SettingsPageLayout>
  );
}
