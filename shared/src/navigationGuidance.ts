export type NavigationUnit = 'mi' | 'km';

export type NavigationManeuverIcon =
  | 'arrow-up'
  | 'arrow-back'
  | 'arrow-forward'
  | 'return-up-back'
  | 'return-up-forward'
  | 'git-merge-outline'
  | 'sync'
  | 'boat-outline'
  | 'navigate';

export interface NavigationLane {
  directions: readonly string[];
  recommended: boolean;
}

/**
 * Provider-neutral maneuver data consumed by Rider Comms clients.
 *
 * Optional road, exit, lane and arrival fields must only be populated from
 * authoritative structured provider data. Clients must never infer them from
 * free-form instruction text.
 */
export interface NavigationInstruction {
  instruction: string;
  maneuver?: string;
  distanceMeters: number;
  durationSeconds: number;
  roadName?: string;
  routeNumber?: string;
  exitNumber?: string;
  lanes?: readonly NavigationLane[];
  arrivalSide?: 'left' | 'right';
}

/**
 * Prepare provider-authored instruction text for display or speech without
 * trying to reinterpret, shorten, or reconstruct its navigation meaning.
 */
export function normalizeNavigationInstructionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The road a step leads onto, quoted from the provider's own instruction
 * ("Turn right onto Camden Rd/A503" -> "Camden Rd / A503"), for the banner's
 * large line as in Google and Apple Maps. Nothing is reconstructed: the text
 * after "onto" or "on" in the first sentence is used as written, and null
 * comes back when the instruction names no road, so the banner falls back to
 * the full instruction.
 */
export function navigationInstructionRoad(instruction: string): string | null {
  const firstSentence = normalizeNavigationInstructionText(instruction).split(/(?<=[a-z0-9)])\.\s+/i)[0] ?? '';
  // "onto" and "on" name the road; failing those, "towards" names where the
  // turn heads ("Turn left towards Leisure Wy"), which is what Google and
  // Apple Maps show large too.
  const match = firstSentence.match(/\bonto\s+(.+)$/i)
    ?? firstSentence.match(/\bon\s+(.+)$/i)
    ?? firstSentence.match(/\btowards?\s+(.+)$/i);
  if (!match) return null;
  const road = match[1]!.replace(/\s+towards?\b.*$/i, '').replace(/\.$/, '').replace(/\s*\/\s*/g, ' / ').trim();
  if (!road || /^the (left|right)\b/i.test(road)) return null;
  return road;
}

export function formatNavigationDistance(metres: number, unit: NavigationUnit): string {
  if (unit === 'km') {
    // Round first, then pick the unit, so 997 m reads "1.0 km", not "1000 m".
    const roundedMetres = Math.max(10, Math.round(metres / 10) * 10);
    if (roundedMetres < 1000) return `${roundedMetres} m`;
    const kilometres = metres / 1000;
    return `${kilometres.toFixed(kilometres < 9.95 ? 1 : 0)} km`;
  }

  const miles = metres / 1609.344;
  if (miles < 0.1) {
    const feet = metres * 3.28084;
    return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  }
  return `${miles.toFixed(miles < 9.95 ? 1 : 0)} mi`;
}

export function formatNavigationSpeed(speedMps: number | null | undefined, unit: NavigationUnit): string {
  if (!Number.isFinite(speedMps) || Number(speedMps) < 0) return '—';
  const converted = unit === 'km' ? Number(speedMps) * 3.6 : Number(speedMps) * 2.2369362921;
  return String(Math.round(converted));
}

export function navigationSpeedUnit(unit: NavigationUnit): 'mph' | 'km/h' {
  return unit === 'km' ? 'km/h' : 'mph';
}

export function formatNavigationDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

const GLANCE_ACTIONS: Readonly<Record<string, string>> = {
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
};

// Only structured maneuver metadata is simplified. Provider instruction text
// is never rewritten; navigationInstructionRoad only quotes the road it names.
export function navigationManeuverAction(maneuver?: string): string {
  if (!maneuver) return 'Continue';
  const maneuverKey = maneuver;
  return maneuverKey.startsWith('roundabout')
    ? 'At roundabout'
    : GLANCE_ACTIONS[maneuverKey] ?? 'Continue';
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
  const cleaned = normalizeNavigationInstructionText(instruction);
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
    case 'ferry':
    case 'ferry-train':
      return 'boat-outline';
    case 'straight':
      return 'arrow-up';
    default:
      return 'navigate';
  }
}
