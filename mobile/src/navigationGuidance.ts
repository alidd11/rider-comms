export type NavigationUnit = 'mi' | 'km';

export type NavigationManeuverIcon =
  | 'arrow-up'
  | 'arrow-back'
  | 'arrow-forward'
  | 'return-up-back'
  | 'return-up-forward'
  | 'git-merge-outline'
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
    default:
      return 'arrow-up';
  }
}
