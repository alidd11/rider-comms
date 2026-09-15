// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { FriendRequest, FriendSummary } from '@rider-comms/shared';
import type { RootStackParamList } from '../navigation';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { useFriends } from '../friends/FriendsContext';
import { getAvatarPreset } from '../settings/avatars';
import { RideBar } from '../ride/RideBar';

function AddFriendCard(): React.JSX.Element {
  const { sendRequest } = useFriends();
  const [riderId, setRiderId] = React.useState('');
  const [sending, setSending] = React.useState(false);

  const canSubmit = riderId.trim().length > 0 && !sending;

  const handleSend = React.useCallback(async () => {
    const target = riderId.trim();
    if (!target) return;
    setSending(true);
    try {
      await sendRequest(target);
      setRiderId('');
    } finally {
      setSending(false);
    }
  }, [riderId, sendRequest]);

  return (
    <View style={[styles.section, elevation.raised, styles.addCard]}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder="Rider ID"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={riderId}
          onChangeText={setRiderId}
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
      <Text style={styles.addCaption}>
        Enter a rider's ID to send them a friend request. Handles aren't searchable yet — TODO once accounts
        exist.
      </Text>
    </View>
  );
}

function RequestRow({ request }: { request: FriendRequest }): React.JSX.Element {
  const { accept, decline } = useFriends();
  return (
    <View style={styles.requestRow}>
      <View style={styles.requestAvatar}>
        <Ionicons name="person" size={18} color={colors.textPrimary} />
      </View>
      <Text style={styles.requestName}>{request.fromRiderId}</Text>
      <Pressable style={styles.requestDecline} onPress={() => decline(request.id)} hitSlop={8}>
        <Ionicons name="close" size={20} color={colors.danger} />
      </Pressable>
      <Pressable style={styles.requestAccept} onPress={() => accept(request.id)} hitSlop={8}>
        <Ionicons name="checkmark" size={20} color={colors.accentText} />
      </Pressable>
    </View>
  );
}

function FriendRow({ friend }: { friend: FriendSummary }): React.JSX.Element {
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
      <Pressable style={styles.friendRemove} onPress={confirmRemove} hitSlop={8}>
        <Ionicons name="person-remove-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </Pressable>
  );
}

export function FriendsScreen(): React.JSX.Element {
  const { friends, incomingRequests, loading, error } = useFriends();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.title}>Friends</Text>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

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
                <RequestRow key={request.id} request={request} />
              ))}
            </View>
          </>
        )}

        <View style={styles.sectionLabelRow}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Friends</Text>
        </View>
        <View style={[styles.section, elevation.raised]}>
          {loading && friends.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyText}>No friends yet — add someone by rider ID above.</Text>
            </View>
          ) : (
            friends.map((friend) => <FriendRow key={friend.riderId} friend={friend} />)
          )}
        </View>
      </ScrollView>

      <RideBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  title: { ...type.title, marginBottom: spacing.lg },
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
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  sectionLabel: { ...type.label, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
  section: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md },
  addCard: { padding: spacing.md, gap: spacing.sm },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  addInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET * 0.7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    ...type.body,
    color: colors.textPrimary,
  },
  addButton: {
    width: MIN_TOUCH_TARGET * 0.7,
    height: MIN_TOUCH_TARGET * 0.7,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonPressed: { backgroundColor: colors.accentPressed },
  addButtonDisabled: { opacity: 0.5 },
  addCaption: { ...type.caption },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  requestAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestName: { ...type.body, color: colors.textPrimary, flex: 1 },
  requestDecline: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAccept: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  friendRemove: { padding: spacing.xs },
  emptyState: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyText: { ...type.caption, textAlign: 'center' },
});
