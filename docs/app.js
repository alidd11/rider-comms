(() => {
  'use strict';

  // Installed iOS PWAs can cold-start with WebKit's dynamic viewport sized
  // as though browser chrome still exists, then suddenly correct after a
  // portrait/landscape round-trip. In standalone mode use the stable 100vh
  // canvas (WebKit bug 254868's documented workaround) and reserve the real
  // safe area *inside* app chrome. VisualViewport remains separate for the
  // keyboard-sensitive chat surface.
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  const visualViewport = window.visualViewport;
  const syncViewportEnvironment = () => {
    const isStandalone = standaloneMedia?.matches || window.navigator.standalone === true;
    const layoutViewportHeight = window.innerHeight;
    const visualViewportHeight = visualViewport?.height ?? layoutViewportHeight;
    const visualViewportTop = Math.max(0, visualViewport?.offsetTop ?? 0);
    const keyboardInset = Math.max(0, layoutViewportHeight - visualViewportHeight - visualViewportTop);
    const keyboardOpen = keyboardInset > 80;
    const root = document.documentElement;
    const rootScrollY = Math.max(0, window.scrollY || root.scrollTop || 0);
    const chatRootPan = root.classList.contains('chat-open') && keyboardOpen ? rootScrollY : 0;

    root.classList.toggle('pwa-standalone', Boolean(isStandalone));
    root.classList.toggle('keyboard-open', keyboardOpen);
    // Do not use 100dvh for the standalone app shell. On affected iOS builds
    // its cold-start value can be roughly one browser-toolbar shorter than the
    // Home Screen window until rotation forces WebKit to recompute it.
    const appHeight = isStandalone ? '100vh' : `${layoutViewportHeight}px`;
    root.style.setProperty('--app-vh', appHeight);
    root.style.setProperty('--visual-vh', `${visualViewportHeight}px`);
    root.style.setProperty('--visual-viewport-top', `${visualViewportTop}px`);
    // Installed iOS can pan the document itself when a textarea receives
    // focus while reporting visualViewport.offsetTop as zero. Compensate that
    // root pan only for keyboard-open chat; every other screen keeps the
    // stable app-shell viewport model.
    root.style.setProperty('--chat-root-pan', `${chatRootPan}px`);
    root.style.setProperty('--bottom-safe-area', isStandalone ? 'env(safe-area-inset-bottom, 0px)' : '0px');
  };
  const settleViewportEnvironment = () => {
    syncViewportEnvironment();
    requestAnimationFrame(() => {
      syncViewportEnvironment();
      requestAnimationFrame(syncViewportEnvironment);
    });
  };
  settleViewportEnvironment();
  window.addEventListener('resize', syncViewportEnvironment);
  window.addEventListener('orientationchange', settleViewportEnvironment);
  window.addEventListener('pageshow', settleViewportEnvironment);
  window.addEventListener('scroll', syncViewportEnvironment, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settleViewportEnvironment();
  });
  visualViewport?.addEventListener?.('resize', syncViewportEnvironment);
  visualViewport?.addEventListener?.('scroll', syncViewportEnvironment);
  standaloneMedia?.addEventListener?.('change', settleViewportEnvironment);

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
    navigationProvider: 'google_maps',
    notifications: false,
    profile: {
      riderId: '',
      displayName: '',
      handle: '',
      avatarId: 'ember',
      zoneTier: 'free',
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

  // Mirrors the native avatar IDs and colours. The PWA maps those presets to
  // its existing SVG sprite so the same rider identity survives both shells.
  const AVATAR_PRESETS = [
    { id: 'ember', icon: 'ride', bg: '#FF8A2B' },
    { id: 'ridge', icon: 'ride', bg: '#4C8BF5' },
    { id: 'moss', icon: 'shield', bg: '#3DD68C' },
    { id: 'dusk', icon: 'route', bg: '#8B5CF6' },
    { id: 'blaze', icon: 'target', bg: '#FF5A5F' },
    { id: 'gold', icon: 'route', bg: '#FBBF24' },
    { id: 'slate', icon: 'nav-arrow', bg: '#64748B' },
    { id: 'rose', icon: 'location', bg: '#EC4899' },
  ];
  const AVATAR_PRESET_BY_ID = Object.fromEntries(AVATAR_PRESETS.map((preset) => [preset.id, preset]));
  function avatarPreset(id) {
    return AVATAR_PRESET_BY_ID[id] || AVATAR_PRESETS[0];
  }

  const PLAN_ORDER = ['free', 'premium', 'premium_plus'];
  const PLAN_INFO = {
    free: {
      name: 'Free',
      priceLabel: 'Free',
      blurb: 'The default — good for a stoplight-to-stoplight ride.',
      radiusMiles: 1,
      features: ['1 mi zone radius', 'Group rides with a host code', 'Voice chat while riding'],
    },
    premium: {
      name: 'Premium',
      priceLabel: '$4.99',
      blurb: 'Wider net for group rides that spread out on the highway.',
      radiusMiles: 6,
      features: ['6 mi zone radius', 'Everything in Free', 'Priority support'],
    },
    premium_plus: {
      name: 'Premium+',
      priceLabel: '$9.99',
      blurb: 'Widest range — for a convoy that has stretched way out.',
      radiusMiles: 20,
      features: ['20 mi zone radius', 'Everything in Premium', 'Early access to new features'],
    },
  };
  function planTier(value) {
    return Object.hasOwn(PLAN_INFO, value) ? value : 'free';
  }

  const NAVIGATION_PROVIDERS = {
    in_app: { label: 'Rider Comms', description: 'Keep turn-by-turn guidance inside Rider Comms.' },
    google_maps: { label: 'Google Maps', description: 'Hand the destination to Google Maps.' },
    waze: { label: 'Waze', description: 'Hand the destination to Waze.' },
    apple_maps: { label: 'Apple Maps', description: 'Hand the destination to Apple Maps.' },
  };
  function navigationProvider(value) {
    return Object.hasOwn(NAVIGATION_PROVIDERS, value) ? value : 'google_maps';
  }

  // Automatic day/night map skin — kept in sync with the CSS light-mode
  // media block below via prefersDarkMode(), so the map tiles match the
  // rest of the UI instead of staying stuck on the dark skin in daylight.
  const MAP_STYLE_DARK = [
    { elementType: 'geometry', stylers: [{ color: '#0a1115' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1115' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7d8c94' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#a9b7bd' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#172229' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#25333b' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#20313a' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#071c25' }] },
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
      backgroundColor: prefersDarkMode() ? '#080d10' : '#f2f5f6',
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
  // see the 0016_private_ride_location_consent migration in backend/src/db.ts.
  // Upload is opt-in for each ride and the backend excludes stale or former
  // members. Keyed by riderId for easy lookup when placing markers.
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
  const movementTracker = new window.RiderMovementSafety.MovementStateTracker();
  let movementState = 'unknown';
  let movementWatchId;
  let movementFreshnessTimer;
  let movementPermissionStatus;
  let latestDevicePosition;
  let mapCentredOnLiveLocation = false;
  let activeChat = null;
  let chatMessages = [];
  let chatNextCursor = null;
  let chatHasLoadedOlder = false;
  let chatPollTimer;
  let chatLoading = false;
  let chatReturnFocus = null;
  let chatHideouts = [];
  let chatHideoutsLoading = false;
  let chatHideoutError = '';
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
        navigationProvider: navigationProvider(stored.navigationProvider),
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
    const preset = avatarPreset(person.avatarId);
    return `<span class="avatar ${className}" style="--avatar:${preset.bg}" aria-hidden="true">${icon(preset.icon)}</span>`;
  }

  function avatarOptionsMarkup(selectedId) {
    return `<div class="avatar-picker-grid" role="radiogroup" aria-label="Profile avatar">${AVATAR_PRESETS.map((preset) => {
      const selected = preset.id === selectedId;
      return `<button type="button" class="avatar-picker-option${selected ? ' selected' : ''}" data-avatar-option="${preset.id}" role="radio" aria-checked="${selected}" aria-label="${preset.id} avatar"><span class="avatar avatar-lg" style="--avatar:${preset.bg}">${icon(preset.icon)}</span>${selected ? '<span class="avatar-picker-check">✓</span>' : ''}</button>`;
    }).join('')}</div>`;
  }

  async function selectProfileAvatar(avatarId) {
    if (!AVATAR_PRESET_BY_ID[avatarId] || avatarId === state.profile.avatarId) return;
    const saved = await patchProfile({ avatarId });
    if (!saved) return;
    showToast('Avatar updated.');
    openSheet('profile');
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
    if (window.RiderMovementSafety.isLockedForSafety(movementState) && !['map', 'ride'].includes(screen)) {
      screen = state.activeRide ? 'ride' : 'map';
      showToast('Controls stay locked until Rider Comms confirms you are stationary.');
    }
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
    const tier = planTier(state.profile.zoneTier);
    const plan = PLAN_INFO[tier];
    const planSummary = $('#planSummary');
    if (planSummary) planSummary.textContent = `${plan.name} plan · ${plan.priceLabel === 'Free' ? 'No card on file' : `${plan.priceLabel}/mo`}`;
    const planPill = $('#planPill');
    if (planPill) planPill.textContent = plan.name;
    const navigationSummary = $('#navigationProviderSummary');
    if (navigationSummary) navigationSummary.textContent = NAVIGATION_PROVIDERS[navigationProvider(state.navigationProvider)].label;
    const genericProfile = state.profile.displayName.trim().toLowerCase() === 'rider'
      || state.profile.handle.trim().toLowerCase() === '@rider';
    $('#completeProfilePrompt').hidden = !genericProfile;
    $$('[data-avatar]').forEach((element) => {
      const preset = avatarPreset(state.profile.avatarId);
      element.innerHTML = icon(preset.icon);
      element.style.setProperty('--avatar', preset.bg);
    });
  }

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
    if (!state.activeRide) return [];
    return (state.activeRide.members || [])
      .filter((member) => member.riderId !== state.profile.riderId && rideMemberLocations.has(member.riderId));
  }

  function renderMapRiders() {
    renderHazardMarkers();
    const riders = visibleMapRiders();
    if (!map || usingFallbackMap) return renderFallbackMarkers([]);
    mapMarkers.forEach((marker) => marker.setMap(null));
    mapMarkers = riders.map((person) => {
      const real = rideMemberLocations.get(person.riderId);
      return addMapMarker(person, { lat: real.lat, lng: real.lon }, false);
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
    renderFallbackMarkers();
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
      <button class="button primary wide" id="messageFriend">Message</button>
      <button class="button secondary wide" id="copyFriendId">Copy Rider ID</button>
      <button class="button danger wide" id="friendSafetyActions">Report or block rider</button>
      <p class="caption">Only connect and arrange rides with people you trust. Social links follow each rider’s privacy settings.</p>`, () => {
      $('#copyFriendId').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(riderId); showToast('Rider ID copied.'); }
        catch { showToast(riderId); }
      });
      $('#messageFriend').addEventListener('click', () => openChat(friend));
      $('#friendSafetyActions').addEventListener('click', () => openFriendSafetyActions(friend));
    });
  }

  const MESSAGE_POLL_INTERVAL_MS = 10000;

  function formatMessageTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }

  function renderChatHideouts() {
    const section = $('#chatHideouts');
    const list = $('#chatHideoutList');
    const status = $('#chatHideoutStatus');
    if (!section || !list || !status || !activeChat) {
      if (section) section.hidden = true;
      return;
    }

    const provider = navigationProvider(state.navigationProvider);
    const providerLabel = NAVIGATION_PROVIDERS[provider].label;
    status.textContent = chatHideoutsLoading
      ? 'Loading…'
      : chatHideoutError
        ? chatHideoutError
        : chatHideouts.length === 1
          ? '1 saved'
          : `${chatHideouts.length} saved`;

    section.hidden = !chatHideoutsLoading && !chatHideoutError && chatHideouts.length === 0;
    list.innerHTML = chatHideouts.map((hideout) => {
      const mine = hideout.createdBy === state.profile.riderId;
      const coords = `${Number(hideout.lat).toFixed(4)}, ${Number(hideout.lon).toFixed(4)}`;
      return `<article class="chat-hideout-row">
        <span class="chat-hideout-icon" aria-hidden="true">${icon('location')}</span>
        <span class="chat-hideout-copy"><strong>${escapeHtml(hideout.name)}</strong><small>${escapeHtml(coords)}</small></span>
        <span class="chat-hideout-actions">
          <button type="button" data-open-hideout="${escapeHtml(hideout.id)}" aria-label="Open directions to ${escapeHtml(hideout.name)} in ${escapeHtml(providerLabel)}">${escapeHtml(providerLabel)}</button>
          ${mine ? `<button type="button" data-delete-hideout="${escapeHtml(hideout.id)}" aria-label="Delete hideout ${escapeHtml(hideout.name)}">×</button>` : ''}
        </span>
      </article>`;
    }).join('');

    $$('[data-open-hideout]', list).forEach((button) => {
      button.addEventListener('click', () => openChatHideout(button.dataset.openHideout));
    });
    $$('[data-delete-hideout]', list).forEach((button) => {
      button.addEventListener('click', () => void deleteChatHideout(button.dataset.deleteHideout));
    });
  }

  async function loadChatHideouts() {
    if (!activeChat || chatHideoutsLoading) return;
    const riderId = activeChat.riderId;
    chatHideoutsLoading = true;
    chatHideoutError = '';
    renderChatHideouts();
    try {
      const result = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/hideouts`);
      if (!activeChat || activeChat.riderId !== riderId) return;
      const hideouts = Array.isArray(result.hideouts) ? result.hideouts : [];
      chatHideouts = hideouts.filter((hideout) =>
        hideout
        && typeof hideout.id === 'string'
        && typeof hideout.name === 'string'
        && Number.isFinite(hideout.lat)
        && Number.isFinite(hideout.lon)
        && Array.isArray(hideout.participantIds)
        && hideout.participantIds.includes(riderId)
      );
    } catch {
      if (activeChat?.riderId === riderId) chatHideoutError = 'Could not load hideouts';
    } finally {
      chatHideoutsLoading = false;
      renderChatHideouts();
    }
  }

  function openChatHideout(hideoutId) {
    const hideout = chatHideouts.find((item) => item.id === hideoutId);
    if (!hideout) return;
    const provider = navigationProvider(state.navigationProvider);
    if (provider !== 'in_app') {
      const href = navigationHref(provider, hideout.lat, hideout.lon, hideout.name);
      if (!href) {
        showToast('Could not open directions.');
        return;
      }
      const opened = window.open(href, '_blank');
      if (opened) opened.opener = null;
      else window.location.href = href;
      return;
    }

    closeChat({ restoreFocus: false });
    navigate('map');
    requestAnimationFrame(() => {
      if (typeof google === 'undefined' || !map || usingFallbackMap) {
        showToast('Rider Comms navigation needs the live map.');
        return;
      }
      const location = new google.maps.LatLng(hideout.lat, hideout.lon);
      setDestinationMarker(location, hideout.name, `${hideout.lat.toFixed(5)}, ${hideout.lon.toFixed(5)}`);
    });
  }

  async function deleteChatHideout(hideoutId) {
    const hideout = chatHideouts.find((item) => item.id === hideoutId);
    if (!hideout || hideout.createdBy !== state.profile.riderId) return;
    try {
      await apiFetch('DELETE', `/hideouts/${encodeURIComponent(hideoutId)}`);
      chatHideouts = chatHideouts.filter((item) => item.id !== hideoutId);
      renderChatHideouts();
      showToast('Hideout deleted.');
    } catch {
      chatHideoutError = 'Could not delete hideout';
      renderChatHideouts();
    }
  }

  function openPlanHideoutSheet() {
    if (!activeChat) return;
    const friend = activeChat;
    presentSheet('Plan a hideout', `
      <form id="planHideoutForm" class="form-field">
        <label for="hideoutName">Name</label>
        <input id="hideoutName" maxlength="100" autocomplete="off" placeholder="e.g. Petrol station meeting point">
        <div class="hideout-coordinate-grid">
          <label>Latitude<input id="hideoutLat" inputmode="decimal" autocomplete="off" placeholder="51.5074"></label>
          <label>Longitude<input id="hideoutLon" inputmode="decimal" autocomplete="off" placeholder="-0.1278"></label>
        </div>
        <p class="caption">Save a meeting point shared with ${escapeHtml(friend.displayName)}. Enter coordinates directly.</p>
        <p id="planHideoutError" class="inline-error" role="alert" hidden></p>
        <button id="saveHideoutBtn" class="button primary wide" type="submit">Save hideout</button>
      </form>`, () => {
      $('#planHideoutForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = $('#hideoutName').value.trim();
        const latInput = $('#hideoutLat').value.trim();
        const lonInput = $('#hideoutLon').value.trim();
        const lat = Number(latInput);
        const lon = Number(lonInput);
        const errorEl = $('#planHideoutError');
        const save = $('#saveHideoutBtn');
        errorEl.hidden = true;

        if (!name || !latInput || !lonInput || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          errorEl.textContent = 'Enter a name plus valid latitude and longitude coordinates.';
          errorEl.hidden = false;
          return;
        }

        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          await apiFetch('POST', '/hideouts', { name, lat, lon, participantIds: [friend.riderId] });
          closeSheet();
          await loadChatHideouts();
          showToast('Hideout saved.');
        } catch (error) {
          const code = error instanceof ApiError ? error.body?.error : '';
          errorEl.textContent = code === 'participants_must_be_friends'
            ? 'Hideouts can only be shared with current friends.'
            : 'Could not save that hideout. Try again.';
          errorEl.hidden = false;
          save.disabled = false;
          save.textContent = 'Save hideout';
        }
      });
    });
  }

  function renderChat() {
    if (!activeChat) return;
    const messages = $('#chatMessages');
    messages.innerHTML = chatMessages.map((message) => {
      const mine = message.fromRiderId === state.profile.riderId;
      const failed = mine && message.status === 'failed';
      const status = message.status === 'pending' ? '<small>Sending…</small>' : failed ? '<small>Failed — tap to retry</small>' : '';
      const body = `<span>${escapeHtml(message.text)}</span><time>${escapeHtml(formatMessageTime(message.createdAt))}</time>${status}`;
      return failed
        ? `<button class="chat-bubble-row mine" data-retry-message="${escapeHtml(message.id)}" aria-label="Message failed. Retry sending."><span class="chat-bubble failed">${body}</span></button>`
        : `<div class="chat-bubble-row${mine ? ' mine' : ''}"><div class="chat-bubble">${body}</div></div>`;
    }).join('');
    $('#chatEmpty').hidden = chatLoading || chatMessages.length > 0;
    $('#chatLoadOlder').hidden = !chatNextCursor;
    $$('[data-retry-message]', messages).forEach((button) => button.addEventListener('click', () => void retryChatMessage(button.dataset.retryMessage)));
    renderChatHideouts();
  }

  function setChatError(message, unavailable = false) {
    const error = $('#chatError');
    error.querySelector('span').textContent = message || '';
    error.hidden = !message;
    $('#chatRetry').hidden = unavailable;
    $('#chatInput').disabled = unavailable;
    $('#chatSend').disabled = unavailable;
  }

  async function loadChatMessages({ older = false, showLoading = false } = {}) {
    if (!activeChat || chatLoading || (older && !chatNextCursor)) return;
    const riderId = activeChat.riderId;
    chatLoading = true;
    if (showLoading) {
      setChatError('Loading messages…');
      $('#chatRetry').hidden = true;
    }
    try {
      const query = new URLSearchParams({ withRiderId: riderId, limit: '100' });
      if (older) query.set('before', chatNextCursor);
      const page = await apiFetch('GET', `/messages?${query.toString()}`);
      if (!activeChat || activeChat.riderId !== riderId) return;
      chatMessages = older || chatHasLoadedOlder
        ? window.RiderMessageState.dedupe([...page.messages, ...chatMessages])
        : window.RiderMessageState.reconcile(chatMessages, page.messages);
      if (older) chatHasLoadedOlder = true;
      if (!chatHasLoadedOlder || older) chatNextCursor = page.nextCursor;
      setChatError('');
      renderChat();
      if (!older) requestAnimationFrame(() => { $('#chatThread').scrollTop = $('#chatThread').scrollHeight; });
    } catch (error) {
      const unavailable = error instanceof ApiError && error.status === 403;
      setChatError(unavailable ? 'This conversation is no longer available.' : 'Could not refresh messages. Check your connection and try again.', unavailable);
    } finally {
      chatLoading = false;
      renderChat();
    }
  }

  function syncChatPolling() {
    clearInterval(chatPollTimer);
    chatPollTimer = undefined;
    if (!activeChat || document.visibilityState !== 'visible') return;
    chatPollTimer = setInterval(() => void loadChatMessages(), MESSAGE_POLL_INTERVAL_MS);
  }

  function openChat(friend) {
    if (window.RiderMovementSafety.isLockedForSafety(movementState)) {
      showToast('Messages stay locked until Rider Comms confirms you are stationary.');
      return;
    }
    chatReturnFocus = lastSheetTrigger || document.activeElement;
    closeSheet();
    activeChat = friend;
    chatMessages = [];
    chatNextCursor = null;
    chatHasLoadedOlder = false;
    chatHideouts = [];
    chatHideoutsLoading = false;
    chatHideoutError = '';
    $('#chatTitle').textContent = friend.displayName;
    $('#chatHandle').textContent = friend.handle;
    $('#chatAvatar').outerHTML = avatar(friend, 'avatar-sm').replace('<span ', '<span id="chatAvatar" ');
    $('#chatScreen').hidden = false;
    $('#app').setAttribute('inert', '');
    document.documentElement.classList.add('chat-open');
    // Friends screens scroll internally, so the document itself should always
    // be at zero here. Explicitly reset any stale iOS focus pan before the
    // composer can receive focus, then let the chat-open body lock prevent a
    // second document-level shift.
    window.scrollTo(0, 0);
    syncViewportEnvironment();
    setChatError('');
    renderChat();
    syncChatPolling();
    history.pushState({ screen: 'friends', chat: friend.riderId }, '', '#friends/chat');
    document.title = `${friend.displayName} · Rider Comms`;
    void loadChatMessages({ showLoading: true });
    void loadChatHideouts();
  }

  function closeChat({ restoreFocus = true } = {}) {
    if (!activeChat) return;
    clearInterval(chatPollTimer);
    chatPollTimer = undefined;
    activeChat = null;
    chatMessages = [];
    chatNextCursor = null;
    chatHasLoadedOlder = false;
    chatHideouts = [];
    chatHideoutsLoading = false;
    chatHideoutError = '';
    $('#chatScreen').hidden = true;
    $('#app').removeAttribute('inert');
    document.documentElement.classList.remove('chat-open');
    syncViewportEnvironment();
    document.title = 'Friends · Rider Comms';
    if (restoreFocus) chatReturnFocus?.focus?.();
    chatReturnFocus = null;
  }

  async function sendChatText(text, localId) {
    if (!activeChat) return;
    const riderId = activeChat.riderId;
    try {
      const sent = await apiFetch('POST', '/messages', { toRiderId: riderId, text });
      if (activeChat?.riderId !== riderId) return;
      chatMessages = chatMessages.map((message) => message.id === localId ? sent : message);
      renderChat();
    } catch {
      if (activeChat?.riderId !== riderId) return;
      chatMessages = chatMessages.map((message) => message.id === localId ? { ...message, status: 'failed' } : message);
      renderChat();
    }
  }

  function submitChatMessage() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!activeChat || !text) return;
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chatMessages.push({ id: localId, fromRiderId: state.profile.riderId, toRiderId: activeChat.riderId, text, createdAt: Date.now(), status: 'pending' });
    input.value = '';
    renderChat();
    requestAnimationFrame(() => { $('#chatThread').scrollTop = $('#chatThread').scrollHeight; });
    void sendChatText(text, localId);
  }

  async function retryChatMessage(localId) {
    const target = chatMessages.find((message) => message.id === localId && message.status === 'failed');
    if (!target) return;
    chatMessages = chatMessages.map((message) => message.id === localId ? { ...message, status: 'pending' } : message);
    renderChat();
    await sendChatText(target.text, localId);
  }

  function openFriendSafetyActions(friend) {
    presentSheet('Safety options', `<div class="settings-note"><strong>${escapeHtml(friend.displayName)}</strong><p>Reports are sent to Rider Comms for review. Blocking immediately removes this friendship and prevents messages or new requests.</p></div>
      <div class="choice-list" aria-label="Report reason">
        <button data-report-rider="harassment"><span><strong>Report harassment</strong><small>Threats, abuse or repeated unwanted contact</small></span>${icon('chevron')}</button>
        <button data-report-rider="unsafe"><span><strong>Report unsafe behaviour</strong><small>Dangerous conduct affecting rider safety</small></span>${icon('chevron')}</button>
        <button data-report-rider="spam"><span><strong>Report spam</strong><small>Scams, advertising or repeated unwanted messages</small></span>${icon('chevron')}</button>
      </div>
      <button class="button danger wide" id="blockFriendBtn">Block rider</button>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $$('[data-report-rider]', $('#sheetBody')).forEach((button) => {
        button.addEventListener('click', () => void reportFriend(friend, button.dataset.reportRider));
      });
      $('#blockFriendBtn').addEventListener('click', () => void blockFriend(friend));
    });
  }

  async function reportFriend(friend, reason) {
    const error = $('#friendSafetyError');
    error.hidden = true;
    $$('[data-report-rider]', $('#sheetBody')).forEach((button) => { button.disabled = true; });
    try {
      await apiFetch('POST', '/reports', {
        riderId: friend.riderId,
        reason,
        details: 'Reported from the PWA friend profile',
      });
      closeSheet();
      showToast('Report received. Thank you.');
    } catch {
      error.textContent = 'Could not send that report. Check your connection and try again.';
      error.hidden = false;
      $$('[data-report-rider]', $('#sheetBody')).forEach((button) => { button.disabled = false; });
    }
  }

  async function blockFriend(friend) {
    if (!window.confirm(`Block ${friend.displayName}? This removes them from your friends and prevents further contact.`)) return;
    const button = $('#blockFriendBtn');
    const error = $('#friendSafetyError');
    button.disabled = true;
    error.hidden = true;
    try {
      await apiFetch('POST', '/blocks', { riderId: friend.riderId });
      state.friends = state.friends.filter((candidate) => candidate.riderId !== friend.riderId);
      state.requests = state.requests.filter((request) => request.riderId !== friend.riderId);
      nearbyRiders = nearbyRiders.filter((candidate) => candidate.riderId !== friend.riderId);
      if (state.selectedRiderId === friend.riderId) state.selectedRiderId = null;
      persist();
      renderFriends();
      renderMapRiders();
      if (activeChat?.riderId === friend.riderId) closeChat({ restoreFocus: false });
      closeSheet();
      showToast(`${friend.displayName} blocked.`);
    } catch {
      button.disabled = false;
      error.textContent = 'Could not block that rider. Check your connection and try again.';
      error.hidden = false;
    }
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
        return { riderId, displayName: profile.displayName, handle: profile.handle, avatarId: profile.avatarId || 'ember' };
      } catch {
        return { riderId, displayName: riderId, handle: riderId, avatarId: 'ember' };
      }
    }));
  }

  /**
   * Loads the rider's real friends + incoming/outgoing requests from the
   * backend (GET /riders/:id/friends, GET /riders/:id/friend-requests).
   * Request responses include joined profile summaries, so this remains two
   * bounded SQL-backed requests regardless of how many riders are listed.
   */
  async function loadFriendsData() {
    if (!state.profile.riderId) return;
    try {
      const [friendsResult, requestsResult] = await Promise.all([
        apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friends?limit=100`),
        apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friend-requests?limit=100`),
      ]);
      state.friends = friendsResult.friends.map((friend) => ({ riderId: friend.riderId, displayName: friend.displayName, handle: friend.handle, avatarId: friend.avatarId || 'ember', status: 'Connected' }));
      const incoming = requestsResult.incoming.filter((request) => request.status === 'pending');
      state.requests = incoming.map((request) => {
        const profile = requestsResult.profiles?.[request.fromRiderId];
        return { id: request.id, riderId: request.fromRiderId, displayName: profile?.displayName ?? request.fromRiderId, handle: profile?.handle ?? request.fromRiderId, avatarId: profile?.avatarId || 'ember', status: 'Wants to connect' };
      });
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
      state.friends.push({ riderId: result.friend.riderId, displayName: result.friend.displayName, handle: result.friend.handle, avatarId: result.friend.avatarId || 'ember', status: 'Connected now' });
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
    const locationToggle = $('#activeRideLocationConsent');
    locationToggle.checked = ride.shareRideLocation === true;
    $('#activeRideLocationStatus').textContent = ride.shareRideLocation
      ? 'On — current ride members can see your recent position.'
      : 'Off — your position is not being uploaded to this ride.';
    const members = ride.members || ride.memberIds.map((riderId) => ({ riderId, displayName: riderId, handle: riderId }));
    $('#activeRideCode').textContent = ride.code;
    $('#ridePillCode').textContent = ride.code;
    $('#rideRole').textContent = ride.isHost ? 'host' : 'member';
    $('#memberCount').textContent = String(members.length);
    const pillCount = $('#ridePill .pill-count');
    if (pillCount) pillCount.textContent = String(members.length);
    $('#leaveRideBtn').textContent = ride.isHost ? 'End ride' : 'Leave ride';
    $('#rideRoster').innerHTML = members.map((person) => {
      const canRemove = ride.isHost && person.riderId !== state.profile.riderId;
      const removeButton = canRemove
        ? `<button type="button" class="roster-remove" data-remove-ride-member="${escapeHtml(person.riderId)}" aria-label="Remove ${escapeHtml(person.displayName)} from this ride">${icon('close')}</button>`
        : '';
      return `<article class="roster-row">${avatar(person, 'small')}<div class="identity"><strong>${escapeHtml(person.displayName)}${person.riderId === state.profile.riderId ? ' · You' : ''}</strong><span>${escapeHtml(person.handle)}</span></div><span class="roster-status">${escapeHtml(person.riderId === ride.createdBy ? 'Host · connected' : 'Connected')}</span>${removeButton}</article>`;
    }).join('');
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
      const shareRideLocation = $('#hostRideLocationConsent').checked;
      const result = await apiFetch('POST', '/rides', {});
      state.activeRide = { rideId: result.rideId, code: result.code, isHost: true, createdBy: result.createdBy, memberIds: result.memberIds, shareRideLocation: false };
      state.selectedRiderId = null;
      persist();
      renderRide();
      navigate('ride');
      showToast('Your private ride is ready.');
      await loadRideRoster();
      if (shareRideLocation) await setRideLocationSharing(true);
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
      const shareRideLocation = $('#joinRideLocationConsent').checked;
      const joined = await apiFetch('POST', '/rides/join', { code });
      const ride = await apiFetch('GET', `/rides/${encodeURIComponent(joined.rideId)}`);
      state.activeRide = { rideId: ride.rideId, code, isHost: ride.createdBy === state.profile.riderId, createdBy: ride.createdBy, memberIds: ride.memberIds, shareRideLocation: false };
      state.selectedRiderId = null;
      persist();
      renderRide();
      navigate('ride');
      showToast('You joined the ride.');
      await loadRideRoster();
      if (shareRideLocation) await setRideLocationSharing(true);
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

  async function removeRideMemberFromActiveRide(riderId) {
    const ride = state.activeRide;
    if (!ride?.isHost || riderId === state.profile.riderId) return;
    const person = ride.members?.find((member) => member.riderId === riderId);
    const label = person?.displayName || riderId;
    if (!window.confirm(`Remove ${label} from this ride?`)) return;
    try {
      const updated = await apiFetch('DELETE', `/rides/${encodeURIComponent(ride.rideId)}/members/${encodeURIComponent(riderId)}`);
      if (!state.activeRide || state.activeRide.rideId !== ride.rideId) return;
      state.activeRide.memberIds = updated.memberIds;
      state.activeRide.members = (state.activeRide.members || []).filter((member) => member.riderId !== riderId);
      rideMemberLocations.delete(riderId);
      persist();
      renderRide();
      renderMapRiders();
      showToast(`${label} was removed from the ride.`);
    } catch {
      showToast('Could not remove that rider. Try again.');
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
        body: `<div class="settings-sheet-section"><span class="settings-sheet-label">Identity</span><div class="form-field"><label>Avatar</label>${avatarOptionsMarkup(state.profile.avatarId)}</div><div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Rider handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div></div><div class="settings-sheet-section"><span class="settings-sheet-label">Connected profiles</span><div class="form-field"><label for="editInstagram">Instagram</label><input id="editInstagram" maxlength="30" value="${escapeHtml(state.profile.instagram)}" placeholder="Username"></div><div class="form-field"><label for="editTiktok">TikTok</label><input id="editTiktok" maxlength="30" value="${escapeHtml(state.profile.tiktok)}" placeholder="Username"></div><p class="caption">Control who can see these in Privacy controls.</p></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save changes</button>`,
        ready: () => {
          $('#saveProfile').addEventListener('click', saveProfile);
          $$('[data-avatar-option]', $('#sheetBody')).forEach((button) => {
            button.addEventListener('click', () => void selectProfileAvatar(button.dataset.avatarOption));
          });
        },
      }),
      sessions: () => ({
        title: 'Signed-in devices',
        body: '<div id="sessionList" class="session-list"><p class="caption">Loading signed-in devices…</p></div><button class="button secondary wide" id="refreshSessions">Refresh devices</button>',
        ready: () => {
          $('#refreshSessions').addEventListener('click', () => void loadAccountSessions());
          void loadAccountSessions();
        },
      }),
      account: () => ({
        title: 'Account and data',
        body: `<div class="settings-note"><strong>Delete Rider Comms account</strong><p>This permanently removes your account and associated test data. This cannot be undone.</p></div><button class="button danger wide" id="deleteAccountBtn">Delete account</button><p id="deleteAccountError" class="inline-error" hidden></p>`,
        ready: () => {
          $('#deleteAccountBtn').addEventListener('click', () => void deleteCurrentAccount());
        },
      }),
      plans: () => {
        const currentTier = planTier(state.profile.zoneTier);
        return {
          title: 'Plan and billing',
          body: `<p class="billing-intro">Your plan controls the mutual nearby-rider radius. Private Group Rides remain available on every plan.</p>
            <div class="settings-note billing-notice"><strong>Store billing is not connected yet</strong><p>Paid plans are shown for transparency but cannot be purchased until verified App Store and Google Play billing is connected. Rider Comms does not collect card details.</p></div>
            <div class="plan-list">${PLAN_ORDER.map((tier) => {
              const plan = PLAN_INFO[tier];
              const current = tier === currentTier;
              const price = plan.priceLabel === 'Free' ? 'Free' : `${plan.priceLabel}/month`;
              return `<article class="plan-card${current ? ' current' : ''}" data-plan-tier="${tier}">
                <div class="plan-top"><span><strong>${escapeHtml(plan.name)}</strong><small>${escapeHtml(price)}</small></span><span class="plan-pill">${current ? 'Current' : 'Unavailable'}</span></div>
                <p>${escapeHtml(plan.blurb)}</p>
                <ul class="plan-features">${plan.features.map((feature) => `<li>${icon('plus')}<span>${escapeHtml(feature)}</span></li>`).join('')}</ul>
                ${current && tier !== 'free' ? '<button class="button danger wide plan-return-free" id="returnToFreePlan">Return to Free</button>' : ''}
              </article>`;
            }).join('')}</div>`,
          ready: () => {
            const returnButton = $('#returnToFreePlan');
            if (!returnButton) return;
            returnButton.addEventListener('click', async () => {
              if (!window.confirm('Return to the Free plan? Your nearby radius will change to 1 mile.')) return;
              returnButton.disabled = true;
              const ok = await patchProfile({ zoneTier: 'free' });
              if (!ok) {
                returnButton.disabled = false;
                return;
              }
              renderProfile();
              openSheet('plans');
              showToast('Returned to the Free plan.');
            });
          },
        };
      },
      privacy: () => ({ title: 'Privacy controls', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Live location', 'Visible to nearby riders only while you are live.', state.profile.shareLocation)}</div><div class="settings-sheet-section"><div class="form-field"><label for="sheetSocialVisibility">Connected profile visibility</label><select id="sheetSocialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><p class="caption">This applies to the Instagram and TikTok usernames on your profile.</p></div>`, ready: () => { $('#sheetSocialVisibility').value = state.profile.socialsVisibility; $('#sheetSocialVisibility').addEventListener('change', (event) => { patchProfile({ instagramVisibility: event.target.value, tiktokVisibility: event.target.value }); }); wireToggles(); } }),
      navigation: () => ({
        title: 'Navigation',
        body: `<div class="choice-list" role="radiogroup" aria-label="Navigation preference">${Object.entries(NAVIGATION_PROVIDERS).map(([id, option]) => `<button data-navigation-option="${id}" role="radio" aria-checked="${navigationProvider(state.navigationProvider) === id}"><span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small></span><i></i></button>`).join('')}</div><div class="settings-note"><strong>Your choice applies to destination buttons</strong><p>Rider Comms navigation stays in the app. Google Maps, Waze and Apple Maps hand the destination to that provider.</p></div>`,
        ready: () => {
          $$('[data-navigation-option]', $('#sheetBody')).forEach((button) => {
            button.addEventListener('click', () => {
              state.navigationProvider = navigationProvider(button.dataset.navigationOption);
              persist();
              renderProfile();
              openSheet('navigation');
              showToast(`Navigation set to ${NAVIGATION_PROVIDERS[state.navigationProvider].label}.`);
            });
          });
        },
      }),
      map: () => ({ title: 'Location and map', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Nearby rider visibility', 'Share your position only after you choose to go live.', state.profile.shareLocation)}</div><div class="settings-note"><strong>Location stays in your control</strong><p>Turning this off stops nearby-rider visibility. Private-ride location is controlled separately inside each ride and remains off unless you explicitly enable it.</p></div>`, ready: wireToggles }),
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
    document.documentElement.classList.add('sheet-open');
    $('#app')?.setAttribute('inert', '');
    $('#chatScreen')?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    ready?.();
    $('#closeSheet').focus();
  }

  function toggleMarkup(key, title, description, active) {
    return `<div class="toggle-row"><span><strong>${escapeHtml(title)}</strong><span class="caption">${escapeHtml(description)}</span></span><button class="toggle" data-toggle="${escapeHtml(key)}" aria-label="${escapeHtml(title)}" aria-pressed="${active}"></button></div>`;
  }

  function sessionDateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Recently active';
  }

  async function loadAccountSessions() {
    const list = $('#sessionList');
    const refresh = $('#refreshSessions');
    if (!list) return;
    if (refresh) refresh.disabled = true;
    list.innerHTML = '<p class="caption">Loading signed-in devices…</p>';
    try {
      const { sessions } = await apiFetch('GET', '/auth/sessions');
      if (!Array.isArray(sessions) || sessions.length === 0) {
        list.innerHTML = '<p class="caption">No account sessions found.</p>';
        return;
      }
      list.innerHTML = sessions.map((accountSession) => {
        const current = accountSession.current === true;
        return `<article class="session-row"><span class="setting-icon">${icon('settings')}</span><span class="session-copy"><strong>${escapeHtml(accountSession.deviceName || 'Rider Comms device')}</strong><small>${current ? 'This device' : `Active ${escapeHtml(sessionDateLabel(accountSession.lastSeenAt))}`}</small></span>${current ? '<span class="plan-pill">Current</span>' : `<button class="button tertiary session-revoke" data-revoke-session="${escapeHtml(accountSession.id)}">Sign out</button>`}</article>`;
      }).join('');
      $$('[data-revoke-session]', list).forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await apiFetch('DELETE', `/auth/sessions/${encodeURIComponent(button.dataset.revokeSession)}`);
          await loadAccountSessions();
          showToast('That device was signed out.');
        } catch {
          button.disabled = false;
          showToast('Could not sign out that device. Try again.');
        }
      }));
    } catch {
      list.innerHTML = '<p class="inline-error">Could not load signed-in devices. Check your connection and try again.</p>';
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function deleteCurrentAccount() {
    if (!window.confirm('Permanently delete your Rider Comms account and associated data?')) return;
    if (!window.confirm('This cannot be undone. Delete the account?')) return;
    const button = $('#deleteAccountBtn');
    const errorEl = $('#deleteAccountError');
    button.disabled = true;
    errorEl.hidden = true;
    try {
      const localStateKey = stateStorageKey();
      await apiFetch('DELETE', '/auth/me');
      localStorage.removeItem(localStateKey);
      clearSession();
      location.reload();
    } catch {
      errorEl.textContent = 'Could not delete your account. Check your connection and try again.';
      errorEl.hidden = false;
      button.disabled = false;
    }
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
    document.documentElement.classList.remove('sheet-open');
    $('#app')?.removeAttribute('inert');
    $('#chatScreen')?.removeAttribute('inert');
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
    const result = await apiFetch('POST', '/presence', {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
      recordedAt: position.timestamp,
    });
    nearbyRiders = await resolveRiderProfiles(result.inZoneWith);
    if (!state.activeRide) renderMapRiders();
    if (state.publicLive && !state.activeRide && microphonePermissionReady) syncVoiceConnection();
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
  const proximityVoiceRooms = new Map(); // peerId -> pair-isolated LiveKit room
  let voiceTargetKey; // 'channel' or `ride:${rideId}`
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
    const connected = Boolean(voiceRoom || proximityVoiceRooms.size);
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
    for (const room of proximityVoiceRooms.values()) {
      void room.localParticipant.setMicrophoneEnabled(speaking).catch(() => {});
    }
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
    if (kind === 'ride' && voiceRoom) return;
    let room;
    try {
      await loadLiveKitClient();
      const body = kind === 'ride' ? { target: 'ride', rideId } : { target: 'channel' };
      const response = await apiFetch('POST', '/voice/token', body);
      if (kind === 'channel') {
        const enteringChannel = voiceTargetKey !== 'channel';
        const desiredPeers = new Set(response.connections.map((connection) => connection.peerId));
        for (const [peerId, existingRoom] of proximityVoiceRooms) {
          if (desiredPeers.has(peerId)) continue;
          void existingRoom.disconnect();
          proximityVoiceRooms.delete(peerId);
        }
        for (const connection of response.connections) {
          if (proximityVoiceRooms.has(connection.peerId)) continue;
          const pairRoom = new window.LivekitClient.Room();
          try {
            await pairRoom.connect(connection.url, connection.token);
            await pairRoom.localParticipant.setMicrophoneEnabled(voiceIsSpeaking && !voiceManuallyMuted);
            proximityVoiceRooms.set(connection.peerId, pairRoom);
          } catch (error) {
            void pairRoom.disconnect();
            throw error;
          }
        }
        voiceTargetKey = 'channel';
        if (enteringChannel) voiceManuallyMuted = false;
      } else {
        room = new window.LivekitClient.Room();
        await room.connect(response.url, response.token);
        await room.localParticipant.setMicrophoneEnabled(false);
        voiceRoom = room;
        voiceTargetKey = `ride:${rideId}`;
        voiceManuallyMuted = false;
      }
      microphonePermissionReady = true;
      if ((voiceRoom || proximityVoiceRooms.size) && !voiceMeterStream) await startVoiceLevelLoop();
      if (!voiceRoom && !proximityVoiceRooms.size && voiceMeterStream) stopVoiceLevelLoop();
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
      if (kind === 'ride') {
        voiceRoom = undefined;
        voiceTargetKey = undefined;
      }
      renderVoiceStatus();
    }
  }

  function stopVoiceLevelLoop() {
    if (voiceLevelFrame) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = undefined; }
    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    voiceAnalyser = undefined;
    if (voiceAudioContext) { void voiceAudioContext.close().catch(() => {}); voiceAudioContext = undefined; }
    if (voiceMeterStream) { voiceMeterStream.getTracks().forEach((track) => track.stop()); voiceMeterStream = undefined; }
    voiceIsSpeaking = false;
  }

  function disconnectVoice() {
    stopVoiceLevelLoop();
    if (voiceRoom) { void voiceRoom.disconnect(); voiceRoom = undefined; }
    for (const room of proximityVoiceRooms.values()) void room.disconnect();
    proximityVoiceRooms.clear();
    voiceTargetKey = undefined;
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
    // Public proximity is refreshed even while already on `channel`: the
    // server returns the current authorised pair roster, and this call
    // disconnects rooms immediately when riders leave range or block one
    // another. Private ride membership is stable for this connection.
    if (desired === voiceTargetKey && desired !== 'channel') return;
    if (desired !== voiceTargetKey && (voiceRoom || proximityVoiceRooms.size)) disconnectVoice();
    // A restored session must not make getUserMedia prompt during boot.
    // Create, Join and Go live set this only from their direct tap.
    if (desired && !microphonePermissionReady) return;
    if (state.activeRide) void connectVoice('ride', state.activeRide.rideId);
    else if (state.publicLive) void connectVoice('channel');
  }

  function toggleVoiceMute() {
    if (!voiceRoom && !proximityVoiceRooms.size) return;
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
        applyDevicePosition(position);
        startMovementSafetyTracking();
        resolve(position);
      }, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });
  }

  let locationPermissionReady = false;

  function applyDevicePosition(position) {
    const lat = position?.coords?.latitude;
    const lng = position?.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    latestDevicePosition = position;
    locationPermissionReady = true;

    if (!map || usingFallbackMap) return;
    const point = { lat, lng };
    if (!userMapMarker) {
      userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, point, true);
    } else {
      userMapMarker.setPosition(point);
    }

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
    const locked = window.RiderMovementSafety.isLockedForSafety(nextState);
    const warning = nextState === 'unknown';
    $('#app')?.classList.toggle('safety-locked', locked);
    const banner = $('#movementSafetyBanner');
    if (banner) banner.hidden = !(locked || warning);
    const message = $('#movementSafetyMessage');
    if (message) message.textContent = nextState === 'moving'
      ? 'Distracting controls are locked until you are safely below 8 mph.'
      : 'Waiting for a reliable speed fix. Controls stay available.';
    const enableButton = $('#enableLocationBtn');
    if (enableButton) {
      enableButton.hidden = !warning;
      enableButton.textContent = movementPermissionStatus?.state === 'denied' ? 'Location help' : 'Enable location';
    }
    $$('[data-nav="routes"], [data-nav="friends"], [data-nav="settings"]').forEach((item) => {
      item.setAttribute('aria-disabled', String(locked));
      item.classList.toggle('safety-unavailable', locked);
    });
    $$('.map-header, #poiChipRow, #reportHazardBtn, #joinNearbyBtn, #riderCard, #hazardCard, #rideJoinState, #shareRideBtn, .ride-code-card, #rideRoster, #openRideMap').forEach((item) => {
      item.toggleAttribute('inert', locked);
      item.setAttribute('aria-disabled', String(locked));
    });
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
    if (!navigator.geolocation || movementWatchId !== undefined || document.visibilityState !== 'visible') return;
    movementWatchId = navigator.geolocation.watchPosition(
      (position) => {
        applyDevicePosition(position);
        applyMovementState(movementTracker.addFix(movementFix(position)));
      },
      () => stopMovementSafetyTracking(),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    movementFreshnessTimer = setInterval(() => applyMovementState(movementTracker.stateAt(Date.now())), 2000);
  }

  async function initialiseMovementSafety() {
    applyMovementState('unknown');
    try {
      const permission = await navigator.permissions?.query?.({ name: 'geolocation' });
      if (permission?.state === 'granted') startMovementSafetyTracking();
      if (permission && permission !== movementPermissionStatus) permission.addEventListener('change', () => {
        if (permission.state === 'granted') startMovementSafetyTracking();
        else stopMovementSafetyTracking();
      });
      movementPermissionStatus = permission;
      applyMovementState(movementState);
    } catch { /* permission state is unavailable; a deliberate location action can start tracking */ }
  }

  async function requestMovementLocationAccess() {
    try {
      const position = await currentPosition();
      applyMovementState(movementTracker.addFix(movementFix(position)));
      showToast('Location enabled. Keep still briefly while Rider Comms confirms you are stationary.');
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
  let rideLocationTimer;

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
    } else {
      if (rideLocationTimer) clearInterval(rideLocationTimer);
      rideLocationTimer = undefined;
      if (!state.activeRide) rideMemberLocations = new Map();
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
    saveRecentSearch(item);
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
    const action = provider === 'in_app'
      ? `<button class="compact-button" data-start-in-app-navigation aria-label="Start navigation in Rider Comms">Start in Rider Comms</button>`
      : `<a class="compact-button" href="${navigationHref(provider, lat, lng, label)}" target="_blank" rel="noopener noreferrer" aria-label="Open directions in ${escapeHtml(providerInfo.label)}">${escapeHtml(providerInfo.label)}</a>`;
    card.innerHTML = `<div class="destination-card-top"><span class="avatar" style="--avatar:#ff2d5a" aria-hidden="true"><svg><use href="#i-location"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(label || 'Selected place')}</strong><span>${escapeHtml(secondary)}</span></div></div><div class="destination-card-actions">${action}<button class="icon-button" aria-label="Dismiss destination" data-dismiss-destination>×</button></div>`;
    card.hidden = false;
    $('[data-start-in-app-navigation]', card)?.addEventListener('click', () => void startInAppNavigation(location, label));
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

  // Rider Comms guidance is opt-in through Settings. It remains a development
  // navigation surface until physical-route, backgrounding and reroute tuning
  // are validated, while riders can always choose an external provider.
  let directionsService;
  let directionsRenderer;
  let navSteps = [];
  let navStepIndex = 0;
  let navWatchId;
  let navDestination = null; // { lat, lng, label }
  let navLastAnnouncedStep = -1;
  let navOffRouteSince = null;
  let navRerouting = false;
  let navGpsWatchdog;
  let navLastFixAt = 0;
  let navGpsIssue = null;

  const NAV_STEP_ARRIVAL_RADIUS_M = 30;
  const NAV_OFF_ROUTE_RADIUS_M = 60;
  const NAV_OFF_ROUTE_GRACE_MS = 10_000;
  const NAV_GPS_STALE_MS = 12_000;
  const NAV_GPS_CHECK_MS = 2_000;
  const NAV_GPS_STALE_NOTICE = 'GPS signal lost. Keep following the route with caution.';
  const NAV_GPS_UNAVAILABLE_NOTICE = 'Live GPS tracking is unavailable. Keep following the route with caution.';
  const NAV_GPS_PERMISSION_NOTICE = 'Location access was removed. Navigation is paused until location access is restored.';

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
    if (state.unit === 'km') {
      if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
      const kilometres = meters / 1000;
      return `${kilometres.toFixed(kilometres < 10 ? 1 : 0)} km`;
    }
    const miles = meters / 1609.344;
    if (miles < 0.1) {
      const feet = meters * 3.28084;
      return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
    }
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
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

  // Navigation now extends the real app surface through the installed-iPhone
  // bottom safe area. Do not recolour browser/system chrome to hide a gap.
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
    $('#navBanner').hidden = false;
    $('#navSummary').hidden = false;
    renderNavStep();
    startNavTracking();
  }

  function setNavGpsIssue(message) {
    if (navGpsIssue === message) return;
    navGpsIssue = message;
    navOffRouteSince = null;
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = message;
      notice.hidden = false;
    }
  }

  function clearNavGpsIssue() {
    if (!navGpsIssue) return;
    navGpsIssue = null;
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = '';
      notice.hidden = true;
    }
    if (navSteps.length) showToast('GPS signal restored.');
  }

  function handleNavPositionError(error) {
    if (!navSteps.length) return;
    setNavGpsIssue(error?.code === 1 ? NAV_GPS_PERMISSION_NOTICE : NAV_GPS_UNAVAILABLE_NOTICE);
  }

  function startNavTracking() {
    stopNavTracking();
    navLastFixAt = Date.now();
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = '';
      notice.hidden = true;
    }
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
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = '';
      notice.hidden = true;
    }
  }

  function handleNavPosition(position) {
    navLastFixAt = Date.now();
    clearNavGpsIssue();
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
    if (arrived) {
      showToast('You have arrived.');
      speak('You have arrived at your destination.');
    }
  }

  function initialiseGoogleMap() {
    // Render immediately even when GPS is unavailable, but never present the
    // London fallback as the rider's own position. If the already-granted
    // location watcher resolved before Maps finished loading, start directly
    // from that real fix instead.
    const fallbackCentre = { lat: 51.564, lng: -0.106 };
    const liveCentre = latestDevicePosition
      ? { lat: latestDevicePosition.coords.latitude, lng: latestDevicePosition.coords.longitude }
      : null;
    const centre = liveCentre || fallbackCentre;
    map = new google.maps.Map($('#googleMap'), {
      center: centre,
      zoom: liveCentre ? 15 : 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      backgroundColor: prefersDarkMode() ? '#080d10' : '#f2f5f6',
      styles: prefersDarkMode() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
    });
    usingFallbackMap = false;
    $('#fallbackMap').hidden = true;
    $('#fallbackMarkers').hidden = true;
    $('#hazardMarkers').hidden = true;
    $('#mapError').hidden = true;
    renderMapStatus();
    initPlaceSearch();
    if (liveCentre) {
      userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, liveCentre, true);
      mapCentredOnLiveLocation = true;
    }
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
      if (registration.waiting && navigator.serviceWorker.controller) $('#updateBanner').hidden = false;
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
    $('#enableLocationBtn').addEventListener('click', () => void requestMovementLocationAccess());
    window.addEventListener('popstate', () => {
      if (activeChat) closeChat();
      navigate(location.hash.split('/')[0].slice(1) || 'map', false);
    });
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
    $('#activeRideLocationConsent').addEventListener('change', (event) => {
      void setRideLocationSharing(event.target.checked);
    });
    $('#rideRoster').addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-remove-ride-member]');
      if (!button) return;
      void removeRideMemberFromActiveRide(button.dataset.removeRideMember);
    });
    $('#shareRideBtn').addEventListener('click', shareRide);
    $('#rideShareTop').addEventListener('click', shareRide);
    $('#copyRideCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.activeRide.code); showToast('Ride code copied.'); } catch { shareRide(); } });
    $('#openRideMap').addEventListener('click', () => navigate('map'));
    $('#ridePill').addEventListener('click', () => navigate('ride'));
    $('#friendSearch').addEventListener('input', renderFriends);
    $('#chatBack').addEventListener('click', () => {
      if (location.hash === '#friends/chat') history.back();
      else closeChat();
    });
    $('#chatHideoutPlan').addEventListener('click', openPlanHideoutSheet);
    $('#chatSafety').addEventListener('click', () => { if (activeChat) openFriendSafetyActions(activeChat); });
    $('#chatRetry').addEventListener('click', () => void loadChatMessages({ showLoading: true }));
    $('#chatLoadOlder').addEventListener('click', () => void loadChatMessages({ older: true }));
    $('#chatComposer').addEventListener('submit', (event) => { event.preventDefault(); submitChatMessage(); });
    $('#chatInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitChatMessage(); }
    });
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
    document.documentElement.classList.add('auth-open');
  }

  function hideAuthScreen() {
    $('#authScreen').hidden = true;
    $('#app').hidden = false;
    document.documentElement.classList.remove('auth-open');
    // Auth is a fixed full-screen surface; once the real app shell becomes
    // visible, resample after paint so a cold-start standalone launch does not
    // keep the shorter pre-auth WebKit viewport until the user rotates.
    settleViewportEnvironment();
  }

  const AUTH_ERROR_MESSAGES = {
    username_taken: 'That username is already taken.',
    email_taken: 'That email is already registered.',
    invalid_username: 'Usernames must be 3–20 letters, numbers or underscores.',
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Passwords must be at least 8 characters.',
    invalid_credentials: 'Incorrect username or password.',
    invalid_token: 'That reset code is invalid or has already been used.',
    expired_token: 'That reset code has expired. Request a new one.',
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
    state.profile.avatarId = profile.avatarId || 'ember';
    state.profile.zoneTier = planTier(profile.zoneTier);
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
      const result = await apiFetch('POST', '/auth/login', { username, password, deviceName: 'Rider Comms PWA' });
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
      const result = await apiFetch('POST', '/auth/signup', { username, email, password, deviceName: 'Rider Comms PWA' });
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

  async function requestPasswordReset(email) {
    const errorEl = $('#recoverError');
    const button = $('#recoverSubmit');
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await apiFetch('POST', '/auth/password-reset/request', { email });
      $('#resetToken').value = '';
      setAuthMode('reset');
      const notice = $('#authNotice');
      notice.textContent = 'If that address belongs to an account, a one-hour reset link and code has been sent.';
      notice.classList.remove('error');
      notice.hidden = false;
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link';
    }
  }

  async function resetPassword(token, password) {
    const errorEl = $('#resetError');
    const button = $('#resetSubmit');
    errorEl.hidden = true;
    if (password.length < 8 || password.length > 128) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.weak_password;
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Resetting…';
    try {
      await apiFetch('POST', '/auth/password-reset/confirm', { token, password });
      clearSession();
      setAuthMode('login');
      const notice = $('#authNotice');
      notice.textContent = 'Password updated. Sign in again on each device.';
      notice.classList.remove('error');
      notice.hidden = false;
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Reset password';
    }
  }

  let authFormsWired = false;
  let setAuthMode = () => {};
  function wireAuthForms(initialResetToken = '') {
    if (authFormsWired) {
      if (initialResetToken) { $('#resetToken').value = initialResetToken; setAuthMode('reset', false); }
      return;
    }
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
      recover: {
        eyebrow: 'Account recovery',
        title: 'Get back on the road.',
        description: 'Request a one-hour password reset link without revealing whether an account exists.',
      },
      reset: {
        eyebrow: 'Secure reset',
        title: 'Choose a new password.',
        description: 'Enter the one-hour code from your email. Every existing session will be signed out.',
      },
    };

    setAuthMode = (target, moveFocus = true) => {
      const mode = typeof target === 'string' ? target : target.dataset.authMode;
      $$('[data-auth-mode]').forEach((item) => {
        const selected = item.dataset.authMode === mode;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      const forms = { login: $('#loginForm'), signup: $('#signupForm'), recover: $('#recoverForm'), reset: $('#resetForm') };
      Object.entries(forms).forEach(([name, form]) => { form.hidden = name !== mode; form.setAttribute('aria-hidden', String(name !== mode)); });
      $$('.auth-error').forEach((item) => { item.hidden = true; });
      $('#authNotice').hidden = true;
      const copy = authCopy[mode];
      $('#authEyebrow').textContent = copy.eyebrow;
      $('#authTitle').textContent = copy.title;
      $('#authDescription').textContent = copy.description;
      const focusTarget = { login: $('#loginUsername'), signup: $('#signupUsername'), recover: $('#recoverEmail'), reset: $('#resetToken') }[mode];
      if (moveFocus) focusTarget.focus();
    };

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
    $('#forgotPasswordBtn').addEventListener('click', () => setAuthMode('recover'));
    $$('.auth-back-login').forEach((button) => button.addEventListener('click', () => setAuthMode('login')));
    $('#recoverForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void requestPasswordReset($('#recoverEmail').value.trim());
    });
    $('#resetForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void resetPassword($('#resetToken').value.trim(), $('#resetPassword').value);
    });
    if (initialResetToken) { $('#resetToken').value = initialResetToken; setAuthMode('reset', false); }
  }

  function consumePasswordResetLink() {
    const params = new URLSearchParams(location.search);
    const token = params.get('resetToken') || '';
    if (!token) return '';
    params.delete('resetToken');
    const remaining = params.toString();
    history.replaceState({}, '', `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
    return token;
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
    void initialiseMovementSafety();
    document.addEventListener('visibilitychange', () => {
      syncChatPolling();
      if (document.visibilityState === 'visible') void initialiseMovementSafety();
      else stopMovementSafetyTracking();
    });
  }

  async function init() {
    const passwordResetToken = consumePasswordResetLink();
    if (passwordResetToken) {
      wireAuthForms(passwordResetToken);
      showAuthScreen();
      return;
    }
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
