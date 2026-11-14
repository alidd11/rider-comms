// Part of docs/app.js. 5 of 20: Riders on the map. Edit here, then run `npm run build:pwa-app`.
  function visibleMapRiders() {
    if (!state.activeRide) return [];
    return (state.activeRide.members || [])
      .filter((member) => member.riderId !== state.profile.riderId && rideMemberLocations.has(member.riderId));
  }

  // Mirrors shared rideMemberLastSeenAgo (shared/src/rideCode.ts);
  // scripts/check-client-parity.mjs runs both on the same ages.
  const RIDE_LOCATION_FRESH_MS = 20_000;
  function rideMemberLastSeenAgo(updatedAt, now) {
    const age = now - updatedAt;
    if (!Number.isFinite(age) || age <= RIDE_LOCATION_FRESH_MS) return null;
    if (age < 60_000) return `${Math.floor(age / 10_000) * 10} s ago`;
    return `${Math.floor(age / 60_000)} min ago`;
  }

  function riderMarkerLabel(displayName, lastSeen, batteryLow = false) {
    return { text: `${riderMapLabel(displayName)}${lastSeen ? ` · ${lastSeen}` : ''}${batteryLow ? ' · low battery' : ''}`, className: 'rider-map-label', color: '#ffffff', fontSize: '12px', fontWeight: '800' };
  }

  function renderMapRiders() {
    renderHazardMarkers();
    renderRegroupPoint();
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
      // Stopped updating (lost signal, phone locked): grey, with how long
      // ago, for up to the 10 minutes the server keeps a last-seen position.
      const lastSeen = rideMemberLastSeenAgo(real.updatedAt, now);
      const status = lastSeen ? 'stale' : 'online';
      const latLng = { lat: real.lat, lng: real.lon };
      const existing = mapMarkers.get(person.riderId);
      if (!existing) {
        const marker = addMapMarker(person, latLng, false, status);
        mapMarkers.set(person.riderId, { marker, status, lastSeen: null, batteryLow: false });
        snapMarkerTo(person.riderId, marker, latLng);
      } else {
        if (existing.status !== status) {
          existing.status = status;
          existing.marker.setIcon(riderAvatarMapIcon(person, false, status));
        }
        glideMarkerTo(person.riderId, existing.marker, latLng, RIDE_LOCATION_REFRESH_MS, now);
      }
      const entry = mapMarkers.get(person.riderId);
      // A rider whose phone says its battery is nearly flat says so too.
      const batteryLow = real.batteryLow === true;
      if (entry.lastSeen !== lastSeen || entry.batteryLow !== batteryLow) {
        entry.lastSeen = lastSeen;
        entry.batteryLow = batteryLow;
        entry.marker.setLabel?.(riderMarkerLabel(person.displayName, lastSeen, batteryLow));
        entry.marker.setTitle?.(`${lastSeen ? `${person.displayName} · last seen ${lastSeen}` : person.displayName}${batteryLow ? ' · low battery' : ''}`);
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

