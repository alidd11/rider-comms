# Data retention schedule

This is the retention schedule the backend enforces today. Every window below
comes from the code named in the last column; if the two disagree, the code is
authoritative and this file must be corrected.

Deletion happens in three ways:

- **Scheduled sweeps**: `backend/src/server.ts` runs each cleanup once at
  startup and then on a timer (auth records hourly; rate-limit events every
  15 minutes; social activity/events hourly; the retention sweep in
  `backend/src/retentionStore.ts` every 15 minutes). Each run logs a structured
  `*_cleaned` / `retention_sweep_completed` line with row counts, or a
  `*_failed` line on error.
- **Request-path pruning**: some reads also delete stale rows they touch. The
  sweeps above make sure this also happens when nobody is making requests.
- **Account deletion**: `DELETE /auth/me` removes everything tied to the rider
  in one transaction (`backend/src/accountDeletionStore.ts`), whatever the
  schedule below says.

## Schedule

| Data | Kept for | Deleted by | Source |
| --- | --- | --- | --- |
| Account (username, email, password hash) | Until the rider deletes their account | Account deletion | `accountDeletionStore.ts` |
| Rider profile, avatar, social handles and visibility | Until account deletion | Account deletion | `accountDeletionStore.ts` |
| Login sessions | 30 days from sign-in, or until logout/revocation | Hourly auth sweep | `ACCOUNT_SESSION_TTL_MS`, `authStore.ts` |
| Email-verification tokens | 24 hours | Hourly auth sweep | `VERIFICATION_TOKEN_TTL_MS`, `authStore.ts` |
| Password-reset tokens | 1 hour | Hourly auth sweep | `PASSWORD_RESET_TOKEN_TTL_MS`, `authStore.ts` |
| Public nearby presence (live coordinates) | Served for 30 s; stored at most 1 hour | 15-minute retention sweep (and on presence updates) | `PresenceStore` 30 s window; `PRESENCE_RETENTION_MS` |
| Private-ride coordinates | Served for 30 s; stored at most 1 hour | 15-minute retention sweep (and on ride-location reads) | `RIDE_LOCATION_MAX_AGE_MS`; `RIDE_LOCATION_RETENTION_MS` |
| Private-ride join codes | 12 hours | 15-minute retention sweep | `shared/src/rideCode.ts`; `retentionStore.ts` |
| Private rides and membership | Until the host ends the ride, or 30 days after creation | Ride end / 15-minute retention sweep | `RIDE_RETENTION_MS` |
| Hazard reports and their votes | 1 hour (police, camera, hidden police, checkpoint), 2 hours (accident), 8 hours (road closure) | 15-minute retention sweep (votes cascade) | `ttlMsForType`, `shared/src/hazards.ts` |
| Friendships and friend requests | Until removed/cancelled or account deletion | User action / account deletion | `friendStore.ts` |
| Direct messages and read state | Until account deletion of either participant | Account deletion | `messageStore.ts` |
| Hideouts | Until deleted by their creator or account deletion | User action / account deletion | `hideoutStore.ts` |
| Social realtime events | 7 days | Hourly social sweep | `SOCIAL_EVENT_RETENTION_MS` |
| Social "last seen" activity | 30 days | Hourly social sweep | `SOCIAL_ACTIVITY_RETENTION_MS` |
| Blocks | Until unblocked or account deletion | User action / account deletion | `moderationStore.ts` |
| Safety reports (moderation evidence, with review status) | Until account deletion of the reporter or the reported rider | Account deletion | `moderationStore.ts` |
| Moderation audit log (decisions, notes, moderator ID) | Until account deletion of the rider the decision was about | Account deletion | `moderationStore.ts`, `MODERATION.md` |
| Scenic routes submitted by a rider | Until deleted or account deletion | Account deletion | `scenicRouteStore.ts` |
| Rate-limit counters | The longest policy window (10 minutes) | 15-minute rate-limit sweeps | `rateLimitStore.ts`, `socialRateLimitStore.ts` |
| Directions route cache | 5 minutes, in process memory only | Cache TTL / process restart | `directionsCache.ts` |
| Place search results | Not stored server-side (Google Places terms) | n/a | `placesProvider.ts` |
| HTTP request logs | Per the hosting provider's log retention | Hosting provider | Structured logs from `server.ts` |

## Open decisions before public launch

These need an owner decision, not just code:

- **Direct messages** are kept indefinitely while both accounts exist. Decide
  whether to add an age limit (for example 12 months) and say so in the privacy
  policy.
- **Safety reports and the moderation audit log** are kept until the account
  they concern is deleted. Decide whether resolved reports and audit entries
  should expire sooner (for example 2 years after closure), and whether audit
  entries should outlive account deletion for repeat-abuse cases.
- **Backups** contain everything above, including data later deleted from the
  live database. The backup retention period (see `BACKUP_RESTORE.md`) must be
  stated in the privacy policy, because deleted accounts persist in backups
  until those backups expire.
- **Hosting logs** include request paths and client addresses. Confirm the
  provider's log retention and state it in the privacy policy.
