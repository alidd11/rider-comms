// Part of docs/app.js. 13 of 20: Device position, Ride Safe and ride location sharing. Edit here, then run `npm run build:pwa-app`.
  function usablePublicPresencePosition(position, now = Date.now()) {
    if (!position?.coords) return false;
    const timestamp = Number(position.timestamp);
    const ageMs = now - timestamp;
    const accuracyMeters = Number(position.coords.accuracy);
    return Number.isFinite(position.coords.latitude)
      && Number.isFinite(position.coords.longitude)
      && Number.isFinite(timestamp)
      && Number.isFinite(accuracyMeters)
      && accuracyMeters >= 0
      && accuracyMeters <= MAX_PUBLIC_PRESENCE_ACCURACY_METERS
      && ageMs >= 0
      && ageMs <= MAX_REUSED_PRESENCE_FIX_AGE_MS;
  }

  async function currentPublicPresencePosition() {
    // The high-accuracy movement watcher already owns the map's current fix.
    // Reuse it when it still satisfies the backend's public-presence privacy
    // bounds instead of starting a second iOS geolocation request from the tap.
    if (usablePublicPresencePosition(latestDevicePosition)) return latestDevicePosition;
    return currentPosition();
  }

  function currentPosition({ maximumAge = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
      navigator.geolocation.getCurrentPosition((position) => {
        locationPermissionReady = true;
        applyDevicePosition(position);
        startMovementSafetyTracking();
        resolve(position);
      }, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge });
    });
  }

  let locationPermissionReady = false;

  function applyDevicePosition(position) {
    const lat = position?.coords?.latitude;
    const lng = position?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    latestDevicePosition = position;
    locationPermissionReady = true;
    movementAccessDenied = false;
    // A restored ride may have rendered before the first already-authorised
    // GPS fix. Resume its consented sharing as soon as that fix arrives.
    if (state.activeRide?.shareRideLocation && !rideLocationTimer) syncRideLocationSharing();

    if (!map || usingFallbackMap) return;
    const point = { lat, lng };
    const now = Date.now();
    if (!userMapMarker) {
      userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, point, true);
      snapMarkerTo('self', userMapMarker, point);
    } else if (navSteps.length) {
      // Turn-by-turn navigation already owns the marker's position via its
      // own, more frequent watchPosition subscription (handleNavPosition),
      // tightly coupled to the adaptive nav camera -- this movement-safety
      // watcher keeps running in the background regardless of nav mode, so
      // it must not also drive the marker or the two would fight over its
      // position every animation frame.
      removeAnimatedMarker('self');
    } else {
      // watchPosition fires irregularly rather than on a fixed interval, so
      // the glide duration adapts to how long it's actually been since the
      // last fix (clamped so a long gap doesn't produce a slow-motion catch-
      // up, and a burst of fast fixes doesn't produce a near-instant snap).
      const durationMs = Number.isFinite(lastSelfDeviceFixAtMs)
        ? Math.min(3000, Math.max(300, now - lastSelfDeviceFixAtMs))
        : 300;
      glideMarkerTo('self', userMapMarker, point, durationMs, now);
    }
    lastSelfDeviceFixAtMs = now;

    if (!mapCentredOnLiveLocation) {
      map.panTo(point);
      map.setZoom(15);
      mapCentredOnLiveLocation = true;
    }
  }

  function movementFix(position) {
    return {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      timestampMs: position.timestamp || Date.now(),
      accuracyMeters: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
      ...(position.coords.speed == null ? {} : { speedMps: position.coords.speed }),
    };
  }

  function applyMovementState(nextState) {
    movementState = nextState;
    const locked = state.rideSafeEnabled && window.RiderMovementSafety.isLockedForSafety(nextState);
    const warning = state.rideSafeEnabled && nextState === 'unknown';
    $('#app')?.classList.toggle('safety-locked', locked);
    const banner = $('#movementSafetyBanner');
    if (banner) banner.hidden = !(locked || warning);
    const message = $('#movementSafetyMessage');
    if (message) message.textContent = nextState === 'moving'
      ? 'Distracting controls are locked until you are safely below 8 mph.'
      : 'Waiting for a reliable speed fix. Controls stay available.';
    const enableButton = $('#enableLocationBtn');
    if (enableButton) {
      // A missing speed fix does not mean location permission is missing.
      enableButton.hidden = !warning || (!movementAccessDenied && (locationPermissionReady || movementPermissionStatus?.state === 'granted'));
      enableButton.textContent = movementAccessDenied || movementPermissionStatus?.state === 'denied' ? 'Location help' : 'Enable location';
    }
    $$('[data-nav="routes"], [data-nav="friends"], [data-nav="settings"]').forEach((item) => {
      item.setAttribute('aria-disabled', String(locked));
      item.classList.toggle('safety-unavailable', locked);
    });
    $$('#mapSearchSlot, #mapAvatarButton, #poiChipRow, #reportHazardBtn, #riderCard, #hazardCard, #rideJoinState, #shareRideBtn, .ride-code-card, #rideRoster, #openRideMap').forEach((item) => {
      item.toggleAttribute('inert', locked);
      item.setAttribute('aria-disabled', String(locked));
    });
    renderMapStatus();
    if (locked && !['map', 'ride'].includes(state.screen)) navigate(state.activeRide ? 'ride' : 'map', false);
    if (locked && activeChat) closeChat({ restoreFocus: false });
  }

  function stopMovementSafetyTracking() {
    if (movementWatchId !== undefined) navigator.geolocation?.clearWatch(movementWatchId);
    movementWatchId = undefined;
    clearInterval(movementFreshnessTimer);
    movementFreshnessTimer = undefined;
    applyMovementState(movementTracker.markUnavailable());
  }

  function startMovementSafetyTracking() {
    if (!state.rideSafeEnabled || !navigator.geolocation || movementWatchId !== undefined || document.visibilityState !== 'visible') return;
    movementWatchId = navigator.geolocation.watchPosition(
      (position) => {
        applyDevicePosition(position);
        applyMovementState(movementTracker.addFix(movementFix(position)));
      },
      (error) => {
        if (error.code === 1) {
          movementAccessDenied = true;
          locationPermissionReady = false;
          stopMovementSafetyTracking();
        } else {
          // TIMEOUT/POSITION_UNAVAILABLE are recoverable watch errors. Keep
          // the subscription so the next valid fix can recover without a tap.
          applyMovementState(movementTracker.stateAt(Date.now()));
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    movementFreshnessTimer = setInterval(() => applyMovementState(movementTracker.stateAt(Date.now())), 2000);
  }

  async function initialiseMovementSafety() {
    if (!state.rideSafeEnabled) {
      stopMovementSafetyTracking();
      return;
    }
    applyMovementState(movementTracker.stateAt(Date.now()));
    try {
      const permission = await navigator.permissions?.query?.({ name: 'geolocation' });
      if (permission?.state === 'granted' || (!permission && locationPermissionReady)) startMovementSafetyTracking();
      if (permission && permission !== movementPermissionStatus) permission.addEventListener('change', () => {
        movementAccessDenied = permission.state === 'denied';
        if (permission.state === 'granted') startMovementSafetyTracking();
        else {
          locationPermissionReady = false;
          stopMovementSafetyTracking();
        }
      });
      movementPermissionStatus = permission;
      movementAccessDenied = permission?.state === 'denied';
      applyMovementState(movementState);
    } catch {
      // Some browsers expose geolocation without the Permissions API.
      // Resume only after an actual successful location request in this session.
      if (locationPermissionReady) startMovementSafetyTracking();
    }
  }

  async function requestMovementLocationAccess() {
    try {
      const position = await currentPosition();
      applyMovementState(movementTracker.addFix(movementFix(position)));
      showToast('Location enabled. Controls stay available until sustained movement at 8 mph.');
    } catch (error) {
      showToast(locationAccessMessage(error, 'enable ride-safe controls'));
    }
  }

  function locationAccessMessage(error, purpose = 'use your location') {
    if (!navigator.geolocation) return 'Location is not supported by this browser.';
    if (error?.code === 1 || error?.name === 'NotAllowedError') {
      // An installed iOS PWA holds its OWN location permission, separate
      // from Safari's -- granting it in one never carries over to the
      // other. Pointing a standalone user at "Safari > Location" sends
      // them to a setting that can't fix this, so the two modes need
      // different instructions here.
      const isStandalone = document.documentElement.classList.contains('pwa-standalone');
      return isStandalone
        ? `Location access is blocked for the installed app. To ${purpose}, allow it in Settings → Rider Comms → Location (or Settings → Privacy & Security → Location Services if it's off entirely).`
        : `Location access is blocked. To ${purpose}, allow it in Settings → Safari → Location, or tap the "AA" icon in the address bar → Website Settings → Location.`;
    }
    if (error?.code === 2) return 'Your location is unavailable right now. Check location services and try again.';
    if (error?.code === 3) return 'Finding your location took too long. Try again in a clearer area.';
    return `Could not access your location to ${purpose}.`;
  }

  async function preflightRideLocationAccess() {
    if (locationPermissionReady) return true;
    try {
      await currentPosition();
      return true;
    } catch (error) {
      showToast(locationAccessMessage(error, 'share your position with your private ride'));
      return false;
    }
  }

  const RIDE_LOCATION_REFRESH_MS = 10_000; // same 5-10s cadence as public presence (see PRESENCE_REFRESH_MS)
  const RIDE_AVATAR_REFRESH_MS = 30_000;
  let rideLocationTimer;
  let lastRideAvatarRefreshAt = 0;
  // Three missed ticks (~30 s) without reaching the backend means group
  // positions on the map are going out of date; say so once, not per tick.
  const RIDE_UNREACHABLE_TICKS = 3;
  let rideUnreachableTicks = 0;

  async function setRideLocationSharing(enabled) {
    const ride = state.activeRide;
    if (!ride) return false;
    const toggle = $('#activeRideLocationConsent');
    toggle.disabled = true;
    try {
      if (enabled && !(await preflightRideLocationAccess())) {
        renderRide();
        return false;
      }
      await apiFetch('PUT', `/rides/${encodeURIComponent(ride.rideId)}/location-sharing`, { enabled });
      if (!state.activeRide || state.activeRide.rideId !== ride.rideId) return false;
      state.activeRide.shareRideLocation = enabled;
      if (!enabled) rideMemberLocations.delete(state.profile.riderId);
      persist();
      renderRide();
      showToast(enabled ? 'Live location is shared with this ride.' : 'Ride location sharing is off and your saved position was removed.');
      return true;
    } catch {
      renderRide();
      showToast('Could not update ride location sharing. Try again.');
      return false;
    } finally {
      toggle.disabled = false;
    }
  }

  /**
   * Keeps this rider's own location POST-ed to the active ride
   * (POST /rides/:id/location) and every member's real location fetched
   * (GET /rides/:id/locations) for as long as a ride is active — this is
   * only after explicit per-ride consent, unlike public presence, which is
   * gated on profile.shareLocation. Called
   * from renderRide(), which already runs after every ride-state change
   * (create, join, end, refreshActiveRide, and once on app start), so
   * there's one place that starts/stops this rather than a call at every
   * site that sets or clears state.activeRide.
   */
  function syncRideLocationSharing() {
    if (state.activeRide?.shareRideLocation === true) {
      // Never trigger a permission prompt during app boot or a restored
      // session. Existing Create/Join and map actions establish consent;
      // background refresh only continues an approved location flow.
      if (!locationPermissionReady) return;
      if (rideLocationTimer) return;
      const tick = async () => {
        const ride = state.activeRide;
        if (!ride) return;
        try {
          const position = await currentPosition();
          if (state.activeRide?.rideId !== ride.rideId || !state.activeRide.shareRideLocation || !session) return;
          await apiFetch('POST', `/rides/${encodeURIComponent(ride.rideId)}/location`, {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
          const { locations } = await apiFetch('GET', `/rides/${encodeURIComponent(ride.rideId)}/locations`);
          if (state.activeRide?.rideId !== ride.rideId || !state.activeRide.shareRideLocation || !session) return;
          rideMemberLocations = new Map(locations.map((entry) => [entry.riderId, entry]));
          if (rideUnreachableTicks >= RIDE_UNREACHABLE_TICKS) showToast('Reconnected. Group positions are live again.');
          rideUnreachableTicks = 0;
          if (state.activeRide) {
            renderMapRiders();
            const now = Date.now();
            if (now - lastRideAvatarRefreshAt >= RIDE_AVATAR_REFRESH_MS) {
              lastRideAvatarRefreshAt = now;
              void loadRideRoster();
            }
          }
        } catch (error) {
          // Best-effort, same as the public presence refresh above — a
          // missed tick (denied permission, a transient network blip)
          // just tries again next interval rather than surfacing an error
          // banner over the whole ride. The markers are still re-rendered
          // so riders whose last fix has aged out turn grey instead of
          // looking live while the backend is unreachable.
          if (state.activeRide) renderMapRiders();
          const unreachable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
          if (!unreachable) return;
          rideUnreachableTicks += 1;
          if (rideUnreachableTicks === RIDE_UNREACHABLE_TICKS) {
            showToast("Can't reach Rider Comms. Group positions may be out of date; voice keeps working if it's connected.");
          }
        }
      };
      rideLocationTimer = setInterval(tick, RIDE_LOCATION_REFRESH_MS);
      void tick();
    } else {
      if (rideLocationTimer) clearInterval(rideLocationTimer);
      rideLocationTimer = undefined;
      lastRideAvatarRefreshAt = 0;
      rideUnreachableTicks = 0;
      if (!state.activeRide) rideMemberLocations = new Map();
    }
  }

