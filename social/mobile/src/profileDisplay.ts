import { DEFAULT_PROFILE } from './garage';
import type { SocialProfileDraft } from './garage';

/** Never present the original demo biography or public-draft flag as a real
 * Rider Comms account preference. This is a device-only profile until a
 * server-backed Social profile contract is agreed.
 */
export function profileForRider(
  saved: SocialProfileDraft, username: string, fixturesEnabled: boolean,
): SocialProfileDraft {
  return {
    ...saved,
    displayName: saved.displayName === DEFAULT_PROFILE.displayName ? username : saved.displayName,
    bio: !fixturesEnabled && saved.bio === DEFAULT_PROFILE.bio ? '' : saved.bio,
    visibility: fixturesEnabled ? saved.visibility : 'private',
  };
}
