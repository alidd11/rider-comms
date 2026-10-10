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
    navigate(location.hash.slice(1) || state.screen || 'map', false);
    loadGoogleMaps();
    registerServiceWorker();
    watchConnection();
    void loadFriendsData();
    startSocialEvents();
    syncFriendActivityPolling();
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

  async function loadBillingStatus() {
    try {
      const billing = await apiFetch('GET', '/billing');
      if (!billing || typeof billing !== 'object') return;
      state.billing = {
        ...state.billing,
        tier: planTier(billing.tier),
        expiresAt: Number.isFinite(Number(billing.expiresAt)) ? Number(billing.expiresAt) : null,
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
    await loadBillingStatus();
    if (verification) showToast(verification.message);
  }

  void init();
})();
