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
    // Dark basemap from sunset to sunrise. Without a fix yet, the time zone
    // gives the longitude closely enough to place sunset. Maps JS reads
    // colorScheme only here, so a map opened before sunset turns dark the
    // next time the app opens.
    const darkOutside = isDarkOutside(
      liveCentre ? liveCentre.lat : fallbackCentre.lat,
      liveCentre ? liveCentre.lng : -new Date().getTimezoneOffset() / 4,
    );
    const mapDark = prefersDarkMode() || darkOutside;
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
      colorScheme: darkOutside ? 'DARK' : 'FOLLOW_SYSTEM',
      backgroundColor: mapDark ? '#080d10' : '#f2f5f6',
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
      label: current ? null : { text: riderMapLabel(person.displayName), className: 'rider-map-label', color: '#ffffff', fontSize: '12px', fontWeight: '800' },
      zIndex: current ? 10 : 5,
    });
    marker.addListener('click', () => selectRider(person.riderId, visibleMapRiders()));
    return marker;
  }

  // Riders lose signal on the road. Say so, instead of leaving the map and
  // chat looking frozen. navigator.onLine is only a hint, so this shows just
  // while the browser itself reports no connection.
  function watchConnection() {
    const sync = () => { $('#offlineBanner').hidden = navigator.onLine !== false; };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    // Tapping a notification while the app is open (docs/sw.js).
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'open-route') void openAppRoute(event.data.route);
    });
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) $('#updateBanner').hidden = false;
      const watch = (worker) => worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) $('#updateBanner').hidden = false;
      });
      watch(registration.installing);
      registration.addEventListener('updatefound', () => watch(registration.installing));
      // update() rejects when the network drops (common on a bike); the next
      // visit tries again, so a failure needs no handling.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update().catch(() => {}); });
      $('#reloadApp').addEventListener('click', () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }));
    }).catch(() => {});
  }

  // The menu behind the rider's avatar on the map: profile, Routes,
  // plan, Settings and help. Routes and Settings aren't tabs any more.
  let appMenuTrigger = null;
  function openAppMenu() {
    if (window.RiderMovementSafety.isLockedForSafety(movementState)) {
      showToast('Controls stay locked until Rider Comms confirms you are stationary.');
      return;
    }
    appMenuTrigger = document.activeElement;
    renderProfile();
    pushOverlayGuard();
    $('#appMenu').hidden = false;
    $('#app')?.setAttribute('inert', '');
    document.documentElement.classList.add('app-menu-open');
    $('#closeAppMenu').focus({ preventScroll: true });
  }

  function closeAppMenu({ restoreFocus = true } = {}) {
    if ($('#appMenu').hidden) return;
    $('#appMenu').hidden = true;
    $('#app')?.removeAttribute('inert');
    document.documentElement.classList.remove('app-menu-open');
    if (restoreFocus) appMenuTrigger?.focus?.();
    appMenuTrigger = null;
  }

  function bindEvents() {
    $('#mapAvatarButton').addEventListener('click', openAppMenu);
    $('#closeAppMenu').addEventListener('click', () => closeAppMenu());
    $('#appMenu').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAppMenu(); });
    $('#appMenuViewProfile').addEventListener('click', () => { closeAppMenu({ restoreFocus: false }); openSheet('myProfile'); });
    $$('[data-menu-nav]').forEach((button) => button.addEventListener('click', () => {
      closeAppMenu({ restoreFocus: false });
      navigate(button.dataset.menuNav);
    }));
    $$('[data-menu-sheet]').forEach((button) => button.addEventListener('click', () => {
      closeAppMenu({ restoreFocus: false });
      openSheet(button.dataset.menuSheet);
    }));
    $$('[data-back-to-map]').forEach((button) => button.addEventListener('click', () => navigate('map')));
    initMapDrawer();
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
    window.addEventListener('popstate', (event) => {
      const leftGuard = onGuardEntry;
      onGuardEntry = Boolean(event.state?.guard);
      // Back closes an open sheet, search, menu or drawer before anything else.
      if (closeTopOverlay()) return;
      // Landed on the spent entry of an overlay that closed itself (a chat
      // opened from a sheet): step past it to the screen below, and stop there.
      if (event.state?.guard) { onGuardEntry = false; history.back(); return; }
      // This press only removed the entry of an overlay already closed with
      // its own button: keep going, so no press is wasted.
      if (leftGuard) { history.back(); return; }
      const screen = location.hash.split('/')[0].slice(1) || 'map';
      if (returningToMap && screen !== 'map') { history.back(); return; }
      returningToMap = false;
      if (activeChat && location.hash !== '#friends/chat') closeChat();
      navigate(screen, false);
    });
    $('#joinRideForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = $('#rideCode').value.trim().toUpperCase();
      if (!RIDE_CODE_PATTERN.test(code)) {
        $('#rideError').textContent = 'Enter a valid six-character ride code.';
        $('#rideError').hidden = false;
        $('#rideCode').setAttribute('aria-invalid', 'true');
        return;
      }
      $('#rideCode').setAttribute('aria-invalid', 'false');
      joinRideByCode(code);
    });
    const syncRideCodeSlots = () => {
      const code = $('#rideCode').value;
      $$('#rideCodeSlots span').forEach((slot, index) => {
        slot.textContent = code[index] || '·';
        slot.classList.toggle('filled', Boolean(code[index]));
        slot.classList.toggle('active', index === code.length && code.length < 6);
      });
    };
    $('#rideCode').addEventListener('input', (event) => {
      // No maxlength: a pasted "ABC 234", share message or invite link is
      // cleaned up here instead of being cut short first.
      event.target.value = normalizeRideCodeInput(event.target.value);
      event.target.setAttribute('aria-invalid', 'false');
      $('#rideError').hidden = true;
      syncRideCodeSlots();
      syncRideJoinButton();
    });
    $('#rideCode').addEventListener('focus', syncRideCodeSlots);
    $('#rideCode').addEventListener('blur', syncRideCodeSlots);
    syncRideCodeSlots();
    syncRideJoinButton();
    // An invite link (…#ride/join/ABC234) opens the Ride page with the code
    // filled in; the rider still taps Join.
    const openRideInvite = () => {
      const code = rideCodeFromInviteText(location.hash);
      if (!code || state.activeRide) return;
      $('#rideCode').value = code;
      syncRideCodeSlots();
      syncRideJoinButton();
      history.replaceState({ screen: 'ride' }, '', '#ride');
      navigate('ride', false);
    };
    openRideInvite();
    window.addEventListener('hashchange', openRideInvite);
    $('#createRideBtn').addEventListener('click', createRide);
    $('#leaveRideBtn').addEventListener('click', endRide);
    $('#activeRideLocationConsent').addEventListener('change', (event) => {
      void setRideLocationSharing(event.target.checked);
    });
    $('#rideRoster').addEventListener('click', (event) => {
      const safety = event.target.closest?.('[data-rider-safety]');
      if (safety) {
        const riderId = safety.dataset.riderSafety;
        const person = state.activeRide?.members?.find((member) => member.riderId === riderId) || { riderId, displayName: 'Rider', handle: '' };
        openRiderSafetyMenu(person, 'the ride roster');
        return;
      }
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
    $('#friendsRetry').addEventListener('click', () => {
      friendsLoadState = 'loading';
      friendsLoadError = '';
      renderFriends();
      void loadFriendsData();
    });
    $('#chatLoadOlder').addEventListener('click', () => void loadChatMessages({ older: true }));
    $('#chatComposer').addEventListener('submit', (event) => { event.preventDefault(); submitChatMessage(); });
    // Installed iOS can leave the document panned after the keyboard closes,
    // shifting the chat; return to the top once focus leaves the composer.
    $('#chatInput').addEventListener('blur', () => {
      requestAnimationFrame(() => {
        if (window.scrollY > 0) window.scrollTo(0, 0);
      });
    });
    $('#chatInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitChatMessage(); }
    });
    $('#addFriendToggle').addEventListener('click', () => { $('#addFriendForm').hidden = !$('#addFriendForm').hidden; if (!$('#addFriendForm').hidden) $('#friendId').focus(); });
    $('#friendEmptyAdd')?.addEventListener('click', () => {
      $('#addFriendForm').hidden = false;
      $('#friendId').focus();
    });
    $('#addFriendForm').addEventListener('submit', (event) => {
      event.preventDefault();
      // The @ is shown as a fixed prefix; preserve raw Rider IDs while
      // normalising a typed or pasted handle to the server format.
      const raw = $('#friendId').value.trim().toLowerCase();
      const entered = raw.replace(/^@+/, '');
      // A typed @ always means a handle (handles may themselves start with
      // "rider_"); otherwise a Rider ID-shaped entry is taken as one.
      const input = !raw.startsWith('@') && /^rider_[a-z0-9_]{4,30}$/.test(entered) ? entered : `@${entered}`;
      const isHandle = /^@[a-z0-9_]{3,24}$/.test(input);
      const isRiderId = /^rider_[a-z0-9_]{4,30}$/.test(input);
      if (!entered || (!isHandle && !isRiderId)) { $('#friendFeedback').textContent = 'Enter their handle or their full Rider ID.'; return; }
      if (input === state.profile.riderId || input === state.profile.handle.toLowerCase()) { $('#friendFeedback').textContent = FRIEND_REQUEST_ERROR_MESSAGES.cannot_friend_yourself; return; }
      $('#friendFeedback').textContent = 'Sending…';
      sendFriendRequest(input);
      $('#friendId').value = '';
    });
    $$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.sheet)));
    $('#completeProfilePrompt')?.addEventListener('click', () => openSheet('profile'));
    const openHazardReport = () => {
      pendingHazardReportPosition = null;
      captureHazardReportPosition();
      openSheet('reportHazard');
    };
    $('#reportHazardBtn').addEventListener('click', openHazardReport);
    $('#hudHazardBtn').addEventListener('click', openHazardReport);
    $('#navReportBtn').addEventListener('click', openHazardReport);
    $('#hudMuteBtn').addEventListener('click', () => void toggleVoiceMute());
    $('#closeSheet').addEventListener('click', sheetBack);
    $('#closeSheetAll').addEventListener('click', () => closeSheet());
    $('#sheetBackdrop').addEventListener('click', (event) => { if (event.target === $('#sheetBackdrop')) closeSheet(); });
    document.addEventListener('keydown', (event) => {
      if ($('#sheetBackdrop').hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        sheetBack();
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
    $('#locateBtn').addEventListener('click', locate);
    $('#joinNearbyBtn').addEventListener('click', toggleNearby);
    $('#voiceStatusBtn').addEventListener('click', toggleVoiceMute);
    $('#rideVoiceStatus').addEventListener('click', toggleVoiceMute);
    $('#endNavBtn').addEventListener('click', () => finishNavigation(false));
  }

  // --- Auth screen -----------------------------------------------------
  // Real signup/login against the backend's Postgres-backed accounts
  // (POST /auth/signup, POST /auth/login) — the app has no fixed local
  // identity anymore; every rider signs in for real before seeing the app.

  const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

  let authSplashTimer;
