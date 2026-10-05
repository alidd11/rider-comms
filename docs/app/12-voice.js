// Part of docs/app.js. 12 of 20: Voice: microphone, LiveKit rooms, VOX and speakers. Edit here, then run `npm run build:pwa-app`.
  function microphoneAccessMessage(error) {
    if (!navigator.mediaDevices?.getUserMedia) return 'Microphone access is not supported by this browser.';
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Microphone access is blocked. Allow it in this site’s device settings.';
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'No microphone is available on this device.';
    }
    return 'Microphone access is unavailable right now.';
  }

  function shouldRetryVoiceConnection(error) {
    // Permission/security/no-device failures need rider or device intervention.
    // Retrying them from a timer can also lose the browser user gesture needed
    // to prompt again, so keep the automatic loop for genuinely transient work.
    if (['NotAllowedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) {
      return false;
    }
    if (!(error instanceof ApiError)) return true;
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }

  /** Ask while the rider is still inside the original Create, Join or Go
   * live tap. Waiting for API calls first loses the browser's user-gesture
   * allowance and can suppress the installed-PWA permission prompt. */
  async function preflightMicrophoneAccess() {
    if (microphonePermissionReady) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast(microphoneAccessMessage());
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphonePermissionReady = true;
      return true;
    } catch (error) {
      showToast(microphoneAccessMessage(error));
      return false;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  function voiceMeterContextNeedsResume() {
    const state = voiceAudioContext?.state;
    // Real Web Audio implementations expose a string AudioContextState.
    // Treat a missing state as "not observable" rather than "suspended" so
    // older/minimal webviews and deterministic test doubles are not falsely
    // pushed into the recovery UI.
    return typeof state === 'string' && state !== 'running';
  }

  async function resumeVoiceMeterContext() {
    const context = voiceAudioContext;
    if (!context || !voiceMeterContextNeedsResume()) return true;
    if (context.state === 'closed' || typeof context.resume !== 'function') return false;
    try {
      await context.resume();
    } catch {
      return false;
    }
    return context === voiceAudioContext && context.state === 'running';
  }

  async function resumePreviouslyAllowedVoice() {
    if (!state.activeRide && !state.publicLive) return;

    // Safari can preserve the LiveKit room while suspending the Web Audio
    // context that drives VOX after an app switch, lock-screen interruption
    // or other media takeover. A connected room with a suspended analyser is
    // not healthy voice: fail closed and try to resume the existing context
    // before treating the session as ready again.
    if (voiceMeterContextNeedsResume()) {
      const resumed = await resumeVoiceMeterContext();
      if (!resumed) {
        voiceFailureNotified = true;
        renderVoiceStatus();
        return;
      }
      voiceFailureNotified = false;
    }

    try {
      const permission = await navigator.permissions?.query({ name: 'microphone' });
      if (permission?.state === 'granted') {
        microphonePermissionReady = true;
        syncVoiceConnection();
      }
    } catch { /* Unsupported Permissions API: wait for a direct rider tap. */ }
    renderVoiceStatus();
  }

  function loadLiveKitClient() {
    if (window.LivekitClient) return Promise.resolve();
    if (liveKitLoadPromise) return liveKitLoadPromise;
    liveKitLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      // Pinned to the exact version this app's backend token-minting was
      // built and tested against (see backend/src/liveKitToken.ts) — lazy
      // loaded, like Google Maps above, so riders who never go live don't
      // pay for it.
      script.src = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js';
      // Subresource integrity: the browser refuses the file if the CDN ever
      // serves anything but this exact build (hash of the npm 2.22.3 bundle).
      script.integrity = 'sha384-G/xxtkVytOx/ia9Q8MXxM+V0ohsaY1fZAgVP3iSGTPz4wJ0s3+ulJNKXh/gnzEDZ';
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { liveKitLoadPromise = undefined; reject(new Error('voice_library_unavailable')); };
      document.head.appendChild(script);
    });
    return liveKitLoadPromise;
  }

  function currentVoiceTarget() {
    return state.activeRide ? `ride:${state.activeRide.rideId}` : state.publicLive ? 'channel' : undefined;
  }

  function cleanupRemoteVoiceAudio(room) {
    const elements = remoteVoiceElements.get(room);
    if (elements) {
      for (const element of elements) element.remove();
      elements.clear();
      remoteVoiceElements.delete(room);
    }
    voiceRemoteSpeakersByRoom.delete(room);
    renderVoiceStatus();
  }

  function disconnectManagedVoiceRoom(room) {
    if (!room) return;
    intentionalVoiceDisconnects.add(room);
    cleanupRemoteVoiceAudio(room);
    void room.disconnect().catch(() => {});
  }

  function scheduleVoiceReconnect(targetKey) {
    if (!targetKey || voiceReconnectTimer || !microphonePermissionReady) return;
    voiceReconnectTimer = setTimeout(() => {
      voiceReconnectTimer = undefined;
      if (currentVoiceTarget() !== targetKey) return;
      syncVoiceConnection();
    }, 2000);
  }

  function clearPublicVoiceRefresh() {
    if (publicVoiceRefreshTimer) {
      clearTimeout(publicVoiceRefreshTimer);
      publicVoiceRefreshTimer = undefined;
    }
  }

  function schedulePublicVoiceRefresh(refreshAfterMs) {
    clearPublicVoiceRefresh();
    const delayMs = typeof refreshAfterMs === 'number' && Number.isFinite(refreshAfterMs) && refreshAfterMs > 0
      ? Math.max(1_000, refreshAfterMs)
      : 20_000;
    publicVoiceRefreshTimer = setTimeout(() => {
      publicVoiceRefreshTimer = undefined;
      // Background public voice must not renew without fresh visible-session
      // presence; foregrounding resumes presence before voice authorization.
      if (currentVoiceTarget() !== 'channel' || document.visibilityState !== 'visible') return;
      syncVoiceConnection();
    }, delayMs);
  }

  /** Re-fetch the public pair roster now, so a mute, unmute or block takes
   * effect without waiting for the next scheduled refresh. */
  function requestPublicVoiceRefresh() {
    if (currentVoiceTarget() !== 'channel' || document.visibilityState !== 'visible') return;
    syncVoiceConnection();
  }

  function clearPublicVoiceAuthorizationLease() {
    if (publicVoiceAuthorizationLeaseTimer) {
      clearTimeout(publicVoiceAuthorizationLeaseTimer);
      publicVoiceAuthorizationLeaseTimer = undefined;
    }
  }

  function expirePublicVoiceAuthorizationLease() {
    publicVoiceAuthorizationLeaseTimer = undefined;
    clearPublicVoiceRefresh();
    if (currentVoiceTarget() !== 'channel') return;

    // A LiveKit participant is not ejected merely because its join token has
    // expired. If the app can no longer re-confirm mutual proximity/block
    // authorization within the server-provided lease, stop transmitting first
    // and tear every public pair room down. Nearby stays armed and retries.
    setVoiceSpeaking(false);
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    if (!voiceRoom) stopVoiceLevelLoop();
    publicVoiceAuthorizationExpired = true;
    voiceFailureNotified = false;
    renderVoiceStatus();
    scheduleVoiceReconnect('channel');
  }

  function renewPublicVoiceAuthorizationLease(leaseMs) {
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    const duration = typeof leaseMs === 'number' && Number.isFinite(leaseMs) && leaseMs > 0
      ? leaseMs
      : DEFAULT_PUBLIC_VOICE_AUTHORIZATION_LEASE_MS;
    publicVoiceAuthorizationLeaseTimer = setTimeout(expirePublicVoiceAuthorizationLease, duration);
  }

  function activeRemoteVoiceSpeakerIds() {
    const ids = new Set();
    for (const speakers of voiceRemoteSpeakersByRoom.values()) {
      for (const riderId of speakers) {
        if (riderId && riderId !== state.profile?.riderId) ids.add(riderId);
      }
    }
    return [...ids];
  }

  function voiceSpeakerProfile(riderId) {
    return voiceSpeakerProfiles.get(riderId)
      || nearbyRiders.find((person) => person.riderId === riderId)
      || state.activeRide?.members?.find((person) => person.riderId === riderId)
      || state.friends.find((person) => person.riderId === riderId);
  }

  function voiceSpeakerSummary() {
    const ids = activeRemoteVoiceSpeakerIds();
    if (!ids.length) return '';
    const names = ids.map((riderId) => voiceSpeakerProfile(riderId)?.displayName || 'Nearby rider');
    return names.length === 1 ? `${names[0]} speaking` : `${names[0]} + ${names.length - 1} speaking`;
  }

  function ensureVoiceSpeakerProfiles(riderIds) {
    for (const riderId of riderIds) {
      if (!riderId || voiceSpeakerProfiles.has(riderId) || voiceSpeakerProfileLoads.has(riderId)) continue;
      voiceSpeakerProfileLoads.add(riderId);
      void apiFetch('GET', `/profiles/${encodeURIComponent(riderId)}`)
        .then((profile) => { voiceSpeakerProfiles.set(riderId, profile); })
        .catch(() => {})
        .finally(() => {
          voiceSpeakerProfileLoads.delete(riderId);
          renderVoiceStatus();
        });
    }
  }

  function renderMapVoiceSpeakerChip(summary) {
    let chip = $('#voiceSpeakerChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'voiceSpeakerChip';
      chip.className = 'status-chip';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      Object.assign(chip.style, {
        position: 'absolute',
        zIndex: '9',
        top: 'calc(var(--safe-top) + 66px)',
        right: 'max(16px,var(--safe-right))',
        maxWidth: 'min(70vw,260px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      });
      $('#mapCanvas')?.appendChild(chip);
    }
    const visible = Boolean(summary && state.publicLive && !state.activeRide);
    chip.hidden = !visible;
    if (visible) {
      chip.textContent = summary;
      chip.setAttribute('aria-label', summary);
    }
  }

  async function rememberVoicePeers(peerIds) {
    const unknown = peerIds.filter((peerId) => !recentVoicePeers.has(peerId));
    if (unknown.length) {
      for (const person of await resolveRiderProfiles(unknown)) recentVoicePeers.set(person.riderId, person);
    }
    for (const peerId of peerIds) {
      const person = recentVoicePeers.get(peerId);
      if (!person) continue;
      recentVoicePeers.delete(peerId);
      recentVoicePeers.set(peerId, person);
    }
    while (recentVoicePeers.size > MAX_RECENT_VOICE_PEERS) recentVoicePeers.delete(recentVoicePeers.keys().next().value);
    renderVoicePeopleButton();
  }

  /** "Riders on voice" button: opens mute / report / block for each rider
   * heard on Nearby Voice this session (App Store guideline 1.2 parity). */
  function renderVoicePeopleButton() {
    let button = $('#voicePeopleBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'voicePeopleBtn';
      button.type = 'button';
      button.className = 'voice-people-btn glass';
      button.addEventListener('click', openVoicePeopleSheet);
      $('#mapCanvas')?.appendChild(button);
    }
    const locked = window.RiderMovementSafety?.isLockedForSafety?.(movementState);
    const visible = state.publicLive && !state.activeRide && recentVoicePeers.size > 0 && !locked;
    button.hidden = !visible;
    if (visible) {
      button.innerHTML = `${icon('friends')}<span>${recentVoicePeers.size}</span>`;
      button.setAttribute('aria-label', `Riders on Nearby Voice: ${recentVoicePeers.size}. Mute, report or block.`);
    }
  }

  function openVoicePeopleSheet() {
    const rows = [...recentVoicePeers.values()].reverse().map((person) => {
      const muted = mutedVoicePeers.has(person.riderId);
      const status = muted ? 'Muted' : proximityVoiceRooms.has(person.riderId) ? 'On voice' : 'Out of range';
      const id = escapeHtml(person.riderId);
      return `<article class="voice-peer-row"><span class="identity"><strong>${escapeHtml(person.displayName)}</strong><small>${status}</small></span>
        <button type="button" data-voice-mute="${id}" aria-label="${muted ? 'Unmute' : 'Mute'} ${escapeHtml(person.displayName)}">${muted ? 'Unmute' : 'Mute'}</button>
        <button type="button" data-voice-report="${id}" aria-label="Report ${escapeHtml(person.displayName)}">Report</button>
        <button type="button" class="danger" data-voice-block="${id}" aria-label="Block ${escapeHtml(person.displayName)}">Block</button></article>`;
    }).join('');
    presentSheet('Riders on Nearby Voice', `<p class="caption">Muting stops you hearing each other for this session. Blocking also hides you from each other in Nearby.</p><div class="voice-peer-list">${rows}</div>`, () => {
      const body = $('#sheetBody');
      $$('[data-voice-mute]', body).forEach((button) => button.addEventListener('click', () => {
        const peerId = button.dataset.voiceMute;
        if (mutedVoicePeers.has(peerId)) mutedVoicePeers.delete(peerId);
        else {
          mutedVoicePeers.add(peerId);
          const room = proximityVoiceRooms.get(peerId);
          if (room) { disconnectManagedVoiceRoom(room); proximityVoiceRooms.delete(peerId); }
        }
        requestPublicVoiceRefresh();
        openVoicePeopleSheet();
      }));
      $$('[data-voice-report]', body).forEach((button) => button.addEventListener('click', () => {
        const person = recentVoicePeers.get(button.dataset.voiceReport);
        if (person) openRiderReportSheet(person, 'Nearby Voice');
      }));
      $$('[data-voice-block]', body).forEach((button) => button.addEventListener('click', () => {
        const person = recentVoicePeers.get(button.dataset.voiceBlock);
        if (!person) return;
        void blockRider(person, () => {
          mutedVoicePeers.add(person.riderId);
          const room = proximityVoiceRooms.get(person.riderId);
          if (room) { disconnectManagedVoiceRoom(room); proximityVoiceRooms.delete(person.riderId); }
          requestPublicVoiceRefresh();
        }, `[data-voice-block="${CSS.escape(person.riderId)}"]`);
      }));
    });
  }

  function wireVoiceRoomLifecycle(room, targetKey, peerId) {
    const events = window.LivekitClient?.RoomEvent;
    const Track = window.LivekitClient?.Track;
    if (!events?.Disconnected) return;

    const audioElements = new Set();
    remoteVoiceElements.set(room, audioElements);

    // The raw LiveKit JS Room API auto-subscribes, but it does NOT render
    // browser audio for us. Attach every subscribed remote audio track to an
    // actual <audio> element or a perfectly healthy room is still silent.
    if (events.TrackSubscribed) {
      room.on(events.TrackSubscribed, (track) => {
        if (Track?.Kind?.Audio && track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.style.display = 'none';
        element.dataset.riderCommsVoice = 'true';
        document.body.appendChild(element);
        audioElements.add(element);
        // iOS/Safari may still require its audio context to be resumed. The
        // direct Go Live flow has already performed getUserMedia from the
        // rider's tap, so this succeeds in the normal test path; failures are
        // harmless and a later room reconnect can retry.
        void room.startAudio?.().catch(() => {});
      });
    }

    if (events.TrackUnsubscribed) {
      room.on(events.TrackUnsubscribed, (track) => {
        for (const element of track.detach()) {
          audioElements.delete(element);
          element.remove();
        }
      });
    }

    if (events.ActiveSpeakersChanged) {
      room.on(events.ActiveSpeakersChanged, (speakers) => {
        const remoteIds = speakers
          .map((participant) => participant.identity)
          .filter((identity) => identity && identity !== state.profile?.riderId);
        voiceRemoteSpeakersByRoom.set(room, new Set(remoteIds));
        ensureVoiceSpeakerProfiles(remoteIds);
        renderVoiceStatus();
      });
    }

    room.on(events.Reconnected, () => {
      voiceFailureNotified = false;
      void room.startAudio?.().catch(() => {});
      renderVoiceStatus();
    });
    room.on(events.Disconnected, () => {
      cleanupRemoteVoiceAudio(room);
      if (intentionalVoiceDisconnects.has(room)) return;

      if (peerId) {
        if (proximityVoiceRooms.get(peerId) === room) proximityVoiceRooms.delete(peerId);
      } else if (voiceRoom === room) {
        voiceRoom = undefined;
        if (voiceTargetKey === targetKey) voiceTargetKey = undefined;
      }

      if (!voiceRoom && !proximityVoiceRooms.size) stopVoiceLevelLoop();
      renderVoiceStatus();
      scheduleVoiceReconnect(targetKey);
    });
  }

  /**
   * The rider's own avatar in the map header glows while they're actually
   * transmitting — same idea as a Discord/FaceTime speaking ring, and a
   * more legible "who's live" signal than a separate icon button off to
   * the side. A small badge on the avatar's corner (not the avatar itself,
   * so tapping the avatar still opens the profile sheet) is the only
   * manual override control, shown only once actually connected.
   */
  function renderVoiceStatus() {
    const avatar = $('#mapAvatarButton');
    const badge = $('#voiceStatusBtn');
    const connected = Boolean(voiceRoom || proximityVoiceRooms.size);
    const wantsVoice = Boolean(state.activeRide || state.publicLive);
    const meterNeedsResume = connected && voiceMeterContextNeedsResume();
    const needsResume = wantsVoice && (
      (!connected && (!microphonePermissionReady || voiceFailureNotified))
      || meterNeedsResume
    );
    // Public Nearby intentionally releases microphone capture when there are
    // no authorised proximity peers. Keep the feature visibly "armed" instead
    // of making that privacy/battery optimisation look like voice crashed.
    const publicAuthorizationExpired = state.publicLive
      && !state.activeRide
      && publicVoiceAuthorizationExpired;
    const waitingForPublicPeer = state.publicLive
      && !state.activeRide
      && !connected
      && microphonePermissionReady
      && !voiceFailureNotified
      && !publicAuthorizationExpired;
    const resumeLocked = needsResume && window.RiderMovementSafety.isLockedForSafety(movementState);
    const remoteSpeakerSummary = connected ? voiceSpeakerSummary() : '';
    renderMapVoiceSpeakerChip(remoteSpeakerSummary);
    renderVoicePeopleButton();
    avatar.classList.toggle('voice-talking', connected && voiceIsSpeaking);
    avatar.classList.toggle('voice-muted', connected && voiceManuallyMuted);
    badge.hidden = !connected && !needsResume && !waitingForPublicPeer && !publicAuthorizationExpired;
    badge.toggleAttribute('inert', resumeLocked);
    badge.setAttribute('aria-disabled', String(resumeLocked));
    badge.classList.toggle('talking', voiceIsSpeaking);
    badge.classList.toggle('muted', voiceManuallyMuted);
    badge.classList.toggle('waiting', waitingForPublicPeer);
    const label = voiceManuallyMuted ? 'Muted — tap to unmute' : voiceIsSpeaking ? 'Talking' : 'Listening — hands-free';
    badge.setAttribute(
      'aria-label',
      publicAuthorizationExpired
        ? 'Nearby Voice · reconnecting'
        : needsResume
          ? 'Resume voice'
          : waitingForPublicPeer
            ? 'Nearby Voice · waiting for riders'
            : voiceManuallyMuted
            ? 'Proximity voice muted — tap to unmute'
            : voiceIsSpeaking
              ? 'Talking'
              : 'Listening — hands-free',
    );
    // The Ride tab has no map header of its own (the glowing avatar above
    // only exists on the Map screen), so a rider parked on Ride while
    // talking needs this same status somewhere too — same real state,
    // same toggleVoiceMute control, just a text chip instead of a glow.
    const rideChip = $('#rideVoiceStatus');
    if (rideChip) {
      rideChip.hidden = !connected && !needsResume;
      rideChip.toggleAttribute('inert', resumeLocked);
      rideChip.setAttribute('aria-disabled', String(resumeLocked));
      rideChip.classList.toggle('talking', voiceIsSpeaking);
      rideChip.classList.toggle('muted', voiceManuallyMuted);
      const rideChipText = $('#rideVoiceStatusText', rideChip);
      const rideLabel = needsResume ? 'Resume voice' : remoteSpeakerSummary || label;
      if (rideChipText) rideChipText.textContent = rideLabel;
      rideChip.setAttribute('aria-label', rideLabel);
    }

    // The global ride pill remains visible across Map/Friends/Settings, so it
    // must carry the same speaker identity as native's persistent RideBar.
    const ridePill = $('#ridePill');
    const ridePillLabel = ridePill ? $('small', ridePill) : null;
    const ridePillVoiceLabel = state.activeRide
      ? remoteSpeakerSummary || (voiceIsSpeaking ? 'You speaking' : 'Active ride')
      : 'Active ride';
    if (ridePillLabel) {
      ridePillLabel.textContent = ridePillVoiceLabel;
      ridePillLabel.style.color = ridePillVoiceLabel === 'Active ride' ? '' : 'var(--accent)';
    }
    if (ridePill) {
      ridePill.setAttribute(
        'aria-label',
        state.activeRide && ridePillVoiceLabel !== 'Active ride'
          ? `Active ride · ${ridePillVoiceLabel}`
          : 'Open active ride',
      );
    }
  }

  function setVoiceSpeaking(speaking) {
    if (voiceIsSpeaking === speaking) return;
    voiceIsSpeaking = speaking;
    void voiceRoom?.localParticipant.setMicrophoneEnabled(speaking).catch(() => {});
    for (const room of proximityVoiceRooms.values()) {
      void room.localParticipant.setMicrophoneEnabled(speaking).catch(() => {});
    }
    renderVoiceStatus();
  }

  function handleVoiceVolume(rms) {
    voiceLatestRms = rms;
    if (voiceManuallyMuted) {
      if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
      if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
      setVoiceSpeaking(false);
      return;
    }

    if (voiceIsSpeaking) {
      if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
      if (rms > VOICE_SPEAKING_RELEASE_THRESHOLD) {
        if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
      } else if (!voiceReleaseTimer) {
        voiceReleaseTimer = setTimeout(() => {
          voiceReleaseTimer = undefined;
          setVoiceSpeaking(false);
        }, VOICE_RELEASE_HANGTIME_MS);
      }
      return;
    }

    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    if (rms >= VOICE_SPEAKING_ATTACK_THRESHOLD) {
      if (!voiceAttackTimer) {
        voiceAttackTimer = setTimeout(() => {
          voiceAttackTimer = undefined;
          if (!voiceManuallyMuted && voiceLatestRms >= VOICE_SPEAKING_ATTACK_THRESHOLD) setVoiceSpeaking(true);
        }, VOICE_ATTACK_HOLD_MS);
      }
    } else if (voiceAttackTimer) {
      clearTimeout(voiceAttackTimer);
      voiceAttackTimer = undefined;
    }
  }

  /**
   * Opens a SECOND, independent getUserMedia stream purely to measure
   * real speech volume — deliberately not the same MediaStreamTrack
   * LiveKit publishes and mutes. livekit-client's LocalTrack.mute() sets
   * `this._mediaStreamTrack.enabled = !muted` on the track it owns (see
   * node_modules/livekit-client's LocalTrack class) — and a browser zeros
   * out a MediaStreamTrack's samples for every consumer, Web Audio
   * included, the instant `.enabled` goes false. Analysing that published
   * track directly meant the very first time VOX muted it after an
   * utterance, the meter went silent forever and could never detect
   * speech again to unmute — exactly the "doesn't pick up my speech"
   * failure this replaces. A second stream from the same physical mic is
   * a completely separate MediaStreamTrack with its own `enabled` flag,
   * so muting LiveKit's copy never touches this one — same independence
   * mobile's native volume analyzer has from the RTC mute flag, just a
   * second real capture instead of a native module bypassing it.
   */
  async function startVoiceLevelLoop() {
    voiceMeterStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new (window.AudioContext || window.webkitAudioContext)();
    voiceAudioContext = context;
    // WebKit may suspend Web Audio independently of the underlying microphone
    // capture/LiveKit room. Never leave a previously-open transmitter latched
    // on when that happens: close VOX immediately, then the foreground/tap
    // recovery paths below can resume the analyser safely.
    context.onstatechange = () => {
      if (voiceAudioContext !== context) return;
      if (context.state !== 'running') setVoiceSpeaking(false);
      renderVoiceStatus();
    };
    const source = context.createMediaStreamSource(voiceMeterStream);
    voiceAnalyser = context.createAnalyser();
    voiceAnalyser.fftSize = 512;
    source.connect(voiceAnalyser);
    if (context.state !== 'running' && context.state !== 'closed') {
      void context.resume().catch(() => {});
    }
    const data = new Uint8Array(voiceAnalyser.frequencyBinCount);
    const tick = () => {
      if (!voiceAnalyser) return;
      voiceAnalyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSquares += v * v; }
      handleVoiceVolume(Math.sqrt(sumSquares / data.length));
      voiceLevelFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Mints a real voice token for either the public presence channel
   * (POST /voice/token {target:'channel'} — the room is derived from the
   * rider's own last-known presence, see server.ts, never a client-
   * supplied one) or a private ride ({target:'ride', rideId} — the same
   * ride-voice endpoint the mobile app's RideBar.tsx already uses, see
   * backend/src/liveKitToken.ts) and connects for real. Best-effort in
   * both cases: a rider should still be visible nearby / still be in the
   * ride even if voice fails to connect (no LiveKit configured, mic
   * permission denied, etc.), so failures here are logged, not surfaced
   * as a blocking error over the action that triggered this. */
  async function connectVoice(kind, rideId) {
    if (kind === 'ride' && voiceRoom) return;
    if (kind === 'channel' && publicVoiceConnectInFlight) {
      publicVoiceRefreshPending = true;
      return;
    }
    if (kind === 'channel') publicVoiceConnectInFlight = true;
    const requestedTarget = kind === 'ride' ? `ride:${rideId}` : 'channel';
    let room;
    try {
      await loadLiveKitClient();
      if (currentVoiceTarget() !== requestedTarget) return;

      const body = kind === 'ride' ? { target: 'ride', rideId } : { target: 'channel' };
      const response = await apiFetch('POST', '/voice/token', body);
      // Token minting and room connection are asynchronous. Nearby may be
      // switched off (or a private ride may replace it) while either request
      // is in flight. Never let stale work resurrect an audio room afterward.
      if (currentVoiceTarget() !== requestedTarget) return;

      if (kind === 'channel') {
        renewPublicVoiceAuthorizationLease(response.authorizationLeaseMs);
        schedulePublicVoiceRefresh(response.refreshAfterMs);
        const enteringChannel = voiceTargetKey !== 'channel';
        const desiredPeers = new Set(response.connections.map((connection) => connection.peerId).filter((peerId) => !mutedVoicePeers.has(peerId)));
        void rememberVoicePeers(response.connections.map((connection) => connection.peerId));
        for (const [peerId, existingRoom] of proximityVoiceRooms) {
          if (desiredPeers.has(peerId)) continue;
          disconnectManagedVoiceRoom(existingRoom);
          proximityVoiceRooms.delete(peerId);
        }
        let lastPairError;
        for (const connection of response.connections) {
          if (currentVoiceTarget() !== requestedTarget) return;
          if (proximityVoiceRooms.has(connection.peerId) || mutedVoicePeers.has(connection.peerId)) continue;
          const pairRoom = new window.LivekitClient.Room();
          wireVoiceRoomLifecycle(pairRoom, requestedTarget, connection.peerId);
          try {
            await pairRoom.connect(connection.url, connection.token);
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            await pairRoom.startAudio?.().catch(() => {});
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            await pairRoom.localParticipant.setMicrophoneEnabled(voiceIsSpeaking && !voiceManuallyMuted);
            if (currentVoiceTarget() !== requestedTarget) {
              disconnectManagedVoiceRoom(pairRoom);
              return;
            }
            proximityVoiceRooms.set(connection.peerId, pairRoom);
          } catch (error) {
            lastPairError = error;
            disconnectManagedVoiceRoom(pairRoom);
            console.warn('[rider-comms] Could not connect proximity peer', connection.peerId, error);
          }
        }
        if (currentVoiceTarget() !== requestedTarget) return;
        if (response.connections.length > 0 && proximityVoiceRooms.size === 0 && lastPairError) throw lastPairError;
        voiceTargetKey = requestedTarget;
        if (enteringChannel) voiceManuallyMuted = false;
      } else {
        room = new window.LivekitClient.Room();
        wireVoiceRoomLifecycle(room, requestedTarget);
        await room.connect(response.url, response.token);
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        await room.startAudio?.().catch(() => {});
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(false);
        if (currentVoiceTarget() !== requestedTarget) {
          disconnectManagedVoiceRoom(room);
          return;
        }
        voiceRoom = room;
        voiceTargetKey = requestedTarget;
        voiceManuallyMuted = false;
      }

      microphonePermissionReady = true;
      if ((voiceRoom || proximityVoiceRooms.size) && !voiceMeterStream) await startVoiceLevelLoop();
      if (currentVoiceTarget() !== requestedTarget) {
        if (kind === 'channel') disconnectPublicVoice();
        else if (room) disconnectManagedVoiceRoom(room);
        return;
      }
      if (!voiceRoom && !proximityVoiceRooms.size && voiceMeterStream) stopVoiceLevelLoop();
      voiceFailureNotified = false;
      renderVoiceStatus();
    } catch (error) {
      // A state change while connecting is an intentional cancellation rather
      // than a voice error; do not flash an unavailable warning after "off".
      if (currentVoiceTarget() !== requestedTarget) {
        if (room) disconnectManagedVoiceRoom(room);
        return;
      }
      console.warn('[rider-comms] Could not connect voice chat', error);
      const leasedPublicConnection = kind === 'channel'
        && proximityVoiceRooms.size > 0
        && !publicVoiceAuthorizationExpired;
      if (!leasedPublicConnection && !voiceFailureNotified) {
        const code = error instanceof ApiError ? error.body?.error : undefined;
        showToast(code === 'email_verification_required'
          ? 'Verify your email before using voice chat.'
          : error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
            ? microphoneAccessMessage(error)
            : 'Voice chat is unavailable right now. Your ride and map still work.');
        voiceFailureNotified = true;
      }
      if (room) disconnectManagedVoiceRoom(room);
      if (kind === 'ride') {
        voiceRoom = undefined;
        voiceTargetKey = undefined;
      }
      if (shouldRetryVoiceConnection(error)) scheduleVoiceReconnect(requestedTarget);
      renderVoiceStatus();
    } finally {
      if (kind === 'channel') {
        publicVoiceConnectInFlight = false;
        if (publicVoiceRefreshPending) {
          publicVoiceRefreshPending = false;
          if (currentVoiceTarget() === 'channel') queueMicrotask(() => syncVoiceConnection());
        }
      }
    }
  }

  function stopVoiceLevelLoop() {
    if (voiceLevelFrame) { cancelAnimationFrame(voiceLevelFrame); voiceLevelFrame = undefined; }
    if (voiceAttackTimer) { clearTimeout(voiceAttackTimer); voiceAttackTimer = undefined; }
    if (voiceReleaseTimer) { clearTimeout(voiceReleaseTimer); voiceReleaseTimer = undefined; }
    voiceLatestRms = 0;
    voiceAnalyser = undefined;
    const context = voiceAudioContext;
    voiceAudioContext = undefined;
    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => {});
    }
    if (voiceMeterStream) { voiceMeterStream.getTracks().forEach((track) => track.stop()); voiceMeterStream = undefined; }
    voiceIsSpeaking = false;
  }

  function disconnectVoice() {
    clearPublicVoiceRefresh();
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    publicVoiceRefreshPending = false;
    stopVoiceLevelLoop();
    if (voiceReconnectTimer) { clearTimeout(voiceReconnectTimer); voiceReconnectTimer = undefined; }
    if (voiceRoom) { disconnectManagedVoiceRoom(voiceRoom); voiceRoom = undefined; }
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    voiceRemoteSpeakersByRoom.clear();
    voiceTargetKey = undefined;
    renderVoiceStatus();
  }

  function disconnectPublicVoice() {
    clearPublicVoiceRefresh();
    clearPublicVoiceAuthorizationLease();
    publicVoiceAuthorizationExpired = false;
    publicVoiceRefreshPending = false;
    // disconnectManagedVoiceRoom() removes each public room's remote-audio
    // elements and active-speaker entry. Do not clear the process-wide speaker
    // map here: a private ride may be using it at the same time from Settings.
    for (const room of proximityVoiceRooms.values()) disconnectManagedVoiceRoom(room);
    proximityVoiceRooms.clear();
    if (voiceTargetKey === 'channel') {
      voiceTargetKey = undefined;
      if (voiceReconnectTimer) { clearTimeout(voiceReconnectTimer); voiceReconnectTimer = undefined; }
    }
    // The meter is process-wide for PWA voice. Keep it alive when a private
    // ride owns voice; otherwise release microphone/WebAudio resources now.
    if (!voiceRoom && !proximityVoiceRooms.size) stopVoiceLevelLoop();
    renderVoiceStatus();
  }

  /**
   * A private ride's voice takes priority over the public channel — you
   * can't be "live" on the public channel while in a ride anyway (see
   * renderMapStatus hiding #joinNearbyBtn during a ride), so this just
   * picks whichever applies and reconnects only when what should be
   * connected has actually changed (a same-ride/channel re-call is a
   * no-op, not a reconnect-and-drop-audio blip). Call this after any
   * change to state.activeRide or state.publicLive rather than calling
   * connectVoice/disconnectVoice directly at each call site.
   */
  function syncVoiceConnection() {
    const desired = state.activeRide ? `ride:${state.activeRide.rideId}` : state.publicLive ? 'channel' : undefined;
    // Public proximity is refreshed even while already on `channel`: the
    // server returns the current authorised pair roster, and this call
    // disconnects rooms immediately when riders leave range or block one
    // another. Private ride membership is stable for this connection.
    if (desired === voiceTargetKey && desired !== 'channel') return;
    if (desired !== voiceTargetKey && (voiceRoom || proximityVoiceRooms.size)) disconnectVoice();
    // A restored session must not make getUserMedia prompt during boot.
    // Create, Join and Go live set this only from their direct tap.
    if (desired && !microphonePermissionReady) return;
    if (state.activeRide) void connectVoice('ride', state.activeRide.rideId);
    else if (state.publicLive) void connectVoice('channel');
  }

  async function toggleVoiceMute() {
    // A suspended VOX analyser is a recovery action, not a mute toggle. This
    // handler runs from a direct rider tap, so it is the best chance Safari
    // has to satisfy any user-activation requirement for AudioContext.resume().
    if (voiceMeterContextNeedsResume()) {
      if (window.RiderMovementSafety.isLockedForSafety(movementState)) return;
      const resumed = await resumeVoiceMeterContext();
      if (!resumed) {
        voiceFailureNotified = true;
        showToast('Voice could not resume. Check microphone access and try again.');
        renderVoiceStatus();
        return;
      }
      voiceFailureNotified = false;
      renderVoiceStatus();
      return;
    }

    if (!voiceRoom && !proximityVoiceRooms.size) {
      if (!state.activeRide && !state.publicLive) return;
      if (window.RiderMovementSafety.isLockedForSafety(movementState)) return;
      if (!(await preflightMicrophoneAccess())) return;
      syncVoiceConnection();
      return;
    }
    voiceManuallyMuted = !voiceManuallyMuted;
    if (voiceManuallyMuted) setVoiceSpeaking(false);
    renderVoiceStatus();
  }

  /**
   * "Go live" / "Leave nearby": real presence, backed by POST/DELETE
   * /presence — not a local-only flag flip. The backend requires
   * profile.shareLocation to be true before it will accept a presence
   * ping (see server.ts's /presence handler, which 403s with
   * location_sharing_disabled otherwise), so going live also turns that
   * profile setting on for real via patchProfile/PUT profile — the same
   * request the Settings > Privacy toggle already makes — rather than
   * silently reusing a client-side copy the backend never saw. Going
   * offline from the map also revokes that profile visibility preference,
   * matching native's one-switch behaviour. Entering a private ride is the
   * exception: it pauses public Nearby without silently rewriting the rider's
   * standing privacy choice. Real hands-free proximity voice chat (see
   * connectVoice above) is tied to the same on/off action — going live for
   * presence and being reachable by voice are the same moment, not two
   * separate steps.
   */
  async function toggleNearby() {
    if (nearbyTogglePending) return;
    nearbyTogglePending = true;
    renderMapStatus();

    try {
      if (state.publicLive) {
        const saved = await stopPublicNearby({ disableLocationSharing: true });
        showToast(saved
          ? 'Nearby visibility and proximity voice are off.'
          : 'Nearby is off, but the location-sharing preference could not be saved.');
        return;
      }

      // Email verification is an intentional public-channel anti-abuse gate.
      // Init refreshes this value from /auth/me, so fail before asking for
      // microphone/location when the account is not eligible.
      if (session?.emailVerified === false) {
        showToast('Verify your email before joining Nearby Voice.');
        return;
      }
      if (!(await preflightMicrophoneAccess())) return;

      let position;
      try {
        position = await currentPublicPresencePosition();
      } catch (error) {
        showToast(locationAccessMessage(error, 'join riders nearby'));
        return;
      }

      const sharingWasAlreadyEnabled = state.profile.shareLocation;
      let enabledSharingForNearby = false;
      try {
        if (!sharingWasAlreadyEnabled) {
          const ok = await patchProfile({ shareLocation: true });
          if (!ok) throw new Error('could_not_enable_location_sharing');
          enabledSharingForNearby = true;
        }

        try {
          await sendPresence(position);
        } catch (error) {
          // Safari can hand back a cached fix that's already too old. Ask for
          // a brand-new one once before giving up.
          if (!(error instanceof ApiError) || error.body?.error !== 'location fix timestamp is stale or invalid') throw error;
          await sendPresence(await currentPosition({ maximumAge: 0 }));
        }
        state.publicLive = true;
        persist();
        renderMapStatus();
        centreMap(position.coords.latitude, position.coords.longitude);
        showToast(
          nearbyRiders.length
            ? 'Location visible. Connecting Nearby Voice…'
            : 'Location visible. Nearby Voice is waiting for riders in range.',
        );
        syncVoiceConnection();
        startPresenceRefresh();
      } catch (error) {
        state.publicLive = false;
        nearbyRiders = [];
        stopPresenceRefresh();
        syncVoiceConnection();
        persist();
        renderMapStatus();
        renderMapRiders();
        try { await apiFetch('DELETE', '/presence'); } catch { /* Presence also expires server-side. */ }

        // If this tap enabled durable sharing but never established Nearby,
        // undo that change so the inactive map control cannot leave a hidden
        // privacy preference switched on.
        if (enabledSharingForNearby) {
          try {
            const profile = await apiFetch(
              'PUT',
              `/riders/${encodeURIComponent(state.profile.riderId)}/profile`,
              { shareLocation: false },
            );
            applyRemoteProfile(profile);
          } catch { /* The failed Nearby session remains locally off. */ }
        }

        const code = error instanceof ApiError ? error.body?.error : undefined;
        showToast(code === 'email_verification_required'
          ? 'Verify your email before joining Nearby Voice.'
          : code === 'location_sharing_disabled'
            ? 'Enable location sharing in Settings to go live.'
            : code === 'location accuracy must be between 0 and 100 metres'
              ? 'Waiting for a more accurate GPS fix. Try Nearby again in a moment.'
              : code === 'implausible_location_jump'
                ? 'Your location jumped unexpectedly. Waiting for a steadier GPS fix. Try Nearby again in a moment.'
                : code === 'rate_limited'
                  ? 'Nearby is updating too often. Try again in a moment.'
                  : code === 'location fix timestamp is stale or invalid'
                    ? 'Couldn’t get a fresh location. Check location is on for this app and try again.'
                    : 'Could not go live. Try again.');
        if (!['email_verification_required', 'location_sharing_disabled', 'rate_limited', 'implausible_location_jump', 'location accuracy must be between 0 and 100 metres'].includes(code)) {
          // Report why, without coordinates, so a failure like this is
          // diagnosable from the server logs.
          clientErrorReporter(`Go live failed: ${code ?? (error instanceof Error ? error.message : String(error))}`, 'nearby.go_live', false);
        }
      }
    } finally {
      nearbyTogglePending = false;
      renderMapStatus();
    }
  }

  const MAX_PUBLIC_PRESENCE_ACCURACY_METERS = 100;
  const MAX_REUSED_PRESENCE_FIX_AGE_MS = 15_000;

