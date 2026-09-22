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
import { useRide } from '../ride/RideContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { RiderAvatar } from '../components/RiderAvatar';
import type { PublicRiderProfile, RideMemberLocation } from '../api/client';

const FRIEND_RIDE_LOCATION_STALE_MS = 20_000;

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
  if (!activity) return 'Offline';
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
  inActiveRide,
  onProfile,
}: {
  friend: FriendSummary;
  activity?: FriendActivity;
  unreadCount: number;
  inActiveRide: boolean;
  onProfile: (friend: FriendSummary) => void;
}): React.JSX.Element {
  const activityCopy = inActiveRide ? 'In your group ride' : activityLabel(activity);
  return (
    <Pressable
      style={({ pressed }) => [styles.friendRow, pressed && styles.friendRowPressed]}
      onPress={() => onProfile(friend)}
      accessibilityRole="button"
      accessibilityLabel={`${friend.displayName}, ${activityCopy}. Open rider profile`}
    >
      <View style={styles.friendAvatarWrap}>
        <RiderAvatar avatarId={friend.avatarId} size={40} />
        <View style={[styles.friendPresenceDot, activity?.online ? styles.friendPresenceOnline : styles.friendPresenceOffline]} />
      </View>
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{friend.displayName}</Text>
        <Text style={styles.friendHandle}>{activityCopy}</Text>
      </View>
      {unreadCount > 0 ? <View style={styles.unreadPill}><Text style={styles.unreadPillText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
      <Ionicons name="ellipsis-horizontal" size={21} color={colors.textMuted} />
    </Pressable>
  );
}

function FriendProfileModal({
  friend,
  activity,
  profileRevision,
  inActiveRide,
  rideLocation,
  rideMemberCount,
  shareRideLocation,
  setRideLocationSharing,
  onClose,
}: {
  friend: FriendSummary | null;
  activity?: FriendActivity;
  profileRevision: number;
  inActiveRide: boolean;
  rideLocation?: RideMemberLocation;
  rideMemberCount: number;
  shareRideLocation: boolean;
  setRideLocationSharing: (enabled: boolean) => Promise<boolean>;
  onClose: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { client } = useAuth();
  const { refresh, remove } = useFriends();
  const [profile, setProfile] = React.useState<PublicRiderProfile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [locationShareBusy, setLocationShareBusy] = React.useState(false);

  React.useEffect(() => {
    if (!friend) {
      setProfile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    // Drop previously-visible social links immediately when realtime says this
    // profile changed. Only the new authoritative response may reveal them.
    setProfile(null);
    setLoading(true);
    setError(null);
    void client.getPublicProfile(friend.riderId)
      .then((next) => { if (!cancelled) setProfile(next); })
      .catch(() => { if (!cancelled) setError('Could not refresh this profile.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, friend?.riderId, profileRevision]);

  if (!friend) return <></>;
  const activityCopy = activityLabel(activity);
  const sharedProfileCount = Number(Boolean(profile?.instagramUsername)) + Number(Boolean(profile?.tiktokUsername));
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
      void remove(friend.riderId)
        .then(onClose)
        .catch(() => Alert.alert('Couldn’t remove friend', 'Please try again when you have a connection.'));
    } },
  ]);
  const reportActions = () => Alert.alert('Report rider', 'Choose the reason that best describes the issue.', [
    { text: 'Harassment', onPress: () => report('harassment') },
    { text: 'Unsafe behaviour', onPress: () => report('unsafe') },
    { text: 'Spam or scam', onPress: () => report('spam') },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const safetyActions = () => Alert.alert('More actions', `Manage your connection with ${friend.displayName}.`, [
    { text: 'Share Rider ID', onPress: () => {
      void Share.share({ message: `${profile?.displayName ?? friend.displayName} on Rider Comms: ${friend.riderId}` });
    } },
    { text: 'Remove friend', onPress: confirmRemove },
    { text: 'Report rider', onPress: reportActions },
    { text: 'Block rider', style: 'destructive', onPress: () => {
      void client.blockRider(friend.riderId)
        .then(async () => { await refresh(); onClose(); })
        .catch(() => Alert.alert('Couldn’t block rider', 'Please try again.'));
    } },
    { text: 'Cancel', style: 'cancel' },
  ]);

  const viewOnMap = () => {
    if (!rideLocation) return;
    onClose();
    navigation.navigate('Tabs', {
      screen: 'Map',
      params: {
        segment: 'public',
        at: Date.now(),
        lat: rideLocation.lat,
        lon: rideLocation.lon,
        label: `${friend.displayName} · live ride location`,
      },
    });
  };

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
              <RiderAvatar avatarId={profile?.avatarId ?? friend.avatarId} size={54} status={activity?.online ? 'online' : 'stale'} />
            </View>
            <View style={styles.profileIdentityCopy}>
              <Text style={styles.profileModalName}>{profile?.displayName ?? friend.displayName}</Text>
              <Text style={styles.profileModalHandle}>{profile?.handle ?? friend.handle} · {activityCopy}</Text>
            </View>
          </View>

          {loading && <ActivityIndicator style={styles.profileLoader} color={colors.accent} />}
          {error && <Text style={styles.profileError}>{error}</Text>}

          <View style={styles.profileActions}>
            <Pressable
              style={({ pressed }) => [styles.profileAction, pressed && styles.profileActionPressed]}
              onPress={() => {
                onClose();
                navigation.navigate('FriendChat', { riderId: friend.riderId, displayName: friend.displayName, avatarId: friend.avatarId });
              }}
              accessibilityRole="button"
              accessibilityLabel="Message rider"
            >
              <Ionicons name="chatbubble-outline" size={21} color={colors.accent} />
              <Text style={styles.profileActionText}>Message</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.profileAction,
                shareRideLocation && inActiveRide && styles.profileActionActive,
                (!inActiveRide || locationShareBusy) && styles.profileActionDisabled,
                pressed && inActiveRide && !locationShareBusy && styles.profileActionPressed,
              ]}
              onPress={() => {
                if (!inActiveRide || locationShareBusy) return;
                setLocationShareBusy(true);
                void setRideLocationSharing(!shareRideLocation)
                  .then((ok) => {
                    if (!ok && !shareRideLocation) {
                      Alert.alert('Location not shared', 'Rider Comms could not enable private ride location sharing. Check location permission and your connection.');
                    }
                  })
                  .finally(() => setLocationShareBusy(false));
              }}
              disabled={!inActiveRide || locationShareBusy}
              accessibilityRole="button"
              accessibilityLabel={
                !inActiveRide
                  ? 'Share location unavailable outside a shared group ride'
                  : shareRideLocation
                    ? 'Stop sharing your location with the group ride'
                    : 'Share your location with the group ride'
              }
              accessibilityState={{ disabled: !inActiveRide || locationShareBusy, selected: shareRideLocation && inActiveRide }}
              accessibilityHint={inActiveRide ? 'Shares your location with everyone in your current group ride, not just this rider.' : 'Available when you are in the same group ride.'}
            >
              <Ionicons name="navigate-outline" size={21} color={inActiveRide ? colors.accent : colors.textMuted} />
              <Text style={styles.profileActionText}>Share to Ride</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.profileAction, !rideLocation && styles.profileActionDisabled, pressed && rideLocation && styles.profileActionPressed]}
              onPress={viewOnMap}
              disabled={!rideLocation}
              accessibilityRole="button"
              accessibilityLabel={rideLocation ? 'View rider on map' : 'Rider location not shared'}
              accessibilityState={{ disabled: !rideLocation }}
            >
              <Ionicons name="location-outline" size={21} color={rideLocation ? colors.accent : colors.textMuted} />
              <Text style={styles.profileActionText}>Map</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.profileAction, pressed && styles.profileActionPressed]}
              onPress={safetyActions}
              accessibilityRole="button"
              accessibilityLabel="More rider actions"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} />
              <Text style={styles.profileActionText}>More</Text>
            </Pressable>
          </View>

          <View style={styles.profileDetailList}>
            <View style={styles.profileDetailRow}>
              <Ionicons name="location-outline" size={19} color={colors.textSecondary} />
              <View style={styles.profileDetailCopy}>
                <Text style={styles.profileDetailTitle}>Location</Text>
                <Text style={styles.profileDetailValue}>{rideLocation ? 'Shared in your current ride · updated recently' : 'Not shared with you'}</Text>
              </View>
            </View>
            <View style={[styles.profileDetailRow, styles.profileDetailRowDivider]}>
              <Ionicons name="people-outline" size={19} color={colors.textSecondary} />
              <View style={styles.profileDetailCopy}>
                <Text style={styles.profileDetailTitle}>Group ride</Text>
                <Text style={styles.profileDetailValue}>{inActiveRide ? `${rideMemberCount} rider${rideMemberCount === 1 ? '' : 's'} · riding together` : 'Not in your current ride'}</Text>
              </View>
            </View>
            <View style={styles.profileDetailRow}>
              <Ionicons name="share-social-outline" size={19} color={colors.textSecondary} />
              <View style={styles.profileDetailCopy}>
                <Text style={styles.profileDetailTitle}>Shared profiles</Text>
                <Text style={styles.profileDetailValue}>{sharedProfileCount ? `${sharedProfileCount} profile${sharedProfileCount === 1 ? '' : 's'} shared with you` : 'None shared'}</Text>
              </View>
            </View>
          </View>

          {(profile?.instagramUsername || profile?.tiktokUsername) ? (
            <View style={styles.profileSocialSection}>
              <Text style={styles.profileSectionLabel}>Shared profiles</Text>
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
            </View>
          ) : null}

          {rideLocation ? (
            <Pressable
              style={({ pressed }) => [styles.profileMapButton, pressed && styles.profileActionPressed]}
              onPress={viewOnMap}
              accessibilityRole="button"
              accessibilityLabel="View rider on map"
            >
              <Text style={styles.profileMapButtonText}>View on Map</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FriendsScreen(): React.JSX.Element {
  const { friends, incomingRequests, outgoingRequests, requestProfiles, activityByRider, conversations, friendProfileRevision, loading, error, refresh } = useFriends();
  const insets = useSafeAreaInsets();
  const { roster, rideLocations, shareRideLocation, setRideLocationSharing } = useRide();
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
  const selectedFriend = selectedProfile
    ? friends.find((friend) => friend.riderId === selectedProfile.riderId) ?? null
    : null;
  const selectedRideLocation = selectedFriend && roster.includes(selectedFriend.riderId)
    ? rideLocations.find((location) => (
        location.riderId === selectedFriend.riderId
        && Date.now() - location.updatedAt <= FRIEND_RIDE_LOCATION_STALE_MS
      ))
    : undefined;

  React.useEffect(() => {
    if (selectedProfile && !selectedFriend) setSelectedProfile(null);
  }, [selectedFriend, selectedProfile]);
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
              <Ionicons name={addOpen ? 'close' : 'person-add-outline'} size={21} color={addOpen ? colors.accentText : colors.textPrimary} />
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
            <Text accessibilityRole="header" style={styles.networkSectionLabel}>Requests ({incomingRequests.length})</Text>
            <View style={styles.section}>
              {incomingRequests.map((request) => (
                <RequestRow key={request.id} request={request} profile={requestProfiles[request.fromRiderId]} />
              ))}
            </View>
          </>
        )}

        {outgoingRequests.length > 0 && (
          <>
            <Text accessibilityRole="header" style={styles.networkSectionLabel}>Sent ({outgoingRequests.length})</Text>
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
                <Text accessibilityRole="header" style={styles.networkSectionLabel}>Online ({onlineFriends.length})</Text>
                {onlineFriends.map((friend) => (
                  <FriendRow key={friend.riderId} friend={friend} activity={activityByRider[friend.riderId]} unreadCount={unreadByRider[friend.riderId] ?? 0} inActiveRide={roster.includes(friend.riderId)} onProfile={setSelectedProfile} />
                ))}
              </>
            ) : null}
            {offlineFriends.length > 0 ? (
              <>
                <Text accessibilityRole="header" style={styles.networkSectionLabel}>Offline ({offlineFriends.length})</Text>
                {offlineFriends.map((friend) => (
                  <FriendRow key={friend.riderId} friend={friend} activity={activityByRider[friend.riderId]} unreadCount={unreadByRider[friend.riderId] ?? 0} inActiveRide={roster.includes(friend.riderId)} onProfile={setSelectedProfile} />
                ))}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <RideBar />
      <FriendProfileModal
        friend={selectedFriend}
        activity={selectedFriend ? activityByRider[selectedFriend.riderId] : undefined}
        profileRevision={friendProfileRevision}
        inActiveRide={selectedFriend ? roster.includes(selectedFriend.riderId) : false}
        rideLocation={selectedRideLocation}
        rideMemberCount={roster.length}
        shareRideLocation={shareRideLocation}
        setRideLocationSharing={setRideLocationSharing}
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
  friendSearchRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 4, paddingHorizontal: 11, marginBottom: 2 },
  friendSearchInput: { ...type.body, color: colors.textPrimary, flex: 1, minHeight: 42, fontSize: 14 },
  networkList: { marginTop: spacing.xs },
  networkSectionLabel: { ...type.label, color: colors.textSecondary, marginTop: 15, marginBottom: 5, textTransform: 'none', letterSpacing: 0, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  friendRowPressed: { opacity: 0.72 },
  friendAvatarWrap: { position: 'relative', flexShrink: 0 },
  friendPresenceDot: { position: 'absolute', right: -2, bottom: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.background },
  friendPresenceOnline: { backgroundColor: colors.success },
  friendPresenceOffline: { backgroundColor: colors.textMuted },
  friendInfo: { flex: 1, gap: 2 },
  friendName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  friendHandle: { ...type.caption, color: colors.textSecondary, fontSize: 11 },
  emptyState: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyTitle: { ...type.subheading, color: colors.textPrimary },
  emptyText: { ...type.caption, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  profileModal: { backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: colors.border, padding: spacing.md, paddingBottom: spacing.xl },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, marginBottom: spacing.sm },
  modalClose: { position: 'absolute', right: spacing.md, top: spacing.md, zIndex: 4, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  profileIdentity: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingTop: 0, paddingRight: 46, paddingBottom: 8 },
  profileAvatarWrap: { position: 'relative' },
  profileIdentityCopy: { flex: 1, minWidth: 0 },
  profileModalName: { ...type.heading, color: colors.textPrimary, fontSize: 17 },
  profileModalHandle: { ...type.body, color: colors.textSecondary, marginTop: 1 },
  profileLoader: { marginTop: spacing.sm },
  profileError: { ...type.caption, color: colors.danger, marginTop: spacing.sm },
  profileActions: { flexDirection: 'row', gap: 7, marginTop: 2 },
  profileAction: { flex: 1, minWidth: 0, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 3, backgroundColor: colors.surface, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  profileActionDisabled: { opacity: 0.38 },
  profileActionActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  profileActionPressed: { opacity: 0.72 },
  profileActionText: { ...type.caption, color: colors.textPrimary, fontWeight: '700', fontSize: 10.5 },
  profileDetailList: { marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  profileDetailRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 6 },
  profileDetailRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  profileDetailCopy: { flex: 1, minWidth: 0 },
  profileDetailTitle: { ...type.caption, color: colors.textPrimary, fontWeight: '700', fontSize: 12 },
  profileDetailValue: { ...type.caption, color: colors.textSecondary, marginTop: 1, fontWeight: '500', fontSize: 11, lineHeight: 15 },
  profileSocialSection: { gap: 7, marginTop: 10 },
  profileSectionLabel: { ...type.caption, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1 },
  socialList: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },
  socialRow: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  socialText: { ...type.body, color: colors.textPrimary, flex: 1 },
  profileMapButton: { minHeight: 46, marginTop: 9, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent },
  profileMapButtonText: { ...type.body, color: colors.accentText, fontWeight: '800' },
});
