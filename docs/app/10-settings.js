// Part of docs/app.js. 10 of 20: Settings sheets, account, notifications and profile. Edit here, then run `npm run build:pwa-app`.
  function wireSettingsHubRows() {
    $$('[data-settings-target]', $('#sheetBody')).forEach((button) => {
      button.addEventListener('click', () => openSheet(button.dataset.settingsTarget));
    });
  }

  function openSheet(type) {
    const templates = {
      accountHub: () => {
        const tier = planTier(state.profile.zoneTier);
        const plan = PLAN_INFO[tier];
        return {
          title: 'Account',
          body: `<div class="settings-hub-list">
            <button data-settings-target="profile"><span class="setting-icon">${icon('user')}</span><span><strong>Profile</strong><small>Name, handle and connected profiles</small></span>${icon('chevron')}</button>
            <button data-settings-target="plans"><span class="setting-icon">${icon('card')}</span><span><strong>Your plan</strong><small id="planSummary">${escapeHtml(plan.name)} plan · ${escapeHtml(plan.features[0])}</small></span><span id="planPill" class="plan-pill">${escapeHtml(plan.name)}</span>${icon('chevron')}</button>
            <button data-settings-target="sessions"><span class="setting-icon">${icon('settings')}</span><span><strong>Signed-in devices</strong><small>Review and revoke account sessions</small></span>${icon('chevron')}</button>
            <button data-settings-target="account"><span class="setting-icon">${icon('shield')}</span><span><strong>Account and data</strong><small>Account deletion and settings reset</small></span>${icon('chevron')}</button>
          </div>`,
          ready: wireSettingsHubRows,
        };
      },
      communication: () => ({
        title: 'Communication',
        body: `<div class="settings-hub-list">
          <button data-settings-target="privacy"><span class="setting-icon">${icon('shield')}</span><span><strong>Privacy controls</strong><small>Location visibility and connected profiles</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      mapNavigation: () => ({
        title: 'Map & Navigation',
        body: `<div class="settings-hub-list">
          <button data-settings-target="map"><span class="setting-icon">${icon('location')}</span><span><strong>Location and map</strong><small>Location sharing and nearby riders</small></span>${icon('chevron')}</button>
          <button data-settings-target="navigation"><span class="setting-icon">${icon('nav-arrow')}</span><span><strong>Navigation</strong><small id="navigationProviderSummary">${escapeHtml(NAVIGATION_PROVIDERS[navigationProvider(state.navigationProvider)].label)}</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      unitsPreferences: () => ({
        title: 'Units & Preferences',
        body: `<div class="settings-hub-list"><button data-settings-target="units"><span class="setting-icon">${icon('units')}</span><span><strong>Distance units</strong><small id="distanceUnitsSummary">${state.profile.unitSystem === 'km' ? 'Kilometres' : 'Miles'}</small></span>${icon('chevron')}</button></div>`,
        ready: wireSettingsHubRows,
      }),
      help: () => ({
        title: 'Help & Support',
        body: `<div class="settings-hub-list">
          <button data-settings-target="safety"><span class="setting-icon">${icon('info')}</span><span><strong>Safety guidance</strong><small>Low-distraction and emergency guidance</small></span>${icon('chevron')}</button>
          <button data-settings-target="legal"><span class="setting-icon">${icon('shield')}</span><span><strong>Privacy, safety & terms</strong><small>Read Rider Comms legal and safety information</small></span>${icon('chevron')}</button>
        </div>`,
        ready: wireSettingsHubRows,
      }),
      about: () => ({
        title: 'About',
        body: `<div class="settings-about-card"><strong>Rider Comms</strong><span>Version 0.3.0 · PWA</span><span>Signed in as ${escapeHtml(state.profile.displayName)} (${escapeHtml(state.profile.handle)})</span></div>`,
      }),
      legal: () => ({
        title: 'Privacy, safety & terms',
        body: `<div class="settings-legal-list">
          <section><strong>Your privacy</strong><p>Your sign-in is kept in this browser. Location is shared only when you choose: going live on Nearby, or switching it on for a group ride. Voice is carried live and never recorded. You can delete your account and its data at any time in Settings.</p></section>
          <section><strong>Your choices</strong><p>Location sharing starts off. Instagram and TikTok usernames each have Public, Friends only or Private visibility.</p></section>
          <section><strong>Rider safety and conduct</strong><p>Harassment, hate, sexual content, threats, stalking, spam and impersonation aren’t allowed. Report or block a rider from their profile or a chat. Reports are reviewed within 24 hours.</p></section>
          <section><strong>Riding safety</strong><p>Don’t look at or touch your phone while moving. Stop somewhere safe first.</p></section>
          <section class="settings-legal-links"><a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a><a href="terms.html" target="_blank" rel="noopener">Terms of Service</a><a href="guidelines.html" target="_blank" rel="noopener">Community Guidelines</a><a href="support.html" target="_blank" rel="noopener">Contact support</a></section>
        </div>`,
      }),
      profile: () => ({
        title: 'Edit profile',
        body: `<div class="settings-sheet-section"><span class="settings-sheet-label">Identity</span><div class="form-field"><label>Avatar</label>${avatarOptionsMarkup(state.profile.avatarId)}</div><div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Rider handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div><p class="caption">${session?.emailVerified ? 'Email verified.' : 'Email verification pending. Nearby Voice requires a verified email.'}</p>${session?.emailVerified ? '' : '<button class="button secondary wide" id="resendVerificationBtn">Resend verification email</button>'}</div><div class="settings-sheet-section"><span class="settings-sheet-label">Connected profiles</span><div class="form-field"><label for="editInstagram">Instagram</label><input id="editInstagram" maxlength="31" value="${escapeHtml(state.profile.instagram)}" placeholder="Username"></div><div class="form-field"><label for="editTiktok">TikTok</label><input id="editTiktok" maxlength="31" value="${escapeHtml(state.profile.tiktok)}" placeholder="Username"></div><p class="caption">Control who can see these in Privacy controls.</p></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save changes</button>`,
        ready: () => {
          $('#saveProfile').addEventListener('click', saveProfile);
          $('#resendVerificationBtn')?.addEventListener('click', () => void resendVerificationEmail());
          document.querySelectorAll('#sheetBody [data-avatar-option]').forEach((button) => {
            button.addEventListener('click', () => void selectProfileAvatar(button.dataset.avatarOption));
          });
          document.querySelectorAll('#sheetBody [data-avatar-family-tab]').forEach((button) => {
            button.addEventListener('click', () => setAvatarPickerFamily(button.dataset.avatarFamilyTab));
          });
        },
      }),
      sessions: () => ({
        title: 'Signed-in devices',
        body: '<div id="sessionList" class="session-list"><p class="caption">Loading signed-in devices…</p></div><button class="button secondary wide" id="refreshSessions">Refresh devices</button>',
        ready: () => {
          $('#refreshSessions').addEventListener('click', () => void loadAccountSessions());
          void loadAccountSessions();
        },
      }),
      account: () => ({
        title: 'Account and data',
        body: `<div class="settings-note"><strong>Reset settings</strong><p>Reset your Rider Comms profile and synced preferences to their defaults, and restore Google Maps as the device navigation provider.</p></div><button class="button secondary wide" id="resetSettingsBtn">Reset settings</button><div class="settings-note"><strong>Delete Rider Comms account</strong><p>This permanently removes your account and associated test data. This cannot be undone.</p></div><button class="button danger wide" id="deleteAccountBtn">Delete account</button><p id="deleteAccountError" class="inline-error" hidden></p>`,
        ready: () => {
          $('#resetSettingsBtn').addEventListener('click', () => void resetSettings());
          $('#deleteAccountBtn').addEventListener('click', () => void deleteCurrentAccount());
        },
      }),
      plans: () => {
        const currentTier = planTier(state.profile.zoneTier);
        return {
          title: 'Your plan',
          body: (() => {
            const plan = PLAN_INFO[currentTier];
            return `<p class="billing-intro">Your plan sets how far away other riders can be and still appear in Nearby. Private group rides work at any distance, on every plan.</p>
            <div class="plan-list"><article class="plan-card current" data-plan-tier="${currentTier}">
              <div class="plan-top"><span><strong>${escapeHtml(plan.name)}</strong></span><span class="plan-pill">Current</span></div>
              <p>${escapeHtml(plan.blurb)}</p>
              <ul class="plan-features">${plan.features.map((feature) => `<li>${icon('plus')}<span>${escapeHtml(feature)}</span></li>`).join('')}</ul>
              ${currentTier !== 'free' ? '<button class="button danger wide plan-return-free" id="returnToFreePlan">Return to Free</button>' : ''}
            </article></div>`;
          })(),
          ready: () => {
            const returnButton = $('#returnToFreePlan');
            if (!returnButton) return;
            returnButton.addEventListener('click', async () => {
              if (!window.confirm('Return to the Free plan? Your nearby radius will change to 1 mile.')) return;
              returnButton.disabled = true;
              const ok = await patchProfile({ zoneTier: 'free' });
              if (!ok) {
                returnButton.disabled = false;
                return;
              }
              renderProfile();
              openSheet('plans');
              showToast('Returned to the Free plan.');
            });
          },
        };
      },
      privacy: () => ({ title: 'Privacy controls', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Live location', 'Visible to nearby riders only while you are live.', state.profile.shareLocation)}</div><div class="settings-sheet-section"><div class="form-field"><label for="sheetInstagramVisibility">Instagram visibility</label><select id="sheetInstagramVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><div class="form-field"><label for="sheetTiktokVisibility">TikTok visibility</label><select id="sheetTiktokVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><p class="caption">Choose who can see each connected profile independently.</p></div>`, ready: () => { const instagram = $('#sheetInstagramVisibility'); const tiktok = $('#sheetTiktokVisibility'); instagram.value = state.profile.instagramVisibility; tiktok.value = state.profile.tiktokVisibility; instagram.addEventListener('change', (event) => { void patchProfile({ instagramVisibility: event.target.value }); }); tiktok.addEventListener('change', (event) => { void patchProfile({ tiktokVisibility: event.target.value }); }); wireToggles(); } }),
      navigation: () => ({
        title: 'Navigation',
        body: `<div class="choice-list" role="radiogroup" aria-label="Navigation preference">${Object.entries(NAVIGATION_PROVIDERS).map(([id, option]) => `<button data-navigation-option="${id}" role="radio" aria-checked="${navigationProvider(state.navigationProvider) === id}"><span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small></span><i></i></button>`).join('')}</div><div class="settings-note"><strong>Your choice applies to destination buttons</strong><p>Rider Comms navigation stays in the app. Google Maps, Waze and Apple Maps hand the destination to that provider.</p></div>`,
        ready: () => {
          $$('[data-navigation-option]', $('#sheetBody')).forEach((button) => {
            button.addEventListener('click', () => {
              state.navigationProvider = navigationProvider(button.dataset.navigationOption);
              persist();
              renderProfile();
              openSheet('navigation');
              showToast(`Navigation set to ${NAVIGATION_PROVIDERS[state.navigationProvider].label}.`);
            });
          });
        },
      }),
      map: () => ({ title: 'Location and map', body: `<div class="settings-sheet-section">${toggleMarkup('shareLocation', 'Nearby rider visibility', 'Share your position only after you choose to go live.', state.profile.shareLocation)}</div><div class="settings-note"><strong>Location stays in your control</strong><p>Turning this off stops nearby-rider visibility. Private-ride location is controlled separately inside each ride and remains off unless you explicitly enable it.</p></div>`, ready: wireToggles }),
      units: () => ({ title: 'Distance units', body: `<div class="choice-list" role="radiogroup" aria-label="Distance units"><button data-unit-option="mi" role="radio"><span><strong>Miles</strong><small>Use miles and mph</small></span><i></i></button><button data-unit-option="km" role="radio"><span><strong>Kilometres</strong><small>Use kilometres and km/h</small></span><i></i></button></div>`, ready: () => { $$('[data-unit-option]', $('#sheetBody')).forEach((button) => { const active = button.dataset.unitOption === state.profile.unitSystem; button.setAttribute('aria-checked', String(active)); button.addEventListener('click', async () => { button.disabled = true; const next = button.dataset.unitOption; const ok = await patchProfile({ unitSystem: next }); if (ok) { openSheet('units'); showToast('Distance unit updated.'); } else button.disabled = false; }); }); } }),
      safety: () => ({
        title: 'Safety',
        body: `<div class="settings-sheet-section">${toggleMarkup('rideSafeEnabled', 'Automatic Ride Safe', 'Uses device motion to lock distracting controls at 8 mph and above. Recommended while riding.', state.rideSafeEnabled)}</div><div class="settings-note"><strong>Device-only safety preference</strong><p>When off, Rider Comms stops its dedicated Ride Safe location watcher. Map, navigation and optional ride-location features request location separately. Only change this while safely stopped.</p></div><div class="safety-guidance"><div><span class="setting-icon"><svg><use href="#i-ride"/></svg></span><span><strong>Set up while stationary</strong><small>Complete profile, route and group controls before moving.</small></span></div><div><span class="setting-icon"><svg><use href="#i-location"/></svg></span><span><strong>Control your location</strong><small>Nearby visibility can be stopped at any time.</small></span></div><div><span class="setting-icon"><svg><use href="#i-info"/></svg></span><span><strong>Not an emergency service</strong><small>Call the appropriate emergency service if you need urgent help.</small></span></div></div>`,
        ready: wireToggles,
      }),
      reportHazard: () => ({
        title: 'Report on the road',
        body: `<p class="caption">Let nearby riders know what's ahead. Reports fade out over time.</p><div class="hazard-type-grid" id="hazardTypeChips">${HAZARD_TYPE_ORDER.map((t) => `<button type="button" class="hazard-type-tile" data-hazard-type="${t}" style="--hazard:${HAZARD_TYPES[t].color}">${hazardIconMarkup(t)}<span>${escapeHtml(HAZARD_TYPES[t].label)}</span></button>`).join('')}</div><p id="hazardFormError" class="inline-error" hidden></p>`,
        ready: () => {
          const chips = $$('[data-hazard-type]', $('#hazardTypeChips'));
          chips.forEach((chip) => chip.addEventListener('click', () => createHazard(chip.dataset.hazardType, chips)));
        },
      }),
    };
    const template = templates[type]?.();
    if (!template) return;
    presentSheet(template.title, template.body, template.ready);
  }

  function presentSheet(title, body, ready) {
    activeFriendProfileRiderId = null;
    if ($('#sheetBackdrop').hidden) lastSheetTrigger = document.activeElement;
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = body;
    $('#sheetBackdrop').hidden = false;
    document.documentElement.classList.add('sheet-open');
    $('#app')?.setAttribute('inert', '');
    $('#chatScreen')?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    ready?.();
    $('.sheet').focus({ preventScroll: true });
  }

  function toggleMarkup(key, title, description, active) {
    return `<div class="toggle-row"><span><strong>${escapeHtml(title)}</strong><span class="caption">${escapeHtml(description)}</span></span><button class="toggle" data-toggle="${escapeHtml(key)}" aria-label="${escapeHtml(title)}" aria-pressed="${active}"></button></div>`;
  }

  function sessionDateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Recently active';
  }

  async function resendVerificationEmail() {
    const button = $('#resendVerificationBtn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Sending…';
    }
    try {
      const identity = await apiFetch('GET', '/auth/me');
      const remember = localStorage.getItem(SESSION_KEY) !== null;
      if (identity.emailVerified) {
        saveSession({ ...session, emailVerified: true }, remember);
        showToast('Your email is already verified. Nearby Voice is available.');
        openSheet('profile');
        return;
      }
      const result = await apiFetch('POST', '/auth/resend-verification', {});
      showToast(result.sent
        ? 'Verification email sent. Open the new link, then return to Rider Comms.'
        : 'Verification email could not be sent. Email delivery is not configured or is temporarily unavailable.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      showToast(code === 'rate_limited'
        ? 'Too many verification requests. Wait a moment and try again.'
        : 'Could not resend verification. Check your connection and try again.');
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = 'Resend verification email';
      }
    }
  }

  async function loadAccountSessions() {
    const list = $('#sessionList');
    const refresh = $('#refreshSessions');
    if (!list) return;
    if (refresh) refresh.disabled = true;
    list.innerHTML = '<p class="caption">Loading signed-in devices…</p>';
    try {
      const { sessions } = await apiFetch('GET', '/auth/sessions');
      if (!Array.isArray(sessions) || sessions.length === 0) {
        list.innerHTML = '<p class="caption">No account sessions found.</p>';
        return;
      }
      list.innerHTML = sessions.map((accountSession) => {
        const current = accountSession.current === true;
        return `<article class="session-row"><span class="setting-icon">${icon('settings')}</span><span class="session-copy"><strong>${escapeHtml(accountSession.deviceName || 'Rider Comms device')}</strong><small>${current ? 'This device' : `Active ${escapeHtml(sessionDateLabel(accountSession.lastSeenAt))}`}</small></span>${current ? '<span class="plan-pill">Current</span>' : `<button class="button tertiary session-revoke" data-revoke-session="${escapeHtml(accountSession.id)}">Sign out</button>`}</article>`;
      }).join('');
      $$('[data-revoke-session]', list).forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await apiFetch('DELETE', `/auth/sessions/${encodeURIComponent(button.dataset.revokeSession)}`);
          await loadAccountSessions();
          showToast('That device was signed out.');
        } catch {
          button.disabled = false;
          showToast('Could not sign out that device. Try again.');
        }
      }));
    } catch {
      list.innerHTML = '<p class="inline-error">Could not load signed-in devices. Check your connection and try again.</p>';
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function resetSettings() {
    if (!window.confirm('Reset Rider Comms settings to their defaults?')) return;
    try {
      if (state.publicLive || state.profile.shareLocation) {
        await stopPublicNearby({ disableLocationSharing: false });
      }
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        zoneTier: 'free',
        avatarId: 'ember',
        displayName: 'Rider',
        handle: '@rider',
        unitSystem: 'mi',
        notifyNearby: false,
        notifyInvites: false,
        notifyChat: false,
        shareLocation: false,
        instagramUsername: '',
        instagramVisibility: 'friends',
        tiktokUsername: '',
        tiktokVisibility: 'friends',
      });
      state.navigationProvider = 'google_maps';
      state.notifications = false;
      applyRemoteProfile(profile);
      persist();
      openSheet('accountHub');
      showToast('Settings reset.');
    } catch {
      showToast('Could not reset settings. Try again.');
    }
  }

  async function deleteCurrentAccount() {
    if (!window.confirm('Permanently delete your Rider Comms account and associated data?')) return;
    if (!window.confirm('This cannot be undone. Delete the account?')) return;
    const button = $('#deleteAccountBtn');
    const errorEl = $('#deleteAccountError');
    button.disabled = true;
    errorEl.hidden = true;
    try {
      const localStateKey = stateStorageKey();
      await apiFetch('DELETE', '/auth/me');
      localStorage.removeItem(localStateKey);
      clearSession();
      location.reload();
    } catch {
      errorEl.textContent = 'Could not delete your account. Check your connection and try again.';
      errorEl.hidden = false;
      button.disabled = false;
    }
  }

  /** Persists one profile field via PUT /riders/:id/profile immediately —
   * used by toggles/selects that should save as soon as the rider flips
   * them, rather than waiting for a separate "Save" button. */
  async function patchProfile(update) {
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, update);
      applyRemoteProfile(profile);
      return true;
    } catch {
      showToast('Could not save that change. Try again.');
      return false;
    }
  }

  function notificationPermission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  function syncNotificationPreference() {
    if (state.notifications && notificationPermission() !== 'granted') {
      state.notifications = false;
      persist();
    }
  }

  /** Notification permission must be requested directly from the Settings
   * tap. Installed iOS PWAs and other mobile browsers may suppress a prompt
   * started during app boot or after unrelated asynchronous work. */
  async function requestNotificationPermission() {
    const permission = notificationPermission();
    if (permission === 'unsupported') {
      showToast('Notifications are not supported by this browser.');
      return false;
    }
    if (permission === 'denied') {
      showToast('Notifications are blocked. Allow them in this site’s device settings.');
      return false;
    }
    if (permission === 'granted') return true;
    try {
      const granted = await Notification.requestPermission() === 'granted';
      if (!granted) showToast('Notification permission was not enabled.');
      return granted;
    } catch {
      showToast('Could not request notification permission.');
      return false;
    }
  }

  function wireToggles() {
    $$('[data-toggle]', $('#sheetBody')).forEach((button) => button.addEventListener('click', async () => {
      const key = button.dataset.toggle;
      const active = button.getAttribute('aria-pressed') !== 'true';
      if (key === 'rideSafeEnabled') {
        if (!active && !window.confirm('Turn off Automatic Ride Safe? Distracting controls will no longer lock automatically while this device is moving. Only change this while safely stopped.')) return;
        state.rideSafeEnabled = active;
        persist();
        button.setAttribute('aria-pressed', String(active));
        if (active) {
          await initialiseMovementSafety();
          showToast('Automatic Ride Safe is on.');
        } else {
          stopMovementSafetyTracking();
          showToast('Automatic Ride Safe is off on this device.');
        }
        return;
      }
      if (['notifyNearby', 'notifyInvites', 'notifyChat'].includes(key)) {
        button.disabled = true;
        const granted = !active || await requestNotificationPermission();
        if (!granted) {
          button.disabled = false;
          return;
        }
        const ok = await patchProfile({ [key]: active });
        if (ok) {
          state.notifications = Boolean(state.profile.notifyNearby || state.profile.notifyInvites || state.profile.notifyChat);
          persist();
          button.setAttribute('aria-pressed', String(Boolean(state.profile[key])));
        }
        button.disabled = false;
        return;
      }
      if (key === 'shareLocation') {
        button.disabled = true;
        if (!active) {
          const ok = await stopPublicNearby({ disableLocationSharing: true });
          button.disabled = false;
          button.setAttribute('aria-pressed', String(state.profile.shareLocation));
          if (ok) showToast('Nearby visibility and proximity voice are off.');
          return;
        }
        try {
          await currentPosition();
        } catch (error) {
          button.disabled = false;
          showToast(locationAccessMessage(error, 'share your location'));
          return;
        }
        const ok = await patchProfile({ shareLocation: true });
        button.disabled = false;
        if (ok) {
          button.setAttribute('aria-pressed', 'true');
          syncRideLocationSharing();
        }
      }
    }));
  }

  async function saveProfile() {
    const errorEl = $('#profileFormError');
    const button = $('#saveProfile');
    errorEl.hidden = true;
    const displayName = $('#editName').value.trim();
    let handle = $('#editHandle').value.trim();
    if (!displayName) { errorEl.textContent = 'Add a display name.'; errorEl.hidden = false; return; }
    if (!handle.startsWith('@')) handle = `@${handle}`;
    if (!/^@[a-z0-9_]{3,24}$/i.test(handle)) { errorEl.textContent = 'Use 3–24 letters, numbers or underscores for your handle.'; errorEl.hidden = false; return; }
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        displayName,
        handle,
        instagramUsername: $('#editInstagram').value.trim().replace(/^@/, ''),
        tiktokUsername: $('#editTiktok').value.trim().replace(/^@/, ''),
        instagramVisibility: state.profile.instagramVisibility,
        tiktokVisibility: state.profile.tiktokVisibility,
      });
      applyRemoteProfile(profile);
      renderFallbackMarkers();
      closeSheet();
      showToast('Profile updated.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      errorEl.textContent = typeof code === 'string' && code ? code.replace(/_/g, ' ') : 'Could not save your profile. Try again.';
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Save profile';
    }
  }

  function closeSheet() {
    activeFriendProfileRiderId = null;
    const trigger = lastSheetTrigger;
    $('#sheetBackdrop').hidden = true;
    document.documentElement.classList.remove('sheet-open');
    $('#app')?.removeAttribute('inert');
    $('#chatScreen')?.removeAttribute('inert');
    document.body.style.overflow = '';
    lastSheetTrigger = null;
    trigger?.focus?.();
  }

  let nearbyTogglePending = false;

