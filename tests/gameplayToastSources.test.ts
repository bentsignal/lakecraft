import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const gameHud = readFileSync(new URL("../client/components/GameHud.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("../client/chat/ChatOverlay.tsx", import.meta.url), "utf8");

const routineGameplayToastText = [
  "TNT primed",
  "Boom!",
  "Creeper exploded",
  "TNT explosion",
  "Creeper explosion",
  "Monster hit",
  "Zombie hit",
  "Arrow hit",
  "Arrow defeated the target",
  "Mob drops collected",
  "Sheep sheared",
  "Oak tree grown",
  "Oak grew",
  "Good morning",
  "Dawn breaks over Fern Hollow",
  "Chest transfer committed",
  "Spawn point set\", \"Lakebed confirmed",
  "Restored ${result.restored} hunger",
  "Crafted ${craftedCount}",
] as const;

for (const text of routineGameplayToastText) {
  assert.equal(singleplayer.includes(text), false, `single-player excludes routine gameplay toast source: ${text}`);
  assert.equal(multiplayer.includes(text), false, `multiplayer excludes routine gameplay toast source: ${text}`);
}

for (const text of [
  "World save full",
  "Container contents protected",
  "Respawn point lost",
  "Too many items nearby",
  "Inventory full",
  "The sapling cannot grow",
] as const) assert.ok(singleplayer.includes(text), `single-player preserves actionable error/recovery feedback: ${text}`);

for (const text of [
  "Pack action delayed",
  "Drop lost contact",
  "Server connection rejected",
  "Placement restored",
] as const) assert.ok(multiplayer.includes(text), `multiplayer preserves actionable error/recovery feedback: ${text}`);

for (const retired of ["TNT did not ignite", "Oak growth lost contact", "Presence lease invalid", "Chest transfer reconciled"]) {
  assert.equal(multiplayer.includes(retired), false, `${retired} belonged to the retired Lakebed world path`);
}

for (const source of [singleplayer, multiplayer, gameHud, chat]) {
  assert.equal(source.includes("ToastSurface"), false, "toast rendering and producers are removed");
  assert.equal(source.includes("HudMessage"), false, "the retired toast message type is removed");
}
assert.ok(singleplayer.includes("setCommandMessages") && multiplayer.includes("setNotificationMessages"),
  "both game modes route local notifications into chat messages");
assert.ok(chat.includes('tone === "player" ? labels.player ?? `<${message.username}>` : ""'),
  "system and warning chat messages render without a sender");

console.log("gameplay notifications use senderless chat messages and the toast system is absent: ok");
