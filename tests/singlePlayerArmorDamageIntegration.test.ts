import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ITEMS,
  applyConfirmedArmorDamage,
  createEmptyEquipment,
  equippedArmorProtection,
  type Equipment,
} from "../shared/game.ts";
import { mitigatedPlayerDamage } from "../shared/playerCombat.ts";
import {
  createDefaultSinglePlayerSnapshot,
  serializeSinglePlayerSave,
} from "../client/singleplayer/localSave.ts";

const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../client/game/types.ts", import.meta.url), "utf8");

const fullArmor: Equipment = {
  head: { itemId: "diamond_helmet", durability: 2 },
  chest: { itemId: "diamond_chestplate", durability: 2 },
  legs: { itemId: "diamond_leggings", durability: 2 },
  feet: { itemId: "diamond_boots", durability: 2 },
};
assert.equal(equippedArmorProtection(fullArmor), 20);
assert.equal(mitigatedPlayerDamage(7, equippedArmorProtection(fullArmor)), 2, "local combat matches Lakebed's 80% full-armor mitigation");

const worn = applyConfirmedArmorDamage(fullArmor);
assert.deepEqual(worn.damaged.sort(), ["chest", "feet", "head", "legs"]);
assert.equal(worn.broken.length, 0);
for (const stack of Object.values(worn.equipment)) assert.equal(stack?.durability, 1, "one hit wears each equipped piece once");
const broken = applyConfirmedArmorDamage(worn.equipment);
assert.equal(broken.broken.length, 4);
assert.deepEqual(broken.equipment, createEmptyEquipment(), "the next hit removes every exhausted piece");
assert.equal(mitigatedPlayerDamage(7, equippedArmorProtection(broken.equipment)), 7, "the hit after break recomputes without stale protection");

const snapshot = createDefaultSinglePlayerSnapshot(7_319, 1_000, "armor-contract");
snapshot.player.equipment = worn.equipment;
const saved = serializeSinglePlayerSave(snapshot, 1, 2_000);
assert.equal(saved.ok, true);
if (!saved.ok) throw new Error(saved.reason);
assert.deepEqual(saved.envelope.payload.player.equipment, worn.equipment, "the local journal preserves exact worn durability");

assert.ok(types.includes('export type PlayerDamageCause = "mob" | "creeper" | "tnt" | "fall"'));
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "mob")'));
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "creeper")'));
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "tnt")'));
assert.ok(engine.includes('options.onPlayerDamage?.(appliedDamage, "fall")'));
assert.equal(engine.includes("incomingDamage - Math.floor(protection / 2)"), false, "the divergent local mitigation formula is removed");
assert.ok(app.includes('if (amount > 0 && cause !== "fall")'), "only positive combat damage wears local armor");
assert.ok(app.includes("applyConfirmedArmorDamage(equipmentRef.current)"));
assert.ok(app.includes("equipmentRef.current = armorDamage.equipment"));
assert.ok(app.includes("setEquipment(armorDamage.equipment)"));
assert.ok(app.includes("markWorldDirty();"), "armor wear joins the existing crash-safe save cadence");
assert.ok(app.includes("armorDamage.broken"), "breakage emits one event-edge notification");
assert.ok(ITEMS.diamond_helmet.label.length > 0, "break notifications use the canonical item label");
assert.equal(app.includes("lakebed/client"), false, "single-player armor remains entirely browser-local");

console.log("single-player armor mitigation, wear, break, and persistence tests passed");
