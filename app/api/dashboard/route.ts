import { env } from "cloudflare:workers";
import { getSettings, listAccounts } from "../../../lib/database";
import { NETWORKS } from "../../../lib/networks";

export async function GET() {
  const [accounts, settings] = await Promise.all([listAccounts(env.DB), getSettings(env.DB)]);
  return Response.json({
    accounts,
    settings: settings
      ? {
          telegramBotToken: settings.telegram_bot_token ? "••••••••••••" : "",
          telegramConfigured: Boolean(settings.telegram_bot_token && settings.telegram_chat_id),
          telegramChatId: settings.telegram_chat_id,
          checkIntervalMinutes: settings.check_interval_minutes,
        }
      : null,
    networks: NETWORKS,
  });
}
