import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { WorldStore } from "../src/database";
import { countItem, createItemStack } from "../../../shared/game.ts";
import { validatePlayerStateJson } from "../../../shared/chestTransfers.ts";
import { createInitializedPlayerState } from "../../../shared/inventoryActions.ts";
import { validateDeathDropConservation } from "../../../shared/deathDrops.ts";
import { BLOCK_ID_MAX } from "../src/protocol.ts";

const paths: string[] = [];

afterEach(async () => {
  for (const path of paths.splice(0)) {
    await Bun.file(path).delete().catch(() => {});
    await Bun.file(`${path}-wal`).delete().catch(() => {});
    await Bun.file(`${path}-shm`).delete().catch(() => {});
  }
});

describe("SQLite world persistence", () => {
  test("owns exact-once mob health and death state without Lakebed mutations", () => {
    const store = new WorldStore(":memory:");
    store.ensurePlayerInventory("alex",undefined,900);
    const armed=createInitializedPlayerState();
    armed.selectedHotbar=0;armed.inventory[0]=createItemStack("stone_pickaxe");
    store.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?").run(JSON.stringify(armed),"alex");
    const first = store.applyMobAttack("alex", "mob_attack_operation_1", "chicken-5nb-0", "chicken", 3, 1_000);
    expect(first).toMatchObject({ ok: true, replayed: false, killed: false, damage:3,state: { health: 1, revision: 1 } });
    expect(store.applyMobAttack("alex", "mob_attack_operation_1", "chicken-5nb-0", "chicken", 3, 1_100))
      .toMatchObject({ ok: true, replayed: true, killed: false, state: { health: 1, revision: 1 } });
    expect(store.applyMobAttack("alex", "mob_attack_operation_1", "chicken-5nb-0", "chicken", 1, 1_100))
      .toMatchObject({ok:true,replayed:true,damage:3});
    const killed = store.applyMobAttack("alex", "mob_attack_operation_2", "chicken-5nb-0", "chicken", 3, 1_300);
    expect(killed).toMatchObject({ ok: true, replayed: false, killed: true, state: { health: 0, revision: 2 } });
    expect(killed.ok && killed.drops).toContainEqual({ itemId: "raw_chicken", count: 1 });
    expect(store.mobAuthorityState("chicken-5nb-0", "chicken", 1_301)).toMatchObject({ health: 0, revision: 2 });
    expect(store.mobAuthorityState("chicken-5nb-0", "chicken", 31_300)).toMatchObject({ health: 4, revision: 2 });
    store.close();
  });

  test("atomically derives combat gear, wears armor and weapons, and replays across restart",()=>{
    const path=`/tmp/lakecraft-combat-authority-${crypto.randomUUID()}.sqlite`;paths.push(path);
    const first=new WorldStore(path);
    for(const id of ["attacker","target"]) {
      first.savePlayer({id,name:id,x:0.5,y:69.02,z:id==="attacker"?0.5:-1.5,yaw:0,pitch:0,health:20},`resume-${id}`,900,10_000);
      first.ensurePlayerInventory(id,undefined,900);
    }
    const attacker=createInitializedPlayerState();attacker.selectedHotbar=0;
    attacker.inventory[0]={itemId:"diamond_sword",count:1,durability:1};
    const target=createInitializedPlayerState();
    target.equipment={
      head:{itemId:"diamond_helmet",durability:1},chest:{itemId:"diamond_chestplate",durability:1},
      legs:{itemId:"diamond_leggings",durability:1},feet:{itemId:"diamond_boots",durability:1},
    };
    first.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?").run(JSON.stringify(attacker),"attacker");
    first.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?").run(JSON.stringify(target),"target");
    const hit=first.applyAuthoritativePlayerAttack("attacker","combat_atomic_restart_1","target",1_000);
    expect(hit).toMatchObject({ok:true,replayed:false,damage:2,health:18,weaponDamaged:true,weaponBroken:true,
      attackerInventory:{revision:"2"},targetInventory:{revision:"2"}});
    const attackerAfter=validatePlayerStateJson(hit.ok?hit.attackerInventory.inventoryJson:"");
    const targetAfter=validatePlayerStateJson(hit.ok?hit.targetInventory.inventoryJson:"");
    expect(attackerAfter.ok&&attackerAfter.state.inventory[0]).toBeNull();
    expect(targetAfter.ok&&targetAfter.state.equipment).toEqual({head:null,chest:null,legs:null,feet:null});
    first.close();
    const restarted=new WorldStore(path);
    expect(restarted.applyAuthoritativePlayerAttack("attacker","combat_atomic_restart_1","target",2_000))
      .toMatchObject({ok:true,replayed:true,damage:2,health:18,weaponBroken:true});
    expect(restarted.loadPlayer("target")?.player.health).toBe(18);
    restarted.close();
  });

  test("binds mob weapon wear and hostile death lifecycle to durable receipts",()=>{
    const path=`/tmp/lakecraft-mob-combat-${crypto.randomUUID()}.sqlite`;paths.push(path);
    const first=new WorldStore(path);
    first.savePlayer({id:"fighter",name:"fighter",x:0.5,y:69.02,z:0.5,yaw:0,pitch:0,health:20},"resume-fighter",900,10_000);
    first.ensurePlayerInventory("fighter",undefined,900);
    const armed=createInitializedPlayerState();armed.selectedHotbar=0;
    armed.inventory[0]={itemId:"diamond_sword",count:1,durability:1};
    first.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?").run(JSON.stringify(armed),"fighter");
    expect(first.applyMobAttack("fighter","mob_weapon_restart_1","zombie-5nb-0","zombie",1_000))
      .toMatchObject({ok:true,replayed:false,damage:7,weaponBroken:true,state:{health:13}});
    const after=validatePlayerStateJson(first.loadPlayerInventory("fighter")!.inventoryJson);
    expect(after.ok&&after.state.inventory[0]).toBeNull();
    const fatal=first.applyAuthoritativePlayerDamage("fighter","mob_contact_fatal_1","mob:zombie-5nb-0",40,true,1_100);
    expect(fatal).toMatchObject({ok:true,killed:true,health:0});
    expect(first.currentPlayerDeath("fighter")?.eventId).toBe("mob:zombie-5nb-0:mob_contact_fatal_1");
    first.close();
    const restarted=new WorldStore(path);
    expect(restarted.applyMobAttack("fighter","mob_weapon_restart_1","zombie-5nb-0","zombie",2_000))
      .toMatchObject({ok:true,replayed:true,damage:7,weaponBroken:true});
    expect(restarted.currentPlayerDeath("fighter")?.settledOperationId).toBeNull();
    restarted.close();
  });

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
      operationId: "op-1", x: 1, y: 72, z: 2, block: BLOCK_ID_MAX, editorId: "u1", editedAt: 20,
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
      { revision: 1, x: 1, y: 72, z: 2, block: BLOCK_ID_MAX, editorId: "u1", editedAt: 20 },
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

  test("keeps legacy display names from breaking read-only admin access lookups", () => {
    const store = new WorldStore(":memory:");
    store.savePlayer({ id: "old-bot", name: "Spawn Probe", x: 1, y: 69.02, z: 1, yaw: 0, pitch: 0 }, "legacy-probe-hash");
    expect(store.listAdminPlayers()).toMatchObject([{ id: "old-bot", name: "Spawn Probe" }]);
    expect(store.roleFor("Spawn Probe")).toBeNull();
    expect(store.banFor("Spawn Probe")).toBeNull();
    expect(store.isWhitelisted("Spawn Probe")).toBe(false);
    store.close();
  });

  test("enforces the unique persisted block cap but permits replacing a coordinate", () => {
    const store = new WorldStore(":memory:");
    expect(store.applyBlockEdit({ operationId: "a", x: 0, y: 72, z: 0, block: 1, editorId: "u", editedAt: 1 }, 1)).not.toBeNull();
    expect(store.applyBlockEdit({ operationId: "b", x: 1, y: 72, z: 0, block: 1, editorId: "u", editedAt: 2 }, 1)).toBeNull();
    expect(store.applyBlockEdit({ operationId: "c", x: 0, y: 72, z: 0, block: 2, editorId: "u", editedAt: 3 }, 1)?.edit.revision).toBe(2);
    store.close();
  });

  test("commits one complete creeper crater exactly once and conserves every revision", () => {
    const store = new WorldStore(":memory:");
    store.savePlayer({ id: "alex", name: "Alex", x: 0, y: 68, z: 0, yaw: 0, pitch: 0, health: 20 }, "resume", 1_000, 10_000);
    const input = {
      eventId: "creeper-5nb-0:1:f",
      fingerprint: "creeper-fingerprint-a",
      mobId: "creeper-5nb-0",
      edits: [
        { x: 0, y: 68, z: 0, block: 0 },
        { x: 1, y: 68, z: 0, block: 0 },
        { x: 0, y: 68, z: 0, block: 0 },
      ],
      playerDamage: [{ userId: "alex", damage: 7 }],
      drops: [{
        dropId: "drop:creeper:test:0", ownerUserId: "creeper-5nb-0", itemId: "cobblestone", count: 1,
        x: 0.5, y: 68.4, z: 0.5, droppedAt: 2_000, ownerPickupAt: 3_000, expiresAt: 302_000,
      }],
      editedAt: 2_000,
      maxUniqueBlocks: 10,
    } as const;
    const committed = store.applyMobExplosion(input);
    expect(committed).toMatchObject({ ok: true, replayed: false });
    expect(committed.ok && committed.edits).toHaveLength(2);
    expect(committed.ok && committed.edits.map((edit) => edit.revision)).toEqual([1, 2]);
    expect(committed.ok && committed.playerDamage).toEqual([{ userId: "alex", damage: 7, health: 13, killed: false }]);
    expect(committed.ok && committed.drops).toHaveLength(1);
    expect(store.listDrops(2_001)).toEqual(committed.ok ? committed.drops : []);
    expect(store.getRevision()).toBe(2);
    expect(store.blockCount()).toBe(2);
    expect(store.mobAuthorityState("creeper-5nb-0", "creeper", 2_001)).toMatchObject({ health: 0 });
    expect(store.applyMobExplosion(input)).toEqual({ ...committed, replayed: true });
    expect(store.getRevision()).toBe(2);
    expect(store.applyMobExplosion({ ...input, fingerprint: "collision" }))
      .toEqual({ ok: false, reason: "event_collision" });
    const limited = store.applyMobExplosion({
      ...input,
      eventId: "creeper-5nb-1:1:f",
      fingerprint: "creeper-fingerprint-b",
      mobId: "creeper-5nb-1",
      edits: [{ x: 2, y: 68, z: 0, block: 0 }],
      playerDamage: [{ userId: "alex", damage: 3 }],
      drops: [],
      maxUniqueBlocks: 2,
    });
    expect(limited).toMatchObject({ ok: true, replayed: false, terrainLimited: true, edits: [] });
    expect(limited.ok && limited.playerDamage).toEqual([{ userId: "alex", damage: 3, health: 10, killed: false }]);
    expect(store.getRevision()).toBe(2);
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

  test("atomically conserves survival block actions and raw item drops across retry and restart", () => {
    const path = `/tmp/lakecraft-authority-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const first = new WorldStore(path);
    first.ensurePlayerInventory("builder", undefined, 1_000);
    const place = JSON.stringify({
      operationId:"block_authority_place_0001",kind:"place",x:0,y:69,z:1,
      expectedBlock:"air",placedBlock:"dirt",selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:"1",expectedChunkRevision:"0",
    });
    const placed = first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:place,block:2,baseBlock:0,gameMode:"survival",editedAt:1_010,maxUniqueBlocks:100,
    });
    expect(placed).toMatchObject({ok:true,replayed:false,edit:{block:2,revision:1},inventory:{revision:"2"}});
    const placedState = validatePlayerStateJson(placed.ok ? placed.inventory.inventoryJson : "");
    expect(placedState.ok && countItem(placedState.state.inventory,"dirt")).toBe(15);
    expect(first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:place,block:2,baseBlock:0,gameMode:"survival",editedAt:1_020,maxUniqueBlocks:100,
    })).toMatchObject({ok:true,replayed:true,edit:{revision:1},inventory:{revision:"2"}});
    const reused = place.replace('"placedBlock":"dirt"','"placedBlock":"stone"')
      .replace('"expectedHeldItem":"dirt"','"expectedHeldItem":"stone"');
    expect(first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:reused,block:3,baseBlock:0,gameMode:"survival",editedAt:1_021,maxUniqueBlocks:100,
    })).toEqual({ok:false,reason:"operation_id_reused"});
    const stale = JSON.stringify({
      operationId:"block_authority_place_0002",kind:"place",x:1,y:69,z:1,
      expectedBlock:"air",placedBlock:"dirt",selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:"2",expectedChunkRevision:"0",
    });
    expect(first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:stale,block:2,baseBlock:0,gameMode:"survival",editedAt:1_030,maxUniqueBlocks:100,
    })).toEqual({ok:false,reason:"stale_chunk_revision"});
    const mine = JSON.stringify({
      operationId:"block_authority_mine_0001",kind:"mine",x:0,y:69,z:1,
      expectedBlock:"dirt",selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:"2",expectedChunkRevision:"1",
    });
    const mined = first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:mine,block:0,baseBlock:0,gameMode:"survival",editedAt:1_035,maxUniqueBlocks:100,
    });
    expect(mined).toMatchObject({ok:true,replayed:false,edit:{block:0,revision:2},inventory:{revision:"2"},drop:{itemId:"dirt",count:1}});
    expect(first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:mine,block:0,baseBlock:0,gameMode:"survival",editedAt:1_036,maxUniqueBlocks:100,
    })).toMatchObject({ok:true,replayed:true,edit:{revision:2},drop:{dropId:"drop:mine:block_authority_mine_0001"}});
    expect(first.listDrops(1_036).filter((entry)=>entry.dropId.startsWith("drop:mine:"))).toHaveLength(1);
    const bedrock = JSON.stringify({
      operationId:"block_authority_mine_bedrock",kind:"mine",x:1,y:1,z:1,
      expectedBlock:"bedrock",selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:"2",expectedChunkRevision:"2",
    });
    expect(first.applyAuthoritativeBlockOperation({
      userId:"builder",requestJson:bedrock,block:0,baseBlock:33,gameMode:"survival",editedAt:1_040,maxUniqueBlocks:100,
    })).toEqual({ok:false,reason:"invalid_request"});
    const drop = {
      dropId:"drop:authority",ownerUserId:"builder",itemId:"dirt",count:4,
      x:0.5,y:69,z:1.5,droppedAt:1_050,ownerPickupAt:2_050,expiresAt:61_050,
    };
    expect(first.applyAuthoritativeDrop("builder","drop_authority_0001",undefined,{itemId:"dirt",count:4},drop,1_050))
      .toEqual({ok:false,reason:"item_mismatch"});
    const dropped = first.applyAuthoritativeDrop("builder","drop_authority_0001",2,{itemId:"dirt",count:4},drop,1_050);
    expect(dropped).toMatchObject({ok:true,replayed:false,inventory:{revision:"3"},drop:{count:4}});
    first.close();

    const restarted = new WorldStore(path);
    expect(restarted.replayAuthoritativeBlockOperation(
      "builder","block_authority_place_0001",place,2,"survival",
    )).toMatchObject({ok:true,replayed:true,edit:{revision:1}});
    const replayedDrop = restarted.applyAuthoritativeDrop(
      "builder","drop_authority_0001",2,{itemId:"dirt",count:4},drop,2_000,
    );
    expect(replayedDrop).toMatchObject({ok:true,replayed:true,inventory:{revision:"3"}});
    const finalState = validatePlayerStateJson(replayedDrop.ok ? replayedDrop.inventory.inventoryJson : "");
    expect(finalState.ok && countItem(finalState.state.inventory,"dirt")).toBe(11);
    expect(restarted.listDrops(2_000)).toHaveLength(2);
    expect(restarted.listDrops(2_000).filter((entry)=>entry.dropId.startsWith("drop:mine:"))).toHaveLength(1);
    const pickup = restarted.consumeDropIntoInventory(
      "builder","pickup_authority_0001","drop:mine:block_authority_mine_0001",2_100,
    );
    expect(pickup).toMatchObject({ok:true,replayed:false,inventory:{revision:"4"},drop:{itemId:"dirt",count:1}});
    const pickedState = validatePlayerStateJson(pickup.ok ? pickup.inventory.inventoryJson : "");
    expect(pickedState.ok && countItem(pickedState.state.inventory,"dirt")).toBe(12);
    expect(restarted.consumeDropIntoInventory(
      "builder","pickup_authority_0001","drop:authority",2_101,
    )).toEqual({ok:false,reason:"operation_id_reused"});
    restarted.close();

    const replayed = new WorldStore(path);
    const replayedPickup = replayed.consumeDropIntoInventory(
      "builder","pickup_authority_0001","drop:mine:block_authority_mine_0001",3_000,
    );
    expect(replayedPickup).toMatchObject({ok:true,replayed:true,inventory:{revision:"4"}});
    const replayedState = validatePlayerStateJson(replayedPickup.ok ? replayedPickup.inventory.inventoryJson : "");
    expect(replayedState.ok && countItem(replayedState.state.inventory,"dirt")).toBe(12);
    expect(replayed.listDrops(3_000)).toEqual([expect.objectContaining({dropId:"drop:authority",count:4})]);
    replayed.close();
  });

  test("mines into one world drop even when the player pack has no free slot", () => {
    const store = new WorldStore(":memory:");
    store.ensurePlayerInventory("full-miner", undefined, 1_000);
    const state = createInitializedPlayerState();
    state.inventory = Array.from({length:36},(_,index)=>index === 0
      ? {itemId:"iron_pickaxe" as const,count:1,durability:120}
      : {itemId:"dirt" as const,count:64});
    store.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?")
      .run(JSON.stringify(state),"full-miner");
    const mine = JSON.stringify({
      operationId:"full_inventory_mine_0001",kind:"mine",x:16,y:69,z:1,
      expectedBlock:"stone",selectedHotbar:0,expectedHeldItem:"iron_pickaxe",
      expectedInventoryRevision:"1",expectedChunkRevision:"0",
    });
    const result = store.applyAuthoritativeBlockOperation({
      userId:"full-miner",requestJson:mine,block:0,baseBlock:3,gameMode:"survival",editedAt:1_010,maxUniqueBlocks:100,
    });
    expect(result).toMatchObject({ok:true,inventory:{revision:"2"},drop:{itemId:"cobblestone",count:1}});
    const committed = validatePlayerStateJson(result.ok ? result.inventory.inventoryJson : "");
    expect(committed.ok && committed.state.inventory[0]).toMatchObject({itemId:"iron_pickaxe",durability:119});
    expect(committed.ok && countItem(committed.state.inventory,"cobblestone")).toBe(0);
    expect(store.listDrops(1_011)).toEqual([expect.objectContaining({itemId:"cobblestone",count:1})]);
    store.close();
  });

  test("settles an authoritative death pack once across retry, pickup, and restart", () => {
    const path = `/tmp/lakecraft-death-authority-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const first = new WorldStore(path);
    first.ensurePlayerInventory("victim",undefined,1_000);
    const source = createInitializedPlayerState();
    source.equipment.head={itemId:"iron_helmet",durability:77};
    first.db.query("UPDATE player_inventory SET inventory_json=? WHERE user_id=?")
      .run(JSON.stringify(source),"victim");
    first.saveDeadPlayer({id:"victim",name:"victim",x:0.5,y:69.02,z:0.5,yaw:0,pitch:0,health:0},
      "resume-victim","fall:fatal_attack_0001",1_005,10_000);
    const requestJson = JSON.stringify({
      operationId:"death_authority_0001",expectedRevision:"1",kind:"death_settle",eventId:"fatal_attack_0001",
    });
    const settled = first.applyAuthoritativeDeathSettlement(
      "victim",requestJson,{x:0.5,y:69.02,z:0.5},1_010,
    );
    expect(settled.result).toMatchObject({ok:true,replayed:false,effect:"death_settled",inventory:{revision:"2"}});
    expect(settled.drops.length).toBeGreaterThan(0);
    expect(validateDeathDropConservation(source.inventory,source.equipment,settled.drops.map((drop)=>({
      itemId:drop.itemId as never,count:drop.count,...(drop.durability===undefined?{}:{durability:drop.durability}),
    })))).toEqual({ok:true,fingerprint:expect.any(String)});
    expect(first.applyAuthoritativeDeathSettlement(
      "victim",requestJson,{x:0.5,y:69.02,z:0.5},1_011,
    ).result).toMatchObject({ok:true,replayed:true,inventory:{revision:"2"}});
    expect(first.listDrops(1_011)).toHaveLength(settled.drops.length);
    first.close();

    const restarted = new WorldStore(path);
    const replay = restarted.applyAuthoritativeDeathSettlement(
      "victim",requestJson,{x:0.5,y:69.02,z:0.5},2_000,
    );
    expect(replay.result).toMatchObject({ok:true,replayed:true,inventory:{revision:"2"}});
    expect(replay.activeDrops).toHaveLength(settled.drops.length);
    expect(restarted.currentPlayerDeath("victim")).toMatchObject({eventId:"fall:fatal_attack_0001",settledOperationId:"death_authority_0001"});
    restarted.ensurePlayerInventory("picker",undefined,2_001);
    const consumed = restarted.consumeDropIntoInventory(
      "picker","pickup_death_restart_0001",settled.drops[0].dropId,2_011,
    );
    expect(consumed).toMatchObject({ok:true,replayed:false});
    const afterPickup = restarted.applyAuthoritativeDeathSettlement(
      "victim",requestJson,{x:0.5,y:69.02,z:0.5},2_012,
    );
    expect(afterPickup.result).toMatchObject({ok:true,replayed:true,inventory:{revision:"2"}});
    expect(afterPickup.activeDrops).toHaveLength(settled.drops.length-1);
    expect(restarted.applyAuthoritativeDeathSettlement(
      "victim",requestJson,{x:1.5,y:69.02,z:0.5},2_013,
    ).result).toEqual({ok:false,reason:"operation_id_reused"});
    const dead=restarted.loadPlayer("victim")!;
    expect(restarted.commitPlayerRespawn({...dead.player,health:20,x:4.5,y:70,z:4.5},dead.resumeHash,2_100,dead.resumeExpiresAt))
      .toEqual({ok:true});
    expect(restarted.commitPlayerRespawn({...dead.player,health:20},dead.resumeHash,2_101,dead.resumeExpiresAt))
      .toEqual({ok:false,reason:"alive"});
    expect(restarted.currentPlayerDeath("victim")).toBeNull();
    restarted.close();
  });
});
