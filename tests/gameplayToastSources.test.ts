import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const multiplayer = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const singleplayer = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const toastSurface = readFileSync(new URL("../client/components/ToastSurface.tsx", import.meta.url), "utf8");

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
  "Respawn reconciliation failed",
  "Pack action delayed",
  "Drop lost contact",
  "TNT did not ignite",
  "Oak growth lost contact",
  "Armor reconciliation failed",
  "Presence lease invalid",
  "Chest transfer reconciled",
] as const) assert.ok(multiplayer.includes(text), `multiplayer preserves actionable error/recovery feedback: ${text}`);

assert.ok(singleplayer.includes("const [messages, setMessages] = useState<HudMessage[]>([])")
  && multiplayer.includes("const [messages, setMessages] = useState<HudMessage[]>([])")
  && toastSurface.includes("export function ToastSurface"),
"achievement-ready toast infrastructure remains intact even though routine gameplay producers are removed");
assert.ok(singleplayer.includes("messages={messages}") && multiplayer.includes("messages={messages}"),
  "both game modes retain the shared HUD toast surface for future achievements and real recovery feedback");

console.log("routine gameplay toast producers removed; recovery and future achievement surface preserved: ok");
