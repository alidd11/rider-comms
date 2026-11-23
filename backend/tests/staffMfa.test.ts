import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import {
  base32Decode, base32Encode, matchTotp, openSecret, otpauthUri, sealSecret, totpAt, TOTP_STEP_SECONDS,
} from '../src/staffMfa.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const nowStep = () => Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

describe('TOTP and secret helpers', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    // RFC 6238 appendix B: ASCII "12345678901234567890", 8-digit codes; the
    // last six digits are what a 6-digit authenticator shows.
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
    assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
    assert.equal(totpAt(secret, Math.floor(1234567890 / 30)), '005924');
    assert.deepEqual(base32Decode('gezd-gnbv gy3tqojq'), Buffer.from('1234567890'));
    assert.throws(() => base32Decode('not base32!'), /invalid_base32/);
  });

  it('accepts one step of drift and rejects malformed codes', () => {
    const secret = base32Encode(Buffer.from('abcdefghijabcdefghij'));
    const at = 1_800_000_000_000;
    const step = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
    assert.equal(matchTotp(secret, totpAt(secret, step), at), step);
    assert.equal(matchTotp(secret, totpAt(secret, step - 1), at), step - 1);
    assert.equal(matchTotp(secret, totpAt(secret, step + 1), at), step + 1);
    assert.equal(matchTotp(secret, totpAt(secret, step - 3), at), null);
    assert.equal(matchTotp(secret, '12345', at), null);
    assert.equal(matchTotp(secret, 'abcdef', at), null);
    assert.match(otpauthUri(secret, 'rider_1'), /^otpauth:\/\/totp\/Rider%20Comms%20Staff%3Arider_1\?secret=.+&digits=6&period=30$/);
  });

  it('encrypts the secret when a key is configured, and refuses it without the key', () => {
    const previous = process.env.STAFF_MFA_ENCRYPTION_KEY;
    try {
      delete process.env.STAFF_MFA_ENCRYPTION_KEY;
      assert.equal(sealSecret('ABC'), 'plain:ABC');
      assert.equal(openSecret('plain:ABC'), 'ABC');
      process.env.STAFF_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      const sealed = sealSecret('ABCDEF');
      assert.match(sealed, /^v1:/);
      assert.ok(!sealed.includes('ABCDEF'));
      assert.equal(openSecret(sealed), 'ABCDEF');
      process.env.STAFF_MFA_ENCRYPTION_KEY = 'too-short';
      assert.equal(sealSecret('X'), 'plain:X');
      assert.throws(() => openSecret(sealed), /mfa_secret_unreadable/);
    } finally {
      if (previous === undefined) delete process.env.STAFF_MFA_ENCRYPTION_KEY;
      else process.env.STAFF_MFA_ENCRYPTION_KEY = previous;
    }
  });
});

describe('staff two-step sign-in', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const created: string[] = [];
  const password = 'Correct-horse-battery-2026';
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  after(async () => {
    await ctx.close();
    if (created.length) await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [created]);
    await resetDbForTests();
  });

  const makeStaff = async (role: 'admin' | 'moderator') => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const username = 'mfa_' + role.slice(0, 3) + '_' + suffix;
    const signed = await ctx.authStore.signUp(username, username + '@example.com', password);
    assert.ok('riderId' in signed);
    created.push(signed.riderId);
    if (role === 'admin') await getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [signed.riderId]);
    else await getPool().query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $1, 0)`, [signed.riderId]);
    return { riderId: signed.riderId, username };
  };
  const login = (username: string, code?: string) => fetch(ctx.baseUrl() + '/auth/staff-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, deviceName: 'Staff test', ...(code === undefined ? {} : { code }) }),
  });
  const call = (token: string, path: string, body?: unknown) => fetch(ctx.baseUrl() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const enrol = async (username: string) => {
    const { token } = await (await login(username)).json() as { token: string };
    assert.equal((await call(token, '/admin/mfa/setup', {})).status, 403); // needs a recent password check
    assert.equal((await call(token, '/auth/reauthenticate', { password })).status, 200);
    const setup = await (await call(token, '/admin/mfa/setup', {})).json() as { secret: string; uri: string };
    assert.match(setup.uri, /^otpauth:\/\/totp\//);
    assert.equal((await call(token, '/admin/mfa/confirm', { code: '000000' })).status, 401);
    const confirmed = await call(token, '/admin/mfa/confirm', { code: totpAt(setup.secret, nowStep()) });
    assert.equal(confirmed.status, 200);
    const { recoveryCodes } = await confirmed.json() as { recoveryCodes: string[] };
    assert.equal(recoveryCodes.length, 10);
    assert.equal((await call(token, '/admin/mfa/setup', {})).status, 409);
    return { token, secret: setup.secret, recoveryCodes };
  };

  it('enrols, then requires a code at sign-in and on other sessions, refusing replays', async () => {
    const admin = await makeStaff('admin');
    const { token: enrolledSession, secret, recoveryCodes } = await enrol(admin.username);
    // The session that set it up has passed a code already.
    assert.equal((await call(enrolledSession, '/admin/me')).status, 200);
    assert.deepEqual(await (await call(enrolledSession, '/admin/mfa')).json(), { enabled: true, recoveryCodesLeft: 10 });

    // Password alone no longer signs in, and the half-made session is revoked.
    const noCode = await login(admin.username);
    assert.equal(noCode.status, 401);
    assert.deepEqual(await noCode.json(), { error: 'mfa_required' });
    assert.equal((await login(admin.username, '123456')).status, 401);
    // The code used while enrolling cannot be replayed.
    assert.equal((await login(admin.username, totpAt(secret, nowStep()))).status, 401);
    const next = await login(admin.username, totpAt(secret, nowStep() + 1));
    assert.equal(next.status, 200);
    const fresh = (await next.json() as { token: string }).token;
    assert.equal((await call(fresh, '/admin/me')).status, 200);

    // A rider-app session of the same account must pass a code before any staff request.
    const app = await ctx.authStore.logIn(admin.username, password);
    assert.ok('token' in app);
    const blocked = await call(app.token, '/admin/overview');
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: 'mfa_required' });
    assert.equal((await call(app.token, '/moderation/reports')).status, 403);
    assert.equal((await call(app.token, '/moderation/social-posts')).status, 403);
    assert.equal((await call(app.token, '/admin/mfa/verify', { code: 'nope' })).status, 401);
    // A recovery code works once.
    assert.equal((await call(app.token, '/admin/mfa/verify', { code: recoveryCodes[0]!.toUpperCase() })).status, 200);
    assert.equal((await call(app.token, '/admin/overview')).status, 200);
    const other = await ctx.authStore.logIn(admin.username, password);
    assert.ok('token' in other);
    assert.equal((await call(other.token, '/admin/mfa/verify', { code: recoveryCodes[0] })).status, 401);
    assert.deepEqual(await (await call(fresh, '/admin/mfa')).json(), { enabled: true, recoveryCodesLeft: 9 });

    const events = await getPool().query<{ event: string }>('SELECT event FROM security_events WHERE rider_id = $1', [admin.riderId]);
    const kinds = new Set(events.rows.map((row) => row.event));
    for (const kind of ['mfa_enabled', 'mfa_verified', 'mfa_failed']) assert.ok(kinds.has(kind), kind);

    // Turning it off needs a password check and a valid code.
    assert.equal((await call(fresh, '/auth/reauthenticate', { password })).status, 200);
    assert.equal((await call(fresh, '/admin/mfa/disable', { code: '000000' })).status, 401);
    assert.equal((await call(fresh, '/admin/mfa/disable', { code: recoveryCodes[1] })).status, 200);
    assert.equal((await login(admin.username)).status, 200);
    assert.equal((await call(fresh, '/admin/mfa/confirm', { code: '123456' })).status, 409);
  });

  it('lets an admin reset a colleague with a note, recorded in the audit log', async () => {
    const admin = await makeStaff('admin');
    const moderator = await makeStaff('moderator');
    await enrol(moderator.username);
    const adminSession = (await (await login(admin.username)).json() as { token: string }).token;
    assert.equal((await call(adminSession, '/auth/reauthenticate', { password })).status, 200);
    const staff = await (await call(adminSession, '/admin/staff')).json() as { staff: { riderId: string; twoStep: boolean }[] };
    assert.equal(staff.staff.find((member) => member.riderId === moderator.riderId)?.twoStep, true);
    const url = `/admin/staff/${moderator.riderId}/mfa-reset`;
    assert.equal((await call(adminSession, url, {})).status, 400);
    assert.equal((await call(adminSession, `/admin/staff/${admin.riderId}/mfa-reset`, { note: 'Self' })).status, 409);
    const reset = await call(adminSession, url, { note: 'Lost phone and recovery codes' });
    assert.equal(reset.status, 200);
    assert.equal((await call(adminSession, url, { note: 'Again' })).status, 404);
    const action = await getPool().query<{ action: string; note: string }>(
      "SELECT action, note FROM moderation_actions WHERE target_rider_id = $1 AND action = 'staff_mfa_reset'", [moderator.riderId]);
    assert.equal(action.rows[0]?.note, 'Lost phone and recovery codes');
    assert.equal((await login(moderator.username)).status, 200);
    assert.equal((await call(adminSession, '/admin/mfa/other', {})).status, 404);
  });
});
