// Part of docs/app.js. 3 of 20: Marker animation, persisted state, avatars, toasts and tab navigation. Edit here, then run `npm run build:pwa-app`.
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
        avoidHighways: stored.avoidHighways === true,
        avoidTolls: stored.avoidTolls === true,
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
    // Lets CSS adapt floating controls to the screen (e.g. the ride pill).
    document.documentElement.dataset.activeScreen = screen;
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
    syncMovementSafetyBanner();
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
    if (planSummary) planSummary.textContent = `${plan.name} plan · ${plan.features[0]}`;
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

