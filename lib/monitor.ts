import {
  ensureDatabase,
  getDb,
  getSettings,
  listAccounts,
  type AccountRow,
} from "./database";
import { readErc20Balance, readNativeBalance } from "./evm";

const MONITOR_LOCK_ID = 8_207_331;

function formatUnits(value: bigint, decimals = 18) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  if (decimals === 0) return `${negative ? "-" : ""}${absolute}`;
  const raw = absolute.toString().padStart(decimals + 1, "0");
  const integer = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "").slice(0, 8);
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function toScaledInteger(value: string, decimals = 18) {
  const clean = value.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) {
    throw new Error("Threshold must be a positive number.");
  }
  const [integer, fraction = ""] = clean.split(".");
  if (decimals === 0) return BigInt(integer);
  return (
    BigInt(integer) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
}

async function readBalance(account: AccountRow) {
  const decimals = account.asset_type === "erc20"
    ? account.token_decimals
    : 18;
  if (decimals === null) {
    throw new Error("ERC-20 token decimals are missing.");
  }
  const raw = account.asset_type === "erc20"
    ? await readErc20Balance(
        account.rpc_url,
        account.token_address || "",
        account.address
      )
    : await readNativeBalance(account.rpc_url, account.address);
  return { raw, decimals, display: formatUnits(raw, decimals) };
}

async function sendTelegram(
  token: string,
  chatId: string,
  account: AccountRow,
  balance: string
) {
  const message = [
    "⚠️ Low balance alert",
    "",
    `Name: ${account.name}`,
    `Address: ${account.address}`,
    `Chain: ${account.chain_name}`,
    ...(account.asset_type === "erc20"
      ? [
          `Token: ${account.token_name || account.symbol} (${account.symbol})`,
          `Contract: ${account.token_address}`,
        ]
      : []),
    `Balance: ${balance} ${account.symbol}`,
    `Threshold: ${account.threshold} ${account.symbol}`,
  ].join("\n");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) throw new Error("Telegram rejected the alert.");
}

export async function runMonitor() {
  const pool = getDb();
  const client = await pool.connect();
  let locked = false;

  try {
    await ensureDatabase(client);
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [MONITOR_LOCK_ID]
    );
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) {
      return { checked: 0, low: 0, failed: 0, notified: 0, skipped: true };
    }

    const [accounts, settings] = await Promise.all([
      listAccounts(client),
      getSettings(client),
    ]);
    let low = 0;
    let checked = 0;
    let failed = 0;
    let notified = 0;

    for (const account of accounts) {
      try {
        const { raw, decimals, display } = await readBalance(account);
        const isLow = raw < toScaledInteger(account.threshold, decimals);
        if (isLow) low += 1;
        checked += 1;

        let alertActive = account.alert_active;
        let lastAlertAt = account.last_alert_at;
        if (
          isLow &&
          !account.alert_active &&
          settings?.telegram_bot_token &&
          settings.telegram_chat_id
        ) {
          await sendTelegram(
            settings.telegram_bot_token,
            settings.telegram_chat_id,
            account,
            display
          );
          alertActive = true;
          lastAlertAt = new Date().toISOString();
          notified += 1;
        } else if (!isLow) {
          alertActive = false;
        }

        await client.query(
          `UPDATE watched_accounts
           SET balance = $1, status = $2, last_checked_at = $3,
               alert_active = $4, last_alert_at = $5
           WHERE id = $6`,
          [
            display,
            isLow ? "low" : "healthy",
            new Date().toISOString(),
            alertActive,
            lastAlertAt,
            account.id,
          ]
        );
      } catch (error) {
        failed += 1;
        console.error(`Balance check failed for account ${account.id}:`, error);
        await client.query(
          "UPDATE watched_accounts SET status = $1, last_checked_at = $2 WHERE id = $3",
          ["error", new Date().toISOString(), account.id]
        );
      }
    }

    return { checked, low, failed, notified, skipped: false };
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [MONITOR_LOCK_ID]);
    }
    client.release();
  }
}
