import * as React from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import {
  MovementStateTracker,
  isLockedForSafety,
  type MovementState,
} from '@rider-comms/shared';
import { toMovementFix } from './movementAdapter';

type MovementSafetyValue = {
  movementState: MovementState;
  lockedForSafety: boolean;
  locationAccess: 'checking' | 'promptable' | 'granted' | 'blocked' | 'services_disabled' | 'unavailable';
  trackingError: string | null;
  refreshTracking: () => Promise<void>;
  requestLocationAccess: () => Promise<void>;
  openLocationSettings: () => Promise<void>;
};

const MovementSafetyContext = React.createContext<MovementSafetyValue>({
  movementState: 'unknown',
  lockedForSafety: false,
  locationAccess: 'checking',
  trackingError: null,
  refreshTracking: async () => {},
  requestLocationAccess: async () => {},
  openLocationSettings: async () => {},
});

export function MovementSafetyProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const tracker = React.useRef(new MovementStateTracker()).current;
  const [movementState, setMovementState] = React.useState<MovementState>('unknown');
  const [locationAccess, setLocationAccess] = React.useState<MovementSafetyValue['locationAccess']>('checking');
  const [trackingError, setTrackingError] = React.useState<string | null>(null);
  const startRef = React.useRef<() => Promise<void>>(async () => {});
  const requestRef = React.useRef<() => Promise<void>>(async () => {});

  React.useEffect(() => {
    let mounted = true;
    let generation = 0;
    let subscription: Location.LocationSubscription | null = null;

    const stop = () => {
      generation += 1;
      subscription?.remove();
      subscription = null;
    };

    const start = async () => {
      stop();
      const requestGeneration = generation;
      const isCurrent = () => mounted && requestGeneration === generation;
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!isCurrent()) return;
        if (!servicesEnabled) {
          setLocationAccess('services_disabled');
          setTrackingError('Location Services are turned off.');
          setMovementState(tracker.markUnavailable());
          return;
        }
        const permission = await Location.getForegroundPermissionsAsync();
        if (!isCurrent()) return;
        if (!permission.granted) {
          setLocationAccess(permission.canAskAgain ? 'promptable' : 'blocked');
          setTrackingError(null);
          setMovementState(tracker.markUnavailable());
          return;
        }
        setLocationAccess('granted');
        setTrackingError(null);
        const nextSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 1_000,
            distanceInterval: 0,
          },
          (position) => {
            if (!isCurrent()) return;
            const next = tracker.addFix(toMovementFix(position));
            setMovementState(next);
          }
        );
        if (isCurrent()) subscription = nextSubscription;
        else nextSubscription.remove();
      } catch {
        if (!isCurrent()) return;
        setLocationAccess('unavailable');
        setTrackingError('Location tracking could not start. Try again or check device settings.');
        setMovementState(tracker.markUnavailable());
      }
    };
    startRef.current = start;
    requestRef.current = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!mounted) return;
        if (!permission.granted) {
          setLocationAccess(permission.canAskAgain ? 'promptable' : 'blocked');
          setTrackingError(permission.canAskAgain ? 'Location access was not granted.' : 'Location access is blocked in device settings.');
          setMovementState(tracker.markUnavailable());
          return;
        }
        await start();
      } catch {
        if (!mounted) return;
        setLocationAccess('unavailable');
        setTrackingError('Location permission could not be requested.');
        setMovementState(tracker.markUnavailable());
      }
    };

    void start();
    const staleTimer = setInterval(() => {
      if (mounted) setMovementState(tracker.stateAt(Date.now()));
    }, 2_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start();
      else {
        stop();
        setMovementState(tracker.markUnavailable());
      }
    });

    return () => {
      mounted = false;
      stop();
      clearInterval(staleTimer);
      appStateSubscription.remove();
    };
  }, [tracker]);

  const value = React.useMemo(() => ({
    movementState,
    lockedForSafety: isLockedForSafety(movementState),
    locationAccess,
    trackingError,
    refreshTracking: () => startRef.current(),
    requestLocationAccess: () => requestRef.current(),
    openLocationSettings: () => Linking.openSettings(),
  }), [locationAccess, movementState, trackingError]);

  return <MovementSafetyContext.Provider value={value}>{children}</MovementSafetyContext.Provider>;
}

export function useMovementSafety(): MovementSafetyValue {
  return React.useContext(MovementSafetyContext);
}
