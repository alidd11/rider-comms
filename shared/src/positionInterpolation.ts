/**
 * Both clients receive rider positions in discrete jumps -- a poll every
 * 10-20s for group-ride/nearby-rider locations, a GPS fix every couple of
 * seconds even during turn-by-turn navigation. Snapping a marker straight to
 * each new fix (what this app used to do everywhere) reads as the map
 * "glitching" -- consumer nav apps never do that: they animate the puck
 * continuously between fixes so it looks like real motion, not teleporting.
 *
 * This is a linear lat/lon interpolation, not great-circle math -- deliberate:
 * every caller here is animating across a single polling interval or a
 * fraction of a second between GPS fixes, never a long-distance route, so the
 * tiny curvature error is invisible and not worth the extra complexity.
 */
export interface Coordinate {
  lat: number;
  lon: number;
}

export function lerpCoordinate(from: Coordinate, to: Coordinate, t: number): Coordinate {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: from.lat + (to.lat - from.lat) * clamped,
    lon: from.lon + (to.lon - from.lon) * clamped,
  };
}

/**
 * Tracks an in-flight glide from wherever a marker currently is toward a
 * target, and answers "where should it be drawn right now". Retargeting
 * mid-glide (a new fix arrives before the previous one finished animating)
 * starts the next glide from the current interpolated point rather than
 * snapping back to the old target first -- otherwise a burst of fast updates
 * would look like it's sawing back and forth instead of gliding forward.
 */
export class PositionAnimator {
  private from: Coordinate;
  private to: Coordinate;
  private startedAtMs: number;
  private durationMs: number;

  constructor(initial: Coordinate) {
    this.from = initial;
    this.to = initial;
    this.startedAtMs = 0;
    this.durationMs = 0;
  }

  moveTo(target: Coordinate, durationMs: number, nowMs: number): void {
    this.from = this.positionAt(nowMs);
    this.to = target;
    this.startedAtMs = nowMs;
    this.durationMs = Math.max(0, durationMs);
  }

  /** Jumps immediately to `position`, no glide -- for a marker's first fix. */
  reset(position: Coordinate): void {
    this.from = position;
    this.to = position;
    this.startedAtMs = 0;
    this.durationMs = 0;
  }

  positionAt(nowMs: number): Coordinate {
    if (this.durationMs <= 0) return this.to;
    const elapsed = nowMs - this.startedAtMs;
    return lerpCoordinate(this.from, this.to, elapsed / this.durationMs);
  }

  isSettled(nowMs: number): boolean {
    return nowMs - this.startedAtMs >= this.durationMs;
  }
}
