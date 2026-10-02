const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Chat day label: "Today", "Yesterday", "Mon 30 Sep", or with the year when
 * it isn't this year. Shown before the first message of each day so times
 * from different days never read as one out-of-order conversation.
 */
export function formatMessageDay(createdAt: number, now: Date = new Date()): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return '';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** True when this message starts a new day in the thread. */
export function startsNewDay(createdAt: number, previousCreatedAt: number | undefined): boolean {
  if (previousCreatedAt === undefined) return true;
  return startOfDay(new Date(createdAt)) !== startOfDay(new Date(previousCreatedAt));
}
