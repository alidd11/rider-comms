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

- The generated web HTML now requires `viewport-fit=cover` and `black-translucent` iOS standalone status-bar mode.
- `html`, `body`, and the React root are all dark to the physical viewport edges, including behind the notch/status bar.
- Content has top/side insets using CSS `env(safe-area-inset-*)` on web and React Native safe-area values on iOS/Android.
- The tab bar owns its bottom safe-area padding; no separately coloured spacer/band is rendered under it.
- The Home indicator and status text remain under OS control. They must not be obscured by clickable controls.
- Browser tests assert viewport metadata, full-width/full-height surfaces and uniform background colours. Only a physical iPhone Home Screen test can fully confirm status-bar rendering.


## Visual demo photography

The prototype uses externally hosted, free Unsplash photography to illustrate a media-first feed. These photographs are **sample imagery**, not user uploads. Fictional demo creators are not the real photographers and do not endorse the service.

Before production, move media to a moderated, rights-checked and optimised content pipeline, preserve correct source and photographer metadata, and provide upload permissions. Source references: Unsplash motorcycle photograph (photo ID `1558981806-ec527fa84c39`), car photograph (ID `1625932197913-68755c94c51f`), cyclist photograph (ID `1517649763962-0c623066013b`), garage photograph (ID `1511994298241-608e28f14fde`). Verify rights and any depicted trademarks/person releases before commercial launch.
