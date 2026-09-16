// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Modal, Linking, RefreshControl, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { FriendRequest, FriendSummary } from '@rider-comms/shared';
import type { RootStackParamList } from '../navigation';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useFriends } from '../friends/FriendsContext';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_AVATAR_ID, getAvatarPreset } from '../settings/avatars';
import { RideBar } from '../ride/RideBar';
import { ScreenHeader } from '../components/ScreenHeader';
import type { PublicRiderProfile } from '../api/client';

function YourRiderIdCard(): React.JSX.Element {
  const { riderId } = useAuth();
  return (
    <View style={[styles.section, elevation.raised, styles.yourIdCard]}>
      <View style={styles.yourIdRow}>
        <View style={styles.yourIdBadge}>
          <Ionicons name="person-circle-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.yourIdInfo}>
          <Text style={styles.yourIdLabel}>Your rider ID</Text>
          <Text style={styles.yourIdValue} selectable>
            {riderId}
          </Text>
        </View>
      </View>
      {/* TODO: add a one-tap copy button once a clipboard dependency (e.g.
          expo-clipboard) is added to this app — for now, long-press to copy. */}
      <Text style={styles.addCaption}>
        Share this with a friend so they can add you back. Long-press the ID above to select and copy it.
      </Text>
    </View>
  );
}

function AddFriendCard(): React.JSX.Element {
  const { sendRequest } = useFriends();
  const [riderId, setRiderId] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [sentConfirmation, setSentConfirmation] = React.useState(false);
  const confirmationTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (confirmationTimeout.current) clearTimeout(confirmationTimeout.current);
    };
  }, []);

  const canSubmit = riderId.trim().length > 0 && !sending;

  const handleChangeText = React.useCallback((text: string) => {
    setRiderId(text);
    setInlineError(null);
  }, []);

  const handleSend = React.useCallback(async () => {
    const target = riderId.trim();
    if (!target) return;
    setSending(true);
    setInlineError(null);
    setSentConfirmation(false);
    try {
      await sendRequest(target);
      setRiderId('');
      setSentConfirmation(true);
      confirmationTimeout.current = setTimeout(() => setSentConfirmation(false), 2500);
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : 'Could not send that friend request.');
    } finally {
      setSending(false);
    }
  }, [riderId, sendRequest]);

  return (
    <View style={[styles.section, elevation.raised, styles.addCard]}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="@handle or Rider ID"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={riderId}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [
            styles.addButton,
            pressed && canSubmit && styles.addButtonPressed,
            !canSubmit && styles.addButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!canSubmit}
        >
          {sending ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <Ionicons name="paper-plane" size={18} color={colors.accentText} />
          )}
        </Pressable>
      </View>
      {inlineError ? (
        <Text style={styles.addInlineError}>{inlineError}</Text>
      ) : sentConfirmation ? (
        <Text style={styles.addInlineSuccess}>Request sent</Text>
      ) : (
        <Text style={styles.addCaption}>
          Enter an exact handle or complete Rider ID to send a private request.
        </Text>
      )}
    </View>
  );
}

function RequestRow({ request, profile }: { request: FriendRequest; profile?: FriendSummary }): React.JSX.Element {
  const { accept, decline } = useFriends();
  const avatar = getAvatarPreset(profile?.avatarId ?? DEFAULT_AVATAR_ID);
  const [resolving, setResolving] = React.useState<'accept' | 'decline' | null>(null);
  const resolve = async (action: 'accept' | 'decline') => {
    setResolving(action);
    try {
      if (action === 'accept') await accept(request.id);
      else await decline(request.id);
    } finally {
      setResolving(null);
    }
  };
  return (
    <View style={styles.requestRow}>
      <View style={[styles.requestAvatar, { backgroundColor: avatar.bg }]}>
        <MaterialCommunityIcons name={avatar.icon} size={20} color={colors.textPrimary} />
      </View>
      <View style={styles.requestIdentity}>
        <Text style={styles.requestName}>{profile?.displayName ?? 'Rider request'}</Text>
        <Text style={styles.requestHandle}>{profile?.handle ?? request.fromRiderId}</Text>
      </View>
      <Pressable style={styles.requestDecline} onPress={() => void resolve('decline')} disabled={resolving !== null} accessibilityLabel={`Decline request from ${profile?.displayName ?? 'rider'}`} hitSlop={8}>
        {resolving === 'decline' ? <ActivityIndicator color={colors.danger} size="small" /> : <Ionicons name="close" size={20} color={colors.danger} />}
      </Pressable>
      <Pressable style={styles.requestAccept} onPress={() => void resolve('accept')} disabled={resolving !== null} accessibilityLabel={`Accept request from ${profile?.displayName ?? 'rider'}`} hitSlop={8}>
        {resolving === 'accept' ? <ActivityIndicator color={colors.accentText} size="small" /> : <Ionicons name="checkmark" size={20} color={colors.accentText} />}
      </Pressable>
    </View>
  );
}

function OutgoingRequestRow({ request, profile }: { request: FriendRequest; profile?: FriendSummary }): React.JSX.Element {
  const avatar = getAvatarPreset(profile?.avatarId ?? DEFAULT_AVATAR_ID);
  return (
    <View style={styles.requestRow}>
      <View style={[styles.requestAvatar, { backgroundColor: avatar.bg }]}>
        <MaterialCommunityIcons name={avatar.icon} size={20} color={colors.textPrimary} />
      </View>
      <View style={styles.requestIdentity}>
        <Text style={styles.requestName}>{profile?.displayName ?? 'Pending request'}</Text>
        <Text style={styles.requestHandle}>{profile?.handle ?? request.toRiderId}</Text>
      </View>
      <View style={styles.pendingPill}><Text style={styles.pendingPillText}>Pending</Text></View>
    </View>
  );
}

function FriendRow({ friend, onProfile }: { friend: FriendSummary; onProfile: (friend: FriendSummary) => void }): React.JSX.Element {
  const { remove } = useFriends();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const avatar = getAvatarPreset(friend.avatarId);

  const confirmRemove = () => {
    Alert.alert('Remove friend?', `${friend.displayName} will be removed from your friends list.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(friend.riderId) },
    ]);
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.friendRow, pressed && styles.friendRowPressed]}
      onPress={() =>
        navigation.navigate('FriendChat', {
          riderId: friend.riderId,
          displayName: friend.displayName,
          avatarId: friend.avatarId,
        })
      }
    >
      <View style={[styles.friendAvatar, { backgroundColor: avatar.bg }]}>
        <MaterialCommunityIcons name={avatar.icon} size={22} color={colors.textPrimary} />
      </View>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{friend.displayName}</Text>
        <Text style={styles.friendHandle}>{friend.handle}</Text>
      </View>
      <Pressable
        style={styles.friendProfileButton}
        onPress={() => onProfile(friend)}
        accessibilityRole="button"
        accessibilityLabel={`View ${friend.displayName}'s profile`}
        hitSlop={8}
      >
        <Ionicons name="information-circle-outline" size={22} color={colors.textSecondary} />
      </Pressable>
      <Pressable style={styles.friendRemove} onPress={confirmRemove} accessibilityLabel={`Remove ${friend.displayName}`} hitSlop={8}>
        <Ionicons name="person-remove-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

function FriendProfileModal({
  friend,
  onClose,
}: {
  friend: FriendSummary | null;
  onClose: () => void;
}): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client } = useAuth();
  const { refresh } = useFriends();
  const [profile, setProfile] = React.useState<PublicRiderProfile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!friend) {
      setProfile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client.getPublicProfile(friend.riderId)
      .then((next) => { if (!cancelled) setProfile(next); })
      .catch(() => { if (!cancelled) setError('Could not refresh this profile.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, friend]);

  if (!friend) return <></>;
  const avatar = getAvatarPreset(profile?.avatarId ?? friend.avatarId);
  const openSocial = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Couldn’t open link', 'This profile link could not be opened.'));
  };
  const report = (reason: 'harassment' | 'unsafe' | 'spam') => {
    void client.reportRider(friend.riderId, reason, 'Reported from the friend profile')
      .then(() => Alert.alert('Report received', 'Thank you. The report has been recorded for review.'))
      .catch(() => Alert.alert('Couldn’t send report', 'Please try again when you have a connection.'));
  };
  const safetyActions = () => Alert.alert('Safety options', `Choose what to do about ${friend.displayName}.`, [
    { text: 'Report harassment', onPress: () => report('harassment') },
    { text: 'Report spam', onPress: () => report('spam') },
    { text: 'Block rider', style: 'destructive', onPress: () => {
      void client.blockRider(friend.riderId)
        .then(async () => { await refresh(); onClose(); })
        .catch(() => Alert.alert('Couldn’t block rider', 'Please try again.'));
    } },
    { text: 'Cancel', style: 'cancel' },
  ]);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.profileModal} onPress={(event) => event.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Pressable style={styles.modalClose} onPress={onClose} accessibilityLabel="Close profile">
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={[styles.profileModalAvatar, { backgroundColor: avatar.bg }]}>
            <MaterialCommunityIcons name={avatar.icon} size={32} color={colors.textPrimary} />
          </View>
          <Text style={styles.profileModalName}>{profile?.displayName ?? friend.displayName}</Text>
          <Text style={styles.profileModalHandle}>{profile?.handle ?? friend.handle}</Text>
          {loading && <ActivityIndicator style={styles.profileLoader} color={colors.accent} />}
          {error && <Text style={styles.profileError}>{error}</Text>}
          {(profile?.instagramUsername || profile?.tiktokUsername) ? (
            <View style={styles.socialList}>
              {profile.instagramUsername ? (
                <Pressable style={styles.socialRow} onPress={() => openSocial(`https://www.instagram.com/${encodeURIComponent(profile.instagramUsername)}/`)}>
                  <Ionicons name="logo-instagram" size={20} color={colors.textPrimary} />
                  <Text style={styles.socialText}>@{profile.instagramUsername}</Text>
                  <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
              {profile.tiktokUsername ? (
                <Pressable style={styles.socialRow} onPress={() => openSocial(`https://www.tiktok.com/@${encodeURIComponent(profile.tiktokUsername)}`)}>
                  <Ionicons name="logo-tiktok" size={20} color={colors.textPrimary} />
                  <Text style={styles.socialText}>@{profile.tiktokUsername}</Text>
                  <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : !loading ? <Text style={styles.profilePrivacyNote}>No connected profiles are shared with you.</Text> : null}
          <Pressable style={styles.profileMessageButton} onPress={() => {
            onClose();
            navigation.navigate('FriendChat', { riderId: friend.riderId, displayName: friend.displayName, avatarId: friend.avatarId });
          }}>
            <Ionicons name="chatbubble-outline" size={19} color={colors.accentText} />
            <Text style={styles.profileMessageButtonText}>Message</Text>
          </Pressable>
          <Pressable style={styles.profileSafetyButton} onPress={safetyActions}>
            <Ionicons name="shield-outline" size={18} color={colors.danger} />
            <Text style={styles.profileSafetyText}>Safety options</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FriendsScreen(): React.JSX.Element {
  const { friends, incomingRequests, outgoingRequests, requestProfiles, loading, error, refresh } = useFriends();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = React.useState('');
  const [selectedProfile, setSelectedProfile] = React.useState<FriendSummary | null>(null);
  const filteredFriends = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return friends;
    return friends.filter((friend) => [friend.displayName, friend.handle, friend.riderId]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [friends, query]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.accent} />}
      >
        <ScreenHeader
          title="Friends"
          subtitle="Your private rider network."
        />

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void refresh()} hitSlop={8}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        )}

        <View style={styles.sectionLabelRow}>
          <Ionicons name="person-circle-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Your ID</Text>
        </View>
        <YourRiderIdCard />

        <View style={styles.sectionLabelRow}>
          <Ionicons name="person-add-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Add friend</Text>
        </View>
        <AddFriendCard />

        {incomingRequests.length > 0 && (
          <>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="mail-open-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Requests</Text>
            </View>
            <View style={[styles.section, elevation.raised]}>
              {incomingRequests.map((request) => (
                <RequestRow key={request.id} request={request} profile={requestProfiles[request.fromRiderId]} />
              ))}
            </View>
          </>
        )}

        {outgoingRequests.length > 0 && (
          <>
            <View style={styles.sectionLabelRow}>
              <Ionicons name="paper-plane-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Sent requests</Text>
            </View>
            <View style={[styles.section, elevation.raised]}>
              {outgoingRequests.map((request) => (
                <OutgoingRequestRow key={request.id} request={request} profile={requestProfiles[request.toRiderId]} />
              ))}
            </View>
          </>
        )}

        <View style={styles.sectionLabelRow}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Friends</Text>
        </View>
        {friends.length > 0 && (
          <View style={styles.friendSearchRow}>
            <Ionicons name="search" size={19} color={colors.textMuted} />
            <TextInput
              style={styles.friendSearchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search your friends"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
          </View>
        )}
        <View style={[styles.section, elevation.raised]}>
          {loading && friends.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Build your riding circle</Text>
              <Text style={styles.emptyText}>Add someone you know using their handle or Rider ID.</Text>
            </View>
          ) : filteredFriends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No matching friends</Text>
              <Text style={styles.emptyText}>Try a different name, handle, or Rider ID.</Text>
            </View>
          ) : (
            filteredFriends.map((friend) => <FriendRow key={friend.riderId} friend={friend} onProfile={setSelectedProfile} />)
          )}
        </View>
      </ScrollView>

      <RideBar />
      <FriendProfileModal friend={selectedProfile} onClose={() => setSelectedProfile(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: spacing.lg },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  retryText: { ...type.button, color: colors.danger },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sectionLabel: { ...type.label, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md },
  addCard: { padding: spacing.md, gap: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  addInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    ...type.body,
    color: colors.textPrimary,
  },
  addButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonPressed: { backgroundColor: colors.accentPressed },
  addButtonDisabled: { opacity: 0.5 },
  addCaption: { ...type.caption },
  addInlineError: { ...type.caption, color: colors.danger },
  addInlineSuccess: { ...type.caption, color: colors.success, fontWeight: '700' },
  yourIdCard: { padding: spacing.md, gap: spacing.sm },
  yourIdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  yourIdBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yourIdInfo: { flex: 1, gap: spacing.xs },
  yourIdLabel: { ...type.caption },
  yourIdValue: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  requestAvatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestIdentity: { flex: 1, minWidth: 0, gap: 2 },
  requestName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  requestHandle: { ...type.caption },
  requestDecline: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAccept: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingPill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.surfaceRaised, borderRadius: radii.pill },
  pendingPillText: { ...type.caption, fontWeight: '700' },
  friendSearchRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  friendSearchInput: { ...type.body, color: colors.textPrimary, flex: 1, minHeight: MIN_TOUCH_TARGET },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  friendRowPressed: { backgroundColor: colors.surfaceRaised },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInfo: { flex: 1, gap: spacing.xs },
  friendName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  friendHandle: { ...type.caption },
  friendProfileButton: { padding: spacing.xs },
  friendRemove: { padding: spacing.xs },
  emptyState: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...type.subheading, color: colors.textPrimary },
  emptyText: { ...type.caption, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  profileModal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  modalHandle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, marginBottom: spacing.md },
  modalClose: { position: 'absolute', right: spacing.md, top: spacing.md, width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  profileModalAvatar: { width: 68, height: 68, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  profileModalName: { ...type.heading, marginTop: spacing.md },
  profileModalHandle: { ...type.body, color: colors.textSecondary, marginTop: spacing.xs },
  profileLoader: { marginTop: spacing.md },
  profileError: { ...type.caption, color: colors.danger, marginTop: spacing.md },
  profilePrivacyNote: { ...type.caption, textAlign: 'center', marginVertical: spacing.lg },
  socialList: { width: '100%', marginVertical: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  socialRow: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  socialText: { ...type.body, color: colors.textPrimary, flex: 1 },
  profileMessageButton: { width: '100%', minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.accent, marginTop: spacing.md },
  profileMessageButtonText: { ...type.button, color: colors.accentText },
  profileSafetyButton: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  profileSafetyText: { ...type.button, color: colors.danger },
});
