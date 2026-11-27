import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CI_TEST_ACCOUNT_MAX_AGE_MS, CiTestAccountSweep } from '../src/ciTestAccountSweep.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const NOW = Date.parse('2026-11-27T12:00:00Z');
const OLD = NOW - CI_TEST_ACCOUNT_MAX_AGE_MS - 60_000;
const RECENT = NOW - 60_000;
const IDS = ['ios-old', 'android-old', 'legacy-old', 'ios-running', 'rider-ci-name', 'rider-example', 'rider-other-email'];

async function insertUser(id: string, username: string, email: string, createdAt: number): Promise<void> {
  await getPool().query(
    `INSERT INTO users (id, username, password_hash, email, created_at)
     VALUES ($1, $2, 'x', $3, to_timestamp($4::double precision / 1000))`,
    [id, username, email, createdAt],
  );
}

describe('CiTestAccountSweep', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed CI account sweep tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM users WHERE id = ANY($1)', [IDS]);
  });

  after(async () => {
    await resetDbForTests();
  });

  it('deletes leftover CI accounts and keeps riders and accounts a run may still use', async () => {
    await insertUser('ios-old', 'ci4601566396611i', 'ci4601566396611i@example.com', OLD);
    await insertUser('android-old', 'ci4601566396611a', 'CI4601566396611A@example.com', OLD);
    await insertUser('legacy-old', 'ci123451', 'ci123451@example.com', OLD);
    await insertUser('ios-running', 'ci4602166396611i', 'ci4602166396611i@example.com', RECENT);
    await insertUser('rider-ci-name', 'ci2024', 'ci2024@gmail.com', OLD);
    await insertUser('rider-example', 'circuit', 'circuit@example.com', OLD);
    await insertUser('rider-other-email', 'ci99i', 'someone@example.com', OLD);

    const deleted: string[] = [];
    const sweep = new CiTestAccountSweep({ deleteRider: async (id) => { deleted.push(id); } });
    assert.deepEqual(await sweep.sweep(NOW), { deleted: 3 });
    assert.deepEqual(deleted.sort(), ['android-old', 'ios-old', 'legacy-old']);
  });

  it('removes the account row through the real account deletion', async () => {
    await insertUser('ios-old', 'ci777i', 'ci777i@example.com', OLD);
    assert.deepEqual(await new CiTestAccountSweep().sweep(NOW), { deleted: 1 });
    const { rows } = await getPool().query('SELECT id FROM users WHERE id = ANY($1)', [IDS]);
    assert.deepEqual(rows, []);
  });
});
