(() => {
  'use strict';

  // CSS display-mode handles first paint in standards-compliant browsers.
  // navigator.standalone covers installed iOS PWAs that do not report the
  // media query consistently after a cold launch.
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  const syncStandaloneMode = () => {
    const isStandalone = standaloneMedia?.matches || window.navigator.standalone === true;
    document.documentElement.classList.toggle('pwa-standalone', Boolean(isStandalone));
    document.documentElement.classList.toggle('pwa-ios-standalone', window.navigator.standalone === true);
  };
  syncStandaloneMode();
  standaloneMedia?.addEventListener?.('change', syncStandaloneMode);

  const STORAGE_KEY = 'rider-comms-pwa-v4';
  // Real, persistent client session (Rider ID + bearer token issued by the
  // backend at signup/login) — this is legitimate client-side storage every
  // real app keeps, not mock data. It lives in its own key, separate from
  // STORAGE_KEY's per-device UI preferences, so logging out never has to
  // touch (or accidentally nuke) unrelated local settings.
  const SESSION_KEY = 'rider-comms-session-v1';
  const DEFAULT_STATE = {
    screen: 'map',
    publicLive: false,
    selectedRiderId: null,
    activeRide: null,
    unit: 'mi',
    notifications: true,
    profile: {
      riderId: '',
      displayName: '',
      handle: '',
      instagram: '',
      tiktok: '',
      socialsVisibility: 'friends',
      shareLocation: false,
    },
    friends: [],
    requests: [],
    routeVehicleFilter: null,
  };

  // Waze-style crowdsourced road reports, backed for real by POST /hazards
  // and GET /hazards/nearby (see backend/src/hazardStore.ts for the TTL and
  // confirm/deny hide-threshold rules). This map is just UI metadata (icon,
  // label, colour) for the real HazardType values the backend returns —
  // never mock report data.
  const HAZARD_TYPES = {
    police: { label: 'Police', icon: 'i-shield', color: '#4f7cff' },
    camera: { label: 'Speed camera', icon: 'i-camera', color: '#4f7cff' },
    accident: { label: 'Accident', icon: 'i-alert', color: '#ff6572' },
    hazard: { label: 'Hazard', icon: 'i-cone', color: '#ffc15a' },
    road_closure: { label: 'Road closure', icon: 'i-no-entry', color: '#ff6572' },
  };
  const HAZARD_TYPE_ORDER = ['police', 'camera', 'accident', 'hazard', 'road_closure'];

  // Automatic day/night map skin — kept in sync with the CSS light-mode
  // media block below via prefersDarkMode(), so the map tiles match the
  // rest of the UI instead of staying stuck on the dark skin in daylight.
  const MAP_STYLE_DARK = [
    { elementType: 'geometry', stylers: [{ color: '#172028' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#172028' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8f9ba7' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#293640' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#34434f' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2834' }] },
  ];
  const MAP_STYLE_LIGHT = [
    { elementType: 'geometry', stylers: [{ color: '#f4f1ec' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f1ec' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5f574c' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#ddd3c4' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe3ea' }] },
  ];
  const darkModeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  function prefersDarkMode() {
    return darkModeQuery ? darkModeQuery.matches : true;
  }
  function applyColorScheme() {
    // Always black-translucent, in both themes. 'default' (which this used
    // to switch to for light mode) makes iOS reserve a solid, opaque status
    // bar bar instead of overlaying content — the exact "band" at the top
    // this is here to avoid. black-translucent is the only value that's
    // truly edge-to-edge; the cost is the status bar's own text/icons stay
    // light-on-transparent even over a light background, which iOS gives no
    // way around for a home-screen web app.
    const meta = $('#statusBarStyleMeta');
    if (meta) meta.setAttribute('content', 'black-translucent');
    map?.setOptions({
      styles: prefersDarkMode() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      backgroundColor: prefersDarkMode() ? '#101820' : '#f4f1ec',
    });
  }
  darkModeQuery?.addEventListener('change', applyColorScheme);

  const VEHICLE_LABELS = { motorcycle_small: 'Small motorcycle', motorcycle_large: 'Large motorcycle', scooter: 'Scooter', car: 'Car' };
  const ROAD_TYPE_LABELS = { rural: 'Rural', mountain: 'Mountain', coastal: 'Coastal', urban: 'Urban', mixed: 'Mixed' };
  const DIFFICULTY_LABELS = { easy: 'Easy', moderate: 'Moderate', challenging: 'Challenging' };
  const SURFACE_LABELS = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };

  // Real nearby riders (from POST /presence's inZoneWith, resolved to
  // display info via GET /profiles/:id — same lookup-per-id pattern
  // loadFriendsData() already uses for incoming friend requests) and the
  // current private ride's roster (from GET/POST /rides, resolved the same
  // way). Both are runtime-only: presence is inherently transient (it goes
  // stale server-side after ~30s of no ping) and a ride's membership can
  // change at any moment from another rider's device, so neither belongs in
  // persisted state the way profile/friends data does — they are always
  // re-fetched from the backend rather than trusted from localStorage.
  let nearbyRiders = [];

  // Real per-rider coordinates for the active ride's members (GET
  // /rides/:id/locations) — same runtime-only convention as nearbyRiders
  // above. Separate mechanism from nearbyRiders/public presence entirely:
  // see the 0014_create_ride_locations migration note in backend/src/db.ts
  // for why a ride's location sharing is always-on for its members and
  // never gated on profile.shareLocation. Keyed by riderId for easy lookup
  // when placing markers.
  let rideMemberLocations = new Map();

  // Real crowdsourced hazard reports for the current area (GET
  // /hazards/nearby), refreshed whenever the map screen is (re)opened or a
  // new report is created — same runtime-only convention as nearbyRiders
  // above, since a report can expire or be voted away server-side at any
  // moment.
  let nearbyHazards = [];

  // Real user-submitted scenic routes for the current filter (GET
  // /scenic-routes), refreshed whenever the Routes screen is opened or its
  // vehicle filter changes — same runtime-only convention as nearbyRiders.
  let routes = [];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Real backend base URL — the same one loadGoogleMaps() already fetches
  // /config from. Every real API call in this file (auth, profile, friends,
  // rides, presence, hazards, scenic routes) goes through this one origin.
  const API_BASE_URL = 'https://backend-production-7fa0.up.railway.app';

  class ApiError extends Error {
    constructor(status, body) {
      super(`API error ${status}: ${JSON.stringify(body)}`);
      this.status = status;
      this.body = body;
    }
  }

  function loadSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (stored && typeof stored.riderId === 'string' && typeof stored.token === 'string') return stored;
    } catch { /* fall through to null */ }
    return null;
  }

  function saveSession(nextSession) {
    session = nextSession;
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  }

  function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
  }

  let session = loadSession();
  const stateStorageKey = () => session?.riderId ? `${STORAGE_KEY}:${session.riderId}` : STORAGE_KEY;
  // v4 stored profile data in one device-global record. Account-scoped
  // storage prevents one rider's cached identity appearing for another.
  localStorage.removeItem(STORAGE_KEY);

  /**
   * Shared fetch helper for every real backend call in this file. Adds the
   * bearer token automatically when a session is present, applies a 10s
   * timeout the same way mobile's RiderCommsClient does, and throws
   * ApiError on any non-2xx response so callers can branch on real error
   * codes (username_taken, invalid_credentials, rate_limited, …) instead of
   * failing silently the way mock-data code never had to consider.
   */
  async function apiFetch(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw new ApiError(0, { error: error?.name === 'AbortError' ? 'timed_out' : 'network_error' });
    }
    clearTimeout(timeout);
    const contentType = response.headers.get('content-type') || '';
    const json = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
    if (!response.ok) {
      // A 401 means the expiring server-side session was revoked, deleted,
      // or has reached its lifetime. Clear local credentials immediately.
      if (response.status === 401) {
        const hadSession = Boolean(session);
        clearSession();
        if (hadSession) location.reload();
      }
      throw new ApiError(response.status, json);
    }
    return json;
  }

  const state = loadState();
  let toastTimer;
  let map;
  let usingFallbackMap = true;
  let userMapMarker;
  let mapMarkers = [];
  let mapHazardMarkers = [];
  let destinationMarker;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(stateStorageKey()) || 'null');
      if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_STATE);
      return {
        ...structuredClone(DEFAULT_STATE),
        ...stored,
        profile: { ...DEFAULT_STATE.profile, ...(stored.profile || {}) },
        friends: Array.isArray(stored.friends) ? stored.friends : structuredClone(DEFAULT_STATE.friends),
        requests: Array.isArray(stored.requests) ? stored.requests : structuredClone(DEFAULT_STATE.requests),
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function persist() {
    localStorage.setItem(stateStorageKey(), JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function initials(name) {
    const result = String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
    return result || 'RC';
  }

  function identityColor(id) {
    const colors = ['#4f7cff', '#8b5cf6', '#e45d8c', '#148f77', '#b96c22', '#3d7f92'];
    let hash = 0;
    for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function avatar(person, className = '') {
    return `<span class="avatar ${className}" style="--avatar:${identityColor(person.riderId)}" aria-hidden="true">${escapeHtml(initials(person.displayName))}</span>`;
  }

  function icon(name) {
    return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
  }

  function navigate(screen, push = true) {
    if (!['map', 'ride', 'routes', 'friends', 'settings'].includes(screen)) screen = 'map';
    state.screen = screen;
    persist();
    $$('.screen').forEach((item) => item.classList.toggle('active', item.dataset.screen === screen));
    $$('[data-nav]').forEach((item) => {
      const active = item.dataset.nav === screen;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    if (push && location.hash !== `#${screen}`) history.pushState({ screen }, '', `#${screen}`);
    document.title = `${screen === 'ride' ? 'Group Ride' : screen[0].toUpperCase() + screen.slice(1)} · Rider Comms`;
    window.scrollTo(0, 0);
    if (screen === 'map') { renderMapRiders(); refreshNearbyHazards(); }
    if (screen === 'routes') renderRoutes();
    if (screen === 'friends') loadFriendsData();
    if (screen === 'ride') refreshActiveRide();
  }

  function renderProfile() {
    $('#profileName').textContent = state.profile.displayName;
    $('#profileHandle').textContent = state.profile.handle;
    $('#profileRiderId').textContent = state.profile.riderId;
    const genericProfile = state.profile.displayName.trim().toLowerCase() === 'rider'
      || state.profile.handle.trim().toLowerCase() === '@rider';
    $('#completeProfilePrompt').hidden = !genericProfile;
    $$('[data-avatar]').forEach((element) => {
      element.textContent = initials(state.profile.displayName);
      element.style.setProperty('--avatar', identityColor(state.profile.riderId));
    });
  }

  function renderFallbackMarkers(riders = nearbyRiders) {
    const layer = $('#fallbackMarkers');
    const people = [
      { ...state.profile, displayName: state.profile.displayName, handle: state.profile.handle, status: 'You', x: 50, y: 53, current: true },
      ...riders,
    ];
    layer.innerHTML = people.map((person) => {
      const selected = state.selectedRiderId === person.riderId;
      const label = person.current || selected ? `<span class="marker-label">${escapeHtml(person.current ? 'You' : person.displayName)}</span>` : '';
      return `<button class="rider-marker${person.current ? ' current' : ''}${selected ? ' selected' : ''}" style="left:${person.x}%;top:${person.y}%;--marker:${identityColor(person.riderId)}" data-rider-id="${escapeHtml(person.riderId)}" aria-label="${escapeHtml(person.current ? 'Your location' : person.displayName)}">${escapeHtml(initials(person.displayName))}${label}</button>`;
    }).join('');
    $$('[data-rider-id]', layer).forEach((button) => button.addEventListener('click', () => selectRider(button.dataset.riderId, people)));
  }

  // Illustrative-position convention: neither the backend's ride roster
  // nor its presence response carries other riders' real lat/lon (Section
  // 8's mutual in-zone check is a yes/no, not a position feed), so the
  // fallback CSS map places each one at a small, deterministic offset from
  // "you" instead — same convention used for a hazard report below, not a
  // real bearing/distance.
  const HAZARD_OFFSETS = [[14, -10], [-16, 8], [10, 16], [-12, -14], [18, 4]];

  function pinIcon(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.1 1 14.6 1 23.6 15 39 15 39s14-15.4 14-24.4C29 7.1 22.7 1 15 1Z" fill="${color}" stroke="#0a0f14" stroke-width="2"/></svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(30, 40),
      anchor: new google.maps.Point(15, 38),
    };
  }

  function addHazardMapMarker(hazard) {
    const meta = HAZARD_TYPES[hazard.type];
    const marker = new google.maps.Marker({ map, position: { lat: hazard.lat, lng: hazard.lon }, title: meta.label, icon: pinIcon(meta.color), zIndex: 6 });
    marker.addListener('click', () => selectHazard(hazard.id));
    return marker;
  }

  function renderMapHazards() {
    if (!map || usingFallbackMap) return;
    mapHazardMarkers.forEach((marker) => marker.setMap(null));
    mapHazardMarkers = nearbyHazards.map((hazard) => addHazardMapMarker(hazard));
  }

  function renderHazardMarkers() {
    const layer = $('#hazardMarkers');
    layer.innerHTML = nearbyHazards.map((hazard, index) => {
      const [dx, dy] = HAZARD_OFFSETS[index % HAZARD_OFFSETS.length];
      const meta = HAZARD_TYPES[hazard.type];
      return `<button class="hazard-marker" style="left:${50 + dx}%;top:${53 + dy}%;--hazard:${meta.color}" data-hazard-id="${escapeHtml(hazard.id)}" aria-label="${escapeHtml(meta.label)}"><svg><use href="#${meta.icon}"/></svg></button>`;
    }).join('');
    $$('[data-hazard-id]', layer).forEach((button) => button.addEventListener('click', () => selectHazard(button.dataset.hazardId)));
    renderMapHazards();
  }

  function selectHazard(hazardId) {
    const hazard = nearbyHazards.find((h) => h.id === hazardId);
    const card = $('#hazardCard');
    if (!hazard) { card.hidden = true; return; }
    const meta = HAZARD_TYPES[hazard.type];
    hideDestinationCard();
    card.innerHTML = `<span class="avatar" style="--avatar:${meta.color}" aria-hidden="true"><svg><use href="#${meta.icon}"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(meta.label)}</strong><span>Reported by a nearby rider</span><div class="hazard-vote-row"><button class="compact-button" data-vote="confirm">Still there (${hazard.confirmations})</button><button class="compact-button" data-vote="deny">Gone (${hazard.denials})</button></div></div>`;
    card.hidden = false;
    $('[data-vote="confirm"]', card).addEventListener('click', () => voteHazard(hazardId, 'confirm'));
    $('[data-vote="deny"]', card).addEventListener('click', () => voteHazard(hazardId, 'deny'));
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
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      if (code === 'not_found') {
        nearbyHazards = nearbyHazards.filter((h) => h.id !== hazardId);
        $('#hazardCard').hidden = true;
        renderHazardMarkers();
        showToast('That report is no longer active.');
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

  const HAZARD_ERROR_MESSAGES = {
    rate_limited: 'Too many reports — please wait a few minutes and try again.',
  };

  /** Reports a real hazard (POST /hazards) at the rider's live GPS
   * position — reuses currentPosition(), the same geolocation helper the
   * locate/go-live buttons use. The backend requires a real coordinate, so
   * a report is never sent (or shown as if it landed) without one. */
  async function createHazard(type, chips) {
    const errorEl = $('#hazardFormError');
    if (errorEl) errorEl.hidden = true;
    let position;
    try {
      position = await currentPosition();
    } catch {
      if (errorEl) { errorEl.textContent = 'Enable location access to report a hazard.'; errorEl.hidden = false; }
      return;
    }
    chips?.forEach((chip) => { chip.disabled = true; });
    try {
      const hazard = await apiFetch('POST', '/hazards', { type, lat: position.coords.latitude, lon: position.coords.longitude });
      closeSheet();
      showToast(`${HAZARD_TYPES[type].label} reported.`);
      await loadNearbyHazards(hazard.lat, hazard.lon);
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      if (errorEl) { errorEl.textContent = HAZARD_ERROR_MESSAGES[code] || 'Could not report that hazard. Try again.'; errorEl.hidden = false; }
    } finally {
      chips?.forEach((chip) => { chip.disabled = false; });
    }
  }

  function visibleMapRiders() {
    const list = state.activeRide
      ? (state.activeRide.members || []).filter((member) => member.riderId !== state.profile.riderId)
      : nearbyRiders;
    return list.map((person, index) => ({ ...person, x: 35 + index * 30, y: 43 + index * 15 }));
  }

  function renderMapRiders() {
    renderHazardMarkers();
    const riders = visibleMapRiders();
    if (!map || usingFallbackMap) return renderFallbackMarkers(riders);
    mapMarkers.forEach((marker) => marker.setMap(null));
    const centre = map.getCenter()?.toJSON() || { lat: 51.564, lng: -0.106 };
    const offsets = [[.004, -.006], [-.003, .006], [.008, .004]];
    mapMarkers = riders.map((person, index) => {
      // In a ride, real coordinates come from GET /rides/:id/locations
      // (see syncRideLocationSharing) — plot those once they've arrived,
      // and only fall back to an illustrative offset for a member who
      // just joined and hasn't sent their first location ping yet. The
      // public nearby-riders case never has a real coordinate to plot (by
      // design — see the comment above HAZARD_OFFSETS), so it always uses
      // the illustrative offset.
      const real = state.activeRide && rideMemberLocations.get(person.riderId);
      const position = real
        ? { lat: real.lat, lng: real.lon }
        : { lat: centre.lat + offsets[index % offsets.length][0], lng: centre.lng + offsets[index % offsets.length][1] };
      return addMapMarker(person, position, false);
    });
  }

  function selectRider(riderId, people = nearbyRiders) {
    if (riderId === state.profile.riderId) {
      state.selectedRiderId = null;
      $('#riderCard').hidden = true;
      renderMapRiders();
      return;
    }
    const person = people.find((item) => item.riderId === riderId) || nearbyRiders.find((item) => item.riderId === riderId);
    if (!person) return;
    state.selectedRiderId = person.riderId;
    hideDestinationCard();
    const card = $('#riderCard');
    card.innerHTML = `${avatar(person)}<div class="rider-card-copy"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status || 'Connected')}</span></div><button class="compact-button" data-view-friend>View</button>`;
    card.hidden = false;
    $('[data-view-friend]', card).addEventListener('click', () => { navigate('friends'); card.hidden = true; });
    renderFallbackMarkers(people.filter((item) => item.riderId !== state.profile.riderId));
  }

  function renderFriends() {
    const query = $('#friendSearch').value.trim().toLowerCase();
    const friends = state.friends.filter((friend) => [friend.displayName, friend.handle, friend.riderId].some((value) => value.toLowerCase().includes(query)));
    $('#requestList').innerHTML = state.requests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></div><div class="request-actions"><button class="decline" data-decline="${escapeHtml(person.id)}" aria-label="Decline ${escapeHtml(person.displayName)}">×</button><button class="accept" data-accept="${escapeHtml(person.id)}" aria-label="Accept ${escapeHtml(person.displayName)}">✓</button></div></article>`).join('');
    $('#friendList').innerHTML = friends.map((person) => `<button class="friend-row" data-friend="${escapeHtml(person.riderId)}">${avatar(person)}<span class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></span><span class="chevron">${icon('chevron')}</span></button>`).join('');
    const hasFriends = state.friends.length > 0;
    const hasVisibleFriends = friends.length > 0;
    const hasRequests = state.requests.length > 0;
    const empty = $('#friendEmpty');
    $('#requestSection').hidden = !hasRequests;
    $('#friendSection').hidden = !hasVisibleFriends;
    empty.hidden = hasVisibleFriends;
    $('#friendEmptyTitle').textContent = query ? 'No matching friends' : 'Build your riding circle';
    $('#friendEmptyCopy').textContent = query
      ? 'Try a different name, handle or Rider ID.'
      : 'Add someone you know using their Rider ID. Only accepted friends become part of your network.';
    $('#friendEmptyAction').hidden = Boolean(query) || hasFriends;
    const count = $('#friendsCountBadge');
    if (count) {
      count.textContent = String(state.friends.length);
      count.hidden = !hasFriends;
    }
    const requestCount = $('#requestsCountBadge');
    if (requestCount) requestCount.textContent = String(state.requests.length);
    $('#networkFriendCount').textContent = String(state.friends.length);
    $('#networkRequestCount').textContent = String(state.requests.length);
    const navBadge = $('#friendsNavBadge');
    if (navBadge) { navBadge.textContent = String(state.requests.length); navBadge.hidden = state.requests.length === 0; }
    $$('[data-accept]').forEach((button) => button.addEventListener('click', () => acceptRequest(button.dataset.accept)));
    $$('[data-decline]').forEach((button) => button.addEventListener('click', () => declineRequest(button.dataset.decline)));
    $$('[data-friend]').forEach((button) => button.addEventListener('click', () => openFriendProfile(button.dataset.friend)));
  }

  async function openFriendProfile(riderId) {
    const friend = state.friends.find((person) => person.riderId === riderId);
    if (!friend) return;
    let profile = friend;
    try {
      profile = await apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`);
    } catch {
      // The friendship itself is still valid if optional public-profile data
      // cannot be refreshed. Show the identity already loaded with the list.
    }
    const socialLinks = [
      profile.instagramUsername ? `<a class="social-link" href="https://www.instagram.com/${encodeURIComponent(profile.instagramUsername)}/" target="_blank" rel="noopener"><span>Instagram</span><strong>@${escapeHtml(profile.instagramUsername)}</strong>${icon('chevron')}</a>` : '',
      profile.tiktokUsername ? `<a class="social-link" href="https://www.tiktok.com/@${encodeURIComponent(profile.tiktokUsername)}" target="_blank" rel="noopener"><span>TikTok</span><strong>@${escapeHtml(profile.tiktokUsername)}</strong>${icon('chevron')}</a>` : '',
    ].filter(Boolean).join('');
    presentSheet(friend.displayName, `<article class="friend-profile-card">${avatar({ ...friend, avatarId: profile.avatarId || friend.avatarId })}<div><strong>${escapeHtml(friend.displayName)}</strong><span>${escapeHtml(friend.handle)}</span><small>Connected rider</small></div></article>
      ${socialLinks ? `<div class="social-links">${socialLinks}</div>` : '<p class="friend-profile-note">This rider has not shared any social links with you.</p>'}
      <button class="button secondary wide" id="copyFriendId">Copy Rider ID</button>
      <p class="caption">Only connect and arrange rides with people you trust. Social links follow each rider’s privacy settings.</p>`, () => {
      $('#copyFriendId').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(riderId); showToast('Rider ID copied.'); }
        catch { showToast(riderId); }
      });
    });
  }

  /**
   * Resolves a list of bare rider IDs (all a ride roster or a presence
   * "in zone with" response carries) into display-ready {riderId,
   * displayName, handle} via GET /profiles/:id — one lookup per ID, same
   * as loadFriendsData() below does for incoming friend requests. Ride
   * rosters and nearby-rider lists are always small, so N lookups here is
   * fine. Falls back to showing the bare ID for a lookup that fails
   * (blocked, or the rider vanished) rather than dropping that rider
   * entirely.
   */
  async function resolveRiderProfiles(riderIds) {
    return Promise.all(riderIds.map(async (riderId) => {
      try {
        const profile = await apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`);
        return { riderId, displayName: profile.displayName, handle: profile.handle };
      } catch {
        return { riderId, displayName: riderId, handle: riderId };
      }
    }));
  }

  /**
   * Loads the rider's real friends + incoming/outgoing requests from the
   * backend (GET /riders/:id/friends, GET /riders/:id/friend-requests).
   * Incoming requests only carry the other rider's ID, so their display
   * name/handle is filled in with a lightweight public-profile lookup per
   * request — friend lists are small, so N lookups here is fine.
   */
  async function loadFriendsData() {
    if (!state.profile.riderId) return;
    try {
      const [friendsResult, requestsResult] = await Promise.all([
        apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friends`),
        apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friend-requests`),
      ]);
      state.friends = friendsResult.friends.map((friend) => ({ riderId: friend.riderId, displayName: friend.displayName, handle: friend.handle, status: 'Connected' }));
      const incoming = requestsResult.incoming.filter((request) => request.status === 'pending');
      state.requests = await Promise.all(incoming.map(async (request) => {
        try {
          const profile = await apiFetch('GET', `/profiles/${encodeURIComponent(request.fromRiderId)}`);
          return { id: request.id, riderId: request.fromRiderId, displayName: profile.displayName, handle: profile.handle, status: 'Wants to connect' };
        } catch {
          return { id: request.id, riderId: request.fromRiderId, displayName: request.fromRiderId, handle: request.fromRiderId, status: 'Wants to connect' };
        }
      }));
      persist();
      renderFriends();
    } catch (error) {
      showToast('Could not load friends. ' + authErrorMessage(error));
    }
  }

  async function acceptRequest(requestId) {
    try {
      const result = await apiFetch('POST', `/friends/requests/${encodeURIComponent(requestId)}/accept`, {});
      state.requests = state.requests.filter((request) => request.id !== requestId);
      state.friends.push({ riderId: result.friend.riderId, displayName: result.friend.displayName, handle: result.friend.handle, status: 'Connected now' });
      persist();
      renderFriends();
      showToast(`${result.friend.displayName} added to friends.`);
    } catch {
      showToast('Could not accept that request. Try again.');
    }
  }

  async function declineRequest(requestId) {
    try {
      await apiFetch('POST', `/friends/requests/${encodeURIComponent(requestId)}/decline`, {});
      state.requests = state.requests.filter((request) => request.id !== requestId);
      persist();
      renderFriends();
      showToast('Request declined.');
    } catch {
      showToast('Could not decline that request. Try again.');
    }
  }

  const FRIEND_REQUEST_ERROR_MESSAGES = {
    cannot_friend_yourself: 'You can’t send a friend request to yourself.',
    rider_not_found: 'No rider with that ID exists.',
    blocked: 'You can’t send a request to this rider.',
    already_requested: 'A request is already pending with this rider.',
    already_friends: 'You’re already friends with this rider.',
  };

  async function sendFriendRequest(riderId) {
    try {
      await apiFetch('POST', '/friends/requests', { toRiderId: riderId });
      $('#friendFeedback').textContent = 'Request sent. We’ll show it here when they respond.';
      loadFriendsData();
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      $('#friendFeedback').textContent = FRIEND_REQUEST_ERROR_MESSAGES[code] || 'Could not send that request. Try again.';
    }
  }

  const VEHICLE_FILTER_ORDER = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];

  function isAutomatedTestRoute(route) {
    const searchable = `${route.name || ''} ${route.description || ''}`.toLowerCase();
    return searchable.includes('e2e test route') || searchable.includes('created end-to-end by playwright');
  }

  function renderRouteFilters() {
    const filtersEl = $('#routeVehicleFilters');
    filtersEl.innerHTML = ['all', ...VEHICLE_FILTER_ORDER].map((key) => {
      const active = (state.routeVehicleFilter ?? 'all') === key;
      const label = key === 'all' ? 'All vehicles' : VEHICLE_LABELS[key];
      return `<button class="chip${active ? ' active' : ''}" data-vehicle-filter="${key}">${escapeHtml(label)}</button>`;
    }).join('');
    $$('[data-vehicle-filter]', filtersEl).forEach((button) => button.addEventListener('click', () => {
      state.routeVehicleFilter = button.dataset.vehicleFilter === 'all' ? null : button.dataset.vehicleFilter;
      persist();
      renderRouteFilters();
      loadRoutes();
    }));
  }

  function renderRouteList() {
    $('#routeEmpty').hidden = routes.length > 0;
    $('#routeList').innerHTML = routes.map((route) => {
      const stars = Array.from({ length: 5 }, (_, i) => `<svg class="star${i < route.scenicRating ? ' filled' : ''}"><use href="#i-star"/></svg>`).join('');
      const badges = [
        ROAD_TYPE_LABELS[route.roadType],
        DIFFICULTY_LABELS[route.difficulty],
        `${route.distanceMiles} mi`,
        `${Math.round(route.estimatedDurationMinutes)} min`,
        `${SURFACE_LABELS[route.surfaceQuality]} surface`,
        route.avoidsTolls ? 'No tolls' : null,
        route.avoidsMotorways ? 'No motorways' : null,
      ].filter(Boolean).map((label) => `<span class="badge">${escapeHtml(label)}</span>`).join('');
      const notices = route.safetyNotices.length
        ? `<div class="safety-box"><svg><use href="#i-shield"/></svg><div>${route.safetyNotices.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</div></div>`
        : '';
      return `<article class="route-card" data-delete-route="${escapeHtml(route.id)}">
        <div class="route-card-head"><div><strong>${escapeHtml(route.name)}</strong><div class="star-row">${stars}</div></div>${route.createdBy === state.profile.riderId ? '<button class="icon-button" data-delete-route-btn aria-label="Delete route"><svg><use href="#i-reset"/></svg></button>' : ''}</div>
        <p class="secondary">${escapeHtml(route.description)}</p>
        <div class="badge-row">${badges}</div>
        <p class="caption">Suited for: ${route.vehicleSuitability.map((v) => VEHICLE_LABELS[v]).join(', ')}</p>
        ${notices}
        <a class="button tertiary" href="https://maps.google.com/?q=${route.startLat},${route.startLon}" target="_blank" rel="noopener">Open start in Maps</a>
      </article>`;
    }).join('');
    $$('[data-delete-route-btn]', $('#routeList')).forEach((button) => button.addEventListener('click', async (event) => {
      const card = event.target.closest('[data-delete-route]');
      const routeId = card?.dataset.deleteRoute;
      if (!routeId || !window.confirm('Delete this route?')) return;
      try {
        await apiFetch('DELETE', `/scenic-routes/${encodeURIComponent(routeId)}`);
        routes = routes.filter((route) => route.id !== routeId);
        renderRouteList();
        showToast('Route deleted.');
      } catch {
        showToast('Could not delete that route. Try again.');
      }
    }));
  }

  /** Loads real user-submitted scenic routes (GET /scenic-routes), passing
   * the current vehicle filter as the backend's own vehicleCategory query
   * param rather than filtering a locally cached list. */
  async function loadRoutes() {
    try {
      const query = state.routeVehicleFilter ? `?vehicleCategory=${encodeURIComponent(state.routeVehicleFilter)}` : '';
      const result = await apiFetch('GET', `/scenic-routes${query}`);
      // Automated browser checks previously wrote a fixture to the live route
      // store. Never present known test fixtures as rider recommendations.
      routes = result.routes.filter((route) => !isAutomatedTestRoute(route));
    } catch (error) {
      showToast('Could not load routes. ' + authErrorMessage(error));
    }
    renderRouteList();
  }

  function renderRoutes() {
    renderRouteFilters();
    loadRoutes();
  }

  function renderRide() {
    const active = Boolean(state.activeRide);
    $('#rideJoinState').hidden = active;
    $('#rideActiveState').hidden = !active;
    $('#rideShareTop').hidden = !active;
    $('#ridePill').hidden = !active;
    syncRideLocationSharing();
    if (!active) return;
    const ride = state.activeRide;
    const members = ride.members || ride.memberIds.map((riderId) => ({ riderId, displayName: riderId, handle: riderId }));
    $('#activeRideCode').textContent = ride.code;
    $('#ridePillCode').textContent = ride.code;
    $('#rideRole').textContent = ride.isHost ? 'host' : 'member';
    $('#memberCount').textContent = String(members.length);
    const pillCount = $('#ridePill .pill-count');
    if (pillCount) pillCount.textContent = String(members.length);
    $('#leaveRideBtn').textContent = ride.isHost ? 'End ride' : 'Leave ride';
    $('#rideRoster').innerHTML = members.map((person) => `<article class="roster-row">${avatar(person, 'small')}<div class="identity"><strong>${escapeHtml(person.displayName)}${person.riderId === state.profile.riderId ? ' · You' : ''}</strong><span>${escapeHtml(person.handle)}</span></div><span class="roster-status">${escapeHtml(person.riderId === ride.createdBy ? 'Host · connected' : 'Connected')}</span></article>`).join('');
    renderMapRiders();
  }

  /**
   * Fetches display info for the active ride's current member IDs (GET
   * /profiles/:id, same lookup-per-id pattern as loadFriendsData) and
   * re-renders. Called after every real ride action below, since the
   * roster comes straight from the backend rather than being invented
   * client-side.
   */
  async function loadRideRoster() {
    if (!state.activeRide) return;
    state.activeRide.members = await resolveRiderProfiles(state.activeRide.memberIds);
    persist();
    renderRide();
  }

  /**
   * Re-syncs the active ride with the backend (GET /rides/:id) — used on
   * returning to the Ride screen, since another member could have joined,
   * left, or the host could have ended the ride while this device was
   * elsewhere. A 404/403 means the ride is gone or this rider was removed
   * from it, so the local "active ride" state is cleared to match reality.
   */
  async function refreshActiveRide() {
    if (!state.activeRide) return;
    try {
      const ride = await apiFetch('GET', `/rides/${encodeURIComponent(state.activeRide.rideId)}`);
      state.activeRide.memberIds = ride.memberIds;
      state.activeRide.createdBy = ride.createdBy;
      state.activeRide.isHost = ride.createdBy === state.profile.riderId;
      persist();
      await loadRideRoster();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
        state.activeRide = null;
        state.selectedRiderId = null;
        persist();
        renderRide();
        renderMapRiders();
        showToast('That ride is no longer active.');
      }
    }
  }

  const RIDE_ERROR_MESSAGES = {
    invalid_or_expired: 'That invite code is invalid or has expired.',
    ride_full: 'This ride is full (max 20 riders).',
    rate_limited: 'Too many attempts — please wait a moment and try again.',
  };

  /** Creates a real private ride (POST /rides) — the backend returns the
   * real ride ID and a fresh six-character share code. */
  async function createRide() {
    const button = $('#createRideBtn');
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const result = await apiFetch('POST', '/rides', {});
      state.activeRide = { rideId: result.rideId, code: result.code, isHost: true, createdBy: result.createdBy, memberIds: result.memberIds };
      state.selectedRiderId = null;
      persist();
      renderRide();
      navigate('ride');
      showToast('Your private ride is ready.');
      await loadRideRoster();
    } catch {
      showToast('Could not create a ride. Try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Create private ride';
    }
  }

  /** Joins a real ride by its share code (POST /rides/join), then fetches
   * the ride's full membership (GET /rides/:id) — the join response only
   * carries the new rideId. Surfaces the backend's real ride_full (409) and
   * invalid/expired-code errors inline instead of guessing at them. */
  async function joinRideByCode(code) {
    const errorEl = $('#rideError');
    const button = $('#joinRideForm button[type="submit"]');
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Joining…';
    try {
      const joined = await apiFetch('POST', '/rides/join', { code });
      const ride = await apiFetch('GET', `/rides/${encodeURIComponent(joined.rideId)}`);
      state.activeRide = { rideId: ride.rideId, code, isHost: ride.createdBy === state.profile.riderId, createdBy: ride.createdBy, memberIds: ride.memberIds };
      state.selectedRiderId = null;
      persist();
      renderRide();
      navigate('ride');
      showToast('You joined the ride.');
      await loadRideRoster();
    } catch (error) {
      const code2 = error instanceof ApiError ? error.body?.error : undefined;
      errorEl.textContent = RIDE_ERROR_MESSAGES[code2] || 'Could not join that ride. Try again.';
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Join';
    }
  }

  /** Ends (host, DELETE /rides/:id) or leaves (member, POST
   * /rides/:id/leave) the active ride for real. The backend rejects a
   * host's own leaveRide call (a ride's host can only end it, not leave
   * it) — see rideStore.ts — so which call to make is picked from the
   * ride's real createdBy, not from client-side role bookkeeping. */
  async function endRide() {
    if (!state.activeRide) return;
    const ride = state.activeRide;
    const message = ride.isHost ? 'End this ride for everyone?' : 'Leave this ride?';
    if (!window.confirm(message)) return;
    try {
      if (ride.isHost) await apiFetch('DELETE', `/rides/${encodeURIComponent(ride.rideId)}`);
      else await apiFetch('POST', `/rides/${encodeURIComponent(ride.rideId)}/leave`, {});
      state.activeRide = null;
      state.selectedRiderId = null;
      persist();
      renderRide();
      renderMapRiders();
      showToast(ride.isHost ? 'Ride ended.' : 'You left the ride.');
    } catch {
      showToast(ride.isHost ? 'Could not end the ride. Try again.' : 'Could not leave the ride. Try again.');
    }
  }

  async function shareRide() {
    if (!state.activeRide) return;
    const text = `Join my Rider Comms group ride with code ${state.activeRide.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Rider Comms invite', text });
      else {
        await navigator.clipboard.writeText(state.activeRide.code);
        showToast('Ride code copied.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Could not open sharing.');
    }
  }

  function openSheet(type) {
    const templates = {
      profile: () => ({
        title: 'Account & profile',
        body: `<div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div><div class="form-field"><label for="editInstagram">Instagram username</label><input id="editInstagram" maxlength="30" value="${escapeHtml(state.profile.instagram)}" placeholder="your_username"></div><div class="form-field"><label for="editTiktok">TikTok username</label><input id="editTiktok" maxlength="30" value="${escapeHtml(state.profile.tiktok)}" placeholder="your_username"></div><div class="form-field"><label for="socialVisibility">Who can see your socials?</label><select id="socialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save profile</button>`,
        ready: () => {
          $('#socialVisibility').value = state.profile.socialsVisibility;
          $('#saveProfile').addEventListener('click', saveProfile);
        },
      }),
      plans: () => ({
        title: 'Subscription & billing',
        body: `<div class="plan-card current"><div class="plan-top"><strong>Free</strong><span class="plan-pill">Current</span></div><p>1-mile mutual rider radius and private Group Rides.</p><button class="button secondary wide" disabled>Current plan</button></div><div class="plan-card"><div class="plan-top"><strong>Premium</strong><span>6 mi</span></div><p>A wider radius for groups that spread out across city routes.</p><button class="button primary wide" data-purchase>Choose Premium</button></div><div class="plan-card"><div class="plan-top"><strong>Premium+</strong><span>20 mi</span></div><p>Maximum discovery range for touring and rural rides.</p><button class="button primary wide" data-purchase>Choose Premium+</button></div><button class="button tertiary wide" data-purchase>Restore purchases</button><p class="caption">Your plan is verified by Rider Comms. Purchases remain unavailable until store products and receipt validation are active.</p>`,
        ready: () => $$('[data-purchase]').forEach((button) => button.addEventListener('click', () => showToast('Purchases are temporarily unavailable.'))),
      }),
      privacy: () => ({ title: 'Privacy & visibility', body: toggleMarkup('shareLocation', 'Share location while live', 'Nearby riders see your location only while you choose to go live.', state.profile.shareLocation) + `<div class="form-field"><label for="sheetSocialVisibility">Social links visibility</label><select id="sheetSocialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div>`, ready: () => { $('#sheetSocialVisibility').value = state.profile.socialsVisibility; $('#sheetSocialVisibility').addEventListener('change', (event) => { patchProfile({ instagramVisibility: event.target.value, tiktokVisibility: event.target.value }); }); wireToggles(); } }),
      map: () => ({ title: 'Map & location', body: toggleMarkup('shareLocation', 'Location sharing', 'Location is requested only when you activate the nearby-rider channel.', state.profile.shareLocation) + `<p class="caption">Google Maps uses a deployment-provided browser key. If the service is unavailable, Rider Comms keeps controls accessible and shows a simplified map surface.</p>`, ready: wireToggles }),
      units: () => ({ title: 'Distance units', body: `<div class="form-field"><label for="unitSelect">Preferred unit</label><select id="unitSelect"><option value="mi">Miles</option><option value="km">Kilometres</option></select></div>`, ready: () => { $('#unitSelect').value = state.unit; $('#unitSelect').addEventListener('change', (event) => { state.unit = event.target.value; persist(); showToast('Distance unit updated.'); }); } }),
      notifications: () => ({ title: 'Notifications', body: toggleMarkup('notifications', 'Ride and message alerts', 'Receive useful updates while Rider Comms is not in the foreground.', state.notifications), ready: wireToggles }),
      safety: () => ({ title: 'Safety & privacy', body: `<h3>Designed for low distraction</h3><p class="secondary">Posting, profile editing and other visual tasks should be completed while stationary. Location sharing is off by default and can be stopped at any time.</p><h3>Emergency awareness</h3><p class="secondary">Rider Comms is not an emergency service. Always follow local road rules and use your vehicle controls safely.</p>` }),
      addRoute: () => ({
        title: 'Add a scenic route',
        body: `<p class="caption">Only add routes and safety notes you can vouch for yourself.</p>
          <div class="form-field"><label for="routeName">Route name</label><input id="routeName" maxlength="80"></div>
          <div class="form-field"><label for="routeDescription">Description</label><textarea id="routeDescription" maxlength="500" rows="3"></textarea></div>
          <div class="form-field"><label>Vehicle suitability</label><div class="chip-row" id="routeVehicleChips">${VEHICLE_FILTER_ORDER.map((v) => `<button type="button" class="chip" data-vehicle="${v}">${escapeHtml(VEHICLE_LABELS[v])}</button>`).join('')}</div></div>
          <div class="form-field"><label for="routeType">Road type</label><select id="routeType">${Object.entries(ROAD_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeDistance">Distance (mi)</label><input id="routeDistance" type="number" min="0.1" step="0.1"></div>
          <div class="form-field"><label for="routeDuration">Duration (min)</label><input id="routeDuration" type="number" min="1" step="1"></div>
          <div class="form-field"><label for="routeDifficulty">Difficulty</label><select id="routeDifficulty">${Object.entries(DIFFICULTY_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeSurface">Surface quality</label><select id="routeSurface">${Object.entries(SURFACE_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeRating">Scenic rating (1-5)</label><input id="routeRating" type="number" min="1" max="5" step="1" value="3"></div>
          <div class="form-field"><label for="routeNotices">Safety notices (one per line, optional)</label><textarea id="routeNotices" rows="2"></textarea></div>
          <div class="form-field"><label for="routeStartLat">Start latitude</label><input id="routeStartLat" type="number" step="any"></div>
          <div class="form-field"><label for="routeStartLon">Start longitude</label><input id="routeStartLon" type="number" step="any"></div>
          <div class="form-field"><label for="routeEndLat">End latitude</label><input id="routeEndLat" type="number" step="any"></div>
          <div class="form-field"><label for="routeEndLon">End longitude</label><input id="routeEndLon" type="number" step="any"></div>
          <p id="routeFormError" class="inline-error" hidden></p>
          <button class="button primary wide" id="saveRoute">Save route</button>`,
        ready: () => {
          const selected = new Set();
          $$('[data-vehicle]', $('#routeVehicleChips')).forEach((chip) => chip.addEventListener('click', () => {
            const v = chip.dataset.vehicle;
            if (selected.has(v)) { selected.delete(v); chip.classList.remove('active'); }
            else { selected.add(v); chip.classList.add('active'); }
          }));
          $('#saveRoute').addEventListener('click', async () => {
            const errorEl = $('#routeFormError');
            errorEl.hidden = true;
            const name = $('#routeName').value.trim();
            const description = $('#routeDescription').value.trim();
            const distanceMiles = Number($('#routeDistance').value);
            const estimatedDurationMinutes = Number($('#routeDuration').value);
            const scenicRating = Number($('#routeRating').value);
            const startLat = Number($('#routeStartLat').value);
            const startLon = Number($('#routeStartLon').value);
            const endLat = Number($('#routeEndLat').value);
            const endLon = Number($('#routeEndLon').value);
            if (!name || !description) { errorEl.textContent = 'Add a name and description.'; errorEl.hidden = false; return; }
            if (selected.size === 0) { errorEl.textContent = 'Choose at least one vehicle type.'; errorEl.hidden = false; return; }
            if (!(distanceMiles > 0) || !(estimatedDurationMinutes > 0)) { errorEl.textContent = 'Distance and duration must be positive numbers.'; errorEl.hidden = false; return; }
            if (!(scenicRating >= 1 && scenicRating <= 5)) { errorEl.textContent = 'Scenic rating must be 1-5.'; errorEl.hidden = false; return; }
            if ([startLat, endLat].some((v) => Number.isNaN(v) || Math.abs(v) > 90) || [startLon, endLon].some((v) => Number.isNaN(v) || Math.abs(v) > 180)) {
              errorEl.textContent = 'Coordinates are invalid or out of range.'; errorEl.hidden = false; return;
            }
            const button = $('#saveRoute');
            button.disabled = true;
            button.textContent = 'Saving…';
            try {
              await apiFetch('POST', '/scenic-routes', {
                name, description,
                vehicleSuitability: [...selected],
                roadType: $('#routeType').value,
                distanceMiles, estimatedDurationMinutes,
                difficulty: $('#routeDifficulty').value,
                surfaceQuality: $('#routeSurface').value,
                avoidsTolls: false, avoidsMotorways: false,
                scenicRating,
                safetyNotices: $('#routeNotices').value.split('\n').map((s) => s.trim()).filter(Boolean),
                startLat, startLon, endLat, endLon,
              });
              closeSheet();
              showToast('Route added.');
              if (state.screen === 'routes') loadRoutes();
            } catch (error) {
              // The backend's own validateScenicRouteInput error strings
              // (e.g. "distanceMiles must be a positive number") are
              // already rider-readable, so they're shown as-is.
              const code = error instanceof ApiError ? error.body?.error : undefined;
              errorEl.textContent = typeof code === 'string' && code ? code : 'Could not save that route. Try again.';
              errorEl.hidden = false;
            } finally {
              button.disabled = false;
              button.textContent = 'Save route';
            }
          });
        },
      }),
      reportHazard: () => ({
        title: 'Report on the road',
        body: `<p class="caption">Let nearby riders know what's ahead. Reports fade out over time.</p><div class="hazard-type-grid" id="hazardTypeChips">${HAZARD_TYPE_ORDER.map((t) => `<button type="button" class="hazard-type-tile" data-hazard-type="${t}" style="--hazard:${HAZARD_TYPES[t].color}">${icon(HAZARD_TYPES[t].icon.replace(/^i-/, ''))}<span>${escapeHtml(HAZARD_TYPES[t].label)}</span></button>`).join('')}</div><p id="hazardFormError" class="inline-error" hidden></p>`,
        ready: () => {
          const chips = $$('[data-hazard-type]', $('#hazardTypeChips'));
          chips.forEach((chip) => chip.addEventListener('click', () => createHazard(chip.dataset.hazardType, chips)));
        },
      }),
    };
    const template = templates[type]?.();
    if (!template) return;
    presentSheet(template.title, template.body, template.ready);
  }

  function presentSheet(title, body, ready) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = body;
    $('#sheetBackdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    ready?.();
    $('#closeSheet').focus();
  }

  function toggleMarkup(key, title, description, active) {
    return `<div class="toggle-row"><span><strong>${escapeHtml(title)}</strong><span class="caption">${escapeHtml(description)}</span></span><button class="toggle" data-toggle="${escapeHtml(key)}" aria-label="${escapeHtml(title)}" aria-pressed="${active}"></button></div>`;
  }

  /** Persists one profile field via PUT /riders/:id/profile immediately —
   * used by toggles/selects that should save as soon as the rider flips
   * them, rather than waiting for a separate "Save" button. */
  async function patchProfile(update) {
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, update);
      applyRemoteProfile(profile);
      return true;
    } catch {
      showToast('Could not save that change. Try again.');
      return false;
    }
  }

  /**
   * Turning the "Notifications" toggle on used to just flip a local flag
   * with nothing behind it at the OS/browser level — no real permission
   * was ever requested, so the browser's own notification-permission
   * prompt (what a rider actually expects to see) never appeared. This is
   * the web equivalent of ensureNotificationPermission() in the mobile app
   * (mobile/src/notifications/permissions.ts) — same reasoning, same
   * caveat: there's still no push-delivery backend, so this only makes
   * the toggle correspond to a real permission grant.
   */
  function ensureWebNotificationPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    void Notification.requestPermission();
  }

  function wireToggles() {
    $$('[data-toggle]', $('#sheetBody')).forEach((button) => button.addEventListener('click', async () => {
      const key = button.dataset.toggle;
      const active = button.getAttribute('aria-pressed') !== 'true';
      if (key === 'notifications') {
        button.setAttribute('aria-pressed', String(active));
        state.notifications = active;
        persist();
        if (active) ensureWebNotificationPermission();
        return;
      }
      if (key === 'shareLocation') {
        button.disabled = true;
        const ok = await patchProfile({ shareLocation: active });
        button.disabled = false;
        if (ok) button.setAttribute('aria-pressed', String(active));
      }
    }));
  }

  async function saveProfile() {
    const errorEl = $('#profileFormError');
    const button = $('#saveProfile');
    errorEl.hidden = true;
    const displayName = $('#editName').value.trim();
    let handle = $('#editHandle').value.trim();
    if (!displayName) { errorEl.textContent = 'Add a display name.'; errorEl.hidden = false; return; }
    if (!handle.startsWith('@')) handle = `@${handle}`;
    if (!/^@[a-z0-9_]{3,24}$/i.test(handle)) { errorEl.textContent = 'Use 3–24 letters, numbers or underscores for your handle.'; errorEl.hidden = false; return; }
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        displayName,
        handle,
        instagramUsername: $('#editInstagram').value.trim().replace(/^@/, ''),
        tiktokUsername: $('#editTiktok').value.trim().replace(/^@/, ''),
        instagramVisibility: $('#socialVisibility').value,
        tiktokVisibility: $('#socialVisibility').value,
      });
      applyRemoteProfile(profile);
      renderFallbackMarkers();
      closeSheet();
      showToast('Profile updated.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      errorEl.textContent = typeof code === 'string' && code ? code.replace(/_/g, ' ') : 'Could not save your profile. Try again.';
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Save profile';
    }
  }

  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    document.body.style.overflow = '';
  }

  function renderMapStatus() {
    const active = state.publicLive && state.profile.shareLocation;
    const privateRide = Boolean(state.activeRide);
    $('#joinNearbyBtn').hidden = privateRide;
    $('#joinNearbyBtn').dataset.active = String(active);
    $('#joinNearbyBtn').lastElementChild.textContent = active ? 'Leave nearby' : 'Go live';
  }

  // Presence has to be refreshed periodically while live — the backend
  // (presenceStore.ts) drops a rider after ~30s with no ping, so a single
  // POST /presence on "Go live" would only ever produce a mutual match for
  // the ~30s window right after pressing the button. This mirrors what a
  // real always-on client does: keep sending its current fix on an
  // interval for as long as the rider stays live, well inside that
  // staleness window.
  const PRESENCE_REFRESH_MS = 20_000;
  let presenceRefreshTimer;

  function stopPresenceRefresh() {
    clearInterval(presenceRefreshTimer);
    presenceRefreshTimer = undefined;
  }

  /** Sends one real presence ping (POST /presence) with the given
   * position and resolves the backend's real inZoneWith rider IDs to
   * display info (same GET /profiles/:id lookup as the ride roster). */
  async function sendPresence(position) {
    const result = await apiFetch('POST', '/presence', { lat: position.coords.latitude, lon: position.coords.longitude });
    nearbyRiders = await resolveRiderProfiles(result.inZoneWith);
    if (!state.activeRide) renderMapRiders();
    return result;
  }

  // Real hands-free proximity voice chat — the same mechanism the mobile
  // app's useVoiceActivity.ts uses (stay muted, keep measuring real mic
  // volume, unmute on real speech, re-mute after a short hangtime), ported
  // to the browser: livekit-client's browser build ships the same
  // stopMicTrackOnMute:false default the mobile app's research confirmed
  // (muting only stops sending, never stops hardware capture), so the same
  // loop works here. The one genuine difference from mobile: there's no
  // native on-device volume analyzer in a browser, so the level comes from
  // a real Web Audio AnalyserNode reading the actual mic MediaStreamTrack
  // instead — same real signal, different (also real) source.
  let voiceRoom;
  let voiceAudioContext;
  let voiceAnalyser;
  let voiceLevelFrame;
  let voiceReleaseTimer;
  let voiceManuallyMuted = false;
  let voiceIsSpeaking = false;
  let liveKitLoadPromise;

  const VOICE_SPEAKING_THRESHOLD = 0.06; // same starting point as mobile's SPEAKING_VOLUME_THRESHOLD — unverified against real riding noise
  const VOICE_RELEASE_HANGTIME_MS = 500;

  function loadLiveKitClient() {
    if (window.LivekitClient) return Promise.resolve();
    if (liveKitLoadPromise) return liveKitLoadPromise;
    liveKitLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // Pinned to the exact version this app's backend token-minting was
      // built and tested against (see backend/src/liveKitToken.ts) — lazy
      // loaded, like Google Maps above, so riders who never go live don't
      // pay for it.
      script.src = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { liveKitLoadPromise = undefined; reject(new Error('voice_library_unavailable')); };
      document.head.appendChild(script);
    });
    return liveKitLoadPromise;
  }

  function renderVoiceStatus() {
    const btn = $('#voiceStatusBtn');
    const connected = Boolean(voiceRoom);
    btn.hidden = !connected;
    btn.classList.toggle('talking', connected && voiceIsSpeaking);
    btn.classList.toggle('muted', connected && voiceManuallyMuted);
    btn.setAttribute('aria-label', voiceManuallyMuted ? 'Proximity voice muted — tap to unmute' : voiceIsSpeaking ? 'Talking' : 'Listening — hands-free');
  }

  function setVoiceSpeaking(speaking) {
    if (voiceIsSpeaking === speaking) return;
    voiceIsSpeaking = speaking;
    void voiceRoom?.localParticipant.setMicrophoneEnabled(speaking).catch(() => {});
    renderVoiceStatus();
  }

  function handleVoiceVolume(rms) {
    if (voiceManuallyMuted) { setVoiceSpeaking(false); return; }
    if (rms > VOICE_SPEAKING_THRESHOLD) {
      if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
      setVoiceSpeaking(true);
    } else if (!voiceReleaseTimer) {
      voiceReleaseTimer = setTimeout(() => { voiceReleaseTimer = undefined; setVoiceSpeaking(false); }, VOICE_RELEASE_HANGTIME_MS);
    }
  }

  function startVoiceLevelLoop(mediaStreamTrack) {
    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceAudioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    voiceAnalyser = voiceAudioContext.createAnalyser();
    voiceAnalyser.fftSize = 512;
    source.connect(voiceAnalyser);
    const data = new Uint8Array(voiceAnalyser.frequencyBinCount);
    const tick = () => {
      if (!voiceAnalyser) return;
      voiceAnalyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSquares += v * v; }
      handleVoiceVolume(Math.sqrt(sumSquares / data.length));
      voiceLevelFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Called right after "Go live" actually succeeds (see toggleNearby
   * below) — mints a real token scoped to the rider's own current
   * presence bucket (POST /voice/token {target:'channel'}, see
   * server.ts, which derives the room from the rider's own last-known
   * presence rather than trusting a client-supplied one) and connects for
   * real. Best-effort: a rider should still be visible nearby even if
   * voice fails to connect (no LiveKit configured on the backend, mic
   * permission denied, etc.), so failures here are logged, not surfaced
   * as a blocking error over the whole "go live" action. */
  async function startProximityVoice() {
    if (voiceRoom) return;
    try {
      await loadLiveKitClient();
      const { token, url } = await apiFetch('POST', '/voice/token', { target: 'channel' });
      const room = new window.LivekitClient.Room();
      await room.connect(url, token);
      voiceManuallyMuted = false;
      const publication = await room.localParticipant.setMicrophoneEnabled(true);
      voiceRoom = room;
      const mediaStreamTrack = publication?.track?.mediaStreamTrack;
      if (mediaStreamTrack) startVoiceLevelLoop(mediaStreamTrack);
      renderVoiceStatus();
    } catch (error) {
      console.warn('[rider-comms] Could not connect proximity voice chat', error);
      voiceRoom = undefined;
      renderVoiceStatus();
    }
  }

  function stopProximityVoice() {
    if (voiceLevelFrame) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = undefined; }
    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    voiceAnalyser = undefined;
    if (voiceAudioContext) { void voiceAudioContext.close().catch(() => {}); voiceAudioContext = undefined; }
    if (voiceRoom) { void voiceRoom.disconnect(); voiceRoom = undefined; }
    voiceIsSpeaking = false;
    renderVoiceStatus();
  }

  function toggleVoiceMute() {
    if (!voiceRoom) return;
    voiceManuallyMuted = !voiceManuallyMuted;
    if (voiceManuallyMuted) setVoiceSpeaking(false);
    renderVoiceStatus();
  }

  /**
   * "Go live" / "Leave nearby": real presence, backed by POST/DELETE
   * /presence — not a local-only flag flip. The backend requires
   * profile.shareLocation to be true before it will accept a presence
   * ping (see server.ts's /presence handler, which 403s with
   * location_sharing_disabled otherwise), so going live also turns that
   * profile setting on for real via patchProfile/PUT profile — the same
   * request the Settings > Privacy toggle already makes — rather than
   * silently reusing a client-side copy the backend never saw. Going
   * offline intentionally leaves that profile setting as the rider left
   * it; "Go live" is a per-session action, while shareLocation is a
   * standing privacy preference the rider controls separately in
   * Settings. Real hands-free proximity voice chat (see startProximityVoice
   * above) is tied to the same on/off action — going live for presence and
   * being reachable by voice are the same moment, not two separate steps.
   */
  async function toggleNearby() {
    if (state.publicLive) {
      stopPresenceRefresh();
      stopProximityVoice();
      try { await apiFetch('DELETE', '/presence'); } catch { /* best effort — still go offline locally */ }
      state.publicLive = false;
      nearbyRiders = [];
      persist();
      renderMapStatus();
      renderMapRiders();
      showToast('You are no longer visible nearby.');
      return;
    }
    let position;
    try {
      position = await currentPosition();
    } catch {
      $('#mapError').hidden = false;
      $('#mapError span').textContent = 'Location permission is needed to join riders nearby. You can still browse the map.';
      return;
    }
    try {
      if (!state.profile.shareLocation) {
        const ok = await patchProfile({ shareLocation: true });
        if (!ok) throw new Error('could_not_enable_location_sharing');
      }
      await sendPresence(position);
      state.publicLive = true;
      persist();
      renderMapStatus();
      centreMap(position.coords.latitude, position.coords.longitude);
      showToast('You are visible to nearby riders.');
      void startProximityVoice();
      presenceRefreshTimer = setInterval(async () => {
        try {
          const nextPosition = await currentPosition();
          await sendPresence(nextPosition);
        } catch { /* a transient miss is fine — the next tick retries */ }
      }, PRESENCE_REFRESH_MS);
    } catch (error) {
      state.publicLive = false;
      persist();
      renderMapStatus();
      $('#mapError').hidden = false;
      const code = error instanceof ApiError ? error.body?.error : undefined;
      $('#mapError span').textContent = code === 'location_sharing_disabled'
        ? 'Enable location sharing in Settings to go live.'
        : 'Could not go live. Try again.';
    }
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });
  }

  const RIDE_LOCATION_REFRESH_MS = 10_000; // same 5-10s cadence as public presence (see PRESENCE_REFRESH_MS)
  let rideLocationTimer;

  /**
   * Keeps this rider's own location POST-ed to the active ride
   * (POST /rides/:id/location) and every member's real location fetched
   * (GET /rides/:id/locations) for as long as a ride is active — this is
   * always-on for ride members, unlike public presence, which stays gated
   * on profile.shareLocation (see the 0014_create_ride_locations migration
   * note in backend/src/db.ts for why they're separate mechanisms). Called
   * from renderRide(), which already runs after every ride-state change
   * (create, join, end, refreshActiveRide, and once on app start), so
   * there's one place that starts/stops this rather than a call at every
   * site that sets or clears state.activeRide.
   */
  function syncRideLocationSharing() {
    if (state.activeRide) {
      if (rideLocationTimer) return;
      const tick = async () => {
        const ride = state.activeRide;
        if (!ride) return;
        try {
          const position = await currentPosition();
          await apiFetch('POST', `/rides/${encodeURIComponent(ride.rideId)}/location`, {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
          const { locations } = await apiFetch('GET', `/rides/${encodeURIComponent(ride.rideId)}/locations`);
          rideMemberLocations = new Map(locations.map((entry) => [entry.riderId, entry]));
          if (state.activeRide) renderMapRiders();
        } catch {
          // Best-effort, same as the public presence refresh above — a
          // missed tick (denied permission, a transient network blip)
          // just tries again next interval rather than surfacing an error
          // banner over the whole ride.
        }
      };
      void tick();
      rideLocationTimer = setInterval(tick, RIDE_LOCATION_REFRESH_MS);
    } else if (rideLocationTimer) {
      clearInterval(rideLocationTimer);
      rideLocationTimer = undefined;
      rideMemberLocations = new Map();
    }
  }

  async function locate() {
    try {
      const position = await currentPosition();
      centreMap(position.coords.latitude, position.coords.longitude);
      showToast('Map centred on your location.');
    } catch {
      $('#mapError').hidden = false;
      $('#mapError span').textContent = 'Allow location access to centre the map on your position.';
    }
  }

  function centreMap(lat, lng) {
    if (map) {
      map.panTo({ lat, lng });
      map.setZoom(15);
      userMapMarker?.setPosition({ lat, lng });
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
    input.placeholder = 'Search offline for now';
    $('.search-slot')?.classList.add('offline');
  }

  function initPlaceSearch() {
    const input = $('#placeSearchInput');
    const autocomplete = new google.maps.places.Autocomplete(input, {
      fields: ['name', 'formatted_address', 'geometry'],
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const location = place?.geometry?.location;
      if (!location) return;
      centreMap(location.lat(), location.lng());
      setDestinationMarker(location, place.name);
      showToast(place.name ? `Centred on ${place.name}` : 'Centred on selected place.');
      input.blur();
    });
  }

  /**
   * "Navigate" hands off to the device's own maps app via Google's
   * universal cross-platform link (opens the native Google Maps app if
   * installed, Apple Maps' own equivalent isn't needed since this link
   * still opens fine in a browser tab otherwise) — turn-by-turn routing
   * itself isn't something this app owns or renders; that's a real,
   * working "start navigating there" action without pretending to be a
   * navigation SDK this app doesn't have.
   */
  function navigationHref(lat, lng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }

  function hideDestinationCard() {
    $('#destinationCard').hidden = true;
  }

  function showDestinationCard(location, label) {
    $('#riderCard').hidden = true;
    $('#hazardCard').hidden = true;
    const lat = location.lat();
    const lng = location.lng();
    const card = $('#destinationCard');
    card.innerHTML = `<span class="avatar" style="--avatar:#ff7a1a" aria-hidden="true"><svg><use href="#i-location"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(label || 'Selected place')}</strong><span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div><a class="compact-button" href="${navigationHref(lat, lng)}" target="_blank" rel="noopener noreferrer">Navigate</a><button class="icon-button" aria-label="Dismiss destination" data-dismiss-destination>×</button>`;
    card.hidden = false;
    $('[data-dismiss-destination]', card).addEventListener('click', () => {
      hideDestinationCard();
      destinationMarker?.setMap(null);
      destinationMarker = undefined;
    });
  }

  function setDestinationMarker(location, label) {
    destinationMarker?.setMap(null);
    destinationMarker = new google.maps.Marker({
      map,
      position: location,
      title: label || 'Selected place',
      icon: pinIcon('#ff7a1a'),
      animation: google.maps.Animation.DROP,
      zIndex: 9,
    });
    destinationMarker.addListener('click', () => showDestinationCard(location, label));
    showDestinationCard(location, label);
  }

  function initialiseGoogleMap() {
    // London fallback — used only until a real GPS fix resolves below. The
    // map has to render with *some* centre immediately rather than block
    // on geolocation (which can take a few seconds, or never resolve if
    // permission is denied), but a rider should never be left looking at
    // this as if it were their real position.
    const centre = { lat: 51.564, lng: -0.106 };
    map = new google.maps.Map($('#googleMap'), {
      center: centre,
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      backgroundColor: prefersDarkMode() ? '#101820' : '#f4f1ec',
      styles: prefersDarkMode() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
    });
    usingFallbackMap = false;
    $('#fallbackMap').hidden = true;
    $('#fallbackMarkers').hidden = true;
    $('#hazardMarkers').hidden = true;
    $('#mapError').hidden = true;
    renderMapStatus();
    initPlaceSearch();
    userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, centre, true);
    const offsets = [[.004, -.006], [-.003, .006], [.008, .004]];
    mapMarkers = visibleMapRiders().map((person, index) => addMapMarker(person, { lat: centre.lat + offsets[index % offsets.length][0], lng: centre.lng + offsets[index % offsets.length][1] }, false));
    renderMapHazards();

    // As soon as a real fix comes back, silently recentre on it and move
    // "you" there — the same real coordinate locate()/"Go live" already
    // use, just fetched proactively on load instead of waiting for the
    // rider to tap something. A denied/unavailable permission just leaves
    // the London fallback in place; locate() and "Go live" both prompt
    // again if the rider tries either.
    currentPosition().then((position) => {
      centreMap(position.coords.latitude, position.coords.longitude);
    }).catch(() => {});
  }

  function addMapMarker(person, position, current) {
    const marker = new google.maps.Marker({
      map,
      position,
      title: current ? 'Your location' : person.displayName,
      label: { text: initials(person.displayName), color: '#ffffff', fontWeight: '700', fontSize: '12px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: current ? 22 : 19, fillColor: identityColor(person.riderId), fillOpacity: 1, strokeColor: current ? '#ff7a1a' : '#e9eef5', strokeWeight: current ? 5 : 3 },
      zIndex: current ? 10 : 5,
    });
    marker.addListener('click', () => selectRider(person.riderId, visibleMapRiders()));
    return marker;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      const watch = (worker) => worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) $('#updateBanner').hidden = false;
      });
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update(); });
      $('#reloadApp').addEventListener('click', () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }));
    }).catch(() => {});
  }

  function bindEvents() {
    $$('[data-nav]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.nav)));
    window.addEventListener('popstate', () => navigate(location.hash.slice(1) || 'map', false));
    $$('[data-ride-mode]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-ride-mode]').forEach((item) => item.classList.toggle('active', item === button));
      const host = button.dataset.rideMode === 'host';
      $('#joinRideForm').hidden = host;
      $('#hostRideForm').hidden = !host;
    }));
    $('#joinRideForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = $('#rideCode').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        $('#rideError').textContent = 'Enter a valid six-character ride code.';
        $('#rideError').hidden = false;
        return;
      }
      joinRideByCode(code);
    });
    $('#rideCode').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6); });
    $('#createRideBtn').addEventListener('click', createRide);
    $('#leaveRideBtn').addEventListener('click', endRide);
    $('#shareRideBtn').addEventListener('click', shareRide);
    $('#rideShareTop').addEventListener('click', shareRide);
    $('#copyRideCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.activeRide.code); showToast('Ride code copied.'); } catch { shareRide(); } });
    $('#openRideMap').addEventListener('click', () => navigate('map'));
    $('#ridePill').addEventListener('click', () => navigate('ride'));
    $('#friendSearch').addEventListener('input', renderFriends);
    $('#addFriendToggle').addEventListener('click', () => { $('#addFriendForm').hidden = !$('#addFriendForm').hidden; if (!$('#addFriendForm').hidden) $('#friendId').focus(); });
    $('#friendEmptyAction').addEventListener('click', () => {
      $('#addFriendForm').hidden = false;
      $('#friendId').focus();
    });
    $('#addFriendForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const riderId = $('#friendId').value.trim().toLowerCase();
      if (!/^rider_[a-z0-9_]{4,30}$/.test(riderId)) { $('#friendFeedback').textContent = 'Enter a complete Rider ID, including rider_.'; return; }
      if (riderId === state.profile.riderId) { $('#friendFeedback').textContent = FRIEND_REQUEST_ERROR_MESSAGES.cannot_friend_yourself; return; }
      $('#friendFeedback').textContent = 'Sending…';
      sendFriendRequest(riderId);
      $('#friendId').value = '';
    });
    $$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.sheet)));
    $('#completeProfilePrompt').addEventListener('click', () => openSheet('profile'));
    $('#editProfileBtn').addEventListener('click', () => openSheet('profile'));
    $('#addRouteBtn').addEventListener('click', () => openSheet('addRoute'));
    $('#reportHazardBtn').addEventListener('click', () => openSheet('reportHazard'));
    $('#closeSheet').addEventListener('click', closeSheet);
    $('#sheetBackdrop').addEventListener('click', (event) => { if (event.target === $('#sheetBackdrop')) closeSheet(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheet(); });
    $('#logoutBtn').addEventListener('click', async () => {
      if (!window.confirm('Log out of Rider Comms on this device?')) return;
      try {
        await apiFetch('POST', '/auth/logout');
      } catch {
        // Local sign-out must still complete when the API is unavailable.
      } finally {
        clearSession();
        location.reload();
      }
    });
    $('#locateBtn').addEventListener('click', locate);
    $('#joinNearbyBtn').addEventListener('click', toggleNearby);
    $('#voiceStatusBtn').addEventListener('click', toggleVoiceMute);
    $('[aria-label="Open profile"]').addEventListener('click', () => navigate('settings'));
  }

  // --- Auth screen -----------------------------------------------------
  // Real signup/login against the backend's Postgres-backed accounts
  // (POST /auth/signup, POST /auth/login) — the app has no fixed local
  // identity anymore; every rider signs in for real before seeing the app.

  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

  function showAuthScreen() {
    $('#app').hidden = true;
    $('#authScreen').hidden = false;
  }

  function hideAuthScreen() {
    $('#authScreen').hidden = true;
    $('#app').hidden = false;
  }

  const AUTH_ERROR_MESSAGES = {
    username_taken: 'That username is already taken.',
    email_taken: 'That email is already registered.',
    invalid_username: 'Usernames must be 3–20 letters, numbers or underscores.',
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Passwords must be at least 8 characters.',
    invalid_credentials: 'Incorrect username or password.',
    rate_limited: 'Too many attempts — please wait a moment and try again.',
    network_error: 'Could not reach Rider Comms. Check your connection and try again.',
    timed_out: 'The request timed out. Please try again.',
  };

  function authErrorMessage(error) {
    const code = error instanceof ApiError ? error.body?.error : undefined;
    return AUTH_ERROR_MESSAGES[code] || 'Something went wrong. Please try again.';
  }

  function applyAuthenticatedIdentity(riderId, username) {
    state.profile.riderId = riderId;
    if (!state.profile.displayName) state.profile.displayName = username;
    if (!state.profile.handle) state.profile.handle = `@${username}`;
    persist();
  }

  function applyRemoteProfile(profile) {
    state.profile.riderId = profile.riderId;
    state.profile.displayName = profile.displayName;
    state.profile.handle = profile.handle;
    state.profile.instagram = profile.instagramUsername;
    state.profile.tiktok = profile.tiktokUsername;
    state.profile.socialsVisibility = profile.instagramVisibility;
    state.profile.shareLocation = profile.shareLocation;
    persist();
    renderProfile();
    renderMapStatus();
  }

  /** Loads the rider's real profile from the backend (GET /riders/:id/profile). */
  async function loadProfile() {
    try {
      const profile = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`);
      applyRemoteProfile(profile);
    } catch {
      showToast('Could not load your profile from the server.');
    }
  }

  /**
   * Replaces the backend's generic default profile ('Rider' / '@rider')
   * with one derived from the username just chosen at signup — the
   * account is brand new, so there is nothing real to overwrite yet.
   */
  async function seedProfileFromUsername(username) {
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        displayName: username,
        handle: `@${username}`,
      });
      applyRemoteProfile(profile);
    } catch (error) {
      // Non-fatal — the account still exists and works with the backend's
      // own default profile; the rider can fix the name later in Settings.
      // Logged loudly (not just swallowed) since a silent failure here is
      // exactly how an account ends up permanently stuck on the generic
      // "Rider"/"@rider" default with no visible trace of why.
      console.warn('[rider-comms] Could not seed a real display name after signup', error);
      showToast('Account created — set your display name in Settings.');
    }
  }

  async function doLogin(username, password) {
    const errorEl = $('#loginError');
    const button = $('#loginSubmit');
    errorEl.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Logging in…';
    try {
      const result = await apiFetch('POST', '/auth/login', { username, password });
      saveSession({ riderId: result.riderId, token: result.token });
      applyAuthenticatedIdentity(result.riderId, username);
      hideAuthScreen();
      startApp();
      loadProfile();
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Log in';
    }
  }

  async function doSignup(username, email, password) {
    const errorEl = $('#signupError');
    const button = $('#signupSubmit');
    errorEl.hidden = true;
    if (!USERNAME_PATTERN.test(username)) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.invalid_username;
      errorEl.hidden = false;
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.weak_password;
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Creating account…';
    try {
      const result = await apiFetch('POST', '/auth/signup', { username, email, password });
      saveSession({ riderId: result.riderId, token: result.token });
      applyAuthenticatedIdentity(result.riderId, username);
      hideAuthScreen();
      startApp();
      showToast(result.emailVerificationSent
        ? 'Account created. Check your email to verify it.'
        : 'Account created. Email verification is temporarily unavailable.');
      await seedProfileFromUsername(username);
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Create account';
    }
  }

  let authFormsWired = false;
  function wireAuthForms() {
    if (authFormsWired) return;
    authFormsWired = true;
    const authCopy = {
      login: {
        eyebrow: 'Welcome back',
        title: 'Ready for the next ride?',
        description: 'Sign in to find nearby riders, rejoin your group and keep your riding circle close.',
      },
      signup: {
        eyebrow: 'Join the community',
        title: 'Your ride starts here.',
        description: 'Create your Rider Comms identity and connect with riders you choose.',
      },
    };

    function setAuthMode(button, moveFocus = true) {
      const signup = button.dataset.authMode === 'signup';
      $$('[data-auth-mode]').forEach((item) => {
        item.classList.toggle('active', item === button);
        item.setAttribute('aria-selected', String(item === button));
        item.tabIndex = item === button ? 0 : -1;
      });
      $('#loginForm').hidden = signup;
      $('#signupForm').hidden = !signup;
      $('#loginForm').setAttribute('aria-hidden', String(signup));
      $('#signupForm').setAttribute('aria-hidden', String(!signup));
      $('#loginError').hidden = true;
      $('#signupError').hidden = true;
      const copy = signup ? authCopy.signup : authCopy.login;
      $('#authEyebrow').textContent = copy.eyebrow;
      $('#authTitle').textContent = copy.title;
      $('#authDescription').textContent = copy.description;
      if (moveFocus) (signup ? $('#signupUsername') : $('#loginUsername')).focus();
    }

    $$('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => setAuthMode(button));
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const target = button.dataset.authMode === 'signup' ? $('#loginTab') : $('#signupTab');
        setAuthMode(target);
        target.focus();
      });
    });
    $$('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      const use = button.querySelector('use');
      if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }));
    $('#loginForm').addEventListener('submit', (event) => {
      event.preventDefault();
      doLogin($('#loginUsername').value.trim(), $('#loginPassword').value);
    });
    $('#signupForm').addEventListener('submit', (event) => {
      event.preventDefault();
      doSignup($('#signupUsername').value.trim(), $('#signupEmail').value.trim(), $('#signupPassword').value);
    });
  }

  async function consumeEmailVerificationLink() {
    const params = new URLSearchParams(location.search);
    const token = params.get('verifyToken');
    if (!token) return null;
    params.delete('verifyToken');
    const remaining = params.toString();
    history.replaceState({}, '', `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
    try {
      await apiFetch('POST', '/auth/verify-email', { token });
      return { ok: true, message: 'Email verified. Your Rider Comms account is ready.' };
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      return {
        ok: false,
        message: code === 'expired_token'
          ? 'That verification link has expired. Sign in and request a new one.'
          : code === 'invalid_token'
            ? 'That verification link is invalid or has already been used.'
            : 'Email verification could not be completed. Check your connection and try the link again.',
      };
    }
  }

  // The app's real init, run once a session (existing or freshly created)
  // is available. Safe to call more than once per page load conceptually,
  // but bindEvents() is only ever invoked from here so it only runs once.
  function startApp() {
    const label = $('#logoutRiderId');
    if (label) label.textContent = state.profile.riderId ? `Signed in as ${state.profile.riderId}` : 'Sign out of this account';
    bindEvents();
    applyColorScheme();
    renderProfile();
    renderFriends();
    renderRide();
    renderMapStatus();
    renderFallbackMarkers();
    renderHazardMarkers();
    navigate(location.hash.slice(1) || state.screen || 'map', false);
    loadGoogleMaps();
    registerServiceWorker();
    loadFriendsData();
    // Covers riders who never touch the toggle (it defaults to "on" — see
    // the state object's `notifications: true` default), not just the
    // ones who flip it from off to on via wireToggles above.
    if (state.notifications) ensureWebNotificationPermission();
  }

  async function init() {
    const verification = await consumeEmailVerificationLink();
    if (!session) {
      wireAuthForms();
      showAuthScreen();
      if (verification) {
        const notice = $('#authNotice');
        notice.textContent = verification.message;
        notice.classList.toggle('error', !verification.ok);
        notice.hidden = false;
      }
      return;
    }
    try {
      const identity = await apiFetch('GET', '/auth/me');
      if (identity.riderId !== session.riderId) {
        clearSession();
        location.reload();
        return;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        wireAuthForms();
        showAuthScreen();
        const notice = $('#authNotice');
        notice.textContent = 'Your saved session could not be checked. Check your connection and try again.';
        notice.classList.add('error');
        notice.hidden = false;
      }
      return;
    }
    applyAuthenticatedIdentity(session.riderId, state.profile.displayName || session.riderId);
    hideAuthScreen();
    startApp();
    loadProfile();
    if (verification) showToast(verification.message);
  }

  void init();
})();
