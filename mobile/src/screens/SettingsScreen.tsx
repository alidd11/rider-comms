import * as React from 'react';
import { View, Text, Pressable, TextInput, ScrollView, Modal, Switch, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
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


/** Each Settings option is its own page; these keys name them (and match
 * the PWA's settings sheet tokens, see scripts/check-client-parity.mjs). */
export type SettingsPageKey = 'myProfile' | 'editProfile' | 'accountHub' | 'communication' | 'mapNavigation' | 'unitsPreferences' | 'help' | 'about';

export const SETTINGS_PAGE_TITLES: Record<SettingsPageKey, string> = {
  myProfile: 'Profile',
  editProfile: 'Edit profile',
  accountHub: 'Account',
  communication: 'Communication',
  mapNavigation: 'Map & Navigation',
  unitsPreferences: 'Units & Preferences',
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

/** Full-screen settings page: back chevron, title, scrolling content. */
function SettingsPageLayout({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
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

export function SettingsScreen(): React.JSX.Element {
  const { profileError, clearProfileError } = useSettings();
  const { logOut } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openPage = (page: SettingsPageKey) => navigation.push('SettingsPage', { page });

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
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />

        {profileError ? (
          <View style={styles.profileSaveStatus} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={17} color={colors.danger} />
            <Text style={styles.profileSaveError}>{profileError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss settings error" onPress={clearProfileError} hitSlop={8}><Ionicons name="close" size={18} color={colors.textMuted} /></Pressable>
          </View>
        ) : null}

        <View style={styles.settingsGroup}>
          <SettingsRow icon="person-outline" title="Account" subtitle="Email, devices and data" onPress={() => openPage('accountHub')} />
          <SettingsRow icon="chatbubble-ellipses-outline" title="Communication" subtitle="Live location and blocked riders" onPress={() => openPage('communication')} />
          <SettingsRow icon="map-outline" title="Map & Navigation" subtitle="Navigation app and route options" onPress={() => openPage('mapNavigation')} />
          <SettingsRow icon="apps-outline" title="Units & Preferences" last onPress={() => openPage('unitsPreferences')} />
        </View>

        <View style={[styles.settingsGroup, styles.secondarySettingsGroup]}>
          <SettingsRow icon="information-circle-outline" title="About" last onPress={() => openPage('about')} />
        </View>

        <View style={[styles.settingsGroup, styles.signOutGroup]}>
          <SettingsRow icon="log-out-outline" title="Sign Out" danger showChevron={false} last onPress={confirmLogOut} />
        </View>
      </ScrollView>
      <RideBar />
    </View>
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

/** Account: sign-in email, signed-in devices, reset and delete. */
function AccountPage(): React.JSX.Element {
  const { resetAll } = useSettings();
  const { emailVerified, client, deleteAccount } = useAuth();
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

  React.useEffect(() => { void loadSessions(); }, [loadSessions]);
  React.useEffect(() => { setVerificationConfirmed(emailVerified); }, [emailVerified]);

  async function revokeSession(id: string) {
    try {
      await client.revokeSession(id);
      setSessions((current) => current.filter((session) => session.id !== id));
    } catch {
      Alert.alert('Couldn’t revoke session', 'Please check your connection and try again.');
    }
  }

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

  return (
    <>
      <PageSection title="Email">
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

      <PageSection title="Signed-in devices" note="Sign out any device you don’t recognise.">
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

      <PageSection title="Account and data">
        <Text style={styles.sheetBodyCopy}>Reset your Rider Comms profile and preferences to their defaults, or permanently delete your account and associated data.</Text>
        <Pressable accessibilityRole="button" style={styles.sheetSecondaryAction} onPress={confirmReset}><Text style={styles.sheetSecondaryActionText}>Reset settings</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.sheetDangerAction} onPress={confirmDeleteAccount}><Text style={styles.sheetDangerActionText}>Delete account</Text></Pressable>
      </PageSection>
    </>
  );
}

function CommunicationPage(): React.JSX.Element {
  const { shareLocation, setShareLocation } = useSettings();
  const { client } = useAuth();
  return (
    <>
      <PageSection
        title="Live location"
        note="Private-ride location is separate: you choose it inside each ride, and it’s off unless you switch it on."
      >
        <ToggleRow icon="location-outline" label="Nearby rider visibility" value={shareLocation} onValueChange={setShareLocation} caption="Nearby riders can see you only while you’re live." />
      </PageSection>
      <PageSection title="Blocked riders" note="Blocked riders can’t message you, see your location or hear you on voice.">
        <BlockedRidersList client={client} />
      </PageSection>
    </>
  );
}

function MapNavigationPage(): React.JSX.Element {
  const { navigationProvider, setNavigationProvider, routeAvoidance, setRouteAvoidance } = useSettings();
  return (
    <>
      <View style={styles.pageSection}>
        <Text style={styles.pageSectionTitle} accessibilityRole="header">Navigation app</Text>
        <View accessibilityRole="radiogroup" style={styles.settingsSheetSection}>
          {NAVIGATION_PROVIDER_OPTIONS.map((option) => <NavigationProviderRow key={option.id} provider={option.id} selected={navigationProvider === option.id} onSelect={() => setNavigationProvider(option.id)} />)}
        </View>
      </View>
      <PageSection title="Route options">
        <ToggleRow icon="speedometer-outline" label="Avoid motorways" value={routeAvoidance.highways} onValueChange={(highways) => setRouteAvoidance({ ...routeAvoidance, highways })} caption="Plan Rider Comms routes on A and B roads where possible." />
        <ToggleRow icon="cash-outline" label="Avoid tolls" value={routeAvoidance.tolls} onValueChange={(tolls) => setRouteAvoidance({ ...routeAvoidance, tolls })} caption="Skip toll roads and bridges where there is another way." />
      </PageSection>
    </>
  );
}

function UnitsPreferencesPage(): React.JSX.Element {
  const { unitSystem, setUnitSystem, rideSafeEnabled, setRideSafeEnabled, loaded } = useSettings();

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

  return (
    <>
      <View style={styles.pageSection}>
        <Text style={styles.pageSectionTitle} accessibilityRole="header">Distance units</Text>
        <View accessibilityRole="radiogroup" style={styles.settingsSheetSection}>
          {loaded ? UNIT_ORDER.map((unit) => <UnitRow key={unit} unit={unit} selected={unitSystem === unit} onSelect={() => setUnitSystem(unit)} />) : <ActivityIndicator style={styles.sheetLoader} color={colors.accent} />}
        </View>
      </View>
      <PageSection
        title="Ride Safe"
        note="When off, Rider Comms stops its dedicated Ride Safe location watcher. Map, navigation and optional ride-location features request location separately. Only change this while safely stopped."
      >
        <ToggleRow
          icon="shield-checkmark-outline"
          label="Automatic Ride Safe"
          value={rideSafeEnabled}
          onValueChange={changeRideSafePreference}
          caption="Uses motion from this device to lock distracting controls at 8 mph and above. Recommended while riding."
        />
      </PageSection>
    </>
  );
}

function HelpPage(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <>
      <PageSection title="Riding safely">
        <View style={styles.safetyRow}><Ionicons name="speedometer-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Set up while stationary</Text><Text style={styles.safetyCopy}>Complete profile, route and group controls before moving.</Text></View></View>
        <View style={styles.safetyRow}><Ionicons name="location-outline" size={21} color={colors.accent} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Control your location</Text><Text style={styles.safetyCopy}>Nearby visibility and private-ride sharing can be stopped independently.</Text></View></View>
        <View style={styles.safetyRow}><Ionicons name="warning-outline" size={21} color={colors.warning} /><View style={styles.safetyCopyWrap}><Text style={styles.safetyTitle}>Not an emergency service</Text><Text style={styles.safetyCopy}>Use the appropriate emergency service when urgent help is needed.</Text></View></View>
      </PageSection>
      <PageSection title="Get help">
        <SettingsRow icon="help-buoy-outline" title="Contact support" subtitle="Help, account deletion and how to reach us" onPress={() => { void Linking.openURL(LEGAL_LINKS.support).catch(() => undefined); }} />
        <SettingsRow icon="document-text-outline" title="Privacy, safety & terms" subtitle="Read Rider Comms legal and safety information" last onPress={() => navigation.navigate('Legal')} />
      </PageSection>
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
    <SettingsPageLayout title={SETTINGS_PAGE_TITLES[page]}>
      {page === 'myProfile' ? <MyProfilePage /> : null}
      {page === 'editProfile' ? <EditProfilePage /> : null}
      {page === 'accountHub' ? <AccountPage /> : null}
      {page === 'communication' ? <CommunicationPage /> : null}
      {page === 'mapNavigation' ? <MapNavigationPage /> : null}
      {page === 'unitsPreferences' ? <UnitsPreferencesPage /> : null}
      {page === 'help' ? <HelpPage /> : null}
      {page === 'about' ? <AboutPage /> : null}
    </SettingsPageLayout>
  );
}
