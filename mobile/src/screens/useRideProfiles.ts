import * as React from 'react';
import type { PublicRiderProfile, RiderCommsClient } from '../api/client';

// Ride locations themselves refresh every 10 seconds. Profile identity
// changes are lower urgency, but still reconcile during a live ride so a
// newly selected avatar appears without leaving/rejoining.
const RIDE_AVATAR_REFRESH_MS = 30_000;

/**
 * Fetches display identity (avatar/name) for every other rider currently in
 * the ride roster, keyed by rider id, and keeps it refreshed on a slow
 * cadence for the duration of the ride.
 */
export function useRideProfiles(
  client: RiderCommsClient,
  riderId: string,
  roster: readonly string[],
): Record<string, PublicRiderProfile> {
  const [rideProfiles, setRideProfiles] = React.useState<Record<string, PublicRiderProfile>>({});
  const rideRosterKey = React.useMemo(() => roster.slice().sort().join('|'), [roster]);

  React.useEffect(() => {
    let cancelled = false;
    const ids = roster.filter((id) => id !== riderId);

    if (!ids.length) {
      setRideProfiles({});
      return () => { cancelled = true; };
    }

    const refresh = async () => {
      try {
        const profiles = await client.getPublicProfiles(ids);
        if (!cancelled) setRideProfiles(profiles);
      } catch {
        // Best-effort refresh; keep whatever profiles are already shown.
      }
    };

    void refresh();
    const timer = setInterval(refresh, RIDE_AVATAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, riderId, rideRosterKey]);

  return rideProfiles;
}
