import { NETWORKS } from "./networks";

export type AccountRow = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  symbol: string;
  rpc_url: string;
  threshold: string;
  balance: string | null;
  status: string;
  last_checked_at: string | null;
  last_alert_at: string | null;
  alert_active: number;
  created_at: string;
};

export type SettingsRow = {
  id: number;
  telegram_bot_token: string;
  telegram_chat_id: string;
  check_interval_minutes: number;
  updated_at: string;
};

const accountSchema = `
  CREATE TABLE IF NOT EXISTS watched_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    chain_name TEXT NOT NULL,
    symbol TEXT NOT NULL DEFAULT 'ETH',
    rpc_url TEXT NOT NULL,
    threshold TEXT NOT NULL DEFAULT '0.05',
    balance TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_checked_at TEXT,
    last_alert_at TEXT,
    alert_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const settingsSchema = `
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    telegram_bot_token TEXT NOT NULL DEFAULT '',
    telegram_chat_id TEXT NOT NULL DEFAULT '',
    check_interval_minutes INTEGER NOT NULL DEFAULT 5,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

export async function ensureDatabase(db: D1Database) {
  await db.batch([
    db.prepare(accountSchema),
    db.prepare(settingsSchema),
    db.prepare("CREATE INDEX IF NOT EXISTS watched_accounts_chain_idx ON watched_accounts (chain_id, name)"),
    db.prepare("INSERT OR IGNORE INTO app_settings (id) VALUES (1)"),
  ]);
}

export async function listAccounts(db: D1Database) {
  await ensureDatabase(db);
  await db.batch(
    NETWORKS.map((network) =>
      db
        .prepare(
          "UPDATE watched_accounts SET chain_name = ?, symbol = ?, rpc_url = ? WHERE chain_id = ?"
        )
        .bind(network.name, network.symbol, network.rpcUrl, network.chainId)
    )
  );
  const result = await db
    .prepare("SELECT * FROM watched_accounts ORDER BY chain_name ASC, name ASC")
    .all<AccountRow>();
  return result.results;
}

export async function getSettings(db: D1Database) {
  await ensureDatabase(db);
  return db.prepare("SELECT * FROM app_settings WHERE id = 1").first<SettingsRow>();
}
