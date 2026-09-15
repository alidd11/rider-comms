import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { generateRideCode } from '@rider-comms/shared';
import { getPool, ensureMigrated } from './db.ts';
import { sendVerificationEmail } from './email.ts';

const scryptAsync = promisify(scrypt);

export interface GuestSession { riderId: string; token: string; }
export interface LoginSession extends GuestSession { emailVerified: boolean; }

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
// Simple, deliberately non-exhaustive email check (not full RFC 5322) —
// good enough to reject obvious typos/garbage without rejecting a real
// address some stricter regex doesn't happen to anticipate.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_KEYLEN = 64;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type SignUpResult = GuestSession | { error: 'username_taken' | 'email_taken' | 'invalid_username' | 'invalid_email' | 'weak_password' };
export type LogInResult = LoginSession | { error: 'invalid_credentials' };
export type VerifyEmailResult = { riderId: string; verified: true } | { error: 'invalid_token' | 'expired_token' };
export type ResendVerificationResult = { sent: true } | { error: 'not_found' | 'already_verified' };

function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

function isStrongEnoughPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expectedKey = Buffer.from(keyHex, 'hex');
  const derivedKey = (await scryptAsync(password, salt, expectedKey.length)) as Buffer;
  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}

export class AuthStore {
  private riderByTokenDigest = new Map<string, string>();
  private issuedRiderIds = new Set<string>();

  /**
   * Injectable so tests never make a real Resend API call (see
   * email.test.ts and the signup/verification tests in authStore.test.ts) —
   * defaults to the real sender, which itself no-ops loudly when
   * RESEND_API_KEY isn't configured.
   */
  private readonly sendVerificationEmailFn: typeof sendVerificationEmail;
  constructor(sendVerificationEmailFn: typeof sendVerificationEmail = sendVerificationEmail) {
    this.sendVerificationEmailFn = sendVerificationEmailFn;
  }

  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  createGuest(): GuestSession {
    let riderId: string;
    do { riderId = `rider_${generateRideCode(8).toLowerCase()}`; } while (this.issuedRiderIds.has(riderId));
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    this.riderByTokenDigest.set(this.digest(token), riderId);
    return { riderId, token };
  }
  hasRider(riderId: string): boolean { return this.issuedRiderIds.has(riderId); }
  riderForToken(token: string): string | undefined { return token ? this.riderByTokenDigest.get(this.digest(token)) : undefined; }
  deleteRider(riderId: string): void {
    this.issuedRiderIds.delete(riderId);
    for (const [digest, issuedRiderId] of this.riderByTokenDigest) {
      if (issuedRiderId === riderId) this.riderByTokenDigest.delete(digest);
    }
  }
  createTestSession(riderId: string): GuestSession {
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    this.riderByTokenDigest.set(this.digest(token), riderId);
    return { riderId, token };
  }
  private issueSession(riderId: string): GuestSession {
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    this.riderByTokenDigest.set(this.digest(token), riderId);
    return { riderId, token };
  }
  /**
   * Real, persistent account signup. Credentials live in Postgres (see
   * db.ts); the issued session token is still tracked only in-memory, same
   * as guest sessions — restarting the backend logs everyone out but never
   * loses an account.
   */
  async signUp(username: unknown, email: unknown, password: unknown): Promise<SignUpResult> {
    if (!isValidUsername(username)) return { error: 'invalid_username' };
    if (!isValidEmail(email)) return { error: 'invalid_email' };
    if (!isStrongEnoughPassword(password)) return { error: 'weak_password' };
    await ensureMigrated();
    const passwordHash = await hashPassword(password);
    let riderId: string;
    do { riderId = `rider_${generateRideCode(8).toLowerCase()}`; } while (this.issuedRiderIds.has(riderId));
    const pool = getPool();
    try {
      await pool.query(
        'INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4)',
        [riderId, username, email, passwordHash]
      );
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (constraint === 'users_email_lower_idx') return { error: 'email_taken' };
      if (constraint === 'users_username_lower_idx') return { error: 'username_taken' };
      throw error;
    }
    // Never let a Resend hiccup (or a missing RESEND_API_KEY, in any
    // environment that hasn't configured it yet) block account creation —
    // issueVerification() already swallows send failures internally.
    await this.issueVerification(riderId, email);
    return this.issueSession(riderId);
  }

  async logIn(username: unknown, password: unknown): Promise<LogInResult> {
    if (typeof username !== 'string' || typeof password !== 'string') return { error: 'invalid_credentials' };
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; password_hash: string; email_verified_at: Date | null }>(
      'SELECT id, password_hash, email_verified_at FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) return { error: 'invalid_credentials' };
    const session = this.issueSession(row.id);
    // Verification is informational only — login is never gated on it, so
    // a client can nudge an unverified rider without blocking sign-in.
    return { ...session, emailVerified: row.email_verified_at !== null };
  }

  /**
   * (Re)issues a fresh verification token for `riderId`/`email`, replacing
   * any outstanding one (so an old email link can't be verified after a
   * newer one was requested), and sends it via Resend. Send failures are
   * logged (inside sendVerificationEmailFn) and never thrown — the token
   * is already persisted either way, so the rider can still be verified
   * later (e.g. once Resend is configured) without re-requesting.
   */
  private async issueVerification(riderId: string, email: string): Promise<void> {
    const pool = getPool();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.digest(token);
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [riderId]);
    await pool.query(
      'INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, riderId, new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)]
    );
    await this.sendVerificationEmailFn(email, token);
  }

  async verifyEmail(token: unknown): Promise<VerifyEmailResult> {
    if (typeof token !== 'string' || !token) return { error: 'invalid_token' };
    await ensureMigrated();
    const pool = getPool();
    const tokenHash = this.digest(token);
    const { rows } = await pool.query<{ user_id: string; expires_at: Date }>(
      'SELECT user_id, expires_at FROM email_verifications WHERE token_hash = $1',
      [tokenHash]
    );
    const row = rows[0];
    if (!row) return { error: 'invalid_token' };
    // Always invalidate on use (or expiry) — a token is single-use either
    // way, so it can't be replayed after a successful verify.
    await pool.query('DELETE FROM email_verifications WHERE token_hash = $1', [tokenHash]);
    if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'expired_token' };
    await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [row.user_id]);
    return { riderId: row.user_id, verified: true };
  }

  async resendVerification(riderId: string): Promise<ResendVerificationResult> {
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ email: string | null; email_verified_at: Date | null }>(
      'SELECT email, email_verified_at FROM users WHERE id = $1',
      [riderId]
    );
    const row = rows[0];
    if (!row || !row.email) return { error: 'not_found' };
    if (row.email_verified_at) return { error: 'already_verified' };
    await this.issueVerification(riderId, row.email);
    return { sent: true };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** The violated unique index's name (e.g. `users_email_lower_idx`), so callers can tell *which* field collided. */
function uniqueViolationConstraint(error: unknown): string | undefined {
  if (!isUniqueViolation(error)) return undefined;
  return (error as { constraint?: string }).constraint;
}
