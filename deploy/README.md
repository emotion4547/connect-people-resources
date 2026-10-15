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
