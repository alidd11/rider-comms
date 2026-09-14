// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(native): this screen needs `expo-location` (or the bare RN geolocation
// API) for real GPS, which isn't installed in this sandbox. It's wired here
// against a `getCurrentLocation()` stub so the polling/zone-membership logic
// is real and swapping in real GPS is a one-line change, not a rewrite.
import * as React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { ZoneTier } from '@rider-comms/shared';
import { RiderCommsClient } from '../api/client';

const API_BASE_URL = 'http://localhost:4000';
const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s

// TODO(native): replace with expo-location's getCurrentPositionAsync().
async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  throw new Error('getCurrentLocation() requires expo-location (not available in this sandbox)');
}

export function PublicZoneScreen(): React.JSX.Element {
  const [tier, setTier] = React.useState<ZoneTier>('free');
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const client = new RiderCommsClient(API_BASE_URL);
    let cancelled = false;

    async function tick() {
      try {
        const { lat, lon } = await getCurrentLocation();
        const radiusMiles = TIER_RADIUS_MILES[tier];
        const { inZoneWith } = await client.updatePresence('me', lat, lon, radiusMiles);
        if (!cancelled) {
          setRidersInZone(inZoneWith);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not update your zone.');
        }
      }
    }

    tick();
    const interval = setInterval(tick, PRESENCE_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tier]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your zone: {TIER_RADIUS_MILES[tier]} mi</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={ridersInZone}
        keyExtractor={(id) => id}
        renderItem={({ item }) => (
          <View style={styles.riderRow}>
            <Text>{item}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No one in your zone right now.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  error: { color: '#c0392b', fontSize: 14, marginBottom: 12 },
  riderRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  empty: { color: '#999', textAlign: 'center', marginTop: 40 },
});
