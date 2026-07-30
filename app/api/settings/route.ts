import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import { ensureDatabase, getDb, getSettings } from "../../../lib/database";

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const db = getDb();
  await ensureDatabase(db);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const existing = await getSettings(db);
    const suppliedToken = String(body.telegramBotToken || "").trim();
    const token = suppliedToken && suppliedToken !== "••••••••••••"
      ? suppliedToken
      : existing?.telegram_bot_token || "";
    const chatId = String(body.telegramChatId || "").trim();
    const interval = Math.max(1, Math.min(1440, Number(body.checkIntervalMinutes) || 5));

    await db.query(
      `UPDATE app_settings
       SET telegram_bot_token = $1, telegram_chat_id = $2,
           check_interval_minutes = $3, updated_at = $4
       WHERE id = 1`,
      [token, chatId, interval, new Date().toISOString()]
    );

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
