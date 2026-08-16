import { describe, expect, test } from "bun:test";
import { WorldStore } from "../src/database.ts";
import {
  RAILWAY_MOB_HOSTILE_CAP,
  RAILWAY_MOB_PASSIVE_CAP,
  RAILWAY_MOB_POPULATION_CAP,
  RailwayMobEcology,
} from "../src/mobEcology.ts";
import { createTerrainAuthority } from "../src/terrain.ts";

const HOSTILES = new Set(["zombie", "skeleton", "creeper", "spider"]);

describe("Railway mob ecology", () => {
  test("keeps a bounded herd-shaped surface population and daytime hostiles under cover", () => {
    const store = new WorldStore(":memory:");
    const terrain = createTerrainAuthority({ preset: "default", superflatGroundY: 20 });
    const ecology = new RailwayMobEcology(true, terrain, store, 0.5, 0.5);
    ecology.tick([{ userId: "alex", x: 0.5, y: 69.02, z: 0.5 }], false, 1_000);
    const snapshot = ecology.snapshot(1_000);
    expect(snapshot.poses).toHaveLength(RAILWAY_MOB_POPULATION_CAP);
    expect(snapshot.poses.filter((pose) => HOSTILES.has(pose.kind))).toHaveLength(RAILWAY_MOB_HOSTILE_CAP);
    expect(snapshot.poses.filter((pose) => !HOSTILES.has(pose.kind))).toHaveLength(RAILWAY_MOB_PASSIVE_CAP);
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

    const hostile = day.poses.find((pose) => HOSTILES.has(pose.kind) && pose.kind !== "creeper")!;
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
});
