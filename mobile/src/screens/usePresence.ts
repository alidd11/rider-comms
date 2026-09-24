import * as React from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { ApiError } from '../api/client';
import type { RiderCommsClient } from '../api/client';
import type { ActiveRide } from '../ride/RideContext';
import { microphoneErrorMessage, preflightVoiceMicrophone } from '../audio/microphone';

// per spec Section 8: every 5-10s
const PRESENCE_UPDATE_INTERVAL_MS = 8000;

export interface Presence {
  publicLive: boolean;
  ridersInZone: string[];
  handleNearbyToggle: () => Promise<void>;
}

/**
 * Owns Public Nearby / Nearby Voice's "Go live" state: the mutual-exclusion
 * rule with private-ride voice and the durable shareLocation setting, the
 * presence poll while live, and the Go Live button's own eligibility
 * checks (safety lock, email verification, microphone).
 *
 * locationUnavailable/error are shared, more general location-fetch state
 * that requestCurrentLocation itself (owned by MapScreen, used well beyond
 * presence) also writes to -- passed in as setters rather than duplicated
 * here, so there's exactly one copy of that state.
 */
export function usePresence(
  client: RiderCommsClient,
  activeRide: ActiveRide | null,
  shareLocation: boolean,
  setShareLocation: (value: boolean) => void,
  lockedForSafety: boolean,
  riderId: string,
  requestCurrentLocation: (
    showSettingsPrompt: boolean,
    accuracy: Location.Accuracy,
    refreshMovementTracking: boolean,
  ) => Promise<{ lat: number; lon: number; accuracyMeters: number; recordedAt: number } | null>,
  setLocationUnavailable: (value: boolean) => void,
  setError: (value: string | null) => void,
): Presence {
  const [publicLive, setPublicLive] = React.useState(false);
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);

  React.useEffect(() => {
    // Public Nearby and private ride voice are mutually exclusive. Durable
    // shareLocation remains the rider's consent preference, but disabling it
    // in Settings or entering a private ride must end the live public session.
    if (publicLive && (!shareLocation || activeRide)) setPublicLive(false);
  }, [activeRide, publicLive, shareLocation]);

  React.useEffect(() => {
    if (!publicLive) {
      setRidersInZone([]);
      void client.leavePresence();
      return;
    }
    let cancelled = false;

    async function tick() {
      // Nearby Voice authorisation is capped at <=100 m accuracy by the
      // backend. Ask for a high-accuracy fix while live so an otherwise valid
      // two-rider test is not rejected just because the generic map fix used
      // the lower-power Balanced mode.
      const location = await requestCurrentLocation(false, Location.Accuracy.High, false);
      if (!location || cancelled) return;
      const { lat, lon, accuracyMeters, recordedAt } = location;
      try {
        const { inZoneWith } = await client.updatePresence(lat, lon, accuracyMeters, recordedAt);
        if (!cancelled) {
          setRidersInZone(inZoneWith);
          setLocationUnavailable(false);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const code = err instanceof ApiError && typeof err.body === 'object' && err.body && 'error' in (err.body as Record<string, unknown>)
            ? String((err.body as Record<string, unknown>).error)
            : '';
          setLocationUnavailable(false);
          setError(code === 'email_verification_required'
            ? 'Verify your email before using Nearby Voice.'
            : code === 'location_sharing_disabled'
              ? 'Nearby location sharing is off. Tap Go live to enable it again.'
              : err instanceof Error ? err.message : 'Could not update your zone.');
          if (code === 'email_verification_required' || code === 'location_sharing_disabled') setPublicLive(false);
        }
      }
    }

    tick();
    const interval = setInterval(tick, PRESENCE_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      void client.leavePresence();
    };
  }, [client, publicLive, requestCurrentLocation, setError, setLocationUnavailable]);

  const handleNearbyToggle = React.useCallback(async () => {
    if (publicLive) {
      setPublicLive(false);
      setShareLocation(false);
      return;
    }
    if (lockedForSafety) {
      Alert.alert('Nearby Voice unavailable while moving', 'Stop safely before joining Nearby Voice. You can always leave or mute an active voice session while riding.');
      return;
    }
    try {
      const identity = await client.getMe();
      if (!identity.emailVerified) {
        Alert.alert('Verify your email', 'Verify your Rider Comms email before joining Nearby Voice.');
        return;
      }
    } catch {
      Alert.alert('Nearby Voice unavailable', 'Rider Comms could not confirm your account status. Check your connection and try again.');
      return;
    }
    try {
      await preflightVoiceMicrophone();
    } catch (microphoneError) {
      Alert.alert('Microphone unavailable', microphoneErrorMessage(microphoneError));
      return;
    }

    try {
      // The presence endpoint refuses a fix until the durable profile says
      // shareLocation=true. Confirm that backend write BEFORE flipping the
      // local setting; otherwise the presence effect can race the queued
      // SettingsContext save and fail the first Go Live with a 403.
      await client.updateProfile(riderId, { shareLocation: true });
      setShareLocation(true);
      setPublicLive(true);
    } catch {
      Alert.alert(
        'Nearby Voice unavailable',
        'Rider Comms could not enable Nearby Voice on the server. Check your connection and try again.',
      );
    }
  }, [client, lockedForSafety, publicLive, riderId, setShareLocation]);

  return { publicLive, ridersInZone, handleNearbyToggle };
}
