import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const options = source("../client/components/OptionsDialog.tsx");
const hud = source("../client/components/GameHud.tsx");
const hotbar = source("../client/components/Hotbar.tsx");
const hudStyles = source("../client/components/HudStyles.tsx");
const chat = source("../client/chat/ChatOverlay.tsx");
const chatStyles = source("../client/chat/ChatStyles.tsx");
const app = source("../client/index.tsx");
const world = source("../apps/game-server/src/world.ts");

assert.ok(options.includes('hudSize === "small" ? "medium" : hudSize === "medium" ? "large" : "small"'),
  "HUD size cycles monotonically from small to medium to large and back to small");
assert.ok(hud.includes('import { useLayoutEffect } from "preact/hooks"')
  && hud.includes("useLayoutEffect(() => {")
  && !hud.includes("useEffect(() => {"),
  "HUD scale variables update in the settings render cycle instead of waiting for a throttled post-paint effect");
for (const contract of [
  'root.setProperty("--lc-hotbar-scale", small ? ".83" : medium ? "1" : "1.18")',
  'root.setProperty("--lc-inventory-scale", small ? ".67" : medium ? ".83" : ".94")',
]) assert.ok(hud.includes(contract), `HUD retains reviewed independent scale mapping: ${contract}`);
assert.ok(hudStyles.includes("scale(var(--lc-hotbar-scale))")
  && hudStyles.includes("zoom:var(--lc-inventory-scale)"),
"hotbar and inventories consume their independent reviewed scales");
assert.ok(hud.includes("armorVisible={armor > 0}") && hotbar.includes('armorVisible ? " has-armor" : ""')
  && hudStyles.includes(".lc-selected-item-name.has-armor { bottom: calc(100% + 20px); }"),
"selected item labels clear the additional armor row only when it exists");
assert.ok(chatStyles.includes("width:calc(100vw - 8px)") && !chatStyles.includes("zoom:"),
  "chat remains full viewport width at every HUD size instead of zoom-shrinking its container");
assert.ok(chatStyles.includes("font-size:var(--lc-chat-font-size)")
  && chatStyles.includes("font:var(--lc-chat-input-font-size)"),
"chat typography still follows the selected HUD size independently of its width");
assert.ok(!chat.includes('type="submit">') && !chatStyles.includes("focus-within")
  && !chatStyles.includes("lc-chat-compose input:focus-visible"),
"Enter is the only chat submit affordance and the input has no focus highlight ring");
assert.ok(world.includes('message: `${state.player.name} has left the server.`')
  && app.includes('tone: message.userId === "server" ? "system" : undefined'),
"server departures appear immediately as system chat notices");

console.log("HUD scale, item label, and chat refinement checks passed");
