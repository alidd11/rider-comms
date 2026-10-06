// Part of docs/app.js. 17 of 20: Turn-by-turn navigation. Edit here, then run `npm run build:pwa-app`.
  // Google's Directions instruction can put secondary guidance in a child
  // div. Convert that markup boundary to punctuation, strip all remaining
  // tags as text and decode only the small entity set the provider uses.
  // Do not hand provider HTML to the browser's HTML parser: the route string
  // is external data and navigation only needs its text content.
  function stripHtml(html) {
    return navigationGuidance.normalizeNavigationInstructionText(
      String(html || '')
        .replace(/<div[^>]*>/gi, '. ')
        .replace(/<\/div>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => NAVIGATION_HTML_ENTITIES[entity] ?? entity)
        .replace(/\s+([,.])/g, '$1')
    );
  }

  const navigationGuidance = globalThis.RiderNavigationGuidance;
  if (!navigationGuidance) throw new Error('Navigation guidance runtime is unavailable');

  // Keep the app-level adapters tiny: the shared browser runtime owns all
  // user-facing formatting and prompt-stage decisions, while state.unit
  // remains the account-scoped preference already used throughout the PWA.
  function navGlanceAction(maneuver) {
    return navigationGuidance.navigationManeuverAction(maneuver);
  }

  /** Best-effort voice guidance — SpeechSynthesis isn't universally
   * available/enabled (older browsers, some in-app webviews), so a
   * missing/failing voice never blocks the real navigation logic, only
   * the audio announcement of it. */
  function speak(text) {
    try {
      if (navMuted || !('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* voice guidance is a nice-to-have, never blocks navigation */ }
  }

  function formatNavDistance(meters) {
    return navigationGuidance.formatNavigationDistance(meters, state.unit);
  }


  function navigationPromptStageForDistance(meters) {
    return navigationGuidance.navigationPromptStageForDistance(meters);
  }

  function navigationPromptText(instruction, meters, stage) {
    return navigationGuidance.navigationPromptText(instruction, meters, state.unit, stage);
  }

  function formatNavDuration(seconds) {
    return navigationGuidance.formatNavigationDuration(seconds);
  }

  function formatNavSpeed(speedMps) {
    return navigationGuidance.formatNavigationSpeed(speedMps, state.unit);
  }

  function navSpeedUnit() {
    return navigationGuidance.navigationSpeedUnit(state.unit);
  }

  function renderNavSpeed() {
    const speedValue = formatNavSpeed(navCurrentSpeedMps);
    const speedUnit = navSpeedUnit();
    const speed = $('#navSpeed');
    const unit = $('#navSpeedUnit');
    if (speed) speed.textContent = speedValue;
    if (unit) unit.textContent = speedUnit;
    $('.nav-speed-badge')?.setAttribute(
      'aria-label',
      navCurrentSpeedMps == null ? 'Current speed unavailable' : `Current speed ${speedValue} ${speedUnit}`,
    );
  }

  let navBannerResizeObserver = null;

  function syncNavigationOverlayGeometry() {
    const banner = $('#navBanner');
    const app = $('#app');
    if (!banner || !app || banner.hidden) return;
    const height = Math.ceil(banner.getBoundingClientRect().height);
    if (height > 0) app.style.setProperty('--nav-banner-height', `${height}px`);
  }

  function watchNavigationOverlayGeometry() {
    if (navBannerResizeObserver || !('ResizeObserver' in window)) return;
    const banner = $('#navBanner');
    if (!banner) return;
    navBannerResizeObserver = new ResizeObserver(syncNavigationOverlayGeometry);
    navBannerResizeObserver.observe(banner);
  }

  function formatArrivalTime(remainingSeconds) {
    return new Date(Date.now() + remainingSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Preserve the maneuver geometry Google already gives us. A slight turn,
  // ordinary turn, sharp turn, fork, ramp and merge are materially different
  // decisions for a rider; rotating one generic triangle made those distinctions
  // too hard to read at a glance.
  const MANEUVER_PRESENTATIONS = {
    'turn-slight-left': 'i-nav-slight-left',
    'turn-left': 'i-nav-left',
    'turn-sharp-left': 'i-nav-sharp-left',
    'uturn-left': 'i-nav-uturn-left',
    'turn-slight-right': 'i-nav-slight-right',
    'turn-right': 'i-nav-right',
    'turn-sharp-right': 'i-nav-sharp-right',
    'uturn-right': 'i-nav-uturn-right',
    'roundabout-left': 'i-nav-roundabout-left',
    'roundabout-right': 'i-nav-roundabout-right',
    ferry: 'i-nav-ferry',
    'ferry-train': 'i-nav-ferry',
    'fork-left': 'i-nav-fork-left',
    'fork-right': 'i-nav-fork-right',
    'ramp-left': 'i-nav-ramp-left',
    'ramp-right': 'i-nav-ramp-right',
    merge: 'i-nav-merge',
    arrive: 'i-nav-arrive',
  };

  function applyManeuverSvg(svg, maneuver) {
    if (!svg) return;
    const maneuverKey = maneuver || 'straight';
    const icon = MANEUVER_PRESENTATIONS[maneuverKey] || 'i-nav-straight';
    $('use', svg)?.setAttribute('href', `#${icon}`);
    svg.dataset.maneuver = maneuverKey;
    svg.style.transform = 'none';
  }

  function applyManeuverIcon(maneuver) {
    applyManeuverSvg($('#navManeuverSvg'), maneuver);
  }

  /** A Google Directions request with the rider's route options applied. */
  function navigationRouteRequest(origin, destination) {
    return {
      origin,
      destination,
      travelMode: google.maps.TravelMode.DRIVING,
      avoidHighways: state.avoidHighways === true,
      avoidTolls: state.avoidTolls === true,
    };
  }

  function getDirectionsService() {
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    return directionsService;
  }

  function getDirectionsRenderer() {
    if (!directionsRenderer) {
      directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        suppressPolylines: true,
        preserveViewport: true,
      });
    }
    directionsRenderer.setMap(map);
    return directionsRenderer;
  }

  function renderNavigationRouteLine(path) {
    if (!Array.isArray(path) || path.length < 2) return;
    if (!navRouteOutline) {
      navRouteOutline = new google.maps.Polyline({ strokeColor: '#174EA6', strokeWeight: 10, zIndex: 6 });
      navRouteLine = new google.maps.Polyline({ strokeColor: '#4285F4', strokeWeight: 6, zIndex: 7 });
    }
    navRouteOutline.setPath(path);
    navRouteLine.setPath(path);
    navRouteOutline.setMap(map);
    navRouteLine.setMap(map);
  }

  function clearNavigationRouteLine() {
    navRouteOutline?.setMap(null);
    navRouteLine?.setMap(null);
  }

  function setNavigationTrafficVisible(visible) {
    if (!map || typeof google?.maps?.TrafficLayer !== 'function') return;
    if (!navigationTrafficLayer) navigationTrafficLayer = new google.maps.TrafficLayer();
    navigationTrafficLayer.setMap(visible ? map : null);
  }

  function navigationRemainingRoutePath() {
    return combineNavigationCameraPaths(
      ...navSteps.slice(navStepIndex).map((step) => navigationStepPath(step)),
    );
  }

  function renderNavigationRoadAhead() {
    const container = $('#navRoadAhead');
    if (!container) return;
    if (!navSteps.length || !navCurrentPosition || navGpsIssue) {
      container.hidden = true;
      container.replaceChildren();
      return;
    }

    const alerts = navigationHazardsAhead(
      navCurrentPosition,
      navigationRemainingRoutePath(),
      nearbyHazards,
      { currentAccuracyMeters: navCurrentAccuracyMeters },
    );
    renderMapHazards();
    container.hidden = alerts.length === 0;
    if (!alerts.length) {
      container.replaceChildren();
      return;
    }

    container.innerHTML = `<span class="nav-road-ahead-label">Reports ahead</span><span class="nav-road-ahead-events">${alerts.map((alert) => {
      const label = navigationHazardLabel(alert.hazard.type);
      const displayLabel = navigationHazardCompactLabel(alert.hazard.type);
      const distance = formatNavDistance(alert.distanceAheadMeters);
      return `<span class="nav-road-ahead-event" aria-label="${escapeHtml(label)}, ${escapeHtml(distance)} ahead">${hazardNavigationIconMarkup(alert.hazard.type)}<span>${escapeHtml(displayLabel)}</span><strong>${escapeHtml(distance)}</strong></span>`;
    }).join('')}</span>`;
  }

  function renderNavStep() {
    const step = navSteps[navStepIndex];
    if (!step) return;
    const upcomingStep = navSteps[navStepIndex + 1];
    applyManeuverIcon(upcomingStep?.maneuver || 'arrive');
    const stepPath = navigationStepPath(step);
    const turnDistance = navCurrentPosition ? remainingDistanceOnPathMeters(navCurrentPosition, stepPath) : step.distance.value;
    $('#navDistanceNext').textContent = formatNavDistance(turnDistance);
    const fullInstruction = upcomingStep
      ? stripHtml(upcomingStep.instructions)
      : `Arrive at ${navDestination?.label || 'destination'}`;
    const instruction = $('#navInstruction');
    instruction.textContent = navGlanceAction(upcomingStep?.maneuver || 'arrive');
    instruction.setAttribute('aria-label', fullInstruction);
    const providerInstruction = $('#navProviderInstruction');
    if (providerInstruction) providerInstruction.textContent = fullInstruction;
    // Keep the provider-authored next instruction intact. The maneuver glyph
    // supplies the glanceable geometry without reconstructing road metadata.
    const followingStep = navSteps[navStepIndex + 2];
    $('#navNextPreview').hidden = !followingStep;
    if (followingStep) {
      applyManeuverSvg($('#navNextManeuverSvg'), followingStep.maneuver);
      $('#navNextInstruction').textContent = stripHtml(followingStep.instructions);
    }
    let remainingMeters = turnDistance;
    const currentStepDistance = Math.max(1, step.distance.value);
    const currentStepRatio = Math.max(0, Math.min(1, turnDistance / currentStepDistance));
    let remainingSeconds = step.duration.value * currentStepRatio;
    for (let i = navStepIndex + 1; i < navSteps.length; i++) {
      remainingMeters += navSteps[i].distance.value;
      remainingSeconds += navSteps[i].duration.value;
    }
    $('#navDistance').textContent = formatNavDistance(remainingMeters);
    $('#navEta').textContent = formatNavDuration(remainingSeconds);
    $('#navArrival').textContent = formatArrivalTime(remainingSeconds);
    renderNavSpeed();
    renderNavigationRoadAhead();
    requestAnimationFrame(syncNavigationOverlayGeometry);
    if (!navMuted && navLastAnnouncedStep !== navStepIndex) {
      navLastAnnouncedStep = navStepIndex;
      if (navLastNowPromptStep !== navStepIndex) speak(stripHtml(step.instructions));
    }
  }

  function maybeSpeakUpcomingNavigationPrompt(here, step) {
    const upcomingIndex = navStepIndex + 1;
    const upcomingStep = navSteps[upcomingIndex];
    if (!upcomingStep) return;

    if (navPromptTargetIndex !== upcomingIndex) {
      navPromptTargetIndex = upcomingIndex;
      navPromptStage = 0;
    }

    const maneuverDistance = remainingDistanceOnPathMeters(here, navigationStepPath(step));
    const stage = navigationPromptStageForDistance(maneuverDistance);
    if (navMuted || stage <= navPromptStage) return;

    navPromptStage = stage;
    if (stage === 3) navLastNowPromptStep = upcomingIndex;
    const prompt = navigationPromptText(stripHtml(upcomingStep.instructions), maneuverDistance, stage);
    if (prompt) speak(prompt);
  }

  function updateNavigationControls() {
    const locate = $('#locateBtn');
    locate?.classList.toggle('active', navFollowing);
    const mute = $('#navMuteBtn');
    if (mute) {
      mute.setAttribute('aria-label', navMuted ? 'Unmute navigation guidance' : 'Mute navigation guidance');
      const use = $('use', mute);
      if (use) use.setAttribute('href', navMuted ? '#i-volume-off' : '#i-volume');
      mute.classList.toggle('active', navMuted);
    }
    const overview = $('#navOverviewBtn');
    if (overview) {
      overview.setAttribute('aria-label', navFollowing ? 'Show route overview' : 'Resume navigation follow mode');
      const use = $('use', overview);
      if (use) use.setAttribute('href', navFollowing ? '#i-route' : '#i-locate');
      overview.classList.toggle('active', !navFollowing);
    }
  }

  function updateNavigationPositionIcon() {
    if (!userMapMarker || !navSteps.length) return;
    // Navigation keeps the rider's persisted identity instead of replacing it
    // with a generic blue chevron. Heading-up mode rotates the provider map
    // beneath this marker, so the chosen avatar can remain screen-upright.
    userMapMarker.setIcon?.(riderAvatarMapIcon(state.profile, true, undefined, 64, true));
  }

  function stopNavigationCameraAnimation() {
    navCameraAnimationToken += 1;
    if (navCameraAnimationFrame !== undefined) {
      cancelAnimationFrame(navCameraAnimationFrame);
      navCameraAnimationFrame = undefined;
    }
  }

  function animateNavigationCamera(target, durationMs = 500) {
    if (!map || typeof map.moveCamera !== 'function') return false;
    stopNavigationCameraAnimation();

    const currentCentre = map.getCenter?.();
    const from = {
      center: currentCentre
        ? { lat: currentCentre.lat(), lng: currentCentre.lng() }
        : target.center,
      zoom: map.getZoom?.(),
      heading: map.getHeading?.(),
      tilt: map.getTilt?.(),
    };
    const hasSnapshot = Number.isFinite(from.center?.lat)
      && Number.isFinite(from.center?.lng)
      && Number.isFinite(from.zoom)
      && Number.isFinite(from.heading)
      && Number.isFinite(from.tilt);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!hasSnapshot || reduceMotion || durationMs <= 0) {
      map.moveCamera(target);
      return true;
    }

    const token = navCameraAnimationToken;
    const headingDelta = ((target.heading - from.heading + 540) % 360) - 180;
    let startedAt;
    const frame = (timestamp) => {
      if (token !== navCameraAnimationToken || !navFollowing) return;
      if (startedAt === undefined) startedAt = timestamp;
      const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / durationMs));
      const eased = 1 - ((1 - progress) ** 3);
      map.moveCamera({
        center: {
          lat: from.center.lat + (target.center.lat - from.center.lat) * eased,
          lng: from.center.lng + (target.center.lng - from.center.lng) * eased,
        },
        zoom: from.zoom + (target.zoom - from.zoom) * eased,
        heading: (from.heading + headingDelta * eased + 360) % 360,
        tilt: from.tilt + (target.tilt - from.tilt) * eased,
      });
      if (progress < 1) navCameraAnimationFrame = requestAnimationFrame(frame);
      else navCameraAnimationFrame = undefined;
    };
    navCameraAnimationFrame = requestAnimationFrame(frame);
    return true;
  }

  function applyNavigationCamera(here, step, gpsHeading, speedMps) {
    if (!map || !step) return;
    const currentPath = navigationStepPath(step);
    const upcomingStep = navSteps[navStepIndex + 1];
    const followingStep = navSteps[navStepIndex + 2];
    const cameraPath = combineNavigationCameraPaths(
      currentPath,
      upcomingStep ? navigationStepPath(upcomingStep) : undefined,
      followingStep ? navigationStepPath(followingStep) : undefined,
    );
    if (!cameraPath.length) return;

    const maneuverDistance = remainingDistanceOnPathMeters(here, currentPath);
    const profile = navigationCamera.navigationCameraProfile({
      speedMps,
      maneuverDistanceMeters: maneuverDistance,
      maneuver: upcomingStep?.maneuver,
    });
    const headingTarget = lookAheadCoordinateOnPath(
      here,
      cameraPath,
      Math.min(70, Math.max(35, profile.lookAheadMeters * 0.35)),
    );
    const routeHeading = bearingDegrees(here, headingTarget);
    const movingSpeed = Number.isFinite(speedMps) ? Number(speedMps) : null;
    const candidateHeading = movingSpeed !== null
      && movingSpeed > 2.5
      && Number.isFinite(gpsHeading)
      && gpsHeading >= 0
      ? gpsHeading
      : routeHeading;
    const heading = navigationCamera.stabilizeNavigationHeading(navCameraHeading, candidateHeading, movingSpeed);
    navCameraHeading = heading;

    if (!navFollowing) return;
    // Centre straight ahead along the camera heading, so the rider stays
    // centred left-to-right and lands in the clear band between the banner
    // and the trip summary however tall those are.
    const occlusion = navigationViewportOcclusion();
    const aheadMeters = occlusion
      ? navCameraCorrection * navigationCamera.navigationCentreAheadMeters({
        viewportHeight: occlusion.height,
        topOcclusion: occlusion.top,
        bottomOcclusion: occlusion.bottom,
        zoom: profile.zoom,
        pitch: profile.pitch,
        latitude: here.lat,
      })
      : 0;
    const centre = navigationCamera.offsetAlongHeading(here.lat, here.lng, heading, aheadMeters);
    const transitionDuration = movingSpeed !== null && movingSpeed <= 1.5 ? 650 : 500;
    if (!animateNavigationCamera(
      { center: centre, zoom: profile.zoom, heading, tilt: profile.pitch },
      transitionDuration,
    )) {
      map.panTo(centre);
      map.setZoom(profile.zoom);
      map.setHeading?.(heading);
      map.setTilt?.(profile.pitch);
    }
    if (occlusion) {
      clearTimeout(navCameraFitTimer);
      const token = navCameraAnimationToken;
      navCameraFitTimer = setTimeout(() => {
        if (token === navCameraAnimationToken && navFollowing) {
          measureNavigationCameraFit(here, occlusion, aheadMeters, profile);
        }
      }, transitionDuration + 80);
    }
    // In heading-up follow mode the map rotates underneath the rider's chosen
    // avatar, keeping their identity screen-upright while exposing more road
    // ahead in the pitched perspective.
    updateNavigationPositionIcon();
  }

  function navigationCameraProjection() {
    if (!map || typeof google?.maps?.OverlayView !== 'function') return null;
    if (!navCameraProjectionOverlay) {
      // An empty overlay is the documented way to borrow the map's
      // projection for converting coordinates to screen pixels.
      navCameraProjectionOverlay = new google.maps.OverlayView();
      navCameraProjectionOverlay.onAdd = () => {};
      navCameraProjectionOverlay.draw = () => {};
      navCameraProjectionOverlay.onRemove = () => {};
      navCameraProjectionOverlay.setMap(map);
    }
    return navCameraProjectionOverlay.getProjection?.() ?? null;
  }

  /** After the camera settles, check where the map really drew the rider and
   * nudge the learned correction so the next move lands on target. */
  function measureNavigationCameraFit(here, occlusion, aheadMeters, profile) {
    const point = navigationCameraProjection()?.fromLatLngToContainerPixel?.(new google.maps.LatLng(here.lat, here.lng));
    if (!point || !Number.isFinite(point.y)) return;
    const metresPerPoint = navigationCamera.navigationMetresPerPoint(profile.zoom, here.lat);
    navCameraCorrection = navigationCamera.nextNavigationCameraCorrection(navCameraCorrection, {
      targetOffset: navigationCamera.navigationRiderScreenOffset(occlusion.height, occlusion.top, occlusion.bottom),
      measuredOffset: point.y - occlusion.height / 2,
      flatOffset: metresPerPoint > 0 ? aheadMeters / metresPerPoint : Number.NaN,
      pitch: profile.pitch,
    });
  }

  function showNavigationOverview() {
    if (!map || !navSteps.length) return;
    navFollowing = false;
    navCameraHeading = null;
    stopNavigationCameraAnimation();
    map.setHeading?.(0);
    map.setTilt?.(0);
    updateNavigationPositionIcon();
    const route = directionsRenderer?.getDirections?.()?.routes?.[0];
    // Pad by what the banner and bottom stack actually cover; the old fixed
    // 170/150 left the route's ends under a tall banner or the controls.
    const occlusion = navigationViewportOcclusion();
    if (route?.bounds) {
      let top = (occlusion?.top ?? 150) + 24;
      let bottom = (occlusion?.bottom ?? 130) + 24;
      // Leave at least 120px of map for the route itself.
      const available = (occlusion?.height ?? Number.POSITIVE_INFINITY) - 120;
      if (top + bottom > available && available > 0) {
        const scale = available / (top + bottom);
        top *= scale;
        bottom *= scale;
      }
      map.fitBounds?.(route.bounds, { top: Math.round(top), right: 70, bottom: Math.round(bottom), left: 70 });
    }
    updateNavigationControls();
  }

  function resumeNavigationFollowing() {
    navFollowing = true;
    updateNavigationControls();
    if (!latestDevicePosition || !navSteps[navStepIndex]) return;
    const here = {
      lat: latestDevicePosition.coords.latitude,
      lng: latestDevicePosition.coords.longitude,
    };
    navCurrentPosition = here;
    applyNavigationCamera(
      here,
      navSteps[navStepIndex],
      latestDevicePosition.coords.heading,
      latestDevicePosition.coords.speed,
    );
  }

  /** Entry point — called from the destination card's real "Start"
   * button (see showDestinationCard above). Fetches the rider's live GPS
   * fix, requests a real route from it to the selected destination, and
   * hands off to applyRoute on success. */
  async function startInAppNavigation(location, label) {
    let position;
    try {
      position = await currentPosition();
    } catch {
      showToast('Location access is needed to start navigation.');
      return;
    }
    const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
    const destination = { lat: location.lat(), lng: location.lng() };
    getDirectionsService().route(
      navigationRouteRequest(origin, destination),
      (result, status) => {
        if (status !== 'OK' || !result) {
          showToast('Could not calculate a route. Try again.');
          return;
        }
        applyRoute(result, destination, label);
      }
    );
  }

  // Navigation now extends the real app surface through the installed-iPhone
  // bottom safe area. Do not recolour browser/system chrome to hide a gap.
  function applyRoute(result, destination, label, { preserveMute = false, routeNotice = null } = {}) {
    const leg = result.routes[0]?.legs[0];
    if (!leg) { showToast('Could not calculate a route. Try again.'); return; }
    stopNavigationCameraAnimation();
    getDirectionsRenderer().setDirections(result);
    navSteps = leg.steps;
    renderNavigationRouteLine(combineNavigationCameraPaths(...navSteps.map((step) => navigationStepPath(step))));
    navStepIndex = 0;
    navLastAnnouncedStep = -1;
    navPromptTargetIndex = -1;
    navPromptStage = 0;
    navLastNowPromptStep = -1;
    navOffRouteSince = null;
    navFollowing = true;
    if (!preserveMute) navMuted = false;
    navCurrentPosition = null;
    navCurrentAccuracyMeters = null;
    navCurrentSpeedMps = Number.isFinite(latestDevicePosition?.coords?.speed) && Number(latestDevicePosition.coords.speed) >= 0
      ? Number(latestDevicePosition.coords.speed)
      : null;
    if (!preserveMute) navCameraHeading = null;
    navDestination = { ...destination, label };
    hideDestinationCard();
    destinationMarker?.setMap(null);
    destinationMarker = new google.maps.Marker({
      map,
      position: destination,
      title: label ? `Destination: ${label}` : 'Route destination',
      icon: routeFinishIcon(),
      zIndex: 11,
    });
    // Any POI category the rider had tapped before starting nav (fuel,
    // parking, food…) leaves its markers on the map otherwise — clutter
    // that has nothing to do with the route and makes driving mode look
    // like the ordinary browsing map with a banner stuck on top of it,
    // not a dedicated turn-by-turn view.
    clearPoiMarkers();
    $('#hazardCard').hidden = true;
    $('#riderCard').hidden = true;
    // A dedicated driving mode, not a banner bolted onto the browsing map:
    // the search bar, POI chips, bottom tab bar and "go live" control all
    // disappear (see the .nav-mode rules in app.css) so the only things on
    // screen are the route, the turn card, the ETA bar, and the controls a
    // rider actually needs mid-drive (report hazard, mute guidance, route overview/follow, end nav).
    $('#app').classList.add('nav-mode');
    watchNavigationOverlayGeometry();
    setNavigationTrafficVisible(true);
    // Populate the first real maneuver before revealing the live region so
    // assistive technology does not announce the placeholder and then the
    // instruction back-to-back.
    renderNavStep();
    $('#navBanner').hidden = false;
    $('#navSpeedBadge').hidden = false;
    $('#navSummary').hidden = false;
    requestAnimationFrame(syncNavigationOverlayGeometry);
    updateNavigationPositionIcon();
    updateNavigationControls();
    startNavTracking();
    if (routeNotice) setNavStatusNotice(routeNotice, { tone: 'info', clearAfterMs: 4000 });
    if (latestDevicePosition && navSteps[0]) {
      const here = { lat: latestDevicePosition.coords.latitude, lng: latestDevicePosition.coords.longitude };
      navCurrentPosition = here;
      applyNavigationCamera(
        here,
        navSteps[0],
        latestDevicePosition.coords.heading,
        latestDevicePosition.coords.speed,
      );
    }
  }

  let navStatusNoticeTimer;

  /** `info` notices (a successful reroute) are styled neutrally and clear
   * themselves; warnings stay until the problem is resolved. */
  function setNavStatusNotice(message, { tone = 'warning', clearAfterMs = 0 } = {}) {
    navStatusNotice = message || null;
    clearTimeout(navStatusNoticeTimer);
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = navStatusNotice || '';
      notice.hidden = !navStatusNotice;
      notice.dataset.tone = tone;
    }
    if (navStatusNotice && clearAfterMs > 0) {
      const shown = navStatusNotice;
      navStatusNoticeTimer = setTimeout(() => {
        if (navStatusNotice === shown) setNavStatusNotice(null);
      }, clearAfterMs);
    }
    requestAnimationFrame(syncNavigationOverlayGeometry);
  }

  function setNavGpsIssue(message) {
    if (navGpsIssue === message && navStatusNotice === message) return;
    navGpsIssue = message;
    navOffRouteSince = null;
    navCurrentAccuracyMeters = null;
    navCurrentSpeedMps = null;
    renderNavSpeed();
    renderNavigationRoadAhead();
    setNavStatusNotice(message);
  }

  function clearNavGpsIssue() {
    if (!navGpsIssue) return;
    navGpsIssue = null;
    setNavStatusNotice(null);
    if (navSteps.length) showToast('GPS signal restored.');
  }

  function handleNavPositionError(error) {
    if (!navSteps.length) return;
    setNavGpsIssue(error?.code === 1 ? NAV_GPS_PERMISSION_NOTICE : NAV_GPS_UNAVAILABLE_NOTICE);
  }

  function startNavTracking() {
    stopNavTracking();
    navLastFixAt = Date.now();
    setNavStatusNotice(null);
    if (!navigator.geolocation) {
      setNavGpsIssue(NAV_GPS_UNAVAILABLE_NOTICE);
      return;
    }
    navWatchId = navigator.geolocation.watchPosition(handleNavPosition, handleNavPositionError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
    navGpsWatchdog = setInterval(() => {
      if (!navSteps.length || navGpsIssue || !navLastFixAt) return;
      if (Date.now() - navLastFixAt > NAV_GPS_STALE_MS) setNavGpsIssue(NAV_GPS_STALE_NOTICE);
    }, NAV_GPS_CHECK_MS);
  }

  function stopNavTracking() {
    if (navWatchId !== undefined) {
      navigator.geolocation?.clearWatch(navWatchId);
      navWatchId = undefined;
    }
    clearInterval(navGpsWatchdog);
    navGpsWatchdog = undefined;
    navLastFixAt = 0;
    navGpsIssue = null;
    setNavStatusNotice(null);
  }

  function handleNavPosition(position) {
    navLastFixAt = Date.now();
    clearNavGpsIssue();
    if (!navSteps.length) return;
    navCurrentSpeedMps = Number.isFinite(position.coords.speed) && Number(position.coords.speed) >= 0
      ? Number(position.coords.speed)
      : null;
    renderNavSpeed();
    if (navRerouting) return;
    const here = { lat: position.coords.latitude, lng: position.coords.longitude };
    navCurrentAccuracyMeters = Number.isFinite(position.coords.accuracy)
      ? Number(position.coords.accuracy)
      : null;
    navCurrentPosition = here;
    userMapMarker?.setPosition?.(here);

    let effectiveIndex = navStepIndex;
    while (effectiveIndex < navSteps.length - 1) {
      const step = navSteps[effectiveIndex];
      const next = navSteps[effectiveIndex + 1];
      const stepEnd = { lat: step.end_location.lat(), lng: step.end_location.lng() };
      const reachedStepEnd = metersBetween(here, stepEnd) <= NAV_STEP_ARRIVAL_RADIUS_M;
      const alreadyOnNextStep = distanceToPathMeters(here, navigationStepPath(next)) <= NAV_STEP_ARRIVAL_RADIUS_M * 1.5;
      if (!reachedStepEnd && !alreadyOnNextStep) break;
      effectiveIndex += 1;
    }

    const lastStep = navSteps[navSteps.length - 1];
    const lastEnd = { lat: lastStep.end_location.lat(), lng: lastStep.end_location.lng() };
    if (effectiveIndex === navSteps.length - 1 && metersBetween(here, lastEnd) <= NAV_STEP_ARRIVAL_RADIUS_M) {
      finishNavigation(true);
      return;
    }

    if (effectiveIndex !== navStepIndex) navStepIndex = effectiveIndex;
    const step = navSteps[navStepIndex];
    renderNavStep();
    maybeSpeakUpcomingNavigationPrompt(here, step);
    applyNavigationCamera(here, step, position.coords.heading, position.coords.speed);
    checkOffRoute(here, step);
  }

  function checkOffRoute(here, step) {
    const distanceToRoute = distanceToPathMeters(here, navigationStepPath(step));
    if (distanceToRoute > NAV_OFF_ROUTE_RADIUS_M) {
      if (!navOffRouteSince) navOffRouteSince = Date.now();
      else if (Date.now() - navOffRouteSince > NAV_OFF_ROUTE_GRACE_MS) {
        navOffRouteSince = null;
        void rerouteFromCurrentPosition(here);
      }
    } else {
      navOffRouteSince = null;
    }
  }

  /** Real reroute — off-route for more than the grace period triggers a
   * fresh DirectionsService request from the rider's current position,
   * same as Waze recalculating after a missed turn. Best-effort: if the
   * reroute request itself fails, the rider just keeps following the
   * stale route/step they were already on rather than losing navigation
   * entirely. */
  async function rerouteFromCurrentPosition(here) {
    if (!navDestination) return;
    navRerouting = true;
    setNavStatusNotice('Rerouting…');
    if (!navMuted) speak('Rerouting.');
    getDirectionsService().route(
      navigationRouteRequest(here, { lat: navDestination.lat, lng: navDestination.lng }),
      (result, status) => {
        navRerouting = false;
        if (status !== 'OK' || !result) {
          setNavStatusNotice('Could not reroute. Continue with caution.');
          return;
        }
        applyRoute(
          result,
          { lat: navDestination.lat, lng: navDestination.lng },
          navDestination.label,
          { preserveMute: true, routeNotice: 'Route updated.' },
        );
      }
    );
  }

  function finishNavigation(arrived) {
    const announceArrival = Boolean(arrived && !navMuted);
    stopNavigationCameraAnimation();
    stopNavTracking();
    directionsRenderer?.setMap(null);
    clearNavigationRouteLine();
    destinationMarker?.setMap(null);
    destinationMarker = undefined;
    navSteps = [];
    navStepIndex = 0;
    navDestination = null;
    navLastAnnouncedStep = -1;
    navPromptTargetIndex = -1;
    navPromptStage = 0;
    navLastNowPromptStep = -1;
    navOffRouteSince = null;
    navRerouting = false;
    navFollowing = true;
    navMuted = false;
    navCurrentPosition = null;
    navCurrentAccuracyMeters = null;
    navCurrentSpeedMps = null;
    navCameraHeading = null;
    clearTimeout(navCameraFitTimer);
    const roadAhead = $('#navRoadAhead');
    if (roadAhead) {
      roadAhead.hidden = true;
      roadAhead.replaceChildren();
    }
    renderMapHazards(true);
    map?.setHeading?.(0);
    map?.setTilt?.(0);
    setNavigationTrafficVisible(false);
    userMapMarker?.setIcon?.(riderAvatarMapIcon(state.profile, true));
    updateNavigationControls();
    $('#navBanner').hidden = true;
    $('#navSpeedBadge').hidden = true;
    $('#navSummary').hidden = true;
    $('#app').style.removeProperty('--nav-banner-height');
    $('#app').classList.remove('nav-mode');
    if (arrived) {
      showToast('You have arrived.');
      if (announceArrival) speak('You have arrived at your destination.');
    }
  }

