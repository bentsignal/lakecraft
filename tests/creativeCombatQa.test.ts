import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  giveLocalItem,
  parseLocalCommand,
  transitionLocalGameMode,
  type LocalModeState,
} from "../client/singleplayer/localCommands.ts";
import { planDeathDrops, validateDeathDropConservation } from "../shared/deathDrops.ts";
import {
  ITEMS,
  MAX_HEALTH,
  MAX_HUNGER,
  countItem,
  createEmptyEquipment,
  createStarterInventory,
  equipArmorFromInventory,
  maxItemDurability,
} from "../shared/game.ts";

const runbook = readFileSync(new URL("../docs/creative-combat-qa.md", import.meta.url), "utf8");
const setup = runbook.match(
  /<!-- creative-qa-setup:start -->[\s\S]*?```text\n([\s\S]*?)```[\s\S]*?<!-- creative-qa-setup:end -->/,
);
assert.ok(setup, "the runbook exposes one machine-checkable setup preset");
const commands = setup[1].split("\n").map((line) => line.trim()).filter(Boolean);
assert.ok(commands.length <= 8, "the setup stays short enough to enter in under one minute");
assert.equal(commands[0], "/gamemode creative");
assert.ok(runbook.includes("run `/gamemode survival`"), "the guide returns to Survival before damage and wear checks");

let state: LocalModeState = {
  mode: "survival",
  health: 3,
  hunger: 2,
  inventory: createStarterInventory(),
  equipment: createEmptyEquipment(),
};
for (const source of commands) {
  const parsed = parseLocalCommand(source);
  assert.equal(parsed.ok, true, `documented command must parse: ${source}`);
  if (!parsed.ok) throw new Error(parsed.message);
  if (parsed.command.kind === "gamemode") {
    state = transitionLocalGameMode(state, parsed.command.mode);
    continue;
  }
  assert.equal(parsed.command.kind, "give", `setup only permits deterministic mode/give commands: ${source}`);
  if (parsed.command.kind !== "give") throw new Error(source);
  const granted = giveLocalItem(state.inventory, parsed.command.itemId, parsed.command.count);
  assert.equal(granted.ok, true, `starter pack has capacity for ${source}`);
  if (!granted.ok) throw new Error(granted.message);
  state = { ...state, inventory: granted.inventory };
}

assert.equal(state.mode, "creative");
assert.equal(state.health, MAX_HEALTH);
assert.equal(state.hunger, MAX_HUNGER);
for (const [itemId, count] of [
  ["diamond_sword", 1],
  ["diamond_chestplate", 1],
  ["cobblestone", 64],
  ["tnt", 8],
  ["flint_and_steel", 1],
  ["bow", 1],
  ["arrow", 16],
] as const) {
  assert.equal(countItem(state.inventory, itemId) >= count, true, `${itemId} is ready for the documented route`);
}
for (const itemId of ["diamond_sword", "diamond_chestplate", "flint_and_steel", "bow"] as const) {
  const stack = state.inventory.find((candidate) => candidate?.itemId === itemId);
  assert.equal(stack?.durability, maxItemDurability(itemId), `${ITEMS[itemId].label} starts at full durability`);
}

const chestplateIndex = state.inventory.findIndex((stack) => stack?.itemId === "diamond_chestplate");
const equipped = equipArmorFromInventory(state.inventory, state.equipment, chestplateIndex);
assert.equal(equipped.ok, true, "the documented shift-click target is valid armor");
if (!equipped.ok) throw new Error(equipped.reason);
state = transitionLocalGameMode({
  ...state,
  inventory: equipped.inventory,
  equipment: equipped.equipment,
}, "survival");
assert.equal(state.mode, "survival");
assert.equal(state.equipment.chest?.itemId, "diamond_chestplate");
assert.equal(countItem(state.inventory, "diamond_chestplate"), 0);

const death = planDeathDrops({
  identity: { userId: "singleplayer", eventId: "creative-qa-smoke" },
  inventory: state.inventory,
  equipment: state.equipment,
  deathPose: { x: 4.5, y: 8, z: -3.5 },
});
assert.equal(death.ok, true, "the prepared QA loadout can enter the conserved respawn settlement");
if (!death.ok) throw new Error(death.reason);
assert.deepEqual(
  validateDeathDropConservation(state.inventory, state.equipment, death.drops.map(({ stack }) => stack)),
  { ok: true, fingerprint: death.conservationFingerprint },
);
assert.equal(death.carriedState.inventory.every((stack) => stack === null), true);
assert.deepEqual(death.carriedState.equipment, createEmptyEquipment());

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
assert.equal(app.includes("lakebed/client"), false, "the documented single-player route adds zero Lakebed traffic");
assert.ok(app.includes('canTakePlayerDamage: () => gameModeRef.current === "survival"'),
  "the guide's Survival boundary gates player damage");
assert.ok(app.includes('if (gameModeRef.current === "creative") return;'),
  "Creative setup cannot accidentally spend melee durability");

console.log("Creative combat QA runbook setup and conserved death orchestration tests passed");
