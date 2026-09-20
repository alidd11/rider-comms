// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, Modal, Linking, RefreshControl, Share, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { FriendActivity, FriendRequest, FriendSummary } from '@rider-comms/shared';
import type { RootStackParamList } from '../navigation';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useFriends } from '../friends/FriendsContext';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_AVATAR_ID } from '../settings/avatars';
import { RideBar } from '../ride/RideBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { RiderAvatar } from '../components/RiderAvatar';
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
      <RiderAvatar avatarId={profile?.avatarId ?? DEFAULT_AVATAR_ID} size={40} />
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
  const { cancel } = useFriends();
  const [cancelling, setCancelling] = React.useState(false);
  const handleCancel = async () => {
    setCancelling(true);
    try { await cancel(request.id); } finally { setCancelling(false); }
  };
  return (
    <View style={styles.requestRow}>
      <RiderAvatar avatarId={profile?.avatarId ?? DEFAULT_AVATAR_ID} size={40} />
      <View style={styles.requestIdentity}>
        <Text style={styles.requestName}>{profile?.displayName ?? 'Pending request'}</Text>
        <Text style={styles.requestHandle}>{profile?.handle ?? request.toRiderId}</Text>
      </View>
      <Pressable style={styles.cancelRequestButton} onPress={() => void handleCancel()} disabled={cancelling} accessibilityLabel={`Cancel request to ${profile?.displayName ?? 'rider'}`}>
        {cancelling ? <ActivityIndicator color={colors.textMuted} size="small" /> : <Text style={styles.cancelRequestText}>Cancel</Text>}
      </Pressable>
    </View>
  );
}

function activityLabel(activity?: FriendActivity): string {
  if (!activity) return 'Connected';
  if (activity.online) return 'Online now';
  if (!activity.lastSeenAt) return 'Offline';
  const elapsed = Math.max(0, Date.now() - activity.lastSeenAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Last seen ${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

function FriendRow({
  friend,
  activity,
  unreadCount,
  onProfile,
}: {
  friend: FriendSummary;
  activity?: FriendActivity;
  unreadCount: number;
  onProfile: (friend: FriendSummary) => void;
}): React.JSX.Element {
  return (
    <Pressable
      style={({ pressed }) => [styles.friendRow, pressed && styles.friendRowPressed]}
      onPress={() => onProfile(friend)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${friend.displayName}'s rider profile`}
    >
      <View style={styles.friendAvatarWrap}>
        <RiderAvatar avatarId={friend.avatarId} size={44} status={activity?.online ? 'online' : 'stale'} />
      </View>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{friend.displayName}</Text>
        <Text style={[styles.friendHandle, activity?.online && styles.friendHandleOnline]}>{activityLabel(activity)}</Text>
      </View>
      {unreadCount > 0 ? <View style={styles.unreadPill}><Text style={styles.unreadPillText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
      <Ionicons name="ellipsis-horizontal" size={21} color={colors.textMuted} />
    </Pressable>
  );
}

function FriendProfileModal({
  friend,
  activity,
  onClose,
}: {
  friend: FriendSummary | null;
  activity?: FriendActivity;
  onClose: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client } = useAuth();
  const { refresh, remove } = useFriends();
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
  const openSocial = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Couldn’t open link', 'This profile link could not be opened.'));
  };
  const report = (reason: 'harassment' | 'unsafe' | 'spam') => {
    void client.reportRider(friend.riderId, reason, 'Reported from the friend profile')
      .then(() => Alert.alert('Report received', 'Thank you. The report has been recorded for review.'))
      .catch(() => Alert.alert('Couldn’t send report', 'Please try again when you have a connection.'));
  };
  const confirmRemove = () => Alert.alert('Remove friend?', `${friend.displayName} will be removed from your friends list.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => {
      void remove(friend.riderId).then(onClose);
    } },
  ]);
  const safetyActions = () => Alert.alert('More actions', `Choose what to do about ${friend.displayName}.`, [
    { text: 'Remove friend', onPress: confirmRemove },
    { text: 'Report harassment', onPress: () => report('harassment') },
    { text: 'Report unsafe behaviour', onPress: () => report('unsafe') },
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
        <Pressable style={[styles.profileModal, { paddingBottom: insets.bottom + spacing.md }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Pressable style={styles.modalClose} onPress={onClose} accessibilityLabel="Close profile">
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </Pressable>

          <View style={styles.profileIdentity}>
            <View style={styles.profileAvatarWrap}>
              <RiderAvatar avatarId={profile?.avatarId ?? friend.avatarId} size={64} status={activity?.online ? 'online' : 'stale'} />
            </View>
            <View style={styles.profileIdentityCopy}>
              <Text style={styles.profileModalName}>{profile?.displayName ?? friend.displayName}</Text>
              <Text style={styles.profileModalHandle}>{profile?.handle ?? friend.handle}</Text>
              <Text style={[styles.profileActivity, activity?.online && styles.profileActivityOnline]}>{activityLabel(activity)}</Text>
            </View>
          </View>

          {loading && <ActivityIndicator style={styles.profileLoader} color={colors.accent} />}
          {error && <Text style={styles.profileError}>{error}</Text>}

          <View style={styles.profileActions}>
            <Pressable style={styles.profileAction} onPress={() => {
              onClose();
              navigation.navigate('FriendChat', { riderId: friend.riderId, displayName: friend.displayName, avatarId: friend.avatarId });
            }}>
              <Ionicons name="chatbubble" size={20} color={colors.accent} />
              <Text style={styles.profileActionText}>Message</Text>
            </Pressable>
            <Pressable style={styles.profileAction} onPress={() => {
              void Share.share({ message: `${profile?.displayName ?? friend.displayName} on Rider Comms: ${friend.riderId}` });
            }}>
              <Ionicons name="share-outline" size={21} color={colors.accent} />
              <Text style={styles.profileActionText}>Share ID</Text>
            </Pressable>
            <Pressable style={styles.profileAction} onPress={safetyActions}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
              <Text style={styles.profileActionText}>More</Text>
            </Pressable>
          </View>

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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FriendsScreen(): React.JSX.Element {
  const { friends, incomingRequests, outgoingRequests, requestProfiles, activityByRider, conversations, loading, error, refresh } = useFriends();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = React.useState('');
  const [selectedProfile, setSelectedProfile] = React.useState<FriendSummary | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const filteredFriends = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return friends;
    return friends.filter((friend) => [friend.displayName, friend.handle, friend.riderId]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }, [friends, query]);
  const unreadByRider = React.useMemo(
    () => Object.fromEntries(conversations.map((conversation) => [conversation.friend.riderId, conversation.unreadCount])),
    [conversations],
  );
  const onlineFriends = filteredFriends.filter((friend) => activityByRider[friend.riderId]?.online);
  const offlineFriends = filteredFriends.filter((friend) => !activityByRider[friend.riderId]?.online);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.accent} />}
      >
        <ScreenHeader
          title="Friends"
          action={(
            <Pressable
              style={({ pressed }) => [styles.headerAdd, addOpen && styles.headerAddActive, pressed && styles.headerAddPressed]}
              onPress={() => setAddOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={addOpen ? 'Close add friend' : 'Add friend'}
            >
              <Ionicons name={addOpen ? 'close' : 'person-add-outline'} size={21} color={addOpen ? colors.accentText : colors.accent} />
            </Pressable>
          )}
        />

        <View style={styles.friendSearchRow}>
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <TextInput
            style={styles.friendSearchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search friends"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={19} color={colors.textMuted} /></Pressable> : null}
        </View>

        {addOpen ? (
          <View style={styles.addPanel}>
            <AddFriendCard />
            <YourRiderIdCard />
          </View>
        ) : null}

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void refresh()} hitSlop={8}><Text style={styles.retryText}>Retry</Text></Pressable>
          </View>
        )}

        {incomingRequests.length > 0 && (
          <>
            <Text style={styles.networkSectionLabel}>Requests ({incomingRequests.length})</Text>
            <View style={styles.section}>
              {incomingRequests.map((request) => (
                <RequestRow key={request.id} request={request} profile={requestProfiles[request.fromRiderId]} />
              ))}
            </View>
          </>
        )}

        {outgoingRequests.length > 0 && (
          <>
            <Text style={styles.networkSectionLabel}>Sent ({outgoingRequests.length})</Text>
            <View style={styles.section}>
              {outgoingRequests.map((request) => (
                <OutgoingRequestRow key={request.id} request={request} profile={requestProfiles[request.toRiderId]} />
              ))}
            </View>
          </>
        )}

        {loading && friends.length === 0 ? (
          <View style={styles.emptyState}><ActivityIndicator color={colors.accent} /></View>
        ) : friends.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Build your riding circle</Text>
            <Text style={styles.emptyText}>Use the add button above to connect by handle or Rider ID.</Text>
          </View>
        ) : filteredFriends.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No matching friends</Text>
            <Text style={styles.emptyText}>Try a different name, handle, or Rider ID.</Text>
          </View>
        ) : (
          <View style={styles.networkList}>
            {onlineFriends.length > 0 ? (
              <>
                <Text style={styles.networkSectionLabel}>Online ({onlineFriends.length})</Text>
                {onlineFriends.map((friend) => (
                  <FriendRow key={friend.riderId} friend={friend} activity={activityByRider[friend.riderId]} unreadCount={unreadByRider[friend.riderId] ?? 0} onProfile={setSelectedProfile} />
                ))}
              </>
            ) : null}
            {offlineFriends.length > 0 ? (
              <>
                <Text style={styles.networkSectionLabel}>Offline ({offlineFriends.length})</Text>
                {offlineFriends.map((friend) => (
                  <FriendRow key={friend.riderId} friend={friend} activity={activityByRider[friend.riderId]} unreadCount={unreadByRider[friend.riderId] ?? 0} onProfile={setSelectedProfile} />
                ))}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <RideBar />
      <FriendProfileModal
        friend={selectedProfile}
        activity={selectedProfile ? activityByRider[selectedProfile.riderId] : undefined}
        onClose={() => setSelectedProfile(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: spacing.xxl },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.dangerSurface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  retryText: { ...type.button, color: colors.danger },
  section: { backgroundColor: colors.surface, borderRadius: radii.md, overflow: 'hidden', marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  headerAdd: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', borderWidth: 0, backgroundColor: 'transparent' },
  headerAddActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  headerAddPressed: { opacity: 0.78 },
  addPanel: { gap: spacing.sm, marginBottom: spacing.md },
  addCard: { padding: spacing.md, gap: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  addInput: { flex: 1, minHeight: MIN_TOUCH_TARGET, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radii.md, paddingHorizontal: spacing.md, ...type.body, color: colors.textPrimary },
  addButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  addButtonPressed: { backgroundColor: colors.accentPressed },
  addButtonDisabled: { opacity: 0.5 },
  addCaption: { ...type.caption },
  addInlineError: { ...type.caption, color: colors.danger },
  addInlineSuccess: { ...type.caption, color: colors.success, fontWeight: '700' },
  yourIdCard: { padding: spacing.md, gap: spacing.sm },
  yourIdRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  yourIdBadge: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  yourIdInfo: { flex: 1, gap: spacing.xs },
  yourIdLabel: { ...type.caption },
  yourIdValue: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  requestAvatar: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  requestIdentity: { flex: 1, minWidth: 0, gap: 2 },
  requestName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  requestHandle: { ...type.caption },
  requestDecline: { width: 44, height: 44, borderRadius: radii.md, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  requestAccept: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pendingPill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.surfaceRaised, borderRadius: radii.pill },
  pendingPillText: { ...type.caption, fontWeight: '700' },
  cancelRequestButton: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  cancelRequestText: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  unreadPill: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  unreadPillText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
  friendSearchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: 11, marginBottom: 2 },
  friendSearchInput: { ...type.body, color: colors.textPrimary, flex: 1, minHeight: MIN_TOUCH_TARGET },
  networkList: { marginTop: spacing.xs },
  networkSectionLabel: { ...type.label, color: colors.textSecondary, marginTop: 14, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1.1, fontSize: 10 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  friendRowPressed: { opacity: 0.72 },
  friendAvatarWrap: { position: 'relative' },
  friendAvatar: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  friendPresence: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.background },
  friendPresenceOnline: { backgroundColor: colors.success },
  friendPresenceOffline: { backgroundColor: colors.textMuted },
  friendInfo: { flex: 1, gap: 2 },
  friendName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  friendHandle: { ...type.caption, color: colors.textSecondary, fontSize: 11 },
  friendHandleOnline: { color: colors.success },
  emptyState: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...type.subheading, color: colors.textPrimary },
  emptyText: { ...type.caption, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  profileModal: { backgroundColor: colors.background, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: colors.border, padding: spacing.md, paddingBottom: spacing.xl },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, marginBottom: spacing.md },
  modalClose: { position: 'absolute', right: spacing.md, top: spacing.md, width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  profileIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: MIN_TOUCH_TARGET + spacing.sm, marginTop: 2 },
  profileAvatarWrap: { position: 'relative' },
  profileModalAvatar: { width: 56, height: 56, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  profilePresence: { position: 'absolute', right: 1, bottom: 1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.background },
  profileIdentityCopy: { flex: 1, minWidth: 0 },
  profileModalName: { ...type.heading, color: colors.textPrimary },
  profileModalHandle: { ...type.body, color: colors.textSecondary, marginTop: 1 },
  profileActivity: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs },
  profileActivityOnline: { color: colors.success, fontWeight: '700' },
  profileLoader: { marginTop: spacing.md },
  profileError: { ...type.caption, color: colors.danger, marginTop: spacing.md },
  profileActions: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  profileAction: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  profileActionText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  profilePrivacyNote: { ...type.caption, color: colors.textSecondary, marginTop: 12, padding: 11, backgroundColor: colors.surface, borderRadius: radii.lg },
  socialList: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.lg, overflow: 'hidden' },
  socialRow: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  socialText: { ...type.body, color: colors.textPrimary, flex: 1 },
});
