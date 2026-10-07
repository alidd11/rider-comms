import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import type { MapPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';
import { styles } from './FriendChatScreen.styles';

/** Plan a hideout by tapping the map or using the rider's location. */
export function PlanHideoutModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, lat: number, lon: number) => Promise<void>;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [name, setName] = React.useState('');
  const [pin, setPin] = React.useState<{ latitude: number; longitude: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mapRef = React.useRef<MapView | null>(null);

  const canSubmit = name.trim().length > 0 && pin !== null && !saving;

  // Start from the rider's position when location is already allowed; never
  // prompt from here. Without it the rider can still tap anywhere on the map.
  const locateRider = React.useCallback(async (prompt: boolean) => {
    setLocating(true);
    try {
      const permission = prompt ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        if (prompt) setError('Allow location access in Settings, or tap the map to choose a spot.');
        return;
      }
      const position = await Location.getLastKnownPositionAsync() ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setPin(next);
      setError(null);
      mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
    } catch {
      if (prompt) setError('Could not find your location. Tap the map to choose a spot.');
    } finally {
      setLocating(false);
    }
  }, []);

  React.useEffect(() => {
    if (visible && !pin) void locateRider(false);
  }, [visible, pin, locateRider]);

  const handleCreate = async () => {
    if (!pin) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), pin.latitude, pin.longitude);
      setName('');
      setPin(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that hideout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessible={false} style={styles.modalBackdrop} onPress={onClose}>
        <Pressable accessible={false} style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.modalTitle}>Plan a hideout</Text>
              <Text style={styles.modalSubtitle}>Save a meeting point to plan around together.</Text>
            </View>
            <Pressable style={styles.modalClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close hideout planner">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <TextInput
            style={styles.modalInput}
            placeholder="Name (e.g. Gas station off Route 9)"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.modalSectionLabel}>Location</Text>
          <View style={styles.pickerMapFrame}>
            <MapView
              ref={mapRef}
              style={styles.pickerMap}
              initialRegion={{ latitude: pin?.latitude ?? 54.5, longitude: pin?.longitude ?? -3.0, latitudeDelta: pin ? 0.02 : 9, longitudeDelta: pin ? 0.02 : 9 }}
              onPress={(event: MapPressEvent) => { setPin(event.nativeEvent.coordinate); setError(null); }}
              accessibilityLabel="Map. Tap to place the hideout."
            >
              {pin ? <Marker coordinate={pin} draggable onDragEnd={(event) => setPin(event.nativeEvent.coordinate)} /> : null}
            </MapView>
          </View>
          <View style={styles.pickerActions}>
            <Text style={styles.modalCaption}>{pin ? 'Drag the pin or tap the map to move it.' : 'Tap the map to choose a spot.'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use my current location"
              onPress={() => void locateRider(true)}
              disabled={locating}
              style={styles.pickerLocate}
            >
              {locating ? <ActivityIndicator color={colors.accentInk} /> : <Ionicons name="locate" size={18} color={colors.accentInk} />}
              <Text style={styles.pickerLocateText}>My location</Text>
            </Pressable>
          </View>

          {error && (
            <View style={styles.modalErrorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.modalErrorText}>{error}</Text>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saving ? 'Saving hideout' : 'Save hideout'}
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
