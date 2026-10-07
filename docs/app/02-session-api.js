// Part of docs/app.js. 2 of 20: Session storage and the API client. Edit here, then run `npm run build:pwa-app`.
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
  let notificationTimer;
  let lastSheetTrigger = null;
  let map;
  let usingFallbackMap = true;
  let userMapMarker;
  let lastSelfDeviceFixAtMs;
  const mapMarkers = new Map(); // riderId -> { marker, status }
  let mapHazardMarkers = [];
  let mapHazardMarkerSignature = '';
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
