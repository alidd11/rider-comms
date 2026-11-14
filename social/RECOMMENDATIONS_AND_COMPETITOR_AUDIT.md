# Rider Social — recommendation, retention and competitor UX audit

**Reviewed:** 13 November 2026. **Status:** An actionable research brief and code-review baseline, not a production recommender system. Sample analytics and local sample posts cannot validate relevance or retention. PR #449 remains scoped to `social/` and its workflow.

## What is implemented today

The `social/mobile/src/recommendations.ts` deterministic v0 model exposes separate **For You, Reels, Following, Clubs, Events, Marketplace and Ads** functions. Before scoring, it filters removed/pending posts, blocks, mutes, hidden topics/content, age restrictions, audience permissions and non-public clubs; verified/approved merchants are required. Ads do not enter organic ranking. It uses weighted recency, declared interests, moderated quality, bounded engagement, limited completion rate and small-creator support; one item per author in the first diversity pass. Following supports newest-first order. These are **good design intentions**, but not safe production server authorization.

### Code audit — exact behavior

- **Verified:** `mayViewContent` excludes discovery from private/approval club content even when a post claims to be public; member-only content is not eligible for general discovery.
- **Verified:** muting, blocking, hiding topics, negative feedback and author diversity are represented in the local model. No precise coordinates, route traces or private-message text are model inputs.
- **Verified:** only approved/verified/payout-enabled merchants enter organic marketplace listing rankings, and ad selection has a frequency ceiling in the demo model.
- **Fixed:** malformed future timestamps previously got the maximum recency boost because negative age was clamped to zero. The client now awards **zero** recency score to future-dated items, with a regression test.
- **Unproven:** quality, impressions, completions and engagement are synthetic sample data. Client-supplied counters are not trustworthy server measurements. The current model has no training data, calibrated exploration, spam/bot integrity, model-version telemetry or fairness evaluation.
- **Risk:** one-creator-per-pass diversity is desirable but simplistic; it can over-represent lower-quality content or bury authentic specialist creators. Explore topic, format and size diversity with safety and relevance constraints, not fixed quotas or fake engagement.
- **Risk:** `Viewer.ageFloor` in a demo does not represent legally verified age. All eligibility, audience and block logic must be rechecked **before candidate retrieval and delivery** on the real backend; no feed may use the client as its security boundary.
- **Risk:** time spent watching can reward outrage, crashes and dangerous stunts. Never maximise watch time alone; model safety, negative feedback, user satisfaction and real community participation separately.

## Competitive evidence

| Reference | Established public pattern | Rider Social response |
| --- | --- | --- |
| [TikTok For You controls](https://support.tiktok.com/en/getting-started/for-you/test-for-you) | Why this post, Not interested, refresh, topic preferences, keyword filters | Provide clear reasons and straightforward suppression of unwanted content, a reset that really works, chronological Following, and no hidden engagement penalties for personal preferences |
| [Meta Recommendation Guidelines](https://about.fb.com/news/2020/08/recommendation-guidelines/) | Content can be allowed to remain available without being broadly recommendable | Decouple **content moderation** from **recommendation eligibility** and explain each independently; enable appeals |
| [Meta Edits product](https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/) | Capture, frame-accurate edit timeline, teleprompter/storyboard, caption tools, export without watermarks, creator insights | Prioritise reliable non-destructive trimming, covers, colour, text, captions, rights-clear audio and drafts before gimmicky AI effects |
| [Strava clubs and social utility](https://support.strava.com/hc/en-us/articles/216918347-Clubs-on-Strava) | Repeat visits driven by real groups and events, not just infinite feeds | Users return to their rides, builds, clubs, planning and events. Keep route/location sharing explicit |
| [Google Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB) | Moderation and reporting/blocking are ongoing, not one-time UI features | Safety is a prerequisite to ranking and publishing, including appeals and repeat-offender handling |

### Public feedback worth testing, not assuming

Community discussions (including Reddit) commonly raise concerns about repetitive recommendations, ineffective “Not interested” signals, advert clutter, unrecoverable mistakes in account moderation and creators needing extra apps to edit or export cleanly. Anecdotes alone do **not** establish their frequency or prevalence. Validate these hypotheses with opt-in research and task testing of real riders before prioritising them as facts. Avoid scraping private user data or presenting unrepresentative Reddit complaints as scientific consensus.

## Proposed production pipeline

```text
Authentication, consent, policy/age/region and account standing
  -> server-side candidate retrieval from public/allowed graph
  -> blocked/privacy/club/moderation/age eligibility gates
  -> spam/duplicate/unsafe-content checks and rights constraints
  -> relevance scoring (topics, explicit follows, content quality, recency)
  -> small-creator exploration and creator/topic/format diversity
  -> budgeted, labelled sponsored inventory in a separate placement path
  -> explanation and user controls
  -> logged, privacy-limited measurement and evaluation
```

For protected 16–17 users: high-privacy defaults, no precise location inference, sensitive category and ad targeting restrictions, and carefully assessed profiling. Use voluntary **broad-area** club/event discovery, never background rider GPS.

### Experiments and release metrics

- **Primary usefulness:** repeat active riders across both apps, successful real club/event participation, creator publish-to-view value, useful replies, search/task success, 7/28-day retention **without** manipulative loops.
- **Feed satisfaction:** explicit Not Interested rate, repeat/exposure fatigue, hide and mute precision, feedback acted on immediately, creator diversity, helpful follow conversions and preference persistence across devices.
- **Safety:** harmful content exposure rate (independently assessed), false positives, successful appeal reinstatement, spam/fraud reach, dangerous riding recommendation exposure, blocked/private leakage = **zero tolerated**.
- **Creator opportunity:** distribution by creator age/size, fraction of new creators receiving an authentic audience, follower/club diversity, rights-cleared media export and editor completion.
- **Performance:** time to first content, startup jank, frame drops, failed upload/trim, cache and bandwidth use, battery use, crash rate, iPhone notch/home-indicator geometry.
- **Experiment rules:** pre-register hypothesis, metrics and guardrails, compare meaningful control groups, block rollouts on safety regressions, do not infer causation from raw viewing time, monitor fairness under consent/minimisation rules.

## Prioritised visual interaction audit

1. **P0:** single navigation and headers, true flush bottom tabs, Dynamic Island full-bleed media without overlay bands, no duplicate controls; keyboard no jump; text contrast and actual iPhone PWA validation.
2. **P0:** real Rider Comms display name/handle, authentic Friends and DMs, no false follower count; loader, offline, error and sign-out states.
3. **P0:** camera → edit → details → publication flow must be real and moderated before claiming posting. No dead effect buttons, fake music, artificial engagement or fake checkout.
4. **P1:** Reels playback/mute, pause, seek, captions, gesture protection, creator context. Show a still image as a sample photo, **never** pretend it is playing a video.
5. **P1:** transparent For You/Following modes, feed preferences, Not Interested/Why this/chronological and no private content leaks.
6. **P1:** clubs/events discoverability with real RSVP permissions, stable member roles and requests, business profiles, verified inventory and professional content tools.
7. **P2:** creator insights based on real aggregates, editor projects and quality exports; branded pages, eligible promotions, flexible commerce and creator collaborations after backend/legal reviews.

## Native video editor strategy

- **iOS:** native AVFoundation compositions and export; real local previews, configurable trim/crop, overlay/composition and metadata stripping. https://developer.apple.com/documentation/avfoundation/avassetexportsession
- **Android:** Jetpack Media3 Transformer supports trim, crop, scaling, overlays, filters and hardware-accelerated export; evaluate an Expo custom module and device-specific failure modes. https://developer.android.com/media/implement/editing-app
- **Web/PWA:** feature-detect WebCodecs/MediaRecorder; they are not universally available. Keep a truthful import/preview workflow and use a controlled, rights-cleared server pipeline when advanced editing parity is needed. https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
- Preserve a single **non-destructive edit manifest** with media hash, source URI, ranges, crops, overlays, audio rights and export settings. Test against the same output expectations across platforms; do not promise byte-identical encodes.

## Continuous release quality loop (one iteration per audit)

1. Refresh branch/open PRs, main and exact-head CI; respect the Social-only ownership boundary and don't modify unrelated agent work.
2. Inventory screen routes, entry points and all visible pressables/links/inputs; each needs a functional destination, intentional disabled state and a test.
3. Capture **actual rendered browser screenshots** for each tab, auth/sign-up, profiles, media, modals, empty/errors, light/dark content and 390px/desktop breakpoints. Mark browser emulation as such. Record physical iPhone/Android validation separately.
4. Classify issues by safety (P0), broken action (P0), layout/parity (P1), polish (P2), feature design (backlog). Fix high-priority scoped defects, then rerun unit/domain and Playwright.
5. Reassess competitor changes and complaints using primary documentation and representative research, update product hypotheses rather than blindly copying them.
6. Produce a clear diff, CI head SHA, screenshots, before/after issues, blockers and 'Requests for Rider Comms' for backend/infrastructure dependencies.

No artificial “100% perfect” certification is possible. The goal is **evidence-based progression** with explicit acceptance criteria and no unresolved critical release blockers.

## Requests for Rider Comms

- Secure server-side social candidate and moderation eligibility; authoritative engagement and feedback metrics, consent/policy and appeal status.
- Versioned Social profiles/graph and private club/event APIs with audience and minor protections.
- Media processing and rights management; abuse/report/appeal/retention infrastructure and moderation workforce.
- Privacy-safe analytics data contract and experiment flags; cross-client revocation, deletion, block and accessibility parity.
