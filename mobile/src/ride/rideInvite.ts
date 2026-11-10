// Ride invite codes as riders actually enter them: typed a character at a
// time, pasted as "ABC 123" or "abc-123", pasted as the host's whole share
// message, or opened from an invite link.

/** The same alphabet as @rider-comms/shared's generateRideCode, minus the
 * look-alikes 0/O and 1/I/L. Typed letters outside it are kept so the rider
 * sees what they typed; the server answers "no such ride". */
const CODE_CHARACTERS = /[^A-Z2-9]/g;
export const RIDE_CODE_LENGTH = 6;

const INVITE_SCHEME = 'ridercomms:';

/** The link the host shares; opening it fills in the code on the Ride tab. */
export function buildRideInviteLink(code: string): string {
  return `ridercomms://join?code=${encodeURIComponent(code)}`;
}

/** The code in a ridercomms://join?code=… link, or null for any other URL. */
export function parseRideInviteLink(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== INVITE_SCHEME) return null;
  if (url.hostname !== 'join' && url.pathname.replace(/^\/+/, '') !== 'join') return null;
  const code = (url.searchParams.get('code') ?? '').toUpperCase().replace(CODE_CHARACTERS, '');
  return code.length === RIDE_CODE_LENGTH ? code : null;
}

/**
 * What the code field should hold after `text` was typed or pasted into it.
 * Short input (typing) is just cleaned up. Longer input is a paste: an
 * invite link, or a message that contains the code, whose last
 * code-shaped word is taken.
 */
export function normalizeRideCodeInput(text: string): string {
  const fromLink = parseRideInviteLink(text.match(/ridercomms:\/\/\S+/i)?.[0]);
  if (fromLink) return fromLink;

  const compact = text.toUpperCase().replace(/[\s-]/g, '');
  if (compact.length <= RIDE_CODE_LENGTH) return compact.replace(CODE_CHARACTERS, '');

  const candidates = [...text.matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z2-9]{3})[\s-]?([A-Za-z2-9]{3})(?=$|[^A-Za-z0-9])/g)];
  const last = candidates.at(-1);
  if (last) return `${last[1]}${last[2]}`.toUpperCase();
  return compact.replace(CODE_CHARACTERS, '').slice(0, RIDE_CODE_LENGTH);
}

export function isCompleteRideCode(code: string): boolean {
  return /^[A-Z2-9]{6}$/.test(code);
}
