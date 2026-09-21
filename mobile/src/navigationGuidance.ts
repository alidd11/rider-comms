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

export function formatNavigationSpeed(speedMps: number | null | undefined, unit: NavigationUnit): string {
  if (!Number.isFinite(speedMps) || Number(speedMps) < 0) return '—';
  const converted = unit === 'km' ? Number(speedMps) * 3.6 : Number(speedMps) * 2.2369362921;
  return String(Math.round(converted));
}

export function navigationSpeedUnit(unit: NavigationUnit): 'mph' | 'km/h' {
  return unit === 'km' ? 'km/h' : 'mph';
}


export interface NavigationGlanceInstruction {
  action: string;
  road: string;
  routeCode: string | null;
}

const GLANCE_ACTIONS: Record<string, string> = {
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
  arrive: 'Arrive',
};

function roundaboutAction(instruction: string): string {
  const exit = instruction.match(/\b(?:take\s+the\s+)?(\d+(?:st|nd|rd|th)\s+exit)\b/i)?.[1];
  return exit ? `Take the ${exit.toLowerCase()}` : 'At roundabout';
}

function roadFromInstruction(instruction: string): string {
  const match = instruction.match(/\b(?:onto|towards?|to stay on|to continue on)\s+(.+)$/i);
  if (!match?.[1]) return '';
  return match[1]
    .replace(/\s+(?:towards?)\s+.+$/i, '')
    .replace(/[.,;]+$/g, '')
    .trim();
}

export function navigationGlanceInstruction(
  instruction: string,
  maneuver?: string,
  destinationLabel = 'destination'
): NavigationGlanceInstruction {
  const cleaned = instruction.replace(/\s+/g, ' ').trim();
  const maneuverKey = maneuver || 'straight';
  const action = maneuverKey.startsWith('roundabout')
    ? roundaboutAction(cleaned)
    : GLANCE_ACTIONS[maneuverKey] ?? 'Go straight';

  let road = maneuverKey === 'arrive' ? destinationLabel.trim() : roadFromInstruction(cleaned);
  const routeMatch = road.match(/\b(?:A|M)\d{1,4}\b/i);
  const routeCode = routeMatch?.[0]?.toUpperCase() ?? null;
  if (routeCode) {
    road = road
      .replace(new RegExp(`\\b${routeCode}\\b`, 'i'), '')
      .replace(/^\s*[\/|·-]\s*|\s*[\/|·-]\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return { action, road, routeCode };
}

export function navigationGlanceSummary(
  instruction: string,
  maneuver?: string,
  destinationLabel = 'destination'
): string {
  const glance = navigationGlanceInstruction(instruction, maneuver, destinationLabel);
  return [glance.action, glance.routeCode, glance.road].filter(Boolean).join(' · ');
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
