// The notice staff schedule in the Staff Hub, on the map. The map screen
// shows it only when the rider is not moving and not navigating; once
// closed, that announcement stays closed on this phone.
import * as React from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import type { Announcement } from '../api/client';
import { colors, elevation, MIN_TOUCH_TARGET, spacing } from '../theme';

export const ANNOUNCEMENT_CLOSED_KEY = 'riderComms.announcementClosed';
export const ANNOUNCEMENT_REFRESH_MS = 5 * 60 * 1000;

/** The announcement to show now, if any, and a way to close it. */
export function useAnnouncement(
  load: () => Promise<{ announcement: Announcement | null }>,
): { announcement: Announcement | null; close: () => void } {
  const [announcement, setAnnouncement] = React.useState<Announcement | null>(null);
  const [closedId, setClosedId] = React.useState<string | null | undefined>(undefined);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ANNOUNCEMENT_CLOSED_KEY)
      .then((value) => { if (!cancelled) setClosedId(value); })
      .catch(() => { if (!cancelled) setClosedId(null); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      Promise.resolve()
        .then(() => loadRef.current())
        .then((data) => { if (!cancelled) setAnnouncement(data?.announcement ?? null); })
        // Keep what is showing; the next refresh tries again.
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, ANNOUNCEMENT_REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const close = React.useCallback(() => {
    if (!announcement) return;
    setClosedId(announcement.id);
    void AsyncStorage.setItem(ANNOUNCEMENT_CLOSED_KEY, announcement.id).catch(() => undefined);
  }, [announcement]);

  // Nothing until the closed id is read, so a closed one never flashes up.
  const visible = closedId !== undefined && announcement && announcement.id !== closedId && announcement.endsAt > Date.now()
    ? announcement : null;
  return { announcement: visible, close };
}

export function AnnouncementBanner({
  announcement,
  top,
  onClose,
}: {
  announcement: Announcement;
  top: number;
  onClose: () => void;
}): React.JSX.Element {
  const warning = announcement.tone === 'warning';
  const accent = warning ? colors.warning : colors.accent;
  return (
    <View
      testID="announcement-banner"
      style={[styles.banner, { top, borderLeftColor: accent }]}
      accessibilityRole="summary"
    >
      <Ionicons name="information-circle-outline" size={22} color={accent} style={styles.icon} />
      <View style={styles.copy}>
        <Text style={styles.title}>{announcement.title}</Text>
        <Text style={styles.body}>{announcement.body}</Text>
      </View>
      <Pressable
        testID="announcement-close"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close announcement"
        hitSlop={4}
        style={styles.close}
      >
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 16,
    borderLeftWidth: 4,
    backgroundColor: colors.surfaceRaised,
    ...elevation.raised,
  },
  icon: { marginTop: 1 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  body: { fontSize: 14, lineHeight: 19, color: colors.textSecondary },
  close: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, marginVertical: -8, alignItems: 'center', justifyContent: 'center' },
});
