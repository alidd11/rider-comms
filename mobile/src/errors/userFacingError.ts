import { ApiError } from '../api/client';

/** Server refusals with a message of their own, worded for riders. */
const KNOWN_REFUSALS: Readonly<Record<string, string>> = {
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  objectionable_content: 'That isn’t allowed here. Try different wording.',
  email_verification_required: 'Verify your email first, then try again.',
  unauthorized: 'Your session has expired. Sign in again.',
};

/**
 * What to show a rider when something fails: never raw error text such as
 * "API error 403: {...}" or "Network request failed". `fallback` says what
 * didn't happen ("Couldn’t create that hideout."); a request that got no
 * answer, or a server error, adds a pointer to the connection.
 */
export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const code = typeof error.body === 'object' && error.body && 'error' in (error.body as Record<string, unknown>)
      ? String((error.body as Record<string, unknown>).error)
      : '';
    if (KNOWN_REFUSALS[code]) return KNOWN_REFUSALS[code]!;
    if (error.status === 408 || error.status >= 500) return `${fallback} Check your connection and try again.`;
    return fallback;
  }
  return `${fallback} Check your connection and try again.`;
}
