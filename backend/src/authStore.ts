import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { errorFields, log } from './log.ts';
import { roleCan } from './staffRoles.ts';
import type { StaffPermission, StaffRole } from './staffRoles.ts';
import type { ScryptOptions } from 'node:crypto';
import { generateRideCode } from '@rider-comms/shared';
import { getPool, ensureMigrated, withTransaction } from './db.ts';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.ts';
import { containsObjectionableText } from './contentFilter.ts';


export interface GuestSession { riderId: string; token: string; }
export interface LoginSession extends GuestSession { emailVerified: boolean; termsAccepted: boolean; }
export interface SignUpSession extends LoginSession { emailVerificationSent: boolean; }
export interface AccountIdentity { riderId: string; username: string; emailVerified: boolean; termsAccepted: boolean; }

/**
 * The Terms of Service and Community Guidelines riders must agree to. Bump
 * this when either document changes materially: everyone is asked to agree
 * again before they next post or join voice.
 */
export const TERMS_VERSION = '2026-10-01';
export interface AccountSessionSummary { id: string; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean; }

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
// Simple, deliberately non-exhaustive email check (not full RFC 5322) —
// good enough to reject obvious typos/garbage without rejecting a real
// address some stricter regex doesn't happen to anticipate.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_KEYLEN = 64;
const LEGACY_PASSWORD_ALGORITHM = 'scrypt-v1';
const PASSWORD_ALGORITHM = 'scrypt-v2';
const SCRYPT_V2_OPTIONS: ScryptOptions = {
  N: 2 ** 15,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
};
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How long account security history is kept. */
export const SECURITY_EVENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const SECURITY_EVENTS = ['account_created', 'login', 'login_failed', 'signed_out', 'session_revoked', 'password_reset', 'reauthenticated', 'reauth_failed'] as const;
export type SecurityEventType = (typeof SECURITY_EVENTS)[number];
export interface SecurityEvent {
  id: string;
  riderId: string;
  event: SecurityEventType;
  sessionId: string | null;
  device: string | null;
  createdAt: number;
}
const MAX_PASSWORD_LENGTH = 128;
// A valid, fixed scrypt record used only to equalise the cost of an unknown
// username and a wrong password. Without it, login timing exposes whether a
// username exists before credentials have been authenticated.
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(SCRYPT_KEYLEN)}`;

export type SignUpResult = SignUpSession | { error: 'username_taken' | 'email_taken' | 'invalid_username' | 'invalid_email' | 'weak_password' | 'objectionable_username' };
export type LogInResult = LoginSession | { error: 'invalid_credentials' | 'account_suspended' };
export type VerifyEmailResult = { riderId: string; verified: true } | { error: 'invalid_token' | 'expired_token' };
export type ResendVerificationResult = { sent: boolean } | { error: 'not_found' | 'already_verified' };
export type ResetPasswordResult = { reset: true } | { error: 'invalid_token' | 'expired_token' | 'weak_password' };

function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_PATTERN.test(email);
}

function isStrongEnoughPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 8 && password.length <= MAX_PASSWORD_LENGTH;
}

function scryptOptionsForAlgorithm(algorithm: string): ScryptOptions | null {
  if (algorithm === LEGACY_PASSWORD_ALGORITHM) return {};
  if (algorithm === PASSWORD_ALGORITHM) return SCRYPT_V2_OPTIONS;
  return null;
}

function derivePassword(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string, algorithm = PASSWORD_ALGORITHM): Promise<string> {
  const options = scryptOptionsForAlgorithm(algorithm);
  if (!options) throw new Error(`Unsupported password algorithm: ${algorithm}`);
  const salt = randomBytes(16);
  const derivedKey = await derivePassword(password, salt, SCRYPT_KEYLEN, options);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

const STORED_PASSWORD_PATTERN = new RegExp(`^[0-9a-f]{32}:[0-9a-f]{${SCRYPT_KEYLEN * 2}}$`, 'i');

async function verifyPassword(password: string, stored: string, algorithm: string): Promise<boolean> {
  const options = scryptOptionsForAlgorithm(algorithm);
  // Strict hex: Buffer.from(…, 'hex') silently drops non-hex input, and an
  // empty expected key would compare equal to an empty derived key.
  if (!options || !STORED_PASSWORD_PATTERN.test(stored)) return false;
  const [saltHex, keyHex] = stored.split(':');
  const expectedKey = Buffer.from(keyHex, 'hex');
  const derivedKey = await derivePassword(password, Buffer.from(saltHex, 'hex'), expectedKey.length, options).catch(() => null);
  return derivedKey !== null && timingSafeEqual(derivedKey, expectedKey);
}

export class AuthStore {
  private riderByTokenDigest = new Map<string, { riderId: string; expiresAt: number; sessionId: string; reauthenticatedAt?: number }>();
  private issuedRiderIds = new Set<string>();

  /**
   * Injectable so tests never make a real Resend API call (see
   * email.test.ts and the signup/verification tests in authStore.test.ts) —
   * defaults to the real sender, which itself no-ops loudly when
   * RESEND_API_KEY isn't configured.
   */
  private readonly sendVerificationEmailFn: typeof sendVerificationEmail;
  private readonly sendPasswordResetEmailFn: typeof sendPasswordResetEmail;
  constructor(
    sendVerificationEmailFn: typeof sendVerificationEmail = sendVerificationEmail,
    sendPasswordResetEmailFn: typeof sendPasswordResetEmail = sendPasswordResetEmail
  ) {
    this.sendVerificationEmailFn = sendVerificationEmailFn;
    this.sendPasswordResetEmailFn = sendPasswordResetEmailFn;
  }

  private digest(token: string): string { return sessionTokenHash(token); }
  private deviceName(value: unknown): string {
    if (typeof value !== 'string') return 'Unknown device';
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 120) || 'Unknown device';
  }
  async hasRider(riderId: string): Promise<boolean> {
    if (this.issuedRiderIds.has(riderId)) return true;
    if (!process.env.DATABASE_URL) return false;
    await ensureMigrated();
    const { rowCount } = await getPool().query('SELECT 1 FROM users WHERE id = $1', [riderId]);
    return Boolean(rowCount);
  }
  async riderForToken(token: string): Promise<string | undefined> {
    if (!token) return undefined;
    const tokenHash = this.digest(token);
    const cached = this.riderByTokenDigest.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) return cached.riderId;
    if (cached) this.riderByTokenDigest.delete(tokenHash);
    if (!process.env.DATABASE_URL) return undefined;
    await ensureMigrated();
    const { rows } = await getPool().query<{ user_id: string }>(
      'SELECT user_id FROM account_sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash]
    );
    const row = rows[0];
    if (!row) {
      await getPool().query('DELETE FROM account_sessions WHERE token_hash = $1 AND expires_at <= now()', [tokenHash]);
      return undefined;
    }
    await getPool().query(
      `UPDATE account_sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'`,
      [tokenHash]
    );
    return row.user_id;
  }
  async revokeToken(token: string): Promise<void> {
    if (!token) return;
    const tokenHash = this.digest(token);
    this.riderByTokenDigest.delete(tokenHash);
    if (!process.env.DATABASE_URL) return;
    await ensureMigrated();
    const removed = await getPool().query<{ id: string; user_id: string }>('DELETE FROM account_sessions WHERE token_hash = $1 RETURNING id, user_id', [tokenHash]);
    await getPool().query('DELETE FROM push_subscriptions WHERE session_token_hash = $1', [tokenHash]);
    const session = removed.rows[0];
    if (session) await this.recordSecurityEvent(session.user_id, 'signed_out', session.id, null);
  }
  /** The session behind a bearer token, so a link can be tied to it. */
  async sessionIdForToken(token: string): Promise<string | undefined> {
    if (!token) return undefined;
    const tokenHash = this.digest(token);
    const cached = this.riderByTokenDigest.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) return cached.sessionId;
    if (!process.env.DATABASE_URL) return undefined;
    await ensureMigrated();
    const { rows } = await getPool().query<{ id: string }>(
      'SELECT id FROM account_sessions WHERE token_hash = $1 AND expires_at > now()',
      [tokenHash],
    );
    return rows[0]?.id;
  }
  /** Whether that session is still signed in for this rider. */
  async isSessionActive(riderId: string, sessionId: string): Promise<boolean> {
    if (!riderId || !sessionId) return false;
    for (const session of this.riderByTokenDigest.values()) {
      if (session.sessionId === sessionId) return session.riderId === riderId && session.expiresAt > Date.now();
    }
    if (!process.env.DATABASE_URL) return false;
    await ensureMigrated();
    const { rowCount } = await getPool().query(
      'SELECT 1 FROM account_sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()',
      [sessionId, riderId],
    );
    return Boolean(rowCount);
  }
  /** Removes process-local test/session state after durable deletion commits. */
  forgetRider(riderId: string): void {
    this.issuedRiderIds.delete(riderId);
    for (const [digest, session] of this.riderByTokenDigest) {
      if (session.riderId === riderId) this.riderByTokenDigest.delete(digest);
    }
  }
  createTestSession(riderId: string): GuestSession {
    const token = randomBytes(32).toString('base64url');
    this.issuedRiderIds.add(riderId);
    // Test sessions count as freshly re-authenticated so staff tests can act; the real check is tested with real sessions.
    this.riderByTokenDigest.set(this.digest(token), { riderId, expiresAt: Number.POSITIVE_INFINITY, sessionId: randomUUID(), reauthenticatedAt: Number.POSITIVE_INFINITY });
    return { riderId, token };
  }
  private async issueAccountSession(riderId: string, deviceName?: unknown, event: SecurityEventType = 'login'): Promise<GuestSession> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.digest(token);
    const expiresAt = Date.now() + ACCOUNT_SESSION_TTL_MS;
    const sessionId = randomUUID();
    const device = this.deviceName(deviceName);
    await getPool().query(
      `INSERT INTO account_sessions (id, token_hash, user_id, expires_at, device_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, tokenHash, riderId, new Date(expiresAt), device]
    );
    await this.recordSecurityEvent(riderId, event, sessionId, device);
    await getPool().query(`
      DELETE FROM account_sessions
      WHERE token_hash IN (
        SELECT token_hash FROM account_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC
        OFFSET 10
      )
    `, [riderId]);
    return { riderId, token };
  }
  /**
   * Real, persistent account signup. Credentials live in Postgres (see
   * db.ts). Account sessions are stored as SHA-256 token digests with an
   * expiry so a backend restart never logs out every rider and a database
   * leak does not expose bearer credentials.
   */
  /** Callers must have obtained agreement to TERMS_VERSION first (the signup route refuses without it); it's recorded with the account. */
  async signUp(username: unknown, email: unknown, password: unknown, deviceName?: unknown): Promise<SignUpResult> {
    if (!isValidUsername(username)) return { error: 'invalid_username' };
    if (containsObjectionableText(username)) return { error: 'objectionable_username' };
    if (!isValidEmail(email)) return { error: 'invalid_email' };
    if (!isStrongEnoughPassword(password)) return { error: 'weak_password' };
    await ensureMigrated();
    const passwordHash = await hashPassword(password);
    let riderId: string;
    do { riderId = `rider_${generateRideCode(8).toLowerCase()}`; } while (this.issuedRiderIds.has(riderId));
    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, password_algorithm, terms_version, terms_accepted_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [riderId, username, email, passwordHash, PASSWORD_ALGORITHM, TERMS_VERSION]
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
    const emailVerificationSent = await this.issueVerification(riderId, email);
    const session = await this.issueAccountSession(riderId, deviceName, 'account_created');
    return { ...session, emailVerified: false, termsAccepted: true, emailVerificationSent };
  }

  async logIn(username: unknown, password: unknown, deviceName?: unknown): Promise<LogInResult> {
    if (!isValidUsername(username) || typeof password !== 'string' || password.length < 1 || password.length > MAX_PASSWORD_LENGTH) return { error: 'invalid_credentials' };
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; password_hash: string; password_algorithm: string; email_verified_at: Date | null; suspended_at: string | number | null; suspended_until: string | number | null; terms_version: string | null }>(
      'SELECT id, password_hash, password_algorithm, email_verified_at, suspended_at, suspended_until, terms_version FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const row = rows[0];
    const passwordMatches = await verifyPassword(
      password,
      row?.password_hash ?? DUMMY_PASSWORD_HASH,
      row?.password_algorithm ?? PASSWORD_ALGORITHM
    );
    if (row && !passwordMatches) await this.recordSecurityEvent(row.id, 'login_failed', null, this.deviceName(deviceName));
    if (!row || !passwordMatches) return { error: 'invalid_credentials' };
    // Checked only after the password matches, so suspension status is never
    // revealed to someone who doesn't hold the account's credentials.
    // A timed suspension that has run out no longer blocks sign-in, even
    // before the maintenance job lifts it (moderationStore.liftExpiredSuspensions).
    if (row.suspended_at !== null && (row.suspended_until === null || Number(row.suspended_until) > Date.now())) return { error: 'account_suspended' };
    if (row.password_algorithm !== PASSWORD_ALGORITHM) {
      await pool.query(
        'UPDATE users SET password_hash = $1, password_algorithm = $2 WHERE id = $3',
        [await hashPassword(password), PASSWORD_ALGORITHM, row.id]
      );
    }
    const session = await this.issueAccountSession(row.id, deviceName);
    // Login remains available so riders can restore an account, resend
    // verification, manage sessions, or delete it. The API authorization
    // boundary blocks abuse-sensitive writes until this becomes true.
    return { ...session, emailVerified: row.email_verified_at !== null, termsAccepted: row.terms_version === TERMS_VERSION };
  }

  /**
   * (Re)issues a fresh verification token for `riderId`/`email`, replacing
   * any outstanding one (so an old email link can't be verified after a
   * newer one was requested), and sends it via Resend. Send failures are
   * logged (inside sendVerificationEmailFn) and never thrown — the token
   * is already persisted either way, so the rider can still be verified
   * later (e.g. once Resend is configured) without re-requesting.
   */
  private async issueVerification(riderId: string, email: string): Promise<boolean> {
    const pool = getPool();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.digest(token);
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [riderId]);
    await pool.query(
      'INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, riderId, new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)]
    );
    return this.sendVerificationEmailFn(email, token);
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
    return { sent: await this.issueVerification(riderId, row.email) };
  }

  async requestPasswordReset(email: unknown): Promise<{ accepted: true }> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM password_resets WHERE expires_at <= now()');
    if (!isValidEmail(email)) return { accepted: true };
    const { rows } = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE lower(email) = lower($1)',
      [email]
    );
    const user = rows[0];
    if (!user) return { accepted: true };
    const token = randomBytes(32).toString('base64url');
    await withTransaction(async (client) => {
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await client.query(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [this.digest(token), user.id, new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)]
      );
    });
    await this.sendPasswordResetEmailFn(user.email, token);
    return { accepted: true };
  }

  async resetPassword(token: unknown, password: unknown): Promise<ResetPasswordResult> {
    if (!isStrongEnoughPassword(password)) return { error: 'weak_password' };
    if (typeof token !== 'string' || !token) return { error: 'invalid_token' };
    await ensureMigrated();
    const passwordHash = await hashPassword(password);
    return withTransaction(async (client) => {
      const { rows } = await client.query<{ user_id: string; expires_at: Date }>(
        'SELECT user_id, expires_at FROM password_resets WHERE token_hash = $1 FOR UPDATE',
        [this.digest(token)]
      );
      const row = rows[0];
      if (!row) {
        return { error: 'invalid_token' };
      }
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [row.user_id]);
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return { error: 'expired_token' };
      }
      await client.query(
        'UPDATE users SET password_hash = $1, password_algorithm = $2 WHERE id = $3',
        [passwordHash, PASSWORD_ALGORITHM, row.user_id]
      );
      await client.query('DELETE FROM account_sessions WHERE user_id = $1', [row.user_id]);
      // Every device signs in again, and re-registers for notifications then.
      await client.query('DELETE FROM push_subscriptions WHERE rider_id = $1', [row.user_id]);
      await client.query(
        `INSERT INTO security_events (rider_id, event, created_at) VALUES ($1, 'password_reset', $2)`,
        [row.user_id, Date.now()],
      );
      return { reset: true };
    });
  }

  async getIdentity(riderId: string): Promise<AccountIdentity | undefined> {
    if (!process.env.DATABASE_URL) return undefined;
    await ensureMigrated();
    const { rows } = await getPool().query<{ username: string; email_verified_at: Date | null; terms_version: string | null }>(
      'SELECT username, email_verified_at, terms_version FROM users WHERE id = $1',
      [riderId]
    );
    const row = rows[0];
    return row ? { riderId, username: row.username, emailVerified: row.email_verified_at !== null, termsAccepted: row.terms_version === TERMS_VERSION } : undefined;
  }

  /** Records agreement to the current Terms; refuses a stale version so a client can't agree to text it didn't show. */
  async acceptTerms(riderId: string, version: unknown): Promise<{ accepted: true } | { error: 'stale_terms_version' }> {
    if (version !== TERMS_VERSION) return { error: 'stale_terms_version' };
    await ensureMigrated();
    await getPool().query('UPDATE users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1', [riderId, TERMS_VERSION]);
    return { accepted: true };
  }

  /**
   * Who receives error alert emails: ALERT_EMAIL (comma-separated) when set,
   * otherwise every admin account with a verified email address.
   */
  async listAlertRecipients(): Promise<string[]> {
    const configured = (process.env.ALERT_EMAIL ?? '').split(',').map((email) => email.trim()).filter(Boolean);
    if (configured.length > 0) return configured;
    if (!process.env.DATABASE_URL) return [];
    await ensureMigrated();
    const { rows } = await getPool().query<{ email: string }>(
      'SELECT email FROM users WHERE is_admin AND email_verified_at IS NOT NULL AND email IS NOT NULL ORDER BY email'
    );
    return rows.map((row) => row.email);
  }

  /** The rider's staff role, re-read from Postgres each time; null for riders who aren't staff. */
  async staffRole(riderId: string): Promise<StaffRole | null> {
    if (!process.env.DATABASE_URL) return null;
    await ensureMigrated();
    const { rows } = await getPool().query<{ is_admin: boolean; role: StaffRole | null }>(
      'SELECT u.is_admin, s.role FROM users u LEFT JOIN staff_roles s ON s.rider_id = u.id WHERE u.id = $1',
      [riderId]
    );
    const row = rows[0];
    if (!row) return null;
    return row.is_admin ? 'admin' : row.role ?? null;
  }

  async can(riderId: string, permission: StaffPermission): Promise<boolean> {
    return roleCan(await this.staffRole(riderId), permission);
  }

  /** Staff send a rider the usual password reset email; false when the rider has no email. */
  async sendPasswordResetFor(riderId: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [riderId]);
    const email = rows[0]?.email;
    if (!email) return false;
    await this.requestPasswordReset(email);
    return true;
  }

  /** A failed password challenge must also invalidate any earlier successful
   * proof for this specific bearer session; otherwise an expired/mistyped
   * retry would leave the previous sensitive-action privilege in place. */
  private async clearRecentReauthentication(riderId: string, token: string): Promise<void> {
    if (!riderId || !token) return;
    const tokenHash = this.digest(token);
    const cached = this.riderByTokenDigest.get(tokenHash);
    if (cached?.riderId === riderId) delete cached.reauthenticatedAt;
    if (!process.env.DATABASE_URL) return;
    await ensureMigrated();
    await getPool().query(
      `UPDATE account_sessions SET reauthenticated_at = NULL
       WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()
         AND reauthenticated_at IS NOT NULL`,
      [tokenHash, riderId],
    );
  }

  /**
   * Re-checks the rider's password on this session, so staff can make
   * sensitive changes for the next STAFF_REAUTH_WINDOW_MS.
   */
  async reauthenticate(riderId: string, token: string, password: unknown): Promise<boolean> {
    if (typeof password !== 'string' || password.length < 1 || password.length > MAX_PASSWORD_LENGTH) {
      await this.clearRecentReauthentication(riderId, token);
      return false;
    }
    await ensureMigrated();
    const { rows } = await getPool().query<{ password_hash: string; password_algorithm: string }>(
      'SELECT password_hash, password_algorithm FROM users WHERE id = $1',
      [riderId],
    );
    const row = rows[0];
    const sessionId = await this.sessionIdForToken(token) ?? null;
    const matches = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH, row?.password_algorithm ?? PASSWORD_ALGORITHM);
    if (!row || !matches) {
      await this.clearRecentReauthentication(riderId, token);
      if (row) await this.recordSecurityEvent(riderId, 'reauth_failed', sessionId, null);
      return false;
    }
    const tokenHash = this.digest(token);
    // Password verification and bearer authorization are separate checks.
    // A session may be revoked or expire while the password hash is being
    // verified: never claim step-up succeeded if no live session was updated.
    const updated = await getPool().query<{ id: string }>(
      `UPDATE account_sessions SET reauthenticated_at = now()
       WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()
       RETURNING id`,
      [tokenHash, riderId],
    );
    if (updated.rowCount !== 1) return false;
    const cached = this.riderByTokenDigest.get(tokenHash);
    if (cached) cached.reauthenticatedAt = Date.now();
    await this.recordSecurityEvent(riderId, 'reauthenticated', updated.rows[0]!.id, null);
    return true;
  }

  /** Whether this session re-entered its password within the window. */
  async recentlyReauthenticated(token: string, windowMs: number): Promise<boolean> {
    if (!token) return false;
    const tokenHash = this.digest(token);
    const cached = this.riderByTokenDigest.get(tokenHash);
    if (cached?.reauthenticatedAt !== undefined && cached.reauthenticatedAt >= Date.now() - windowMs) return true;
    if (!process.env.DATABASE_URL) return false;
    await ensureMigrated();
    const { rowCount } = await getPool().query(
      `SELECT 1 FROM account_sessions WHERE token_hash = $1 AND expires_at > now()
       AND reauthenticated_at > now() - ($2::bigint * interval '1 millisecond')`,
      [tokenHash, windowMs],
    );
    return Boolean(rowCount);
  }

  /** Account security history, newest first: one rider's, staff's, or everyone's. */
  async listSecurityEvents({ riderId, staffOnly = false, limit = 100 }: { riderId?: string; staffOnly?: boolean; limit?: number } = {}): Promise<SecurityEvent[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ id: string; rider_id: string; event: SecurityEventType; session_id: string | null; device: string | null; created_at: string }>(
      `SELECT e.id, e.rider_id, e.event, e.session_id, e.device, e.created_at
       FROM security_events e
       WHERE ($1::text IS NULL OR e.rider_id = $1)
         AND (NOT $2 OR EXISTS (
           SELECT 1 FROM users u LEFT JOIN staff_roles s ON s.rider_id = u.id
           WHERE u.id = e.rider_id AND (u.is_admin OR s.role IS NOT NULL)))
       ORDER BY e.created_at DESC, e.id
       LIMIT $3`,
      [riderId ?? null, staffOnly, Math.min(Math.max(Math.trunc(limit), 1), 200)],
    );
    return rows.map((row) => ({
      id: row.id, riderId: row.rider_id, event: row.event, sessionId: row.session_id, device: row.device, createdAt: Number(row.created_at),
    }));
  }

  /** Never fails the action it describes: a lost history line is logged instead. */
  private async recordSecurityEvent(riderId: string, event: SecurityEventType, sessionId: string | null, device: string | null): Promise<void> {
    try {
      await getPool().query(
        'INSERT INTO security_events (rider_id, event, session_id, device, created_at) VALUES ($1, $2, $3, $4, $5)',
        [riderId, event, sessionId, device, Date.now()],
      );
    } catch (error) {
      log('error', 'security_event_not_recorded', { riderId, securityEvent: event, ...errorFields(error) });
    }
  }

  async isAdmin(riderId: string): Promise<boolean> {
    if (!process.env.DATABASE_URL) return false;
    await ensureMigrated();
    const { rows } = await getPool().query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE id = $1',
      [riderId]
    );
    return rows[0]?.is_admin === true;
  }

  async listSessions(riderId: string, currentToken: string): Promise<AccountSessionSummary[]> {
    await ensureMigrated();
    const currentHash = this.digest(currentToken);
    await getPool().query('DELETE FROM account_sessions WHERE expires_at <= now()');
    const { rows } = await getPool().query<{
      id: string; token_hash: string; device_name: string; created_at: Date; last_seen_at: Date; expires_at: Date;
    }>(
      `SELECT id, token_hash, device_name, created_at, last_seen_at, expires_at
       FROM account_sessions
       WHERE user_id = $1 AND expires_at > now()
       ORDER BY created_at DESC`,
      [riderId]
    );
    return rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      createdAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      current: row.token_hash === currentHash,
    }));
  }

  async revokeSession(riderId: string, sessionId: string): Promise<boolean> {
    await ensureMigrated();
    const result = await getPool().query<{ token_hash: string }>(
      'DELETE FROM account_sessions WHERE id = $1 AND user_id = $2 RETURNING token_hash',
      [sessionId, riderId],
    );
    const revoked = result.rows[0];
    if (!revoked) return false;
    // The revoked device stops getting notifications too.
    await getPool().query('DELETE FROM push_subscriptions WHERE session_token_hash = $1', [revoked.token_hash]);
    await this.recordSecurityEvent(riderId, 'session_revoked', sessionId, null);
    return true;
  }

  /** Removes abandoned authentication artefacts without waiting for their
   * exact bearer/reset/verification token to be presented again. Safe to run
   * repeatedly from every replica because each delete is idempotent. */
  async cleanupExpiredRecords(now = new Date()): Promise<{ sessions: number; verifications: number; passwordResets: number; securityEvents: number }> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const sessions = await client.query('DELETE FROM account_sessions WHERE expires_at <= $1', [now]);
      const verifications = await client.query('DELETE FROM email_verifications WHERE expires_at <= $1', [now]);
      const passwordResets = await client.query('DELETE FROM password_resets WHERE expires_at <= $1', [now]);
      const securityEvents = await client.query('DELETE FROM security_events WHERE created_at < $1', [now.getTime() - SECURITY_EVENT_RETENTION_MS]);
      await client.query(
        `DELETE FROM push_subscriptions p WHERE p.session_token_hash IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM account_sessions s WHERE s.token_hash = p.session_token_hash)`,
      );
      return {
        sessions: sessions.rowCount ?? 0,
        verifications: verifications.rowCount ?? 0,
        passwordResets: passwordResets.rowCount ?? 0,
        securityEvents: securityEvents.rowCount ?? 0,
      };
    });
  }
}

/** How a bearer token is stored: account_sessions.token_hash and push_subscriptions.session_token_hash. */
export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** The violated unique index's name (e.g. `users_email_lower_idx`), so callers can tell *which* field collided. */
function uniqueViolationConstraint(error: unknown): string | undefined {
  if (!isUniqueViolation(error)) return undefined;
  return (error as { constraint?: string }).constraint;
}
