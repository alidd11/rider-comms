export type NavigationManeuverKind =
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'uturn-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn-right'
  | 'merge'
  | 'fork-left'
  | 'fork-right'
  | 'ramp-left'
  | 'ramp-right'
  | 'roundabout-left'
  | 'roundabout-right'
  | 'ferry'
  | 'arrive';

export function navigationManeuverKind(maneuver?: string): NavigationManeuverKind {
  switch (maneuver) {
    case 'turn-slight-left': return 'slight-left';
    case 'turn-left': return 'left';
    case 'turn-sharp-left': return 'sharp-left';
    case 'uturn-left': return 'uturn-left';
    case 'turn-slight-right': return 'slight-right';
    case 'turn-right': return 'right';
    case 'turn-sharp-right': return 'sharp-right';
    case 'uturn-right': return 'uturn-right';
    case 'merge': return 'merge';
    case 'fork-left': return 'fork-left';
    case 'fork-right': return 'fork-right';
    case 'ramp-left': return 'ramp-left';
    case 'ramp-right': return 'ramp-right';
    case 'roundabout-left': return 'roundabout-left';
    case 'roundabout-right': return 'roundabout-right';
    case 'ferry':
    case 'ferry-train': return 'ferry';
    case 'arrive': return 'arrive';
    default: return 'straight';
  }
}
