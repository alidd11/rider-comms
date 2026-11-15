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

## Open testing beta (14 November 2026 owner decision)

The owner has explicitly authorised **open testing for authenticated Rider Comms accounts** instead of an ownership/management-only pilot. Configure `SOCIAL_OPEN_BETA_ENABLED=true` **on the backend service only**, after the code change is tested and deployed. No rider ID list is necessary in this mode.

- The server still authenticates every request with its existing Rider Comms session. Invalid or revoked credentials receive 401.
- `GET /social/bootstrap` then returns `entitlement: "beta"`, `policyVersion: "social-open-beta-v1"` and all six existing capabilities **false**.
- The reserved `/social/*` product routes still return 404 until individually implemented, validated and security-reviewed. This flag is **not** an instruction to enable unmoderated publishing or unchecked uploads.
- Without this explicit setting, the original allowlist fail-closed behaviour is unchanged. To pause open testing, remove or set the variable to `false` and redeploy; existing pilot allowlist rules then apply.
- Existing routes such as `/social/events`, `/messages` and `/auth/*` retain their independently enforced policies.

### Storage plumbing (not a publishing feature)

A private Railway S3-compatible bucket named `social-private-media` is provisioned in the existing Rider Comms backend project's production environment. Five `SOCIAL_MEDIA_S3_*` variables (`ENDPOINT`, `BUCKET`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`) reference bucket credentials **only on the backend service**. They were set with deployment skipped because the current backend does not yet consume them.

Do not copy secret values to the Social static Expo bundle, GitHub or logs. This connection alone does not provide upload signing, media validation, scanning, transcoding, privacy-safe playback or deletion. Keep `mediaUpload` and publishing capabilities disabled until the secure implementation passes tests.

## Posting: photos and Reels (15 November 2026)

Posting has its own switch: uploads and new posts work only with `SOCIAL_POSTING_ENABLED=true` **and** the five `SOCIAL_MEDIA_S3_*` variables set. Opening the beta (`SOCIAL_OPEN_BETA_ENABLED`) or configuring storage does not turn posting on. With the switch off, `/social/bootstrap` reports `mediaUpload` and `publicPosting` as false and `POST /social/media` and `POST /social/posts` answer `503 social_posting_disabled`. Feeds still read. Every other capability (private audiences, live streaming, checkout, payouts) stays false. Without storage, Social stays read-only and the routes below answer `503 social_media_not_configured`.

Don't set `SOCIAL_POSTING_ENABLED` until the owner has decided on content scanning.

- `POST /social/media`: the raw file with its `Content-Type` and `Content-Length`. Accepts JPEG, PNG and WebP up to 20 MB, and MP4, QuickTime and WebM up to 200 MB and 60 s.
  - The body streams to a private temp file and the type is checked against the file's first bytes.
  - Photos are re-encoded as JPEG (at most 2048 px) by `sharp`. Videos are re-encoded as H.264/AAC MP4 (at most 1280 px), with a poster frame, by `ffmpeg-static`, one at a time and with a short queue (`503 media_busy`).
  - Re-encoding removes GPS, camera and other metadata. ffmpeg may only open local files, with the one demuxer the declared type allows.
  - Only the processed files are stored. Needs a verified email and current Terms. Limited to 40 uploads an hour.
  - Before writing, the upload's storage keys are queued for deletion an hour later. Saving the upload's record releases them, so a file whose record never lands (a storage or database failure, a crash) is still deleted.
- `POST /social/posts` `{kind: 'photo'|'reel', caption, mediaIds}`: 1–6 photos or one video. Each upload can be used once and only by the rider who uploaded it. Captions are checked by the severe-content filter. Limited to 15 posts an hour.
- `GET /social/feed?scope=for-you|following|reels`, `GET /social/riders/:id/posts`, `GET /social/posts/:id`, `DELETE /social/posts/:id` (author only).
  - Feeds leave out blocked riders (both ways), posts the viewer reported, hidden posts (except to their author) and suspended riders.
  - "Following" means Rider Comms friends.
- `POST /social/posts/:id/report` `{reason, details?}`:
  - The reporter stops seeing the post at once.
  - Three distinct reports hide it for everyone until a moderator decides.
  - Each report also goes into the existing safety report queue.
- `GET /moderation/social-posts`, `POST /moderation/social-posts/:id/(restore|remove)`: admins only.
- Media is served by `GET /social/media/:id/(file|poster)?v&s&exp&sig`, before sign-in, because `<img>` and `<video>` can't send a token.
  - The HMAC link names one rider, the signed-in session it was issued to, and one file. It lasts 20 to 30 minutes, and stops working as soon as that session signs out or is revoked.
  - Every request re-checks that the session is still signed in and that the rider may still see the post (for staff, that they are still an admin). It supports byte ranges, and the bytes may be cached only for as long as the link lasts.
  - The Social app fetches a post again when one of its photos fails to load, and reloads Reels every 15 minutes, so links are refreshed before they expire.
  - The link key is derived from the storage secret unless `SOCIAL_MEDIA_URL_SECRET` (32+ characters) is set.
- Deleting a post, an account or an unused upload (after 6 hours) queues the stored files in `social_media_delete_outbox`. A maintenance job empties the queue every 5 minutes.
