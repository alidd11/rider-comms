import * as React from 'react';

export interface ActiveRide {
  rideId: string;
  code?: string;
  /** True only if this device created the ride — the backend doesn't track
   * roles beyond that, so a joined member is never a host. */
  isHost: boolean;
}

interface RideContextValue {
  activeRide: ActiveRide | null;
  startRide: (ride: ActiveRide) => void;
  leaveRide: () => void;
  // TODO(backend): there is no ride-membership endpoint at all — the
  // backend only knows "who's nearby" (presence), not "who's in this
  // ride." This roster is host-side-only local state so the add/remove
  // UI is real to interact with; wiring it to actually add/remove a
  // rider's access needs that endpoint built first.
  roster: string[];
  removeRider: (id: string) => void;
}

const RideContext = React.createContext<RideContextValue | null>(null);

const MOCK_ROSTER_ON_HOST = ['rider_alex82', 'maria_ktm'];

export function RideProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [activeRide, setActiveRide] = React.useState<ActiveRide | null>(null);
  const [roster, setRoster] = React.useState<string[]>([]);

  const startRide = React.useCallback((ride: ActiveRide) => {
    setActiveRide(ride);
    setRoster(ride.isHost ? MOCK_ROSTER_ON_HOST : []);
  }, []);

  const leaveRide = React.useCallback(() => {
    setActiveRide(null);
    setRoster([]);
  }, []);

  const removeRider = React.useCallback((id: string) => {
    setRoster((current) => current.filter((riderId) => riderId !== id));
  }, []);

  const value = React.useMemo(
    () => ({ activeRide, startRide, leaveRide, roster, removeRider }),
    [activeRide, startRide, leaveRide, roster, removeRider]
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = React.useContext(RideContext);
  if (!ctx) {
    throw new Error('useRide() must be called within a RideProvider');
  }
  return ctx;
}
