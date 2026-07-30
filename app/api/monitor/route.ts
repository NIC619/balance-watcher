import { env } from "cloudflare:workers";
import { runMonitor } from "../../../lib/monitor";

export async function POST() {
  try {
    return Response.json(await runMonitor(env.DB));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Balance check failed." }, { status: 500 });
  }
}
