#!/bin/sh
# Periodic backup of MongoDB (mongodump archive) and the uploads volume.
# Restore:
#   mongorestore --uri="$MONGO_BACKUP_URI" --archive=/backups/<stamp>/noble.archive.gz --gzip --drop
#   tar -xzf /backups/<stamp>/uploads.tar.gz -C /data
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

while true; do
  stamp="$(date +%Y%m%d-%H%M%S)"
  target="/backups/${stamp}"
  mkdir -p "${target}"
  echo "[backup] ${stamp}: dumping database"
  mongodump --uri="${MONGO_BACKUP_URI}" --archive="${target}/noble.archive.gz" --gzip --quiet
  echo "[backup] ${stamp}: archiving uploads"
  tar -czf "${target}/uploads.tar.gz" -C /data uploads
  find /backups -mindepth 1 -maxdepth 1 -type d -mtime +"${KEEP_DAYS}" -exec rm -rf {} +
  echo "[backup] ${stamp}: done; next run in ${INTERVAL}s"
  sleep "${INTERVAL}"
done
