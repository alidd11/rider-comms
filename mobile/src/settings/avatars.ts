export type AvatarFamily = 'helmet' | 'motorbike' | 'car';

export interface AvatarPreset {
  id: string;
  family: AvatarFamily;
  label: string;
  tagline: string;
  bg: string;
  secondary: string;
  accent: string;
  motifPath?: string;
  motifFill?: string;
  bodyPath?: string;
  glassPath?: string;
  detailPath?: string;
}

export const AVATAR_FAMILIES: ReadonlyArray<{ id: AvatarFamily; label: string }> = [
  { id: 'helmet', label: 'Helmets' },
  { id: 'motorbike', label: 'Motorbikes' },
  { id: 'car', label: 'Cars' },
];

/**
 * Rider Comms avatar collection.
 *
 * IDs are persisted in rider_profiles.avatar_id. Existing helmet IDs therefore
 * stay stable forever; the motorbike/car IDs extend the same field without a
 * database migration. PWA and native mirror these exact colours + SVG paths
 * and scripts/check-avatar-system.mjs fails CI if either shell drifts.
 *
 * The vehicle silhouettes intentionally use a 64x64 master and only a handful
 * of bold layers. That is what keeps them recognisable at the 40px live-map
 * size while still looking premium in the profile picker.
 */
export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  // Rider helmets — existing persisted IDs.
  { id: 'ember', family: 'helmet', label: 'Ember', tagline: 'Always ahead', bg: '#FF8A2B', secondary: '#9E2D0A', accent: '#22D3EE', motifPath: 'M32 10c-4 4-7 8-5 12 1.4 3 5.2 4.2 8 2.2 4-2.8 3-8-3-14Z' },
  { id: 'ridge', family: 'helmet', label: 'Ridge', tagline: 'Higher together', bg: '#4C8BF5', secondary: '#1746A2', accent: '#22D3EE', motifPath: 'M19 24l8-10 5 6 4-5 9 9H19Z' },
  { id: 'moss', family: 'helmet', label: 'Moss', tagline: 'Explore more', bg: '#3DD68C', secondary: '#147A4A', accent: '#22D3EE', motifPath: 'M21 24c3-9 11-12 22-11-2 8-8 12-17 11 4-3 8-6 13-8-7 2-12 4-18 8Z', motifFill: '#071015' },
  { id: 'dusk', family: 'helmet', label: 'Dusk', tagline: 'Rides later', bg: '#8B5CF6', secondary: '#4D2B9C', accent: '#22D3EE', motifPath: 'M37 11a10 10 0 1 0 7 16 11 11 0 1 1-7-16Z' },
  { id: 'blaze', family: 'helmet', label: 'Blaze', tagline: 'Full throttle', bg: '#FF5A5F', secondary: '#A51623', accent: '#22D3EE', motifPath: 'M35 9 23 25h8l-3 12 13-19h-9l3-9Z', motifFill: '#071015' },
  { id: 'gold', family: 'helmet', label: 'Gold', tagline: 'Ride royalty', bg: '#FBBF24', secondary: '#9A6500', accent: '#22D3EE', motifPath: 'm32 10 3.4 7 7.7 1.1-5.6 5.4 1.3 7.7-6.8-3.6-6.8 3.6 1.3-7.7-5.6-5.4 7.7-1.1L32 10Z', motifFill: '#071015' },
  { id: 'slate', family: 'helmet', label: 'Slate', tagline: 'Steady always', bg: '#64748B', secondary: '#334155', accent: '#22D3EE', motifPath: 'M32 10 44 26l-12-5-12 5 12-16Z', motifFill: '#071015' },
  { id: 'rose', family: 'helmet', label: 'Rose', tagline: 'Good company', bg: '#EC4899', secondary: '#9D174D', accent: '#22D3EE', motifPath: 'M32 10a7 7 0 0 0-7 7c0 6 7 13 7 13s7-7 7-13a7 7 0 0 0-7-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z', motifFill: '#071015' },

  // Motorbikes — front-on, deliberately simplified for map-size recognition.
  { id: 'bike_sport', family: 'motorbike', label: 'Sport', tagline: 'Pure speed', bg: '#FF4D55', secondary: '#8F111B', accent: '#EAF8FB', bodyPath: 'M19 27 23 17 29 12h6l6 5 4 10-5 8-3 17H27l-3-17-5-8Z', glassPath: 'M26 17h12l3 9-9 5-9-5 3-9Z', detailPath: 'M17 25h10M37 25h10M28 38h8' },
  { id: 'bike_naked', family: 'motorbike', label: 'Naked', tagline: 'Street ready', bg: '#3B82F6', secondary: '#173F8F', accent: '#EAF8FB', bodyPath: 'M23 29 25 20 30 16h4l5 4 2 9-4 7-2 16h-6l-2-16-4-7Z', glassPath: 'M27 21h10l2 6-7 3-7-3 2-6Z', detailPath: 'M15 24h12M37 24h12M25 34h14' },
  { id: 'bike_tourer', family: 'motorbike', label: 'Tourer', tagline: 'Long way home', bg: '#DCE6EC', secondary: '#667887', accent: '#22D3EE', bodyPath: 'M18 30 21 17 27 10h10l6 7 3 13-6 8-3 16H27l-3-16-6-8Z', glassPath: 'M25 12h14l4 13-11 5-11-5 4-13Z', detailPath: 'M16 27h10M38 27h10M24 39h16' },
  { id: 'bike_scooter', family: 'motorbike', label: 'Scooter', tagline: 'City flow', bg: '#F4F7F8', secondary: '#9AA8B2', accent: '#22D3EE', bodyPath: 'M24 26 27 15h10l3 11-2 7-1 20H27l-1-20-2-7Z', glassPath: 'M28 13h8l3 11-7 3-7-3 3-11Z', detailPath: 'M21 28h7M36 28h7M28 36h8' },
  { id: 'bike_adventure', family: 'motorbike', label: 'Adventure', tagline: 'Any road', bg: '#FF8A2B', secondary: '#8F4A10', accent: '#EAF8FB', bodyPath: 'M20 29 22 14 28 9h8l6 5 2 15-5 8-2 18H27l-2-18-5-8Z', glassPath: 'M27 10h10l4 15-9 4-9-4 4-15Z', detailPath: 'M14 27h12M38 27h12M24 35h16M30 7h4' },
  { id: 'bike_cruiser', family: 'motorbike', label: 'Cruiser', tagline: 'Take it easy', bg: '#8B5CF6', secondary: '#4C2B8C', accent: '#EAF8FB', bodyPath: 'M22 31 25 21 30 17h4l5 4 3 10-5 6-2 17h-6l-2-17-5-6Z', glassPath: 'M28 21h8l2 6-6 3-6-3 2-6Z', detailPath: 'M13 23h15M36 23h15M23 34h18' },
  { id: 'bike_retro', family: 'motorbike', label: 'Retro', tagline: 'Old soul', bg: '#3DD68C', secondary: '#156B47', accent: '#F6E7B0', bodyPath: 'M23 30 25 20 29 16h6l4 4 2 10-4 7-2 17h-6l-2-17-4-7Z', glassPath: 'M27 20h10l1 7-6 4-6-4 1-7Z', detailPath: 'M15 25h12M37 25h12M28 35h8' },
  { id: 'bike_electric', family: 'motorbike', label: 'Electric', tagline: 'Quiet torque', bg: '#22D3EE', secondary: '#0E7490', accent: '#EAF8FB', bodyPath: 'M21 29 24 18 29 13h6l5 5 3 11-5 8-2 17h-8l-2-17-5-8Z', glassPath: 'M27 16h10l3 10-8 4-8-4 3-10Z', detailPath: 'M16 25h11M37 25h11M29 35h6' },
  { id: 'bike_custom', family: 'motorbike', label: 'Custom', tagline: 'Made yours', bg: '#FBBF24', secondary: '#8B5C09', accent: '#EAF8FB', bodyPath: 'M22 31 24 19 29 14h6l5 5 2 12-5 6-2 18h-6l-2-18-5-6Z', glassPath: 'M28 20h8l1 6-5 3-5-3 1-6Z', detailPath: 'M12 22h17M35 22h17M26 35h12' },
  { id: 'bike_trail', family: 'motorbike', label: 'Trail', tagline: 'Further out', bg: '#79C76B', secondary: '#2F6F32', accent: '#EAF8FB', bodyPath: 'M21 29 23 15 28 10h8l5 5 2 14-5 8-2 18h-8l-2-18-5-8Z', glassPath: 'M27 13h10l3 11-8 4-8-4 3-11Z', detailPath: 'M14 26h13M37 26h13M25 35h14' },
  { id: 'bike_sport_touring', family: 'motorbike', label: 'Sport Touring', tagline: 'Fast and far', bg: '#4C8BF5', secondary: '#1E4F9F', accent: '#EAF8FB', bodyPath: 'M19 29 22 16 28 11h8l6 5 3 13-5 8-3 17H27l-3-17-5-8Z', glassPath: 'M26 14h12l4 11-10 5-10-5 4-11Z', detailPath: 'M15 26h11M38 26h11M25 36h14' },
  { id: 'bike_cafe_racer', family: 'motorbike', label: 'Cafe Racer', tagline: 'Classic pace', bg: '#F05A61', secondary: '#8C222B', accent: '#F8E5C0', bodyPath: 'M22 30 25 19 29 15h6l4 4 3 11-5 7-2 17h-6l-2-17-5-7Z', glassPath: 'M27 20h10l1 6-6 3-6-3 1-6Z', detailPath: 'M13 24h15M36 24h15M27 35h10' },

  // Cars — top-down silhouettes as shown in the approved collection board.
  { id: 'car_hatchback', family: 'car', label: 'Hatchback', tagline: 'Easy everywhere', bg: '#2388FF', secondary: '#0E4A96', accent: '#DFF7FF', bodyPath: 'M22 9h20l7 10 2 26-7 10H20l-7-10 2-26 7-10Z', glassPath: 'M23 18h18l4 8-2 9H21l-2-9 4-8Z', detailPath: 'M20 42h24M25 50h14' },
  { id: 'car_saloon', family: 'car', label: 'Saloon', tagline: 'Everyday refined', bg: '#E7EEF2', secondary: '#7C8B96', accent: '#CFF6FF', bodyPath: 'M21 8h22l6 11 1 27-6 10H20l-6-10 1-27 6-11Z', glassPath: 'M23 16h18l5 10-2 11H20l-2-11 5-10Z', detailPath: 'M19 42h26M24 51h16' },
  { id: 'car_suv', family: 'car', label: 'SUV', tagline: 'Room for more', bg: '#64748B', secondary: '#293646', accent: '#EAF8FB', bodyPath: 'M19 7h26l6 10v30l-7 10H20l-7-10V17l6-10Z', glassPath: 'M22 16h20l5 10-2 12H19l-2-12 5-10Z', detailPath: 'M18 43h28M22 52h20' },
  { id: 'car_4x4', family: 'car', label: '4x4', tagline: 'Explore further', bg: '#3DD68C', secondary: '#17633F', accent: '#EAF8FB', bodyPath: 'M18 7h28l7 10v31l-8 9H19l-8-9V17l7-10Z', glassPath: 'M21 16h22l5 9-2 13H18l-2-13 5-9Z', detailPath: 'M17 42h30M21 52h22M16 12h4M44 12h4' },
  { id: 'car_coupe', family: 'car', label: 'Coupe', tagline: 'Road focused', bg: '#FF4D55', secondary: '#991925', accent: '#EAF8FB', bodyPath: 'M23 8h18l8 12 1 24-8 12H22l-8-12 1-24 8-12Z', glassPath: 'M24 18h16l6 9-2 10H20l-2-10 6-9Z', detailPath: 'M20 43h24M27 51h10' },
  { id: 'car_convertible', family: 'car', label: 'Convertible', tagline: 'Open sky', bg: '#FBBF24', secondary: '#9A6500', accent: '#071015', bodyPath: 'M22 8h20l8 12v24l-8 12H22l-8-12V20l8-12Z', glassPath: 'M22 18h20l3 8-3 7H22l-3-7 3-8Z', detailPath: 'M19 40h26M24 49h16' },
  { id: 'car_estate', family: 'car', label: 'Estate', tagline: 'Carry the day', bg: '#3488FF', secondary: '#164E9D', accent: '#DFF7FF', bodyPath: 'M20 6h24l7 10v32l-7 9H20l-7-9V16l7-10Z', glassPath: 'M22 15h20l5 10-1 15H18l-1-15 5-10Z', detailPath: 'M18 45h28M23 53h18' },
  { id: 'car_van', family: 'car', label: 'Van', tagline: 'Built to carry', bg: '#F3F7F9', secondary: '#83919A', accent: '#22D3EE', bodyPath: 'M19 5h26l7 9v35l-8 8H20l-8-8V14l7-9Z', glassPath: 'M21 14h22l5 9-1 12H17l-1-12 5-9Z', detailPath: 'M17 43h30M21 52h22' },
  { id: 'car_pickup', family: 'car', label: 'Pickup', tagline: 'Ready to work', bg: '#FF8A2B', secondary: '#8B4611', accent: '#EAF8FB', bodyPath: 'M19 6h26l7 10v31l-8 10H20l-8-10V16l7-10Z', glassPath: 'M22 15h20l5 9-2 10H19l-2-10 5-9Z', detailPath: 'M18 40h28M18 45h28M22 53h20' },
  { id: 'car_supercar', family: 'car', label: 'Supercar', tagline: 'Peak performance', bg: '#8B5CF6', secondary: '#4C278F', accent: '#22D3EE', bodyPath: 'M24 8h16l10 13-1 22-9 13H24L15 43l-1-22 10-13Z', glassPath: 'M25 18h14l7 9-3 10H21l-3-10 7-9Z', detailPath: 'M20 43h24M28 51h8' },
  { id: 'car_classic', family: 'car', label: 'Classic', tagline: 'Icons live on', bg: '#47C48A', secondary: '#1D6A4A', accent: '#F6E7B0', bodyPath: 'M22 7h20l7 12v26l-7 12H22l-7-12V19l7-12Z', glassPath: 'M23 17h18l5 9-3 11H21l-3-11 5-9Z', detailPath: 'M19 42h26M25 51h14' },
  { id: 'car_electric', family: 'car', label: 'Electric', tagline: 'Future ready', bg: '#22D3EE', secondary: '#0E7490', accent: '#071015', bodyPath: 'M21 7h22l7 11v28l-7 11H21l-7-11V18l7-11Z', glassPath: 'M23 16h18l5 10-2 11H20l-2-11 5-10Z', detailPath: 'M19 43h26M27 50h10' },
];

export type AvatarId = string;
export const DEFAULT_AVATAR_ID: AvatarId = 'ember';

export function getAvatarPreset(id: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}

export function getAvatarFamily(id: string): AvatarFamily {
  return getAvatarPreset(id).family;
}
