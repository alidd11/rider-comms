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

const DEFAULT_PUBLIC_APP_URL = 'https://alidd11.github.io/rider-comms/';

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

  let verifyUrlString: string;
  try {
    const verifyUrl = new URL(process.env.PUBLIC_APP_URL ?? DEFAULT_PUBLIC_APP_URL);
    if (verifyUrl.protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use HTTPS');
    verifyUrl.searchParams.set('verifyToken', token);
    verifyUrlString = verifyUrl.toString();
  } catch (error) {
    console.error('[rider-comms] Invalid PUBLIC_APP_URL — skipping verification email', error);
    return false;
  }
  const text = [
    'Welcome to Rider Comms!',
    '',
    `Verify your email by visiting: ${verifyUrlString}`,
    '',
    `Or enter this verification code in the app: ${token}`,
    '',
    'This link/code expires in 24 hours. If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `<p>Welcome to Rider Comms!</p><p>Verify your email by clicking the link below:</p><p><a href="${verifyUrlString}">${verifyUrlString}</a></p><p>Or enter this verification code in the app: <strong>${token}</strong></p><p>This link/code expires in 24 hours. If you did not create this account, you can ignore this email.</p>`;

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
