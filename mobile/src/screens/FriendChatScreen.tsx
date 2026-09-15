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
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DirectMessage, Hideout } from '@rider-comms/shared';
import type { RootStackParamList } from '../navigation';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { getAvatarPreset } from '../settings/avatars';

// Same poll cadence style used elsewhere (MapScreen's presence, FriendsContext).
const MESSAGE_POLL_INTERVAL_MS = 10000;

type Props = NativeStackScreenProps<RootStackParamList, 'FriendChat'>;

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MessageBubble({ message, currentRiderId }: { message: DirectMessage; currentRiderId: string }): React.JSX.Element {
  const mine = message.fromRiderId === currentRiderId;
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{message.text}</Text>
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>{formatTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

function HideoutRow({
  hideout,
  onDelete,
  currentRiderId,
}: {
  hideout: Hideout;
  onDelete: (id: string) => void;
  currentRiderId: string;
}): React.JSX.Element {
  const canDelete = hideout.createdBy === currentRiderId;
  return (
    <View style={styles.hideoutRow}>
      <MaterialCommunityIcons name="map-marker-radius" size={18} color={colors.accent} />
      <View style={styles.hideoutInfo}>
        <Text style={styles.hideoutName}>{hideout.name}</Text>
        <Text style={styles.hideoutCoords}>
          {hideout.lat.toFixed(4)}, {hideout.lon.toFixed(4)}
        </Text>
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
            Tapping a spot on the map to set this isn't wired up yet — TODO once a real map SDK exists. For now,
            type coordinates directly.
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

export function FriendChatScreen({ route, navigation }: Props): React.JSX.Element {
  const { riderId, displayName, avatarId } = route.params;
  const { riderId: currentRiderId, client } = useAuth();
  const avatar = getAvatarPreset(avatarId);
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = React.useState<DirectMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [hideouts, setHideouts] = React.useState<Hideout[]>([]);
  const [planOpen, setPlanOpen] = React.useState(false);

  const loadMessages = React.useCallback(async () => {
    try {
      const { messages: fetched } = await client.getMessages(riderId);
      setMessages(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not load messages.');
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

  React.useEffect(() => {
    loadMessages();
    loadHideouts();
    const interval = setInterval(loadMessages, MESSAGE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMessages, loadHideouts]);

  useFocusEffect(
    React.useCallback(() => {
      loadMessages();
      loadHideouts();
    }, [loadMessages, loadHideouts])
  );

  const handleSend = React.useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await client.sendMessage(riderId, text);
      setDraft('');
      await loadMessages();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }, [client, draft, riderId, loadMessages]);

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
        void client.blockRider(riderId).then(() => navigation.goBack()).catch(() => Alert.alert('Couldn’t block rider', 'Please try again.'));
      } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [client, displayName, navigation, reportRider, riderId]);

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
        </View>
      )}

      {hideouts.length > 0 && (
        <View style={styles.hideoutList}>
          {hideouts.map((h) => (
            <HideoutRow key={h.id} hideout={h} onDelete={handleDeleteHideout} currentRiderId={currentRiderId} />
          ))}
        </View>
      )}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} currentRiderId={currentRiderId} />}
        contentContainerStyle={styles.messageList}
        inverted={false}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
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
  hideoutDelete: { padding: spacing.xs },
  messageList: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: radii.lg, padding: spacing.md },
  bubbleMine: { backgroundColor: colors.accent },
  bubbleTheirs: { backgroundColor: colors.surface },
  bubbleText: { ...type.body, color: colors.textPrimary },
  bubbleTextMine: { color: colors.accentText },
  bubbleTime: { ...type.caption, marginTop: spacing.xs },
  bubbleTimeMine: { color: colors.accentText, opacity: 0.7 },
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
    minHeight: MIN_TOUCH_TARGET * 0.7,
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
    width: MIN_TOUCH_TARGET * 0.7,
    height: MIN_TOUCH_TARGET * 0.7,
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
    minHeight: MIN_TOUCH_TARGET * 0.7,
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
