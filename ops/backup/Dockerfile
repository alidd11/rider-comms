# Daily encrypted database backup, run as the Railway "db-backup" cron
# service. Reuses the repository's own backup scripts (exercised by CI's
# backup drill on every build). See BACKUP_RESTORE.md.
FROM postgres:16-alpine
RUN apk add --no-cache bash age aws-cli
WORKDIR /app
COPY scripts/db-backup.sh scripts/db-restore-verify.sh ops/backup/run.sh /app/
RUN chmod +x /app/*.sh
ENTRYPOINT []
CMD ["/app/run.sh"]
