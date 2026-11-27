import { ensureMigrated, getPool } from './db.ts';
import { AccountDeletionStore } from './accountDeletionStore.ts';

// The native-builds workflow signs up a throwaway account on production for
// each iOS and Android run (username `ci<run id><attempt>` plus `i` or `a`,
// email `<username>@example.com`) and deletes it at the end of the job. A
// cancelled or lost runner skips that step, so this sweep removes any that
// are left. Both the username shape and the matching reserved-domain email
// must hold, so a real rider is never caught by it.

/** Accounts younger than this are left alone: a native run may still be using one. */
export const CI_TEST_ACCOUNT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const SELECT_LEFTOVER_CI_ACCOUNTS = `
  SELECT id FROM users
  WHERE username ~ '^ci[0-9]+[ai]?$'
    AND lower(email) = lower(username) || '@example.com'
    AND created_at < to_timestamp($1::double precision / 1000)
  ORDER BY created_at
  LIMIT 200`;

export class CiTestAccountSweep {
  private readonly deletion: Pick<AccountDeletionStore, 'deleteRider'>;

  constructor(deletion: Pick<AccountDeletionStore, 'deleteRider'> = new AccountDeletionStore()) {
    this.deletion = deletion;
  }

  /** Deletes leftover CI accounts, each with everything it owns. Returns how many went. */
  async sweep(now = Date.now()): Promise<{ deleted: number }> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ id: string }>(SELECT_LEFTOVER_CI_ACCOUNTS, [now - CI_TEST_ACCOUNT_MAX_AGE_MS]);
    for (const { id } of rows) await this.deletion.deleteRider(id);
    return { deleted: rows.length };
  }
}
