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

- avatar selection: native only
- direct messages: native only
- hideouts: native only
- block/report flows: native only
- host rider removal: native only
- private ride location sharing: PWA only
- recent places: PWA only
- navigation: both clients exist but behavior differs
- signed-in device/session management: native only
- account deletion UI: native only
- billing preview content: both clients exist but content differs

These are defects to close during the parity programme, not deferred product ideas.

## Change rule

A pull request that adds or materially changes a user-facing feature must do one of the following:

1. implement the behavior in both clients in the same change, or
2. update `client-parity.json` to record a temporary gap with a follow-up plan.

CI validates the parity manifest so the gap inventory cannot silently disappear or become malformed.
