# Rider Comms engineering audit

Audit date: 2026-09-15

Rider Comms remains a pre-alpha. This branch hardens the prototype boundary with authenticated guest sessions, actor-based API authorisation, opt-in foreground location, server-controlled zone entitlements, complete private-ride lifecycle operations, bounded inputs and rate limiting, honest billing UI, and protected Instagram/TikTok profile fields with per-network visibility.

Production release remains blocked by durable database-backed accounts and revocable sessions, real voice rooms and motorcycle headset testing, a production map/navigation SDK, store-verified purchases, staffed moderation and persistent reports, observability, backups, accessibility testing, and moving-state safety controls. This branch now includes prototype block/report controls and in-app account deletion, but those do not replace the required production operations.

The proposed video feed must disable playback, posting, comments and scrolling when sustained movement is detected. Scenic routes require moderated community submissions, vehicle-suitability metadata, live hazard reporting, and clear warnings that road conditions can change.

Verification on 2026-09-15: repository type-check passed; 79 automated tests passed; Expo Doctor passed 21/21 checks; Android and iOS production Metro exports passed; `git diff --check` passed.
