#!/usr/bin/env bash
# Проверка здоровья сервера раз в 5 минут (ТЗ, раздел 19: мониторинг). При сбое пишет в журнал и шлёт оповещение
# администратору и руководителю через систему уведомлений (одно в сутки на вид сбоя).
#   */5 * * * * root /opt/supabase/ops-check.sh >> /var/log/rabotavsem-ops.log 2>&1
set -uo pipefail
DB="docker exec supabase-db psql -U supabase_admin -d postgres -qAt"
SITE="${SITE_URL:-https://rabota-vsem-56.ru}"
alert() {  # вид, заголовок, текст
  echo "$(date '+%F %T') СБОЙ [$1] $2 — $3"
  $DB -c "select private.ops_alert('$1', \$q\$$2\$q\$, \$q\$$3\$q\$)" >/dev/null 2>&1 || echo "$(date '+%F %T') оповестить не удалось (база недоступна?)"
}

# 1. Сайт и API отвечают
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE/" || true)
[ "$code" = "200" ] || alert site "Сайт не отвечает" "Адрес $SITE ответил кодом ${code:-нет ответа}"
api=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$SITE/auth/v1/health" || true)
[ "$api" = "200" ] || alert auth "Сервис входа не отвечает" "$SITE/auth/v1/health ответил кодом ${api:-нет ответа}"

# 2. База отвечает
$DB -c "select 1" >/dev/null 2>&1 || alert db "База данных не отвечает" "Команда select 1 не выполнилась"

# 3. Свежий бэкап
latest=$(ls -1t /var/backups/rabota-vsem/db-*.dump 2>/dev/null | head -1 || true)
if [ -z "$latest" ]; then alert backup "Нет бэкапов" "В /var/backups/rabota-vsem нет ни одного дампа"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
  [ "$age_h" -le 30 ] || alert backup "Бэкап устарел" "Последнему дампу $age_h ч, ночной бэкап не отработал"
fi

# 4. Место на диске и память
use=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${use:-0}" -lt 85 ] || alert disk "Мало места на диске" "Занято ${use}% корневого раздела"
avail=$(free -m | awk '/^Mem:/ {print $7}')
[ "${avail:-999}" -gt 120 ] || alert memory "Мало свободной памяти" "Доступно ${avail} МБ"

# 5. Задания по расписанию: очередь уведомлений не копится
stuck=$($DB -c "select count(*) from public.notification_outbox where status = 'pending' and scheduled_at < now() - interval '30 minutes'" 2>/dev/null || echo 0)
[ "${stuck:-0}" -lt 50 ] || alert queue "Очередь уведомлений не разбирается" "Неотправленных старше 30 минут: $stuck"
