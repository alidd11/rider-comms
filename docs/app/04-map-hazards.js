// Part of docs/app.js. 4 of 20: Map markers and hazard reports. Edit here, then run `npm run build:pwa-app`.
  function renderFallbackMarkers() {
    const layer = $('#fallbackMarkers');
    layer.innerHTML = '';
  }

  function pinIcon(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.1 1 14.6 1 23.6 15 39 15 39s14-15.4 14-24.4C29 7.1 22.7 1 15 1Z" fill="${color}" stroke="#0a0f14" stroke-width="2"/></svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(30, 40),
      anchor: new google.maps.Point(15, 38),
    };
  }

  function routeFinishIcon() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="48" viewBox="0 0 44 48">
      <circle cx="22" cy="21" r="18" fill="#2fa8d3" stroke="#071015" stroke-width="3"/>
      <path d="M15 34V10m0 2h16l-4 5 4 5H15" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M17 12h4v4h-4zm8 0h4v4h-4zm-4 4h4v4h-4zm8 0h2l-2 4h-4v-4z" fill="#fff"/>
    </svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(44, 48),
      anchor: new google.maps.Point(22, 43),
    };
  }

  function addHazardMapMarker(hazard) {
    const meta = HAZARD_TYPES[hazard.type];
    const marker = new google.maps.Marker({
      map,
      position: { lat: hazard.lat, lng: hazard.lon },
      title: meta.label,
      icon: hazardPinIcon(hazard.type),
      zIndex: 6,
    });
    marker.addListener('click', () => selectHazard(hazard.id));
    return { id: hazard.id, type: hazard.type, marker };
  }

  function setHazardMarkerSelection(hazardId = null) {
    mapHazardMarkers.forEach((entry) => {
      entry.marker.setIcon(hazardPinIcon(entry.type, entry.id === hazardId));
      // The rider's own marker is z-index 10. A selected/newly-reported
      // hazard may share that exact GPS coordinate, so keep it visible above
      // the avatar without changing or inventing its authoritative location.
      entry.marker.setZIndex(entry.id === hazardId ? 12 : 6);
    });
  }

  function visibleHazardsForMap() {
    if (!navSteps.length) return nearbyHazards;
    if (!navCurrentPosition || navGpsIssue) return [];
    const visibleIds = new Set(navigationHazardsAhead(
      navCurrentPosition,
      navigationRemainingRoutePath(),
      nearbyHazards,
      { currentAccuracyMeters: navCurrentAccuracyMeters },
    ).map((alert) => alert.hazard.id));
    return nearbyHazards.filter((hazard) => visibleIds.has(hazard.id));
  }

  function renderMapHazards(force = false) {
    if (!map || usingFallbackMap) return;
    const visibleHazards = visibleHazardsForMap();
    const signature = visibleHazards.map((hazard) => hazard.id).join('|');
    if (!force && signature === mapHazardMarkerSignature) return;
    mapHazardMarkers.forEach((entry) => entry.marker.setMap(null));
    mapHazardMarkers = visibleHazards.map((hazard) => addHazardMapMarker(hazard));
    mapHazardMarkerSignature = signature;
  }

  function renderHazardMarkers() {
    const layer = $('#hazardMarkers');
    // The static fallback cannot project coordinates accurately. Showing
    // decorative offsets would misrepresent a report's real direction, so
    // only the real Google map renders hazards and rider positions.
    layer.innerHTML = '';
    renderMapHazards();
  }

  /** "5m ago" / "2h ago" — Waze shows a report's age so riders can judge
   * for themselves whether it's likely still current, on top of the real
   * TTL/crowd-hiding that removes it server-side regardless (see
   * ttlMsForType/shouldHide in shared/src/hazards.ts). */
  function timeAgo(timestampMs) {
    const minutes = Math.max(0, Math.round((Date.now() - timestampMs) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
  }

  function selectHazard(hazardId) {
    const hazard = nearbyHazards.find((h) => h.id === hazardId);
    const card = $('#hazardCard');
    if (!hazard) { card.hidden = true; setHazardMarkerSelection(); return; }
    const meta = HAZARD_TYPES[hazard.type];
    hideDestinationCard();
    setHazardMarkerSelection(hazard.id);
    card.innerHTML = `
      <div class="hazard-card-head">
        <span class="hazard-card-art" aria-hidden="true">${hazardIconMarkup(hazard.type)}</span>
        <div class="hazard-card-copy">
          <strong>${escapeHtml(meta.label)}</strong>
          <span>Reported ${timeAgo(hazard.createdAt)}</span>
        </div>
        <button class="hazard-card-dismiss" aria-label="Dismiss road report" data-dismiss-hazard>×</button>
      </div>
      <div class="hazard-vote-row" aria-label="Road report status">
        <button class="hazard-vote-button hazard-vote-confirm" data-vote="confirm" aria-label="Still there, ${hazard.confirmations} confirmations">
          <span class="hazard-vote-label">Still there</span>
          <span class="hazard-vote-count">${hazard.confirmations}</span>
        </button>
        <button class="hazard-vote-button hazard-vote-deny" data-vote="deny" aria-label="Gone, ${hazard.denials} reports">
          <span class="hazard-vote-label">Gone</span>
          <span class="hazard-vote-count">${hazard.denials}</span>
        </button>
      </div>`;
    card.hidden = false;
    $('[data-vote="confirm"]', card).addEventListener('click', () => voteHazard(hazardId, 'confirm'));
    $('[data-vote="deny"]', card).addEventListener('click', () => voteHazard(hazardId, 'deny'));
    $('[data-dismiss-hazard]', card).addEventListener('click', () => { card.hidden = true; setHazardMarkerSelection(); });
  }

  /** Real confirm/deny voting (POST /hazards/:id/confirm or /deny) — the
   * backend only returns {} on success, so the local count is bumped
   * optimistically rather than re-fetching the whole nearby list. A 404
   * means the report already expired or was hidden by other riders'
   * denials since this card was opened, so it's dropped locally too. */
  async function voteHazard(hazardId, direction) {
    try {
      await apiFetch('POST', `/hazards/${encodeURIComponent(hazardId)}/${direction}`, {});
      const hazard = nearbyHazards.find((h) => h.id === hazardId);
      if (hazard) { if (direction === 'confirm') hazard.confirmations += 1; else hazard.denials += 1; }
      $('#hazardCard').hidden = true;
      renderHazardMarkers();
      showToast(direction === 'confirm' ? 'Thanks — marked as still there.' : 'Thanks — we’ll clear it once a few riders agree.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      if (code === 'not_found') {
        nearbyHazards = nearbyHazards.filter((h) => h.id !== hazardId);
        $('#hazardCard').hidden = true;
        renderHazardMarkers();
        showToast('That report is no longer active.');
      } else if (code === 'email_verification_required') {
        showToast(HAZARD_EMAIL_VERIFICATION_MESSAGE);
      } else {
        showToast('Could not record your vote. Try again.');
      }
    }
  }

  /** Fetches real nearby hazard reports (GET /hazards/nearby) for the given
   * position. A transient failure leaves the previously-loaded list showing
   * rather than clearing it. */
  async function loadNearbyHazards(lat, lon) {
    try {
      const result = await apiFetch('GET', `/hazards/nearby?lat=${lat}&lon=${lon}`);
      nearbyHazards = result.hazards;
    } catch {
      // keep whatever was last loaded
    }
    renderHazardMarkers();
    if (navSteps.length) renderNavigationRoadAhead();
  }

  /** Refreshes nearbyHazards for the rider's real current position, falling
   * back to the map's centre (or a default London-ish coordinate on the
   * fallback map) when location access isn't available — same fallback
   * convention the rest of the map screen already uses. */
  async function refreshNearbyHazards() {
    let lat, lon;
    try {
      const position = await currentPosition();
      lat = position.coords.latitude;
      lon = position.coords.longitude;
    } catch {
      const centre = map ? map.getCenter()?.toJSON() : null;
      lat = centre?.lat ?? 51.564;
      lon = centre?.lng ?? -0.106;
    }
    await loadNearbyHazards(lat, lon);
  }

  const HAZARD_REFRESH_MS = 60_000; // hazards live 1-8h (ttlMsForType) or get crowd-hidden — no need for presence's 8-10s cadence, just a periodic notice that one's gone
  let hazardRefreshTimer;

  /**
   * Without this, a hazard that expired or got crowd-denied server-side
   * kept showing on the map indefinitely — nearbyHazards was only ever
   * (re)fetched on first opening the Map tab, never again while parked on
   * it, so a report could never visibly "disappear" no matter what
   * happened server-side. Started/stopped alongside the Map screen the
   * same way syncRideLocationSharing tracks state.activeRide.
   */
  function syncHazardRefresh(active) {
    if (active) {
      if (hazardRefreshTimer) return;
      hazardRefreshTimer = setInterval(refreshNearbyHazards, HAZARD_REFRESH_MS);
    } else if (hazardRefreshTimer) {
      clearInterval(hazardRefreshTimer);
      hazardRefreshTimer = undefined;
    }
  }

  const HAZARD_EMAIL_VERIFICATION_MESSAGE = 'Verify your email in Settings → Account → Edit profile to report or confirm road hazards.';
  const HAZARD_ERROR_MESSAGES = {
    email_verification_required: HAZARD_EMAIL_VERIFICATION_MESSAGE,
    rate_limited: 'Too many reports — please wait a few minutes and try again.',
  };

  /** Reports a real hazard (POST /hazards) at the rider's live GPS
   * position — reuses currentPosition(), the same geolocation helper the
   * locate/go-live buttons use. The backend requires a real coordinate, so
   * a report is never sent (or shown as if it landed) without one. */
  async function createHazard(type, chips) {
    const errorEl = $('#hazardFormError');
    if (errorEl) errorEl.hidden = true;
    let reportPosition = pendingHazardReportPosition;
    if (!reportPosition) {
      try {
        reportPosition = hazardReportPosition(await currentPosition());
      } catch (error) {
        if (errorEl) { errorEl.textContent = locationAccessMessage(error, 'report a hazard'); errorEl.hidden = false; }
        return;
      }
    }
    if (!reportPosition) {
      if (errorEl) { errorEl.textContent = 'Rider Comms could not get a valid location for that report.'; errorEl.hidden = false; }
      return;
    }
    chips?.forEach((chip) => { chip.disabled = true; });
    try {
      const hazard = await apiFetch('POST', '/hazards', { type, lat: reportPosition.lat, lon: reportPosition.lon });
      pendingHazardReportPosition = null;
      nearbyHazards = [hazard, ...nearbyHazards.filter((entry) => entry.id !== hazard.id)];
      renderHazardMarkers();
      closeSheet();
      selectHazard(hazard.id);
      showToast(`${HAZARD_TYPES[type].label} reported.`);
      await loadNearbyHazards(hazard.lat, hazard.lon);
      if (nearbyHazards.some((entry) => entry.id === hazard.id)) selectHazard(hazard.id);
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      if (errorEl) { errorEl.textContent = HAZARD_ERROR_MESSAGES[code] || 'Could not report that hazard. Try again.'; errorEl.hidden = false; }
    } finally {
      chips?.forEach((chip) => { chip.disabled = false; });
    }
  }

