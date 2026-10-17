-- Этап 1, шаг 3 (часть 1): роли отделов из ТЗ (раздел 2).
-- Значения enum добавляются отдельной миграцией: новое значение нельзя использовать
-- в той же транзакции, где оно добавлено.
--
-- Соответствие ТЗ: director — руководитель, sales — менеджер по продажам,
-- site_manager — менеджер объекта (координатор), recruiter — рекрутер, accountant — бухгалтер,
-- admin — администратор системы (уже есть), client_admin и client_manager — сотрудники заказчика.
-- Роль hr сейчас означает сотрудника заказчика; в шаге 4 такие пользователи станут
-- контактами заказчика с ролью client_admin или client_manager.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'director';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'site_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'recruiter';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client_manager';
