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
   `20261017120200_mfa_setting.sql`, `20261017130000_clients_contracts_tariffs.sql`, `20261017140000_sites_launch.sql`, `20261017150000_orders_shifts.sql`, `20261017160000_workers_assignments.sql`, `20261017170000_hiring.sql`, `20261017180000_timesheets.sql`, `20261017190000_accruals.sql`. Миграция `…120000_new_roles.sql` обязательно отдельным
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

### Расписание статусов смен
Смены «идут» и «завершаются» по времени, вместе с ними двигается статус заказа. Для этого раз в 5 минут нужно
вызывать функцию базы; на сервере добавьте в cron (`crontab -e`):
```
*/5 * * * * docker exec supabase-db psql -U supabase_admin -d postgres -qc "select private.advance_shift_statuses()" >/dev/null 2>&1
```

### Ключ шифрования персональных данных
Номера документов, ИНН, СНИЛС и реквизиты выплаты шифруются в базе ключом `app.pii_key`. Ключ хранится в настройках
сервера Postgres, а не в таблицах, поэтому в логические бэкапы (`backup.sh`) не попадает. `apply-stage1.sh` создаёт ключ при первом
применении и один раз показывает его в терминале. **Сохраните его в парольном менеджере отдельно от сервера:** потеря ключа означает
потерю зашифрованных данных, а смена ключа требует перешифровки.

### Ежедневная проверка сроков документов
Задачи по истекающим документам и налогу патента создаёт функция базы. Добавьте в cron (раз в день):
```
15 6 * * * docker exec supabase-db psql -U supabase_admin -d postgres -qc "select private.generate_document_tasks()" >/dev/null 2>&1
```

### Явка, автоподтверждение табелей и рейтинг
Три функции работают по расписанию. Добавьте в cron:
```
*/10 * * * * docker exec supabase-db psql -U supabase_admin -d postgres -qc "select private.process_attendance(); select private.autoconfirm_timesheets()" >/dev/null 2>&1
30 3 * * * docker exec supabase-db psql -U supabase_admin -d postgres -qc "select private.recompute_all_ratings()" >/dev/null 2>&1
```
`process_attendance` ставит «не вышел» через 2 часа после начала смены без отметки и закрывает забытый уход по графику (пометка «авто»).
`autoconfirm_timesheets` подтверждает табели, на которые заказчик не ответил в срок (48 часов по умолчанию, настройка `timesheet.autoconfirm_hours`).
`recompute_all_ratings` пересчитывает рейтинг: окно 90 дней скользит со временем.

### Налоговые ставки перед первыми начислениями
Начисления считают налоги, взносы и комиссию выплаты по таблице «Налоговые статусы» (`/admin/rules`). Стартовые ставки
из ТЗ помечены «не подтверждено»: до первого табеля бухгалтерия должна проверить ИП 0%, самозанятый — комиссия 2%,
ГПХ — НДФЛ 13% и взносы 30%, а также ставки для трудового договора (в ТЗ не заданы, взяты как у ГПХ).
Ставка действует с даты вступления, созданные начисления не пересчитываются.
