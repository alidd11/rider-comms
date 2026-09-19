# Client parity contract

Rider Comms is one product with two client shells:

- **PWA** — the zero-cost iPhone/browser test client used during development.
- **Native** — the Expo/React Native client intended for Android and eventual iOS distribution.

The PWA is not a reduced product and the native client is not a separate product. During development, user-facing behavior must remain 1:1 unless a platform API makes an exact implementation impossible.

## Definition of parity

A capability is in parity only when both clients expose the same user outcome, backend behavior, permission semantics, terminology, feature state and safety rule. The implementation may differ where the platform requires it.

Allowed implementation differences include secure credential storage, OS-level Bluetooth/audio routing, notification permission APIs, map SDKs and native deep-link plumbing. These differences must not create a different product flow.

## Current tracked gaps

The machine-readable source of truth is `client-parity.json`. Any new user-facing capability must be added there in the same pull request that introduces it.

The current intentional gap list is:

- navigation: both clients now align on provider choice, route/step UI, distance units, next-turn preview, ETA/arrival, spoken turn/reroute/arrival prompts, arrival handling, automatic rerouting, and explicit GPS-loss/recovery handling without discarding the active route. Native navigation keeps private/public LiveKit voice connected and ducks real incoming chat while a navigation prompt speaks. External-music ducking remains OS-managed rather than app-controlled, and background/locked-screen guidance plus physical ride/Bluetooth validation remain outstanding.

Direct messages, Hideouts, block/report flows and the billing preview are now available with matching user-facing content in both clients. Social parity is tracked more granularly as well: both clients consume the durable realtime social feed, expose unread/read state, paginate full friend/request/message history, support outgoing-request cancellation, and preserve independent Instagram/TikTok visibility controls.

These are defects to close during the parity programme, not deferred product ideas.

## Change rule

A pull request that adds or materially changes a user-facing feature must do one of the following:

1. implement the behavior in both clients in the same change, or
2. update `client-parity.json` to record a temporary gap with a follow-up plan.

CI validates the parity manifest so the gap inventory cannot silently disappear or become malformed.
