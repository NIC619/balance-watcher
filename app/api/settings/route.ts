import { env } from "cloudflare:workers";
import { ensureDatabase, getSettings } from "../../../lib/database";

export async function POST(request: Request) {
  await ensureDatabase(env.DB);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const existing = await getSettings(env.DB);
    const suppliedToken = String(body.telegramBotToken || "").trim();
    const token = suppliedToken && suppliedToken !== "••••••••••••"
      ? suppliedToken
      : existing?.telegram_bot_token || "";
    const chatId = String(body.telegramChatId || "").trim();
    const interval = Math.max(1, Math.min(1440, Number(body.checkIntervalMinutes) || 5));

    await env.DB
      .prepare(
        "UPDATE app_settings SET telegram_bot_token = ?, telegram_chat_id = ?, check_interval_minutes = ?, updated_at = ? WHERE id = 1"
      )
      .bind(token, chatId, interval, new Date().toISOString())
      .run();

    if (body.sendTest === true) {
      if (!token || !chatId) throw new Error("Add a bot token and chat ID first.");
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "✅ Watchtower is connected.\n\nYou’ll receive an alert here when a monitored account drops below its threshold.",
        }),
      });
      if (!response.ok) throw new Error("Telegram could not deliver the test message. Check the token and chat ID.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 400 });
  }
}
