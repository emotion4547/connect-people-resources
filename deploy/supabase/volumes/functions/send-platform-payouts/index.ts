// Отправка реестра выплат на платформу самозанятых (ТЗ, раздел 15, В-5). Платформа выбирается по решению клиента
// (Консоль.Про, Наймикс, Jump.finance, Рокет Ворк — по одной за раз), поэтому функция устроена как набор адаптеров:
// каждый принимает строки реестра и возвращает итог по каждой. Пока платформа не выбрана (PAYOUT_PLATFORM не задан), функция
// честно отвечает, что канал не подключён, и реестр проводится в ручном режиме (выгрузка таблицы и отметка проведения).
//
// Вызывается из интерфейса бухгалтера: нужен вход пользователя с правом на реестры выплат. Реквизиты и ИНН расшифровываются
// в базе служебной ролью и дальше уходят только платформе, в логи не пишутся.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface Line { line_id: string; worker_name: string; requisites: string | null; amount: number; registry_number: string; inn: string | null }
interface Outcome { line_id: string; status: "paid" | "error" | "accepted"; provider_id?: string; receipt?: string; error?: string }

// Песочница для проверки обвязки без реальной платформы: реквизиты, содержащие «ERR», вернут ошибку.
const mock = async (lines: Line[]): Promise<Outcome[]> =>
  lines.map((l) => (l.requisites?.includes("ERR")
    ? { line_id: l.line_id, status: "error", error: "Исполнитель не привязан к платформе" }
    : { line_id: l.line_id, status: "paid", provider_id: `mock-${l.line_id}`, receipt: `https://receipts.example/${l.line_id}` }));

// Адаптеры реальных платформ добавляются сюда: ключ — значение PAYOUT_PLATFORM.
const ADAPTERS: Record<string, (lines: Line[]) => Promise<Outcome[]>> = { mock };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Forbidden" }, 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const registryId = body.registry_id as string | undefined;
  if (!registryId) return json({ error: "Не указан реестр" }, 400);
  const { data: allowed } = await userClient.rpc("platform_send_allowed", { _registry_id: registryId });
  if (allowed !== true) return json({ error: "Недостаточно прав или реестр не готов к отправке" }, 403);

  const provider = Deno.env.get("PAYOUT_PLATFORM") ?? "none";
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    return json({ error: "Платформа самозанятых не подключена. Проведите реестр в ручном режиме: выгрузите таблицу и отметьте строки." }, 501);
  }

  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: lines, error } = await admin.rpc("platform_registry_payload", { _registry_id: registryId });
  if (error) return json({ error: error.message }, 500);

  const outcomes = await adapter((lines ?? []) as Line[]);
  const stats = { paid: 0, error: 0, accepted: 0 };
  for (const o of outcomes) {
    await admin.rpc("platform_record_result", { _line_id: o.line_id, _status: o.status, _provider_id: o.provider_id ?? null, _receipt: o.receipt ?? null, _error: o.error ?? null });
    stats[o.status]++;
  }
  return json({ ok: true, provider, ...stats });
});
