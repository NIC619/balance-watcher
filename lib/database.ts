import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { NETWORK_PRESETS } from "./networks";

export type AccountRow = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  symbol: string;
  rpc_url: string;
  asset_type: "native" | "erc20";
  token_address: string | null;
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  threshold: string;
  balance: string | null;
  status: string;
  last_checked_at: string | null;
  last_alert_at: string | null;
  alert_active: boolean;
  created_at: string;
};

export type NetworkRow = {
  chain_id: number;
  name: string;
  native_symbol: string;
  rpc_url: string;
  color: string;
  environment: "mainnet" | "testnet";
  is_preset: boolean;
  created_at: string;
  updated_at: string;
};

export type SettingsRow = {
  id: number;
  telegram_bot_token: string;
  telegram_chat_id: string;
  check_interval_minutes: number;
  updated_at: string;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

declare global {
  var watchtowerPool: Pool | undefined;
  var watchtowerSchemaPromise: Promise<void> | undefined;
}

export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!global.watchtowerPool) {
    global.watchtowerPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return global.watchtowerPool;
}

async function initializeSchema(db: Queryable) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS networks (
      chain_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      native_symbol TEXT NOT NULL,
      rpc_url TEXT NOT NULL,
      color TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'mainnet',
      is_preset BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  for (const network of NETWORK_PRESETS) {
    await db.query(
      `INSERT INTO networks
       (chain_id, name, native_symbol, rpc_url, color, environment, is_preset)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (chain_id) DO NOTHING`,
      [
        network.chainId,
        network.name,
        network.nativeSymbol,
        network.rpcUrl,
        network.color,
        network.environment,
      ]
    );
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS watched_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      chain_name TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT 'ETH',
      rpc_url TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'native',
      token_address TEXT,
      token_name TEXT,
      token_symbol TEXT,
      token_decimals INTEGER,
      threshold TEXT NOT NULL DEFAULT '0.05',
      balance TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_checked_at TIMESTAMPTZ,
      last_alert_at TIMESTAMPTZ,
      alert_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    "ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'native'"
  );
  await db.query(
    "ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS token_address TEXT"
  );
  await db.query(
    "ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS token_name TEXT"
  );
  await db.query(
    "ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS token_symbol TEXT"
  );
  await db.query(
    "ALTER TABLE watched_accounts ADD COLUMN IF NOT EXISTS token_decimals INTEGER"
  );
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      telegram_bot_token TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      check_interval_minutes INTEGER NOT NULL DEFAULT 5,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    "CREATE INDEX IF NOT EXISTS watched_accounts_chain_idx ON watched_accounts (chain_id, name)"
  );
  await db.query(
    "INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
  );
}

export async function ensureDatabase(db: Queryable = getDb()) {
  if (!global.watchtowerSchemaPromise) {
    global.watchtowerSchemaPromise = initializeSchema(db).catch((error) => {
      global.watchtowerSchemaPromise = undefined;
      throw error;
    });
  }
  await global.watchtowerSchemaPromise;
}

export async function listAccounts(db: Queryable = getDb()) {
  await ensureDatabase(db);
  await db.query(`
    UPDATE watched_accounts AS account
    SET chain_name = network.name,
        rpc_url = network.rpc_url,
        symbol = CASE
          WHEN account.asset_type = 'native' THEN network.native_symbol
          ELSE COALESCE(account.token_symbol, account.symbol)
        END
    FROM networks AS network
    WHERE account.chain_id = network.chain_id
  `);
  const result = await db.query<AccountRow>(
    "SELECT * FROM watched_accounts ORDER BY chain_name ASC, name ASC"
  );
  return result.rows;
}

export async function listNetworks(db: Queryable = getDb()) {
  await ensureDatabase(db);
  const result = await db.query<NetworkRow>(
    `SELECT * FROM networks
     ORDER BY CASE WHEN environment = 'mainnet' THEN 0 ELSE 1 END, name ASC`
  );
  return result.rows;
}

export async function getNetwork(
  chainId: number,
  db: Queryable = getDb()
) {
  await ensureDatabase(db);
  return queryOne<NetworkRow>(
    "SELECT * FROM networks WHERE chain_id = $1",
    [chainId],
    db
  );
}

export async function getSettings(db: Queryable = getDb()) {
  await ensureDatabase(db);
  const result = await db.query<SettingsRow>(
    "SELECT * FROM app_settings WHERE id = 1"
  );
  return result.rows[0] || null;
}

export async function closeDb() {
  if (global.watchtowerPool) {
    await global.watchtowerPool.end();
    global.watchtowerPool = undefined;
    global.watchtowerSchemaPromise = undefined;
  }
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: Queryable = getDb()
) {
  const result = await db.query<T>(sql, values);
  return result.rows[0] || null;
}
