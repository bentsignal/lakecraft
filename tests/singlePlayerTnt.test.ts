import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  BLOCK,
  LOCAL_TNT_TERRAIN_MAX_BLOCKS,
  LOCAL_TNT_TERRAIN_RADIUS,
  localTntDestructionThreshold,
  planLocalTntExplosion,
  tryInteractBlock,
  type BlockId,
  type BlockTarget,
} from "../client/game/index.ts";
import { TNT_FUSE_MS, TNT_IGNITION_REACH } from "../shared/tntAuthority.ts";

const source = { x: 4, y: 8, z: -3 };
const overrides = new Map<string, BlockId>([
  [`${source.x},${source.y},${source.z}`, BLOCK.TNT],
  [`${source.x + 1},${source.y},${source.z}`, BLOCK.CHEST],
  [`${source.x - 1},${source.y},${source.z}`, BLOCK.FURNACE],
  [`${source.x},${source.y},${source.z + 1}`, BLOCK.BED],
  [`${source.x},${source.y},${source.z - 1}`, BLOCK.DOOR_CLOSED],
  [`${source.x},${source.y + 1},${source.z}`, BLOCK.TNT],
]);
const readBlock = (x: number, y: number, z: number): BlockId =>
  overrides.get(`${x},${y},${z}`) ?? BLOCK.STONE;
const crater = planLocalTntExplosion(source.x, source.y, source.z, readBlock);

assert.equal(TNT_FUSE_MS, 4_000, "single-player and authoritative multiplayer share the four-second fuse");
assert.equal(LOCAL_TNT_TERRAIN_RADIUS, 4.5);
assert.equal(LOCAL_TNT_TERRAIN_MAX_BLOCKS, 192, "one local terrain blast remains capped at exactly three old 64-cell plans");
assert.ok(crater.length > 0 && crater.length <= LOCAL_TNT_TERRAIN_MAX_BLOCKS, "the larger local crater remains strictly bounded");
assert.ok(crater.some((edit) => edit.x === source.x && edit.y === source.y && edit.z === source.z
  && edit.previousBlock === BLOCK.TNT && edit.block === BLOCK.AIR), "the primed source TNT is consumed by its own blast");
for (const protectedBlock of [BLOCK.CHEST, BLOCK.FURNACE, BLOCK.DOOR_CLOSED]) {
  assert.ok(!crater.some((edit) => edit.previousBlock === protectedBlock), `interactive block ${protectedBlock} remains protected`);
}
assert.ok(crater.some((edit) => edit.previousBlock === BLOCK.BED && edit.block === BLOCK.AIR),
  "beds enter the crater so the engine can atomically reconcile their paired metadata");
assert.ok(crater.some((edit) => edit.previousBlock === BLOCK.TNT && edit.chainPrimed === true
  && edit.block === BLOCK.TNT), "neighboring TNT remains in terrain and receives a secondary fuse");
assert.ok(crater.every((edit) => edit.block === BLOCK.AIR || edit.chainPrimed === true), "the local plan can only destroy blocks or prime neighboring TNT");
assert.deepEqual(planLocalTntExplosion(0.5, 8, 0, readBlock), [], "forged fractional centers are rejected");

const stoneCrater = planLocalTntExplosion(0, 8, 0, () => BLOCK.STONE);
const brickCrater = planLocalTntExplosion(0, 8, 0, () => BLOCK.BRICKS);
const soilCrater = planLocalTntExplosion(0, 8, 0, () => BLOCK.DIRT);
const extent = (edits: typeof stoneCrater, axis: "x" | "y" | "z") => [
  Math.min(...edits.map((edit) => edit[axis])),
  Math.max(...edits.map((edit) => edit[axis])),
] as const;
assert.deepEqual(extent(stoneCrater, "y"), [5, 10], "ordinary stone reaches three blocks down and two blocks up");
assert.deepEqual(extent(stoneCrater, "x"), [-3, 3], "ordinary stone produces a recognizable seven-block-wide crater");
assert.deepEqual(extent(soilCrater, "x"), [-4, 4], "soft soil loses a wider nine-block cross-section");
assert.ok(soilCrater.length > stoneCrater.length && stoneCrater.length > brickCrater.length,
  "deterministic material thresholds make soil weaker than stone and brick");
assert.ok(localTntDestructionThreshold(BLOCK.DIRT) > localTntDestructionThreshold(BLOCK.STONE)
  && localTntDestructionThreshold(BLOCK.STONE) > localTntDestructionThreshold(BLOCK.BRICKS));
assert.deepEqual(planLocalTntExplosion(0, 8, 0, () => BLOCK.STONE), stoneCrater,
  "identical terrain produces an exactly ordered deterministic crater");
const perimeterTnt = { x: 2, y: 10, z: 0 };
const cappedSoilCrater = planLocalTntExplosion(0, 8, 0, (x, y, z) =>
  x === perimeterTnt.x && y === perimeterTnt.y && z === perimeterTnt.z ? BLOCK.TNT : BLOCK.DIRT);
assert.ok(cappedSoilCrater.some((edit) => edit.chainPrimed && edit.x === perimeterTnt.x
  && edit.y === perimeterTnt.y && edit.z === perimeterTnt.z),
"chain TNT inside the ellipsoid is prioritized even when nearer soil fills the 192-entry cap");

const chainWorld = new Map<string, BlockId>();
for (let blockY = 3; blockY <= 12; blockY += 1) {
  for (let blockZ = -8; blockZ <= 8; blockZ += 1) {
    for (let blockX = -8; blockX <= 12; blockX += 1) chainWorld.set(`${blockX},${blockY},${blockZ}`, BLOCK.STONE);
  }
}
const grid = [[0, 8, 0], [1, 8, 0], [2, 8, 0], [0, 8, 1], [1, 8, 1], [2, 8, 1]] as const;
for (const coordinate of grid) chainWorld.set(coordinate.join(","), BLOCK.TNT);
const queued: Array<readonly [number, number, number]> = [grid[0]];
const exploded = new Set<string>();
const destroyed = new Set<string>();
while (queued.length > 0) {
  const coordinate = queued.shift()!;
  const key = coordinate.join(",");
  if (exploded.has(key)) continue;
  exploded.add(key);
  for (const edit of planLocalTntExplosion(...coordinate, (blockX, blockY, blockZ) =>
    chainWorld.get(`${blockX},${blockY},${blockZ}`) ?? BLOCK.AIR)) {
    if (edit.chainPrimed) queued.push([edit.x, edit.y, edit.z]);
    else {
      const editKey = `${edit.x},${edit.y},${edit.z}`;
      chainWorld.set(editKey, BLOCK.AIR);
      destroyed.add(editKey);
    }
  }
}
assert.equal(exploded.size, 6, "the compact six-TNT grid primes every source exactly once");
assert.ok(destroyed.size >= 270, `the compact chain destroys a substantial combined volume (${destroyed.size})`);

const plannerStartedAt = performance.now();
let plannedCells = 0;
for (let iteration = 0; iteration < 1_000; iteration += 1) {
  plannedCells += planLocalTntExplosion(iteration, 8, 0, () => BLOCK.STONE).length;
}
const plannerElapsedMs = performance.now() - plannerStartedAt;
assert.equal(plannedCells, stoneCrater.length * 1_000);
assert.ok(plannerElapsedMs < 250, `1,000 bounded terrain plans took ${plannerElapsedMs.toFixed(1)}ms`);

const target: BlockTarget = {
  block: { ...source, block: BLOCK.TNT },
  place: { x: source.x, y: source.y + 1, z: source.z },
  distance: 4.5,
};
let interactions = 0;
assert.equal(tryInteractBlock(target, (received) => {
  interactions += 1;
  assert.equal(received, target);
  return true;
}), true, "right-click can dispatch explicit TNT ignition before adjacent placement");
assert.equal(interactions, 1);

const appSource = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.doesNotMatch(appSource, /lakebed\/(?:client|server)/, "single-player TNT cannot create Lakebed traffic");
assert.match(appSource, /itemId !== "flint_and_steel"/, "only explicitly held flint and steel can ignite local TNT");
assert.match(appSource, /applyConfirmedDurableItemUse[\s\S]*?"flint_and_steel"/, "a confirmed local ignition spends exactly one tool use");
assert.match(appSource, /target\.distance > TNT_IGNITION_REACH/, `local ignition rejects targets beyond ${TNT_IGNITION_REACH} blocks`);
assert.match(appSource, /primeLocalTnt\(x, y, z, TNT_FUSE_MS, 0, true\)/, "ignition schedules the shared four-second fuse");
assert.match(appSource, /candidate\.chainPrimed[\s\S]*?slice\(0, 8\)/, "local chain reactions share the bounded eight-child cascade ceiling");
const blastHandler = appSource.slice(appSource.indexOf("const edits = engineRef.current?.explodeTnt"), appSource.indexOf("fuseTimers.set", appSource.indexOf("const edits = engineRef.current?.explodeTnt")));
assert.ok(blastHandler.includes("recordLocalExplosion") && appSource.includes("acceptWorldEdits: acceptLocalWorldEdits"),
  "blast edits reserve the local journal before the engine changes terrain");
assert.doesNotMatch(blastHandler, /addItem|getMiningDrop|applyConfirmedToolUse/, "explosion destruction, including source TNT, never produces mining drops or tool wear");

console.log("lakecraft single-player TNT tests: ok");
