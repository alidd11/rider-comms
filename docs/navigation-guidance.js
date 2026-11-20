(function (root) {
  'use strict';

  // Browser port of shared/src/navigationGuidance.ts. The PWA intentionally
  // ships as plain static files, so scripts/check-navigation-guidance.mjs runs
  // shared golden fixtures against both implementations to prevent drift.
  function formatNavigationDistance(metres, unit) {
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

  function navigationPromptStageForDistance(metres, speedMps = null) {
    const speed = typeof speedMps === 'number' && Number.isFinite(speedMps) && speedMps > 0 ? speedMps : 0;
    const ahead = (seconds, floor, ceiling) => Math.min(ceiling, Math.max(floor, speed * seconds));
    if (!Number.isFinite(metres) || metres > ahead(50, 500, 3200)) return 0;
    if (metres > ahead(15, 150, 800)) return 1;
    if (metres > ahead(3, 40, 120)) return 2;
    return 3;
  }

  /** A point on a route, as both apps hold them. */

  /** How twisty a route is: degrees of turning per kilometre, measured over
   * stretches of at least 30 m so GPS-scale wiggles in the line don't count.
   * A straight motorway scores near 0; a mountain pass well over 200. */
  function routeTwistiness(points) {
    const toRad = Math.PI / 180;
    const metres = (a, b) => {
      const dLat = (b.lat - a.lat) * toRad;
      const dLon = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
      return Math.sqrt(dLat * dLat + dLon * dLon) * 6_371_000;
    };
    const bearing = (a, b) => Math.atan2(
      (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * toRad),
      b.lat - a.lat,
    ) / toRad;
    let length = 0;
    let turning = 0;
    let anchor = points[0];
    let previousBearing = null;
    for (let i = 1; anchor && i < points.length; i += 1) {
      const point = points[i];
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


  /**
   * Labels the ways Google offers: the quickest is "Fastest"; another that
   * turns at least a third more per kilometre (and isn't a straight road
   * with one bend) is "Twisty", the one riders often want; the rest are
   * "Alternative". Each says its time and how much longer it is.
   */
  function routeChoices(
    routes,
  ) {
    if (routes.length === 0) return [];
    let fastest = 0;
    routes.forEach((route, index) => { if (route.durationSeconds < routes[fastest].durationSeconds) fastest = index; });
    const twist = routes.map((route) => routeTwistiness(route.coordinates));
    let twisty = -1;
    routes.forEach((_route, index) => {
      if (index === fastest || twist[index] < 40 || twist[index] < twist[fastest] * 1.33) return;
      if (twisty === -1 || twist[index] > twist[twisty]) twisty = index;
    });
    return routes.map((route, index) => {
      const label = index === fastest ? 'Fastest' : index === twisty ? 'Twisty' : 'Alternative';
      const extra = route.durationSeconds - routes[fastest].durationSeconds;
      const time = formatNavigationDuration(route.durationSeconds);
      const more = index !== fastest && extra >= 60 ? `+${formatNavigationDuration(extra)}` : '';
      const parts = [label, time, ...(more ? [more] : [])];
      // An alternative's tag is just how much longer it takes, when it does.
      const tag = label === 'Alternative' ? (more || label) : [label, ...(more ? [more] : [])].join(' · ');
      return { index, label, text: parts.join(' · '), time, tag };
    });
  }

  /** "+8 min traffic" when today's traffic adds two minutes or more, else ''. */
  function routeTrafficDelayText(durationSeconds, typicalDurationSeconds) {
    if (typeof typicalDurationSeconds !== 'number' || !Number.isFinite(typicalDurationSeconds)) return '';
    const delay = durationSeconds - typicalDurationSeconds;
    return delay >= 120 ? `+${formatNavigationDuration(delay)} traffic` : '';
  }

  /** How often a route in progress is checked against live traffic. */
  const FASTER_ROUTE_CHECK_MS = 5 * 60_000;

  /**
   * Seconds a freshly asked-for route saves over the rest of the current one,
   * when that's worth switching for: at least 3 minutes, and at least 10% of
   * what's left, so a long trip doesn't hop roads to save a minute. 0 means
   * stay on the current route.
   */
  function fasterRouteSavingSeconds(remainingSeconds, newRouteSeconds) {
    if (!Number.isFinite(remainingSeconds) || !Number.isFinite(newRouteSeconds) || newRouteSeconds <= 0) return 0;
    const saving = remainingSeconds - newRouteSeconds;
    return saving >= Math.max(180, remainingSeconds * 0.1) ? saving : 0;
  }

  /** What the rider hears: "Faster route found. Saves 6 min." */
  function fasterRouteAnnouncement(savingSeconds) {
    return `Faster route found. Saves ${formatNavigationDuration(savingSeconds)}.`;
  }

  /** The rest of a route from the point nearest the rider, thinned to at most
   * `maxPoints`, for searching along the way. */
  function routeAheadPath(points, here, maxPoints = 200) {
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
    return Array.from({ length: maxPoints }, (_, i) => ahead[Math.round(i * step)]);
  }


  /**
   * Orders places found along the route by how much each adds to the trip
   * (the time via the place, less the time left), and says so: "+3 min", or
   * "On the way" under a minute. Places Google gave no time for go last.
   */
  function stopsOnTheWay(places, remainingSeconds) {
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

  /** Port of navigationEtaShareText: the message "Share ETA" sends. */
  function navigationEtaShareText(destination, arrivalLabel, remainingMeters, unit) {
    const place = String(destination || '').trim() || 'my destination';
    return `On my way to ${place}. Arriving about ${arrivalLabel}, ${formatNavigationDistance(remainingMeters, unit)} to go. Sent from Rider Comms.`;
  }

  const NAVIGATION_CONTINUE_PROMPT_METERS = 2000;

  function navigationStepStartPrompt(instruction, stepMeters, unit, alreadySpokenAtTurn) {
    const parts = [];
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

  function normalizeNavigationInstructionText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  // The road a step leads onto, quoted from the provider's instruction
  // (shared/src/navigationGuidance.ts navigationInstructionRoad).
  function navigationInstructionRoad(instruction) {
    const firstSentence = normalizeNavigationInstructionText(instruction).split(/(?<=[a-z0-9)])\.\s+/i)[0] || '';
    const match = firstSentence.match(/\bonto\s+(.+)$/i)
      || firstSentence.match(/\bon\s+(.+)$/i)
      || firstSentence.match(/\btowards?\s+(.+)$/i);
    if (!match) return null;
    const road = match[1].replace(/\s+towards?\b.*$/i, '').replace(/\.$/, '').replace(/\s*\/\s*/g, ' / ').trim();
    if (!road || /^the (left|right)\b/i.test(road)) return null;
    return road;
  }

  function navigationPromptText(instruction, metres, unit, stage) {
    const cleaned = normalizeNavigationInstructionText(instruction);
    if (!cleaned || stage === 0) return '';
    if (stage === 3) return cleaned;
    return `In ${formatNavigationDistance(metres, unit)}, ${cleaned.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase())}`;
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

  function routeStyleAvoidsMotorways(style, avoidMotorwaysSetting) {
    return style === 'fastest' ? avoidMotorwaysSetting : true;
  }

  function routeIndexForStyle(routes, style) {
    let best = 0;
    if (style === 'twisty') {
      const twist = routes.map((route) => routeTwistiness(route.coordinates));
      twist.forEach((value, index) => { if (value > twist[best]) best = index; });
      return best;
    }
    routes.forEach((route, index) => { if (route.durationSeconds < routes[best].durationSeconds) best = index; });
    return best;
  }

  function routeTrafficNote(durationSeconds, typicalDurationSeconds, fastest) {
    if (typeof typicalDurationSeconds !== 'number' || !Number.isFinite(typicalDurationSeconds)) return fastest ? 'Fastest route' : '';
    const delay = durationSeconds - typicalDurationSeconds;
    if (delay >= 120) return `${fastest ? 'Fastest despite ' : ''}+${formatNavigationDuration(delay)} of traffic`;
    return fastest ? 'Fastest route, usual traffic' : 'Usual traffic';
  }

  function routeShareText(destination, arrivalLabel, meters, unit, via) {
    const place = destination.trim() || 'my destination';
    const road = via.trim() ? ` via ${via.trim()}` : '';
    return `Heading to ${place}${road}: ${formatNavigationDistance(meters, unit)}, arriving about ${arrivalLabel}. Sent from Rider Comms.`;
  }

  root.RiderNavigationGuidance = Object.freeze({
    formatNavigationDistance,
    formatNavigationDuration,
    formatNavigationSpeed,
    maneuverIcon,
    navigationInstructionRoad,
    navigationManeuverAction,
    normalizeNavigationInstructionText,
    navigationPromptStageForDistance,
    navigationPromptText,
    navigationStepStartPrompt,
    routeTwistiness,
    routeChoices,
    routeTrafficDelayText,
    routeStyleAvoidsMotorways,
    routeIndexForStyle,
    routeTrafficNote,
    routeShareText,
    FASTER_ROUTE_CHECK_MS,
    fasterRouteSavingSeconds,
    fasterRouteAnnouncement,
    routeAheadPath,
    stopsOnTheWay,
    navigationEtaShareText,
    navigationSpeedUnit,
  });
})(typeof window === 'undefined' ? globalThis : window);
