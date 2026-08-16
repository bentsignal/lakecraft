import { describe, expect, test } from "bun:test";
import type { JoinAuthenticator } from "../src/auth";
import type { ServerConfig } from "../src/config";
import { WorldStore } from "../src/database";
import { APPEARANCE_CAPABILITY, BLOCK_ID_MAX, MOBS_CAPABILITY, SKIN_PIXEL_BYTES, WORLD_CHUNKS_CAPABILITY, WORLD_CHUNKS_LEGACY_CAPABILITY, type ClientMessage, type ServerMessage } from "../src/protocol";
import { GameWorld, RESUME_TOKEN_TTL_MS, type Peer } from "../src/world";
import { RAILWAY_MOB_PASSIVE_PER_HABITAT } from "../src/mobEcology";
import { terrainHeight as clientTerrainHeight } from "../../../client/game/terrain";
import { createTerrainChunk } from "../../../client/game/terrain";
import { BLOCK } from "../../../client/game/types";
import {
  CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_SPEED,
  MAX_PLAYER_Y,
  PLAYER_FEET_CLEARANCE,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
  createTerrainAuthority,
  terrainFeetY,
  terrainHeight,
} from "../src/terrain";
import {
  PLAYER_GRAVITY as CLIENT_PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED as CLIENT_PLAYER_JUMP_SPEED,
} from "../../../client/game/voxelEngine";
import {
  CREATIVE_FLIGHT_SPEED as CLIENT_CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_SPEED as CLIENT_CREATIVE_FLIGHT_SPRINT_SPEED,
} from "../../../client/game/playerMovement";
import { decodeRealtimeChunkEdits } from "../../../shared/realtimeWorldChunks";
import { BLOCK_TYPES } from "../../../shared/protocol.ts";
import { createInitializedPlayerState } from "../../../shared/inventoryActions.ts";
import { countItem, createItemStack, type ItemId } from "../../../shared/game.ts";
import { validatePlayerStateJson } from "../../../shared/chestTransfers.ts";

class FakePeer implements Peer {
  readonly sent: ServerMessage[] = [];
  closed?: { code: number; reason: string };
  queued = 0;

  constructor(readonly id: string) {}
  send(payload: string): void { this.sent.push(JSON.parse(payload)); }
  close(code: number, reason: string): void { this.closed = { code, reason }; }
  bufferedAmount(): number { return this.queued; }
  ofType<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.sent.filter((message) => message.type === type) as Extract<ServerMessage, { type: T }>[];
  }
}

const authenticator: JoinAuthenticator = {
  async authenticate(message) {
    if (!message.demo) throw new Error("demo required");
    return {
      userId: message.demo.userId,
      displayName: message.demo.name,
      ...(message.demo.inventoryJson === undefined ? {} : { initialInventoryJson: message.demo.inventoryJson }),
    };
  },
};

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 3001,
    serverId: "test-server",
    serverName: "Test World",
    serverDescription: "Tests",
    authMode: "local-demo",
    localDemoToken: "0123456789abcdef",
    dataDir: ".",
    tickHz: 20,
    snapshotHz: 10,
    idleSuspendMs: 100,
    maxPlayers: 8,
    maxPersistedBlocks: 100,
    allowedOrigins: [],
    worldPreset: "default",
    superflatGroundY: 20,
    defaultGameMode: "survival",
    spawnX: 0.5,
    spawnZ: 0.5,
    spawnYaw: 0,
    ...overrides,
  };
}

function join(userId: string, name = userId, resumeToken?: string, inventoryJson?: string): ClientMessage {
  if (resumeToken) return { v: 1, type: "join", resumeToken, capabilities: [WORLD_CHUNKS_CAPABILITY] };
  return {
    v: 1,
    type: "join",
    capabilities: [WORLD_CHUNKS_CAPABILITY],
    demo: { token: "0123456789abcdef", userId, name, ...(inventoryJson ? { inventoryJson } : {}) },
  };
}

function selectedInventory(itemId:ItemId,durability?:number):string {
  const state=createInitializedPlayerState();
  state.selectedHotbar=0;
  state.inventory[0]={...createItemStack(itemId),...(durability===undefined?{}:{durability})};
  return JSON.stringify(state);
}

function authoritativeBlockEdit(input: {
  operationId: string; seq: number; x: number; y: number; z: number; block: number;
  previousBlock?: number; chunkRevision?: number; inventoryRevision?: number;
}): ClientMessage {
  const previousBlock = input.previousBlock ?? 0;
  const request = input.block === 0
    ? { operationId:input.operationId,kind:"mine",x:input.x,y:input.y,z:input.z,
      expectedBlock:BLOCK_TYPES[previousBlock],selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:String(input.inventoryRevision ?? 1),expectedChunkRevision:String(input.chunkRevision ?? 0) }
    : { operationId:input.operationId,kind:"place",x:input.x,y:input.y,z:input.z,
      expectedBlock:"air",placedBlock:BLOCK_TYPES[input.block],selectedHotbar:2,expectedHeldItem:"dirt",
      expectedInventoryRevision:String(input.inventoryRevision ?? 1),expectedChunkRevision:String(input.chunkRevision ?? 0) };
  return { v:1,type:"block_edit",...input,requestJson:JSON.stringify(request) } as ClientMessage;
}

describe("authoritative world", () => {
  test("matches the browser's deterministic terrain surface across the playable region", () => {
    for (let x = -128; x <= 128; x += 7) {
      for (let z = -128; z <= 128; z += 11) {
        expect(terrainHeight(x, z)).toBe(clientTerrainHeight(x, z, 7319));
      }
    }
    expect(terrainFeetY(0.5, 0.5)).toBe(68 + PLAYER_FEET_CLEARANCE);
    expect(terrainFeetY(0.5, 4.72)).toBe(69 + PLAYER_FEET_CLEARANCE);
    expect(terrainFeetY(0.5, -4.72)).toBe(71 + PLAYER_FEET_CLEARANCE);
    expect(PLAYER_GRAVITY).toBe(CLIENT_PLAYER_GRAVITY);
    expect(PLAYER_JUMP_SPEED).toBe(CLIENT_PLAYER_JUMP_SPEED);
    expect(CREATIVE_FLIGHT_SPEED).toBe(CLIENT_CREATIVE_FLIGHT_SPEED);
    expect(CREATIVE_FLIGHT_SPRINT_SPEED).toBe(CLIENT_CREATIVE_FLIGHT_SPRINT_SPEED);
    const authority = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const chunk = createTerrainChunk(7319, -2, 3);
    for (let x = -16; x < -8; x += 3) for (let z = 24; z < 32; z += 3) {
      for (let y = 1; y <= 86; y += 1) {
        expect(authority.blockAt(x, y, z)).toBe(chunk.get(`${x},${y},${z}`) ?? BLOCK.AIR);
      }
    }
  });

  test("shares exact superflat strata, spawn, collision, and Creative defaults with the browser", async () => {
    const superflat = config({ worldPreset: "superflat", superflatGroundY: 20, defaultGameMode: "creative" });
    const store = new WorldStore(":memory:");
    const world = new GameWorld(superflat, store, authenticator);
    const chunk = createTerrainChunk(7319, 0, 0, 16, world.terrain.descriptor);
    for (let x = 0; x < 16; x += 3) for (let z = 0; z < 16; z += 5) {
      for (let y = 0; y <= 22; y += 1) {
        expect(world.terrain.blockAt(x, y, z)).toBe(chunk.get(`${x},${y},${z}`) ?? BLOCK.AIR);
      }
    }
    expect(world.terrain.blockAt(0, 1, 0)).toBe(BLOCK.BEDROCK);
    expect(world.terrain.blockAt(0, 16, 0)).toBe(BLOCK.STONE);
    expect(world.terrain.blockAt(0, 17, 0)).toBe(BLOCK.DIRT);
    expect(world.terrain.blockAt(0, 20, 0)).toBe(BLOCK.GRASS);
    expect(world.terrain.feetY(0.5, 0.5)).toBe(20 + PLAYER_FEET_CLEARANCE);
    const peer = new FakePeer("superflat-player");
    world.open(peer, 1_000);
    expect(peer.ofType("hello")[0]).toMatchObject({
      terrain: { preset: "superflat", superflatGroundY: 20 },
      defaultGameMode: "creative",
    });
    await world.message(peer, JSON.stringify(join("builder")), 1_000);
    expect(peer.ofType("welcome")[0]).toMatchObject({
      player: { gameMode: "creative", y: 20 + PLAYER_FEET_CLEARANCE },
      terrain: { preset: "superflat", superflatGroundY: 20 },
      defaultGameMode: "creative",
    });
    store.close();
  });

  test("uses a configurable clear Creative spawn and relocates an obstructed saved pose", async () => {
    const store = new WorldStore(":memory:");
    const original = new GameWorld(config({
      worldPreset: "superflat",
      superflatGroundY: 20,
      defaultGameMode: "creative",
    }), store, authenticator);
    const first = new FakePeer("spawn-original");
    original.open(first, 1_000);
    await original.message(first, JSON.stringify(join("spawn-user")), 1_000);
    const resumeToken = String(first.ofType("welcome")[0].resumeToken);
    original.close(first);
    expect(store.applyBlockEdit({
      operationId: "spawn_obstruction_1",
      x: 0,
      y: 21,
      z: 0,
      block: 26,
      editorId: "builder",
      editedAt: 1_100,
    }, 100)).not.toBeNull();

    const relocated = new GameWorld(config({
      worldPreset: "superflat",
      superflatGroundY: 20,
      defaultGameMode: "creative",
      spawnX: -23.5,
      spawnZ: -23.5,
      spawnYaw: 3 * Math.PI / 4,
    }), store, authenticator);
    expect(await relocated.runAdminCommand("/setworldspawn -23.5 -23.5 135")).toMatchObject({ ok: true });
    const resumed = new FakePeer("spawn-resumed");
    relocated.open(resumed, 1_200);
    await relocated.message(resumed, JSON.stringify(join("ignored", "ignored", resumeToken)), 1_200);
    expect(resumed.ofType("welcome")[0]).toMatchObject({
      resumed: true,
      player: { x: -23.5, y: 21.02, z: -23.5, yaw: 3 * Math.PI / 4, gameMode: "creative" },
    });
    await relocated.message(resumed, JSON.stringify({
      v:1,type:"respawn",operationId:"spawn_respawn_safe_1",
    }), 1_300);
    expect(resumed.ofType("respawned")).toHaveLength(0);
    expect(resumed.ofType("error").at(-1)).toMatchObject({operationId:"spawn_respawn_safe_1"});
    await relocated.message(resumed, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveY:1,moveZ:0,yaw:3 * Math.PI / 4,pitch:0,
      jump:true,sprint:false,x:-23.5,y:21.37,z:-23.5,
    }), 1_350);
    relocated.tick(1_400);
    relocated.snapshots(1_400);
    expect(Number(resumed.ofType("snapshot").at(-1)?.self.y)).toBeGreaterThan(21.02);
    store.close();
  });

  test("pins a persisted world's terrain across server restarts", () => {
    const store = new WorldStore(":memory:");
    new GameWorld(config({ worldPreset: "superflat", superflatGroundY: 20 }), store, authenticator);
    expect(() => new GameWorld(
      config({ worldPreset: "superflat", superflatGroundY: 21 }),
      store,
      authenticator,
    )).toThrow("World terrain is pinned to superflat:20; refusing superflat:21");
    expect(() => new GameWorld(config({ worldPreset: "default" }), store, authenticator))
      .toThrow("World terrain is pinned to superflat:20; refusing default:20");
    store.close();
  });

  test("integrates validated sequenced inputs and emits spatial snapshots", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("socket-a");
    const steve = new FakePeer("socket-b");
    world.open(alex, 1_000);
    world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);

    await world.message(alex, JSON.stringify({
      v: 1, type: "input", seq: 1, dtMs: 16, moveX: 1, moveZ: 0,
      yaw: Math.PI * 3, pitch: 0.1, jump: false, sprint: true,
      heldItem: "iron_pickaxe",
    }), 1_010);
    world.tick(1_020);
    world.snapshots(1_030);
    const snapshot = alex.ofType("snapshot").at(-1)!;
    expect(snapshot.inputAck).toBe(1);
    expect(snapshot.self.x).toBeCloseTo(0.78);
    expect(snapshot.self.y).toBeCloseTo(69.02);
    expect(snapshot.self.yaw).toBeCloseTo(-Math.PI);
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]).toMatchObject({ id: "steve", name: "Steve" });
    await world.message(alex, JSON.stringify({ v:1, type:"action", seq:1, kind:"swing" }), 1_031);
    world.snapshots(1_032);
    expect(steve.ofType("snapshot").at(-1)?.players[0]).toMatchObject({
      id: "alex",
      heldItem: "iron_pickaxe",
      visualActions: [{ sequence: 1, kind: "swing" }],
    });
    store.close();
  });

  test("gives two clients one Railway-owned mob timeline and exact-once death drops", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config({ daylightCycle:false, dayPhase:0.5, mobsEnabled:true }), store, authenticator);
    const alex = new FakePeer("mob-a");
    const steve = new FakePeer("mob-b");
    world.open(alex, 1_000); world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex", "Alex",undefined,selectedInventory("diamond_sword"))), 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);
    world.tick(1_050); world.tick(1_100); world.snapshots(1_100);
    const left = alex.ofType("mob_snapshot").at(-1)!;
    const right = steve.ofType("mob_snapshot").at(-1)!;
    expect(left).toEqual(right);
    expect(left.poses).toHaveLength(RAILWAY_MOB_PASSIVE_PER_HABITAT + 4);
    const chicken = left.poses.find((pose) => pose.kind === "chicken")!;

    let x = 0.5, y = 69.02, z = 0.5;
    const targetX = chicken.x;
    const targetY = chicken.y;
    const targetZ = chicken.z + 1.5;
    let seq = 0;
    while (Math.hypot(targetX - x, targetY - y, targetZ - z) > 0.01) {
      const distance = Math.hypot(targetX - x, targetY - y, targetZ - z);
      const step = Math.min(1.25, distance);
      x += (targetX - x) / distance * step;
      y += (targetY - y) / distance * step;
      z += (targetZ - z) / distance * step;
      await world.message(alex, JSON.stringify({
        v:1,type:"input",seq:++seq,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,
        jump:false,sprint:false,heldItem:"diamond_sword",x,y,z,
      }), 1_100 + seq);
    }
    const attack = { v:1,type:"mob_attack",operationId:"mob_attack:death-proof",mobId:chicken.mobId };
    await world.message(alex, JSON.stringify(attack), 1_500);
    await world.message(alex, JSON.stringify(attack), 1_501);
    expect(alex.ofType("mob_hit").slice(-2)).toMatchObject([
      { killed:true,replayed:false,state:{ mobId:chicken.mobId,health:0 } },
      { killed:true,replayed:true,state:{ mobId:chicken.mobId,health:0 } },
    ]);
    expect(steve.ofType("mob_hit").at(-1)).toMatchObject({ killed:true,state:{ mobId:chicken.mobId,health:0 } });
    const drops = alex.ofType("drop_snapshot").at(-1)?.drops ?? [];
    expect(drops.some((drop) => drop.itemId === "raw_chicken" && drop.count === 1)).toBe(true);
    expect(drops.filter((drop) => drop.itemId === "raw_chicken")).toHaveLength(1);
    world.snapshots(1_502);
    expect(alex.ofType("mob_snapshot").at(-1)?.states.find((mob) => mob.mobId === chicken.mobId)?.health).toBe(0);
    store.close();
  });

  test("commits one Railway creeper blast to world chunks and player health", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config({
      daylightCycle: false,
      dayPhase: 0.95,
      mobsEnabled: true,
      maxPersistedBlocks: 1_000,
    }), store, authenticator);
    const alex = new FakePeer("creeper-victim");
    world.open(alex, 1_000);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 1_000);
    world.tick(1_050); world.tick(1_100); world.snapshots(1_100);
    const creeper = alex.ofType("mob_snapshot").at(-1)!.poses.find((pose) => pose.kind === "creeper")!;

    let x = 0.5, y = 69.02, z = 0.5, seq = 0;
    const target = { x: creeper.x + 1.4, y: creeper.y, z: creeper.z };
    while (Math.hypot(target.x - x, target.y - y, target.z - z) > 0.01) {
      const distance = Math.hypot(target.x - x, target.y - y, target.z - z);
      const step = Math.min(1.25, distance);
      x += (target.x - x) / distance * step;
      y += (target.y - y) / distance * step;
      z += (target.z - z) / distance * step;
      await world.message(alex, JSON.stringify({
        v: 1, type: "input", seq: ++seq, dtMs: 50, moveX: 0, moveZ: 0,
        yaw: 0, pitch: 0, jump: false, sprint: false, x, y, z,
      }), 1_100 + seq);
    }
    await world.message(alex, JSON.stringify({
      v: 1,
      type: "chunk_subscribe",
      seq: 1,
      centerX: Math.floor(creeper.x / 16),
      centerZ: Math.floor(creeper.z / 16),
      radius: 2,
      known: [],
    }), 1_200);
    for (let tick = 0; tick < 50; tick += 1) world.tick(1_250 + tick * 50);
    world.snapshots(4_000);
    const crater = alex.ofType("block_patch").filter((message) => message.edit.editorId === creeper.mobId);
    expect(crater.length).toBeGreaterThan(0);
    expect(new Set(crater.map((message) => message.edit.revision)).size).toBe(crater.length);
    expect(store.getRevision()).toBe(crater.length);
    expect(alex.ofType("player_hit").some((hit) => hit.attackerId === creeper.mobId)).toBe(true);
    expect(alex.ofType("mob_snapshot").at(-1)!.poses.some((pose) => pose.mobId === creeper.mobId)).toBe(false);
    const revision = store.getRevision();
    for (let tick = 0; tick < 20; tick += 1) world.tick(4_050 + tick * 50);
    expect(store.getRevision()).toBe(revision);
    store.close();
  });

  test("keeps Creative servers mob-free by default", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config({ worldPreset:"superflat",defaultGameMode:"creative" }), store, authenticator);
    const peer = new FakePeer("creative-mobs");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("builder")), 1_000);
    world.tick(1_100); world.snapshots(1_100);
    expect(peer.ofType("mob_snapshot").at(-1)).toMatchObject({ poses:[],states:[] });
    store.close();
  });

  test("persists block edits and acknowledges exact operation retries without another revision", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config({ defaultGameMode:"creative" }), store, authenticator);
    const peer = new FakePeer("socket-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    const edit = authoritativeBlockEdit({ operationId:"place-operation-0001",seq:1,x:0,y:69,z:1,block:BLOCK_ID_MAX });
    await world.message(peer, JSON.stringify(edit), 1_100);
    await world.message(peer, JSON.stringify(edit), 1_200);
    const patches = peer.ofType("block_patch");
    expect(patches).toHaveLength(2);
    expect(patches[0].operationId).toBe("place-operation-0001");
    expect(patches[1].edit.revision).toBe(patches[0].edit.revision);
    expect(store.getRevision()).toBe(1);

    const latePeer = new FakePeer("socket-late");
    world.open(latePeer, 1_300);
    await world.message(latePeer, JSON.stringify(join("steve")), 1_300);
    expect(latePeer.ofType("world_snapshot")).toHaveLength(0);
    await world.message(latePeer, JSON.stringify({
      v: 1, type: "chunk_subscribe", seq: 1, centerX: 0, centerZ: 0, radius: 1, known: [],
    }), 1_301);
    const streamedChunk = latePeer.ofType("world_chunks")
      .flatMap((message) => message.chunks)
      .find((chunk) => chunk.x === 0 && chunk.z === 0);
    expect(streamedChunk?.revision).toBe(1);
    expect(streamedChunk!.data.startsWith("v2:")).toBe(true);
    expect(decodeRealtimeChunkEdits(0, 0, streamedChunk!.data)).toContainEqual({ x: 0, y: 69, z: 1, block: BLOCK_ID_MAX });

    const legacyPeer = new FakePeer("socket-legacy");
    world.open(legacyPeer, 1_400);
    await world.message(legacyPeer, JSON.stringify({
      v:1,type:"join",demo:{token:"0123456789abcdef",userId:"legacy",name:"Legacy"},
    }), 1_400);
    expect(legacyPeer.ofType("hello")[0].capabilities).toContain(WORLD_CHUNKS_LEGACY_CAPABILITY);
    await world.message(legacyPeer, JSON.stringify({
      v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[],
    }), 1_401);
    const legacyChunk = legacyPeer.ofType("world_chunks")
      .flatMap((message) => message.chunks)
      .find((chunk) => chunk.x === 0 && chunk.z === 0)!;
    expect(legacyChunk.data.startsWith("v2:")).toBe(false);
    expect(decodeRealtimeChunkEdits(0, 0, legacyChunk.data)).not.toContainEqual({ x:0,y:69,z:1,block:BLOCK_ID_MAX });
    await world.message(peer, JSON.stringify(authoritativeBlockEdit({
      operationId:"place-v2-only-0001",seq:2,x:0,y:69,z:2,block:BLOCK_ID_MAX,chunkRevision:1,
    })), 1_500);
    expect(legacyPeer.ofType("block_patch")).toHaveLength(0);
    const revisionBeforeLegacyEdits = store.getRevision();
    await world.message(legacyPeer, JSON.stringify({
      v:1,type:"block_edit",operationId:"erase-hidden-v2",seq:1,x:0,y:69,z:1,block:0,
    }), 1_510);
    await world.message(legacyPeer, JSON.stringify({
      v:1,type:"block_edit",operationId:"place-unsupported-v2",seq:2,x:0,y:69,z:3,block:499,
    }), 1_520);
    await world.message(legacyPeer,JSON.stringify({
      v:1,type:"block_edit",operationId:"legacy-raw-place",seq:3,x:0,y:69,z:4,block:2,
    }),1_530);
    await world.message(legacyPeer,JSON.stringify({
      v:1,type:"block_edit",operationId:"legacy-raw-mine",seq:4,x:0,y:68,z:0,block:0,
    }),1_540);
    expect(legacyPeer.ofType("error").slice(-4).map((message) => message.operationId)).toEqual([
      "erase-hidden-v2", "place-unsupported-v2", "legacy-raw-place", "legacy-raw-mine",
    ]);
    expect(store.getRevision()).toBe(revisionBeforeLegacyEdits);
    expect(store.getBlockEditsSince(0, 16)).toContainEqual(expect.objectContaining({
      x:0,y:69,z:1,block:BLOCK_ID_MAX,
    }));
    store.close();
  });

  test("acknowledges a legacy receipt with current state without rebroadcasting its stale patch", async () => {
    const store = new WorldStore(":memory:");
    expect(store.applyBlockEdit({
      operationId:"legacy-receipt-a",x:1,y:69,z:1,block:1,editorId:"alex",editedAt:1_000,
    },100)?.edit.revision).toBe(1);
    expect(store.applyBlockEdit({
      operationId:"legacy-receipt-b",x:1,y:69,z:1,block:2,editorId:"steve",editedAt:1_010,
    },100)?.edit.revision).toBe(2);
    const world = new GameWorld(config({defaultGameMode:"creative"}),store,authenticator);
    const author = new FakePeer("legacy-replay-author");
    const observer = new FakePeer("legacy-replay-observer");
    world.open(author,2_000); world.open(observer,2_000);
    await world.message(author,JSON.stringify(join("alex")),2_000);
    await world.message(observer,JSON.stringify(join("observer")),2_000);
    await world.message(observer,JSON.stringify({
      v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[],
    }),2_001);
    const observerPatches = observer.ofType("block_patch").length;
    await world.message(author,JSON.stringify({
      v:1,type:"block_edit",operationId:"legacy-receipt-a",seq:1,x:1,y:69,z:1,block:1,
    }),2_010);
    expect(author.ofType("block_patch").at(-1)).toMatchObject({
      operationId:"legacy-receipt-a",edit:{x:1,y:69,z:1,block:2,revision:2},
    });
    expect(observer.ofType("block_patch")).toHaveLength(observerPatches);
    expect(store.getRevision()).toBe(2);
    store.close();
  });

  test("streams only subscribed chunks, skips known revisions, and scopes live patches", async()=>{
    const store=new WorldStore(":memory:"),world=new GameWorld(config({defaultGameMode:"creative"}),store,authenticator);
    const near=new FakePeer("chunk-near"),far=new FakePeer("chunk-far");
    world.open(near,1000);world.open(far,1000);
    await world.message(near,JSON.stringify(join("near","Near")),1000);
    await world.message(far,JSON.stringify(join("far","Far")),1000);
    await world.message(near,JSON.stringify({v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[]}),1010);
    await world.message(far,JSON.stringify({v:1,type:"chunk_subscribe",seq:1,centerX:20,centerZ:20,radius:1,known:[]}),1010);
    await world.message(near,JSON.stringify(authoritativeBlockEdit({operationId:"chunk-scope-0001",seq:1,x:0,y:69,z:1,block:4})),1020);
    expect(near.ofType("block_patch").at(-1)?.edit).toMatchObject({x:0,z:1,revision:1});
    expect(far.ofType("block_patch")).toHaveLength(0);
    const before=near.ofType("world_chunks").length;
    const known=near.ofType("world_chunks").flatMap((message)=>message.chunks).map((chunk)=>({x:chunk.x,z:chunk.z,revision:chunk.x===0&&chunk.z===0?1:chunk.revision}));
    await world.message(near,JSON.stringify({v:1,type:"chunk_subscribe",seq:2,centerX:0,centerZ:0,radius:1,known}),1030);
    expect(near.ofType("world_chunks")).toHaveLength(before + 1);
    expect(near.ofType("world_chunks").at(-1)).toMatchObject({chunks:[],complete:true});
    await world.message(near,JSON.stringify({v:1,type:"chunk_subscribe",seq:3,centerX:20,centerZ:20,radius:1,known:[]}),1040);
    expect(near.ofType("world_chunks_unload").at(-1)?.chunks).toHaveLength(9);
    store.close();
  });

  test("rejects raw-client block and drop minting while conserving current survival actions", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("raw-adversary");
    const observer = new FakePeer("drop-observer");
    world.open(peer, 1_000); world.open(observer,1_000);
    await world.message(peer, JSON.stringify(join("raw-user")), 1_000);
    await world.message(observer,JSON.stringify(join("observer")),1_000);
    await world.message(observer,JSON.stringify({
      v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[],
    }),1_001);
    await world.message(peer, JSON.stringify({
      v:1,type:"block_edit",operationId:"raw_block_mint_0001",seq:1,x:0,y:69,z:1,block:2,
    }), 1_010);
    expect(peer.ofType("error").at(-1)).toMatchObject({operationId:"raw_block_mint_0001"});
    expect(store.getRevision()).toBe(0);

    await world.message(peer, JSON.stringify(authoritativeBlockEdit({
      operationId:"conserved_place_0001",seq:2,x:0,y:69,z:1,block:2,
    })), 1_020);
    expect(peer.ofType("block_patch").at(-1)).toMatchObject({edit:{block:2,revision:1}});
    expect(peer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"2"});

    const mine = authoritativeBlockEdit({
      operationId:"conserved_mine_0001",seq:3,x:0,y:69,z:1,block:0,
      previousBlock:2,chunkRevision:1,inventoryRevision:2,
    });
    await world.message(peer,JSON.stringify(mine),1_025);
    expect(peer.ofType("block_patch").at(-1)).toMatchObject({edit:{block:0,revision:2}});
    expect(peer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"2"});
    expect(observer.ofType("drop_snapshot").at(-1)?.drops).toEqual([
      expect.objectContaining({dropId:"drop:mine:conserved_mine_0001",itemId:"dirt",count:1}),
    ]);
    await world.message(peer,JSON.stringify(mine),1_026);
    expect(store.listDrops(1_026).filter((drop)=>drop.dropId.startsWith("drop:mine:"))).toHaveLength(1);

    const rawCreditJson = JSON.stringify({
      operationId:"raw_world_credit_0001",expectedRevision:"1",kind:"world_credit",
      stack:{itemId:"diamond",count:64},
    });
    await world.message(observer,JSON.stringify({
      v:1,type:"inventory_action",requestJson:rawCreditJson,
    }),1_030);
    expect(observer.ofType("error").at(-1)).toMatchObject({code:"bad_message",operationId:"raw_world_credit_0001"});
    expect(observer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"1"});

    const pickup = {
      v:1,type:"pickup_item",operationId:"pickup_mined_drop_0001",dropId:"drop:mine:conserved_mine_0001",
    } as const;
    await world.message(observer,JSON.stringify(pickup),2_025);
    expect(observer.ofType("drop_result").at(-1)).toMatchObject({
      operationId:"pickup_mined_drop_0001",action:"pickup",drop:{itemId:"dirt",count:1},
    });
    expect(observer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"2"});
    const pickedState = validatePlayerStateJson(observer.ofType("inventory_state").at(-1)!.inventory.inventoryJson);
    expect(pickedState.ok && countItem(pickedState.state.inventory,"dirt")).toBe(17);
    await world.message(observer,JSON.stringify(pickup),2_026);
    expect(observer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"2"});
    expect(store.listDrops(2_026)).toHaveLength(0);

    await world.message(peer, JSON.stringify({
      v:1,type:"drop_item",operationId:"raw_drop_mint_0001",itemId:"diamond",count:64,
      x:0.5,y:69.02,z:0.5,
    }), 2_030);
    expect(peer.ofType("error").at(-1)).toMatchObject({operationId:"raw_drop_mint_0001"});
    expect(store.listDrops(2_030)).toHaveLength(0);
    const qDrop = {
      v:1,type:"drop_item",operationId:"conserved_drop_0001",itemId:"dirt",count:1,sourceSlot:2,
      x:0.5,y:69.02,z:0.5,
    } as const;
    await world.message(peer, JSON.stringify(qDrop), 2_040);
    expect(peer.ofType("drop_result").at(-1)).toMatchObject({operationId:"conserved_drop_0001",drop:{itemId:"dirt",count:1}});
    expect(peer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"3"});
    const qDropId = peer.ofType("drop_result").at(-1)!.drop!.dropId;
    await world.message(observer,JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_q_drop_0001",dropId:qDropId,
    }),3_040);
    expect(store.listDrops(3_040)).toHaveLength(0);
    await world.message(peer,JSON.stringify(qDrop),3_041);
    expect(peer.ofType("drop_result").at(-1)).toMatchObject({operationId:"conserved_drop_0001",drop:{dropId:qDropId}});
    expect(store.listDrops(3_041)).toHaveLength(0);
    expect(observer.ofType("drop_snapshot").at(-1)?.drops).toEqual([]);

    const observerPatchCount = observer.ofType("block_patch").length;
    const observerDropCount = observer.ofType("drop_snapshot").length;
    const originalPlace = authoritativeBlockEdit({
      operationId:"conserved_place_0001",seq:2,x:0,y:69,z:1,block:2,
    });
    await world.message(peer,JSON.stringify(originalPlace),3_050);
    expect(peer.ofType("block_patch").at(-1)).toMatchObject({
      operationId:"conserved_place_0001",edit:{x:0,y:69,z:1,block:0,revision:2},
    });
    expect(peer.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"3"});
    expect(observer.ofType("block_patch")).toHaveLength(observerPatchCount);
    expect(observer.ofType("drop_snapshot")).toHaveLength(observerDropCount);
    expect(store.getRevision()).toBe(2);
    expect(store.listDrops(3_050)).toHaveLength(0);

    world.close(peer);
    const restarted = new GameWorld(config(), store, authenticator);
    const resumed = new FakePeer("raw-restarted");
    const restartObserver = new FakePeer("raw-restart-observer");
    restarted.open(resumed,4_000); restarted.open(restartObserver,4_000);
    await restarted.message(resumed,JSON.stringify(join("raw-user")),4_000);
    await restarted.message(restartObserver,JSON.stringify(join("restart-observer")),4_000);
    await restarted.message(restartObserver,JSON.stringify({
      v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[],
    }),4_001);
    const restartObserverPatches = restartObserver.ofType("block_patch").length;
    const restartObserverDrops = restartObserver.ofType("drop_snapshot").length;
    await restarted.message(resumed,JSON.stringify(originalPlace),4_010);
    expect(resumed.ofType("block_patch").at(-1)).toMatchObject({
      operationId:"conserved_place_0001",edit:{x:0,y:69,z:1,block:0,revision:2},
    });
    expect(resumed.ofType("inventory_state").at(-1)?.inventory).toMatchObject({revision:"3"});
    expect(restartObserver.ofType("block_patch")).toHaveLength(restartObserverPatches);
    expect(restartObserver.ofType("drop_snapshot")).toHaveLength(restartObserverDrops);
    expect(store.getRevision()).toBe(2);
    expect(store.listDrops(4_010)).toHaveLength(0);
    store.close();
  });

  test("runs shared pack actions on the realtime authority and restores them on reconnect", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("inventory-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    expect(peer.ofType("inventory_state")[0]?.inventory).toMatchObject({ userId:"alex",revision:"1" });

    const requestJson = JSON.stringify({
      operationId:"inventory_place_0001",expectedRevision:"1",kind:"place_block",sourceSlot:2,expectedItemId:"dirt",
    });
    await world.message(peer, JSON.stringify({ v:1,type:"inventory_action",requestJson }), 1_010);
    await world.message(peer, JSON.stringify({ v:1,type:"inventory_action",requestJson }), 1_020);
    expect(peer.ofType("inventory_result").slice(-2)).toMatchObject([
      { operationId:"inventory_place_0001",result:{ ok:true,replayed:false,inventory:{ revision:"2" } } },
      { operationId:"inventory_place_0001",result:{ ok:true,replayed:true,inventory:{ revision:"2" } } },
    ]);
    world.close(peer);

    const resumed = new FakePeer("inventory-b");
    world.open(resumed, 1_040);
    await world.message(resumed, JSON.stringify(join("alex")), 1_040);
    expect(resumed.ofType("inventory_state")[0]?.inventory).toMatchObject({ userId:"alex",revision:"2" });
    store.close();
  });

  test("acknowledges canonical browser poses without integrating them twice", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("pose-socket");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("pose-user")), 1_000);
    await world.message(peer, JSON.stringify({
      v:1, type:"input", seq:1, dtMs:50, moveX:1, moveZ:0, yaw:0.4, pitch:0,
      jump:false, sprint:true, x:0.78, y:69.02, z:0.5,
    }), 1_050);
    for (let now = 1_051; now <= 1_250; now += 50) world.tick(now);
    world.snapshots(1_251);
    expect(peer.ofType("snapshot").at(-1)?.self).toMatchObject({ x:0.78, y:69.02, z:0.5 });
    store.close();
  });

  test("broadcasts crouch state, held items, and player-to-player item transfers", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("drop-a");
    const steve = new FakePeer("drop-b");
    world.open(alex, 1_000); world.open(steve, 1_000);
    const initial = createInitializedPlayerState();
    initial.inventory[2] = { itemId:"diamond_pickaxe",count:1,durability:120 };
    await world.message(alex, JSON.stringify(join("alex", "alex", undefined, JSON.stringify(initial))), 1_000);
    await world.message(steve, JSON.stringify(join("steve")), 1_000);
    await world.message(alex, JSON.stringify({ v:1,type:"action",seq:1,kind:"crouch_on" }), 1_010);
    await world.message(alex, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,sprint:false,heldItem:"diamond_pickaxe",
      x:0.5,y:69.02,z:0.5,
    }), 1_011);
    world.snapshots(1_012);
    expect(steve.ofType("snapshot").at(-1)?.players[0]).toMatchObject({ crouching:true, heldItem:"diamond_pickaxe" });
    await world.message(alex, JSON.stringify({
      v:1,type:"drop_item",operationId:"drop_transfer_1",itemId:"diamond_pickaxe",count:1,durability:120,sourceSlot:2,x:0.5,y:69.02,z:0.5,
    }), 1_020);
    const drop = alex.ofType("drop_result").at(-1)?.drop;
    expect(drop).toMatchObject({ itemId:"diamond_pickaxe", durability:120, ownerUserId:"alex" });
    await world.message(steve, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_transfer_early",dropId:drop!.dropId,
    }), 2_019);
    expect(steve.ofType("error").at(-1)).toMatchObject({ operationId:"pickup_transfer_early" });
    await world.message(steve, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_transfer_1",dropId:drop!.dropId,
    }), 2_020);
    expect(steve.ofType("drop_result").at(-1)).toMatchObject({ action:"pickup", drop:{ dropId:drop!.dropId } });
    await world.message(steve, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_transfer_1",dropId:drop!.dropId,
    }), 2_021);
    expect(steve.ofType("drop_result").slice(-2)).toEqual([
      expect.objectContaining({ action:"pickup", drop:expect.objectContaining({ dropId:drop!.dropId }) }),
      expect.objectContaining({ action:"pickup", drop:expect.objectContaining({ dropId:drop!.dropId }) }),
    ]);
    expect(alex.ofType("drop_snapshot").at(-1)?.drops).toEqual([]);
    store.close();
  });

  test("settles tossed items and lets a stationary owner recollect after the universal delay", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const owner = new FakePeer("toss-owner");
    world.open(owner, 1_000);
    await world.message(owner, JSON.stringify(join("alex")), 1_000);
    await world.message(owner, JSON.stringify({
      v:1,type:"drop_item",operationId:"drop_toss_gravity",itemId:"dirt",count:1,sourceSlot:2,
      x:0.5,y:69.67,z:0.5,
    }), 1_010);
    const dropId = owner.ofType("drop_result").at(-1)!.drop!.dropId;
    for (let now = 1_050; now <= 1_800; now += 50) world.tick(now);
    const settled = owner.ofType("drop_snapshot").at(-1)!.drops[0];
    expect(settled).toMatchObject({ dropId, y:69, ownerPickupAt:2_010 });
    await world.message(owner, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_still_blocked",dropId,
    }), 2_009);
    expect(owner.ofType("error").at(-1)).toMatchObject({ operationId:"pickup_still_blocked" });
    await world.message(owner, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_after_timer",dropId,
    }), 2_010);
    expect(owner.ofType("drop_result").at(-1)).toMatchObject({ action:"pickup",drop:{ dropId } });
    store.close();
  });

  test("atomically publishes a dead player's authoritative pack for another client", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const dead = new FakePeer("dead-picker");
    const owner = new FakePeer("death-drop-owner");
    world.open(dead, 1_000); world.open(owner, 1_000);
    await world.message(dead, JSON.stringify(join("alex")), 1_000);
    await world.message(owner, JSON.stringify(join("steve")), 1_000);
    await world.message(owner, JSON.stringify({
      v:1,type:"drop_item",operationId:"death_drop_nearby",itemId:"dirt",count:4,sourceSlot:2,
      x:0.5,y:69.02,z:0.5,
    }), 1_010);
    const dropId = owner.ofType("drop_result").at(-1)!.drop!.dropId;
    await world.message(dead, JSON.stringify({
      v:1,type:"self_damage",operationId:"fall_fatal_picker",damage:20,cause:"fall",
    }), 1_020);
    const deadDebitJson = JSON.stringify({
      operationId:"dead_pack_debit_0001",expectedRevision:"1",kind:"world_debit",sourceSlot:2,
      stack:{itemId:"dirt",count:1},
    });
    await world.message(dead,JSON.stringify({v:1,type:"inventory_action",requestJson:deadDebitJson}),1_020);
    expect(dead.ofType("error").at(-1)).toMatchObject({operationId:"dead_pack_debit_0001"});
    const settleJson = JSON.stringify({
      operationId:"death_settlement_0001",expectedRevision:"1",kind:"death_settle",eventId:"fall_fatal_picker",
    });
    await world.message(dead,JSON.stringify({v:1,type:"inventory_action",requestJson:settleJson}),1_021);
    expect(dead.ofType("inventory_result").at(-1)).toMatchObject({
      operationId:"death_settlement_0001",result:{ok:true,replayed:false,effect:"death_settled",inventory:{revision:"2"}},
    });
    const settledState = validatePlayerStateJson((dead.ofType("inventory_result").at(-1)!.result as {inventory:{inventoryJson:string}}).inventory.inventoryJson);
    expect(settledState.ok && settledState.state.inventory.every((stack)=>stack===null)).toBe(true);
    const deathDrops = owner.ofType("drop_snapshot").at(-1)!.drops.filter((drop)=>drop.ownerUserId==="alex");
    expect(deathDrops.length).toBeGreaterThan(0);
    const countBeforeRetry = store.listDrops(1_022).length;
    await world.message(dead,JSON.stringify({v:1,type:"inventory_action",requestJson:settleJson}),1_022);
    expect(dead.ofType("inventory_result").at(-1)).toMatchObject({result:{ok:true,replayed:true,inventory:{revision:"2"}}});
    expect(store.listDrops(1_022)).toHaveLength(countBeforeRetry);
    await world.message(dead,JSON.stringify({
      v:1,type:"drop_item",operationId:"dead_raw_stack_0001",itemId:"diamond",count:64,
      x:0.5,y:69.02,z:0.5,
    }),1_023);
    expect(dead.ofType("error").at(-1)).toMatchObject({operationId:"dead_raw_stack_0001"});
    expect(store.listDrops(1_023)).toHaveLength(countBeforeRetry);
    await world.message(dead, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_while_dead",dropId,
    }), 2_010);
    expect(dead.ofType("error").at(-1)).toMatchObject({ operationId:"pickup_while_dead" });
    const transferable = deathDrops[0];
    await world.message(owner,JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_death_pack_0001",dropId:transferable.dropId,
    }),2_021);
    expect(owner.ofType("drop_result").at(-1)).toMatchObject({action:"pickup",drop:{dropId:transferable.dropId}});
    expect(store.listDrops(2_021)).toHaveLength(countBeforeRetry-1);
    store.close();
  });

  test("applies authoritative PvP damage once with reach, cooldown, and persisted health", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("pvp-a");
    const steve = new FakePeer("pvp-b");
    world.open(alex, 1_000); world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex","alex",undefined,selectedInventory("iron_sword"))), 1_000);
    await world.message(steve, JSON.stringify(join("steve")), 1_000);
    await world.message(alex, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,sprint:false,
      heldItem:"iron_sword",x:0.5,y:69.02,z:0.5,
    }), 1_010);
    await world.message(steve, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:250,moveX:0,moveZ:0,yaw:Math.PI,pitch:0,jump:false,sprint:false,
      x:0.5,y:69.02,z:-1.5,
    }), 1_011);
    const attack = { v:1,type:"player_attack",operationId:"attack:exactly-once",targetId:"steve" };
    await world.message(alex, JSON.stringify(attack), 1_100);
    await world.message(alex, JSON.stringify(attack), 1_101);
    expect(alex.ofType("player_hit").slice(-2).map((hit) => hit.health)).toEqual([14, 14]);
    expect(steve.ofType("player_hit")).toHaveLength(1);
    expect(steve.ofType("player_hit")[0]).toMatchObject({ damage:6, health:14, killed:false });
    expect(store.loadPlayer("steve")?.player.health).toBe(14);

    await world.message(alex, JSON.stringify({ ...attack, operationId:"attack:cooldown" }), 1_200);
    expect(alex.ofType("error").at(-1)).toMatchObject({ code:"rate_limited", operationId:"attack:cooldown" });
    await world.message(alex, JSON.stringify({ ...attack, operationId:"attack:ready" }), 1_600);
    expect(steve.ofType("player_hit").at(-1)).toMatchObject({ health:8 });
    world.setPlayerGameMode("steve", "creative");
    await world.message(alex, JSON.stringify({ ...attack, operationId:"attack:creative" }), 2_100);
    expect(alex.ofType("error").at(-1)).toMatchObject({ code:"bad_message", operationId:"attack:creative" });
    expect(store.loadPlayer("steve")?.player.health).toBe(8);
    store.close();
  });

  test("treats claimed held diamond sword as visual-only without canonical ownership",async()=>{
    const store=new WorldStore(":memory:"),world=new GameWorld(config(),store,authenticator);
    const liar=new FakePeer("liar"),target=new FakePeer("honest");world.open(liar,1_000);world.open(target,1_000);
    await world.message(liar,JSON.stringify(join("liar")),1_000);
    await world.message(target,JSON.stringify(join("honest")),1_000);
    await world.message(liar,JSON.stringify({v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,
      jump:false,sprint:false,heldItem:"diamond_sword",x:0.5,y:69.02,z:0.5}),1_010);
    await world.message(target,JSON.stringify({v:1,type:"input",seq:1,dtMs:250,moveX:0,moveZ:0,yaw:Math.PI,pitch:0,
      jump:false,sprint:false,x:0.5,y:69.02,z:-1.5}),1_011);
    await world.message(liar,JSON.stringify({v:1,type:"player_attack",operationId:"claimed_diamond_no_ownership_1",targetId:"honest"}),1_100);
    expect(target.ofType("player_hit").at(-1)).toMatchObject({damage:1,health:19,killed:false});
    expect(store.loadPlayer("honest")?.player.health).toBe(19);
    store.close();
  });

  test("acks durable combat replays without rolling live health or rebroadcasting historical hits",async()=>{
    const store=new WorldStore(":memory:");
    const first=new GameWorld(config(),store,authenticator),a1=new FakePeer("replay-a1"),t1=new FakePeer("replay-t1");
    first.open(a1,1_000);first.open(t1,1_000);
    await first.message(a1,JSON.stringify(join("replay-attacker","replay-attacker",undefined,selectedInventory("iron_sword"))),1_000);
    await first.message(t1,JSON.stringify(join("replay-target")),1_000);
    await first.message(a1,JSON.stringify({v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,sprint:false,x:0.5,y:69.02,z:0.5}),1_010);
    await first.message(t1,JSON.stringify({v:1,type:"input",seq:1,dtMs:250,moveX:0,moveZ:0,yaw:Math.PI,pitch:0,jump:false,sprint:false,x:0.5,y:69.02,z:-1.5}),1_011);
    for(const [operationId,at] of [["combat_replay_old_1",1_100],["combat_replay_new_1",1_600],
      ["combat_replay_new_2",2_100],["combat_replay_fatal_1",2_600]] as const)
      await first.message(a1,JSON.stringify({v:1,type:"player_attack",operationId,targetId:"replay-target"}),at);
    expect(store.loadPlayer("replay-target")?.player.health).toBe(0);

    const restarted=new GameWorld(config(),store,authenticator),a2=new FakePeer("replay-a2"),t2=new FakePeer("replay-t2");
    restarted.open(a2,3_000);restarted.open(t2,3_000);
    await restarted.message(a2,JSON.stringify(join("replay-attacker")),3_000);
    await restarted.message(t2,JSON.stringify(join("replay-target")),3_000);
    await restarted.message(a2,JSON.stringify({v:1,type:"player_attack",operationId:"combat_replay_old_1",targetId:"replay-target"}),3_100);
    expect(a2.ofType("player_hit").at(-1)).toMatchObject({operationId:"combat_replay_old_1",health:0,killed:true});
    await restarted.message(a2,JSON.stringify({v:1,type:"player_attack",operationId:"combat_replay_fatal_1",targetId:"replay-target"}),3_101);
    expect(a2.ofType("player_hit").at(-1)).toMatchObject({operationId:"combat_replay_fatal_1",health:0,killed:true});
    expect(t2.ofType("player_hit")).toHaveLength(0);
    restarted.snapshots(3_102);
    expect(t2.ofType("snapshot").at(-1)?.self.health).toBe(0);
    expect(store.loadPlayer("replay-target")?.player.health).toBe(0);

    await restarted.message(a2,JSON.stringify({v:1,type:"self_damage",operationId:"self_replay_old_1",damage:2,cause:"fall"}),3_200);
    await restarted.message(a2,JSON.stringify({v:1,type:"self_damage",operationId:"self_replay_fatal_1",damage:20,cause:"fall"}),3_400);
    expect(store.loadPlayer("replay-attacker")?.player.health).toBe(0);
    const third=new GameWorld(config(),store,authenticator),t3=new FakePeer("replay-t3");third.open(t3,4_000);
    await third.message(t3,JSON.stringify(join("replay-attacker")),4_000);
    await third.message(t3,JSON.stringify({v:1,type:"self_damage",operationId:"self_replay_old_1",damage:2,cause:"fall"}),4_100);
    expect(t3.ofType("self_damage_result").at(-1)).toMatchObject({health:0,killed:true});
    third.snapshots(4_101);
    expect(t3.ofType("snapshot").at(-1)?.self.health).toBe(0);
    store.close();
  });

  test("acks fatal mob retries before pose eligibility with the current mob state only",async()=>{
    const store=new WorldStore(":memory:");
    store.savePlayer({id:"mob-replay",name:"mob-replay",x:0.5,y:69.02,z:0.5,yaw:0,pitch:0,health:20},"mob-replay-token",900,10_000);
    store.ensurePlayerInventory("mob-replay",selectedInventory("diamond_sword"),900);
    for(let index=0;index<3;index+=1)expect(store.applyMobAttack("mob-replay",`mob_replay_hit_${index}`,
      "zombie-5nb-0","zombie",1_000+index*500)).toMatchObject({ok:true});
    expect(store.mobAuthorityState("zombie-5nb-0","zombie",2_001).health).toBe(0);
    const world=new GameWorld(config({mobsEnabled:false}),store,authenticator),fighter=new FakePeer("mob-replay-fighter"),observer=new FakePeer("mob-replay-observer");
    world.open(fighter,2_100);world.open(observer,2_100);
    await world.message(fighter,JSON.stringify(join("mob-replay")),2_100);
    await world.message(observer,JSON.stringify(join("mob-observer")),2_100);
    await world.message(fighter,JSON.stringify({v:1,type:"mob_attack",operationId:"mob_replay_hit_2",mobId:"zombie-5nb-0"}),2_200);
    expect(fighter.ofType("mob_hit").at(-1)).toMatchObject({replayed:true,killed:true,state:{health:0}});
    expect(observer.ofType("mob_hit")).toHaveLength(0);
    const later=new GameWorld(config({mobsEnabled:false}),store,authenticator),latePeer=new FakePeer("mob-replay-later");
    later.open(latePeer,32_500);await later.message(latePeer,JSON.stringify(join("mob-replay")),32_500);
    await later.message(latePeer,JSON.stringify({v:1,type:"mob_attack",operationId:"mob_replay_hit_2",mobId:"zombie-5nb-0"}),32_600);
    expect(latePeer.ofType("mob_hit").at(-1)).toMatchObject({replayed:true,killed:false,state:{health:20}});
    store.close();
  });

  test("persists exact-once fall damage instead of restoring health from snapshots", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("fall-socket");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    const fall = { v:1,type:"self_damage",operationId:"fall:exactly-once",damage:7,cause:"fall" };
    await world.message(peer, JSON.stringify(fall), 1_200);
    await world.message(peer, JSON.stringify(fall), 1_201);
    expect(peer.ofType("self_damage_result").slice(-2)).toEqual([
      expect.objectContaining({ damage:7,health:13,killed:false,cause:"fall" }),
      expect.objectContaining({ damage:7,health:13,killed:false,cause:"fall" }),
    ]);
    world.snapshots(1_202);
    expect(peer.ofType("snapshot").at(-1)?.self.health).toBe(13);
    expect(store.loadPlayer("alex")?.player.health).toBe(13);
    await world.message(peer, JSON.stringify({ ...fall, operationId:"fall:fatal", damage:20 }), 1_400);
    expect(peer.ofType("self_damage_result").at(-1)).toMatchObject({ damage:13,health:0,killed:true });
    store.close();
  });

  test("rejects raw respawn while alive", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("respawn-socket");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    await world.message(peer, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:1,pitch:0.2,jump:false,sprint:false,
      x:12,y:80,z:-6,
    }), 1_050);
    await world.message(peer, JSON.stringify({ v:1,type:"respawn",operationId:"respawn_test_1" }), 1_100);
    expect(peer.ofType("respawned")).toHaveLength(0);
    expect(peer.ofType("error").at(-1)).toMatchObject({operationId:"respawn_test_1"});
    expect(store.loadPlayer("alex")?.player.health).toBe(20);
    store.close();
  });

  test("freezes a dead pose and atomically clears crouch/action state on respawn", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const attacker = new FakePeer("death-attacker");
    const target = new FakePeer("death-target");
    world.open(attacker, 1_000); world.open(target, 1_000);
    await world.message(attacker, JSON.stringify(join("attacker","attacker",undefined,selectedInventory("diamond_sword"))), 1_000);
    await world.message(target, JSON.stringify(join("target")), 1_000);
    await world.message(attacker, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,sprint:false,
      heldItem:"iron_sword",x:0.5,y:69.02,z:0.5,
    }), 1_010);
    await world.message(target, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:250,moveX:0,moveZ:0,yaw:Math.PI,pitch:0,jump:false,sprint:false,
      x:0.5,y:69.02,z:-1.5,
    }), 1_011);
    await world.message(target, JSON.stringify({ v:1,type:"action",seq:1,kind:"crouch_on" }), 1_012);
    for (let hit = 0; hit < 4; hit += 1) {
      await world.message(attacker, JSON.stringify({
        v:1,type:"player_attack",operationId:`attack:death-${hit}`,targetId:"target",
      }), 1_100 + hit * 500);
    }
    expect(target.ofType("player_hit").at(-1)).toMatchObject({ health:0, killed:true });
    await world.message(target, JSON.stringify({
      v:1,type:"input",seq:2,dtMs:50,moveX:1,moveZ:0,yaw:1,pitch:0.2,jump:true,sprint:true,
      x:1.5,y:80,z:-1.5,
    }), 2_700);
    await world.message(target, JSON.stringify({ v:1,type:"action",seq:2,kind:"crouch_on" }), 2_701);
    world.tick(2_750); world.snapshots(2_751);
    expect(target.ofType("snapshot").at(-1)?.self).toMatchObject({ x:0.5,y:69.02,z:-1.5,health:0,crouching:false,visualActions:[] });
    await world.message(target,JSON.stringify({v:1,type:"respawn",operationId:"respawn_before_settle_1"}),2_780);
    expect(target.ofType("respawned")).toHaveLength(0);
    expect(target.ofType("error").at(-1)).toMatchObject({operationId:"respawn_before_settle_1"});
    await world.message(target,JSON.stringify({v:1,type:"inventory_action",requestJson:JSON.stringify({
      operationId:"death_settle_respawn_0001",expectedRevision:"1",kind:"death_settle",eventId:"untrusted-client-event",
    })}),2_790);
    expect(target.ofType("inventory_result").at(-1)).toMatchObject({result:{ok:true,effect:"death_settled"}});
    await world.message(target, JSON.stringify({ v:1,type:"respawn",operationId:"respawn_death_1" }), 2_800);
    world.snapshots(2_801);
    expect(target.ofType("snapshot").at(-1)?.self).toMatchObject({
      x:0.5,y:69.02,z:0.5,health:20,crouching:false,visualActions:[],
    });
    store.close();
  });

  test("keeps Creative catalog infinite across repeated edits, Q-drop, and pickup",async()=>{
    const store=new WorldStore(":memory:");
    const world=new GameWorld(config({worldPreset:"superflat",superflatGroundY:20,defaultGameMode:"creative"}),store,authenticator);
    const builder=new FakePeer("creative-builder"),friend=new FakePeer("creative-friend");
    world.open(builder,1_000);world.open(friend,1_000);
    await world.message(builder,JSON.stringify(join("builder")),1_000);
    await world.message(friend,JSON.stringify(join("friend")),1_000);
    const initialBuilderStates=builder.ofType("inventory_state").length;
    for(let index=0;index<3;index+=1)await world.message(builder,JSON.stringify(authoritativeBlockEdit({
      operationId:`creative_place_repeat_${index}`,seq:index+1,x:index,y:21,z:1,block:2,
      previousBlock:0,chunkRevision:index,inventoryRevision:1,
    })),1_010+index);
    expect(builder.ofType("block_patch").slice(-3)).toHaveLength(3);
    expect(builder.ofType("inventory_state")).toHaveLength(initialBuilderStates);
    expect(store.loadPlayerInventory("builder")?.revision).toBe("1");
    await world.message(builder,JSON.stringify({v:1,type:"drop_item",operationId:"creative_drop_catalog_1",
      itemId:"diamond",count:64,x:0.5,y:21.5,z:0.5}),1_100);
    expect(builder.ofType("drop_result").at(-1)).toMatchObject({action:"drop",drop:{itemId:"diamond",count:64}});
    expect(builder.ofType("inventory_state")).toHaveLength(initialBuilderStates);
    const drop=builder.ofType("drop_result").at(-1)!.drop;
    const initialFriendStates=friend.ofType("inventory_state").length;
    await world.message(friend,JSON.stringify({v:1,type:"pickup_item",operationId:"creative_pickup_catalog_1",dropId:drop.dropId}),2_101);
    expect(friend.ofType("drop_result").at(-1)).toMatchObject({action:"pickup",drop:{dropId:drop.dropId}});
    expect(friend.ofType("inventory_state")).toHaveLength(initialFriendStates);
    expect(store.listDrops(2_102)).toHaveLength(0);
    store.close();
  });

  test("rotates resume tokens and restores the last authoritative pose", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const first = new FakePeer("socket-a");
    world.open(first, 1_000);
    await world.message(first, JSON.stringify(join("alex", "Alex")), 1_000);
    const token = first.ofType("welcome")[0].resumeToken;
    await world.message(first, JSON.stringify({
      v: 1, type: "input", seq: 1, dtMs: 16, moveX: 1, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 1_010);
    world.tick(1_020);
    world.close(first);

    const second = new FakePeer("socket-b");
    world.open(second, 2_000);
    await world.message(second, JSON.stringify(join("alex", "Alex", token)), 2_000);
    const welcome = second.ofType("welcome")[0];
    expect(welcome.resumed).toBe(true);
    expect(welcome.player.x).toBeCloseTo(0.5 + 4.3 / 20);
    expect(welcome.player.y).toBeCloseTo(69.02);
    expect(welcome.resumeToken).not.toBe(token);
    store.close();
  });

  test("rejects an expired reconnect credential and requires fresh authentication", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const first = new FakePeer("socket-a");
    world.open(first, 1_000);
    await world.message(first, JSON.stringify(join("alex", "Alex")), 1_000);
    const token = first.ofType("welcome")[0].resumeToken;
    world.close(first);

    const expired = new FakePeer("socket-expired");
    world.open(expired, 1_000 + RESUME_TOKEN_TTL_MS + 1);
    await world.message(
      expired,
      JSON.stringify(join("alex", "Alex", token)),
      1_000 + RESUME_TOKEN_TTL_MS + 1,
    );
    expect(expired.ofType("welcome")).toHaveLength(0);
    expect(expired.ofType("error").at(-1)).toMatchObject({ code: "auth_failed", fatal: true });
    store.close();
  });

  test("rebases retained input and edit sequences on resume, then enforces the gap window", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config({ defaultGameMode:"creative" }), store, authenticator);
    const first = new FakePeer("socket-a");
    world.open(first, 1_000);
    await world.message(first, JSON.stringify(join("alex", "Alex")), 1_000);
    const token = first.ofType("welcome")[0].resumeToken;
    await world.message(first, JSON.stringify({
      v: 1, type: "input", seq: 70, dtMs: 16, moveX: 0, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 1_010);
    await world.message(first, JSON.stringify(authoritativeBlockEdit({
      operationId:"before-resume-0001",seq:70,x:0,y:69,z:1,block:4,
    })), 1_020);
    world.close(first);

    const resumed = new FakePeer("socket-b");
    world.open(resumed, 2_000);
    await world.message(resumed, JSON.stringify(join("alex", "Alex", token)), 2_000);
    await world.message(resumed, JSON.stringify({
      v: 1, type: "input", seq: 71, dtMs: 16, moveX: 1, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 2_010);
    await world.message(resumed, JSON.stringify(authoritativeBlockEdit({
      operationId:"after-resume-0001",seq:71,x:1,y:69,z:1,block:5,chunkRevision:1,
    })), 2_020);
    world.snapshots(2_030);
    expect(resumed.ofType("snapshot").at(-1)?.inputAck).toBe(71);
    expect(resumed.ofType("block_patch").at(-1)).toMatchObject({
      operationId: "after-resume-0001",
      edit: { block: 5 },
    });

    await world.message(resumed, JSON.stringify({
      v: 1, type: "input", seq: 136, dtMs: 16, moveX: 0, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 2_040);
    await world.message(resumed, JSON.stringify({
      v: 1, type: "block_edit", operationId: "gap-too-large", seq: 136,
      x: 2, y: 69, z: 1, block: 6,
    }), 2_050);
    expect(resumed.ofType("error").slice(-2)).toMatchObject([
      { code: "input_gap" },
      { code: "invalid_edit", operationId: "gap-too-large" },
    ]);

    await world.message(resumed, JSON.stringify({
      v: 1, type: "input", seq: 135, dtMs: 16, moveX: 0, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 2_060);
    await world.message(resumed, JSON.stringify(authoritativeBlockEdit({
      operationId:"gap-at-limit-0001",seq:135,x:2,y:69,z:1,block:6,chunkRevision:2,
    })), 2_070);
    world.snapshots(2_080);
    expect(resumed.ofType("snapshot").at(-1)?.inputAck).toBe(135);
    expect(resumed.ofType("block_patch").at(-1)?.operationId).toBe("gap-at-limit-0001");
    store.close();
  });

  test("rejects out-of-reach edits with operation correlation", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    await world.message(peer, JSON.stringify({
      v: 1, type: "block_edit", operationId: "far-away", seq: 1, x: 100, y: 69, z: 100, block: 1,
    }), 1_100);
    expect(peer.ofType("error").at(-1)).toMatchObject({
      code: "edit_too_far",
      operationId: "far-away",
      fatal: false,
    });
    expect(store.getRevision()).toBe(0);
    store.close();
  });

  test("blocks the fixed-floor regression and lets a jump clear the one-block spawn rim", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);

    let sequence = 0;
    let now = 1_000;
    const input = async (jump: boolean) => {
      sequence += 1;
      now += 50;
      await world.message(peer, JSON.stringify({
        v: 1, type: "input", seq: sequence, dtMs: 50, moveX: 0, moveZ: 1,
        yaw: 0, pitch: 0, jump, sprint: false,
      }), now);
      world.tick(now);
    };

    for (let tick = 0; tick < 20; tick += 1) await input(false);
    world.snapshots(now);
    const blocked = peer.ofType("snapshot").at(-1)!.self;
    expect(blocked.z).toBeGreaterThan(4.5);
    expect(blocked.z).toBeLessThan(4.72);
    expect(blocked.y).toBeCloseTo(69.02);

    for (let tick = 0; tick < 14; tick += 1) await input(tick === 0);
    world.snapshots(now);
    const landed = peer.ofType("snapshot").at(-1)!.self;
    expect(landed.z).toBeGreaterThan(5);
    expect(landed.y).toBeGreaterThanOrEqual(70.02);
    store.close();
  });

  test("heals a legacy resumed pose persisted below its deterministic surface", async () => {
    const store = new WorldStore(":memory:");
    const resumeToken = "legacy-token";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resumeToken));
    const resumeHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    store.savePlayer({
      id: "alex", name: "Alex", x: 0.5, y: 69.02, z: -5.2,
      yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
    }, resumeHash, 500, 10_000);
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex", "Alex", resumeToken)), 1_000);
    expect(peer.ofType("welcome")[0]?.player.y).toBe(terrainFeetY(0.5, -5.2));
    store.close();
  });

  test("echoes chat immediately in one server order, deduplicates retries, and restores history", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("socket-chat-a");
    const steve = new FakePeer("socket-chat-b");
    world.open(alex, 1_000);
    world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);

    const first = { v: 1, type: "chat_send", operationId: "chat_alex_0001", message: "hello" };
    await world.message(alex, JSON.stringify(first), 2_000);
    expect(alex.ofType("chat_message").at(-1)).toMatchObject({
      message: { sequence: 1, operationId: "chat_alex_0001", userId: "alex", message: "hello" },
    });
    expect(steve.ofType("chat_message").at(-1)?.message.sequence).toBe(1);

    await world.message(steve, JSON.stringify({
      v: 1, type: "chat_send", operationId: "chat_steve_001", message: "hi",
    }), 2_010);
    expect(alex.ofType("chat_message").map(({ message }) => message.sequence)).toEqual([1, 2]);
    expect(steve.ofType("chat_message").map(({ message }) => message.sequence)).toEqual([1, 2]);

    await world.message(alex, JSON.stringify(first), 2_020);
    expect(alex.ofType("chat_message").map(({ message }) => message.sequence)).toEqual([1, 2, 1]);
    expect(steve.ofType("chat_message").map(({ message }) => message.sequence)).toEqual([1, 2]);

    const resumed = new FakePeer("socket-chat-reconnect");
    world.open(resumed, 3_000);
    await world.message(resumed, JSON.stringify(join("sam", "Sam")), 3_000);
    expect(resumed.ofType("chat_history")[0].messages.map(({ sequence }) => sequence)).toEqual([1, 2]);
    store.close();
  });

  test("chat rate limits are operation-correlated without disconnecting the sender", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-chat-rate");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex", "Alex")), 1_000);
    await world.message(peer, JSON.stringify({
      v: 1, type: "chat_send", operationId: "chat_alex_0001", message: "one",
    }), 2_000);
    await world.message(peer, JSON.stringify({
      v: 1, type: "chat_send", operationId: "chat_alex_0002", message: "two",
    }), 2_100);
    expect(peer.ofType("error").at(-1)).toMatchObject({
      code: "rate_limited", operationId: "chat_alex_0002", fatal: false, retryable: true,
    });
    expect(peer.closed).toBeUndefined();
    store.close();
  });

  test("relays bounded selected skins and armor out-of-band without snapshot or database growth", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("socket-appearance-a");
    const steve = new FakePeer("socket-appearance-b");
    world.open(alex, 1_000);
    world.open(steve, 1_000);
    expect(alex.ofType("hello")[0].capabilities).toEqual([
      APPEARANCE_CAPABILITY, WORLD_CHUNKS_LEGACY_CAPABILITY, WORLD_CHUNKS_CAPABILITY, MOBS_CAPABILITY,
    ]);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);
    expect(steve.ofType("appearance_roster")[0].players).toEqual([{
      userId: "alex", skinId: "default", skinModel: "wide",
      armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
    }]);

    const skinPixels = Buffer.alloc(SKIN_PIXEL_BYTES, 17).toString("base64");
    const digest = await crypto.subtle.digest("SHA-256", Buffer.from(skinPixels, "base64"));
    const skinId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 1,
      appearance: {
        skinId, skinModel: "slim", armorHead: "diamond_helmet",
        armorChest: "iron_chestplate", armorLegs: "golden_leggings", armorFeet: "leather_boots",
      },
      skinPixels,
    }), 2_000);
    expect(steve.ofType("appearance_state").at(-1)?.player).toMatchObject({
      userId: "alex", skinId, skinModel: "slim", armorHead: "diamond_helmet",
    });
    await world.message(steve, JSON.stringify({
      v: 1, type: "appearance_request", userId: "alex", skinId,
    }), 2_100);
    expect(steve.ofType("appearance_blob").at(-1)).toEqual({
      v: 1, type: "appearance_blob", userId: "alex", skinId, skinPixels,
    });
    await world.message(steve, JSON.stringify({
      v: 1, type: "appearance_request", userId: "alex", skinId,
    }), 2_101);
    expect(steve.ofType("appearance_blob")).toHaveLength(1);
    for (let request = 0; request < 4; request += 1) await world.message(steve, JSON.stringify({
      v: 1, type: "appearance_request", userId: "missing", skinId: String(request).repeat(64),
    }), 2_110 + request);
    expect(steve.ofType("appearance_blob")).toHaveLength(4);
    expect(steve.ofType("error").at(-1)).toMatchObject({
      code: "rate_limited", message: "Appearance requests are rate limited", fatal: false,
    });

    world.snapshots(2_200);
    expect(steve.ofType("snapshot").at(-1)?.players[0]).not.toHaveProperty("skinId");
    expect(steve.ofType("snapshot").at(-1)?.players[0]).not.toHaveProperty("armorHead");
    expect(store.loadPlayer("alex")?.player).not.toHaveProperty("skinId");

    await world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 2,
      appearance: {
        skinId, skinModel: "slim", armorHead: "",
        armorChest: "", armorLegs: "", armorFeet: "",
      },
      skinPixels,
    }), 2_200);
    expect(alex.ofType("error").at(-1)).toMatchObject({ code: "rate_limited", fatal: false });
    await world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 3,
      appearance: {
        skinId: "b".repeat(64), skinModel: "wide", armorHead: "",
        armorChest: "", armorLegs: "", armorFeet: "",
      },
      skinPixels,
    }), 5_001);
    expect(alex.ofType("error").at(-1)).toMatchObject({ code: "bad_message", message: "Skin hash does not match its pixels" });
    store.close();
  });

  test("never applies a slow skin upload after a newer appearance sequence", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("socket-appearance-race-a");
    const steve = new FakePeer("socket-appearance-race-b");
    world.open(alex, 1_000);
    world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);
    const skinPixels = Buffer.alloc(SKIN_PIXEL_BYTES, 23).toString("base64");
    const digest = await crypto.subtle.digest("SHA-256", Buffer.from(skinPixels, "base64"));
    const skinId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const slow = world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 1,
      appearance: { skinId, skinModel: "wide", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
      skinPixels,
    }), 2_000);
    await world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 2,
      appearance: { skinId: "default", skinModel: "wide", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
    }), 2_001);
    await slow;
    expect(steve.ofType("appearance_state").at(-1)?.player.skinId).toBe("default");
    expect(steve.ofType("appearance_state").some((message) => message.player.skinId === skinId)).toBe(false);
    store.close();
  });

  test("an empty appearance lookup does not consume the later one-shot blob response", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const steve = new FakePeer("socket-appearance-late-steve");
    world.open(steve, 1_000);
    await world.message(steve, JSON.stringify(join("steve", "Steve")), 1_000);
    const skinPixels = Buffer.alloc(SKIN_PIXEL_BYTES, 29).toString("base64");
    const digest = await crypto.subtle.digest("SHA-256", Buffer.from(skinPixels, "base64"));
    const skinId = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await world.message(steve, JSON.stringify({
      v: 1, type: "appearance_request", userId: "alex", skinId,
    }), 2_000);
    expect(steve.ofType("appearance_blob").at(-1)).toEqual({
      v: 1, type: "appearance_blob", userId: "alex", skinId,
    });

    const alex = new FakePeer("socket-appearance-late-alex");
    world.open(alex, 2_100);
    await world.message(alex, JSON.stringify(join("alex", "Alex")), 2_100);
    await world.message(alex, JSON.stringify({
      v: 1, type: "appearance_set", seq: 1,
      appearance: { skinId, skinModel: "wide", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
      skinPixels,
    }), 2_200);
    await world.message(steve, JSON.stringify({
      v: 1, type: "appearance_request", userId: "alex", skinId,
    }), 3_001);
    expect(steve.ofType("appearance_blob").at(-1)).toEqual({
      v: 1, type: "appearance_blob", userId: "alex", skinId, skinPixels,
    });
    store.close();
  });

  test("admin grants are persisted, reflected in snapshots, and live players can be kicked", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-admin");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex", "Alex")), 1_000);
    expect(world.adminPlayers()).toMatchObject([{
      id: "alex", name: "Alex", gameMode: "survival", connected: true,
    }]);
    expect(world.setPlayerGameMode("alex", "creative")).toBe(true);
    world.snapshots(1_100);
    expect(peer.ofType("snapshot").at(-1)?.self.gameMode).toBe("creative");
    expect(store.loadPlayer("alex")?.player.gameMode).toBe("creative");
    expect(world.kickPlayer("alex")).toBe(true);
    expect(peer.closed).toEqual({ code: 4002, reason: "Disconnected by server operator" });
    expect(world.playerCount).toBe(0);
    expect(world.adminPlayers()[0]).toMatchObject({ gameMode: "creative", connected: false });
    store.close();
  });

  test("admin state tolerates players persisted by older demo clients with spaced names", () => {
    const store = new WorldStore(":memory:");
    store.savePlayer({ id: "spawn-probe", name: "Spawn Probe", x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }, "legacy-probe-hash");
    const world = new GameWorld(config(), store, authenticator);
    expect(world.adminState().players).toMatchObject([{
      id: "spawn-probe", name: "Spawn Probe", role: null, connected: false,
    }]);
    store.close();
  });

  test("persists whitelist, operator, ban, spawn, daylight, and server-chat administration",async()=>{
    const store=new WorldStore(":memory:"),world=new GameWorld(config({accessMode:"whitelist",initialWhitelist:["Alex"],daylightCycle:false,dayPhase:.5}),store,authenticator);
    const alex=new FakePeer("access-alex"),bob=new FakePeer("access-bob");world.open(alex,1000);world.open(bob,1000);
    await world.message(alex,JSON.stringify(join("alex","Alex")),1000);
    await world.message(bob,JSON.stringify(join("bob","Bob")),1000);
    expect(alex.ofType("welcome")[0]?.worldSettings).toMatchObject({daylightCycle:false,dayPhase:.5});
    expect(bob.ofType("error")[0]).toMatchObject({code:"auth_failed",fatal:true});
    expect(await world.runAdminCommand("/whitelist add Bob")).toMatchObject({ok:true});
    expect(await world.runAdminCommand("/op Alex")).toMatchObject({ok:true});
    expect(alex.ofType("private_notice").at(-1)?.message).toBe("You have been granted operator privileges.");
    expect(world.setPlayerGameMode("alex","creative")).toBe(true);
    await world.message(alex,JSON.stringify({v:1,type:"chat_send",operationId:"command-gamemode-1",message:"/gamemode survival"}),1100);
    await Promise.resolve();
    expect(world.adminPlayers().find((player)=>player.id==="alex")?.gameMode).toBe("survival");
    expect(alex.ofType("private_notice").map((notice)=>notice.message)).toEqual(expect.arrayContaining([
      "Your game mode was set to survival.","Set Alex to survival.",
    ]));
    expect(await world.runAdminCommand("/setworldspawn 42.5 -19.5 90")).toMatchObject({ok:true});
    expect(await world.runAdminCommand("/time set noon")).toMatchObject({ok:true});
    expect(await world.runAdminCommand("/gamerule doDaylightCycle false")).toMatchObject({ok:true});
    expect(await world.runAdminCommand("/say Maintenance in ten minutes")).toMatchObject({ok:true});
    expect(world.adminState()).toMatchObject({
      settings:{accessMode:"whitelist",spawnX:42.5,spawnZ:-19.5,daylightCycle:false,dayPhase:.5},
      access:expect.arrayContaining([expect.objectContaining({username:"Alex",role:"operator"}),expect.objectContaining({username:"Bob",banned:false})]),
      chat:[expect.objectContaining({username:"[Server]",message:"Maintenance in ten minutes"})],
    });
    expect(await world.runAdminCommand("/ban Alex testing")).toMatchObject({ok:true});
    const retry=new FakePeer("access-alex-retry");world.open(retry,2000);await world.message(retry,JSON.stringify(join("alex","Alex")),2000);
    expect(retry.ofType("error")[0]).toMatchObject({code:"auth_failed",fatal:true});
    store.close();
  });

  test("supports password and public access without a shared invitation token",async()=>{
    const store=new WorldStore(":memory:"),world=new GameWorld(config({accessMode:"password",serverPassword:"correct horse"}),store,authenticator);
    const denied=new FakePeer("password-denied");world.open(denied,1000);
    await world.message(denied,JSON.stringify({...join("denied","Denied"),password:"wrong"}),1000);
    expect(denied.ofType("error")[0]).toMatchObject({code:"auth_failed"});
    const allowed=new FakePeer("password-allowed");world.open(allowed,1000);
    await world.message(allowed,JSON.stringify({...join("allowed","Allowed"),password:"correct horse"}),1000);
    expect(allowed.ofType("welcome")).toHaveLength(1);
    expect(await world.runAdminCommand("/access public")).toMatchObject({ok:true});
    const publicPeer=new FakePeer("public");world.open(publicPeer,1000);await world.message(publicPeer,JSON.stringify(join("public","Public")),1000);
    expect(publicPeer.ofType("welcome")).toHaveLength(1);store.close();
  });

  test("admin kick revokes automatic resume while allowing a fresh authenticated join", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const first = new FakePeer("socket-kick-first");
    world.open(first, 1_000);
    await world.message(first, JSON.stringify(join("alex", "Alex")), 1_000);
    const kickedToken = first.ofType("welcome")[0].resumeToken;

    expect(world.kickPlayer("alex")).toBe(true);
    expect(first.closed).toEqual({ code: 4002, reason: "Disconnected by server operator" });

    const automatic = new FakePeer("socket-kick-automatic");
    world.open(automatic, 2_000);
    await world.message(automatic, JSON.stringify(join("alex", "Alex", kickedToken)), 2_000);
    expect(automatic.ofType("welcome")).toHaveLength(0);
    expect(automatic.ofType("error").at(-1)).toMatchObject({ code: "auth_failed", fatal: true });

    const fresh = new FakePeer("socket-kick-fresh");
    world.open(fresh, 3_000);
    await world.message(fresh, JSON.stringify(join("alex", "Alex")), 3_000);
    expect(fresh.ofType("welcome")[0]).toMatchObject({ resumed: false, player: { id: "alex", name: "Alex" } });
    store.close();
  });

  test("creative grants permit sustained authoritative flight and revocation lands safely", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-creative-flight");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex", "Alex")), 1_000);
    expect(world.setPlayerGameMode("alex", "creative")).toBe(true);

    let sequence = 0;
    let now = 1_000;
    const input = async (moveX: number, moveY: number, sprint = false) => {
      sequence += 1;
      now += 50;
      await world.message(peer, JSON.stringify({
        v: 1, type: "input", seq: sequence, dtMs: 50,
        moveX, moveY, moveZ: 0, yaw: 0, pitch: 0, jump: moveY > 0, sprint,
      }), now);
      world.tick(now);
    };

    for (let tick = 0; tick < 40; tick += 1) await input(0, 1);
    world.snapshots(now);
    const ascended = peer.ofType("snapshot").at(-1)!.self;
    expect(ascended.y).toBeCloseTo(69.02 + CREATIVE_FLIGHT_SPEED * 2);
    expect(ascended.vy).toBe(CREATIVE_FLIGHT_SPEED);

    for (let tick = 0; tick < 10; tick += 1) await input(1, 0);
    for (let tick = 0; tick < 10; tick += 1) await input(1, 0, true);
    world.snapshots(now);
    const traversed = peer.ofType("snapshot").at(-1)!.self;
    expect(traversed.x).toBeCloseTo(0.5 + CREATIVE_FLIGHT_SPEED / 2 + CREATIVE_FLIGHT_SPRINT_SPEED / 2);
    expect(traversed.y).toBeCloseTo(ascended.y);

    for (let tick = 0; tick < 8; tick += 1) await input(0, -1);
    world.snapshots(now);
    const descended = peer.ofType("snapshot").at(-1)!.self;
    expect(descended.y).toBeCloseTo(ascended.y - CREATIVE_FLIGHT_SPEED * 0.4);

    expect(world.setPlayerGameMode("alex", "survival")).toBe(true);
    for (let tick = 0; tick < 40; tick += 1) await input(0, 0);
    world.snapshots(now);
    const landed = peer.ofType("snapshot").at(-1)!.self;
    expect(landed.gameMode).toBe("survival");
    expect(landed.y).toBe(terrainFeetY(landed.x, landed.z));
    expect(landed.vy).toBe(0);

    expect(world.setPlayerGameMode("alex", "creative")).toBe(true);
    for (let tick = 0; tick < 400; tick += 1) await input(0, 1);
    world.snapshots(now);
    const ceiling = peer.ofType("snapshot").at(-1)!.self;
    expect(ceiling.y).toBe(MAX_PLAYER_Y);
    expect(ceiling.vy).toBe(0);
    store.close();
  });
});
