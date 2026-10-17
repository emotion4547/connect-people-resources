#!/usr/bin/env bash
# Применение шагов 1–3 этапа 1 на боевой сервер: бэкап, миграции, edge-функция, настройки входа,
# проверка. Запускается ЧЕЛОВЕКОМ с его компьютера, из корня репозитория:
#
#   bash deploy/scripts/apply-stage1.sh            # только показать, что будет сделано
#   bash deploy/scripts/apply-stage1.sh --yes      # выполнить
#
# Нужен вход на сервер по SSH (ключ или пароль, как обычно). Скрипт можно запускать повторно:
# уже применённые миграции пропускаются. Ошибка на любом шаге останавливает выполнение,
# остальные шаги не запускаются.
set -euo pipefail

HOST="${HOST:-root@89.125.121.144}"
DB="docker exec -i supabase-db psql -U supabase_admin -d postgres"
MIGRATIONS=(
  20261017100000_organizations_and_audit_log.sql
  20261017110000_settings_and_tax_rates.sql
  20261017120000_new_roles.sql
  20261017120100_staff_permissions_directories.sql
  20261017120200_mfa_setting.sql
  20261017130000_clients_contracts_tariffs.sql
  20261017140000_sites_launch.sql
  20261017150000_orders_shifts.sql
  20261017160000_workers_assignments.sql
  20261017170000_hiring.sql
)

cd "$(dirname "$0")/../.."

if [ "${1:-}" != "--yes" ]; then
  cat <<EOF
Будет сделано на $HOST:
  1. бэкап базы (/opt/supabase/backup.sh) и проверка, что файл создан
  2. миграции по порядку, каждая в своей транзакции, уже применённые пропускаются:
$(printf '       %s\n' "${MIGRATIONS[@]}")
  3. edge-функция invite-staff в /opt/supabase/volumes/functions, перезапуск supabase-edge-functions
  4. docker-compose.yml: GOTRUE_MFA_TOTP_* и расширенный GOTRUE_URI_ALLOW_LIST (копия файла рядом),
     перезапуск только сервиса входа (auth), вход прервётся на несколько секунд
  5. проверка (deploy/scripts/stage1-smoke.sql): выполняется в транзакции и откатывается
Фронтенд этот скрипт НЕ выкладывает.
Для выполнения: bash deploy/scripts/apply-stage1.sh --yes
EOF
  exit 0
fi

for f in "${MIGRATIONS[@]}"; do [ -f "supabase/migrations/$f" ] || { echo "Нет файла supabase/migrations/$f"; exit 1; }; done
[ -f deploy/supabase/volumes/functions/admit-candidate/index.ts ] || { echo "Нет файла функции admit-candidate"; exit 1; }
[ -f deploy/supabase/volumes/functions/invite-staff/index.ts ] || { echo "Нет файла функции invite-staff"; exit 1; }
[ -f deploy/scripts/stage1-smoke.sql ] || { echo "Нет файла stage1-smoke.sql"; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_DIR="/root/stage1-$STAMP"

echo "== Копирование файлов на сервер ($REMOTE_DIR)"
ssh "$HOST" "mkdir -p $REMOTE_DIR/functions"
scp -q "${MIGRATIONS[@]/#/supabase/migrations/}" deploy/scripts/stage1-smoke.sql "$HOST:$REMOTE_DIR/"
scp -q deploy/supabase/volumes/functions/invite-staff/index.ts "$HOST:$REMOTE_DIR/functions/invite-staff.ts"
scp -q deploy/supabase/volumes/functions/admit-candidate/index.ts "$HOST:$REMOTE_DIR/functions/admit-candidate.ts"

echo "== Выполнение на сервере"
ssh "$HOST" "REMOTE_DIR=$REMOTE_DIR STAMP=$STAMP bash -s" <<'REMOTE'
set -euo pipefail
DB="docker exec -i supabase-db psql -U supabase_admin -d postgres"
cd /opt/supabase

echo "-- 1. Бэкап"
BEFORE="$(ls -1t /var/backups/rabota-vsem/db-*.dump 2>/dev/null | head -1 || true)"
./backup.sh
AFTER="$(ls -1t /var/backups/rabota-vsem/db-*.dump | head -1)"
[ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ] || { echo "ОШИБКА: новый файл бэкапа не появился"; exit 1; }
[ -s "$AFTER" ] || { echo "ОШИБКА: файл бэкапа пуст"; exit 1; }
echo "   создан: $AFTER ($(du -h "$AFTER" | cut -f1))"

applied() {  # 0, если миграция уже применена
  local q
  case "$1" in
    20261017100000*) q="select to_regclass('public.organizations') is not null" ;;
    20261017110000*) q="select to_regclass('public.setting_definitions') is not null" ;;
    20261017120000*) q="select exists (select 1 from pg_enum where enumtypid = 'public.app_role'::regtype and enumlabel = 'accountant')" ;;
    20261017120100*) q="select to_regclass('public.staff_profiles') is not null" ;;
    20261017170000*) q="select to_regclass('public.candidates') is not null" ;;
    20261017160000*) q="select to_regclass('public.assignments') is not null" ;;
    20261017150000*) q="select to_regclass('public.shifts') is not null" ;;
    20261017140000*) q="select to_regclass('public.site_secrets') is not null" ;;
    20261017130000*) q="select to_regclass('public.tariffs') is not null" ;;
    20261017120200*) q="select to_regclass('public.setting_definitions') is not null and exists (select 1 from public.setting_definitions where key = 'auth.mfa_enforced')" ;;
  esac
  [ "$($DB -tAc "$q")" = "t" ]
}

echo "-- 2. Миграции"
for f in $(ls "$REMOTE_DIR"/2026*.sql | sort); do
  name="$(basename "$f")"
  if applied "$name"; then
    echo "   пропуск (уже применена): $name"
  else
    $DB -v ON_ERROR_STOP=1 --single-transaction < "$f"
    echo "   применена: $name"
  fi
done

echo "-- 2а. Ключ шифрования персональных данных"
if [ "$($DB -tAc "select coalesce(current_setting('app.pii_key', true), '') = ''")" = "t" ]; then
  PII_KEY="$(openssl rand -hex 32)"
  $DB -qc "ALTER SYSTEM SET app.pii_key = '$PII_KEY'" >/dev/null
  $DB -qc "select pg_reload_conf()" >/dev/null
  echo "   ключ создан. СОХРАНИТЕ ЕГО В ПАРОЛЬНОМ МЕНЕДЖЕРЕ ОТДЕЛЬНО ОТ СЕРВЕРА: без него зашифрованные номера документов не прочитать."
  echo "   КЛЮЧ: $PII_KEY"
else
  echo "   ключ уже задан"
fi

echo "-- 3. Edge-функции invite-staff и admit-candidate"
for fn in invite-staff admit-candidate; do
  mkdir -p "volumes/functions/$fn"
  cp "$REMOTE_DIR/functions/$fn.ts" "volumes/functions/$fn/index.ts"
done
docker restart supabase-edge-functions >/dev/null
echo "   функция на месте, edge-runtime перезапущен"

echo "-- 4. Сервис входа"
cp docker-compose.yml "docker-compose.yml.bak-$STAMP"
if grep -q GOTRUE_MFA_TOTP_ENROLL_ENABLED docker-compose.yml; then
  echo "   настройки входа уже есть"
else
  sed -i 's|^\(\s*\)GOTRUE_URI_ALLOW_LIST: .*|\1GOTRUE_URI_ALLOW_LIST: ${SITE_URL},${SITE_URL}/**\n\1GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true"\n\1GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true"|' docker-compose.yml
  grep -q GOTRUE_MFA_TOTP_ENROLL_ENABLED docker-compose.yml || { cp "docker-compose.yml.bak-$STAMP" docker-compose.yml; echo "ОШИБКА: не удалось внести настройки входа, файл восстановлен"; exit 1; }
  docker compose config -q || { cp "docker-compose.yml.bak-$STAMP" docker-compose.yml; echo "ОШИБКА: compose-файл невалиден, восстановлен прежний"; exit 1; }
fi
docker compose up -d auth
sleep 5
docker compose ps auth --format '   {{.Name}}: {{.Status}}'

echo "-- 5. Проверка (в транзакции, с откатом)"
$DB -v ON_ERROR_STOP=1 < "$REMOTE_DIR/stage1-smoke.sql" 2>&1 | grep -E "NOTICE|ПРОВАЛ|ERROR" | sed 's/^psql:[^ ]* //'
echo "-- Готово. Каталог с файлами на сервере: $REMOTE_DIR"
REMOTE

cat <<'EOF'

Дальше вручную (нужен интерфейс):
  1. Выложить фронтенд: слить stage1 в main (после этого GitHub Actions выложит сайт).
  2. Войти администратором: в меню появятся «Организации», «Сотрудники», «Права ролей», «Справочники»,
     «Правила и ставки», «Безопасность».
  3. «Сотрудники» → «Добавить сотрудника» → скопировать ссылку → открыть её в другом браузере →
     задать пароль → войти → вернуться и заблокировать этого сотрудника → убедиться, что вход закрыт.
  4. «Безопасность» → подключить двухфакторный вход; включать обязательность в «Правилах и ставках»
     только после того, как это сделали все сотрудники.
EOF
