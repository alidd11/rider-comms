/** Send "typing" at most this often while the rider types (the server throttles the same). */
export const TYPING_SEND_INTERVAL_MS = 3_000;
/** Show "typing…" for this long after the friend's last signal. */
export const TYPING_SHOW_MS = 6_000;

export function shouldSendTyping(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= TYPING_SEND_INTERVAL_MS;
}

/**
 * The friend is typing when their last signal is recent and no message
 * from them has arrived since it.
 */
export function peerIsTyping(typingAt: number, now: number, lastPeerMessageAt = 0): boolean {
  return typingAt > 0 && now - typingAt < TYPING_SHOW_MS && lastPeerMessageAt < typingAt;
}
