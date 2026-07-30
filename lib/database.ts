import { Pool, type PoolClient, type QueryResultRow } from "pg";
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
  alert_active: boolean;
  created_at: string;
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
    CREATE TABLE IF NOT EXISTS watched_accounts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      chain_name TEXT NOT NULL,
      symbol TEXT NOT NULL DEFAULT 'ETH',
      rpc_url TEXT NOT NULL,
      threshold TEXT NOT NULL DEFAULT '0.05',
      balance TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_checked_at TIMESTAMPTZ,
      last_alert_at TIMESTAMPTZ,
      alert_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
  await Promise.all(
    NETWORKS.map((network) =>
      db.query(
        "UPDATE watched_accounts SET chain_name = $1, symbol = $2, rpc_url = $3 WHERE chain_id = $4",
        [network.name, network.symbol, network.rpcUrl, network.chainId]
      )
    )
  );
  const result = await db.query<AccountRow>(
    "SELECT * FROM watched_accounts ORDER BY chain_name ASC, name ASC"
  );
  return result.rows;
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
