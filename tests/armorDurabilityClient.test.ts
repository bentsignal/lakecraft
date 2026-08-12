import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../client/components/InventoryDrawer.tsx", import.meta.url), "utf8");

assert.doesNotMatch(multiplayer, /claimMobPlayerDamage|attackMob/,
  "disabled local mobs cannot mutate Lakebed armor durability in a Railway world");
assert.match(multiplayer, /getArmor=\{\(\) => \(\{/,
  "multiplayer publishes cosmetic equipment through Railway appearance");
assert.match(singleplayer, /applyConfirmedArmorDamage/);
assert.match(drawer, /maxItemDurability\(itemId\)/);
assert.match(drawer, /className="lc-equipment-panel/);

console.log("armor durability client boundary tests passed");
