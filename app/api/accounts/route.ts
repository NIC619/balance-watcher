import { env } from "cloudflare:workers";
import { ensureDatabase } from "../../../lib/database";
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
  await ensureDatabase(env.DB);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "create");

    if (action === "delete") {
      await env.DB.prepare("DELETE FROM watched_accounts WHERE id = ?").bind(Number(body.id)).run();
      return Response.json({ ok: true });
    }

    if (action === "duplicate") {
      const id = Number(body.id);
      const network = networkById(Number(body.chainId));
      if (!network) throw new Error("Choose a target network.");
      const source = await env.DB
        .prepare("SELECT name, address, threshold FROM watched_accounts WHERE id = ?")
        .bind(id)
        .first<{ name: string; address: string; threshold: string }>();
      if (!source) throw new Error("Account not found.");
      await env.DB
        .prepare(
          "INSERT INTO watched_accounts (name, address, chain_id, chain_name, symbol, rpc_url, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(source.name, source.address, network.chainId, network.name, network.symbol, network.rpcUrl, source.threshold)
        .run();
      return Response.json({ ok: true });
    }

    const input = accountInput(body);
    if (action === "update") {
      await env.DB
        .prepare(
          "UPDATE watched_accounts SET name = ?, address = ?, chain_id = ?, chain_name = ?, symbol = ?, rpc_url = ?, threshold = ?, status = 'pending', alert_active = 0 WHERE id = ?"
        )
        .bind(
          input.name,
          input.address,
          input.network.chainId,
          input.network.name,
          input.network.symbol,
          input.network.rpcUrl,
          input.threshold,
          Number(body.id)
        )
        .run();
    } else {
      await env.DB
        .prepare(
          "INSERT INTO watched_accounts (name, address, chain_id, chain_name, symbol, rpc_url, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          input.name,
          input.address,
          input.network.chainId,
          input.network.name,
          input.network.symbol,
          input.network.rpcUrl,
          input.threshold
        )
        .run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save account." }, { status: 400 });
  }
}
