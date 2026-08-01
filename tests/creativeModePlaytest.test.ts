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
  assert.deepEqual(picked[4], createItemStack(itemId, ITEMS[itemId].maxStack));
  assert.equal(picked.filter(Boolean).length, 1);
}
assert.deepEqual(empty, createEmptyInventory(), "catalog picks never mutate their source inventory");
assert.deepEqual(pickCreativeCatalogItem(empty, -1, "dirt"), empty, "invalid slots fail closed");

const hud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(hud.includes("showSurvivalStatus ? <SurvivalHud"), "Creative hides hearts, hunger, and armor while retaining the hotbar");
assert.ok(app.includes('showSurvivalStatus={gameMode === "survival"}'));
assert.ok(app.includes('canCreativeFly: () => gameModeRef.current === "creative"'));
assert.ok(app.includes('canMobsTargetPlayer: () => gameModeRef.current === "survival"'));
assert.ok(engine.includes('if (paused) return;'));
assert.ok(engine.includes('document.pointerLockElement !== canvas'), "flight taps share the engine pointer-lock guard");
assert.ok(engine.includes("options.canCreativeFly?.() !== true && creativeFlight.flying"), "Survival transition exits flight safely");
assert.ok(engine.includes("player: playerTarget"), "the mob step receives no Creative target");
assert.ok(drawer.includes("Creative Inventory"));
assert.ok(drawer.includes("Player Inventory"), "catalog-first UI exposes the full player inventory");
assert.ok(drawer.includes("Object.values(ITEMS)"), "catalog derives from the canonical item table");

console.log("creative mode playtest regression checks passed");
