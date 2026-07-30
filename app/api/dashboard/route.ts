import {
  getSettings,
  listAccounts,
  listNetworks,
} from "../../../lib/database";
import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";

export async function GET(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const [accounts, settings, networks] = await Promise.all([
    listAccounts(),
    getSettings(),
    listNetworks(),
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
    networks: networks.map((network) => ({
      chainId: network.chain_id,
      name: network.name,
      nativeSymbol: network.native_symbol,
      rpcUrl: network.rpc_url,
      color: network.color,
      environment: network.environment,
      isPreset: network.is_preset,
    })),
  });
}
