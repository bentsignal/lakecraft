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
      moveY: -1,
      moveZ: 0.8,
      yaw: 1.2,
      pitch: -0.2,
      jump: false,
      sprint: true,
      heldItem: "iron_pickaxe",
    }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.type === "input") {
      expect(decoded.message.heldItem).toBe("iron_pickaxe");
      expect(decoded.message.moveY).toBe(-1);
    }
  });

  test("accepts bounded visual actions and rejects untrusted item/action values", () => {
    expect(decodeClientMessage(JSON.stringify({ v:1, type:"action", seq:2, kind:"swing" }))).toMatchObject({
      ok: true, message: { type: "action", seq: 2, kind: "swing" },
    });
    expect(decodeClientMessage(JSON.stringify({ v:1, type:"action", seq:3, kind:"slot", value:8 })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({ v:1, type:"action", seq:4, kind:"slot", value:9 })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"input", seq:1, dtMs:16, moveX:0, moveZ:0, yaw:0, pitch:0,
      jump:false, sprint:false, heldItem:"constructor",
    })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"input", seq:1, dtMs:16, moveX:0, moveZ:0, yaw:0, pitch:0,
      jump:false, sprint:false, heldItem:"../pickaxe",
    })).ok).toBe(false);
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
      v: 1, type: "input", seq: 1, dtMs: 16, moveX: 0, moveY: -1.1, moveZ: 0,
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

  test("normalizes bounded chat and rejects invalid operation ids", () => {
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "chat_send", operationId: "chat_12345678", message: "  hello\n there  ",
    }))).toEqual({
      ok: true,
      message: { v: 1, type: "chat_send", operationId: "chat_12345678", message: "hello there" },
    });
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "chat_send", operationId: "short", message: "hello",
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "chat_send", operationId: "chat_12345678", message: "x".repeat(181),
    })).ok).toBe(false);
  });
});
