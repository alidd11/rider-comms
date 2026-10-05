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

import { createHash } from 'node:crypto';

const RESEND_API_URL = 'https://api.resend.com/emails';
// Signup, resend and password reset wait for the send. A hung Resend request
// must give up well inside the apps' own 10 s request timeout, or signup
// would succeed on the server while the app reports a failure (OUTAGES.md).
export const RESEND_TIMEOUT_MS = 5_000;

export const DEFAULT_PUBLIC_APP_URL = 'https://alidd11.github.io/rider-comms/';

export interface SendVerificationEmailOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Resend's error body explains a refusal ("verify a domain", "invalid
// address") but can quote email addresses, which must not reach the logs.
async function resendErrorReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: unknown; message?: unknown };
    const parts = [body?.name, body?.message].filter((part): part is string => typeof part === 'string' && part.length > 0);
    return parts.join(': ').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]').slice(0, 300);
  } catch {
    return '';
  }
}

function recipientId(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

async function sendEmail(
  email: string,
  subject: string,
  text: string,
  html: string,
  fetchImpl: typeof fetch,
  timeoutMs = RESEND_TIMEOUT_MS
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const recipient = recipientId(email);
  if (!apiKey || !from) {
    console.warn(`[rider-comms] Email delivery is not configured; skipped recipient ${recipient}.`);
    return false;
  }
  try {
    const response = await fetchImpl(RESEND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: email, subject, text, html }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const reason = await resendErrorReason(response);
      console.error(`[rider-comms] Resend returned HTTP ${response.status} for recipient ${recipient}${reason ? ` (${reason})` : ''}.`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[rider-comms] Resend request failed for recipient ${recipient}.`, error);
    return false;
  }
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
  { fetchImpl = fetch, timeoutMs = RESEND_TIMEOUT_MS }: SendVerificationEmailOptions = {}
): Promise<boolean> {
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

  return sendEmail(email, 'Verify your Rider Comms email', text, html, fetchImpl, timeoutMs);
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  { fetchImpl = fetch }: SendVerificationEmailOptions = {}
): Promise<boolean> {
  let resetUrlString: string;
  try {
    const resetUrl = new URL(process.env.PUBLIC_APP_URL ?? DEFAULT_PUBLIC_APP_URL);
    if (resetUrl.protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use HTTPS');
    resetUrl.searchParams.set('resetToken', token);
    resetUrlString = resetUrl.toString();
  } catch (error) {
    console.error('[rider-comms] Invalid PUBLIC_APP_URL — skipping password reset email', error);
    return false;
  }
  const text = [
    'Reset your Rider Comms password',
    '',
    `Open this secure link: ${resetUrlString}`,
    '',
    `Or enter this reset code in the app: ${token}`,
    '',
    'This link/code expires in one hour. If you did not request it, you can ignore this email.',
  ].join('\n');
  const html = `<p>Reset your Rider Comms password</p><p><a href="${resetUrlString}">Choose a new password</a></p><p>Or enter this reset code in the app: <strong>${token}</strong></p><p>This link/code expires in one hour. If you did not request it, you can ignore this email.</p>`;
  return sendEmail(email, 'Reset your Rider Comms password', text, html, fetchImpl);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Staff-only operational email (error alerts). Never throws. */
export async function sendOperationalEmail(
  to: string,
  subject: string,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  return sendEmail(to, subject, text, `<pre style="white-space:pre-wrap;font-family:monospace">${escapeHtml(text)}</pre>`, fetchImpl);
}
