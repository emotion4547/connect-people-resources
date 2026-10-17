// Доставка внешних уведомлений (ТЗ, раздел 13). Берёт готовые задания из очереди `notification_outbox`
// (их создаёт база) и отправляет по каналам: MAX, push, email, SMS. Запускается по расписанию (cron) раз в минуту.
//
// Доступ: заголовок x-cron-secret должен совпадать с NOTIFY_CRON_SECRET (функция вызывается сервером, не браузером).
// Ключи (все необязательные: без ключа канал помечается «пропущено» и в ленте системы уведомление остаётся):
//   MAX_BOT_TOKEN       — токен бота MAX; идёт заголовком Authorization (в параметре запроса API его отвергает)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT — web push
//   EMAIL_WEBHOOK_URL   — HTTP-приёмник почты: POST {to, subject, text}; пока нет SMTP, подключается любым сервисом
//   SMS_WEBHOOK_URL     — HTTP-приёмник SMS: POST {phone, text}
//   SITE_URL            — адрес сайта для ссылок в сообщениях
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "npm:web-push@3.6.7";

interface Job {
  id: string; channel: "max" | "push" | "email" | "sms"; user_id: string;
  title: string; body: string | null; link: string | null; address: string | null; attempts: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const text = (j: Job, siteUrl: string) =>
  [j.title, j.body, j.link ? `${siteUrl}${j.link}` : null].filter(Boolean).join("\n");

async function sendMax(j: Job, siteUrl: string): Promise<"sent" | "skipped"> {
  const token = Deno.env.get("MAX_BOT_TOKEN");
  if (!token) return "skipped";
  let ok = false;
  let lastError = "";
  for (const addr of (j.address ?? "").split("\n").filter(Boolean)) {
    // Адрес «chat:123» — групповой чат, просто число — личный диалог с ботом.
    const q = addr.startsWith("chat:") ? `chat_id=${encodeURIComponent(addr.slice(5))}` : `user_id=${encodeURIComponent(addr)}`;
    const r = await fetch(`https://platform-api.max.ru/messages?${q}`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text(j, siteUrl) }),
    });
    if (r.ok) ok = true; else lastError = `MAX ${r.status}`;
  }
  if (!ok) throw new Error(lastError || "нет адреса MAX");
  return "sent";
}

async function sendPush(j: Job, admin: ReturnType<typeof createClient>): Promise<"sent" | "skipped"> {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return "skipped";
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com", pub, priv);
  let ok = false;
  let lastError = "";
  for (const addr of (j.address ?? "").split("\n").filter(Boolean)) {
    try {
      await webpush.sendNotification(JSON.parse(addr), JSON.stringify({ title: j.title, body: j.body, url: j.link ?? "/" }));
      ok = true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      lastError = `push ${status ?? e}`;
      // Подписка удалена в браузере: отключаем, чтобы не слать впустую.
      if (status === 404 || status === 410) {
        await admin.from("notification_contacts").update({ is_active: false }).eq("user_id", j.user_id).eq("channel", "push").eq("address", addr);
      }
    }
  }
  if (!ok) throw new Error(lastError || "нет подписки");
  return "sent";
}

async function sendWebhook(url: string | undefined, payload: Record<string, unknown>): Promise<"sent" | "skipped"> {
  if (!url) return "skipped";
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`webhook ${r.status}`);
  return "sent";
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFY_CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const siteUrl = Deno.env.get("SITE_URL") ?? "";

  // Сначала порождаем события по расписанию (напоминания, сигналы), затем доставляем очередь.
  await admin.rpc("run_notification_jobs_public");

  const { data: jobs, error } = await admin.rpc("claim_outbox", { _limit: 50 });
  if (error) return json({ error: error.message }, 500);

  const stats = { sent: 0, skipped: 0, failed: 0 };
  for (const j of (jobs ?? []) as Job[]) {
    try {
      let result: "sent" | "skipped";
      if (j.channel === "max") result = await sendMax(j, siteUrl);
      else if (j.channel === "push") result = await sendPush(j, admin);
      else if (j.channel === "email") {
        result = await sendWebhook(Deno.env.get("EMAIL_WEBHOOK_URL"), { to: j.address, subject: j.title, text: text(j, siteUrl) });
      } else {
        result = await sendWebhook(Deno.env.get("SMS_WEBHOOK_URL"), { phone: j.address, text: text(j, siteUrl) });
      }
      await admin.rpc("finish_outbox", { _id: j.id, _status: result, _error: result === "skipped" ? "канал не настроен" : null });
      stats[result]++;
    } catch (e) {
      await admin.rpc("finish_outbox", { _id: j.id, _status: "failed", _error: String(e).slice(0, 300) });
      stats.failed++;
    }
  }
  return json({ ok: true, ...stats });
});
