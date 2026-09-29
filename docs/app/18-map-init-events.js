// Part of docs/app.js. 18 of 20: Google Map setup, service worker and UI event wiring. Edit here, then run `npm run build:pwa-app`.
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
      // The web map does not need hardware-keyboard navigation. Disabling it
      // also removes Google's optional "Keyboard shortcuts" footer control
      // while leaving Google's required map attribution untouched.
      keyboardShortcuts: false,
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
