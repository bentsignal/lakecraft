import { describe, expect, test } from "bun:test";
import type { JoinAuthenticator } from "../src/auth";
import type { ServerConfig } from "../src/config";
import { WorldStore } from "../src/database";
import type { ClientMessage, ServerMessage } from "../src/protocol";
import { GameWorld, RESUME_TOKEN_TTL_MS, type Peer } from "../src/world";

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
    }), 1_010);
    world.tick(1_020);
    world.snapshots(1_030);
    const snapshot = alex.ofType("snapshot").at(-1)!;
    expect(snapshot.inputAck).toBe(1);
    expect(snapshot.self.x).toBeCloseTo(0.8);
    expect(snapshot.self.y).toBeCloseTo(69.02);
    expect(snapshot.self.yaw).toBeCloseTo(-Math.PI);
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]).toMatchObject({ id: "steve", name: "Steve" });
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
});
