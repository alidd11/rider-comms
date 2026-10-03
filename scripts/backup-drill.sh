#!/usr/bin/env bash
# End-to-end drill of the backup tooling against a disposable database, as run
# in CI: generate a throwaway age key, back up $DATABASE_URL with
# scripts/db-backup.sh (including its pre-encryption verify restore), restore
# the encrypted file with scripts/db-restore-verify.sh, and check the restored
# row counts match the source. Proves the scripts work without touching
# production or its key. See BACKUP_RESTORE.md.
#
#   DATABASE_URL=postgres://user:pass@host:5432/test_db scripts/backup-drill.sh
#
# Creates and drops two scratch databases next to DATABASE_URL, so the role
# needs CREATEDB. Never point this at production.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at a disposable database}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/rider-comms-drill.XXXXXX")"
server="${DATABASE_URL%/*}"
verify_db="rider_comms_drill_verify"
restore_db="rider_comms_drill_restore"

psql_admin() { psql "$DATABASE_URL" --no-psqlrc --quiet --command "$1"; }
cleanup() {
  psql_admin "DROP DATABASE IF EXISTS $verify_db" || true
  psql_admin "DROP DATABASE IF EXISTS $restore_db" || true
  rm -rf "$work"
}
trap cleanup EXIT

for db in "$verify_db" "$restore_db"; do
  psql_admin "DROP DATABASE IF EXISTS $db"
  psql_admin "CREATE DATABASE $db"
done

age-keygen --output "$work/drill.agekey" 2>/dev/null
recipient="$(age-keygen -y "$work/drill.agekey")"

backup="$(BACKUP_AGE_RECIPIENT="$recipient" BACKUP_VERIFY_DATABASE_URL="$server/$verify_db" \
  "$script_dir/db-backup.sh" "$work/out")"
RESTORE_DATABASE_URL="$server/$restore_db" BACKUP_AGE_IDENTITY="$work/drill.agekey" \
  "$script_dir/db-restore-verify.sh" "$backup"

count() { psql "$1" --no-psqlrc --tuples-only --no-align --quiet --command "SELECT count(*) FROM $2"; }
for table in schema_migrations users rider_profiles friendships direct_messages safety_reports rides hazard_reports; do
  source_rows="$(count "$DATABASE_URL" "$table")"
  restored_rows="$(count "$server/$restore_db" "$table")"
  if [[ "$source_rows" != "$restored_rows" ]]; then
    echo "$table: source has $source_rows rows but the restore has $restored_rows" >&2
    exit 1
  fi
done
echo "backup drill ok: encrypted backup restored with matching row counts"
