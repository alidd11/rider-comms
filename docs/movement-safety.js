(function (root) {
  'use strict';

  const defaults = {
    maxUsableAccuracyMeters: 50,
    movingSpeedMps: 3.57632,
    stationarySpeedMps: 3.35,
    confirmMovingMs: 2000,
    confirmStationaryMs: 6000,
    staleAfterMs: 20000,
  };

  function validFix(fix) {
    return Number.isFinite(fix.lat) && fix.lat >= -90 && fix.lat <= 90
      && Number.isFinite(fix.lon) && fix.lon >= -180 && fix.lon <= 180
      && Number.isFinite(fix.timestampMs) && fix.timestampMs > 0
      && Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters >= 0
      && (fix.speedMps === undefined || (Number.isFinite(fix.speedMps) && fix.speedMps >= 0));
  }

  function distanceMeters(a, b) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLon = radians(b.lon - a.lon);
    const lat1 = radians(a.lat);
    const lat2 = radians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  class MovementStateTracker {
    constructor(config = {}) {
      this.config = { ...defaults, ...config };
      this.reset();
    }

    reset() {
      this.state = 'unknown';
      this.lastGoodFix = null;
      this.movingSinceMs = null;
      this.stationarySinceMs = null;
    }

    addFix(fix) {
      if (!validFix(fix) || (this.lastGoodFix && fix.timestampMs <= this.lastGoodFix.timestampMs)) return this.state;
      if (this.lastGoodFix && fix.timestampMs - this.lastGoodFix.timestampMs > this.config.staleAfterMs) this.reset();
      if (fix.accuracyMeters > this.config.maxUsableAccuracyMeters) return this.state;

      let speed = fix.speedMps;
      if (speed === undefined) {
        if (!this.lastGoodFix) speed = 0;
        else {
          const seconds = (fix.timestampMs - this.lastGoodFix.timestampMs) / 1000;
          const noise = Math.max(fix.accuracyMeters, this.lastGoodFix.accuracyMeters);
          speed = seconds <= 0 ? 0 : Math.max(0, distanceMeters(this.lastGoodFix, fix) - noise) / seconds;
        }
      }
      this.lastGoodFix = fix;
      if (speed >= this.config.movingSpeedMps) {
        this.stationarySinceMs = null;
        if (this.movingSinceMs === null) this.movingSinceMs = fix.timestampMs;
        if (fix.timestampMs - this.movingSinceMs >= this.config.confirmMovingMs) this.state = 'moving';
      } else if (speed <= this.config.stationarySpeedMps) {
        this.movingSinceMs = null;
        if (this.stationarySinceMs === null) this.stationarySinceMs = fix.timestampMs;
        if (fix.timestampMs - this.stationarySinceMs >= this.config.confirmStationaryMs) this.state = 'stationary';
      } else {
        this.movingSinceMs = null;
        this.stationarySinceMs = null;
      }
      return this.state;
    }

    stateAt(nowMs) {
      if (!Number.isFinite(nowMs) || !this.lastGoodFix || nowMs - this.lastGoodFix.timestampMs > this.config.staleAfterMs) this.reset();
      return this.state;
    }

    markUnavailable() {
      this.reset();
      return this.state;
    }
  }

  root.RiderMovementSafety = {
    MovementStateTracker,
    isLockedForSafety: (state) => state === 'moving',
  };
})(typeof window === 'undefined' ? globalThis : window);
