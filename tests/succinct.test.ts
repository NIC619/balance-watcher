import assert from "node:assert/strict";
import test from "node:test";
import { parseSuccinctBalanceResponse } from "../lib/succinct";

function frame(flags: number, payload: Buffer) {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

test("decodes a Succinct network balance from a gRPC-Web response", () => {
  const amount = "16147744998836694532";
  const encodedAmount = Buffer.from(amount, "utf8");
  const message = Buffer.concat([
    Buffer.from([0x0a, encodedAmount.length]),
    encodedAmount,
  ]);
  const response = Buffer.concat([
    frame(0, message),
    frame(0x80, Buffer.from("grpc-status: 0\r\n", "utf8")),
  ]);

  assert.equal(parseSuccinctBalanceResponse(response), 16147744998836694532n);
});

test("rejects a failed Succinct gRPC-Web response", () => {
  const response = frame(
    0x80,
    Buffer.from("grpc-status: 5\r\ngrpc-message: not found\r\n", "utf8")
  );
  assert.throws(
    () => parseSuccinctBalanceResponse(response),
    /gRPC status 5/
  );
});

test("rejects a truncated Succinct gRPC-Web frame", () => {
  assert.throws(
    () => parseSuccinctBalanceResponse(Buffer.from([0, 0, 0, 0, 4, 0x0a])),
    /truncated response/
  );
});
