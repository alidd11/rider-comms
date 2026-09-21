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
  nativeMapSource,
  nativeSettingsSource,
  nativeCameraSource,
  nativeManeuverSource,
  nativeManeuverGlyphSource,
  nativeGuidanceSource,
] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../docs/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationCamera.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationManeuver.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/components/NavigationManeuverGlyph.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/navigationGuidance.ts', import.meta.url), 'utf8'),
]);


const SETTINGS_ROOT_LABELS = [
  'Account',
  'Communication',
  'Map & Navigation',
  'Offline Maps',
  'Units & Preferences',
  'Help & Support',
  'About',
  'Sign Out',
];
for (const label of SETTINGS_ROOT_LABELS) {
  const escaped = label.replaceAll('&', '&amp;');
  if (!pwaIndexSource.includes(`<strong${label === 'Sign Out' ? ' class="danger-text"' : ''}>${escaped}</strong>`)) {
    throw new Error(`PWA Settings root is missing approved category: ${label}`);
  }
  if (!nativeSettingsSource.includes(`title="${label}"`)) {
    throw new Error(`Native Settings root is missing approved category: ${label}`);
  }
}
for (const token of ['accountHub', 'communication', 'mapNavigation', 'offlineMaps', 'unitsPreferences', 'help', 'about']) {
  if (!pwaIndexSource.includes(`data-sheet="${token}"`) || !nativeSettingsSource.includes(`activeSheet === '${token}'`)) {
    throw new Error(`Settings hierarchy drifted for ${token}`);
  }
}
if (/<h2 class="group-title">(?:Account|Preferences|Privacy and safety)<\/h2>/.test(pwaIndexSource)) {
  throw new Error('PWA Settings must not expose the legacy section-heavy root');
}
if (!/settings-profile-row/.test(pwaIndexSource) || !/settings-main-group/.test(pwaIndexSource) || !/settings-secondary-group/.test(pwaIndexSource)) {
  throw new Error('PWA Settings must preserve the approved profile + grouped-card mockup hierarchy');
}
if (!/patchProfile\(\{ unitSystem: next \}\)/.test(pwaMapSource) || !nativeSettingsSource.includes("setUnitSystem(unit)")) {
  throw new Error('Distance units must persist through the rider profile on both clients');
}
for (const key of ['notifyNearby', 'notifyInvites', 'notifyChat']) {
  if (!pwaMapSource.includes(key) || !nativeSettingsSource.includes(key)) {
    throw new Error(`Settings notification parity is missing ${key}`);
  }
}
if (!pwaMapSource.includes('Reset Rider Comms settings to their defaults?') || !nativeSettingsSource.includes('Reset Rider Comms settings?')) {
  throw new Error('Settings reset behavior must exist on both clients');
}
if (!pwaMapSource.includes('Offline map downloads are not available in this build yet.')
  || !nativeSettingsSource.includes('Offline map downloads are not available in this build yet.')) {
  throw new Error('Offline Maps disclosure must match on both clients');
}

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
    /size=\{activeRoute \? 64 : 44\}/,
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
  || !/title: label \? \`Destination: \${label}\` : 'Route destination'/.test(pwaMapSource)
  || !/destinationMarker\?\.setMap\(null\);[\s\S]*destinationMarker = undefined;[\s\S]*navSteps = \[\]/.test(pwaMapSource)) {
  throw new Error('PWA navigation must render and clear a dedicated route-finish marker');
}
if (!/navigationDestination \? \([\s\S]*flag-checkered[\s\S]*navigationDestinationMarker/.test(nativeMapSource)) {
  throw new Error('Native navigation must render a dedicated route-finish marker');
}
if (!/mapMarker=\{!activeRoute\}/.test(nativeMapSource)
  || !/status=\{activeRoute \? 'none' : selfMapStatus\}/.test(nativeMapSource)) {
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
if (!/\.nav-mode \.map-actions\{[^\n]*flex-direction:row;align-items:center;gap:2px;padding:4px;[^\n]*border-radius:18px/.test(pwaCssSource)) {
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
