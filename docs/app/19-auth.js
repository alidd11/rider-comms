// Part of docs/app.js. 19 of 20: Sign-in, sign-up and password reset. Edit here, then run `npm run build:pwa-app`.
  function clearAuthFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
  }

  function showAuthScreen(withSplash = false) {
    clearAuthFocus();
    $('#app').hidden = true;
    $('#authScreen').hidden = false;
    document.documentElement.classList.add('auth-open');
    const splash = $('#authSplash');
    if (!splash) return;
    clearTimeout(authSplashTimer);
    splash.hidden = !withSplash;
    if (withSplash) {
      authSplashTimer = setTimeout(() => {
        splash.hidden = true;
        clearAuthFocus();
      }, 900);
    }
  }

  /** Blocking agreement for accounts created before the current Terms (or
   * after they change). Resolves once the rider agrees; signing out reloads. */
  function requireTermsAgreement(version) {
    return new Promise((resolve) => {
      const gate = document.createElement('div');
      gate.className = 'terms-gate';
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      gate.setAttribute('aria-labelledby', 'termsGateTitle');
      gate.innerHTML = `
        <div class="terms-gate-card">
          <h1 id="termsGateTitle">Updated terms</h1>
          <p>To keep riding with others on Rider Comms, please read and agree to our Terms of Service and Community Guidelines. Abusive or objectionable content and behaviour aren’t tolerated, and anyone can report or block another rider.</p>
          <p class="terms-gate-links"><a href="terms.html" target="_blank" rel="noopener">Terms of Service</a><a href="guidelines.html" target="_blank" rel="noopener">Community Guidelines</a><a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a></p>
          <p class="inline-error" role="alert" hidden></p>
          <button type="button" class="button primary wide" data-terms-agree>I agree</button>
          <button type="button" class="button secondary wide" data-terms-signout>Sign out</button>
        </div>`;
      document.body.append(gate);
      const agree = gate.querySelector('[data-terms-agree]');
      const errorEl = gate.querySelector('.inline-error');
      agree.focus();
      agree.addEventListener('click', async () => {
        agree.disabled = true;
        errorEl.hidden = true;
        try {
          await apiFetch('POST', '/auth/accept-terms', { version });
          gate.remove();
          resolve();
        } catch {
          errorEl.textContent = 'Couldn’t save your agreement. Check your connection and try again.';
          errorEl.hidden = false;
          agree.disabled = false;
        }
      });
      gate.querySelector('[data-terms-signout]').addEventListener('click', async () => {
        try { await apiFetch('POST', '/auth/logout'); } catch { /* Local sign-out still completes. */ }
        clearSession();
        location.reload();
      });
    });
  }

  function hideAuthScreen() {
    clearTimeout(authSplashTimer);
    const splash = $('#authSplash');
    if (splash) splash.hidden = true;
    $('#authScreen').hidden = true;
    $('#app').hidden = false;
    document.documentElement.classList.remove('auth-open');
    // Auth is a fixed full-screen surface; once the real app shell becomes
    // visible, resample after paint so a cold-start standalone launch does not
    // keep the shorter pre-auth WebKit viewport until the user rotates.
    settleViewportEnvironment();
  }

  const AUTH_ERROR_MESSAGES = {
    username_taken: 'That username is already taken.',
    email_taken: 'That email is already registered.',
    invalid_username: 'Usernames must be 3–20 letters, numbers or underscores.',
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Passwords must be at least 8 characters.',
    invalid_credentials: 'Incorrect username or password.',
    account_suspended: 'This account has been suspended for breaking the community rules. Contact support if you think this is a mistake.',
    invalid_token: 'That reset code is invalid or has already been used.',
    expired_token: 'That reset code has expired. Request a new one.',
    rate_limited: 'Too many attempts — please wait a moment and try again.',
    network_error: 'Could not reach Rider Comms. Check your connection and try again.',
    timed_out: 'The request timed out. Please try again.',
    terms_not_accepted: 'Agree to the Terms of Service and Community Guidelines to create an account.',
    objectionable_username: 'That username isn’t allowed. Choose another.',
  };

  function authErrorMessage(error) {
    const code = error instanceof ApiError ? error.body?.error : undefined;
    return AUTH_ERROR_MESSAGES[code] || 'Something went wrong. Please try again.';
  }

  function applyAuthenticatedIdentity(riderId, username) {
    state.profile.riderId = riderId;
    if (!state.profile.displayName) state.profile.displayName = username;
    if (!state.profile.handle) state.profile.handle = `@${username}`;
    persist();
  }

  function applyRemoteProfile(profile) {
    state.profile.riderId = profile.riderId;
    state.profile.displayName = profile.displayName;
    state.profile.handle = profile.handle;
    state.profile.avatarId = profile.avatarId || 'ember';
    state.profile.zoneTier = planTier(profile.zoneTier);
    state.profile.unitSystem = profile.unitSystem === 'km' ? 'km' : 'mi';
    state.profile.notifyNearby = Boolean(profile.notifyNearby);
    state.profile.notifyInvites = Boolean(profile.notifyInvites);
    state.profile.notifyChat = Boolean(profile.notifyChat);
    state.unit = state.profile.unitSystem;
    state.profile.instagram = profile.instagramUsername;
    state.profile.tiktok = profile.tiktokUsername;
    state.profile.instagramVisibility = profile.instagramVisibility;
    state.profile.tiktokVisibility = profile.tiktokVisibility;
    state.profile.shareLocation = profile.shareLocation;
    persist();
    renderProfile();
    renderMapStatus();
  }

  /** Throwing profile snapshot used by the durable social event loop. */
  async function refreshProfileAuthoritative() {
    const profile = await apiFetch('GET', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`);
    applyRemoteProfile(profile);
  }

  /** UI/startup wrapper keeps the existing non-fatal profile-load behavior. */
  async function loadProfile() {
    try {
      await refreshProfileAuthoritative();
      return true;
    } catch {
      showToast('Could not load your profile from the server.');
      return false;
    }
  }

  /**
   * Replaces the backend's generic default profile ('Rider' / '@rider')
   * with one derived from the username just chosen at signup — the
   * account is brand new, so there is nothing real to overwrite yet.
   */
  async function seedProfileFromUsername(username) {
    try {
      const profile = await apiFetch('PUT', `/riders/${encodeURIComponent(state.profile.riderId)}/profile`, {
        displayName: username,
        handle: `@${username}`,
      });
      applyRemoteProfile(profile);
    } catch (error) {
      // Non-fatal — the account still exists and works with the backend's
      // own default profile; the rider can fix the name later in Settings.
      // Logged loudly (not just swallowed) since a silent failure here is
      // exactly how an account ends up permanently stuck on the generic
      // "Rider"/"@rider" default with no visible trace of why.
      console.warn('[rider-comms] Could not seed a real display name after signup', error);
      showToast('Account created — set your display name in Settings.');
    }
  }

  async function doLogin(username, password) {
    const errorEl = $('#loginError');
    const button = $('#loginSubmit');
    errorEl.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Logging in…';
    try {
      const result = await apiFetch('POST', '/auth/login', { username, password, deviceName: 'Rider Comms PWA' });
      saveSession({ riderId: result.riderId, token: result.token, emailVerified: Boolean(result.emailVerified) }, $('#rememberMe')?.checked !== false);
      applyAuthenticatedIdentity(result.riderId, username);
      // A newly authenticated rider may already belong to a ride on another
      // device. Reconcile before enabling ride location or voice in the UI.
      state.activeRide = null;
      await refreshActiveRide();
      hideAuthScreen();
      startApp();
      loadProfile();
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Log in';
    }
  }

  async function doSignup(username, email, password) {
    const errorEl = $('#signupError');
    const button = $('#signupSubmit');
    errorEl.hidden = true;
    if (!USERNAME_PATTERN.test(username)) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.invalid_username;
      errorEl.hidden = false;
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.weak_password;
      errorEl.hidden = false;
      return;
    }
    if (!$('#signupTerms').checked) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.terms_not_accepted;
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Creating account…';
    try {
      const result = await apiFetch('POST', '/auth/signup', { username, email, password, deviceName: 'Rider Comms PWA', acceptTerms: true });
      saveSession({ riderId: result.riderId, token: result.token, emailVerified: Boolean(result.emailVerified) });
      applyAuthenticatedIdentity(result.riderId, username);
      hideAuthScreen();
      startApp();
      showToast(result.emailVerificationSent
        ? 'Account created. Check your email to verify it.'
        : 'Account created, but the verification email could not be sent. Verified-only features such as Nearby Voice will remain unavailable until email delivery is restored.');
      await seedProfileFromUsername(username);
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.textContent = 'Create account';
    }
  }

  async function requestPasswordReset(email) {
    const errorEl = $('#recoverError');
    const button = $('#recoverSubmit');
    errorEl.hidden = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await apiFetch('POST', '/auth/password-reset/request', { email });
      $('#resetToken').value = '';
      setAuthMode('reset');
      const notice = $('#authNotice');
      notice.textContent = 'If that address belongs to an account, a one-hour reset link and code has been sent.';
      notice.classList.remove('error');
      notice.hidden = false;
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Send reset link';
    }
  }

  async function resetPassword(token, password) {
    const errorEl = $('#resetError');
    const button = $('#resetSubmit');
    errorEl.hidden = true;
    if (password.length < 8 || password.length > 128) {
      errorEl.textContent = AUTH_ERROR_MESSAGES.weak_password;
      errorEl.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Resetting…';
    try {
      await apiFetch('POST', '/auth/password-reset/confirm', { token, password });
      clearSession();
      setAuthMode('login');
      const notice = $('#authNotice');
      notice.textContent = 'Password updated. Sign in again on each device.';
      notice.classList.remove('error');
      notice.hidden = false;
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Reset password';
    }
  }

  let authFormsWired = false;
  let setAuthMode = () => {};
  function wireAuthForms(initialResetToken = '') {
    if (authFormsWired) {
      if (initialResetToken) { $('#resetToken').value = initialResetToken; setAuthMode('reset', false); }
      return;
    }
    authFormsWired = true;
    const authCopy = {
      login: {
        eyebrow: '',
        title: 'Welcome back',
        description: 'Good to see you again.',
      },
      signup: {
        eyebrow: 'New rider',
        title: 'Create your account',
        description: 'Set up your Rider Comms identity and keep your rides and rider circle across devices.',
      },
      recover: {
        eyebrow: 'Account recovery',
        title: 'Get back in',
        description: 'Request a one-hour reset link without revealing whether an account exists.',
      },
      reset: {
        eyebrow: 'Secure reset',
        title: 'Choose a new password',
        description: 'Enter the one-hour code from your email. Every existing session will be signed out.',
      },
    };

    setAuthMode = (target, moveFocus = true) => {
      const mode = typeof target === 'string' ? target : target.dataset.authMode;
      $$('.auth-segmented [data-auth-mode]').forEach((item) => {
        const selected = item.dataset.authMode === mode;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      const forms = { login: $('#loginForm'), signup: $('#signupForm'), recover: $('#recoverForm'), reset: $('#resetForm') };
      Object.entries(forms).forEach(([name, form]) => { form.hidden = name !== mode; form.setAttribute('aria-hidden', String(name !== mode)); });
      const extras = $('#authLoginExtras');
      if (extras) extras.hidden = mode !== 'login';
      $$('.auth-error').forEach((item) => { item.hidden = true; });
      $('#authNotice').hidden = true;
      const copy = authCopy[mode];
      $('#authEyebrow').textContent = copy.eyebrow;
      $('#authTitle').textContent = copy.title;
      $('#authDescription').textContent = copy.description;
      const focusTarget = { login: $('#loginUsername'), signup: $('#signupUsername'), recover: $('#recoverEmail'), reset: $('#resetToken') }[mode];
      if (moveFocus) focusTarget.focus();
    };

    $$('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => setAuthMode(button));
    });
    $$('.auth-segmented [data-auth-mode]').forEach((button) => {
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const target = button.dataset.authMode === 'signup' ? $('#loginTab') : $('#signupTab');
        setAuthMode(target);
        target.focus();
      });
    });
    $$('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      const use = button.querySelector('use');
      if (use) use.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }));
    $('#loginForm').addEventListener('submit', (event) => {
      event.preventDefault();
      doLogin($('#loginUsername').value.trim(), $('#loginPassword').value);
    });
    $('#signupForm').addEventListener('submit', (event) => {
      event.preventDefault();
      doSignup($('#signupUsername').value.trim(), $('#signupEmail').value.trim(), $('#signupPassword').value);
    });
    $('#forgotPasswordBtn').addEventListener('click', () => setAuthMode('recover'));
    $$('.auth-back-login').forEach((button) => button.addEventListener('click', () => setAuthMode('login')));
    $('#recoverForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void requestPasswordReset($('#recoverEmail').value.trim());
    });
    $('#resetForm').addEventListener('submit', (event) => {
      event.preventDefault();
      void resetPassword($('#resetToken').value.trim(), $('#resetPassword').value);
    });
    if (initialResetToken) { $('#resetToken').value = initialResetToken; setAuthMode('reset', false); }
    else setAuthMode('login', false);
  }

  function consumePasswordResetLink() {
    const params = new URLSearchParams(location.search);
    const token = params.get('resetToken') || '';
    if (!token) return '';
    params.delete('resetToken');
    const remaining = params.toString();
    history.replaceState({}, '', `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
    return token;
  }

  async function consumeEmailVerificationLink() {
    const params = new URLSearchParams(location.search);
    const token = params.get('verifyToken');
    if (!token) return null;
    params.delete('verifyToken');
    const remaining = params.toString();
    history.replaceState({}, '', `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
    try {
      await apiFetch('POST', '/auth/verify-email', { token });
      return { ok: true, message: 'Email verified. Your Rider Comms account is ready.' };
    } catch (error) {
      const code = error instanceof ApiError ? error.body?.error : undefined;
      return {
        ok: false,
        message: code === 'expired_token'
          ? 'That verification link has expired. Sign in and request a new one.'
          : code === 'invalid_token'
            ? 'That verification link is invalid or has already been used.'
            : 'Email verification could not be completed. Check your connection and try the link again.',
      };
    }
  }

