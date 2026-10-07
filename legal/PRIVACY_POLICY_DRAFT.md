# Rider Comms Privacy Policy: DRAFT

> **Draft for legal review, not for publication.** Written by engineering to
> describe what the software actually does as of the repository state it ships
> with. A qualified lawyer must review it for your jurisdiction, your legal
> entity and your final launch configuration before it is published at a
> stable HTTPS URL and linked from the app and store listings. Items in
> `[brackets]` must be filled in. Keep this file in sync with `RETENTION.md`.

**Last updated:** [date]

[Company legal name] ("we", "us") operates Rider Comms, an app for motorcycle
and moped riders that provides group voice, private group rides, rider
presence nearby, hazard reports, messaging and navigation. This policy
explains what personal data we collect, why, who we share it with, how long we
keep it and your choices.

Contact: [support email] · [postal address] · [Data Protection Officer or EU/UK
representative, if required]

## What we collect and why

| Data | When | Why | Legal basis (GDPR-style)[confirm] |
| --- | --- | --- | --- |
| Username, email address, password (stored only as a salted hash) | Creating an account | To run your account, verify your email and let you reset your password | Contract |
| Profile: display name, handle, avatar, distance units, optional Instagram/TikTok usernames with your chosen visibility | When you edit your profile | To show you to other riders the way you choose | Contract |
| Precise location | While the app is in use. The one exception is turn-by-turn navigation you start: it keeps using your location with the screen locked so directions continue, and stops when navigation ends. | Nearby riders (only if you turn on sharing and go live), private-ride locations (only if you opt in for that ride), hazard reports, map search, navigation | Consent (you can turn each off at any time) |
| Voice audio | Only while you're connected to a voice channel | Carried live between riders by our voice provider. We don't record or store voice. | Contract |
| Messages, friend requests, hideouts | When you use them | To deliver them to the riders you choose | Contract |
| Hazard reports and confirmations | When you submit them | To warn nearby riders; they expire within hours | Legitimate interest (road safety) |
| Reports and blocks about other riders | When you report or block | To keep riders safe and enforce our rules | Legitimate interest / legal obligation |
| Subscription details: which plan, the store's transaction or purchase ID, renewal date and status. We never see your card or payment details. | When you subscribe or restore a purchase | To give you the plan you paid for, and to keep it in step with renewals, cancellations and refunds | Contract |
| Device name, sign-in times, session tokens (stored only as hashes) | Each sign-in | So you can see and sign out of your devices, and to protect your account | Contract / legitimate interest (security) |
| IP address, request logs | Every request | Security, abuse prevention and troubleshooting. Rate limiting uses a one-way hash of your IP address. | Legitimate interest (security) |
| Product usage: when you were last active, and when you first joined a group ride or went live on Nearby | As you use the app | To understand, in aggregate, whether new riders find the app useful. Our staff dashboard shows only totals. | Legitimate interest (improving the service) |
| Crash reports: error message, technical stack trace, platform, app version | When the app hits an unexpected error | To find and fix bugs. Kept only in server logs, not linked to your account. | Legitimate interest (reliability) |

We don't use advertising SDKs, don't sell personal data, don't track you
across other apps or websites, and don't collect location in the background
except during navigation you start. Your position is shared with other
riders only while the app is open and sharing is on.

## Who we share data with

Other riders see only what the app shows them under your settings (for
example, your profile, and your location only while you share it).

We use these service providers ("processors"), who handle data only on our
instructions:

| Provider | What they receive | Purpose |
| --- | --- | --- |
| [Hosting provider, e.g. Railway] | All account and app data, request logs | Runs our servers and database |
| LiveKit | Live voice audio, your rider ID, room membership | Real-time voice |
| Google (Maps Platform) | Map views, search text and nearby coordinates, route start and end points | Maps, place search and navigation. Place searches and routes go through our servers, so Google sees our server, not your device. The web app loads Google Maps directly in your browser. |
| Apple (Apple Maps, iOS app only) | Map views of the area you're looking at | The iOS app's base map. Android shows Google Maps. |
| Resend | Your email address and the message | Verification and password-reset emails |
| GitHub Pages | Standard web request data | Hosts the web app |
| Apple App Store and Google Play | Your purchase, under their own privacy policies. We send them the transaction ID to check a subscription, and a one-way code for your account so a purchase is tied to it. | App distribution, and selling and verifying subscriptions |

We may also disclose data where the law requires it, or to protect someone
from serious harm.

[International transfers: describe where each provider processes data and the
safeguard used, e.g. Standard Contractual Clauses.]

## How long we keep data

Summary of our retention schedule:

- **Live locations** are shown for about 30 seconds and deleted within an hour.
- **Your last nearby-sharing position** is kept for 30 minutes, only to check
  that each new position is physically possible (this stops people faking
  locations to find other riders). It is never shown to anyone.
- **Hazard reports** expire after 1–8 hours depending on type.
- **Ride join codes** expire after 12 hours. Rides are deleted when the host
  ends them, or 30 days after creation at the latest.
- **Sign-in sessions** last 30 days. Email-verification links last 24 hours,
  and password-reset links last 1 hour.
- **Messages, friendships, profile and account data**, and **subscription
  details**, are kept until you delete your account. [Owner decision: add an age limit for messages?]
- **Reports and moderation decisions** about a rider are kept until that
  rider's account is deleted. [Owner decision: shorter limit?]
- **Backups** are kept for 30 days, so deleted data can remain in a backup
  for up to 30 days after deletion.
- **Server logs** are kept for [hosting provider log retention].

## Your choices and rights

- **Location:** sharing is off by default. Nearby sharing and each private
  ride's sharing are separate switches, and you can turn them off at any time.
  You can also withdraw location permission in your device settings.
- **Social handles:** each can be Public, Friends only or Private.
- **Blocking and reporting** are available from profiles, chats, ride rosters,
  friend requests and Nearby Voice. You can review and undo blocks in Settings.
- **Delete your account** in Settings. This permanently deletes your account
  and associated data straight away (except backups, as above). If your
  account is suspended and you can't sign in, contact [support email] to
  request deletion.
- Depending on where you live, you may have rights to access, correct,
  export, restrict or object to processing of your data, and to complain to
  your data protection authority ([e.g. ICO in the UK]). Contact [support
  email] and we'll respond within [30 days / the legal deadline].

## Safety and moderation

Reports are reviewed by our moderators. We may suspend accounts that break our
[Terms](TERMS_DRAFT.md) and [Community Guidelines](COMMUNITY_GUIDELINES.md). We review reports within 24 hours. A suspension revokes all sign-ins. Decisions are
logged, and you can appeal by contacting [support email].

## Security

Passwords and session tokens are stored only as one-way hashes. Traffic is
encrypted in transit (HTTPS). Backups are encrypted. Access to production
systems is limited to [roles]. No system is perfectly secure; we'll notify
you and regulators of a breach where the law requires.

## Children

Rider Comms is not intended for anyone under [16 / the minimum age in your
country / the age required to ride]. We don't knowingly collect data from
children. Contact us if you believe a child has created an account.

## Changes

We'll update this policy when our practices change, and give notice in the
app of material changes.
