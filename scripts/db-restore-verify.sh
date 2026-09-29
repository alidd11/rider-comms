#!/usr/bin/env bash
# Restores a backup made by scripts/db-backup.sh into a scratch database and
# checks that it is usable. Run this regularly: a backup that has never been
# restored is not a tested backup.
#
#   RESTORE_DATABASE_URL=postgres://.../scratch BACKUP_AGE_IDENTITY=~/keys/backup.agekey \
#     scripts/db-restore-verify.sh backups/rider-comms-<stamp>.dump.age
#
# RESTORE_DATABASE_URL is wiped and replaced by the backup contents, so it
# must never be the production database. See BACKUP_RESTORE.md.
set -euo pipefail

backup="${1:?usage: db-restore-verify.sh <backup file>}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point at a scratch database}"
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "RESTORE_DATABASE_URL is the same as DATABASE_URL; refusing to overwrite it" >&2
  exit 1
fi

if [[ "${BACKUP_SKIP_CHECKSUM:-}" == "1" ]]; then
  : # called by db-backup.sh on its own fresh, not-yet-checksummed dump
elif [[ -f "$backup.sha256" ]]; then
  (cd "$(dirname "$backup")" && sha256sum --check --quiet "$(basename "$backup").sha256")
  echo "checksum ok"
else
  echo "warning: no $backup.sha256 checksum found; skipping integrity check" >&2
fi

restore() {
  pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_DATABASE_URL"
}
if [[ "$backup" == *.age ]]; then
  : "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY must name the age private key file for encrypted backups}"
  age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$backup" | restore
else
  restore < "$backup"
fi
echo "restore ok"

query() { psql "$RESTORE_DATABASE_URL" --no-psqlrc --tuples-only --no-align --quiet --command "$1"; }
latest_migration="$(query 'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')"
if [[ -z "$latest_migration" ]]; then
  echo "restored database has no applied migrations" >&2
  exit 1
fi
echo "latest migration: $latest_migration"
for table in users rider_profiles friendships direct_messages safety_reports rides hazard_reports; do
  echo "$table: $(query "SELECT count(*) FROM $table") rows"
done
