// The collection lives in shared/ so every app on the account draws the same
// avatars; this module keeps the native import path stable.
export {
  AVATAR_FAMILIES,
  AVATAR_PRESETS,
  DEFAULT_AVATAR_ID,
  getAvatarFamily,
  getAvatarPreset,
} from '@rider-comms/shared';
export type { AvatarFamily, AvatarId, AvatarPreset } from '@rider-comms/shared';
