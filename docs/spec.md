# Rider Comms App — Technical & Product Spec

*A hands-free, proximity-based group voice + real navigation app for moped/motorcycle riders. React Native, cross-platform.*

## 1. Why this exists

CruiserFM (and most of the app-only competitors — WAVE Intercom, Crew Relay Chat, BlinkTalk) get the basic idea right — GPS proximity + internet voice instead of dedicated mesh hardware — but ship two things that make them unsafe or pointless for actual riding:

1. **Push-to-talk requires touching the phone (or a manual button) to speak.** For someone riding, that's a hand off the bars and eyes off the road just to say something. It's the same category of behavior that hands-free/no-touch-device laws exist to prevent — California's no-touch phone law and most U.S. state hands-free statutes are built specifically around banning manual handling of a device while operating a vehicle. (I'm not a lawyer, and this varies by state/country and sometimes by whether the device is helmet/handlebar-mounted vs. a phone in your pocket — worth checking your specific jurisdiction — but the design goal is straightforward regardless of the letter of the law: nobody should need to touch anything to talk.)
2. **The map is decorative.** Showing pins and a route line without turn-by-turn guidance means the rider still needs a separate navigation app running, which defeats the point of an all-in-one rider app.

This spec fixes both: **open-mic voice activation (VOX)** instead of a button, and **real turn-by-turn navigation** with spoken directions mixed into the same audio channel as group chat.

## 2. Product principles

- **Zero required touches while riding.** Joining a ride, talking, and getting directions should all work without looking at or touching the phone once you're moving.
- **Voice, not buttons, is the interface.** VOX for talking; voice commands (optional, phase 2) for actions like "mute" or "next turn."
- **Fail safe, not silent.** If the voice channel drops (no signal), the rider should get a clear audio cue, not a silent failure they only notice when they've been talking to no one for five minutes.
- **Navigation and chat share one audio bus, intelligently.** Nav prompts duck (lower) chat audio briefly rather than colliding with it or requiring a separate app.

## 3. High-level architecture

```
┌─────────────────────────────── Rider's Phone ───────────────────────────────┐
│                                                                              │
│   Helmet BT Headset  ◄──A2DP/HFP──►  Audio Engine                          │
│                                        ├─ VOX (voice activity detection)    │
│                                        ├─ Noise suppression (wind/engine)   │
│                                        ├─ Echo cancellation                 │
│                                        └─ Audio mixer (chat/nav/music)      │
│                                                                              │
│   Media Control  ◄──MediaSession/MPRemoteCommandCenter──►  Spotify/Apple   │
│                                                              Music (or any) │
│                                                                              │
│   GPS/GNSS  ──────────────────────►  Location Service                      │
│                                        ├─ Proximity/group matching          │
│                                        └─ Nav engine (routing + TBT voice)  │
│                                                                              │
│   React Native App Shell                                                    │
│     ├─ Group/Ride Manager (join/create/leave)                              │
│     ├─ WebRTC client (voice transport)                                     │
│     └─ Background service (keeps audio + location alive, screen off)       │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                        │  (internet: cellular/WiFi)
                                        ▼
┌────────────────────────────── Backend (cloud) ──────────────────────────────┐
│  Voice SFU / relay (e.g. LiveKit)  — routes audio between riders in a group │
│  Presence & Session service — who's in which group, live location          │
│  Group/Ride API — create/join/manage rides, permissions, group codes       │
│  Navigation/routing service — proxies Mapbox/Google Directions, reroute    │
│  Push notification service — ride invites, disconnect alerts               │
└──────────────────────────────────────────────────────────────────────────────┘
```

There is no true device-to-device mesh here (see the earlier discussion on why phones can't really replicate Cardo's dedicated mesh radios) — this is the same internet-relay category as CruiserFM/WAVE, done properly.

## 4. Core subsystem: Audio Engine (the part that actually matters)

This is the piece that determines whether the app feels like a real intercom or a walkie-talkie toy.

**VOX (voice-operated transmission), not push-to-talk:**
- Continuously monitor the mic input level and spectral characteristics.
- Use a noise gate tuned above ambient wind/engine noise, not just a raw volume threshold — raw volume alone will constantly false-trigger on wind buffeting at speed.
- Recommended approach: run a lightweight voice-activity-detection (VAD) model on-device (e.g. Silero VAD or WebRTC's built-in VAD) *after* a noise-suppression pass, not before. Feeding raw mic audio into a volume-threshold gate is exactly how naive PTT-replacement attempts fail at highway speed.
- Add a short "hangover" time (300–500ms of continued transmission after speech stops) so words don't get clipped.
- Give the rider an audio earcon (a soft beep) when their mic opens and closes, so they always know when they're transmitting — critical since there's no visual/physical confirmation like a button gives.

**Noise suppression pipeline (in order):**
1. Acoustic echo cancellation (AEC) — needed because the helmet speaker and mic are close together.
2. Wind/engine noise suppression — RNNoise (open source, runs in real time on-device) or a commercial equivalent (Krisp SDK) tuned for road/wind noise specifically, not office noise.
3. VAD gate (above) decides whether the now-cleaned signal gets transmitted.

**Half-duplex vs. full-duplex:** Default to full-duplex (everyone can hear and be heard simultaneously, like a real intercom) rather than one-speaker-at-a-time radio semantics — this is what makes an intercom feel different from a walkie-talkie app. The SFU (LiveKit or similar) handles mixing multiple simultaneous speakers.

**Audio ducking with navigation:** When a turn-by-turn prompt needs to play, duck (reduce, don't mute) the group chat audio bus by ~15dB for the duration of the prompt, then restore. This is standard practice in car navigation + media integration (CarPlay/Android Auto do this) and is directly portable here.

## 5. Core subsystem: Proximity & Group Management

Two first-class modes, both in from the start — not one core feature and one optional add-on. CruiserFM's "range" model (pay per mile) is a monetization gimmick, not a technical requirement, since it's all internet-relay anyway; the two modes below replace it with something that actually maps to how riders use this.

**A. Private ride groups (code-based).** A rider creates a ride, gets a shareable code/QR, and others join it directly — a known set of people, like an actual planned group ride. The ride creator can kick/mute participants. This is the trusted, no-moderation-needed case.

**B. Public local channels (open, no code, join-by-location).** Anyone nearby can drop in without an invite — closer to a CB radio "Channel 19 for this stretch of road" than a citywide open mic. To keep this useful instead of turning into noise:
- Bucket riders into location-scoped rooms (e.g. a geohash/grid cell a few miles across, or a rolling radius around each rider) rather than one giant global room — the room a rider is in updates automatically as they travel, no manual channel-picking required for the default case.
- Because this is open to strangers, moderation has to ship *with* it, not after: instant local mute of any speaker (one tap or a voice command, client-side, takes effect immediately for you regardless of server state), a report-abuse flow, rate limiting on brand-new/anonymous accounts, and lightweight identity friction (e.g. phone-number verification at signup) to raise the cost of throwaway abuse accounts. Auto-mute heuristics (sustained shouting/loud noise, profanity detection) are worth adding but shouldn't be the *only* line of defense — the instant manual mute is the one that has to work perfectly on day one.
- Default this to **opt-in per session** — a rider chooses to open the public channel, rather than being dropped into an open mic with strangers automatically just for having the app running.

**Mode interaction:** keep it simple for MVP — a rider is in exactly one voice room at a time, joined either by code (private) or by location (public), using the same underlying SFU room mechanics either way. Letting someone be in both simultaneously (a private group *and* a public channel, mixed together) is a reasonable phase-2 idea but adds a fourth source to the audio-priority mixer (Section 4/7) and isn't worth the complexity until the single-room version is solid.

**Group size:** private rides, design for 2–20 riders (full-duplex mixing gets noisy fast beyond that, and real group rides are rarely bigger). Public channels need their own cap per room (e.g. ~15-30) with the location-bucketing above splitting a busy area into multiple rooms rather than one room growing unbounded.

**Radius tiers (the part of CruiserFM's model worth keeping — done cleanly):** the public channel's join radius doesn't cost more to serve technically at different sizes, but it's a genuinely reasonable subscription lever — someone who rides constantly and wants maximum reach gets more value from a bigger radius than someone who opens the app occasionally. Locked-in structure (names TBD, per your note):
- **Free — 1 mile.** Enough to reach the riders you're physically near right now (a stoplight cluster, a rest stop, a small local group).
- **Premium** — medium radius, roughly 5–8 miles. Covers "everyone on this highway" or "this side of town."
- **Premium+** — large radius, roughly 15–25 miles or a full metro/regional area — for touring, or sparser rural areas where 1 mile finds no one at all.

(Premium/Premium+ mile values are still a tuning knob — ship defaults, watch real usage, adjust. Free is locked at 1 mile.)

**Locked-in decision: radius is mutual, not one-way — "the zone."** Two riders can only hear each other while each is inside the *other's* active radius: eligibility = distance ≤ min(rider A's radius, rider B's radius). Practically, that means if a Premium+ rider (15mi) and a Free rider (1mi) are 3 miles apart, they're simply not in the same zone — not a broken/asymmetric state, just out of range of each other, the same as two CB radios too far apart to reach each other.

**This check runs server-side, not client-side.** The backend (Presence service) already has both riders' locations from their regular pings; it re-evaluates the mutual condition for a pair whenever either location updates, and pushes the resulting in-zone/out-of-zone state to both clients. Clients never need each other's raw GPS to work this out themselves — that would mean leaking precise stranger locations directly between devices and risking two phones disagreeing about the answer from slightly stale data. The backend is the single source of truth for who's in whose zone.

**"The zone" means audio *and* visibility together, not audio alone.** The same mutual check governs whether a rider appears on your map/roster, not just whether you can hear them — dropping out of audio range but still seeing someone's live position on your map defeats the "just out of range" framing and needlessly exposes a stranger's location past the point you can actually reach them. So a state flip (in ↔ out of zone) always moves both at once: audio subscribe/unsubscribe on the SFU, and roster/map entry appear/disappear, in the same update.

**What actually happens when B drifts out of A's zone:** the moment the backend's recompute (triggered by either rider's next location ping) flips the mutual condition to false, it tells the SFU to unsubscribe A↔B's audio in both directions simultaneously and removes each from the other's roster/map — nobody else in the shared room is affected, since this is a pairwise state, not a room-wide event. Each device plays the calm "dropped out of zone" earcon (distinct from "you're disconnected," which means something's actually wrong). If they later close the distance again, the next location update flips it back to true automatically — roster and audio both restore themselves with no manual rejoin.

This reuses the same geo-bucketed rooms from above, which exist purely as an internal sharding layer (so one SFU room doesn't try to span, say, an entire state) — sized comfortably larger than the biggest radius tier so two riders whose zones could ever overlap are guaranteed to already share a room. Riders never see the bucket; all they experience is their own zone growing or shrinking. Within a shared room, each client subscribes only to the participants currently inside its own zone (LiveKit and comparable SFUs support this per-participant selective subscription natively) — a bigger radius tier is "subscribe to more of the same room," not a separate server-side room per plan.

**Private ride groups are unaffected by any of this** — code-based joining has no radius; tiers only gate the public discovery mode.

## 6. Core subsystem: Navigation

This needs to be real turn-by-turn, not a route line:

- Use an existing navigation SDK rather than building routing from scratch: **Mapbox Navigation SDK** (has React Native community wrappers, good offline support, customizable voice prompts) or **Google Navigation SDK for Android/iOS** (higher quality data, less customizable, stricter licensing/cost at scale). Mapbox is the more realistic starting point for an indie build.
- Turn-by-turn voice prompts feed into the same Audio Engine mixer described above (ducking chat, not replacing it).
- Rerouting must happen automatically and silently when a rider misses a turn — no manual interaction.
- Group ride mode: the ride leader's route can be shared to followers, with each follower getting their own turn-by-turn guidance to the same destination (not just a shared position dot) — this is the actual gap CruiserFM leaves open.

## 7. Core subsystem: Media Playback Control (Spotify / Apple Music)

Like Waze's now-playing bar, riders should be able to see and control their music without opening Spotify or Apple Music separately. Two integration tiers, and the first one alone gets most of the value:

**Tier 1 — OS-level media session control (build this for MVP).** Both iOS (`MPRemoteCommandCenter` / `MPNowPlayingInfoCenter`) and Android (`MediaSession`/`MediaController`) let any app send play/pause/skip/previous commands and read now-playing metadata (track, artist, artwork) for *whatever app currently holds the active media session* — Spotify, Apple Music, YouTube Music, a podcast app, anything. This is effectively how Waze's music bar works. It's the resilient choice: one implementation covers every music app the rider might already be using, needs no per-service developer approval, and requires no extra login beyond what's already running.

**Tier 2 — Direct SDK integration (phase 2, additive).** For deeper functionality — browsing playlists, starting a specific track from inside your app, catalog search — you'd add:
- **Spotify App Remote SDK** (iOS + Android): commands a running Spotify app directly and can browse/play specific content, but requires the rider to have Spotify installed, OAuth into your app, and Spotify's approval of your app's API access — Spotify has tightened this "extended access" review over the years, so treat it as a real lead-time item, not a given. Tier 1 remains the fallback for any user (or your own app, if that review stalls) without approved access.
- **Apple MusicKit** (iOS only): needs an active Apple Music subscription and user authorization; gives `ApplicationMusicPlayer` control plus catalog browsing, but is Apple Music-specific with no Android equivalent.

**Where it fits in the audio design (extends Section 4):** music becomes a third source in the ducking hierarchy, so this needs one shared "Audio Mixer" component making priority decisions, not three subsystems independently fighting for the output. Priority, highest to lowest:
1. Turn-by-turn navigation prompt (brief, always heard)
2. Group voice chat (another rider talking)
3. Music (ducks under both of the above)

**Hands-free control applies here too** — the whole point of dropping push-to-talk is that nothing requires touching the phone, so skip/pause/next should be reachable by voice command (folds into the phase-2 voice-command system already scoped in Section 11) or a helmet/handlebar remote, not by unlocking the screen.

**UI:** a glanceable now-playing bar (track/artist/artwork) on the riding-mode screen, read-only by touch — the same pattern Waze uses — since interacting with it manually while moving defeats the entire premise of this app.

## 8. Data flow: joining a room and talking

**Private ride (code-based):**
1. Rider A creates a ride → backend generates a ride ID/code, opens a room on the voice SFU.
2. Rider B joins via code → app requests mic + location permissions (once, up front) → connects to the SFU room → subscribes to presence updates.

**Public local channel (join-by-location):**
1. Rider opens the public channel → app sends current location to the Presence service.
2. Backend resolves which geo-bucketed room covers that location (creating one if none exists yet nearby) and returns its SFU room ID.
3. As the rider travels far enough to cross into a different bucket, the app hands off to the new room automatically (with a brief earcon so the switch isn't silent/confusing).
4. Within that room, the **backend** (not the client) recomputes, per pair of riders, whether distance ≤ min(their radius, the other rider's radius) whenever either one's location updates — this is "the zone" from Section 5. A flip in either direction pushes a subscribe/unsubscribe of that pair's audio *and* removes/restores each other's roster and map entry together, in one update, to both riders' devices — with a light, distinct earcon ("dropped out of zone" vs. "disconnected/offline" need to sound different: one is normal and expected, the other is a problem).
5. No manual reconnect needed: the moment the mutual-range condition holds again (riders converge back within each other's radius), the backend's next recompute restores audio and roster/map visibility together, automatically.

**Shared, regardless of room type:**
6. Every participant's Audio Engine runs continuously: mic → noise suppression → VAD gate → (if speaking) encode and publish to SFU → SFU mixes and forwards to all other participants' decoders → helmet speaker.
7. Location updates stream at a low frequency (e.g. every 5–10s, more when speed is low/stopped) to the Presence service, shown on a shared map scoped to your current room.
8. If a rider loses signal entirely, the backend flags them "disconnected" and the app plays a distinct earcon locally ("you're offline") — deliberately different from the "out of zone" earcon above, since one means "temporarily out of range, will reconnect" and the other means "something's actually wrong."
9. In a public room specifically, muting another speaker (tap or voice command) takes effect immediately on your own client without waiting on the server — the abuse case that matters most is "make this person stop being audible to me right now."

## 9. Tech stack recommendation

| Layer | Choice | Why |
|---|---|---|
| Mobile app | React Native (+ TypeScript) | One codebase for iOS/Android; large ecosystem for BT audio, background tasks, maps |
| Voice transport | LiveKit (self-hosted or cloud) | Open-source WebRTC SFU, good RN SDK, handles multi-party mixing |
| Noise suppression | RNNoise (on-device) or Krisp SDK | Real-time, runs on-device, tuned for wind/engine noise |
| VAD | Silero VAD or WebRTC VAD | Lightweight, on-device, low latency |
| Navigation | Mapbox Navigation SDK | Turn-by-turn out of the box, customizable voice prompts, reasonable pricing at small scale |
| Backend | Node.js/TypeScript or Go, Postgres | Session/group state, ride codes, presence |
| Push notifications | Firebase Cloud Messaging / APNs | Ride invites, disconnect alerts |
| Background execution | iOS: Background Modes (audio, location) + CallKit-style handling; Android: Foreground Service | Keep the voice channel and GPS alive with the screen off |
| Media control (Tier 1) | `MPRemoteCommandCenter`/`MPNowPlayingInfoCenter` (iOS), `MediaSession`/`MediaController` (Android) — via a native module or `react-native-track-player`-style wrapper | Universal play/pause/skip + now-playing metadata for any music app, no per-vendor approval |
| Media control (Tier 2) | Spotify App Remote SDK; Apple MusicKit | Deeper per-service control (browse/play specific tracks) — phase 2, pending Spotify API approval |
| Subscription billing | RevenueCat (wraps StoreKit + Google Play Billing) | Handles the Free/Premium/Premium+ radius tiers across both app stores without hand-rolling receipt validation on each platform |

## 10. Battery, data, and background-execution reality check

- **iOS background audio + location together is the single biggest engineering risk.** Apple is aggressive about killing background processes; you need to correctly declare the `audio` and `location` background modes, and the app needs to behave like a legitimate VoIP app (similar to how WhatsApp/Zoom keep a call alive in the background) to survive App Store review and actual background execution. This is very doable (Zello, WAVE Intercom, and others ship it) but is not trivial — budget real time for it.
- **Android** is more permissive via a Foreground Service with a persistent notification ("Ride in progress — tap to end"), which is also good UX (the rider gets a visible, non-intrusive indicator that the mic could be live).
- **Data usage:** continuous VOX-gated voice at typical Opus compression (~24-32kbps when actively transmitting, near-zero when gated closed) is modest — comparable to a phone call, not video. Worth surfacing an estimated MB/hour to riders since they may be on limited data plans while touring.
- **Battery:** GPS + screen-off audio streaming is the same profile as running a nav app during a call — expect real riders to want it plugged into a phone mount charger for long rides, and say so rather than overpromising battery life.

## 11. Suggested MVP scope (phase 1)

Build only this first:
1. Create/join a **private ride** via a shareable code.
2. Join the **public local channel** for wherever you currently are, no code needed, at a single default radius (ship one Free-tier radius first — hold off on wiring up billing/Premium tiers until the core public-channel experience is validated) — plus the two moderation basics that have to launch alongside it: instant client-side mute and a report-abuse flow. (Auto-mute heuristics and phone-verification friction can follow shortly after, but manual mute/report ship on day one, not later.)
3. VOX-based full-duplex group voice with noise suppression (this is the core differentiator — get it right before anything else), shared by both room types.
4. Basic turn-by-turn navigation via Mapbox, ducked correctly against chat audio.
5. Background operation on both iOS and Android that survives screen-off riding.
6. A live group map showing where everyone in your current room is.
7. Now-playing display + play/pause/skip/next via OS-level media session control (Tier 1) — works with Spotify, Apple Music, or whatever the rider already has playing, with no extra integration per service.

Explicitly defer to phase 2+: Free/Premium/Premium+ radius tiers and the billing to support them, being in a private group and a public channel simultaneously, wake-word voice commands, direct Spotify/Apple Music SDK integration (Tier 2 — playlist browsing, in-app track selection), auto-mute abuse heuristics and identity-verification friction beyond the MVP basics, ride history/stats, social/friends features.

## 12. Open risks to watch

- **False VOX triggers from wind noise at highway speed** — mitigate with real-world testing on an actual bike, not a desk mic; this is the one thing that will make or break the "feels hands-free and safe" pitch.
- **App Store review friction** around background location + audio — have a clear, honest privacy explanation ready (this is exactly the kind of app reviewers scrutinize).
- **SFU hosting cost** scales with concurrent voice minutes — LiveKit self-hosted keeps this cheap early; watch it as usage grows.
- **Public channel abuse is a launch-day risk, not a future one**, since it's in the MVP now — the instant mute has to be reliable and fast (client-side, not round-tripped through a moderation queue) or the public mode will get a bad reputation immediately.
- **Room-sizing/geo-bucketing for public channels** needs real tuning — too large a radius and a channel is dead silent or overwhelming; too small and a rider on a quiet backroad has no one to talk to. Plan to make the bucket size adjustable server-side without an app update.
- **Spotify API approval timeline** for Tier 2 integration is outside your control — don't block MVP launch on it; Tier 1 already covers the core "control your music without touching the phone" need.
- **Radius-tier fairness/symmetry** — if the mutual (min-radius) rule from Section 5 isn't implemented consistently, riders will notice and complain about "half-connected" behavior (I can see them but they can't hear me); test this explicitly once tiers ship, not just the happy path of two same-tier riders.

---

## 13. Security, privacy & abuse-resistance gaps (fix before launch, not after)

- **Ride codes need real entropy and expiration.** A private ride code is effectively a password to a live voice room. A short, human-typeable code is guessable/brute-forceable at scale if there's no protection — pair it with server-side rate-limiting on join attempts, auto-expiry (when the ride ends, or after N hours idle), and no partial-match feedback that would help someone narrow down a guess.
- **GPS spoofing is a real threat to the zone model, not a hypothetical.** Someone can fake their location to appear "in zone" with a specific target for harassment, or to falsely claim a paid larger radius they're not actually using. Sanity-check incoming location pings against plausible movement (flag a "rider" who jumps 50 miles between two 10-second pings) and use the OS's mock-location signals where available (Android exposes `isFromMockProvider()`; iOS is harder to detect directly, but jailbreak/simulator heuristics help) to flag likely-spoofed sessions for review rather than trusting every ping blindly.
- **The account/auth model is still undefined.** Phone-number verification was mentioned as anti-abuse friction, but the doc never nails down the actual identity system: phone/OTP, email, or SSO, and how it ties to a durable identity for banning abusive accounts. A banned phone number simply re-registering under a new one is a known evasion path — device fingerprinting or requiring a verified payment method for paid tiers helps close that gap somewhat.
- **State the trust boundary of the SFU explicitly.** WebRTC covers transit encryption (DTLS-SRTP) by default via LiveKit — worth saying so plainly. But audio is decrypted and re-mixed at the SFU, meaning the operator (you) technically has access to live streams passing through it — same as Zoom or Discord, and normal for this class of app, but it should be stated plainly in the privacy policy rather than left implicit, especially since users may assume a "private" ride is more isolated than it technically is.
- **Data at rest needs its own story** — encryption at rest and access controls for location history, ride logs, and account data, especially once any support/moderation tooling can query it.

## 14. Reliability, scale & observability gaps

- **No multi-region infrastructure plan yet.** Both LiveKit and Mapbox support geo-distributed deployment; a real launch needs media servers placed near actual rider concentrations, not a single region serving everyone — otherwise distant riders eat needless latency, and one regional outage takes the whole app down.
- **No failover story for the Presence/matching service.** If it goes down, the zone recomputation from Section 8 silently freezes rather than failing loudly — everyone's in-zone state just stops updating. Needs health checks, redundancy, and an explicit degraded-mode behavior (e.g. keep existing subscriptions alive rather than tearing riders out of their zone if Presence is briefly unreachable).
- **No load-testing plan for the exact scenario this app will actually hit hardest: rallies.** Events like Sturgis or Daytona Bike Week put thousands of riders in overlapping zones in a small area simultaneously — the geo-bucketing/room-sizing math from Section 5 needs to be load-tested against that specifically, not just steady-state daily usage.
- **No observability stack specified.** At minimum: crash reporting, structured logging with correlation IDs across the mobile app → backend → SFU path (so "audio cut out at 2pm" is actually debuggable from a support ticket), and product analytics kept separate from error/crash monitoring.
- **No defined reliability target.** Even an internal SLA (e.g. 99.9% for the voice/matching backend) forces real redundancy decisions that "just get it working" doesn't.

## 15. Accessibility & platform-fragmentation gaps

- **The app is audio-first by design, which structurally excludes Deaf/hard-of-hearing riders** from voice chat itself. Worth scoping a haptic-alert layer (helmet/handlebar vibration, or phone-mount vibration) for at least the events where a missed audio cue matters most — zone entry/exit, ride invites, disconnect warnings — so hearing isn't a hard requirement for every signal the app gives, even though full voice chat inherently can't be made accessible the same way.
- **Android background-execution fragmentation is a known, serious problem for exactly this category of app.** Samsung, Xiaomi (MIUI), Huawei, and OnePlus all ship manufacturer-specific battery managers more aggressive than stock Android at killing background services — a foreground service alone (Section 10) doesn't fully solve this on those OEMs. Plan explicit onboarding that detects the manufacturer and walks the rider through disabling battery optimization for the app, rather than discovering this as a wave of "the app just stopped working" tickets after launch.
- **Locale and units matter more than they might seem** for a product whose value proposition includes touring riders internationally. CruiserFM is styled around miles; a real competitor should store distance internally in a locale-independent unit and display in the rider's preferred unit from day one, along with real localization — not just English — rather than retrofitting it later.

## 16. Legal considerations

- **This is a communications product used while operating a vehicle.** Even with the hands-free design goal throughout this doc, get actual legal review — not just the "I'm not a lawyer" caveats scattered through this spec — on Terms of Service liability language generally, since a safety-adjacent product carries more exposure than an ordinary consumer app if something goes wrong while it's in use.
- **Jurisdictional hands-free rules vary**, as flagged earlier in Section 1 — worth confirming for whatever markets you launch in first, rather than assuming U.S. norms translate everywhere.

## 17. Revised priority order

Putting all of the above in sequence rather than as a flat list: Sections 13–14 (security, privacy, reliability, observability) are pre-launch musts — none of them are optional polish, they're the difference between a demo and something safe to put in front of real users at scale. Section 15 (accessibility, Android fragmentation) is far cheaper to bake in now than retrofit later, since both touch core architecture (background execution, notification/alert design) rather than being addable on top afterward. Section 16 (legal review) is worth starting in parallel now, since legal review timelines run independently of engineering and shouldn't become the thing blocking launch at the last minute.

---

Happy to go deeper on any one piece next — e.g. a working React Native prototype of just the VOX + noise-suppression pipeline (the highest-risk, most important part), or the backend session/SFU service.
