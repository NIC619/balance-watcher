import type { PoolClient } from "pg";
import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import {
  ensureDatabase,
  getDb,
  getNetwork,
  type AssetRow,
  type NetworkRow,
  type WalletRow,
} from "../../../lib/database";
import {
  EVM_ADDRESS_PATTERN,
  validateErc20Token,
  type ValidatedToken,
} from "../../../lib/evm";

type AssetInput = {
  id?: number;
  assetType: "native" | "erc20";
  threshold: string;
  tokenAddress: string;
};

type ValidatedAsset = AssetInput & {
  token: ValidatedToken | null;
};

function thresholdValue(value: unknown) {
  const threshold = String(value || "").trim();
  if (!/^\d+(\.\d+)?$/.test(threshold)) {
    throw new Error("Every asset needs a valid non-negative threshold.");
  }
  return threshold;
}

async function walletInput(
  body: Record<string, unknown>,
  network: NetworkRow
) {
  const name = String(body.name || "").trim();
  const address = String(body.address || "").trim().toLowerCase();
  if (!name || name.length > 120) throw new Error("Add a name tag.");
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new Error("Enter a valid 0x EVM address.");
  }
  if (!Array.isArray(body.assets) || body.assets.length === 0) {
    throw new Error("Watch at least one asset.");
  }

  const rawAssets = body.assets as Array<Record<string, unknown>>;
  let nativeCount = 0;
  const seenTokens = new Set<string>();
  const assets = await Promise.all(
    rawAssets.map(async (raw): Promise<ValidatedAsset> => {
      const assetType = raw.assetType === "erc20" ? "erc20" : "native";
      const threshold = thresholdValue(raw.threshold);
      const id = Number(raw.id) > 0 ? Number(raw.id) : undefined;
      if (assetType === "native") {
        nativeCount += 1;
        return { id, assetType, threshold, tokenAddress: "", token: null };
      }

      const tokenAddress = String(raw.tokenAddress || "").trim().toLowerCase();
      if (seenTokens.has(tokenAddress)) {
        throw new Error("The same ERC-20 token cannot be watched twice.");
      }
      seenTokens.add(tokenAddress);
      const token = await validateErc20Token(network.rpc_url, tokenAddress);
      return { id, assetType, threshold, tokenAddress, token };
    })
  );
  if (nativeCount > 1) {
    throw new Error("A wallet can only have one native-token watch.");
  }
  return { name, address, assets };
}

async function insertAsset(
  client: PoolClient,
  walletId: number,
  asset: ValidatedAsset
) {
  await client.query(
    `INSERT INTO watched_assets
      (wallet_id, asset_type, token_address, token_name, token_symbol,
       token_decimals, threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      walletId,
      asset.assetType,
      asset.token?.address || null,
      asset.token?.name || null,
      asset.token?.symbol || null,
      asset.token?.decimals ?? null,
      asset.threshold,
    ]
  );
}

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const pool = getDb();
  await ensureDatabase(pool);

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "save");

    if (action === "delete") {
      await pool.query("DELETE FROM watched_wallets WHERE id = $1", [
        Number(body.id),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "duplicate") {
      const targetNetwork = await getNetwork(Number(body.chainId), pool);
      if (!targetNetwork) throw new Error("Choose a target network.");
      const sourceWallet = await pool.query<WalletRow>(
        "SELECT * FROM watched_wallets WHERE id = $1",
        [Number(body.id)]
      );
      const wallet = sourceWallet.rows[0];
      if (!wallet) throw new Error("Watched wallet not found.");
      const sourceAssets = await pool.query<AssetRow>(
        "SELECT * FROM watched_assets WHERE wallet_id = $1 ORDER BY id",
        [wallet.id]
      );
      const validatedAssets = await Promise.all(
        sourceAssets.rows.map(async (asset): Promise<ValidatedAsset> => {
          const token = asset.asset_type === "erc20"
            ? await validateErc20Token(
                targetNetwork.rpc_url,
                asset.token_address || ""
              )
            : null;
          return {
            assetType: asset.asset_type,
            threshold: asset.threshold,
            tokenAddress: asset.token_address || "",
            token,
          };
        })
      );

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO watched_wallets (name, address, chain_id)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [wallet.name, wallet.address, targetNetwork.chain_id]
        );
        for (const asset of validatedAssets) {
          await insertAsset(client, inserted.rows[0].id, asset);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new Error("This address is already watched on the target network.");
        }
        throw error;
      } finally {
        client.release();
      }
      return Response.json({ ok: true });
    }

    const network = await getNetwork(Number(body.chainId), pool);
    if (!network) throw new Error("Choose a configured network.");
    const input = await walletInput(body, network);
    const walletId = Number(body.id) > 0 ? Number(body.id) : undefined;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      let savedWalletId = walletId;
      if (savedWalletId) {
        const updated = await client.query<{ id: number }>(
          `UPDATE watched_wallets
           SET name = $1, address = $2, chain_id = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4
           RETURNING id`,
          [input.name, input.address, network.chain_id, savedWalletId]
        );
        if (!updated.rows[0]) throw new Error("Watched wallet not found.");
      } else {
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO watched_wallets (name, address, chain_id)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [input.name, input.address, network.chain_id]
        );
        savedWalletId = inserted.rows[0].id;
      }

      const retainedIds = input.assets
        .map((asset) => asset.id)
        .filter((id): id is number => Boolean(id));
      if (retainedIds.length) {
        await client.query(
          `DELETE FROM watched_assets
           WHERE wallet_id = $1 AND NOT (id = ANY($2::int[]))`,
          [savedWalletId, retainedIds]
        );
      } else {
        await client.query(
          "DELETE FROM watched_assets WHERE wallet_id = $1",
          [savedWalletId]
        );
      }

      for (const asset of input.assets) {
        if (!asset.id) {
          await insertAsset(client, savedWalletId, asset);
          continue;
        }
        const updated = await client.query(
          `UPDATE watched_assets
           SET asset_type = $1, token_address = $2, token_name = $3,
               token_symbol = $4, token_decimals = $5, threshold = $6,
               balance = CASE
                 WHEN asset_type = $1
                  AND COALESCE(token_address, '') = COALESCE($2, '')
                 THEN balance ELSE NULL END,
               status = CASE
                 WHEN asset_type = $1
                  AND COALESCE(token_address, '') = COALESCE($2, '')
                 THEN status ELSE 'pending' END,
               alert_active = CASE
                 WHEN asset_type = $1
                  AND COALESCE(token_address, '') = COALESCE($2, '')
                 THEN alert_active ELSE FALSE END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $7 AND wallet_id = $8`,
          [
            asset.assetType,
            asset.token?.address || null,
            asset.token?.name || null,
            asset.token?.symbol || null,
            asset.token?.decimals ?? null,
            asset.threshold,
            asset.id,
            savedWalletId,
          ]
        );
        if (!updated.rowCount) {
          throw new Error("An asset no longer belongs to this wallet.");
        }
      }

      await client.query("COMMIT");
      return Response.json({ ok: true, id: savedWalletId });
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new Error("This address or asset is already being watched.");
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Could not save watched wallet.",
      },
      { status: 400 }
    );
  }
}
