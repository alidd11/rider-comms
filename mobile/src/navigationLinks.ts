import type { NavigationProvider } from './navigationPreference.ts';

export interface NavigationTarget {
  lat: number;
  lon: number;
  label?: string;
}

const MAX_LABEL_LENGTH = 120;

export interface NavigationUrlOpener {
  canOpenURL: (url: string) => Promise<boolean>;
  openURL: (url: string) => Promise<unknown>;
}

function isValidNavigationCoordinate(lat: unknown, lon: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function navigationTargetFromValues(
  lat: unknown,
  lon: unknown,
  label?: unknown
): NavigationTarget | null {
  if (!isValidNavigationCoordinate(lat, lon)) return null;
  if (label !== undefined && typeof label !== 'string') return null;

  const normalizedLabel = typeof label === 'string' ? label.trim() : '';
  if (normalizedLabel.length > MAX_LABEL_LENGTH || normalizedLabel.includes('\uFFFD')) return null;

  return {
    lat,
    lon: lon as number,
    ...(normalizedLabel ? { label: normalizedLabel } : {}),
  };
}

/** Parses only Rider Comms navigation links; all other paths and protocols fail closed. */
export function parseNavigationLink(rawUrl: string | null | undefined): NavigationTarget | null {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const isWebLink = url.protocol === 'https:' &&
      (url.pathname === '/navigate' || url.pathname === '/rider-comms/navigate');
    const isAppLink = url.protocol === 'ridercomms:' &&
      (url.hostname === 'navigate' || url.pathname === '/navigate');
    if (!isWebLink && !isAppLink) return null;

    const latText = url.searchParams.get('lat');
    const lonText = url.searchParams.get('lon');
    if (latText === null || lonText === null || !latText.trim() || !lonText.trim()) return null;

    const lat = Number(latText);
    const lon = Number(lonText);
    return navigationTargetFromValues(lat, lon, url.searchParams.get('label') ?? undefined);
  } catch {
    return null;
  }
}

export function buildNavigationProviderUrl(
  target: NavigationTarget,
  provider: Exclude<NavigationProvider, 'in_app'>
): string | null {
  const validated = navigationTargetFromValues(target.lat, target.lon, target.label);
  if (!validated) return null;

  const coordinate = `${validated.lat},${validated.lon}`;
  const label = validated.label ?? coordinate;

  if (provider === 'google_maps') {
    const params = new URLSearchParams({ api: '1', destination: coordinate, travelmode: 'driving' });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }
  if (provider === 'waze') {
    const params = new URLSearchParams({ ll: coordinate, navigate: 'yes' });
    return `https://www.waze.com/ul?${params.toString()}`;
  }
  return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(label)}&dirflg=d`;
}

/** Feature-detects the destination URL before handing control to the OS.
 * Unsupported schemes and platform failures share the same safe false result
 * so screens can retain context and offer a retry/provider change. */
export async function openNavigationUrl(url: string, opener: NavigationUrlOpener): Promise<boolean> {
  try {
    // Reject executable URLs and lookalike hosts before handing control to the OS.
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password ||
        (target.port && target.port !== '443')) return false;
    // Restrict handoff to the navigation endpoints this app actually generates.
    // A trusted hostname alone would also permit unrelated web pages.
    const isNavigationEndpoint =
      (target.hostname === 'www.google.com' && target.pathname === '/maps/dir/') ||
      (target.hostname === 'www.waze.com' && target.pathname === '/ul') ||
      (target.hostname === 'maps.apple.com' && target.pathname === '/');
    if (!isNavigationEndpoint) return false;
    if (!(await opener.canOpenURL(url))) return false;
    await opener.openURL(url);
    return true;
  } catch {
    return false;
  }
}
