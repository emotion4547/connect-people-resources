import { supabase } from '@/integrations/supabase/client';

// Таблицы и функции шагов 1–3 появились после генерации src/integrations/supabase/types.ts.
// Пока типы не перегенерированы, обращение к ним идёт через этот помощник. После перегенерации
// типов (supabase gen types) его можно убрать и вернуть обычный supabase.from(...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = supabase as any;

export const db = (table: string) => raw.from(table);
export const rpc = (fn: string, args?: Record<string, unknown>) => raw.rpc(fn, args);
export const invokeFunction = (name: string, body: Record<string, unknown>) =>
  raw.functions.invoke(name, { body });
