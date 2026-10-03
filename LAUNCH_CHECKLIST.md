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

## 2. Off-site backups (about an hour)

Railway snapshots already exist, but they sit with the same provider as the
database. The off-site copy needs:

1. An age key pair. Keep the private key in two safe places.
2. A read-only database role, a TCP proxy on the Postgres service, and TLS
   on Postgres. The plain image has no certificate.
3. The `BACKUP_AGE_RECIPIENT` and `PRODUCTION_DATABASE_URL` repository
   secrets.
4. One manual run of the Database backup workflow, then a restore drill.

Steps and commands are in `BACKUP_RESTORE.md`. Until the secrets exist, the
nightly backup job fails on purpose.

## 3. Apple (a few days, mostly Apple's review time)

1. Join the Apple Developer Program and register the bundle ID
   `com.ridercomms.app`.
2. Build and upload:
   `cd mobile && npx eas-cli build --platform ios --profile production`,
   then `npx eas-cli submit --platform ios`. Build numbers increment
   automatically.
3. Create two demo accounts with verified email that are friends with each
   other, for App Review.
4. Take screenshots from the TestFlight build (6.9" and 6.5" iPhone).
5. Fill in App Store Connect from `APP_REVIEW.md`: listing copy, privacy
   label, age rating, and review notes with the demo accounts.
6. Optional: to make shared links open the app, add the Apple Team ID and
   the association file (README, "Native app links and maps handoff").

## 4. Google Play (optional for launch)

1. Create a Play Console account and app.
2. `cd mobile && npx eas-cli build --platform android --profile production`.
3. Fill in Data safety, target audience, content rating and the account
   deletion URL from `APP_REVIEW.md`.
4. Record the short video Play asks for to justify the microphone
   foreground service: voice keeps going after the screen locks.

## 5. Device checks before submitting

On a real iPhone, with location and microphone allowed:

- Navigation with turn prompts while riding, including losing GPS in a
  tunnel.
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
