// Unverified scaffold — see navigation/index.tsx header note.
import * as React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Hideout } from '@rider-comms/shared';
import type { RootStackParamList } from '../navigation';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { getAvatarPreset } from '../settings/avatars';
import { buildNavigationProviderUrl } from '../navigationLinks';
import { reconcileMessageThread, type LocalDirectMessage } from '../friends/messageState';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { RideSafeSurface } from '../safety/RideSafeSurface';
import { useFriends } from '../friends/FriendsContext';
import { useSettings } from '../settings/SettingsContext';
import { navigationProviderLabel } from '../navigationPreference';

// Same poll cadence style used elsewhere (MapScreen's presence, FriendsContext).
const MESSAGE_POLL_INTERVAL_MS = 10000;

type Props = NativeStackScreenProps<RootStackParamList, 'FriendChat'>;

/**
 * A message as rendered locally: the optimistic echo needs a temp id and a
 * transient send status before (and possibly instead of) the server's copy
 * arrives — see handleSend below. Messages loaded from the backend never
 * carry `status`, so they render as sent by default.
 */
type LocalMessage = LocalDirectMessage;

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MessageBubble({
  message,
  currentRiderId,
  onRetry,
}: {
  message: LocalMessage;
  currentRiderId: string;
  onRetry: (id: string) => void;
}): React.JSX.Element {
  const mine = message.fromRiderId === currentRiderId;
  const failed = mine && message.status === 'failed';

  const bubble = (
    <View style={styles.bubbleColumn}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, failed && styles.bubbleFailed]}>
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.text}</Text>
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{formatTime(message.createdAt)}</Text>
      </View>
      {mine && message.status === 'pending' && <Text style={styles.bubbleStatusCaption}>Sending…</Text>}
      {failed && <Text style={styles.bubbleStatusCaptionFailed}>Failed — tap to retry</Text>}
    </View>
  );

  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      {failed ? <Pressable onPress={() => onRetry(message.id)}>{bubble}</Pressable> : bubble}
    </View>
  );
}

function HideoutRow({
  hideout,
  onDelete,
  onOpen,
  currentRiderId,
}: {
  hideout: Hideout;
  onDelete: (id: string) => void;
  onOpen: (hideout: Hideout) => void;
  currentRiderId: string;
}): React.JSX.Element {
  const canDelete = hideout.createdBy === currentRiderId;
  return (
    <View style={styles.hideoutRow}>
      <MaterialCommunityIcons name="map-marker-radius" size={18} color={colors.accent} />
      <View style={styles.hideoutInfo}>
        <Text style={styles.hideoutName}>{hideout.name}</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open directions to ${hideout.name}`}
          onPress={() => onOpen(hideout)}
          hitSlop={4}
        >
          <Text style={[styles.hideoutCoords, styles.hideoutCoordsLink]}>
            {hideout.lat.toFixed(4)}, {hideout.lon.toFixed(4)}
          </Text>
        </Pressable>
      </View>
      {canDelete && (
        <Pressable onPress={() => onDelete(hideout.id)} hitSlop={8} style={styles.hideoutDelete}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      )}
    </View>
  );
}

function PlanHideoutModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, lat: number, lon: number) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = React.useState('');
  const [lat, setLat] = React.useState('');
  const [lon, setLon] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && lat.trim().length > 0 && lon.trim().length > 0 && !saving;

  const handleCreate = async () => {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      setError('Latitude and longitude must be numbers.');
      return;
    }
    if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) {
      setError('Latitude must be between -90 and 90, and longitude between -180 and 180.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), latNum, lonNum);
      setName('');
      setLat('');
      setLon('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that hideout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Plan a hideout</Text>
          <Text style={styles.modalSubtitle}>Save a meeting point to plan around together.</Text>

          <TextInput
            style={styles.modalInput}
            placeholder="Name (e.g. Gas station off Route 9)"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.modalSectionLabel}>Location</Text>
          <View style={styles.coordRow}>
            <TextInput
              style={[styles.modalInput, styles.coordInput]}
              placeholder="Latitude"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              value={lat}
              onChangeText={setLat}
            />
            <TextInput
              style={[styles.modalInput, styles.coordInput]}
              placeholder="Longitude"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              value={lon}
              onChangeText={setLon}
            />
          </View>
          <Text style={styles.modalCaption}>
            Tapping a spot on the map to set this is coming soon. For now, type coordinates directly.
          </Text>

          {error && (
            <View style={styles.modalErrorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.modalErrorText}>{error}</Text>
            </View>
          )}

          <Pressable
            style={[styles.modalDone, !canSubmit && styles.modalDoneDisabled]}
            onPress={handleCreate}
            disabled={!canSubmit}
          >
            {saving ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.modalDoneText}>Save hideout</Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FriendChatScreen(props: Props): React.JSX.Element {
  const { lockedForSafety } = useMovementSafety();
  return lockedForSafety ? <RideSafeSurface /> : <FriendChatScreenContent {...props} />;
}

function FriendChatScreenContent({ route, navigation }: Props): React.JSX.Element {
  const { riderId, displayName, avatarId } = route.params;
  const { riderId: currentRiderId, client } = useAuth();
  const { refresh: refreshFriends } = useFriends();
  const { navigationProvider } = useSettings();
  const avatar = getAvatarPreset(avatarId);
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = React.useState<LocalMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const listRef = React.useRef<FlatList<LocalMessage>>(null);

  const [hideouts, setHideouts] = React.useState<Hideout[]>([]);
  const [planOpen, setPlanOpen] = React.useState(false);

  const loadMessages = React.useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const { messages: fetched } = await client.getMessages(riderId);
      setMessages((current) => reconcileMessageThread(current, fetched));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError('This conversation is no longer available.');
      else setError('Could not refresh messages. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [client, riderId]);

  const loadHideouts = React.useCallback(async () => {
    try {
      const { hideouts: fetched } = await client.getHideouts(currentRiderId);
      setHideouts(fetched.filter((h) => h.participantIds.includes(riderId)));
    } catch {
      // Hideouts are secondary to the chat itself — a failure here doesn't
      // need its own error banner on top of the message-load one.
    }
  }, [client, currentRiderId, riderId]);

  useFocusEffect(
    React.useCallback(() => {
      void loadMessages(true);
      void loadHideouts();
      const interval = setInterval(() => void loadMessages(), MESSAGE_POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [loadMessages, loadHideouts])
  );

  // Optimistic local echo: the user's own message appears instantly with a
  // temp id/`pending` status, then is reconciled with the server's copy (or
  // flipped to `failed`, with tap-to-retry on that one bubble) rather than
  // waiting on a full loadMessages() round trip before it shows up at all.
  const handleSend = React.useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setMessages((current) => [
      ...current,
      { id: tempId, fromRiderId: currentRiderId, toRiderId: riderId, text, createdAt: Date.now(), status: 'pending' },
    ]);
    setDraft('');
    setSending(true);
    try {
      const sent = await client.sendMessage(riderId, text);
      setMessages((current) => current.map((m) => (m.id === tempId ? sent : m)));
      setError(null);
    } catch {
      setMessages((current) => current.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));
    } finally {
      setSending(false);
    }
  }, [client, draft, riderId, currentRiderId]);

  const handleRetry = React.useCallback(
    async (localId: string) => {
      const target = messages.find((m) => m.id === localId);
      if (!target) return;
      setMessages((current) => current.map((m) => (m.id === localId ? { ...m, status: 'pending' } : m)));
      try {
        const sent = await client.sendMessage(riderId, target.text);
        setMessages((current) => current.map((m) => (m.id === localId ? sent : m)));
      } catch {
        setMessages((current) => current.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)));
      }
    },
    [client, messages, riderId]
  );

  const handleOpenHideout = React.useCallback(async (hideout: Hideout) => {
    if (navigationProvider === 'in_app') {
      navigation.navigate('Tabs', {
        screen: 'Map',
        params: {
          segment: 'public',
          at: Date.now(),
          lat: hideout.lat,
          lon: hideout.lon,
          label: hideout.name,
        },
      });
      return;
    }

    const url = buildNavigationProviderUrl(
      { lat: hideout.lat, lon: hideout.lon, label: hideout.name },
      navigationProvider
    );
    if (!url) {
      Alert.alert('Location unavailable', 'This location cannot be opened because its coordinates are invalid.');
      return;
    }

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Couldn’t open directions', `Rider Comms could not open ${navigationProviderLabel(navigationProvider)} on this device.`);
    }
  }, [navigation, navigationProvider]);

  const handleCreateHideout = React.useCallback(
    async (name: string, lat: number, lon: number) => {
      await client.createHideout(name, lat, lon, [riderId]);
      await loadHideouts();
    },
    [client, riderId, loadHideouts]
  );

  const handleDeleteHideout = React.useCallback(
    async (hideoutId: string) => {
      try {
        await client.deleteHideout(hideoutId);
        await loadHideouts();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete that hideout.');
      }
    },
    [client, loadHideouts]
  );

  const reportRider = React.useCallback((reason: 'harassment' | 'unsafe' | 'spam' | 'sexual' | 'other') => {
    void client.reportRider(riderId, reason, 'Reported from the direct-message screen')
      .then(() => Alert.alert('Report received', 'Thank you. The report has been recorded for review.'))
      .catch(() => Alert.alert('Couldn’t send report', 'Please try again when you have a connection.'));
  }, [client, riderId]);

  const openSafetyActions = React.useCallback(() => {
    Alert.alert('Safety options', `Choose what to do about ${displayName}.`, [
      { text: 'Report harassment', onPress: () => reportRider('harassment') },
      { text: 'Report unsafe behaviour', onPress: () => reportRider('unsafe') },
      { text: 'Block rider', style: 'destructive', onPress: () => {
        void client.blockRider(riderId)
          .then(async () => { await refreshFriends(); navigation.goBack(); })
          .catch(() => Alert.alert('Couldn’t block rider', 'Please try again.'));
      } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [client, displayName, navigation, refreshFriends, reportRider, riderId]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={[styles.headerAvatar, { backgroundColor: avatar.bg }]}>
          <MaterialCommunityIcons name={avatar.icon} size={18} color={colors.textPrimary} />
        </View>
        <Text style={styles.headerName}>{displayName}</Text>
        <Pressable onPress={() => setPlanOpen(true)} style={styles.planButton} hitSlop={8}>
          <MaterialCommunityIcons name="map-marker-plus" size={18} color={colors.accent} />
          <Text style={styles.planButtonText}>Plan a hideout</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Safety options" onPress={openSafetyActions} style={styles.safetyButton} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal-circle" size={23} color={colors.textSecondary}/>
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void loadMessages(true)} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {hideouts.length > 0 && (
        <View style={styles.hideoutList}>
          {hideouts.map((h) => (
            <HideoutRow key={h.id} hideout={h} onDelete={handleDeleteHideout} onOpen={handleOpenHideout} currentRiderId={currentRiderId} />
          ))}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} currentRiderId={currentRiderId} onRetry={handleRetry} />}
        contentContainerStyle={[styles.messageList, messages.length === 0 && styles.messageListEmpty]}
        inverted={false}
        onContentSizeChange={() => { if (messages.length > 0) listRef.current?.scrollToEnd({ animated: true }); }}
        ListEmptyComponent={loading ? (
          <View style={styles.chatEmpty}><ActivityIndicator color={colors.accent} /><Text style={styles.chatEmptyText}>Loading conversation…</Text></View>
        ) : (
          <View style={styles.chatEmpty}>
            <Ionicons name="chatbubble-ellipses-outline" size={34} color={colors.textMuted} />
            <Text style={styles.chatEmptyTitle}>Start a private conversation</Text>
            <Text style={styles.chatEmptyText}>Messages in this thread are only available to you and {displayName}.</Text>
          </View>
        )}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={1000}
          accessibilityLabel={`Message ${displayName}`}
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            pressed && draft.trim() && styles.sendButtonPressed,
            (!draft.trim() || sending) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!draft.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={colors.accentText} />
          )}
        </Pressable>
      </View>

      <PlanHideoutModal
        visible={planOpen}
        onClose={() => setPlanOpen(false)}
        onCreate={handleCreateHideout}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { padding: spacing.xs },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: { ...type.subheading, flex: 1 },
  planButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.xs },
  planButtonText: { ...type.caption, color: colors.accent },
  safetyButton: { padding: spacing.xs },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    margin: spacing.md,
  },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  retryText: { ...type.button, color: colors.danger },
  hideoutList: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  hideoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  hideoutInfo: { flex: 1 },
  hideoutName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  hideoutCoords: { ...type.caption },
  hideoutCoordsLink: { color: colors.accent, textDecorationLine: 'underline' },
  hideoutDelete: { padding: spacing.xs },
  messageList: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  messageListEmpty: { justifyContent: 'center' },
  chatEmpty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  chatEmptyTitle: { ...type.subheading, color: colors.textPrimary, textAlign: 'center' },
  chatEmptyText: { ...type.caption, textAlign: 'center' },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubbleColumn: { maxWidth: '78%' },
  bubble: { borderRadius: radii.lg, padding: spacing.md },
  bubbleMine: { backgroundColor: colors.accent },
  bubbleTheirs: { backgroundColor: colors.surface },
  bubbleFailed: { opacity: 0.6, borderWidth: 1, borderColor: colors.danger },
  bubbleText: { ...type.body, color: colors.textPrimary },
  bubbleTextMine: { color: colors.accentText },
  bubbleTime: { ...type.caption, marginTop: spacing.xs },
  bubbleTimeMine: { color: colors.accentText, opacity: 0.7 },
  bubbleStatusCaption: { ...type.caption, textAlign: 'right', marginTop: spacing.xs },
  bubbleStatusCaptionFailed: {
    ...type.caption,
    color: colors.danger,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...type.body,
    color: colors.textPrimary,
  },
  sendButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: { backgroundColor: colors.accentPressed },
  sendButtonDisabled: { opacity: 0.5 },
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
  modalInput: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    ...type.body,
    color: colors.textPrimary,
  },
  modalSectionLabel: { ...type.label, marginBottom: spacing.sm },
  coordRow: { flexDirection: 'row', gap: spacing.sm },
  coordInput: { flex: 1, marginBottom: 0 },
  modalCaption: { ...type.caption, marginTop: spacing.sm, marginBottom: spacing.md },
  modalErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  modalErrorText: { ...type.body, color: colors.danger, flex: 1 },
  modalDone: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDoneDisabled: { opacity: 0.5 },
  modalDoneText: { ...type.button, color: colors.accentText },
});
