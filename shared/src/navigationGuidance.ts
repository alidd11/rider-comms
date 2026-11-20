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

/**
 * Which spoken prompt is due this far before a turn. The warnings come by
 * time, not just distance, as in Google Maps and Waze: at least 500 m, 150 m
 * and 40 m ahead, but 50, 15 and 3 seconds ahead at speed, so a motorway
 * exit at 70 mph is announced about a mile out (never more than 2 miles),
 * not 16 seconds before it. Unknown speed keeps the distance-only thresholds.
 */
export function navigationPromptStageForDistance(metres: number, speedMps: number | null = null): NavigationPromptStage {
  const speed = typeof speedMps === 'number' && Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
  const ahead = (seconds: number, floor: number, ceiling: number) => Math.min(ceiling, Math.max(floor, speed * seconds));
  if (!Number.isFinite(metres) || metres > ahead(50, 500, 3200)) return 0;
  if (metres > ahead(15, 150, 800)) return 1;
  if (metres > ahead(3, 40, 120)) return 2;
  return 3;
}

/** A step this long gets "Continue for …" when it begins (Google Maps and
 * Waze do the same on long roads), so the rider knows nothing is coming. */
export const NAVIGATION_CONTINUE_PROMPT_METERS = 2000;

/**
 * What's said as a new step begins: its instruction (unless it was already
 * said at the turn), then, on a long road, how far until the next one:
 * "Turn left onto A3. Continue for 12 mi."
 */
export function navigationStepStartPrompt(
  instruction: string,
  stepMeters: number,
  unit: NavigationUnit,
  alreadySpokenAtTurn: boolean,
): string {
  const parts: string[] = [];
  const cleaned = normalizeNavigationInstructionText(instruction);
  if (cleaned && !alreadySpokenAtTurn) parts.push(cleaned.replace(/[.!]$/, ''));
  if (Number.isFinite(stepMeters) && stepMeters >= NAVIGATION_CONTINUE_PROMPT_METERS) {
    parts.push(`Continue for ${formatNavigationDistance(stepMeters, unit)}`);
  }
  // A lone instruction is said as it comes; with "Continue for …" each
  // part is its own sentence.
  if (parts.length === 0) return '';
  if (cleaned && !alreadySpokenAtTurn && parts.length === 1) return cleaned;
  return `${parts.join('. ')}.`;
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
  // "In 500 ft, turn left", not "In 500 ft, Turn left".
  return `In ${formatNavigationDistance(metres, unit)}, ${cleaned.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase())}`;
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

/** A point on a route, as both apps hold them. */
export interface RouteChoicePoint { lat: number; lon: number }

/** How twisty a route is: degrees of turning per kilometre, measured over
 * stretches of at least 30 m so GPS-scale wiggles in the line don't count.
 * A straight motorway scores near 0; a mountain pass well over 200. */
export function routeTwistiness(points: readonly RouteChoicePoint[]): number {
  const toRad = Math.PI / 180;
  const metres = (a: RouteChoicePoint, b: RouteChoicePoint) => {
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
    return Math.sqrt(dLat * dLat + dLon * dLon) * 6_371_000;
  };
  const bearing = (a: RouteChoicePoint, b: RouteChoicePoint) => Math.atan2(
    (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * toRad),
    b.lat - a.lat,
  ) / toRad;
  let length = 0;
  let turning = 0;
  let anchor = points[0];
  let previousBearing: number | null = null;
  for (let i = 1; anchor && i < points.length; i += 1) {
    const point = points[i]!;
    const stretch = metres(anchor, point);
    if (stretch < 30) continue;
    const heading = bearing(anchor, point);
    if (previousBearing !== null) {
      const change = Math.abs(((heading - previousBearing + 540) % 360) - 180);
      turning += change;
    }
    previousBearing = heading;
    length += stretch;
    anchor = point;
  }
  return length >= 200 ? turning / (length / 1000) : 0;
}

/** One of the ways to a destination, as the rider sees it before choosing. */
export interface RouteChoice {
  index: number;
  label: 'Fastest' | 'Twisty' | 'Alternative';
  /** "Twisty · 29 min · +6 min": the spoken label. */
  text: string;
  /** "29 min": the big line on the route button. */
  time: string;
  /** "Twisty · +6 min", "+2 min", "Fastest": the small line under it. */
  tag: string;
}

/**
 * Labels the ways Google offers: the quickest is "Fastest"; another that
 * turns at least a third more per kilometre (and isn't a straight road
 * with one bend) is "Twisty", the one riders often want; the rest are
 * "Alternative". Each says its time and how much longer it is.
 */
export function routeChoices(
  routes: ReadonlyArray<{ durationSeconds: number; coordinates: readonly RouteChoicePoint[] }>,
): RouteChoice[] {
  if (routes.length === 0) return [];
  let fastest = 0;
  routes.forEach((route, index) => { if (route.durationSeconds < routes[fastest]!.durationSeconds) fastest = index; });
  const twist = routes.map((route) => routeTwistiness(route.coordinates));
  let twisty = -1;
  routes.forEach((_route, index) => {
    if (index === fastest || twist[index]! < 40 || twist[index]! < twist[fastest]! * 1.33) return;
    if (twisty === -1 || twist[index]! > twist[twisty]!) twisty = index;
  });
  return routes.map((route, index) => {
    const label = index === fastest ? 'Fastest' : index === twisty ? 'Twisty' : 'Alternative';
    const extra = route.durationSeconds - routes[fastest]!.durationSeconds;
    const time = formatNavigationDuration(route.durationSeconds);
    const more = index !== fastest && extra >= 60 ? `+${formatNavigationDuration(extra)}` : '';
    const parts = [label, time, ...(more ? [more] : [])];
    // An alternative's tag is just how much longer it takes, when it does.
    const tag = label === 'Alternative' ? (more || label) : [label, ...(more ? [more] : [])].join(' · ');
    return { index, label, text: parts.join(' · '), time, tag };
  });
}

/** How the rider wants to get there, chosen in the route preview (as in
 * Calimoto and Scenic): the quickest way, the bendiest, or off motorways. */
export type RouteStyle = 'fastest' | 'twisty' | 'no_motorways';

/** Whether to ask Google to keep off motorways for a riding style. Twisty and
 * No motorways both do (that's where the bendy roads are); Fastest follows
 * the rider's own setting. */
export function routeStyleAvoidsMotorways(style: RouteStyle, avoidMotorwaysSetting: boolean): boolean {
  return style === 'fastest' ? avoidMotorwaysSetting : true;
}

/** Which of the ways to show first for a riding style: the bendiest for
 * Twisty, otherwise the quickest. */
export function routeIndexForStyle(
  routes: ReadonlyArray<{ durationSeconds: number; coordinates: readonly RouteChoicePoint[] }>,
  style: RouteStyle,
): number {
  let best = 0;
  if (style === 'twisty') {
    const twist = routes.map((route) => routeTwistiness(route.coordinates));
    twist.forEach((value, index) => { if (value > twist[best]!) best = index; });
    return best;
  }
  routes.forEach((route, index) => { if (route.durationSeconds < routes[best]!.durationSeconds) best = index; });
  return best;
}

/** The line under the chosen route's time: "Fastest despite +8 min of
 * traffic", "Usual traffic", or '' when Google gave no traffic figure. */
export function routeTrafficNote(durationSeconds: number, typicalDurationSeconds: number | null | undefined, fastest: boolean): string {
  if (typeof typicalDurationSeconds !== 'number' || !Number.isFinite(typicalDurationSeconds)) return fastest ? 'Fastest route' : '';
  const delay = durationSeconds - typicalDurationSeconds;
  if (delay >= 120) return `${fastest ? 'Fastest despite ' : ''}+${formatNavigationDuration(delay)} of traffic`;
  return fastest ? 'Fastest route, usual traffic' : 'Usual traffic';
}

/** What Share sends from the route preview, before setting off. */
export function routeShareText(destination: string, arrivalLabel: string, meters: number, unit: 'mi' | 'km', via: string): string {
  const place = destination.trim() || 'my destination';
  const road = via.trim() ? ` via ${via.trim()}` : '';
  return `Heading to ${place}${road}: ${formatNavigationDistance(meters, unit)}, arriving about ${arrivalLabel}. Sent from Rider Comms.`;
}

/** "+8 min traffic" when today's traffic adds two minutes or more, else ''. */
export function routeTrafficDelayText(durationSeconds: number, typicalDurationSeconds: number | null | undefined): string {
  if (typeof typicalDurationSeconds !== 'number' || !Number.isFinite(typicalDurationSeconds)) return '';
  const delay = durationSeconds - typicalDurationSeconds;
  return delay >= 120 ? `+${formatNavigationDuration(delay)} traffic` : '';
}

/** How often a route in progress is checked against live traffic. */
export const FASTER_ROUTE_CHECK_MS = 5 * 60_000;

/**
 * Seconds a freshly asked-for route saves over the rest of the current one,
 * when that's worth switching for: at least 3 minutes, and at least 10% of
 * what's left, so a long trip doesn't hop roads to save a minute. 0 means
 * stay on the current route.
 */
export function fasterRouteSavingSeconds(remainingSeconds: number, newRouteSeconds: number): number {
  if (!Number.isFinite(remainingSeconds) || !Number.isFinite(newRouteSeconds) || newRouteSeconds <= 0) return 0;
  const saving = remainingSeconds - newRouteSeconds;
  return saving >= Math.max(180, remainingSeconds * 0.1) ? saving : 0;
}

/** What the rider hears: "Faster route found. Saves 6 min." */
export function fasterRouteAnnouncement(savingSeconds: number): string {
  return `Faster route found. Saves ${formatNavigationDuration(savingSeconds)}.`;
}

/** The rest of a route from the point nearest the rider, thinned to at most
 * `maxPoints`, for searching along the way. */
export function routeAheadPath(
  points: readonly RouteChoicePoint[],
  here: RouteChoicePoint,
  maxPoints = 200,
): RouteChoicePoint[] {
  if (points.length < 2) return [];
  let nearest = 0;
  let best = Infinity;
  points.forEach((point, index) => {
    const dLat = point.lat - here.lat;
    const dLon = (point.lon - here.lon) * Math.cos(here.lat * Math.PI / 180);
    const distance = dLat * dLat + dLon * dLon;
    if (distance < best) { best = distance; nearest = index; }
  });
  const ahead = [{ lat: here.lat, lon: here.lon }, ...points.slice(nearest + 1)];
  if (ahead.length < 2) return [];
  if (ahead.length <= maxPoints) return ahead;
  const step = (ahead.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => ahead[Math.round(i * step)]!);
}

/** A place on the way, as the rider sees it in the list. */
export interface StopOnTheWay<T> { place: T; text: string; detourSeconds: number | null }

/**
 * Orders places found along the route by how much each adds to the trip
 * (the time via the place, less the time left), and says so: "+3 min", or
 * "On the way" under a minute. Places Google gave no time for go last.
 */
export function stopsOnTheWay<T extends { travelSeconds?: number }>(
  places: readonly T[],
  remainingSeconds: number | null,
): StopOnTheWay<T>[] {
  return places
    .map((place) => {
      const detour = typeof place.travelSeconds === 'number' && typeof remainingSeconds === 'number' && Number.isFinite(remainingSeconds)
        ? Math.max(0, place.travelSeconds - remainingSeconds)
        : null;
      const text = detour === null ? '' : detour < 60 ? 'On the way' : `+${formatNavigationDuration(detour)}`;
      return { place, text, detourSeconds: detour };
    })
    .sort((a, b) => (a.detourSeconds ?? Infinity) - (b.detourSeconds ?? Infinity));
}

/**
 * The message "Share ETA" sends while navigating: where you're going, when
 * you'll arrive and how far is left. Arrival is the formatted clock time.
 */
export function navigationEtaShareText(
  destination: string,
  arrivalLabel: string,
  remainingMeters: number,
  unit: 'mi' | 'km',
): string {
  const place = destination.trim() || 'my destination';
  return `On my way to ${place}. Arriving about ${arrivalLabel}, ${formatNavigationDistance(remainingMeters, unit)} to go. Sent from Rider Comms.`;
}
