/**
 * Sends the "verify your email" message via Resend (https://resend.com).
 *
 * RESEND_API_KEY is read from process.env lazily, at call time — same
 * lazy-init contract as DATABASE_URL in db.ts — so importing this module
 * never throws and a backend without the key configured still boots and
 * completes signup end-to-end; it just skips the actual send and logs
 * loudly about why, the same graceful-degrade contract searchPlaces() uses
 * in mobile/src/api/places.ts for a missing Google Places key and
 * loadGoogleMaps() uses in docs/app.js for a missing Google Maps key.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

// docs/ (the PWA) has no dedicated verify-email screen yet — it's a
// hash-routed single-page app (see docs/app.js) with a fixed set of
// screens (#map, #ride, #routes, #friends, #settings) and none of them is
// this. Rather than link to a page that 404s, point at a plausible future
// route and rely on the verification *code* printed alongside it, which
// works with no client changes at all. Whoever builds the PWA/mobile
// verify screen just needs to read `token` off this same query param.
const VERIFY_URL_BASE = 'https://alidd11.github.io/rider-comms/verify-email';

export interface SendVerificationEmailOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Never throws — returns whether the email was actually sent. Callers
 * (authStore.ts) treat a `false` the same as `true` for the purposes of
 * signup succeeding: a missing key or a Resend outage must never block
 * account creation.
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  { fetchImpl = fetch }: SendVerificationEmailOptions = {}
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    // Fires on every signup in any environment that hasn't configured
    // Resend yet (including this one, until the app owner's Resend account
    // is ready) — loud and specific on purpose, matching loadGoogleMaps()'s
    // console.warn for a missing Google Maps key, so it's never a silent
    // no-op that's confusing to debug later.
    console.warn(
      `[rider-comms] RESEND_API_KEY/RESEND_FROM_EMAIL not set — skipping verification email to ${email}. Set both environment variables to enable email verification sends.`
    );
    return false;
  }

  const verifyUrl = `${VERIFY_URL_BASE}?token=${encodeURIComponent(token)}`;
  const text = [
    'Welcome to Rider Comms!',
    '',
    `Verify your email by visiting: ${verifyUrl}`,
    '',
    `Or enter this verification code in the app: ${token}`,
    '',
    'This link/code expires in 24 hours. If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `<p>Welcome to Rider Comms!</p><p>Verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>Or enter this verification code in the app: <strong>${token}</strong></p><p>This link/code expires in 24 hours. If you did not create this account, you can ignore this email.</p>`;

  try {
    const response = await fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: 'Verify your Rider Comms email',
        text,
        html,
      }),
    });
    if (!response.ok) {
      console.error(`[rider-comms] Resend API returned HTTP ${response.status} sending a verification email to ${email}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[rider-comms] Failed to send verification email via Resend', error);
    return false;
  }
}
