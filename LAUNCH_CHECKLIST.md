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
- Production monitoring: uptime checks every 10 minutes, crash and error
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

## 1. Legal and support (about a day, plus lawyer time)

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
4. Create two demo accounts with verified email that are friends with each
   other, for App Review.
5. Take screenshots from the TestFlight build (6.9" and 6.5" iPhone).
6. Fill in App Store Connect from `APP_REVIEW.md`: listing copy, privacy
   label, age rating, and review notes with the demo accounts.
7. Optional: to make shared links open the app, add the Apple Team ID and
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

## 6. Submit

Submit for review in App Store Connect. If App Review asks for sign-in-free
browsing, the planned answer is in `APP_REVIEW.md` ("Known judgement
calls").
