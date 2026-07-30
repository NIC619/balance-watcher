import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import {
  ensureDatabase,
  getDb,
  getNetwork,
  type AccountRow,
  type NetworkRow,
} from "../../../lib/database";
import {
  EVM_ADDRESS_PATTERN,
  validateErc20Token,
  type ValidatedToken,
} from "../../../lib/evm";

async function accountInput(
  value: unknown,
  db: ReturnType<typeof getDb>
) {
  const body = value as Record<string, unknown>;
  const name = String(body.name || "").trim();
  const address = String(body.address || "").trim();
  const chainId = Number(body.chainId);
  const threshold = String(body.threshold || "").trim();
  const assetType = body.assetType === "erc20" ? "erc20" : "native";
  const network = await getNetwork(chainId, db);
  if (!name) throw new Error("Add a name tag.");
  if (!EVM_ADDRESS_PATTERN.test(address)) throw new Error("Enter a valid 0x EVM address.");
  if (!network) throw new Error("Choose a supported network.");
  if (!/^\d+(\.\d+)?$/.test(threshold)) throw new Error("Enter a valid threshold.");
  const token = assetType === "erc20"
    ? await validateErc20Token(
        network.rpc_url,
        String(body.tokenAddress || "").trim()
      )
    : null;
  return {
    name,
    address: address.toLowerCase(),
    threshold,
    assetType,
    network,
    token,
  };
}

function assetValues(network: NetworkRow, token: ValidatedToken | null) {
  return {
    symbol: token?.symbol || network.native_symbol,
    tokenAddress: token?.address || null,
    tokenName: token?.name || null,
    tokenSymbol: token?.symbol || null,
    tokenDecimals: token?.decimals ?? null,
  };
}

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const db = getDb();
  await ensureDatabase(db);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "create");

    if (action === "delete") {
      await db.query("DELETE FROM watched_accounts WHERE id = $1", [
        Number(body.id),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "duplicate") {
      const id = Number(body.id);
      const network = await getNetwork(Number(body.chainId), db);
      if (!network) throw new Error("Choose a target network.");
      const sourceResult = await db.query<AccountRow>(
        "SELECT * FROM watched_accounts WHERE id = $1",
        [id]
      );
      const source = sourceResult.rows[0];
      if (!source) throw new Error("Account not found.");
      const token = source.asset_type === "erc20"
        ? await validateErc20Token(
            network.rpc_url,
            source.token_address || ""
          )
        : null;
      const asset = assetValues(network, token);
      await db.query(
        `INSERT INTO watched_accounts
         (name, address, chain_id, chain_name, symbol, rpc_url, threshold,
          asset_type, token_address, token_name, token_symbol, token_decimals)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          source.name,
          source.address,
          network.chain_id,
          network.name,
          asset.symbol,
          network.rpc_url,
          source.threshold,
          source.asset_type,
          asset.tokenAddress,
          asset.tokenName,
          asset.tokenSymbol,
          asset.tokenDecimals,
        ]
      );
      return Response.json({ ok: true });
    }

    const input = await accountInput(body, db);
    const asset = assetValues(input.network, input.token);
    if (action === "update") {
      await db.query(
        `UPDATE watched_accounts
         SET name = $1, address = $2, chain_id = $3, chain_name = $4,
             symbol = $5, rpc_url = $6, threshold = $7,
             asset_type = $8, token_address = $9, token_name = $10,
             token_symbol = $11, token_decimals = $12,
             balance = NULL, status = 'pending', alert_active = FALSE
         WHERE id = $13`,
        [
          input.name,
          input.address,
          input.network.chain_id,
          input.network.name,
          asset.symbol,
          input.network.rpc_url,
          input.threshold,
          input.assetType,
          asset.tokenAddress,
          asset.tokenName,
          asset.tokenSymbol,
          asset.tokenDecimals,
          Number(body.id),
        ]
      );
    } else {
      await db.query(
        `INSERT INTO watched_accounts
         (name, address, chain_id, chain_name, symbol, rpc_url, threshold,
          asset_type, token_address, token_name, token_symbol, token_decimals)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          input.name,
          input.address,
          input.network.chain_id,
          input.network.name,
          asset.symbol,
          input.network.rpc_url,
          input.threshold,
          input.assetType,
          asset.tokenAddress,
          asset.tokenName,
          asset.tokenSymbol,
          asset.tokenDecimals,
        ]
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save account." }, { status: 400 });
  }
}
