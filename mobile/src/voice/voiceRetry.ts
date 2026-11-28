/**
 * How long to wait before the next voice reconnect: 2 s, 4 s, 8 s and so on,
 * up to a minute, matching the web app. During an outage this stops every
 * rider in a group asking for a token every two seconds; a successful
 * connection starts the sequence again.
 */
export function voiceRetryDelayMs(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt));
  return Math.min(2_000 * 2 ** Math.min(step, 5), 60_000);
}
