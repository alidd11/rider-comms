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
] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
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


// Settings is Waze-style on both clients: the root lists categories (same
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
  ['General', 'Map & navigation', 'Voice and sound', 'Riding', 'Ride Safe', 'Vehicle details', 'Notifications', 'Account', 'Account and login', 'Privacy', 'About'],
  pwaSettingsList,
  nativeSettingsRoot,
  'Settings root',
);
for (const tint of ['#1FB6D9', '#2FB35F', '#3478F6', '#F2802A', '#8E5CF6', '#EF4444', '#2A8196', '#1E95E8', '#16A9D9']) {
  if (!pwaSettingsList.toUpperCase().includes(tint) || !nativeSettingsRoot.toUpperCase().includes(tint)) {
    throw new Error(`Settings category tint drifted: ${tint}`);
  }
}
assertSameOrder(
  ['Distance units', 'Navigation app', 'Avoid motorways', 'Avoid tolls', 'Spoken directions', 'Notifications on this device', 'Friend requests', 'Messages', 'Ride Safe auto-lock',
    'Nearby rider visibility', 'Blocked riders', 'Email', 'Signed-in devices', 'Sign out', 'Reset settings', 'Delete account'],
  pwaMapSource.slice(pwaMapSource.indexOf('generalSettings: () =>')),
  nativeSettingsSource.slice(nativeSettingsSource.indexOf('function GeneralPage(')),
  'Settings pages',
);
// Vehicle types: same choices, labels and order on both clients.
{
  const pwaVehicles = [...pwaMapSource.matchAll(/\['(motorcycle_large|motorcycle_small|scooter)', '([^']+)'\]/g)].map((match) => `${match[1]}:${match[2]}`);
  const nativeVehicles = [...nativeRiderPreferencesSource.matchAll(/\['(motorcycle_large|motorcycle_small|scooter)', '([^']+)'\]/g)].map((match) => `${match[1]}:${match[2]}`);
  if (pwaVehicles.length !== 3 || pwaVehicles.join('|') !== nativeVehicles.join('|')) {
    throw new Error(`Vehicle type choices drifted: PWA ${pwaVehicles.join(', ')} vs native ${nativeVehicles.join(', ')}`);
  }
}
if (/id="logoutBtn"/.test(pwaIndexSource) || /title="Sign Out"/.test(nativeSettingsRoot)) {
  throw new Error('Sign out lives in Account and login on both clients, not on the Settings root');
}
// The pages the root and category pages open, with the same tokens.
for (const token of ['general', 'mapNavigation', 'voiceSound', 'rideSafe', 'vehicle', 'notifications', 'account', 'privacy', 'about']) {
  if (!pwaMapSource.includes(`${token}: {`) || !pwaSettingsList.includes(`'${token}'`) || !nativeSettingsSource.includes(`page === '${token}'`) || !nativeSettingsSource.includes(`openPage('${token}')`)) {
    throw new Error(`Settings page drifted for ${token}`);
  }
}
for (const token of ['navigationApp', 'blockedRiders', 'email', 'devices']) {
  if (!pwaMapSource.includes(`${token}: {`) || !pwaMapSource.includes(`settingsLink('${token}'`) || !nativeSettingsSource.includes(`page === '${token}'`) || !nativeSettingsSource.includes(`page: '${token}'`)) {
    throw new Error(`Settings page drifted for ${token}`);
  }
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
// No duplicates: Help lives in the menu only, the plan only under Your plan,
// and the profile is not repeated on the Settings root.
if (/data-sheet="help"|settings-profile-row/.test(pwaIndexSource) || /openPage\('help'\)|styles\.profileCard/.test(nativeSettingsSource)) {
  throw new Error('Settings root must not repeat Help or the profile card from the menu');
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

const HAZARD_EMAIL_VERIFICATION_COPY = 'Verify your email in Settings → Account → Edit profile to report or confirm road hazards.';
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
    /riderAvatarMapIcon\(state\.profile, true, undefined, 64, true\)/,
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
    /setNavStatusNotice\('Could not reroute\. Continue with caution\.'\)/,
    /routeNotice: 'Route updated\.'/,
    /visibleMapRiders\(\)/,
  ]],
  ['Native navigation', nativeMapSource, [
    /navigationFollowing/,
    /navigationMuted/,
    /size=\{64\}/,
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
if (!/style=\{styles\.navigationInstruction\}[\s\S]{0,220}?accessibilityLiveRegion="polite"[\s\S]{0,220}?accessibilityLabel=\{navigationGuidanceInstruction\}/.test(nativeMapSource)) {
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
if (/function navGlanceInstruction\(|function navGlanceSummary\(/.test(pwaMapSource)
  || /navRouteBadge|navRoadName/.test(pwaIndexSource)
  || /roadFromInstruction|roundaboutAction|navigationGlanceInstruction|navigationGlanceSummary/.test(nativeGuidanceSource)
  || /navigationRouteBadge|navigationRoadName/.test(nativeMapSource)) {
  throw new Error('Navigation must not reconstruct route, road, exit or junction metadata from free-form provider instructions');
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
if (!/mapMarker: !navigationMode/.test(pwaMapSource) || !/anchor: navigationMode/.test(pwaMapSource)) {
  throw new Error('PWA navigation avatar must switch from a map pin to a clean centred navigation avatar');
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
if (!/onLayout=\{\(event\) => \{[\s\S]*setNavigationSummaryHeight/.test(nativeMapSource)) {
  throw new Error('Native navigation controls must follow the real ETA summary height including safe-area and text growth');
}

console.log(`Client parity manifest valid: ${manifest.capabilities.length} capabilities tracked; map basemaps, navigation control dock, route-ahead alerts, maneuver glanceability, live speed and adaptive dedicated navigation aligned`);
