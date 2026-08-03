import { connect, constants } from "node:http2";

export const SUCCINCT_NETWORK_RPC_URL = "https://rpc.mainnet.succinct.xyz";
export const SUCCINCT_EXPLORER_URL = "https://explorer.succinct.xyz";
export const SUCCINCT_TOKEN_DECIMALS = 18;

const BALANCE_RPC_PATH = "/network.ProverNetwork/GetBalance";

function encodeVarint(value: number) {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function decodeVarint(buffer: Buffer, start: number) {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  while (offset < buffer.length) {
    const byte = buffer[offset];
    value += (byte & 0x7f) * multiplier;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, offset };
    multiplier *= 128;
    if (multiplier > Number.MAX_SAFE_INTEGER) break;
  }
  throw new Error("Succinct returned an invalid protobuf value.");
}

function skipField(buffer: Buffer, wireType: number, offset: number) {
  let nextOffset: number;
  if (wireType === 0) nextOffset = decodeVarint(buffer, offset).offset;
  else if (wireType === 1) nextOffset = offset + 8;
  if (wireType === 2) {
    const length = decodeVarint(buffer, offset);
    nextOffset = length.offset + length.value;
  } else if (wireType === 5) {
    nextOffset = offset + 4;
  } else if (wireType !== 0 && wireType !== 1) {
    throw new Error("Succinct returned an unsupported protobuf field.");
  }
  if (nextOffset! > buffer.length) {
    throw new Error("Succinct returned a truncated protobuf value.");
  }
  return nextOffset!;
}

function parseBalanceMessage(message: Buffer) {
  let offset = 0;
  while (offset < message.length) {
    const key = decodeVarint(message, offset);
    offset = key.offset;
    const field = key.value >> 3;
    const wireType = key.value & 0x07;
    if (field === 1 && wireType === 2) {
      const length = decodeVarint(message, offset);
      const end = length.offset + length.value;
      if (end > message.length) break;
      const amount = message.subarray(length.offset, end).toString("utf8");
      if (!/^\d+$/.test(amount)) {
        throw new Error("Succinct returned an invalid balance.");
      }
      return BigInt(amount);
    }
    offset = skipField(message, wireType, offset);
  }
  throw new Error("Succinct did not return a network balance.");
}

export function parseSuccinctBalanceResponse(body: Buffer) {
  let offset = 0;
  let balance: bigint | null = null;
  let grpcStatus: string | null = null;
  while (offset + 5 <= body.length) {
    const flags = body[offset];
    const length = body.readUInt32BE(offset + 1);
    const start = offset + 5;
    const end = start + length;
    if (end > body.length) {
      throw new Error("Succinct returned a truncated response.");
    }
    const frame = body.subarray(start, end);
    if ((flags & 0x80) !== 0) {
      const trailer = frame.toString("utf8");
      grpcStatus = trailer.match(/grpc-status:\s*(\d+)/i)?.[1] || grpcStatus;
    } else if (balance === null) {
      balance = parseBalanceMessage(frame);
    }
    offset = end;
  }
  if (offset !== body.length) {
    throw new Error("Succinct returned a truncated response.");
  }
  if (grpcStatus && grpcStatus !== "0") {
    throw new Error(`Succinct balance request failed with gRPC status ${grpcStatus}.`);
  }
  if (balance === null) {
    throw new Error("Succinct did not return a network balance.");
  }
  return balance;
}

function encodeBalanceRequest(address: string) {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("Enter a valid 0x EVM address.");
  }
  const addressBytes = Buffer.from(normalized, "hex");
  const message = Buffer.concat([
    Buffer.from([0x0a]),
    encodeVarint(addressBytes.length),
    addressBytes,
  ]);
  const frame = Buffer.alloc(5);
  frame.writeUInt32BE(message.length, 1);
  return Buffer.concat([frame, message]);
}

export async function readSuccinctNetworkBalance(address: string) {
  const endpoint = new URL(
    process.env.SUCCINCT_NETWORK_RPC_URL || SUCCINCT_NETWORK_RPC_URL
  );
  if (endpoint.protocol !== "https:") {
    throw new Error("Succinct network RPC must use HTTPS.");
  }

  return new Promise<bigint>((resolve, reject) => {
    const client = connect(endpoint.origin);
    let settled = false;
    const finish = (error?: Error, value?: bigint) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.close();
      if (error) reject(error);
      else resolve(value as bigint);
    };
    const timer = setTimeout(() => {
      finish(new Error("Succinct balance request timed out."));
      client.destroy();
    }, 15_000);

    client.on("error", (error) => finish(error));
    const request = client.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: BALANCE_RPC_PATH,
      [constants.HTTP2_HEADER_SCHEME]: "https",
      [constants.HTTP2_HEADER_AUTHORITY]: endpoint.host,
      "content-type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-user-agent": "grpc-web-javascript/0.1",
    });
    const chunks: Buffer[] = [];
    let status = 0;
    request.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] || 0);
    });
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("error", (error) => finish(error));
    request.on("end", () => {
      if (status !== 200) {
        finish(new Error(`Succinct balance request returned HTTP ${status}.`));
        return;
      }
      try {
        finish(undefined, parseSuccinctBalanceResponse(Buffer.concat(chunks)));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Succinct balance request failed."));
      }
    });
    request.end(encodeBalanceRequest(address));
  });
}
