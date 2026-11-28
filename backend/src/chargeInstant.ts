/**
 * Strict, offset-bearing ISO timestamp parsing for FUTURE-ONLY charging
 * evidence. JavaScript Date.parse normalises 24:00 into the next day, which
 * must not silently change a route passage or operator-review timestamp.
 * This function never infers Europe/London offset from a bare local time.
 */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function parseChargeInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = ISO_INSTANT.exec(value);
  if (!parts) return null;
  const day = value.slice(0, 10);
  const midnight = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day)
    return null;
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (parts[8] !== 'Z') {
    const offsetHour = Number(parts[10]);
    const offsetMinute = Number(parts[11]);
    // ISO offsets here are capped at ±14:00, not ±14:59.
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))
      return null;
    offsetMinutes = (parts[9] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  const fraction = parts[7] ? Number(parts[7].padEnd(3, '0')) : 0;
  return midnight + ((hour * 60 + minute - offsetMinutes) * 60 + second) * 1000 + fraction;
}
