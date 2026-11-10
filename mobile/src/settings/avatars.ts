export type AvatarFamily = 'helmet' | 'motorbike' | 'car';

export interface AvatarPreset {
  id: string;
  family: AvatarFamily;
  label: string;
  tagline: string;
  bg: string;
  secondary: string;
  accent: string;
  /** Vehicle wheel radius in the 64px master (default 7.5 bikes, 5.5 cars). */
  wheelRadius?: number;
  motifPath?: string;
  motifFill?: string;
  bodyPath?: string;
  seatPath?: string;
  glassPath?: string;
  trimPath?: string;
  detailPath?: string;
  accentPath?: string;
  tailPath?: string;
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
 * Vehicles are drawn side-on on a 64x64 master with shaded paint, glass and
 * real wheels, so they read at the 40px live-map size and still hold up large
 * in the profile picker.
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

  // Motorbikes — side-on, facing right, wheels on a shared ground line.
  { id: 'bike_sport', family: 'motorbike', label: 'Sport', tagline: 'Pure speed', bg: '#FF4D55', secondary: '#8F111B', accent: '#EAF8FB', bodyPath: 'M8 24.5L22 27.5L26 24C30 20.5 36 19.5 41 21L47 22.5C51 24 54 27 54.5 31L48 32.5L40 34L38 40L29 41.5L25 36L22 31L12 29Z', seatPath: 'M14 26.3C18 25.7 22 25.4 26 25.2L25.5 27.2L15 28.2Z', glassPath: 'M41 21C42.5 17.5 45.5 16 49 16.5L50.5 23.3L47 22.5Z', trimPath: 'M29 34H37L37.5 39.5L30 40.5Z', detailPath: 'M45 42L45.5 32M19 42L28 38M27 40.5L16 37', accentPath: 'M50.5 26L54 28.4L53.4 30.2L50 28.6ZM28 31.5L38 29.8L37.6 31.2L28.4 32.8Z' },
  { id: 'bike_naked', family: 'motorbike', label: 'Naked', tagline: 'Street ready', bg: '#3B82F6', secondary: '#173F8F', accent: '#EAF8FB', bodyPath: 'M9 27.5L20 29L25 26C29 21.5 35 20.5 40 22.5L41.5 28L36 31.5L26 31.5Z', seatPath: 'M12 27.5C16 27 21 26.8 25 26.8L24.5 28.6L13 29.2Z', trimPath: 'M26 31H38L40 39H28Z', detailPath: 'M45 42L40 22M37 21H44M19 42L30 37M28 40L14 38', accentPath: 'M41.5 25.5a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z' },
  { id: 'bike_tourer', family: 'motorbike', label: 'Tourer', tagline: 'Long way home', bg: '#DCE6EC', secondary: '#667887', accent: '#22D3EE', bodyPath: 'M12 27L24 28L28 24.5C32 20 38 19 44 20.5L50 23.5C53.5 26 55 29.5 54.5 33.5L47 34.5L40 35L39 40L30 41.5L26 37L23 33L14 32ZM10 30H22V38.5H10ZM6 20.5H16V27.5H6Z', seatPath: 'M16 26.5C20 25.8 24 25.4 28 25.2L27.5 27.3L17 28.2Z', glassPath: 'M44 20.5C44 15.5 46 11.5 50 10.5L53 23L50 23.5Z', trimPath: 'M30 35H38L38.5 40L31 41Z', detailPath: 'M45 42L45.5 34M19 42L28 38', accentPath: 'M51 28L54.5 30L54 32.5L50.5 31Z' },
  { id: 'bike_scooter', family: 'motorbike', label: 'Scooter', tagline: 'City flow', bg: '#F4F7F8', secondary: '#9AA8B2', accent: '#22D3EE', wheelRadius: 5.5, bodyPath: 'M10 31C10 26 15 24 21 25L27 26L31 36L37 36L41 22L46 20L49 23L47 37C44 41 38 42 31 42H18C13 42 10 37 10 31Z', seatPath: 'M12 25C16 22.5 23 22.5 28 24.5L27 26.5C22 25.5 16 25.5 12 27Z', glassPath: 'M44 20L45 14C46.5 13.5 48 14 48.5 15L48 20.5Z', detailPath: 'M45 44L46 23M42 19H50', accentPath: 'M47.5 24.5L50 25.5L49.5 28L47 27.5Z' },
  { id: 'bike_adventure', family: 'motorbike', label: 'Adventure', tagline: 'Any road', bg: '#FF8A2B', secondary: '#8F4A10', accent: '#EAF8FB', wheelRadius: 8, bodyPath: 'M9 25L20 27L25 24C29 19 36 18 42 20L46 22L52 25L49 28L45 27L41 31L33 33L26 32L22 30L12 30ZM10 29H20V36H10Z', seatPath: 'M13 25.4C17 24.6 21 24.2 25 24.1L24.6 26.2L14 26.9Z', glassPath: 'M42 20C42 15 44 12 47 11L49 21L46 22Z', trimPath: 'M27 32H39L41 37L33 39H28Z', detailPath: 'M45 41.5L43 22M19 41.5L30 36', accentPath: 'M46 23.5L49 24.5L48.5 26.5L45.5 25.7Z' },
  { id: 'bike_cruiser', family: 'motorbike', label: 'Cruiser', tagline: 'Take it easy', bg: '#8B5CF6', secondary: '#4C2B8C', accent: '#EAF8FB', bodyPath: 'M25 27C28 23 35 22 40 24L41 28L27 30ZM9 37C10 31 15 28 21 28.5L26 31L24 34C20 32 15 33 13 37ZM41 36C43 33.5 47 33.5 50 35.5L48 37C46 35.5 44 35.5 42 37Z', seatPath: 'M19 29C22 29.5 25 30 28 30L27 32L20 31.5Z', trimPath: 'M28 31L34 30L36 38L30 39ZM33 31L38 29L40 36L36 38Z', detailPath: 'M45 42L38 21M35 20C37 19.5 40 19.5 42 21M19 42L28 37M27 40L9 39', accentPath: 'M40.5 25a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0Z' },
  { id: 'bike_retro', family: 'motorbike', label: 'Retro', tagline: 'Old soul', bg: '#3DD68C', secondary: '#156B47', accent: '#F6E7B0', bodyPath: 'M25 26C28 22 35 21 39 23L40 28L27 29ZM20 29H26V33H20ZM11 35C12 31 16 30 20 31L22 33C19 32.5 15 33 13 35ZM40 34C43 32 47 32 50 34L49 36C46 34.5 44 34.5 41 35.5Z', seatPath: 'M12 27H25.5L25 29.5H13C12 29.5 11.5 28 12 27Z', trimPath: 'M27 30H37L38 38H29Z', detailPath: 'M45 42L40 23M37 21.5C39 21 42 21 44 22.5M19 42L28 37M21 31L18 40M29 39L13 39', accentPath: 'M40 25a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z' },
  { id: 'bike_electric', family: 'motorbike', label: 'Electric', tagline: 'Quiet torque', bg: '#22D3EE', secondary: '#0E7490', accent: '#EAF8FB', bodyPath: 'M9 28L21 29L26 25C31 21 38 20 44 22L48 25L44 27L40 33L28 36L24 33L14 32Z', seatPath: 'M12 27.6L21 28.2L25.5 25.8L21 25.6Z', trimPath: 'M27 31H40L38 38H29Z', detailPath: 'M45 42L43 25M41 23H47M19 42L30 37', accentPath: 'M44 23.5L48 25L46.5 26.3L43.5 25.2ZM29.5 33.5H37.5V34.7H29.5Z' },
  { id: 'bike_custom', family: 'motorbike', label: 'Custom', tagline: 'Made yours', bg: '#FBBF24', secondary: '#8B5C09', accent: '#EAF8FB', bodyPath: 'M24 27C27 24 32 23.5 36 25L36 28.5L25 29.5ZM10 36C11 32 15 30 20 30.5L22 33C18 32.5 15 33.5 13 36.5Z', seatPath: 'M18 30.5L25 29.5L26 31.5L19 32.5Z', trimPath: 'M26 30L31 29.5L33 38L27 38.5ZM30.5 30L35 28.5L37 36L33 37.5Z', detailPath: 'M45 42L36 24M35 24L33 16M32 16H37M19 42L28 37M15 30L13 22M27 40L8 38.5', accentPath: 'M37.5 25.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0Z' },
  { id: 'bike_trail', family: 'motorbike', label: 'Trail', tagline: 'Further out', bg: '#79C76B', secondary: '#2F6F32', accent: '#EAF8FB', wheelRadius: 8, bodyPath: 'M10 23L22 26L26 24L33 22L38 24L36 30L30 31L24 30L14 27ZM41 30L50 28.5L49 30.5L42 31.5ZM38 22L43 21L44 27L40 28Z', seatPath: 'M13 22.3L26 24.6L27.5 23.2L15 20.8Z', trimPath: 'M27 31H35L35 37H29Z', detailPath: 'M45 41.5L40 22M37 20H44M19 41.5L30 35M30 33L18 30', accentPath: 'M39.5 23.5L42 23L42.5 25.5L40.2 26Z' },
  { id: 'bike_sport_touring', family: 'motorbike', label: 'Sport Touring', tagline: 'Fast and far', bg: '#4C8BF5', secondary: '#1E4F9F', accent: '#EAF8FB', bodyPath: 'M9 26L21 28.5L25.5 25C29.5 21 36 19.5 42 21L48.5 23C52.5 25 54.5 28.5 54.5 32.5L48 33.5L40 34.5L38.5 40L29.5 41.5L25.5 36.5L22 32L12 30.5ZM11.5 30H21.5V37H11.5Z', seatPath: 'M13 26.8C17 26.1 21 25.7 25 25.6L24.6 27.6L14 28.4Z', glassPath: 'M42 21C43.5 17 46.5 15 50 14.8L51.2 23.6L48.5 23Z', trimPath: 'M30 35H38L38.5 40L31 41Z', detailPath: 'M45 42L45.5 33M19 42L28 38', accentPath: 'M50.5 27L54.2 29.3L53.8 31.3L50 29.7Z' },
  { id: 'bike_cafe_racer', family: 'motorbike', label: 'Cafe Racer', tagline: 'Classic pace', bg: '#F05A61', secondary: '#8C222B', accent: '#F8E5C0', bodyPath: 'M24 25C28 22 35 22 40 24L40 28L26 29ZM11 27C11 24 14 22.5 17 23L19 26.5L13 28Z', seatPath: 'M17 26L24.5 26L24 28.5L18 28.5Z', trimPath: 'M27 29H37L38 38H29Z', detailPath: 'M45 42L41 24M40 25L46 26M19 42L28 37M13 28L17 38M29 39L14 40', accentPath: 'M41 26a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z' },

  // Cars — side-on, facing right, wheels on the same ground line.
  { id: 'car_hatchback', family: 'car', label: 'Hatchback', tagline: 'Easy everywhere', bg: '#2388FF', secondary: '#0E4A96', accent: '#DFF7FF', bodyPath: 'M8 37C8 33 9 30 11 28L15 22C16 21 17.5 20.5 19 20.5H34C36 20.5 37.5 21.3 38.5 22.5L44 29L52 31C55 31.8 56.5 34 56.5 37V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M13.5 28.5L17 23C17.5 22.3 18.3 22 19 22H25V28.5ZM27 22H34C35.2 22 36.2 22.5 37 23.4L41.5 28.5H27Z', detailPath: 'M26 30V43M30 32H33', accentPath: 'M52.5 32.5L56 34V36L52 35Z', tailPath: 'M8.2 31L10 30.2V34H8.2Z' },
  { id: 'car_saloon', family: 'car', label: 'Saloon', tagline: 'Everyday refined', bg: '#E7EEF2', secondary: '#7C8B96', accent: '#CFF6FF', bodyPath: 'M8 37.5C8 34.5 9.5 32.5 12 32L18 31L23 23.5C24 22 25.5 21.5 27 21.5H37C38.6 21.5 40 22.3 41 23.6L46 30.5L52.5 32C55 32.6 56.5 34.5 56.5 37V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M20 30.5L24.5 24C25 23.3 25.8 23 26.6 23H31.5V30.5ZM33.5 23H37C38 23 39 23.5 39.6 24.4L43.6 30.5H33.5Z', detailPath: 'M32.5 32V43M27 33.5H30', accentPath: 'M53 33.5L56.3 35V37L52.6 36Z', tailPath: 'M8.2 34L11 33V36.2H8.2Z' },
  { id: 'car_suv', family: 'car', label: 'SUV', tagline: 'Room for more', bg: '#64748B', secondary: '#293646', accent: '#EAF8FB', wheelRadius: 6.5, bodyPath: 'M8 36V24.5C8 22.5 9.5 21 11.5 20.5L14 18H38C39.6 18 41 18.7 42 20L47 27L53 29C55.3 29.7 56.5 31.5 56.5 34V43.5C56.5 44.6 55.6 45.5 54.5 45.5H52.5A7.5 7.5 0 0 037.5 45.5H26.5A7.5 7.5 0 0 011.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M10 27V23.5C10 22.5 10.8 21.7 11.8 21.4L14.5 19.5H21V27ZM23 19.5H30V27H23ZM32 19.5H37.5C38.6 19.5 39.6 20 40.3 20.9L44.5 27H32Z', detailPath: 'M31 28V42M22 28V40M13 17H38', accentPath: 'M53 30.5L56.3 32V34.5L52.6 33.4Z', tailPath: 'M8.2 27H10.2V33H8.2Z' },
  { id: 'car_4x4', family: 'car', label: '4x4', tagline: 'Explore further', bg: '#3DD68C', secondary: '#17633F', accent: '#EAF8FB', wheelRadius: 7, bodyPath: 'M10 36V21C10 19.3 11.3 18 13 18H38L44 26L52.5 27.5C54.8 28 56.5 30 56.5 32.5V43.5C56.5 44.6 55.6 45.5 54.5 45.5H53A8 8 0 0 037 45.5H27A8 8 0 0 011 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M12.5 26V21.5C12.5 20.7 13.2 20 14 20H22V26ZM24 20H31V26H24ZM33 20H37.2L41.6 26H33Z', trimPath: 'M13 15.5H37V17H13ZM15.5 17H17V18H15.5ZM24 17H25.5V18H24ZM32.5 17H34V18H32.5ZM4 31a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0ZM52 40H57.5V44H52Z', detailPath: 'M32 27V42M23 27V41', accentPath: 'M52.5 29L56.3 30.2V32.6L52.2 31.6Z' },
  { id: 'car_coupe', family: 'car', label: 'Coupe', tagline: 'Road focused', bg: '#FF4D55', secondary: '#991925', accent: '#EAF8FB', bodyPath: 'M8 39C8 36 9.5 34 12 33.5L19 32L26 25C27.5 23.6 29.4 23 31.4 23H37C39 23 40.7 23.9 41.8 25.4L46 31L53 32.5C55.3 33 56.5 35 56.5 37.5V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M22 31.5L27.5 26C28.4 25 29.7 24.5 31 24.5H35V31.5ZM36.5 24.5H37.2C38.4 24.5 39.4 25 40.1 26L43.8 31.5H36.5Z', detailPath: 'M36 33V43M30 34.5H33', accentPath: 'M53 34L56.3 35.6V37.5L52.6 36.5Z', tailPath: 'M8.2 35.5L11 34.5V37.6H8.2Z' },
  { id: 'car_convertible', family: 'car', label: 'Convertible', tagline: 'Open sky', bg: '#FBBF24', secondary: '#9A6500', accent: '#071015', bodyPath: 'M8 38C8 35 9.5 33.2 12 32.7L20 31.5H45L53 33C55.3 33.4 56.5 35.3 56.5 37.8V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M39 31.5L35.5 24.5L37 24L41.5 31.5Z', trimPath: 'M22 31.5V27C22 26 22.8 25.3 23.8 25.3H25C26 25.3 26.6 26 26.6 27V31.5ZM29 31.5V27.5C29 26.6 29.7 26 30.6 26H31.6C32.5 26 33 26.6 33 27.5V31.5Z', detailPath: 'M33 33V43M27 34.5H30', accentPath: 'M53 34L56.3 35.6V37.5L52.6 36.5Z', tailPath: 'M8.2 35L11 34V37.2H8.2Z' },
  { id: 'car_estate', family: 'car', label: 'Estate', tagline: 'Carry the day', bg: '#3488FF', secondary: '#164E9D', accent: '#DFF7FF', bodyPath: 'M8 37V28C8 25.5 9.5 23.5 12 22.5L15 21.2C16 20.7 17 20.5 18 20.5H36C37.7 20.5 39.2 21.3 40.2 22.6L45 29.5L52.5 31.3C55 31.9 56.5 34 56.5 36.5V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M10.5 29V27C10.5 25.5 11.4 24.2 12.8 23.6L16 22.2H20V29ZM22 22.2H29V29H22ZM31 22.2H36C37 22.2 38 22.7 38.6 23.5L42.5 29H31Z', detailPath: 'M30 30V43M21 30V41M12 19.5H36', accentPath: 'M53 32.5L56.3 34V36L52.6 35Z', tailPath: 'M8.2 29H10.2V34H8.2Z' },
  { id: 'car_van', family: 'car', label: 'Van', tagline: 'Built to carry', bg: '#F3F7F9', secondary: '#83919A', accent: '#22D3EE', bodyPath: 'M8 43.5V17C8 15.3 9.3 14 11 14H41C42.8 14 44.3 15 45 16.6L49 26L53.5 28C55.4 28.9 56.5 30.7 56.5 32.8V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M37 16H40.6C41.6 16 42.5 16.6 42.9 17.5L46.5 26H37ZM10.5 17.5H17V24H10.5Z', detailPath: 'M35 16V44M24 16V40M28 30H31', accentPath: 'M53 29.5L56.3 31V33.5L52.6 32.5Z', tailPath: 'M8.2 28H10V35H8.2Z' },
  { id: 'car_pickup', family: 'car', label: 'Pickup', tagline: 'Ready to work', bg: '#FF8A2B', secondary: '#8B4611', accent: '#EAF8FB', bodyPath: 'M8 43.5V30H28V20.5C28 19.4 28.9 18.5 30 18.5H39C40.5 18.5 41.8 19.3 42.6 20.5L47 27.5L53 29.2C55.2 29.8 56.5 31.6 56.5 33.9V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M30 27.5V21.5C30 20.9 30.4 20.5 31 20.5H38.6C39.4 20.5 40.1 20.9 40.5 21.6L44.4 27.5Z', trimPath: 'M8 30H28V31.6H8Z', detailPath: 'M28 32V44M33 30H36', accentPath: 'M53 30.5L56.3 32V34.3L52.6 33.4Z', tailPath: 'M8.2 32.5H10V37H8.2Z' },
  { id: 'car_supercar', family: 'car', label: 'Supercar', tagline: 'Peak performance', bg: '#8B5CF6', secondary: '#4C278F', accent: '#22D3EE', bodyPath: 'M7 40C7 37.5 8 36 10 35.2L16 33L24 28.5C26 27.3 28.3 26.7 30.6 26.7H35C36.8 26.7 38.5 27.4 39.8 28.6L45 33.2L54 35.3C56 35.8 57 37.3 57 39.3V43.5C57 44.6 56.1 45.5 55 45.5H51.5A6.5 6.5 0 0 0 38.5 45.5H25.5A6.5 6.5 0 0 0 12.5 45.5H9C7.9 45.5 7 44.6 7 43.5Z', glassPath: 'M24.5 32L28 29.5C29 28.8 30.2 28.4 31.4 28.4H35C36.3 28.4 37.5 28.9 38.4 29.8L42 33.2H25.5Z', trimPath: 'M20 37L27 35.5V38.5L21 39.5ZM6 31H14V32.6H6ZM8.6 32.6H10V35H8.6Z', accentPath: 'M53 36L57 37V38.6L52.6 38Z', tailPath: 'M7.2 37L10 36.2V38.6H7.2Z' },
  { id: 'car_classic', family: 'car', label: 'Classic', tagline: 'Icons live on', bg: '#47C48A', secondary: '#1D6A4A', accent: '#F6E7B0', bodyPath: 'M8 43.5V39C8 31 14 21.5 27 21.5H31C38 21.5 42 25 45 30.5C51 31 56.5 33.5 56.5 39V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 0 38.5 45.5H25.5A6.5 6.5 0 0 0 12.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M16 30C17.5 26.5 21 23.3 26 23.1V30ZM28 23.1H31C35.5 23.1 38.8 25.6 41 30H28Z', trimPath: 'M6.5 41.5H11V43.5H6.5ZM53.5 41.5H58V43.5H53.5Z', detailPath: 'M27 31V43M31 33H34', accentPath: 'M50.5 34a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z', tailPath: 'M8.6 35.5H10.4V38.5H8.6Z' },
  { id: 'car_electric', family: 'car', label: 'Electric', tagline: 'Future ready', bg: '#22D3EE', secondary: '#0E7490', accent: '#071015', bodyPath: 'M8 39C8 34 10 32.5 13 31.8L18 30.5L25 23.8C26.6 22.3 28.7 21.5 30.9 21.5H36.5C38.6 21.5 40.6 22.3 42.1 23.8L48 30L53.5 31.8C55.4 32.5 56.5 34.3 56.5 36.3V43.5C56.5 44.6 55.6 45.5 54.5 45.5H51.5A6.5 6.5 0 0 038.5 45.5H25.5A6.5 6.5 0 0 012.5 45.5H10C8.9 45.5 8 44.6 8 43.5Z', glassPath: 'M20 29.5L26 24.4C27.2 23.4 28.7 22.9 30.2 22.9H36.8C38.4 22.9 39.9 23.5 41 24.6L45.6 29.5Z', detailPath: 'M33 31V43M27.5 32.5H30.5', accentPath: 'M50 33H56.4V34.4H50Z', tailPath: 'M8.2 33.5H12V34.9H8.2Z' },
];

export type AvatarId = string;
export const DEFAULT_AVATAR_ID: AvatarId = 'ember';

export function getAvatarPreset(id: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}

export function getAvatarFamily(id: string): AvatarFamily {
  return getAvatarPreset(id).family;
}
