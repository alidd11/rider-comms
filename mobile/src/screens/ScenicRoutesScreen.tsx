// Curated routes only — see shared/src/scenicRoutes.ts's header note. This
// screen never invents a route or a suitability/safety claim; every field
// shown here came from validated data a rider explicitly entered (there's
// no moderation/curation policy yet — see the TODO(curation-policy) note
// in backend/src/server.ts — so for now "curated" means "entered by a
// verified rider account," not "reviewed by Rider Comms," and the create
// form says so).
import * as React from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Modal,
  Linking,
  Platform,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  Difficulty,
  RoadType,
  ScenicRoute,
  SurfaceQuality,
  VehicleCategory,
} from '@rider-comms/shared';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';

const VEHICLE_LABELS: Record<VehicleCategory, string> = {
  motorcycle_small: 'Small motorcycle',
  motorcycle_large: 'Large motorcycle',
  scooter: 'Scooter',
  car: 'Car',
};
const ROAD_TYPE_LABELS: Record<RoadType, string> = {
  rural: 'Rural',
  mountain: 'Mountain',
  coastal: 'Coastal',
  urban: 'Urban',
  mixed: 'Mixed',
};
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', moderate: 'Moderate', challenging: 'Challenging' };
const SURFACE_LABELS: Record<SurfaceQuality, string> = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };

const VEHICLE_ORDER: VehicleCategory[] = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];
const ROAD_TYPE_ORDER: RoadType[] = ['rural', 'mountain', 'coastal', 'urban', 'mixed'];
const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'moderate', 'challenging'];
const SURFACE_ORDER: SurfaceQuality[] = ['excellent', 'good', 'fair', 'poor'];

function openInMaps(lat: number, lon: number): void {
  const url = Platform.OS === 'ios' ? `https://maps.apple.com/?q=${lat},${lon}` : `geo:${lat},${lon}?q=${lat},${lon}`;
  Linking.openURL(url).catch(() => {});
}

function StarRating({ rating }: { rating: number }): React.JSX.Element {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= rating ? 'star' : 'star-outline'} size={14} color={colors.accent} />
      ))}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function RouteCard({
  route,
  canDelete,
  onDelete,
}: {
  route: ScenicRoute;
  canDelete: boolean;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.card, elevation.raised]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{route.name}</Text>
          <StarRating rating={route.scenicRating} />
        </View>
        {canDelete && (
          <Pressable onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </Pressable>
        )}
      </View>
      <Text style={styles.cardDescription}>{route.description}</Text>

      <View style={styles.badgeRow}>
        <View style={styles.badge}><Text style={styles.badgeText}>{ROAD_TYPE_LABELS[route.roadType]}</Text></View>
        <View style={styles.badge}><Text style={styles.badgeText}>{DIFFICULTY_LABELS[route.difficulty]}</Text></View>
        <View style={styles.badge}><Text style={styles.badgeText}>{route.distanceMiles} mi</Text></View>
        <View style={styles.badge}><Text style={styles.badgeText}>{Math.round(route.estimatedDurationMinutes)} min</Text></View>
        <View style={styles.badge}><Text style={styles.badgeText}>{SURFACE_LABELS[route.surfaceQuality]} surface</Text></View>
        {route.avoidsTolls && <View style={styles.badge}><Text style={styles.badgeText}>No tolls</Text></View>}
        {route.avoidsMotorways && <View style={styles.badge}><Text style={styles.badgeText}>No motorways</Text></View>}
      </View>

      <Text style={styles.suitabilityLabel}>
        Suited for: {route.vehicleSuitability.map((v) => VEHICLE_LABELS[v]).join(', ')}
      </Text>

      {route.safetyNotices.length > 0 && (
        <View style={styles.safetyBox}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
          <View style={{ flex: 1 }}>
            {route.safetyNotices.map((notice, index) => (
              <Text key={index} style={styles.safetyText}>{notice}</Text>
            ))}
          </View>
        </View>
      )}

      <View style={styles.cardActions}>
        <Pressable style={styles.actionButton} onPress={() => openInMaps(route.startLat, route.startLon)}>
          <Ionicons name="navigate-outline" size={16} color={colors.accent} />
          <Text style={styles.actionButtonText}>Open start in Maps</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CreateRouteModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: Parameters<import('../api/client').RiderCommsClient['createScenicRoute']>[0]) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [vehicleSuitability, setVehicleSuitability] = React.useState<VehicleCategory[]>([]);
  const [roadType, setRoadType] = React.useState<RoadType>('rural');
  const [distanceMiles, setDistanceMiles] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState('');
  const [difficulty, setDifficulty] = React.useState<Difficulty>('easy');
  const [surfaceQuality, setSurfaceQuality] = React.useState<SurfaceQuality>('good');
  const [avoidsTolls, setAvoidsTolls] = React.useState(false);
  const [avoidsMotorways, setAvoidsMotorways] = React.useState(false);
  const [scenicRating, setScenicRating] = React.useState<1 | 2 | 3 | 4 | 5>(3);
  const [safetyNotices, setSafetyNotices] = React.useState('');
  const [startLat, setStartLat] = React.useState('');
  const [startLon, setStartLon] = React.useState('');
  const [endLat, setEndLat] = React.useState('');
  const [endLon, setEndLon] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function toggleVehicle(category: VehicleCategory) {
    setVehicleSuitability((current) =>
      current.includes(category) ? current.filter((v) => v !== category) : [...current, category]
    );
  }

  function reset() {
    setName(''); setDescription(''); setVehicleSuitability([]); setRoadType('rural');
    setDistanceMiles(''); setDurationMinutes(''); setDifficulty('easy'); setSurfaceQuality('good');
    setAvoidsTolls(false); setAvoidsMotorways(false); setScenicRating(3); setSafetyNotices('');
    setStartLat(''); setStartLon(''); setEndLat(''); setEndLon(''); setError(null);
  }

  async function handleSubmit() {
    const parsedDistance = Number(distanceMiles);
    const parsedDuration = Number(durationMinutes);
    const parsedStartLat = Number(startLat);
    const parsedStartLon = Number(startLon);
    const parsedEndLat = Number(endLat);
    const parsedEndLon = Number(endLon);

    if (!name.trim() || !description.trim()) return setError('Add a name and description.');
    if (vehicleSuitability.length === 0) return setError('Choose at least one vehicle type.');
    if (!Number.isFinite(parsedDistance) || parsedDistance <= 0) return setError('Distance must be a positive number.');
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) return setError('Duration must be a positive number.');
    if ([parsedStartLat, parsedStartLon, parsedEndLat, parsedEndLon].some((v) => Number.isNaN(v))) {
      return setError('Start and end coordinates must be numbers.');
    }
    if (Math.abs(parsedStartLat) > 90 || Math.abs(parsedEndLat) > 90 || Math.abs(parsedStartLon) > 180 || Math.abs(parsedEndLon) > 180) {
      return setError('Coordinates are out of range.');
    }

    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        vehicleSuitability,
        roadType,
        distanceMiles: parsedDistance,
        estimatedDurationMinutes: parsedDuration,
        difficulty,
        surfaceQuality,
        avoidsTolls,
        avoidsMotorways,
        scenicRating,
        safetyNotices: safetyNotices.trim() ? safetyNotices.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        startLat: parsedStartLat,
        startLon: parsedStartLon,
        endLat: parsedEndLat,
        endLon: parsedEndLon,
      });
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this route.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add a scenic route</Text>
            <Text style={styles.modalSubtitle}>
              This isn't reviewed by Rider Comms yet — only enter routes and safety notes you can vouch for yourself.
            </Text>

            <TextInput style={styles.input} placeholder="Route name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} maxLength={80} />
            <TextInput style={[styles.input, styles.multiline]} placeholder="Description" placeholderTextColor={colors.textMuted} value={description} onChangeText={setDescription} multiline maxLength={500} />

            <Text style={styles.fieldLabel}>Vehicle suitability</Text>
            <View style={styles.chipRow}>
              {VEHICLE_ORDER.map((v) => (
                <Chip key={v} label={VEHICLE_LABELS[v]} active={vehicleSuitability.includes(v)} onPress={() => toggleVehicle(v)} />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Road type</Text>
            <View style={styles.chipRow}>
              {ROAD_TYPE_ORDER.map((r) => (
                <Chip key={r} label={ROAD_TYPE_LABELS[r]} active={roadType === r} onPress={() => setRoadType(r)} />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Difficulty</Text>
            <View style={styles.chipRow}>
              {DIFFICULTY_ORDER.map((d) => (
                <Chip key={d} label={DIFFICULTY_LABELS[d]} active={difficulty === d} onPress={() => setDifficulty(d)} />
              ))}
            </View>

            <Text style={styles.fieldLabel}>Surface quality</Text>
            <View style={styles.chipRow}>
              {SURFACE_ORDER.map((s) => (
                <Chip key={s} label={SURFACE_LABELS[s]} active={surfaceQuality === s} onPress={() => setSurfaceQuality(s)} />
              ))}
            </View>

            <View style={styles.rowFields}>
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Distance (mi)" placeholderTextColor={colors.textMuted} value={distanceMiles} onChangeText={setDistanceMiles} keyboardType="numeric" />
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Duration (min)" placeholderTextColor={colors.textMuted} value={durationMinutes} onChangeText={setDurationMinutes} keyboardType="numeric" />
            </View>

            <Text style={styles.fieldLabel}>Scenic rating</Text>
            <View style={styles.chipRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Chip key={n} label={String(n)} active={scenicRating === n} onPress={() => setScenicRating(n as 1 | 2 | 3 | 4 | 5)} />
              ))}
            </View>

            <View style={styles.chipRow}>
              <Chip label="Avoids tolls" active={avoidsTolls} onPress={() => setAvoidsTolls((v) => !v)} />
              <Chip label="Avoids motorways" active={avoidsMotorways} onPress={() => setAvoidsMotorways((v) => !v)} />
            </View>

            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Safety notices (one per line, optional)"
              placeholderTextColor={colors.textMuted}
              value={safetyNotices}
              onChangeText={setSafetyNotices}
              multiline
            />

            <Text style={styles.fieldLabel}>Start coordinates</Text>
            <View style={styles.rowFields}>
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Latitude" placeholderTextColor={colors.textMuted} value={startLat} onChangeText={setStartLat} keyboardType="numbers-and-punctuation" />
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Longitude" placeholderTextColor={colors.textMuted} value={startLon} onChangeText={setStartLon} keyboardType="numbers-and-punctuation" />
            </View>
            <Text style={styles.fieldLabel}>End coordinates</Text>
            <View style={styles.rowFields}>
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Latitude" placeholderTextColor={colors.textMuted} value={endLat} onChangeText={setEndLat} keyboardType="numbers-and-punctuation" />
              <TextInput style={[styles.input, styles.rowInput]} placeholder="Longitude" placeholderTextColor={colors.textMuted} value={endLon} onChangeText={setEndLon} keyboardType="numbers-and-punctuation" />
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable style={[styles.submitButton, saving && styles.submitButtonDisabled]} onPress={handleSubmit} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.submitButtonText}>Save route</Text>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ScenicRoutesScreen(): React.JSX.Element {
  const { client, riderId } = useAuth();
  const insets = useSafeAreaInsets();
  const [routes, setRoutes] = React.useState<ScenicRoute[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = React.useState<VehicleCategory | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const loadRoutes = React.useCallback(async () => {
    try {
      const { routes: fetched } = await client.listScenicRoutes(vehicleFilter ? { vehicleCategory: vehicleFilter } : {});
      setRoutes(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scenic routes.');
    } finally {
      setLoading(false);
    }
  }, [client, vehicleFilter]);

  React.useEffect(() => {
    setLoading(true);
    loadRoutes();
  }, [loadRoutes]);

  function confirmDelete(route: ScenicRoute) {
    Alert.alert('Delete this route?', `Remove "${route.name}" for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.deleteScenicRoute(route.id);
            setRoutes((current) => current.filter((r) => r.id !== route.id));
          } catch {
            Alert.alert("Couldn't delete route", 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Scenic Routes</Text>
            <Text style={styles.subtitle}>Curated by riders — not yet reviewed by Rider Comms.</Text>
          </View>
          <Pressable style={styles.addButton} onPress={() => setCreateOpen(true)} accessibilityLabel="Add a route">
            <Ionicons name="add" size={22} color={colors.accentText} />
          </Pressable>
        </View>

        <View style={styles.chipRow}>
          <Chip label="All vehicles" active={vehicleFilter === null} onPress={() => setVehicleFilter(null)} />
          {VEHICLE_ORDER.map((v) => (
            <Chip key={v} label={VEHICLE_LABELS[v]} active={vehicleFilter === v} onPress={() => setVehicleFilter(v)} />
          ))}
        </View>

        {loading && <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />}

        {!loading && error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorBoxText}>{error}</Text>
          </View>
        )}

        {!loading && !error && routes.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="road-variant" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No routes yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to add a scenic route for other riders to discover.
            </Text>
          </View>
        )}

        {routes.map((route) => (
          <RouteCard key={route.id} route={route} canDelete={route.createdBy === riderId} onDelete={() => confirmDelete(route)} />
        ))}
      </ScrollView>

      <CreateRouteModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          const created = await client.createScenicRoute(input);
          setRoutes((current) => [created, ...current]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { ...type.title },
  subtitle: { ...type.caption, marginTop: spacing.xs },
  addButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { ...type.caption, color: colors.textPrimary },
  chipTextActive: { color: colors.accentText, fontWeight: '700' },
  errorBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.dangerSurface, borderRadius: radii.md, padding: spacing.md },
  errorBoxText: { ...type.body, color: colors.danger, flex: 1 },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyTitle: { ...type.subheading, color: colors.textPrimary },
  emptySubtitle: { ...type.caption, textAlign: 'center', maxWidth: 260 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardName: { ...type.subheading, color: colors.textPrimary },
  starRow: { flexDirection: 'row', gap: 2, marginTop: spacing.xs },
  cardDescription: { ...type.body, color: colors.textSecondary },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  badgeText: { ...type.caption, color: colors.textPrimary },
  suitabilityLabel: { ...type.caption },
  safetyBox: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.sm },
  safetyText: { ...type.caption, color: colors.textSecondary },
  cardActions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionButtonText: { ...type.caption, color: colors.accent, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: spacing.lg, maxHeight: '88%' },
  modalHandle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  modalTitle: { ...type.heading, textAlign: 'center' },
  modalSubtitle: { ...type.caption, textAlign: 'center' },
  fieldLabel: { ...type.label, color: colors.textSecondary },
  input: { minHeight: MIN_TOUCH_TARGET * 0.8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, paddingHorizontal: spacing.md, ...type.body, color: colors.textPrimary },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: spacing.sm },
  rowFields: { flexDirection: 'row', gap: spacing.sm },
  rowInput: { flex: 1 },
  errorText: { ...type.body, color: colors.danger },
  submitButton: { minHeight: MIN_TOUCH_TARGET, backgroundColor: colors.accent, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { ...type.button, color: colors.accentText },
  cancelButton: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { ...type.button, color: colors.textMuted },
});
