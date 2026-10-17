# Развёртывание «Работа для Всех»

Сервер `89.125.121.144` (Москва). Всё, включая данные пользователей, живёт на нём
(152-ФЗ, ст. 18 ч. 5): облачный Supabase больше не используется.

## Как устроено
- **Фронтенд** — статика в `/var/www/rabota-vsem-56.ru`, отдаёт Caddy (HTTPS автоматически).
  Автодеплой: GitHub Actions по пушу в `main` (`.github/workflows/deploy.yml`).
- **Бэкенд** — облегчённый самохостинг Supabase в Docker, каталог `/opt/supabase`
  (`deploy/supabase/`): Postgres, GoTrue (вход), PostgREST, Realtime, Storage,
  edge-функции `delete-user` и `send-webhook`, внутренний шлюз Caddy на `127.0.0.1:8000`.
  Основной Caddy проксирует на него `/auth/v1`, `/rest/v1`, `/storage/v1`,
  `/realtime/v1`, `/functions/v1`. Studio, аналитики и Kong нет — сервер на 2 ГБ.
- **Секреты** — только в `/opt/supabase/.env` на сервере (в git не попадают).
  В фронтенд вшит публичный anon-ключ (`.env` репозитория).

## Команды (на сервере)
```bash
cd /opt/supabase
docker compose ps                     # состояние
docker compose logs -f auth           # логи сервиса
docker compose up -d                  # поднять всё после правок
```

## Новая миграция БД
Положить SQL в `supabase/migrations/`, затем на сервере:
```bash
docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --single-transaction < migrations/<файл>.sql
```

## Новая edge-функция
Положить в `deploy/supabase/volumes/functions/<имя>/index.ts`, скопировать на сервер в
`/opt/supabase/volumes/functions/` и `docker restart supabase-edge-functions`.

## Бэкапы
`/opt/supabase/backup.sh` (cron 03:17): дамп БД (`public`, `private`, `auth`, `storage`) и
файлы хранилища в `/var/backups/rabota-vsem`, 14 дней. Восстановление проверено на
отдельной базе. **Копии лежат на том же сервере** — настройте выгрузку на другой хост.

## Администратор
Саморегистрация даёт только роли `hr` и `worker`. Админа создают через GoTrue Admin API
со служебным ключом и затем `update public.user_roles set role='admin'`.

## Применение изменений этапа 1 (шаги 1–3)
Коротко: `bash deploy/scripts/apply-stage1.sh --yes` с вашего компьютера (без `--yes` покажет план). Скрипт делает всё ниже, кроме фронтенда. Подробности по шагам:

Порядок важен. Перед началом — свежий бэкап (`/opt/supabase/backup.sh`).
1. Миграции по одной, как в разделе «Новая миграция БД», строго в этом порядке:
   `20261017100000_organizations_and_audit_log.sql`, `20261017110000_settings_and_tax_rates.sql`,
   `20261017120000_new_roles.sql`, `20261017120100_staff_permissions_directories.sql`,
   `20261017120200_mfa_setting.sql`, `20261017130000_clients_contracts_tariffs.sql`. Миграция `…120000_new_roles.sql` обязательно отдельным
   запуском: новые значения enum нельзя использовать в той же транзакции.
2. Edge-функция `invite-staff`: скопировать `deploy/supabase/volumes/functions/invite-staff/` на сервер
   в `/opt/supabase/volumes/functions/` и `docker restart supabase-edge-functions`.
3. Сервис входа: в `docker-compose.yml` добавлены `GOTRUE_MFA_TOTP_*` и расширен `GOTRUE_URI_ALLOW_LIST`
   (разрешены адреса возврата вида `<сайт>/set-password`). Скопировать файл на сервер и
   `docker compose up -d auth`.
4. Фронтенд выкладывается обычным путём (пуш в `main`). Выкладывать его **после** миграций:
   новый интерфейс обращается к новым таблицам.
5. После миграций обязателен вход администратора: у существующих пользователей появилась организация
   «Основная организация», название поменять в разделе «Организации».
Двухфакторный вход по умолчанию выключен; включается в «Правилах и ставках» после того, как все
сотрудники подключили код в разделе «Безопасность».
