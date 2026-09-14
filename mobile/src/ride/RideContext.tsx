import * as React from 'react';

export interface ActiveRide {
  rideId: string;
  code?: string;
}

interface RideContextValue {
  activeRide: ActiveRide | null;
  startRide: (ride: ActiveRide) => void;
  leaveRide: () => void;
}

const RideContext = React.createContext<RideContextValue | null>(null);

export function RideProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [activeRide, setActiveRide] = React.useState<ActiveRide | null>(null);

  const startRide = React.useCallback((ride: ActiveRide) => setActiveRide(ride), []);
  const leaveRide = React.useCallback(() => setActiveRide(null), []);

  const value = React.useMemo(() => ({ activeRide, startRide, leaveRide }), [activeRide, startRide, leaveRide]);

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = React.useContext(RideContext);
  if (!ctx) {
    throw new Error('useRide() must be called within a RideProvider');
  }
  return ctx;
}
