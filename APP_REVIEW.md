# App Store submission guide

Everything App Store Connect asks for, with the answers that match what the
iOS app actually does. The code side is ready. The **You** items need your
Apple account, legal entity or a decision.

## Before you submit (you)

1. **Fill in `legal/site-details.json`.** Add your company legal name,
   support email and postal address, then run `npm run build:legal` and
   merge. Until then, those fields show in brackets on the published pages.
   Your lawyer should also complete the bracketed sections the generator
   leaves visible:
   - Privacy: Data Protection Officer or representative, and international transfers.
   - Terms: police and camera reports, liability, and governing law.
2. **Make sure the support email is monitored.** It appears on the Support
   page and in the app. Apple checks that it works.
3. **Staff the moderation queue.** The app and the Community Guidelines tell
   riders that reports are reviewed within 24 hours, which is what guideline
   1.2 requires. Review reports in the staff dashboard (`MODERATION.md`).
4. **Create a demo account for App Review**, with the email verified.
   Ideally create a second account and make the two friends, so the reviewer
   can see chat and the ride roster.
5. **Apple Developer setup.** You need an Apple Developer Program membership,
   the bundle ID `com.ridercomms.app`, and signing via
   `npx eas-cli build --platform ios --profile production`, then upload to
   TestFlight.
6. **Test on a physical iPhone.** Run the checks in `ACCESSIBILITY.md`, plus
   voice over a helmet intercom.

## App Store Connect answers

| Field | Answer |
| --- | --- |
| Privacy Policy URL | https://alidd11.github.io/rider-comms/privacy.html |
| Support URL | https://alidd11.github.io/rider-comms/support.html |
| Marketing URL (optional) | https://alidd11.github.io/rider-comms/ |
| Category | Navigation (primary), Social Networking (secondary) |
| Price | Free. No in-app purchases. |
| Sign-in required | Yes. Give the demo account in Review Notes. |
| Encryption export | Exempt. `ITSAppUsesNonExemptEncryption` is already `false`, because the app only uses standard HTTPS/TLS and WebRTC. |
| Content rights | The app shows riders' own content, plus Google and Apple maps under their terms. Route photos are licensed (`ROUTE_IMAGE_LICENSES.md`). |

### Age rating questionnaire

Your answers decide the rating. These match the app as built:

- **User-generated content:** yes (chat, profiles, voice), with reporting, blocking and filtering.
- **Messaging and chat:** yes.
- **Location sharing:** yes, opt-in only.
- Everything else (violence, sexual content, gambling, drugs, horror, mature themes): none.
- **Web access:** no general web browser. Links open Safari for Instagram, TikTok and maps.

The Terms set a minimum age of 16, so pick the rating band that covers that.

### App Privacy ("nutrition label")

These match `mobile/app.json` → `privacyManifests` and the Privacy Policy.
For every row: not used for tracking, and no third-party advertising.

| Data type | Linked to the rider | Purpose |
| --- | --- | --- |
| Contact info → Email address | Yes | App functionality |
| Contact info → Name (display name) | Yes | App functionality |
| Identifiers → User ID | Yes | App functionality |
| Location → Precise location | Yes | App functionality |
| User content → Emails or text messages (chat) | Yes | App functionality |
| User content → Other user content (profile, hideouts, hazard reports) | Yes | App functionality |
| Usage data → Product interaction (last active, first ride) | Yes | Analytics |
| Diagnostics → Crash data | No | App functionality |

Voice is carried live and never stored, so it isn't "collected" in Apple's
sense. Answer **No** to tracking.

## Store listing

Draft copy within App Store limits. It describes only features that ship;
check it again if a feature changes.

| Field (limit) | Text |
| --- | --- |
| Name (30) | Rider Comms |
| Subtitle (30) | Group voice & rides for bikers |
| Promotional text (170) | Talk to your group hands-free, see everyone on the map, and get warned about hazards ahead. Built for motorcycle riders. |
| Keywords (100 bytes) | motorcycle,intercom,biker,group ride,helmet,voice chat,ride tracker,hazard,route,moto,navigation |

Keywords leave out "rider" and "comms" because Apple already indexes the
app name. The copy doesn't mention police or speed-camera reports: warning
of speed cameras is illegal in some countries (the Terms flag this for legal
review), so settle that, and the countries the app is listed in, before
advertising it.

**Description (4,000):**

> Rider Comms keeps your group together on the road.
>
> GROUP VOICE
> Talk to the riders in your group through your helmet intercom or
> earphones. Voice opens when you speak, so you keep your hands on the bars.
> It keeps working with the screen off.
>
> GROUP RIDES
> Start a private ride and share the code. Everyone in the ride sees each
> other on the map, and the roster shows who has joined.
>
> NEARBY
> Turn on Nearby to talk to other riders close by, even if you aren't
> friends yet. It's off until you switch it on. Other riders never see your
> exact position, and you can mute, report or block anyone.
>
> HAZARDS
> Report crashes and road closures in a tap. Riders near you see them on
> the map, and reports disappear once other riders say they're gone.
>
> ROUTES AND NAVIGATION
> Browse riding routes, plan a ride to your favourite meeting spots, and
> navigate with spoken turn-by-turn directions.
>
> FRIENDS AND CHAT
> Add friends by handle, message them, and see who's online.
>
> SAFETY
> Location sharing is opt-in. You can report or block any rider from their
> profile, chat or the ride roster. Reports are reviewed by a person within
> 24 hours. You can delete your account and data from Settings at any time.
>
> Please ride safely and follow local laws. Set up voice and your route
> before you set off, and don't use your phone while riding.

**What's New (first release):** First release.

Screenshots must show the iOS app itself (6.9" and 6.5" iPhone sizes), so
take them from a TestFlight build rather than the PWA.

## Review notes (paste into App Store Connect)

> Rider Comms is a companion app for motorcycle riders: group voice chat,
> private group rides with live positions, an opt-in "Nearby" mode for
> riders close by, hazard reports, chat with friends and navigation.
>
> **Demo account:** [username] / [password] (email verified). A second account
> [username2] is already a friend for testing chat and rides.
>
> **Background audio** is used for live voice chat with your group while
> riding (the screen is usually off) and for spoken turn-by-turn directions.
>
> **Background location** is used only during turn-by-turn navigation that
> the rider starts in the app, so directions keep working with the phone
> locked. It runs under the "While Using the App" permission (the app never
> asks for "Always"), iOS shows the blue location indicator while it runs,
> and it stops as soon as navigation ends. To see it: start navigation to
> any place from the map, lock the phone, and move; the next turn is spoken.
>
> **Safety and moderation (guideline 1.2):**
> - Signing up requires agreeing to the Terms and Community Guidelines, which
>   have zero tolerance for objectionable content.
> - Names, handles, usernames, hideout names and messages are filtered on the
>   server.
> - Riders can report and block from profiles, chats, the ride roster, friend
>   requests and the Nearby Voice rider list, and can mute a nearby rider.
> - Reports reach a staffed moderation queue and are reviewed within 24 hours.
>   Moderators can suspend accounts.
>
> **Account deletion:** Settings → Account → Account and data → Delete
> account.
>
> **No purchases:** the plan screen shows the rider's current Nearby range
> only. Nothing is sold.
>
> Voice needs two devices to hear each other. To test Nearby, both accounts
> must go live within a mile of each other.

## Google Play Console answers

The Android build (`com.ridercomms.app`) uses the same backend and features.
These answers match what the app sends off the device.

| Field | Answer |
| --- | --- |
| Privacy policy | https://alidd11.github.io/rider-comms/privacy.html |
| Account deletion URL | https://alidd11.github.io/rider-comms/support.html. The "Delete your account" section covers deleting from the app, on the web without installing the app, and by email. |
| Ads | No |
| Target audience | 16 and over (the Terms' minimum age); not designed for children |
| Content rating (IARC) | Users interact, shares location (opt-in), no purchases, no other mature content |
| App access | Sign-in required: give the same demo account as App Review |

**Data safety.** Collected data is not shared with third parties: maps,
voice and email providers process it on our behalf, which Google doesn't
count as sharing. Data is encrypted in transit. Riders can delete their
account and data.

| Data type | Purpose | Notes |
| --- | --- | --- |
| Location → Precise location | App functionality | Optional (riders turn sharing on) |
| Personal info → Name | App functionality | Display name |
| Personal info → Email address | App functionality, account management | |
| Personal info → User IDs | App functionality | |
| Messages → Other in-app messages | App functionality | Chat with friends |
| Audio → Voice or sound recordings | App functionality | Live voice only, processed ephemerally and never stored |
| Photos and videos | Not collected | |
| App activity → App interactions | Analytics | Last active, first ride |
| App activity → Other user-generated content | App functionality | Profiles, hideouts, hazard reports |
| App info and performance → Crash logs | App functionality | Not linked to the rider |

**Foreground service declaration.** Two foreground services, each with a
short video Play asks for. Record both on a test device.

- **Microphone** (`FOREGROUND_SERVICE_MICROPHONE`): voice keeps running with
  the screen off. Use case: "Voice chat with your riding group while the
  screen is off." Video: voice continuing after the screen locks.
- **Location** (`FOREGROUND_SERVICE_LOCATION`): turn-by-turn navigation the
  rider starts keeps working with the screen off, with a "Rider Comms
  navigation" notification, and stops when navigation ends. Use case:
  "Navigation: spoken turn-by-turn directions while the screen is off."
  Video: start navigation, lock the screen, and hear the next turn.

The app doesn't request `ACCESS_BACKGROUND_LOCATION`, so Play's background
location declaration doesn't apply.

## Rejection risks already handled in code

- **2.1 completeness:**
  - Notification toggles were removed, because push delivery doesn't exist yet.
  - Offline maps were removed.
  - The placeholder Apple, Google and Discord sign-in buttons were removed.
  - Hideouts use a map picker instead of typed coordinates.
  - All "test build" and "coming soon" wording is gone.
- **3.1.1 payments:** no prices and no unbuyable plans are shown.
- **4.8 sign in with Apple:** not required, because there is no third-party sign-in.
- **5.1.1 data and permissions:**
  - Permission strings explain each use.
  - Purpose strings that SDK plugins add for APIs the app doesn't use (camera,
    Face ID, "always" location, motion) say so plainly instead of the generic
    "Allow Rider Comms to access…" text. `scripts/check-native-permissions.mjs`
    keeps it that way. Unused Android permissions (camera, storage, draw over
    other apps) are removed from the manifest.
  - The screen before the location prompt says "Continue", not "Enable" or "Allow".
  - Account deletion is in the app.
  - The privacy manifest declares collected data and required-reason APIs.
- **1.2 user-generated content:** agreement at signup (and once for existing
  accounts), server-side filtering, report, block and mute everywhere other
  riders appear, a blocked-riders list, and a 24-hour moderation commitment.
- **Icon:** full-bleed 1024×1024 with no transparency (`mobile/assets/brand/`).

## Known judgement calls

- **Sign-in is required for the whole app.** Apple can ask for
  account-free browsing (5.1.1(v)) when core features don't need an account.
  Rider Comms is built around riders finding and talking to each other, so
  requiring an account is defensible. If App Review pushes back, the fix is
  to let the map and routes open signed-out.
- **Nearby Voice connects riders who aren't friends.** That's the product. The
  rider list with mute, report and block, plus the filter and staffed
  moderation, is what makes it acceptable under guideline 1.2.
