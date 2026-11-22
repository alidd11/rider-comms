# Rider Comms Staff — installable Operations Hub PWA

## Internal Company Case Desk (merged in PR #580)

The Case desk is role-gated and accessible inside both entry points after staff login. Support staff can see support cases, moderators can see internally opened appeals, administrators can see every case type including privacy requests and incidents, and analysts cannot access case details. Every staff change requires a reason and a recent password re-check. The cases are **not** external email, billing reconciliation, legal request fulfilment or live incident automation; none of those is implied by the UI.

## Entry point and installation
The **Rider Comms Staff** app is a separate installable web application at `/staff/`, using the same Origin and secured Operations Hub UI as `/admin.html` but a distinct manifest ID, URL scope, service worker and branded app name. The original rider PWA keeps its own `/` manifest and functionality.

- **iPhone/iPad:** open the staff URL in Safari, tap Share > Add to Home Screen. Open the installed app and sign in directly.
- **Android/desktop:** open the staff URL in a supporting browser and choose Install app. If `beforeinstallprompt` is supported, the staff UI exposes an install button after the browser determines it is eligible.
- The install is not a pre-granted staff session. Each installed app signs in with an existing Rider Comms username and password and must pass a fresh server-side role check.

## Login, permissions and logout
`POST /auth/staff-login` uses the same password verification, account suspension and IP+account rate limits as normal sign-in. It checks staff role **after** password validation. A non-staff rider is refused with `staff_only` and the just-created token is revoked before returning. No staff permission is granted by the UI itself.

The client checks `GET /admin/me` before persisting its bearer token under `rider-comms-staff-session-v1`. The installed app ignores the original rider session storage key, important for iOS's isolated app storage. Legacy `/admin.html` may still use an existing rider session, but can also sign in directly. A staff sign-out removes the staff key, suppresses legacy auto-reentry and requests `POST /auth/logout` for the Staff-issued token only (it does not revoke an unrelated Rider Comms session).

The existing `/admin` and `/moderation` endpoints still enforce current staff roles and recent reauthentication for sensitive actions. Staff removal, account suspension and session revocation remain server-controlled. No staff account or role is created at installation.

## Offline and deployment safety
The Staff worker caches **only static, public shell assets** and handles its own `/staff/` navigations. It never caches API responses, token storage, rider records, audit logs, sensitive report details or cross-origin traffic. Offline mode can render the shell, but cannot display authenticated data without a current backend response. The main rider worker no longer evicts the Staff worker's cache or falls back to the rider UI when navigating offline to `/staff/`.

The Pages build copies `docs/staff/` to `dist/pwa/staff/`, versions the worker cache when shell files change, and the lint command runs `scripts/check-staff-pwa.mjs`. `staff/index.html` keeps a restrictive CSP with explicit `worker-src 'self'` and `manifest-src 'self'`.

## Automatic Staff PWA updates

The Staff PWA periodically checks for a new deployed version without requiring a new Home Screen installation or App Store download. Its service worker's cache name is derived from the actual dashboard build, and the browser checks the worker script with HTTP caching disabled. The app checks when first launched, when it returns to the foreground, when connectivity returns and approximately every 15 minutes while open.

- A downloaded version becomes active automatically when the Staff workspace has been idle and no unsaved form edits, sensitive dialogs or active page loads would be interrupted.
- If an update arrives while staff are editing, a compact **App update available** notice offers **Update now** or **Later**. Update now warns before discarding unsaved changes. Later postpones automatic activation until the app returns to the foreground.
- After a new worker gains control, the dashboard reloads once to avoid running an old UI against new cached assets. The staff session is rechecked by the backend; update checks do not store or read bearer tokens.
- The worker caches only public HTML, JavaScript, CSS, fonts and icons. It does **not** download staff cases or any private API response. Offline mode remains an unauthorised shell.
- iOS may suspend or terminate background pages, so an app cannot guarantee updates while completely closed. Opening or resuming the installed Staff app is the reliable update trigger.

**Release smoke test:** install the currently deployed Staff PWA on an iPhone, deploy a changed Staff shell, relaunch it and confirm the new UI appears without re-adding the Home Screen icon. Leave a case note unsaved during an update to verify the notice appears and automatic reload is deferred. Then finish/save the note or explicitly choose Update now. Repeat on iOS WebKit and Android Chromium, online and offline.

## QA and limitations
Backend regression covers invalid credentials, refusal and token revocation for ordinary riders, active staff login, `/admin/me` permissions and logout revocation. Playwright checks the independent installed login screen, manifest, valid sign-in, staff-only rejection, password-clearing errors, and sign-out.

The Playwright configuration blocks real service workers to keep API mocks deterministic. The update-flow tests inject a simulated worker lifecycle to check activation, safe deferral and manual reload; they do **not** establish real on-device iOS service-worker behaviour. Manual Safari and Chromium installation, session persistence after force-closing, reauthentication and offline/no-network behaviour still need real-device validation before a full production rollout.

## Further improvements (not included in this increment)
Formal support tickets/appeals, cursor-paginated moderation work, provider-verified billing operations, staff MFA, device revocation UI and production operational switches all require separately scoped backend contracts and security/privacy reviews. These features are not yet represented as live.
