import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import {
  ensureDatabase,
  getDb,
  getNetwork,
} from "../../../lib/database";
import { validateRpcEndpoint } from "../../../lib/evm";
import { defaultNetworkColor } from "../../../lib/networks";

function networkFields(body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const nativeSymbol = String(body.nativeSymbol || "").trim().toUpperCase();
  const environment: "mainnet" | "testnet" =
    body.environment === "testnet" ? "testnet" : "mainnet";
  const colorInput = String(body.color || "").trim();
  if (!name || name.length > 80) {
    throw new Error("Network name must be between 1 and 80 characters.");
  }
  if (!/^[A-Z0-9._-]{1,16}$/.test(nativeSymbol)) {
    throw new Error("Native token symbol must be 1–16 letters or numbers.");
  }
  if (colorInput && !/^#[0-9a-fA-F]{6}$/.test(colorInput)) {
    throw new Error("Choose a valid network color.");
  }
  return { name, nativeSymbol, environment, colorInput };
}

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  const db = getDb();
  await ensureDatabase(db);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "create");

    if (action === "delete") {
      const chainId = Number(body.chainId);
      const network = await getNetwork(chainId, db);
      if (!network) throw new Error("Network not found.");
      if (network.is_preset) {
        throw new Error("Built-in networks can be edited but not deleted.");
      }
      const usage = await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM watched_accounts WHERE chain_id = $1",
        [chainId]
      );
      if (Number(usage.rows[0]?.count || 0) > 0) {
        throw new Error("Remove or move watched accounts before deleting this network.");
      }
      await db.query("DELETE FROM networks WHERE chain_id = $1", [chainId]);
      return Response.json({ ok: true });
    }

    const fields = networkFields(body);
    const validated = await validateRpcEndpoint(String(body.rpcUrl || "").trim());

    if (action === "update") {
      const originalChainId = Number(body.chainId);
      if (validated.chainId !== originalChainId) {
        throw new Error(
          `RPC reports chain ID ${validated.chainId}, expected ${originalChainId}.`
        );
      }
      const existing = await getNetwork(originalChainId, db);
      if (!existing) throw new Error("Network not found.");
      await db.query(
        `UPDATE networks
         SET name = $1, native_symbol = $2, rpc_url = $3, color = $4,
             environment = $5, updated_at = CURRENT_TIMESTAMP
         WHERE chain_id = $6`,
        [
          fields.name,
          fields.nativeSymbol,
          validated.rpcUrl,
          fields.colorInput || existing.color,
          fields.environment,
          originalChainId,
        ]
      );
    } else {
      const existing = await getNetwork(validated.chainId, db);
      if (existing) {
        throw new Error(
          `Chain ID ${validated.chainId} is already configured as ${existing.name}.`
        );
      }
      await db.query(
        `INSERT INTO networks
         (chain_id, name, native_symbol, rpc_url, color, environment)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          validated.chainId,
          fields.name,
          fields.nativeSymbol,
          validated.rpcUrl,
          fields.colorInput ||
            defaultNetworkColor(validated.chainId, fields.environment),
          fields.environment,
        ]
      );
    }

    return Response.json({ ok: true, chainId: validated.chainId });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Could not save network.",
      },
      { status: 400 }
    );
  }
}
