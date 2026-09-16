export interface NavigationTarget {
  lat: number;
  lon: number;
  label?: string;
}

const MAX_LABEL_LENGTH = 120;

export function isValidNavigationCoordinate(lat: unknown, lon: unknown): lat is number {
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

export function buildExternalNavigationUrl(
  target: NavigationTarget,
  platform: 'ios' | 'android'
): string | null {
  const validated = navigationTargetFromValues(target.lat, target.lon, target.label);
  if (!validated) return null;

  const coordinate = `${validated.lat},${validated.lon}`;
  const label = validated.label ?? coordinate;
  if (platform === 'ios') {
    return `https://maps.apple.com/?daddr=${encodeURIComponent(coordinate)}&q=${encodeURIComponent(label)}&dirflg=d`;
  }
  return `geo:${coordinate}?q=${encodeURIComponent(`${coordinate}(${label})`)}`;
}
