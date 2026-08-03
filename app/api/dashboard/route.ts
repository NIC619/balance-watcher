import {
  getSettings,
  listWallets,
  listNetworks,
} from "../../../lib/database";
import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";

export async function GET(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const [wallets, settings, networks] = await Promise.all([
    listWallets(),
    getSettings(),
    listNetworks(),
  ]);
  return Response.json({
    wallets: wallets.map((wallet) => {
      const network = networks.find(
        (item) => item.chain_id === wallet.chain_id
      );
      return {
        ...wallet,
        chain_name: network?.name || `Chain ${wallet.chain_id}`,
        assets: wallet.assets.map((asset) => ({
          ...asset,
          symbol: asset.asset_type === "native"
            ? network?.native_symbol || "NATIVE"
            : asset.asset_type === "succinct_network"
              ? "PROVE"
              : asset.token_symbol || "TOKEN",
        })),
      };
    }),
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
      explorerUrl: network.explorer_url,
      color: network.color,
      environment: network.environment,
      isPreset: network.is_preset,
    })),
  });
}
