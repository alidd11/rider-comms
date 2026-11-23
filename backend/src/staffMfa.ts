import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ensureMigrated, getPool, withTransaction } from './db.ts';
import { sessionTokenHash } from './authStore.ts';

/**
 * Two-step sign-in for staff with an authenticator app (RFC 6238 TOTP:
 * SHA-1, 6 digits, 30-second steps; what Google Authenticator, 1Password and
 * Authy expect). Once a staff member turns it on, every staff request from a
 * session that has not passed a code is refused with `mfa_required`.
 *
 * The shared secret is encrypted with AES-256-GCM when STAFF_MFA_ENCRYPTION_KEY
 * (32 bytes, base64) is set; without it, it is stored as is in the database,
 * which is still only reachable by the backend. Recovery codes are stored
 * only as SHA-256 hashes and each works once.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODE_COUNT = 10;
const ISSUER = 'Rider Comms Staff';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('invalid_base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code an authenticator app shows for `step` (seconds / 30). */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const binary = ((hmac[offset]! & 127) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The matching step, allowing one step of clock drift either way, or null. */
export function matchTotp(secret: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (const step of [current, current - 1, current + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

const hashRecovery = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

function encryptionKey(): Buffer | null {
  const raw = process.env.STAFF_MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function sealSecret(secret: string): string {
  const key = encryptionKey();
  if (!key) return 'plain:' + secret;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function openSecret(sealed: string): string {
  if (sealed.startsWith('plain:')) return sealed.slice(6);
  const [version, iv, tag, body] = sealed.split(':');
  const key = encryptionKey();
  if (version !== 'v1' || !iv || !tag || !body || !key) throw new Error('mfa_secret_unreadable');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

type MfaRow = { rider_id: string; secret: string; enabled_at: string | null; last_step: string | null; recovery_hashes: string[] };
export type MfaEvent = 'mfa_enabled' | 'mfa_disabled' | 'mfa_verified' | 'mfa_failed' | 'mfa_reset';

export class StaffMfaStore {
  /** Sessions that passed a code. Durable in account_sessions; this map also
   * covers in-memory test sessions and saves a query on every request. */
  private verified = new Set<string>();

  private async record(riderId: string, event: MfaEvent): Promise<void> {
    await getPool().query(
      'INSERT INTO security_events (rider_id, event, session_id, device, created_at) VALUES ($1, $2, NULL, NULL, $3)',
      [riderId, event, Date.now()],
    );
  }

  async status(riderId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
    await ensureMigrated();
    const { rows } = await getPool().query<MfaRow>('SELECT * FROM staff_mfa WHERE rider_id = $1', [riderId]);
    const row = rows[0];
    return { enabled: Boolean(row?.enabled_at), recoveryCodesLeft: row?.enabled_at ? row.recovery_hashes.length : 0 };
  }

  /** Riders with two-step sign-in on, for the Staff page. */
  async enabledFor(riderIds: string[]): Promise<Set<string>> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ rider_id: string }>(
      'SELECT rider_id FROM staff_mfa WHERE rider_id = ANY($1::text[]) AND enabled_at IS NOT NULL', [riderIds]);
    return new Set(rows.map((row) => row.rider_id));
  }

  /** A new secret, not yet active. Re-running replaces an unconfirmed one. */
  async beginSetup(riderId: string, account: string): Promise<{ secret: string; uri: string } | { error: 'already_enabled' }> {
    await ensureMigrated();
    const secret = base32Encode(randomBytes(20));
    const { rowCount } = await getPool().query(
      `INSERT INTO staff_mfa (rider_id, secret, enabled_at, last_step, recovery_hashes, created_at)
       VALUES ($1, $2, NULL, NULL, '{}', $3)
       ON CONFLICT (rider_id) DO UPDATE SET secret = EXCLUDED.secret, created_at = EXCLUDED.created_at
       WHERE staff_mfa.enabled_at IS NULL`,
      [riderId, sealSecret(secret), Date.now()],
    );
    if (!rowCount) return { error: 'already_enabled' };
    return { secret, uri: otpauthUri(secret, account) };
  }

  /** Turns it on after the first correct code; returns the recovery codes once. */
  async confirmSetup(riderId: string, token: string, code: string): Promise<{ recoveryCodes: string[] } | { error: 'not_started' | 'already_enabled' | 'invalid_code' }> {
    await ensureMigrated();
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<MfaRow>('SELECT * FROM staff_mfa WHERE rider_id = $1 FOR UPDATE', [riderId]);
      const row = rows[0];
      if (!row) return { error: 'not_started' as const };
      if (row.enabled_at) return { error: 'already_enabled' as const };
      const step = matchTotp(openSecret(row.secret), code);
      if (step === null) return { error: 'invalid_code' as const };
      const recoveryCodes = newRecoveryCodes();
      await client.query(
        'UPDATE staff_mfa SET enabled_at = $2, last_step = $3, recovery_hashes = $4 WHERE rider_id = $1',
        [riderId, Date.now(), step, recoveryCodes.map(hashRecovery)],
      );
      return { recoveryCodes };
    });
    if ('recoveryCodes' in result) {
      await this.markSessionVerified(token);
      await this.record(riderId, 'mfa_enabled');
    } else if (result.error === 'invalid_code') {
      await this.record(riderId, 'mfa_failed');
    }
    return result;
  }

  /** Checks an authenticator or recovery code. Each TOTP step and each
   * recovery code is accepted once, so an overheard code can't be replayed. */
  async verify(riderId: string, code: unknown): Promise<boolean> {
    if (typeof code !== 'string' || code.length > 20) return false;
    await ensureMigrated();
    const ok = await withTransaction(async (client) => {
      const { rows } = await client.query<MfaRow>('SELECT * FROM staff_mfa WHERE rider_id = $1 AND enabled_at IS NOT NULL FOR UPDATE', [riderId]);
      const row = rows[0];
      if (!row) return false;
      const trimmed = code.trim();
      const step = matchTotp(openSecret(row.secret), trimmed);
      if (step !== null) {
        if (row.last_step !== null && step <= Number(row.last_step)) return false;
        await client.query('UPDATE staff_mfa SET last_step = $2 WHERE rider_id = $1', [riderId, step]);
        return true;
      }
      const hash = hashRecovery(trimmed);
      if (!row.recovery_hashes.includes(hash)) return false;
      await client.query('UPDATE staff_mfa SET recovery_hashes = array_remove(recovery_hashes, $2) WHERE rider_id = $1', [riderId, hash]);
      return true;
    });
    await this.record(riderId, ok ? 'mfa_verified' : 'mfa_failed');
    return ok;
  }

  async disable(riderId: string, event: 'mfa_disabled' | 'mfa_reset' = 'mfa_disabled'): Promise<boolean> {
    await ensureMigrated();
    const { rowCount } = await getPool().query('DELETE FROM staff_mfa WHERE rider_id = $1', [riderId]);
    if (rowCount) await this.record(riderId, event);
    return Boolean(rowCount);
  }

  async markSessionVerified(token: string): Promise<void> {
    if (!token) return;
    const hash = sessionTokenHash(token);
    this.verified.add(hash);
    await getPool().query('UPDATE account_sessions SET mfa_verified_at = now() WHERE token_hash = $1', [hash]);
  }

  /** True when this rider has two-step sign-in on and this session has not passed it. */
  async sessionNeedsCode(riderId: string, token: string): Promise<boolean> {
    if (!process.env.DATABASE_URL) return false;
    const hash = token ? sessionTokenHash(token) : '';
    if (hash && this.verified.has(hash)) return false;
    await ensureMigrated();
    const { rows } = await getPool().query<{ enabled: boolean; session_ok: boolean }>(
      `SELECT (m.enabled_at IS NOT NULL) AS enabled,
        EXISTS (SELECT 1 FROM account_sessions s WHERE s.token_hash = $2 AND s.user_id = $1
          AND s.expires_at > now() AND s.mfa_verified_at IS NOT NULL) AS session_ok
       FROM staff_mfa m WHERE m.rider_id = $1`,
      [riderId, hash],
    );
    const row = rows[0];
    if (!row?.enabled) return false;
    if (row.session_ok) {
      this.verified.add(hash);
      return false;
    }
    return true;
  }
}

export const staffMfa = new StaffMfaStore();
