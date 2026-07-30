import assert from "node:assert/strict";
import test from "node:test";
import {
  validateErc20Token,
  validateRpcEndpoint,
} from "../lib/evm";

function uintWord(value: bigint | number) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodedString(value: string) {
  const encoded = Buffer.from(value, "utf8").toString("hex");
  return `0x${uintWord(32)}${uintWord(encoded.length / 2)}${encoded.padEnd(
    Math.ceil(encoded.length / 64) * 64,
    "0"
  )}`;
}

function rpcResponse(result: string) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("validates an EVM RPC and derives its chain ID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => rpcResponse("0x89");
  try {
    assert.deepEqual(
      await validateRpcEndpoint("https://rpc.example"),
      { chainId: 137, rpcUrl: "https://rpc.example/" }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates and decodes ERC-20 contract metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: Array<{ data?: string } | string>;
    };
    if (body.method === "eth_getCode") return rpcResponse("0x60016000");
    const data = (body.params[0] as { data: string }).data;
    if (data === "0x18160ddd") return rpcResponse(`0x${uintWord(1_000_000n)}`);
    if (data.startsWith("0x70a08231")) return rpcResponse(`0x${uintWord(0)}`);
    if (data === "0x313ce567") return rpcResponse(`0x${uintWord(6)}`);
    if (data === "0x95d89b41") return rpcResponse(encodedString("USDC"));
    if (data === "0x06fdde03") return rpcResponse(encodedString("USD Coin"));
    throw new Error(`Unexpected call data: ${data}`);
  };

  try {
    assert.deepEqual(
      await validateErc20Token(
        "https://rpc.example",
        "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
      ),
      {
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an address without contract code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => rpcResponse("0x");
  try {
    await assert.rejects(
      validateErc20Token(
        "https://rpc.example",
        "0x0000000000000000000000000000000000000001"
      ),
      /no contract code/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
