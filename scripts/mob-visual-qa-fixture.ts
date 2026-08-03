#!/usr/bin/env -S node --experimental-strip-types

/**
 * Test-only generator for PR16 mob-renderer visual evidence.
 *
 * This file is deliberately outside client/, server/, and shared/. It uses the
 * shipping serializers as a consumer, but is never imported by the capsule.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOCAL_WORLD_REGISTRY_SLOT_A_KEY,
  LOCAL_WORLD_REGISTRY_SLOT_B_KEY,
  createLocalWorld,
  listLocalWorlds,
  loadLocalWorldRegistry,
  type LocalWorldRecord,
} from "../client/singleplayer/localWorldRegistry.ts";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import {
  createMobSimulation,
  exportMobSimulationSnapshot,
  type MobKind,
  type MobSpawnDescriptor,
  type MobState,
} from "../client/game/mobs.ts";
import { DEFAULT_FOV_RADIANS, STANDING_EYE_HEIGHT } from "../client/game/playerMovement.ts";
import { terrainHeight } from "../client/game/terrain.ts";
import { BLOCK, VOXEL_RUNTIME_SNAPSHOT_VERSION, type WorldEdit } from "../client/game/types.ts";

export const MOB_VISUAL_QA_FIXTURE_FORMAT = "lakecraft.mob-visual-qa-fixture" as const;
export const MOB_VISUAL_QA_FIXTURE_VERSION = 1 as const;
export const MOB_VISUAL_QA_IMPORT_SENTINEL = "mob-visual-qa-fixture" as const;
export const MOB_VISUAL_QA_SEED = 33;
export const MOB_VISUAL_QA_TIMESTAMP = 1_800_000_000_000;
export const MOB_VISUAL_QA_PLATFORM_Y = 30;

export type MobVisualQaRole = "wide" | "narrow-animals" | "narrow-hostiles" | "states";

export interface MobVisualQaWorldManifest {
  role: MobVisualQaRole;
  worldId: string;
  name: string;
  viewport: { width: number; height: number };
  distanceBandBlocks: readonly [number, number];
  camera: { x: number; y: number; z: number; yaw: number; pitch: number };
  mobs: Array<{
    id: string;
    kind: MobKind;
    x: number;
    y: number;
    z: number;
    yaw: number;
    sheared: boolean;
    walking: boolean;
    fuseProgress: number;
  }>;
}

export interface MobVisualQaFixtureManifest {
  format: typeof MOB_VISUAL_QA_FIXTURE_FORMAT;
  version: typeof MOB_VISUAL_QA_FIXTURE_VERSION;
  fixtureDigest: string;
  generatedAt: number;
  seed: number;
  keyCount: number;
  keys: Array<{ key: string; chars: number; sha256: string; value: string }>;
  worlds: MobVisualQaWorldManifest[];
}

export interface GeneratedMobVisualQaFixture {
  manifest: MobVisualQaFixtureManifest;
  manifestText: string;
  installerText: string;
}

class MemoryStorage implements SinglePlayerStorageAdapter {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  listKeys(): string[] {
    return [...this.values.keys()].sort();
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

interface WorldPlan {
  role: MobVisualQaRole;
  name: string;
  createdAt: number;
  viewport: { width: number; height: number };
  distanceBandBlocks: readonly [number, number];
  camera: { x: number; y: number; z: number; yaw: number; pitch: number };
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawns: Array<{ kind: MobKind; x: number; z: number }>;
  phase: "day" | "night";
}

const CAMERA_Y = MOB_VISUAL_QA_PLATFORM_Y + 1.02;
const CAMERA_Z = 4.5;
const CAMERA_PITCH = -0.08;

const WORLD_PLANS: readonly WorldPlan[] = [
  {
    role: "wide",
    name: "Mob QA Wide",
    createdAt: MOB_VISUAL_QA_TIMESTAMP,
    viewport: { width: 1280, height: 720 },
    distanceBandBlocks: [4, 8],
    camera: { x: 0, y: CAMERA_Y, z: CAMERA_Z, yaw: 0, pitch: CAMERA_PITCH },
    floor: { minX: -7, maxX: 7, minZ: -4, maxZ: 5 },
    spawns: [
      { kind: "pig", x: -4.6, z: -2 },
      { kind: "cow", x: -3.07, z: -2 },
      { kind: "sheep", x: -1.53, z: -2 },
      { kind: "creeper", x: 0, z: -2 },
      { kind: "chicken", x: 1.53, z: -2 },
      { kind: "zombie", x: 3.07, z: -2 },
      { kind: "skeleton", x: 4.6, z: -2 },
    ],
    phase: "day",
  },
  {
    role: "narrow-animals",
    name: "Mob QA Narrow Animals",
    createdAt: MOB_VISUAL_QA_TIMESTAMP + 1,
    viewport: { width: 800, height: 720 },
    distanceBandBlocks: [3, 6],
    camera: { x: 0, y: CAMERA_Y, z: CAMERA_Z, yaw: 0, pitch: CAMERA_PITCH },
    floor: { minX: -4, maxX: 4, minZ: -3, maxZ: 5 },
    spawns: [
      { kind: "pig", x: -1.8, z: 0 },
      { kind: "cow", x: -0.6, z: 0 },
      { kind: "sheep", x: 0.6, z: 0 },
      { kind: "chicken", x: 1.8, z: 0 },
    ],
    phase: "day",
  },
  {
    role: "narrow-hostiles",
    name: "Mob QA Narrow Hostiles",
    createdAt: MOB_VISUAL_QA_TIMESTAMP + 2,
    viewport: { width: 800, height: 720 },
    distanceBandBlocks: [3, 6],
    camera: { x: 0, y: CAMERA_Y, z: CAMERA_Z, yaw: 0, pitch: CAMERA_PITCH },
    floor: { minX: -4, maxX: 4, minZ: -3, maxZ: 5 },
    spawns: [
      { kind: "zombie", x: -1.35, z: 0 },
      { kind: "skeleton", x: 0, z: 0 },
      { kind: "creeper", x: 1.35, z: 0 },
    ],
    phase: "day",
  },
  {
    role: "states",
    name: "Mob QA States",
    createdAt: MOB_VISUAL_QA_TIMESTAMP + 3,
    viewport: { width: 800, height: 720 },
    distanceBandBlocks: [3, 6],
    camera: { x: 0, y: CAMERA_Y, z: CAMERA_Z, yaw: 0, pitch: CAMERA_PITCH },
    floor: { minX: -4, maxX: 4, minZ: -3, maxZ: 5 },
    spawns: [
      { kind: "cow", x: -1.65, z: 0 },
      { kind: "sheep", x: 0, z: 0 },
      { kind: "creeper", x: 1.65, z: 0.25 },
    ],
    phase: "night",
  },
] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function coordinateKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function createPlatformEdits(plan: WorldPlan): WorldEdit[] {
  const edits = new Map<string, WorldEdit>();
  for (let x = plan.floor.minX; x <= plan.floor.maxX; x += 1) {
    for (let z = plan.floor.minZ; z <= plan.floor.maxZ; z += 1) {
      const edit = { x, y: MOB_VISUAL_QA_PLATFORM_Y, z, block: BLOCK.STONE_BRICKS };
      edits.set(coordinateKey(x, edit.y, z), edit);
    }
  }
  // One contrasting, non-occluding floor cell identifies every exact mob pose.
  for (const spawn of plan.spawns) {
    const x = Math.floor(spawn.x);
    const z = Math.floor(spawn.z);
    const edit = { x, y: MOB_VISUAL_QA_PLATFORM_Y, z, block: BLOCK.WOOL };
    edits.set(coordinateKey(x, edit.y, z), edit);
  }
  // Warm light for the deliberately nighttime state frame; both lights remain
  // behind the mob line and outside the camera-to-face rays.
  if (plan.phase === "night") {
    for (const x of [-3, 3]) {
      const edit = { x, y: MOB_VISUAL_QA_PLATFORM_Y + 1, z: 2, block: BLOCK.TORCH };
      edits.set(coordinateKey(x, edit.y, edit.z), edit);
    }
  }
  return [...edits.values()].sort((left, right) =>
    left.x - right.x || left.y - right.y || left.z - right.z || left.block - right.block);
}

function spawnDescriptor(plan: WorldPlan, index: number): MobSpawnDescriptor {
  const spawn = plan.spawns[index];
  return {
    id: `qa-${plan.role}-${spawn.kind}-${index}`,
    kind: spawn.kind,
    x: spawn.x,
    y: MOB_VISUAL_QA_PLATFORM_Y + 1,
    z: spawn.z,
    // Mob detail planes are on local +Z, so yaw zero faces the +Z camera.
    yaw: 0,
    homeX: spawn.x,
    homeZ: spawn.z,
    behaviorSeed: 0x5100_0000 + index + plan.createdAt - MOB_VISUAL_QA_TIMESTAMP,
  };
}

function setStableMobState(mob: MobState, elapsedSeconds: number): void {
  mob.previousX = mob.x;
  mob.previousY = mob.y;
  mob.previousZ = mob.z;
  mob.previousYaw = mob.yaw;
  mob.behavior = mob.kind === "zombie" || mob.kind === "skeleton" || mob.kind === "creeper"
    ? "dormant"
    : "idle";
  mob.behaviorUntilSeconds = elapsedSeconds + 1_000_000;
  mob.directionX = 0;
  mob.directionZ = 0;
  mob.desiredX = mob.x;
  mob.desiredZ = mob.z;
  mob.hostileActive = false;
  mob.nextContactDamageAtSeconds = elapsedSeconds + 1_000_000;
  mob.nextRangedAttackAtSeconds = elapsedSeconds + 1_000_000;
}

function createSnapshot(plan: WorldPlan, world: LocalWorldRecord): SinglePlayerSnapshot {
  const elapsedSeconds = 100;
  const simulation = createMobSimulation(plan.spawns.map((_spawn, index) => spawnDescriptor(plan, index)));
  simulation.elapsedSeconds = elapsedSeconds;
  simulation.tick = 3_000;
  for (const mob of simulation.mobs) setStableMobState(mob, elapsedSeconds);

  // Creepers stay hostile in daylight. A strictly valid, future-scheduled fuse
  // parks baseline creepers without rendering any fuse progress, so paired
  // frames remain stable and the visual test never needs a shipping QA hook.
  // The dedicated state world below uses a real visible in-progress fuse.
  if (plan.role !== "states") {
    const parkedCreeper = simulation.mobs.find(({ kind }) => kind === "creeper");
    if (parkedCreeper) {
      parkedCreeper.behavior = "fuse";
      parkedCreeper.hostileActive = true;
      parkedCreeper.fuseStartedAtSeconds = elapsedSeconds + 100;
      parkedCreeper.fuseUntilSeconds = elapsedSeconds + 110;
      parkedCreeper.behaviorUntilSeconds = parkedCreeper.fuseUntilSeconds;
    }
  }

  if (plan.role === "states") {
    const walkingCow = simulation.mobs.find(({ kind }) => kind === "cow")!;
    walkingCow.behavior = "wander";
    walkingCow.behaviorUntilSeconds = elapsedSeconds + 10;
    walkingCow.directionX = 0.8;
    walkingCow.directionZ = 0.6;
    walkingCow.desiredX = walkingCow.x + 1.25;
    walkingCow.desiredZ = walkingCow.z + 0.94;
    walkingCow.previousX = walkingCow.x - 0.24;
    walkingCow.previousZ = walkingCow.z - 0.18;

    const shearedSheep = simulation.mobs.find(({ kind }) => kind === "sheep")!;
    shearedSheep.sheared = true;

    const fusingCreeper = simulation.mobs.find(({ kind }) => kind === "creeper")!;
    fusingCreeper.behavior = "fuse";
    fusingCreeper.hostileActive = true;
    fusingCreeper.fuseStartedAtSeconds = elapsedSeconds - 0.8;
    // A deliberately delayed due time leaves enough real time for rapid pause
    // and capture while the renderer still derives a visible 0.53 progress.
    // Keep the authentic fused state visible long enough for a human to enter,
    // pause, and capture it without weakening the runtime's fuse validation.
    fusingCreeper.fuseUntilSeconds = elapsedSeconds + 30;
    fusingCreeper.behaviorUntilSeconds = fusingCreeper.fuseUntilSeconds;
  }

  const snapshot = createDefaultSinglePlayerSnapshot(MOB_VISUAL_QA_SEED, plan.createdAt, world.id);
  snapshot.world.gameMode = "creative";
  snapshot.world.activePlayMs = 60_000;
  snapshot.world.edits = createPlatformEdits(plan);
  snapshot.runtime = {
    version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
    pose: { ...plan.camera },
    respawnPoint: { ...plan.camera },
    playerHealth: 20,
    worldTimeMs: plan.createdAt,
    dayNight: {
      cycleLengthMs: 1_000_000_000_000,
      epochMs: plan.createdAt,
      epochPhase: plan.phase === "day" ? 0.5 : 0,
    },
    mobAccumulatorSeconds: 0,
    mobSimulation: exportMobSimulationSnapshot(simulation),
  };
  return snapshot;
}

function horizontalHalfFov(viewport: Readonly<{ width: number; height: number }>): number {
  return Math.atan(Math.tan(DEFAULT_FOV_RADIANS / 2) * viewport.width / viewport.height);
}

function fuseProgress(mob: Readonly<MobState>, elapsedSeconds: number): number {
  return mob.fuseStartedAtSeconds > 0
    ? Math.max(0, Math.min(1, (elapsedSeconds - mob.fuseStartedAtSeconds) / 1.5))
    : 0;
}

function manifestWorld(plan: WorldPlan, world: LocalWorldRecord, snapshot: SinglePlayerSnapshot): MobVisualQaWorldManifest {
  const simulation = snapshot.runtime!.mobSimulation;
  return {
    role: plan.role,
    worldId: world.id,
    name: world.name,
    viewport: { ...plan.viewport },
    distanceBandBlocks: [...plan.distanceBandBlocks],
    camera: { ...plan.camera },
    mobs: simulation.mobs.map((mob) => ({
      id: mob.id,
      kind: mob.kind,
      x: mob.x,
      y: mob.y,
      z: mob.z,
      yaw: mob.yaw,
      sheared: mob.sheared,
      walking: Math.hypot(mob.x - mob.previousX, mob.z - mob.previousZ) > 0.001
        || (mob.behavior === "wander" && Math.hypot(mob.directionX, mob.directionZ) > 0.001),
      fuseProgress: fuseProgress(mob, simulation.elapsedSeconds),
    })),
  };
}

function assertPlanGeometry(plan: WorldPlan): void {
  const halfFov = horizontalHalfFov(plan.viewport);
  for (const spawn of plan.spawns) {
    const forward = plan.camera.z - spawn.z;
    const lateral = Math.abs(spawn.x - plan.camera.x);
    const distance = Math.hypot(lateral, forward);
    if (forward <= 0 || distance < plan.distanceBandBlocks[0] || distance > plan.distanceBandBlocks[1]) {
      throw new Error(`${plan.role}/${spawn.kind} is outside its distance band.`);
    }
    // Include 0.55 blocks of half-width so the pig and every other face remain
    // fully inside the requested viewport, rather than merely placing centers.
    if (Math.atan2(lateral + 0.55, forward) >= halfFov - 0.015) {
      throw new Error(`${plan.role}/${spawn.kind} may clip at the viewport edge.`);
    }
    if (terrainHeight(Math.floor(spawn.x), Math.floor(spawn.z), MOB_VISUAL_QA_SEED) !== MOB_VISUAL_QA_PLATFORM_Y) {
      throw new Error(`${plan.role}/${spawn.kind} is not on the deterministic flat plateau.`);
    }
  }
  if (terrainHeight(plan.camera.x, plan.camera.z, MOB_VISUAL_QA_SEED) !== MOB_VISUAL_QA_PLATFORM_Y) {
    throw new Error(`${plan.role} camera is not on the deterministic flat plateau.`);
  }
  if (plan.camera.y + STANDING_EYE_HEIGHT <= MOB_VISUAL_QA_PLATFORM_Y + 1) {
    throw new Error(`${plan.role} camera eye is occluded by the platform.`);
  }
}

export function generateMobVisualQaFixture(): GeneratedMobVisualQaFixture {
  const storage = new MemoryStorage();
  const worlds: MobVisualQaWorldManifest[] = [];

  for (const plan of WORLD_PLANS) {
    assertPlanGeometry(plan);
    const created = createLocalWorld(storage, {
      name: plan.name,
      seedText: String(MOB_VISUAL_QA_SEED),
      gameMode: "creative",
      now: plan.createdAt,
    });
    if (!created.ok) throw new Error(`Could not create ${plan.role}: ${created.reason}`);
    const snapshot = createSnapshot(plan, created.world);
    const saved = saveSinglePlayerSnapshot(storage, snapshot, plan.createdAt + 100, { worldId: created.world.id });
    if (!saved.ok) throw new Error(`Could not save ${plan.role}: ${saved.reason} ${saved.path ?? ""}`.trim());
    worlds.push(manifestWorld(plan, created.world, saved.envelope.payload));
  }

  const registry = loadLocalWorldRegistry(storage, MOB_VISUAL_QA_TIMESTAMP + 1_000);
  if (!registry.registry || registry.status === "corrupt" || registry.status === "unsupported") {
    throw new Error(`Generated registry did not reload: ${registry.status}`);
  }
  const listed = listLocalWorlds(storage);
  if (listed.worlds.length !== WORLD_PLANS.length
    || listed.worlds.some(({ health, capacity }) => health !== "healthy" || capacity !== "ok")) {
    throw new Error("Generated fixture did not pass the shipping world inspection path.");
  }
  for (const world of worlds) {
    const loaded = loadSinglePlayerSave(storage, { migrateLegacy: false, worldId: world.worldId });
    if ((loaded.status !== "loaded" && loaded.status !== "recovered") || !loaded.snapshot?.runtime) {
      throw new Error(`Generated ${world.role} journal did not reload.`);
    }
  }

  const keys = [...storage.values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, chars: value.length, sha256: sha256(value), value }));
  if (!keys.some(({ key }) => key === LOCAL_WORLD_REGISTRY_SLOT_A_KEY)
    || !keys.some(({ key }) => key === LOCAL_WORLD_REGISTRY_SLOT_B_KEY)) {
    throw new Error("Fixture must include both strict registry slots.");
  }
  const fixtureDigest = sha256(keys.map(({ key, sha256: digest }) => `${key}\0${digest}`).join("\0"));
  const manifest: MobVisualQaFixtureManifest = {
    format: MOB_VISUAL_QA_FIXTURE_FORMAT,
    version: MOB_VISUAL_QA_FIXTURE_VERSION,
    fixtureDigest,
    generatedAt: MOB_VISUAL_QA_TIMESTAMP,
    seed: MOB_VISUAL_QA_SEED,
    keyCount: keys.length,
    keys,
    worlds,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const installerText = createInstaller(manifest);
  return { manifest, manifestText, installerText };
}

function createInstaller(manifest: MobVisualQaFixtureManifest): string {
  const payload = manifest.keys.map(({ key, value, sha256 }) => ({ key, value, sha256 }));
  return `// ${MOB_VISUAL_QA_FIXTURE_FORMAT} v${MOB_VISUAL_QA_FIXTURE_VERSION}\n`
    + `// digest ${manifest.fixtureDigest}; disposable isolated browser profile only\n`
    + `(async () => {\n`
    + `  const payload = ${JSON.stringify(payload)};\n`
    + `  const prefix = "lakecraft.singleplayer.";\n`
    + `  const existing = [];\n`
    + `  for (let i = 0; i < localStorage.length; i += 1) {\n`
    + `    const key = localStorage.key(i);\n`
    + `    if (key && key.startsWith(prefix)) existing.push(key);\n`
    + `  }\n`
    + `  if (existing.length) throw new Error("Refusing to replace existing single-player data: " + existing.sort().join(", "));\n`
    + `  const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");\n`
    + `  const written = [];\n`
    + `  try {\n`
    + `    for (const entry of payload) {\n`
    + `      const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.value)));\n`
    + `      if (digest !== entry.sha256) throw new Error("Payload checksum mismatch: " + entry.key);\n`
    + `      localStorage.setItem(entry.key, entry.value);\n`
    + `      written.push(entry.key);\n`
    + `      if (localStorage.getItem(entry.key) !== entry.value) throw new Error("Storage readback mismatch: " + entry.key);\n`
    + `    }\n`
    + `  } catch (error) {\n`
    + `    for (const key of written.reverse()) localStorage.removeItem(key);\n`
    + `    throw error;\n`
    + `  }\n`
    + `  return { fixture: ${JSON.stringify(manifest.fixtureDigest)}, keyCount: payload.length, worlds: ${JSON.stringify(manifest.worlds.map(({ name }) => name))} };\n`
    + `})();\n`;
}

export async function writeMobVisualQaFixture(outputDirectory: string): Promise<{
  manifestPath: string;
  installerPath: string;
  manifestSha256: string;
  installerSha256: string;
}> {
  const generated = generateMobVisualQaFixture();
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const manifestPath = resolve(directory, "mob-visual-qa-fixture.json");
  const installerPath = resolve(directory, "install-mob-visual-qa-fixture.js");
  await writeFile(manifestPath, generated.manifestText, "utf8");
  await writeFile(installerPath, generated.installerText, "utf8");
  return {
    manifestPath,
    installerPath,
    manifestSha256: sha256(generated.manifestText),
    installerSha256: sha256(generated.installerText),
  };
}

function cliOutputDirectory(args: readonly string[]): string {
  const outIndex = args.indexOf("--out");
  if (outIndex < 0 || !args[outIndex + 1]) {
    throw new Error("Usage: node --experimental-strip-types scripts/mob-visual-qa-fixture.ts --out <directory>");
  }
  return args[outIndex + 1];
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && basename(invokedPath) === basename(fileURLToPath(import.meta.url))) {
  const result = await writeMobVisualQaFixture(cliOutputDirectory(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
