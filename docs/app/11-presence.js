// Part of docs/app.js. 11 of 20: Map status and public nearby presence. Edit here, then run `npm run build:pwa-app`.
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

  // Last refresh problem shown to the rider, so a repeated rejection (every
  // 8 s) produces one toast rather than a stream of them.
  let presenceRefreshIssue = '';

  /** Same handling as the native app's usePresence: the server turning
   * Nearby off ends the session, anything it can recover from keeps the
   * rider live and says why, and network blips retry quietly. */
  async function handlePresenceRefreshError(error) {
    const code = error instanceof ApiError ? error.body?.error : undefined;
    if (code === 'location_sharing_disabled' || code === 'email_verification_required') {
      presenceRefreshIssue = '';
      if (code === 'location_sharing_disabled') state.profile.shareLocation = false;
      await stopPublicNearby();
      showToast(code === 'location_sharing_disabled'
        ? 'Nearby location sharing is off. Tap Go live to enable it again.'
        : 'Verify your email before joining Nearby Voice.');
      return;
    }
    const message = code === 'implausible_location_jump'
      ? 'Your location jumped unexpectedly. Waiting for a steadier GPS fix.'
      : code === 'rate_limited'
        ? 'Nearby is updating too often. It will catch up in a moment.'
        : '';
    if (message && message !== presenceRefreshIssue) showToast(message);
    presenceRefreshIssue = message;
  }

  function startPresenceRefresh() {
    stopPresenceRefresh();
    presenceRefreshIssue = '';
    presenceRefreshTimer = setInterval(async () => {
      if (!state.publicLive || state.activeRide || document.visibilityState !== 'visible' || presenceRefreshInFlight) return;
      presenceRefreshInFlight = true;
      try {
        const position = await currentPublicPresencePosition();
        if (state.publicLive && !state.activeRide) {
          await sendPresence(position);
          presenceRefreshIssue = '';
        }
      } catch (error) {
        // A transient miss (no fix, offline, timeout) is retried on the next tick.
        await handlePresenceRefreshError(error);
      } finally { presenceRefreshInFlight = false; }
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
      // Measured on this device's clock from when the fix reached the page
      // (see devicePositionAgeMs), so neither clock skew nor iOS's reused
      // timestamps make a current position look stale.
      fixAgeMs: Math.max(0, Math.round(devicePositionAgeMs(position))),
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
  // Nearby Voice riders heard this session (peerId -> profile), kept so they
  // can be muted, reported or blocked even after leaving range; and riders
  // this rider chose not to hear (their pair room isn't joined).
  const MAX_RECENT_VOICE_PEERS = 20;
  const recentVoicePeers = new Map();
  const mutedVoicePeers = new Set();
  const voiceRemoteSpeakersByRoom = new Map(); // LiveKit Room -> Set<riderId>
  const voiceSpeakerProfiles = new Map(); // riderId -> resolved public profile
  const voiceSpeakerProfileLoads = new Set();
  let voiceTargetKey; // 'channel' or `ride:${rideId}`
  let voiceMeterStream;
  let voiceAudioContext;
  let voiceAnalyser;
  let voiceLevelFrame;
  // Shared VOX gate (voice-activity.js); a fresh one per voice session so it
  // learns the current background noise.
  let voiceActivityGate = null;
  let voiceLastLevelAt = 0;
  let voiceGateWatchdog;
  // Playback graph for other riders' voices (see boostRemoteVoice).
  let voicePlaybackContext;
  const remoteVoiceBoosts = new WeakMap();
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

  // If the level meter stops (the page went to the background), never leave
  // the mic transmitting: close it after this long without a sample.
  const VOICE_LEVEL_STALE_MS = 1000;

