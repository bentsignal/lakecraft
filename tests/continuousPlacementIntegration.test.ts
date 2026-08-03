import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");
const singlePlayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const secondary = engine.slice(
  engine.indexOf("} else if (button === 2)"),
  engine.indexOf("const pressedMouseButtons"),
);
const secondaryRelease = engine.slice(
  engine.indexOf("function applyCapturedMouseUp"),
  engine.indexOf("function onMouseUp"),
);
const update = engine.slice(engine.indexOf("function update(dt"), engine.indexOf("function bindBuffer"));
const placement = engine.slice(engine.indexOf("function tryPlaceSelectedBlock"), engine.indexOf("function attackEntityUnderCrosshair"));
const teardown = engine.slice(engine.indexOf("destroy()"), engine.indexOf("applyWorldEdits"));
const pause = engine.slice(engine.indexOf("setPaused(nextPaused)"), engine.indexOf("isPaused()"));

assert.ok(types.includes("continuousBlockPlacement?: boolean"), "held placement is an explicit default-off engine option");
assert.ok(types.includes("canPlaceSelectedBlock?: (block: BlockId) => boolean"), "the inventory owner preflights every placement synchronously");
assert.ok(singlePlayer.includes("continuousBlockPlacement: true"), "only the offline app opts into repeat placement");
assert.ok(singlePlayer.includes("ITEM_TO_ENGINE[stack.itemId] === block"), "single-player proves the selected stack can pay for the exact engine block");
assert.ok(singlePlayer.includes("consumeSelectedPlacementStack(next, selectedSlot, placedItem)"),
  "accepted initial and repeated edits consume exactly the selected slot");
assert.ok(singlePlayer.includes("ITEM_TO_ENGINE[placedItem] !== edit.block")
  && singlePlayer.includes("selectedStack?.itemId !== placedItem"), "placement settlement reasserts selected item and engine block identity");
assert.ok(singlePlayer.includes("engine.setSelectedBlock(nextSelected ? ITEM_TO_ENGINE[nextSelected.itemId] ?? BLOCK.AIR : BLOCK.AIR)"),
  "selected depletion synchronously disarms the engine before React reconciliation");
assert.doesNotMatch(singlePlayer.slice(singlePlayer.indexOf("onBlockEdit:"), singlePlayer.indexOf("onMobDrops:")),
  /removeItem\(next, held, 1\)/, "placement never drains a different matching stack");
assert.equal(multiplayer.includes("continuousBlockPlacement: true"), false, "multiplayer gains no repeat edit cadence or Lakebed traffic");

for (const discrete of ["useMobUnderCrosshair", "createDoorToggleEdit", "tryInteractBlock", "isRangedWeaponSelected", "onUseSelectedItem"]) {
  assert.ok(secondary.indexOf(discrete) < secondary.indexOf("tryPlaceSelectedBlock()"), `${discrete} remains discrete before ordinary placement can arm`);
}
assert.ok(secondary.indexOf("if (secondaryButtonHeld) return") < secondary.indexOf("useMobUnderCrosshair"),
  "a duplicate physical mousedown is rejected before any discrete callback can fire again");
assert.ok(secondary.includes("pressSecondaryPlacement(accepted && stillPayable, placementBlock"),
  "only an accepted ordinary placement with selected inventory remaining can arm repeats");
assert.ok(secondary.includes("selectedBlock === placementBlock")
  && secondary.includes("canPlaceSelectedBlock?.(placementBlock) !== false")
  && secondary.includes("accepted && stillPayable"),
"an accepted final selected block cannot be re-armed after synchronous inventory settlement switches the engine to air");
assert.ok(placement.indexOf("emitEdit(") < placement.indexOf('emitHandAction("place")'),
  "rejected edits never consume the one visible place action");
assert.ok(placement.includes("canPlaceSelectedBlock?.(selectedBlock) === false"), "empty or stale selected stacks cannot place free blocks");
assert.ok(update.indexOf("target = nextTarget") < update.indexOf("repeatHeldBlockPlacement(now)"), "each repeat uses the freshly raycast target");
assert.doesNotMatch(placement, /setTimeout|setInterval/, "held placement adds no timer or polling loop");

assert.match(secondaryRelease, /button === 2[\s\S]{0,100}cancelSecondaryPlacementHold\(true\)/,
  "right-button release disarms placement before bow release handling");
assert.match(engine, /function releaseTransientInput[\s\S]{0,180}cancelSecondaryPlacementHold\(true\)/,
  "blur and visibility cleanup disarm placement");
assert.match(engine, /function onPointerLockChange[\s\S]{0,220}releaseTransientInput\(\)/,
  "pointer-lock loss disarms placement");
assert.ok(teardown.includes("cancelSecondaryPlacementHold(true);"), "teardown cannot retain a physical button state");
assert.ok(pause.includes("cancelSecondaryPlacementHold(true);"), "pause disarms held placement");
assert.match(engine, /if \(playerHealth <= 0\)[\s\S]{0,300}cancelSecondaryPlacementHold\(true\)/,
  "death disarms held placement before further world input");
assert.match(engine, /setSelectedBlock\(block\)[\s\S]{0,140}block !== selectedBlock[\s\S]{0,80}cancelSecondaryPlacementHold\(\)/,
  "selected item changes disarm without count-only rerenders breaking a valid chain");
assert.ok(engine.includes("cancelSecondaryPlacementHold();\n      options.onHotbarSelect")
  && engine.includes("cancelSecondaryPlacementHold();\n    options.onHotbarCycle"), "number and wheel slot changes disarm immediately");
assert.match(engine, /reconcilePose\(nextPose\) \{\s+cancelSecondaryPlacementHold\(true\)/,
  "authoritative pose reconciliation cannot retain stale physical secondary input");
assert.match(engine, /importRuntimeSnapshot\(value\)[\s\S]{0,1200}clearMining\(\);\s+cancelSecondaryPlacementHold\(true\);/,
  "runtime restoration clears held placement beside the existing mining and bow reset");
assert.match(engine, /respawn\(\) \{\s+cancelSecondaryPlacementHold\(true\)/,
  "respawn starts with no latent held placement");

console.log("continuous placement engine integration tests passed");
