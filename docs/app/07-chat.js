// Part of docs/app.js. 7 of 20: Direct messages, Hideouts, and report/block/remove. Edit here, then run `npm run build:pwa-app`.
  function formatMessageTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  }

  /** "Today", "Yesterday", "Mon 30 Sep", or with the year when it isn't this year. */
  function formatMessageDay(value, now = new Date()) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  }

  function renderChatHideouts() {
    const section = $('#chatHideouts');
    const list = $('#chatHideoutList');
    const status = $('#chatHideoutStatus');
    if (!section || !list || !status || !activeChat) {
      if (section) section.hidden = true;
      return;
    }

    const provider = navigationProvider(state.navigationProvider);
    const providerLabel = NAVIGATION_PROVIDERS[provider].label;
    status.textContent = chatHideoutsLoading
      ? 'Loading…'
      : chatHideoutError
        ? chatHideoutError
        : chatHideouts.length === 1
          ? '1 saved'
          : `${chatHideouts.length} saved`;

    section.hidden = !chatHideoutsLoading && !chatHideoutError && chatHideouts.length === 0;
    list.innerHTML = chatHideouts.map((hideout) => {
      const mine = hideout.createdBy === state.profile.riderId;
      const coords = `${Number(hideout.lat).toFixed(4)}, ${Number(hideout.lon).toFixed(4)}`;
      return `<article class="chat-hideout-row">
        <span class="chat-hideout-icon" aria-hidden="true">${icon('location')}</span>
        <span class="chat-hideout-copy"><strong>${escapeHtml(hideout.name)}</strong><small>${escapeHtml(coords)}</small></span>
        <span class="chat-hideout-actions">
          <button type="button" data-open-hideout="${escapeHtml(hideout.id)}" aria-label="Open directions to ${escapeHtml(hideout.name)} in ${escapeHtml(providerLabel)}">${escapeHtml(providerLabel)}</button>
          ${mine ? `<button type="button" data-delete-hideout="${escapeHtml(hideout.id)}" aria-label="Delete hideout ${escapeHtml(hideout.name)}">×</button>` : ''}
        </span>
      </article>`;
    }).join('');

    $$('[data-open-hideout]', list).forEach((button) => {
      button.addEventListener('click', () => openChatHideout(button.dataset.openHideout));
    });
    $$('[data-delete-hideout]', list).forEach((button) => {
      button.addEventListener('click', () => void deleteChatHideout(button.dataset.deleteHideout));
    });
  }

  async function loadChatHideouts() {
    if (!activeChat || chatHideoutsLoading) return;
    const riderId = activeChat.riderId;
    chatHideoutsLoading = true;
    chatHideoutError = '';
    renderChatHideouts();
    try {
      const result = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/hideouts`);
      if (!activeChat || activeChat.riderId !== riderId) return;
      const hideouts = Array.isArray(result.hideouts) ? result.hideouts : [];
      chatHideouts = hideouts.filter((hideout) =>
        hideout
        && typeof hideout.id === 'string'
        && typeof hideout.name === 'string'
        && Number.isFinite(hideout.lat)
        && Number.isFinite(hideout.lon)
        && Array.isArray(hideout.participantIds)
        && hideout.participantIds.includes(riderId)
      );
    } catch {
      if (activeChat?.riderId === riderId) chatHideoutError = 'Could not load hideouts';
    } finally {
      chatHideoutsLoading = false;
      renderChatHideouts();
    }
  }

  function openChatHideout(hideoutId) {
    const hideout = chatHideouts.find((item) => item.id === hideoutId);
    if (!hideout) return;
    const provider = navigationProvider(state.navigationProvider);
    if (provider !== 'in_app') {
      const href = navigationHref(provider, hideout.lat, hideout.lon, hideout.name);
      if (!href) {
        showToast('Could not open directions.');
        return;
      }
      const opened = window.open(href, '_blank');
      if (opened) opened.opener = null;
      else window.location.href = href;
      return;
    }

    closeChat({ restoreFocus: false });
    navigate('map');
    requestAnimationFrame(() => {
      if (typeof google === 'undefined' || !map || usingFallbackMap) {
        showToast('Rider Comms navigation needs the live map.');
        return;
      }
      const location = new google.maps.LatLng(hideout.lat, hideout.lon);
      setDestinationMarker(location, hideout.name, `${hideout.lat.toFixed(5)}, ${hideout.lon.toFixed(5)}`);
    });
  }

  async function deleteChatHideout(hideoutId) {
    const hideout = chatHideouts.find((item) => item.id === hideoutId);
    if (!hideout || hideout.createdBy !== state.profile.riderId) return;
    try {
      await apiFetch('DELETE', `/hideouts/${encodeURIComponent(hideoutId)}`);
      chatHideouts = chatHideouts.filter((item) => item.id !== hideoutId);
      renderChatHideouts();
      showToast('Hideout deleted.');
    } catch {
      chatHideoutError = 'Could not delete hideout';
      renderChatHideouts();
    }
  }

  function openPlanHideoutSheet() {
    if (!activeChat) return;
    const friend = activeChat;
    presentSheet('Plan a hideout', `
      <form id="planHideoutForm" class="form-field">
        <label for="hideoutName">Name</label>
        <input id="hideoutName" maxlength="100" autocomplete="off" placeholder="e.g. Petrol station meeting point">
        <div class="hideout-coordinate-grid">
          <label>Latitude<input id="hideoutLat" inputmode="decimal" autocomplete="off" placeholder="51.5074"></label>
          <label>Longitude<input id="hideoutLon" inputmode="decimal" autocomplete="off" placeholder="-0.1278"></label>
        </div>
        <button id="hideoutUseLocation" class="button secondary wide" type="button">Use my current location</button>
        <p class="caption">Save a meeting point shared with ${escapeHtml(friend.displayName)}. Use your location, or paste coordinates from a map.</p>
        <p id="planHideoutError" class="inline-error" role="alert" hidden></p>
        <button id="saveHideoutBtn" class="button primary wide" type="submit">Save hideout</button>
      </form>`, () => {
      $('#hideoutUseLocation').addEventListener('click', async () => {
        const button = $('#hideoutUseLocation');
        button.disabled = true;
        try {
          const position = await currentPosition();
          $('#hideoutLat').value = position.coords.latitude.toFixed(5);
          $('#hideoutLon').value = position.coords.longitude.toFixed(5);
        } catch (error) {
          showToast(locationAccessMessage(error, 'use your location for a hideout'));
        } finally {
          button.disabled = false;
        }
      });
      $('#planHideoutForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = $('#hideoutName').value.trim();
        const latInput = $('#hideoutLat').value.trim();
        const lonInput = $('#hideoutLon').value.trim();
        const lat = Number(latInput);
        const lon = Number(lonInput);
        const errorEl = $('#planHideoutError');
        const save = $('#saveHideoutBtn');
        errorEl.hidden = true;

        if (!name || !latInput || !lonInput || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          errorEl.textContent = 'Enter a name plus valid latitude and longitude coordinates.';
          errorEl.hidden = false;
          return;
        }

        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          await apiFetch('POST', '/hideouts', { name, lat, lon, participantIds: [friend.riderId] });
          closeSheet();
          await loadChatHideouts();
          showToast('Hideout saved.');
        } catch (error) {
          const code = error instanceof ApiError ? error.body?.error : '';
          errorEl.textContent = code === 'participants_must_be_friends'
            ? 'Hideouts can only be shared with current friends.'
            : 'Could not save that hideout. Try again.';
          errorEl.hidden = false;
          save.disabled = false;
          save.textContent = 'Save hideout';
        }
      });
    });
  }

  function renderChat() {
    if (!activeChat) return;
    const messages = $('#chatMessages');
    let previousDay = '';
    messages.innerHTML = chatMessages.map((message) => {
      // A day label before the first message of each day, so times from
      // different days never read as one out-of-order conversation.
      const day = formatMessageDay(message.createdAt);
      const dayLabel = day && day !== previousDay ? `<p class="chat-day" role="separator">${escapeHtml(day)}</p>` : '';
      previousDay = day || previousDay;
      const mine = message.fromRiderId === state.profile.riderId;
      const failed = mine && message.status === 'failed';
      const status = message.status === 'pending'
        ? '<small>Sending…</small>'
        : failed
          ? '<small>Failed — tap to retry</small>'
          : mine && message.id === chatPeerReadThroughMessageId
            ? '<small>Read</small>'
            : '';
      const body = `<span>${escapeHtml(message.text)}</span><time>${escapeHtml(formatMessageTime(message.createdAt))}</time>${status}`;
      return dayLabel + (failed
        ? `<button class="chat-bubble-row mine" data-retry-message="${escapeHtml(message.id)}" aria-label="Message failed. Retry sending."><span class="chat-bubble failed">${body}</span></button>`
        : `<div class="chat-bubble-row${mine ? ' mine' : ''}"><div class="chat-bubble">${body}</div></div>`);
    }).join('');
    $('#chatEmpty').hidden = chatLoading || chatMessages.length > 0;
    $('#chatLoadOlder').hidden = !chatNextCursor;
    $$('[data-retry-message]', messages).forEach((button) => button.addEventListener('click', () => void retryChatMessage(button.dataset.retryMessage)));
    renderChatHideouts();
  }

  function setChatError(message, unavailable = false) {
    const error = $('#chatError');
    error.querySelector('span').textContent = message || '';
    error.hidden = !message;
    $('#chatRetry').hidden = unavailable;
    $('#chatInput').disabled = unavailable;
    $('#chatSend').disabled = unavailable;
  }

  async function loadChatMessages({ older = false, showLoading = false, throwOnError = false } = {}) {
    if (!activeChat || (older && !chatNextCursor)) return;

    // Latest-thread refreshes are authoritative and must never be discarded
    // just because another chat fetch is already in flight. Older-page loads
    // remain user-driven and simply wait for a quiet thread.
    if (older && chatLoadPromise) return;
    while (!older && chatLoadPromise) {
      try { await chatLoadPromise; } catch { /* The queued latest fetch retries below. */ }
      if (!activeChat) return;
    }

    const riderId = activeChat.riderId;
    const run = (async () => {
      chatLoading = true;
      if (showLoading) {
        setChatError('Loading messages…');
        $('#chatRetry').hidden = true;
      }
      try {
        const query = new URLSearchParams({ withRiderId: riderId, limit: '100' });
        if (older) query.set('before', chatNextCursor);
        const page = await apiFetch('GET', `/messages?${query.toString()}`);
        if (!activeChat || activeChat.riderId !== riderId) return;
        chatMessages = older || chatHasLoadedOlder
          ? window.RiderMessageState.dedupe([...page.messages, ...chatMessages])
          : window.RiderMessageState.reconcile(chatMessages, page.messages);
        if (older) chatHasLoadedOlder = true;
        if (!chatHasLoadedOlder || older) chatNextCursor = page.nextCursor;
        chatPeerReadThroughMessageId = page.peerReadThroughMessageId || null;
        setChatError('');
        if (!older) {
          try {
            await apiFetch('POST', '/messages/read', { withRiderId: riderId });
            await refreshMessageSummaries();
          } catch {
            // The conversation loaded successfully. Read-state reconciliation
            // can recover independently without turning the thread into an error.
          }
        }
        renderChat();
        if (!older) requestAnimationFrame(() => { $('#chatThread').scrollTop = $('#chatThread').scrollHeight; });
      } catch (error) {
        const unavailable = error instanceof ApiError && error.status === 403;
        setChatError(unavailable ? 'This conversation is no longer available.' : 'Could not refresh messages. Check your connection and try again.', unavailable);
        // A 403 is authoritative relationship state, not a transport failure.
        // Transient failures must escape realtime callers so they rebaseline
        // instead of advancing the durable cursor with a stale open thread.
        if (throwOnError && !unavailable) throw error;
      } finally {
        chatLoading = false;
        renderChat();
      }
    })();

    chatLoadPromise = run;
    try {
      await run;
    } finally {
      if (chatLoadPromise === run) chatLoadPromise = null;
    }
  }

  function openChat(friend) {
    if (window.RiderMovementSafety.isLockedForSafety(movementState)) {
      showToast('Messages stay locked until Rider Comms confirms you are stationary.');
      return;
    }
    chatReturnFocus = lastSheetTrigger || document.activeElement;
    closeSheet();
    activeChat = friend;
    chatMessages = [];
    chatNextCursor = null;
    chatHasLoadedOlder = false;
    chatPeerReadThroughMessageId = null;
    chatHideouts = [];
    chatHideoutsLoading = false;
    chatHideoutError = '';
    $('#chatTitle').textContent = friend.displayName;
    $('#chatHandle').textContent = friend.handle;
    $('#chatAvatar').outerHTML = avatar(friend, 'avatar-sm').replace('<span ', '<span id="chatAvatar" ');
    $('#chatScreen').hidden = false;
    $('#app').setAttribute('inert', '');
    document.documentElement.classList.add('chat-open');
    // Friends screens scroll internally, so the document itself should always
    // be at zero here. Explicitly reset any stale iOS focus pan before the
    // composer can receive focus, then let the chat-open body lock prevent a
    // second document-level shift.
    window.scrollTo(0, 0);
    syncViewportEnvironment();
    setChatError('');
    renderChat();
    history.pushState({ screen: 'friends', chat: friend.riderId }, '', '#friends/chat');
    document.title = `${friend.displayName} · Rider Comms`;
    void loadChatMessages({ showLoading: true });
    void loadChatHideouts();
  }

  function closeChat({ restoreFocus = true } = {}) {
    if (!activeChat) return;
    activeChat = null;
    chatMessages = [];
    chatNextCursor = null;
    chatHasLoadedOlder = false;
    chatPeerReadThroughMessageId = null;
    chatHideouts = [];
    chatHideoutsLoading = false;
    chatHideoutError = '';
    $('#chatScreen').hidden = true;
    $('#app').removeAttribute('inert');
    document.documentElement.classList.remove('chat-open');
    syncViewportEnvironment();
    document.title = 'Friends · Rider Comms';
    if (restoreFocus) chatReturnFocus?.focus?.();
    chatReturnFocus = null;
  }

  async function sendChatText(text, localId) {
    if (!activeChat) return;
    const riderId = activeChat.riderId;
    try {
      const sent = await apiFetch('POST', '/messages', { toRiderId: riderId, text });
      if (activeChat?.riderId !== riderId) return;
      chatMessages = window.RiderMessageState.acknowledge(chatMessages, localId, sent);
      renderChat();
    } catch {
      if (activeChat?.riderId !== riderId) return;
      chatMessages = chatMessages.map((message) => message.id === localId ? { ...message, status: 'failed' } : message);
      renderChat();
    }
  }

  function submitChatMessage() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!activeChat || !text) return;
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chatMessages.push({ id: localId, fromRiderId: state.profile.riderId, toRiderId: activeChat.riderId, text, createdAt: Date.now(), status: 'pending' });
    input.value = '';
    renderChat();
    requestAnimationFrame(() => { $('#chatThread').scrollTop = $('#chatThread').scrollHeight; });
    void sendChatText(text, localId);
  }

  async function retryChatMessage(localId) {
    const target = chatMessages.find((message) => message.id === localId && message.status === 'failed');
    if (!target) return;
    chatMessages = chatMessages.map((message) => message.id === localId ? { ...message, status: 'pending' } : message);
    renderChat();
    await sendChatText(target.text, localId);
  }

  const REPORT_REASONS = [
    ['harassment', 'Harassment or threats', 'Abuse, threats or repeated unwanted contact', 'message'],
    ['sexual', 'Sexual or explicit content', 'Explicit messages, names or behaviour', 'shield'],
    ['unsafe', 'Unsafe behaviour', 'Dangerous conduct affecting rider safety', 'shield'],
    ['spam', 'Spam or scam', 'Advertising, scams or repeated unwanted messages', 'info'],
    ['other', 'Something else', 'Anything else that breaks the Community Guidelines', 'info'],
  ];

  /** Report flow shared by every place another rider appears (friend
   * profile, chat, ride roster, friend requests, Nearby Voice). */
  function openRiderReportSheet(person, source) {
    presentSheet('Report rider', `<article class="friend-more-card">
        <span class="friend-more-avatar">${avatar(person)}</span>
        <span><strong>${escapeHtml(person.displayName)}</strong><small>${escapeHtml(person.handle || '')}</small></span>
      </article>
      <p class="friend-more-intro">Choose the reason that best describes the issue. Our team reviews reports within 24 hours.</p>
      <div class="friend-more-menu" aria-label="Report reason">
        ${REPORT_REASONS.map(([reason, title, detail, glyph]) => `<button data-report-rider="${reason}"><span class="friend-more-icon">${icon(glyph)}</span><span><strong>${title}</strong><small>${detail}</small></span>${icon('chevron')}</button>`).join('')}
      </div>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $$('[data-report-rider]', $('#sheetBody')).forEach((button) => {
        button.addEventListener('click', () => void reportRider(person, button.dataset.reportRider, source));
      });
    });
  }

  /** Report and block for a rider who isn't (necessarily) a friend. */
  function openRiderSafetyMenu(person, source, onBlocked) {
    presentSheet(person.displayName || 'Rider', `<div class="friend-more-menu" aria-label="Safety actions">
        <button id="riderReportBtn"><span class="friend-more-icon">${icon('shield')}</span><span><strong>Report rider</strong><small>Harassment, explicit content, unsafe behaviour or spam</small></span>${icon('chevron')}</button>
        <button class="danger" id="riderBlockBtn"><span class="friend-more-icon">${icon('close')}</span><span><strong>Block rider</strong><small>You won’t see or hear each other in Nearby, and they can’t contact you</small></span>${icon('chevron')}</button>
      </div>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $('#riderReportBtn').addEventListener('click', () => openRiderReportSheet(person, source));
      $('#riderBlockBtn').addEventListener('click', () => void blockRider(person, onBlocked, '#riderBlockBtn'));
    });
  }

  function openFriendReportActions(friend) {
    openRiderReportSheet(friend, 'the PWA friend profile');
  }

  function openFriendSafetyActions(friend) {
    presentSheet('More actions', `<article class="friend-more-card">
        <span class="friend-more-avatar">${avatar(friend)}</span>
        <span><strong>${escapeHtml(friend.displayName)}</strong><small>${escapeHtml(friend.handle)}</small></span>
      </article>
      <div class="friend-more-menu" aria-label="Connection actions">
        <button id="shareFriendIdMore"><span class="friend-more-icon">${icon('share')}</span><span><strong>Share Rider ID</strong><small>Send or copy this rider’s ID</small></span>${icon('chevron')}</button>
        <button id="removeFriendBtn"><span class="friend-more-icon">${icon('friends')}</span><span><strong>Remove friend</strong><small>End this Rider Comms connection</small></span>${icon('chevron')}</button>
      </div>
      <span class="friend-more-section-label">Safety</span>
      <div class="friend-more-menu" aria-label="Safety actions">
        <button id="reportFriendBtn"><span class="friend-more-icon">${icon('shield')}</span><span><strong>Report rider</strong><small>Harassment, unsafe behaviour or spam</small></span>${icon('chevron')}</button>
        <button class="danger" id="blockFriendBtn"><span class="friend-more-icon">${icon('close')}</span><span><strong>Block rider</strong><small>Remove this connection and prevent further contact</small></span>${icon('chevron')}</button>
      </div>
      <p id="friendSafetyError" class="inline-error" role="alert" hidden></p>`, () => {
      $('#shareFriendIdMore').addEventListener('click', async () => {
        const message = `${friend.displayName} on Rider Comms: ${friend.riderId}`;
        if (navigator.share) {
          try { await navigator.share({ text: message }); return; }
          catch (error) { if (error?.name === 'AbortError') return; }
        }
        try { await navigator.clipboard.writeText(friend.riderId); showToast('Rider ID copied.'); }
        catch { showToast(friend.riderId); }
      });
      $('#removeFriendBtn').addEventListener('click', () => void removeFriend(friend));
      $('#reportFriendBtn').addEventListener('click', () => openFriendReportActions(friend));
      $('#blockFriendBtn').addEventListener('click', () => void blockFriend(friend));
    });
  }

  async function removeFriend(friend) {
    if (!window.confirm(`Remove ${friend.displayName} from your friends list?`)) return;
    const button = $('#removeFriendBtn');
    const error = $('#friendSafetyError');
    button.disabled = true;
    error.hidden = true;
    try {
      await apiFetch(
        'DELETE',
        `/riders/${encodeURIComponent(state.profile.riderId)}/friends/${encodeURIComponent(friend.riderId)}`,
      );
      state.friends = state.friends.filter((candidate) => candidate.riderId !== friend.riderId);
      state.requests = state.requests.filter((request) => request.riderId !== friend.riderId);
      outgoingFriendRequests = outgoingFriendRequests.filter((request) => request.riderId !== friend.riderId);
      conversationSummaries.delete(friend.riderId);
      persist();
      renderFriends();
      if (activeChat?.riderId === friend.riderId) closeChat({ restoreFocus: false });
      closeSheet();
      showToast(`${friend.displayName} removed from friends.`);
      void Promise.all([refreshFriendNetwork(), refreshMessageSummaries()]).catch(() => {});
    } catch {
      button.disabled = false;
      error.textContent = 'Could not remove that friend. Check your connection and try again.';
      error.hidden = false;
    }
  }

  async function reportRider(person, reason, source) {
    const error = $('#friendSafetyError');
    error.hidden = true;
    $$('[data-report-rider]', $('#sheetBody')).forEach((button) => { button.disabled = true; });
    try {
      await apiFetch('POST', '/reports', {
        riderId: person.riderId,
        reason,
        details: `Reported from ${source}`,
      });
      closeSheet();
      showToast('Report received. Thank you.');
    } catch {
      error.textContent = 'Could not send that report. Check your connection and try again.';
      error.hidden = false;
      $$('[data-report-rider]', $('#sheetBody')).forEach((button) => { button.disabled = false; });
    }
  }

  /** Blocks anyone (friend or not) and drops them from every local list. */
  async function blockRider(person, onBlocked, buttonSelector = '#blockFriendBtn') {
    if (!window.confirm(`Block ${person.displayName}? You won’t see or hear each other in Nearby, and they can’t message you or send friend requests. You can unblock them in Settings.`)) return;
    const button = $(buttonSelector);
    const error = $('#friendSafetyError');
    if (button) button.disabled = true;
    if (error) error.hidden = true;
    try {
      await apiFetch('POST', '/blocks', { riderId: person.riderId });
      state.friends = state.friends.filter((candidate) => candidate.riderId !== person.riderId);
      state.requests = state.requests.filter((request) => request.riderId !== person.riderId);
      nearbyRiders = nearbyRiders.filter((candidate) => candidate.riderId !== person.riderId);
      if (state.selectedRiderId === person.riderId) state.selectedRiderId = null;
      persist();
      renderFriends();
      renderMapRiders();
      if (activeChat?.riderId === person.riderId) closeChat({ restoreFocus: false });
      closeSheet();
      onBlocked?.();
      showToast(`${person.displayName} blocked.`);
    } catch {
      if (button) button.disabled = false;
      if (error) {
        error.textContent = 'Could not block that rider. Check your connection and try again.';
        error.hidden = false;
      }
    }
  }

  function blockFriend(friend) {
    return blockRider(friend);
  }

  const SOCIAL_EVENT_RETRY_MS = 2000;

