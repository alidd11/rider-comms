import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface AvatarPreset {
  id: string;
  icon: IconName;
  bg: string;
}

// Motorcycle/rider-themed, not generic silhouettes — each preset pairs a
// riding-related glyph with a distinct background so a roster of avatars
// reads at a glance, the same way Discord/Slack's colored-initial grids do.
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'ember', icon: 'motorbike', bg: '#FF8A2B' },
  { id: 'ridge', icon: 'motorbike-electric', bg: '#4C8BF5' },
  { id: 'moss', icon: 'racing-helmet', bg: '#3DD68C' },
  { id: 'dusk', icon: 'road-variant', bg: '#8B5CF6' },
  { id: 'blaze', icon: 'speedometer', bg: '#FF5A5F' },
  { id: 'gold', icon: 'road', bg: '#FBBF24' },
  { id: 'slate', icon: 'compass-outline', bg: '#64748B' },
  { id: 'rose', icon: 'map-marker-distance', bg: '#EC4899' },
];

export const DEFAULT_AVATAR_ID = AVATAR_PRESETS[0].id;

export function getAvatarPreset(id: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}
