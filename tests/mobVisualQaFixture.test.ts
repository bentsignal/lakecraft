import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  MOB_VISUAL_QA_FIXTURE_FORMAT,
  MOB_VISUAL_QA_IMPORT_SENTINEL,
  MOB_VISUAL_QA_PLATFORM_Y,
  MOB_VISUAL_QA_SEED,
  generateMobVisualQaFixture,
} from "../scripts/mob-visual-qa-fixture.ts";
import {
  loadLocalWorldRegistry,
  listLocalWorlds,
} from "../client/singleplayer/localWorldRegistry.ts";
import {
  loadSinglePlayerSave,
  singlePlayerWorldStorageKeys,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import { validateMobSimulationSnapshot } from "../client/game/mobs.ts";
import { terrainHeight } from "../client/game/terrain.ts";
import { BLOCK, validateVoxelRuntimeSnapshotDetailed } from "../client/game/types.ts";

class FixtureStorage implements SinglePlayerStorageAdapter {
  readonly values: Map<string, string>;
  constructor(values: Map<string, string>) { this.values = values; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  listKeys(): string[] { return [...this.values.keys()]; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function fixtureStorage(): FixtureStorage {
  const generated = generateMobVisualQaFixture();
  return new FixtureStorage(new Map(generated.manifest.keys.map(({ key, value }) => [key, value])));
}

test("mob visual QA fixture is byte deterministic and checksummed", () => {
  const first = generateMobVisualQaFixture();
  const second = generateMobVisualQaFixture();
  assert.equal(first.manifestText, second.manifestText);
  assert.equal(first.installerText, second.installerText);
  assert.equal(first.manifest.format, MOB_VISUAL_QA_FIXTURE_FORMAT);
  assert.match(first.manifest.fixtureDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.manifest.keyCount, first.manifest.keys.length);
  assert.equal(new Set(first.manifest.keys.map(({ key }) => key)).size, first.manifest.keyCount);
  assert.ok(first.installerText.includes("Refusing to replace existing single-player data"));
  assert.ok(first.installerText.includes("crypto.subtle.digest(\"SHA-256\""));
  assert.ok(first.installerText.includes("Storage readback mismatch"));
});

test("fixture passes the strict registry, journal, runtime, and mob validators", () => {
  const generated = generateMobVisualQaFixture();
  const storage = fixtureStorage();
  const registry = loadLocalWorldRegistry(storage);
  assert.ok(registry.registry);
  assert.ok(registry.status === "loaded" || registry.status === "recovered");
  assert.equal(registry.registry.worlds.length, 4);
  const listed = listLocalWorlds(storage);
  assert.equal(listed.worlds.length, 4);
  assert.ok(listed.worlds.every(({ health, capacity }) => health === "healthy" && capacity === "ok"));

  for (const world of generated.manifest.worlds) {
    const load = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.worldId });
    assert.ok(load.status === "loaded" || load.status === "recovered", `${world.role} journal must load`);
    assert.ok(load.snapshot?.runtime);
    assert.equal(load.snapshot.world.worldId, world.worldId);
    assert.equal(load.snapshot.world.seed, MOB_VISUAL_QA_SEED);
    const runtime = validateVoxelRuntimeSnapshotDetailed(load.snapshot.runtime);
    assert.equal(runtime.ok, true);
    assert.ok(validateMobSimulationSnapshot(load.snapshot.runtime.mobSimulation));
    const values = singlePlayerWorldStorageKeys(world.worldId).map((key) => storage.getItem(key));
    assert.equal(values[0], null, "legacy slot remains absent");
    assert.ok(values[1], "head exists");
    assert.ok(values[2], "slot A exists");
    assert.ok(values[3], "slot B exists");
  }
});

test("wide and narrow lineups are front-facing, in-band, unoccluded, and keep the pig in frame", () => {
  const generated = generateMobVisualQaFixture();
  const expectedKinds = new Set(["pig", "cow", "sheep", "chicken", "zombie", "skeleton", "creeper"]);
  const observedKinds = new Set(generated.manifest.worlds.flatMap(({ mobs }) => mobs.map(({ kind }) => kind)));
  assert.deepEqual(observedKinds, expectedKinds);

  for (const world of generated.manifest.worlds) {
    const verticalFov = Math.PI / 3;
    const halfHorizontalFov = Math.atan(Math.tan(verticalFov / 2) * world.viewport.width / world.viewport.height);
    for (const mob of world.mobs) {
      const forward = world.camera.z - mob.z;
      const lateral = Math.abs(world.camera.x - mob.x);
      const distance = Math.hypot(forward, lateral);
      assert.equal(mob.y, MOB_VISUAL_QA_PLATFORM_Y + 1);
      assert.equal(mob.yaw, 0, `${world.role}/${mob.kind} faces camera on +Z`);
      assert.ok(distance >= world.distanceBandBlocks[0] && distance <= world.distanceBandBlocks[1]);
      assert.ok(Math.atan2(lateral + 0.55, forward) < halfHorizontalFov - 0.015,
        `${world.role}/${mob.kind} full body remains horizontally inside frame`);
      assert.equal(terrainHeight(Math.floor(mob.x), Math.floor(mob.z), MOB_VISUAL_QA_SEED), MOB_VISUAL_QA_PLATFORM_Y);
    }
  }

  const wide = generated.manifest.worlds.find(({ role }) => role === "wide")!;
  assert.equal(wide.mobs.length, 7);
  const pig = wide.mobs.find(({ kind }) => kind === "pig")!;
  assert.ok(pig.x > -5, "pig has deliberate left-edge margin");
  assert.equal(wide.mobs.find(({ kind }) => kind === "creeper")?.fuseProgress, 0,
    "baseline creeper is parked without a visible fuse");
  assert.deepEqual(
    generated.manifest.worlds.filter(({ role }) => role.startsWith("narrow")).map(({ mobs }) => mobs.length),
    [4, 3],
  );
});

test("state fixture persists shearing, walking interpolation, and a delayed visible creeper fuse", () => {
  const generated = generateMobVisualQaFixture();
  const states = generated.manifest.worlds.find(({ role }) => role === "states")!;
  assert.equal(states.mobs.find(({ kind }) => kind === "sheep")?.sheared, true);
  assert.equal(states.mobs.find(({ kind }) => kind === "cow")?.walking, true);
  const creeper = states.mobs.find(({ kind }) => kind === "creeper")!;
  assert.ok(creeper.fuseProgress >= 0.5 && creeper.fuseProgress <= 0.55);

  const storage = fixtureStorage();
  const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: states.worldId });
  assert.ok(loaded.snapshot?.runtime);
  const edits = new Map(loaded.snapshot.world.edits.map((edit) => [`${edit.x}:${edit.y}:${edit.z}`, edit.block]));
  for (const mob of states.mobs) {
    assert.equal(edits.get(`${Math.floor(mob.x)}:${MOB_VISUAL_QA_PLATFORM_Y}:${Math.floor(mob.z)}`), BLOCK.WOOL);
  }
  assert.equal(edits.get(`-3:${MOB_VISUAL_QA_PLATFORM_Y + 1}:2`), BLOCK.TORCH);
  assert.equal(edits.get(`3:${MOB_VISUAL_QA_PLATFORM_Y + 1}:2`), BLOCK.TORCH);
});

async function sourceFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await sourceFiles(resolved));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) output.push(resolved);
  }
  return output;
}

test("production source graph has no QA fixture import or runtime hook", async () => {
  for (const root of ["client", "server", "shared"]) {
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, "utf8");
      assert.equal(source.includes(MOB_VISUAL_QA_IMPORT_SENTINEL), false, `${file} must not reference QA fixture tooling`);
    }
  }
});

test("shipping proof distinguishes ordinary source artifacts from canonical stages", async () => {
  const runbook = await readFile("docs/mob-visual-qa-fixture.md", "utf8");
  assert.match(runbook, /both builds must succeed/);
  assert.match(runbook, /Do \*\*not\*\* require the ordinary raw artifacts to be\nbyte-identical/);
  assert.match(runbook, /scripts\/build-lakebed-audit\.mjs/);
  assert.match(runbook, /Main, head A, and head B must be byte-identical/);
  assert.doesNotMatch(runbook, /Any delta is a blocker and indicates the tooling leaked/);
});
