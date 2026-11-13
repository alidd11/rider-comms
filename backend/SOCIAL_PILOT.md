# Rider Social backend pilot admission (stage 1)

This independent backend PR is **only** the server-side beta entitlement and
bootstrap foundation requested by issue #466. It does not enable a Social
media service, upload, public UGC, marketplace or creator payment.

## Configure

Set `SOCIAL_PILOT_RIDER_IDS` on the **backend Railway service only** to a
comma-separated list of the explicitly authorised Rider Comms account IDs,
for example `rider_example123` in a test environment. The example is not a
valid account. Do **not** configure it in public Expo variables or the static
Social web bundle.

An unset, empty or partially invalid value fails closed (no invited riders).
Exact IDs are checked from the server-verified bearer session; the response
never lists other invited IDs. Configuration changes on Railway require the
backend deployment/restart to apply, including revocations. Do not claim
dynamic revocation is immediate without a restart.

## API

- `GET /social/bootstrap`: `401` without a valid Rider Comms session,
  `403 {"error":"social_beta_not_enabled"}` without server entitlement,
  `200` for an invited account with `entitlement: "pilot"`,
  `policyVersion: "social-pilot-v1"` and all UGC/commerce capabilities **false**.
- Other reserved `/social/*` product endpoints require the same entitlement
  and remain **404/not implemented** for an approved pilot until secure server
  media, moderation, privacy and deletion services actually exist.
- Existing Rider Comms `/social/events` is a legacy authenticated push/polling
  feature used by the main app and is deliberately outside this **new product**
  permission boundary. Existing friendships, profiles, rides and DMs are also
  unaffected by this new beta entitlement.

All API responses are `Cache-Control: no-store`. No additional public route,
token in query string, or client-only rider allowlist is created.

## Before the Social client can use this

1. Verify backend PR exact-head CI and security review; merge deliberately,
   deploy the backend, configure the real rider ID privately, and verify using
   two independent disposable test accounts (invited 200, uninvited 403).
2. Add `/social/bootstrap` check in Social client **before rendering the app**:
   show a clear non-pilot/temporarily-unavailable state. Do not let a client
   exception treat a failed request as entitlement success.
3. Add private media ingestion, scanning/EXIF stripping, storage, playback,
   delete, privacy/age gates, report/block/moderation/appeals and processor
   retention separately. Keep every capability disabled until tested.

No customer ID or secret is committed in this change. This is a security
foundation, **not** issue #466 completion or a release approval.
