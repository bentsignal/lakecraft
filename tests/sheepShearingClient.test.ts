import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../client/game/mobRenderer.ts", import.meta.url), "utf8");

const secondary = engine.slice(
  engine.indexOf("} else if (button === 2)"),
  engine.indexOf("const pressedMouseButtons"),
);
assert.ok(secondary.indexOf("useMobUnderCrosshair()") < secondary.indexOf("createDoorToggleEdit"), "mob use precedes doors, block UI, food, and placement");
assert.ok(secondary.includes("if (useMobUnderCrosshair()) return"), "a handled sheep click cannot also place a block");
assert.match(engine, /mobTargetHasClickPriority\(mobTarget\.distance, target\?\.distance \?\? null\)/, "solid blocks still occlude secondary mob use");

const localUse = singleplayer.slice(singleplayer.indexOf("onMobUse:"), singleplayer.indexOf("onPlayerHealthChange:"));
assert.match(localUse, /target\.kind !== "sheep"[\s\S]*?itemId !== "shears"/, "local interaction requires sheep plus selected shears");
assert.ok(localUse.indexOf("applyConfirmedDurableItemUse") < localUse.indexOf("addItem(wear.inventory, \"wool\""));
assert.ok(localUse.indexOf("added.remainder !== 0") < localUse.indexOf("acceptedInventory = added.inventory"), "full inventory rejects before any local commit");
assert.match(localUse, /if \(result\.ok && acceptedInventory\)[\s\S]*?updateInventory\(acceptedInventory\)/, "accepted clip commits wool and exactly one durability result together");

const networkUse = multiplayer.slice(multiplayer.indexOf("onMobUse:"), multiplayer.indexOf("onMobAttack:"));
assert.match(networkUse, /retryExactLakebedMutation\(\(\) => shearMob\(target\.id, target\.kind, operationId\)\)/, "transport retry reuses one exact operation ID");
assert.ok(networkUse.indexOf("if (!result.ok)") < networkUse.indexOf("applyMobCombatStates"), "rejected interactions never change local authority state");
assert.ok(networkUse.includes("loadCanonicalPlayer(result.inventory)"), "accepted shearing reconciles Lakebed's canonical inventory");
assert.doesNotMatch(networkUse, /setInterval|setTimeout/, "shearing adds no request or polling loop");

assert.match(renderer, /if \(sheared\) appendBox[\s\S]*?else appendBox/, "sheared sheep use a visibly distinct narrow body in the existing batch");

console.log("right-click sheep shearing client integration tests passed");
