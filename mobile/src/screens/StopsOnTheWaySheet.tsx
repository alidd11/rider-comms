import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StopOnTheWay } from '@rider-comms/shared';
import type { PlaceAlongRoute } from '../api/client';
import { colors, radii, spacing, type, MIN_TOUCH_TARGET } from '../theme';

/** What can be searched for along the route (PWA: STOP_KINDS). */
export const STOP_KINDS = [
  { key: 'petrol', label: 'Petrol', query: 'petrol station', icon: 'gas-station' },
  { key: 'cafes', label: 'Cafés', query: 'cafe', icon: 'coffee' },
  { key: 'food', label: 'Food', query: 'restaurant', icon: 'silverware-fork-knife' },
] as const;

type Status = 'loading' | 'ready' | 'error';

/**
 * Petrol, cafés or food on the way, during navigation and only while parked
 * (Ride Safe hides the button that opens it). Each shows what it adds to the
 * trip; a tap routes through it, keeping the destination.
 */
export function StopsOnTheWaySheet({
  visible,
  onClose,
  findStops,
  onChoose,
}: {
  visible: boolean;
  onClose: () => void;
  findStops: (query: string) => Promise<StopOnTheWay<PlaceAlongRoute>[]>;
  onChoose: (place: PlaceAlongRoute) => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = React.useState<(typeof STOP_KINDS)[number]['key']>('petrol');
  const [status, setStatus] = React.useState<Status>('loading');
  const [stops, setStops] = React.useState<StopOnTheWay<PlaceAlongRoute>[]>([]);
  const findRef = React.useRef(findStops);
  findRef.current = findStops;

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStatus('loading');
    setStops([]);
    const query = STOP_KINDS.find((entry) => entry.key === kind)!.query;
    findRef.current(query)
      .then((found) => { if (!cancelled) { setStops(found); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [kind, visible]);

  const label = STOP_KINDS.find((entry) => entry.key === kind)!.label.toLowerCase();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} testID="stops-on-the-way">
        <Text style={styles.title} accessibilityRole="header">On the way</Text>
        <View style={styles.kinds} accessibilityRole="radiogroup">
          {STOP_KINDS.map((entry) => {
            const selected = entry.key === kind;
            return (
              <Pressable
                key={entry.key}
                onPress={() => setKind(entry.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={entry.label}
                style={[styles.kind, selected && styles.kindSelected]}
              >
                <MaterialCommunityIcons name={entry.icon} size={18} color={selected ? colors.accentText : colors.textSecondary} />
                <Text style={[styles.kindText, selected && styles.kindTextSelected]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {status === 'loading' ? <ActivityIndicator style={styles.state} color={colors.accent} accessibilityLabel="Searching along the route" /> : null}
        {status === 'error' ? <Text style={styles.state}>Couldn’t search along the route. Try again.</Text> : null}
        {status === 'ready' && stops.length === 0 ? <Text style={styles.state}>No {label} found along the rest of the route.</Text> : null}
        {status === 'ready' ? stops.map(({ place, text }) => (
          <Pressable
            key={place.id}
            onPress={() => onChoose(place)}
            accessibilityRole="button"
            accessibilityLabel={[place.name, place.address, text].filter(Boolean).join(', ')}
            accessibilityHint="Adds this stop to your route"
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>{place.name}</Text>
              {place.address ? <Text style={styles.rowAddress} numberOfLines={1}>{place.address}</Text> : null}
            </View>
            {text ? <Text style={styles.rowDetour}>{text}</Text> : null}
          </Pressable>
        )) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, backgroundColor: colors.surface },
  title: { ...type.subheading, color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  kinds: { flexDirection: 'row', gap: spacing.sm },
  kind: { flex: 1, minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  kindSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindText: { ...type.caption, color: colors.textSecondary, fontWeight: '800' },
  kindTextSelected: { color: colors.accentText },
  state: { ...type.body, color: colors.textSecondary, paddingVertical: spacing.md, textAlign: 'center' },
  row: { minHeight: MIN_TOUCH_TARGET + 8, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  rowAddress: { ...type.caption, color: colors.textMuted },
  rowDetour: { ...type.caption, color: colors.accentInk, fontWeight: '800' },
});
