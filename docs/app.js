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
  };

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
  let userMapMarker;
  let mapMarkers = [];

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
    if (!['map', 'ride', 'friends', 'settings'].includes(screen)) screen = 'map';
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

  function selectRider(riderId, people = PUBLIC_RIDERS) {
    if (riderId === state.profile.riderId) {
      state.selectedRiderId = null;
      $('#riderCard').hidden = true;
      renderFallbackMarkers(state.activeRide && state.screen === 'map' ? RIDE_MEMBERS.filter((member) => member.riderId !== state.profile.riderId).map((member, index) => ({ ...member, x: 34 + index * 32, y: 42 + index * 16 })) : PUBLIC_RIDERS);
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
    const rideRiders = RIDE_MEMBERS.filter((member) => member.riderId !== state.profile.riderId).map((member, index) => ({ ...member, x: 34 + index * 32, y: 42 + index * 16 }));
    renderFallbackMarkers(state.screen === 'map' ? rideRiders : PUBLIC_RIDERS);
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
    $('#mapStatusText').textContent = active ? 'Visible to nearby riders' : 'Location sharing off';
    $('.map-status').classList.toggle('live', active);
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
      $('#mapError').hidden = false;
      $('#mapError span').textContent = 'Live map tiles are unavailable. Rider locations remain available in the simplified map view.';
      return;
    }
    window.__riderCommsMapReady = initialiseGoogleMap;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__riderCommsMapReady&v=weekly`;
    script.async = true;
    script.onerror = () => { $('#mapError').hidden = false; };
    document.head.appendChild(script);
  }

  function initialiseGoogleMap() {
    const centre = { lat: 51.564, lng: -0.106 };
    map = new google.maps.Map($('#googleMap'), {
      center: centre,
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      backgroundColor: '#101820',
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#172028' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#172028' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8f9ba7' }] },
        { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#293640' }] },
        { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#34434f' }] },
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2834' }] },
      ],
    });
    $('#fallbackMap').hidden = true;
    $('#fallbackMarkers').hidden = true;
    $('#mapError').hidden = true;
    userMapMarker = addMapMarker({ ...state.profile, displayName: state.profile.displayName }, centre, true);
    const offsets = [[.004, -.006], [-.003, .006], [.008, .004]];
    mapMarkers = PUBLIC_RIDERS.map((person, index) => addMapMarker(person, { lat: centre.lat + offsets[index][0], lng: centre.lng + offsets[index][1] }, false));
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
    marker.addListener('click', () => selectRider(person.riderId, PUBLIC_RIDERS));
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
  }

  function init() {
    bindEvents();
    renderProfile();
    renderFriends();
    renderRide();
    renderMapStatus();
    renderFallbackMarkers();
    navigate(location.hash.slice(1) || state.screen || 'map', false);
    loadGoogleMaps();
    registerServiceWorker();
  }

  init();
})();
