#!/usr/bin/env bash
# Encrypted logical backup of the Rider Comms Postgres database.
#
#   DATABASE_URL=postgres://... BACKUP_AGE_RECIPIENT=age1... scripts/db-backup.sh [output-dir]
#
# Writes rider-comms-<UTC timestamp>.dump.age (pg_dump custom format,
# encrypted to the age public key) plus a .sha256 checksum next to it. Only
# the public key is needed here; keep the matching private key offline and
# use it with scripts/db-restore-verify.sh. See BACKUP_RESTORE.md.
#
# Optional BACKUP_VERIFY_DATABASE_URL: a scratch database the dump is restored
# into and sanity-checked *before* it is encrypted, so an unusable dump fails
# the run without the private key ever being needed. It is wiped each time.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point at the database to back up}"
out_dir="${1:-./backups}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$out_dir"

if [[ -z "${BACKUP_AGE_RECIPIENT:-}" && "${BACKUP_ALLOW_UNENCRYPTED:-}" != "1" ]]; then
  echo "Refusing to write an unencrypted backup: set BACKUP_AGE_RECIPIENT (or BACKUP_ALLOW_UNENCRYPTED=1 for local testing)" >&2
  exit 1
fi
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || { echo "age is required for encrypted backups" >&2; exit 1; }
fi

plain="$(mktemp "${TMPDIR:-/tmp}/rider-comms-dump.XXXXXX")"
trap 'rm -f "$plain"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file "$plain" "$DATABASE_URL"

if [[ -n "${BACKUP_VERIFY_DATABASE_URL:-}" ]]; then
  # Verification output goes to stderr so stdout stays just the backup path.
  RESTORE_DATABASE_URL="$BACKUP_VERIFY_DATABASE_URL" BACKUP_SKIP_CHECKSUM=1 \
    "$script_dir/db-restore-verify.sh" "$plain" >&2
fi

if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  file="$out_dir/rider-comms-$stamp.dump.age"
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$file.partial" "$plain"
else
  # Local testing only: production backups hold personal data and must be encrypted.
  file="$out_dir/rider-comms-$stamp.dump"
  cp "$plain" "$file.partial"
fi

# Rename only after the output is complete, so a failed run never leaves a
# truncated file under a final backup name.
mv "$file.partial" "$file"
(cd "$(dirname "$file")" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
echo "$file"
