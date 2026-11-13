/**
 * Local composer text drafts are private to the signed-in Rider Comms account.
 * Never migrate the legacy unscoped draft: another rider might have authored it.
 * No passwords, bearer tokens, or media bytes are stored here.
 */
export const LEGACY_UNSCOPED_TEXT_DRAFT = '@rider-comms/social/create-text-draft-v1';
export function accountTextDraftKey(riderId: string): string {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(riderId))
    throw new Error('Invalid Rider Comms account identifier');
  return '@rider-comms/social/create-text-draft-v2/' + riderId;
}
