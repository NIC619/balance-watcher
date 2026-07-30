export const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

type RpcPayload<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

function normalizeRpcUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid RPC URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("RPC URL must use http:// or https://.");
  }
  return url.toString();
}

export async function rpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[]
) {
  const response = await fetch(normalizeRpcUrl(rpcUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`RPC returned HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as RpcPayload<T>;
  if (payload.error) {
    throw new Error(payload.error.message || `RPC ${method} failed.`);
  }
  if (payload.result === undefined || payload.result === null) {
    throw new Error(`RPC returned no result for ${method}.`);
  }
  return payload.result;
}

export async function validateRpcEndpoint(rpcUrl: string) {
  const normalizedUrl = normalizeRpcUrl(rpcUrl);
  const value = await rpcRequest<string>(normalizedUrl, "eth_chainId", []);
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("RPC returned an invalid chain ID.");
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > 2_147_483_647n) {
    throw new Error("RPC chain ID is outside the supported range.");
  }
  return { chainId: Number(parsed), rpcUrl: normalizedUrl };
}

function callDataAddress(selector: string, address: string) {
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    throw new Error("Enter a valid 0x EVM address.");
  }
  return `${selector}${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

async function ethCall(rpcUrl: string, to: string, data: string) {
  return rpcRequest<string>(rpcUrl, "eth_call", [{ to, data }, "latest"]);
}

function decodeUint(value: string, field: string) {
  if (!/^0x[0-9a-fA-F]{64,}$/.test(value)) {
    throw new Error(`Token returned an invalid ${field} value.`);
  }
  return BigInt(value);
}

function decodeText(value: string) {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) return "";
  const hex = value.slice(2);
  if (hex.length < 64 || hex.length % 2 !== 0) return "";
  const bytes = Buffer.from(hex, "hex");

  // Some older tokens return bytes32 instead of an ABI string.
  if (bytes.length === 32) {
    return bytes.toString("utf8").replace(/\0+$/, "").trim();
  }

  try {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 32 > bytes.length) {
      return "";
    }
    const lengthStart = offset * 2;
    const length = Number(BigInt(`0x${hex.slice(lengthStart, lengthStart + 64)}`));
    if (!Number.isSafeInteger(length) || length < 0 || length > 4096) return "";
    const start = offset + 32;
    if (start + length > bytes.length) return "";
    return bytes.subarray(start, start + length).toString("utf8").trim();
  } catch {
    return "";
  }
}

export type ValidatedToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

export async function validateErc20Token(
  rpcUrl: string,
  tokenAddress: string
): Promise<ValidatedToken> {
  if (!EVM_ADDRESS_PATTERN.test(tokenAddress)) {
    throw new Error("Enter a valid ERC-20 token address.");
  }
  const address = tokenAddress.toLowerCase();
  const code = await rpcRequest<string>(rpcUrl, "eth_getCode", [
    address,
    "latest",
  ]);
  if (!code || code === "0x" || code === "0x0") {
    throw new Error("Token address has no contract code on this network.");
  }

  // totalSupply() and balanceOf(address) are required ERC-20 read methods.
  await Promise.all([
    ethCall(rpcUrl, address, "0x18160ddd").then((value) =>
      decodeUint(value, "totalSupply()")
    ),
    ethCall(
      rpcUrl,
      address,
      callDataAddress("0x70a08231", "0x0000000000000000000000000000000000000000")
    ).then((value) => decodeUint(value, "balanceOf()")),
  ]);

  const decimalsValue = await ethCall(rpcUrl, address, "0x313ce567");
  const decimalsBigInt = decodeUint(decimalsValue, "decimals()");
  if (decimalsBigInt > 255n) {
    throw new Error("Token decimals are outside the ERC-20 uint8 range.");
  }

  const [symbolValue, nameValue] = await Promise.all([
    ethCall(rpcUrl, address, "0x95d89b41").catch(() => ""),
    ethCall(rpcUrl, address, "0x06fdde03").catch(() => ""),
  ]);
  const symbol = decodeText(symbolValue).slice(0, 24) || "TOKEN";
  const name = decodeText(nameValue).slice(0, 120) || symbol;

  return {
    address,
    name,
    symbol,
    decimals: Number(decimalsBigInt),
  };
}

export async function readNativeBalance(rpcUrl: string, accountAddress: string) {
  const result = await rpcRequest<string>(rpcUrl, "eth_getBalance", [
    accountAddress,
    "latest",
  ]);
  return BigInt(result);
}

export async function readErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  accountAddress: string
) {
  const result = await ethCall(
    rpcUrl,
    tokenAddress,
    callDataAddress("0x70a08231", accountAddress)
  );
  return decodeUint(result, "balanceOf()");
}
