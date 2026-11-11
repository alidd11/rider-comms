import * as React from 'react';
import { isDarkOutside } from '@rider-comms/shared';

const FALLBACK_LAT = 51.564;
const CHECK_INTERVAL_MS = 60_000;

/** True from sunset to sunrise where the rider is (shared/src/daylight.ts). */
export function useDarkOutside(location: { lat: number; lon: number } | null | undefined): boolean {
  const lat = location?.lat ?? FALLBACK_LAT;
  const lon = location?.lon ?? -new Date().getTimezoneOffset() / 4;
  const [dark, setDark] = React.useState(() => isDarkOutside(lat, lon));
  // Whole degrees are enough to move sunset; don't re-arm on every GPS fix.
  const latKey = Math.round(lat);
  const lonKey = Math.round(lon);
  React.useEffect(() => {
    setDark(isDarkOutside(lat, lon));
    const timer = setInterval(() => setDark(isDarkOutside(lat, lon)), CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latKey, lonKey]);
  return dark;
}
