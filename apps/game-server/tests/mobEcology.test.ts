import { describe, expect, test } from "bun:test";
import { WorldStore } from "../src/database.ts";
import {
  RAILWAY_MOB_HOSTILE_CAP,
  RAILWAY_MOB_HOSTILE_PER_HABITAT,
  RAILWAY_MOB_MAX_HABITATS,
  RAILWAY_MOB_PER_PLAYER_SNAPSHOT_CAP,
  RAILWAY_MOB_PASSIVE_CAP,
  RAILWAY_MOB_PASSIVE_PER_HABITAT,
  RAILWAY_MOB_POPULATION_CAP,
  RailwayMobEcology,
} from "../src/mobEcology.ts";
import { createTerrainAuthority, type TerrainAuthority } from "../src/terrain.ts";
import { BLOCK_TYPES } from "../../../shared/protocol.ts";

const HOSTILES = new Set(["zombie", "skeleton", "creeper", "spider"]);

describe("Railway mob ecology", () => {
  test("keeps a bounded herd-shaped surface population and daytime hostiles under cover", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    ecology.tick([{ userId: "alex", x: 0.5, y: 69.02, z: 0.5 }], false, 1_000);
    const snapshot = ecology.snapshot(1_000);
    expect(snapshot.poses).toHaveLength(RAILWAY_MOB_PASSIVE_PER_HABITAT + 4);
    expect(snapshot.poses.filter((pose) => HOSTILES.has(pose.kind))).toHaveLength(4);
    expect(snapshot.poses.filter((pose) => !HOSTILES.has(pose.kind))).toHaveLength(RAILWAY_MOB_PASSIVE_PER_HABITAT);
    for (const pose of snapshot.poses.filter((candidate) => HOSTILES.has(candidate.kind))) {
      expect(pose.y).toBeLessThan(terrain.height(pose.x, pose.z));
    }
    const passive = snapshot.poses.filter((pose) => !HOSTILES.has(pose.kind));
    expect(passive.some((left, index) => passive.some((right, other) => other !== index
      && right.kind === left.kind && Math.hypot(right.x - left.x, right.z - left.z) <= 4))).toBe(true);
    store.close();
  });

  test("mixes surface and cave hostiles at night and restores an exact persisted checkpoint", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const first = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    const targets = [{ userId: "alex", x: 0.5, y: 69.02, z: 0.5 }];
    first.tick(targets, true, 2_000);
    first.tick(targets, true, 2_100);
    const before = first.snapshot(2_100);
    const hostile = before.poses.filter((pose) => HOSTILES.has(pose.kind));
    expect(hostile.some((pose) => pose.y === terrain.height(pose.x, pose.z) + 1)).toBe(true);
    expect(hostile.some((pose) => pose.y < terrain.height(pose.x, pose.z))).toBe(true);
    first.persist(2_100);

    const restored = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    expect(restored.snapshot(2_101)).toEqual({ ...before, serverNow: 2_101 });
    store.close();
  });

  test("retains established herds across clock changes and rate-limits hostile contact", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    const player = { userId: "alex", x: 0.5, y: 69.02, z: 0.5 };
    ecology.tick([player], true, 1_000);
    const night = ecology.snapshot(1_000);
    ecology.tick([player], false, 1_100);
    const day = ecology.snapshot(1_100);
    expect(day.poses.filter((pose) => !HOSTILES.has(pose.kind)).map((pose) => pose.mobId))
      .toEqual(night.poses.filter((pose) => !HOSTILES.has(pose.kind)).map((pose) => pose.mobId));
    const nightPassive = new Map(night.poses.filter((pose) => !HOSTILES.has(pose.kind)).map((pose) => [pose.mobId, pose]));
    for (const pose of day.poses.filter((candidate) => !HOSTILES.has(candidate.kind))) {
      const prior = nightPassive.get(pose.mobId)!;
      expect(Math.hypot(pose.x - prior.x, pose.z - prior.z)).toBeLessThan(0.2);
    }

    const hostile = day.poses.find((pose) => (pose.kind === "zombie" || pose.kind === "spider")
      && ecology.hostileSpawnEligible(Math.floor(pose.x), Math.floor(pose.y), Math.floor(pose.z), false))!;
    const target = { userId: "alex", x: hostile.x, y: hostile.y, z: hostile.z };
    expect(ecology.tick([target], false, 1_200)).toHaveLength(1);
    expect(ecology.tick([target], false, 1_300)).toHaveLength(0);
    const laterHits = [];
    for (let now = 1_400; now <= 2_300; now += 100) laterHits.push(...ecology.tick([target], false, now));
    expect(laterHits).toHaveLength(1);
    store.close();
  });

  test("disables the entire population for Creative servers", () => {
    const store = new WorldStore(":memory:");
    const ecology = new RailwayMobEcology(false,
      createTerrainAuthority({ preset: "superflat", superflatGroundY: 20 }), store, 0.5, 0.5);
    ecology.tick([{ userId: "builder", x: 0.5, y: 21.02, z: 0.5 }], true, 1_000);
    expect(ecology.snapshot(1_000)).toEqual({ serverNow: 1_000, tick: 0, poses: [], states: [] });
    expect(store.loadMobWorld()).toBeNull();
    store.close();
  });

  test("owns bounded stable habitats around widely separated active players", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    const targets = [
      { userId: "alex", x: 0.5, y: 69.02, z: 0.5 },
      { userId: "steve", x: 480.5, y: terrain.height(480, 0) + 1.02, z: 0.5 },
    ];
    ecology.tick(targets, true, 1_000);
    const first = ecology.snapshot(1_000);
    expect(first.poses).toHaveLength(2 * (RAILWAY_MOB_PASSIVE_PER_HABITAT + RAILWAY_MOB_HOSTILE_PER_HABITAT));
    expect(first.poses.length).toBeLessThanOrEqual(RAILWAY_MOB_POPULATION_CAP);
    for (const target of targets) {
      const nearby = first.poses.filter((pose) => Math.hypot(pose.x - target.x, pose.z - target.z) <= 42);
      expect(nearby.length).toBeGreaterThan(0);
      expect(nearby.length).toBeLessThanOrEqual(RAILWAY_MOB_PASSIVE_PER_HABITAT + RAILWAY_MOB_HOSTILE_PER_HABITAT);
    }
    const alexView = ecology.snapshot(1_000, targets[0]);
    expect(alexView.poses.length).toBeLessThanOrEqual(RAILWAY_MOB_PER_PLAYER_SNAPSHOT_CAP);
    expect(alexView.poses.every((pose) => Math.hypot(pose.x - targets[0]!.x, pose.z - targets[0]!.z) <= 64)).toBe(true);
    expect(alexView.poses.every((pose) => Math.hypot(pose.x - targets[1]!.x, pose.z - targets[1]!.z) > 64)).toBe(true);
    ecology.tick(targets.slice().reverse(), true, 1_100);
    expect(ecology.snapshot(1_100).poses.map((pose) => pose.mobId).sort())
      .toEqual(first.poses.map((pose) => pose.mobId).sort());
    expect(RAILWAY_MOB_MAX_HABITATS * RAILWAY_MOB_HOSTILE_PER_HABITAT).toBe(RAILWAY_MOB_HOSTILE_CAP);
    expect(RAILWAY_MOB_MAX_HABITATS * RAILWAY_MOB_PASSIVE_PER_HABITAT).toBe(RAILWAY_MOB_PASSIVE_CAP);
    store.close();
  });

  test("retains incumbent IDs across habitat boundaries and despawns only after the grace lifecycle", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    ecology.tick([{ userId: "alex", x: 23.5, y: terrain.height(23, 0) + 1.02, z: 0.5 }], true, 1_000);
    const before = ecology.snapshot(1_000);
    ecology.tick([{ userId: "alex", x: 24.5, y: terrain.height(24, 0) + 1.02, z: 0.5 }], true, 1_100);
    const crossed = ecology.snapshot(1_100);
    expect(before.poses.every((pose) => crossed.poses.some((candidate) => candidate.mobId === pose.mobId))).toBe(true);
    expect(crossed.poses.length).toBeLessThanOrEqual(RAILWAY_MOB_POPULATION_CAP);

    const far = { userId: "alex", x: 240.5, y: terrain.height(240, 0) + 1.02, z: 0.5 };
    ecology.tick([far], true, 1_200);
    expect(before.poses.every((pose) => ecology.snapshot(1_200).poses.some((candidate) => candidate.mobId === pose.mobId))).toBe(true);
    for (let tick = 0; tick < 320; tick += 1) ecology.tick([far], true, 1_300 + tick * 100);
    const settled = ecology.snapshot(33_300);
    expect(before.poses.every((pose) => !settled.poses.some((candidate) => candidate.mobId === pose.mobId))).toBe(true);
    expect(settled.poses.length).toBeLessThanOrEqual(RAILWAY_MOB_POPULATION_CAP);
    store.close();
  });

  test("suppresses lit caves, admits dark caves, and respects occluding walls", () => {
    const overrides = new Map<string, number>();
    const terrain = caveTerrain(overrides);
    const store = new WorldStore(":memory:");
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    expect(ecology.hostileSpawnEligible(0, 4, 0, false)).toBe(true);
    overrides.set("1:4:0", blockId("torch"));
    ecology.invalidateLighting();
    expect(ecology.hostileSpawnEligible(0, 4, 0, false)).toBe(false);
    overrides.set("1:4:0", blockId("air"));
    overrides.set("3:4:0", blockId("torch"));
    overrides.set("2:4:0", blockId("stone"));
    ecology.invalidateLighting();
    expect(ecology.hostileSpawnEligible(0, 4, 0, false)).toBe(true);
    expect(ecology.hostileSpawnEligible(0, 11, 0, false)).toBe(false);
    expect(ecology.hostileSpawnEligible(0, 11, 0, true)).toBe(true);
    store.close();
  });

  test("replays deterministic skeleton projectiles with exact one-shot resolution", () => {
    const run = () => {
      const store = new WorldStore(":memory:");
      const ecology = new RailwayMobEcology(true, caveTerrain(new Map()), store, 0.5, 0.5);
      ecology.tick([{ userId: "alex", x: 0.5, y: 4, z: 0.5 }], true, 1_000);
      const skeleton = ecology.snapshot(1_000).poses.find((pose) => pose.kind === "skeleton")!;
      const target = { userId: "alex", x: skeleton.x + 6, y: skeleton.y, z: skeleton.z };
      const timeline: Array<{ projectiles: string[]; hits: string[] }> = [];
      for (let tick = 0; tick < 45; tick += 1) {
        const hits = ecology.tick([target], true, 1_100 + tick * 100);
        timeline.push({
          projectiles: ecology.projectileSnapshot().map((projectile) => projectile.projectileId),
          hits: hits.filter((hit) => hit.source === "projectile").map((hit) => hit.operationId),
        });
      }
      store.close();
      return timeline;
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.some((entry) => entry.projectiles.length > 0)).toBe(true);
    const hits = first.flatMap((entry) => entry.hits);
    expect(new Set(hits).size).toBe(hits.length);
    expect(hits.length).toBeGreaterThan(0);
  });

  test("latches one creeper explosion and removes its lifecycle after acknowledgement", () => {
    const store = new WorldStore(":memory:");
    const ecology = new RailwayMobEcology(true, caveTerrain(new Map()), store, 0.5, 0.5);
    ecology.tick([{ userId: "alex", x: 0.5, y: 4, z: 0.5 }], true, 1_000);
    const creeper = ecology.snapshot(1_000).poses.find((pose) => pose.kind === "creeper")!;
    const target = { userId: "alex", x: creeper.x + 1.5, y: creeper.y, z: creeper.z };
    const events = [];
    for (let tick = 0; tick < 25; tick += 1) {
      ecology.tick([target], true, 1_100 + tick * 100);
      events.push(...ecology.drainExplosions());
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ mobId: creeper.mobId });
    ecology.acknowledgeExplosion(creeper.mobId, 4_000);
    expect(ecology.snapshot(4_000).poses.some((pose) => pose.mobId === creeper.mobId)).toBe(false);
    for (let tick = 0; tick < 10; tick += 1) ecology.tick([target], true, 4_100 + tick * 100);
    expect(ecology.drainExplosions()).toHaveLength(0);
    store.close();
  });
});

function blockId(name: string): number {
  const id = (BLOCK_TYPES as readonly string[]).indexOf(name);
  if (id < 0) throw new Error(`missing test block ${name}`);
  return id;
}

function caveTerrain(overrides: ReadonlyMap<string, number>): TerrainAuthority {
  const air = blockId("air");
  const stone = blockId("stone");
  return {
    descriptor: { preset: "default", superflatGroundY: 20 },
    height: () => 10,
    feetY: () => 11.02,
    blockAt(x, y, z) {
      const override = overrides.get(`${x}:${y}:${z}`);
      if (override !== undefined) return override;
      if (y > 10) return air;
      if (y === 10 || y === 6 || y <= 3) return stone;
      return air;
    },
  };
}
