(function (root) {
  'use strict';

  // Browser port of shared/src/navigationGuidance.ts. The PWA intentionally
  // ships as plain static files, so scripts/check-navigation-guidance.mjs runs
  // shared golden fixtures against both implementations to prevent drift.
  function formatNavigationDistance(metres, unit) {
    if (unit === 'km') {
      if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
      const kilometres = metres / 1000;
      return `${kilometres.toFixed(kilometres < 10 ? 1 : 0)} km`;
    }

    const miles = metres / 1609.344;
    if (miles < 0.1) {
      const feet = metres * 3.28084;
      return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
    }
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }

  function formatNavigationSpeed(speedMps, unit) {
    if (!Number.isFinite(speedMps) || Number(speedMps) < 0) return '—';
    const converted = unit === 'km' ? Number(speedMps) * 3.6 : Number(speedMps) * 2.2369362921;
    return String(Math.round(converted));
  }

  function navigationSpeedUnit(unit) {
    return unit === 'km' ? 'km/h' : 'mph';
  }

  function formatNavigationDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }

  const glanceActions = Object.freeze({
    straight: 'Go straight',
    'turn-left': 'Turn left',
    'turn-right': 'Turn right',
    'turn-slight-left': 'Bear left',
    'turn-slight-right': 'Bear right',
    'turn-sharp-left': 'Sharp left',
    'turn-sharp-right': 'Sharp right',
    'uturn-left': 'Make a U-turn',
    'uturn-right': 'Make a U-turn',
    'fork-left': 'Keep left',
    'fork-right': 'Keep right',
    'ramp-left': 'Take ramp left',
    'ramp-right': 'Take ramp right',
    merge: 'Merge',
    ferry: 'Take the ferry',
    'ferry-train': 'Take the ferry train',
    depart: 'Start route',
    'name-change': 'Continue',
    arrive: 'Arrive',
  });

  function navigationManeuverAction(maneuver) {
    if (!maneuver) return 'Continue';
    const maneuverKey = maneuver;
    return maneuverKey.startsWith('roundabout')
      ? 'At roundabout'
      : glanceActions[maneuverKey] || 'Continue';
  }

  function navigationPromptStageForDistance(metres) {
    if (!Number.isFinite(metres) || metres > 500) return 0;
    if (metres > 150) return 1;
    if (metres > 40) return 2;
    return 3;
  }

  function normalizeNavigationInstructionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function navigationPromptText(instruction, metres, unit, stage) {
    const cleaned = normalizeNavigationInstructionText(instruction);
    if (!cleaned || stage === 0) return '';
    if (stage === 3) return cleaned;
    return `In ${formatNavigationDistance(metres, unit)}, ${cleaned}`;
  }

  function maneuverIcon(maneuver) {
    switch (maneuver) {
      case 'turn-left':
      case 'turn-sharp-left':
      case 'turn-slight-left':
      case 'fork-left':
      case 'ramp-left':
        return 'arrow-back';
      case 'turn-right':
      case 'turn-sharp-right':
      case 'turn-slight-right':
      case 'fork-right':
      case 'ramp-right':
        return 'arrow-forward';
      case 'uturn-left':
        return 'return-up-back';
      case 'uturn-right':
        return 'return-up-forward';
      case 'merge':
        return 'git-merge-outline';
      case 'roundabout-left':
      case 'roundabout-right':
        return 'sync';
      case 'ferry':
      case 'ferry-train':
        return 'boat-outline';
      case 'straight':
        return 'arrow-up';
      default:
        return 'navigate';
    }
  }

  root.RiderNavigationGuidance = Object.freeze({
    formatNavigationDistance,
    formatNavigationDuration,
    formatNavigationSpeed,
    maneuverIcon,
    navigationManeuverAction,
    normalizeNavigationInstructionText,
    navigationPromptStageForDistance,
    navigationPromptText,
    navigationSpeedUnit,
  });
})(typeof window === 'undefined' ? globalThis : window);
