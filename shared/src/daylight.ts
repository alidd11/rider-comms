// Is it dark where the rider is? Used to switch the map to its dark style
// from sunset to sunrise, even when the phone itself is in light mode.
// NOAA's low-precision solar position (accurate to a few minutes), which is
// plenty for picking a map style. The PWA has the same function in
// docs/app/01-bootstrap.js (isDarkOutside); keep them in step.

const DEG = Math.PI / 180;
/** The sun's centre at sunset, allowing for refraction and its radius. */
export const SUNSET_ELEVATION_DEGREES = -0.833;

export function solarElevationDegrees(lat: number, lon: number, date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = hours * 60 + equationOfTime + 4 * lon;
  const hourAngle = (trueSolarMinutes / 4 - 180) * DEG;
  const cosZenith = Math.sin(lat * DEG) * Math.sin(declination)
    + Math.cos(lat * DEG) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / DEG;
}

/** True from sunset to sunrise at this place and time. */
export function isDarkOutside(lat: number, lon: number, date: Date = new Date()): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return solarElevationDegrees(lat, lon, date) < SUNSET_ELEVATION_DEGREES;
}
