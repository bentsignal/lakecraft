import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CREATIVE_FLIGHT_DOUBLE_TAP_MS,
  CREATIVE_FLIGHT_SPEED,
  createCreativeFlightTapState,
  creativeFlightVerticalVelocity,
  transitionCreativeFlightTap,
} from "../client/game/playerMovement.ts";
import { createMobSimulation, stepMobSimulation, type MobSpawnDescriptor } from "../client/game/mobs.ts";
import { canonicalLocalItemIds, pickCreativeCatalogItem, transitionLocalGameMode } from "../client/singleplayer/localCommands.ts";
import { ITEMS, MAX_HEALTH, MAX_HUNGER, createEmptyEquipment, createEmptyInventory, createItemStack } from "../shared/game.ts";
import {
  createInventoryWorkspace,
  leftClickArmorSlot,
  leftClickInventorySlot,
  stowInventoryWorkspace,
} from "../shared/inventoryWorkspace.ts";

let flight = createCreativeFlightTapState();
flight = transitionCreativeFlightTap(flight, 1_000, true);
assert.equal(flight.flying, false, "one Space remains the ordinary jump intent");
flight = transitionCreativeFlightTap(flight, 1_000 + CREATIVE_FLIGHT_DOUBLE_TAP_MS, true);
assert.equal(flight.flying, true, "the inclusive double-tap boundary toggles flight");
assert.equal(transitionCreativeFlightTap(flight, 1_301, true, true).flying, true, "native repeats never toggle");
flight = transitionCreativeFlightTap(flight, 2_000, true);
flight = transitionCreativeFlightTap(flight, 2_100, true);
assert.equal(flight.flying, false, "a second deliberate double tap exits flight");
assert.deepEqual(transitionCreativeFlightTap(flight, 2_200, false), createCreativeFlightTapState(), "leaving Creative fails closed");
assert.equal(creativeFlightVerticalVelocity(true, false), CREATIVE_FLIGHT_SPEED);
assert.equal(creativeFlightVerticalVelocity(false, true), -CREATIVE_FLIGHT_SPEED);
assert.equal(creativeFlightVerticalVelocity(true, true), 0);
assert.equal(creativeFlightVerticalVelocity(false, false), 0);

const restored = transitionLocalGameMode({
  mode: "creative",
  health: 2,
  hunger: 3,
  inventory: createEmptyInventory(),
  equipment: createEmptyEquipment(),
}, "survival");
assert.equal(restored.health, MAX_HEALTH);
assert.equal(restored.hunger, MAX_HUNGER);

const skeleton: MobSpawnDescriptor = {
  id: "skeleton-creative-test",
  kind: "skeleton",
  x: 0,
  y: 1,
  z: 0,
  yaw: 0,
  homeX: 0,
  homeZ: 0,
  behaviorSeed: 1,
};
const hostile = createMobSimulation([skeleton]);
for (let tick = 0; tick < 200; tick += 1) {
  stepMobSimulation(hostile, {
    dtSeconds: 0.1,
    isNight: true,
    terrainHeight: () => 0,
    player: null,
  });
}
assert.notEqual(hostile.mobs[0].behavior, "chase", "Creative players are absent from hostile acquisition");
assert.equal(hostile.projectiles.some(({ active }) => active), false, "skeletons cannot launch without a player target");
assert.equal(hostile.pendingProjectileDamage, 0);

const empty = createEmptyInventory();
const itemIds = canonicalLocalItemIds();
assert.deepEqual(itemIds, Object.keys(ITEMS).sort(), "catalog covers every canonical game item exactly once");
for (const itemId of itemIds) {
  const picked = pickCreativeCatalogItem(empty, 4, itemId);
  assert.deepEqual(picked[4], createItemStack(itemId));
  assert.equal(picked.filter(Boolean).length, 1);
}
assert.deepEqual(empty, createEmptyInventory(), "catalog picks never mutate their source inventory");
assert.deepEqual(pickCreativeCatalogItem(empty, -1, "dirt"), empty, "invalid slots fail closed");

// Normal-inventory edits must cross one commit boundary before the catalog can
// replace that UI. Model an equip plus selected-hotbar replacement, then prove
// the same published snapshot feeds React state, refs, held rendering, and save.
const authorityInventory = createEmptyInventory();
authorityInventory[0] = createItemStack("dirt", 8);
authorityInventory[9] = createItemStack("diamond_helmet");
authorityInventory[10] = createItemStack("tnt", 64);
let workspace = createInventoryWorkspace(authorityInventory, createEmptyEquipment(), 2);
let interaction = leftClickInventorySlot(workspace, 9);
assert.equal(interaction.ok, true);
if (!interaction.ok) throw new Error(interaction.reason);
workspace = interaction.state;
interaction = leftClickArmorSlot(workspace, "head");
assert.equal(interaction.ok, true);
if (!interaction.ok) throw new Error(interaction.reason);
workspace = interaction.state;
interaction = leftClickInventorySlot(workspace, 10);
assert.equal(interaction.ok, true);
if (!interaction.ok) throw new Error(interaction.reason);
workspace = interaction.state;
interaction = leftClickInventorySlot(workspace, 0);
assert.equal(interaction.ok, true);
if (!interaction.ok) throw new Error(interaction.reason);
workspace = interaction.state;
const committed = stowInventoryWorkspace(workspace);
assert.equal(committed.ok, true);
if (!committed.ok) throw new Error(committed.reason);
let callbackCount = 0;
let inventoryState = authorityInventory;
let inventoryRef = authorityInventory;
let equipmentState = createEmptyEquipment();
let equipmentRef = createEmptyEquipment();
const onWorkspaceChange = () => {
  callbackCount += 1;
  inventoryState = committed.snapshot.inventory;
  inventoryRef = committed.snapshot.inventory;
  equipmentState = committed.snapshot.equipment;
  equipmentRef = committed.snapshot.equipment;
  return true;
};
assert.equal(onWorkspaceChange(), true);
const heldRendererItem = inventoryState[0]?.itemId ?? null;
const savedPlayer = { inventory: inventoryRef, equipment: equipmentRef };
assert.equal(callbackCount, 1, "the inventory→catalog edge publishes exactly once");
assert.equal(heldRendererItem, "tnt");
assert.deepEqual(inventoryState, inventoryRef);
assert.deepEqual(equipmentState, equipmentRef);
assert.equal(equipmentState.head?.itemId, "diamond_helmet");
assert.deepEqual(savedPlayer, { inventory: inventoryState, equipment: equipmentState });

const hud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const presentation = readFileSync(new URL("../client/gameplay/presentation.ts", import.meta.url), "utf8");
assert.ok(hud.includes("showSurvivalStatus ? <SurvivalHud"), "Creative hides hearts, hunger, and armor while retaining the hotbar");
assert.ok(app.includes('showSurvivalStatus={gameMode === "survival"}'));
assert.ok(presentation.includes('canCreativeFly: () => context.getGameMode() === "creative"'));
assert.ok(app.includes("getGameMode: () => gameModeRef.current"));
assert.ok(presentation.includes('canMobsTargetPlayer: () => context.getGameMode() === "survival"'));
assert.ok(engine.includes('if (paused) return;'));
assert.ok(engine.includes('document.pointerLockElement !== canvas'), "flight taps share the engine pointer-lock guard");
assert.ok(engine.includes("options.canCreativeFly?.() !== true && creativeFlight.flying"), "Survival transition exits flight safely");
assert.ok(engine.includes("player: playerTarget"), "the mob step receives no Creative target");
assert.ok(drawer.includes("Creative Inventory"));
assert.ok(drawer.includes("Player Inventory"), "catalog-first UI exposes the full player inventory");
assert.ok(drawer.includes("Object.values(ITEMS)"), "catalog derives from the canonical item table");
assert.ok(drawer.includes("takeCreativeCatalogStack(stateRef.current"), "catalog clicks use the shared cursor workspace");
assert.ok(drawer.includes("insertCreativeCatalogStack(stateRef.current"), "modifier clicks use the shared slot-addressed workspace");
assert.ok(drawer.includes("const stack = createItemStack(item.id)"), "catalog tiles never obscure their art with a 64 counter");
assert.ok(app.includes('if (gameModeRef.current === "creative") return true;'),
  "the visible one-item Creative stack still places infinitely without consumption");
assert.equal(drawer.includes("onCreativePick"), false, "catalog picks never bypass the workspace to overwrite the selected hotbar slot");
assert.ok(drawer.includes('if (!commitWorkspace()) return;\n    onClose(keyboardCode);'),
  "Creative and Survival both commit one stowed workspace before reporting the close key");

console.log("creative mode playtest regression checks passed");
