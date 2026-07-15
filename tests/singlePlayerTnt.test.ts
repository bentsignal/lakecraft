import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOCK,
  planLocalTntExplosion,
  tryInteractBlock,
  type BlockId,
  type BlockTarget,
} from "../client/game/index.ts";
import { CREEPER_EXPLOSION_MAX_BLOCKS } from "../shared/creeperExplosion.ts";
import { TNT_FUSE_MS, TNT_IGNITION_REACH } from "../shared/tntAuthority.ts";

const source = { x: 4, y: 8, z: -3 };
const overrides = new Map<string, BlockId>([
  [`${source.x},${source.y},${source.z}`, BLOCK.TNT],
  [`${source.x + 1},${source.y},${source.z}`, BLOCK.CHEST],
  [`${source.x - 1},${source.y},${source.z}`, BLOCK.FURNACE],
  [`${source.x},${source.y},${source.z + 1}`, BLOCK.BED],
  [`${source.x},${source.y},${source.z - 1}`, BLOCK.DOOR_CLOSED],
]);
const readBlock = (x: number, y: number, z: number): BlockId =>
  overrides.get(`${x},${y},${z}`) ?? BLOCK.STONE;
const crater = planLocalTntExplosion(source.x, source.y, source.z, readBlock);

assert.equal(TNT_FUSE_MS, 4_000, "single-player and authoritative multiplayer share the four-second fuse");
assert.ok(crater.length > 0 && crater.length <= CREEPER_EXPLOSION_MAX_BLOCKS, "local crater uses the shared 64-cell blast ceiling");
assert.ok(crater.some((edit) => edit.x === source.x && edit.y === source.y && edit.z === source.z
  && edit.previousBlock === BLOCK.TNT && edit.block === BLOCK.AIR), "the primed source TNT is consumed by its own blast");
for (const protectedBlock of [BLOCK.CHEST, BLOCK.FURNACE, BLOCK.BED, BLOCK.DOOR_CLOSED]) {
  assert.ok(!crater.some((edit) => edit.previousBlock === protectedBlock), `interactive block ${protectedBlock} remains protected`);
}
assert.ok(crater.every((edit) => edit.block === BLOCK.AIR), "the local plan can only destroy blocks");
assert.deepEqual(planLocalTntExplosion(0.5, 8, 0, readBlock), [], "forged fractional centers are rejected");

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
assert.match(appSource, /itemId !== "torch"/, "only the explicitly held torch can ignite local TNT");
assert.match(appSource, /target\.distance > TNT_IGNITION_REACH/, `local ignition rejects targets beyond ${TNT_IGNITION_REACH} blocks`);
assert.match(appSource, /window\.setTimeout\([\s\S]*?TNT_FUSE_MS\)/, "ignition resolves after the shared four-second fuse");
const blastHandler = appSource.slice(appSource.indexOf("const edits = engineRef.current?.explodeTnt"), appSource.indexOf("fuseTimers.set", appSource.indexOf("const edits = engineRef.current?.explodeTnt")));
assert.ok(blastHandler.includes("editsRef.current"), "blast edits are persisted in the local world save");
assert.doesNotMatch(blastHandler, /addItem|getMiningDrop|applyConfirmedToolUse/, "explosion destruction, including source TNT, never produces mining drops or tool wear");

console.log("lakecraft single-player TNT tests: ok");
