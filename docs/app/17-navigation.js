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
      avoidFerries: state.avoidFerries === true,
    };
  }

  function getDirectionsService() {
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    return directionsService;
  }

  function getDirectionsRenderer() {
    if (!directionsRenderer) {
      directionsRenderer = trackMapOverlay(new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        suppressPolylines: true,
        preserveViewport: true,
      }));
    }
    directionsRenderer.setMap(map);
    return directionsRenderer;
  }

  function renderNavigationRouteLine(path) {
    if (!Array.isArray(path) || path.length < 2) return;
    if (!navRouteOutline) {
      navRouteOutline = trackMapOverlay(new google.maps.Polyline({ strokeColor: '#174EA6', strokeWeight: 10, zIndex: 6 }));
      navRouteLine = trackMapOverlay(new google.maps.Polyline({ strokeColor: '#4285F4', strokeWeight: 6, zIndex: 7 }));
    }
    navRouteOutline.setPath(path);
    navRouteLine.setPath(path);
    navRouteOutline.setMap(map);
    navRouteLine.setMap(map);
  }

  function clearNavigationRouteLine() {
    navRouteOutline?.setMap(null);
    navRouteLine?.setMap(null);
    clearNavigationManeuverArrow();
  }

  /** Draws the white turn arrow on the road at the upcoming maneuver, as
   * Google and Apple Maps do; redrawn only when the step changes. */
  function renderNavigationManeuverArrow() {
    if (!map || typeof google?.maps?.Polyline !== 'function' || !navigationPuck) return;
    const step = navSteps[navStepIndex];
    const next = navSteps[navStepIndex + 1];
    const key = step && next ? `${navStepIndex}:${navSteps.length}` : null;
    if (key === navArrowKey) return;
    navArrowKey = key;
    const toPuck = (path) => path.map((point) => ({ lat: point.lat, lon: point.lng }));
    const arrow = key ? navigationPuck.navigationManeuverArrow(toPuck(navigationStepPath(step)), toPuck(navigationStepPath(next))) : null;
    if (!arrow) {
      navArrowOutline?.setMap(null);
      navArrowLine?.setMap(null);
      return;
    }
    if (!navArrowOutline) {
      navArrowOutline = trackMapOverlay(new google.maps.Polyline({ strokeColor: '#0b1216', strokeOpacity: 1, strokeWeight: 13, zIndex: 8, clickable: false }));
      navArrowLine = trackMapOverlay(new google.maps.Polyline({ strokeColor: '#ffffff', strokeOpacity: 1, strokeWeight: 8, zIndex: 9, clickable: false }));
    }
    const path = arrow.path.map((point) => ({ lat: point.lat, lng: point.lon }));
    navArrowOutline.setPath(path);
    navArrowLine.setPath(path);
    navArrowOutline.setMap(map);
    navArrowLine.setMap(map);
  }

  function clearNavigationManeuverArrow() {
    navArrowOutline?.setMap(null);
    navArrowLine?.setMap(null);
    navArrowKey = null;
  }

  function setNavigationTrafficVisible(visible) {
    if (!map || typeof google?.maps?.TrafficLayer !== 'function') return;
    if (!navigationTrafficLayer) navigationTrafficLayer = trackMapOverlay(new google.maps.TrafficLayer());
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
      const distance = formatNavDistance(alert.distanceAheadMeters);
      return `<span class="nav-road-ahead-event" aria-label="${escapeHtml(label)}, ${escapeHtml(distance)} ahead">${hazardNavigationIconMarkup(alert.hazard.type)}<strong>${escapeHtml(distance)}</strong></span>`;
    }).join('')}</span>`;
  }

  function renderNavStep() {
    const step = navSteps[navStepIndex];
    if (!step) return;
    renderNavigationManeuverArrow();
    const upcomingStep = navSteps[navStepIndex + 1];
    applyManeuverIcon(upcomingStep?.maneuver || 'arrive');
    const stepPath = navigationStepPath(step);
    const turnDistance = navCurrentPosition ? remainingDistanceOnPathMeters(navCurrentPosition, stepPath) : step.distance.value;
    $('#navDistanceNext').textContent = formatNavDistance(turnDistance);
    const fullInstruction = upcomingStep
      ? stripHtml(upcomingStep.instructions)
      : `Arrive at ${navDestination?.label || 'destination'}`;
    // As in Google and Apple Maps: the distance, then the road the turn
    // leads onto in large type (the arrow shows the turn). Without a named
    // road, the action and the full instruction show.
    const roadName = upcomingStep ? navigationGuidance.navigationInstructionRoad(fullInstruction) : null;
    const instruction = $('#navInstruction');
    instruction.textContent = roadName || navGlanceAction(upcomingStep?.maneuver || 'arrive');
    instruction.classList.toggle('nav-instruction-road', Boolean(roadName));
    instruction.setAttribute('aria-label', fullInstruction);
    const providerInstruction = $('#navProviderInstruction');
    if (providerInstruction) {
      providerInstruction.textContent = fullInstruction;
      providerInstruction.hidden = Boolean(roadName);
    }
    // Keep the provider-authored next instruction intact. The maneuver glyph
    // supplies the glanceable geometry without reconstructing road metadata.
    const followingStep = navSteps[navStepIndex + 2];
    $('#navNextPreview').hidden = !followingStep;
    if (followingStep) {
      applyManeuverSvg($('#navNextManeuverSvg'), followingStep.maneuver);
      const nextFull = stripHtml(followingStep.instructions);
      const nextInstruction = $('#navNextInstruction');
      nextInstruction.textContent = navigationGuidance.navigationInstructionRoad(nextFull) || nextFull;
      nextInstruction.setAttribute('aria-label', nextFull);
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
    // Navigation keeps the rider's chosen avatar, upright on screen, and adds
    // a cone pointing the way they are travelling (shared
    // navigationPuckConeDegrees): up while the map follows heading-up, turned
    // when the rider has panned or opened the overview.
    const mapHeading = navFollowing && Number.isFinite(navCameraHeading) ? navCameraHeading : map?.getHeading?.();
    const cone = navigationPuck?.navigationPuckConeDegrees(navPuckTravelHeading, mapHeading) ?? null;
    const key = `${state.profile.avatarId}:${cone}`;
    if (userMapMarker.getIcon?.()?.navPuckKey === key) return;
    userMapMarker.setIcon?.(navigationPuckIcon(cone, key));
  }

  function navigationPuckIcon(cone, key) {
    const puck = navigationPuck;
    const box = puck?.PUCK_BOX_SIZE ?? 64;
    const avatarSize = puck?.PUCK_AVATAR_SIZE ?? 64;
    const inset = (box - avatarSize) / 2;
    const avatar = riderAvatarSvg(state.profile.avatarId, { selected: true, mapMarker: false, status: 'none', standalone: true, groupRing: false })
      .replace('<svg ', `<svg x="${inset}" y="${inset}" width="${avatarSize}" height="${avatarSize}" `);
    const centre = box / 2;
    const coneSvg = cone === null || !puck ? '' : `<defs><linearGradient id="navPuckBeam" x1="0" y1="1" x2="0" y2="0"><stop offset=".3" stop-color="${puck.PUCK_CONE_COLOR}" stop-opacity=".5"/><stop offset="1" stop-color="${puck.PUCK_CONE_COLOR}" stop-opacity="0"/></linearGradient></defs><g transform="rotate(${cone} ${centre} ${centre})"><path d="${puck.PUCK_CONE_BEAM_PATH}" fill="url(#navPuckBeam)"/><path d="${puck.PUCK_CONE_ARROW_PATH}" fill="${puck.PUCK_CONE_COLOR}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${coneSvg}${avatar}</svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(box, box),
      anchor: new google.maps.Point(centre, centre),
      navPuckKey: key,
    };
  }

  function stopNavigationCameraAnimation() {
    navCameraAnimationToken += 1;
    if (navCameraAnimationFrame !== undefined) {
      cancelAnimationFrame(navCameraAnimationFrame);
      navCameraAnimationFrame = undefined;
    }
  }

  function animateNavigationCamera(target, durationMs = 500, linear = false) {
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
      const eased = linear ? progress : 1 - ((1 - progress) ** 3);
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

  function applyNavigationCamera(here, step, gpsHeading, speedMps, glideMs = 0) {
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

    if (!navFollowing) {
      updateNavigationPositionIcon();
      return;
    }
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
    // While moving, glide at a steady pace with the puck to its next
    // predicted position; otherwise ease in as before.
    const gliding = glideMs > 0 && movingSpeed !== null && movingSpeed > 1.5;
    const transitionDuration = gliding ? glideMs : movingSpeed !== null && movingSpeed <= 1.5 ? 650 : 500;
    if (!animateNavigationCamera(
      { center: centre, zoom: profile.zoom, heading, tilt: profile.pitch },
      transitionDuration,
      gliding,
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
      navCameraProjectionOverlay = trackMapOverlay(new google.maps.OverlayView());
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
    // Only learn from a settled camera on a visible page: a backgrounded or
    // locked page pauses the animation frames while this timer still fires.
    if (document.hidden || navCameraAnimationFrame !== undefined) return;
    // The layout (rotation, banner height) may have changed since the move.
    const current = navigationViewportOcclusion();
    if (!current
      || Math.abs(current.width - occlusion.width) > 2
      || Math.abs(current.height - occlusion.height) > 2
      || Math.abs(current.top - occlusion.top) > 2
      || Math.abs(current.bottom - occlusion.bottom) > 2) return;
    const point = navigationCameraProjection()?.fromLatLngToContainerPixel?.(new google.maps.LatLng(here.lat, here.lng));
    if (!point || !Number.isFinite(point.y) || !Number.isFinite(point.x)) return;
    // The camera puts the rider straight ahead of centre, so a real
    // projection reports them centred left-to-right. One that ignores the
    // map's rotation doesn't; learning from it would push the rider off
    // the clear band, so skip the sample.
    const sideways = Math.abs(point.x - occlusion.width / 2);
    if (sideways > 4 + 0.1 * Math.abs(point.y - occlusion.height / 2)) return;
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
      positionSpeedMps(latestDevicePosition),
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
          showToast('Couldn’t calculate a route. Try again.');
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
    if (!leg) { showToast('Couldn’t calculate a route. Try again.'); return; }
    stopNavigationCameraAnimation();
    getDirectionsRenderer().setDirections(result);
    navSteps = leg.steps;
    const routePath = combineNavigationCameraPaths(...navSteps.map((step) => navigationStepPath(step)));
    renderNavigationRouteLine(routePath);
    navPuckPath = navigationPuck.buildNavigationPathIndex(routePath.map((point) => ({ lat: point.lat, lon: point.lng })));
    navPuckAlongMeters = null;
    navStepIndex = 0;
    navArrowKey = null;
    navLastAnnouncedStep = -1;
    navPromptTargetIndex = -1;
    navPromptStage = 0;
    navLastNowPromptStep = -1;
    navOffRouteSince = null;
    navFollowing = true;
    // Settings → Voice and sound decides whether a new route starts muted.
    if (!preserveMute) navMuted = state.spokenDirections === false;
    navCurrentPosition = null;
    navCurrentAccuracyMeters = null;
    navCurrentSpeedMps = latestDevicePosition ? positionSpeedMps(latestDevicePosition) : null;
    if (!preserveMute) {
      navCameraHeading = null;
      navTrip = navigationPuck.startNavigationTrip(Date.now());
    }
    navDestination = { ...destination, label };
    hideDestinationCard();
    destinationMarker?.setMap(null);
    destinationMarker = trackMapOverlay(new google.maps.Marker({
      map,
      position: destination,
      title: label ? `Destination: ${label}` : 'Route destination',
      icon: routeFinishIcon(),
      zIndex: 11,
    }));
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
    renderMapChrome();
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
        positionSpeedMps(latestDevicePosition),
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
      // Never a cached fix: a few seconds' old position puts the puck tens
      // of metres behind a moving rider.
      maximumAge: 0,
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
    navCurrentSpeedMps = positionSpeedMps(position);
    renderNavSpeed();
    if (navRerouting) return;
    const raw = { lat: position.coords.latitude, lng: position.coords.longitude };
    if (navTrip) {
      navTrip = navigationPuck.recordNavigationTripFix(navTrip, { lat: raw.lat, lon: raw.lng, accuracyMeters: position.coords.accuracy });
    }
    navCurrentAccuracyMeters = Number.isFinite(position.coords.accuracy)
      ? Number(position.coords.accuracy)
      : null;
    // Snap the fix onto the route and carry it forward by the rider's speed
    // (see shared/src/navigationPuck.ts). Off-route checks keep the raw fix.
    const placed = placeNavigationPuck(position);
    const here = placed.now;
    navCurrentPosition = here;

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
    applyNavigationCamera(placed.target, step, placed.heading, navCurrentSpeedMps, NAV_PUCK_GLIDE_MS);
    checkOffRoute(raw, step, navSteps[navStepIndex + 1], navCurrentAccuracyMeters);
  }

  /** Places the navigation puck for a new fix and returns where it is now
   * and where it will be when the next fix is due. */
  function placeNavigationPuck(position) {
    const coords = position.coords;
    const speed = positionSpeedMps(position);
    const raw = { lat: coords.latitude, lng: coords.longitude };
    if (!navigationPuck || !navPuckPath) {
      userMapMarker?.setPosition?.(raw);
      navPuckTravelHeading = navigationPuck?.navigationPuckTravelHeading(false, null, coords.heading, speed) ?? null;
      return { now: raw, target: raw, heading: coords.heading };
    }
    const nowMs = Date.now();
    const match = navigationPuck.matchFixToPath(navPuckPath, {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracyMeters: coords.accuracy,
      headingDegrees: coords.heading,
      speedMps: speed,
    }, navPuckAlongMeters);
    navPuckAlongMeters = match.distanceAlongMeters;
    const age = navigationPuck.navigationFixAgeSeconds(position.timestamp, nowMs);
    const current = navigationPuck.predictNavigationPuck(navPuckPath, match, speed, age);
    const ahead = navigationPuck.predictNavigationPuck(navPuckPath, match, speed, age + NAV_PUCK_GLIDE_MS / 1000);
    const now = { lat: current.lat, lng: current.lon };
    const target = { lat: ahead.lat, lng: ahead.lon };
    if (userMapMarker) {
      if (!navPuckPlaced) {
        snapMarkerTo('self-nav', userMapMarker, now);
        navPuckPlaced = true;
      }
      glideMarkerTo('self-nav', userMapMarker, target, NAV_PUCK_GLIDE_MS, nowMs);
    }
    // On the route, its direction is steadier than the GPS course.
    const heading = match.snapped && Number.isFinite(ahead.bearingDegrees) ? ahead.bearingDegrees : coords.heading;
    navPuckTravelHeading = navigationPuck.navigationPuckTravelHeading(match.snapped, ahead.bearingDegrees, coords.heading, speed);
    return { now, target, heading };
  }

  /** Off the route for longer than the grace period reroutes. A fix too
   * uncertain to judge (shared navigationRouteStatus) leaves the timer as is. */
  function checkOffRoute(here, step, nextStep, accuracyMeters) {
    const status = navigationPuck.navigationRouteStatus(
      distanceToPathMeters(here, navigationStepPath(step)),
      nextStep ? distanceToPathMeters(here, navigationStepPath(nextStep)) : null,
      accuracyMeters,
    );
    if (status === 'unknown') return;
    if (status === 'off') {
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
          setNavStatusNotice('Couldn’t reroute. Continue with caution.');
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
    const arrival = arrived && navTrip ? {
      label: navDestination?.label || '',
      seconds: navigationPuck.navigationTripSeconds(navTrip, Date.now()),
      distanceMeters: navTrip.distanceMeters,
    } : null;
    navTrip = null;
    stopNavigationCameraAnimation();
    stopNavTracking();
    directionsRenderer?.setMap(null);
    clearNavigationRouteLine();
    destinationMarker?.setMap(null);
    destinationMarker = undefined;
    navSteps = [];
    navPuckPath = null;
    navPuckAlongMeters = null;
    navPuckPlaced = false;
    navPuckTravelHeading = null;
    removeAnimatedMarker('self-nav');
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
    renderMapChrome();
    if (arrived) {
      if (arrival) showArrivalCard(arrival);
      else showToast('You’ve arrived.');
      if (announceArrival) speak('You’ve arrived.');
    }
  }

  /** "You’ve arrived", the place, and the ride's time and distance. */
  function showArrivalCard({ label, seconds, distanceMeters }) {
    const card = $('#destinationCard');
    card.innerHTML = `<div class="destination-card-head"><span class="destination-card-icon" aria-hidden="true"><svg><use href="#i-flag"/></svg></span><div class="rider-card-copy"><strong>You’ve arrived</strong>${label ? `<span>${escapeHtml(label)}</span>` : ''}</div></div><p class="arrival-stats">${escapeHtml(`${formatNavDuration(seconds)} · ${formatNavDistance(distanceMeters)}`)}</p><div class="destination-card-actions"><button type="button" class="destination-primary-action" data-dismiss-arrival><strong>Done</strong></button></div>`;
    card.dataset.arrival = 'true';
    card.setAttribute('role', 'status');
    card.hidden = false;
    $('[data-dismiss-arrival]', card).addEventListener('click', () => {
      hideDestinationCard();
    });
  }

