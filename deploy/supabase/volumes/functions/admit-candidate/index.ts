// Допуск кандидата к сменам (ТЗ, раздел 10, Н-9): создаёт учётную запись исполнителя и переносит в неё
// данные кандидата. Закрытый чек-лист проверяет база; здесь только заведение пользователя в GoTrue.
//
// Отправка логина и ссылки по SMS или MAX придёт вместе с уведомлениями (шаг 12), пока функция
// возвращает логин и одноразовую ссылку для установки пароля, и рекрутер передаёт их сам.
// Ссылка даёт вход в учётную запись, поэтому в логи она не пишется.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const WORKER_EMAIL_DOMAIN = "workers.local";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let createdUserId: string | null = null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);
    const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL") ?? supabaseUrl;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { candidate_id } = await req.json();
    if (!candidate_id) return json({ error: "Не указан кандидат" }, 400);

    // Права и чек-лист проверяет база от имени вызывающего: пустой ответ — допускать можно.
    const { data: missing, error: checkErr } = await userClient.rpc("check_admission", { _candidate_id: candidate_id });
    if (checkErr) return json({ error: checkErr.code === "42501" ? "Недостаточно прав" : checkErr.message }, checkErr.code === "42501" ? 403 : 400);
    if (missing && missing.length > 0) {
      return json({ error: "Допуск невозможен, не закрыто: " + missing.map((m: { label: string }) => m.label).join("; ") }, 422);
    }

    const { data: candidate, error: candErr } = await admin.from("candidates").select("full_name, phone, stage").eq("id", candidate_id).single();
    if (candErr || !candidate) return json({ error: "Кандидат не найден" }, 404);
    if (candidate.stage === "admitted") return json({ error: "Кандидат уже допущен" }, 409);

    // Логин из телефона; если такой уже занят, добавляем цифры.
    const digits = String(candidate.phone ?? "").replace(/\D/g, "").slice(-10);
    let login = digits.length >= 10 ? `w${digits}` : `w${Math.floor(100000 + Math.random() * 900000)}`;
    const email = (l: string) => `${l}@${WORKER_EMAIL_DOMAIN}`;
    const { data: existing } = await admin.from("profiles").select("user_id").eq("email", email(login)).maybeSingle();
    if (existing) login = `${login}${Math.floor(10 + Math.random() * 90)}`;

    const tempPassword = crypto.randomUUID() + crypto.randomUUID();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: email(login), password: tempPassword, email_confirm: true,
      user_metadata: { role: "worker", full_name: candidate.full_name, login },
    });
    if (createErr || !created.user) return json({ error: createErr?.message ?? "Не удалось создать учётную запись" }, 400);
    createdUserId = created.user.id;

    // Ссылка готовится до допуска: после переноса документов удалять исполнителя нельзя.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery", email: email(login), options: { redirectTo: `${publicUrl}/set-password` },
    });
    if (linkErr) throw linkErr;

    const { error: admitErr } = await admin.rpc("admit_candidate_internal", {
      _candidate_id: candidate_id, _user_id: createdUserId, _actor: userData.user.id,
    });
    if (admitErr) throw admitErr;

    return json({ success: true, worker_id: createdUserId, login, action_link: link.properties?.action_link ?? null });
  } catch (e: unknown) {
    // Допуск не состоялся: убираем созданную учётную запись, чтобы не оставлять «пустых» исполнителей.
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    console.error("admit-candidate error:", message);
    return json({ error: message }, 500);
  }
});
