import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_API_PREFIX,
  AGENT_BLOCK_NAMES,
  AgentApiRateLimiter,
  handleAgentBuilderRequest,
  type AgentBuilderWorld,
  type AgentRegionBounds,
} from "../src/agentBuilder";
import { applyAgentBatch, type AgentBatchInput } from "../src/agentBuilderPersistence";
import { loadConfig } from "../src/config";
import { WorldStore } from "../src/database";
import { GameWorld, type Peer } from "../src/world";
import { BLOCK_TYPES } from "../../../shared/protocol";

const TOKEN = "agent-builder-token-with-32-characters-minimum";

expect(AGENT_BLOCK_NAMES).toEqual([...BLOCK_TYPES]);

class TestWorld implements AgentBuilderWorld {
  readonly store = new WorldStore(":memory:");
  readonly patches: import("../src/protocol").BlockEdit[] = [];
  maxBlocks = 1_000;

  agentMetadata() {
    return {
      serverId: "creative-world",
      name: "Creative",
      description: "Agent test world",
      revision: this.store.getRevision(),
      persistedBlocks: this.store.blockCount(),
      maxPersistedBlocks: this.maxBlocks,
      worldPreset: "superflat",
      groundY: 20,
      defaultGameMode: "creative" as const,
      connectedPlayers: 0,
      spawn: { x: 0.5, y: 21.02, z: 0.5, yaw: 0 },
    };
  }

  agentEditsSince(sinceRevision: number, limit: number) {
    return this.store.getAllBlockEdits().filter((edit) => edit.revision > sinceRevision).slice(0, limit);
  }

  agentBlockAt(x: number, y: number, z: number): number {
    const override = this.store.getAllBlockEdits().find((edit) => edit.x === x && edit.y === y && edit.z === z);
    if (override) return override.block;
    if (y === 1) return 33;
    if (y < 17) return 3;
    if (y < 20) return 2;
    return y === 20 ? 1 : 0;
  }

  agentReadRegion(bounds: AgentRegionBounds) {
    const blocks: number[] = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) blocks.push(this.agentBlockAt(x, y, z));
    }
    return {
      revision: this.store.getRevision(), bounds,
      size: { x: bounds.maxX - bounds.minX + 1, y: bounds.maxY - bounds.minY + 1, z: bounds.maxZ - bounds.minZ + 1 },
      order: "x,z,y" as const,
      blocks,
    };
  }

  agentApplyBatch(input: AgentBatchInput) {
    const result = applyAgentBatch(this.store, input, this.maxBlocks);
    if (result.ok && !result.replayed) this.patches.push(...result.edits);
    return result;
  }
}

async function call(
  world: AgentBuilderWorld,
  path: string,
  init: RequestInit = {},
  token: string | null = TOKEN,
  options: Parameters<typeof handleAgentBuilderRequest>[4] = { limiter: new AgentApiRateLimiter(), now: 1_000 },
  serverToken: string | null = TOKEN,
) {
  const request = new Request(`http://server.test${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return handleAgentBuilderRequest(request, new URL(request.url), serverToken ?? undefined, world, options);
}

describe("Railway-local agent builder API", () => {
  test("ignores unrelated routes and fails closed when AGENT_TOKEN is absent", async () => {
    const world = new TestWorld();
    expect(await call(world, "/status")).toBeNull();
    const disabled = await call(world, `${AGENT_API_PREFIX}/status`, {}, TOKEN, undefined, null);
    expect(disabled?.status).toBe(404);
    expect(await disabled?.text()).not.toContain(TOKEN);
    world.store.close();
  });

  test("requires a dedicated bearer header and never accepts or echoes a URL token", async () => {
    const world = new TestWorld();
    for (const path of [`${AGENT_API_PREFIX}/status`, `${AGENT_API_PREFIX}/status?token=${TOKEN}`]) {
      const response = await call(world, path, {}, null);
      expect(response?.status).toBe(401);
      expect(response?.headers.get("www-authenticate")).toBe("Bearer");
      expect(await response?.text()).not.toContain(TOKEN);
    }
    const wrong = await call(world, `${AGENT_API_PREFIX}/status`, {}, "definitely-the-wrong-agent-builder-token");
    expect(wrong?.status).toBe(401);
    world.store.close();
  });

  test("returns bounded metadata, exact blocks, dense regions, and revision edits", async () => {
    const world = new TestWorld();
    const status = await call(world, `${AGENT_API_PREFIX}/status`);
    expect(await status?.json()).toMatchObject({
      ok: true,
      server: { serverId: "creative-world", worldPreset: "superflat", groundY: 20 },
      blockPalette: AGENT_BLOCK_NAMES,
      limits: { batchEdits: 512, regionCells: 4096 },
    });
    const block = await call(world, `${AGENT_API_PREFIX}/block?x=0&y=20&z=0`);
    expect(await block?.json()).toMatchObject({ block: 1, blockName: "grass" });
    const region = await call(world, `${AGENT_API_PREFIX}/region?minX=0&minY=20&minZ=0&maxX=1&maxY=21&maxZ=0`);
    expect(await region?.json()).toMatchObject({ region: { order: "x,z,y", blocks: [1, 1, 0, 0] } });
    const oversized = await call(world, `${AGENT_API_PREFIX}/region?minX=0&minY=1&minZ=0&maxX=64&maxY=64&maxZ=0`);
    expect(oversized?.status).toBe(400);
    world.store.close();
  });

  test("commits batches atomically and replays the same operation without another revision", async () => {
    const world = new TestWorld();
    const body = JSON.stringify({
      operationId: "observatory.floor.0001",
      agent: "test-agent",
      edits: [{ x: 2, y: 21, z: 3, block: "stone_bricks" }, { x: 3, y: 21, z: 3, block: 19 }],
    });
    const first = await call(world, `${AGENT_API_PREFIX}/edits`, { method: "POST", body });
    expect(first?.status).toBe(200);
    expect(await first?.json()).toMatchObject({ ok: true, replayed: false, revision: 2 });
    const replay = await call(world, `${AGENT_API_PREFIX}/edits`, { method: "POST", body });
    expect(await replay?.json()).toMatchObject({ ok: true, replayed: true, revision: 2 });
    expect(world.store.getRevision()).toBe(2);
    expect(world.patches).toHaveLength(2);

    const conflict = await call(world, `${AGENT_API_PREFIX}/edits`, {
      method: "POST",
      body: JSON.stringify({ operationId: "observatory.floor.0001", agent: "test-agent", edits: [{ x: 2, y: 21, z: 3, block: 0 }] }),
    });
    expect(conflict?.status).toBe(409);
    expect(await conflict?.json()).toMatchObject({ reason: "operation_id_reused" });
    world.store.close();
  });

  test("persists idempotency receipts across a Railway process restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "lakecraft-agent-builder-"));
    const path = join(directory, "world.sqlite");
    try {
      const input: AgentBatchInput = {
        operationId: "restart.receipt.0001",
        editorId: "agent:test",
        editedAt: 1_000,
        edits: [{ x: 7, y: 21, z: 9, block: 26 }],
      };
      const first = new WorldStore(path);
      expect(applyAgentBatch(first, input, 100)).toMatchObject({ ok: true, replayed: false, revision: 1 });
      first.close();
      const restarted = new WorldStore(path);
      expect(applyAgentBatch(restarted, input, 100)).toMatchObject({ ok: true, replayed: true, revision: 1 });
      expect(restarted.getRevision()).toBe(1);
      expect(restarted.getAllBlockEdits()).toHaveLength(1);
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects duplicate coordinates, oversized fills, world-limit batches, and oversized bodies", async () => {
    const world = new TestWorld();
    const duplicate = await call(world, `${AGENT_API_PREFIX}/edits`, {
      method: "POST",
      body: JSON.stringify({
        operationId: "duplicate.coords.0001", edits: [
          { x: 0, y: 21, z: 0, block: 3 }, { x: 0, y: 21, z: 0, block: 4 },
        ],
      }),
    });
    expect(duplicate?.status).toBe(400);
    const fill = await call(world, `${AGENT_API_PREFIX}/fill`, {
      method: "POST",
      body: JSON.stringify({ operationId: "oversized.fill.0001", from: { x: 0, y: 1, z: 0 }, to: { x: 8, y: 8, z: 8 }, block: 3 }),
    });
    expect(fill?.status).toBe(400);

    world.maxBlocks = 1;
    const limited = await call(world, `${AGENT_API_PREFIX}/edits`, {
      method: "POST",
      body: JSON.stringify({ operationId: "atomic.limit.0001", edits: [{ x: 0, y: 21, z: 0, block: 3 }, { x: 1, y: 21, z: 0, block: 3 }] }),
    });
    expect(limited?.status).toBe(507);
    expect(world.store.blockCount()).toBe(0);
    expect(world.store.getRevision()).toBe(0);

    const tooLarge = await call(world, `${AGENT_API_PREFIX}/edits`, {
      method: "POST",
      headers: { "content-length": "65537" },
      body: "{}",
    });
    expect(tooLarge?.status).toBe(413);
    world.store.close();
  });

  test("uses weighted rate limits and returns a valid bounded PNG camera artifact", async () => {
    const world = new TestWorld();
    const limiter = new AgentApiRateLimiter(20, 0.001, 1_000);
    const camera = await call(world, `${AGENT_API_PREFIX}/camera`, {
      method: "POST",
      body: JSON.stringify({ x: 8, y: 25, z: 8, yaw: -2.3, pitch: -0.3, width: 64, height: 48, maxDistance: 32 }),
    }, TOKEN, { limiter, now: 1_000 });
    expect(camera?.status).toBe(200);
    expect(camera?.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await camera!.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.byteLength).toBeLessThan(64 * 48 * 3 + 256);
    const limited = await call(world, `${AGENT_API_PREFIX}/status`, {}, TOKEN, { limiter, now: 1_000 });
    expect(limited?.status).toBe(429);
    const invalidCamera = await call(world, `${AGENT_API_PREFIX}/camera`, {
      method: "POST",
      body: JSON.stringify({ x: 0, y: 25, z: 0, yaw: 0, pitch: 0, width: 321 }),
    });
    expect(invalidCamera?.status).toBe(400);
    world.store.close();
  });

  test("publishes agent edits to connected player sockets immediately", async () => {
    const config = loadConfig({
      AUTH_MODE: "local-demo", SERVER_ID: "live-world", LOCAL_DEMO_TOKEN: "0123456789abcdef",
      WORLD_PRESET: "superflat", DEFAULT_GAME_MODE: "creative", SUPERFLAT_GROUND_Y: "20",
      MAX_PERSISTED_BLOCKS: "1000",
    });
    const store = new WorldStore(":memory:");
    const world = new GameWorld(config, store, {
      authenticate: async () => ({ userId: "viewer", displayName: "Viewer" }),
    });
    const messages: Array<Record<string, unknown>> = [];
    const peer: Peer = {
      id: "viewer-socket",
      send(payload) { messages.push(JSON.parse(payload)); },
      close() {}, bufferedAmount: () => 0,
    };
    world.open(peer, 1_000);
    await world.message(peer, JSON.stringify({
      v: 1, type: "join", demo: { token: "0123456789abcdef", userId: "viewer", name: "Viewer" },
    }), 1_000);
    await world.message(peer,JSON.stringify({v:1,type:"chunk_subscribe",seq:1,centerX:0,centerZ:0,radius:1,known:[]}),1_001);
    messages.length = 0;
    const result = world.agentApplyBatch({
      operationId: "live.broadcast.0001", editorId: "agent:test", editedAt: 2_000,
      edits: [{ x: 4, y: 21, z: 4, block: 32 }],
    });
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(world.agentBlockAt(4, 21, 4)).toBe(32);
    expect(messages).toContainEqual(expect.objectContaining({
      v: 1, type: "block_patch", edit: expect.objectContaining({ x: 4, y: 21, z: 4, block: 32 }),
    }));
    world.shutdown();
    store.close();
  });
});
