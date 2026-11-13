/** Which half of the social snapshot failed to refresh, and why. */
export class SocialRefreshError extends Error {
  readonly part: 'friends' | 'messages';
  readonly cause: unknown;
  constructor(part: 'friends' | 'messages', cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'SocialRefreshError';
    this.part = part;
    this.cause = cause;
  }
}

/**
 * Refreshes the friend network and message summaries independently: one
 * failing never discards the other's fresh snapshot. Rejects with a
 * SocialRefreshError naming the half that failed (friends first).
 */
export async function refreshAuthoritativeSocialSnapshot(
  refreshNetwork: () => Promise<void>,
  refreshMessages: () => Promise<void>,
): Promise<void> {
  const [network, messages] = await Promise.allSettled([refreshNetwork(), refreshMessages()]);
  if (network.status === 'rejected') throw new SocialRefreshError('friends', network.reason);
  if (messages.status === 'rejected') throw new SocialRefreshError('messages', messages.reason);
}

/**
 * One sentence for the Friends screen (PWA: friendsLoadErrorMessage): what
 * didn't load, then what to do. A request that never got an answer (no
 * signal, timeout, server error) points at the connection; never raw error text.
 */
export function socialRefreshErrorMessage(error: unknown): string {
  const part = error instanceof SocialRefreshError ? error.part : 'friends';
  const cause = error instanceof SocialRefreshError ? error.cause : error;
  const status = typeof (cause as { status?: unknown } | null)?.status === 'number' ? (cause as { status: number }).status : 0;
  const what = part === 'messages' ? 'Couldn’t load your messages.' : 'Couldn’t load friends.';
  return status === 0 || status >= 500 ? `${what} Check your connection and try again.` : `${what} Try again.`;
}
