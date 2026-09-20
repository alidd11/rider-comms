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

const [pwaMapSource, nativeMapSource, nativeCameraSource] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationCamera.ts', import.meta.url), 'utf8'),
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
    /arrive: \{ icon: 'i-location'/,
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
    /navigationGuidanceInstruction/,
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
    /animateCamera\([\s\S]*duration: movingSpeed !== null && movingSpeed <= 1\.5 \? 650 : 500/,
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

console.log(`Client parity manifest valid: ${manifest.capabilities.length} capabilities tracked; map basemaps and adaptive dedicated navigation aligned`);
