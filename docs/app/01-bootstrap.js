// Part of docs/app.js. 1 of 20: Bootstrap: viewport, map icons, plan tier, colour scheme, crash reporting. Edit here, then run `npm run build:pwa-app`.
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
    avoidHighways: false,
    avoidTolls: false,
    rideSafeEnabled: true,
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
    // Billing is authoritative on the server. Keep a small cached snapshot
    // so the PWA can render the same current-plan/availability state as the
    // native client while a fresh request is in flight.
    billing: {
      tier: 'free',
      expiresAt: null,
      purchasesEnabled: false,
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
        return '<path d="M6 20C10 13 16 9 24 9C32 9 38 13 42 20L36 24H12Z" fill="#2FB7EB"/><path d="M10 22H38L37 27H11Z" fill="#0E5F80"/><path d="M10 27C14 29 19 30 24 30C29 30 34 29 38 27L40 30C36 35 12 35 8 30Z" fill="#159CCF"/><path d="M24 11L27.5 12.6V16.5C27.5 19.3 26.2 21.3 24 22.6C21.8 21.3 20.5 19.3 20.5 16.5V12.6Z" fill="#F4F7F8" stroke="#63727A" stroke-width="0.7"/><path d="M24 13.3L26 14.2V16.2C26 17.9 25.3 19.2 24 20.1C22.7 19.2 22 17.9 22 16.2V14.2Z" fill="#159CCF"/>';
      case 'hidden_police':
        return '<path d="M8 19C11 13 17 10 24 10C31 10 37 13 40 19L35 23H13Z" fill="#2FB7EB"/><path d="M12 21H36L35 26H13Z" fill="#0E5F80"/><path d="M24 11L27.5 12.6V16.5C27.5 19.3 26.2 21.3 24 22.6C21.8 21.3 20.5 19.3 20.5 16.5V12.6Z" fill="#F4F7F8" stroke="#63727A" stroke-width="0.7"/><path d="M24 13.3L26 14.2V16.2C26 17.9 25.3 19.2 24 20.1C22.7 19.2 22 17.9 22 16.2V14.2Z" fill="#159CCF"/><path d="M4 27H44V39H4Z" fill="#63727A"/><path d="M4 27H44V30H4Z" fill="#AAB5BB"/><circle cx="11" cy="34" r="1.5" fill="#10191F"/><circle cx="37" cy="34" r="1.5" fill="#10191F"/>';
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

  function hazardMapGlyphInnerSvg(type) {
    switch (type) {
      case 'police':
        return '<path d="M7 22C11 14 17 11 24 11C31 11 37 14 41 22L35 27H13Z" fill="#2FB7EB"/><rect x="10" y="25" width="28" height="5" rx="2.5" fill="#159CCF"/><path d="M24 13L28 15V19C28 22 26.4 24.4 24 25.8C21.6 24.4 20 22 20 19V15Z" fill="#F4F7F8"/>';
      case 'hidden_police':
        return '<path d="M8 20C12 14 18 11 24 11C30 11 36 14 40 20L35 25H13Z" fill="#2FB7EB"/><path d="M24 13L27.5 14.6V18.2C27.5 21 26.1 23 24 24.3C21.9 23 20.5 21 20.5 18.2V14.6Z" fill="#F4F7F8"/><rect x="6" y="26" width="36" height="11" rx="2.5" fill="#63727A"/><rect x="6" y="26" width="36" height="3" rx="1.5" fill="#AAB5BB"/>';
      case 'police_checkpoint':
        return '<path d="M19 11C20 7 22 5 24 5C26 5 28 7 29 11L27 14H21Z" fill="#2FB7EB"/><rect x="5" y="20" width="38" height="10" rx="2" fill="#F4F7F8"/><polygon points="5,20 12,20 18,30 11,30" fill="#F0646B"/><polygon points="21,20 28,20 34,30 27,30" fill="#F0646B"/><polygon points="37,20 43,20 43,29 42,30" fill="#F0646B"/><rect x="9" y="30" width="4" height="10" rx="1" fill="#63727A"/><rect x="35" y="30" width="4" height="10" rx="1" fill="#63727A"/>';
      case 'camera':
        return '<rect x="9" y="18" width="27" height="19" rx="4" fill="#F4F7F8"/><rect x="13" y="13" width="13" height="10" rx="2.5" fill="#2FB7EB"/><circle cx="19.5" cy="18" r="3" fill="#071015"/><rect x="13" y="23" width="12" height="7" rx="1.5" fill="#73848D"/><circle cx="15" cy="37" r="3.5" fill="#10191F"/><circle cx="31" cy="37" r="3.5" fill="#10191F"/><path d="M30 12C34 13 37 16 38 20" fill="none" stroke="#2FB7EB" stroke-width="3.2" stroke-linecap="round"/><path d="M32 7C39 9 43 13 45 20" fill="none" stroke="#2FB7EB" stroke-width="3.2" stroke-linecap="round"/>';
      case 'accident':
        return '<polygon points="24,5 28,13 35,8 34,16 43,15 37,22 44,25 35,29 38,37 29,32 24,41 19,32 10,37 13,29 4,25 11,22 5,15 14,16 13,8 20,13" fill="#F0646B"/><rect x="5" y="29" width="16" height="10" rx="3" fill="#F4F7F8"/><rect x="27" y="29" width="16" height="10" rx="3" fill="#F4F7F8"/><circle cx="9" cy="40" r="2.5" fill="#10191F"/><circle cx="18" cy="40" r="2.5" fill="#10191F"/><circle cx="30" cy="40" r="2.5" fill="#10191F"/><circle cx="39" cy="40" r="2.5" fill="#10191F"/>';
      case 'road_closure':
        return '<circle cx="24" cy="21" r="15" fill="#F0646B"/><circle cx="24" cy="21" r="10.5" fill="#F4F7F8"/><rect x="13" y="18.5" width="22" height="5" rx="2.5" fill="#F0646B"/>';
      default:
        return '';
    }
  }

  function hazardNavigationIconMarkup(type) {
    return '<svg class="nav-road-ahead-icon" viewBox="0 0 48 48" aria-hidden="true">' + hazardMapGlyphInnerSvg(type) + '</svg>';
  }

  function hazardIconMarkup(type, className = 'hazard-art-icon') {
    return '<svg class="' + className + '" viewBox="0 0 48 48" aria-hidden="true">' + hazardIconInnerSvg(type) + '</svg>';
  }

  function hazardPinIcon(type, selected = false) {
    const size = selected ? 44 : 36;
    const border = selected ? '#35D6FF' : '#3C4E58';
    const borderWidth = selected ? 2.8 : 1.8;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
      + '<path d="M32 2C17 2 7 12.5 7 26c0 16.5 25 36 25 36s25-19.5 25-36C57 12.5 47 2 32 2Z" fill="#0D171C" stroke="' + border + '" stroke-width="' + borderWidth + '"/>'
      + '<g transform="translate(10 8) scale(0.92)">' + hazardMapGlyphInnerSvg(type) + '</g></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size),
    };
  }
  const {
    navigationHazardCompactLabel,
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

  // Plans set the Nearby range (keep in step with mobile/src/settings/plans.ts).
  // Paid plans are App Store / Google Play subscriptions bought in the
  // mobile app; the web app shows them but sells nothing.
  const PLAN_INFO = {
    free: {
      name: 'Free',
      price: 'Free',
      blurb: 'Good for a stoplight-to-stoplight ride with riders close by.',
      radiusMiles: 1,
      features: ['1 mi Nearby range', 'Group rides at any distance with a host code', 'Voice chat, navigation and road alerts'],
    },
    premium: {
      name: 'Premium',
      price: '$4.99 / month',
      blurb: 'A wider range for group rides that spread out on the highway.',
      radiusMiles: 6,
      features: ['6 mi Nearby range', 'Everything in Free'],
    },
    premium_plus: {
      name: 'Premium+',
      price: '$9.99 / month',
      blurb: 'The widest range, for a convoy that has stretched way out.',
      radiusMiles: 20,
      features: ['20 mi Nearby range', 'Everything in Free'],
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

  // Vendor-free crash reporting: uncaught errors and unhandled promise
  // rejections go to the backend's POST /client-errors, which logs them as
  // structured events (see backend/src/clientErrors.ts). Best-effort only:
  // duplicates within a minute are dropped and each page load sends at most
  // 20 reports.
  const clientErrorReporter = (() => {
    const maxReports = 20;
    const duplicateWindowMs = 60_000;
    const lastSentAt = new Map();
    let sent = 0;
    return function reportClientError(error, context, fatal) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'Unknown error');
      const key = `${context}|${message}`;
      const now = Date.now();
      if (sent >= maxReports || now - (lastSentAt.get(key) ?? -Infinity) < duplicateWindowMs) return;
      sent += 1;
      lastSentAt.set(key, now);
      try {
        void fetch(`${API_BASE_URL}/client-errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: 'web',
            message: message.slice(0, 500),
            stack: error instanceof Error && error.stack ? error.stack.slice(0, 4000) : '',
            fatal: fatal === true,
            context,
          }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Reporting must never cause a second error.
      }
    };
  })();
  window.addEventListener('error', (event) => {
    // A script from another origin (Google Maps, a browser extension) that
    // throws reaches us as a bare "Script error." with no stack: the browser
    // hides the details, so it's logged as non-fatal and doesn't page staff.
    if (!event.error && event.message === 'Script error.' && !event.filename) {
      clientErrorReporter(event.message, 'window.error.cross_origin', false);
      return;
    }
    clientErrorReporter(event.error ?? event.message, 'window.error', true);
  });
  window.addEventListener('unhandledrejection', (event) => clientErrorReporter(event.reason, 'unhandledrejection', false));

  class ApiError extends Error {
    constructor(status, body) {
      super(`API error ${status}: ${JSON.stringify(body)}`);
      this.status = status;
      this.body = body;
    }
  }
