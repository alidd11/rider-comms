import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { generateRideCode } from '@rider-comms/shared';
import { getPool, ensureMigrated } from './db.ts';

const scryptAsync = promisify(scrypt);

export interface GuestSession { riderId: string; token: string; }

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const SCRYPT_KEYLEN = 64;

export type SignUpResult = GuestSession | { error: 'username_taken' | 'invalid_username' | 'weak_password' };
export type LogInResult = GuestSession | { error: 'invalid_credentials' };

function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && USERNAME_PATTERN.test(username);
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
  async signUp(username: unknown, password: unknown): Promise<SignUpResult> {
    if (!isValidUsername(username)) return { error: 'invalid_username' };
    if (!isStrongEnoughPassword(password)) return { error: 'weak_password' };
    await ensureMigrated();
    const passwordHash = await hashPassword(password);
    let riderId: string;
    do { riderId = `rider_${generateRideCode(8).toLowerCase()}`; } while (this.issuedRiderIds.has(riderId));
    const pool = getPool();
    try {
      await pool.query('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [riderId, username, passwordHash]);
    } catch (error) {
      if (isUniqueViolation(error)) return { error: 'username_taken' };
      throw error;
    }
    return this.issueSession(riderId);
  }
  async logIn(username: unknown, password: unknown): Promise<LogInResult> {
    if (typeof username !== 'string' || typeof password !== 'string') return { error: 'invalid_credentials' };
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) return { error: 'invalid_credentials' };
    return this.issueSession(row.id);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
