import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { WorldStore } from "../src/database";
import { countItem } from "../../../shared/game.ts";
import { validatePlayerStateJson } from "../../../shared/chestTransfers.ts";

const paths: string[] = [];

afterEach(async () => {
  for (const path of paths.splice(0)) {
    await Bun.file(path).delete().catch(() => {});
    await Bun.file(`${path}-wal`).delete().catch(() => {});
    await Bun.file(`${path}-shm`).delete().catch(() => {});
  }
});

describe("SQLite world persistence", () => {
  test("persists and replays the shared inventory state machine without Lakebed gameplay writes", () => {
    const store = new WorldStore(":memory:");
    const initial = store.ensurePlayerInventory("alex", undefined, 1_000);
    const initialState = validatePlayerStateJson(initial.inventoryJson);
    expect(initialState.ok && countItem(initialState.state.inventory, "dirt")).toBe(16);

    const placeRequest = JSON.stringify({
      operationId:"inventory_place_0001",expectedRevision:"1",kind:"place_block",sourceSlot:2,expectedItemId:"dirt",
    });
    const placed = store.applyPlayerInventoryAction("alex", placeRequest, 1_010);
    expect(placed).toMatchObject({ ok:true,replayed:false,effect:"placed_block",inventory:{ revision:"2" } });
    if (!placed.ok) throw new Error("placement failed");
    const placedState = validatePlayerStateJson(placed.inventory.inventoryJson);
    expect(placedState.ok && countItem(placedState.state.inventory, "dirt")).toBe(15);
    expect(store.applyPlayerInventoryAction("alex", placeRequest, 1_020)).toMatchObject({
      ok:true,replayed:true,effect:"placed_block",inventory:{ revision:"2" },
    });

    const conflicting = store.applyPlayerInventoryAction("alex", JSON.stringify({
      operationId:"inventory_place_0002",expectedRevision:"1",kind:"place_block",sourceSlot:2,expectedItemId:"dirt",
    }), 1_030);
    expect(conflicting).toMatchObject({ ok:false,reason:"conflict",inventory:{ revision:"2" } });

    const credited = store.applyPlayerInventoryAction("alex", JSON.stringify({
      operationId:"inventory_pickup_001",expectedRevision:"2",kind:"world_credit",stack:{ itemId:"dirt",count:1 },
    }), 1_040);
    expect(credited).toMatchObject({ ok:true,effect:"world_credited",inventory:{ revision:"3" } });
    if (!credited.ok) throw new Error("credit failed");
    const creditedState = validatePlayerStateJson(credited.inventory.inventoryJson);
    expect(creditedState.ok && countItem(creditedState.state.inventory, "dirt")).toBe(16);
    store.close();
  });

  test("uses WAL and recovers player state, revisions, and idempotent operations", () => {
    const path = `/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const first = new WorldStore(path);
    expect(first.db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    first.savePlayer(
      { id: "u1", name: "Alex", x: 1, y: 72, z: 3, yaw: 0.5, pitch: 0, gameMode: "creative" },
      "resume-hash",
      10,
      10_000,
    );
    const accepted = first.applyBlockEdit({
      operationId: "op-1", x: 1, y: 72, z: 2, block: 4, editorId: "u1", editedAt: 20,
    }, 10);
    const duplicate = first.applyBlockEdit({
      operationId: "op-1", x: 9, y: 72, z: 9, block: 5, editorId: "u1", editedAt: 30,
    }, 10);
    expect(accepted?.duplicate).toBe(false);
    expect(duplicate).toEqual({ ...accepted, duplicate: true });
    expect(first.appendChat({
      operationId: "chat-restart", userId: "u1", username: "Alex", message: "still here", sentAt: 40,
    }, 900, 80)).toMatchObject({ ok: true, message: { sequence: 1 } });
    first.close();

    const restarted = new WorldStore(path);
    expect(restarted.loadPlayer("u1")).toMatchObject({
      player: { id: "u1", name: "Alex", x: 1, y: 72, z: 3, gameMode: "creative" },
      resumeHash: "resume-hash",
      resumeExpiresAt: 10_000,
    });
    expect(restarted.getRevision()).toBe(1);
    expect(restarted.getAllBlockEdits()).toEqual([
      { revision: 1, x: 1, y: 72, z: 2, block: 4, editorId: "u1", editedAt: 20 },
    ]);
    expect(restarted.recentChat(80)).toMatchObject([{
      sequence: 1, operationId: "chat-restart", userId: "u1", message: "still here",
    }]);
    restarted.close();
  });

  test("migrates pre-expiry player databases without losing poses", () => {
    const path = `/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE player_state (
        user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
        yaw REAL NOT NULL, pitch REAL NOT NULL,
        resume_hash TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO player_state VALUES ('u1', 'Alex', 1, 2, 3, 0, 0, 'legacy-hash', 9);
    `);
    legacy.close();

    const migrated = new WorldStore(path);
    expect(migrated.loadPlayer("u1")).toMatchObject({
      player: { id: "u1", x: 1, y: 2, z: 3, gameMode: "survival" },
      resumeHash: "legacy-hash",
      resumeExpiresAt: 0,
    });
    migrated.close();
  });

  test("migrates legacy world edits into negative-safe coordinate chunks",()=>{
    const path=`/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;paths.push(path);
    const legacy=new Database(path,{create:true});legacy.exec(`
      CREATE TABLE block_edits(x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,block INTEGER NOT NULL,revision INTEGER NOT NULL UNIQUE,editor_id TEXT NOT NULL,edited_at INTEGER NOT NULL,PRIMARY KEY(x,y,z));
      INSERT INTO block_edits VALUES(-1,70,-9,4,1,'builder',10);
    `);legacy.close();
    const migrated=new WorldStore(path);
    expect(migrated.getWorldChunk(-1,-2)).toMatchObject({revision:1,edits:[{x:-1,y:70,z:-9,block:4}]});
    expect(migrated.getWorldChunk(0,-2).edits).toEqual([]);
    expect(migrated.db.query<{name:string},[]>("SELECT name FROM sqlite_master WHERE type='index' AND name='block_edits_chunk_revision'").get()?.name).toBe("block_edits_chunk_revision");
    migrated.close();
  });

  test("persists admin game-mode grants without exposing resume credentials in player listings", () => {
    const store = new WorldStore(":memory:");
    store.savePlayer({ id: "u1", name: "Alex", x: 1, y: 69.02, z: 1, yaw: 0, pitch: 0 }, "secret-hash");
    expect(store.listPlayers()).toEqual([{ id: "u1", name: "Alex", gameMode: "survival" }]);
    expect(JSON.stringify(store.listPlayers())).not.toContain("secret-hash");
    expect(store.setPlayerGameMode("u1", "creative")).toBe(true);
    expect(store.loadPlayer("u1")?.player.gameMode).toBe("creative");
    expect(store.setPlayerGameMode("missing", "creative")).toBe(false);
    store.close();
  });

  test("enforces the unique persisted block cap but permits replacing a coordinate", () => {
    const store = new WorldStore(":memory:");
    expect(store.applyBlockEdit({ operationId: "a", x: 0, y: 72, z: 0, block: 1, editorId: "u", editedAt: 1 }, 1)).not.toBeNull();
    expect(store.applyBlockEdit({ operationId: "b", x: 1, y: 72, z: 0, block: 1, editorId: "u", editedAt: 2 }, 1)).toBeNull();
    expect(store.applyBlockEdit({ operationId: "c", x: 0, y: 72, z: 0, block: 2, editorId: "u", editedAt: 3 }, 1)?.edit.revision).toBe(2);
    store.close();
  });

  test("persists ordered bounded chat with idempotent operation acknowledgement", () => {
    const store = new WorldStore(":memory:");
    const first = store.appendChat({
      operationId: "chat_first", userId: "u1", username: "Alex", message: "one", sentAt: 1_000,
    }, 900, 2);
    const duplicate = store.appendChat({
      operationId: "chat_first", userId: "u1", username: "Alex", message: "changed", sentAt: 2_000,
    }, 900, 2);
    const limited = store.appendChat({
      operationId: "chat_second", userId: "u1", username: "Alex", message: "two", sentAt: 1_500,
    }, 900, 2);
    const second = store.appendChat({
      operationId: "chat_second", userId: "u1", username: "Alex", message: "two", sentAt: 2_000,
    }, 900, 2);
    const third = store.appendChat({
      operationId: "chat_third", userId: "u2", username: "Steve", message: "three", sentAt: 2_100,
    }, 900, 2);
    expect(first).toMatchObject({ ok: true, duplicate: false, message: { sequence: 1, message: "one" } });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true, message: { sequence: 1, message: "one" } });
    expect(limited).toEqual({ ok: false, retryAfterMs: 400 });
    expect(second).toMatchObject({ ok: true, message: { sequence: 2 } });
    expect(third).toMatchObject({ ok: true, message: { sequence: 3 } });
    expect(store.recentChat(80).map(({ sequence }) => sequence)).toEqual([2, 3]);
    store.close();
  });

  test("persists exact world drops and prunes expired items", () => {
    const store = new WorldStore(":memory:");
    const drop = {
      dropId:"drop:test", ownerUserId:"u1", itemId:"diamond_pickaxe", count:1, durability:120,
      x:1, y:69.02, z:2, droppedAt:1_000, ownerPickupAt:2_000, expiresAt:10_000,
    };
    store.saveDrop(drop, "drop_operation_1");
    expect(store.getDropOperation("u1", "drop_operation_1")).toEqual(drop);
    expect(store.listDrops(9_999)).toEqual([drop]);
    expect(store.listDrops(10_000)).toEqual([]);
    store.close();
  });

  test("retains the universal pickup deadline and exact-once receipt across restart", () => {
    const path = `/tmp/lakecraft-world-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const drop = {
      dropId:"drop:restart", ownerUserId:"owner", itemId:"dirt", count:1,
      x:0.5, y:69, z:0.5, droppedAt:1_000, ownerPickupAt:2_000, expiresAt:10_000,
    };
    const first = new WorldStore(path);
    // Production databases from the previous latch implementation retain
    // these additive columns. New code must ignore them without a rebuild.
    first.db.exec("ALTER TABLE dropped_items ADD COLUMN owner_pickup_blocked INTEGER NOT NULL DEFAULT 0;");
    first.db.exec("ALTER TABLE pickup_operations ADD COLUMN owner_pickup_blocked INTEGER NOT NULL DEFAULT 0;");
    first.saveDrop(drop, "drop_restart_operation");
    first.close();

    const restarted = new WorldStore(path);
    expect(restarted.listDrops(1_999)).toEqual([drop]);
    expect(restarted.consumeDrop("picker", "pickup_restart_operation", drop.dropId, 2_000)).toEqual(drop);
    restarted.close();

    const replayed = new WorldStore(path);
    expect(replayed.listDrops(2_001)).toEqual([]);
    expect(replayed.getPickupOperation("picker", "pickup_restart_operation")).toEqual(drop);
    expect(replayed.consumeDrop("picker", "pickup_restart_operation", drop.dropId, 2_500)).toEqual(drop);
    replayed.close();
  });
});
