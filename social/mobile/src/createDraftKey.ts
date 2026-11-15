/**
 * Local composer text drafts are private to the signed-in Rider Comms account.
 * Never migrate the legacy unscoped draft: another rider might have authored it.
 * No passwords, bearer tokens, or media bytes are stored here.
 */
export const LEGACY_UNSCOPED_TEXT_DRAFT = '@rider-comms/social/create-text-draft-v1';
/**
 * The actual Rider Comms backend creates account IDs such as rider_ab12cd34.
 * Accept its underscore separator as well as existing UUID/hyphen IDs; do
 * not accept storage path separators, whitespace, traversal or unbounded IDs.
 */
export function isSafeRiderStorageId(riderId: string): boolean {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(riderId);
}

export function accountTextDraftKey(riderId: string): string {
  if (!isSafeRiderStorageId(riderId))
    throw new Error('Invalid Rider Comms account identifier');
  return '@rider-comms/social/create-text-draft-v2/' + riderId;
}
