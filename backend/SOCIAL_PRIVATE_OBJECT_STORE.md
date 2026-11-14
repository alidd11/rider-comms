# Rider Social private S3 object transport

The private object transport is deliberately **server-only**. It signs requests to the existing Railway `social-private-media` S3 bucket; it does not expose any upload or playback endpoint and cannot be called by the Social PWA.

## Storage configuration

The backend provides `SOCIAL_MEDIA_S3_ENDPOINT`, `SOCIAL_MEDIA_S3_BUCKET`, `SOCIAL_MEDIA_S3_REGION`, `SOCIAL_MEDIA_S3_ACCESS_KEY_ID` and `SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY`. All live on Railway's backend service as variable references, not in source, logs or any public bundle. Missing configuration disables this module; partial or insecure configuration throws before any network request.

Railway's current bucket uses **virtual-hosted** style; the module defaults to this. Legacy path-style is supported only through explicit `SOCIAL_MEDIA_S3_URL_STYLE=path` on the backend.

## Restrictions

- Only cryptographically random `social/processed/<uuid>.jpg|png|webp|mp4` keys are accepted. The key is generated on the backend, never chosen by a user.
- AWS Signature V4 signs a full SHA-256 hash of outgoing bytes, the target host, date and content type. No `UNSIGNED-PAYLOAD`, public bucket ACLs or credential exposure.
- PUT is bounded to 80 MiB and allowed processed MIME formats. It is **not** an original-user-upload handler.
- Server-to-bucket fetch uses HTTPS, no redirects, no cookies and a bounded deadline. S3 errors and network errors produce only a generic storage failure.
- DELETE succeeds idempotently on 2xx or a missing (404) object. It is intended for a future durable retryable deletion outbox.

## Mandatory work before public publishing

1. Review separate MIME/magic-byte intake policy PR #498 with Claude, the main backend owner.
2. Implement streaming authenticated upload sessions with exact size checks, independent durable rate limits, verified-email/Terms/age gates and safe object ownership.
3. Quarantine and fully decode originals; scan for unsafe content and malware, strip all EXIF/GPS/metadata and re-encode images and transcode videos in isolated workers. A signature check is not a sanitizer.
4. Only sanitized, approved bytes may reach `SocialPrivateObjectTransport.putProcessed`, and only after processing approval. The transport does not itself certify sanitization.
5. Maintain a durable Postgres ownership/state model and a retryable storage-delete outbox. User account deletion must cover Social metadata, object revocation and storage cleanup.
6. Require author suspension, audience, both-way block, report/moderation and child-privacy checks for every API response. Never return a raw S3 URL or server-side signed request to the app.
7. Test with separate real consenting accounts on PWA/native, including cross-user access attempts, malformed uploads, processing outages, revocation and deletion failures.

This PR adds only a transport and mocked-network tests under `backend/`. It does not modify `server.ts`, routes, shared packages, migrations, CI, mobile or the main web app. Release capability flags remain disabled. Claude retains backend integration ownership.
