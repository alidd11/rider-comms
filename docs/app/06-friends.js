// Part of docs/app.js. 6 of 20: Friends list and friend profiles. Edit here, then run `npm run build:pwa-app`.
  function friendActivityLabel(activity) {
    if (!activity) return 'Offline';
    if (activity.online) return 'Online now';
    if (!Number.isFinite(activity.lastSeenAt)) return 'Offline';
    const elapsed = Math.max(0, Date.now() - activity.lastSeenAt);
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `Last seen ${Math.max(1, minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last seen ${hours}h ago`;
    return `Last seen ${Math.floor(hours / 24)}d ago`;
  }

  async function loadAllFriendPages() {
    const friends = [];
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friends?${query.toString()}`);
      friends.push(...(Array.isArray(page.friends) ? page.friends : []));
      before = page.nextCursor || undefined;
    } while (before);
    return friends;
  }

  async function loadAllFriendRequestPages() {
    const incoming = [];
    const outgoing = [];
    const profiles = {};
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/friend-requests?${query.toString()}`);
      incoming.push(...(Array.isArray(page.incoming) ? page.incoming : []));
      outgoing.push(...(Array.isArray(page.outgoing) ? page.outgoing : []));
      Object.assign(profiles, page.profiles || {});
      before = page.nextCursor || undefined;
    } while (before);
    return { incoming, outgoing, profiles };
  }

  async function loadAllConversationPages() {
    const conversations = [];
    let before;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (before) query.set('before', before);
      const page = await apiFetch('GET', `/conversations?${query.toString()}`);
      conversations.push(...(Array.isArray(page.conversations) ? page.conversations : []));
      before = page.nextCursor || undefined;
    } while (before);
    return conversations;
  }

  async function refreshFriendActivity() {
    if (!state.profile.riderId) return;
    try {
      const result = await apiFetch('GET', '/friends/activity');
      friendActivity = new Map((Array.isArray(result.activity) ? result.activity : []).map((item) => [item.riderId, item]));
      renderFriends();
    } catch {
      // Preserve the last known activity state on transient network errors.
    }
  }

  async function refreshMessageSummaries() {
    if (!state.profile.riderId) return;
    const [conversations, unread] = await Promise.all([
      loadAllConversationPages(),
      apiFetch('GET', '/messages/unread-count'),
    ]);
    conversationSummaries = new Map(conversations.map((conversation) => [conversation.friend.riderId, conversation]));
    unreadMessageCount = Number.isFinite(unread.unreadCount) ? unread.unreadCount : 0;
    renderFriends();
  }

  function syncFriendActivityPolling() {
    clearInterval(friendActivityTimer);
    friendActivityTimer = undefined;
    if (!session) return;
    friendActivityTimer = setInterval(() => { void refreshFriendActivity(); }, 30_000);
  }

  function renderFriends() {
    const query = $('#friendSearch').value.trim().toLowerCase();
    const friends = state.friends
      .filter((friend) => [friend.displayName, friend.handle, friend.riderId].some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => {
        const aOnline = friendActivity.get(a.riderId)?.online === true;
        const bOnline = friendActivity.get(b.riderId)?.online === true;
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        return 0;
      });
    const onlineFriends = friends.filter((friend) => friendActivity.get(friend.riderId)?.online === true);
    const offlineFriends = friends.filter((friend) => friendActivity.get(friend.riderId)?.online !== true);

    const incomingRows = state.requests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · ${escapeHtml(person.status)}</span></div><div class="request-actions"><button class="request-safety" data-request-safety="${escapeHtml(person.id)}" aria-label="Report or block ${escapeHtml(person.displayName)}">${icon('shield')}</button><button class="decline" data-decline="${escapeHtml(person.id)}" aria-label="Decline ${escapeHtml(person.displayName)}">×</button><button class="accept" data-accept="${escapeHtml(person.id)}" aria-label="Accept ${escapeHtml(person.displayName)}">✓</button></div></article>`).join('');
    const outgoingRows = outgoingFriendRequests.map((person) => `<article class="request-row">${avatar(person)}<div class="identity"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.handle)} · Pending</span></div><div class="request-actions"><button data-cancel-request="${escapeHtml(person.id)}" aria-label="Cancel request to ${escapeHtml(person.displayName)}">Cancel</button></div></article>`).join('');
    $('#requestList').innerHTML = incomingRows + outgoingRows;

    const friendRowHtml = (person) => {
      const activity = friendActivity.get(person.riderId);
      const online = activity?.online === true;
      const unread = conversationSummaries.get(person.riderId)?.unreadCount || 0;
      const inActiveRide = state.activeRide?.memberIds?.includes(person.riderId) === true;
      const activityCopy = inActiveRide ? 'In your group ride' : friendActivityLabel(activity);
      return `<button class="friend-row${online ? ' is-online' : ''}" data-friend="${escapeHtml(person.riderId)}">
        <span class="friend-avatar-wrap">${avatar(person)}<i class="friend-presence-dot ${online ? 'online' : 'offline'}" aria-hidden="true"></i></span>
        <span class="identity"><strong>${escapeHtml(person.displayName)}</strong><span class="friend-activity">${escapeHtml(activityCopy)}</span></span>
        ${unread > 0 ? `<span class="count-badge friend-unread-badge" aria-label="${unread} unread messages">${unread > 99 ? '99+' : unread}</span>` : ''}
        <span class="friend-more" aria-hidden="true">•••</span>
      </button>`;
    };
    $('#friendList').innerHTML = [
      onlineFriends.length
        ? `<section class="friend-group"><h2 class="friend-group-label">Online (${onlineFriends.length})</h2>${onlineFriends.map(friendRowHtml).join('')}</section>`
        : '',
      offlineFriends.length
        ? `<section class="friend-group"><h2 class="friend-group-label">Offline (${offlineFriends.length})</h2>${offlineFriends.map(friendRowHtml).join('')}</section>`
        : '',
    ].join('');
    const hasFriends = state.friends.length > 0;
    const hasVisibleFriends = friends.length > 0;
    const requestTotal = state.requests.length + outgoingFriendRequests.length;
    const hasRequests = requestTotal > 0;
    const empty = $('#friendEmpty');
    $('#requestSection').hidden = !hasRequests;
    $('#friendSection').hidden = !hasVisibleFriends;
    empty.hidden = hasVisibleFriends;
    $('#friendEmptyTitle').textContent = query ? 'No matching friends' : 'Build your riding circle';
    $('#friendEmptyCopy').textContent = query
      ? 'Try a different name, handle or Rider ID.'
      : 'Use the add button above to connect by handle or Rider ID.';
    const count = $('#friendsCountBadge');
    if (count) {
      count.textContent = String(state.friends.length);
      count.hidden = !hasFriends;
    }
    const requestCount = $('#requestsCountBadge');
    if (requestCount) requestCount.textContent = String(requestTotal);
    $('#networkFriendCount').textContent = String(state.friends.length);
    $('#networkRequestCount').textContent = String(requestTotal);
    const navBadge = $('#friendsNavBadge');
    const attentionCount = state.requests.length + unreadMessageCount;
    if (navBadge) {
      navBadge.textContent = attentionCount > 99 ? '99+' : String(attentionCount);
      navBadge.hidden = attentionCount === 0;
    }
    $$('[data-accept]').forEach((button) => button.addEventListener('click', () => acceptRequest(button.dataset.accept)));
    $$('[data-decline]').forEach((button) => button.addEventListener('click', () => declineRequest(button.dataset.decline)));
    $$('[data-request-safety]').forEach((button) => button.addEventListener('click', () => {
      const request = state.requests.find((candidate) => candidate.id === button.dataset.requestSafety);
      if (request) openRiderSafetyMenu(request, 'an incoming friend request');
    }));
    $$('[data-cancel-request]').forEach((button) => button.addEventListener('click', () => cancelRequest(button.dataset.cancelRequest)));
    $$('[data-friend]').forEach((button) => button.addEventListener('click', () => openFriendProfile(button.dataset.friend)));
  }

  async function openFriendProfile(riderId) {
    const friend = state.friends.find((person) => person.riderId === riderId);
    if (!friend) {
      if (activeFriendProfileRiderId === riderId) closeSheet();
      return;
    }

    const renderProfile = (profile, { loading = false, refreshError = false } = {}) => {
      const currentFriend = state.friends.find((person) => person.riderId === riderId);
      if (!currentFriend) {
        if (activeFriendProfileRiderId === riderId) closeSheet();
        return false;
      }
      const activity = friendActivity.get(riderId);
      const activityCopy = friendActivityLabel(activity);
      const inActiveRide = state.activeRide?.memberIds?.includes(riderId) === true;
      const rideLocation = rideMemberLocations.get(riderId);
      const liveRideLocation = inActiveRide && rideLocation && Date.now() - rideLocation.updatedAt <= RIDE_LOCATION_REFRESH_MS * 2
        ? rideLocation
        : null;
      const socialLinks = [
        profile.instagramUsername ? `<a class="social-link" href="https://www.instagram.com/${encodeURIComponent(profile.instagramUsername)}/" target="_blank" rel="noopener"><span>Instagram</span><strong>@${escapeHtml(profile.instagramUsername)}</strong>${icon('chevron')}</a>` : '',
        profile.tiktokUsername ? `<a class="social-link" href="https://www.tiktok.com/@${encodeURIComponent(profile.tiktokUsername)}" target="_blank" rel="noopener"><span>TikTok</span><strong>@${escapeHtml(profile.tiktokUsername)}</strong>${icon('chevron')}</a>` : '',
      ].filter(Boolean).join('');
      const sharedProfileCount = Number(Boolean(profile.instagramUsername)) + Number(Boolean(profile.tiktokUsername));
      const groupRideCount = state.activeRide?.memberIds?.length ?? 0;
      const profileAvatar = avatar({ ...currentFriend, avatarId: profile.avatarId || currentFriend.avatarId });
      const mapActionState = liveRideLocation
        ? ' aria-label="View rider on map"'
        : ' disabled aria-disabled="true" aria-label="Rider location not shared" title="This rider is not sharing a fresh private-ride location."';
      const shareLocationState = inActiveRide
        ? ` aria-pressed="${state.activeRide?.shareRideLocation === true}" aria-label="${state.activeRide?.shareRideLocation === true ? 'Stop sharing your location with this group ride' : 'Share your location with this group ride'}" title="Shares your location with everyone in your current group ride, not just this rider."`
        : ' disabled aria-disabled="true" aria-label="Share location unavailable outside a shared group ride" title="Available when you are in the same group ride."';

      presentSheet(currentFriend.displayName, `<article class="friend-profile-card">
          <div class="friend-profile-identity">
            <span class="friend-profile-avatar">${profileAvatar}<i class="friend-presence-dot ${activity?.online ? 'online' : 'offline'}" aria-hidden="true"></i></span>
            <div class="friend-profile-copy">
              <strong>${escapeHtml(currentFriend.displayName)}</strong>
              <span>${escapeHtml(currentFriend.handle)} · ${escapeHtml(activityCopy)}</span>
            </div>
          </div>
        </article>
        <div class="friend-profile-actions" aria-label="Rider actions">
          <button id="messageFriend"><span class="friend-action-icon">${icon('message')}</span><strong>Message</strong></button>
          <button id="shareFriendLocation"${shareLocationState}><span class="friend-action-icon">${icon('nav-arrow')}</span><strong>Share to Ride</strong></button>
          <button id="friendMapAction"${mapActionState}><span class="friend-action-icon">${icon('location')}</span><strong>Map</strong></button>
          <button id="friendSafetyActions"><span class="friend-action-icon friend-action-more" aria-hidden="true">•••</span><strong>More</strong></button>
        </div>
        <div class="friend-profile-detail-list">
          <div><span class="setting-icon">${icon('location')}</span><span><strong>Location</strong><small>${liveRideLocation ? 'Shared in your current ride · updated recently' : 'Not shared with you'}</small></span></div>
          <div><span class="setting-icon">${icon('ride')}</span><span><strong>Group ride</strong><small>${inActiveRide ? `${groupRideCount} rider${groupRideCount === 1 ? '' : 's'} · riding together` : 'Not in your current ride'}</small></span></div>
          <div><span class="setting-icon">${icon('friends')}</span><span><strong>Shared profiles</strong><small>${sharedProfileCount ? `${sharedProfileCount} profile${sharedProfileCount === 1 ? '' : 's'} shared with you` : 'None shared'}</small></span></div>
        </div>
        ${loading
          ? '<p class="friend-profile-note friend-profile-note-quiet">Refreshing shared profile…</p>'
          : refreshError
            ? '<p class="friend-profile-note friend-profile-note-quiet">Could not refresh shared profile. Reopen this rider to try again.</p>'
            : socialLinks
              ? `<div class="friend-profile-social"><span class="friend-profile-section-label">Shared profiles</span><div class="social-links">${socialLinks}</div></div>`
              : ''}
        ${liveRideLocation ? '<button id="viewFriendOnMap" class="friend-profile-view-map">View on Map</button>' : ''}`, () => {
        const showFriendOnMap = () => {
          if (!liveRideLocation) return;
          closeSheet();
          navigate('map');
          centreMap(liveRideLocation.lat, liveRideLocation.lon);
          const ridePeople = state.activeRide?.members || [];
          if (ridePeople.some((person) => person.riderId === riderId)) selectRider(riderId, ridePeople);
        };
        $('#shareFriendLocation').addEventListener('click', async () => {
          if (!inActiveRide || !state.activeRide) return;
          const enable = state.activeRide.shareRideLocation !== true;
          const ok = await setRideLocationSharing(enable);
          if (ok && activeFriendProfileRiderId === riderId) renderProfile(profile);
        });
        $('#messageFriend').addEventListener('click', () => openChat(currentFriend));
        $('#friendMapAction').addEventListener('click', showFriendOnMap);
        $('#viewFriendOnMap')?.addEventListener('click', showFriendOnMap);
        $('#friendSafetyActions').addEventListener('click', () => openFriendSafetyActions(currentFriend));
      });
      activeFriendProfileRiderId = riderId;
      return true;
    };

    // Scrub any previously-visible social links immediately. The authoritative
    // public profile response is the only thing allowed to reveal them again.
    if (!renderProfile(friend, { loading: true })) return;

    let profile;
    try {
      profile = await apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`);
    } catch {
      // The scrubbed friendship identity stays visible, but no stale social
      // links survive a failed privacy refresh.
      if (activeFriendProfileRiderId === riderId) renderProfile(friend, { refreshError: true });
      return;
    }
    if (activeFriendProfileRiderId !== riderId) return;
    renderProfile(profile);
  }

