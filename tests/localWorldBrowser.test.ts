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
assert.ok(browser.includes('role="listbox"') && browser.includes('role="option"') && browser.includes("aria-selected="),
  "world selection exposes complete listbox and option semantics");
assert.ok(browser.includes('event.key !== "ArrowDown"') && browser.includes('event.key !== "ArrowUp"')
  && browser.includes('event.key !== "Home"') && browser.includes('event.key !== "End"')
  && browser.includes("moveLocalWorldSelection"),
  "the roving listbox implements Arrow, Home, and End navigation");
assert.ok(browser.includes("tabIndex={entry.world.id === reconciledSelectedId")
  && browser.includes("document.getElementById(`lc-local-world-${next}`)?.focus()"),
  "keyboard navigation maintains one tabbable option and moves DOM focus");
assert.ok(browser.includes('role={error ? "alert" : "status"}'), "create/import/reset feedback is announced");
assert.ok(browser.includes('role="alertdialog"') && browser.includes("dialog.showModal()"),
  "destructive confirmation uses the browser's focus-trapping modal dialog");
assert.ok(browser.includes("inert={modalOpen}")
  && browser.includes("onCancel={(event)")
  && browser.includes("data-safe-action")
  && browser.includes("trapDialogFocus")
  && browser.includes("restoreFocusRef")
  && browser.includes("restore?.isConnected"),
  "modal backgrounds are inert, Escape cancels, and initial focus is on the safe action");
assert.ok(browser.includes("Confirm destructive action") && browser.includes("This cannot be undone."),
  "delete and reset require explicit confirmation");
assert.ok(
  browser.includes("World deletion cleanup is pending. Healthy worlds remain available; no unverified deletion was applied.")
  && browser.includes("Ignored an invalid world-deletion marker. Healthy worlds remain available; orphaned storage may remain.")
  && browser.includes("Recovered an interrupted world deletion. Other worlds remain unchanged.")
  && browser.includes("disabled={!selected || deleteRecoveryPending || transactionReadOnly}"),
  "delete recovery remains visible without blocking access to healthy worlds",
);
assert.ok(
  browser.includes("const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(listing.registryLoad)")
  && browser.includes("World storage is read-only because pending transaction state could not be verified.")
  && browser.includes("Play and world changes are disabled until browser storage recovers.")
  && browser.includes("World storage is read-only until pending transaction state can be verified.")
  && browser.includes(">Retry World Storage</button>"),
  "opaque transaction state is presented as retryable read-only storage without a healthy-world availability claim",
);
assert.ok(
  browser.includes("const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected))")
  && browser.includes("aria-disabled={!selectedPlayable}")
  && browser.includes("disabled={!selectedPlayable}")
  && browser.includes("if (!selected || !selectedPlayable)"),
  "Play behavior and accessibility state fail closed while transaction visibility is opaque",
);
assert.ok(
  browser.includes("aria-disabled={!selected || transactionReadOnly}")
  && browser.includes("disabled={!selected || transactionReadOnly}")
  && browser.includes("aria-disabled={legacy.status !== \"available\" || blocked || transactionReadOnly || imported}"),
  "reset and legacy import controls expose and enforce registry read-only state",
);
assert.ok(
  browser.includes("aria-disabled={transactionReadOnly}")
  && browser.includes("disabled={transactionReadOnly}")
  && browser.includes('onClick={() => openConfirmation({ kind: "legacy_reset" })}'),
  "legacy reset is removed from keyboard and click activation while transaction state is opaque",
);
const openCreateSource = functionSource("openCreateDialog");
const openConfirmationSource = functionSource("openConfirmation");
const createSource = functionSource("create");
const confirmedSource = functionSource("runConfirmed");
const importSource = functionSource("importLegacy");
for (const [source, guardedCall] of [
  [openCreateSource, "setCreateOpen(true)"],
  [openConfirmationSource, "setConfirm(action)"],
  [createSource, "createLocalWorld(storage"],
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
assert.ok(browser.includes("reconcileLocalWorldSelection(selectedId, visibleWorldIds)")
  && browser.includes("const selected = filtered.find(({ world }) => world.id === reconciledSelectedId)"),
  "a search clears hidden selection before any world action can resolve a target");
assert.ok(browser.includes("confirmedWorld?.name"), "destructive confirmation identifies its exact target");
assert.ok(browser.includes("touchLocalWorld(storage, selected.world.id, Date.now(), selected.world)"),
  "Play records last-played against the exact selected registry record before mounting the world");
assert.ok(browser.includes("resolveLocalWorldPlay(storage, selected, result)")
  && registry.includes('touch.reason !== "world_touch_recovery_pending"')
  && registry.includes("touch.mutationStarted !== false")
  && registry.includes("loadLocalWorldRegistryRaw(storage)")
  && registry.includes('left.status !== "stable" || right.status !== "stable"'),
  "Play fallback requires two stable transaction scans around registry and snapshot revalidation");
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
assert.ok(registry.includes("LOCAL_WORLD_DELETE_TRANSACTION_KEY")
  && registry.includes("recoverLocalWorldDelete")
  && registry.includes("checksummed transaction"),
  "delete cleanup is recoverable across the registry commit point");
assert.ok(registry.includes("registryShare")
  && registry.includes("singlePlayerWorldStorageKeys(world.id)")
  && registry.includes("LOCAL_WORLD_NAMESPACE_BUDGET_CHARS"),
  "capacity uses the selected namespace plus apportioned registry overhead");

console.log("local world browser UI, accessibility, namespace, and legacy-choice tests passed");
