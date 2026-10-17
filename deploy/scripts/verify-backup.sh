#!/usr/bin/env bash
# Проверка восстановления из бэкапа (ТЗ, раздел 19: восстановление проверяется раз в месяц).
# Берёт самый свежий дамп, разворачивает его во ВРЕМЕННУЮ базу внутри того же Postgres, сверяет количество строк в ключевых таблицах
# с рабочей базой и удаляет временную базу. Рабочая база не меняется. Запускается на сервере:
#
#   bash /opt/supabase/verify-backup.sh
#
# Бэкап, который ни разу не разворачивали, бэкапом не считается: результат (OK/ПРОВАЛ) нужно смотреть.
set -euo pipefail
DIR=/var/backups/rabota-vsem
DB="docker exec -i supabase-db psql -U supabase_admin -v ON_ERROR_STOP=1 -At"
LATEST=$(ls -1t "$DIR"/db-*.dump 2>/dev/null | head -1 || true)
[ -n "$LATEST" ] || { echo "ПРОВАЛ: в $DIR нет дампов"; exit 1; }
AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
echo "Дамп: $LATEST (возраст $AGE_H ч)"
[ "$AGE_H" -le 30 ] || echo "ВНИМАНИЕ: дампу больше 30 часов, ночной бэкап не отработал"

TMP="restore_check_$$"
cleanup() { $DB -d postgres -c "drop database if exists $TMP" >/dev/null 2>&1 || true; }
trap cleanup EXIT

$DB -d postgres -c "create database $TMP" >/dev/null
# Расширения, на которые ссылается схема, нужны до восстановления
for ext in $($DB -d postgres -c "select extname from pg_extension where extname not in ('plpgsql')"); do
  $DB -d "$TMP" -c "create schema if not exists extensions; create extension if not exists \"$ext\" with schema extensions" >/dev/null 2>&1 || true
done
# Как в рабочей базе: расширения в схеме extensions и она в пути поиска (иначе не создаются ограничения «без пересечений» на gist)
$DB -d postgres -c "alter database $TMP set search_path to public, extensions" >/dev/null
docker cp "$LATEST" supabase-db:/tmp/restore_check.dump
ERR=$(docker exec supabase-db pg_restore -U supabase_admin -d "$TMP" --no-owner --no-privileges /tmp/restore_check.dump 2>&1 | grep -i "error" | grep -v 'errors ignored' | grep -vc 'schema "public" already exists' || true)
docker exec supabase-db rm -f /tmp/restore_check.dump

FAIL=0
for t in public.organizations public.user_roles public.workers public.clients public.sites public.orders public.shifts public.assignments public.accruals public.client_documents; do
  live=$($DB -d postgres -c "select count(*) from $t")
  rest=$($DB -d "$TMP" -c "select count(*) from $t" 2>/dev/null || echo "нет")
  # Дамп снят ночью: допускаем, что за день в рабочей базе прибавилось, но в копии не должно быть больше, чем сейчас
  if [ "$rest" = "нет" ] || [ "$rest" -gt "$live" ]; then FAIL=1; fi
  printf '%-28s рабочая %-8s копия %s\n' "$t" "$live" "$rest"
done
echo "Ошибок при восстановлении: $ERR"
if [ "$FAIL" -eq 0 ]; then echo "OK: бэкап разворачивается, таблицы на месте"; else echo "ПРОВАЛ: копия не сходится с рабочей базой"; exit 1; fi
