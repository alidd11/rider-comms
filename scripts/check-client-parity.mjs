import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../client-parity.json', import.meta.url), 'utf8');
const manifest = JSON.parse(raw);

if (!manifest?.policy?.rule || !Array.isArray(manifest.capabilities)) {
  throw new Error('client-parity.json is missing its policy or capabilities list');
}

const ids = new Set();
for (const capability of manifest.capabilities) {
  if (!capability || typeof capability.id !== 'string' || capability.id.length === 0) {
    throw new Error('Every parity capability needs a non-empty id');
  }
  if (ids.has(capability.id)) throw new Error(`Duplicate parity capability: ${capability.id}`);
  ids.add(capability.id);

  if (typeof capability.pwa !== 'boolean' || typeof capability.native !== 'boolean') {
    throw new Error(`${capability.id}: pwa/native must be booleans`);
  }
  if (!['parity', 'gap', 'behavior-gap', 'content-gap'].includes(capability.status)) {
    throw new Error(`${capability.id}: unsupported status ${capability.status}`);
  }
  if (capability.status === 'parity' && (!capability.pwa || !capability.native)) {
    throw new Error(`${capability.id}: parity requires both clients`);
  }
  if (capability.status === 'gap' && capability.pwa === capability.native) {
    throw new Error(`${capability.id}: gap must identify exactly one missing client`);
  }
  if ((capability.status === 'behavior-gap' || capability.status === 'content-gap') && (!capability.pwa || !capability.native)) {
    throw new Error(`${capability.id}: behavior/content gaps require both clients to exist`);
  }
}

for (const required of ['auth', 'group-ride', 'ride-safe', 'place-search', 'friends', 'direct-messages', 'social-realtime', 'message-read-state']) {
  if (!ids.has(required)) throw new Error(`Missing required parity capability: ${required}`);
}

const [
  pwaMapSource,
  pwaCssSource,
  pwaIndexSource,
  nativeMapSource,
  nativeCameraSource,
  nativeManeuverSource,
  nativeManeuverGlyphSource,
  nativeGuidanceSource,
] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationCamera.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationManeuver.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/NavigationManeuverGlyph.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationGuidance.ts', import.meta.url), 'utf8'),
]);

if (
  !/mapTypeId:\s*['"]roadmap['"]/.test(pwaMapSource)
  || !/colorScheme:\s*['"]FOLLOW_SYSTEM['"]/.test(pwaMapSource)
  || !/renderingType:\s*google\.maps\.RenderingType\.VECTOR/.test(pwaMapSource)
  || !/tiltInteractionEnabled:\s*true/.test(pwaMapSource)
  || !/headingInteractionEnabled:\s*true/.test(pwaMapSource)
) {
  throw new Error('PWA map must use Google Roadmap with the vector renderer and provider-native tilt/heading');
}
if (/MAP_STYLE_(?:DARK|LIGHT)/.test(pwaMapSource)) {
  throw new Error('PWA map must not replace Google Roadmap with embedded basemap imitation styles');
}
if (!/mapType="standard"/.test(nativeMapSource)) {
  throw new Error('Native map must use the provider-native standard road map surface');
}
if (/HYBRID_MAP_STYLE_(?:DARK|LIGHT)/.test(nativeMapSource)) {
  throw new Error('Native map must not carry embedded Hybrid basemap imitation styles');
}

for (const [label, source, patterns] of [
  ['PWA navigation', pwaMapSource, [
    /navFollowing/,
    /navMuted/,
    /riderAvatarMapIcon\(state\.profile, true, undefined, 54\)/,
    /applyNavigationCamera/,
    /showNavigationOverview/,
    /navMuteBtn/,
    /navOverviewBtn/,
    /navigationStepPath/,
    /navPromptTargetIndex/,
    /navigationPromptStageForDistance/,
    /maybeSpeakUpcomingNavigationPrompt/,
    /navSteps\[navStepIndex \+ 1\]/,
    /navSteps\[navStepIndex \+ 2\]/,
    /arrive: 'i-nav-arrive'/,
    /'turn-slight-left': 'i-nav-slight-left'/,
    /'turn-sharp-right': 'i-nav-sharp-right'/,
    /'fork-right': 'i-nav-fork-right'/,
    /'ramp-left': 'i-nav-ramp-left'/,
    /navCurrentSpeedMps/,
    /formatNavSpeed\(navCurrentSpeedMps\)/,
    /navSpeedUnit\(\)/,
    /distanceToPathMeters/,
    /remainingDistanceOnPathMeters/,
    /lookAheadCoordinateOnPath/,
    /navigationCameraProfile/,
    /currentNavigationViewportBias/,
    /combineNavigationCameraPaths/,
    /stabilizeNavigationHeading/,
    /position\.coords\.speed/,
    /animateNavigationCamera/,
    /requestAnimationFrame/,
    /cancelAnimationFrame/,
    /prefers-reduced-motion: reduce/,
    /transitionDuration = movingSpeed !== null && movingSpeed <= 1\.5 \? 650 : 500/,
    /setNavigationTrafficVisible\(true\)/,
    /if \(!preserveMute\) navMuted = false/,
    /preserveMute: true/,
    /setNavStatusNotice\('Rerouting…'\)/,
    /if \(!navMuted\) speak\('Rerouting\.'\)/,
    /setNavStatusNotice\('Could not reroute\. Continue with caution\.'\)/,
    /routeNotice: 'Route updated\.'/,
    /visibleMapRiders\(\)/,
  ]],
  ['Native navigation', nativeMapSource, [
    /navigationFollowing/,
    /navigationMuted/,
    /size=\{activeRoute \? 54 : 44\}/,
    /focusNavigationCamera/,
    /navigationPromptProgress/,
    /navigationPromptStageForDistance/,
    /upcomingNavigationStep/,
    /followingNavigationStep/,
    /NavigationManeuverGlyph/,
    /navigationGuidanceInstruction/,
    /navigationSpeedMps/,
    /formatNavigationSpeed\(navigationSpeedMps, unitSystem\)/,
    /navigationSpeedUnit\(unitSystem\)/,
    /distanceToPathMeters/,
    /remainingDistanceOnPathMeters/,
    /lookAheadCoordinateOnPath/,
    /navigationCameraProfile/,
    /navigationViewportBias/,
    /combineNavigationCameraPaths/,
    /stabilizeNavigationHeading/,
    /position\.coords\.speed/,
    /pitch: profile\.pitch/,
    /zoom: profile\.zoom/,
    /AccessibilityInfo\.isReduceMotionEnabled\(\)/,
    /reduceMotionChanged/,
    /reduceMotionEnabled[\s\S]*setCamera\(camera\)[\s\S]*animateCamera\(camera/,
    /animateCamera\(camera, \{ duration: movingSpeed !== null && movingSpeed <= 1\.5 \? 650 : 500 \}\)/,
    /if \(!navigationMuted\) speakNavigationPrompt\('Rerouting\.'\)/,
    /setNavigationNotice\('Could not reroute\. Continue with caution\.'\)/,
    /showsTraffic=\{Boolean\(activeRoute\)\}/,
    /fitRoute\(activeRoute\)/,
    /rideLocations[\s\S]*Private ride member · live location/,
    /RideBar controlsVisible=\{!activeRoute\}/,
    /tabBarStyle:\s*activeRoute\s*\?\s*\{\s*display:\s*'none'/,
  ]],
]) {
  for (const pattern of patterns) {
    if (!pattern.test(source)) throw new Error(`${label} is missing required dedicated-navigation behavior: ${pattern}`);
  }
}

const adaptiveCameraPatterns = [
  /speed <= 1\.5[\s\S]*zoom: 18\.8[\s\S]*pitch: 52[\s\S]*lookAheadMeters: 90[\s\S]*centreAheadMeters: 42/,
  /speed < 7[\s\S]*zoom: 18\.7[\s\S]*pitch: 58[\s\S]*lookAheadMeters: 120[\s\S]*centreAheadMeters: 52/,
  /speed < 14[\s\S]*zoom: 18\.4[\s\S]*pitch: 60[\s\S]*lookAheadMeters: 165[\s\S]*centreAheadMeters: 70/,
  /speed < 22[\s\S]*zoom: 18\.0[\s\S]*pitch: 58[\s\S]*lookAheadMeters: 230[\s\S]*centreAheadMeters: 95/,
  /zoom: 17\.6[\s\S]*pitch: 54[\s\S]*lookAheadMeters: 310[\s\S]*centreAheadMeters: 125/,
  /maneuver\.includes\('roundabout'\)[\s\S]*maneuver\.includes\('uturn'\)[\s\S]*maneuver\.includes\('fork'\)/,
  /maneuverDistance <= 260/,
  /maneuverDistance <= 180/,
  /occludedFraction[\s\S]*topDominance/,
  /speed <= 1\.5[\s\S]*return previous/,
];
for (const [label, source] of [['PWA adaptive camera', pwaMapSource], ['Native adaptive camera', nativeCameraSource]]) {
  for (const pattern of adaptiveCameraPatterns) {
    if (!pattern.test(source)) throw new Error(`${label} drifted from the shared adaptive camera contract: ${pattern}`);
  }
}

if (!/id="navInstruction"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(pwaIndexSource)) {
  throw new Error('PWA navigation maneuver instruction must be a polite atomic live region');
}
if (!/style=\{styles\.navigationInstruction\} accessibilityLiveRegion="polite"/.test(nativeMapSource)) {
  throw new Error('Native navigation maneuver instruction must remain a polite live region');
}

for (const [maneuver, icon] of [
  ['turn-slight-left', 'i-nav-slight-left'],
  ['turn-left', 'i-nav-left'],
  ['turn-sharp-left', 'i-nav-sharp-left'],
  ['fork-right', 'i-nav-fork-right'],
  ['ramp-left', 'i-nav-ramp-left'],
  ['roundabout-right', 'i-nav-roundabout-right'],
]) {
  const mapping = new RegExp(`['"]${maneuver}['"]\\s*:\\s*['"]${icon}['"]`);
  if (!mapping.test(pwaMapSource)) {
    throw new Error(`PWA navigation must preserve distinct maneuver geometry for ${maneuver}`);
  }
  if (!pwaIndexSource.includes(`id="${icon}"`)) {
    throw new Error(`PWA navigation is missing the ${icon} maneuver glyph`);
  }
}

for (const token of [
  "'slight-left'",
  "'left'",
  "'sharp-left'",
  "'fork-left'",
  "'ramp-left'",
  "'roundabout-left'",
  "'uturn-left'",
]) {
  if (!nativeManeuverSource.includes(token)) {
    throw new Error(`Native navigation maneuver categories are missing ${token}`);
  }
}
for (const glyph of ['slightLeft', 'left', 'sharpLeft', 'forkLeft', 'rampLeft', 'roundaboutLeft', 'uturnLeft']) {
  if (!nativeManeuverGlyphSource.includes(glyph)) {
    throw new Error(`Native navigation maneuver glyphs are missing ${glyph}`);
  }
}

if (!/\.nav-maneuver-icon\{[^\n]*width:72px;height:80px[^\n]*border-radius:18px/.test(pwaCssSource)) {
  throw new Error('PWA primary maneuver glyph must remain large and glanceable');
}
if (!/navigationManeuver:\s*\{[\s\S]*?width: 72,[\s\S]*?height: 80,[\s\S]*?borderRadius: 18/.test(nativeMapSource)) {
  throw new Error('Native primary maneuver glyph must match the PWA glanceable geometry');
}

if (!/id="navSpeed"/.test(pwaIndexSource) || !/id="navSpeedUnit"/.test(pwaIndexSource)) {
  throw new Error('PWA dedicated navigation must expose live GPS speed and units');
}
if (!/nav-summary-speed/.test(pwaCssSource) || !/grid-template-columns:1\.08fr 1fr 1fr 1fr/.test(pwaCssSource)) {
  throw new Error('PWA navigation summary must keep the four-stat layout with live speed');
}
if (!/formatNavigationSpeed/.test(nativeGuidanceSource) || !/navigationSpeedUnit/.test(nativeGuidanceSource)) {
  throw new Error('Native navigation must share explicit GPS speed formatting and units');
}

if (/translateY\(-32vh\)/.test(pwaCssSource)) {
  throw new Error('PWA map controls must not be scattered with viewport-relative vertical transforms');
}
if (/viewportHeight \* 0\.32/.test(nativeMapSource)) {
  throw new Error('Native map controls must not be scattered with viewport-relative vertical transforms');
}
if (!/\.nav-mode #locateBtn\{display:none\}/.test(pwaCssSource)) {
  throw new Error('PWA navigation must hide the redundant standalone re-centre control');
}
if (!/\.nav-mode \.map-actions\{[^\n]*flex-direction:row;gap:2px;padding:4px;[^\n]*border-radius:18px/.test(pwaCssSource)) {
  throw new Error('PWA navigation actions must remain one compact horizontal dock');
}
if (!/\.nav-mode \.map-actions \.icon-button\{width:48px;min-width:48px;height:48px;[^\n]*border-radius:14px/.test(pwaCssSource)) {
  throw new Error('PWA navigation dock controls must keep 48px rounded-square touch targets');
}
if (!/#app\.nav-mode \.screen-map \.map-actions\{[\s\S]*?bottom:calc\(var\(--nav-summary-height,104px\) \+ var\(--navigation-control-inset\) \+ 18px\)[\s\S]*?flex-direction:row[\s\S]*?gap:2px[\s\S]*?padding:4px/.test(pwaCssSource)) {
  throw new Error('PWA phone navigation dock must stay horizontal and directly above the ETA summary');
}
if (!/body:has\(#destinationCard:not\(\[hidden\]\)\) \.screen-map \.map-actions\{display:none\}/.test(pwaCssSource)) {
  throw new Error('PWA destination selection must hide competing general map controls like native');
}
if (!/#destinationCard \.destination-primary-action\{[^\n]*border-radius:14px/.test(pwaCssSource)) {
  throw new Error('PWA destination primary action must align with native navigation button geometry');
}
if (!/mapActionButton:\s*\{[\s\S]*?width: 48,[\s\S]*?height: 48,[\s\S]*?borderRadius: 14/.test(nativeMapSource)) {
  throw new Error('Native map controls must keep the shared 48px rounded-square geometry');
}
if (!/navigationActions:\s*\{[\s\S]*?flexDirection: 'row',[\s\S]*?gap: 2,[\s\S]*?padding: 4,[\s\S]*?borderRadius: 18/.test(nativeMapSource)) {
  throw new Error('Native navigation actions must match the compact horizontal PWA dock');
}
if (!/navigationActionButton:\s*\{[\s\S]*?width: 48,[\s\S]*?height: 48,[\s\S]*?borderRadius: 14/.test(nativeMapSource)) {
  throw new Error('Native navigation dock controls must keep 48px rounded-square touch targets');
}

if (/bottom: insets\.bottom \+ 116/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must not double-count the bottom safe area above the summary');
}
if (!/navigationSummaryHeight \+ spacing\.md/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must stay directly above the measured navigation summary');
}
if (!/onLayout=\{\(event\) => \{[\s\S]*setNavigationSummaryHeight/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must follow the real ETA summary height including safe-area and text growth');
}

console.log(`Client parity manifest valid: ${manifest.capabilities.length} capabilities tracked; map basemaps, navigation control dock, maneuver glanceability, live speed and adaptive dedicated navigation aligned`);
