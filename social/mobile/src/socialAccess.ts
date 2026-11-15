import { createContext, useContext } from 'react';
import type { SocialCapability } from './authClient';

/** What the server lets this rider do in Social (from /social/bootstrap). */
export type SocialAccess = Record<SocialCapability, boolean>;

const NONE: SocialAccess = {
  mediaUpload: false, privatePosting: false, publicPosting: false,
  liveStreaming: false, marketplaceCheckout: false, creatorPayouts: false,
};

export const SocialAccessContext = createContext<SocialAccess>(NONE);

export function useSocialAccess(): SocialAccess {
  return useContext(SocialAccessContext);
}

/** Uploading and posting to the test's shared feed are both switched on. */
export function canPublish(access: SocialAccess): boolean {
  return access.mediaUpload && access.publicPosting;
}
