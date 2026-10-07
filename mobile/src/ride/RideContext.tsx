import * as React from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { ApiError, type RideMemberLocation } from '../api/client';

export const RIDE_LOCATION_REFRESH_MS = 10_000;
// Membership changes are handled immediately by explicit actions. The
// background reconciliation only needs to catch host removals/ends, so keep
// it aligned with the location cadence instead of polling twice as often.
export const RIDE_ROSTER_REFRESH_MS = 10_000;
// Three failed ticks (~30 s), matching the web app's notice.
const RIDE_UNREACHABLE_TICKS = 3;
const RIDE_RESTORE_RETRY_MS = 10_000;

export interface ActiveRide {
  rideId: string;
  code?: string;
  isHost: boolean;
  shareRideLocation?: boolean;
}

interface Value {
  activeRide: ActiveRide | null;
  startRide: (ride: ActiveRide, shareRideLocation?: boolean) => Promise<void>;
  leaveRide: () => Promise<void>;
  roster: string[];
  removeRider: (id: string) => Promise<void>;
  rideLocations: RideMemberLocation[];
  /** True after several location ticks in a row failed to reach the backend,
   * so group positions on the map are going out of date. */
  rideLocationsUnreachable: boolean;
  shareRideLocation: boolean;
  setRideLocationSharing: (enabled: boolean) => Promise<boolean>;
}

const RideContext = React.createContext<Value | null>(null);

export function RideProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { client, riderId } = useAuth();
  const [activeRide, setActiveRide] = React.useState<ActiveRide | null>(null);
  const [roster, setRoster] = React.useState<string[]>([]);
  const [rideLocations, setRideLocations] = React.useState<RideMemberLocation[]>([]);
  const [rideLocationsUnreachable, setRideLocationsUnreachable] = React.useState(false);
  const localRideChange = React.useRef(0);
  const activeRideId = React.useRef<string | null>(null);
  activeRideId.current = activeRide?.rideId ?? null;

  React.useEffect(() => {
    let cancelled = false;
    let restoreInFlight = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // The database owns membership and consent. Reconcile when a session
    // opens or the app returns to the foreground. A successful "no ride"
    // response is authoritative and does not need a 10-second idle poll;
    // only a transient failure schedules a retry.
    setActiveRide(null);
    setRoster([]);
    setRideLocations([]);

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!cancelled && !activeRideId.current && AppState.currentState === 'active') void restore();
      }, RIDE_RESTORE_RETRY_MS);
    };

    const restore = async () => {
      if (cancelled || restoreInFlight) return;
      restoreInFlight = true;
      const change = localRideChange.current;
      try {
        const { ride } = await client.getCurrentRide();
        if (cancelled || change !== localRideChange.current) return;
        setActiveRide(ride ? {
          rideId: ride.rideId,
          code: ride.code || undefined,
          isHost: ride.createdBy === riderId,
          shareRideLocation: ride.shareRideLocation === true,
        } : null);
        setRoster(ride?.memberIds ?? []);
        if (!ride?.shareRideLocation) setRideLocations([]);
      } catch {
        // Do not resume a cached ride or its private location sharing from
        // an unverified membership. Retry only after a genuine failure.
        scheduleRetry();
      } finally {
        restoreInFlight = false;
      }
    };

    void restore();
    const listener = AppState.addEventListener('change', (status) => {
      if (status !== 'active' || activeRideId.current) return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      void restore();
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      listener.remove();
    };
  }, [client, riderId]);

  const setSharingForRide = React.useCallback(async (rideId: string, enabled: boolean): Promise<boolean> => {
    if (enabled) {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) return false;
    }
    try {
      await client.setRideLocationSharing(rideId, enabled);
      localRideChange.current += 1;
      setActiveRide((current) => current?.rideId === rideId ? { ...current, shareRideLocation: enabled } : current);
      if (!enabled) setRideLocations([]);
      return true;
    } catch {
      return false;
    }
  }, [client]);

  const startRide = React.useCallback(async (ride: ActiveRide, shareRideLocation = false) => {
    localRideChange.current += 1;
    const initial = { ...ride, shareRideLocation: false };
    setActiveRide(initial);
    setRoster([riderId]);
    setRideLocations([]);
    if (shareRideLocation) await setSharingForRide(ride.rideId, true);
  }, [riderId, setSharingForRide]);

  const setRideLocationSharing = React.useCallback(async (enabled: boolean) => {
    if (!activeRide) return false;
    return setSharingForRide(activeRide.rideId, enabled);
  }, [activeRide, setSharingForRide]);

  const leaveRide = React.useCallback(async () => {
    const ride = activeRide;
    if (!ride) return;
    try {
      if (ride.isHost) await client.endRide(ride.rideId);
      else await client.leaveRide(ride.rideId);
      localRideChange.current += 1;
      setActiveRide(null);
      setRoster([]);
      setRideLocations([]);
    } catch {
      // Keep authoritative local ride state when the server operation fails.
      // The rider can retry instead of appearing to have left when they have not.
    }
  }, [activeRide, client]);

  const removeRider = React.useCallback(async (id: string) => {
    if (!activeRide?.isHost || id === riderId) return;
    try {
      const updated = await client.removeRideMember(activeRide.rideId, id);
      setRoster(updated.memberIds);
      setRideLocations((current) => current.filter((location) => location.riderId !== id));
    } catch {
      // Preserve the server-authoritative roster on failure.
    }
  }, [activeRide, client, riderId]);

  React.useEffect(() => {
    if (!activeRide) return;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || AppState.currentState !== 'active') return;
      const change = localRideChange.current;
      try {
        const ride = await client.getRide(activeRide.rideId);
        if (!cancelled && change === localRideChange.current) {
          setRoster(ride.memberIds);
          setActiveRide((current) => current?.rideId === ride.rideId ? {
            ...current, isHost: ride.createdBy === riderId,
            shareRideLocation: ride.shareRideLocation === true,
            code: ride.code || undefined,
          } : current);
        }
      } catch (error) {
        if (!cancelled && error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setActiveRide(null);
          setRoster([]);
          setRideLocations([]);
        }
        // Transient refresh failures leave the last authoritative state intact
        // and are retried on the next poll.
      }
    };
    void refresh();
    const timer = setInterval(refresh, RIDE_ROSTER_REFRESH_MS);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
    // Keyed on the ride id, not the ride object: each poll replaces the
    // object, and depending on it would restart this polling loop every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide?.rideId, client, riderId]);

  React.useEffect(() => {
    setRideLocationsUnreachable(false);
    if (!activeRide?.shareRideLocation) {
      setRideLocations([]);
      return;
    }
    let cancelled = false;
    let unreachableTicks = 0;

    const tick = async () => {
      if (cancelled || AppState.currentState !== 'active') return;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted || cancelled) return;
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        let locations: RideMemberLocation[];
        try {
          ({ locations } = await client.updateRideLocation(
            activeRide.rideId,
            fix.coords.latitude,
            fix.coords.longitude,
          ));
        } catch (error) {
          // A network failure, timeout or 5xx means the backend is
          // unreachable; a 4xx is a real answer and doesn't count.
          if (!(error instanceof ApiError) || error.status >= 500) {
            unreachableTicks += 1;
            if (!cancelled && unreachableTicks >= RIDE_UNREACHABLE_TICKS) setRideLocationsUnreachable(true);
          }
          throw error;
        }
        unreachableTicks = 0;
        if (!cancelled) {
          setRideLocations(locations);
          setRideLocationsUnreachable(false);
        }
      } catch {
        // A missed foreground tick is retried. The backend expires locations
        // after 30s, so stale coordinates are never kept authoritative.
      }
    };

    void tick();
    const timer = setInterval(tick, RIDE_LOCATION_REFRESH_MS);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [activeRide?.rideId, activeRide?.shareRideLocation, client]);

  const value = React.useMemo(() => ({
    activeRide,
    startRide,
    leaveRide,
    roster,
    removeRider,
    rideLocations,
    rideLocationsUnreachable,
    shareRideLocation: activeRide?.shareRideLocation === true,
    setRideLocationSharing,
  }), [activeRide, startRide, leaveRide, roster, removeRider, rideLocations, rideLocationsUnreachable, setRideLocationSharing]);

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): Value {
  const value = React.useContext(RideContext);
  if (!value) throw new Error('useRide() must be called within RideProvider');
  return value;
}
