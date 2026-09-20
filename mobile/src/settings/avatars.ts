export interface AvatarPreset {
  id: 'ember' | 'ridge' | 'moss' | 'dusk' | 'blaze' | 'gold' | 'slate' | 'rose';
  label: string;
  tagline: string;
  bg: string;
  motifPath: string;
  motifFill?: string;
}

/**
 * Rider Comms avatar masters.
 *
 * These eight IDs are already persisted in rider_profiles.avatar_id. Keep the
 * IDs stable so existing accounts retain their chosen identity while the
 * renderer can evolve. The PWA mirrors these exact colours and SVG paths; the
 * avatar parity check fails CI if either shell drifts.
 *
 * Geometry targets the shared 64x64 avatar viewBox. Every avatar uses the same
 * helmet/visor/eye silhouette and changes only its colour + forehead motif so
 * it remains recognisable at 24-32px map-marker sizes.
 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'ember',
    label: 'Ember',
    tagline: 'Always ready',
    bg: '#FF8A2B',
    motifPath: 'M32 10c-4 4-7 8-5 12 1.4 3 5.2 4.2 8 2.2 4-2.8 3-8-3-14Z',
  },
  {
    id: 'ridge',
    label: 'Ridge',
    tagline: 'Finds new roads',
    bg: '#4C8BF5',
    motifPath: 'M19 24l8-10 5 6 4-5 9 9H19Z',
  },
  {
    id: 'moss',
    label: 'Moss',
    tagline: 'Keeps it flowing',
    bg: '#3DD68C',
    motifPath: 'M21 24c3-9 11-12 22-11-2 8-8 12-17 11 4-3 8-6 13-8-7 2-12 4-18 8Z',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    tagline: 'Night ride',
    bg: '#8B5CF6',
    motifPath: 'M37 11a10 10 0 1 0 7 16 11 11 0 1 1-7-16Z',
  },
  {
    id: 'blaze',
    label: 'Blaze',
    tagline: 'Fast and focused',
    bg: '#FF5A5F',
    motifPath: 'M35 9 23 25h8l-3 12 13-19h-9l3-9Z',
    motifFill: '#071015',
  },
  {
    id: 'gold',
    label: 'Gold',
    tagline: 'Brightens the ride',
    bg: '#FBBF24',
    motifPath: 'm32 10 3.4 7 7.7 1.1-5.6 5.4 1.3 7.7-6.8-3.6-6.8 3.6 1.3-7.7-5.6-5.4 7.7-1.1L32 10Z',
    motifFill: '#071015',
  },
  {
    id: 'slate',
    label: 'Slate',
    tagline: 'Points the way',
    bg: '#64748B',
    motifPath: 'M32 10 44 26l-12-5-12 5 12-16Z',
    motifFill: '#071015',
  },
  {
    id: 'rose',
    label: 'Rose',
    tagline: 'Explores everywhere',
    bg: '#EC4899',
    motifPath: 'M32 10a7 7 0 0 0-7 7c0 6 7 13 7 13s7-7 7-13a7 7 0 0 0-7-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
    motifFill: '#071015',
  },
];

export type AvatarId = AvatarPreset['id'];
export const DEFAULT_AVATAR_ID: AvatarId = AVATAR_PRESETS[0].id;

export function getAvatarPreset(id: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}
