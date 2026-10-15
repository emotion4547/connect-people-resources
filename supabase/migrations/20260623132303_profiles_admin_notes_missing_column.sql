-- Колонка была добавлена в облачной базе вручную и в миграции не попала;
-- следующая миграция переносит её в profile_admin_data и удаляет. Без этого
-- файла чистая база (самохостинг) не поднимается.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS admin_notes TEXT;
