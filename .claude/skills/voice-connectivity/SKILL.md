---
name: voice-connectivity
description: Review changes to group ride voice and Nearby Voice (LiveKit), audio sessions, microphones and recovery from lost connections. Use when touching voice tokens, rooms, the ride bar, proximity voice, or reconnect and retry logic in either app.
---

# Voice and connectivity

Voice runs on LiveKit. Group rides use one room per ride. Nearby Voice uses
one pair room for each pair of riders in range.

## Where it lives

- **Backend**:
  - `backend/src/routes/live.ts`: voice tokens, Nearby pairs, hang-ups
  - `backend/src/routes/context.ts`: `PROXIMITY_VOICE_TOKEN_TTL_SECONDS`,
    `PROXIMITY_VOICE_REFRESH_MS`, `MAX_NEARBY_VOICE_PEERS`
- **Web**: `docs/app/12-voice.js`, `docs/voice-activity.js`
- **Native**:
  - `mobile/src/voice/ProximityVoice.tsx`, `proximityVoiceState.ts`
  - `mobile/src/ride/RideBar.tsx`, which holds the group ride connection
- **Checks**: `check-voice-runtime` and `check-voice-activity`, both in
  `npm run lint`

## Rules

- **Nearby authorisation is a short lease.** The client renews it, and when
  renewal fails the call fails closed and disconnects. A token's expiry alone
  doesn't eject a connected participant, so the lease is what ends a stale
  pair.
- **The server ends pairs.** Out of range, either rider leaving Nearby, or
  either turning location sharing off ends the pair. A LiveKit "not found"
  when removing a participant is expected, not an error.
- **Blocks apply both ways.** Every list of peers that leads to a token or a
  position goes through `moderationStore.filterAllowedPeerIds`, and ride voice
  refuses a ride with a blocked member. A new path to peers must do the same.
- **The closest riders win.** At most `MAX_NEARBY_VOICE_PEERS` calls are held
  at once.
- **The microphone is held only while connected.** Wait for a peer before
  asking for the mic or starting the audio session, and release both on leave.
- **Don't unmount the voice holder.** UI that hides the ride bar must fade it
  instead (native: the drawer fades `RideBar`), or group voice drops.
- **Retry transient failures with backoff:** network, 5xx and LiveKit
  disconnects. Don't retry failures that a timer would make worse, such as
  permission denials, or anything that needs a user gesture (a mic prompt on
  the web). Cancel any delayed connect when the rider turns voice off before it
  fires.
- **Audio interruptions are normal**: calls, Siri, Bluetooth helmet units
  connecting. Recover without the rider doing anything, and show a clear
  state when that isn't possible.

## Before committing

- Run the backend tests for `live.ts` and rides.
- Run `tests/visual/nearby-voice.spec.js` and `voice-speakers.spec.js`.
- Run the native Jest tests for `mobile/src/voice` and `mobile/src/ride`.
- In the PR, describe what happens when the network drops mid-call and comes
  back.
