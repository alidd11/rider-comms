(function (root) {
  'use strict';

  // Browser port of shared/src/voiceActivity.ts. The PWA ships as plain
  // static files, so scripts/check-voice-activity.mjs runs the same sample
  // sequences through both implementations to prevent drift.
  const DEFAULT_VOICE_ACTIVITY_CONFIG = Object.freeze({
    minAttackLevel: 0.03,
    minReleaseLevel: 0.018,
    attackOverNoise: 2.2,
    releaseOverNoise: 1.5,
    attackHoldMs: 40,
    hangtimeMs: 900,
    maxNoiseFloor: 0.3,
  });

  const FLOOR_FALL_PER_SECOND = 2.5;
  const FLOOR_RISE_PER_SECOND = 0.35;
  const FLOOR_RISE_WHILE_SPEAKING_PER_SECOND = 0.08;
  const WARMUP_MS = 600;
  const WARMUP_PER_SECOND = 5;

  class VoiceActivityGate {
    constructor(config = {}) {
      this.config = { ...DEFAULT_VOICE_ACTIVITY_CONFIG, ...config };
      this.speaking = false;
      this.noiseFloor = 0;
      this.aboveSince = null;
      this.quietSince = null;
      this.lastSampleAt = null;
      this.startedAt = null;
    }

    get state() {
      return {
        speaking: this.speaking,
        noiseFloor: this.noiseFloor,
        attackLevel: this.attackLevel(),
        releaseLevel: this.releaseLevel(),
      };
    }

    attackLevel() {
      return Math.max(this.config.minAttackLevel, this.noiseFloor * this.config.attackOverNoise);
    }

    releaseLevel() {
      return Math.max(this.config.minReleaseLevel, this.noiseFloor * this.config.releaseOverNoise);
    }

    update(level, now) {
      const value = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
      const elapsedMs = this.lastSampleAt === null ? 0 : Math.max(0, Math.min(1000, now - this.lastSampleAt));
      this.lastSampleAt = now;
      if (this.startedAt === null) this.startedAt = now;

      if (now - this.startedAt < WARMUP_MS) {
        this.learnFloor(value, elapsedMs, WARMUP_PER_SECOND, WARMUP_PER_SECOND);
        return false;
      }

      if (this.speaking) {
        this.learnFloor(value, elapsedMs, FLOOR_FALL_PER_SECOND, FLOOR_RISE_WHILE_SPEAKING_PER_SECOND);
        if (value > this.releaseLevel()) {
          this.quietSince = null;
        } else {
          if (this.quietSince === null) this.quietSince = now;
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
        if (this.aboveSince === null) this.aboveSince = now;
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

    learnFloor(value, elapsedMs, fallPerSecond, risePerSecond) {
      if (elapsedMs <= 0) return;
      const perSecond = value < this.noiseFloor ? fallPerSecond : risePerSecond;
      const step = 1 - Math.exp(-perSecond * (elapsedMs / 1000));
      this.noiseFloor = Math.min(this.config.maxNoiseFloor, this.noiseFloor + (value - this.noiseFloor) * step);
    }

    reset() {
      this.speaking = false;
      this.aboveSince = null;
      this.quietSince = null;
    }
  }

  root.RiderVoiceActivity = Object.freeze({
    DEFAULT_VOICE_ACTIVITY_CONFIG,
    VoiceActivityGate,
    VOICE_PLAYBACK_BOOST: 2,
  });
})(typeof window === 'undefined' ? globalThis : window);
