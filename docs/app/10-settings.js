// Part of docs/app.js. 10 of 20: Settings sheets, account, notifications and profile. Edit here, then run `npm run build:pwa-app`.
  // Each Settings option is its own full page with everything for it on the
  // page, not a sheet holding another list of sheets. Every control lives in
  // exactly one place: your public profile (View profile) and editing it are
  // their own pages, the plan is only under "Your plan", and Account is
  // sign-in, devices and data. The older per-topic keys (profile, plans,
  // navigation…) still work: they open the page that now holds them.
  const SETTINGS_PAGES = {
    myProfile: { title: 'Profile', sections: [['', 'profileView']] },
    editProfile: { title: 'Edit profile', sections: [['', 'profile']], back: 'myProfile' },
    plan: { title: 'Your plan', sections: [['', 'plans']] },
    // The Settings list holds the switches itself; these are the choices
    // and lists it opens.
    navigationApp: { title: 'Navigation app', sections: [['', 'navigation']] },
    distanceUnits: { title: 'Distance units', sections: [['', 'units']] },
    blockedRiders: { title: 'Blocked riders', sections: [['', 'blocked']] },
    email: { title: 'Email', sections: [['', 'emailStatus']] },
    devices: { title: 'Signed-in devices', sections: [['', 'sessions']] },
    help: { title: 'Help & Support', sections: [['', 'helpContact'], ['Common questions', 'faq'], ['Riding safely', 'safetyGuidance'], ['Legal', 'legalLinks']] },
    about: { title: 'About', sections: [['', 'aboutCard']] },
  };
  const SETTINGS_PAGE_FOR_SECTION = {
    profile: 'editProfile', profileView: 'myProfile', plans: 'plan',
    navigation: 'navigationApp', units: 'distanceUnits', blocked: 'blockedRiders',
    emailStatus: 'email', sessions: 'devices', legal: 'help', faq: 'help',
  };
  let currentSettingsPage = null;
  // The hazard picker closes itself if nothing is picked (native mirrors).
  const HAZARD_AUTO_CLOSE_SECONDS = 10;
  let hazardAutoCloseTimer;
  // Help & Support's common questions. The native Help page has the same
  // list (scripts/check-client-parity.mjs keeps them equal).
  const HELP_FAQ = [
    ['I can’t sign in', 'Use Forgot password? on the sign-in screen. We’ll email a reset link and code to the address on your account.'],
    ['I didn’t get the verification email', 'Check your spam folder, then open Settings → Email and send a new one.'],
    ['Voice isn’t connecting', 'Check that Rider Comms can use your microphone and that you have a data connection. Your map and ride keep working while voice reconnects.'],
    ['My location isn’t showing', 'Location is only shared when you turn it on: Go live for Nearby, or the location switch in a group ride. Check that location access is allowed for Rider Comms.'],
    ['Someone is bothering me', 'Report and block them from their profile, a chat, the ride roster or a friend request. Reports are reviewed within 24 hours.'],
    ['How do I delete my account?', 'Settings → Delete account. It permanently deletes your account and its data straight away.'],
  ];

  function openSheet(type) {
    const templates = {
      music: () => {
        const apps = musicAppsInOrder();
        const last = rememberedMusicApp();
        return {
          title: 'Music',
          body: `<p class="caption music-sheet-note">Opens your music app. While riding, play, pause and skip with your helmet or headset buttons.</p>
            <div class="settings-hub-list">${apps.map((app) => `<button data-music-app="${app.id}"><span class="setting-icon">${icon('music')}</span><span><strong>${escapeHtml(app.name)}</strong><small>${app.id === last ? 'Last used' : `Open ${escapeHtml(app.name)}`}</small></span>${icon('chevron')}</button>`).join('')}</div>`,
          ready: () => $$('[data-music-app]').forEach((button) => button.addEventListener('click', () => openMusicApp(button.dataset.musicApp))),
        };
      },
      blocked: () => ({
        title: 'Blocked riders',
        body: '<div id="blockedRidersList" class="blocked-list" aria-live="polite"><p class="caption">Loading…</p></div>',
        ready: () => void renderBlockedRiders(),
      }),
      safetyGuidance: () => ({
        title: 'Riding safely',
        body: '<div class="safety-guidance"><div><span class="setting-icon"><svg><use href="#i-ride"/></svg></span><span><strong>Set up while stationary</strong><small>Complete profile, route and group controls before moving.</small></span></div><div><span class="setting-icon"><svg><use href="#i-location"/></svg></span><span><strong>Control your location</strong><small>Nearby visibility can be stopped at any time.</small></span></div><div><span class="setting-icon"><svg><use href="#i-info"/></svg></span><span><strong>Not an emergency service</strong><small>Call the appropriate emergency service if you need urgent help.</small></span></div></div>',
      }),
      aboutCard: () => ({
        title: 'About',
        body: `<div class="settings-about-card"><strong>Rider Comms</strong><span>Version 0.3.0 · PWA</span><span>Signed in as ${escapeHtml(state.profile.displayName)} (${escapeHtml(state.profile.handle)})</span></div>`,
      }),
      helpContact: () => ({
        title: 'Contact support',
        body: `<a class="button primary wide help-contact" href="support.html" target="_blank" rel="noopener">${icon('message')}<span>Contact support</span></a><p class="caption help-contact-note">We reply within 2 working days. Safety reports made in the app are reviewed within 24 hours.</p>`,
      }),
      faq: () => ({
        title: 'Common questions',
        body: `<div class="faq-list">${HELP_FAQ.map(([question, answer]) => `<details class="faq-item"><summary><span>${escapeHtml(question)}</span>${icon('chevron')}</summary><p>${escapeHtml(answer)}</p></details>`).join('')}</div>`,
      }),
      legalLinks: () => ({
        title: 'Legal',
        body: `<div class="settings-list help-links"><div class="settings-rows">${[
          ['privacy.html', 'lock', 'Privacy Policy'],
          ['terms.html', 'info', 'Terms of Service'],
          ['guidelines.html', 'friends', 'Community Guidelines'],
        ].map(([href, iconName, label]) => `<a class="settings-row" href="${href}" target="_blank" rel="noopener"><span class="setting-icon">${icon(iconName)}</span><span class="settings-row-label">${label}</span><span class="settings-row-chevron">${icon('chevron')}</span></a>`).join('')}</div></div>`,
      }),
      profileView: () => {
        const plan = PLAN_INFO[planTier(state.profile.zoneTier)];
        const visibilityLabel = { public: 'Everyone', friends: 'Friends only', private: 'Only me' };
        const socialRow = (label, username, visibility) => `<div class="my-profile-social"><span><strong>${label}</strong><small>${username ? `@${escapeHtml(username)}` : 'Not added'}</small></span>${username ? `<span class="my-profile-visibility">${escapeHtml(visibilityLabel[visibility] || 'Friends only')}</span>` : ''}</div>`;
        return {
          title: 'Profile',
          body: `<article class="my-profile-card">
              <span class="my-profile-avatar">${avatar(state.profile, 'avatar-xl')}</span>
              <strong class="my-profile-name">${escapeHtml(state.profile.displayName)}</strong>
              <span class="my-profile-handle">${escapeHtml(state.profile.handle)}</span>
              <span class="my-profile-plan">${escapeHtml(plan.name)} plan</span>
            </article>
            <button class="button primary wide" id="editProfileFromView" type="button">Edit profile</button>
            <section class="my-profile-section" aria-label="Connected profiles"><h3 class="settings-page-heading">Connected profiles</h3><div class="my-profile-socials">${socialRow('Instagram', state.profile.instagram, state.profile.instagramVisibility)}${socialRow('TikTok', state.profile.tiktok, state.profile.tiktokVisibility)}</div><p class="caption">This is how riders see you. Each connected profile shows only to the people you choose.</p></section>`,
          ready: () => $('#editProfileFromView').addEventListener('click', () => openSheet('editProfile')),
        };
      },
      profile: () => ({
        title: 'Edit profile',
        body: `<div class="settings-sheet-section"><span class="settings-sheet-label">Avatar</span>${avatarOptionsMarkup(state.profile.avatarId)}</div><div class="settings-sheet-section"><span class="settings-sheet-label">Name</span><div class="form-field"><label for="editName">Display name</label><input id="editName" maxlength="50" value="${escapeHtml(state.profile.displayName)}"></div><div class="form-field"><label for="editHandle">Rider handle</label><input id="editHandle" maxlength="25" value="${escapeHtml(state.profile.handle)}"></div></div><div class="settings-sheet-section"><span class="settings-sheet-label">Connected profiles</span><div class="form-field"><label for="editInstagram">Instagram</label><input id="editInstagram" maxlength="31" value="${escapeHtml(state.profile.instagram)}" placeholder="Username" autocapitalize="none" autocorrect="off"></div><div class="form-field"><label for="sheetInstagramVisibility">Who can see your Instagram</label><select id="sheetInstagramVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div><div class="form-field"><label for="editTiktok">TikTok</label><input id="editTiktok" maxlength="31" value="${escapeHtml(state.profile.tiktok)}" placeholder="Username" autocapitalize="none" autocorrect="off"></div><div class="form-field"><label for="sheetTiktokVisibility">Who can see your TikTok</label><select id="sheetTiktokVisibility"><option value="friends">Friends only</option><option value="public">Everyone</option><option value="private">Only me</option></select></div></div><p id="profileFormError" class="inline-error" hidden></p><button class="button primary wide" id="saveProfile">Save changes</button>`,
        ready: () => {
          $('#sheetInstagramVisibility').value = state.profile.instagramVisibility;
          $('#sheetTiktokVisibility').value = state.profile.tiktokVisibility;
          $('#saveProfile').addEventListener('click', saveProfile);
          document.querySelectorAll('#sheetBody [data-avatar-option]').forEach((button) => {
            button.addEventListener('click', () => void selectProfileAvatar(button.dataset.avatarOption));
          });
          document.querySelectorAll('#sheetBody [data-avatar-family-tab]').forEach((button) => {
            button.addEventListener('click', () => setAvatarPickerFamily(button.dataset.avatarFamilyTab));
          });
        },
      }),
      emailStatus: () => ({
        title: 'Email',
        body: `<div class="settings-note"><strong>${session?.emailVerified ? 'Email verified' : 'Email not verified yet'}</strong><p>${session?.emailVerified ? 'Your email is verified, so Nearby Voice is available.' : 'Nearby Voice needs a verified email. Open the link we emailed you, or send a new one.'}</p></div>${session?.emailVerified ? '' : '<button class="button secondary wide" id="resendVerificationBtn">Resend verification email</button>'}`,
        ready: () => $('#resendVerificationBtn')?.addEventListener('click', () => void resendVerificationEmail()),
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
        body: `<div class="settings-note"><strong>Reset settings</strong><p>Reset your Rider Comms profile and synced preferences to their defaults, and restore Google Maps as the device navigation provider.</p></div><button class="button secondary wide" id="resetSettingsBtn">Reset settings</button><div class="settings-note"><strong>Delete Rider Comms account</strong><p>This permanently deletes your Rider Comms account and associated data. This cannot be undone. It doesn’t cancel a Premium subscription bought in the app: cancel that in your App Store or Google Play subscription settings.</p></div><button class="button danger wide" id="deleteAccountBtn">Delete account</button><p id="deleteAccountError" class="inline-error" hidden></p>`,
        ready: () => {
          $('#resetSettingsBtn').addEventListener('click', () => void resetSettings());
          $('#deleteAccountBtn').addEventListener('click', () => void deleteCurrentAccount());
        },
      }),
      plans: () => {
        const currentTier = planTier(state.profile.zoneTier);
        const paid = currentTier !== 'free';
        const expiresAt = state.billing?.expiresAt ? new Date(state.billing.expiresAt) : null;
        const expiryLabel = expiresAt && Number.isFinite(expiresAt.getTime())
          ? `${state.billing?.willRenew ? 'Renews' : 'Ends'} ${expiresAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
          : '';
        const storeNote = state.billing?.purchasesEnabled
          ? 'Subscriptions are purchased and managed in the native app. Your plan works here when you sign in.'
          : 'Subscriptions are purchased in the native app. This browser shows your current plan and range.';
        return {
          title: 'Your plan',
          body: `<div class="plan-summary"><span>You’re on</span><strong>${escapeHtml(PLAN_INFO[currentTier].name)}</strong><small>${PLAN_INFO[currentTier].radiusMiles} mi Nearby range${expiryLabel ? ` · ${escapeHtml(expiryLabel)}` : ''}</small></div>
            <p class="billing-intro">Plans change how far Nearby reaches. Group rides, voice chat, navigation and road alerts are included on every plan.</p>
            <div class="plan-list">${Object.entries(PLAN_INFO).map(([tier, plan]) => `<article class="plan-card${tier === currentTier ? ' current' : ''}" data-plan-tier="${tier}">
              <div class="plan-top"><span><strong>${escapeHtml(plan.name)}</strong>${tier === 'free' ? '' : `<small class="plan-price">${escapeHtml(plan.price)}</small>`}</span>${tier === currentTier ? '<span class="plan-pill">Current</span>' : ''}</div>
              <p>${escapeHtml(plan.blurb)}</p>
              <ul class="plan-features">${plan.features.map((feature) => `<li>${icon('plus')}<span>${escapeHtml(feature)}</span></li>`).join('')}</ul>
            </article>`).join('')}</div>
            <div class="settings-note"><strong>${paid ? 'Manage your subscription' : 'Subscribe in the app'}</strong><p>${paid
              ? `${storeNote} To change or cancel it, use the App Store or Google Play subscription settings on the device you subscribed with.`
              : storeNote}</p></div>`,
        };
      },
      navigation: () => ({
        title: 'Navigation',
        body: `<div class="choice-list" role="radiogroup" aria-label="Navigation preference">${Object.entries(NAVIGATION_PROVIDERS).map(([id, option]) => `<button data-navigation-option="${id}" role="radio" aria-checked="${navigationProvider(state.navigationProvider) === id}"><span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small></span><i></i></button>`).join('')}</div><p class="caption">Rider Comms navigation stays in the app. Google Maps, Waze and Apple Maps hand the destination to that app.</p>`,
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
      units: () => ({ title: 'Distance units', body: `<div class="choice-list" role="radiogroup" aria-label="Distance units"><button data-unit-option="mi" role="radio"><span><strong>Miles</strong><small>Use miles and mph</small></span><i></i></button><button data-unit-option="km" role="radio"><span><strong>Kilometres</strong><small>Use kilometres and km/h</small></span><i></i></button></div>`, ready: () => { $$('[data-unit-option]', $('#sheetBody')).forEach((button) => { const active = button.dataset.unitOption === state.profile.unitSystem; button.setAttribute('aria-checked', String(active)); button.addEventListener('click', async () => { button.disabled = true; const next = button.dataset.unitOption; const ok = await patchProfile({ unitSystem: next }); if (ok) { openSheet('units'); showToast('Distance unit updated.'); } else button.disabled = false; }); }); } }),
      reportHazard: () => ({
        title: 'Report on the road',
        body: `<p class="caption">Let nearby riders know what's ahead. Reports fade out over time.</p><div class="hazard-type-grid" id="hazardTypeChips">${HAZARD_TYPE_ORDER.map((t) => `<button type="button" class="hazard-type-tile" data-hazard-type="${t}" style="--hazard:${HAZARD_TYPES[t].color}">${hazardIconMarkup(t)}<span>${escapeHtml(HAZARD_TYPES[t].label)}</span></button>`).join('')}</div><p id="hazardFormError" class="inline-error" hidden></p><p id="hazardAutoClose" class="hazard-autoclose" aria-live="off">Closes in ${HAZARD_AUTO_CLOSE_SECONDS} seconds if you don’t pick one.</p>`,
        ready: () => {
          const chips = $$('[data-hazard-type]', $('#hazardTypeChips'));
          // One tap to report; if nothing is picked the picker closes itself
          // so it never sits over the map on a ride.
          clearInterval(hazardAutoCloseTimer);
          let remaining = HAZARD_AUTO_CLOSE_SECONDS;
          hazardAutoCloseTimer = setInterval(() => {
            if ($('#sheetBackdrop').hidden || !$('#hazardTypeChips')) { clearInterval(hazardAutoCloseTimer); return; }
            remaining -= 1;
            if (remaining <= 0) { clearInterval(hazardAutoCloseTimer); closeSheet(); return; }
            $('#hazardAutoClose').textContent = `Closes in ${remaining} seconds if you don’t pick one.`;
          }, 1000);
          chips.forEach((chip) => chip.addEventListener('click', () => {
            clearInterval(hazardAutoCloseTimer);
            $('#hazardAutoClose').hidden = true;
            createHazard(chip.dataset.hazardType, chips);
          }));
        },
      }),
    };
    const pageKey = SETTINGS_PAGES[type] ? type : SETTINGS_PAGE_FOR_SECTION[type];
    if (pageKey) {
      const page = SETTINGS_PAGES[pageKey];
      const sameScrollable = !$('#sheetBackdrop').hidden && currentSettingsPage === pageKey ? $('.sheet') : null;
      const keepScroll = sameScrollable ? sameScrollable.scrollTop : null;
      const parts = page.sections.map(([heading, key]) => ({ heading, key, template: templates[key]() }));
      const body = parts.map(({ heading, key, template }) => `<section class="settings-page-section" data-settings-section="${key}">${heading ? `<h3 class="settings-page-heading">${escapeHtml(heading)}</h3>` : ''}${template.body}</section>`).join('');
      presentSheet(page.title, body, () => parts.forEach(({ template }) => template.ready?.()), { page: pageKey });
      // Re-rendering the same page (after a change) keeps its place; opening
      // it for one section scrolls to that section.
      if (keepScroll !== null) $('.sheet').scrollTop = keepScroll;
      else if (type !== pageKey) $(`[data-settings-section="${type}"]`)?.scrollIntoView({ block: 'start' });
      return;
    }
    const template = templates[type]?.();
    if (!template) return;
    presentSheet(template.title, template.body, template.ready);
  }

  function presentSheet(title, body, ready, options = {}) {
    activeFriendProfileRiderId = null;
    if ($('#sheetBackdrop').hidden) lastSheetTrigger = document.activeElement;
    // Settings pages are full screen with a back chevron; everything else
    // stays a bottom sheet with a close button.
    currentSettingsPage = options.page || null;
    $('#sheetBackdrop').classList.toggle('settings-page-mode', Boolean(currentSettingsPage));
    const close = $('#closeSheet');
    close.innerHTML = currentSettingsPage ? '<svg class="icon-back" aria-hidden="true"><use href="#i-chevron"/></svg>' : '×';
    close.dataset.backTo = SETTINGS_PAGES[currentSettingsPage]?.back || '';
    close.setAttribute('aria-label', currentSettingsPage ? 'Back' : 'Close');
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
        openSheet('email');
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
        return `<article class="session-row"><span class="setting-icon">${icon('phone')}</span><span class="session-copy"><strong>${escapeHtml(accountSession.deviceName || 'Rider Comms device')}</strong><small>${current ? 'This device' : `Active ${escapeHtml(sessionDateLabel(accountSession.lastSeenAt))}`}</small></span>${current ? '<span class="plan-pill">Current</span>' : `<button class="button tertiary session-revoke" data-revoke-session="${escapeHtml(accountSession.id)}">Sign out</button>`}</article>`;
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
      state.avoidHighways = false;
      state.avoidTolls = false;
      applyRemoteProfile(profile);
      persist();
      renderSettingsList();
      showToast('Settings reset.');
    } catch {
      showToast('Could not reset settings. Try again.');
    }
  }

  async function deleteCurrentAccount() {
    if (!window.confirm('Permanently delete your Rider Comms account and associated data? This doesn’t cancel a Premium subscription bought in the app: cancel that in your App Store or Google Play subscription settings.')) return;
    if (!window.confirm('This cannot be undone. Delete the account?')) return;
    const button = $('#deleteAccountBtn');
    if (button) button.disabled = true;
    try {
      const localStateKey = stateStorageKey();
      await apiFetch('DELETE', '/auth/me');
      localStorage.removeItem(localStateKey);
      clearSession();
      location.reload();
    } catch {
      showToast('Could not delete your account. Check your connection and try again.');
      if (button) button.disabled = false;
    }
  }

  // The Settings screen is a real settings list: switches act in place,
  // choices show their current value and open a page to change it, and
  // only lists (devices, blocked riders) and account actions go further.
  function renderSettingsList() {
    const list = $('#settingsList');
    if (!list) return;
    const section = (title, rows, note = '') => `<section class="settings-section" aria-label="${escapeHtml(title)}"><h2 class="settings-section-title">${escapeHtml(title)}</h2><div class="settings-rows">${rows.join('')}</div>${note ? `<p class="settings-section-note">${escapeHtml(note)}</p>` : ''}</section>`;
    const link = (page, iconName, label, value = '') => `<button type="button" class="settings-row" data-settings-open="${page}"><span class="setting-icon">${icon(iconName)}</span><span class="settings-row-label">${escapeHtml(label)}</span>${value ? `<span class="settings-row-value">${escapeHtml(value)}</span>` : ''}<span class="settings-row-chevron">${icon('chevron')}</span></button>`;
    const toggle = (key, iconName, label, active) => `<div class="settings-row settings-row-toggle"><span class="setting-icon">${icon(iconName)}</span><span class="settings-row-label">${escapeHtml(label)}</span><button type="button" class="toggle" data-toggle="${key}" aria-label="${escapeHtml(label)}" aria-pressed="${active}"></button></div>`;
    const action = (id, iconName, label, danger = false) => `<button type="button" class="settings-row${danger ? ' settings-row-danger' : ''}" id="${id}"><span class="setting-icon">${icon(iconName)}</span><span class="settings-row-label">${escapeHtml(label)}</span></button>`;
    list.innerHTML = [
      section('Riding', [
        toggle('rideSafeEnabled', 'shield', 'Ride Safe auto-lock', state.rideSafeEnabled),
        link('distanceUnits', 'units', 'Distance units', state.profile.unitSystem === 'km' ? 'Kilometres' : 'Miles'),
      ], 'Ride Safe locks distracting controls at 8 mph and above. Only change it while safely stopped.'),
      section('Map & navigation', [
        link('navigationApp', 'route', 'Navigation app', NAVIGATION_PROVIDERS[navigationProvider(state.navigationProvider)].label),
        toggle('avoidHighways', 'map', 'Avoid motorways', state.avoidHighways),
        toggle('avoidTolls', 'card', 'Avoid tolls', state.avoidTolls),
      ], 'Route options apply to routes Rider Comms plans.'),
      section('Privacy', [
        toggle('shareLocation', 'location', 'Nearby rider visibility', state.profile.shareLocation),
        link('blockedRiders', 'eye-off', 'Blocked riders'),
      ], 'Nearby riders see you only while you’re live. Group-ride location is chosen inside each ride.'),
      section('Account', [
        link('email', 'mail', 'Email', session?.emailVerified ? 'Verified' : 'Not verified'),
        link('devices', 'phone', 'Signed-in devices'),
        action('resetSettingsBtn', 'reset', 'Reset settings'),
        action('deleteAccountBtn', 'alert', 'Delete account', true),
      ]),
      section('About', [link('about', 'info', 'About', 'Version 0.3.0')]),
    ].join('');
    $$('[data-settings-open]', list).forEach((button) => button.addEventListener('click', () => openSheet(button.dataset.settingsOpen)));
    $('#resetSettingsBtn').addEventListener('click', () => void resetSettings());
    $('#deleteAccountBtn').addEventListener('click', () => void deleteCurrentAccount());
    wireToggles(list);
    void refreshBlockedCount();
  }

  // Blocked riders shows how many, fetched after the list draws so it never
  // waits on the network.
  let blockedCount = null;
  async function refreshBlockedCount() {
    const show = () => {
      const row = $('[data-settings-open="blockedRiders"]');
      if (!row) return;
      if (!blockedCount) { row.querySelector('.settings-row-value')?.remove(); return; }
      if (!row.querySelector('.settings-row-value')) {
        const value = document.createElement('span');
        value.className = 'settings-row-value';
        row.querySelector('.settings-row-chevron').before(value);
      }
      row.querySelector('.settings-row-value').textContent = String(blockedCount);
    };
    show();
    try {
      const { blocked } = await apiFetch('GET', '/blocks');
      blockedCount = Array.isArray(blocked) ? blocked.length : null;
      show();
    } catch {
      // The row still opens the list; the count is a nicety.
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

  function wireToggles(root = $('#sheetBody')) {
    // A settings page can hold several sections that each wire toggles;
    // wire each button once so a tap doesn't flip it twice.
    const unwired = $$('[data-toggle]:not([data-toggle-wired])', root);
    unwired.forEach((button) => button.setAttribute('data-toggle-wired', ''));
    unwired.forEach((button) => button.addEventListener('click', async () => {
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
      if (key === 'avoidHighways' || key === 'avoidTolls') {
        state[key] = active;
        persist();
        button.setAttribute('aria-pressed', String(active));
        const label = key === 'avoidHighways' ? 'motorways' : 'tolls';
        showToast(active ? `New routes avoid ${label}.` : `New routes can use ${label}.`);
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
        instagramVisibility: $('#sheetInstagramVisibility')?.value || state.profile.instagramVisibility,
        tiktokVisibility: $('#sheetTiktokVisibility')?.value || state.profile.tiktokVisibility,
      });
      applyRemoteProfile(profile);
      renderFallbackMarkers();
      openSheet('myProfile');
      showToast('Profile updated.');
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      errorEl.textContent = typeof code === 'string' && code ? code.replace(/_/g, ' ') : 'Could not save your profile. Try again.';
      errorEl.hidden = false;
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'Save changes';
      }
    }
  }

  /** Settings → Communication → Blocked riders: list blocks and undo them. */
  async function renderBlockedRiders() {
    const list = $('#blockedRidersList');
    if (!list) return;
    let blocked;
    try {
      ({ blocked } = await apiFetch('GET', '/blocks'));
    } catch {
      list.innerHTML = '<p class="inline-error" role="alert">Couldn’t load blocked riders. Check your connection and try again.</p>';
      return;
    }
    if (!$('#blockedRidersList')) return;
    if (!blocked?.length) {
      list.innerHTML = '<p class="caption">You haven’t blocked anyone. Block a rider from their profile, a chat or the ride roster.</p>';
      return;
    }
    list.innerHTML = blocked.map((rider) => `<article class="blocked-row"><span class="identity"><strong>${escapeHtml(rider.displayName)}</strong><small>${escapeHtml(rider.handle || '')}</small></span><button type="button" class="button secondary" data-unblock="${escapeHtml(rider.riderId)}">Unblock</button></article>`).join('');
    $$('[data-unblock]', list).forEach((button) => button.addEventListener('click', async () => {
      const rider = blocked.find((entry) => entry.riderId === button.dataset.unblock);
      if (!rider || !window.confirm(`Unblock ${rider.displayName}? They’ll be able to find you in Nearby and send you a friend request again. Your previous friendship isn’t restored.`)) return;
      button.disabled = true;
      try {
        await apiFetch('DELETE', `/blocks/${encodeURIComponent(rider.riderId)}`);
        showToast(`${rider.displayName} unblocked.`);
        void renderBlockedRiders();
      } catch {
        button.disabled = false;
        showToast('Couldn’t unblock. Try again.');
      }
    }));
  }

  // Like Waze's music button, but a web app can't embed a player: it opens
  // the rider's music app by its URL scheme and remembers which one.
  const MUSIC_APPS = [
    { id: 'spotify', name: 'Spotify', url: 'spotify:' },
    { id: 'apple-music', name: 'Apple Music', url: 'music://', appleOnly: true },
    { id: 'youtube-music', name: 'YouTube Music', url: 'youtubemusic://' },
  ];
  const MUSIC_APP_KEY = 'rider-comms-music-app';

  function rememberedMusicApp() {
    try { return localStorage.getItem(MUSIC_APP_KEY); } catch { return null; }
  }

  function musicAppsInOrder() {
    const ua = navigator.userAgent;
    const apple = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const last = rememberedMusicApp();
    return MUSIC_APPS
      .filter((app) => !app.appleOnly || apple)
      .sort((a, b) => Number(b.id === last) - Number(a.id === last));
  }

  function openMusicApp(id) {
    const app = MUSIC_APPS.find((candidate) => candidate.id === id);
    if (!app) return;
    try { localStorage.setItem(MUSIC_APP_KEY, app.id); } catch { /* Ordering only. */ }
    closeSheet();
    // Opening the app hides this page. If it's still showing, the app
    // probably isn't installed.
    const notOpened = setTimeout(() => {
      if (document.visibilityState === 'visible') showToast(`Couldn’t open ${app.name}. Is it installed?`);
    }, 1600);
    document.addEventListener('visibilitychange', () => clearTimeout(notOpened), { once: true });
    window.location.href = app.url;
  }

  // A settings page opened from another page (Edit profile from Profile)
  // goes back to it; everything else closes.
  function sheetBack() {
    const backTo = $('#closeSheet').dataset.backTo;
    if (currentSettingsPage && backTo) openSheet(backTo);
    else closeSheet();
  }

  function closeSheet() {
    activeFriendProfileRiderId = null;
    const trigger = lastSheetTrigger;
    $('#sheetBackdrop').hidden = true;
    $('#sheetBackdrop').classList.remove('settings-page-mode');
    currentSettingsPage = null;
    document.documentElement.classList.remove('sheet-open');
    $('#app')?.removeAttribute('inert');
    $('#chatScreen')?.removeAttribute('inert');
    document.body.style.overflow = '';
    lastSheetTrigger = null;
    if (state.screen === 'settings') {
      // The list re-renders with any changed value; keep focus on the row
      // that opened the page.
      const openedFrom = trigger?.dataset?.settingsOpen;
      renderSettingsList();
      if (openedFrom) { $(`[data-settings-open="${openedFrom}"]`)?.focus(); return; }
    }
    trigger?.focus?.();
  }

  let nearbyTogglePending = false;
