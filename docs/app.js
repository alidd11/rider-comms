(() => {
  'use strict';

  // CSS display-mode handles first paint in standards-compliant browsers.
  // navigator.standalone covers installed iOS PWAs that do not report the
  // media query consistently after a cold launch.
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  const syncStandaloneMode = () => {
    const isStandalone = standaloneMedia?.matches || window.navigator.standalone === true;
    document.documentElement.classList.toggle('pwa-standalone', Boolean(isStandalone));
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
    notifications: false,
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
    { elementType: 'geometry', stylers: [{ color: '#19191b' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#19191b' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9b9893' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2d' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#353539' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#10252b' }] },
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
      backgroundColor: prefersDarkMode() ? '#0e0e0f' : '#f4f1ec',
    });
  }
  darkModeQuery?.addEventListener('change', applyColorScheme);


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
  let lastSheetTrigger = null;
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
    syncHazardRefresh(screen === 'map');
    if (screen === 'friends') loadFriendsData();
    if (screen === 'ride') refreshActiveRide();
  }

  function renderProfile() {
    $('#profileName').textContent = state.profile.displayName;
    $('#profileHandle').textContent = state.profile.handle;
    $('#profileRiderId').textContent = state.profile.riderId;
    $('#distanceUnitsSummary').textContent = state.unit === 'km' ? 'Kilometres' : 'Miles';
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
    if (!hazard) { card.hidden = true; return; }
    const meta = HAZARD_TYPES[hazard.type];
    hideDestinationCard();
    card.innerHTML = `<span class="avatar" style="--avatar:${meta.color}" aria-hidden="true"><svg><use href="#${meta.icon}"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(meta.label)}</strong><span>Reported ${timeAgo(hazard.createdAt)}</span><div class="hazard-vote-row"><button class="compact-button" data-vote="confirm">Still there (${hazard.confirmations})</button><button class="compact-button" data-vote="deny">Gone (${hazard.denials})</button></div></div><button class="icon-button" aria-label="Dismiss" data-dismiss-hazard>×</button>`;
    card.hidden = false;
    $('[data-vote="confirm"]', card).addEventListener('click', () => voteHazard(hazardId, 'confirm'));
    $('[data-vote="deny"]', card).addEventListener('click', () => voteHazard(hazardId, 'deny'));
    $('[data-dismiss-hazard]', card).addEventListener('click', () => { card.hidden = true; });
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
    } catch (error) {
      if (errorEl) { errorEl.textContent = locationAccessMessage(error, 'report a hazard'); errorEl.hidden = false; }
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
      : 'Use the add button above to connect by handle or Rider ID.';
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

  function renderRide() {
    const active = Boolean(state.activeRide);
    $('#rideJoinState').hidden = active;
    $('#rideActiveState').hidden = !active;
    $('#rideShareTop').hidden = !active;
    $('#ridePill').hidden = !active;
    syncRideLocationSharing();
    syncVoiceConnection();
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
      await preflightMicrophoneAccess();
      await preflightRideLocationAccess();
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
      await preflightMicrophoneAccess();
      await preflightRideLocationAccess();
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
        title: 'Edit profile',
        body: `<div class="settings-sheet-section"><span class="settings-sheet-label">Identity</span><div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Rider handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div></div><div class="settings-sheet-section"><span class="settings-sheet-label">Connected profiles</span><div class="form-field"><label for="editInstagram">Instagram</label><input id="editInstagram" maxlength="30" value="${escapeHtml(state.profile.instagram)}" placeholder="Username"></div><div class="form-field"><label for="editTiktok">TikTok</label><input id="editTiktok" maxlength="30" value="${escapeHtml(state.profile.tiktok)}" placeholder="Username"></div><p class="caption">Control who can see these in Privacy controls.</p></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save changes</button>`,
        ready: () => {
          $('#saveProfile').addEventListener('click', saveProfile);
        },
      }),
      plans: () => ({
        title: 'Plan and billing',
        body: `<div class="plan-card current"><div class="plan-top"><strong>Free</strong><span class="plan-pill">Current</span></div><p>1-mile mutual rider radius and private Group Rides.</p></div><div class="plan-card"><div class="plan-top"><strong>Premium</strong><span>6 mi</span></div><p>A wider radius for groups that spread out across city routes.</p><span class="caption">Not available yet</span></div><div class="plan-card"><div class="plan-top"><strong>Premium+</strong><span>20 mi</span></div><p>Maximum discovery range for touring and rural rides.</p><span class="caption">Not available yet</span></div><p class="caption">No payment details are requested until verified store billing is available.</p>`,
      }),
      privacy: () => ({ title: 'Privacy controls', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Live location', 'Visible to nearby riders only while you are live.', state.profile.shareLocation)}</div><div class="settings-sheet-section"><div class="form-field"><label for="sheetSocialVisibility">Connected profile visibility</label><select id="sheetSocialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><p class="caption">This applies to the Instagram and TikTok usernames on your profile.</p></div>`, ready: () => { $('#sheetSocialVisibility').value = state.profile.socialsVisibility; $('#sheetSocialVisibility').addEventListener('change', (event) => { patchProfile({ instagramVisibility: event.target.value, tiktokVisibility: event.target.value }); }); wireToggles(); } }),
      map: () => ({ title: 'Location and map', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Nearby rider visibility', 'Share your position only after you choose to go live.', state.profile.shareLocation)}</div><div class="settings-note"><strong>Location stays in your control</strong><p>Turning this off stops nearby-rider visibility. Private Group Ride members can still share ride locations while that ride is active.</p></div>`, ready: wireToggles }),
      units: () => ({ title: 'Distance units', body: `<div class="choice-list" role="radiogroup" aria-label="Distance units"><button data-unit-option="mi" role="radio"><span><strong>Miles</strong><small>Use miles and mph</small></span><i></i></button><button data-unit-option="km" role="radio"><span><strong>Kilometres</strong><small>Use kilometres and km/h</small></span><i></i></button></div>`, ready: () => { $$('[data-unit-option]', $('#sheetBody')).forEach((button) => { const active = button.dataset.unitOption === state.unit; button.setAttribute('aria-checked', String(active)); button.addEventListener('click', () => { state.unit = button.dataset.unitOption; persist(); openSheet('units'); showToast('Distance unit updated.'); }); }); } }),
      notifications: () => ({ title: 'Notifications', body: `<div class="settings-sheet-section">${toggleMarkup('notifications', 'Notification permission', 'Allow Rider Comms to use device notifications.', notificationSettingActive())}</div><div class="settings-note"><strong>Permission only</strong><p>Background ride and message delivery is not active yet. This control only manages browser permission.</p></div>`, ready: wireToggles }),
      safety: () => ({ title: 'Safety', body: `<div class="safety-guidance"><div><span class="setting-icon"><svg><use href="#i-ride"/></svg></span><span><strong>Set up while stationary</strong><small>Complete profile, route and group controls before moving.</small></span></div><div><span class="setting-icon"><svg><use href="#i-location"/></svg></span><span><strong>Control your location</strong><small>Nearby visibility can be stopped at any time.</small></span></div><div><span class="setting-icon"><svg><use href="#i-info"/></svg></span><span><strong>Not an emergency service</strong><small>Call the appropriate emergency service if you need urgent help.</small></span></div></div>` }),
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
    if ($('#sheetBackdrop').hidden) lastSheetTrigger = document.activeElement;
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

  function notificationPermission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  function notificationSettingActive() {
    return state.notifications && notificationPermission() === 'granted';
  }

  function syncNotificationPreference() {
    if (state.notifications && notificationPermission() !== 'granted') {
      state.notifications = false;
      persist();
    }
  }

  /** Notification permission must be requested directly from the Settings
   * tap. Installed iOS PWAs and other mobile browsers may suppress a prompt
   * started during app boot or after unrelated asynchronous work. */
  async function requestNotificationPermission() {
    const permission = notificationPermission();
    if (permission === 'unsupported') {
      showToast('Notifications are not supported by this browser.');
      return false;
    }
    if (permission === 'denied') {
      showToast('Notifications are blocked. Allow them in this site’s device settings.');
      return false;
    }
    if (permission === 'granted') return true;
    try {
      const granted = await Notification.requestPermission() === 'granted';
      if (!granted) showToast('Notification permission was not enabled.');
      return granted;
    } catch {
      showToast('Could not request notification permission.');
      return false;
    }
  }

  function wireToggles() {
    $$('[data-toggle]', $('#sheetBody')).forEach((button) => button.addEventListener('click', async () => {
      const key = button.dataset.toggle;
      const active = button.getAttribute('aria-pressed') !== 'true';
      if (key === 'notifications') {
        button.disabled = true;
        const granted = !active || await requestNotificationPermission();
        state.notifications = active && granted;
        persist();
        button.setAttribute('aria-pressed', String(state.notifications));
        button.disabled = false;
        return;
      }
      if (key === 'shareLocation') {
        button.disabled = true;
        if (active) {
          try {
            await currentPosition();
          } catch (error) {
            button.disabled = false;
            showToast(locationAccessMessage(error, 'share your location'));
            return;
          }
        }
        const ok = await patchProfile({ shareLocation: active });
        button.disabled = false;
        if (ok) {
          button.setAttribute('aria-pressed', String(active));
          if (active) syncRideLocationSharing();
        }
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
        instagramVisibility: state.profile.socialsVisibility,
        tiktokVisibility: state.profile.socialsVisibility,
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
    const trigger = lastSheetTrigger;
    $('#sheetBackdrop').hidden = true;
    document.body.style.overflow = '';
    lastSheetTrigger = null;
    trigger?.focus?.();
  }

  function renderMapStatus() {
    const active = state.publicLive && state.profile.shareLocation;
    const privateRide = Boolean(state.activeRide);
    const joinBtn = $('#joinNearbyBtn');
    joinBtn.hidden = privateRide;
    joinBtn.dataset.active = String(active);
    joinBtn.setAttribute('aria-label', active ? 'Leave nearby' : 'Go live nearby');
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
  // instead — same real signal, different (also real) source. Covers both
  // voice contexts the mobile app has: the public presence channel
  // ("Go live") and a private ride's own room (RideBar.tsx's equivalent),
  // via connectVoice(kind, rideId) below — see syncVoiceConnection for how
  // the two are picked between.
  let voiceRoom;
  let voiceTargetKey; // 'channel' or `ride:${rideId}` — identifies what voiceRoom is currently for, so re-syncs are idempotent
  let voiceMeterStream;
  let voiceAudioContext;
  let voiceAnalyser;
  let voiceLevelFrame;
  let voiceReleaseTimer;
  let voiceManuallyMuted = false;
  let voiceIsSpeaking = false;
  let liveKitLoadPromise;
  let microphonePermissionReady = false;
  let voiceFailureNotified = false;

  const VOICE_SPEAKING_THRESHOLD = 0.06; // same starting point as mobile's SPEAKING_VOLUME_THRESHOLD — unverified against real riding noise
  const VOICE_RELEASE_HANGTIME_MS = 500;

  function microphoneAccessMessage(error) {
    if (!navigator.mediaDevices?.getUserMedia) return 'Microphone access is not supported by this browser.';
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Microphone access is blocked. Allow it in this site’s device settings.';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'No microphone is available on this device.';
    }
    return 'Microphone access is unavailable right now.';
  }

  /** Ask while the rider is still inside the original Create, Join or Go
   * live tap. Waiting for API calls first loses the browser's user-gesture
   * allowance and can suppress the installed-PWA permission prompt. */
  async function preflightMicrophoneAccess() {
    if (microphonePermissionReady) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast(microphoneAccessMessage());
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphonePermissionReady = true;
      return true;
    } catch (error) {
      showToast(microphoneAccessMessage(error));
      return false;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

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

  /**
   * The rider's own avatar in the map header glows while they're actually
   * transmitting — same idea as a Discord/FaceTime speaking ring, and a
   * more legible "who's live" signal than a separate icon button off to
   * the side. A small badge on the avatar's corner (not the avatar itself,
   * so tapping the avatar still opens the profile sheet) is the only
   * manual override control, shown only once actually connected.
   */
  function renderVoiceStatus() {
    const avatar = $('#mapAvatarButton');
    const badge = $('#voiceStatusBtn');
    const connected = Boolean(voiceRoom);
    avatar.classList.toggle('voice-talking', connected && voiceIsSpeaking);
    avatar.classList.toggle('voice-muted', connected && voiceManuallyMuted);
    badge.hidden = !connected;
    badge.classList.toggle('talking', voiceIsSpeaking);
    badge.classList.toggle('muted', voiceManuallyMuted);
    const label = voiceManuallyMuted ? 'Muted — tap to unmute' : voiceIsSpeaking ? 'Talking' : 'Listening — hands-free';
    badge.setAttribute('aria-label', voiceManuallyMuted ? 'Proximity voice muted — tap to unmute' : voiceIsSpeaking ? 'Talking' : 'Listening — hands-free');
    // The Ride tab has no map header of its own (the glowing avatar above
    // only exists on the Map screen), so a rider parked on Ride while
    // talking needs this same status somewhere too — same real state,
    // same toggleVoiceMute control, just a text chip instead of a glow.
    const rideChip = $('#rideVoiceStatus');
    if (rideChip) {
      rideChip.hidden = !connected;
      rideChip.classList.toggle('talking', voiceIsSpeaking);
      rideChip.classList.toggle('muted', voiceManuallyMuted);
      const rideChipText = $('#rideVoiceStatusText', rideChip);
      if (rideChipText) rideChipText.textContent = label;
    }
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

  /**
   * Opens a SECOND, independent getUserMedia stream purely to measure
   * real speech volume — deliberately not the same MediaStreamTrack
   * LiveKit publishes and mutes. livekit-client's LocalTrack.mute() sets
   * `this._mediaStreamTrack.enabled = !muted` on the track it owns (see
   * node_modules/livekit-client's LocalTrack class) — and a browser zeros
   * out a MediaStreamTrack's samples for every consumer, Web Audio
   * included, the instant `.enabled` goes false. Analysing that published
   * track directly meant the very first time VOX muted it after an
   * utterance, the meter went silent forever and could never detect
   * speech again to unmute — exactly the "doesn't pick up my speech"
   * failure this replaces. A second stream from the same physical mic is
   * a completely separate MediaStreamTrack with its own `enabled` flag,
   * so muting LiveKit's copy never touches this one — same independence
   * mobile's native volume analyzer has from the RTC mute flag, just a
   * second real capture instead of a native module bypassing it.
   */
  async function startVoiceLevelLoop() {
    voiceMeterStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceAudioContext.createMediaStreamSource(voiceMeterStream);
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

  /**
   * Mints a real voice token for either the public presence channel
   * (POST /voice/token {target:'channel'} — the room is derived from the
   * rider's own last-known presence, see server.ts, never a client-
   * supplied one) or a private ride ({target:'ride', rideId} — the same
   * ride-voice endpoint the mobile app's RideBar.tsx already uses, see
   * backend/src/liveKitToken.ts) and connects for real. Best-effort in
   * both cases: a rider should still be visible nearby / still be in the
   * ride even if voice fails to connect (no LiveKit configured, mic
   * permission denied, etc.), so failures here are logged, not surfaced
   * as a blocking error over the action that triggered this. */
  async function connectVoice(kind, rideId) {
    if (voiceRoom) return;
    let room;
    try {
      await loadLiveKitClient();
      const body = kind === 'ride' ? { target: 'ride', rideId } : { target: 'channel' };
      const { token, url } = await apiFetch('POST', '/voice/token', body);
      room = new window.LivekitClient.Room();
      await room.connect(url, token);
      voiceManuallyMuted = false;
      await room.localParticipant.setMicrophoneEnabled(true);
      microphonePermissionReady = true;
      voiceRoom = room;
      voiceTargetKey = kind === 'ride' ? `ride:${rideId}` : 'channel';
      await startVoiceLevelLoop();
      voiceFailureNotified = false;
      renderVoiceStatus();
    } catch (error) {
      console.warn('[rider-comms] Could not connect voice chat', error);
      if (!voiceFailureNotified) {
        showToast(error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
          ? microphoneAccessMessage(error)
          : 'Voice chat is unavailable right now. Your ride and map still work.');
        voiceFailureNotified = true;
      }
      // Tear down anything that did connect before the failure (e.g. the
      // room connected fine but the second meter-stream getUserMedia call
      // failed) rather than leaking a live, published connection nothing
      // still references.
      if (room) void room.disconnect();
      voiceRoom = undefined;
      voiceTargetKey = undefined;
      renderVoiceStatus();
    }
  }

  function disconnectVoice() {
    if (voiceLevelFrame) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = undefined; }
    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    voiceAnalyser = undefined;
    if (voiceAudioContext) { void voiceAudioContext.close().catch(() => {}); voiceAudioContext = undefined; }
    if (voiceMeterStream) { voiceMeterStream.getTracks().forEach((track) => track.stop()); voiceMeterStream = undefined; }
    if (voiceRoom) { void voiceRoom.disconnect(); voiceRoom = undefined; }
    voiceTargetKey = undefined;
    voiceIsSpeaking = false;
    renderVoiceStatus();
  }

  /**
   * A private ride's voice takes priority over the public channel — you
   * can't be "live" on the public channel while in a ride anyway (see
   * renderMapStatus hiding #joinNearbyBtn during a ride), so this just
   * picks whichever applies and reconnects only when what should be
   * connected has actually changed (a same-ride/channel re-call is a
   * no-op, not a reconnect-and-drop-audio blip). Call this after any
   * change to state.activeRide or state.publicLive rather than calling
   * connectVoice/disconnectVoice directly at each call site.
   */
  function syncVoiceConnection() {
    const desired = state.activeRide ? `ride:${state.activeRide.rideId}` : state.publicLive ? 'channel' : undefined;
    if (desired === voiceTargetKey) return;
    if (voiceRoom) disconnectVoice();
    // A restored session must not make getUserMedia prompt during boot.
    // Create, Join and Go live set this only from their direct tap.
    if (desired && !microphonePermissionReady) return;
    if (state.activeRide) void connectVoice('ride', state.activeRide.rideId);
    else if (state.publicLive) void connectVoice('channel');
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
   * Settings. Real hands-free proximity voice chat (see connectVoice
   * above) is tied to the same on/off action — going live for presence and
   * being reachable by voice are the same moment, not two separate steps.
   */
  async function toggleNearby() {
    if (state.publicLive) {
      stopPresenceRefresh();
      state.publicLive = false;
      syncVoiceConnection();
      try { await apiFetch('DELETE', '/presence'); } catch { /* best effort — still go offline locally */ }
      nearbyRiders = [];
      persist();
      renderMapStatus();
      renderMapRiders();
      showToast('You are no longer visible nearby.');
      return;
    }
    await preflightMicrophoneAccess();
    let position;
    try {
      position = await currentPosition();
    } catch (error) {
      // Denied/unavailable location is a transient, recoverable thing —
      // the real Google Map is still up and fine. #mapError's "Map
      // unavailable" heading is for when the map itself has actually
      // failed to load (see handleGoogleMapsFailure below), and it never
      // auto-dismisses, so reusing it here left a permanent, misleading
      // "Map unavailable" banner sitting over a perfectly working map for
      // the rest of the session.
      showToast(locationAccessMessage(error, 'join riders nearby'));
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
      syncVoiceConnection();
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
      const code = error instanceof ApiError ? error.body?.error : undefined;
      showToast(code === 'location_sharing_disabled'
        ? 'Enable location sharing in Settings to go live.'
        : 'Could not go live. Try again.');
    }
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
      navigator.geolocation.getCurrentPosition((position) => {
        locationPermissionReady = true;
        resolve(position);
      }, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });
  }

  let locationPermissionReady = false;

  function locationAccessMessage(error, purpose = 'use your location') {
    if (!navigator.geolocation) return 'Location is not supported by this browser.';
    if (error?.code === 1 || error?.name === 'NotAllowedError') {
      return `Location access is blocked. Allow it in this site’s device settings to ${purpose}.`;
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
      syncRideLocationSharing();
      showToast('Map centred on your location.');
    } catch (error) {
      showToast(locationAccessMessage(error, 'centre the map'));
    }
  }

  function centreMap(lat, lng) {
    if (map) {
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
    input.placeholder = 'Search offline for now';
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

  // Recent-place shortcuts (Google Maps/Waze pattern: the empty search
  // screen shows where you've been, not a blank page) — kept client-side
  // only, newest first, deduped by placeId, capped so the list stays a
  // quick glance rather than a scrollable history.
  const RECENT_SEARCHES_KEY = 'riderComms.recentSearches';
  const RECENT_SEARCHES_MAX = 6;

  function loadRecentSearches() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveRecentSearch(entry) {
    try {
      const existing = loadRecentSearches().filter((item) => item.placeId !== entry.placeId);
      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([entry, ...existing].slice(0, RECENT_SEARCHES_MAX)));
    } catch {
      // Private-mode/quota storage failures just mean no recent list — not fatal.
    }
  }

  function clearRecentSearches() {
    try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* ignore */ }
    renderRecentOrHint();
  }

  function openSearchScreen() {
    if ($('#mapSearchSlot')?.classList.contains('offline')) return;
    clearPoiMarkers();
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

  function selectRecentSearch(item) {
    if (!item) return;
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
    if (place.placeId) {
      saveRecentSearch({
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
      panToPlace(lat, lng);
      setDestinationMarker(location, place.name, place.formatted_address);
      showToast(place.name ? `Centred on ${place.name}` : 'Centred on selected place.');
      saveRecentSearch({ placeId, name: place.name || 'Selected place', secondary: place.formatted_address || '', lat, lng });
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
   * more" the way Google Maps/Waze's own category rows do.
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

  function showDestinationCard(location, label, address) {
    $('#riderCard').hidden = true;
    $('#hazardCard').hidden = true;
    const lat = location.lat();
    const lng = location.lng();
    const card = $('#destinationCard');
    const secondary = address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    card.innerHTML = `<div class="destination-card-top"><span class="avatar" style="--avatar:#ff2d5a" aria-hidden="true"><svg><use href="#i-location"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(label || 'Selected place')}</strong><span>${escapeHtml(secondary)}</span></div></div><div class="destination-card-actions"><button class="compact-button" data-start-nav>Start</button><a class="icon-button" href="${navigationHref(lat, lng)}" target="_blank" rel="noopener noreferrer" aria-label="Open in Maps app"><svg><use href="#i-share"/></svg></a><button class="icon-button" aria-label="Dismiss destination" data-dismiss-destination>×</button></div>`;
    card.hidden = false;
    $('[data-start-nav]', card).addEventListener('click', () => void startInAppNavigation(location, label));
    $('[data-dismiss-destination]', card).addEventListener('click', () => {
      hideDestinationCard();
      destinationMarker?.setMap(null);
      destinationMarker = undefined;
    });
  }

  function setDestinationMarker(location, label, address) {
    destinationMarker?.setMap(null);
    destinationMarker = new google.maps.Marker({
      map,
      position: location,
      title: label || 'Selected place',
      icon: pinIcon('#ff2d5a'),
      animation: google.maps.Animation.DROP,
      zIndex: 9,
    });
    destinationMarker.addListener('click', () => showDestinationCard(location, label, address));
    showDestinationCard(location, label, address);
  }

  // Real in-app turn-by-turn navigation — the point of an "all in one
  // biker app" is not having to bounce out to a separate maps app mid-
  // ride. Uses the real Google Directions API (google.maps.DirectionsService/
  // DirectionsRenderer — part of the same `libraries=places` Maps JS
  // script already loaded, no extra key or library needed) for the actual
  // route/steps, real watchPosition() GPS tracking to advance through
  // them, a real off-route distance check that triggers a real reroute,
  // and the browser's real SpeechSynthesis API for voice prompts — no
  // fake/simulated turn data anywhere in this. What's unverified: this
  // sandbox has no live Google Maps key or a real device to actually
  // drive a route with, so the exact arrival/off-route radii below are a
  // reasonable starting point, not tuned against a real ride.
  let directionsService;
  let directionsRenderer;
  let navSteps = [];
  let navStepIndex = 0;
  let navWatchId;
  let navDestination = null; // { lat, lng, label }
  let navLastAnnouncedStep = -1;
  let navOffRouteSince = null;
  let navRerouting = false;

  const NAV_STEP_ARRIVAL_RADIUS_M = 30;
  const NAV_OFF_ROUTE_RADIUS_M = 60;
  const NAV_OFF_ROUTE_GRACE_MS = 10_000;

  /** Plain equirectangular-projection distance — accurate enough over the
   * short (metres-to-low-kilometres) spans between a rider's real position
   * and a route step's endpoints/segment; no need for full geodesic math
   * at this scale, and no extra Maps `geometry` library to load for it. */
  function metersBetween(a, b) {
    const R = 6_371_000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Perpendicular distance from `point` to the segment `segStart`→`segEnd`,
   * in metres, via a local flat projection centred on segStart — same
   * "good enough over short spans" reasoning as metersBetween above. */
  function distanceToSegmentMeters(point, segStart, segEnd) {
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((point.lat * Math.PI) / 180);
    const toXY = (p) => ({ x: (p.lng - segStart.lng) * metersPerDegLng, y: (p.lat - segStart.lat) * metersPerDegLat });
    const p = toXY(point);
    const b = toXY(segEnd);
    const lengthSq = b.x * b.x + b.y * b.y;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSq)) : 0;
    const closest = { x: t * b.x, y: t * b.y };
    return Math.hypot(p.x - closest.x, p.y - closest.y);
  }

  // Google's Directions "instructions" field sometimes nests an advisory
  // note (a road restriction, a seasonal closure) in a child element
  // directly after the visible turn text, with no whitespace between
  // them in the source, e.g. `Turn left onto Yerbury Rd<div>May be
  // closed at certain times of day or year</div>`. Plain textContent
  // concatenates the two into one run-on word ("...RdMay be closed...")
  // -- both on screen and read aloud by the voice guidance below. Join
  // each direct child's text with a space instead of relying on
  // textContent's own (non-existent) whitespace handling.
  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = Array.from(div.childNodes).map((node) => node.textContent || '').join(' ');
    return text.replace(/\s+/g, ' ').trim();
  }

  /** Best-effort voice guidance — SpeechSynthesis isn't universally
   * available/enabled (older browsers, some in-app webviews), so a
   * missing/failing voice never blocks the real navigation logic, only
   * the audio announcement of it. */
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch { /* voice guidance is a nice-to-have, never blocks navigation */ }
  }

  function formatNavDistance(meters) {
    if (meters >= 1609.34) return `${(meters / 1609.34).toFixed(1)} mi`;
    return `${Math.round(meters * 3.28084 / 10) * 10} ft`;
  }

  function formatNavDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function formatArrivalTime(remainingSeconds) {
    return new Date(Date.now() + remainingSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // Google's DirectionsResult steps carry a `maneuver` field (turn-left,
  // roundabout-right, uturn-left, merge, fork-right, …) — real nav apps
  // (Google Maps, Waze) show a direction-specific arrow for this rather
  // than one generic "go" icon for every step, so a rider can tell a
  // sharp turn from a gentle one at a glance without reading the text.
  // There's no full icon set here, so this reuses the existing arrow (and
  // the existing loop-shaped reset icon for roundabouts) and rotates it —
  // close enough to convey direction without shipping ~15 new SVGs.
  const MANEUVER_PRESENTATIONS = {
    'turn-slight-left': { icon: 'i-nav-arrow', rotate: -30 },
    'turn-left': { icon: 'i-nav-arrow', rotate: -90 },
    'turn-sharp-left': { icon: 'i-nav-arrow', rotate: -135 },
    'uturn-left': { icon: 'i-nav-arrow', rotate: 180 },
    'turn-slight-right': { icon: 'i-nav-arrow', rotate: 30 },
    'turn-right': { icon: 'i-nav-arrow', rotate: 90 },
    'turn-sharp-right': { icon: 'i-nav-arrow', rotate: 135 },
    'uturn-right': { icon: 'i-nav-arrow', rotate: 180 },
    'roundabout-left': { icon: 'i-reset', rotate: -90 },
    'roundabout-right': { icon: 'i-reset', rotate: 90 },
    'fork-left': { icon: 'i-nav-arrow', rotate: -30 },
    'fork-right': { icon: 'i-nav-arrow', rotate: 30 },
    'ramp-left': { icon: 'i-nav-arrow', rotate: -30 },
    'ramp-right': { icon: 'i-nav-arrow', rotate: 30 },
    merge: { icon: 'i-nav-arrow', rotate: -20 },
  };

  function applyManeuverIcon(maneuver) {
    const presentation = MANEUVER_PRESENTATIONS[maneuver] || { icon: 'i-nav-arrow', rotate: 0 };
    $('#navManeuverSvg use').setAttribute('href', `#${presentation.icon}`);
    $('#navManeuverSvg').style.transform = `rotate(${presentation.rotate}deg)`;
  }

  function getDirectionsService() {
    if (!directionsService) directionsService = new google.maps.DirectionsService();
    return directionsService;
  }

  function getDirectionsRenderer() {
    if (!directionsRenderer) {
      directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: { strokeColor: '#ff2d5a', strokeWeight: 6, strokeOpacity: 0.9 },
      });
    }
    directionsRenderer.setMap(map);
    return directionsRenderer;
  }

  function renderNavStep() {
    const step = navSteps[navStepIndex];
    if (!step) return;
    applyManeuverIcon(step.maneuver);
    $('#navDistanceNext').textContent = formatNavDistance(step.distance.value);
    $('#navInstruction').textContent = stripHtml(step.instructions);
    // Google's own guidance is to surface the *next* maneuver ahead of
    // time rather than only at the moment it's due — a rider glancing at
    // the screen mid-turn should already know what's coming after it.
    const nextStep = navSteps[navStepIndex + 1];
    $('#navNextPreview').hidden = !nextStep;
    if (nextStep) $('#navNextInstruction').textContent = stripHtml(nextStep.instructions);
    let remainingMeters = 0;
    let remainingSeconds = 0;
    for (let i = navStepIndex; i < navSteps.length; i++) {
      remainingMeters += navSteps[i].distance.value;
      remainingSeconds += navSteps[i].duration.value;
    }
    $('#navDistance').textContent = formatNavDistance(remainingMeters);
    $('#navEta').textContent = formatNavDuration(remainingSeconds);
    $('#navArrival').textContent = formatArrivalTime(remainingSeconds);
    if (navLastAnnouncedStep !== navStepIndex) {
      navLastAnnouncedStep = navStepIndex;
      speak(stripHtml(step.instructions));
    }
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
      { origin, destination, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (status !== 'OK' || !result) {
          showToast('Could not calculate a route. Try again.');
          return;
        }
        applyRoute(result, destination, label);
      }
    );
  }

  // The CSS `.nav-mode` rules force a dark turn card/ETA bar regardless of
  // system theme, but the actual OS/browser chrome around the page — the
  // iOS status bar colour and the strip below the safe area — is driven by
  // these <meta name="theme-color"> tags, which still follow the system's
  // light/dark preference. In light mode that left a plain white band
  // directly under the dark nav UI. Force them dark while navigating and
  // restore whatever they were (light-mode "#ffffff" included) once it ends.
  function setNavChromeColor(active) {
    const metas = $$('meta[name="theme-color"]');
    if (active) {
      // applyRoute() re-runs on every reroute, not just the initial start —
      // guard against re-capturing the already-dark value as "original" on
      // a later reroute, which would otherwise leave it stuck dark forever.
      metas.forEach((meta) => {
        if (meta.dataset.preNavContent === undefined) meta.dataset.preNavContent = meta.getAttribute('content');
        // Must match the turn card/ETA bar's actual background,
        // not just the app's general background
        // is close but visibly different, which read as a seam rather
        // than a flush edge between the OS chrome and the app's own UI.
        meta.setAttribute('content', '#101011');
      });
    } else {
      metas.forEach((meta) => {
        if (meta.dataset.preNavContent === undefined) return;
        meta.setAttribute('content', meta.dataset.preNavContent);
        delete meta.dataset.preNavContent;
      });
    }
  }

  function applyRoute(result, destination, label) {
    const leg = result.routes[0]?.legs[0];
    if (!leg) { showToast('Could not calculate a route. Try again.'); return; }
    getDirectionsRenderer().setDirections(result);
    navSteps = leg.steps;
    navStepIndex = 0;
    navLastAnnouncedStep = -1;
    navOffRouteSince = null;
    navDestination = { ...destination, label };
    hideDestinationCard();
    destinationMarker?.setMap(null);
    destinationMarker = undefined;
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
    // rider actually needs mid-drive (report hazard, re-centre, end nav).
    $('#app').classList.add('nav-mode');
    setNavChromeColor(true);
    $('#navBanner').hidden = false;
    $('#navSummary').hidden = false;
    renderNavStep();
    startNavTracking();
  }

  function startNavTracking() {
    stopNavTracking();
    navWatchId = navigator.geolocation.watchPosition(handleNavPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
  }

  function stopNavTracking() {
    if (navWatchId !== undefined) {
      navigator.geolocation.clearWatch(navWatchId);
      navWatchId = undefined;
    }
  }

  function handleNavPosition(position) {
    if (navRerouting || !navSteps.length) return;
    const here = { lat: position.coords.latitude, lng: position.coords.longitude };
    centreMap(here.lat, here.lng);
    const step = navSteps[navStepIndex];
    if (!step) return;
    const stepEnd = { lat: step.end_location.lat(), lng: step.end_location.lng() };
    if (metersBetween(here, stepEnd) <= NAV_STEP_ARRIVAL_RADIUS_M) {
      if (navStepIndex < navSteps.length - 1) {
        navStepIndex += 1;
      } else {
        finishNavigation(true);
        return;
      }
    }
    renderNavStep();
    checkOffRoute(here, navSteps[navStepIndex]);
  }

  function checkOffRoute(here, step) {
    const stepStart = { lat: step.start_location.lat(), lng: step.start_location.lng() };
    const stepEnd = { lat: step.end_location.lat(), lng: step.end_location.lng() };
    const distanceToRoute = distanceToSegmentMeters(here, stepStart, stepEnd);
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
    showToast('Rerouting…');
    speak('Rerouting.');
    getDirectionsService().route(
      { origin: here, destination: { lat: navDestination.lat, lng: navDestination.lng }, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        navRerouting = false;
        if (status !== 'OK' || !result) return;
        applyRoute(result, { lat: navDestination.lat, lng: navDestination.lng }, navDestination.label);
      }
    );
  }

  function finishNavigation(arrived) {
    stopNavTracking();
    directionsRenderer?.setMap(null);
    navSteps = [];
    navStepIndex = 0;
    navDestination = null;
    navOffRouteSince = null;
    navRerouting = false;
    $('#navBanner').hidden = true;
    $('#navSummary').hidden = true;
    $('#app').classList.remove('nav-mode');
    setNavChromeColor(false);
    if (arrived) {
      showToast('You have arrived.');
      speak('You have arrived at your destination.');
    }
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

  }

  function addMapMarker(person, position, current) {
    const marker = new google.maps.Marker({
      map,
      position,
      title: current ? 'Your location' : person.displayName,
      // "You" gets a small, unlabelled dot — the same convention every
      // real map app (Google Maps, Waze, Uber) uses for the rider's own
      // position: precise, not a beach-ball with initials on it. Other
      // riders keep a (smaller than before) labelled dot, since telling
      // several nearby riders apart at a glance is the point there.
      ...(current ? {} : { label: { text: initials(person.displayName), color: '#ffffff', fontWeight: '700', fontSize: '9px' } }),
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        // A precise dot, not a beach-ball (see the earlier size pass) —
        // but 7 turned out to undershoot the other way and got hard to
        // spot at a glance. 10 with a slightly thicker ring keeps it
        // clearly the smallest/simplest shape on the map (still no
        // label, unlike other riders) while actually being visible.
        scale: current ? 10 : 9,
        fillColor: identityColor(person.riderId),
        fillOpacity: 1,
        strokeColor: current ? '#ffffff' : '#e9eef5',
        strokeWeight: current ? 3 : 2,
      },
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
    $('#addFriendForm').addEventListener('submit', (event) => {
      event.preventDefault();
      // A rider's handle (what they'd actually share, e.g. "@ali_rides")
      // works alongside the raw Rider ID — see server.ts's
      // /friends/requests handler, which resolves a handle server-side.
      const input = $('#friendId').value.trim().toLowerCase();
      const isHandle = /^@[a-z0-9_]{3,24}$/.test(input);
      const isRiderId = /^rider_[a-z0-9_]{4,30}$/.test(input);
      if (!isHandle && !isRiderId) { $('#friendFeedback').textContent = 'Enter their handle (starting with @) or their full Rider ID.'; return; }
      if (input === state.profile.riderId || input === state.profile.handle.toLowerCase()) { $('#friendFeedback').textContent = FRIEND_REQUEST_ERROR_MESSAGES.cannot_friend_yourself; return; }
      $('#friendFeedback').textContent = 'Sending…';
      sendFriendRequest(input);
      $('#friendId').value = '';
    });
    $$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.sheet)));
    $('#completeProfilePrompt').addEventListener('click', () => openSheet('profile'));
    $('#editProfileBtn').addEventListener('click', () => openSheet('profile'));
    $('#reportHazardBtn').addEventListener('click', () => openSheet('reportHazard'));
    $('#closeSheet').addEventListener('click', closeSheet);
    $('#sheetBackdrop').addEventListener('click', (event) => { if (event.target === $('#sheetBackdrop')) closeSheet(); });
    document.addEventListener('keydown', (event) => {
      if ($('#sheetBackdrop').hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = $$('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]', $('.sheet'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
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
    $('#rideVoiceStatus').addEventListener('click', toggleVoiceMute);
    $('#endNavBtn').addEventListener('click', () => finishNavigation(false));
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
        eyebrow: 'Back on the road',
        title: 'The pack’s waiting.',
        description: 'Log in to find your riders, rejoin the group, and pick up where the ride left off.',
      },
      signup: {
        eyebrow: 'New rider',
        title: 'Suit up. Roll out.',
        description: 'Set up your Rider Comms identity and link up with the riders you trust.',
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
    // Startup only reconciles saved UI state with the browser. Permission
    // prompts belong to deliberate taps in Settings, never cold launch.
    syncNotificationPreference();
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
