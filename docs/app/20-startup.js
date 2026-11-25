// Part of docs/app.js. 20 of 20: App start-up. Edit here, then run `npm run build:pwa-app`.
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
    // A notification can open the app straight into a chat.
    if (/^#chat:/.test(location.hash)) {
      const route = location.hash;
      history.replaceState(null, '', '#friends');
      void openAppRoute(route);
    } else {
      navigate(location.hash.slice(1) || state.screen || 'map', false);
    }
    // A slow map never holds the rider on the splash for long.
    clearTimeout(launchSplashTimer);
    launchSplashTimer = setTimeout(hideLaunchSplash, 4000);
    loadGoogleMaps();
    registerServiceWorker();
    void syncPushSubscription();
    watchConnection();
    void loadFriendsData();
    startSocialEvents();
    syncFriendActivityPolling();
    void initialiseMovementSafety();
    $('#announcementClose')?.addEventListener('click', closeAnnouncement);
    void refreshAnnouncement();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void initialiseMovementSafety();
      if (document.visibilityState === 'visible') void refreshAnnouncement();
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

  // The notice staff schedule in the Staff Hub. It sits on the map, never
  // while Ride Safe is locking controls or during navigation (CSS), and once
  // closed that announcement stays closed on this device.
  const ANNOUNCEMENT_CLOSED_KEY = 'riderComms.announcementClosed';
  const ANNOUNCEMENT_REFRESH_MS = 5 * 60 * 1000;
  let announcementTimer;

  function renderAnnouncement(announcement) {
    const banner = $('#announcementBanner');
    if (!banner) return;
    let closed = '';
    try { closed = localStorage.getItem(ANNOUNCEMENT_CLOSED_KEY) || ''; } catch { /* storage blocked */ }
    const show = Boolean(announcement && typeof announcement.id === 'string' && announcement.id !== closed && announcement.endsAt > Date.now());
    banner.hidden = !show;
    if (!show) return;
    banner.dataset.id = announcement.id;
    banner.dataset.tone = announcement.tone === 'warning' ? 'warning' : 'info';
    $('#announcementTitle').textContent = announcement.title;
    $('#announcementText').textContent = announcement.body;
  }

  async function refreshAnnouncement() {
    clearTimeout(announcementTimer);
    announcementTimer = setTimeout(() => void refreshAnnouncement(), ANNOUNCEMENT_REFRESH_MS);
    if (document.visibilityState === 'hidden') return;
    try {
      const data = await apiFetch('GET', '/announcements/current');
      renderAnnouncement(data?.announcement ?? null);
    } catch { /* keep what is showing; the next refresh tries again */ }
  }

  function closeAnnouncement() {
    const banner = $('#announcementBanner');
    if (!banner) return;
    try { localStorage.setItem(ANNOUNCEMENT_CLOSED_KEY, banner.dataset.id || ''); } catch { /* storage blocked */ }
    banner.hidden = true;
  }

  async function loadBillingStatus() {
    try {
      const billing = await apiFetch('GET', '/billing');
      if (!billing || typeof billing !== 'object') return;
      const tier = planTier(billing.tier);
      const subscriptions = Array.isArray(billing.subscriptions) ? billing.subscriptions : [];
      state.billing = {
        ...state.billing,
        tier,
        expiresAt: billing.expiresAt !== null && Number.isFinite(Number(billing.expiresAt)) ? Number(billing.expiresAt) : null,
        // Whether the subscription behind the current plan renews: a cancelled
        // one keeps working until it ends, and must say so.
        willRenew: subscriptions.some((subscription) => subscription?.active === true && subscription.tier === tier && subscription.willRenew === true),
        purchasesEnabled: billing.purchasesEnabled === true,
      };
      state.profile.zoneTier = state.billing.tier;
      persist();
      renderProfile();
    } catch {
      // The cached profile remains usable when billing is temporarily offline.
    }
  }

  async function init() {
    // Last resort if start-up stalls before it reaches a screen.
    launchSplashTimer = setTimeout(hideLaunchSplash, 12000);
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
      // Accounts created before the current Terms agree once before the app
      // opens (App Store guideline 1.2 parity with the iPhone app).
      if (identity.termsAccepted === false) await requireTermsAgreement(identity.termsVersion);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        wireAuthForms();
        showAuthScreen();
        const notice = $('#authNotice');
        notice.textContent = 'Your saved session couldn’t be checked. Check your connection and try again.';
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
    restoreQueuedHazardReports();
    await loadProfile();
    await loadBillingStatus();
    if (verification) showToast(verification.message);
  }

  void init();
})();
