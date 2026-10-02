// Part of docs/app.js. 8 of 20: Realtime social feed and friend requests. Edit here, then run `npm run build:pwa-app`.
  function waitForSocialRetry(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runSocialEventLoop(generation) {
    while (session && generation === socialEventGeneration) {
      try {
        if (!socialEventCursor) {
          const baseline = await apiFetch('GET', '/social/events?limit=100&waitMs=0');
          if (generation !== socialEventGeneration) return;
          socialEventCursor = baseline.cursor;

          // Cursor establishment is only valid once every authoritative social
          // snapshot succeeds. If any fetch fails, the catch below clears the
          // cursor so recovery starts from a new tail instead of keeping stale
          // local state behind an already-advanced cursor.
          await Promise.all([
            refreshFriendNetwork(),
            refreshMessageSummaries(),
            refreshProfileAuthoritative(),
          ]);
          if (activeChat) await loadChatMessages({ throwOnError: true });
          if (activeFriendProfileRiderId) await openFriendProfile(activeFriendProfileRiderId);
        }

        let page = await apiFetch(
          'GET',
          `/social/events?after=${encodeURIComponent(socialEventCursor)}&limit=100&waitMs=25000`,
          undefined,
          30_000,
        );
        if (generation !== socialEventGeneration) return;

        let networkDirty = false;
        let messageDirty = false;
        let chatDirty = false;
        let selfProfileDirty = false;
        const friendProfileDirtyRiderIds = new Set();

        while (true) {
          for (const event of Array.isArray(page.events) ? page.events : []) {
            const peerProfileDirty = event.type === 'social_refresh'
              && event.entityId === 'profile'
              && event.actorRiderId !== state.profile.riderId;
            if (event.type === 'friend_request' || event.type === 'friend_request_resolved' || event.type === 'friend_removed' || peerProfileDirty) {
              networkDirty = true;
            }
            if (event.type === 'message' || event.type === 'message_read' || event.type === 'friend_removed') {
              messageDirty = true;
            }
            if (event.type === 'message' || event.type === 'message_read' || event.type === 'friend_removed') chatDirty = true;
            if (peerProfileDirty) friendProfileDirtyRiderIds.add(event.actorRiderId);
            if (event.type === 'social_refresh' && event.entityId === 'profile' && event.actorRiderId === state.profile.riderId) {
              selfProfileDirty = true;
            }
          }
          socialEventCursor = page.cursor || socialEventCursor;
          if (!page.hasMore || generation !== socialEventGeneration) break;
          page = await apiFetch(
            'GET',
            `/social/events?after=${encodeURIComponent(socialEventCursor)}&limit=100&waitMs=0`,
          );
        }

        if (generation !== socialEventGeneration) return;
        if (selfProfileDirty) await refreshProfileAuthoritative();
        if (networkDirty) await refreshFriendNetwork();
        if (messageDirty) await refreshMessageSummaries();
        if (chatDirty && activeChat) await loadChatMessages({ throwOnError: true });

        const openProfileRiderId = activeFriendProfileRiderId;
        if (openProfileRiderId && !state.friends.some((friend) => friend.riderId === openProfileRiderId)) {
          closeSheet();
        } else if (openProfileRiderId && friendProfileDirtyRiderIds.has(openProfileRiderId)) {
          await openFriendProfile(openProfileRiderId);
        }
      } catch {
        if (generation !== socialEventGeneration || !session) return;
        socialEventCursor = undefined;
        await waitForSocialRetry(SOCIAL_EVENT_RETRY_MS);
      }
    }
  }

  function startSocialEvents() {
    socialEventGeneration += 1;
    socialEventCursor = undefined;
    void runSocialEventLoop(socialEventGeneration);
  }

  function stopSocialEvents() {
    socialEventGeneration += 1;
    socialEventCursor = undefined;
  }

  /**
   * Resolves a list of bare rider IDs (all a ride roster or a presence
   * "in zone with" response carries) into display-ready {riderId,
   * displayName, handle} via GET /profiles/:id — one lookup per ID, same
   * as loadFriendsData() below does for incoming friend requests. Ride
   * rosters and nearby-rider lists are always small, so N lookups here is
   * fine. Falls back to showing the bare ID for a lookup that fails
   * (blocked, or the rider vanished) rather than dropping that rider
   * entirely.
   */
  async function resolveRiderProfiles(riderIds) {
    return Promise.all(riderIds.map(async (riderId) => {
      try {
        const profile = await apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`);
        return { riderId, displayName: profile.displayName || riderId, handle: profile.handle || '', avatarId: profile.avatarId || 'ember' };
      } catch {
        return { riderId, displayName: riderId, handle: riderId, avatarId: 'ember' };
      }
    }));
  }

  /**
   * Loads the rider's real friends + incoming/outgoing requests from the
   * backend (GET /riders/:id/friends, GET /riders/:id/friend-requests).
   * Request responses include joined profile summaries, so this remains two
   * bounded SQL-backed requests regardless of how many riders are listed.
   */
  async function refreshFriendNetwork() {
    if (!state.profile.riderId) return;
    const [friendsResult, requestsResult, activityResult] = await Promise.all([
      loadAllFriendPages(),
      loadAllFriendRequestPages(),
      apiFetch('GET', '/friends/activity').catch(() => null),
    ]);
    state.friends = friendsResult.map((friend) => ({
      riderId: friend.riderId,
      displayName: friend.displayName,
      handle: friend.handle,
      avatarId: friend.avatarId || 'ember',
      status: 'Connected',
    }));
    if (activityResult) {
      friendActivity = new Map((Array.isArray(activityResult.activity) ? activityResult.activity : []).map((item) => [item.riderId, item]));
    }

    const incoming = requestsResult.incoming.filter((request) => request.status === 'pending');
    state.requests = incoming.map((request) => {
      const profile = requestsResult.profiles?.[request.fromRiderId];
      return {
        id: request.id,
        riderId: request.fromRiderId,
        displayName: profile?.displayName ?? request.fromRiderId,
        handle: profile?.handle ?? request.fromRiderId,
        avatarId: profile?.avatarId || 'ember',
        status: 'Wants to connect',
      };
    });
    const outgoing = requestsResult.outgoing.filter((request) => request.status === 'pending');
    outgoingFriendRequests = outgoing.map((request) => {
      const profile = requestsResult.profiles?.[request.toRiderId];
      return {
        id: request.id,
        riderId: request.toRiderId,
        displayName: profile?.displayName ?? request.toRiderId,
        handle: profile?.handle ?? request.toRiderId,
        avatarId: profile?.avatarId || 'ember',
      };
    });
    persist();
    renderFriends();
  }

  async function loadFriendsData() {
    if (!state.profile.riderId) return;
    try {
      // Network and message summaries are independent authoritative resources.
      // Apply either successful snapshot even when the other one is transiently
      // unavailable; realtime callers use the throwing functions directly.
      await Promise.all([refreshFriendNetwork(), refreshMessageSummaries()]);
    } catch (error) {
      showToast('Could not load friends. ' + authErrorMessage(error));
    }
  }

  async function acceptRequest(requestId) {
    try {
      const result = await apiFetch('POST', `/friends/requests/${encodeURIComponent(requestId)}/accept`, {});
      state.requests = state.requests.filter((request) => request.id !== requestId);
      if (!state.friends.some((friend) => friend.riderId === result.friend.riderId)) {
        state.friends.push({ riderId: result.friend.riderId, displayName: result.friend.displayName, handle: result.friend.handle, avatarId: result.friend.avatarId || 'ember', status: 'Connected now' });
      }
      persist();
      renderFriends();
      showToast(`${result.friend.displayName} added to friends.`);
    } catch {
      showToast('Could not accept that request. Try again.');
    }
  }

  async function declineRequest(requestId) {
    try {
      await apiFetch('POST', `/friends/requests/${encodeURIComponent(requestId)}/decline`, {});
      state.requests = state.requests.filter((request) => request.id !== requestId);
      persist();
      renderFriends();
      showToast('Request declined.');
    } catch {
      showToast('Could not decline that request. Try again.');
    }
  }

  async function cancelRequest(requestId) {
    try {
      await apiFetch('DELETE', `/friends/requests/${encodeURIComponent(requestId)}`);
      outgoingFriendRequests = outgoingFriendRequests.filter((request) => request.id !== requestId);
      renderFriends();
      showToast('Request cancelled.');
    } catch {
      showToast('Could not cancel that request. Try again.');
    }
  }

  const FRIEND_REQUEST_ERROR_MESSAGES = {
    cannot_friend_yourself: 'You cannot send a friend request to yourself.',
    rider_not_found: 'No rider with that handle or Rider ID was found.',
    blocked: 'This connection is unavailable.',
    request_exists: 'A friend request is already pending between you.',
    already_friends: 'You are already friends with this rider.',
    rate_limited: 'Too many requests. Wait a moment and try again.',
    unauthorized: 'Your session has expired. Sign in again.',
  };

  async function sendFriendRequest(riderId) {
    try {
      await apiFetch('POST', '/friends/requests', { toRiderId: riderId });
      $('#friendFeedback').textContent = 'Request sent. We’ll show it here when they respond.';
      loadFriendsData();
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      $('#friendFeedback').textContent = FRIEND_REQUEST_ERROR_MESSAGES[code] || 'Could not send that request. Try again.';
    }
  }

