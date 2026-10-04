#!/usr/bin/env bash
# One backup run: dump the production database over Railway's private
# network, restore the dump into a throwaway Postgres inside this container
# to prove it is usable, encrypt it to the age public key, upload it to the
# backup bucket, and delete uploads older than the retention window.
set -euo pipefail

: "${DATABASE_URL:?}" "${BACKUP_AGE_RECIPIENT:?}"
: "${BUCKET:?}" "${ENDPOINT:?}" "${ACCESS_KEY_ID:?}" "${SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${REGION:-auto}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
s3() { aws --endpoint-url "$ENDPOINT" s3 "$@"; }

# Throwaway Postgres for the verify restore (db-backup.sh's
# BACKUP_VERIFY_DATABASE_URL). initdb refuses to run as root.
scratch=/tmp/verify-pg
mkdir -p "$scratch" && chown postgres:postgres "$scratch"
su-exec postgres initdb -D "$scratch" -A trust -U postgres --no-locale > /dev/null
su-exec postgres pg_ctl -D "$scratch" -o "-c listen_addresses=127.0.0.1 -p 5433" -w start > /dev/null
trap 'su-exec postgres pg_ctl -D "$scratch" -m fast stop > /dev/null 2>&1 || true' EXIT
su-exec postgres createdb -h 127.0.0.1 -p 5433 -U postgres verify
export BACKUP_VERIFY_DATABASE_URL="postgres://postgres@127.0.0.1:5433/verify"

# db-backup.sh prints the verify report on stderr (stdout is just the
# backup path). Railway marks stderr lines as errors, so route the report to
# stdout here; real failures still exit non-zero.
if ! /app/db-backup.sh /tmp/backups > /tmp/backup-path 2> /tmp/backup-report; then
  cat /tmp/backup-report
  exit 1
fi
cat /tmp/backup-report
file="$(cat /tmp/backup-path)"
name="$(basename "$file")"
s3 cp --only-show-errors "$file" "s3://$BUCKET/daily/$name"
s3 cp --only-show-errors "$file.sha256" "s3://$BUCKET/daily/$name.sha256"
echo "{\"level\":\"info\",\"event\":\"backup_uploaded\",\"object\":\"daily/$name\",\"bytes\":$(stat -c %s "$file")}"

# Retention: object names carry the UTC date (rider-comms-YYYYMMDDTHHMMSSZ...).
cutoff="$(date -u -d "@$(( $(date +%s) - retention_days * 86400 ))" +%Y%m%d)"
s3 ls "s3://$BUCKET/daily/" | awk '{print $4}' | while read -r object; do
  stamp="$(echo "$object" | sed -n 's/^rider-comms-\([0-9]\{8\}\)T.*/\1/p')"
  if [ -n "$stamp" ] && [ "$stamp" -lt "$cutoff" ]; then
    s3 rm --only-show-errors "s3://$BUCKET/daily/$object"
    echo "{\"level\":\"info\",\"event\":\"backup_expired\",\"object\":\"daily/$object\"}"
  fi
done
