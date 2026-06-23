# Changelog — 2026-06-23

## Безопасность
- Закрыты находки скана: `chat_attachments_public`, `client_role_metadata`, `file_ext_trust`, `security_definer_functions`, `webhook_no_auth`, `SUPA_*` (anon/authenticated executable, leaked password protection, public bucket listing, rls always true), `chat_attachments_public_upload`, `chat_messages_no_update_policy`, `profiles_admin_notes_exposed_to_hr`, `realtime_messages_no_rls`, `user_roles_self_insert`.
- Миграции: ужесточение RLS для `chat_messages`, `user_roles`, `profile_admin_data`; приватизация bucket `chat-attachments`; авторизация в edge-функции `send-webhook`.
- Изменения: `AvatarUpload.tsx`, `AdminUsers.tsx`, `AdminWorkers.tsx`, `supabase/functions/send-webhook/index.ts`.

## SEO
- `index.html`, `PageMeta.tsx`, `Index.tsx`: метатеги, OG/Twitter, canonical.
- `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` обновлены/добавлены.

## UX — Этап 1 (быстрые правки)
- Новый файл `src/lib/constants.ts` (`POSITIONS`, `CUSTOM_POSITION`) — единый источник списка должностей.
- `CreateRequest.tsx`: добавлено поле «Оплата» (`pay`), `min` для дат, CTA «Написать в поддержку» при отсутствии объектов.
- `HRDashboard.tsx`: «Ближайшие заявки» сортируются по `start_date`, добавлены `.limit(500)` и `.limit(5)`.
- `HRSupport.tsx`: статус менеджера → «Обычно отвечаем в течение часа».
- `App.tsx`: удалён дубль `<Sonner />`-тостера.

## UX — Этап 2 (Worker)
- `WorkerResponses`: кнопка «Отменить отклик» для `pending` + `AlertDialog`.
- `WorkerCalendar`: показываются `pending`-смены (синие точки), легенда, бейдж «На рассмотрении».
- `WorkerProfile`: «Предпочитаемые должности» — чип-multiselect из `POSITIONS` вместо свободного текста.
- Bottom-nav для worker: «Главная» первой, «Анкета» ниже.

## UX — Этап 3 (HR)
- `HRRequests`:
  - Кнопка «Дублировать» — открывает `/hr/create-request` с предзаполненным `location.state.duplicate`.
  - Кнопка «Отменить заявку» с `AlertDialog`; статус → `cancelled`, параллельно `pending`/`assigned` отклики → `rejected`.
  - После создания заявки редирект `/hr/requests?highlight=<id>` — строка подсвечивается и автоскроллится; подсветка снимается через 4 с.
- `CreateRequest.tsx` принимает `location.state.duplicate` и автозаполняет поля (без перетирания авто-выбранного объекта).

## UX — Этап 4 (Admin, performance)
- Realtime-подписки `postgres_changes` на таблицу `requests` в `AdminRequests` и `HRRequests` — список обновляется без F5.
- `.limit(500)` на загрузку заявок в `AdminRequests`/`HRRequests`, `.limit(2000)` в отчётах.
- `AdminReports.tsx` переработан:
  - Фильтр по периоду (по умолчанию — 30 дней).
  - 4 KPI-карточки (всего за период, выполнено, активные, исполнителей всего).
  - `BarChart` по дням и `PieChart` по статусам (recharts).
  - Счётчики через `count: 'exact', head: true`.
  - Сохранён CSV-экспорт.

## UX — Этап 5 (стабильность, навигация)
- Новый `src/components/ErrorBoundary.tsx` — глобальная защита от крэшей рендера; кнопки «Попробовать снова»/«На главную». Подключён в `App.tsx`.
- Новый `src/components/admin/InboxTabs.tsx` — общие табы «Чаты поддержки» / «Контактные заявки» с realtime-счётчиками непрочитанных. Подключены в `AdminMessages.tsx` и `AdminContactMessages.tsx`, заголовок объединён в «Входящие».

## База / инфраструктура
- Миграция: `ALTER PUBLICATION supabase_realtime ADD TABLE …` + `REPLICA IDENTITY FULL` для `requests`, `responses`, `chat_messages`, `support_chats`, `contact_messages` — без этого realtime-подписки UI не получали событий.
- Создан тестовый объект «E2E Test Site» с HR-менеджером `hr@gmail.com`.
- Заданы тестовые пароли для `hr@gmail.com` (`TestHR123!`) и `admin@gmail.com` (`TestAdm123!`).

## E2E (sandbox)
Новая директория `e2e-sandbox/` (вне сборки приложения):
- `_helpers.py` — общий `login()`, контексты браузера, тестовые учётки.
- `01_login.py` — вход HR и Admin → попадание на свои дашборды.
- `02_view_requests.py` — список заявок (строки или empty-state).
- `03_open_request_card.py` — открытие диалога «Детали заявки».
- `04_send_message.py` — отправка сообщения в поддержку + проверка появления.
- `05_realtime_hr_to_admin.py` — HR создаёт заявку → Admin видит её без перезагрузки.
- `README.md` — учётки, порядок запуска.
- **Финальный прогон: 5/5 passed.**
