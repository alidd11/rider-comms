# Social discovery and ranking — v0 architecture

**Implemented as deterministic pure functions:** \`social/mobile/src/recommendations.ts\` with cross-surface policy tests in \`tests/recommendations.test.ts\`.

This is **not** a trained recommender, production backend ranking service or advertising auction. It is a secure-by-default domain prototype that makes policy, ranking signals and test expectations explicit, ready for backend integration after Claude's Rider Comms scope settles.

## Eligibility before scoring

- Published / not removed; correct visibility and club visibility; author consents to public sharing.
- No posts from blocked/muted users, hidden IDs or hidden topics.
- No content beyond the viewer's verified age floor.
- Public For You and Reels never return private/approval/member-only club content.
- Following supports follower-only or authorised club content, but only from followed authors.
- Events: only public upcoming active events with capacity and eligible organisers.
- Clubs: no private or suspended clubs in general discovery.
- Marketplace: only active available listings from verified, **commerce-approved**, payout-enabled, unsuspended businesses.
- Advertising: separately eligible inventory; approved, funded, age-restricted, frequency capped, labelled **Ad**.

**Production requirement:** enforce all authorisation server-side, before retrieval or serialization. UI filtering or TypeScript type rules are not security boundaries. Use authenticated server-derived viewer capabilities, not arbitrary client-sent age claims.

## Organic rankers

| Surface | Signals | Requirements |
| --- | --- | --- |
| For You | Chosen interests, recentness, bounded quality/engagement, small creator chance | Per-creator diversity, negative-feedback exclusion, explainable reason |
| Following | Explicit follow relationships | Strict newest-first option; relevance sorting separately |
| Reels | Similar to For You, with bounded completion-rate input | Never directly use unbounded watch-time totals |
| Clubs | Chosen interests, active members, mutual connections, optional broad region | Private/suspended excluded |
| Events | Chosen interests, upcoming date, event interest, optional broad region | Private/past/full/cancelled excluded |
| Marketplace | Search terms, interests, product quality and capped popularity | No paid-tier boost, non-business sellers prohibited |
| Advertising | Explicitly separate eligibility and candidate selection | No organic-rank contamination, must show “Ad” label |

The current policy uses **no live GPS, ride history, DMs, precise location, intimate categories, payment balances or personal documents** to rank content or ads.

Selected region is only a voluntary **broad region**. Recommendation personalisation can be disabled; a teen-safe preference default must be enforced by the real backend based on regional policy, not just this sample.

## Future production integrations

1. Authenticated server ingestion: moderated content, club access, age assurance, user interests (with consent), events and verified inventory; indexed candidate retrieval and feature freshness.
2. Feedback processing: explicit Not Interested, hide, block, save, follow. Rate limit and resist engagement manipulation; prevent cross-user leakage.
3. Versioned ranking policy and kill switches per region/age/surface; feature audit logs with minimal retention. Separate feature flags for personalisation and ads.
4. Experimentation: offline replay and calibration, online holdout/A-B metrics, audit logging, reproducible ranking version; safety before engagement. Avoid discriminatory outcomes and runaway popularity loops.
5. Operational targets: service latency, delivery errors, new-creator coverage, active club/event discovery, merchant service quality, fraud signals, user control effectiveness and complaints.
6. Provider-appropriate advertising delivery, consent, legal review, age controls and ad frequency; **no implicit access** to the Rider Comms location or voice systems.

## Remaining implementation

- No database/candidate retrieval backend, real personalised profile, sessions, recommendation data, traffic sampling or model training.
- No storage for dislikes/interest edits; client demo state only.
- No live sponsored delivery / billing; ad selection prototype only.
- No server-side enforcement or verified merchant integration yet.

This guide is an implementation baseline, not a claim the final algorithms are finished.
