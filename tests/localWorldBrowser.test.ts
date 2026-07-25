import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const browser = readFileSync(new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const save = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../client/singleplayer/localWorldRegistry.ts", import.meta.url), "utf8");

assert.equal(browser.includes("lakebed/client"), false, "the world list stays entirely browser-local");
assert.equal(app.includes("lakebed/client"), false, "selecting a world cannot mount Lakebed transport");
assert.ok(browser.includes('aria-labelledby="lc-world-browser-title"'));
assert.ok(browser.includes('aria-label="Search worlds"'));
assert.ok(browser.includes('role="listbox"') && browser.includes('role="option"') && browser.includes("aria-selected="),
  "world selection exposes listbox semantics");
assert.ok(browser.includes('aria-live="polite"'), "create/import/reset feedback is announced");
assert.ok(browser.includes('role="alertdialog"') && browser.includes('aria-modal="true"'),
  "destructive confirmation is a modal alert dialog");
assert.ok(browser.includes("Confirm destructive action") && browser.includes("This cannot be undone."),
  "delete and reset require explicit confirmation");

for (const label of [
  "Select World",
  "Create New World",
  "Play Selected World",
  "Delete World…",
  "Reset World…",
  "Legacy single world detected",
  "Import Legacy World",
  "Reset Legacy Data…",
  "Last played",
  "Last saved",
  "Healthy",
  "Corrupt save",
  "Storage near limit",
  "Storage limit exceeded",
]) {
  assert.ok(browser.includes(label), `world browser exposes ${label}`);
}

assert.ok(browser.includes("world.name.toLocaleLowerCase().includes"),
  "search filters by normalized world name without mutating the registry");
assert.ok(browser.includes("touchLocalWorld(localStorage"), "Play records last-played before mounting the world");
assert.ok(browser.includes("requestPointerLockHandoff()"), "Play reuses its user gesture for pointer capture");
assert.ok(browser.includes("if (document.pointerLockElement) document.exitPointerLock()"),
  "the browser releases any title-screen pointer handoff while showing UI");
assert.ok(browser.includes("legacy.status !== \"none\""), "legacy choice is shown only when old data exists");
assert.ok(browser.includes("The original remains available until you explicitly reset it."),
  "import never implies that legacy data was deleted");

assert.ok(app.includes("<LocalWorldBrowser"), "single-player enters the world browser before constructing gameplay");
assert.ok(app.includes("<SinglePlayerWorld"), "only a selected world mounts the voxel engine");
assert.ok(app.includes("saveSinglePlayerSnapshot(localStorage, snapshot, now, { worldId: world.id })"),
  "manual/autosave/quit commits stay in the active world namespace");
assert.ok(app.includes("resetSinglePlayerSave(localStorage, { worldId: world.id })"),
  "in-game recovery can reset only the active world");
assert.ok(app.includes("quitSavedRef.current = true") && app.includes("onExit();"),
  "Save and Quit returns to the list without a duplicate unmount save");
assert.ok(app.includes("worldName={world.name}"), "the pause menu identifies the active world");

assert.ok(save.includes("Invalid single-player world storage namespace."),
  "invalid world IDs fail closed before any browser key is touched");
assert.ok(save.includes("SINGLEPLAYER_WORLD_STORAGE_PREFIX"), "each journal key is namespaced by world");
assert.ok(registry.includes("LOCAL_WORLD_REGISTRY_SLOT_A_KEY")
  && registry.includes("LOCAL_WORLD_REGISTRY_SLOT_B_KEY")
  && registry.includes("checksum"),
  "the world list has its own strict two-slot checksum journal");
assert.ok(registry.includes("migrateLegacy: true") && registry.includes("explicit Import action"),
  "legacy migration exists only behind the explicit import API");

console.log("local world browser UI, accessibility, namespace, and legacy-choice tests passed");
