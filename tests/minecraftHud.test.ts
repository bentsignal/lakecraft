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
assert.ok(styles.includes("repeat(9, 40px)"), "desktop hotbar uses reference-scale 40px slots");
assert.ok(styles.includes("var(--lc-pixel-font)"), "HUD uses the shared pixel-font variable");
assert.ok(pauseMenu.includes("Back to Game") && pauseMenu.includes("Disconnect"), "pause menu exposes the core multiplayer actions");
assert.ok(playerList.includes("if (!visible) return null"), "Tab player list disappears immediately on keyup");

console.log("minecraft HUD component tests passed");
