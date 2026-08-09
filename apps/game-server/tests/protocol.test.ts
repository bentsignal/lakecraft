import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, decodeClientMessage, encodeServerMessage } from "../src/protocol";

describe("protocol v1", () => {
  test("accepts normalized movement inputs", () => {
    const decoded = decodeClientMessage(JSON.stringify({
      v: 1,
      type: "input",
      seq: 4,
      dtMs: 16.7,
      moveX: 0.6,
      moveZ: 0.8,
      yaw: 1.2,
      pitch: -0.2,
      jump: false,
      sprint: true,
    }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.message.type).toBe("input");
  });

  test("rejects version mismatches, oversized axes, and invalid block ids", () => {
    expect(decodeClientMessage('{"v":2,"type":"ping","t":0}')).toMatchObject({
      ok: false,
      code: "unsupported_version",
    });
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "input", seq: 1, dtMs: 16, moveX: 1, moveZ: 1,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "block_edit", operationId: "a", seq: 1, x: 0, y: 72, z: 0, block: 34,
    })).ok).toBe(false);
  });

  test("server messages retain explicit protocol version", () => {
    const encoded = encodeServerMessage({ v: PROTOCOL_VERSION, type: "pong", t: 1, serverTime: 2 });
    expect(JSON.parse(encoded)).toEqual({ v: 1, type: "pong", t: 1, serverTime: 2 });
  });
});
