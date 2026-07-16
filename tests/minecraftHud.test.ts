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
const hotbarCss = styles.slice(styles.indexOf(".lc-hotbar {"), styles.indexOf(".lc-item-glyph {"));
assert.match(styles, /\.lc-survival-wrap \{[^}]*width: 364px;/, "desktop survival HUD owns the exact 364px reference width");
assert.match(hotbarCss, /\.lc-hotbar \{[^}]*background: rgba\([^)]*,\.62\);[^}]*box-sizing: border-box;[^}]*overflow: visible;[^}]*padding: 0;[^}]*width: 100%;/,
  "translucent zero-padding chrome makes nine 40px tracks plus two 2px borders exactly 364px wide");
assert.equal(hotbarCss.includes("background: #8b8b8b"), false, "hotbar no longer uses an opaque gray slab");
assert.match(hotbarCss, /\.lc-hotbar__slot \{[^}]*box-sizing: border-box;[^}]*height: 40px;/,
  "40px border-box slots plus the hotbar border produce the exact 44px desktop height");
const selectedFrameCss = hotbarCss.slice(hotbarCss.indexOf(".lc-hotbar__slot.is-selected::after"));
for (const token of ["height: 48px", "width: 48px", "pointer-events: none", "position: absolute", "transform: translate(-50%,-50%)"]) {
  assert.ok(selectedFrameCss.includes(token), `selected frame preserves its protruding geometry: ${token}`);
}
assert.ok(hotbarCss.includes(".lc-hotbar__slot.is-selected::after"), "selection uses a frame pseudo-element without changing slot markup");
assert.match(styles, /@media \(max-width: 820px\) \{ \.lc-survival-wrap \{ max-width: calc\(100vw - 12px\); \}/,
  "narrow HUD keeps a six-pixel viewport gutter for the protruding selector");
assert.match(styles, /@media \(max-width: 820px\)[^}]*[\s\S]*?\.lc-hotbar \{ grid-template-columns: repeat\(9, minmax\(0, 1fr\)\); \}/,
  "narrow hotbars retain nine flexible tracks while the visible selector may protrude safely");
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
