# Launch checklist

Everything left before Rider Comms goes public, in order. The code side is
done. Each step needs an account, a legal entity, a decision or a physical
device, so it needs the owner. The detailed guides are linked.

## Already done

- Two-rider voice over helmet intercoms tested on real devices.
- Installed-iPhone PWA chat composer confirmed on device (#386).
- Privacy Policy, Terms, Community Guidelines and Support pages published
  with placeholders for the owner details below.
- Store answers drafted: App Store listing, privacy labels, age rating,
  review notes, and Google Play Data safety (`APP_REVIEW.md`).
- Production monitoring: the backend checks the web app every 5 minutes, GitHub checks everything every few hours, crash and error
  alert emails, request tracing, and a database-aware deploy health check.
- Railway volume backups of the production database (daily and weekly).
- A daily encrypted database backup (Railway `db-backup` service, 02:41
  UTC). Each copy is verified by a test restore before upload and kept for
  30 days. The owner holds the decryption key, `rider-comms-backup.agekey`.
- Both apps show "No connection" when a rider loses signal (#398).
- Both native apps compile and launch (iPhone simulator, Android emulator)
  on every mobile change and weekly, including after the LiveKit 3.0
  upgrade. Voice itself still needs the device check below.
- Store technical checks run on those builds: the iPhone app has a purpose
  string for every privacy-sensitive framework it links and bundles its
  privacy manifest. The Android APK targets API 36, supports 16 KB memory
  pages, and requests only the permissions the store answers describe.

## 0. Google Cloud API key (5 minutes, do this first)

Two live features are waiting on this: **place search** in both apps, and
**photo and Reel posting in Rider Social**. The backend has one Google key,
stored on Railway as `GOOGLE_DIRECTIONS_API_KEY`. Google refuses it today:
search gets `PERMISSION_DENIED`, and on 2026-11-19 the Rider Social content
check got "Requests to this API vision.googleapis.com … are blocked". Every
upload is refused until the check can run, so nothing is posted unchecked.

1. In Google Cloud Console, go to **APIs & Services → Library** and make sure
   **Places API (New)**, **Routes API** and **Cloud Vision API** are all
   enabled for the project. Cloud Vision is already on.
2. Go to **APIs & Services → Credentials** and open the backend's key.
3. **API restrictions:** choose *Don't restrict key*, or keep *Restrict key*
   and tick **Places API (New)**, **Routes API** and **Cloud Vision API**.
4. **Application restrictions:** **None**. The key is used only by the
   server, so website or app restrictions block it.
5. Save, wait about five minutes, then search for a place and post a photo in
   Rider Social. If either still fails, the backend logs say why
   (`places_provider_refused`, `media_scan_refused`).

Cost: Cloud Vision SafeSearch is about $1.50 per 1,000 images after the
first 1,000 each month. A Reel counts as four images (its cover and three
frames).

## 0b. Two Railway settings (5 minutes)

Claude's session isn't allowed to make these, so they need you in the
Railway dashboard (project `rider-comms-backend`, production):

1. **Move Rider Social photos next to the server.** The `social-private-media`
   bucket is in Amsterdam (`ams`) and the backend runs in California, so
   every photo crosses the Atlantic. Choose **+ New → Bucket**, region
   **US West (sjc)**, name it `social-media-us`, then tell Claude: it points
   the five `SOCIAL_MEDIA_S3_*` variables at it. The old bucket is empty
   (no upload has been stored yet), so nothing needs copying; delete it
   afterwards.
2. **Point-in-time recovery for the database.** Open the **Postgres** service,
   then **Settings → Backups → Point-in-Time Recovery → Enable**, and click
   **Deploy** on the staged change. The database can then be restored to
   any minute, not only to the last daily backup.

## 1. Legal and support (about a day, plus lawyer time)

**Do this first: new riders aren't getting their verification email.**
On 2026-10-05, Resend refused a new rider's verification email (HTTP 403),
twice. Your own alert emails still arrive. That pattern almost always means
the sending domain isn't verified in Resend, so it only delivers to the
account owner. Until a rider verifies their email they can't go live, join
voice, message, send friend requests or report hazards.

1. In Resend (resend.com → Domains), add a domain you own, for example
   `ridercomms.app`, and add the DNS records it shows at your domain
   registrar. A `github.io` address can't be verified.
2. Once Resend shows the domain as verified, set `RESEND_FROM_EMAIL` on the
   Railway backend to an address on it, for example
   `Rider Comms <noreply@ridercomms.app>`.
3. Sign up with a fresh email and check the verification email arrives. If
   it doesn't, the backend log line `Resend returned HTTP …` now includes
   Resend's reason.

1. Fill in `legal/site-details.json`: company legal name, support email and
   postal address. Then run `npm run build:legal` and merge.
2. Have a lawyer complete the sections the pages still show in brackets:
   data protection officer or representative, international transfers,
   police and camera reports, liability, and governing law.
3. Set up the support inbox and make sure someone reads it. Apple checks
   that it works.
4. Name who reviews reports. The app promises review within 24 hours
   (`MODERATION.md`).

## 2. Backup key, and optionally an off-Railway copy

1. **Save the backup key** (`rider-comms-backup.agekey`, sent in the
   session) in your password manager and one other safe place. Without it
   the daily backups can't be restored.

Optional: a copy outside Railway. The daily backup and the snapshots all
sit with Railway. The GitHub workflow can keep a copy elsewhere once it has:

1. The same age public key, or a new key pair.
2. A read-only database role, a TCP proxy on the Postgres service, and TLS
   on Postgres. The plain image has no certificate.
3. The `BACKUP_AGE_RECIPIENT` and `PRODUCTION_DATABASE_URL` repository
   secrets.
4. One manual run of the Database backup workflow, then a restore drill.

Steps and commands are in `BACKUP_RESTORE.md`. Until the secrets exist, the
nightly GitHub job passes with a warning and takes no copy.

## 3. Apple (a few days, mostly Apple's review time)

1. Join the Apple Developer Program and register the bundle ID
   `com.ridercomms.app`.
2. Decide the encryption export answer with your lawyer or export adviser
   before the first upload (`APP_REVIEW.md`, "Known judgement calls"). It
   decides one line in `mobile/app.json` and whether France needs a
   declaration.
3. Build and upload:
   `cd mobile && npx eas-cli build --platform ios --profile production`,
   then `npx eas-cli submit --platform ios`. Build numbers increment
   automatically.
4. Push notifications (friend requests and messages). The web app needs
   nothing: the server makes and keeps its own Web Push keys. For the
   iOS and Android apps:
   - Link the app to an Expo project: `cd mobile && npx eas-cli init`,
     then set its project id as the EAS environment variable
     `EAS_PROJECT_ID` (or leave the `extra.eas.projectId` that `eas init`
     writes into `app.json`).
   - iOS: `npx eas-cli credentials`, choose iOS, and let it create a push
     key (APNs). Build again so the app has the push entitlement.
   - Android: create a Firebase project for `com.ridercomms.app`, upload its
     FCM v1 service account key with `npx eas-cli credentials` (Android →
     Google Service Account → push notifications), and add
     `google-services.json` to the app config.
   - Optional: if you turn on "enhanced push security" in Expo, set
     `EXPO_ACCESS_TOKEN` on the server (Railway).
   - Test on a real phone: Settings → Notifications → turn it on, then
     send yourself a friend request and a message from another account.
5. Create two demo accounts with verified email that are friends with each
   other, for App Review.
6. Take screenshots from the TestFlight build (6.9" and 6.5" iPhone).
7. Fill in App Store Connect from `APP_REVIEW.md`: listing copy, privacy
   label, age rating, and review notes with the demo accounts.
8. Optional: to make shared links open the app, add the Apple Team ID and
   the association file (README, "Native app links and maps handoff").

## 4. Google Play (optional for launch)

1. Create a Play Console account and app.
2. Create the Android map key. Without it the Android map can't load, and
   the production build refuses to start:
   - In Google Cloud, enable **Maps SDK for Android** and create an API key.
   - Restrict it to Android apps: package `com.ridercomms.app` with the
     SHA-1 of the EAS upload key (`npx eas-cli credentials`) and of Play's
     app signing key (Play Console → Test and release → App integrity).
   - Save it in EAS as `GOOGLE_MAPS_ANDROID_API_KEY` for the production
     and preview environments: `npx eas-cli env:create --name
     GOOGLE_MAPS_ANDROID_API_KEY --environment production --environment
     preview --visibility sensitive`.
3. `cd mobile && npx eas-cli build --platform android --profile production`.
4. Fill in Data safety, target audience, content rating and the account
   deletion URL from `APP_REVIEW.md`.
5. Record the two short videos Play asks for to justify the foreground
   services: voice keeps going after the screen locks, and navigation keeps
   speaking turns after the screen locks (`APP_REVIEW.md`).

## 5. Device checks before submitting

On a real iPhone, with location and microphone allowed:

- Navigation with turn prompts while riding, including losing GPS in a
  tunnel.
- Navigation with the phone locked: start a route, lock the phone, and
  check the next turn is spoken, with and without voice chat and music
  playing. iPhone shows the blue location pill; Android shows a "Rider Comms
  navigation" notification. Both disappear when navigation ends.
- Ride Safe: controls lock above 8 mph and unlock after stopping. Check for
  false locks as a passenger.
- VoiceOver on sign-in, map, ride and chat, and the largest Dynamic Type
  size (`ACCESSIBILITY.md`).
- Account deletion from Settings.
- Voice on the first native build after the LiveKit React Native 3.0
  upgrade (#391): a group ride and Nearby, on iPhone and Android.
- Music from the rider's own app during a ride: it keeps playing, quieter,
  under voice chat and turn prompts, on iPhone and Android.
- Dark and light mode on Android follow the phone's setting.

## 6. Submit

Submit for review in App Store Connect. If App Review asks for sign-in-free
browsing, the planned answer is in `APP_REVIEW.md` ("Known judgement
calls").
