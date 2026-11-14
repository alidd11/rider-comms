# Rider Social media intake: fail-closed policy

This document governs **future** uploads to the private Railway `social-private-media`
bucket (Amsterdam region). Storage credentials are only on the existing backend.
**No public upload, posting, playback, transcoding or object-access endpoint is enabled
by this PR.** Never expose direct S3 keys or URLs to browsers.

The first-stage policy in `socialMediaPolicy.ts` accepts only declared JPEG,
PNG, WebP up to 12 MiB each, or MP4 up to 80 MiB. It checks exact MIME values,
safe integer byte lengths and leading file signatures. Header checks are not
malware detection and do not make polyglot, truncated or spoofed files safe.

## Mandatory server pipeline before enabling publishing

1. Authenticate the existing Rider Comms bearer session. Require verified email,
   current accepted Terms, age safeguards and suspension checks. Bound requests
   independently of the shared 300/minute API budget using a durable upload rate
   limit. Impose per-account daily bytes and concurrent-job limits.
2. Create a short-lived, account-bound upload intent with a random object key and
   an idempotency key. Never trust a supplied rider ID or object key. Enforce
   Content-Length and streaming limits; verify the actual byte count and checksum.
3. Quarantine raw input in private storage; limit lifetime and purge failed jobs.
   Use isolated scanners and trusted image/video parsers. Reject invalid bytes,
   decompression bombs, scripts, embedded files and unsupported codecs.
4. Re-encode images/video into safe delivery formats and **strip all EXIF,
   GPS, comments and time/location metadata**. Generate thumbnails from the
   sanitized result. Do not serve raw originals.
5. Run applicable content policy, child-safety, copyright and staffed moderation
   review before changing post state to published. Fail closed on scanner outages.
6. Read access must check content state, author suspension, audience and both-way
   blocks on the server, then issue an ephemeral signed playback grant. Avoid
   permanent public CDN/S3 URLs. Never disclose map or ride positions.
7. Store media ownership and retention metadata transactionally. Revoke playback
   and issue deletion jobs on post/account deletion, with retryable storage cleanup
   and tested idempotence. Account deletion must cover the social schema **and**
   its object storage.
8. Test at least two accounts, stale grants, cross-user key guesses, block/
   unblock, file-type forgery, actual byte caps, malformed media, processing
   failures, deletes, audit logs, CORS, iOS web/native flow and signed URL expiry.

`SOCIAL_OPEN_BETA_ENABLED=true` only removes the *invitation* allowlist. It does
not bypass any of the above, and existing `SOCIAL_PILOT_CAPABILITIES.mediaUpload`
remains `false`. The main Rider Comms `/social/events` endpoint is unaffected.

## Multi-agent coordination

Claude owns the main app, native app, shared code and most backend/CI work.
This isolated contract changes only `backend/src/socialMediaPolicy.ts`,
`backend/tests/socialMediaPolicy.test.ts` and this document; it does not
alter server middleware order, main-app routes or any active PR branch.
