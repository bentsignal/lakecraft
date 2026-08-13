import { describe, expect, test } from "bun:test";
import type { JoinAuthenticator } from "../src/auth";
import type { ServerConfig } from "../src/config";
import { WorldStore } from "../src/database";
import { APPEARANCE_CAPABILITY, SKIN_PIXEL_BYTES, type ClientMessage, type ServerMessage } from "../src/protocol";
import { GameWorld, RESUME_TOKEN_TTL_MS, type Peer } from "../src/world";
import { terrainHeight as clientTerrainHeight } from "../../../client/game/terrain";
import {
  CREATIVE_FLIGHT_SPEED,
  CREATIVE_FLIGHT_SPRINT_SPEED,
  MAX_PLAYER_Y,
  PLAYER_FEET_CLEARANCE,
  PLAYER_GRAVITY,
  PLAYER_JUMP_SPEED,
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
    return { userId: message.demo.userId, displayName: message.demo.name };
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
    ...overrides,
  };
}

function join(userId: string, name = userId, resumeToken?: string): ClientMessage {
  if (resumeToken) return { v: 1, type: "join", resumeToken };
  return {
    v: 1,
    type: "join",
    demo: { token: "0123456789abcdef", userId, name },
  };
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

  test("persists block edits and acknowledges exact operation retries without another revision", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const peer = new FakePeer("socket-a");
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify(join("alex")), 1_000);
    const edit = { v: 1, type: "block_edit", operationId: "place-1", seq: 1, x: 0, y: 69, z: 1, block: 4 };
    await world.message(peer, JSON.stringify(edit), 1_100);
    await world.message(peer, JSON.stringify(edit), 1_200);
    const patches = peer.ofType("block_patch");
    expect(patches).toHaveLength(2);
    expect(patches[0].operationId).toBe("place-1");
    expect(patches[1].edit.revision).toBe(patches[0].edit.revision);
    expect(store.getRevision()).toBe(1);

    const latePeer = new FakePeer("socket-late");
    world.open(latePeer, 1_300);
    await world.message(latePeer, JSON.stringify(join("steve")), 1_300);
    expect(latePeer.ofType("world_snapshot")[0]).toMatchObject({
      revision: 1,
      edits: [{ x: 0, y: 69, z: 1, block: 4, editorId: "alex" }],
    });
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
    await world.message(alex, JSON.stringify(join("alex")), 1_000);
    await world.message(steve, JSON.stringify(join("steve")), 1_000);
    await world.message(alex, JSON.stringify({ v:1,type:"action",seq:1,kind:"crouch_on" }), 1_010);
    await world.message(alex, JSON.stringify({
      v:1,type:"input",seq:1,dtMs:50,moveX:0,moveZ:0,yaw:0,pitch:0,jump:false,sprint:false,heldItem:"diamond_pickaxe",
      x:0.5,y:69.02,z:0.5,
    }), 1_011);
    world.snapshots(1_012);
    expect(steve.ofType("snapshot").at(-1)?.players[0]).toMatchObject({ crouching:true, heldItem:"diamond_pickaxe" });
    await world.message(alex, JSON.stringify({
      v:1,type:"drop_item",operationId:"drop_transfer_1",itemId:"diamond_pickaxe",count:1,durability:120,x:0.5,y:69.02,z:0.5,
    }), 1_020);
    const drop = alex.ofType("drop_result").at(-1)?.drop;
    expect(drop).toMatchObject({ itemId:"diamond_pickaxe", durability:120, ownerUserId:"alex" });
    await world.message(steve, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_transfer_1",dropId:drop!.dropId,
    }), 1_600);
    expect(steve.ofType("drop_result").at(-1)).toMatchObject({ action:"pickup", drop:{ dropId:drop!.dropId } });
    await world.message(steve, JSON.stringify({
      v:1,type:"pickup_item",operationId:"pickup_transfer_1",dropId:drop!.dropId,
    }), 1_700);
    expect(steve.ofType("drop_result").slice(-2)).toEqual([
      expect.objectContaining({ action:"pickup", drop:expect.objectContaining({ dropId:drop!.dropId }) }),
      expect.objectContaining({ action:"pickup", drop:expect.objectContaining({ dropId:drop!.dropId }) }),
    ]);
    expect(alex.ofType("drop_snapshot").at(-1)?.drops).toEqual([]);
    store.close();
  });

  test("applies authoritative PvP damage once with reach, cooldown, and persisted health", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const alex = new FakePeer("pvp-a");
    const steve = new FakePeer("pvp-b");
    world.open(alex, 1_000); world.open(steve, 1_000);
    await world.message(alex, JSON.stringify(join("alex")), 1_000);
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

  test("respawns through server authority and persists the canonical spawn", async () => {
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
    expect(peer.ofType("respawned").at(-1)).toMatchObject({
      operationId:"respawn_test_1",
      player:{ x:0.5, y:69.02, z:0.5, yaw:0, pitch:0, vx:0, vy:0, vz:0 },
    });
    expect(store.loadPlayer("alex")?.player).toMatchObject({ x:0.5, y:69.02, z:0.5 });
    store.close();
  });

  test("freezes a dead pose and atomically clears crouch/action state on respawn", async () => {
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config(), store, authenticator);
    const attacker = new FakePeer("death-attacker");
    const target = new FakePeer("death-target");
    world.open(attacker, 1_000); world.open(target, 1_000);
    await world.message(attacker, JSON.stringify(join("attacker")), 1_000);
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
    await world.message(target, JSON.stringify({ v:1,type:"respawn",operationId:"respawn_death_1" }), 2_800);
    world.snapshots(2_801);
    expect(target.ofType("snapshot").at(-1)?.self).toMatchObject({
      x:0.5,y:69.02,z:0.5,health:20,crouching:false,visualActions:[],
    });
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
    const world = new GameWorld(config(), store, authenticator);
    const first = new FakePeer("socket-a");
    world.open(first, 1_000);
    await world.message(first, JSON.stringify(join("alex", "Alex")), 1_000);
    const token = first.ofType("welcome")[0].resumeToken;
    await world.message(first, JSON.stringify({
      v: 1, type: "input", seq: 70, dtMs: 16, moveX: 0, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 1_010);
    await world.message(first, JSON.stringify({
      v: 1, type: "block_edit", operationId: "before-resume", seq: 70,
      x: 0, y: 69, z: 1, block: 4,
    }), 1_020);
    world.close(first);

    const resumed = new FakePeer("socket-b");
    world.open(resumed, 2_000);
    await world.message(resumed, JSON.stringify(join("alex", "Alex", token)), 2_000);
    await world.message(resumed, JSON.stringify({
      v: 1, type: "input", seq: 71, dtMs: 16, moveX: 1, moveZ: 0,
      yaw: 0, pitch: 0, jump: false, sprint: false,
    }), 2_010);
    await world.message(resumed, JSON.stringify({
      v: 1, type: "block_edit", operationId: "after-resume", seq: 71,
      x: 1, y: 69, z: 1, block: 5,
    }), 2_020);
    world.snapshots(2_030);
    expect(resumed.ofType("snapshot").at(-1)?.inputAck).toBe(71);
    expect(resumed.ofType("block_patch").at(-1)).toMatchObject({
      operationId: "after-resume",
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
    await world.message(resumed, JSON.stringify({
      v: 1, type: "block_edit", operationId: "gap-at-limit", seq: 135,
      x: 2, y: 69, z: 1, block: 6,
    }), 2_070);
    world.snapshots(2_080);
    expect(resumed.ofType("snapshot").at(-1)?.inputAck).toBe(135);
    expect(resumed.ofType("block_patch").at(-1)?.operationId).toBe("gap-at-limit");
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
    expect(alex.ofType("hello")[0].capabilities).toEqual([APPEARANCE_CAPABILITY]);
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
    expect(world.adminPlayers()).toEqual([{
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
