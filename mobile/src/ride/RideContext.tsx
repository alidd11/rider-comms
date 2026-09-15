import * as React from 'react';
import { useAuth } from '../auth/AuthContext';
export interface ActiveRide { rideId: string; code?: string; isHost: boolean }
interface Value { activeRide: ActiveRide | null; startRide: (ride: ActiveRide) => void; leaveRide: () => Promise<void>; roster: string[]; removeRider: (id: string) => Promise<void> }
const RideContext = React.createContext<Value | null>(null);
export function RideProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { client, riderId } = useAuth(); const [activeRide, setActiveRide] = React.useState<ActiveRide | null>(null); const [roster, setRoster] = React.useState<string[]>([]);
  const startRide = React.useCallback((ride: ActiveRide) => { setActiveRide(ride); setRoster([riderId]); }, [riderId]);
  const leaveRide = React.useCallback(async () => { const ride = activeRide; setActiveRide(null); setRoster([]); if (!ride) return; try { if (ride.isHost) await client.endRide(ride.rideId); else await client.leaveRide(ride.rideId); } catch {} }, [activeRide, client]);
  const removeRider = React.useCallback(async (id: string) => { if (!activeRide?.isHost || id === riderId) return; setRoster((v) => v.filter((x) => x !== id)); try { setRoster((await client.removeRideMember(activeRide.rideId, id)).memberIds); } catch {} }, [activeRide, client, riderId]);
  React.useEffect(() => { if (!activeRide) return; let cancelled = false; const refresh = async () => { try { const ride = await client.getRide(activeRide.rideId); if (!cancelled) setRoster(ride.memberIds); } catch {} }; void refresh(); const timer = setInterval(refresh, 5000); return () => { cancelled = true; clearInterval(timer); }; }, [activeRide, client]);
  const value = React.useMemo(() => ({ activeRide, startRide, leaveRide, roster, removeRider }), [activeRide, startRide, leaveRide, roster, removeRider]);
  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}
export function useRide(): Value { const value = React.useContext(RideContext); if (!value) throw new Error('useRide() must be called within RideProvider'); return value; }
