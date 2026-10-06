// Part of docs/app.js. 15 of 20: Destination card and external navigation handoff. Edit here, then run `npm run build:pwa-app`.
  /**
   * Build the external-navigation URL for the rider's selected provider.
   * Rider Comms itself owns the in-app turn-by-turn path; this helper is
   * only for Google Maps, Waze and Apple Maps handoff when the rider has
   * selected an external provider in Settings.
   */
  function navigationHref(provider, lat, lng, label) {
    const coordinate = `${lat},${lng}`;
    if (provider === 'google_maps') {
      const params = new URLSearchParams({ api: '1', destination: coordinate, travelmode: 'driving' });
      return `https://www.google.com/maps/dir/?${params}`;
    }
    if (provider === 'waze') {
      const params = new URLSearchParams({ ll: coordinate, navigate: 'yes' });
      return `https://www.waze.com/ul?${params}`;
    }
    if (provider === 'apple_maps') {
      const params = new URLSearchParams({ daddr: coordinate, q: label || coordinate, dirflg: 'd' });
      return `https://maps.apple.com/?${params}`;
    }
    return null;
  }

  function hideDestinationCard() {
    $('#destinationCard').hidden = true;
  }

  function showDestinationCard(location, label, address) {
    $('#riderCard').hidden = true;
    $('#hazardCard').hidden = true;
    const lat = location.lat();
    const lng = location.lng();
    const card = $('#destinationCard');
    const secondary = address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const provider = navigationProvider(state.navigationProvider);
    const providerInfo = NAVIGATION_PROVIDERS[provider];
    const providerCaption = provider === 'in_app' ? 'In Rider Comms' : `Open in ${providerInfo.label}`;
    const action = provider === 'in_app'
      ? `<button class="destination-primary-action" data-start-in-app-navigation aria-label="Start route in Rider Comms"><svg><use href="#i-nav-arrow"/></svg><span><strong>Start route</strong><small>In Rider Comms</small></span></button>`
      : `<a class="destination-primary-action" href="${navigationHref(provider, lat, lng, label)}" target="_blank" rel="noopener noreferrer" aria-label="Start route in ${escapeHtml(providerInfo.label)}"><svg><use href="#i-nav-arrow"/></svg><span><strong>Start route</strong><small>${escapeHtml(providerCaption)}</small></span></a>`;
    card.innerHTML = `<div class="destination-card-head"><span class="destination-card-icon" aria-hidden="true"><svg><use href="#i-location"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(label || 'Selected place')}</strong><span>${escapeHtml(secondary)}</span></div><button class="destination-card-dismiss" aria-label="Dismiss destination" data-dismiss-destination>×</button></div><div class="destination-card-eta" data-destination-eta><svg aria-hidden="true"><use href="#i-route"/></svg><span>Calculating route…</span></div><div class="destination-card-actions">${action}</div>`;
    card.hidden = false;
    $('[data-start-in-app-navigation]', card)?.addEventListener('click', () => void startInAppNavigation(location, label));
    $('[data-dismiss-destination]', card).addEventListener('click', () => {
      hideDestinationCard();
      destinationMarker?.setMap(null);
      destinationMarker = undefined;
    });
    void updateDestinationEta(location);
  }

  // A rider picking a destination could not previously tell how far or how
  // long the drive was until after committing to "Start route" -- fetch a
  // quick driving-time estimate for the card itself so that decision can be
  // made up front, same as Google/Waze/Apple Maps' own place cards. Guarded
  // by a token since the card's destination can change (or be dismissed)
  // while this request is still in flight.
  let destinationEtaToken = 0;
  async function updateDestinationEta(location) {
    const token = ++destinationEtaToken;
    let position;
    try {
      position = await currentPosition();
    } catch {
      if (token === destinationEtaToken) $('#destinationCard [data-destination-eta]')?.setAttribute('hidden', '');
      return;
    }
    if (token !== destinationEtaToken) return;
    if (typeof google?.maps?.DirectionsService !== 'function') {
      $('#destinationCard [data-destination-eta]')?.setAttribute('hidden', '');
      return;
    }
    const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
    const destination = { lat: location.lat(), lng: location.lng() };
    getDirectionsService().route(
      navigationRouteRequest(origin, destination),
      (result, status) => {
        if (token !== destinationEtaToken) return;
        const etaEl = $('#destinationCard [data-destination-eta]');
        if (!etaEl) return;
        const leg = status === 'OK' ? result?.routes[0]?.legs[0] : null;
        if (!leg) { etaEl.setAttribute('hidden', ''); return; }
        etaEl.querySelector('span').textContent = `${formatNavDistance(leg.distance.value)} · ${formatNavDuration(leg.duration.value)}`;
        etaEl.removeAttribute('hidden');
      }
    );
  }

  function setDestinationMarker(location, label, address) {
    destinationMarker?.setMap(null);
    destinationMarker = new google.maps.Marker({
      map,
      position: location,
      title: label || 'Selected place',
      icon: pinIcon('#2fa8d3'),
      animation: google.maps.Animation.DROP,
      zIndex: 9,
    });
    destinationMarker.addListener('click', () => showDestinationCard(location, label, address));
    showDestinationCard(location, label, address);
  }

  // Rider Comms guidance is opt-in through Settings. It remains a development
  // navigation surface until physical-route, backgrounding and reroute tuning
  // are validated, while riders can always choose an external provider.
  let directionsService;
  let directionsRenderer;
  // DirectionsRenderer draws only a single flat polyline -- against some
  // basemap colours (especially water/park tints near its own blue) that
  // reads as barely-there. Real nav apps give the route line a darker
  // outline so it stays legible over anything underneath; suppress the
  // renderer's own line (see getDirectionsRenderer) and draw that
  // outline+inner pair ourselves instead, same two colours/widths the
  // native app already uses.
  let navRouteOutline;
  let navRouteLine;
  let navSteps = [];
  let navStepIndex = 0;
  let navWatchId;
  let navDestination = null; // { lat, lng, label }
  let navLastAnnouncedStep = -1;
  let navPromptTargetIndex = -1;
  let navPromptStage = 0;
  let navLastNowPromptStep = -1;
  let navOffRouteSince = null;
  let navRerouting = false;
  let navFollowing = true;
  let navMuted = false;
  let navCurrentPosition = null;
  let navCurrentAccuracyMeters = null;
  let navCurrentSpeedMps = null;
  let navCameraHeading = null;
  let navCameraAnimationFrame;
  let navCameraAnimationToken = 0;
  // Learned per device: how far the map's real perspective is from the
  // shared camera model. See measureNavigationCameraFit.
  let navCameraCorrection = 1;
  let navCameraFitTimer;
  let navCameraProjectionOverlay = null;
  let navGpsWatchdog;
  let navLastFixAt = 0;
  let navGpsIssue = null;
  let navStatusNotice = null;

  const NAV_STEP_ARRIVAL_RADIUS_M = 30;
  const NAV_OFF_ROUTE_RADIUS_M = 60;
  const NAV_OFF_ROUTE_GRACE_MS = 10_000;
  const NAV_GPS_STALE_MS = 12_000;
  const NAV_GPS_CHECK_MS = 2_000;
  const NAV_GPS_STALE_NOTICE = 'GPS signal lost. Keep following the route with caution.';
  const NAV_GPS_UNAVAILABLE_NOTICE = 'Live GPS tracking is unavailable. Keep following the route with caution.';
  const NAV_GPS_PERMISSION_NOTICE = 'Location access was removed. Navigation is paused until location access is restored.';

