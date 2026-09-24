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
    rideSafeEnabled: true,
    notifications: false,
    profile: {
      riderId: '',
      displayName: '',
      handle: '',
      avatarId: 'ember',
      zoneTier: 'free',
      unitSystem: 'mi',
      notifyNearby: false,
      notifyInvites: false,
      notifyChat: false,
      instagram: '',
      tiktok: '',
      instagramVisibility: 'friends',
      tiktokVisibility: 'friends',
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
    police: { label: 'Police', color: '#2fa8d3' },
    hidden_police: { label: 'Hidden police', color: '#2fa8d3' },
    police_checkpoint: { label: 'Police checkpoint', color: '#2fa8d3' },
    camera: { label: 'Mobile speed camera', color: '#2fa8d3' },
    accident: { label: 'Accident', color: '#f0646b' },
    road_closure: { label: 'Road closure', color: '#f0646b' },
  };
  const HAZARD_TYPE_ORDER = ['police', 'hidden_police', 'police_checkpoint', 'camera', 'accident', 'road_closure'];

  // Brand-specific road report artwork from the approved Rider Comms icon
  // sheet. These are deliberately inline vectors rather than font glyphs so
  // the report sheet, selected cards, navigation alerts and map markers all
  // share the exact same visual language.
  function hazardIconInnerSvg(type) {
    switch (type) {
      case 'police':
        return '<path d="M7 22c2-7.5 8.5-12 17-12s15 4.5 17 12l-6 5H13Z" fill="#2FB7EB"/><path d="M11 27c4 2 22 2 26 0l-2 5c-3 3-7 4-11 4s-8-1-11-4Z" fill="#159CCF"/><path d="M24 14l4 2v4c0 3-1.7 5.4-4 6.6-2.3-1.2-4-3.6-4-6.6v-4Z" fill="#10191F"/>';
      case 'hidden_police':
        return '<path d="M8 22c2-7 8-11 16-11s14 4 16 11l-5 5H13Z" fill="#2FB7EB"/><path d="M24 14l4 2v4c0 3-1.7 5.2-4 6.4-2.3-1.2-4-3.4-4-6.4v-4Z" fill="#10191F"/><path d="M6 31c5-5 11-8 18-8 8 0 14 3 18 8l-2 10H8Z" fill="#303C43"/><path d="M9 31c5-3 10-4 15-4 6 0 11 1 15 4l-1 4H10Z" fill="#63727A"/>';
      case 'police_checkpoint':
        return '<path d="M14 13c1.5-6 5-9 10-9s8.5 3 10 9l-4 4H18Z" fill="#2FB7EB"/><path d="M24 7l3.5 1.7v3.2c0 2.3-1.4 4.1-3.5 5.1-2.1-1-3.5-2.8-3.5-5.1V8.7Z" fill="#10191F"/><rect x="4" y="22" width="40" height="11" rx="2" fill="#F4F7F8"/><polygon points="4,22 11,22 18,33 11,33" fill="#F0646B"/><polygon points="20,22 27,22 34,33 27,33" fill="#F0646B"/><polygon points="36,22 43,22 44,24 44,33 43,33" fill="#F0646B"/><rect x="8" y="33" width="5" height="11" rx="1" fill="#63727A"/><rect x="35" y="33" width="5" height="11" rx="1" fill="#63727A"/>';
      case 'camera':
        return '<rect x="13" y="9" width="14" height="10" rx="2" fill="#2FB7EB"/><circle cx="20" cy="14" r="3" fill="#071015"/><path d="M8 22h25l8 8v10H6a3 3 0 0 1-3-3V27a5 5 0 0 1 5-5Z" fill="#F4F7F8"/><path d="M28 23h5l6 7H28Z" fill="#9EC6D7"/><rect x="9" y="26" width="12" height="7" rx="1.5" fill="#73848D"/><circle cx="12" cy="40" r="4" fill="#10191F"/><circle cx="34" cy="40" r="4" fill="#10191F"/><path d="M30 10c4 1 7 4 8 8" fill="none" stroke="#2FB7EB" stroke-width="3" stroke-linecap="round"/><path d="M32 5c7 2 11 6 13 13" fill="none" stroke="#2FB7EB" stroke-width="3" stroke-linecap="round"/>';
      case 'accident':
        return '<polygon points="24,4 28,12 35,7 34,15 43,14 37,21 45,24 36,28 39,35 30,31 24,40 18,31 9,35 12,28 3,24 11,21 5,14 14,15 13,7 20,12" fill="#F0646B"/><path d="M1 31l4-9h12l5 9v9H3a2 2 0 0 1-2-2Z" fill="#F4F7F8"/><path d="M26 31l5-9h12l4 9v7a2 2 0 0 1-2 2H26Z" fill="#F4F7F8"/><rect x="6" y="25" width="9" height="5" rx="1" fill="#87979E"/><rect x="33" y="25" width="9" height="5" rx="1" fill="#87979E"/><circle cx="7" cy="40" r="3" fill="#10191F"/><circle cx="18" cy="40" r="3" fill="#10191F"/><circle cx="31" cy="40" r="3" fill="#10191F"/><circle cx="43" cy="40" r="3" fill="#10191F"/>';
      case 'road_closure':
        return '<circle cx="24" cy="16" r="14" fill="#F0646B"/><circle cx="24" cy="16" r="10.5" fill="#F4F7F8"/><rect x="13" y="14" width="22" height="4" rx="2" fill="#F0646B"/><rect x="4" y="29" width="40" height="9" rx="2" fill="#F4F7F8"/><polygon points="4,29 12,29 19,38 11,38" fill="#F0646B"/><polygon points="21,29 29,29 36,38 28,38" fill="#F0646B"/><polygon points="38,29 44,29 44,36 43,38" fill="#F0646B"/><rect x="8" y="38" width="5" height="7" rx="1" fill="#63727A"/><rect x="35" y="38" width="5" height="7" rx="1" fill="#63727A"/>';
      default:
        return '';
    }
  }

  function hazardIconMarkup(type, className = 'hazard-art-icon') {
    return '<svg class="' + className + '" viewBox="0 0 48 48" aria-hidden="true">' + hazardIconInnerSvg(type) + '</svg>';
  }

  function hazardPinIcon(type, selected = false) {
    const size = selected ? 32 : 26;
    const border = selected ? '#35D6FF' : '#3C4E58';
    const borderWidth = selected ? 2.8 : 1.8;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
      + '<path d="M32 2C17 2 7 12.5 7 26c0 16.5 25 36 25 36s25-19.5 25-36C57 12.5 47 2 32 2Z" fill="#0D171C" stroke="' + border + '" stroke-width="' + borderWidth + '"/>'
      + '<g transform="translate(15 7) scale(0.7)">' + hazardIconInnerSvg(type) + '</g></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size),
    };
  }
  const {
    navigationHazardLabel,
    navigationHazardsAhead,
  } = window.RiderNavigationRoadEvents;

  const { PositionAnimator } = window.RiderPositionInterpolation;

  const {
    AVATAR_FAMILIES,
    AVATAR_PRESETS,
    AVATAR_PRESET_BY_ID,
    avatarPreset,
    getAvatarFamily,
    riderAvatarSvg,
  } = window.RiderAvatarSystem;

  function riderAvatarMapIcon(person, current = false, statusOverride, sizeOverride, navigationMode = false) {
    const status = navigationMode
      ? 'none'
      : statusOverride || (current
        ? (state.profile.shareLocation || state.activeRide?.shareRideLocation ? 'online' : 'none')
        : 'online');
    const svg = riderAvatarSvg(person.avatarId, { selected: current, mapMarker: !navigationMode, status });
    const width = sizeOverride ?? (current ? 44 : 40);
    const height = navigationMode ? width : width * (72 / 64);
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(width, height),
      anchor: navigationMode
        ? new google.maps.Point(width / 2, height / 2)
        : new google.maps.Point(width / 2, height - 1),
    };
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

  // Keep Google's current Roadmap visual language as the basemap rather than
  // recreating Google Maps with embedded JSON styles. Rider Comms owns only
  // the rider/hazard/route layers and controls above it.
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
    // Maps JS colorScheme is initialization-only. FOLLOW_SYSTEM owns the
    // basemap theme; this only keeps the empty/loading canvas in sync if the
    // OS appearance changes while Rider Comms is already open.
    map?.setOptions({
      backgroundColor: prefersDarkMode() ? '#080d10' : '#e9eef0',
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
  // Track the backend-authorised public voice roster separately from display
  // profiles so faster presence polling does not churn LiveKit tokens.
  let nearbyVoicePeerKey = '';

  // Real per-rider coordinates for the active ride's members (GET
  // /rides/:id/locations) — same runtime-only convention as nearbyRiders
  // above. Separate mechanism from nearbyRiders/public presence entirely:
  // see the 0016_private_ride_location_consent migration in backend/src/db.ts.
  // Upload is opt-in for each ride and the backend excludes stale or former
  // members. Keyed by riderId for easy lookup when placing markers.
  let rideMemberLocations = new Map();

  // Social online/last-seen is deliberately separate from location presence.
  // It is loaded only for current friends and never persisted to localStorage.
  let friendActivity = new Map();
  let outgoingFriendRequests = [];
  let conversationSummaries = new Map();
  let unreadMessageCount = 0;
  let socialEventCursor;
  let socialEventGeneration = 0;
  let friendActivityTimer;
  let activeFriendProfileRiderId = null;

  // Real crowdsourced hazard reports for the current area (GET
  // /hazards/nearby), refreshed whenever the map screen is (re)opened or a
  // new report is created — same runtime-only convention as nearbyRiders
  // above, since a report can expire or be voted away server-side at any
  // moment.
  let nearbyHazards = [];
  let pendingHazardReportPosition = null;

  function hazardReportPosition(position) {
    const lat = Number(position?.coords?.latitude);
    const lon = Number(position?.coords?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function captureHazardReportPosition() {
    // Match Waze's report flow: snapshot the location when reporting starts,
    // not after the rider has spent time choosing a category. Reuse the
    // authoritative device fix; never infer or road-snap the incident.
    pendingHazardReportPosition = hazardReportPosition(latestDevicePosition);
    if (pendingHazardReportPosition) return;
    void currentPosition()
      .then((position) => {
        if (!pendingHazardReportPosition && !$('#sheetBackdrop')?.hidden && $('#sheetTitle')?.textContent === 'Report on the road') {
          pendingHazardReportPosition = hazardReportPosition(position);
        }
      })
      .catch(() => {});
  }

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
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const stored = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
        if (stored && typeof stored.riderId === 'string' && typeof stored.token === 'string') return stored;
      } catch { /* fall through to the next storage */ }
    }
    return null;
  }

  function saveSession(nextSession, remember = true) {
    session = nextSession;
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(nextSession));
  }

  function clearSession() {
    stopSocialEvents();
    clearInterval(friendActivityTimer);
    friendActivityTimer = undefined;
    socialEventCursor = undefined;
    outgoingFriendRequests = [];
    conversationSummaries = new Map();
    unreadMessageCount = 0;
    session = null;
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }

  let session = loadSession();
  const movementTracker = new window.RiderMovementSafety.MovementStateTracker();
  let movementState = 'unknown';
  let movementWatchId;
  let movementFreshnessTimer;
  let movementPermissionStatus;
  let movementAccessDenied = false;
  let rideRefreshVersion = 0;
  let latestDevicePosition;
  let mapCentredOnLiveLocation = false;
  let activeChat = null;
  let chatMessages = [];
  let chatNextCursor = null;
  let chatHasLoadedOlder = false;
  let chatPeerReadThroughMessageId = null;
  let chatLoading = false;
  let chatLoadPromise = null;
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
  async function apiFetch(method, path, body, timeoutMs = 10_000) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
  let lastSelfDeviceFixAtMs;
  const mapMarkers = new Map(); // riderId -> { marker, status }
  let mapHazardMarkers = [];
  // Riders' real positions only ever change in discrete jumps -- a poll
  // every RIDE_LOCATION_REFRESH_MS/PRESENCE_REFRESH_MS, or a GPS fix every
  // couple of seconds -- so every marker glides toward each new fix over an
  // animation loop instead of snapping straight to it, the same way
  // Google Maps/Waze/Apple Maps read as continuous motion despite an
  // equally infrequent underlying position source. Keyed by an arbitrary
  // string ('self' for userMapMarker, riderId for everyone else) so one
  // loop drives every animated marker on the map.
  const animatedMarkers = new Map();
  let animatedMarkersFrame;

  function tickAnimatedMarkers() {
    animatedMarkersFrame = undefined;
    if (animatedMarkers.size === 0) return;
    const now = Date.now();
    for (const { marker, animator } of animatedMarkers.values()) {
      const position = animator.positionAt(now);
      marker.setPosition({ lat: position.lat, lng: position.lon });
    }
    animatedMarkersFrame = requestAnimationFrame(tickAnimatedMarkers);
  }

  function ensureMarkerAnimationLoop() {
    if (animatedMarkersFrame === undefined) animatedMarkersFrame = requestAnimationFrame(tickAnimatedMarkers);
  }

  /** Registers/updates `marker` under `key` and glides it to `{lat,lng}` over `durationMs`. */
  function glideMarkerTo(key, marker, latLng, durationMs, nowMs) {
    const target = { lat: latLng.lat, lon: latLng.lng };
    let entry = animatedMarkers.get(key);
    if (!entry) {
      entry = { marker, animator: new PositionAnimator(target) };
      animatedMarkers.set(key, entry);
    } else {
      entry.marker = marker;
      entry.animator.moveTo(target, durationMs, nowMs);
    }
    ensureMarkerAnimationLoop();
  }

  /** Registers/updates `marker` under `key`, jumping immediately with no glide (a marker's first fix). */
  function snapMarkerTo(key, marker, latLng) {
    const target = { lat: latLng.lat, lon: latLng.lng };
    const entry = animatedMarkers.get(key);
    if (entry) {
      entry.marker = marker;
      entry.animator.reset(target);
    } else {
      animatedMarkers.set(key, { marker, animator: new PositionAnimator(target) });
    }
  }

  function removeAnimatedMarker(key) {
    animatedMarkers.delete(key);
  }
  let destinationMarker;
  let navigationTrafficLayer;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(stateStorageKey()) || 'null');
      if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_STATE);
      const storedProfile = stored.profile && typeof stored.profile === 'object' ? stored.profile : {};
      const legacySocialVisibility = storedProfile.socialsVisibility || 'friends';
      return {
        ...structuredClone(DEFAULT_STATE),
        ...stored,
        rideSafeEnabled: stored.rideSafeEnabled !== false,
        navigationProvider: navigationProvider(stored.navigationProvider),
        unit: storedProfile.unitSystem === 'km' ? 'km' : storedProfile.unitSystem === 'mi' ? 'mi' : stored.unit === 'km' ? 'km' : 'mi',
        profile: {
          ...DEFAULT_STATE.profile,
          ...storedProfile,
          instagramVisibility: storedProfile.instagramVisibility || legacySocialVisibility,
          tiktokVisibility: storedProfile.tiktokVisibility || legacySocialVisibility,
        },
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

  function avatar(person, className = '') {
    const preset = avatarPreset(person.avatarId);
    return `<span class="avatar ${className}" style="--avatar:${preset.bg}" aria-hidden="true">${riderAvatarSvg(person.avatarId)}</span>`;
  }

  function avatarOptionsMarkup(selectedId) {
    const selectedFamily = getAvatarFamily(selectedId);
    const familyTabs = AVATAR_FAMILIES.map((family) => {
      const active = family.id === selectedFamily;
      return `<button type="button" class="avatar-family-tab${active ? ' active' : ''}" data-avatar-family-tab="${family.id}" role="tab" aria-selected="${active}">${escapeHtml(family.label)}</button>`;
    }).join('');
    const panels = AVATAR_FAMILIES.map((family) => {
      const active = family.id === selectedFamily;
      const options = AVATAR_PRESETS.filter((preset) => preset.family === family.id).map((preset) => {
        const selected = preset.id === selectedId;
        return `<button type="button" class="avatar-picker-option${selected ? ' selected' : ''}" data-avatar-option="${preset.id}" role="radio" aria-checked="${selected}" aria-label="${escapeHtml(preset.label)} avatar"><span class="avatar avatar-lg" style="--avatar:${preset.bg}">${riderAvatarSvg(preset.id, { selected })}</span><span class="avatar-picker-label">${escapeHtml(preset.label)}</span>${selected ? '<span class="avatar-picker-check">✓</span>' : ''}</button>`;
      }).join('');
      return `<div class="avatar-family-panel" data-avatar-family-panel="${family.id}"${active ? '' : ' hidden'}><div class="avatar-picker-grid" role="radiogroup" aria-label="${escapeHtml(family.label)} avatars">${options}</div></div>`;
    }).join('');
    return `<div class="avatar-family-tabs" role="tablist" aria-label="Avatar type">${familyTabs}</div>${panels}`;
  }

  function setAvatarPickerFamily(familyId) {
    const body = $('#sheetBody');
    if (!body || !AVATAR_FAMILIES.some((family) => family.id === familyId)) return;
    body.querySelectorAll('[data-avatar-family-tab]').forEach((button) => {
      const active = button.dataset.avatarFamilyTab === familyId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    body.querySelectorAll('[data-avatar-family-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.avatarFamilyPanel !== familyId;
    });
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
    [...document.querySelectorAll('.screen')].forEach((item) => item.classList.toggle('active', item.dataset.screen === screen));
    [...document.querySelectorAll('[data-nav]')].forEach((item) => {
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

  window.addEventListener('rider-comms:navigate-to', (event) => {
    const detail = event.detail;
    const lat = Number(detail?.lat);
    const lng = Number(detail?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      showToast('That route start is unavailable.');
      return;
    }
    const label = typeof detail?.label === 'string' && detail.label.trim() ? detail.label.trim().slice(0, 120) : 'Route start';
    navigate('map');

    // Keep the destination actionable even when the Google map is still
    // loading or the app has fallen back to its non-map surface. The card
    // itself only needs the LatLng interface; once Maps becomes available,
    // upgrade the same destination to a real marker without changing intent.
    const fallbackLocation = { lat: () => lat, lng: () => lng };
    showDestinationCard(fallbackLocation, label, 'Curated route start');

    const openOnMap = () => {
      if (!map || !window.google?.maps) return false;
      const location = new google.maps.LatLng(lat, lng);
      setDestinationMarker(location, label, 'Curated route start');
      map.panTo(location);
      map.setZoom(Math.max(map.getZoom() || 14, 14));
      return true;
    };

    if (!openOnMap()) setTimeout(openOnMap, 500);
  });

  function renderProfile() {
    $('#profileName').textContent = state.profile.displayName;
    $('#profileHandle').textContent = state.profile.handle;
    const profileRiderId = $('#profileRiderId');
    if (profileRiderId) profileRiderId.textContent = state.profile.riderId;
    const distanceUnitsSummary = $('#distanceUnitsSummary');
    if (distanceUnitsSummary) distanceUnitsSummary.textContent = state.profile.unitSystem === 'km' ? 'Kilometres' : 'Miles';
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
    const completeProfilePrompt = $('#completeProfilePrompt');
    if (completeProfilePrompt) completeProfilePrompt.hidden = !genericProfile;
    document.querySelectorAll('[data-avatar]').forEach((element) => {
      const preset = avatarPreset(state.profile.avatarId);
      element.innerHTML = riderAvatarSvg(state.profile.avatarId);
      element.style.setProperty('--avatar', preset.bg);
    });
    if (userMapMarker && map && !usingFallbackMap) {
      userMapMarker.setIcon?.(riderAvatarMapIcon(state.profile, true));
    }
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

  function renderMapHazards() {
    if (!map || usingFallbackMap) return;
    mapHazardMarkers.forEach((entry) => entry.marker.setMap(null));
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
    if (!hazard) { card.hidden = true; setHazardMarkerSelection(); return; }
    const meta = HAZARD_TYPES[hazard.type];
    hideDestinationCard();
    setHazardMarkerSelection(hazard.id);
    card.innerHTML = `<span class="hazard-card-art" aria-hidden="true">${hazardIconMarkup(hazard.type)}</span><div class="rider-card-copy"><strong>${escapeHtml(meta.label)}</strong><span>Reported ${timeAgo(hazard.createdAt)}</span><div class="hazard-vote-row"><button class="compact-button" data-vote="confirm">Still there (${hazard.confirmations})</button><button class="compact-button" data-vote="deny">Gone (${hazard.denials})</button></div></div><button class="icon-button" aria-label="Dismiss" data-dismiss-hazard>×</button>`;
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

  function visibleMapRiders() {
    if (!state.activeRide) return [];
    return (state.activeRide.members || [])
      .filter((member) => member.riderId !== state.profile.riderId && rideMemberLocations.has(member.riderId));
  }

  function renderMapRiders() {
    renderHazardMarkers();
    const riders = visibleMapRiders();
    if (!map || usingFallbackMap) return renderFallbackMarkers([]);
    if (userMapMarker) {
      if (navSteps.length) updateNavigationPositionIcon();
      else userMapMarker.setIcon?.(riderAvatarMapIcon(state.profile, true));
    }
    // Update existing markers in place (position glides, icon swaps only
    // when status actually changes) instead of tearing every marker down
    // and rebuilding it on every call -- this used to run on every ride
    // poll tick *and* on unrelated UI actions (selecting a rider, voting on
    // a hazard, ...), so riders' avatars would visibly flicker even when
    // nothing about their position had changed.
    const now = Date.now();
    const seenRiderIds = new Set();
    for (const person of riders) {
      seenRiderIds.add(person.riderId);
      const real = rideMemberLocations.get(person.riderId);
      const fresh = now - real.updatedAt <= RIDE_LOCATION_REFRESH_MS * 2;
      const status = fresh ? 'online' : 'stale';
      const latLng = { lat: real.lat, lng: real.lon };
      const existing = mapMarkers.get(person.riderId);
      if (!existing) {
        const marker = addMapMarker(person, latLng, false, status);
        mapMarkers.set(person.riderId, { marker, status });
        snapMarkerTo(person.riderId, marker, latLng);
      } else {
        if (existing.status !== status) {
          existing.status = status;
          existing.marker.setIcon(riderAvatarMapIcon(person, false, status));
        }
        glideMarkerTo(person.riderId, existing.marker, latLng, RIDE_LOCATION_REFRESH_MS, now);
      }
    }
    for (const [riderId, existing] of mapMarkers) {
      if (seenRiderIds.has(riderId)) continue;
      existing.marker.setMap(null);
      mapMarkers.delete(riderId);
      removeAnimatedMarker(riderId);
    }
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

  function friendActivityLabel(activity) {
    if (!activity) return 'Offline';
    if (activity.online) return 'Online now';
    if (!Number.isFinite(activity.lastSeenAt)) return 'Offline';
    const elapsed = Math.max(0, Date.now() - activity.lastSeenAt);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `Last seen ${Math.max(1, minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last seen ${hours}h ago`;
    return `Last seen ${Math.floor(hours / 24)}d ago`;
  }

  async function loadAllFriendPages() {
    const friends = [];
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friends?${query.toString()}`);
      friends.push(...(Array.isArray(page.friends) ? page.friends : []));
      before = page.nextCursor || undefined;
    } while (before);
    return friends;
  }

  async function loadAllFriendRequestPages() {
    const incoming = [];
    const outgoing = [];
    const profiles = {};
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friend-requests?${query.toString()}`);
      incoming.push(...(Array.isArray(page.incoming) ? page.incoming : []));
      outgoing.push(...(Array.isArray(page.outgoing) ? page.outgoing : []));
      Object.assign(profiles, page.profiles || {});
      before = page.nextCursor || undefined;
    } while (before);
    return { incoming, outgoing, profiles };
  }

  async function loadAllConversationPages() {
    const conversations = [];
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/conversations?${query.toString()}`);
      conversations.push(...(Array.isArray(page.conversations) ? page.conversations : []));
      before = page.nextCursor || undefined;
    } while (before);
    return conversations;
  }

  async function refreshFriendActivity() {
    if (!state.profile.riderId) return;
    try {
      const result = await apiFetch('GET', '/friends/activity');
      friendActivity = new Map((Array.isArray(result.activity) ? result.activity : []).map((item) => [item.riderId, item]));
      renderFriends();
    } catch {
      // Preserve the last known activity state on transient network errors.
    }
  }

  async function refreshMessageSummaries() {
    if (!state.profile.riderId) return;
    const [conversations, unread] = await Promise.all([
      loadAllConversationPages(),
      apiFetch('GET', '/messages/unread-count'),
    ]);
    conversationSummaries = new Map(conversations.map((conversation) => [conversation.friend.riderId, conversation]));
    unreadMessageCount = Number.isFinite(unread.unreadCount) ? unread.unreadCount : 0;
    renderFriends();
  }

  function syncFriendActivityPolling() {
    clearInterval(friendActivityTimer);
    friendActivityTimer = undefined;
    if (!session) return;
    friendActivityTimer = setInterval(() => { void refreshFriendActivity(); }, 30_000);
  }

  function renderFriends() {
    const query = $('#friendSearch').value.trim().toLowerCase();
    const friends = state.friends
      .filter((friend) => [friend.displayName, friend.handle, friend.riderId].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => {
        const aOnline = friendActivity.get(a.riderId)?.online === true;
        const bOnline = friendActivity.get(b.riderId)?.online === true;
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        return 0;
      });
    const onlineFriends = friends.filter((friend) => friendActivity.get(friend.riderId)?.online === true);
    const offlineFriends = friends.filter((friend) => friendActivity.get(friend.riderId)?.online !== true);

    const incomingRows = state.requests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></div><div class="request-actions"><button class="decline" data-decline="${escapeHtml(person.id)}" aria-label="Decline ${escapeHtml(person.displayName)}">×</button><button class="accept" data-accept="${escapeHtml(person.id)}" aria-label="Accept ${escapeHtml(person.displayName)}">✓</button></div></article>`).join('');
    const outgoingRows = outgoingFriendRequests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · Pending</span></div><div class="request-actions"><button data-cancel-request="${escapeHtml(person.id)}" aria-label="Cancel request to ${escapeHtml(person.displayName)}">Cancel</button></div></article>`).join('');
    $('#requestList').innerHTML = incomingRows + outgoingRows;

    const friendRowHtml = (person) => {
      const activity = friendActivity.get(person.riderId);
      const online = activity?.online === true;
      const unread = conversationSummaries.get(person.riderId)?.unreadCount || 0;
      const inActiveRide = state.activeRide?.memberIds?.includes(person.riderId) === true;
      const activityCopy = inActiveRide ? 'In your group ride' : friendActivityLabel(activity);
      return `<button class="friend-row${online ? ' is-online' : ''}" data-friend="${escapeHtml(person.riderId)}">
        <span class="friend-avatar-wrap">${avatar(person)}<i class="friend-presence-dot ${online ? 'online' : 'offline'}" aria-hidden="true"></i></span>
        <span class="identity"><strong>${escapeHtml(person.displayName)}</strong><span class="friend-activity">${escapeHtml(activityCopy)}</span></span>
        ${unread > 0 ? `<span class="count-badge friend-unread-badge" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</span>` : ''}
        <span class="friend-more" aria-hidden="true">•••</span>
      </button>`;
    };
    $('#friendList').innerHTML = [
      onlineFriends.length
        ? `<section class="friend-group"><h2 class="friend-group-label">Online (${onlineFriends.length})</h2>${onlineFriends.map(friendRowHtml).join('')}</section>`
        : '',
      offlineFriends.length
        ? `<section class="friend-group"><h2 class="friend-group-label">Offline (${offlineFriends.length})</h2>${offlineFriends.map(friendRowHtml).join('')}</section>`
        : '',
    ].join('');
    const hasFriends = state.friends.length > 0;
    const hasVisibleFriends = friends.length > 0;
    const requestTotal = state.requests.length + outgoingFriendRequests.length;
    const hasRequests = requestTotal > 0;
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
    if (requestCount) requestCount.textContent = String(requestTotal);
    $('#networkFriendCount').textContent = String(state.friends.length);
    $('#networkRequestCount').textContent = String(requestTotal);
    const navBadge = $('#friendsNavBadge');
    const attentionCount = state.requests.length + unreadMessageCount;
    if (navBadge) {
      navBadge.textContent = attentionCount > 99 ? '99+' : String(attentionCount);
      navBadge.hidden = attentionCount === 0;
    }
    $$('[data-accept]').forEach((button) => button.addEventListener('click', () => acceptRequest(button.dataset.accept)));
    $$('[data-decline]').forEach((button) => button.addEventListener('click', () => declineRequest(button.dataset.decline)));
    $$('[data-cancel-request]').forEach((button) => button.addEventListener('click', () => cancelRequest(button.dataset.cancelRequest)));
    $$('[data-friend]').forEach((button) => button.addEventListener('click', () => openFriendProfile(button.dataset.friend)));
  }

  async function openFriendProfile(riderId) {
    const friend = state.friends.find((person) => person.riderId === riderId);
    if (!friend) {
      if (activeFriendProfileRiderId === riderId) closeSheet();
      return;
    }

    const renderProfile = (profile, { loading = false, refreshError = false } = {}) => {
      const currentFriend = state.friends.find((person) => person.riderId === riderId);
      if (!currentFriend) {
        if (activeFriendProfileRiderId === riderId) closeSheet();
        return false;
      }
      const activity = friendActivity.get(riderId);
      const activityCopy = friendActivityLabel(activity);
      const inActiveRide = state.activeRide?.memberIds?.includes(riderId) === true;
      const rideLocation = rideMemberLocations.get(riderId);
      const liveRideLocation = inActiveRide && rideLocation && Date.now() - rideLocation.updatedAt <= RIDE_LOCATION_REFRESH_MS * 2
        ? rideLocation
        : null;
      const socialLinks = [
        profile.instagramUsername ? `<a class="social-link" href="https://www.instagram.com/${encodeURIComponent(profile.instagramUsername)}/" target="_blank" rel="noopener"><span>Instagram</span><strong>@${escapeHtml(profile.instagramUsername)}</strong>${icon('chevron')}</a>` : '',
        profile.tiktokUsername ? `<a class="social-link" href="https://www.tiktok.com/@${encodeURIComponent(profile.tiktokUsername)}" target="_blank" rel="noopener"><span>TikTok</span><strong>@${escapeHtml(profile.tiktokUsername)}</strong>${icon('chevron')}</a>` : '',
      ].filter(Boolean).join('');
      const sharedProfileCount = Number(Boolean(profile.instagramUsername)) + Number(Boolean(profile.tiktokUsername));
      const groupRideCount = state.activeRide?.memberIds?.length ?? 0;
      const profileAvatar = avatar({ ...currentFriend, avatarId: profile.avatarId || currentFriend.avatarId });
      const mapActionState = liveRideLocation
        ? ' aria-label="View rider on map"'
        : ' disabled aria-disabled="true" aria-label="Rider location not shared" title="This rider is not sharing a fresh private-ride location."';
      const shareLocationState = inActiveRide
        ? ` aria-pressed="${state.activeRide?.shareRideLocation === true}" aria-label="${state.activeRide?.shareRideLocation === true ? 'Stop sharing your location with this group ride' : 'Share your location with this group ride'}" title="Shares your location with everyone in your current group ride, not just this rider."`
        : ' disabled aria-disabled="true" aria-label="Share location unavailable outside a shared group ride" title="Available when you are in the same group ride."';

      presentSheet(currentFriend.displayName, `<article class="friend-profile-card">
          <div class="friend-profile-identity">
            <span class="friend-profile-avatar">${profileAvatar}<i class="friend-presence-dot ${activity?.online ? 'online' : 'offline'}" aria-hidden="true"></i></span>
            <div class="friend-profile-copy">
              <strong>${escapeHtml(currentFriend.displayName)}</strong>
              <span>${escapeHtml(currentFriend.handle)} · ${escapeHtml(activityCopy)}</span>
            </div>
          </div>
        </article>
        <div class="friend-profile-actions" aria-label="Rider actions">
          <button id="messageFriend"><span class="friend-action-icon">${icon('message')}</span><strong>Message</strong></button>
          <button id="shareFriendLocation"${shareLocationState}><span class="friend-action-icon">${icon('nav-arrow')}</span><strong>Share to Ride</strong></button>
          <button id="friendMapAction"${mapActionState}><span class="friend-action-icon">${icon('location')}</span><strong>Map</strong></button>
          <button id="friendSafetyActions"><span class="friend-action-icon friend-action-more" aria-hidden="true">•••</span><strong>More</strong></button>
        </div>
        <div class="friend-profile-detail-list">
          <div><span class="setting-icon">${icon('location')}</span><span><strong>Location</strong><small>${liveRideLocation ? 'Shared in your current ride · updated recently' : 'Not shared with you'}</small></span></div>
          <div><span class="setting-icon">${icon('ride')}</span><span><strong>Group ride</strong><small>${inActiveRide ? `${groupRideCount} rider${groupRideCount === 1 ? '' : 's'} · riding together` : 'Not in your current ride'}</small></span></div>
          <div><span class="setting-icon">${icon('friends')}</span><span><strong>Shared profiles</strong><small>${sharedProfileCount ? `${sharedProfileCount} profile${sharedProfileCount === 1 ? '' : 's'} shared with you` : 'None shared'}</small></span></div>
        </div>
        ${loading
          ? '<p class="friend-profile-note friend-profile-note-quiet">Refreshing shared profile…</p>'
          : refreshError
            ? '<p class="friend-profile-note friend-profile-note-quiet">Could not refresh shared profile. Reopen this rider to try again.</p>'
            : socialLinks
              ? `<div class="friend-profile-social"><span class="friend-profile-section-label">Shared profiles</span><div class="social-links">${socialLinks}</div></div>`
              : ''}
        ${liveRideLocation ? '<button id="viewFriendOnMap" class="friend-profile-view-map">View on Map</button>' : ''}`, () => {
        const showFriendOnMap = () => {
          if (!liveRideLocation) return;
          closeSheet();
          navigate('map');
          centreMap(liveRideLocation.lat, liveRideLocation.lon);
          const ridePeople = state.activeRide?.members || [];
          if (ridePeople.some((person) => person.riderId === riderId)) selectRider(riderId, ridePeople);
        };
        $('#shareFriendLocation').addEventListener('click', async () => {
          if (!inActiveRide || !state.activeRide) return;
          const enable = state.activeRide.shareRideLocation !== true;
          const ok = await setRideLocationSharing(enable);
          if (ok && activeFriendProfileRiderId === riderId) renderProfile(profile);
        });
        $('#messageFriend').addEventListener('click', () => openChat(currentFriend));
        $('#friendMapAction').addEventListener('click', showFriendOnMap);
        $('#viewFriendOnMap')?.addEventListener('click', showFriendOnMap);
        $('#friendSafetyActions').addEventListener('click', () => openFriendSafetyActions(currentFriend));
      });
      activeFriendProfileRiderId = riderId;
      return true;
    };

    // Scrub any previously-visible social links immediately. The authoritative
    // public profile response is the only thing allowed to reveal them again.
    if (!renderProfile(friend, { loading: true })) return;

    let profile;
    try {
      profile = await apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`);
    } catch {
      // The scrubbed friendship identity stays visible, but no stale social
      // links survive a failed privacy refresh.
      if (activeFriendProfileRiderId === riderId) renderProfile(friend, { refreshError: true });
      return;
    }
    if (activeFriendProfileRiderId !== riderId) return;
    renderProfile(profile);
  }

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
      const status = message.status === 'pending'
        ? '<small>Sending…</small>'
        : failed
          ? '<small>Failed — tap to retry</small>'
          : mine && message.id === chatPeerReadThroughMessageId
            ? '<small>Read</small>'
            : '';
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

  async function loadChatMessages({ older = false, showLoading = false, throwOnError = false } = {}) {
    if (!activeChat || (older && !chatNextCursor)) return;

    // Latest-thread refreshes are authoritative and must never be discarded
    // just because another chat fetch is already in flight. Older-page loads
    // remain user-driven and simply wait for a quiet thread.
    if (older && chatLoadPromise) return;
    while (!older && chatLoadPromise) {
      try { await chatLoadPromise; } catch { /* The queued latest fetch retries below. */ }
      if (!activeChat) return;
    }

    const riderId = activeChat.riderId;
    const run = (async () => {
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
        chatPeerReadThroughMessageId = page.peerReadThroughMessageId || null;
        setChatError('');
        if (!older) {
          try {
            await apiFetch('POST', '/messages/read', { withRiderId: riderId });
            await refreshMessageSummaries();
          } catch {
            // The conversation loaded successfully. Read-state reconciliation
            // can recover independently without turning the thread into an error.
          }
        }
        renderChat();
        if (!older) requestAnimationFrame(() => { $('#chatThread').scrollTop = $('#chatThread').scrollHeight; });
      } catch (error) {
        const unavailable = error instanceof ApiError && error.status === 403;
        setChatError(unavailable ? 'This conversation is no longer available.' : 'Could not refresh messages. Check your connection and try again.', unavailable);
        // A 403 is authoritative relationship state, not a transport failure.
        // Transient failures must escape realtime callers so they rebaseline
        // instead of advancing the durable cursor with a stale open thread.
        if (throwOnError && !unavailable) throw error;
      } finally {
        chatLoading = false;
        renderChat();
      }
    })();

    chatLoadPromise = run;
    try {
      await run;
    } finally {
      if (chatLoadPromise === run) chatLoadPromise = null;
    }
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
    chatPeerReadThroughMessageId = null;
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
    history.pushState({ screen: 'friends', chat: friend.riderId }, '', '#friends/chat');
    document.title = `${friend.displayName} · Rider Comms`;
    void loadChatMessages({ showLoading: true });
    void loadChatHideouts();
  }

  function closeChat({ restoreFocus = true } = {}) {
    if (!activeChat) return;
    activeChat = null;
    chatMessages = [];
    chatNextCursor = null;
    chatHasLoadedOlder = false;
    chatPeerReadThroughMessageId = null;
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
      chatMessages = window.RiderMessageState.acknowledge(chatMessages, localId, sent);
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

  function openFriendReportActions(friend) {
    presentSheet('Report rider', `<article class="friend-more-card">
        <span class="friend-more-avatar">${avatar(friend)}</span>
        <span><strong>${escapeHtml(friend.displayName)}</strong><small>${escapeHtml(friend.handle)}</small></span>
      </article>
      <p class="friend-more-intro">Choose the reason that best describes the issue. Reports are sent to Rider Comms for review.</p>
      <div class="friend-more-menu" aria-label="Report reason">
        <button data-report-rider="harassment"><span class="friend-more-icon">${icon('message')}</span><span><strong>Harassment</strong><small>Threats, abuse or repeated unwanted contact</small></span>${icon('chevron')}</button>
        <button data-report-rider="unsafe"><span class="friend-more-icon">${icon('shield')}</span><span><strong>Unsafe behaviour</strong><small>Dangerous conduct affecting rider safety</small></span>${icon('chevron')}</button>
        <button data-report-rider="spam"><span class="friend-more-icon">${icon('info')}</span><span><strong>Spam or scam</strong><small>Advertising, scams or repeated unwanted messages</small></span>${icon('chevron')}</button>
      </div>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $('[data-report-rider]', $('#sheetBody')).forEach((button) => {
        button.addEventListener('click', () => void reportFriend(friend, button.dataset.reportRider));
      });
    });
  }

  function openFriendSafetyActions(friend) {
    presentSheet('More actions', `<article class="friend-more-card">
        <span class="friend-more-avatar">${avatar(friend)}</span>
        <span><strong>${escapeHtml(friend.displayName)}</strong><small>${escapeHtml(friend.handle)}</small></span>
      </article>
      <div class="friend-more-menu" aria-label="Connection actions">
        <button id="shareFriendIdMore"><span class="friend-more-icon">${icon('share')}</span><span><strong>Share Rider ID</strong><small>Send or copy this rider’s ID</small></span>${icon('chevron')}</button>
        <button id="removeFriendBtn"><span class="friend-more-icon">${icon('friends')}</span><span><strong>Remove friend</strong><small>End this Rider Comms connection</small></span>${icon('chevron')}</button>
      </div>
      <span class="friend-more-section-label">Safety</span>
      <div class="friend-more-menu" aria-label="Safety actions">
        <button id="reportFriendBtn"><span class="friend-more-icon">${icon('shield')}</span><span><strong>Report rider</strong><small>Harassment, unsafe behaviour or spam</small></span>${icon('chevron')}</button>
        <button class="danger" id="blockFriendBtn"><span class="friend-more-icon">${icon('close')}</span><span><strong>Block rider</strong><small>Remove this connection and prevent further contact</small></span>${icon('chevron')}</button>
      </div>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $('#shareFriendIdMore').addEventListener('click', async () => {
        const message = `${friend.displayName} on Rider Comms: ${friend.riderId}`;
        if (navigator.share) {
          try { await navigator.share({ text: message }); return; }
          catch (error) { if (error?.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(friend.riderId); showToast('Rider ID copied.'); }
        catch { showToast(friend.riderId); }
      });
      $('#removeFriendBtn').addEventListener('click', () => void removeFriend(friend));
      $('#reportFriendBtn').addEventListener('click', () => openFriendReportActions(friend));
      $('#blockFriendBtn').addEventListener('click', () => void blockFriend(friend));
    });
  }

  async function removeFriend(friend) {
    if (!window.confirm(`Remove ${friend.displayName} from your friends list?`)) return;
    const button = $('#removeFriendBtn');
    const error = $('#friendSafetyError');
    button.disabled = true;
    error.hidden = true;
    try {
      await apiFetch(
        'DELETE',
        `/riders/${encodeURIComponent(state.profile.riderId)}/friends/${encodeURIComponent(friend.riderId)}`,
      );
      state.friends = state.friends.filter((candidate) => candidate.riderId !== friend.riderId);
      state.requests = state.requests.filter((request) => request.riderId !== friend.riderId);
      outgoingFriendRequests = outgoingFriendRequests.filter((request) => request.riderId !== friend.riderId);
      conversationSummaries.delete(friend.riderId);
      persist();
      renderFriends();
      if (activeChat?.riderId === friend.riderId) closeChat({ restoreFocus: false });
      closeSheet();
      showToast(`${friend.displayName} removed from friends.`);
      void Promise.all([refreshFriendNetwork(), refreshMessageSummaries()]).catch(() => {});
    } catch {
      button.disabled = false;
      error.textContent = 'Could not remove that friend. Check your connection and try again.';
      error.hidden = false;
    }
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

  const SOCIAL_EVENT_RETRY_MS = 2000;

  function waitForSocialRetry(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runSocialEventLoop(generation) {
    while (session && generation === socialEventGeneration) {
      try {
        if (!socialEventCursor) {
          const baseline = await apiFetch('GET', '/social/events?limit=100&waitMs=0');
          if (generation !== socialEventGeneration) return;
          socialEventCursor = baseline.cursor;

          // Cursor establishment is only valid once every authoritative social
          // snapshot succeeds. If any fetch fails, the catch below clears the
          // cursor so recovery starts from a new tail instead of keeping stale
          // local state behind an already-advanced cursor.
          await Promise.all([
            refreshFriendNetwork(),
            refreshMessageSummaries(),
            refreshProfileAuthoritative(),
          ]);
          if (activeChat) await loadChatMessages({ throwOnError: true });
          if (activeFriendProfileRiderId) await openFriendProfile(activeFriendProfileRiderId);
        }

        let page = await apiFetch(
          'GET',
          `/social/events?after=${encodeURIComponent(socialEventCursor)}&limit=100&waitMs=25000`,
          undefined,
          30_000,
        );
        if (generation !== socialEventGeneration) return;

        let networkDirty = false;
        let messageDirty = false;
        let chatDirty = false;
        let selfProfileDirty = false;
        const friendProfileDirtyRiderIds = new Set();

        while (true) {
          for (const event of Array.isArray(page.events) ? page.events : []) {
            const peerProfileDirty = event.type === 'social_refresh'
              && event.entityId === 'profile'
              && event.actorRiderId !== state.profile.riderId;
            if (event.type === 'friend_request' || event.type === 'friend_request_resolved' || event.type === 'friend_removed' || peerProfileDirty) {
              networkDirty = true;
            }
            if (event.type === 'message' || event.type === 'message_read' || event.type === 'friend_removed') {
              messageDirty = true;
            }
            if (event.type === 'message' || event.type === 'message_read' || event.type === 'friend_removed') chatDirty = true;
            if (peerProfileDirty) friendProfileDirtyRiderIds.add(event.actorRiderId);
            if (event.type === 'social_refresh' && event.entityId === 'profile' && event.actorRiderId === state.profile.riderId) {
              selfProfileDirty = true;
            }
          }
          socialEventCursor = page.cursor || socialEventCursor;
          if (!page.hasMore || generation !== socialEventGeneration) break;
          page = await apiFetch(
            'GET',
            `/social/events?after=${encodeURIComponent(socialEventCursor)}&limit=100&waitMs=0`,
          );
        }

        if (generation !== socialEventGeneration) return;
        if (selfProfileDirty) await refreshProfileAuthoritative();
        if (networkDirty) await refreshFriendNetwork();
        if (messageDirty) await refreshMessageSummaries();
        if (chatDirty && activeChat) await loadChatMessages({ throwOnError: true });

        const openProfileRiderId = activeFriendProfileRiderId;
        if (openProfileRiderId && !state.friends.some((friend) => friend.riderId === openProfileRiderId)) {
          closeSheet();
        } else if (openProfileRiderId && friendProfileDirtyRiderIds.has(openProfileRiderId)) {
          await openFriendProfile(openProfileRiderId);
        }
      } catch {
        if (generation !== socialEventGeneration || !session) return;
        socialEventCursor = undefined;
        await waitForSocialRetry(SOCIAL_EVENT_RETRY_MS);
      }
    }
  }

  function startSocialEvents() {
    socialEventGeneration += 1;
    socialEventCursor = undefined;
    void runSocialEventLoop(socialEventGeneration);
  }

  function stopSocialEvents() {
    socialEventGeneration += 1;
    socialEventCursor = undefined;
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
  async function refreshFriendNetwork() {
    if (!state.profile.riderId) return;
    const [friendsResult, requestsResult, activityResult] = await Promise.all([
      loadAllFriendPages(),
      loadAllFriendRequestPages(),
      apiFetch('GET', '/friends/activity').catch(() => null),
    ]);
    state.friends = friendsResult.map((friend) => ({
      riderId: friend.riderId,
      displayName: friend.displayName,
      handle: friend.handle,
      avatarId: friend.avatarId || 'ember',
      status: 'Connected',
    }));
    if (activityResult) {
      friendActivity = new Map((Array.isArray(activityResult.activity) ? activityResult.activity : []).map((item) => [item.riderId, item]));
    }

    const incoming = requestsResult.incoming.filter((request) => request.status === 'pending');
    state.requests = incoming.map((request) => {
      const profile = requestsResult.profiles?.[request.fromRiderId];
      return {
        id: request.id,
        riderId: request.fromRiderId,
        displayName: profile?.displayName ?? request.fromRiderId,
        handle: profile?.handle ?? request.fromRiderId,
        avatarId: profile?.avatarId || 'ember',
        status: 'Wants to connect',
      };
    });
    const outgoing = requestsResult.outgoing.filter((request) => request.status === 'pending');
    outgoingFriendRequests = outgoing.map((request) => {
      const profile = requestsResult.profiles?.[request.toRiderId];
      return {
        id: request.id,
        riderId: request.toRiderId,
        displayName: profile?.displayName ?? request.toRiderId,
        handle: profile?.handle ?? request.toRiderId,
        avatarId: profile?.avatarId || 'ember',
      };
    });
    persist();
    renderFriends();
  }

  async function loadFriendsData() {
    if (!state.profile.riderId) return;
    try {
      // Network and message summaries are independent authoritative resources.
      // Apply either successful snapshot even when the other one is transiently
      // unavailable; realtime callers use the throwing functions directly.
      await Promise.all([refreshFriendNetwork(), refreshMessageSummaries()]);
    } catch (error) {
      showToast('Could not load friends. ' + authErrorMessage(error));
    }
  }

  async function acceptRequest(requestId) {
    try {
      const result = await apiFetch('POST', `/friends/requests/${encodeURIComponent(requestId)}/accept`, {});
      state.requests = state.requests.filter((request) => request.id !== requestId);
      if (!state.friends.some((friend) => friend.riderId === result.friend.riderId)) {
        state.friends.push({ riderId: result.friend.riderId, displayName: result.friend.displayName, handle: result.friend.handle, avatarId: result.friend.avatarId || 'ember', status: 'Connected now' });
      }
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

  async function cancelRequest(requestId) {
    try {
      await apiFetch('DELETE', `/friends/requests/${encodeURIComponent(requestId)}`);
      outgoingFriendRequests = outgoingFriendRequests.filter((request) => request.id !== requestId);
      renderFriends();
      showToast('Request cancelled.');
    } catch {
      showToast('Could not cancel that request. Try again.');
    }
  }

  const FRIEND_REQUEST_ERROR_MESSAGES = {
    cannot_friend_yourself: 'You cannot send a friend request to yourself.',
    rider_not_found: 'No rider with that handle or Rider ID was found.',
    blocked: 'This connection is unavailable.',
    request_exists: 'A friend request is already pending between you.',
    already_friends: 'You are already friends with this rider.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    unauthorized: 'Your session has expired. Sign in again.',
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
    $('#activeRideCode').textContent = ride.code || 'Invite expired';
    $('#ridePillCode').textContent = ride.code || 'Invite expired';
    $('#copyRideCode').disabled = !ride.code;
    $('#rideShareTop').disabled = !ride.code;
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
    const rideId = state.activeRide.rideId;
    const members = await resolveRiderProfiles(state.activeRide.memberIds);
    if (state.activeRide?.rideId !== rideId) return;
    state.activeRide.members = members;
    persist();
    renderRide();
  }

  // Reconcile membership, invite validity and private location consent from
  // the server. Cached ride details are never enough to resume sharing.
  async function refreshActiveRide() {
    const version = rideRefreshVersion;
    try {
      const previous = state.activeRide;
      const { ride } = await apiFetch('GET', '/rides/current');
      if (version !== rideRefreshVersion) return;
      state.activeRide = ride ? {
        rideId: ride.rideId, code: ride.code, isHost: ride.createdBy === state.profile.riderId,
        createdBy: ride.createdBy, memberIds: ride.memberIds,
        shareRideLocation: ride.shareRideLocation === true,
        members: previous?.rideId === ride.rideId ? previous.members : undefined,
      } : null;
      if (ride) await stopPublicPresenceForRide();
      if (!ride) {
        state.selectedRiderId = null;
        rideMemberLocations = new Map();
      }
      persist();
      renderRide();
      if (ride) await loadRideRoster();
      else if (previous) showToast('That ride is no longer active.');
    } catch (error) {
      // Transient failures leave the last verified state intact. A fresh
      // login starts with no verified ride and can retry from the Ride tab.
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
      if (!(await preflightMicrophoneAccess())) return;
      const shareRideLocation = $('#hostRideLocationConsent').checked;
      const result = await apiFetch('POST', '/rides', {});
      rideRefreshVersion += 1;
      state.activeRide = { rideId: result.rideId, code: result.code, isHost: true, createdBy: result.createdBy, memberIds: result.memberIds, shareRideLocation: false };
      await stopPublicPresenceForRide();
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
      if (!(await preflightMicrophoneAccess())) return;
      const shareRideLocation = $('#joinRideLocationConsent').checked;
      const joined = await apiFetch('POST', '/rides/join', { code });
      const ride = await apiFetch('GET', `/rides/${encodeURIComponent(joined.rideId)}`);
      rideRefreshVersion += 1;
      state.activeRide = { rideId: ride.rideId, code, isHost: ride.createdBy === state.profile.riderId, createdBy: ride.createdBy, memberIds: ride.memberIds, shareRideLocation: false };
      await stopPublicPresenceForRide();
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
      rideRefreshVersion += 1;
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
    if (!state.activeRide.code) return showToast('This invite has expired. Your ride remains active.');
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

  function wireSettingsHubRows() {
    $$('[data-settings-target]', $('#sheetBody')).forEach((button) => {
      button.addEventListener('click', () => openSheet(button.dataset.settingsTarget));
    });
  }

  function openSheet(type) {
    const templates = {
      accountHub: () => {
        const tier = planTier(state.profile.zoneTier);
        const plan = PLAN_INFO[tier];
        return {
          title: 'Account',
          body: `<div class="settings-hub-list">
            <button data-settings-target="profile"><span class="setting-icon">${icon('user')}</span><span><strong>Profile</strong><small>Name, handle and connected profiles</small></span>${icon('chevron')}</button>
            <button data-settings-target="plans"><span class="setting-icon">${icon('card')}</span><span><strong>Plan and billing</strong><small id="planSummary">${escapeHtml(plan.name)} plan · ${escapeHtml(plan.priceLabel === 'Free' ? 'No card on file' : `${plan.priceLabel}/mo`)}</small></span><span id="planPill" class="plan-pill">${escapeHtml(plan.name)}</span>${icon('chevron')}</button>
            <button data-settings-target="sessions"><span class="setting-icon">${icon('settings')}</span><span><strong>Signed-in devices</strong><small>Review and revoke account sessions</small></span>${icon('chevron')}</button>
            <button data-settings-target="account"><span class="setting-icon">${icon('shield')}</span><span><strong>Account and data</strong><small>Account deletion and settings reset</small></span>${icon('chevron')}</button>
          </div>`,
          ready: wireSettingsHubRows,
        };
      },
      communication: () => ({
        title: 'Communication',
        body: `<div class="settings-hub-list">
          <button data-settings-target="notifications"><span class="setting-icon">${icon('bell')}</span><span><strong>Notifications</strong><small>Nearby riders, ride invites and group chat</small></span>${icon('chevron')}</button>
          <button data-settings-target="privacy"><span class="setting-icon">${icon('shield')}</span><span><strong>Privacy controls</strong><small>Location visibility and connected profiles</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      mapNavigation: () => ({
        title: 'Map & Navigation',
        body: `<div class="settings-hub-list">
          <button data-settings-target="map"><span class="setting-icon">${icon('location')}</span><span><strong>Location and map</strong><small>Location sharing and nearby riders</small></span>${icon('chevron')}</button>
          <button data-settings-target="navigation"><span class="setting-icon">${icon('nav-arrow')}</span><span><strong>Navigation</strong><small id="navigationProviderSummary">${escapeHtml(NAVIGATION_PROVIDERS[navigationProvider(state.navigationProvider)].label)}</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      offlineMaps: () => ({
        title: 'Offline Maps',
        body: '<div class="settings-note"><strong>Online maps only</strong><p>Offline map downloads are not available in this build yet. Rider Comms currently needs a data connection for map tiles and route calculation.</p></div>',
      }),
      unitsPreferences: () => ({
        title: 'Units & Preferences',
        body: `<div class="settings-hub-list"><button data-settings-target="units"><span class="setting-icon">${icon('units')}</span><span><strong>Distance units</strong><small id="distanceUnitsSummary">${state.profile.unitSystem === 'km' ? 'Kilometres' : 'Miles'}</small></span>${icon('chevron')}</button></div>`,
        ready: wireSettingsHubRows,
      }),
      help: () => ({
        title: 'Help & Support',
        body: `<div class="settings-hub-list">
          <button data-settings-target="safety"><span class="setting-icon">${icon('info')}</span><span><strong>Safety guidance</strong><small>Low-distraction and emergency guidance</small></span>${icon('chevron')}</button>
          <button data-settings-target="legal"><span class="setting-icon">${icon('shield')}</span><span><strong>Privacy, safety & terms</strong><small>Read Rider Comms legal and safety information</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      about: () => ({
        title: 'About',
        body: `<div class="settings-about-card"><strong>Rider Comms</strong><span>Version 0.3.0 · PWA</span><span>Signed in as ${escapeHtml(state.profile.riderId)}</span></div>`,
      }),
      legal: () => ({
        title: 'Privacy, safety & terms',
        body: `<div class="settings-legal-list">
          <section><strong>Privacy</strong><p>Rider Comms stores its private session token in browser storage for this test build. Profile settings, friendships, messages, rides, hideouts and optional social usernames are sent to the test API. Public nearby-rider location starts only after you enable sharing and go live. Private-ride location is a separate, optional choice for each ride and is removed when you switch it off, leave, are removed or the ride ends.</p></section>
          <section><strong>Your choices</strong><p>Location sharing starts off. Instagram and TikTok usernames each have Public, Friends only or Private visibility. You can delete your account and associated test data from Settings.</p></section>
          <section><strong>Rider safety and conduct</strong><p>Harassment, threats, sexual exploitation, dangerous content, spam and impersonation are not allowed. Direct-message screens include Report and Block controls. Blocking removes the friendship and prevents further messages or requests.</p></section>
          <section><strong>Riding safety</strong><p>Do not operate messaging, profile or billing controls while moving. Stop somewhere safe before using visual or touch controls.</p></section>
          <section><strong>Test-build notice</strong><p>This is a pre-alpha test build backed by a test API and database. A published privacy policy, support contact, documented retention schedule, tested deletion process and staffed moderation operation are still required before public store release.</p></section>
        </div>`,
      }),
      profile: () => ({
        title: 'Edit profile',
        body: `<div class="settings-sheet-section"><span class="settings-sheet-label">Identity</span><div class="form-field"><label>Avatar</label>${avatarOptionsMarkup(state.profile.avatarId)}</div><div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Rider handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div><p class="caption">${session?.emailVerified ? 'Email verified.' : 'Email verification pending. Nearby Voice requires a verified email.'}</p>${session?.emailVerified ? '' : '<button class="button secondary wide" id="resendVerificationBtn">Resend verification email</button>'}</div><div class="settings-sheet-section"><span class="settings-sheet-label">Connected profiles</span><div class="form-field"><label for="editInstagram">Instagram</label><input id="editInstagram" maxlength="31" value="${escapeHtml(state.profile.instagram)}" placeholder="Username"></div><div class="form-field"><label for="editTiktok">TikTok</label><input id="editTiktok" maxlength="31" value="${escapeHtml(state.profile.tiktok)}" placeholder="Username"></div><p class="caption">Control who can see these in Privacy controls.</p></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save changes</button>`,
        ready: () => {
          $('#saveProfile').addEventListener('click', saveProfile);
          $('#resendVerificationBtn')?.addEventListener('click', () => void resendVerificationEmail());
          document.querySelectorAll('#sheetBody [data-avatar-option]').forEach((button) => {
            button.addEventListener('click', () => void selectProfileAvatar(button.dataset.avatarOption));
          });
          document.querySelectorAll('#sheetBody [data-avatar-family-tab]').forEach((button) => {
            button.addEventListener('click', () => setAvatarPickerFamily(button.dataset.avatarFamilyTab));
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
        body: `<div class="settings-note"><strong>Reset settings</strong><p>Reset your Rider Comms profile and synced preferences to their defaults, and restore Google Maps as the device navigation provider.</p></div><button class="button secondary wide" id="resetSettingsBtn">Reset settings</button><div class="settings-note"><strong>Delete Rider Comms account</strong><p>This permanently removes your account and associated test data. This cannot be undone.</p></div><button class="button danger wide" id="deleteAccountBtn">Delete account</button><p id="deleteAccountError" class="inline-error" hidden></p>`,
        ready: () => {
          $('#resetSettingsBtn').addEventListener('click', () => void resetSettings());
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
      privacy: () => ({ title: 'Privacy controls', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Live location', 'Visible to nearby riders only while you are live.', state.profile.shareLocation)}</div><div class="settings-sheet-section"><div class="form-field"><label for="sheetInstagramVisibility">Instagram visibility</label><select id="sheetInstagramVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><div class="form-field"><label for="sheetTiktokVisibility">TikTok visibility</label><select id="sheetTiktokVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><p class="caption">Choose who can see each connected profile independently.</p></div>`, ready: () => { const instagram = $('#sheetInstagramVisibility'); const tiktok = $('#sheetTiktokVisibility'); instagram.value = state.profile.instagramVisibility; tiktok.value = state.profile.tiktokVisibility; instagram.addEventListener('change', (event) => { void patchProfile({ instagramVisibility: event.target.value }); }); tiktok.addEventListener('change', (event) => { void patchProfile({ tiktokVisibility: event.target.value }); }); wireToggles(); } }),
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
      units: () => ({ title: 'Distance units', body: `<div class="choice-list" role="radiogroup" aria-label="Distance units"><button data-unit-option="mi" role="radio"><span><strong>Miles</strong><small>Use miles and mph</small></span><i></i></button><button data-unit-option="km" role="radio"><span><strong>Kilometres</strong><small>Use kilometres and km/h</small></span><i></i></button></div>`, ready: () => { $$('[data-unit-option]', $('#sheetBody')).forEach((button) => { const active = button.dataset.unitOption === state.profile.unitSystem; button.setAttribute('aria-checked', String(active)); button.addEventListener('click', async () => { button.disabled = true; const next = button.dataset.unitOption; const ok = await patchProfile({ unitSystem: next }); if (ok) { openSheet('units'); showToast('Distance unit updated.'); } else button.disabled = false; }); }); } }),
      notifications: () => ({ title: 'Notifications', body: `<div class="settings-sheet-section">${toggleMarkup('notifyNearby', 'Nearby riders', 'Notify me about nearby riders.', state.profile.notifyNearby)}${toggleMarkup('notifyInvites', 'Ride invites', 'Notify me about group ride invitations.', state.profile.notifyInvites)}${toggleMarkup('notifyChat', 'Group chat messages', 'Notify me about group ride messages.', state.profile.notifyChat)}</div><div class="settings-note"><strong>Browser permission required</strong><p>Enabling a notification preference also requires browser notification permission. Background delivery remains platform-dependent.</p></div>`, ready: wireToggles }),
      safety: () => ({
        title: 'Safety',
        body: `<div class="settings-sheet-section">${toggleMarkup('rideSafeEnabled', 'Automatic Ride Safe', 'Uses device motion to lock distracting controls at 8 mph and above. Recommended while riding.', state.rideSafeEnabled)}</div><div class="settings-note"><strong>Device-only safety preference</strong><p>When off, Rider Comms stops its dedicated Ride Safe location watcher. Map, navigation and optional ride-location features request location separately. Only change this while safely stopped.</p></div><div class="safety-guidance"><div><span class="setting-icon"><svg><use href="#i-ride"/></svg></span><span><strong>Set up while stationary</strong><small>Complete profile, route and group controls before moving.</small></span></div><div><span class="setting-icon"><svg><use href="#i-location"/></svg></span><span><strong>Control your location</strong><small>Nearby visibility can be stopped at any time.</small></span></div><div><span class="setting-icon"><svg><use href="#i-info"/></svg></span><span><strong>Not an emergency service</strong><small>Call the appropriate emergency service if you need urgent help.</small></span></div></div>`,
        ready: wireToggles,
      }),
      reportHazard: () => ({
        title: 'Report on the road',
        body: `<p class="caption">Let nearby riders know what's ahead. Reports fade out over time.</p><div class="hazard-type-grid" id="hazardTypeChips">${HAZARD_TYPE_ORDER.map((t) => `<button type="button" class="hazard-type-tile" data-hazard-type="${t}" style="--hazard:${HAZARD_TYPES[t].color}">${hazardIconMarkup(t)}<span>${escapeHtml(HAZARD_TYPES[t].label)}</span></button>`).join('')}</div><p id="hazardFormError" class="inline-error" hidden></p>`,
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
    activeFriendProfileRiderId = null;
    if ($('#sheetBackdrop').hidden) lastSheetTrigger = document.activeElement;
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = body;
    $('#sheetBackdrop').hidden = false;
    document.documentElement.classList.add('sheet-open');
    $('#app')?.setAttribute('inert', '');
    $('#chatScreen')?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    ready?.();
    $('.sheet').focus({ preventScroll: true });
  }

  function toggleMarkup(key, title, description, active) {
    return `<div class="toggle-row"><span><strong>${escapeHtml(title)}</strong><span class="caption">${escapeHtml(description)}</span></span><button class="toggle" data-toggle="${escapeHtml(key)}" aria-label="${escapeHtml(title)}" aria-pressed="${active}"></button></div>`;
  }

  function sessionDateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Recently active';
  }

  async function resendVerificationEmail() {
    const button = $('#resendVerificationBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      const identity = await apiFetch('GET', '/auth/me');
      const remember = localStorage.getItem(SESSION_KEY) !== null;
      if (identity.emailVerified) {
        saveSession({ ...session, emailVerified: true }, remember);
        showToast('Your email is already verified. Nearby Voice is available.');
        openSheet('profile');
        return;
      }
      const result = await apiFetch('POST', '/auth/resend-verification', {});
      showToast(result.sent
        ? 'Verification email sent. Open the new link, then return to Rider Comms.'
        : 'Verification email could not be sent. Email delivery is not configured or is temporarily unavailable.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      showToast(code === 'rate_limited'
        ? 'Too many verification requests. Wait a moment and try again.'
        : 'Could not resend verification. Check your connection and try again.');
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = 'Resend verification email';
      }
    }
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

  async function resetSettings() {
    if (!window.confirm('Reset Rider Comms settings to their defaults?')) return;
    try {
      if (state.publicLive || state.profile.shareLocation) {
        await stopPublicNearby({ disableLocationSharing: false });
      }
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        zoneTier: 'free',
        avatarId: 'ember',
        displayName: 'Rider',
        handle: '@rider',
        unitSystem: 'mi',
        notifyNearby: false,
        notifyInvites: false,
        notifyChat: false,
        shareLocation: false,
        instagramUsername: '',
        instagramVisibility: 'friends',
        tiktokUsername: '',
        tiktokVisibility: 'friends',
      });
      state.navigationProvider = 'google_maps';
      state.notifications = false;
      applyRemoteProfile(profile);
      persist();
      openSheet('accountHub');
      showToast('Settings reset.');
    } catch {
      showToast('Could not reset settings. Try again.');
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
      if (key === 'rideSafeEnabled') {
        if (!active && !window.confirm('Turn off Automatic Ride Safe? Distracting controls will no longer lock automatically while this device is moving. Only change this while safely stopped.')) return;
        state.rideSafeEnabled = active;
        persist();
        button.setAttribute('aria-pressed', String(active));
        if (active) {
          await initialiseMovementSafety();
          showToast('Automatic Ride Safe is on.');
        } else {
          stopMovementSafetyTracking();
          showToast('Automatic Ride Safe is off on this device.');
        }
        return;
      }
      if (['notifyNearby', 'notifyInvites', 'notifyChat'].includes(key)) {
        button.disabled = true;
        const granted = !active || await requestNotificationPermission();
        if (!granted) {
          button.disabled = false;
          return;
        }
        const ok = await patchProfile({ [key]: active });
        if (ok) {
          state.notifications = Boolean(state.profile.notifyNearby || state.profile.notifyInvites || state.profile.notifyChat);
          persist();
          button.setAttribute('aria-pressed', String(Boolean(state.profile[key])));
        }
        button.disabled = false;
        return;
      }
      if (key === 'shareLocation') {
        button.disabled = true;
        if (!active) {
          const ok = await stopPublicNearby({ disableLocationSharing: true });
          button.disabled = false;
          button.setAttribute('aria-pressed', String(state.profile.shareLocation));
          if (ok) showToast('Nearby visibility and proximity voice are off.');
          return;
        }
        try {
          await currentPosition();
        } catch (error) {
          button.disabled = false;
          showToast(locationAccessMessage(error, 'share your location'));
          return;
        }
        const ok = await patchProfile({ shareLocation: true });
        button.disabled = false;
        if (ok) {
          button.setAttribute('aria-pressed', 'true');
          syncRideLocationSharing();
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
        instagramVisibility: state.profile.instagramVisibility,
        tiktokVisibility: state.profile.tiktokVisibility,
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
    activeFriendProfileRiderId = null;
    const trigger = lastSheetTrigger;
    $('#sheetBackdrop').hidden = true;
    document.documentElement.classList.remove('sheet-open');
    $('#app')?.removeAttribute('inert');
    $('#chatScreen')?.removeAttribute('inert');
    document.body.style.overflow = '';
    lastSheetTrigger = null;
    trigger?.focus?.();
  }

  let nearbyTogglePending = false;

  function renderMapStatus() {
    const active = state.publicLive && state.profile.shareLocation;
    const privateRide = Boolean(state.activeRide);
    const joinBtn = $('#joinNearbyBtn');
    joinBtn.hidden = privateRide;
    joinBtn.dataset.active = String(active);
    joinBtn.setAttribute('aria-label', active ? 'Leave nearby' : 'Go live nearby');
    joinBtn.setAttribute('aria-pressed', String(active));
    const joiningLocked = window.RiderMovementSafety.isLockedForSafety(movementState) && !state.publicLive;
    const unavailable = joiningLocked || nearbyTogglePending;
    joinBtn.toggleAttribute('inert', unavailable);
    joinBtn.toggleAttribute('disabled', nearbyTogglePending);
    joinBtn.setAttribute('aria-disabled', String(unavailable));
    joinBtn.setAttribute('aria-busy', String(nearbyTogglePending));
    renderVoiceStatus();
  }

  // Presence has to be refreshed periodically while live — the backend
  // (presenceStore.ts) drops a rider after ~30s with no ping, so a single
  // POST /presence on "Go live" would only ever produce a mutual match for
  // the ~30s window right after pressing the button. This mirrors what a
  // real always-on client does: keep sending its current fix on an
  // interval for as long as the rider stays live, well inside that
  // staleness window.
  // Keep public presence on the product's 5–10s cadence. Twenty seconds left
  // too little margin inside the backend's ~30s stale lease and delayed peer
  // discovery enough to make two-device testing look disconnected.
  const PRESENCE_REFRESH_MS = 8_000;
  let presenceRefreshTimer;
  let presenceRefreshInFlight = false;

  function stopPresenceRefresh() {
    clearInterval(presenceRefreshTimer);
    presenceRefreshTimer = undefined;
  }

  function startPresenceRefresh() {
    stopPresenceRefresh();
    presenceRefreshTimer = setInterval(async () => {
      if (!state.publicLive || state.activeRide || document.visibilityState !== 'visible' || presenceRefreshInFlight) return;
      presenceRefreshInFlight = true;
      try {
        const position = await currentPublicPresencePosition();
        if (state.publicLive && !state.activeRide) await sendPresence(position);
      } catch { /* A transient miss is retried on the next tick. */ }
      finally { presenceRefreshInFlight = false; }
    }, PRESENCE_REFRESH_MS);
  }

  async function stopPublicNearby({ disableLocationSharing = false } = {}) {
    stopPresenceRefresh();
    state.publicLive = false;
    nearbyRiders = [];
    nearbyVoicePeerKey = '';
    // Only tear down the public proximity transport. This helper is also
    // called from Settings, which remains reachable during a private ride;
    // changing public visibility must never drop that ride's private voice.
    disconnectPublicVoice();
    persist();
    renderMapStatus();
    renderMapRiders();

    // Remove the current public presence lease immediately. The backend also
    // expires stale leases, but a deliberate "off" action should not wait for
    // that timeout before disappearing from Nearby.
    try { await apiFetch('DELETE', '/presence'); } catch { /* Presence also expires server-side. */ }

    if (!disableLocationSharing || !state.profile.shareLocation) return true;
    return patchProfile({ shareLocation: false });
  }

  async function stopPublicPresenceForRide() {
    if (!state.publicLive) return;
    // Entering a private ride ends the public session but does not rewrite the
    // rider's standing public-location preference. The map button itself does
    // revoke that preference, matching native's one-switch behaviour.
    await stopPublicNearby();
  }

  // Stored public-live intent is not proof of current server consent or an
  // active presence lease. Check both consent and existing OS permission before
  // rejoining after a restart; never trigger an unsolicited location prompt.
  async function resumePublicPresence() {
    if (!state.publicLive || state.activeRide) return;
    if (!state.profile.shareLocation) {
      state.publicLive = false;
      persist();
      renderMapStatus();
      return;
    }
    try {
      const permission = await navigator.permissions?.query({ name: 'geolocation' });
      if (permission?.state !== 'granted') throw new Error('location_permission_needed');
      const position = await currentPosition();
      if (!state.publicLive || state.activeRide || !session) return;
      await sendPresence(position);
      startPresenceRefresh();
      await resumePreviouslyAllowedVoice();
    } catch {
      state.publicLive = false;
      nearbyRiders = [];
      try { await apiFetch('DELETE', '/presence'); } catch { /* Lease expires even if offline. */ }
      persist();
      renderMapStatus();
      renderMapRiders();
      showToast('Nearby paused. Tap Go live to resume when location is available.');
    }
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
    const nextVoicePeerKey = [...result.inZoneWith].sort().join('\u0000');
    const voicePeersChanged = nextVoicePeerKey !== nearbyVoicePeerKey;
    nearbyVoicePeerKey = nextVoicePeerKey;
    // Voice authorization should react to the backend roster immediately;
    // resolving display profiles is secondary UI work and can take several
    // extra network round trips on a crowded channel.
    if (state.publicLive && !state.activeRide && microphonePermissionReady && voicePeersChanged) syncVoiceConnection();
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
  const proximityVoiceRooms = new Map(); // peerId -> pair-isolated LiveKit room
  const voiceRemoteSpeakersByRoom = new Map(); // LiveKit Room -> Set<riderId>
  const voiceSpeakerProfiles = new Map(); // riderId -> resolved public profile
  const voiceSpeakerProfileLoads = new Set();
  let voiceTargetKey; // 'channel' or `ride:${rideId}`
  let voiceMeterStream;
  let voiceAudioContext;
  let voiceAnalyser;
  let voiceLevelFrame;
  let voiceAttackTimer;
  let voiceReleaseTimer;
  let voiceLatestRms = 0;
  let voiceManuallyMuted = false;
  let voiceIsSpeaking = false;
  let liveKitLoadPromise;
  let microphonePermissionReady = false;
  let voiceFailureNotified = false;
  let voiceReconnectTimer;
  let publicVoiceRefreshTimer;
  let publicVoiceAuthorizationLeaseTimer;
  let publicVoiceAuthorizationExpired = false;
  let publicVoiceConnectInFlight = false;
  let publicVoiceRefreshPending = false;
  const DEFAULT_PUBLIC_VOICE_AUTHORIZATION_LEASE_MS = 60_000;
  const intentionalVoiceDisconnects = new WeakSet();
  const remoteVoiceElements = new WeakMap();

  // More sensitive than the original 0.06 gate, but with hysteresis and a
  // short attack hold so one wind/helmet bump does not immediately transmit.
  const VOICE_SPEAKING_ATTACK_THRESHOLD = 0.035;
  const VOICE_SPEAKING_RELEASE_THRESHOLD = 0.02;
  const VOICE_ATTACK_HOLD_MS = 70;
  const VOICE_RELEASE_HANGTIME_MS = 650;

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

  function shouldRetryVoiceConnection(error) {
    // Permission/security/no-device failures need rider or device intervention.
    // Retrying them from a timer can also lose the browser user gesture needed
    // to prompt again, so keep the automatic loop for genuinely transient work.
    if (['NotAllowedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) {
      return false;
    }
    if (!(error instanceof ApiError)) return true;
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
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

  function voiceMeterContextNeedsResume() {
    const state = voiceAudioContext?.state;
    // Real Web Audio implementations expose a string AudioContextState.
    // Treat a missing state as "not observable" rather than "suspended" so
    // older/minimal webviews and deterministic test doubles are not falsely
    // pushed into the recovery UI.
    return typeof state === 'string' && state !== 'running';
  }

  async function resumeVoiceMeterContext() {
    const context = voiceAudioContext;
    if (!context || !voiceMeterContextNeedsResume()) return true;
    if (context.state === 'closed' || typeof context.resume !== 'function') return false;
    try {
      await context.resume();
    } catch {
      return false;
    }
    return context === voiceAudioContext && context.state === 'running';
  }

  async function resumePreviouslyAllowedVoice() {
    if (!state.activeRide && !state.publicLive) return;

    // Safari can preserve the LiveKit room while suspending the Web Audio
    // context that drives VOX after an app switch, lock-screen interruption
    // or other media takeover. A connected room with a suspended analyser is
    // not healthy voice: fail closed and try to resume the existing context
    // before treating the session as ready again.
    if (voiceMeterContextNeedsResume()) {
      const resumed = await resumeVoiceMeterContext();
      if (!resumed) {
        voiceFailureNotified = true;
        renderVoiceStatus();
        return;
      }
      voiceFailureNotified = false;
    }

    try {
      const permission = await navigator.permissions?.query({ name: 'microphone' });
      if (permission?.state === 'granted') {
        microphonePermissionReady = true;
        syncVoiceConnection();
      }
    } catch { /* Unsupported Permissions API: wait for a direct rider tap. */ }
    renderVoiceStatus();
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

  function currentVoiceTarget() {
    return state.activeRide ? `ride:${state.activeRide.rideId}` : state.publicLive ? 'channel' : undefined;
  }

  function cleanupRemoteVoiceAudio(room) {
    const elements = remoteVoiceElements.get(room);
    if (elements) {
      for (const element of elements) element.remove();
      elements.clear();
      remoteVoiceElements.delete(room);
    }
    voiceRemoteSpeakersByRoom.delete(room);
    renderVoiceStatus();
  }

  function disconnectManagedVoiceRoom(room) {
    if (!room) return;
    intentionalVoiceDisconnects.add(room);
    cleanupRemoteVoiceAudio(room);
    void room.disconnect().catch(() => {});
  }

  function scheduleVoiceReconnect(targetKey) {
    if (!targetKey || voiceReconnectTimer || !microphonePermissionReady) return;
    voiceReconnectTimer = setTimeout(() => {
      voiceReconnectTimer = undefined;
      if (currentVoiceTarget() !== targetKey) return;
      syncVoiceConnection();
    }, 2000);
  }

  function clearPublicVoiceRefresh() {
    if (publicVoiceRefreshTimer) {
      clearTimeout(publicVoiceRefreshTimer);
      publicVoiceRefreshTimer = undefined;
    }
  }

  function schedulePublicVoiceRefresh(refreshAfterMs) {
    clearPublicVoiceRefresh();
    const delayMs = typeof refreshAfterMs === 'number' && Number.isFinite(refreshAfterMs) && refreshAfterMs > 0
      ? Math.max(1_000, refreshAfterMs)
      : 20_000;
    publicVoiceRefreshTimer = setTimeout(() => {
      publicVoiceRefreshTimer = undefined;
      // Background public voice must not renew without fresh visible-session
      // presence; foregrounding resumes presence before voice authorization.
      if (currentVoiceTarget() !== 'channel' || document.visibilityState !== 'visible') return;
      syncVoiceConnection();
    }, delayMs);
  }

  function clearPublicVoiceAuthorizationLease() {
    if (publicVoiceAuthorizationLeaseTimer) {
      clearTimeout(publicVoiceAuthorizationLeaseTimer);
      publicVoiceAuthorizationLeaseTimer = undefined;
    }
  }

  function expirePublicVoiceAuthorizationLease() {
    publicVoiceAuthorizationLeaseTimer = undefined;
    clearPublicVoiceRefresh();
    if (currentVoiceTarget() !== 'channel') return;

    // A LiveKit participant is not ejected merely because its join token has
    // expired. If the app can no longer re-confirm mutual proximity/block
    // authorization within the server-provided lease, stop transmitting first
    // and tear every public pair room down. Nearby stays armed and retries.
    setVoiceSpeaking(false);
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    if (!voiceRoom) stopVoiceLevelLoop();
    publicVoiceAuthorizationExpired = true;
    voiceFailureNotified = false;
    renderVoiceStatus();
    scheduleVoiceReconnect('channel');
  }

  function renewPublicVoiceAuthorizationLease(leaseMs) {
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    const duration = typeof leaseMs === 'number' && Number.isFinite(leaseMs) && leaseMs > 0
      ? leaseMs
      : DEFAULT_PUBLIC_VOICE_AUTHORIZATION_LEASE_MS;
    publicVoiceAuthorizationLeaseTimer = setTimeout(expirePublicVoiceAuthorizationLease, duration);
  }

  function activeRemoteVoiceSpeakerIds() {
    const ids = new Set();
    for (const speakers of voiceRemoteSpeakersByRoom.values()) {
      for (const riderId of speakers) {
        if (riderId && riderId !== state.profile?.riderId) ids.add(riderId);
      }
    }
    return [...ids];
  }

  function voiceSpeakerProfile(riderId) {
    return voiceSpeakerProfiles.get(riderId)
      || nearbyRiders.find((person) => person.riderId === riderId)
      || state.activeRide?.members?.find((person) => person.riderId === riderId)
      || state.friends.find((person) => person.riderId === riderId);
  }

  function voiceSpeakerSummary() {
    const ids = activeRemoteVoiceSpeakerIds();
    if (!ids.length) return '';
    const names = ids.map((riderId) => voiceSpeakerProfile(riderId)?.displayName || 'Nearby rider');
    return names.length === 1 ? `${names[0]} speaking` : `${names[0]} + ${names.length - 1} speaking`;
  }

  function ensureVoiceSpeakerProfiles(riderIds) {
    for (const riderId of riderIds) {
      if (!riderId || voiceSpeakerProfiles.has(riderId) || voiceSpeakerProfileLoads.has(riderId)) continue;
      voiceSpeakerProfileLoads.add(riderId);
      void apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`)
        .then((profile) => { voiceSpeakerProfiles.set(riderId, profile); })
        .catch(() => {})
        .finally(() => {
          voiceSpeakerProfileLoads.delete(riderId);
          renderVoiceStatus();
        });
    }
  }

  function renderMapVoiceSpeakerChip(summary) {
    let chip = $('#voiceSpeakerChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'voiceSpeakerChip';
      chip.className = 'status-chip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      Object.assign(chip.style, {
        position: 'absolute',
        zIndex: '9',
        top: 'calc(var(--safe-top) + 66px)',
        right: 'max(16px,var(--safe-right))',
        maxWidth: 'min(70vw,260px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      });
      $('#mapCanvas')?.appendChild(chip);
    }
    const visible = Boolean(summary && state.publicLive && !state.activeRide);
    chip.hidden = !visible;
    if (visible) {
      chip.textContent = summary;
      chip.setAttribute('aria-label', summary);
    }
  }

  function wireVoiceRoomLifecycle(room, targetKey, peerId) {
    const events = window.LivekitClient?.RoomEvent;
    const Track = window.LivekitClient?.Track;
    if (!events?.Disconnected) return;

    const audioElements = new Set();
    remoteVoiceElements.set(room, audioElements);

    // The raw LiveKit JS Room API auto-subscribes, but it does NOT render
    // browser audio for us. Attach every subscribed remote audio track to an
    // actual <audio> element or a perfectly healthy room is still silent.
    if (events.TrackSubscribed) {
      room.on(events.TrackSubscribed, (track) => {
        if (Track?.Kind?.Audio && track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.style.display = 'none';
        element.dataset.riderCommsVoice = 'true';
        document.body.appendChild(element);
        audioElements.add(element);
        // iOS/Safari may still require its audio context to be resumed. The
        // direct Go Live flow has already performed getUserMedia from the
        // rider's tap, so this succeeds in the normal test path; failures are
        // harmless and a later room reconnect can retry.
        void room.startAudio?.().catch(() => {});
      });
    }

    if (events.TrackUnsubscribed) {
      room.on(events.TrackUnsubscribed, (track) => {
        for (const element of track.detach()) {
          audioElements.delete(element);
          element.remove();
        }
      });
    }

    if (events.ActiveSpeakersChanged) {
      room.on(events.ActiveSpeakersChanged, (speakers) => {
        const remoteIds = speakers
          .map((participant) => participant.identity)
          .filter((identity) => identity && identity !== state.profile?.riderId);
        voiceRemoteSpeakersByRoom.set(room, new Set(remoteIds));
        ensureVoiceSpeakerProfiles(remoteIds);
        renderVoiceStatus();
      });
    }

    room.on(events.Reconnected, () => {
      voiceFailureNotified = false;
      void room.startAudio?.().catch(() => {});
      renderVoiceStatus();
    });
    room.on(events.Disconnected, () => {
      cleanupRemoteVoiceAudio(room);
      if (intentionalVoiceDisconnects.has(room)) return;

      if (peerId) {
        if (proximityVoiceRooms.get(peerId) === room) proximityVoiceRooms.delete(peerId);
      } else if (voiceRoom === room) {
        voiceRoom = undefined;
        if (voiceTargetKey === targetKey) voiceTargetKey = undefined;
      }

      if (!voiceRoom && !proximityVoiceRooms.size) stopVoiceLevelLoop();
      renderVoiceStatus();
      scheduleVoiceReconnect(targetKey);
    });
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
    const wantsVoice = Boolean(state.activeRide || state.publicLive);
    const meterNeedsResume = connected && voiceMeterContextNeedsResume();
    const needsResume = wantsVoice && (
      (!connected && (!microphonePermissionReady || voiceFailureNotified))
      || meterNeedsResume
    );
    // Public Nearby intentionally releases microphone capture when there are
    // no authorised proximity peers. Keep the feature visibly "armed" instead
    // of making that privacy/battery optimisation look like voice crashed.
    const publicAuthorizationExpired = state.publicLive
      && !state.activeRide
      && publicVoiceAuthorizationExpired;
    const waitingForPublicPeer = state.publicLive
      && !state.activeRide
      && !connected
      && microphonePermissionReady
      && !voiceFailureNotified
      && !publicAuthorizationExpired;
    const resumeLocked = needsResume && window.RiderMovementSafety.isLockedForSafety(movementState);
    const remoteSpeakerSummary = connected ? voiceSpeakerSummary() : '';
    renderMapVoiceSpeakerChip(remoteSpeakerSummary);
    avatar.classList.toggle('voice-talking', connected && voiceIsSpeaking);
    avatar.classList.toggle('voice-muted', connected && voiceManuallyMuted);
    badge.hidden = !connected && !needsResume && !waitingForPublicPeer && !publicAuthorizationExpired;
    badge.toggleAttribute('inert', resumeLocked);
    badge.setAttribute('aria-disabled', String(resumeLocked));
    badge.classList.toggle('talking', voiceIsSpeaking);
    badge.classList.toggle('muted', voiceManuallyMuted);
    badge.classList.toggle('waiting', waitingForPublicPeer);
    const label = voiceManuallyMuted ? 'Muted — tap to unmute' : voiceIsSpeaking ? 'Talking' : 'Listening — hands-free';
    badge.setAttribute(
      'aria-label',
      publicAuthorizationExpired
        ? 'Nearby Voice · reconnecting'
        : needsResume
          ? 'Resume voice'
          : waitingForPublicPeer
            ? 'Nearby Voice · waiting for riders'
            : voiceManuallyMuted
            ? 'Proximity voice muted — tap to unmute'
            : voiceIsSpeaking
              ? 'Talking'
              : 'Listening — hands-free',
    );
    // The Ride tab has no map header of its own (the glowing avatar above
    // only exists on the Map screen), so a rider parked on Ride while
    // talking needs this same status somewhere too — same real state,
    // same toggleVoiceMute control, just a text chip instead of a glow.
    const rideChip = $('#rideVoiceStatus');
    if (rideChip) {
      rideChip.hidden = !connected && !needsResume;
      rideChip.toggleAttribute('inert', resumeLocked);
      rideChip.setAttribute('aria-disabled', String(resumeLocked));
      rideChip.classList.toggle('talking', voiceIsSpeaking);
      rideChip.classList.toggle('muted', voiceManuallyMuted);
      const rideChipText = $('#rideVoiceStatusText', rideChip);
      const rideLabel = needsResume ? 'Resume voice' : remoteSpeakerSummary || label;
      if (rideChipText) rideChipText.textContent = rideLabel;
      rideChip.setAttribute('aria-label', rideLabel);
    }

    // The global ride pill remains visible across Map/Friends/Settings, so it
    // must carry the same speaker identity as native's persistent RideBar.
    const ridePill = $('#ridePill');
    const ridePillLabel = ridePill ? $('small', ridePill) : null;
    const ridePillVoiceLabel = state.activeRide
      ? remoteSpeakerSummary || (voiceIsSpeaking ? 'You speaking' : 'Active ride')
      : 'Active ride';
    if (ridePillLabel) {
      ridePillLabel.textContent = ridePillVoiceLabel;
      ridePillLabel.style.color = ridePillVoiceLabel === 'Active ride' ? '' : 'var(--accent)';
    }
    if (ridePill) {
      ridePill.setAttribute(
        'aria-label',
        state.activeRide && ridePillVoiceLabel !== 'Active ride'
          ? `Active ride · ${ridePillVoiceLabel}`
          : 'Open active ride',
      );
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
    voiceLatestRms = rms;
    if (voiceManuallyMuted) {
      if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
      if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
      setVoiceSpeaking(false);
      return;
    }

    if (voiceIsSpeaking) {
      if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
      if (rms > VOICE_SPEAKING_RELEASE_THRESHOLD) {
        if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
      } else if (!voiceReleaseTimer) {
        voiceReleaseTimer = setTimeout(() => {
          voiceReleaseTimer = undefined;
          setVoiceSpeaking(false);
        }, VOICE_RELEASE_HANGTIME_MS);
      }
      return;
    }

    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    if (rms >= VOICE_SPEAKING_ATTACK_THRESHOLD) {
      if (!voiceAttackTimer) {
        voiceAttackTimer = setTimeout(() => {
          voiceAttackTimer = undefined;
          if (!voiceManuallyMuted && voiceLatestRms >= VOICE_SPEAKING_ATTACK_THRESHOLD) setVoiceSpeaking(true);
        }, VOICE_ATTACK_HOLD_MS);
      }
    } else if (voiceAttackTimer) {
      clearTimeout(voiceAttackTimer);
      voiceAttackTimer = undefined;
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
    const context = new (window.AudioContext || window.webkitAudioContext)();
    voiceAudioContext = context;
    // WebKit may suspend Web Audio independently of the underlying microphone
    // capture/LiveKit room. Never leave a previously-open transmitter latched
    // on when that happens: close VOX immediately, then the foreground/tap
    // recovery paths below can resume the analyser safely.
    context.onstatechange = () => {
      if (voiceAudioContext !== context) return;
      if (context.state !== 'running') setVoiceSpeaking(false);
      renderVoiceStatus();
    };
    const source = context.createMediaStreamSource(voiceMeterStream);
    voiceAnalyser = context.createAnalyser();
    voiceAnalyser.fftSize = 512;
    source.connect(voiceAnalyser);
    if (context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {});
    }
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
    if (kind === 'channel' && publicVoiceConnectInFlight) {
      publicVoiceRefreshPending = true;
      return;
    }
    if (kind === 'channel') publicVoiceConnectInFlight = true;
    const requestedTarget = kind === 'ride' ? `ride:${rideId}` : 'channel';
    let room;
    try {
      await loadLiveKitClient();
      if (currentVoiceTarget() !== requestedTarget) return;

      const body = kind === 'ride' ? { target: 'ride', rideId } : { target: 'channel' };
      const response = await apiFetch('POST', '/voice/token', body);
      // Token minting and room connection are asynchronous. Nearby may be
      // switched off (or a private ride may replace it) while either request
      // is in flight. Never let stale work resurrect an audio room afterward.
      if (currentVoiceTarget() !== requestedTarget) return;

      if (kind === 'channel') {
        renewPublicVoiceAuthorizationLease(response.authorizationLeaseMs);
        schedulePublicVoiceRefresh(response.refreshAfterMs);
        const enteringChannel = voiceTargetKey !== 'channel';
        const desiredPeers = new Set(response.connections.map((connection) => connection.peerId));
        for (const [peerId, existingRoom] of proximityVoiceRooms) {
          if (desiredPeers.has(peerId)) continue;
          disconnectManagedVoiceRoom(existingRoom);
          proximityVoiceRooms.delete(peerId);
        }
        let lastPairError;
        for (const connection of response.connections) {
          if (currentVoiceTarget() !== requestedTarget) return;
          if (proximityVoiceRooms.has(connection.peerId)) continue;
          const pairRoom = new window.LivekitClient.Room();
          wireVoiceRoomLifecycle(pairRoom, requestedTarget, connection.peerId);
          try {
            await pairRoom.connect(connection.url, connection.token);
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            await pairRoom.startAudio?.().catch(() => {});
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            await pairRoom.localParticipant.setMicrophoneEnabled(voiceIsSpeaking && !voiceManuallyMuted);
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            proximityVoiceRooms.set(connection.peerId, pairRoom);
          } catch (error) {
            lastPairError = error;
            disconnectManagedVoiceRoom(pairRoom);
            console.warn('[rider-comms] Could not connect proximity peer', connection.peerId, error);
          }
        }
        if (currentVoiceTarget() !== requestedTarget) return;
        if (response.connections.length > 0 && proximityVoiceRooms.size === 0 && lastPairError) throw lastPairError;
        voiceTargetKey = requestedTarget;
        if (enteringChannel) voiceManuallyMuted = false;
      } else {
        room = new window.LivekitClient.Room();
        wireVoiceRoomLifecycle(room, requestedTarget);
        await room.connect(response.url, response.token);
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        await room.startAudio?.().catch(() => {});
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(false);
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        voiceRoom = room;
        voiceTargetKey = requestedTarget;
        voiceManuallyMuted = false;
      }

      microphonePermissionReady = true;
      if ((voiceRoom || proximityVoiceRooms.size) && !voiceMeterStream) await startVoiceLevelLoop();
      if (currentVoiceTarget() !== requestedTarget) {
        if (kind === 'channel') disconnectPublicVoice();
        else if (room) disconnectManagedVoiceRoom(room);
        return;
      }
      if (!voiceRoom && !proximityVoiceRooms.size && voiceMeterStream) stopVoiceLevelLoop();
      voiceFailureNotified = false;
      renderVoiceStatus();
    } catch (error) {
      // A state change while connecting is an intentional cancellation rather
      // than a voice error; do not flash an unavailable warning after "off".
      if (currentVoiceTarget() !== requestedTarget) {
        if (room) disconnectManagedVoiceRoom(room);
        return;
      }
      console.warn('[rider-comms] Could not connect voice chat', error);
      const leasedPublicConnection = kind === 'channel'
        && proximityVoiceRooms.size > 0
        && !publicVoiceAuthorizationExpired;
      if (!leasedPublicConnection && !voiceFailureNotified) {
        const code = error instanceof ApiError ? error.body?.error : undefined;
        showToast(code === 'email_verification_required'
          ? 'Verify your email before using voice chat.'
          : error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
            ? microphoneAccessMessage(error)
            : 'Voice chat is unavailable right now. Your ride and map still work.');
        voiceFailureNotified = true;
      }
      if (room) disconnectManagedVoiceRoom(room);
      if (kind === 'ride') {
        voiceRoom = undefined;
        voiceTargetKey = undefined;
      }
      if (shouldRetryVoiceConnection(error)) scheduleVoiceReconnect(requestedTarget);
      renderVoiceStatus();
    } finally {
      if (kind === 'channel') {
        publicVoiceConnectInFlight = false;
        if (publicVoiceRefreshPending) {
          publicVoiceRefreshPending = false;
          if (currentVoiceTarget() === 'channel') queueMicrotask(() => syncVoiceConnection());
        }
      }
    }
  }

  function stopVoiceLevelLoop() {
    if (voiceLevelFrame) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = undefined; }
    if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    voiceLatestRms = 0;
    voiceAnalyser = undefined;
    const context = voiceAudioContext;
    voiceAudioContext = undefined;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
    if (voiceMeterStream) { voiceMeterStream.getTracks().forEach((track) => track.stop()); voiceMeterStream = undefined; }
    voiceIsSpeaking = false;
  }

  function disconnectVoice() {
    clearPublicVoiceRefresh();
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    publicVoiceRefreshPending = false;
    stopVoiceLevelLoop();
    if (voiceReconnectTimer) { clearTimeout(voiceReconnectTimer); voiceReconnectTimer = undefined; }
    if (voiceRoom) { disconnectManagedVoiceRoom(voiceRoom); voiceRoom = undefined; }
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    voiceRemoteSpeakersByRoom.clear();
    voiceTargetKey = undefined;
    renderVoiceStatus();
  }

  function disconnectPublicVoice() {
    clearPublicVoiceRefresh();
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    publicVoiceRefreshPending = false;
    // disconnectManagedVoiceRoom() removes each public room's remote-audio
    // elements and active-speaker entry. Do not clear the process-wide speaker
    // map here: a private ride may be using it at the same time from Settings.
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    if (voiceTargetKey === 'channel') {
      voiceTargetKey = undefined;
      if (voiceReconnectTimer) { clearTimeout(voiceReconnectTimer); voiceReconnectTimer = undefined; }
    }
    // The meter is process-wide for PWA voice. Keep it alive when a private
    // ride owns voice; otherwise release microphone/WebAudio resources now.
    if (!voiceRoom && !proximityVoiceRooms.size) stopVoiceLevelLoop();
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

  async function toggleVoiceMute() {
    // A suspended VOX analyser is a recovery action, not a mute toggle. This
    // handler runs from a direct rider tap, so it is the best chance Safari
    // has to satisfy any user-activation requirement for AudioContext.resume().
    if (voiceMeterContextNeedsResume()) {
      if (window.RiderMovementSafety.isLockedForSafety(movementState)) return;
      const resumed = await resumeVoiceMeterContext();
      if (!resumed) {
        voiceFailureNotified = true;
        showToast('Voice could not resume. Check microphone access and try again.');
        renderVoiceStatus();
        return;
      }
      voiceFailureNotified = false;
      renderVoiceStatus();
      return;
    }

    if (!voiceRoom && !proximityVoiceRooms.size) {
      if (!state.activeRide && !state.publicLive) return;
      if (window.RiderMovementSafety.isLockedForSafety(movementState)) return;
      if (!(await preflightMicrophoneAccess())) return;
      syncVoiceConnection();
      return;
    }
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
   * offline from the map also revokes that profile visibility preference,
   * matching native's one-switch behaviour. Entering a private ride is the
   * exception: it pauses public Nearby without silently rewriting the rider's
   * standing privacy choice. Real hands-free proximity voice chat (see
   * connectVoice above) is tied to the same on/off action — going live for
   * presence and being reachable by voice are the same moment, not two
   * separate steps.
   */
  async function toggleNearby() {
    if (nearbyTogglePending) return;
    nearbyTogglePending = true;
    renderMapStatus();

    try {
      if (state.publicLive) {
        const saved = await stopPublicNearby({ disableLocationSharing: true });
        showToast(saved
          ? 'Nearby visibility and proximity voice are off.'
          : 'Nearby is off, but the location-sharing preference could not be saved.');
        return;
      }

      // Email verification is an intentional public-channel anti-abuse gate.
      // Init refreshes this value from /auth/me, so fail before asking for
      // microphone/location when the account is not eligible.
      if (session?.emailVerified === false) {
        showToast('Verify your email before joining Nearby Voice.');
        return;
      }
      if (!(await preflightMicrophoneAccess())) return;

      let position;
      try {
        position = await currentPublicPresencePosition();
      } catch (error) {
        showToast(locationAccessMessage(error, 'join riders nearby'));
        return;
      }

      const sharingWasAlreadyEnabled = state.profile.shareLocation;
      let enabledSharingForNearby = false;
      try {
        if (!sharingWasAlreadyEnabled) {
          const ok = await patchProfile({ shareLocation: true });
          if (!ok) throw new Error('could_not_enable_location_sharing');
          enabledSharingForNearby = true;
        }

        await sendPresence(position);
        state.publicLive = true;
        persist();
        renderMapStatus();
        centreMap(position.coords.latitude, position.coords.longitude);
        showToast(
          nearbyRiders.length
            ? 'Location visible. Connecting Nearby Voice…'
            : 'Location visible. Nearby Voice is waiting for riders in range.',
        );
        syncVoiceConnection();
        startPresenceRefresh();
      } catch (error) {
        state.publicLive = false;
        nearbyRiders = [];
        stopPresenceRefresh();
        syncVoiceConnection();
        persist();
        renderMapStatus();
        renderMapRiders();
        try { await apiFetch('DELETE', '/presence'); } catch { /* Presence also expires server-side. */ }

        // If this tap enabled durable sharing but never established Nearby,
        // undo that change so the inactive map control cannot leave a hidden
        // privacy preference switched on.
        if (enabledSharingForNearby) {
          try {
            const profile = await apiFetch(
              'PUT',
              `/riders/${encodeURIComponent(state.profile.riderId)}/profile`,
              { shareLocation: false },
            );
            applyRemoteProfile(profile);
          } catch { /* The failed Nearby session remains locally off. */ }
        }

        const code = error instanceof ApiError ? error.body?.error : undefined;
        showToast(code === 'email_verification_required'
          ? 'Verify your email before joining Nearby Voice.'
          : code === 'location_sharing_disabled'
            ? 'Enable location sharing in Settings to go live.'
            : code === 'location accuracy must be between 0 and 100 metres'
              ? 'Waiting for a more accurate GPS fix. Try Nearby again in a moment.'
              : 'Could not go live. Try again.');
      }
    } finally {
      nearbyTogglePending = false;
      renderMapStatus();
    }
  }

  const MAX_PUBLIC_PRESENCE_ACCURACY_METERS = 100;
  const MAX_REUSED_PRESENCE_FIX_AGE_MS = 15_000;

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
          if (state.activeRide) {
            renderMapRiders();
            const now = Date.now();
            if (now - lastRideAvatarRefreshAt >= RIDE_AVATAR_REFRESH_MS) {
              lastRideAvatarRefreshAt = now;
              void loadRideRoster();
            }
          }
        } catch {
          // Best-effort, same as the public presence refresh above — a
          // missed tick (denied permission, a transient network blip)
          // just tries again next interval rather than surfacing an error
          // banner over the whole ride.
        }
      };
      rideLocationTimer = setInterval(tick, RIDE_LOCATION_REFRESH_MS);
      void tick();
    } else {
      if (rideLocationTimer) clearInterval(rideLocationTimer);
      rideLocationTimer = undefined;
      lastRideAvatarRefreshAt = 0;
      if (!state.activeRide) rideMemberLocations = new Map();
    }
  }

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
      { origin, destination, travelMode: google.maps.TravelMode.DRIVING },
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

  /** Plain equirectangular-projection distance — accurate enough over the
   * short (metres-to-low-kilometres) spans between a rider's real position
   * and a route step's endpoints/segment; no need for full geodesic math
   * at this scale, and no extra Maps `geometry` library to load for it. */
  function bearingDegrees(from, to) {
    const toRad = (value) => (value * Math.PI) / 180;
    const toDeg = (value) => (value * 180) / Math.PI;
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const deltaLon = toRad(to.lng - from.lng);
    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function navigationCameraProfile({
    speedMps,
    maneuverDistanceMeters,
    maneuver,
    viewportBias = 1,
  }) {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;
    let profile;

    if (speed <= 1.5) profile = { zoom: 18.8, pitch: 52, lookAheadMeters: 90, centreAheadMeters: 42 };
    else if (speed < 7) profile = { zoom: 18.7, pitch: 58, lookAheadMeters: 120, centreAheadMeters: 52 };
    else if (speed < 14) profile = { zoom: 18.4, pitch: 60, lookAheadMeters: 165, centreAheadMeters: 70 };
    else if (speed < 22) profile = { zoom: 18.0, pitch: 58, lookAheadMeters: 230, centreAheadMeters: 95 };
    else profile = { zoom: 17.6, pitch: 54, lookAheadMeters: 310, centreAheadMeters: 125 };

    const maneuverDistance = Number.isFinite(maneuverDistanceMeters)
      ? Math.max(0, Number(maneuverDistanceMeters))
      : Number.POSITIVE_INFINITY;
    const complexManeuver = Boolean(maneuver && (
      maneuver.includes('roundabout')
      || maneuver.includes('uturn')
      || maneuver.includes('fork')
    ));

    if (complexManeuver && maneuverDistance <= 260) {
      profile = {
        zoom: Math.min(profile.zoom, 18.0),
        pitch: Math.min(profile.pitch, 50),
        lookAheadMeters: Math.max(profile.lookAheadMeters, 220),
        centreAheadMeters: Math.max(profile.centreAheadMeters, 80),
      };
    } else if (maneuverDistance <= 180) {
      const proximity = clamp((180 - maneuverDistance) / 160, 0, 1);
      profile = {
        zoom: Math.min(18.9, profile.zoom + 0.35 * proximity),
        pitch: Math.max(52, profile.pitch - 5 * proximity),
        lookAheadMeters: Math.max(140, profile.lookAheadMeters * (1 - 0.2 * proximity)),
        centreAheadMeters: Math.max(55, profile.centreAheadMeters * (1 - 0.08 * proximity)),
      };
    }

    return {
      ...profile,
      centreAheadMeters: profile.centreAheadMeters * clamp(viewportBias, 0.9, 1.3),
    };
  }

  function navigationViewportBias(viewportHeight, topOcclusion, bottomOcclusion) {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 1;
    const top = clamp(Number.isFinite(topOcclusion) ? topOcclusion : 0, 0, viewportHeight);
    const bottom = clamp(Number.isFinite(bottomOcclusion) ? bottomOcclusion : 0, 0, viewportHeight);
    const occludedFraction = clamp((top + bottom) / viewportHeight, 0, 0.7);
    const topDominance = clamp((top - bottom) / viewportHeight, -0.25, 0.25);
    return clamp(1 + occludedFraction * 0.45 + topDominance * 0.35, 0.9, 1.3);
  }

  function currentNavigationViewportBias() {
    const mapElement = $('#googleMap');
    const banner = $('#navBanner');
    const summary = $('#navSummary');
    // In nav mode the mute/overview control dock (.map-actions) floats
    // above #navSummary, not inside it -- measuring only #navSummary's own
    // top edge missed the dock's height entirely, understating how much of
    // the bottom of the screen is actually occluded and letting the
    // rider's own puck sit lower on screen than there was real clearance
    // for, worst exactly when a maneuver's zoom/pitch change amplifies
    // that same fixed offset in screen-pixel terms.
    const controls = $('.map-actions');
    if (!mapElement) return 1;
    const mapRect = mapElement.getBoundingClientRect();
    if (mapRect.height <= 0) return 1;
    const bannerRect = banner && !banner.hidden ? banner.getBoundingClientRect() : null;
    const summaryRect = summary && !summary.hidden ? summary.getBoundingClientRect() : null;
    const controlsRect = controls && !controls.hidden ? controls.getBoundingClientRect() : null;
    const topOcclusion = bannerRect ? Math.max(0, bannerRect.bottom - mapRect.top) : 0;
    const bottomEdge = Math.min(
      summaryRect ? summaryRect.top : Number.POSITIVE_INFINITY,
      controlsRect ? controlsRect.top : Number.POSITIVE_INFINITY,
    );
    const bottomOcclusion = Number.isFinite(bottomEdge) ? Math.max(0, mapRect.bottom - bottomEdge) : 0;
    return navigationViewportBias(mapRect.height, topOcclusion, bottomOcclusion);
  }

  function stabilizeNavigationHeading(previousHeading, candidateHeading, speedMps) {
    const normalise = (value) => ((value % 360) + 360) % 360;
    const candidate = normalise(candidateHeading);
    if (!Number.isFinite(previousHeading)) return candidate;
    const previous = normalise(Number(previousHeading));
    const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;
    if (speed <= 1.5) return previous;
    const delta = ((candidate - previous + 540) % 360) - 180;
    const alpha = speed < 5 ? 0.22 : speed < 12 ? 0.34 : speed < 22 ? 0.46 : 0.56;
    return normalise(previous + delta * alpha);
  }

  function combineNavigationCameraPaths(...paths) {
    const combined = [];
    paths.forEach((path) => {
      if (!Array.isArray(path)) return;
      path.forEach((coordinate) => {
        const previous = combined[combined.length - 1];
        if (
          previous
          && Math.abs(previous.lat - coordinate.lat) < 1e-7
          && Math.abs(previous.lng - coordinate.lng) < 1e-7
        ) return;
        combined.push(coordinate);
      });
    });
    return combined;
  }

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

  /** Local short-span projection used for route matching. Returning the
   * projection ratio as well as the cross-track distance lets navigation
   * calculate remaining distance along a curved step instead of measuring a
   * straight line to the next junction. */
  function projectToSegment(point, segStart, segEnd) {
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((point.lat * Math.PI) / 180);
    const toXY = (p) => ({ x: (p.lng - segStart.lng) * metersPerDegLng, y: (p.lat - segStart.lat) * metersPerDegLat });
    const p = toXY(point);
    const b = toXY(segEnd);
    const lengthSq = b.x * b.x + b.y * b.y;
    const ratio = lengthSq > 0 ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSq)) : 0;
    const closest = { x: ratio * b.x, y: ratio * b.y };
    return { distanceMeters: Math.hypot(p.x - closest.x, p.y - closest.y), ratio };
  }

  function distanceToSegmentMeters(point, segStart, segEnd) {
    return projectToSegment(point, segStart, segEnd).distanceMeters;
  }

  function navigationStepPath(step) {
    const rawPath = Array.isArray(step?.path)
      ? step.path
      : typeof step?.path?.getArray === 'function'
        ? step.path.getArray()
        : [];
    const coordinates = rawPath.map((point) => ({
      lat: typeof point?.lat === 'function' ? point.lat() : point?.lat,
      lng: typeof point?.lng === 'function' ? point.lng() : point?.lng,
    })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (coordinates.length >= 2) return coordinates;
    return [
      { lat: step.start_location.lat(), lng: step.start_location.lng() },
      { lat: step.end_location.lat(), lng: step.end_location.lng() },
    ];
  }

  function distanceToPathMeters(point, path) {
    if (!path.length) return Number.POSITIVE_INFINITY;
    if (path.length === 1) return metersBetween(point, path[0]);
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length - 1; index += 1) {
      nearest = Math.min(nearest, projectToSegment(point, path[index], path[index + 1]).distanceMeters);
    }
    return nearest;
  }

  function remainingDistanceOnPathMeters(point, path) {
    if (!path.length) return 0;
    if (path.length === 1) return metersBetween(point, path[0]);

    let nearestIndex = 0;
    let nearestProjection = projectToSegment(point, path[0], path[1]);
    for (let index = 1; index < path.length - 1; index += 1) {
      const projection = projectToSegment(point, path[index], path[index + 1]);
      if (projection.distanceMeters < nearestProjection.distanceMeters) {
        nearestIndex = index;
        nearestProjection = projection;
      }
    }

    let remaining = metersBetween(path[nearestIndex], path[nearestIndex + 1]) * (1 - nearestProjection.ratio);
    for (let index = nearestIndex + 1; index < path.length - 1; index += 1) {
      remaining += metersBetween(path[index], path[index + 1]);
    }
    return remaining;
  }


  function lookAheadCoordinateOnPath(point, path, lookAheadMeters = 120) {
    if (!path.length) return point;
    if (path.length === 1) return path[0];

    let nearestIndex = 0;
    let nearestProjection = projectToSegment(point, path[0], path[1]);
    for (let index = 1; index < path.length - 1; index += 1) {
      const projection = projectToSegment(point, path[index], path[index + 1]);
      if (projection.distanceMeters < nearestProjection.distanceMeters) {
        nearestIndex = index;
        nearestProjection = projection;
      }
    }

    let remainingLookAhead = Math.max(0, lookAheadMeters);
    let segmentIndex = nearestIndex;
    let startRatio = nearestProjection.ratio;

    while (segmentIndex < path.length - 1) {
      const start = path[segmentIndex];
      const end = path[segmentIndex + 1];
      const segmentLength = metersBetween(start, end);
      const available = segmentLength * (1 - startRatio);
      if (segmentLength <= 0) {
        segmentIndex += 1;
        startRatio = 0;
        continue;
      }
      if (remainingLookAhead <= available) {
        const ratio = Math.max(0, Math.min(1, startRatio + remainingLookAhead / segmentLength));
        return {
          lat: start.lat + (end.lat - start.lat) * ratio,
          lng: start.lng + (end.lng - start.lng) * ratio,
        };
      }
      remainingLookAhead -= available;
      segmentIndex += 1;
      startRatio = 0;
    }

    return path[path.length - 1];
  }

  const NAVIGATION_HTML_ENTITIES = Object.freeze({
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  });

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
    container.hidden = alerts.length === 0;
    if (!alerts.length) {
      container.replaceChildren();
      return;
    }

    container.innerHTML = `<span class="nav-road-ahead-label">Reports ahead</span><span class="nav-road-ahead-events">${alerts.map((alert) => {
      const meta = HAZARD_TYPES[alert.hazard.type];
      const label = navigationHazardLabel(alert.hazard.type);
      const displayLabel = label.replace(/ reported$/, '');
      const distance = formatNavDistance(alert.distanceAheadMeters);
      return `<span class="nav-road-ahead-event" aria-label="${escapeHtml(label)}, ${escapeHtml(distance)} ahead">${hazardIconMarkup(alert.hazard.type, 'nav-road-ahead-icon')}<span>${escapeHtml(displayLabel)}</span><strong>${escapeHtml(distance)}</strong></span>`;
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
      if (use) use.setAttribute('href', navFollowing ? '#i-route' : '#i-target');
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
    const profile = navigationCameraProfile({
      speedMps,
      maneuverDistanceMeters: maneuverDistance,
      maneuver: upcomingStep?.maneuver,
      viewportBias: currentNavigationViewportBias(),
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
    const heading = stabilizeNavigationHeading(navCameraHeading, candidateHeading, movingSpeed);
    navCameraHeading = heading;

    if (!navFollowing) return;
    const centre = lookAheadCoordinateOnPath(here, cameraPath, profile.centreAheadMeters);
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
    // In heading-up follow mode the map rotates underneath the rider's chosen
    // avatar, keeping their identity screen-upright while exposing more road
    // ahead in the pitched perspective.
    updateNavigationPositionIcon();
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
    if (route?.bounds) map.fitBounds?.(route.bounds, { top: 170, right: 70, bottom: 150, left: 70 });
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
    if (routeNotice) setNavStatusNotice(routeNotice);
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

  function setNavStatusNotice(message) {
    navStatusNotice = message || null;
    const notice = $('#navGpsNotice');
    if (notice) {
      notice.textContent = navStatusNotice || '';
      notice.hidden = !navStatusNotice;
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
      { origin: here, destination: { lat: navDestination.lat, lng: navDestination.lng }, travelMode: google.maps.TravelMode.DRIVING },
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
    const roadAhead = $('#navRoadAhead');
    if (roadAhead) {
      roadAhead.hidden = true;
      roadAhead.replaceChildren();
    }
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
      // A div-backed Maps JavaScript map otherwise defaults to the raster
      // renderer, which ignores the pitched/heading camera used by navigation.
      // Force Google's vector/WebGL renderer so navigation can use genuine
      // provider-native perspective and close-zoom 3D building geometry.
      renderingType: google.maps.RenderingType.VECTOR,
      tiltInteractionEnabled: true,
      headingInteractionEnabled: true,
      isFractionalZoomEnabled: true,
      mapTypeId: 'roadmap',
      colorScheme: 'FOLLOW_SYSTEM',
      backgroundColor: prefersDarkMode() ? '#080d10' : '#f2f5f6',
    });
    map.addListener?.('dragstart', () => {
      if (!navSteps.length) return;
      navFollowing = false;
      stopNavigationCameraAnimation();
      updateNavigationPositionIcon();
      updateNavigationControls();
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
    renderMapRiders();
    renderMapHazards();

  }

  function addMapMarker(person, position, current, status) {
    const marker = new google.maps.Marker({
      map,
      position,
      title: current ? 'Your location' : person.displayName,
      icon: riderAvatarMapIcon(person, current, status),
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
    $('#navMuteBtn')?.addEventListener('click', () => {
      navMuted = !navMuted;
      if (navMuted) window.speechSynthesis?.cancel?.();
      else if (navSteps.length) renderNavStep();
      updateNavigationControls();
    });
    $('#navOverviewBtn')?.addEventListener('click', () => {
      if (navFollowing) showNavigationOverview();
      else resumeNavigationFollowing();
    });
    window.addEventListener('popstate', () => {
      if (activeChat) closeChat();
      navigate(location.hash.split('/')[0].slice(1) || 'map', false);
    });
    $$('[data-ride-mode]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-ride-mode]').forEach((item) => item.classList.toggle('active', item === button));
      const host = button.dataset.rideMode === 'host';
      $('#joinRideForm').hidden = host;
      $('#hostRideForm').hidden = !host;
      $('#rideHostMode').hidden = host;
      $('#rideJoinMode').hidden = !host;
      $('#rideEntryTitle').textContent = host ? 'Start a ride' : 'Join a ride';
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
    const syncRideCodeSlots = () => {
      const code = $('#rideCode').value;
      $$('#rideCodeSlots span').forEach((slot, index) => {
        slot.textContent = code[index] || '—';
        slot.classList.toggle('filled', Boolean(code[index]));
        slot.classList.toggle('active', index === code.length && code.length < 6);
      });
    };
    $('#rideCode').addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
      syncRideCodeSlots();
    });
    $('#rideCode').addEventListener('focus', syncRideCodeSlots);
    syncRideCodeSlots();
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
    $('#completeProfilePrompt')?.addEventListener('click', () => openSheet('profile'));
    $('#editProfileBtn').addEventListener('click', () => openSheet('profile'));
    $('#reportHazardBtn').addEventListener('click', () => {
      pendingHazardReportPosition = null;
      captureHazardReportPosition();
      openSheet('reportHazard');
    });
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
      if (event.shiftKey && document.activeElement === $('.sheet')) {
        event.preventDefault();
        last.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    $('#logoutBtn').addEventListener('click', async () => {
      if (!window.confirm('Sign out of Rider Comms on this device?')) return;
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

  let authSplashTimer;
  function clearAuthFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  }

  function showAuthScreen(withSplash = false) {
    clearAuthFocus();
    $('#app').hidden = true;
    $('#authScreen').hidden = false;
    document.documentElement.classList.add('auth-open');
    const splash = $('#authSplash');
    if (!splash) return;
    clearTimeout(authSplashTimer);
    splash.hidden = !withSplash;
    if (withSplash) {
      authSplashTimer = setTimeout(() => {
        splash.hidden = true;
        clearAuthFocus();
      }, 900);
    }
  }

  function hideAuthScreen() {
    clearTimeout(authSplashTimer);
    const splash = $('#authSplash');
    if (splash) splash.hidden = true;
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
    state.profile.unitSystem = profile.unitSystem === 'km' ? 'km' : 'mi';
    state.profile.notifyNearby = Boolean(profile.notifyNearby);
    state.profile.notifyInvites = Boolean(profile.notifyInvites);
    state.profile.notifyChat = Boolean(profile.notifyChat);
    state.unit = state.profile.unitSystem;
    state.notifications = Boolean(state.profile.notifyNearby || state.profile.notifyInvites || state.profile.notifyChat);
    state.profile.instagram = profile.instagramUsername;
    state.profile.tiktok = profile.tiktokUsername;
    state.profile.instagramVisibility = profile.instagramVisibility;
    state.profile.tiktokVisibility = profile.tiktokVisibility;
    state.profile.shareLocation = profile.shareLocation;
    persist();
    renderProfile();
    renderMapStatus();
  }

  /** Throwing profile snapshot used by the durable social event loop. */
  async function refreshProfileAuthoritative() {
    const profile = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`);
    applyRemoteProfile(profile);
  }

  /** UI/startup wrapper keeps the existing non-fatal profile-load behavior. */
  async function loadProfile() {
    try {
      await refreshProfileAuthoritative();
      return true;
    } catch {
      showToast('Could not load your profile from the server.');
      return false;
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
      saveSession({ riderId: result.riderId, token: result.token, emailVerified: Boolean(result.emailVerified) }, $('#rememberMe')?.checked !== false);
      applyAuthenticatedIdentity(result.riderId, username);
      // A newly authenticated rider may already belong to a ride on another
      // device. Reconcile before enabling ride location or voice in the UI.
      state.activeRide = null;
      await refreshActiveRide();
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
      saveSession({ riderId: result.riderId, token: result.token, emailVerified: Boolean(result.emailVerified) });
      applyAuthenticatedIdentity(result.riderId, username);
      hideAuthScreen();
      startApp();
      showToast(result.emailVerificationSent
        ? 'Account created. Check your email to verify it.'
        : 'Account created, but the verification email could not be sent. Verified-only features such as Nearby Voice will remain unavailable until email delivery is restored.');
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
        eyebrow: '',
        title: 'Welcome back',
        description: 'Good to see you again.',
      },
      signup: {
        eyebrow: 'New rider',
        title: 'Create your account',
        description: 'Set up your Rider Comms identity and keep your rides and rider circle across devices.',
      },
      recover: {
        eyebrow: 'Account recovery',
        title: 'Get back in',
        description: 'Request a one-hour reset link without revealing whether an account exists.',
      },
      reset: {
        eyebrow: 'Secure reset',
        title: 'Choose a new password',
        description: 'Enter the one-hour code from your email. Every existing session will be signed out.',
      },
    };

    setAuthMode = (target, moveFocus = true) => {
      const mode = typeof target === 'string' ? target : target.dataset.authMode;
      $$('.auth-segmented [data-auth-mode]').forEach((item) => {
        const selected = item.dataset.authMode === mode;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      const forms = { login: $('#loginForm'), signup: $('#signupForm'), recover: $('#recoverForm'), reset: $('#resetForm') };
      Object.entries(forms).forEach(([name, form]) => { form.hidden = name !== mode; form.setAttribute('aria-hidden', String(name !== mode)); });
      const extras = $('#authLoginExtras');
      if (extras) extras.hidden = mode !== 'login';
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
    });
    $$('.auth-segmented [data-auth-mode]').forEach((button) => {
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
    else setAuthMode('login', false);
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
    void resumePreviouslyAllowedVoice();
    renderFallbackMarkers();
    renderHazardMarkers();
    navigate(location.hash.slice(1) || state.screen || 'map', false);
    loadGoogleMaps();
    registerServiceWorker();
    void loadFriendsData();
    startSocialEvents();
    syncFriendActivityPolling();
    // Startup only reconciles saved UI state with the browser. Permission
    // prompts belong to deliberate taps in Settings, never cold launch.
    syncNotificationPreference();
    void initialiseMovementSafety();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void initialiseMovementSafety();
      else stopMovementSafetyTracking();
      if (document.visibilityState === 'visible') {
        void (async () => {
          await refreshActiveRide();
          if (state.publicLive && !presenceRefreshTimer) await resumePublicPresence();
          else await resumePreviouslyAllowedVoice();
        })();
      } else stopPresenceRefresh();
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
      showAuthScreen(true);
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
      const rememberedSession = localStorage.getItem(SESSION_KEY) !== null;
      saveSession({ ...session, emailVerified: Boolean(identity.emailVerified) }, rememberedSession);
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
    // Public Nearby is opt-in per running app session. Persisted UI state is
    // never authority to restart location publication or microphone capture
    // after a reload/cold launch; clear any prior presence lease instead.
    const hadPersistedPublicLive = state.publicLive === true;
    state.publicLive = false;
    state.activeRide = null;
    persist();
    await refreshActiveRide();
    if (hadPersistedPublicLive) {
      try { await apiFetch('DELETE', '/presence'); } catch { /* Lease expires server-side. */ }
    }
    hideAuthScreen();
    startApp();
    await loadProfile();
    if (verification) showToast(verification.message);
  }

  void init();
})();
