#!/usr/bin/env bash
# Ночной бэкап: дамп базы + файлы хранилища. Хранит 14 дней.
# Копии лежат на том же сервере — для защиты от потери сервера их нужно
# дополнительно выгружать наружу (rsync/rclone на другой хост).
set -euo pipefail
DIR=/var/backups/rabota-vsem
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DIR"
docker exec supabase-db pg_dump -U supabase_admin -d postgres --format=custom --no-owner \
  --schema=public --schema=private --schema=auth --schema=storage > "$DIR/db-$STAMP.dump.tmp"
mv "$DIR/db-$STAMP.dump.tmp" "$DIR/db-$STAMP.dump"
tar -czf "$DIR/storage-$STAMP.tar.gz" -C /opt/supabase/volumes storage 2>/dev/null || true
find "$DIR" -type f \( -name 'db-*.dump' -o -name 'storage-*.tar.gz' \) -mtime +14 -delete
echo "backup ok: $STAMP ($(du -sh "$DIR" | cut -f1))"
