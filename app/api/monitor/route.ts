import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../lib/auth";
import { runMonitor } from "../../../lib/monitor";

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  try {
    return Response.json(await runMonitor());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Balance check failed." }, { status: 500 });
  }
}
