# Backup and restore runbook

Production data lives in one PostgreSQL database (`DATABASE_URL`). This runbook
covers the encrypted nightly backup, how to prove a backup restores, and how to
recover production from one.

## What is in place

- `scripts/db-backup.sh` takes a `pg_dump` custom-format dump. If
  `BACKUP_VERIFY_DATABASE_URL` is set, it first restores the dump into that
  scratch database and sanity-checks it. It then encrypts the dump with
  [age](https://age-encryption.org) to a public key and writes a `.sha256`
  checksum. It refuses to write an unencrypted backup unless
  `BACKUP_ALLOW_UNENCRYPTED=1` is set, which is for local testing only.
- `scripts/db-restore-verify.sh` checks the checksum, decrypts with the
  private key, and restores into a scratch database with `pg_restore --clean`.
  It then prints the latest applied migration and row counts for the core
  tables. It refuses to run if the target equals `DATABASE_URL`.
- **Railway `db-backup` cron service** (`ops/backup/`) runs daily at 02:41
  UTC inside the Railway project. It dumps the database over the private
  network, so nothing is exposed to the internet, and restores each dump into
  a throwaway Postgres inside the container to prove it is usable. It then
  encrypts the dump to the age public key, uploads it with its checksum to the
  `db-backups` bucket under `daily/`, and deletes uploads older than 30 days.
  The private key isn't stored anywhere in Railway or the repository; the
  owner keeps it. Logs show `backup_uploaded` and `backup_expired` events.
  This copy is independent of the Postgres volume and its snapshots, but it
  sits with the same provider. The GitHub workflow below is the off-provider
  copy.
- `.github/workflows/backup.yml` runs the backup nightly at 03:17 UTC, and on
  demand from the Actions tab. It verifies each dump against a throwaway
  Postgres container, then keeps the encrypted file as a workflow artifact for
  30 days.
- `scripts/backup-drill.sh` runs on every CI build. It backs up the CI test
  database with a throwaway key, restores the encrypted file into a scratch
  database, and fails if any core table's row count differs. That proves the
  scripts still work. It doesn't replace the monthly drill with a real
  production backup and key.

## One-time setup

1. **Create the backup key pair** on a trusted machine, not in CI:
   ```sh
   age-keygen -o rider-comms-backup.agekey
   ```
   The command prints the public key (`age1…`). Store the private key file in
   a password manager or offline vault, with at least two people able to reach
   it. **Without this file no backup can be restored.**
2. **Add repository secrets** under Settings → Secrets and variables → Actions:
   - `BACKUP_AGE_RECIPIENT`: the `age1…` public key.
   - `PRODUCTION_DATABASE_URL`: an externally reachable connection string for
     the production database, with `sslmode=require`. A read-only role is
     enough for `pg_dump` and is recommended. On Railway the database is
     private by default; it gets an external host and port only after you
     add a TCP proxy to the Postgres service (Settings → Networking). That
     exposes the database to the internet, so use a strong password and
     the read-only role. The production service runs the plain `postgres:16-alpine`
     image, which has no TLS certificate, so `sslmode=require` will fail until
     TLS is configured on it; don't send the dump over an unencrypted
     connection.

   Until both secrets exist, the nightly **Database backup** run passes with a
   warning that no off-provider copy was taken. The daily Railway backup above
   still runs.
3. **Match the Postgres version.** If production runs a Postgres major version
   newer than 16, add a repository variable `POSTGRES_MAJOR` set to that
   version. `pg_dump` cannot dump a newer server.
4. **Provider snapshots.** Railway volume backups are enabled on the
   `postgres-data` volume (since 2026-10-03), on a daily schedule kept for 7
   days and a weekly one kept for 4 weeks. They restore faster, but they sit
   with the same provider as the database, so they don't replace this
   off-provider encrypted copy.
5. **Run the workflow once by hand** (Actions → Database backup → Run
   workflow) and check that it uploads an artifact.

## Targets

| | Target |
| --- | --- |
| Backup frequency | Daily, so up to 24 hours of data can be lost (RPO) |
| Backup retention | 30 days as GitHub artifacts. Keep longer copies only if the privacy policy says so. |
| Restore drill | Monthly, and after every Postgres major upgrade |
| Time to restore (RTO) | Under 1 hour for the current data size, measured in each drill |

Deleted accounts stay in backups until those backups expire. The privacy
policy must state the backup retention period (see `RETENTION.md`).

## Monthly restore drill

1. Download the latest backup and its `.sha256`: from the `db-backups` bucket
   (Railway dashboard, or any S3 client with the bucket's credentials), or the
   latest `rider-comms-db-backup-*` artifact from the Database backup workflow.
2. Create an empty scratch database. A local Postgres of the same major
   version works.
3. Run:
   ```sh
   RESTORE_DATABASE_URL=postgres://.../scratch \
   BACKUP_AGE_IDENTITY=/path/to/rider-comms-backup.agekey \
     scripts/db-restore-verify.sh rider-comms-<stamp>.dump.age
   ```
4. Confirm the script prints `checksum ok`, `restore ok`, the expected latest
   migration, and plausible row counts. Record the date, the backup used, and
   how long it took.
5. Drop the scratch database afterwards. It holds real personal data.

## Recovering production

1. **Stop writes.** Scale the backend to zero, or put it in maintenance, so
   nothing writes to the database during the restore.
2. **Choose the backup.** Use the most recent artifact from before the
   incident, or a provider snapshot if one is newer and trustworthy.
3. **Restore into a new, empty database** rather than over the damaged one:
   ```sh
   RESTORE_DATABASE_URL=postgres://.../new-database \
   BACKUP_AGE_IDENTITY=/path/to/rider-comms-backup.agekey \
     scripts/db-restore-verify.sh rider-comms-<stamp>.dump.age
   ```
4. **Point the backend at the restored database** by changing `DATABASE_URL`,
   then start it. On startup the backend applies any migrations newer than the
   backup (see `ensureMigrated`) before accepting traffic, and runs its
   retention sweeps.
5. **Check health.** `/health` and `/ready` should respond, and a test account
   should be able to sign in.
6. **Record the incident**: what happened, the backup restored, the data loss
   window, and follow-ups. Keep the damaged database until the review is done,
   then delete it.
7. **Revoke sessions if needed.** If the incident involved compromised
   credentials, rotate `DATABASE_URL` credentials and the LiveKit and Google
   keys, and consider revoking all sessions:
   `DELETE FROM account_sessions;` forces every rider to sign in again.

## Local check of the tooling

With a local Postgres:

```sh
age-keygen -o /tmp/test.agekey           # prints the public key
DATABASE_URL=postgres://.../dev BACKUP_AGE_RECIPIENT=age1... scripts/db-backup.sh /tmp/backups
RESTORE_DATABASE_URL=postgres://.../scratch BACKUP_AGE_IDENTITY=/tmp/test.agekey \
  scripts/db-restore-verify.sh /tmp/backups/rider-comms-*.dump.age
```
