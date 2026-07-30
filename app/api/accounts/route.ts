import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import { ensureDatabase, getDb } from "../../../lib/database";
import { networkById } from "../../../lib/networks";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function accountInput(value: unknown) {
  const body = value as Record<string, unknown>;
  const name = String(body.name || "").trim();
  const address = String(body.address || "").trim();
  const chainId = Number(body.chainId);
  const threshold = String(body.threshold || "").trim();
  const network = networkById(chainId);
  if (!name) throw new Error("Add a name tag.");
  if (!addressPattern.test(address)) throw new Error("Enter a valid 0x EVM address.");
  if (!network) throw new Error("Choose a supported network.");
  if (!/^\d+(\.\d+)?$/.test(threshold)) throw new Error("Enter a valid threshold.");
  return { name, address: address.toLowerCase(), threshold, network };
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
      const network = networkById(Number(body.chainId));
      if (!network) throw new Error("Choose a target network.");
      const sourceResult = await db.query<{
        name: string;
        address: string;
        threshold: string;
      }>(
        "SELECT name, address, threshold FROM watched_accounts WHERE id = $1",
        [id]
      );
      const source = sourceResult.rows[0];
      if (!source) throw new Error("Account not found.");
      await db.query(
        `INSERT INTO watched_accounts
         (name, address, chain_id, chain_name, symbol, rpc_url, threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          source.name,
          source.address,
          network.chainId,
          network.name,
          network.symbol,
          network.rpcUrl,
          source.threshold,
        ]
      );
      return Response.json({ ok: true });
    }

    const input = accountInput(body);
    if (action === "update") {
      await db.query(
        `UPDATE watched_accounts
         SET name = $1, address = $2, chain_id = $3, chain_name = $4,
             symbol = $5, rpc_url = $6, threshold = $7,
             status = 'pending', alert_active = FALSE
         WHERE id = $8`,
        [
          input.name,
          input.address,
          input.network.chainId,
          input.network.name,
          input.network.symbol,
          input.network.rpcUrl,
          input.threshold,
          Number(body.id),
        ]
      );
    } else {
      await db.query(
        `INSERT INTO watched_accounts
         (name, address, chain_id, chain_name, symbol, rpc_url, threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.name,
          input.address,
          input.network.chainId,
          input.network.name,
          input.network.symbol,
          input.network.rpcUrl,
          input.threshold,
        ]
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save account." }, { status: 400 });
  }
}
