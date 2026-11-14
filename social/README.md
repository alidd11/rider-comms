# Rider Comms Social — separate application

This directory contains the **new, independently installed social application** within the existing Rider Comms monorepo. It is intentionally independent of the Rider Comms navigation application.

## Account integration

Social signs in with the same Rider Comms account; there is no second credential database. iOS/Android session secrets are held in expo-secure-store, while web uses memory plus tab-level sessionStorage. A full username-bearing identity from `GET /auth/me` is required, and a separate 16+ self-declaration applies to the development preview.

The backend needs the Social preview browser origin on its CORS allowlist before web sign-in can be tested manually. Exact origin, routes, security rules, testing and backend requests: [ACCOUNT_INTEGRATION.md](ACCOUNT_INTEGRATION.md).

## Scope and current status

- Social-focused: For You / Following, Reels, Stories, clubs, events, garages, verified-business commerce, creator features.
- Shared ecosystem **now for authentication and read-only data**: Rider Comms account login, registration, validated sessions, existing usernames, friend lists and conversation summaries. Posting, social follows and message writes still need backend contracts.
- Existing Rider Comms client, PWA and backend are **not changed** by this foundation.
- `mobile/` now authenticates directly against the **existing Rider Comms account backend**. Demo feeds, Reels, local draft profiles, local garages, commerce and comments remain previews only. Social publishing, secure media persistence, verified age assurance, merchant payments and messaging writes are not implemented.
- Neither app is required to install the other. Both will eventually have separate release pipelines and app-store identities.

## Run independently

From `social/mobile/`:

```sh
npm ci
npm run typecheck
npm test
npm run web
```

The independent GitHub Actions workflow at `.github/workflows/social-app.yml` uses its pinned actions and its dedicated committed lockfile to check TypeScript, mocked auth tests, domain tests, web export and Playwright screenshots. It deliberately does not build or modify the existing Rider Comms application.

The prototype uses Expo SDK 58 and React Native to target iOS, Android and web. It is deliberately a separate npm package for now, **not a root workspace**, so Claude's existing root lockfile, workspace graph, CI and releases remain undisturbed. Pin dependencies in this package before commercial releases.

## Agent ownership / integration boundary

- Only modify `social/**` for this workstream until explicitly coordinated.
- Do not import Rider Comms' backend implementation or change shared migrations to make the prototype run.
- Treat private ride, location, presence, navigation and live voice information as **never available to the social app by default**.
- Authentication now uses existing Rider Comms API routes. Shared friends and conversation summaries are read-only. Actual messaging, Social followers, posts, age assurance and transactions still need versioned backend contracts, permission checks and cross-client tests.
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

- The generated web HTML requires `viewport-fit=cover` and a translucent iOS status bar with explicit safe-area insets.
- `html`, `body`, and the React root are all dark to the physical viewport edges, including behind the notch/status bar.
- Content has top/side insets using CSS `env(safe-area-inset-*)` on web and React Native safe-area values on iOS/Android.
- The tab bar owns its bottom safe-area padding; no separately coloured spacer/band is rendered under it.
- The Home indicator and status text remain under OS control. They must not be obscured by clickable controls.
- Browser tests assert viewport metadata, full-width/full-height surfaces and uniform background colours. Only a physical iPhone Home Screen test can fully confirm status-bar rendering.


## Visual demo photography

The prototype uses externally hosted, free Unsplash photography to illustrate a media-first feed. These photographs are **sample imagery**, not user uploads. Fictional demo creators are not the real photographers and do not endorse the service.

Before production, move media to a moderated, rights-checked and optimised content pipeline, preserve correct source and photographer metadata, and provide upload permissions. Source references: Unsplash motorcycle photograph (photo ID `1558981806-ec527fa84c39`), car photograph (ID `1625932197913-68755c94c51f`), cyclist photograph (ID `1517649763962-0c623066013b`), garage photograph (ID `1511994298241-608e28f14fde`). Verify rights and any depicted trademarks/person releases before commercial launch.


### Installed iPhone PWA bottom-gap corrective action (2026-11-12)

The earlier non-translucent black status-bar experiment attempted to avoid a bottom-gap regression. An intermittent physical iPhone startup issue subsequently showed it could leave the header behind the Dynamic Island. The EclipseRBLX-based correction below supersedes this experiment.


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


### iPhone Dynamic Island / intermittent startup correction (2026-11-12)

Compared the live EclipseRBLX `main` implementation at commit `c74ac789741b6e0d7918b99d2ea972f9d98ea646`. Eclipse sets `viewport-fit=cover` and `interactive-widget=resizes-content`, uses `black-translucent` status-bar mode, applies `env(safe-area-inset-top)` to the fixed header, and keeps `--app-vh` and the bottom inset in sync using `visualViewport`.

Social previously had a conflicting standalone-only `padding-top: 0 !important` rule, allowing the header to appear behind the Dynamic Island. The Social fix keeps top safe-area padding in ALL display modes, synchronises the fixed shell on initial load, resize, orientation, resuming, and visual-viewport changes, and preserves bottom-safe padding inside the tab bar. No fake-colour spacer or transformed layout.

Automated Chromium tests check a forced 59px top inset and viewport geometry. They do not reproduce real iOS Home Screen WebKit behaviour. Check the installed app on a physical iPhone. Because the status-bar configuration has changed, iOS may require deleting and adding the Home Screen PWA once. The URL remains unchanged; normal future builds still update without reinstalling.


## TikTok-style Shop discovery milestone (2026-11-12)

Shop now uses a commerce-first discovery layout: search, category filters, automotive interests, two-column media cards, saved listings, demo basket, example merchant storefronts and a standalone product detail screen. No fake ratings, sale discounts, order records or merchant verification statuses are generated. All prices and names are explicitly fictional; gallery photos are thematic illustrative media, not exact product photography. Vehicles and rentals remain enquiry-only and cannot enter checkout.

Important: business verification, stock, consumer rights/returns, transaction fees, dispute handling, age/identity checks where applicable, payments and payout controls must all be enforced by authenticated backend services before public sales. Shop actions currently change local in-memory preview state only. This is a discovery design iteration, not a TikTok Shop commerce integration.


## Social profile redesign (2026-11-12)

- Removed the visible EARLY PREVIEW tagline from the global header, with a compact single-line Social wordmark. The installed iOS safe-area rules remain unchanged.
- The Social profile is now avatar-led and shows display name, bio, privacy, Posts, Followers, Following, and Friends. Posts, Reels, and Garage are separate tabs, preserving the local profile and garage editing flow.
- No fictional follower or mutual-friend counts are shown: these display a dash until the authenticated services exist. Friends will eventually use the shared Rider Comms mutual friendship graph, while followers are independent one-way Social follow relationships.
- The Following panel opens interactive *example Social accounts* with sample follow/unfollow actions. These do not affect shared Rider Comms relationships.
- Posts and Reels show empty states until the user's own publishing service goes live. The visible username is marked as unlinked; do not show a fictional handle as if it had been reserved.
- Layout references: TikTok's official Friends Tab description and conventional Instagram-style tabbed personal profiles, without copying branded visual assets.

### Shop example photography

Demo listing media has been improved to match gloves, helmet and scooter themes rather than unrelated motorcycle lifestyle shots. Images come from free-to-use Unsplash photography by LouisMoto, Snapmaker, Alexander Simonsen and Raissa Lara Lütolf (-Fasel), used as illustrations rather than real merchant product images. Do not imply the photograph corresponds to a specific for-sale product. Replace these with each merchant's authorised listing photography and image rights metadata before production.


### Camera-first composition and details screen (2026-11-12)

The Create tab now opens a dedicated full-screen studio rather than retaining the main bottom navigation. Close returns to Home; switching formats after selection requires confirmation to avoid losing a draft. The camera can capture photos, flip lenses, toggle rear flash and use a timed shutter. Native Reel recording offers real 15/60-second caps; browser users select existing Reel video instead of being shown a non-working web record action.

Media editing occupies the principal canvas, with genuine crop/rotate, reorder, remove and gallery controls. Details have an optional title, caption and manual hashtag/mention typing, an actual in-app preview, audience and community options, a paid-promotion declaration, and text-only drafts. The Post action remains disabled until moderated backend publishing exists. The Create route preserves iOS status-bar/home-indicator safe areas; physical device recording and keyboard review is still required.

The social interface follows the hard human-designed, AI-free-feeling product requirement in PRODUCT_SPEC.md. This is an original app UI, not a branded TikTok copy.


## Home / Reels navigation separation (14 November 2026)

Home is the photo, Stories and community-updates timeline with one stable feed and compact contextual preferences. Reels is the **only** full-screen viewer with `For You` / `Following` selectors. This avoids duplicating TikTok-like feed tabs across both surfaces, and the Home preference controls do not silently switch the Reels video stream. The production Home empty state remains explicit about unpublished backend content, while isolated Playwright fixtures still exercise card interactions and layout.


### Open-beta empty-state clarity

When no real posts exist, Home uses a compact editorial starter panel rather than a large fake feed card. The only primary action opens the private draft studio; it does not claim uploading is live. Secondary links to Reels and existing friend Messages are real navigation. The profile chip says “Profile preview” (rather than “Private preview”), which avoids implying that the publicly accessible beta is invite-only. Production smoke tests confirm these navigation paths and text claims.

## Profile layout refresh — 14 November 2026

The own-account profile now uses a compact handle, real account avatar, verified
Rider Comms friend count and clearly scoped device-only Social content. Duplicate
display-name text is suppressed when it equals the handle. Profile tabs are
icon-first with fully accessible names; real Posts, Reels and synced Saved
content remain unavailable until their secured backend is integrated.

**Edit profile** is a separate screen, not an inline card beneath the media
tabs. It hides the global bottom navigation while editing and provides
Cancel/Save controls. Only the Social name and bio device drafts may change;
Rider Comms identity and public profile data are never overwritten. The Home
Community feed heading/subtitle is removed, while feed preferences remain
accessible from the top action bar.

Production screenshot smoke tests and fixture interaction tests verify the
dedicated editor, concise profile, accessible tabs, and return navigation.
