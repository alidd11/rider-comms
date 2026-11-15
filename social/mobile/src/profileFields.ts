import { MAX_PROFILE_BIO_LENGTH } from '../../../shared/src/social.ts';

/** The Rider Comms limit for a display name. */
export const MAX_DISPLAY_NAME_LENGTH = 50;

/** The parts of the shared Rider Comms profile that Social edits. */
export interface ProfileFields {
  displayName: string;
  bio: string;
  avatarId: string;
}

/** The fields that changed, trimmed, or the reason the form can't be saved. */
export function profileChanges(initial: ProfileFields, draft: ProfileFields):
  { ok: true; changes: Partial<ProfileFields> } | { ok: false; error: string } {
  const displayName = draft.displayName.trim();
  const bio = draft.bio.trim();
  if (!displayName) return { ok: false, error: 'Enter a name.' };
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) return { ok: false, error: `Names can be up to ${MAX_DISPLAY_NAME_LENGTH} characters.` };
  if (bio.length > MAX_PROFILE_BIO_LENGTH) return { ok: false, error: `Bios can be up to ${MAX_PROFILE_BIO_LENGTH} characters.` };
  const changes: Partial<ProfileFields> = {};
  if (displayName !== initial.displayName) changes.displayName = displayName;
  if (bio !== initial.bio) changes.bio = bio;
  if (draft.avatarId !== initial.avatarId) changes.avatarId = draft.avatarId;
  return { ok: true, changes };
}
