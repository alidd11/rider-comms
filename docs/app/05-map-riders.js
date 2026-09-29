// Part of docs/app.js. 5 of 20: Riders on the map. Edit here, then run `npm run build:pwa-app`.
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

