import {
  requestIsAuthenticated,
  unauthorizedResponse,
} from "../../../../lib/auth";
import { getNetwork } from "../../../../lib/database";
import { validateErc20Token } from "../../../../lib/evm";

export async function POST(request: Request) {
  if (!requestIsAuthenticated(request)) return unauthorizedResponse();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const network = await getNetwork(Number(body.chainId));
    if (!network) throw new Error("Choose a configured network.");
    const token = await validateErc20Token(
      network.rpc_url,
      String(body.tokenAddress || "").trim()
    );
    return Response.json({ token });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Could not validate token.",
      },
      { status: 400 }
    );
  }
}
