// Проверка статуса самозанятого в ФНС (ТЗ, раздел 15, В-7). Спрашивает открытый сервис «Проверка статуса НПД» по ИНН
// и записывает результат: «действует» или «снят с учёта». Снятого с учёта база блокирует для выплат и заводит задачу рекрутеру.
//
// Вызывается двумя способами:
//   • по расписанию сервера (cron, раз в минуту): заголовок x-cron-secret = NOTIFY_CRON_SECRET, проверяет двух исполнителей за вызов —
//     у сервиса ФНС жёсткое ограничение частоты запросов, поэтому пачки маленькие, а за сутки проходят все;
//   • из интерфейса бухгалтера («Проверить сейчас»): обычный вход пользователя, в теле org_id и worker_ids.
// ИНН расшифровывается только внутри базы функцией для служебной роли и в логи не пишется.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const FNS_URL = "https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let limit = 2;
  let only: string[] | null = null;
  const secret = Deno.env.get("NOTIFY_CRON_SECRET");
  const byCron = !!secret && req.headers.get("x-cron-secret") === secret;

  if (!byCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Forbidden" }, 403);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const orgId = body.org_id as string | undefined;
    const ids = Array.isArray(body.worker_ids) ? (body.worker_ids as string[]).slice(0, 10) : [];
    if (!orgId || !ids.length) return json({ error: "Укажите организацию и исполнителей" }, 400);
    const { data: allowed } = await userClient.rpc("npd_check_allowed", { _org_id: orgId });
    if (allowed !== true) return json({ error: "Недостаточно прав" }, 403);
    // Только исполнители этой организации.
    const { data: own } = await admin.from("workers").select("user_id").eq("org_id", orgId).in("user_id", ids);
    only = ((own ?? []) as { user_id: string }[]).map((w) => w.user_id);
    limit = only.length;
    if (!limit) return json({ checked: 0 });
  }

  const { data: jobs, error } = await admin.rpc("list_npd_checks", { _limit: limit, _only: only });
  if (error) return json({ error: error.message }, 500);

  const result = { active: 0, inactive: 0, failed: 0 };
  for (const j of (jobs ?? []) as { worker_id: string; inn: string }[]) {
    try {
      const r = await fetch(FNS_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inn: j.inn, requestDate: new Date().toISOString().slice(0, 10) }),
      });
      if (r.status === 422 || r.status === 429) { result.failed++; break; } // лимит запросов ФНС: продолжим следующим вызовом
      if (!r.ok) { result.failed++; continue; }
      const data = await r.json();
      const active = data?.status === true;
      await admin.rpc("record_npd_status", { _worker_id: j.worker_id, _status: active ? "active" : "inactive", _message: String(data?.message ?? "").slice(0, 300) });
      if (active) result.active++; else result.inactive++;
    } catch {
      result.failed++;
    }
  }
  return json({ ok: true, ...result });
});
