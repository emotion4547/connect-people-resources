# E2E sandbox checks (Playwright + Python)

Эти скрипты предназначены для запуска **только внутри Lovable sandbox** (среды
агента). Они дёргают живой preview на `http://localhost:8080` и реальную
проектную базу. В исходники приложения не интегрированы — ничего не ставится в
`package.json`.

## Тестовые учётки

Внутри sandbox были выставлены известные пароли для существующих учёток:

| Роль   | Email             | Пароль        |
|--------|-------------------|---------------|
| HR     | `hr@gmail.com`    | `TestHR123!`  |
| Admin  | `admin@gmail.com` | `TestAdm123!` |

Если нужно их изменить — обнови `auth.users.encrypted_password`
через `crypt('<new>', gen_salt('bf'))`.

## Сценарии

| Файл                            | Что проверяет                                                    |
|---------------------------------|-------------------------------------------------------------------|
| `01_login.py`                   | Логин под HR и под Admin, попадание на соответствующий дашборд   |
| `02_view_requests.py`           | HR видит список заявок на `/hr/requests`                          |
| `03_open_request_card.py`       | HR открывает диалог «Детали заявки»                              |
| `04_send_message.py`            | HR заходит в поддержку и отправляет новое сообщение              |
| `05_realtime_hr_to_admin.py`    | HR создаёт заявку → Admin видит её в `/admin/requests` без F5     |

## Запуск

```bash
cd e2e-sandbox
python3 01_login.py
python3 02_view_requests.py
python3 03_open_request_card.py
python3 04_send_message.py
python3 05_realtime_hr_to_admin.py
```

Скриншоты сохраняются в `e2e-sandbox/screenshots/<scenario>/`.
