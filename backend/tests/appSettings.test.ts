import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import {
  APP_SETTINGS_CACHE_MS, HAZARD_TYPES, appSettings, compareVersions, defaultAppSettings, isAppSettingKey, parseAppSetting,
} from '../src/appSettings.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_setadmin';
const MOD = 'rider_setmod';
const RIDER = 'rider_setrider';
const SEEDED = [ADMIN, MOD, RIDER];
const allMinutes = (minutes: number) => Object.fromEntries(HAZARD_TYPES.map((type) => [type, minutes]));

describe('app setting values', () => {
  it('defaults to the built-in hazard lifetimes and no version floor', () => {
    const defaults = defaultAppSettings();
    assert.deepEqual([defaults.hazardMinutes.police, defaults.hazardMinutes.accident, defaults.hazardMinutes.road_closure], [60, 120, 480]);
    assert.deepEqual(defaults.minAppVersion, { ios: null, android: null });
    assert.deepEqual(defaults.updateUrl, { ios: null, android: null });
  });
  it('knows its keys', () => {
    assert.ok(isAppSettingKey('hazardMinutes') && isAppSettingKey('minAppVersion') && isAppSettingKey('updateUrl'));
    assert.equal(isAppSettingKey('everything'), false);
  });
  it('takes whole minutes from 15 to 24 hours for every hazard type', () => {
    assert.deepEqual(parseAppSetting('hazardMinutes', allMinutes(90)), allMinutes(90));
    assert.ok('error' in parseAppSetting('hazardMinutes', 'x'));
    assert.ok('error' in parseAppSetting('hazardMinutes', { ...allMinutes(90), police: 14 }));
    assert.ok('error' in parseAppSetting('hazardMinutes', { ...allMinutes(90), police: 1441 }));
    assert.ok('error' in parseAppSetting('hazardMinutes', { ...allMinutes(90), police: 30.5 }));
    const { camera: _camera, ...missing } = allMinutes(90);
    assert.ok('error' in parseAppSetting('hazardMinutes', missing));
  });
  it('takes x.y.z versions, or nothing', () => {
    assert.deepEqual(parseAppSetting('minAppVersion', { ios: ' 1.2.0 ', android: '' }), { ios: '1.2.0', android: null });
    assert.deepEqual(parseAppSetting('minAppVersion', {}), { ios: null, android: null });
    assert.ok('error' in parseAppSetting('minAppVersion', { ios: '1.2', android: null }));
    assert.ok('error' in parseAppSetting('minAppVersion', { ios: 'v1.2.0', android: null }));
    assert.ok('error' in parseAppSetting('minAppVersion', { ios: 12, android: null }));
  });
  it('sends riders only to the official store for their phone', () => {
    const ios = 'https://apps.apple.com/app/rider-comms/id123';
    const android = 'https://play.google.com/store/apps/details?id=app.ridercomms';
    assert.deepEqual(parseAppSetting('updateUrl', { ios, android }), { ios, android });
    assert.ok('error' in parseAppSetting('updateUrl', { ios: android, android: null }), 'wrong store');
    assert.ok('error' in parseAppSetting('updateUrl', { ios: 'http://apps.apple.com/app/id1', android: null }), 'not https');
    assert.ok('error' in parseAppSetting('updateUrl', { ios: 'https://apps.apple.com.evil.example/x', android: null }));
    assert.ok('error' in parseAppSetting('updateUrl', { ios: 'not a link', android: null }));
    assert.ok('error' in parseAppSetting('updateUrl', { ios: `https://apps.apple.com/${'x'.repeat(300)}`, android: null }));
  });
  it('compares versions number by number', () => {
    assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
    assert.equal(compareVersions('0.9.12', '1.0.0'), -1);
    assert.equal(compareVersions('2.0', '2.0.0'), 0);
  });
});

describe('app settings without a database', { skip: hasDatabase && 'DATABASE_URL set' }, () => {
  it('uses the defaults', async () => {
    assert.deepEqual(await appSettings.current(), defaultAppSettings());
  });
});

describe('staff app settings', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM app_settings');
    await getPool().query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM hazard_reports WHERE reported_by = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
    appSettings.clearCache();
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, terms_version)
       VALUES ($1,'set_admin','setadmin@example.org','x',now(),true,'2026-10-01'), ($2,'set_mod','setmod@example.org','x',now(),false,'2026-10-01'),
        ($3,'set_rider','setrider@example.org','x',now(),false,'2026-10-01')`, SEEDED);
    await getPool().query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $2, 0)`, [MOD, ADMIN]);
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  it('admins only; a change needs a note and a valid value, and lands in the audit log', async () => {
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/settings')).status, 403);
    const start = await (await authenticatedFetch(ctx, ADMIN, '/admin/settings')).json() as { settings: unknown; changes: Record<string, unknown> };
    assert.deepEqual(start, { settings: defaultAppSettings(), changes: {} });
    assert.equal((await postJson(ctx, ADMIN, '/admin/settings/minAppVersion', { value: { ios: '1.2.0' } })).status, 400, 'no note');
    assert.equal((await postJson(ctx, ADMIN, '/admin/settings/minAppVersion', { value: { ios: '1.2' }, note: 'n' })).status, 400);
    assert.equal((await postJson(ctx, ADMIN, '/admin/settings/everything', { value: {}, note: 'n' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/settings', { method: 'POST', body: '{}' })).status, 405);
    const saved = await postJson(ctx, ADMIN, '/admin/settings/minAppVersion', { value: { ios: '1.2.0', android: null }, note: 'Crash in 1.1' });
    assert.equal(saved.status, 200);
    const after = await saved.json() as { settings: { minAppVersion: unknown }; changes: { minAppVersion: { changedBy: string; note: string } } };
    assert.deepEqual(after.settings.minAppVersion, { ios: '1.2.0', android: null });
    assert.deepEqual([after.changes.minAppVersion.changedBy, after.changes.minAppVersion.note], [ADMIN, 'Crash in 1.1']);
    const audit = await (await authenticatedFetch(ctx, ADMIN, '/moderation/actions')).json() as { actions: { action: string; detail?: string }[] };
    assert.ok(audit.actions.some((row) => row.action === 'app_setting_change' && row.detail === 'minAppVersion'));
  });

  it('tells the phone apps the oldest version allowed and where to update', async () => {
    const ios = 'https://apps.apple.com/app/rider-comms/id123';
    await appSettings.set('minAppVersion', { ios: '1.2.0', android: '1.1.0' }, ADMIN, 'n');
    await appSettings.set('updateUrl', { ios, android: null }, ADMIN, 'n');
    const config = await (await fetch(`${ctx.baseUrl()}/config`)).json() as { minAppVersion: unknown; updateUrl: unknown };
    assert.deepEqual(config.minAppVersion, { ios: '1.2.0', android: '1.1.0' });
    assert.deepEqual(config.updateUrl, { ios, android: null });
  });

  it('keeps answering /config with the maps key and defaults when settings cannot be read', async (t) => {
    t.mock.method(appSettings, 'current', async () => { throw new Error('database down'); });
    const res = await fetch(`${ctx.baseUrl()}/config`);
    assert.equal(res.status, 200);
    const config = await res.json() as { googleMapsApiKey: string; minAppVersion: unknown };
    assert.equal(typeof config.googleMapsApiKey, 'string');
    assert.deepEqual(config.minAppVersion, { ios: null, android: null });
  });

  it('a hazard type without a saved lifetime gets its built-in one', async (t) => {
    const { police: _police, ...rest } = defaultAppSettings().hazardMinutes;
    t.mock.method(appSettings, 'current', async () => ({ ...defaultAppSettings(), hazardMinutes: rest }));
    assert.equal(await appSettings.hazardTtlMs('police'), 60 * 60_000);
  });

  it('new hazards last as long as staff set', async () => {
    await appSettings.set('hazardMinutes', { ...allMinutes(60), accident: 30 }, ADMIN, 'Shorter accident pins');
    const before = Date.now();
    const res = await postJson(ctx, RIDER, '/hazards', { type: 'accident', lat: 51.5, lon: -0.12 });
    assert.equal(res.status, 201);
    const { expiresAt } = await res.json() as { expiresAt: number };
    assert.ok(expiresAt >= before + 30 * 60_000 && expiresAt <= Date.now() + 30 * 60_000, String(expiresAt - before));
  });

  it('a stored value that no longer parses keeps the default; replicas re-read after the cache', async () => {
    await getPool().query(`INSERT INTO app_settings (key, value, changed_by, changed_at, note) VALUES ('hazardMinutes', '{"police": 5}', $1, 0, 'old')`, [ADMIN]);
    await getPool().query(`INSERT INTO app_settings (key, value, changed_by, changed_at, note) VALUES ('retired', '{}', $1, 0, 'old')`, [ADMIN]);
    const read = await appSettings.read();
    assert.deepEqual(read.settings.hazardMinutes, defaultAppSettings().hazardMinutes);
    assert.ok(read.changes.hazardMinutes);
    const now = Date.now();
    assert.deepEqual((await appSettings.current(now)).minAppVersion, { ios: null, android: null });
    await getPool().query(`INSERT INTO app_settings (key, value, changed_by, changed_at, note) VALUES ('minAppVersion', '{"ios": "2.0.0"}', $1, 0, 'elsewhere')`, [ADMIN]);
    assert.equal((await appSettings.current(now + 1)).minAppVersion.ios, null, 'still cached');
    assert.equal((await appSettings.current(now + APP_SETTINGS_CACHE_MS)).minAppVersion.ios, '2.0.0');
  });
});
