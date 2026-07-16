import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameHud = source("../client/components/GameHud.tsx");
const hotbar = source("../client/components/Hotbar.tsx");
const styles = source("../client/components/HudStyles.tsx");
const pauseMenu = source("../client/components/PauseMenu.tsx");
const playerList = source("../client/components/PlayerList.tsx");

assert.equal(gameHud.match(/<Crosshair\s*\/>/g)?.length, 1, "there is exactly one CSS crosshair");
assert.equal(gameHud.includes("<StatusStrip"), false, "the permanent status strip is not rendered");
assert.ok(gameHud.includes("<SurvivalHud"), "health, hunger, and armor are grouped with the hotbar");
assert.ok(hotbar.includes("length: HOTBAR_SIZE"), "hotbar is backed by the canonical nine-slot size");
assert.equal(hotbar.includes("lc-hotbar-label"), false, "normal play has no hotbar labels");
assert.equal(hotbar.includes("lc-slot__key"), false, "normal play has no slot-number chrome");
assert.ok(hotbar.includes("className=\"lc-selected-item-name\""), "one selected-item caption shares the canonical hotbar");
assert.ok(hotbar.includes("{selectedItem.label}</span>"), "the caption uses the canonical item catalog label");
assert.ok(hotbar.includes('key={`${selectedIndex}:${selectedStack!.itemId}`}'), "slot and item identity restart the caption");
assert.equal(hotbar.includes("selectedStack!.count"), false, "stack consumption cannot restart the caption");
assert.ok(hotbar.includes('aria-live="polite"') && hotbar.includes('aria-atomic="true"'), "one stable live region announces selection changes");
for (const forbidden of ["setTimeout", "setInterval", "useEffect", "useState"]) {
  assert.equal(hotbar.includes(forbidden), false, `hotbar caption adds no ${forbidden}`);
}
assert.ok(styles.includes("repeat(9, 40px)"), "desktop hotbar uses reference-scale 40px slots");
assert.ok(styles.includes("var(--lc-pixel-font)"), "HUD uses the shared pixel-font variable");
const captionCss = styles.slice(styles.indexOf(".lc-selected-item-name"), styles.indexOf(".lc-hotbar {"));
assert.ok(captionCss.includes("text-shadow: 2px 2px #202020") && captionCss.includes("text-overflow: ellipsis"),
  "caption uses bounded Minecraft-style pixel text without a card");
assert.equal(captionCss.includes("background:"), false, "caption has no non-Minecraft panel background");
assert.equal((styles.match(/@keyframes lc-selected-item-name/g) ?? []).length, 1, "one bounded opacity animation owns the lifetime");
assert.equal(styles.includes("lc-item-glyph--empty::before"), false, "empty slots have no dashed placeholder chrome");
assert.equal(styles.includes(".lc-slot__key"), false, "stale slot-number CSS is removed");
assert.match(gameHud, /!deathScreenOpen && !inventoryOpen && !modalOpen && !pauseOpen[\s\S]*?<Hotbar/,
  "the caption disappears with the shared survival HUD boundary");
assert.ok(pauseMenu.includes("Back to Game") && pauseMenu.includes("Disconnect"), "pause menu exposes the core multiplayer actions");
assert.ok(playerList.includes("if (!visible) return null"), "Tab player list disappears immediately on keyup");

console.log("minecraft HUD component tests passed");
