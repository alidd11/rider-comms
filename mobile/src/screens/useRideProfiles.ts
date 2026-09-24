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
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          return [id, await client.getPublicProfile(id)] as const;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setRideProfiles(Object.fromEntries(entries.filter((entry): entry is readonly [string, PublicRiderProfile] => entry !== null)));
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
