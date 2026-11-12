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
