import { readFile } from 'node:fs/promises';
import { readNativeMapScreenSource } from './native-map-screen-source.mjs';

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

for (const required of ['auth', 'settings', 'group-ride', 'ride-safe', 'place-search', 'friends', 'direct-messages', 'social-realtime', 'message-read-state']) {
  if (!ids.has(required)) throw new Error(`Missing required parity capability: ${required}`);
}

const [
  pwaMapSource,
  pwaCssSource,
  pwaIndexSource,
  nativeMapScreenSource,
  nativeMapScreenStylesSource,
  nativeMapMarkersSource,
  nativeHazardReportsSource,
  nativeNavigationSummarySource,
  nativeInAppNavigationSource,
  nativeSettingsSource,
  nativeManeuverSource,
  nativeManeuverGlyphSource,
  nativeGuidanceSource,
  nativeMenuSource,
  nativeRiderPreferencesSource,
  pwaRoutesSource,
  nativeCuratedRoutesSource,
] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readNativeMapScreenSource(),
  readFile(new URL('../mobile/src/screens/MapScreen.styles.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/mapMarkers.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/useHazardReports.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/useNavigationSummary.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/useInAppNavigation.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationManeuver.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/NavigationManeuverGlyph.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationGuidance.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MenuScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/riderPreferences.ts', import.meta.url), 'utf8'),
  readFile(new URL('../docs/routes.js', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/routes/curatedRoutes.ts', import.meta.url), 'utf8'),
]);
// MapScreen.tsx delegates its map-marker rendering (HazardMarker,
// SmoothSelfMarker, SmoothRideMemberMarker) to mapMarkers.tsx, its hazard
// fetch/report/vote logic to useHazardReports.ts, the active-step
// road-ahead/summary derivations to useNavigationSummary.ts, the
// route request/reroute/GPS-watcher/camera logic to
// useInAppNavigation.ts, and its StyleSheet to MapScreen.styles.ts --
// checked together since parity assertions below don't care which file a
// given literal lives in.
const nativeMapSource = nativeMapScreenSource + nativeMapScreenStylesSource + nativeMapMarkersSource + nativeHazardReportsSource + nativeNavigationSummarySource + nativeInAppNavigationSource;


// Settings works the same on both clients: the root lists categories (same
// rows, order and icon tints), each opening a page with the same rows in
// the same order. The PWA builds the root in renderSettingsList() and the
// pages in openSheet()'s templates; native in SettingsScreen() and the
// *Page components.
const pwaSettingsList = pwaMapSource.slice(pwaMapSource.indexOf('const SETTINGS_CATEGORIES'));
const nativeSettingsRoot = nativeSettingsSource.slice(nativeSettingsSource.indexOf('export function SettingsScreen()'));
function assertSameOrder(labels, pwaSource, nativeSource, where) {
  let pwaCursor = -1;
  let nativeCursor = -1;
  for (const label of labels) {
    const pwaAt = pwaSource.indexOf(`'${label}'`, pwaCursor + 1);
    const nativeAt = nativeSource.indexOf(`title="${label}"`, nativeCursor + 1);
    if (pwaAt <= pwaCursor) throw new Error(`PWA ${where} is missing or misorders: ${label}`);
    if (nativeAt <= nativeCursor) throw new Error(`Native ${where} is missing or misorders: ${label}`);
    pwaCursor = pwaAt;
    nativeCursor = nativeAt;
  }
}
assertSameOrder(
  ['General', 'Map & navigation', 'Voice and sound', 'Notifications', 'Riding', 'Ride Safe', 'Vehicle details', 'Account', 'Account and login', 'Privacy', 'Your plan', 'Help & Support'],
  pwaSettingsList,
  nativeSettingsRoot,
  'Settings root',
);
for (const tint of ['#1FB6D9', '#2FB35F', '#3478F6', '#EF4444', '#F2802A', '#8E5CF6', '#2A8196', '#1E95E8', '#E0A100', '#5E6AD2']) {
  if (!pwaSettingsList.toUpperCase().includes(tint) || !nativeSettingsRoot.toUpperCase().includes(tint)) {
    throw new Error(`Settings category tint drifted: ${tint}`);
  }
}
assertSameOrder(
  ['Distance units', 'Navigation app', 'Avoid motorways', 'Avoid tolls', 'Avoid ferries', 'Spoken directions', 'Notifications on this device', 'Friend requests', 'Messages', 'Ride Safe auto-lock',
    'Nearby rider visibility', 'Blocked riders', 'Email', 'Signed-in devices', 'Sign out', 'Reset settings', 'Delete account'],
  pwaMapSource.slice(pwaMapSource.indexOf('generalSettings: () =>')),
  nativeSettingsSource.slice(nativeSettingsSource.indexOf('function GeneralPage(')),
  'Settings pages',
);
// Vehicle types: same choices, labels, groups and order on both clients.
{
  const vehiclePattern = /\['(motorcycle_large|motorcycle_small|scooter|car|van)', '([^']+)', '([^']+)'\]/g;
  const pwaVehicles = [...pwaMapSource.matchAll(vehiclePattern)].map((match) => match.slice(1).join(':'));
  const nativeVehicles = [...nativeRiderPreferencesSource.matchAll(vehiclePattern)].map((match) => match.slice(1).join(':'));
  if (pwaVehicles.length !== 5 || pwaVehicles.join('|') !== nativeVehicles.join('|')) {
    throw new Error(`Vehicle type choices drifted: PWA ${pwaVehicles.join(', ')} vs native ${nativeVehicles.join(', ')}`);
  }
}
// Ride Safe's page lists the same locked and still-working items.
{
  const summary = (source) => {
    const start = source.indexOf('= [', source.indexOf('const RIDE_SAFE_SUMMARY'));
    return source.slice(start, source.indexOf('];', start)).replace(/\s+/g, ' ');
  };
  if (!summary(pwaMapSource).includes('Locked while') || summary(pwaMapSource) !== summary(nativeSettingsSource)) {
    throw new Error('Ride Safe summary drifted between the PWA and native Settings');
  }
}
// Route types on Routes: same keys, labels and order, from the same fields.
{
  const pwaCategories = [...(pwaRoutesSource.match(/const categoryLabels = \{([^}]+)\}/)?.[1] ?? '').matchAll(/(\w+): '([^']+)'/g)].map((match) => `${match[1]}:${match[2]}`);
  const nativeCategories = [...nativeCuratedRoutesSource.matchAll(/\{ value: '(\w+)', label: '([^']+)' \}/g)].map((match) => `${match[1]}:${match[2]}`);
  if (pwaCategories.length !== 7 || pwaCategories.join('|') !== nativeCategories.join('|')) {
    throw new Error(`Route types drifted: PWA ${pwaCategories.join(', ')} vs native ${nativeCategories.join(', ')}`);
  }
  const pwaRoadTypes = pwaRoutesSource.match(/const roadTypeLabels = (\{[^}]+\})/)?.[1];
  const nativeRoadTypes = nativeCuratedRoutesSource.match(/ROAD_TYPE_LABELS: Record<RoadType, string> = (\{[^}]+\})/)?.[1]?.replace(/\s+/g, ' ').replace(/, \}/, ' }');
  if (!pwaRoadTypes || pwaRoadTypes !== nativeRoadTypes) {
    throw new Error(`Road type labels drifted: PWA ${pwaRoadTypes} vs native ${nativeRoadTypes}`);
  }
}
if (/id="logoutBtn"/.test(pwaIndexSource) || /title="Sign Out"/.test(nativeSettingsRoot)) {
  throw new Error('Sign out lives in Account and login on both clients, not on the Settings root');
}
// The pages the root and category pages open, with the same tokens.
for (const token of ['general', 'mapNavigation', 'voiceSound', 'rideSafe', 'vehicle', 'notifications', 'account', 'privacy']) {
  if (!pwaMapSource.includes(`${token}: {`) || !pwaSettingsList.includes(`'${token}'`) || !nativeSettingsSource.includes(`page === '${token}'`) || !nativeSettingsSource.includes(`openPage('${token}')`)) {
    throw new Error(`Settings page drifted for ${token}`);
  }
}
for (const token of ['navigationApp', 'blockedRiders', 'email', 'devices']) {
  if (!pwaMapSource.includes(`${token}: {`) || !pwaMapSource.includes(`settingsLink('${token}'`) || !nativeSettingsSource.includes(`page === '${token}'`) || !nativeSettingsSource.includes(`page: '${token}'`)) {
    throw new Error(`Settings page drifted for ${token}`);
  }
}
// About is the last section of Help & Support on both clients.
if (!pwaMapSource.includes("['Legal', 'legalLinks'], ['About', 'aboutCard']") || !nativeSettingsSource.includes('<AboutPage title="About" />')) {
  throw new Error('About must close Help & Support on both clients');
}
// Help & Support's common questions are the same on both clients.
const nativeFaqBlock = nativeSettingsSource.slice(nativeSettingsSource.indexOf('export const HELP_FAQ'), nativeSettingsSource.indexOf('function FaqItem('));
const nativeFaq = [...nativeFaqBlock.matchAll(/\['([^']+)', '([^']+)'\]/g)];
if (nativeFaq.length < 5) throw new Error('Native Help & Support must list its common questions');
for (const [, question, answer] of nativeFaq) {
  if (!pwaMapSource.includes(`['${question}', '${answer}']`)) throw new Error(`Help question drifted between clients: ${question}`);
}
// Pages opened from the avatar menu rather than the Settings root: each
// exists once, on both clients.
for (const token of ['myProfile', 'editProfile', 'help']) {
  if (!pwaMapSource.includes(`${token}: {`) || !nativeSettingsSource.includes(`page === '${token}'`)) {
    throw new Error(`Menu page drifted for ${token}`);
  }
}
if (!pwaMapSource.includes("openSheet('myProfile')") || !nativeMenuSource.includes("page: 'myProfile'")) {
  throw new Error('View profile must open the profile page on both clients, not Account settings');
}
// The Settings root links to Your plan and Help & Support (the same pages
// the menu opens); the profile card stays in the menu only.
if (/settings-profile-row/.test(pwaIndexSource) || /styles\.profileCard/.test(nativeSettingsSource)) {
  throw new Error('Settings root must not repeat the profile card from the menu');
}
if (!pwaSettingsList.includes("['plan', 'card', 'Your plan'") || !nativeSettingsRoot.includes("navigation.push('Billing')")
  || !pwaSettingsList.includes("['help', 'help', 'Help & Support'") || !nativeSettingsRoot.includes("openPage('help')")) {
  throw new Error('Settings root must open Your plan and Help & Support on both clients');
}
if (/<h2 class="group-title">(?:Account|Preferences|Privacy and safety)<\/h2>/.test(pwaIndexSource)) {
  throw new Error('PWA Settings must not expose the legacy section-heavy root');
}
if (!/patchProfile\(\{ unitSystem: next \}\)/.test(pwaMapSource) || !nativeSettingsSource.includes("setUnitSystem(unit)")) {
  throw new Error('Distance units must persist through the rider profile on both clients');
}
// Neither client offers settings for features that don't work yet: there is
// no push delivery and no offline map download (App Review guideline 2.1).
if (/data-settings-target="notifications"|setActiveSheet\('notifications'\)|page: 'notifications'/.test(pwaMapSource + nativeSettingsSource)) {
  throw new Error('Notification settings must stay hidden on both clients until push delivery exists');
}
if (!pwaMapSource.includes('Reset Rider Comms settings to their defaults?') || !nativeSettingsSource.includes('Reset Rider Comms settings?')) {
  throw new Error('Settings reset behavior must exist on both clients');
}
if (/offlineMaps/.test(pwaMapSource + pwaIndexSource + nativeSettingsSource)) {
  throw new Error('Offline Maps must stay hidden on both clients until downloads exist');
}

const HAZARD_EMAIL_VERIFICATION_COPY = 'Verify your email to report road hazards: Settings → Account and login → Email.';
if (!pwaMapSource.includes('email_verification_required: HAZARD_EMAIL_VERIFICATION_MESSAGE')
  || !pwaMapSource.includes(HAZARD_EMAIL_VERIFICATION_COPY)) {
  throw new Error('PWA hazard reporting must explain the verified-email requirement');
}
if (!nativeMapSource.includes("code === 'email_verification_required'")
  || !nativeMapSource.includes(HAZARD_EMAIL_VERIFICATION_COPY)
  || !nativeMapSource.includes("Couldn’t report hazard")
  || !nativeMapSource.includes("Couldn’t update road report")) {
  throw new Error('Native hazard reporting and voting must surface the verified-email requirement');
}
if (!pwaMapSource.includes('captureHazardReportPosition()')
  || !pwaMapSource.includes('pendingHazardReportPosition')
  || !pwaMapSource.includes('entry.marker.setZIndex(entry.id === hazardId ? 12 : 6)')
  || !pwaMapSource.includes('nearbyHazards = [hazard, ...nearbyHazards.filter')
  || !pwaMapSource.includes('selectHazard(hazard.id)')) {
  throw new Error('PWA road reports must snapshot the report position and immediately select the server-created marker above the rider marker');
}
if (!nativeMapSource.includes('pendingHazardReportLocation.current = { lat: location.lat, lon: location.lon }')
  || !nativeMapSource.includes('zIndex={selected ? 12 : 6}')
  || !nativeMapSource.includes('setHazards((current) => [created, ...current.filter')
  || !nativeMapSource.includes('setSelectedHazardId(created.id)')) {
  throw new Error('Native road reports must snapshot the report position and immediately select the server-created marker above the rider marker');
}

if (
  !/mapTypeId:\s*['"]roadmap['"]/.test(pwaMapSource)
  || !/colorScheme:\s*(?:darkOutside \? ['"]DARK['"] : )?['"]FOLLOW_SYSTEM['"]/.test(pwaMapSource)
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
    /navigationPuckIcon\(cone, key\)/,
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
    /navigationViewportOcclusion\(\)/,
    /navigationCamera\.navigationCentreAheadMeters/,
    /navigationCamera\.offsetAlongHeading/,
    /combineNavigationCameraPaths/,
    /stabilizeNavigationHeading/,
    /position\.coords\.speed/,
    /animateNavigationCamera/,
    /requestAnimationFrame/,
    /cancelAnimationFrame/,
    /prefers-reduced-motion: reduce/,
    /transitionDuration = gliding \? glideMs : movingSpeed !== null && movingSpeed <= 1\.5 \? 650 : 500/,
    /navigationPuck\.matchFixToPath\(/,
    /navigationPuck\.predictNavigationPuck\(/,
    /maximumAge: 0,/,
    /setNavigationTrafficVisible\(true\)/,
    /if \(!preserveMute\) navMuted = state\.spokenDirections === false/,
    /preserveMute: true/,
    /setNavStatusNotice\('Rerouting…'\)/,
    /if \(!navMuted\) speak\('Rerouting\.'\)/,
    /setNavStatusNotice\('Couldn’t reroute\. Continue with caution\.'\)/,
    /routeNotice: 'Route updated\.'/,
    /visibleMapRiders\(\)/,
  ]],
  ['Native navigation', nativeMapSource, [
    /navigationFollowing/,
    /navigationMuted/,
    /size=\{PUCK_AVATAR_SIZE\}/,
    /size=\{44\}/,
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
    /navigationCentreAheadMeters/,
    /offsetAlongHeading/,
    /altitude: navigationCameraAltitudeMeters/,
    /combineNavigationCameraPaths/,
    /stabilizeNavigationHeading/,
    /position\.coords\.speed/,
    /pitch: profile\.pitch/,
    /zoom: profile\.zoom/,
    /AccessibilityInfo\.isReduceMotionEnabled\(\)/,
    /reduceMotionChanged/,
    /reduceMotionEnabled[\s\S]*setCamera\(camera\)[\s\S]*animateCamera\(camera/,
    /transitionDuration = gliding \? glideMs : movingSpeed !== null && movingSpeed <= 1\.5 \? 650 : 500[\s\S]*animateCamera\(camera, \{ duration: transitionDuration \}\)/,
    /matchFixToPath\(puckPath,/,
    /setNavigationMuted\(!spokenDirectionsRef\.current\)/,
    /predictNavigationPuck\(puckPath,/,
    /if \(!navigationMutedRef\.current\) speakNavigationPrompt\('Rerouting\.'\)/,
    /setNavigationNotice\('Couldn’t reroute\. Continue with caution\.'\)/,
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

// The adaptive camera's zoom/pitch/heading math itself now lives in
// shared/src/navigationCamera.ts (see docs/navigation-camera.js and
// mobile/src/navigationCamera.ts), with real behavioral parity enforced by
// scripts/check-navigation-camera.mjs against golden fixtures -- a stronger
// guarantee than this file's usual literal-source-text matching, which
// can no longer see that logic here since it isn't duplicated in-line
// in either client anymore.

if (!/id="navInstruction"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(pwaIndexSource)) {
  throw new Error('PWA navigation maneuver instruction must be a polite atomic live region');
}
// NavigationOverlay's banner takes the full instruction as guidanceInstruction.
if (!/style=\{\[?styles\.navigationInstruction\b[\s\S]{0,220}?accessibilityLiveRegion="polite"[\s\S]{0,220}?accessibilityLabel=\{guidanceInstruction\}/.test(nativeMapSource)
  || !/guidanceInstruction=\{navigationGuidanceInstruction\}/.test(nativeMapSource)) {
  throw new Error('Native navigation maneuver instruction must remain a polite live region with the full provider instruction as its accessible label');
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

if (!/\.nav-maneuver-icon\{[^\n]*width:70px;height:78px[^\n]*display:grid;place-items:center/.test(pwaCssSource)) {
  throw new Error('PWA primary maneuver glyph must remain large, flat and glanceable');
}
if (/\.nav-maneuver-icon\{[^\n]*(?:background|border-radius|border:)/.test(pwaCssSource)) {
  throw new Error('PWA primary maneuver glyph must stay integrated into the navigation header rather than boxed as a separate tile');
}
if (!/navigationManeuver:\s*\{[^}]*width: 70,[^}]*height: 78,[^}]*alignItems: 'center'/.test(nativeMapSource)) {
  throw new Error('Native primary maneuver glyph must match the flat PWA guidance geometry');
}
if (/navigationManeuver:\s*\{[^}]*backgroundColor: colors\.surfaceRaised/.test(nativeMapSource)) {
  throw new Error('Native primary maneuver glyph must stay integrated into the navigation header rather than boxed as a separate tile');
}

if (!/id="navSpeedBadge"[^>]*class="nav-speed-badge"/.test(pwaIndexSource)
  || !/id="navSpeed"/.test(pwaIndexSource)
  || !/id="navSpeedUnit"/.test(pwaIndexSource)) {
  throw new Error('PWA dedicated navigation must expose the prominent live-speed badge and units');
}
if (!/\.nav-speed-badge\{[^\n]*top:calc\(var\(--safe-top\) \+ 8px \+ var\(--nav-banner-height,166px\) \+ 10px\)[^\n]*right:max\(14px,var\(--safe-right\)\)[^\n]*width:76px;height:76px[^\n]*border-radius:38px/.test(pwaCssSource)
  || !/grid-template-columns:1\.14fr 1fr 1fr/.test(pwaCssSource)
  || /nav-summary-speed/.test(pwaCssSource)) {
  throw new Error('PWA navigation must keep live speed in the 76px top-right badge and the ETA summary to three trip stats');
}
if (!/syncNavigationOverlayGeometry/.test(pwaMapSource)
  || !/--nav-banner-height/.test(pwaMapSource)
  || !/\$\('#navSpeedBadge'\)\.hidden = false/.test(pwaMapSource)
  || !/\$\('#navSpeedBadge'\)\.hidden = true/.test(pwaMapSource)) {
  throw new Error('PWA speed badge must follow the measured guidance-header height and navigation lifecycle');
}
if (!/formatNavigationSpeed/.test(nativeGuidanceSource) || !/navigationSpeedUnit/.test(nativeGuidanceSource)) {
  throw new Error('Native navigation must share explicit GPS speed formatting and units');
}
if (!/navigationBannerHeight/.test(nativeMapSource)
  || !/setNavigationBannerHeight/.test(nativeMapSource)
  || !/styles\.navigationSpeedBadge/.test(nativeMapSource)
  || !/right: spacing\.md/.test(nativeMapSource)
  || !/width: 76,[\s\S]*height: 76,[\s\S]*borderRadius: 38/.test(nativeMapSource)) {
  throw new Error('Native navigation must position the 76px live-speed badge at the upper right below the measured guidance header');
}

if (
  !/id="navRoadAhead"[^>]*class="nav-road-ahead"/.test(pwaIndexSource)
  || !/navigationRemainingRoutePath/.test(pwaMapSource)
  || !/navigationHazardsAhead\(/.test(pwaMapSource)
  || !/renderNavigationRoadAhead\(\)/.test(pwaMapSource)
  || !/\.nav-road-ahead\{[^\n]*min-height:42px/.test(pwaCssSource)
  || !/hazardNavigationIconMarkup/.test(pwaMapSource)
  || !/visibleHazardsForMap/.test(pwaMapSource)
) {
  throw new Error('PWA navigation must surface the shared route-ahead hazard strip');
}
if (
  !/NavigationRoadAhead/.test(nativeMapSource)
  || !/navigationRoadAlerts/.test(nativeMapSource)
  || !/navigationHazardsAhead\(/.test(nativeMapSource)
  || !/const topOcclusion = insets\.top \+ spacing\.sm \+ navigationBannerHeight/.test(nativeMapSource)
  || !/visibleMapHazards/.test(nativeMapSource)
) {
  throw new Error('Native navigation must surface route-ahead hazards below the measured guidance header');
}

if (!/id="navProviderInstruction"/.test(pwaIndexSource)
  || !/function navGlanceAction\(/.test(pwaMapSource)
  || !/providerInstruction\.textContent = fullInstruction/.test(pwaMapSource)) {
  throw new Error('PWA navigation header must pair a structured maneuver action with untouched provider instruction text');
}
if (!/navigationManeuverAction/.test(nativeGuidanceSource)
  || !/navigationProviderInstruction/.test(nativeMapSource)
  || !/\{navigationGuidanceInstruction\}/.test(nativeMapSource)) {
  throw new Error('Native navigation header must pair a structured maneuver action with untouched provider instruction text');
}
// The banner may show the road a turn leads onto, but only as quoted by the
// shared navigationInstructionRoad (text after "onto"/"on", verbatim, null
// otherwise). Synthesised route badges, exit or junction numbers and
// roundabout actions stay banned in both clients.
if (/function navGlanceInstruction\(|function navGlanceSummary\(/.test(pwaMapSource)
  || /navRouteBadge|navRoadName/.test(pwaIndexSource)
  || /roadFromInstruction|roundaboutAction|navigationGlanceInstruction|navigationGlanceSummary/.test(nativeGuidanceSource)
  || /navigationRouteBadge/.test(nativeMapSource)) {
  throw new Error('Navigation must not reconstruct route, exit or junction metadata from free-form provider instructions');
}
if (!/navigationGuidance\.navigationInstructionRoad\(fullInstruction\)/.test(pwaMapSource)
  || !/navigationInstructionRoad\(upcomingNavigationStep\.instruction\)/.test(nativeNavigationSummarySource)) {
  throw new Error('The banner road must come only from the shared navigationInstructionRoad, in both clients');
}

if (!/function routeFinishIcon\(\)/.test(pwaMapSource)
  || !/title: label \? `Destination: \${label}` : 'Route destination'/.test(pwaMapSource)
  || !/destinationMarker\?\.setMap\(null\);[\s\S]*destinationMarker = undefined;[\s\S]*navSteps = \[\]/.test(pwaMapSource)) {
  throw new Error('PWA navigation must render and clear a dedicated route-finish marker');
}
if (!/navigationDestination \? \([\s\S]*flag-checkered[\s\S]*navigationDestinationMarker/.test(nativeMapSource)) {
  throw new Error('Native navigation must render a dedicated route-finish marker');
}
if (!/mapMarker=\{false\}[\s\S]{0,40}selected status="none"/.test(nativeMapSource)) {
  throw new Error('Native navigation avatar must switch from a map pin to a clean navigation avatar');
}
if (!/function navigationPuckIcon[\s\S]*mapMarker: false[\s\S]*anchor: new google\.maps\.Point\(centre, centre\)/.test(pwaMapSource)) {
  throw new Error('PWA navigation avatar must switch from a map pin to a clean centred navigation avatar');
}
// Both apps point the puck's cone the same way (shared navigationPuckConeDegrees).
if (!/navigationPuck\?\.navigationPuckConeDegrees\(navPuckTravelHeading, mapHeading\)/.test(pwaMapSource)
  || !/navigationPuck\.navigationPuckTravelHeading\(match\.snapped, ahead\.bearingDegrees, coords\.heading, speed\)/.test(pwaMapSource)
  || !/navigationPuckConeDegrees\(\s*navigationPuckTravelHeading\(match\.snapped, ahead\.bearingDegrees, position\.coords\.heading, speed\),\s*mapHeadingRef\.current,?\s*\)/.test(await readFile(new URL('../mobile/src/screens/useInAppNavigation.ts', import.meta.url), 'utf8'))) {
  throw new Error('Both apps must draw the navigation cone from the shared navigationPuckTravelHeading and navigationPuckConeDegrees');
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
if (!/\.nav-mode \.map-actions\{[^\n]*flex-direction:column;align-items:center;gap:8px/.test(pwaCssSource)) {
  throw new Error('PWA navigation actions must stack vertically like the general map controls');
}
if (!/\.nav-mode \.map-actions \.icon-button\{width:54px;min-width:54px;height:54px;border-radius:50%/.test(pwaCssSource)) {
  throw new Error('PWA navigation dock controls must keep the shared 54px circular geometry');
}
if (!/#app\.nav-mode \.screen-map \.map-actions\{[\s\S]*?bottom:calc\(var\(--nav-summary-height,104px\) \+ var\(--navigation-control-inset\) \+ 18px\)[\s\S]*?flex-direction:column[\s\S]*?gap:8px/.test(pwaCssSource)) {
  throw new Error('PWA phone navigation dock must stack vertically and stay directly above the ETA summary');
}
if (!/body:has\(#destinationCard:not\(\[hidden\]\)\) \.screen-map \.map-actions\{display:none\}/.test(pwaCssSource)) {
  throw new Error('PWA destination selection must hide competing general map controls like native');
}
if (!/#destinationCard \.destination-primary-action\{[^\n]*border-radius:14px/.test(pwaCssSource)) {
  throw new Error('PWA destination primary action must align with native navigation button geometry');
}
if (!/mapActionButton:\s*\{[\s\S]*?width: 54,[\s\S]*?height: 54,[\s\S]*?borderRadius: 27/.test(nativeMapSource)) {
  throw new Error('Native map controls must keep the shared 54px circular geometry');
}
if (!/navigationActions:\s*\{[\s\S]*?flexDirection: 'column',[\s\S]*?gap: spacing\.sm/.test(nativeMapSource)) {
  throw new Error('Native navigation actions must stack vertically like the stacked PWA dock');
}
if (!/navigationActionButton:\s*\{[\s\S]*?width: 54,[\s\S]*?height: 54,[\s\S]*?borderRadius: 27/.test(nativeMapSource)) {
  throw new Error('Native navigation dock controls must keep the shared 54px circular geometry');
}

if (/bottom: insets\.bottom \+ 116/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must not double-count the bottom safe area above the summary');
}
if (!/navigationSummaryHeight \+ spacing\.md/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must stay directly above the measured navigation summary');
}
// NavigationTripSummary measures itself and reports through onHeight.
if (!/function NavigationTripSummary[\s\S]*?onLayout=\{measured\(onHeight\)\}/.test(nativeMapSource) || !/onHeight=\{setNavigationSummaryHeight\}/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must follow the real ETA summary height including safe-area and text growth');
}

// A ride member's "last seen" wording is the same in both apps.
{
  const shared = await import('../shared/src/rideCode.ts');
  const body = pwaMapSource.match(/const RIDE_LOCATION_FRESH_MS = (\d[\d_]*);\s*function rideMemberLastSeenAgo\(updatedAt, now\) \{[\s\S]*?\n {2}\}/)?.[0];
  if (!body) throw new Error('PWA must define rideMemberLastSeenAgo next to RIDE_LOCATION_FRESH_MS');
  const pwaLastSeen = new Function(`${body}; return rideMemberLastSeenAgo;`)();
  for (const age of [0, 20_000, 20_001, 45_000, 59_999, 60_000, 125_000, 9.5 * 60_000, Number.NaN]) {
    const now = 10_000_000;
    if (pwaLastSeen(now - age, now) !== shared.rideMemberLastSeenAgo(now - age, now)) {
      throw new Error(`PWA and shared rideMemberLastSeenAgo disagree at ${age} ms`);
    }
  }
  if (!/rideMemberLastSeenAgo\(location\.updatedAt, markerNow\)/.test(nativeMapScreenSource)) {
    throw new Error('Native ride markers must use the shared rideMemberLastSeenAgo');
  }
}

// What members hear when the host sets a regroup point.
{
  const shared = await import('../shared/src/rideCode.ts');
  const body = pwaMapSource.match(/function regroupAnnouncement\(previous, next, isHost\) \{[\s\S]*?\n {2}\}/)?.[0];
  if (!body) throw new Error('PWA must define regroupAnnouncement');
  const pwaAnnouncement = new Function(`${body}; return regroupAnnouncement;`)();
  const esso = { lat: 51.6, lon: -0.2, label: 'Esso, A1', setAt: 1 };
  for (const [previous, next, isHost] of [[null, esso, false], [esso, { ...esso, setAt: 2, label: '' }, false], [null, esso, true], [esso, esso, false], [esso, null, false], [undefined, esso, false]]) {
    if (pwaAnnouncement(previous, next, isHost) !== shared.regroupAnnouncement(previous, next, isHost)) {
      throw new Error('PWA and shared regroupAnnouncement disagree');
    }
  }
  if (!/regroupAnnouncement\(known, regroup, activeRide\?\.isHost === true\)/.test(nativeMapScreenSource)) {
    throw new Error('Native map must announce regroup points with the shared regroupAnnouncement');
  }
}

// What the group hears when a rider's position stops, or starts, updating.
{
  const shared = await import('../shared/src/rideCode.ts');
  const body = pwaMapSource.match(/const RIDE_DROPPED_ALERT_MS = (\d[\d_]*);\s*function rideDropAnnouncements\(previous, locations, names, now\) \{[\s\S]*?\n {2}\}/);
  if (!body) throw new Error('PWA must define rideDropAnnouncements next to RIDE_DROPPED_ALERT_MS');
  if (Number(body[1].replaceAll('_', '')) !== shared.RIDE_DROPPED_ALERT_MS) throw new Error('PWA RIDE_DROPPED_ALERT_MS must match shared');
  const pwaDrop = new Function('RIDE_LOCATION_FRESH_MS', `${body[0]}; return rideDropAnnouncements;`)(shared.RIDE_LOCATION_FRESH_MS);
  const now = 1_000_000;
  const names = { sam: 'Sam' };
  const cases = [
    [{}, [{ riderId: 'sam', updatedAt: now }]],
    [{ sam: 'fresh' }, [{ riderId: 'sam', updatedAt: now - 60_000 }]],
    [{ sam: 'fresh' }, [{ riderId: 'sam', updatedAt: now - 120_000 }]],
    [{ sam: 'dropped' }, [{ riderId: 'sam', updatedAt: now - 200_000 }]],
    [{ sam: 'dropped' }, [{ riderId: 'sam', updatedAt: now - 1000 }]],
    [{}, [{ riderId: 'sam', updatedAt: now - 300_000 }]],
    [{ x: 'fresh' }, [{ riderId: 'x', updatedAt: Number.NaN }]],
    [{ x: 'fresh' }, [{ riderId: 'x', updatedAt: now - 130_000 }]],
    [{ sam: 'fresh' }, []],
  ];
  for (const [previous, locations] of cases) {
    if (JSON.stringify(pwaDrop(previous, locations, names, now)) !== JSON.stringify(shared.rideDropAnnouncements(previous, locations, names, now))) {
      throw new Error('PWA and shared rideDropAnnouncements disagree');
    }
  }
  if (!/rideDropAnnouncements\(/.test(nativeMapScreenSource)) {
    throw new Error('Native map must announce dropped riders with the shared rideDropAnnouncements');
  }
}

// A rider's low battery is judged and announced the same in both apps.
{
  const shared = await import('../shared/src/rideCode.ts');
  const body = pwaMapSource.match(/const RIDE_BATTERY_LOW_LEVEL = ([\d.]+);\s*function isRideBatteryLow\(level, charging\) \{[\s\S]*?\n {2}\}\s*function rideBatteryAnnouncements\(previous, locations, names\) \{[\s\S]*?\n {2}\}/);
  if (!body) throw new Error('PWA must define isRideBatteryLow and rideBatteryAnnouncements next to RIDE_BATTERY_LOW_LEVEL');
  if (Number(body[1]) !== shared.RIDE_BATTERY_LOW_LEVEL) throw new Error('PWA RIDE_BATTERY_LOW_LEVEL must match shared');
  const pwa = new Function(`${body[0]}; return { isRideBatteryLow, rideBatteryAnnouncements };`)();
  for (const [level, charging] of [[0.15, false], [0.1, true], [0.16, false], [-1, false], [null, false], [undefined, false], [0, false]]) {
    if (pwa.isRideBatteryLow(level, charging) !== shared.isRideBatteryLow(level, charging)) throw new Error('PWA and shared isRideBatteryLow disagree');
  }
  const names = { sam: 'Sam' };
  const cases = [
    [{}, [{ riderId: 'sam', batteryLow: true }]],
    [{ sam: true }, [{ riderId: 'sam', batteryLow: true }]],
    [{ sam: true }, [{ riderId: 'sam' }]],
    [{}, [{ riderId: 'x', batteryLow: true }, { riderId: 'sam', batteryLow: false }]],
  ];
  for (const [previous, locations] of cases) {
    if (JSON.stringify(pwa.rideBatteryAnnouncements(previous, locations, names)) !== JSON.stringify(shared.rideBatteryAnnouncements(previous, locations, names))) {
      throw new Error('PWA and shared rideBatteryAnnouncements disagree');
    }
  }
  if (!/rideBatteryAnnouncements\(/.test(nativeMapScreenSource)) {
    throw new Error('Native map must announce low batteries with the shared rideBatteryAnnouncements');
  }
}

// The end-of-ride summary reads the same in both apps.
{
  const shared = await import('../shared/src/rideCode.ts');
  const body = pwaMapSource.match(/function rideSummary\(durationMs, riders, distanceMeters, unit\) \{[\s\S]*?\n {2}\}/)?.[0];
  if (!body) throw new Error('PWA must define rideSummary');
  const pwaSummary = new Function(`${body}; return rideSummary;`)();
  for (const args of [[102 * 60_000, 4, 61_472, 'mi'], [120 * 60_000, 2, 12_345, 'km'], [25 * 60_000, 1, null, 'mi'], [20_000, 3, 50, 'mi'], [Number.NaN, 2, Number.NaN, 'km']]) {
    if (pwaSummary(...args) !== shared.rideSummary(...args)) throw new Error('PWA and shared rideSummary disagree');
  }
}

// Both apps draw the white turn arrow from the shared geometry.
if (!/navigationPuck\.navigationManeuverArrow\(/.test(pwaMapSource) || !/navigationManeuverArrow\(\s*activeRoute\.steps\[navigationStepIndex\]/.test(nativeMapScreenSource)) {
  throw new Error('Both apps must draw the turn arrow with the shared navigationManeuverArrow');
}

// The host's regroup point: a chip and a flag for every member, "Regroup
// here" / "Clear regroup point" for the host, in both apps.
{
  const nativeRegroupSource = await readFile(new URL('../mobile/src/screens/RegroupPoint.tsx', import.meta.url), 'utf8');
  for (const [label, source, patterns] of [
    ['PWA', pwaMapSource + pwaIndexSource, [/id="regroupChip"/, /function renderRegroupPoint/, />Regroup here</, />Clear regroup point</, /Regroup point · set by the host/, /\/regroup`/]],
    ['Native', nativeMapScreenSource + nativeRegroupSource, [/<RegroupChip/, /<RegroupMarker/, /'Regroup here'/, /'Clear regroup point'/, /Regroup point · set by the host/]],
  ]) {
    for (const pattern of patterns) {
      if (!pattern.test(source)) throw new Error(`${label} regroup point is missing ${pattern}`);
    }
  }
}

console.log(`Client parity manifest valid: ${manifest.capabilities.length} capabilities tracked; map basemaps, navigation control dock, route-ahead alerts, maneuver glanceability, live speed and adaptive dedicated navigation aligned`);
