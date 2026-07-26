import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const browser = readFileSync(new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const save = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../client/singleplayer/localWorldRegistry.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = browser.indexOf(`  function ${name}`);
  const nextFunction = browser.indexOf("\n  function ", start + 1);
  const componentReturn = browser.indexOf("\n  return (", start + 1);
  const end = [nextFunction, componentReturn].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  return browser.slice(start, end);
}

assert.equal(browser.includes("lakebed/client"), false, "the world list stays entirely browser-local");
assert.equal(app.includes("lakebed/client"), false, "selecting a world cannot mount Lakebed transport");
assert.ok(browser.includes('aria-label="Local world browser"'));
assert.ok(browser.includes('aria-label="Search worlds"'));
assert.ok(browser.includes('<select\n          aria-label="Local worlds"')
  && browser.includes("size={Math.max(3, Math.min(8, filtered.length || 3))}")
  && browser.includes('value={entry.world.id}'),
  "world selection uses a visible native multi-row select with native keyboard semantics");
assert.equal(browser.includes("moveLocalWorldSelection"), false,
  "native select owns Arrow, Home, End, focus, and selected-option behavior");
assert.ok(browser.includes('" · Last saved "')
  && browser.includes("HEALTH_LABELS[entry.health]")
  && browser.includes("CAPACITY_LABELS[entry.capacity]"),
  "each native option exposes mode, last-save, health, and capacity context");
assert.ok(browser.includes('role={notice[1] ? "alert" : "status"}'), "create/import/reset feedback is announced");
assert.ok(browser.includes('role={modal === CREATE ? undefined : "alertdialog"}') && browser.includes("dialog.showModal()"),
  "destructive confirmation uses the browser's focus-trapping modal dialog");
assert.ok(browser.includes('onClose={() => setModal(0)}')
  && browser.includes('method="dialog"')
  && browser.includes("autoFocus")
  && browser.includes("restoreFocusRef")
  && browser.includes("restore?.isConnected")
  && browser.includes('document.getElementById("lc-world-browser-title")'),
  "native modal behavior handles inertness, Escape, Tab order, a safe initial action, and explicit fallback restoration");
assert.equal(browser.includes("trapDialogFocus"), false,
  "the browser dialog owns focus trapping instead of a partial custom Tab implementation");
assert.ok(browser.includes("Confirm destructive action") && browser.includes("This cannot be undone."),
  "delete and reset require explicit confirmation");
assert.ok(
  browser.includes("World deletion cleanup is pending. Healthy worlds remain available; no unverified deletion was applied.")
  && browser.includes("Ignored an invalid world-deletion marker. Healthy worlds remain available; orphaned storage may remain.")
  && browser.includes("Recovered an interrupted world deletion. Other worlds remain unchanged.")
  && browser.includes('["Delete World…", !selected || deleteRecoveryPending || transactionReadOnly'),
  "delete recovery remains visible without blocking access to healthy worlds",
);
assert.ok(
  browser.includes("const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)")
  && browser.includes("World storage is read-only because pending transaction state could not be verified.")
  && browser.includes("Play and world changes are disabled until browser storage recovers.")
  && browser.includes("World storage is read-only until pending transaction state can be verified.")
  && browser.includes("Retry World Storage"),
  "opaque transaction state is presented as retryable read-only storage without a healthy-world availability claim",
);
assert.ok(
  browser.includes("const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected))")
  && browser.includes('["Play Selected World", !selectedPlayable, play]')
  && browser.includes("if (!selected || !selectedPlayable)"),
  "native Play disabled behavior and its handler fail closed while transaction visibility is opaque",
);
assert.ok(
  browser.includes('["Reset World…", !selected || transactionReadOnly')
  && browser.includes('disabled={legacy.status !== "available" || blocked || transactionReadOnly || imported}'),
  "native reset and legacy import controls enforce registry read-only state",
);
assert.ok(
  browser.includes("disabled={transactionReadOnly}")
  && browser.includes("onClick={() => openDialog(LEGACY_RESET)}"),
  "legacy reset is removed from keyboard and click activation while transaction state is opaque",
);
const openSource = functionSource("openDialog");
const createSource = functionSource("create");
const playSource = functionSource("play");
const confirmedSource = functionSource("runConfirmed");
const importSource = functionSource("importLegacy");
for (const [source, guardedCall] of [
  [openSource, "setModal(next)"],
  [createSource, "createLocalWorld(storage"],
  [playSource, "touchLocalWorld(storage"],
  [confirmedSource, "resetLegacyLocalWorld(storage)"],
  [importSource, "importLegacyLocalWorld(storage"],
] as const) {
  assert.ok(source.indexOf("if (transactionReadOnly)") >= 0
    && source.indexOf("if (transactionReadOnly)") < source.indexOf(guardedCall),
  `read-only handler guard precedes ${guardedCall}`);
}

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
assert.ok(browser.includes("filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null")
  && browser.includes('value={selected?.world.id ?? ""}'),
  "a search resolves every action and the controlled native select to a visible option");
assert.ok(browser.includes("confirmedWorld?.name") && browser.includes("? selected?.world"),
  "destructive confirmation identifies its exact selected target");
assert.ok(browser.includes("new FormData(form)")
  && browser.includes('defaultValue="New World"')
  && browser.includes('defaultValue="survival"')
  && browser.includes('data.get("m") === "creative" ? "creative" : "survival"'),
  "native create fields preserve the default name and fail-closed Survival/Creative mode parsing");
assert.ok(browser.includes("touchLocalWorld(storage, selected.world.id, Date.now(), selected.world)"),
  "Play records last-played against the exact selected registry record before mounting the world");
assert.ok(browser.includes("resolveLocalWorldPlay(storage, selected, result)")
  && registry.includes('touch.reason !== "world_touch_recovery_pending"')
  && registry.includes("touch.mutationStarted !== false")
  && registry.includes("const before = scanRegistryState(storage)")
  && registry.includes("const after = scanRegistryState(storage)")
  && registry.includes("after[2] !== before[2]")
  && registry.includes("pendingDeletesWorld"),
  "Play fallback requires two stable registry scans around snapshot revalidation");
assert.ok(browser.includes("requestPointerLockHandoff()"), "Play reuses its user gesture for pointer capture");
assert.ok(browser.includes("if (document.pointerLockElement) document.exitPointerLock()"),
  "the browser releases any title-screen pointer handoff while showing UI");
assert.ok(browser.includes("legacy.status !== \"none\""), "legacy choice is shown only when old data exists");
assert.ok(browser.includes("Reset the original separately when ready."),
  "import never implies that legacy data was deleted");
assert.ok(browser.includes("browserSinglePlayerStorage()") && browser.includes("storage: suppliedStorage"),
  "the browser consumes the guarded storage boundary and accepts the root's shared adapter");

assert.ok(app.includes("<LocalWorldBrowser"), "single-player enters the world browser before constructing gameplay");
assert.ok(app.includes("<SinglePlayerWorld"), "only a selected world mounts the voxel engine");
assert.ok(app.includes("saveSinglePlayerSnapshot(storage, snapshot, now, { worldId: world.id })"),
  "manual/autosave/quit commits stay in the active world namespace");
assert.ok(app.includes("resetSinglePlayerSave(storage, { worldId: world.id })"),
  "in-game recovery can reset only the active world");
assert.equal(/\b(?:window\.)?localStorage\b/.test(app), false,
  "the world browser and active single-player world share a captured guarded adapter");
assert.ok(app.includes("quitSavedRef.current = true") && app.includes("onExit();"),
  "Save and Quit returns to the list without a duplicate unmount save");
assert.ok(app.includes("worldName={world.name}"), "the pause menu identifies the active world");

assert.ok(save.includes("Invalid single-player world storage namespace."),
  "invalid world IDs fail closed before any browser key is touched");
assert.ok(save.includes("SINGLEPLAYER_WORLD_STORAGE_PREFIX"), "each journal key is namespaced by world");
assert.ok(save.includes("const storage = window.localStorage")
  && save.includes("const getItem = storage.getItem")
  && save.includes("return UNAVAILABLE_SINGLEPLAYER_STORAGE"),
  "the only browser storage getter and method access lives inside one guarded adapter");
assert.ok(registry.includes("LOCAL_WORLD_REGISTRY_SLOT_A_KEY")
  && registry.includes("LOCAL_WORLD_REGISTRY_SLOT_B_KEY")
  && registry.includes("checksum"),
  "the world list has its own strict two-slot checksum journal");
assert.ok(registry.includes("migrateLegacy: true") && registry.includes("explicit Import action"),
  "legacy migration exists only behind the explicit import API");
assert.ok(registry.includes("type LocalWorldPendingTransaction")
  && registry.includes("saveRegistryState")
  && registry.includes('pending[0] ? "delete" : "create"')
  && registry.includes('completed = "cleanup_completed"'),
  "delete cleanup is recoverable from the pending tuple inside the registry commit point");
assert.ok(registry.includes("registryShare")
  && registry.includes("singlePlayerWorldStorageKeys(world.id)")
  && registry.includes("LOCAL_WORLD_NAMESPACE_BUDGET_CHARS"),
  "capacity uses the selected namespace plus apportioned registry overhead");

console.log("local world browser UI, accessibility, namespace, and legacy-choice tests passed");
