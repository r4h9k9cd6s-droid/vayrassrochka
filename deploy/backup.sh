#!/bin/bash
# Раз в сутки делает сжатый дамп базы и удаляет копии старше KEEP_DAYS дней.
set -u
while true; do
  stamp=$(date -u +%Y-%m-%d_%H%M)
  if pg_dump -h db -U vayrassrochka vayrassrochka | gzip > "/backups/db_${stamp}.sql.gz.tmp"; then
    mv "/backups/db_${stamp}.sql.gz.tmp" "/backups/db_${stamp}.sql.gz"
    echo "[backup] ${stamp}: готово"
  else
    rm -f "/backups/db_${stamp}.sql.gz.tmp"
    echo "[backup] ${stamp}: ОШИБКА" >&2
  fi
  find /backups -name 'db_*.sql.gz' -mtime +"${KEEP_DAYS:-14}" -delete
  sleep 86400
done
