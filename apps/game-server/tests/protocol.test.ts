import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, SKIN_PIXEL_BYTES, decodeClientMessage, encodeServerMessage } from "../src/protocol";

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
      x: 1.25,
      y: 69.02,
      z: -2.5,
    }));
    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.type === "input") {
      expect(decoded.message.heldItem).toBe("iron_pickaxe");
      expect(decoded.message.moveY).toBe(-1);
      expect(decoded.message.x).toBe(1.25);
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

  test("bounds shared item drops and pickup operations", () => {
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"drop_item", operationId:"drop_12345678", itemId:"diamond_pickaxe", count:1,
      durability:120, ownerMustLeave:true, x:0.5, y:69.02, z:0.5,
    })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"pickup_item", operationId:"pickup_12345678", dropId:"drop:known",
    })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"player_attack", operationId:"attack:12345678", targetId:"player-2",
    })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"self_damage", operationId:"fall:12345678", damage:7, cause:"fall",
    })).ok).toBe(true);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"self_damage", operationId:"fall:12345678", damage:21, cause:"mob",
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"drop_item", operationId:"drop_12345678", itemId:"dirt", count:1,
      ownerMustLeave:"yes", x:0, y:69, z:0,
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"player_attack", operationId:"short", targetId:"",
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"drop_item", operationId:"drop_12345678", itemId:"../bad", count:65, x:0, y:0, z:0,
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v:1, type:"respawn", operationId:"respawn_12345678",
    }))).toMatchObject({ ok:true, message:{ type:"respawn", operationId:"respawn_12345678" } });
  });

  test("accepts only bounded opaque shared inventory actions", () => {
    const requestJson = JSON.stringify({
      operationId: "inventory_place_0001",
      expectedRevision: "1",
      kind: "place_block",
      sourceSlot: 2,
      expectedItemId: "dirt",
    });
    expect(decodeClientMessage(JSON.stringify({ v:1,type:"inventory_action",requestJson }))).toMatchObject({
      ok:true,
      message:{ type:"inventory_action",requestJson },
    });
    expect(decodeClientMessage(JSON.stringify({ v:1,type:"inventory_action",requestJson:"x" }))).toMatchObject({ ok:false });
    expect(decodeClientMessage(JSON.stringify({ v:1,type:"inventory_action",requestJson:"x".repeat(8_192) }))).toMatchObject({ ok:false });
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

  test("accepts only bounded content-addressed skin and exact-slot armor messages", () => {
    const skinPixels = Buffer.alloc(SKIN_PIXEL_BYTES, 7).toString("base64");
    const valid = {
      v: 1, type: "appearance_set", seq: 1,
      appearance: {
        skinId: "a".repeat(64), skinModel: "slim",
        armorHead: "diamond_helmet", armorChest: "iron_chestplate",
        armorLegs: "golden_leggings", armorFeet: "leather_boots",
      },
      skinPixels,
    };
    expect(decodeClientMessage(JSON.stringify(valid))).toMatchObject({
      ok: true, message: { type: "appearance_set", seq: 1, appearance: { skinModel: "slim" } },
    });
    expect(Buffer.byteLength(JSON.stringify(valid))).toBeGreaterThan(16 * 1024);
    expect(Buffer.byteLength(JSON.stringify(valid))).toBeLessThan(32 * 1024);
    expect(decodeClientMessage(JSON.stringify({
      ...valid, appearance: { ...valid.appearance, armorHead: "iron_chestplate" },
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ ...valid, skinPixels: skinPixels.slice(4) })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      ...valid, appearance: { ...valid.appearance, skinId: "default", skinModel: "slim" },
    })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({
      v: 1, type: "appearance_request", userId: "alex", skinId: "a".repeat(64),
    })).ok).toBe(true);
  });
});
