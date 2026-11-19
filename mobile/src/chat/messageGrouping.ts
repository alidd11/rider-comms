/** A message straight after another from the same rider, the same day and
 * within five minutes, sits tight under it, as in Messages (PWA: .follows). */
export function messageFollows(previous: { fromRiderId: string; createdAt: number } | undefined, message: { fromRiderId: string; createdAt: number }, newDay: boolean): boolean {
  return Boolean(previous && !newDay && previous.fromRiderId === message.fromRiderId
    && Math.abs(message.createdAt - previous.createdAt) < 5 * 60_000);
}
