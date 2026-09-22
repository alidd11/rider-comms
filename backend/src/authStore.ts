import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { generateRideCode } from '@rider-comms/shared';
import { getPool, ensureMigrated } from './db.ts';
import { sendPasswordResetEmail, sendVerificationEmail } from './email.ts';


export interface GuestSession { riderId: string; token: string; }
export interface LoginSession extends GuestSession { emailVerified: boolean; }
export interface SignUpSession extends LoginSession { emailVerificationSent: boolean; }
export interface AccountIdentity { riderId: string; username: string; emailVerified: boolean; }
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
const MAX_PASSWORD_LENGTH = 128;
// A valid, fixed scrypt record used only to equalise the cost of an unknown
// username and a wrong password. Without it, login timing exposes whether a
// username exists before credentials have been authenticated.
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(SCRYPT_KEYLEN)}`;

export type SignUpResult = SignUpSession | { error: 'username_taken' | 'email_taken' | 'invalid_username' | 'invalid_email' | 'weak_password' };
export type LogInResult = LoginSession | { error: 'invalid_credentials' };
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

async function verifyPassword(password: string, stored: string, algorithm: string): Promise<boolean> {
  try {
    const options = scryptOptionsForAlgorithm(algorithm);
    if (!options) return false;
    const [saltHex, keyHex, extra] = stored.split(':');
    if (extra !== undefined || !saltHex || !keyHex || saltHex.length !== 32 || keyHex.length !== SCRYPT_KEYLEN * 2) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expectedKey = Buffer.from(keyHex, 'hex');
    const derivedKey = await derivePassword(password, salt, expectedKey.length, options);
    return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

export class AuthStore {
  private riderByTokenDigest = new Map<string, { riderId: string; expiresAt: number }>();
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

  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private deviceName(value: unknown): string {
    if (typeof value !== 'string') return 'Unknown device';
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
    await getPool().query('DELETE FROM account_sessions WHERE token_hash = $1', [tokenHash]);
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
    this.riderByTokenDigest.set(this.digest(token), { riderId, expiresAt: Number.POSITIVE_INFINITY });
    return { riderId, token };
  }
  private async issueAccountSession(riderId: string, deviceName?: unknown): Promise<GuestSession> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.digest(token);
    const expiresAt = Date.now() + ACCOUNT_SESSION_TTL_MS;
    await getPool().query(
      `INSERT INTO account_sessions (id, token_hash, user_id, expires_at, device_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), tokenHash, riderId, new Date(expiresAt), this.deviceName(deviceName)]
    );
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
  async signUp(username: unknown, email: unknown, password: unknown, deviceName?: unknown): Promise<SignUpResult> {
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
        'INSERT INTO users (id, username, email, password_hash, password_algorithm) VALUES ($1, $2, $3, $4, $5)',
        [riderId, username, email, passwordHash, PASSWORD_ALGORITHM]
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
    const session = await this.issueAccountSession(riderId, deviceName);
    return { ...session, emailVerified: false, emailVerificationSent };
  }

  async logIn(username: unknown, password: unknown, deviceName?: unknown): Promise<LogInResult> {
    if (!isValidUsername(username) || typeof password !== 'string' || password.length < 1 || password.length > MAX_PASSWORD_LENGTH) return { error: 'invalid_credentials' };
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; password_hash: string; password_algorithm: string; email_verified_at: Date | null }>(
      'SELECT id, password_hash, password_algorithm, email_verified_at FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const row = rows[0];
    const passwordMatches = await verifyPassword(
      password,
      row?.password_hash ?? DUMMY_PASSWORD_HASH,
      row?.password_algorithm ?? PASSWORD_ALGORITHM
    );
    if (!row || !passwordMatches) return { error: 'invalid_credentials' };
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await client.query(
        'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [this.digest(token), user.id, new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.sendPasswordResetEmailFn(user.email, token);
    return { accepted: true };
  }

  async resetPassword(token: unknown, password: unknown): Promise<ResetPasswordResult> {
    if (!isStrongEnoughPassword(password)) return { error: 'weak_password' };
    if (typeof token !== 'string' || !token) return { error: 'invalid_token' };
    await ensureMigrated();
    const passwordHash = await hashPassword(password);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ user_id: string; expires_at: Date }>(
        'SELECT user_id, expires_at FROM password_resets WHERE token_hash = $1 FOR UPDATE',
        [this.digest(token)]
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { error: 'invalid_token' };
      }
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [row.user_id]);
      if (new Date(row.expires_at).getTime() < Date.now()) {
        await client.query('COMMIT');
        return { error: 'expired_token' };
      }
      await client.query(
        'UPDATE users SET password_hash = $1, password_algorithm = $2 WHERE id = $3',
        [passwordHash, PASSWORD_ALGORITHM, row.user_id]
      );
      await client.query('DELETE FROM account_sessions WHERE user_id = $1', [row.user_id]);
      await client.query('COMMIT');
      return { reset: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getIdentity(riderId: string): Promise<AccountIdentity | undefined> {
    if (!process.env.DATABASE_URL) return undefined;
    await ensureMigrated();
    const { rows } = await getPool().query<{ username: string; email_verified_at: Date | null }>(
      'SELECT username, email_verified_at FROM users WHERE id = $1',
      [riderId]
    );
    return rows[0] ? { riderId, username: rows[0].username, emailVerified: rows[0].email_verified_at !== null } : undefined;
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
    const result = await getPool().query('DELETE FROM account_sessions WHERE id = $1 AND user_id = $2', [sessionId, riderId]);
    return result.rowCount === 1;
  }

  /** Removes abandoned authentication artefacts without waiting for their
   * exact bearer/reset/verification token to be presented again. Safe to run
   * repeatedly from every replica because each delete is idempotent. */
  async cleanupExpiredRecords(now = new Date()): Promise<{ sessions: number; verifications: number; passwordResets: number }> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const sessions = await client.query('DELETE FROM account_sessions WHERE expires_at <= $1', [now]);
      const verifications = await client.query('DELETE FROM email_verifications WHERE expires_at <= $1', [now]);
      const passwordResets = await client.query('DELETE FROM password_resets WHERE expires_at <= $1', [now]);
      await client.query('COMMIT');
      return {
        sessions: sessions.rowCount ?? 0,
        verifications: verifications.rowCount ?? 0,
        passwordResets: passwordResets.rowCount ?? 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
