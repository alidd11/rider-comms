// Part of docs/app.js. 9 of 20: Private group rides. Edit here, then run `npm run build:pwa-app`.
  function renderRide() {
    const active = Boolean(state.activeRide);
    $('#rideJoinState').hidden = active;
    $('#rideActiveState').hidden = !active;
    $('#rideShareTop').hidden = !active;
    $('#ridePill').hidden = !active;
    const menuLive = $('#appMenuRide');
    if (menuLive) menuLive.hidden = !active;
    // The floating ride pill covers the last ~50px of every screen; give
    // scrollable screens room to clear it.
    document.documentElement.classList.toggle('ride-pill-visible', active);
    syncRideLocationSharing();
    syncVoiceConnection({ automatic: true });
    syncRideRosterPolling();
    if (!active) {
      renderRegroupPoint();
      return;
    }
    const ride = state.activeRide;
    const locationToggle = $('#activeRideLocationConsent');
    locationToggle.checked = ride.shareRideLocation === true;
    $('#activeRideLocationStatus').textContent = ride.shareRideLocation
      ? 'On. Riders in this ride can see where you are. It stops when you switch it off, leave the ride or the ride ends.'
      : 'Off. Riders in this ride can’t see where you are.';
    const members = (ride.members || ride.memberIds.map((riderId) => ({ riderId, displayName: riderId, handle: riderId })))
      // Show this rider from their own profile, never from a lookup fallback.
      .map((person) => (person.riderId === state.profile.riderId
        ? { ...person, displayName: state.profile.displayName || person.displayName, handle: state.profile.handle || person.handle, avatarId: state.profile.avatarId || person.avatarId }
        : person));
    $('#activeRideCode').textContent = ride.code || 'Invite expired';
    $('#ridePillCode').textContent = ride.code || 'Invite expired';
    $('#copyRideCode').disabled = !ride.code;
    $('#rideShareTop').disabled = !ride.code;
    $('#rideRole').textContent = ride.isHost ? 'host' : 'member';
    const riderCount = `${members.length} ${members.length === 1 ? 'rider' : 'riders'}`;
    $('#memberCount').textContent = riderCount;
    $('#rideRosterCount').textContent = String(members.length);
    $('#rideRosterCount').setAttribute('aria-label', riderCount);
    const pillCount = $('#ridePill .pill-count');
    if (pillCount) pillCount.textContent = String(members.length);
    $('#leaveRideBtn').textContent = ride.isHost ? 'End ride' : 'Leave ride';
    $('#rideRoster').innerHTML = members.map((person) => {
      const canRemove = ride.isHost && person.riderId !== state.profile.riderId;
      const removeButton = canRemove
        ? `<button type="button" class="roster-remove" data-remove-ride-member="${escapeHtml(person.riderId)}" aria-label="Remove ${escapeHtml(person.displayName)} from this ride">${icon('close')}</button>`
        : '';
      const safetyButton = person.riderId !== state.profile.riderId
        ? `<button type="button" class="roster-safety" data-rider-safety="${escapeHtml(person.riderId)}" aria-label="Report or block ${escapeHtml(person.displayName)}">${icon('shield')}</button>`
        : '';
      return `<article class="roster-row">${avatar(person, 'small')}<div class="identity"><strong>${escapeHtml(person.displayName)}${person.riderId === state.profile.riderId ? ' · You' : ''}</strong><span>${escapeHtml(person.handle)}${person.riderId === ride.createdBy ? '<b class="roster-host-inline" aria-hidden="true"> · Host</b>' : ''}</span></div><span class="roster-status">${person.riderId === ride.createdBy ? 'Host' : 'Member'}</span>${safetyButton}${removeButton}</article>`;
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

  // While the app is open in a ride, keep the ride current on every screen,
  // as the native app does (RIDE_ROSTER_REFRESH_MS in RideContext): riders
  // join with the invite code at any time, the host can remove someone or
  // set a regroup point, and nothing else tells a rider on the map. Profiles
  // are only fetched again when the member list changes.
  const RIDE_ROSTER_REFRESH_MS = 10_000;
  let rideRosterTimer;
  function syncRideRosterPolling() {
    const wanted = Boolean(state.activeRide) && document.visibilityState === 'visible';
    if (wanted && !rideRosterTimer) {
      rideRosterTimer = setInterval(() => {
        if (!state.activeRide || document.visibilityState !== 'visible') {
          clearInterval(rideRosterTimer);
          rideRosterTimer = undefined;
          return;
        }
        void refreshActiveRide({ poll: true });
      }, RIDE_ROSTER_REFRESH_MS);
    } else if (!wanted && rideRosterTimer) {
      clearInterval(rideRosterTimer);
      rideRosterTimer = undefined;
    }
  }

  const sameMembers = (a = [], b = []) => a.length === b.length && a.every((riderId) => b.includes(riderId));

  // Reconcile membership, invite validity and private location consent from
  // the server. Cached ride details are never enough to resume sharing.
  async function refreshActiveRide({ poll = false } = {}) {
    const version = rideRefreshVersion;
    try {
      const previous = state.activeRide;
      const { ride } = await apiFetch('GET', '/rides/current');
      if (version !== rideRefreshVersion) return;
      state.activeRide = ride ? {
        rideId: ride.rideId, code: ride.code, isHost: ride.createdBy === state.profile.riderId,
        createdBy: ride.createdBy, memberIds: ride.memberIds,
        shareRideLocation: ride.shareRideLocation === true,
        regroup: ride.regroup ?? null,
        members: previous?.rideId === ride.rideId ? previous.members : undefined,
      } : null;
      announceRegroup(previous?.rideId === ride?.rideId ? previous?.regroup : undefined, ride?.regroup ?? null, ride?.createdBy === state.profile.riderId);
      if (ride) await stopPublicPresenceForRide();
      if (!ride) {
        state.selectedRiderId = null;
        rideMemberLocations = new Map();
      }
      persist();
      renderRide();
      const membersChanged = !previous?.members || previous.rideId !== ride?.rideId || !sameMembers(previous.memberIds, ride?.memberIds);
      if (ride && (!poll || membersChanged)) await loadRideRoster();
      else if (!ride && previous) showToast('That ride is no longer active.');
    } catch {
      // Transient failures leave the last verified state intact. A fresh
      // login starts with no verified ride and can retry from the Ride tab.
    }
  }

  const RIDE_ERROR_MESSAGES = {
    invalid_or_expired: 'That code doesn’t match an active ride. Check it with your host.',
    ride_full: 'This ride is full (20 riders max). Ask the host to start another.',
    rate_limited: 'Too many attempts. Wait a minute before trying again.',
    email_verification_required: 'Verify your email first: open the link we sent you (Settings → Account and login → Email).',
    terms_acceptance_required: 'Accept the latest Terms in Settings before riding with others.',
    // No signal is a different problem from a bad code (start and join share these).
    network_error: 'Couldn’t reach Rider Comms. Check your connection and try again.',
    timed_out: 'Couldn’t reach Rider Comms. Check your connection and try again.',
  };

  /** Creates a real private ride (POST /rides) — the backend returns the
   * real ride ID and a fresh six-character share code. */
  async function createRide() {
    const button = $('#createRideBtn');
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      if (!(await preflightMicrophoneAccess())) return;
      // Live location is chosen inside the ride, once it exists.
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
    } catch (error) {
      const reason = error instanceof ApiError ? error.body?.error : undefined;
      showToast(RIDE_ERROR_MESSAGES[reason] || 'Couldn’t create a ride. Try again.', 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon('plus')}<span>Start a ride</span>`;
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
    } catch (error) {
      const code2 = error instanceof ApiError ? error.body?.error : undefined;
      errorEl.textContent = RIDE_ERROR_MESSAGES[code2] || 'Couldn’t join that ride. Try again.';
      errorEl.hidden = false;
    } finally {
      // The code stays in the field so the rider can fix one character.
      button.textContent = 'Join ride';
      syncRideJoinButton();
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
      showToast(ride.isHost ? 'Couldn’t end the ride. Try again.' : 'Couldn’t leave the ride. Try again.');
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
      showToast('Couldn’t remove that rider. Try again.');
    }
  }

  async function shareRide() {
    if (!state.activeRide) return;
    if (!state.activeRide.code) return showToast('This invite has expired. Your ride remains active.');
    const text = `Join my Rider Comms group ride with code ${state.activeRide.code}\n${rideInviteLink(state.activeRide.code)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Rider Comms invite', text });
      else {
        await navigator.clipboard.writeText(state.activeRide.code);
        showToast('Ride code copied.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Couldn’t open sharing.');
    }
  }

  // Ride invite codes as riders enter them: typed, pasted as "ABC 234" or
  // "abc-234", pasted as the host's whole share message, or opened from an
  // invite link (…/#ride/join/ABC234). Same rules as the native app's
  // mobile/src/ride/rideInvite.ts.
  const RIDE_CODE_PATTERN = /^[A-Z2-9]{6}$/;

  function rideInviteLink(code) {
    return `${location.origin}${location.pathname}#ride/join/${encodeURIComponent(code)}`;
  }

  function rideCodeFromInviteText(text) {
    const linked = String(text).match(/#ride\/join\/([A-Za-z2-9]{6})\b/) || String(text).match(/ridercomms:\/\/join\?code=([A-Za-z2-9]{6})\b/i);
    return linked ? linked[1].toUpperCase() : null;
  }

  function normalizeRideCodeInput(text) {
    const fromLink = rideCodeFromInviteText(text);
    if (fromLink) return fromLink;
    const compact = String(text).toUpperCase().replace(/[\s-]/g, '');
    if (compact.length <= 6) return compact.replace(/[^A-Z2-9]/g, '');
    const candidates = [...String(text).matchAll(/(?:^|[^A-Za-z0-9])([A-Za-z2-9]{3})[\s-]?([A-Za-z2-9]{3})(?=$|[^A-Za-z0-9])/g)];
    const last = candidates[candidates.length - 1];
    if (last) return `${last[1]}${last[2]}`.toUpperCase();
    return compact.replace(/[^A-Z2-9]/g, '').slice(0, 6);
  }

  /** Join is only offered once all six characters are in. */
  function syncRideJoinButton() {
    const button = $('#joinRideForm button[type="submit"]');
    if (!button || button.textContent === 'Joining…') return;
    button.disabled = !RIDE_CODE_PATTERN.test($('#rideCode').value);
  }

  // The group's regroup point (set by the host; GET /rides/current carries
  // it): a flag on the map and a chip saying where and how far, one tap from
  // the route there. The native MapScreen mirrors this (RegroupPoint.tsx).
  let regroupMarker;
  const REGROUP_FALLBACK_LABEL = 'Regroup point';

  function regroupTitle(point) {
    return point.label || REGROUP_FALLBACK_LABEL;
  }

  function isRegroupSpot(point, place) {
    if (!point || !place) return false;
    return metersBetween({ lat: point.lat, lng: point.lon }, place) < 10;
  }

  function regroupIcon() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#d39a42" stroke="#fff" stroke-width="3"/><path d="M14 29V12m0 0h12l-2.5 4.5L26 21H14" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 20),
    };
  }

  function renderRegroupPoint() {
    const point = state.activeRide?.regroup || null;
    const chip = $('#regroupChip');
    if (chip) {
      chip.hidden = !point;
      if (point) {
        const here = userMapMarker?.getPosition?.();
        const distance = here ? formatNavDistance(metersBetween({ lat: here.lat(), lng: here.lng() }, { lat: point.lat, lng: point.lon })) : '';
        $('#regroupChipText').textContent = ` · ${regroupTitle(point)}${distance ? ` · ${distance}` : ''}`;
        chip.setAttribute('aria-label', `Regroup at ${regroupTitle(point)}${distance ? `, ${distance} away` : ''}`);
      }
    }
    if (!map || usingFallbackMap || typeof google?.maps?.Marker !== 'function') return;
    if (!point) {
      regroupMarker?.setMap(null);
      regroupMarker = undefined;
      return;
    }
    if (!regroupMarker) {
      regroupMarker = new google.maps.Marker({ map, icon: regroupIcon(), zIndex: 11 });
      regroupMarker.addListener('click', showRegroupPoint);
    }
    regroupMarker.setPosition({ lat: point.lat, lng: point.lon });
    regroupMarker.setTitle?.(`Regroup: ${regroupTitle(point)}`);
  }

  /** Shows the regroup point in the destination card (one tap to route). */
  function showRegroupPoint() {
    const point = state.activeRide?.regroup;
    if (!point || typeof google?.maps?.LatLng !== 'function') return;
    const location = new google.maps.LatLng(point.lat, point.lon);
    map?.panTo?.(location);
    showDestinationCard(location, regroupTitle(point), 'Regroup point · set by the host');
  }

  /** Host only: sets the regroup point at a place, or clears it. */
  async function setRegroupPoint(point) {
    const ride = state.activeRide;
    if (!ride?.isHost) return false;
    try {
      const { regroup } = point
        ? await apiFetch('PUT', `/rides/${encodeURIComponent(ride.rideId)}/regroup`, point)
        : await apiFetch('DELETE', `/rides/${encodeURIComponent(ride.rideId)}/regroup`);
      if (state.activeRide?.rideId === ride.rideId) state.activeRide.regroup = regroup;
      persist();
      renderRegroupPoint();
      return true;
    } catch {
      return false;
    }
  }

  // Mirrors shared regroupAnnouncement (shared/src/rideCode.ts);
  // scripts/check-client-parity.mjs runs both on the same cases.
  function regroupAnnouncement(previous, next, isHost) {
    if (isHost || !next || previous === undefined) return null;
    if (previous && previous.setAt === next.setAt) return null;
    return next.label ? `Regroup at ${next.label}.` : 'Regroup point set. It’s on your map.';
  }

  /** A new regroup point from the host: a toast, and spoken unless spoken
   * directions are off or navigation is muted (speak() checks navMuted). */
  function announceRegroup(previous, next, isHost) {
    const announcement = regroupAnnouncement(previous, next, isHost);
    if (!announcement) return;
    showToast(announcement);
    if (state.spokenDirections !== false) speak(announcement);
  }
