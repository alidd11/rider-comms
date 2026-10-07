# Subscriptions: store setup

Rider Comms sells two auto-renewing monthly subscriptions. They only widen
the Nearby range.

| Plan | Product ID (both stores) | Price | Nearby range |
| --- | --- | --- | --- |
| Free | none | Free | 1 mi |
| Premium | `premium_monthly` | $4.99 / month | 6 mi |
| Premium+ | `premium_plus_monthly` | $9.99 / month | 20 mi |

How it works:

- The app buys through StoreKit (iOS) or Google Play Billing (Android),
  using `expo-iap`.
- The app sends the server only the transaction ID or purchase token. The
  server asks Apple or Google for the subscription
  (`backend/src/storeBilling.ts`) and only then sets the plan
  (`backend/src/billingStore.ts`). The app can't set its own plan.
- Each purchase is tied to the Rider Comms account that bought it (Apple's
  `appAccountToken`, Google's `obfuscatedAccountId`). Another account can't
  use it.
- Renewals, cancellations and refunds come from store notifications. A
  15-minute sweep also re-checks any subscription close to its end, so a
  missed notification can't leave a rider on the wrong plan.

Until the backend has store credentials, the plan screen shows the plans but
buying is switched off ("Subscriptions can't be bought right now").

## 1. App Store Connect

1. **Agreements, Tax, and Banking:** accept the Paid Apps agreement, and add
   bank and tax details. Nothing can be sold until this is active.
2. **Your app → Monetization → Subscriptions:** create a subscription group
   named `Rider Comms plans`.
3. In that group, create two subscriptions:

   | Reference name | Product ID | Duration | Price | Level |
   | --- | --- | --- | --- | --- |
   | Premium+ monthly | `premium_plus_monthly` | 1 month | $9.99 (tier) | 1 (highest) |
   | Premium monthly | `premium_monthly` | 1 month | $4.99 (tier) | 2 |

   Put Premium+ above Premium in the group. Apple then treats moving to
   Premium+ as an upgrade (immediate) and moving to Premium as a downgrade
   (from the next renewal).
4. For each subscription, add an App Store localization:
   - Display name: `Premium` or `Premium+`.
   - Description: `6 mile Nearby range` or `20 mile Nearby range`.
5. Add a review screenshot of the plan screen. A simulator screenshot is fine.
6. Add the subscriptions to the app version you submit, under **In-App
   Purchases and Subscriptions** on the version page.
7. **App Information:**
   - Set the License Agreement to the custom EULA
     `https://alidd11.github.io/rider-comms/terms.html`, or keep Apple's
     standard EULA.
   - Either way, the app description must link to the Terms of Use and the
     Privacy Policy (guideline 3.1.2).
8. **Users and Access → Integrations → In-App Purchase:** generate an
   in-app purchase key. Download the `.p8` file (you can only download it
   once), and note the **Key ID** and the **Issuer ID** shown on that page.
9. **App Information → App Store Server Notifications:** set both the
   Production and Sandbox URL to
   `https://backend-production-7fa0.up.railway.app/billing/apple/notifications`,
   with **Version 2**.
10. **Users and Access → Sandbox:** create a sandbox tester for testing
    purchases on a device.

## 2. Google Play Console

1. **Monetization setup:** set up a payments profile (merchant account).
2. **Your app → Monetize → Products → Subscriptions:** create two
   subscriptions:

   | Product ID | Name | Base plan ID | Billing period | Price |
   | --- | --- | --- | --- | --- |
   | `premium_monthly` | Premium | `monthly` | 1 month, auto-renewing | $4.99 (set local prices) |
   | `premium_plus_monthly` | Premium+ | `monthly` | 1 month, auto-renewing | $9.99 (set local prices) |

   Activate both base plans. Don't add offers for now. The app buys the
   base plan.
3. **Google Cloud Console** (the project linked to Play Console):
   1. Enable the **Google Play Android Developer API**.
   2. Create a **service account** and download a JSON key for it.
4. **Play Console → Users and permissions:** invite the service account's
   email address, with app permissions **View financial data** and **Manage
   orders and subscriptions**. It can take up to 24 hours to start working.
5. **Real-time developer notifications:**
   1. In Google Cloud, create a Pub/Sub topic, e.g. `play-billing`.
   2. Grant `google-play-developer-notifications@system.gserviceaccount.com`
      the **Pub/Sub Publisher** role on that topic.
   3. Add a **push** subscription to the topic, with endpoint
      `https://backend-production-7fa0.up.railway.app/billing/google/notifications?token=<GOOGLE_RTDN_TOKEN>`.
      Use the same random value you set for `GOOGLE_RTDN_TOKEN` below.
   4. In Play Console go to **Monetize → Monetization setup**, enter the
      topic name, and press **Send test notification**.
6. **License testing:** add your Google account so test purchases aren't
   charged.

## 3. Backend (Railway) variables

| Variable | Value |
| --- | --- |
| `APPLE_IAP_KEY_ID` | Key ID from App Store Connect step 8 |
| `APPLE_IAP_ISSUER_ID` | Issuer ID from App Store Connect step 8 |
| `APPLE_IAP_PRIVATE_KEY` | Full contents of the `.p8` file. Newlines may be written as `\n`. |
| `APPLE_BUNDLE_ID` | Optional; defaults to `com.ridercomms.app` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Full contents of the service account JSON key |
| `GOOGLE_PLAY_PACKAGE_NAME` | Optional; defaults to `com.ridercomms.app` |
| `GOOGLE_RTDN_TOKEN` | A long random string, e.g. `openssl rand -hex 32`; also used in the Pub/Sub push URL |

To check them after deploying, look for this line in the deploy logs:
`{"event":"billing_configured","purchasesEnabled":true}`.

## 4. Test before submitting

1. Install a development or TestFlight build and sign in.
2. Open Settings → Account → Your plan. Check that the store prices load.
3. Buy Premium with the sandbox tester (iOS) or license tester (Android).
   - The plan should switch to Premium within a few seconds.
   - Going live on Nearby should report a 6 mi range.
4. Upgrade to Premium+, then use **Manage subscription** to cancel.
   - The plan screen should say "Ends …" and keep Premium+ until then.
5. Delete and reinstall the app, sign in, and tap **Restore purchases**.
6. Sign in to a second Rider Comms account on the same store account and tap
   **Restore purchases**. It should say the subscription belongs to another
   account.

Sandbox renewals are fast: a monthly subscription renews every 5 minutes, up
to 12 times. That's a quick way to watch renewals and expiry reach the
server.
