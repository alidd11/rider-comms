import * as React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RiderCommsClient } from '../api/client';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { confirmBlock, openReportFlow } from '../safety/riderSafetyActions';

export interface VoicePeopleSheetProps {
  visible: boolean;
  onClose: () => void;
  client: Pick<RiderCommsClient, 'reportRider' | 'blockRider'>;
  /** Riders heard this session, oldest first: riderId → display name. */
  peers: ReadonlyMap<string, string>;
  mutedPeers: ReadonlySet<string>;
  statusOf: (peerId: string) => string;
  onToggleMute: (peerId: string) => void;
  onBlocked: (peerId: string) => void;
}

/** Mute, report and block for every rider heard on Nearby Voice (App Store guideline 1.2). */
export function VoicePeopleSheet({ visible, onClose, client, peers, mutedPeers, statusOf, onToggleMute, onBlocked }: VoicePeopleSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessible={false} style={styles.backdrop} onPress={onClose}>
        <Pressable accessible={false} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Riders on Nearby Voice</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconButton}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.sheetCaption}>Muting stops you hearing each other for this session. Blocking also hides you from each other in Nearby.</Text>
          <ScrollView>
            {[...peers].reverse().map(([peerId, name]) => {
              const muted = mutedPeers.has(peerId);
              const target = { riderId: peerId, name, source: 'Nearby Voice' };
              return (
                <View key={peerId} style={styles.peerRow}>
                  <View style={styles.peerIdentity}>
                    <Text style={styles.peerName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.peerStatus}>{statusOf(peerId)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={muted ? `Unmute ${name}` : `Mute ${name}`}
                    onPress={() => onToggleMute(peerId)}
                    style={styles.iconButton}
                  >
                    <Ionicons name={muted ? 'volume-mute' : 'volume-high-outline'} size={20} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Report ${name}`} onPress={() => openReportFlow(client, target)} style={styles.iconButton}>
                    <Ionicons name="flag-outline" size={20} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Block ${name}`}
                    onPress={() => confirmBlock(client, target, () => onBlocked(peerId))}
                    style={styles.iconButton}
                  >
                    <Ionicons name="hand-left-outline" size={20} color={colors.danger} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '70%', backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.subheading, color: colors.textPrimary },
  sheetCaption: { ...type.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  iconButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  peerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  peerIdentity: { flex: 1, minWidth: 0 },
  peerName: { ...type.body, color: colors.textPrimary },
  peerStatus: { ...type.caption, color: colors.textMuted },
});
