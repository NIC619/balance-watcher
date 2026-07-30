import { getSettings, listAccounts } from "../../../lib/database";
import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import { NETWORKS } from "../../../lib/networks";

export async function GET(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const [accounts, settings] = await Promise.all([
    listAccounts(),
    getSettings(),
  ]);
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
