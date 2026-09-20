export type NavigationUnit = 'mi' | 'km';

export type NavigationManeuverIcon =
  | 'arrow-up'
  | 'arrow-back'
  | 'arrow-forward'
  | 'return-up-back'
  | 'return-up-forward'
  | 'git-merge-outline'
  | 'sync'
  | 'navigate';

export function formatNavigationDistance(metres: number, unit: NavigationUnit): string {
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


export type NavigationPromptStage = 0 | 1 | 2 | 3;

export function navigationPromptStageForDistance(metres: number): NavigationPromptStage {
  if (!Number.isFinite(metres) || metres > 500) return 0;
  if (metres > 150) return 1;
  if (metres > 40) return 2;
  return 3;
}

export function navigationPromptText(
  instruction: string,
  metres: number,
  unit: NavigationUnit,
  stage: NavigationPromptStage
): string {
  const cleaned = instruction.replace(/\s+/g, ' ').trim();
  if (!cleaned || stage === 0) return '';
  if (stage === 3) return cleaned;
  return `In ${formatNavigationDistance(metres, unit)}, ${cleaned}`;
}

export function maneuverIcon(maneuver?: string): NavigationManeuverIcon {
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
    default:
      return 'arrow-up';
  }
}
