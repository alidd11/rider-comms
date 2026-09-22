/**
 * Waze-style crowdsourced hazard/road reports (police, accidents, generic
 * hazards, closures, speed cameras). Kept intentionally small and pure here
 * so both the backend store and any future client-side logic can reuse the
 * exact same TTL and "should this disappear" rules without drifting.
 *
 * `hidden_police` and `police_checkpoint` are both police-presence reports,
 * same as `police`/`camera`, just distinguishing *how* the presence shows up
 * (out of sight vs. a staffed roadside checkpoint) -- riders asked for that
 * distinction specifically, rather than folding it into the generic `police`
 * type.
 */
export type HazardType = 'police' | 'accident' | 'hazard' | 'road_closure' | 'camera' | 'hidden_police' | 'police_checkpoint';

export interface HazardReport {
  id: string;
  type: HazardType;
  lat: number;
  lon: number;
  reportedBy: string;
  createdAt: number;
  expiresAt: number;
  confirmations: number;
  denials: number;
}

/**
 * How long a report stays live before it's assumed stale, per type.
 *
 * - `police` / `camera`: checkpoints and mobile speed traps move on quickly
 *   (typically within the hour), so these expire fastest.
 * - `accident` / `hazard`: cleared or resolved within a couple of hours in
 *   the common case, so they get a mid-length window.
 * - `road_closure`: closures (construction, downed trees, flooding) commonly
 *   last for a whole riding day, so they get the longest window.
 */
export function ttlMsForType(type: HazardType): number {
  const HOUR_MS = 60 * 60 * 1000;
  switch (type) {
    case 'police':
    case 'camera':
    case 'hidden_police':
    case 'police_checkpoint':
      return HOUR_MS;
    case 'accident':
    case 'hazard':
      return 2 * HOUR_MS;
    case 'road_closure':
      return 8 * HOUR_MS;
  }
}

export function isExpired(report: HazardReport, nowMs: number): boolean {
  return nowMs >= report.expiresAt;
}

/**
 * Threshold for the crowd overriding the TTL: once denials outnumber
 * confirmations by 3 or more, the report is treated as gone/wrong and is
 * hidden immediately, even if it hasn't technically expired yet. 3 is
 * chosen to require a real signal (not a single troll denial) while still
 * reacting well before the TTL for a report that's clearly stale.
 */
export const HIDE_NET_DENIAL_THRESHOLD = 3;

export function shouldHide(report: HazardReport): boolean {
  return report.denials - report.confirmations >= HIDE_NET_DENIAL_THRESHOLD;
}
