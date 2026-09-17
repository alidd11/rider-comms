import * as React from 'react';
import { AppState } from 'react-native';
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
  refreshTracking: () => Promise<void>;
};

const MovementSafetyContext = React.createContext<MovementSafetyValue>({
  movementState: 'unknown',
  lockedForSafety: true,
  refreshTracking: async () => {},
});

export function MovementSafetyProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const tracker = React.useRef(new MovementStateTracker()).current;
  const [movementState, setMovementState] = React.useState<MovementState>('unknown');
  const startRef = React.useRef<() => Promise<void>>(async () => {});

  React.useEffect(() => {
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const stop = () => {
      subscription?.remove();
      subscription = null;
    };

    const start = async () => {
      stop();
      const permission = await Location.getForegroundPermissionsAsync();
      if (!mounted || !permission.granted) {
        if (mounted) setMovementState(tracker.markUnavailable());
        return;
      }
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 1_000,
          distanceInterval: 0,
        },
        (position) => {
          if (!mounted) return;
          const next = tracker.addFix(toMovementFix(position));
          setMovementState(next);
        }
      );
    };
    startRef.current = start;

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
    refreshTracking: () => startRef.current(),
  }), [movementState]);

  return <MovementSafetyContext.Provider value={value}>{children}</MovementSafetyContext.Provider>;
}

export function useMovementSafety(): MovementSafetyValue {
  return React.useContext(MovementSafetyContext);
}
