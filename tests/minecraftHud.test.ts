import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameHud = source("../client/components/GameHud.tsx");
const hotbar = source("../client/components/Hotbar.tsx");
const styles = source("../client/components/HudStyles.tsx");
const pauseMenu = source("../client/components/PauseMenu.tsx");
const playerList = source("../client/components/PlayerList.tsx");

assert.equal(gameHud.match(/<Crosshair\s*\/>/g)?.length, 1, "there is exactly one CSS crosshair");
assert.ok(gameHud.includes("!deathScreenOpen && !pauseOpen && !inventoryOpen && !modalOpen ? <Crosshair /> : null"),
  "the one reticle remains hidden behind death, pause, inventory, and modal surfaces");
const crosshairCss = styles.slice(styles.indexOf(".lc-crosshair {"), styles.indexOf(".lc-survival-wrap {"));
assert.match(crosshairCss, /\.lc-crosshair \{[^}]*height: 16px;[^}]*left: 50%;[^}]*pointer-events: none;[^}]*top: 50%;[^}]*transform: translate\(-50%,-50%\);[^}]*width: 16px;/,
  "reticle remains one non-interactive 16px square at the exact viewport center");
assert.equal(crosshairCss.match(/clip-path: polygon/g)?.length, 2, "black outline and white core use two authored crisp pixel silhouettes");
assert.ok(crosshairCss.includes("background: #111") && crosshairCss.includes("background: #fff"),
  "reticle preserves contrast over both bright and dark terrain");
assert.ok(crosshairCss.includes("6px 0,10px 0") && crosshairCss.includes("7px 1px,9px 1px"),
  "outer and inner pluses stay aligned to integer pixel coordinates");
assert.equal(/filter:|drop-shadow|url\(|animation:/.test(crosshairCss), false,
  "reticle uses no blurred filter, asset, or animated behavior");
assert.equal(gameHud.includes("<StatusStrip"), false, "the permanent status strip is not rendered");
assert.ok(gameHud.includes("<SurvivalHud"), "health, hunger, and armor are grouped with the hotbar");
assert.ok(hotbar.includes("length: HOTBAR_SIZE"), "hotbar is backed by the canonical nine-slot size");
assert.equal(hotbar.includes("lc-hotbar-label"), false, "normal play has no hotbar labels");
assert.equal(hotbar.includes("lc-slot__key"), false, "normal play has no slot-number chrome");
assert.ok(hotbar.includes('className={`lc-selected-item-name${armorVisible ? " has-armor" : ""}`}'),
  "one armor-aware selected-item caption shares the canonical hotbar");
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
for (const token of ["MINECRAFT_HOTBAR_PNG_BASE64", "background-size: 100% 100%", "height: 44px", "padding: 2px", "width: 100%"] ) {
  assert.ok(hotbarCss.includes(token), `hotbar exact frame CSS keeps ${token}`);
}
assert.equal(hotbarCss.includes("background: #8b8b8b"), false, "hotbar has no approximate opaque gray slab");
assert.match(hotbarCss, /\.lc-hotbar__slot \{[^}]*box-sizing: border-box;[^}]*height: 40px;/,
  "40px border-box slots plus the hotbar border produce the exact 44px desktop height");
const selectedFrameCss = hotbarCss.slice(hotbarCss.indexOf(".lc-hotbar__slot.is-selected::after"));
for (const token of ["MINECRAFT_HOTBAR_SELECTION_PNG_BASE64", "height: 46px", "width: 48px", "pointer-events: none", "position: absolute", "transform: translate(-50%,-50%)"]) {
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
const countCss = styles.slice(styles.indexOf(".lc-item-glyph__count"), styles.indexOf(".lc-durability"));
assert.ok(countCss.includes("font: 400 16px/16px") && countCss.includes("font-synthesis: none"),
  "shared hotbar and inventory counts use the regular installed glyph face at the canonical scale");
assert.equal(countCss.includes("-webkit-text-stroke"), false, "counts avoid the thick synthetic outline that obscured glyph pixels");
assert.ok(countCss.includes("text-shadow: 2px 2px #3f3f3f") && countCss.includes("bottom: 2px") && countCss.includes("right: 2px"),
  "stack counts use one hard Minecraft shadow at the lower-right slot anchor");
assert.match(styles, /\.lc-inventory-window \{[^}]*max-width: calc\(100vw - 28px\);[^}]*width: 648px;/,
  "the survival inventory keeps canonical desktop proportions while fitting narrow viewports");
assert.match(styles, /\.lc-player-preview \{[^}]*background:#111;[^}]*image-rendering:pixelated;/,
  "the real shared player skin renders against the reference inventory preview field");
assert.match(gameHud, /!deathScreenOpen && !inventoryOpen && !modalOpen && !pauseOpen[\s\S]*?<Hotbar/,
  "the caption disappears with the shared survival HUD boundary");
assert.ok(pauseMenu.includes("Back to Game") && pauseMenu.includes("Disconnect"), "pause menu exposes the core multiplayer actions");
assert.ok(playerList.includes("if (!visible) return null"), "Tab player list disappears immediately on keyup");

console.log("minecraft HUD component tests passed");
