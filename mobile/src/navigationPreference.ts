export type NavigationProvider = 'in_app' | 'google_maps' | 'waze' | 'apple_maps';

export const DEFAULT_NAVIGATION_PROVIDER: NavigationProvider = 'google_maps';

export const NAVIGATION_PROVIDER_OPTIONS: ReadonlyArray<{
  id: NavigationProvider;
  label: string;
  description: string;
}> = [
  { id: 'in_app', label: 'Rider Comms', description: 'Keep turn-by-turn guidance inside Rider Comms.' },
  { id: 'google_maps', label: 'Google Maps', description: 'Hand the destination to Google Maps.' },
  { id: 'waze', label: 'Waze', description: 'Hand the destination to Waze.' },
  { id: 'apple_maps', label: 'Apple Maps', description: 'Hand the destination to Apple Maps.' },
];

const PROVIDERS = new Set<NavigationProvider>(NAVIGATION_PROVIDER_OPTIONS.map((option) => option.id));

export function parseNavigationProvider(value: unknown): NavigationProvider {
  return typeof value === 'string' && PROVIDERS.has(value as NavigationProvider)
    ? value as NavigationProvider
    : DEFAULT_NAVIGATION_PROVIDER;
}

export function navigationProviderStorageKey(riderId: string): string {
  return `@rider-comms/settings/navigation-provider/${riderId}`;
}

export function navigationProviderLabel(provider: NavigationProvider): string {
  return NAVIGATION_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? 'Google Maps';
}
