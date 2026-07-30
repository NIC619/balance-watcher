import { ensureDatabase, getSettings, listAccounts, type AccountRow } from "./database";

function formatUnits(value: bigint, decimals = 18) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(decimals + 1, "0");
  const integer = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function toScaledInteger(value: string, decimals = 18) {
  const clean = value.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Threshold must be a positive number.");
  const [integer, fraction = ""] = clean.split(".");
  return BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
}

async function readBalance(account: AccountRow) {
  const response = await fetch(account.rpc_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [account.address, "latest"],
    }),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const payload = (await response.json()) as { result?: string; error?: { message?: string } };
  if (!payload.result) throw new Error(payload.error?.message || "RPC returned no balance");
  const wei = BigInt(payload.result);
  return { wei, display: formatUnits(wei) };
}

async function sendTelegram(token: string, chatId: string, account: AccountRow, balance: string) {
  const message = [
    "⚠️ Low balance alert",
    "",
    `Name: ${account.name}`,
    `Address: ${account.address}`,
    `Chain: ${account.chain_name}`,
    `Balance: ${balance} ${account.symbol}`,
    `Threshold: ${account.threshold} ${account.symbol}`,
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
  if (!response.ok) throw new Error("Telegram rejected the alert.");
}

export async function runMonitor(db: D1Database) {
  await ensureDatabase(db);
  const [accounts, settings] = await Promise.all([listAccounts(db), getSettings(db)]);
  let low = 0;
  let checked = 0;
  let failed = 0;
  let notified = 0;

  for (const account of accounts) {
    try {
      const { wei, display } = await readBalance(account);
      const isLow = wei < toScaledInteger(account.threshold);
      if (isLow) low += 1;
      checked += 1;

      let alertActive = account.alert_active;
      let lastAlertAt = account.last_alert_at;
      if (isLow && !account.alert_active && settings?.telegram_bot_token && settings.telegram_chat_id) {
        await sendTelegram(settings.telegram_bot_token, settings.telegram_chat_id, account, display);
        alertActive = 1;
        lastAlertAt = new Date().toISOString();
        notified += 1;
      } else if (!isLow) {
        alertActive = 0;
      }

      await db
        .prepare(
          "UPDATE watched_accounts SET balance = ?, status = ?, last_checked_at = ?, alert_active = ?, last_alert_at = ? WHERE id = ?"
        )
        .bind(display, isLow ? "low" : "healthy", new Date().toISOString(), alertActive, lastAlertAt, account.id)
        .run();
    } catch {
      failed += 1;
      await db
        .prepare("UPDATE watched_accounts SET status = ?, last_checked_at = ? WHERE id = ?")
        .bind("error", new Date().toISOString(), account.id)
        .run();
    }
  }

  return { checked, low, failed, notified };
}
