import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { NETWORK_PRESETS } from "./networks";

export type WalletRow = {
  id: number;
  name: string;
  address: string;
  chain_id: number;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: number;
  wallet_id: number;
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
  updated_at: string;
};

export type MonitoredAssetRow = AssetRow & {
  name: string;
  address: string;
  chain_id: number;
  chain_name: string;
  symbol: string;
  rpc_url: string;
};

export type WalletWithAssets = WalletRow & {
  assets: AssetRow[];
};

export type NetworkRow = {
  chain_id: number;
  name: string;
  native_symbol: string;
  rpc_url: string;
  explorer_url: string | null;
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
      explorer_url TEXT,
      color TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'mainnet',
      is_preset BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query("ALTER TABLE networks ADD COLUMN IF NOT EXISTS explorer_url TEXT");
  for (const network of NETWORK_PRESETS) {
    await db.query(
      `INSERT INTO networks
       (chain_id, name, native_symbol, rpc_url, explorer_url, color, environment, is_preset)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (chain_id) DO NOTHING`,
      [
        network.chainId,
        network.name,
        network.nativeSymbol,
        network.rpcUrl,
        network.explorerUrl,
        network.color,
        network.environment,
      ]
    );
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS watched_wallets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      chain_id INTEGER NOT NULL REFERENCES networks(chain_id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (chain_id, address)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS watched_assets (
      id SERIAL PRIMARY KEY,
      wallet_id INTEGER NOT NULL REFERENCES watched_wallets(id) ON DELETE CASCADE,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS watched_assets_native_unique
     ON watched_assets (wallet_id) WHERE asset_type = 'native'`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS watched_assets_token_unique
     ON watched_assets (wallet_id, LOWER(token_address))
     WHERE asset_type = 'erc20'`
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS watched_wallets_chain_idx ON watched_wallets (chain_id, name)"
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS watched_assets_wallet_idx ON watched_assets (wallet_id)"
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
    "INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
  );
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const explorerMigration = "preset_explorer_urls_v1";
  const explorerApplied = await db.query<{ applied: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM app_migrations WHERE name = $1) AS applied",
    [explorerMigration]
  );
  if (!explorerApplied.rows[0]?.applied) {
    for (const network of NETWORK_PRESETS) {
      await db.query(
        "UPDATE networks SET explorer_url = $1 WHERE chain_id = $2",
        [network.explorerUrl, network.chainId]
      );
    }
    await db.query(
      "INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
      [explorerMigration]
    );
  }

  const migrationName = "normalize_wallet_assets_v1";
  const migration = await db.query<{ applied: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM app_migrations WHERE name = $1) AS applied",
    [migrationName]
  );
  if (!migration.rows[0]?.applied) {
    const legacy = await db.query<{ exists: boolean }>(
      "SELECT to_regclass('public.watched_accounts') IS NOT NULL AS exists"
    );
    if (legacy.rows[0]?.exists) {
      await db.query(`
        INSERT INTO watched_wallets (name, address, chain_id, created_at)
        SELECT DISTINCT ON (chain_id, LOWER(address))
          name, LOWER(address), chain_id, created_at
        FROM watched_accounts
        ORDER BY chain_id, LOWER(address), id
        ON CONFLICT (chain_id, address) DO NOTHING
      `);
      await db.query(`
        INSERT INTO watched_assets
          (wallet_id, asset_type, token_address, token_name, token_symbol,
           token_decimals, threshold, balance, status, last_checked_at,
           last_alert_at, alert_active, created_at)
        SELECT wallet.id, account.asset_type, LOWER(account.token_address),
               account.token_name, account.token_symbol,
               account.token_decimals, account.threshold, account.balance,
               account.status, account.last_checked_at, account.last_alert_at,
               account.alert_active, account.created_at
        FROM watched_accounts AS account
        JOIN watched_wallets AS wallet
          ON wallet.chain_id = account.chain_id
         AND wallet.address = LOWER(account.address)
        ORDER BY account.id
        ON CONFLICT DO NOTHING
      `);
    }
    await db.query(
      "INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
      [migrationName]
    );
  }
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

export async function listWallets(db: Queryable = getDb()) {
  await ensureDatabase(db);
  const [walletResult, assetResult] = await Promise.all([
    db.query<WalletRow>(
      `SELECT wallet.*
       FROM watched_wallets AS wallet
       JOIN networks AS network ON network.chain_id = wallet.chain_id
       ORDER BY CASE WHEN network.environment = 'mainnet' THEN 0 ELSE 1 END,
                network.name ASC, wallet.name ASC`
    ),
    db.query<AssetRow>(
      `SELECT * FROM watched_assets
       ORDER BY wallet_id,
                CASE WHEN asset_type = 'native' THEN 0 ELSE 1 END,
                token_symbol ASC`
    ),
  ]);
  const assetsByWallet = new Map<number, AssetRow[]>();
  for (const asset of assetResult.rows) {
    const assets = assetsByWallet.get(asset.wallet_id) || [];
    assets.push(asset);
    assetsByWallet.set(asset.wallet_id, assets);
  }
  return walletResult.rows.map((wallet) => ({
    ...wallet,
    assets: assetsByWallet.get(wallet.id) || [],
  }));
}

export async function listMonitoredAssets(db: Queryable = getDb()) {
  await ensureDatabase(db);
  const result = await db.query<MonitoredAssetRow>(
    `SELECT asset.*, wallet.name, wallet.address, wallet.chain_id,
            network.name AS chain_name, network.rpc_url,
            CASE
              WHEN asset.asset_type = 'native' THEN network.native_symbol
              ELSE COALESCE(asset.token_symbol, 'TOKEN')
            END AS symbol
     FROM watched_assets AS asset
     JOIN watched_wallets AS wallet ON wallet.id = asset.wallet_id
     JOIN networks AS network ON network.chain_id = wallet.chain_id
     ORDER BY network.name ASC, wallet.name ASC,
              CASE WHEN asset.asset_type = 'native' THEN 0 ELSE 1 END,
              asset.token_symbol ASC`
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
