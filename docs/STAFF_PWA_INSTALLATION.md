# Rider Comms Staff — installable Operations Hub PWA

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

## QA and limitations
Backend regression covers invalid credentials, refusal and token revocation for ordinary riders, active staff login, `/admin/me` permissions and logout revocation. Playwright checks the independent installed login screen, manifest, valid sign-in, staff-only rejection, password-clearing errors, and sign-out.

The Playwright configuration blocks service workers to make API mocks deterministic; it therefore tests **app logic and metadata**, not actual on-device iOS installation. Manual Safari and Chromium installation, session persistence after force-closing, reauthentication and offline/no-network behaviour still need real-device validation before a full production rollout.

## Further improvements (not included in this increment)
Formal support tickets/appeals, cursor-paginated moderation work, provider-verified billing operations, staff MFA, device revocation UI and production operational switches all require separately scoped backend contracts and security/privacy reviews. These features are not yet represented as live.
