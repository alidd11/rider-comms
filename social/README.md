# Rider Comms Social — separate application

This directory contains the **new, independently installed social application** within the existing Rider Comms monorepo. It is intentionally independent of the Rider Comms navigation application.

## Scope and current status

- Social-focused: For You / Following, Reels, Stories, clubs, events, garages, verified-business commerce, creator features.
- Shared ecosystem *later*: accounts, unique username, friendships and direct messages.
- Existing Rider Comms client, PWA and backend are **not changed** by this foundation.
- `mobile/` is a **UI foundation using local demonstration data only**. No real accounts, payments, video streaming, uploads, age checks, messages, merchant verification or persistence are implemented. The demo interface labels unconnected actions as previews.
- Neither app is required to install the other. Both will eventually have separate release pipelines and app-store identities.

## Run independently

From `social/mobile/`:

```sh
npm install
npm run typecheck
npm test
npm run web
```

The independent GitHub Actions workflow at `.github/workflows/social-app.yml` checks the social package's TypeScript, domain tests and static web export. It deliberately does not build or modify the existing Rider Comms application.

The prototype uses Expo SDK 58 and React Native to target iOS, Android and web. It is deliberately a separate npm package for now, **not a root workspace**, so Claude's existing root lockfile, workspace graph, CI and releases remain undisturbed. Pin dependencies in this package before commercial releases.

## Agent ownership / integration boundary

- Only modify `social/**` for this workstream until explicitly coordinated.
- Do not import Rider Comms' backend implementation or change shared migrations to make the prototype run.
- Treat private ride, location, presence, navigation and live voice information as **never available to the social app by default**.
- Future shared auth, friend graph and DMs need versioned APIs, permission checks, migration design and cross-client tests; keep social-specific content and user profile data in social-specific resources.
- Check open PRs and exact-head CI before integration; do not change Claude's branches.
- No use of real businesses, usernames, actual user posts or copyrighted media as demo inventory without permission.

See [PRODUCT_SPEC.md](PRODUCT_SPEC.md) for agreed product direction and release boundaries.


## Preview interaction milestone

The standalone PWA now contains local-only demonstration journeys for:
- Editing the **Social** profile display name, biography and profile visibility (not Rider Comms identity or username).
- Adding up to 12 vehicles (cars / motorcycles / bicycles) to a private-by-default garage, changing their visibility and removing them with confirmation.
- Opening event details, reviewing organiser and venue privacy messaging, and recording **session-only** demo interest.
- For You / Following, Reels, clubs and marketplace with deterministic v0 recommendation and eligibility filters.

The social profile and garage demo state are stored in this device's app storage through AsyncStorage. Nothing is sent to the existing Rider Comms backend or to other users; clearing browser site data removes them. Do not use the preview as a backup or for sensitive data.

Independent social CI includes TypeScript, unit tests, static web export, mobile/desktop Chromium interaction tests and screenshot artifacts. GitHub PR #449 remains a draft until reviewed. The live demonstration PWA is hosted separately from Rider Comms on Railway and automatically deploys this development branch. Root CI and existing Rider Comms native/web releases remain separate.


## Edge-to-edge viewport and safe areas

- The generated web HTML now requires `viewport-fit=cover` and non-translucent iOS standalone status-bar mode.
- `html`, `body`, and the React root are all dark to the physical viewport edges, including behind the notch/status bar.
- Content has top/side insets using CSS `env(safe-area-inset-*)` on web and React Native safe-area values on iOS/Android.
- The tab bar owns its bottom safe-area padding; no separately coloured spacer/band is rendered under it.
- The Home indicator and status text remain under OS control. They must not be obscured by clickable controls.
- Browser tests assert viewport metadata, full-width/full-height surfaces and uniform background colours. Only a physical iPhone Home Screen test can fully confirm status-bar rendering.


## Visual demo photography

The prototype uses externally hosted, free Unsplash photography to illustrate a media-first feed. These photographs are **sample imagery**, not user uploads. Fictional demo creators are not the real photographers and do not endorse the service.

Before production, move media to a moderated, rights-checked and optimised content pipeline, preserve correct source and photographer metadata, and provide upload permissions. Source references: Unsplash motorcycle photograph (photo ID `1558981806-ec527fa84c39`), car photograph (ID `1625932197913-68755c94c51f`), cyclist photograph (ID `1517649763962-0c623066013b`), garage photograph (ID `1511994298241-608e28f14fde`). Verify rights and any depicted trademarks/person releases before commercial launch.


### Installed iPhone PWA bottom-gap corrective action (2026-11-12)

The installed Social PWA now selects the iOS `black` status-bar mode instead of `black-translucent`. Current WebKit reports document a standalone iOS 26/27 viewport mismatch that can leave an unusable strip below an app with the translucent setting (WebKit bug 313800, related bug 236445). The root React Native Web wrapper is explicitly a full-height flex column and the tab bar is non-shrinking, with safe-bottom padding inside the bar. In non-translucent standalone mode, the status-bar is owned by iOS; the app avoids adding a duplicate top inset. A browser-only geometry check cannot prove physical iPhone Home Screen behaviour; verify on device before treating the visual regression as closed.


## Immersive Home/Reels milestone

- Stories appear before the Home feed selector, and feed media uses a more immersive portrait canvas.
- Demo follows update the independent Social following feed, without changing Rider Comms friendships.
- Reels uses a stationary full-height surface, one snap-paginated card per item, creator actions, separate follow toggles, and a direct creation shortcut.
- Reels currently displays **labelled photographs**, not real playable videos. Comments, shares, audio, livestreams, media publishing and the recommendation data pipeline are not live.
- These are original automotive-oriented interactions informed by public Instagram/TikTok product behaviour; they are not a pixel-identical clone or competitive feature parity.


The Stories demo also uses a full-viewport image viewer with visible previous/next regions, sequence markers, sample creator information and an exit control. It never submits replies or pretends that Story media has been published; the real 24-hour lifecycle requires authenticated backend services.


## Content interaction milestone — 2026-11-12

- Home feed: swipeable up-to-six-image galleries with counters and visible next/previous affordances for accessibility, double-tap-to-like with brief heart feedback, and session-only likes/saves. Photos remain curated sample assets; they're not user uploads.
- Comments: a reusable bottom sheet for both Home and Reels. Users can type a local preview comment without a server; no messages are published or represented as other users' comments. Backend ownership, reporting, rate limits, spam defence, blocks and ages must be enforced before publication.
- Creator discovery: tap an author or `View build & garage` for fictional public creator builds; open the corresponding club from that preview. Creator public garage is not the authenticated user's private garage and does not leak Rider Comms profile or location.
- Reels video architecture: when a vetted video URL is supplied, expo-video mounts only the active Reel, plays muted/looped, pauses on transition and allows tap to pause. Present sample Reels remain still photos with an explicit indicator. No audio licensing or production video publishing is assumed.
- Editorial references: [Expo video SDK](https://docs.expo.dev/versions/v58.0.0/sdk/video/), [TikTok recommendation explanation](https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content), and Meta's feed/product guidance. Production recommendation and trust features are separate backend milestones.
