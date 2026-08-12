import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAvatarAppearance } from "../shared/avatarAppearance.ts";

assert.deepEqual(normalizeAvatarAppearance("iron_sword", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"), {
  heldItem: "iron_sword", armorHead: "iron_helmet", armorChest: "iron_chestplate", armorLegs: "iron_leggings", armorFeet: "iron_boots",
});
assert.deepEqual(normalizeAvatarAppearance("bad", "bad", "bad", "bad", "bad"), {
  heldItem: "", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "",
});

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const transport = readFileSync(new URL("../client/RealtimeMultiplayerTransport.tsx", import.meta.url), "utf8");
const realtime = readFileSync(new URL("../client/realtimeMultiplayer.ts", import.meta.url), "utf8");
assert.match(multiplayer, /getHeldItem=\{\(\) => inventoryRef\.current\[selectedRef\.current\]\?\.itemId \?\? null\}/);
assert.match(multiplayer, /getSkin=\{selectedSkin\}/);
assert.match(multiplayer, /getArmor=\{\(\) => \(\{/);
assert.match(multiplayer, /registerActionSink=\{\(sink\) => \{ motionActionSinkRef\.current = sink;/);
assert.match(transport, /client\.submitAction\(kind, value\)/);
assert.match(realtime, /appearance_set|appearance_request|appearance_blob/);
assert.doesNotMatch(multiplayer, /heartbeatPlayer|MultiplayerSegmentTransport/);

console.log("Railway avatar appearance integration tests passed");
