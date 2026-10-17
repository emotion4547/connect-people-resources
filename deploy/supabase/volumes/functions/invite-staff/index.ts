// Заведение сотрудника администратором организации (ТЗ, раздел 6, А-3).
//
// Почтового сервера на сервере пока нет (раздел 21), поэтому письмо с приглашением
// не отправляется: функция создаёт учётную запись и возвращает одноразовую ссылку
// для установки пароля, которую администратор передаёт сотруднику сам.
// Когда появится SMTP, достаточно заменить generateLink на inviteUserByEmail.
//
// Ссылка даёт вход в учётную запись, поэтому в логи она не пишется, а в ответе
// возвращается только вызвавшему администратору.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STAFF_ROLES = ["director", "sales", "site_manager", "recruiter", "accountant", "admin"];
const DEPARTMENTS = ["management", "sales", "sites", "hiring", "accounting", "admin"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicUrl = Deno.env.get("SUPABASE_PUBLIC_URL") ?? supabaseUrl;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const { org_id, email, full_name, department, roles, job_title, phone } = await req.json();

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return json({ error: "Укажите корректный email" }, 400);
    if (!full_name || String(full_name).trim().length === 0) return json({ error: "Укажите ФИО" }, 400);
    if (!DEPARTMENTS.includes(department)) return json({ error: "Неизвестный отдел" }, 400);
    if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => STAFF_ROLES.includes(r))) {
      return json({ error: "Укажите хотя бы одну роль из списка ролей сотрудников" }, 400);
    }
    if (!org_id) return json({ error: "Не указана организация" }, 400);

    const { data: mfaOk, error: mfaErr } = await userClient.rpc('session_mfa_ok', { _org_id: org_id });
    if (mfaErr || mfaOk !== true) return json({ error: 'Подтвердите двухфакторный вход' }, 403);

    const admin = createClient(supabaseUrl, serviceKey);

    // Вызывающий должен быть действующим администратором именно этой организации.
    const { data: callerRole } = await admin
      .from("user_roles").select("role").eq("user_id", callerId).eq("org_id", org_id).eq("role", "admin").maybeSingle();
    const { data: callerStaff } = await admin
      .from("staff_profiles").select("is_active").eq("user_id", callerId).maybeSingle();
    if (!callerRole || callerStaff?.is_active === false) return json({ error: "Forbidden: admin of this organization only" }, 403);

    // Сотрудник мог уже работать в другой организации: тогда учётную запись не создаём.
    const { data: existing } = await admin.from("profiles").select("user_id").eq("email", cleanEmail).maybeSingle();
    let userId: string;
    let created = false;
    let actionLink: string | null = null;

    if (existing) {
      // Учётную запись исполнителя или заказчика сотрудником не делаем: у них другие права и данные.
      const { data: existingRoles } = await admin.from("user_roles").select("role").eq("user_id", existing.user_id);
      if ((existingRoles ?? []).some((r) => ["worker", "hr", "client_admin", "client_manager"].includes(r.role))) {
        return json({ error: "Этот email уже занят исполнителем или заказчиком" }, 409);
      }
      userId = existing.user_id;
    } else {
      const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
        email: cleanEmail,
        email_confirm: true,
        user_metadata: { full_name: String(full_name).trim(), staff: true },
      });
      if (createErr || !createdUser.user) return json({ error: createErr?.message ?? "Не удалось создать пользователя" }, 400);
      userId = createdUser.user.id;
      created = true;
      // Регистрационный триггер выдаёт каждому новому пользователю роль исполнителя,
      // сотруднику она не нужна.
      await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "worker");
    }

    // Сначала роли, потом профиль: запись журнала профиля привязывается к организациям по ролям.
    const { error: rolesErr } = await admin.from("user_roles").upsert(
      roles.map((role: string) => ({ user_id: userId, role, org_id })),
      { onConflict: "user_id,role,org_id", ignoreDuplicates: true },
    );
    if (rolesErr) throw rolesErr;

    const { error: profileErr } = await admin.from("staff_profiles").upsert({
      user_id: userId,
      full_name: String(full_name).trim(),
      department,
      job_title: job_title ? String(job_title).trim() : null,
      phone: phone ? String(phone).trim() : null,
    }, { onConflict: "user_id" });
    if (profileErr) throw profileErr;

    if (created) {
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: cleanEmail,
        options: { redirectTo: `${publicUrl}/set-password` },
      });
      if (linkErr) throw linkErr;
      actionLink = link.properties?.action_link ?? null;
    }

    return json({ success: true, user_id: userId, created, action_link: actionLink });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("invite-staff error:", message);
    return json({ error: message }, 500);
  }
});
