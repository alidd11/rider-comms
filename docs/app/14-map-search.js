// Part of docs/app.js. 14 of 20: Map loading, place search and nearby POIs. Edit here, then run `npm run build:pwa-app`.
  async function locate() {
    try {
      const position = await currentPosition();
      centreMap(position.coords.latitude, position.coords.longitude);
      syncRideLocationSharing();
    } catch (error) {
      showToast(locationAccessMessage(error, 'centre the map'));
    }
  }

  function centreMap(lat, lng) {
    if (map) {
      if (navSteps.length) {
        navFollowing = true;
        navCurrentPosition = { lat, lng };
        userMapMarker?.setPosition({ lat, lng });
        updateNavigationControls();
        applyNavigationCamera({ lat, lng }, navSteps[navStepIndex]);
        return;
      }
      map.panTo({ lat, lng });
      map.setZoom(15);
      userMapMarker?.setPosition({ lat, lng });
    }
  }

  // Same camera move as centreMap, but for panning to a searched
  // destination rather than the rider's own GPS fix — must not drag the
  // "you are here" marker onto the place being looked up.
  function panToPlace(lat, lng) {
    if (map) {
      map.panTo({ lat, lng });
      map.setZoom(15);
    }
  }

  // Fires for failures the script tag's own onerror can't see: the script
  // loads fine, but the key is rejected at request time (bad referrer
  // restriction, billing disabled, quota exceeded, revoked key). Without
  // this, Google's own full-canvas "Sorry! Something went wrong" error UI
  // silently takes over #googleMap while the rest of the app still thinks
  // the real map is up and running (usingFallbackMap stays false, the
  // fallback layers stay hidden) — this is the officially documented hook
  // for exactly that case (window.gm_authFailure).
  function handleGoogleMapsFailure() {
    usingFallbackMap = true;
    $('#googleMap').hidden = true;
    $('#fallbackMap').hidden = false;
    $('#fallbackMarkers').hidden = false;
    $('#hazardMarkers').hidden = false;
    $('#mapError').hidden = false;
    disablePlaceSearch();
    renderMapStatus();
  }
  window.gm_authFailure = handleGoogleMapsFailure;

  // The Google Maps key used to be baked into docs/config.js at GitHub
  // Pages deploy time from a repo secret — but that path proved unreliable
  // (the secret didn't reliably survive/apply across deploys). The backend
  // now serves it at runtime from a Railway env var instead, which is
  // simpler to keep in sync since it's set directly on the running service
  // rather than baked into a static build. docs/config.js's static value
  // (if ever populated again) is still checked first so this still works
  // offline-first / without a network round trip when it's present.
  // (API_BASE_URL itself is defined once, near the top of this file, and
  // reused by every real backend call, not just this one.)
  async function loadGoogleMaps() {
    let key = window.RIDER_COMMS_CONFIG?.googleMapsApiKey;
    if (!key) {
      try {
        const response = await fetch(`${API_BASE_URL}/config`);
        if (response.ok) key = (await response.json())?.googleMapsApiKey;
      } catch (error) {
        console.warn('[rider-comms] Could not reach the backend for /config', error);
      }
    }
    if (!key) {
      // Skip the network request entirely rather than firing one that's
      // doomed to fail — and log loudly, since this is otherwise silent:
      // the app just quietly sits on the CSS fallback map forever with no
      // trace of why. This fires on every load whose backend GOOGLE_MAPS_API_KEY
      // env var is unset, not just occasional outages, so it needs to be
      // loud and specific.
      console.warn('[rider-comms] Google Maps API key missing (neither RIDER_COMMS_CONFIG nor the backend /config endpoint has one) — falling back to the offline map.');
      $('#mapError').hidden = true;
      renderMapStatus();
      disablePlaceSearch();
      return;
    }
    window.__riderCommsMapReady = initialiseGoogleMap;
    const script = document.createElement('script');
    // `libraries=places` is required for the search bar's Autocomplete
    // below — it shares this same browser-restricted key (see
    // RIDER_COMMS_CONFIG's own comment), no separate Places key needed.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__riderCommsMapReady&v=weekly`;
    script.async = true;
    script.onerror = handleGoogleMapsFailure;
    document.head.appendChild(script);
  }

  function disablePlaceSearch() {
    const input = $('#placeSearchInput');
    input.disabled = true;
    input.placeholder = 'Search unavailable right now';
    $('#mapSearchSlot')?.classList.add('offline');
    // The POI chips call the real Places JS API directly (nearbySearch) —
    // with no Google Maps loaded there's no Places library either, so
    // they'd just be dead buttons rather than a working offline feature.
    $('#poiChipRow').hidden = true;
  }

  // Google's own Autocomplete widget renders as an unstyled white dropdown
  // that can't be themed — it just gets bolted onto the page over whatever
  // it's anchored to. This full-screen search page instead drives the same
  // Places data (AutocompleteService for predictions, PlacesService for the
  // chosen place's coordinates) but renders every row itself, so it matches
  // the rest of the app instead of looking like a different product bolted
  // onto this one.
  let autocompleteService;
  let searchSessionToken;
  let searchDebounceTimer;
  let searchRequestToken = 0;
  let searchScreenPosition;
  let activePoiType;
  let nearbySearchResults = [];

  // Recent-place shortcuts (the usual map-app pattern: the empty search
  // screen shows where you've been, not a blank page) — kept client-side
  // only, newest first, deduped by placeId, capped so the list stays a
  // quick glance rather than a scrollable history.
  const RECENT_SEARCHES_KEY = 'riderComms.recentSearches';
  const RECENT_SEARCHES_MAX = 6;
  const recentSearchesStorageKey = () => session?.riderId ? `${RECENT_SEARCHES_KEY}:${session.riderId}` : null;

  function loadRecentSearches() {
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
      const key = recentSearchesStorageKey();
      if (!key) return [];
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveRecentSearch(entry) {
    try {
      const key = recentSearchesStorageKey();
      if (!key) return;
      const existing = loadRecentSearches().filter((item) => item.placeId !== entry.placeId);
      localStorage.setItem(key, JSON.stringify([entry, ...existing].slice(0, RECENT_SEARCHES_MAX)));
    } catch {
      // Private-mode/quota storage failures just mean no recent list — not fatal.
    }
  }

  function clearRecentSearches() {
    try {
      const key = recentSearchesStorageKey();
      if (key) localStorage.removeItem(key);
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch { /* ignore */ }
    renderRecentOrHint();
  }

  // Home and Work: one tap away in the drawer, kept on this device for this
  // rider like recent searches (native: @rider-comms/saved-places).
  const SAVED_PLACES_KEY = 'riderComms.savedPlaces';
  const SAVED_PLACE_LABELS = { home: 'Home', work: 'Work' };
  const savedPlacesStorageKey = () => session?.riderId ? `${SAVED_PLACES_KEY}:${session.riderId}` : null;
  // The slot search is choosing a place for, if any.
  let savingPlaceSlot = null;
  // Search opened from Settings saves the place without touching the map,
  // then returns to that Settings page.
  let savingFromSettingsPage = null;

  function validSavedPlace(entry) {
    return entry && typeof entry.placeId === 'string' && typeof entry.name === 'string'
      && Number.isFinite(entry.lat) && Math.abs(entry.lat) <= 90 && Number.isFinite(entry.lng) && Math.abs(entry.lng) <= 180;
  }

  function loadSavedPlaces() {
    try {
      const key = savedPlacesStorageKey();
      const raw = key ? JSON.parse(localStorage.getItem(key) || '{}') : {};
      const saved = {};
      for (const slot of Object.keys(SAVED_PLACE_LABELS)) if (validSavedPlace(raw?.[slot])) saved[slot] = raw[slot];
      return saved;
    } catch {
      return {};
    }
  }

  function setSavedPlace(slot, entry) {
    try {
      const key = savedPlacesStorageKey();
      if (!key) return;
      const saved = loadSavedPlaces();
      if (entry) saved[slot] = { placeId: entry.placeId, name: entry.name, secondary: entry.secondary || '', lat: entry.lat, lng: entry.lng };
      else delete saved[slot];
      localStorage.setItem(key, JSON.stringify(saved));
    } catch { /* A full or blocked store just means the shortcut asks again. */ }
    renderSavedPlaceShortcuts();
    if (currentSettingsPage === 'mapNavigation') openSheet('mapNavigation');
  }

  function renderSavedPlaceShortcuts() {
    const saved = loadSavedPlaces();
    $$('[data-saved-place]').forEach((button) => {
      const slot = button.dataset.savedPlace;
      const place = saved[slot];
      const label = SAVED_PLACE_LABELS[slot];
      button.setAttribute('aria-label', place ? `${label}, ${place.name}` : `Set ${label}`);
      button.title = place ? `Route to ${place.name}. Press and hold to change ${label}.` : `Choose your ${label.toLowerCase()} address`;
    });
  }

  function showSavedPlace(place) {
    panToPlace(place.lat, place.lng);
    setDestinationMarker(new google.maps.LatLng(place.lat, place.lng), place.name, place.secondary);
  }

  // Home and Work start the route straight away, like other map apps: in
  // Rider Comms, or handed to the rider's chosen navigation app.
  function routeToSavedPlace(place) {
    if (window.google?.maps) showSavedPlace(place);
    const provider = navigationProvider(state.navigationProvider);
    if (provider === 'in_app') {
      if (window.google?.maps) void startInAppNavigation(new google.maps.LatLng(place.lat, place.lng), place.name);
      return;
    }
    window.open(navigationHref(provider, place.lat, place.lng, place.name), '_blank', 'noopener');
  }

  function openSavedPlace(slot) {
    const place = loadSavedPlaces()[slot];
    if (place) routeToSavedPlace(place);
    else openSearchScreen({ saveAs: slot });
  }

  // Settings, Map & navigation: set, change or remove Home and Work.
  function editSavedPlaceFromSettings(slot) {
    const page = currentSettingsPage;
    closeSheet();
    openSearchScreen({ saveAs: slot, fromSettingsPage: page });
  }

  function editSavedPlace(slot) {
    const place = loadSavedPlaces()[slot];
    if (!place) { openSearchScreen({ saveAs: slot }); return; }
    const label = SAVED_PLACE_LABELS[slot];
    presentSheet(label, `<p class="caption saved-place-address"><strong>${escapeHtml(place.name)}</strong>${place.secondary ? `<br>${escapeHtml(place.secondary)}` : ''}</p>
      <button class="button secondary wide" type="button" id="savedPlaceChange">Change ${label}</button>
      <button class="button danger wide" type="button" id="savedPlaceRemove">Remove ${label}</button>`, () => {
      $('#savedPlaceChange').addEventListener('click', () => { closeSheet(); openSearchScreen({ saveAs: slot }); });
      $('#savedPlaceRemove').addEventListener('click', () => { setSavedPlace(slot, null); closeSheet(); showToast(`${label} removed.`); });
    });
  }

  // A place chosen while search is choosing Home or Work is saved there too.
  // Returns true when that is all it's for (search opened from Settings).
  function rememberChosenPlace(entry) {
    saveRecentSearch(entry);
    if (!savingPlaceSlot) return false;
    const label = SAVED_PLACE_LABELS[savingPlaceSlot];
    setSavedPlace(savingPlaceSlot, entry);
    savingPlaceSlot = null;
    if (savingFromSettingsPage) {
      showToast(`${label} saved.`);
      closeSearchScreen();
      return true;
    }
    showToast(`${label} saved. Tap it in Where to and the route starts.`);
    return false;
  }

  function openSearchScreen(options = {}) {
    if ($('#mapSearchSlot')?.classList.contains('offline')) return;
    savingPlaceSlot = SAVED_PLACE_LABELS[options.saveAs] ? options.saveAs : null;
    savingFromSettingsPage = savingPlaceSlot && typeof options.fromSettingsPage === 'string' ? options.fromSettingsPage : null;
    const current = savingPlaceSlot ? loadSavedPlaces()[savingPlaceSlot] : null;
    $('#searchSaveCurrent').hidden = !current;
    $('#searchSaveCurrentName').textContent = current ? `Now: ${current.name}` : '';
    const saveLabel = savingPlaceSlot ? SAVED_PLACE_LABELS[savingPlaceSlot] : '';
    $('#searchSaveBanner').hidden = !savingPlaceSlot;
    $('#searchSaveBanner').textContent = savingPlaceSlot ? `Choose your ${saveLabel}` : '';
    $('#poiChipRow').hidden = Boolean(savingPlaceSlot);
    $('#searchScreenInput').placeholder = savingPlaceSlot ? `Your ${saveLabel.toLowerCase()} address` : 'Search for a place';
    $('#searchScreenInput').setAttribute('aria-label', savingPlaceSlot ? `Search for your ${saveLabel.toLowerCase()} address` : 'Search for a place');
    clearPoiMarkers();
    pushOverlayGuard();
    $('#searchScreen').hidden = false;
    const input = $('#searchScreenInput');
    input.value = '';
    $('#searchScreenClear').hidden = true;
    activePoiType = undefined;
    nearbySearchResults = [];
    $$('.poi-chip').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    renderRecentOrHint();
    input.focus();
    searchScreenPosition = undefined;
    void acquireSearchPosition();
  }

  function closeSearchScreen() {
    savingPlaceSlot = null;
    const returnTo = savingFromSettingsPage;
    savingFromSettingsPage = null;
    if (returnTo) queueMicrotask(() => openSheet(returnTo));
    searchRequestToken += 1;
    clearTimeout(searchDebounceTimer);
    $('#searchScreen').hidden = true;
    $('#searchScreenInput').blur();
  }

  function placeDistanceLabel(lat, lng) {
    if (!searchScreenPosition || typeof lat !== 'number' || typeof lng !== 'number') return '';
    return formatNavDistance(metersBetween(searchScreenPosition, { lat, lng }));
  }

  function renderRecentOrHint() {
    const recent = loadRecentSearches();
    const results = $('#searchScreenResults');
    if (!recent.length) {
      results.innerHTML = `
        <div class="search-empty-state">
          <span class="search-empty-icon"><svg><use href="#i-location"/></svg></span>
          <strong>Where do you want to go?</strong>
          <p>Search by place or address, or choose a nearby category above.</p>
        </div>`;
      return;
    }
    results.innerHTML = `
      <div class="search-results-heading"><div><span>History</span><strong>Recent places</strong></div><button class="search-recent-clear" id="searchRecentClearBtn" type="button">Clear</button></div>
      ${recent.map((item, index) => `
        <button class="search-result-row" data-recent-index="${index}">
          <span class="search-result-icon"><svg><use href="#i-history"/></svg></span>
          <span class="search-result-copy">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.secondary || '')}</span>
          </span>
          <span class="search-result-trailing"><small>${escapeHtml(placeDistanceLabel(item.lat, item.lng))}</small><svg><use href="#i-chevron"/></svg></span>
        </button>`).join('')}`;
    $('#searchRecentClearBtn').addEventListener('click', clearRecentSearches);
    $$('.search-result-row[data-recent-index]', results).forEach((row) => {
      row.addEventListener('click', () => selectRecentSearch(recent[Number(row.dataset.recentIndex)]));
    });
  }

  function renderSearchLoading(title = 'Searching places', eyebrow = 'Search') {
    $('#searchScreenResults').innerHTML = `
      <div class="search-results-heading"><div><span>${escapeHtml(eyebrow)}</span><strong>${escapeHtml(title)}</strong></div></div>
      <div class="search-skeleton" aria-label="Searching">
        ${Array.from({ length: 4 }, () => '<div><i></i><span><b></b><small></small></span></div>').join('')}
      </div>`;
  }

  function renderSearchMessage(icon, title, copy, className = '') {
    $('#searchScreenResults').innerHTML = `
      <div class="search-empty-state ${className}">
        <span class="search-empty-icon"><svg><use href="#${icon}"/></svg></span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(copy)}</p>
      </div>`;
  }

  function renderSearchLocationError(error, purpose = 'search nearby') {
    renderSearchMessage(
      'i-location',
      'Location needed',
      locationAccessMessage(error, purpose),
      'search-error-state'
    );
    const state = $('#searchScreenResults .search-empty-state');
    if (!state) return;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button primary search-location-retry';
    retry.textContent = 'Try location again';
    retry.addEventListener('click', () => {
      if (activePoiType) void searchNearbyPois(activePoiType);
      else void acquireSearchPosition(true);
    });
    state.append(retry);
  }

  async function acquireSearchPosition(showLoading = false) {
    if (showLoading) renderSearchLoading('Finding your location', 'Nearby');
    try {
      const position = await currentPosition();
      searchScreenPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (!$('#searchScreenInput').value.trim() && !activePoiType) renderRecentOrHint();
    } catch (error) {
      if (!$('#searchScreenInput').value.trim() && !activePoiType) {
        renderSearchLocationError(error, 'search nearby');
      }
    }
  }

  const PLACE_TYPE_ICONS = {
    gas_station: 'i-fuel',
    parking: 'i-parking',
    restaurant: 'i-food',
    meal_takeaway: 'i-food',
    cafe: 'i-coffee',
    car_repair: 'i-wrench',
  };

  function predictionIcon(prediction) {
    const match = (prediction.types || []).find((type) => PLACE_TYPE_ICONS[type]);
    return match ? PLACE_TYPE_ICONS[match] : 'i-location';
  }

  function renderSearchResults(predictions) {
    const results = $('#searchScreenResults');
    if (!predictions.length) {
      renderSearchMessage('i-search', 'No matching places', 'Check the spelling or try a broader place name.', 'search-error-state');
      return;
    }
    results.innerHTML = `
      <div class="search-results-heading"><div><span>Suggestions</span><strong>Places and addresses</strong></div><small>${predictions.length} results</small></div>
      ${predictions.map((prediction, index) => `
      <button class="search-result-row" data-place-id="${escapeHtml(prediction.place_id)}" data-result-index="${index}">
        <span class="search-result-icon"><svg><use href="#${predictionIcon(prediction)}"/></svg></span>
        <span class="search-result-copy">
          <strong>${escapeHtml(prediction.structured_formatting?.main_text || prediction.description)}</strong>
          <span>${escapeHtml(prediction.structured_formatting?.secondary_text || '')}</span>
        </span>
        <span class="search-result-trailing"><svg><use href="#i-chevron"/></svg></span>
      </button>`).join('')}`;
    $$('.search-result-row', results).forEach((row) => row.addEventListener('click', () => void selectSearchResult(row.dataset.placeId)));
  }

  // The Where to drawer on the map: search and shortcuts at rest, recent
  // places once it is slid up.
  function renderDrawerRecent() {
    const list = $('#mapDrawerRecent');
    if (!list) return;
    if ($('#mapSearchSlot')?.classList.contains('offline')) {
      list.innerHTML = '<p class="map-drawer-empty">Search is unavailable right now.</p>';
      return;
    }
    const recent = loadRecentSearches();
    if (!recent.length) {
      list.innerHTML = '<p class="map-drawer-empty">Places you search for show up here.</p>';
      return;
    }
    list.innerHTML = `<div class="search-results-heading"><div><strong>Recent</strong></div></div>${recent.map((item, index) => `
        <button class="search-result-row" type="button" data-drawer-recent="${index}">
          <span class="search-result-icon"><svg><use href="#i-history"/></svg></span>
          <span class="search-result-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.secondary || '')}</span></span>
        </button>`).join('')}`;
    $$('[data-drawer-recent]', list).forEach((row) => row.addEventListener('click', () => {
      setMapDrawerOpen(false);
      selectRecentSearch(recent[Number(row.dataset.drawerRecent)]);
    }));
  }

  function setMapDrawerOpen(open) {
    const drawer = $('#mapDrawer');
    if (!drawer) return;
    if (open && drawer.dataset.state !== 'open') pushOverlayGuard();
    drawer.dataset.state = open ? 'open' : 'peek';
    $('#mapDrawerRecent').hidden = !open;
    const handle = $('#mapDrawerHandle');
    handle.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', open ? 'Hide recent places' : 'Show recent places');
    document.documentElement.classList.toggle('map-drawer-open', open);
    if (open) renderDrawerRecent();
  }

  const DRAWER_SETTLE_MS = 220;
  const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // The recent list's full height when open (it scrolls past its max-height).
  // Pulled up, the drawer rises to just below the rider's avatar: recent
  // places, then room for more below them (native: OPEN_TOP_CLEARANCE).
  const DRAWER_OPEN_GAP = 24;
  const DRAWER_MIN_OPEN = 240;
  function drawerListHeight() {
    const drawer = $('#mapDrawer');
    const list = $('#mapDrawerRecent');
    const avatar = $('.map-avatar-wrap')?.getBoundingClientRect();
    const status = $('#mapStatusChip')?.getBoundingClientRect();
    const clear = Math.max(avatar?.bottom || 0, status?.bottom || 0) + DRAWER_OPEN_GAP;
    // The drawer's top when resting: its bottom edge less everything but the list.
    const rest = drawer.getBoundingClientRect().bottom - (drawer.offsetHeight - (list.hidden ? 0 : list.offsetHeight));
    return Math.max(DRAWER_MIN_OPEN, Math.round(rest - clear));
  }
  function syncDrawerOpenHeight() {
    const drawer = $('#mapDrawer');
    if (!drawer || drawer.dataset.state !== 'peek') return;
    document.documentElement.style.setProperty('--map-drawer-list-open', `${drawerListHeight()}px`);
  }

  // Grows or shrinks the recent list from `from` px to open or closed, then
  // hands the final state to setMapDrawerOpen.
  let drawerSettleTimer;
  function settleMapDrawer(open, from) {
    const list = $('#mapDrawerRecent');
    if (!list) return;
    clearTimeout(drawerSettleTimer);
    if (open) setMapDrawerOpen(true);
    const clear = () => {
      list.style.height = '';
      list.style.overflow = '';
      list.style.transition = '';
    };
    if (prefersReducedMotion()) {
      clear();
      if (!open) setMapDrawerOpen(false);
      return;
    }
    list.hidden = false;
    const target = open ? drawerListHeight() : 0;
    list.style.overflow = 'hidden';
    list.style.transition = 'none';
    list.style.height = `${from}px`;
    void list.offsetHeight;
    list.style.transition = `height ${DRAWER_SETTLE_MS}ms cubic-bezier(.2,.8,.2,1)`;
    list.style.height = `${target}px`;
    drawerSettleTimer = setTimeout(() => {
      clear();
      if (!open) setMapDrawerOpen(false);
    }, DRAWER_SETTLE_MS + 20);
  }

  function toggleMapDrawer(open) {
    const list = $('#mapDrawerRecent');
    const from = list && !list.hidden ? list.getBoundingClientRect().height : 0;
    settleMapDrawer(open, from);
  }

  // The drawer follows the finger: the recent list grows or shrinks with the
  // slide, then settles open or closed. A tap on the handle toggles it, and a
  // slide that starts on a button must not also press it.
  function initMapDrawer() {
    const drawer = $('#mapDrawer');
    if (!drawer) return;
    const list = $('#mapDrawerRecent');
    let drag = null;
    let dragged = false;
    // Follow the gesture on the window: a slide quickly leaves the drawer's
    // own edge, and capturing the pointer would steal plain taps from its
    // buttons.
    const onMove = (event) => {
      if (!drag) return;
      const dy = event.clientY - drag.startY;
      if (!dragged) {
        if (Math.abs(dy) <= 8) return;
        dragged = true;
        clearTimeout(drawerSettleTimer);
        // Opening: show the list now, at no height, so it can grow.
        if (!drag.wasOpen) setMapDrawerOpen(true);
        drag.full = drawerListHeight();
        list.style.overflow = 'hidden';
        list.style.transition = 'none';
      }
      const height = Math.max(0, Math.min(drag.full, drag.startHeight - dy));
      list.style.height = `${height}px`;
      drag.height = height;
    };
    const onEnd = (event) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      const current = drag;
      drag = null;
      // A slide's own click (if any) follows straight after; never let a
      // stale flag swallow a later, real tap.
      setTimeout(() => { dragged = false; }, 0);
      if (!current || !dragged) return;
      const dy = event.type === 'pointerup' ? event.clientY - current.startY : 0;
      // Open past a short pull up, or when mostly open and not pulled down.
      const open = current.wasOpen ? dy < 60 : dy < -30;
      // A light tick when the slide snaps the drawer to its other rest, like
      // the native app (where the browser supports it).
      if (open !== current.wasOpen) navigator.vibrate?.(8);
      settleMapDrawer(open, current.height ?? current.startHeight);
    };
    drawer.addEventListener('pointerdown', (event) => {
      if (event.target.closest('#mapDrawerRecent')) return;
      const wasOpen = drawer.dataset.state === 'open';
      drag = { startY: event.clientY, wasOpen, startHeight: wasOpen ? list.getBoundingClientRect().height : 0 };
      dragged = false;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    });
    window.addEventListener('click', (event) => {
      if (!dragged) return;
      dragged = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    $('#mapDrawerHandle').addEventListener('click', () => toggleMapDrawer(drawer.dataset.state !== 'open'));
    $$('[data-saved-place]', drawer).forEach((button) => {
      const slot = button.dataset.savedPlace;
      let holdTimer;
      let held = false;
      const cancelHold = () => clearTimeout(holdTimer);
      button.addEventListener('pointerdown', () => {
        held = false;
        cancelHold();
        holdTimer = setTimeout(() => { held = true; editSavedPlace(slot); }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, cancelHold));
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        cancelHold();
        if (!held) { held = true; editSavedPlace(slot); }
      });
      button.addEventListener('click', () => {
        if (held) { held = false; return; }
        setMapDrawerOpen(false);
        openSavedPlace(slot);
      });
    });
    $('#searchSaveRemove').addEventListener('click', () => {
      const slot = savingPlaceSlot;
      if (!slot) return;
      setSavedPlace(slot, null);
      showToast(`${SAVED_PLACE_LABELS[slot]} removed.`);
      closeSearchScreen();
    });
    $('#drawerPetrol').addEventListener('click', () => {
      setMapDrawerOpen(false);
      openSearchScreen();
      $('.poi-chip[data-poi-type="gas_station"]')?.click();
    });
    renderSavedPlaceShortcuts();
    drawer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawer.dataset.state === 'open') {
        toggleMapDrawer(false);
        $('#mapDrawerHandle').focus();
      }
    });
    // Keep the floating controls exactly above the drawer's resting height.
    const peek = () => {
      if (drawer.dataset.state !== 'peek' || !drawer.offsetHeight) return;
      syncDrawerOpenHeight();
      const inset = parseFloat(getComputedStyle(drawer).paddingBottom) - 14;
      document.documentElement.style.setProperty('--map-drawer-peek', `${Math.round(drawer.offsetHeight - Math.max(0, inset))}px`);
    };
    if ('ResizeObserver' in window) new ResizeObserver(peek).observe(drawer);
    peek();
  }

  function selectRecentSearch(item) {
    if (!item) return;
    if (rememberChosenPlace(item)) return;
    panToPlace(item.lat, item.lng);
    // showDestinationCard/setDestinationMarker call location.lat()/.lng()
    // as methods (matching the real google.maps.LatLng that
    // selectSearchResult below gets from Places) -- a plain {lat,lng}
    // literal here would throw when a recent result is tapped.
    setDestinationMarker(new google.maps.LatLng(item.lat, item.lng), item.name, item.secondary);
    showToast(`Centred on ${item.name}`);
    closeSearchScreen();
  }

  function openNearbyPlace(place) {
    if (!place) return;
    const location = new google.maps.LatLng(place.location.lat, place.location.lng);
    clearPoiMarkers();
    panToPlace(place.location.lat, place.location.lng);
    setDestinationMarker(location, place.name);
    if (place.placeId && savingFromSettingsPage) {
      rememberChosenPlace({ placeId: place.placeId, name: place.name, secondary: place.address || '', lat: place.location.lat, lng: place.location.lng });
      return;
    }
    if (place.placeId) {
      rememberChosenPlace({
        placeId: place.placeId,
        name: place.name,
        secondary: place.address || '',
        lat: place.location.lat,
        lng: place.location.lng,
      });
    }
    closeSearchScreen();
  }

  function selectSearchResult(placeId) {
    if (!placesService) placesService = new google.maps.places.PlacesService(map);
    placesService.getDetails({ placeId, fields: ['name', 'geometry', 'formatted_address'], sessionToken: searchSessionToken }, (place, status) => {
      searchSessionToken = new google.maps.places.AutocompleteSessionToken();
      const location = place?.geometry?.location;
      if (status !== google.maps.places.PlacesServiceStatus.OK || !location) {
        showToast('Could not open that place. Try again.');
        return;
      }
      const lat = location.lat();
      const lng = location.lng();
      if (savingFromSettingsPage) {
        rememberChosenPlace({ placeId, name: place.name || 'Selected place', secondary: place.formatted_address || '', lat, lng });
        return;
      }
      panToPlace(lat, lng);
      setDestinationMarker(location, place.name, place.formatted_address);
      showToast(place.name ? `Centred on ${place.name}` : 'Centred on selected place.');
      rememberChosenPlace({ placeId, name: place.name || 'Selected place', secondary: place.formatted_address || '', lat, lng });
      closeSearchScreen();
    });
  }

  function searchPlaces(query) {
    if (!query) {
      renderRecentOrHint();
      return;
    }
    renderSearchLoading();
    const requestToken = ++searchRequestToken;
    if (!autocompleteService) autocompleteService = new google.maps.places.AutocompleteService();
    if (!searchSessionToken) searchSessionToken = new google.maps.places.AutocompleteSessionToken();
    autocompleteService.getPlacePredictions(
      { input: query, sessionToken: searchSessionToken, locationBias: map?.getBounds() },
      (predictions, status) => {
        if (requestToken !== searchRequestToken) return; // a newer keystroke's request already landed
        if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          renderSearchResults([]);
          return;
        }
        if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
          renderSearchMessage('i-search', 'Search is unavailable', 'Google Maps could not complete that search. Try again in a moment.', 'search-error-state');
          return;
        }
        renderSearchResults(predictions);
      }
    );
  }

  function initPlaceSearch() {
    $('#mapSearchSlot').addEventListener('click', openSearchScreen);
    $('#searchScreenBack').addEventListener('click', closeSearchScreen);
    $('#searchScreenInput').addEventListener('input', (event) => {
      const query = event.target.value.trim();
      $('#searchScreenClear').hidden = !query;
      searchRequestToken += 1;
      activePoiType = undefined;
      $$('.poi-chip').forEach((button) => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => searchPlaces(query), 220);
    });
    $('#searchScreenInput').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeSearchScreen(); return; }
      if (event.key === 'Enter') { event.preventDefault(); $('.search-result-row', $('#searchScreenResults'))?.click(); }
    });
    $('#searchScreenClear').addEventListener('click', () => {
      const input = $('#searchScreenInput');
      input.value = '';
      $('#searchScreenClear').hidden = true;
      clearTimeout(searchDebounceTimer);
      activePoiType = undefined;
      $$('.poi-chip').forEach((button) => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
      renderRecentOrHint();
      input.focus();
    });
    initPoiChips();
  }

  const POI_CATEGORIES = {
    gas_station: { label: 'Petrol', plural: 'petrol stations', icon: 'i-fuel' },
    parking: { label: 'Parking', plural: 'parking places', icon: 'i-parking' },
    restaurant: { label: 'Restaurants', plural: 'restaurants', icon: 'i-food' },
    cafe: { label: 'Coffee', plural: 'coffee shops', icon: 'i-coffee' },
    car_repair: { label: 'Repair', plural: 'repair shops', icon: 'i-wrench' },
  };
  let placesService;
  let poiMarkers = [];

  function clearPoiMarkers() {
    poiMarkers.forEach((marker) => marker.setMap(null));
    poiMarkers = [];
  }

  // nearbySearch is one of the pricier Places SKUs, and a rider commonly
  // re-taps the same chip within a few minutes without having moved far
  // (toggling it off/on, or re-checking after glancing at the map) — none
  // of that needs a fresh billed request. Cache results per category,
  // keyed to a coarse (~110m) position bucket so ordinary GPS jitter
  // still lands on the same entry, and expire them after a few minutes
  // since a rider actually riding toward a new area should get a fresh
  // lookup, not a stale one. Deliberately in-memory/per-session only —
  // never persisted — since Places' terms don't allow caching results
  // beyond the session that fetched them.
  const POI_CACHE_TTL_MS = 3 * 60 * 1000;
  const POI_CACHE_MAX_ENTRIES = 30;
  const poiResultCache = new Map();

  function poiCacheKey(type, lat, lng) {
    return `${type}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
  }

  function renderNearbyResults(type, places) {
    const category = POI_CATEGORIES[type];
    const results = $('#searchScreenResults');
    if (!places.length) {
      renderSearchMessage(category.icon, `No ${category.plural} nearby`, 'Try another category or search by name.');
      return;
    }
    nearbySearchResults = places;
    results.innerHTML = `
      <div class="search-results-heading"><div><span>Nearby</span><strong>${escapeHtml(category.label)}</strong></div><small>${places.length} closest</small></div>
      ${places.map((place, index) => {
        const meta = [place.openNow === true ? 'Open' : place.openNow === false ? 'Closed' : '', place.rating ? `${place.rating.toFixed(1)} ★` : ''].filter(Boolean);
        return `<button class="search-result-row nearby-result-row" data-nearby-index="${index}">
          <span class="search-result-icon category-icon"><svg><use href="#${category.icon}"/></svg></span>
          <span class="search-result-copy">
            <strong>${escapeHtml(place.name)}</strong>
            <span>${escapeHtml(place.address || 'Address unavailable')}</span>
            ${meta.length ? `<small class="search-result-meta ${place.openNow === true ? 'is-open' : ''}">${escapeHtml(meta.join(' · '))}</small>` : ''}
          </span>
          <span class="search-result-trailing"><small>${escapeHtml(place.distanceLabel)}</small><svg><use href="#i-chevron"/></svg></span>
        </button>`;
      }).join('')}`;
    $$('.nearby-result-row', results).forEach((row) => {
      row.addEventListener('click', () => openNearbyPlace(nearbySearchResults[Number(row.dataset.nearbyIndex)]));
    });
  }

  /**
   * "Petrol"/"Parking"/"Food"/"Coffee"/"Repair" chips below the search bar
   * — real POI lookup via the classic Places JS API's nearbySearch (the
   * same `libraries=places` script already loaded for Autocomplete covers
   * this; no separate key or library needed). Free-text search alone
   * technically could already find e.g. "petrol station near me", but a
   * rider glancing at their phone mid-ride shouldn't have to type — one
   * tap for the categories that actually matter on a ride.
   */
  async function searchNearbyPois(type) {
    if (!map) return;
    const category = POI_CATEGORIES[type];
    const requestToken = ++searchRequestToken;
    renderSearchLoading(`Finding ${category.plural}`, 'Nearby');
    let lat, lng;
    try {
      const position = await currentPosition();
      lat = position.coords.latitude;
      lng = position.coords.longitude;
    } catch (error) {
      if (requestToken !== searchRequestToken || activePoiType !== type) return;
      renderSearchLocationError(error, `find ${category.plural} nearby`);
      return;
    }
    if (requestToken !== searchRequestToken || activePoiType !== type) return;
    searchScreenPosition = { lat, lng };
    const cacheKey = poiCacheKey(type, lat, lng);
    const cached = poiResultCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < POI_CACHE_TTL_MS) {
      renderNearbyResults(type, cached.places);
      return;
    }
    if (!placesService) placesService = new google.maps.places.PlacesService(map);
    placesService.nearbySearch({
      location: { lat, lng },
      rankBy: google.maps.places.RankBy.DISTANCE,
      type,
    }, (results, status) => {
      if (requestToken !== searchRequestToken || activePoiType !== type) return;
      if (status !== google.maps.places.PlacesServiceStatus.OK && status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        renderSearchMessage(category.icon, 'Nearby search is unavailable', 'Google Maps could not complete that search. Try again in a moment.', 'search-error-state');
        return;
      }
      const places = status === google.maps.places.PlacesServiceStatus.OK && results?.length
        ? results
          .map((place) => {
            if (place.business_status === google.maps.places.BusinessStatus.CLOSED_PERMANENTLY) return null;
            const location = place.geometry?.location;
            if (!location) return null;
            const point = { lat: location.lat(), lng: location.lng() };
            const distance = metersBetween({ lat, lng }, point);
            return {
              placeId: place.place_id,
              location: point,
              name: place.name || category.label,
              address: place.vicinity || place.formatted_address || '',
              rating: typeof place.rating === 'number' ? place.rating : undefined,
              openNow: typeof place.opening_hours?.open_now === 'boolean' ? place.opening_hours.open_now : undefined,
              distance,
              distanceLabel: formatNavDistance(distance),
            };
          })
          .filter(Boolean)
          .filter((place) => place.distance <= 5000)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 8)
        : [];
      if (poiResultCache.size >= POI_CACHE_MAX_ENTRIES) {
        poiResultCache.delete(poiResultCache.keys().next().value);
      }
      poiResultCache.set(cacheKey, { timestamp: Date.now(), places });
      renderNearbyResults(type, places);
    });
  }

  function initPoiChips() {
    $$('.poi-chip').forEach((button) => button.addEventListener('click', () => {
      const type = button.dataset.poiType;
      const wasActive = button.classList.contains('active');
      $$('.poi-chip').forEach((b) => b.classList.remove('active'));
      $$('.poi-chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      searchRequestToken += 1;
      if (wasActive) {
        activePoiType = undefined;
        renderRecentOrHint();
        return;
      }
      activePoiType = type;
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      $('#searchScreenInput').value = '';
      $('#searchScreenClear').hidden = true;
      void searchNearbyPois(type);
    }));
    initPoiChipScrollFade();
  }

  /**
   * The chip row overflows on purpose (five chips don't fit on a phone
   * width) — but a row that just gets clipped at the screen edge with no
   * signal reads as broken, not scrollable. This toggles a CSS mask-image
   * fade on whichever edge still has more chips to reveal (both edges
   * once scrolled partway, right-only at the start, left-only at the end,
   * and no fade at all if the row happens to fit without scrolling, e.g.
   * a wide viewport) so a partially-visible chip reads as "swipe for
   * more" the way map apps' own category rows do.
   */
  function initPoiChipScrollFade() {
    const row = $('#poiChipRow');
    if (!row) return;
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 1) {
        row.classList.remove('scrolled', 'at-end');
        row.classList.add('no-scroll');
        return;
      }
      row.classList.remove('no-scroll');
      row.classList.toggle('scrolled', row.scrollLeft > 4);
      row.classList.toggle('at-end', row.scrollLeft >= max - 4);
    };
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

