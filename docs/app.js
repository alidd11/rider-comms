(() => {
  'use strict';

  const STORAGE_KEY = 'rider-comms-pwa-v4';
  const DEFAULT_STATE = {
    screen: 'map',
    publicLive: false,
    selectedRiderId: null,
    activeRide: null,
    unit: 'mi',
    notifications: true,
    profile: {
      riderId: 'rider_k4xqpz82',
      displayName: 'Ali',
      handle: '@ali_rides',
      instagram: '',
      tiktok: '',
      socialsVisibility: 'friends',
      shareLocation: false,
    },
    friends: [
      { riderId: 'rider_maria', displayName: 'Maria K.', handle: '@maria_ktm', status: 'On a ride' },
      { riderId: 'rider_jc', displayName: 'JC', handle: '@jc_ridesout', status: 'Active 8m ago' },
    ],
    requests: [{ riderId: 'rider_alex82', displayName: 'Alex R.', handle: '@rider_alex82', status: 'Wants to connect' }],
    routes: [],
    hazards: [],
    routeVehicleFilter: null,
  };

  // Waze-style crowdsourced road reports. This is local, device-only mock
  // state, same as the rest of this file (see the module header note on
  // why the PWA has no backend calls) — a real deployment backs this with
  // the same /hazards endpoints and TTL/hide-threshold rules the native
  // app's client uses (see shared/src/hazards.ts, backend/src/hazardStore.ts).
  const HAZARD_TYPES = {
    police: { label: 'Police', icon: 'i-shield', color: '#4f7cff' },
    camera: { label: 'Speed camera', icon: 'i-camera', color: '#4f7cff' },
    accident: { label: 'Accident', icon: 'i-alert', color: '#ff6572' },
    hazard: { label: 'Hazard', icon: 'i-cone', color: '#ffc15a' },
    road_closure: { label: 'Road closure', icon: 'i-no-entry', color: '#ff6572' },
  };
  const HAZARD_TYPE_ORDER = ['police', 'camera', 'accident', 'hazard', 'road_closure'];

  // Automatic day/night map skin — kept in sync with the CSS light-mode
  // media block below via prefersDarkMode(), so the map tiles match the
  // rest of the UI instead of staying stuck on the dark skin in daylight.
  const MAP_STYLE_DARK = [
    { elementType: 'geometry', stylers: [{ color: '#172028' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#172028' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8f9ba7' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#293640' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#34434f' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2834' }] },
  ];
  const MAP_STYLE_LIGHT = [
    { elementType: 'geometry', stylers: [{ color: '#f4f1ec' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f1ec' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5f574c' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#ddd3c4' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe3ea' }] },
  ];
  const darkModeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  function prefersDarkMode() {
    return darkModeQuery ? darkModeQuery.matches : true;
  }
  function applyColorScheme() {
    // Always black-translucent, in both themes. 'default' (which this used
    // to switch to for light mode) makes iOS reserve a solid, opaque status
    // bar bar instead of overlaying content — the exact "band" at the top
    // this is here to avoid. black-translucent is the only value that's
    // truly edge-to-edge; the cost is the status bar's own text/icons stay
    // light-on-transparent even over a light background, which iOS gives no
    // way around for a home-screen web app.
    const meta = $('#statusBarStyleMeta');
    if (meta) meta.setAttribute('content', 'black-translucent');
    map?.setOptions({
      styles: prefersDarkMode() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      backgroundColor: prefersDarkMode() ? '#101820' : '#f4f1ec',
    });
  }
  darkModeQuery?.addEventListener('change', applyColorScheme);

  const VEHICLE_LABELS = { motorcycle_small: 'Small motorcycle', motorcycle_large: 'Large motorcycle', scooter: 'Scooter', car: 'Car' };
  const ROAD_TYPE_LABELS = { rural: 'Rural', mountain: 'Mountain', coastal: 'Coastal', urban: 'Urban', mixed: 'Mixed' };
  const DIFFICULTY_LABELS = { easy: 'Easy', moderate: 'Moderate', challenging: 'Challenging' };
  const SURFACE_LABELS = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };

  const PUBLIC_RIDERS = [
    { riderId: 'rider_alex82', displayName: 'Alex R.', handle: '@rider_alex82', status: 'Nearby', x: 24, y: 34 },
    { riderId: 'rider_maria', displayName: 'Maria K.', handle: '@maria_ktm', status: 'In your zone', x: 67, y: 55 },
    { riderId: 'rider_jc', displayName: 'JC', handle: '@jc_ridesout', status: 'Nearby', x: 78, y: 75 },
  ];

  const RIDE_MEMBERS = [
    { riderId: 'rider_k4xqpz82', displayName: 'Ali', handle: '@ali_rides', status: 'Host · connected' },
    { riderId: 'rider_maria', displayName: 'Maria K.', handle: '@maria_ktm', status: 'Connected' },
    { riderId: 'rider_jc', displayName: 'JC', handle: '@jc_ridesout', status: 'Connected' },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = loadState();
  let toastTimer;
  let map;
  let usingFallbackMap = true;
  let userMapMarker;
  let mapMarkers = [];
  let mapHazardMarkers = [];
  let destinationMarker;

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return structuredClone(DEFAULT_STATE);
      return {
        ...structuredClone(DEFAULT_STATE),
        ...stored,
        profile: { ...DEFAULT_STATE.profile, ...(stored.profile || {}) },
        friends: Array.isArray(stored.friends) ? stored.friends : structuredClone(DEFAULT_STATE.friends),
        requests: Array.isArray(stored.requests) ? stored.requests : structuredClone(DEFAULT_STATE.requests),
        routes: Array.isArray(stored.routes) ? stored.routes : structuredClone(DEFAULT_STATE.routes),
        hazards: Array.isArray(stored.hazards) ? stored.hazards : structuredClone(DEFAULT_STATE.hazards),
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function initials(name) {
    const result = String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
    return result || 'RC';
  }

  function identityColor(id) {
    const colors = ['#4f7cff', '#8b5cf6', '#e45d8c', '#148f77', '#b96c22', '#3d7f92'];
    let hash = 0;
    for (const char of id) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }

  function avatar(person, className = '') {
    return `<span class="avatar ${className}" style="--avatar:${identityColor(person.riderId)}" aria-hidden="true">${escapeHtml(initials(person.displayName))}</span>`;
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
    state.screen = screen;
    persist();
    $$('.screen').forEach((item) => item.classList.toggle('active', item.dataset.screen === screen));
    $$('[data-nav]').forEach((item) => {
      const active = item.dataset.nav === screen;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    if (push && location.hash !== `#${screen}`) history.pushState({ screen }, '', `#${screen}`);
    document.title = `${screen === 'ride' ? 'Group Ride' : screen[0].toUpperCase() + screen.slice(1)} · Rider Comms`;
    window.scrollTo(0, 0);
    if (screen === 'map') renderMapRiders();
    if (screen === 'routes') renderRoutes();
  }

  function renderProfile() {
    $('#profileName').textContent = state.profile.displayName;
    $('#profileHandle').textContent = state.profile.handle;
    $$('[data-avatar]').forEach((element) => {
      element.textContent = initials(state.profile.displayName);
      element.style.setProperty('--avatar', identityColor(state.profile.riderId));
    });
  }

  function renderFallbackMarkers(riders = PUBLIC_RIDERS) {
    const layer = $('#fallbackMarkers');
    const people = [
      { ...state.profile, displayName: state.profile.displayName, handle: state.profile.handle, status: 'You', x: 50, y: 53, current: true },
      ...riders,
    ];
    layer.innerHTML = people.map((person) => {
      const selected = state.selectedRiderId === person.riderId;
      const label = person.current || selected ? `<span class="marker-label">${escapeHtml(person.current ? 'You' : person.displayName)}</span>` : '';
      return `<button class="rider-marker${person.current ? ' current' : ''}${selected ? ' selected' : ''}" style="left:${person.x}%;top:${person.y}%;--marker:${identityColor(person.riderId)}" data-rider-id="${escapeHtml(person.riderId)}" aria-label="${escapeHtml(person.current ? 'Your location' : person.displayName)}">${escapeHtml(initials(person.displayName))}${label}</button>`;
    }).join('');
    $$('[data-rider-id]', layer).forEach((button) => button.addEventListener('click', () => selectRider(button.dataset.riderId, people)));
  }

  // Same illustrative-position convention as PUBLIC_RIDERS' fixed x/y
  // percentages above (see the module header note on why the PWA has no
  // real map data) — each new report is placed at a small, deterministic
  // offset from "you" so multiple reports don't stack exactly on top of
  // each other, not at a real bearing/distance.
  const HAZARD_OFFSETS = [[14, -10], [-16, 8], [10, 16], [-12, -14], [18, 4]];

  // Real lat/lng deltas (same illustrative-offset convention as
  // HAZARD_OFFSETS above) so a report also gets a genuine position on the
  // live Google Map via addHazardMapMarker, instead of only existing in the
  // fallback layer's page-relative percentages — which used to stay
  // visible, floating disconnected from the real map, whenever a maps key
  // was configured.
  const HAZARD_GEO_OFFSETS = [[.0035, -.002], [-.004, .0025], [.002, .0042], [-.003, -.0038], [.0048, .0012]];

  function hazardLatLng(hazard, index) {
    if (typeof hazard.lat === 'number' && typeof hazard.lon === 'number') return { lat: hazard.lat, lng: hazard.lon };
    const centre = map ? map.getCenter().toJSON() : { lat: 51.564, lng: -0.106 };
    const [dLat, dLng] = HAZARD_GEO_OFFSETS[index % HAZARD_GEO_OFFSETS.length];
    hazard.lat = centre.lat + dLat;
    hazard.lon = centre.lng + dLng;
    persist();
    return { lat: hazard.lat, lng: hazard.lon };
  }

  function pinIcon(color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C7.3 1 1 7.1 1 14.6 1 23.6 15 39 15 39s14-15.4 14-24.4C29 7.1 22.7 1 15 1Z" fill="${color}" stroke="#0a0f14" stroke-width="2"/></svg>`;
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(30, 40),
      anchor: new google.maps.Point(15, 38),
    };
  }

  function addHazardMapMarker(hazard, position) {
    const meta = HAZARD_TYPES[hazard.type];
    const marker = new google.maps.Marker({ map, position, title: meta.label, icon: pinIcon(meta.color), zIndex: 6 });
    marker.addListener('click', () => selectHazard(hazard.id));
    return marker;
  }

  function renderMapHazards() {
    if (!map || usingFallbackMap) return;
    mapHazardMarkers.forEach((marker) => marker.setMap(null));
    mapHazardMarkers = state.hazards.map((hazard, index) => addHazardMapMarker(hazard, hazardLatLng(hazard, index)));
  }

  function renderHazardMarkers() {
    const layer = $('#hazardMarkers');
    layer.innerHTML = state.hazards.map((hazard, index) => {
      const [dx, dy] = HAZARD_OFFSETS[index % HAZARD_OFFSETS.length];
      const meta = HAZARD_TYPES[hazard.type];
      return `<button class="hazard-marker" style="left:${50 + dx}%;top:${53 + dy}%;--hazard:${meta.color}" data-hazard-id="${escapeHtml(hazard.id)}" aria-label="${escapeHtml(meta.label)}"><svg><use href="#${meta.icon}"/></svg></button>`;
    }).join('');
    $$('[data-hazard-id]', layer).forEach((button) => button.addEventListener('click', () => selectHazard(button.dataset.hazardId)));
    renderMapHazards();
  }

  function selectHazard(hazardId) {
    const hazard = state.hazards.find((h) => h.id === hazardId);
    const card = $('#hazardCard');
    if (!hazard) { card.hidden = true; return; }
    const meta = HAZARD_TYPES[hazard.type];
    card.innerHTML = `<span class="avatar" style="--avatar:${meta.color}" aria-hidden="true"><svg><use href="#${meta.icon}"/></svg></span><div class="rider-card-copy"><strong>${escapeHtml(meta.label)}</strong><span>Reported by a nearby rider</span><div class="hazard-vote-row"><button class="compact-button" data-vote="confirm">Still there (${hazard.confirmations})</button><button class="compact-button" data-vote="deny">Gone (${hazard.denials})</button></div></div>`;
    card.hidden = false;
    $('[data-vote="confirm"]', card).addEventListener('click', () => voteHazard(hazardId, 'confirm'));
    $('[data-vote="deny"]', card).addEventListener('click', () => voteHazard(hazardId, 'deny'));
  }

  function voteHazard(hazardId, direction) {
    const hazard = state.hazards.find((h) => h.id === hazardId);
    if (!hazard) return;
    if (direction === 'confirm') hazard.confirmations += 1;
    else hazard.denials += 1;
    persist();
    $('#hazardCard').hidden = true;
    renderHazardMarkers();
  }

  function createHazard(type) {
    state.hazards.push({ id: `hazard_${Date.now().toString(36)}`, type, confirmations: 0, denials: 0, createdAt: Date.now() });
    persist();
    renderHazardMarkers();
    showToast(`${HAZARD_TYPES[type].label} reported.`);
  }

  function visibleMapRiders() {
    if (!state.activeRide) return PUBLIC_RIDERS;
    return RIDE_MEMBERS
      .filter((member) => member.riderId !== state.profile.riderId)
      .map((member, index) => ({ ...member, x: 35 + index * 30, y: 43 + index * 15 }));
  }

  function renderMapRiders() {
    renderHazardMarkers();
    const riders = visibleMapRiders();
    if (!map || usingFallbackMap) return renderFallbackMarkers(riders);
    mapMarkers.forEach((marker) => marker.setMap(null));
    const centre = map.getCenter()?.toJSON() || { lat: 51.564, lng: -0.106 };
    const offsets = [[.004, -.006], [-.003, .006], [.008, .004]];
    mapMarkers = riders.map((person, index) => addMapMarker(person, {
      lat: centre.lat + offsets[index % offsets.length][0],
      lng: centre.lng + offsets[index % offsets.length][1],
    }, false));
  }

  function selectRider(riderId, people = PUBLIC_RIDERS) {
    if (riderId === state.profile.riderId) {
      state.selectedRiderId = null;
      $('#riderCard').hidden = true;
      renderMapRiders();
      return;
    }
    const person = people.find((item) => item.riderId === riderId) || PUBLIC_RIDERS.find((item) => item.riderId === riderId);
    if (!person) return;
    state.selectedRiderId = person.riderId;
    const card = $('#riderCard');
    card.innerHTML = `${avatar(person)}<div class="rider-card-copy"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status || 'Connected')}</span></div><button class="compact-button" data-view-friend>View</button>`;
    card.hidden = false;
    $('[data-view-friend]', card).addEventListener('click', () => { navigate('friends'); card.hidden = true; });
    renderFallbackMarkers(people.filter((item) => item.riderId !== state.profile.riderId));
  }

  function renderFriends() {
    const query = $('#friendSearch').value.trim().toLowerCase();
    const friends = state.friends.filter((friend) => [friend.displayName, friend.handle, friend.riderId].some((value) => value.toLowerCase().includes(query)));
    $('#requestList').innerHTML = state.requests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></div><div class="request-actions"><button class="decline" data-decline="${escapeHtml(person.riderId)}" aria-label="Decline ${escapeHtml(person.displayName)}">×</button><button class="accept" data-accept="${escapeHtml(person.riderId)}" aria-label="Accept ${escapeHtml(person.displayName)}">✓</button></div></article>`).join('');
    $('#friendList').innerHTML = friends.map((person) => `<button class="friend-row" data-friend="${escapeHtml(person.riderId)}">${avatar(person)}<span class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></span><span class="chevron">${icon('chevron')}</span></button>`).join('');
    $('#friendEmpty').hidden = friends.length > 0;
    const count = $('#friendsTitle')?.parentElement?.parentElement?.querySelector('.count-badge');
    if (count) count.textContent = String(state.friends.length);
    $$('[data-accept]').forEach((button) => button.addEventListener('click', () => acceptRequest(button.dataset.accept)));
    $$('[data-decline]').forEach((button) => button.addEventListener('click', () => declineRequest(button.dataset.decline)));
    $$('[data-friend]').forEach((button) => button.addEventListener('click', () => showToast('Messaging opens from the installed mobile app.')));
  }

  function acceptRequest(riderId) {
    const person = state.requests.find((request) => request.riderId === riderId);
    if (!person) return;
    state.requests = state.requests.filter((request) => request.riderId !== riderId);
    state.friends.push({ ...person, status: 'Connected now' });
    persist();
    renderFriends();
    showToast(`${person.displayName} added to friends.`);
  }

  function declineRequest(riderId) {
    state.requests = state.requests.filter((request) => request.riderId !== riderId);
    persist();
    renderFriends();
    showToast('Request declined.');
  }

  const VEHICLE_FILTER_ORDER = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];

  function renderRoutes() {
    const filtersEl = $('#routeVehicleFilters');
    filtersEl.innerHTML = ['all', ...VEHICLE_FILTER_ORDER].map((key) => {
      const active = (state.routeVehicleFilter ?? 'all') === key;
      const label = key === 'all' ? 'All vehicles' : VEHICLE_LABELS[key];
      return `<button class="chip${active ? ' active' : ''}" data-vehicle-filter="${key}">${escapeHtml(label)}</button>`;
    }).join('');
    $$('[data-vehicle-filter]', filtersEl).forEach((button) => button.addEventListener('click', () => {
      state.routeVehicleFilter = button.dataset.vehicleFilter === 'all' ? null : button.dataset.vehicleFilter;
      persist();
      renderRoutes();
    }));

    const filtered = state.routeVehicleFilter
      ? state.routes.filter((route) => route.vehicleSuitability.includes(state.routeVehicleFilter))
      : state.routes;

    $('#routeEmpty').hidden = filtered.length > 0;
    $('#routeList').innerHTML = filtered.map((route) => {
      const stars = Array.from({ length: 5 }, (_, i) => `<svg class="star${i < route.scenicRating ? ' filled' : ''}"><use href="#i-star"/></svg>`).join('');
      const badges = [
        ROAD_TYPE_LABELS[route.roadType],
        DIFFICULTY_LABELS[route.difficulty],
        `${route.distanceMiles} mi`,
        `${Math.round(route.estimatedDurationMinutes)} min`,
        `${SURFACE_LABELS[route.surfaceQuality]} surface`,
        route.avoidsTolls ? 'No tolls' : null,
        route.avoidsMotorways ? 'No motorways' : null,
      ].filter(Boolean).map((label) => `<span class="badge">${escapeHtml(label)}</span>`).join('');
      const notices = route.safetyNotices.length
        ? `<div class="safety-box"><svg><use href="#i-shield"/></svg><div>${route.safetyNotices.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</div></div>`
        : '';
      return `<article class="route-card" data-delete-route="${escapeHtml(route.id)}">
        <div class="route-card-head"><div><strong>${escapeHtml(route.name)}</strong><div class="star-row">${stars}</div></div>${route.createdBy === state.profile.riderId ? '<button class="icon-button" data-delete-route-btn aria-label="Delete route"><svg><use href="#i-reset"/></svg></button>' : ''}</div>
        <p class="secondary">${escapeHtml(route.description)}</p>
        <div class="badge-row">${badges}</div>
        <p class="caption">Suited for: ${route.vehicleSuitability.map((v) => VEHICLE_LABELS[v]).join(', ')}</p>
        ${notices}
        <a class="button tertiary" href="https://maps.google.com/?q=${route.startLat},${route.startLon}" target="_blank" rel="noopener">Open start in Maps</a>
      </article>`;
    }).join('');
    $$('[data-delete-route-btn]', $('#routeList')).forEach((button) => button.addEventListener('click', (event) => {
      const card = event.target.closest('[data-delete-route]');
      const routeId = card?.dataset.deleteRoute;
      if (!routeId || !window.confirm('Delete this route?')) return;
      state.routes = state.routes.filter((route) => route.id !== routeId);
      persist();
      renderRoutes();
      showToast('Route deleted.');
    }));
  }

  function createRoute(input) {
    const route = { ...input, id: `route_${Date.now().toString(36)}`, createdBy: state.profile.riderId, createdAt: Date.now() };
    state.routes.unshift(route);
    persist();
    renderRoutes();
    showToast('Route added.');
  }

  function renderRide() {
    const active = Boolean(state.activeRide);
    $('#rideJoinState').hidden = active;
    $('#rideActiveState').hidden = !active;
    $('#rideShareTop').hidden = !active;
    $('#ridePill').hidden = !active;
    if (!active) return;
    const ride = state.activeRide;
    $('#activeRideCode').textContent = ride.code;
    $('#ridePillCode').textContent = ride.code;
    $('#rideRole').textContent = ride.isHost ? 'host' : 'member';
    $('#memberCount').textContent = String(RIDE_MEMBERS.length);
    $('#leaveRideBtn').textContent = ride.isHost ? 'End ride' : 'Leave ride';
    $('#rideRoster').innerHTML = RIDE_MEMBERS.map((person) => `<article class="roster-row">${avatar(person, 'small')}<div class="identity"><strong>${escapeHtml(person.displayName)}${person.riderId === state.profile.riderId ? ' · You' : ''}</strong><span>${escapeHtml(person.handle)}</span></div><span class="roster-status">${escapeHtml(person.status)}</span></article>`).join('');
    renderMapRiders();
  }

  function randomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  function startRide(isHost, code = randomCode()) {
    state.activeRide = { code, isHost, rideId: `ride_${Date.now().toString(36)}` };
    state.selectedRiderId = null;
    persist();
    renderRide();
    navigate('ride');
    showToast(isHost ? 'Your private ride is ready.' : 'You joined the ride.');
  }

  function endRide() {
    if (!state.activeRide) return;
    const message = state.activeRide.isHost ? 'End this ride for everyone?' : 'Leave this ride?';
    if (!window.confirm(message)) return;
    state.activeRide = null;
    state.selectedRiderId = null;
    persist();
    renderRide();
    renderFallbackMarkers();
    showToast('Ride ended on this device.');
  }

  async function shareRide() {
    if (!state.activeRide) return;
    const text = `Join my Rider Comms group ride with code ${state.activeRide.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Rider Comms invite', text });
      else {
        await navigator.clipboard.writeText(state.activeRide.code);
        showToast('Ride code copied.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Could not open sharing.');
    }
  }

  function openSheet(type) {
    const templates = {
      profile: () => ({
        title: 'Account & profile',
        body: `<div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div><div class="form-field"><label for="editInstagram">Instagram username</label><input id="editInstagram" maxlength="30" value="${escapeHtml(state.profile.instagram)}" placeholder="your_username"></div><div class="form-field"><label for="editTiktok">TikTok username</label><input id="editTiktok" maxlength="30" value="${escapeHtml(state.profile.tiktok)}" placeholder="your_username"></div><div class="form-field"><label for="socialVisibility">Who can see your socials?</label><select id="socialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><button class="button primary wide" id="saveProfile">Save profile</button>`,
        ready: () => {
          $('#socialVisibility').value = state.profile.socialsVisibility;
          $('#saveProfile').addEventListener('click', saveProfile);
        },
      }),
      plans: () => ({
        title: 'Subscription & billing',
        body: `<div class="plan-card current"><div class="plan-top"><strong>Free</strong><span class="plan-pill">Current</span></div><p>1-mile mutual rider radius and private Group Rides.</p><button class="button secondary wide" disabled>Current plan</button></div><div class="plan-card"><div class="plan-top"><strong>Premium</strong><span>6 mi</span></div><p>A wider radius for groups that spread out across city routes.</p><button class="button primary wide" data-purchase>Choose Premium</button></div><div class="plan-card"><div class="plan-top"><strong>Premium+</strong><span>20 mi</span></div><p>Maximum discovery range for touring and rural rides.</p><button class="button primary wide" data-purchase>Choose Premium+</button></div><button class="button tertiary wide" data-purchase>Restore purchases</button><p class="caption">Your plan is verified by Rider Comms. Purchases remain unavailable until store products and receipt validation are active.</p>`,
        ready: () => $$('[data-purchase]').forEach((button) => button.addEventListener('click', () => showToast('Purchases are temporarily unavailable.'))),
      }),
      privacy: () => ({ title: 'Privacy & visibility', body: toggleMarkup('shareLocation', 'Share location while live', 'Nearby riders see your location only while you choose to go live.', state.profile.shareLocation) + `<div class="form-field"><label for="sheetSocialVisibility">Social links visibility</label><select id="sheetSocialVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div>`, ready: () => { $('#sheetSocialVisibility').value = state.profile.socialsVisibility; $('#sheetSocialVisibility').addEventListener('change', (event) => { state.profile.socialsVisibility = event.target.value; persist(); }); wireToggles(); } }),
      map: () => ({ title: 'Map & location', body: toggleMarkup('shareLocation', 'Location sharing', 'Location is requested only when you activate the nearby-rider channel.', state.profile.shareLocation) + `<p class="caption">Google Maps uses a deployment-provided browser key. If the service is unavailable, Rider Comms keeps controls accessible and shows a simplified map surface.</p>`, ready: wireToggles }),
      units: () => ({ title: 'Distance units', body: `<div class="form-field"><label for="unitSelect">Preferred unit</label><select id="unitSelect"><option value="mi">Miles</option><option value="km">Kilometres</option></select></div>`, ready: () => { $('#unitSelect').value = state.unit; $('#unitSelect').addEventListener('change', (event) => { state.unit = event.target.value; persist(); showToast('Distance unit updated.'); }); } }),
      notifications: () => ({ title: 'Notifications', body: toggleMarkup('notifications', 'Ride and message alerts', 'Receive useful updates while Rider Comms is not in the foreground.', state.notifications), ready: wireToggles }),
      safety: () => ({ title: 'Safety & privacy', body: `<h3>Designed for low distraction</h3><p class="secondary">Posting, profile editing and other visual tasks should be completed while stationary. Location sharing is off by default and can be stopped at any time.</p><h3>Emergency awareness</h3><p class="secondary">Rider Comms is not an emergency service. Always follow local road rules and use your vehicle controls safely.</p>` }),
      addRoute: () => ({
        title: 'Add a scenic route',
        body: `<p class="caption">This isn't reviewed by Rider Comms yet — only enter routes and safety notes you can vouch for yourself.</p>
          <div class="form-field"><label for="routeName">Route name</label><input id="routeName" maxlength="80"></div>
          <div class="form-field"><label for="routeDescription">Description</label><textarea id="routeDescription" maxlength="500" rows="3"></textarea></div>
          <div class="form-field"><label>Vehicle suitability</label><div class="chip-row" id="routeVehicleChips">${VEHICLE_FILTER_ORDER.map((v) => `<button type="button" class="chip" data-vehicle="${v}">${escapeHtml(VEHICLE_LABELS[v])}</button>`).join('')}</div></div>
          <div class="form-field"><label for="routeType">Road type</label><select id="routeType">${Object.entries(ROAD_TYPE_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeDistance">Distance (mi)</label><input id="routeDistance" type="number" min="0.1" step="0.1"></div>
          <div class="form-field"><label for="routeDuration">Duration (min)</label><input id="routeDuration" type="number" min="1" step="1"></div>
          <div class="form-field"><label for="routeDifficulty">Difficulty</label><select id="routeDifficulty">${Object.entries(DIFFICULTY_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeSurface">Surface quality</label><select id="routeSurface">${Object.entries(SURFACE_LABELS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="routeRating">Scenic rating (1-5)</label><input id="routeRating" type="number" min="1" max="5" step="1" value="3"></div>
          <div class="form-field"><label for="routeNotices">Safety notices (one per line, optional)</label><textarea id="routeNotices" rows="2"></textarea></div>
          <div class="form-field"><label for="routeStartLat">Start latitude</label><input id="routeStartLat" type="number" step="any"></div>
          <div class="form-field"><label for="routeStartLon">Start longitude</label><input id="routeStartLon" type="number" step="any"></div>
          <div class="form-field"><label for="routeEndLat">End latitude</label><input id="routeEndLat" type="number" step="any"></div>
          <div class="form-field"><label for="routeEndLon">End longitude</label><input id="routeEndLon" type="number" step="any"></div>
          <p id="routeFormError" class="inline-error" hidden></p>
          <button class="button primary wide" id="saveRoute">Save route</button>`,
        ready: () => {
          const selected = new Set();
          $$('[data-vehicle]', $('#routeVehicleChips')).forEach((chip) => chip.addEventListener('click', () => {
            const v = chip.dataset.vehicle;
            if (selected.has(v)) { selected.delete(v); chip.classList.remove('active'); }
            else { selected.add(v); chip.classList.add('active'); }
          }));
          $('#saveRoute').addEventListener('click', () => {
            const errorEl = $('#routeFormError');
            const name = $('#routeName').value.trim();
            const description = $('#routeDescription').value.trim();
            const distanceMiles = Number($('#routeDistance').value);
            const estimatedDurationMinutes = Number($('#routeDuration').value);
            const scenicRating = Number($('#routeRating').value);
            const startLat = Number($('#routeStartLat').value);
            const startLon = Number($('#routeStartLon').value);
            const endLat = Number($('#routeEndLat').value);
            const endLon = Number($('#routeEndLon').value);
            if (!name || !description) { errorEl.textContent = 'Add a name and description.'; errorEl.hidden = false; return; }
            if (selected.size === 0) { errorEl.textContent = 'Choose at least one vehicle type.'; errorEl.hidden = false; return; }
            if (!(distanceMiles > 0) || !(estimatedDurationMinutes > 0)) { errorEl.textContent = 'Distance and duration must be positive numbers.'; errorEl.hidden = false; return; }
            if (!(scenicRating >= 1 && scenicRating <= 5)) { errorEl.textContent = 'Scenic rating must be 1-5.'; errorEl.hidden = false; return; }
            if ([startLat, endLat].some((v) => Number.isNaN(v) || Math.abs(v) > 90) || [startLon, endLon].some((v) => Number.isNaN(v) || Math.abs(v) > 180)) {
              errorEl.textContent = 'Coordinates are invalid or out of range.'; errorEl.hidden = false; return;
            }
            createRoute({
              name, description,
              vehicleSuitability: [...selected],
              roadType: $('#routeType').value,
              distanceMiles, estimatedDurationMinutes,
              difficulty: $('#routeDifficulty').value,
              surfaceQuality: $('#routeSurface').value,
              avoidsTolls: false, avoidsMotorways: false,
              scenicRating,
              safetyNotices: $('#routeNotices').value.split('\n').map((s) => s.trim()).filter(Boolean),
              startLat, startLon, endLat, endLon,
            });
            closeSheet();
          });
        },
      }),
      reportHazard: () => ({
        title: 'Report on the road',
        body: `<p class="caption">Let nearby riders know what's ahead. Reports fade out over time.</p><div class="chip-row" id="hazardTypeChips">${HAZARD_TYPE_ORDER.map((t) => `<button type="button" class="chip" data-hazard-type="${t}">${escapeHtml(HAZARD_TYPES[t].label)}</button>`).join('')}</div>`,
        ready: () => $$('[data-hazard-type]', $('#hazardTypeChips')).forEach((chip) => chip.addEventListener('click', () => {
          createHazard(chip.dataset.hazardType);
          closeSheet();
        })),
      }),
    };
    const template = templates[type]?.();
    if (!template) return;
    $('#sheetTitle').textContent = template.title;
    $('#sheetBody').innerHTML = template.body;
    $('#sheetBackdrop').hidden = false;
    document.body.style.overflow = 'hidden';
    template.ready?.();
    $('#closeSheet').focus();
  }

  function toggleMarkup(key, title, description, active) {
    return `<div class="toggle-row"><span><strong>${escapeHtml(title)}</strong><span class="caption">${escapeHtml(description)}</span></span><button class="toggle" data-toggle="${escapeHtml(key)}" aria-label="${escapeHtml(title)}" aria-pressed="${active}"></button></div>`;
  }

  function wireToggles() {
    $$('[data-toggle]', $('#sheetBody')).forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      const active = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(active));
      if (key === 'shareLocation') state.profile.shareLocation = active;
      if (key === 'notifications') state.notifications = active;
      persist();
      renderMapStatus();
    }));
  }

  function saveProfile() {
    const displayName = $('#editName').value.trim();
    let handle = $('#editHandle').value.trim();
    if (!displayName) return showToast('Add a display name.');
    if (!handle.startsWith('@')) handle = `@${handle}`;
    if (!/^@[a-z0-9_]{3,24}$/i.test(handle)) return showToast('Use 3–24 letters, numbers or underscores for your handle.');
    state.profile.displayName = displayName;
    state.profile.handle = handle;
    state.profile.instagram = $('#editInstagram').value.trim().replace(/^@/, '');
    state.profile.tiktok = $('#editTiktok').value.trim().replace(/^@/, '');
    state.profile.socialsVisibility = $('#socialVisibility').value;
    persist();
    renderProfile();
    renderFallbackMarkers();
    closeSheet();
    showToast('Profile updated.');
  }

  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    document.body.style.overflow = '';
  }

  function renderMapStatus() {
    const active = state.publicLive && state.profile.shareLocation;
    const privateRide = Boolean(state.activeRide);
    $('#mapStatusText').textContent = privateRide
      ? `${RIDE_MEMBERS.length} riders · private ride`
      : active ? 'Visible to nearby riders' : 'Location sharing off';
    $('.map-status').classList.toggle('live', active);
    $('#joinNearbyBtn').hidden = privateRide;
    $('#joinNearbyBtn').dataset.active = String(active);
    $('#joinNearbyBtn').lastElementChild.textContent = active ? 'Leave nearby' : 'Go live';
  }

  async function toggleNearby() {
    if (state.publicLive) {
      state.publicLive = false;
      persist();
      renderMapStatus();
      showToast('You are no longer visible nearby.');
      return;
    }
    try {
      const position = await currentPosition();
      state.profile.shareLocation = true;
      state.publicLive = true;
      persist();
      renderMapStatus();
      centreMap(position.coords.latitude, position.coords.longitude);
      showToast('You are visible to nearby riders.');
    } catch {
      state.publicLive = false;
      renderMapStatus();
      $('#mapError').hidden = false;
      $('#mapError span').textContent = 'Location permission is needed to join riders nearby. You can still browse the map.';
    }
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    });
  }

  async function locate() {
    try {
      const position = await currentPosition();
      centreMap(position.coords.latitude, position.coords.longitude);
      showToast('Map centred on your location.');
    } catch {
      $('#mapError').hidden = false;
      $('#mapError span').textContent = 'Allow location access to centre the map on your position.';
    }
  }

  function centreMap(lat, lng) {
    if (map) {
      map.panTo({ lat, lng });
      map.setZoom(15);
      userMapMarker?.setPosition({ lat, lng });
    }
  }

  function loadGoogleMaps() {
    const key = window.RIDER_COMMS_CONFIG?.googleMapsApiKey;
    if (!key) {
      $('#mapError').hidden = true;
      renderMapStatus();
      disablePlaceSearch();
      return;
    }
    window.__riderCommsMapReady = initialiseGoogleMap;
    const script = document.createElement('script');
    // `libraries=places` is required for the search bar's Autocomplete
    // below — it shares this same browser-restricted key (see
    // RIDER_COMMS_CONFIG's own comment), no separate Places key needed.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=__riderCommsMapReady&v=weekly`;
    script.async = true;
    script.onerror = () => { $('#mapError').hidden = false; disablePlaceSearch(); };
    document.head.appendChild(script);
  }

  function disablePlaceSearch() {
    const input = $('#placeSearchInput');
    input.disabled = true;
    input.placeholder = 'Search unavailable';
  }

  function initPlaceSearch() {
    const input = $('#placeSearchInput');
    const autocomplete = new google.maps.places.Autocomplete(input, {
      fields: ['name', 'formatted_address', 'geometry'],
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const location = place?.geometry?.location;
      if (!location) return;
      centreMap(location.lat(), location.lng());
      setDestinationMarker(location, place.name);
      showToast(place.name ? `Centred on ${place.name}` : 'Centred on selected place.');
      input.blur();
    });
  }

  function setDestinationMarker(location, label) {
    destinationMarker?.setMap(null);
    destinationMarker = new google.maps.Marker({
      map,
      position: location,
      title: label || 'Selected place',
      icon: pinIcon('#ff7a1a'),
      animation: google.maps.Animation.DROP,
      zIndex: 9,
    });
  }

  function initialiseGoogleMap() {
    const centre = { lat: 51.564, lng: -0.106 };
    map = new google.maps.Map($('#googleMap'), {
      center: centre,
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      backgroundColor: prefersDarkMode() ? '#101820' : '#f4f1ec',
      styles: prefersDarkMode() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
    });
    usingFallbackMap = false;
    $('#fallbackMap').hidden = true;
    $('#fallbackMarkers').hidden = true;
    $('#hazardMarkers').hidden = true;
    $('#mapError').hidden = true;
    renderMapStatus();
    initPlaceSearch();
    userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, centre, true);
    const offsets = [[.004, -.006], [-.003, .006], [.008, .004]];
    mapMarkers = visibleMapRiders().map((person, index) => addMapMarker(person, { lat: centre.lat + offsets[index % offsets.length][0], lng: centre.lng + offsets[index % offsets.length][1] }, false));
    renderMapHazards();
  }

  function addMapMarker(person, position, current) {
    const marker = new google.maps.Marker({
      map,
      position,
      title: current ? 'Your location' : person.displayName,
      label: { text: initials(person.displayName), color: '#ffffff', fontWeight: '700', fontSize: '12px' },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: current ? 22 : 19, fillColor: identityColor(person.riderId), fillOpacity: 1, strokeColor: current ? '#ff7a1a' : '#e9eef5', strokeWeight: current ? 5 : 3 },
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
    window.addEventListener('popstate', () => navigate(location.hash.slice(1) || 'map', false));
    $$('[data-ride-mode]').forEach((button) => button.addEventListener('click', () => {
      $$('[data-ride-mode]').forEach((item) => item.classList.toggle('active', item === button));
      const host = button.dataset.rideMode === 'host';
      $('#joinRideForm').hidden = host;
      $('#hostRideForm').hidden = !host;
    }));
    $('#joinRideForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = $('#rideCode').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        $('#rideError').textContent = 'Enter a valid six-character ride code.';
        $('#rideError').hidden = false;
        return;
      }
      $('#rideError').hidden = true;
      startRide(false, code);
    });
    $('#rideCode').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6); });
    $('#createRideBtn').addEventListener('click', () => startRide(true));
    $('#leaveRideBtn').addEventListener('click', endRide);
    $('#shareRideBtn').addEventListener('click', shareRide);
    $('#rideShareTop').addEventListener('click', shareRide);
    $('#copyRideCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.activeRide.code); showToast('Ride code copied.'); } catch { shareRide(); } });
    $('#openRideMap').addEventListener('click', () => navigate('map'));
    $('#ridePill').addEventListener('click', () => navigate('ride'));
    $('#friendSearch').addEventListener('input', renderFriends);
    $('#addFriendToggle').addEventListener('click', () => { $('#addFriendForm').hidden = !$('#addFriendForm').hidden; if (!$('#addFriendForm').hidden) $('#friendId').focus(); });
    $('#addFriendForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const riderId = $('#friendId').value.trim().toLowerCase();
      if (!/^rider_[a-z0-9_]{4,30}$/.test(riderId)) { $('#friendFeedback').textContent = 'Enter a complete Rider ID, including rider_.'; return; }
      $('#friendFeedback').textContent = 'Request sent. We’ll show it here when they respond.';
      $('#friendId').value = '';
    });
    $$('[data-sheet]').forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.sheet)));
    $('#editProfileBtn').addEventListener('click', () => openSheet('profile'));
    $('#addRouteBtn').addEventListener('click', () => openSheet('addRoute'));
    $('#reportHazardBtn').addEventListener('click', () => openSheet('reportHazard'));
    $('#closeSheet').addEventListener('click', closeSheet);
    $('#sheetBackdrop').addEventListener('click', (event) => { if (event.target === $('#sheetBackdrop')) closeSheet(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSheet(); });
    $('#resetPwa').addEventListener('click', () => {
      if (!window.confirm('Reset this device’s Rider Comms preview?')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    $('#locateBtn').addEventListener('click', locate);
    $('#joinNearbyBtn').addEventListener('click', toggleNearby);
    $('[aria-label="Open profile"]').addEventListener('click', () => navigate('settings'));
  }

  // On a cold PWA launch (standalone, home-screen icon), iOS sometimes
  // resolves env(safe-area-inset-bottom) from a stale metric on the very
  // first layout pass, so the fixed bottom nav renders with extra bottom
  // padding — sitting noticeably higher than it should — until *anything*
  // else triggers a reflow, which is why switching tabs once and coming
  // back always looks correct. Force that reflow ourselves right after
  // load so it's correct from the first paint instead of only after the
  // user's first navigation. Harmless no-op on browsers that got it right
  // the first time (desktop, Android).
  function nudgeBottomNavReflow() {
    const nav = $('.bottom-nav');
    if (!nav) return;
    const nudge = () => { nav.style.display = 'none'; void nav.offsetHeight; nav.style.display = ''; };
    requestAnimationFrame(() => requestAnimationFrame(nudge));
    setTimeout(nudge, 400);
  }

  function init() {
    bindEvents();
    applyColorScheme();
    renderProfile();
    renderFriends();
    renderRide();
    renderMapStatus();
    renderFallbackMarkers();
    renderHazardMarkers();
    navigate(location.hash.slice(1) || state.screen || 'map', false);
    loadGoogleMaps();
    registerServiceWorker();
    nudgeBottomNavReflow();
  }

  init();
})();
