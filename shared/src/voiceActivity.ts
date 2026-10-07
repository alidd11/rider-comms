/**
 * Hands-free voice activation (VOX) decision, shared by the native app and
 * the PWA (docs/voice-activity.js is the browser port, checked against this
 * by scripts/check-voice-activity.mjs).
 *
 * A fixed loudness threshold was either too eager (wind and engine noise
 * opened the mic) or too deaf (quiet speech didn't). This gate learns the
 * background level while the rider isn't talking and sets its thresholds
 * relative to it, so it needs speech clearly above the noise in a loud
 * place and still opens for normal speech in a quiet one.
 */

export interface VoiceActivityConfig {
  /** Lowest level that can open the mic, however quiet it is around. */
  minAttackLevel: number;
  /** Lowest level that keeps an open mic open. */
  minReleaseLevel: number;
  /** Speech must stand this many times above the noise floor to open the mic. */
  attackOverNoise: number;
  /** ...and this many times above it to keep the mic open. */
  releaseOverNoise: number;
  /** Speech must stay above the attack level this long (rejects single bumps). */
  attackHoldMs: number;
  /** Keep transmitting through pauses this long, so sentence tails aren't clipped. */
  hangtimeMs: number;
  /** The noise floor never rises above this. High enough that even loud,
   * steady wind is learnt (so it can't hold the mic open forever), low
   * enough that speech close to the mic can still open it. */
  maxNoiseFloor: number;
}

export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  minAttackLevel: 0.03,
  minReleaseLevel: 0.018,
  attackOverNoise: 2.2,
  releaseOverNoise: 1.5,
  attackHoldMs: 40,
  hangtimeMs: 900,
  maxNoiseFloor: 0.3,
};

// The floor follows quiet quickly (the rider stopped at lights) and noise
// slowly (so the start of speech isn't learnt as noise).
const FLOOR_FALL_PER_SECOND = 2.5;
const FLOOR_RISE_PER_SECOND = 0.35;
// While transmitting, the floor still drops in the gaps between words but
// creeps up only very slowly. Speech has gaps and steady noise doesn't, so a
// mic opened by a gust of wind closes again within seconds, and long
// speech stays open.
const FLOOR_RISE_WHILE_SPEAKING_PER_SECOND = 0.08;
// For the first moments the gate only listens, so a rider who starts in
// wind or engine noise doesn't open the mic before the noise is learnt.
const WARMUP_MS = 600;
const WARMUP_PER_SECOND = 5;

export interface VoiceActivityState {
  speaking: boolean;
  noiseFloor: number;
  attackLevel: number;
  releaseLevel: number;
}

export class VoiceActivityGate {
  private readonly config: VoiceActivityConfig;
  private speaking = false;
  private noiseFloor = 0;
  private aboveSince: number | null = null;
  private quietSince: number | null = null;
  private lastSampleAt: number | null = null;
  private startedAt: number | null = null;

  constructor(config: Partial<VoiceActivityConfig> = {}) {
    this.config = { ...DEFAULT_VOICE_ACTIVITY_CONFIG, ...config };
  }

  get state(): VoiceActivityState {
    return {
      speaking: this.speaking,
      noiseFloor: this.noiseFloor,
      attackLevel: this.attackLevel(),
      releaseLevel: this.releaseLevel(),
    };
  }

  private attackLevel(): number {
    return Math.max(this.config.minAttackLevel, this.noiseFloor * this.config.attackOverNoise);
  }

  private releaseLevel(): number {
    return Math.max(this.config.minReleaseLevel, this.noiseFloor * this.config.releaseOverNoise);
  }

  /** Feed one level sample (0–1 RMS) taken at `now` ms. Returns whether to transmit. */
  update(level: number, now: number): boolean {
    const value = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    const elapsedMs = this.lastSampleAt === null ? 0 : Math.max(0, Math.min(1000, now - this.lastSampleAt));
    this.lastSampleAt = now;
    this.startedAt ??= now;

    if (now - this.startedAt < WARMUP_MS) {
      this.learnFloor(value, elapsedMs, WARMUP_PER_SECOND, WARMUP_PER_SECOND);
      return false;
    }

    if (this.speaking) {
      this.learnFloor(value, elapsedMs, FLOOR_FALL_PER_SECOND, FLOOR_RISE_WHILE_SPEAKING_PER_SECOND);
      if (value > this.releaseLevel()) {
        this.quietSince = null;
      } else {
        this.quietSince ??= now;
        if (now - this.quietSince >= this.config.hangtimeMs) {
          this.speaking = false;
          this.quietSince = null;
          this.aboveSince = null;
        }
      }
      return this.speaking;
    }

    this.learnFloor(value, elapsedMs, FLOOR_FALL_PER_SECOND, FLOOR_RISE_PER_SECOND);

    if (value >= this.attackLevel()) {
      this.aboveSince ??= now;
      if (now - this.aboveSince >= this.config.attackHoldMs) {
        this.speaking = true;
        this.aboveSince = null;
        this.quietSince = null;
      }
    } else {
      this.aboveSince = null;
    }
    return this.speaking;
  }

  private learnFloor(value: number, elapsedMs: number, fallPerSecond: number, risePerSecond: number): void {
    if (elapsedMs <= 0) return;
    const perSecond = value < this.noiseFloor ? fallPerSecond : risePerSecond;
    const step = 1 - Math.exp(-perSecond * (elapsedMs / 1000));
    this.noiseFloor = Math.min(this.config.maxNoiseFloor, this.noiseFloor + (value - this.noiseFloor) * step);
  }

  /** Close immediately (manual mute, mic lost) without forgetting the noise floor. */
  reset(): void {
    this.speaking = false;
    this.aboveSince = null;
    this.quietSince = null;
  }
}

/**
 * Playback gain for other riders' voices. Wind and helmet speakers bury
 * normal-level speech, so voices play about twice as loud (+6 dB). Native
 * WebRTC accepts gains up to 10; the PWA routes voice through Web Audio
 * so a gain above 1 is possible there too.
 */
export const VOICE_PLAYBACK_BOOST = 2;
