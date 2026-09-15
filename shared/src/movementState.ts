import { haversineMiles } from './distance.ts';

const METERS_PER_MILE = 1609.344;

export type MovementState = 'stationary' | 'moving' | 'unknown';

export interface LocationFix {
  lat: number;
  lon: number;
  /** Unix ms timestamp this fix was taken at. */
  timestampMs: number;
  /** Horizontal accuracy radius, in meters, as reported by the OS. */
  accuracyMeters: number;
  /** OS-reported ground speed in meters/second, when available. */
  speedMps?: number;
}

export interface MovementStateConfig {
  /** Fixes reporting worse (larger) accuracy than this are too noisy to
   * trust and are ignored entirely — they neither move the state toward
   * moving nor stationary. */
  maxUsableAccuracyMeters: number;
  /** Speed at/above which a fix counts as "moving" evidence. */
  movingSpeedMps: number;
  /** Speed at/below which a fix counts as "stationary" evidence —
   * deliberately lower than `movingSpeedMps` so a single reading hovering
   * near one threshold can't flip the state back and forth (hysteresis
   * band between the two). */
  stationarySpeedMps: number;
  /** Moving evidence must be sustained for at least this long before
   * locking. Kept short: erring toward locked is the safe direction. */
  confirmMovingMs: number;
  /** Stationary evidence must be sustained for at least this long before
   * unlocking. Kept long — this is the "delayed unlocking after stopping"
   * requirement, so a momentary red light doesn't unlock the feed. */
  confirmStationaryMs: number;
  /** If no usable fix arrives within this long, the state decays to
   * 'unknown' rather than silently trusting stale data forever. */
  staleAfterMs: number;
}

export const DEFAULT_MOVEMENT_CONFIG: MovementStateConfig = {
  maxUsableAccuracyMeters: 50,
  // ~3.1 mph: a brisk walk. A moving bicycle/motorcycle/car clears this
  // almost immediately, while GPS jitter on a stationary device very
  // rarely produces a sustained apparent speed this high.
  movingSpeedMps: 1.4,
  // ~1.1 mph: comfortably below the apparent speed GPS jitter alone tends
  // to produce for a genuinely stopped device, leaving a real gap between
  // this and movingSpeedMps for the hysteresis band.
  stationarySpeedMps: 0.5,
  confirmMovingMs: 2_000,
  confirmStationaryMs: 6_000,
  staleAfterMs: 20_000,
};

/**
 * Whether a consumer (e.g. the social video feed) should treat this state
 * as locked. 'unknown' is locked, same as 'moving' — never fail open on an
 * unclear reading. Only a confidently-confirmed 'stationary' state unlocks.
 */
export function isLockedForSafety(state: MovementState): boolean {
  return state !== 'stationary';
}

/**
 * Tracks whether a rider is currently moving, from a stream of location
 * fixes, for gating any interaction that must be unavailable while riding.
 * Deliberately never a single-GPS-reading decision: it debounces with
 * hysteresis (separate moving/stationary thresholds) and delayed
 * unlocking (a much longer confirmation window to declare stationary than
 * to declare moving), and fails toward 'moving'/locked whenever it can't
 * be confident, never toward 'stationary'/unlocked.
 *
 * KNOWN LIMITATION (passenger/accessibility): GPS motion alone cannot
 * distinguish the person riding from a passenger, or a rider using
 * adaptive controls, sitting in the same moving vehicle — the location
 * signal looks identical for both. This model only answers "is this
 * device currently in motion," which is the correct and sufficient input
 * for a rider-safety lockout; any passenger exemption is a separate,
 * explicit product decision layered on top (e.g. a manual, session-scoped
 * "I'm a passenger" acknowledgement) and must never be inferred silently
 * from the location signal itself.
 */
export class MovementStateTracker {
  private readonly config: MovementStateConfig;
  private state: MovementState = 'unknown';
  private lastGoodFix: LocationFix | null = null;
  private movingSinceMs: number | null = null;
  private stationarySinceMs: number | null = null;

  constructor(config: Partial<MovementStateConfig> = {}) {
    this.config = { ...DEFAULT_MOVEMENT_CONFIG, ...config };
  }

  get currentState(): MovementState {
    return this.state;
  }

  /** Feed one location fix. Returns the (possibly updated) state. */
  addFix(fix: LocationFix): MovementState {
    if (this.lastGoodFix && fix.timestampMs - this.lastGoodFix.timestampMs > this.config.staleAfterMs) {
      this.resetToUnknown();
    }

    if (fix.accuracyMeters > this.config.maxUsableAccuracyMeters) {
      return this.state;
    }

    const speedMps = this.deriveSpeed(fix);
    this.lastGoodFix = fix;
    this.applyEvidence(fix.timestampMs, speedMps);
    return this.state;
  }

  private deriveSpeed(fix: LocationFix): number {
    if (typeof fix.speedMps === 'number' && fix.speedMps >= 0) return fix.speedMps;
    // No reported speed and no prior fix to diff against — evidence-neutral
    // (0), not an assertion of movement.
    if (!this.lastGoodFix) return 0;

    const dtSeconds = (fix.timestampMs - this.lastGoodFix.timestampMs) / 1000;
    if (dtSeconds <= 0) return 0;

    const distanceMeters =
      haversineMiles(
        { lat: this.lastGoodFix.lat, lon: this.lastGoodFix.lon },
        { lat: fix.lat, lon: fix.lon }
      ) * METERS_PER_MILE;

    // The wider of the two fixes' accuracy circles is roughly the apparent
    // displacement GPS jitter alone can produce while genuinely stationary,
    // so subtract that noise floor before treating displacement as real.
    const noiseFloorMeters = Math.max(fix.accuracyMeters, this.lastGoodFix.accuracyMeters);
    const realDisplacementMeters = Math.max(0, distanceMeters - noiseFloorMeters);
    return realDisplacementMeters / dtSeconds;
  }

  private applyEvidence(atMs: number, speedMps: number): void {
    if (speedMps >= this.config.movingSpeedMps) {
      this.stationarySinceMs = null;
      if (this.movingSinceMs === null) this.movingSinceMs = atMs;
      if (atMs - this.movingSinceMs >= this.config.confirmMovingMs) this.state = 'moving';
    } else if (speedMps <= this.config.stationarySpeedMps) {
      this.movingSinceMs = null;
      if (this.stationarySinceMs === null) this.stationarySinceMs = atMs;
      if (atMs - this.stationarySinceMs >= this.config.confirmStationaryMs) this.state = 'stationary';
    } else {
      // In the hysteresis band between the two thresholds: ambiguous
      // evidence resets both confirmation windows but holds the last
      // confident state rather than flapping.
      this.movingSinceMs = null;
      this.stationarySinceMs = null;
    }
  }

  private resetToUnknown(): void {
    this.state = 'unknown';
    this.lastGoodFix = null;
    this.movingSinceMs = null;
    this.stationarySinceMs = null;
  }
}
