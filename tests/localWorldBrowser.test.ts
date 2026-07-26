import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const browser = readFileSync(new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const save = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../client/singleplayer/localWorldRegistry.ts", import.meta.url), "utf8");
const menuButton = readFileSync(new URL("../client/lobby/menuButton.tsx", import.meta.url), "utf8");

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
assert.ok(browser.includes("`Last saved ${dateText(entry.lastSavedAt)}`")
  && browser.includes('entry.health === "unsupported"')
  && browser.includes("parts.push(health, `Storage ${capacity}`)")
  && browser.includes('return parts.join(" · ")'),
  "each native option exposes mode, last-save, health, and capacity context");
assert.ok(browser.includes('role={error ? "alert" : "status"}')
  && browser.includes('hint(notice || "Local worlds · no Lakebed traffic")'),
  "create/import/reset feedback is announced");
assert.ok(browser.includes('role={creating ? undefined : "alertdialog"}') && browser.includes("dialog.showModal()"),
  "destructive confirmation uses the browser's focus-trapping modal dialog");
assert.ok(browser.includes('onClose={() => setModal(0)}')
  && browser.includes('method="dialog"')
  && browser.includes("autoFocus")
  && browser.includes("restoreFocusRef")
  && browser.includes("restore?.isConnected")
  && browser.includes('const TITLE_ID = "lc-world-browser-title"')
  && browser.includes("document.getElementById(TITLE_ID)"),
  "native modal behavior handles inertness, Escape, Tab order, a safe initial action, and explicit fallback restoration");
assert.equal(browser.includes("trapDialogFocus"), false,
  "the browser dialog owns focus trapping instead of a partial custom Tab implementation");
assert.ok(browser.includes("Confirm deletion/reset") && browser.includes("This cannot be undone."),
  "delete and reset require explicit confirmation");
assert.ok(
  browser.includes("Deletion recovery pending; nothing deleted. Healthy worlds remain available.")
  && browser.includes("Invalid deletion ignored. Worlds remain available; orphaned data may remain.")
  && browser.includes("Deletion recovered; other worlds unchanged.")
  && browser.includes('["Delete World…", !selected || deleteRecoveryPending || transactionReadOnly'),
  "delete recovery remains visible without blocking access to healthy worlds",
);
assert.ok(
  browser.includes("const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(registryLoad)")
  && browser.includes("Unverified transactions: storage is read-only.")
  && browser.includes("Play and changes are disabled until recovery.")
  && browser.includes("Unverified transactions: storage is read-only.")
  && browser.includes("Retry Storage"),
  "opaque transaction state is presented as retryable read-only storage without a healthy-world availability claim",
);
assert.ok(
  browser.includes("const selectedPlayable = Boolean(selected && !transactionReadOnly && canPlayLocalWorld(selected))")
  && browser.includes('["Play World", !selectedPlayable, ACTION.PLAY]')
  && browser.includes("if (!selected || !selectedPlayable)"),
  "native Play disabled behavior and its handler fail closed while transaction visibility is opaque",
);
assert.ok(
  browser.includes('["Reset World…", !selected || transactionReadOnly')
  && browser.includes('legacy.status !== "available" || blocked || transactionReadOnly || imported'),
  "native reset and legacy import controls enforce registry read-only state",
);
assert.ok(
  browser.includes("[`Reset ${LEGACY}Data…`, transactionReadOnly, ACTION.LEGACY_RESET]"),
  "legacy reset is removed from keyboard and click activation while transaction state is opaque",
);
const performSource = functionSource("perform");
for (const guardedCall of [
  "setModal(action",
  "createLocalWorld(storage",
  "resetLegacyLocalWorld(storage)",
  "importLegacyLocalWorld(storage",
] as const) {
  assert.ok(performSource.indexOf("if (transactionReadOnly)") >= 0
    && performSource.indexOf("if (transactionReadOnly)") < performSource.indexOf(guardedCall),
  `read-only handler guard precedes ${guardedCall}`);
}
const playSource = functionSource("play");
assert.ok(playSource.indexOf("if (!selected || !selectedPlayable)") >= 0
  && playSource.indexOf("if (!selected || !selectedPlayable)") < playSource.indexOf("touchLocalWorld(storage"),
  "Play's handler guard precedes its world-list mutation");

for (const label of [
  "Select World",
  "Create New World",
  "Play World",
  "Delete World…",
  "Reset World…",
  "Last played",
  "Last saved",
]) {
  assert.ok(browser.includes(label), `world browser exposes ${label}`);
}
assert.ok(browser.includes('const LEGACY = "Legacy "')
  && browser.includes("`${LEGACY}world found.")
  && browser.includes("`Import ${LEGACY}World`")
  && browser.includes("`Reset ${LEGACY}Data…`"),
  "legacy controls and guidance retain their complete labels");
assert.ok(browser.includes("capitalize(entry.health)")
  && browser.includes('entry.capacity === "warning" ? "low"')
  && browser.includes('entry.capacity === "exceeded" ? "full"'),
  "world rows derive the same readable health and storage-capacity labels");

assert.ok(browser.includes("world.name.toLocaleLowerCase().includes"),
  "search filters by normalized world name without mutating the registry");
assert.ok(browser.includes("filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null")
  && browser.includes('value={selected?.world.id ?? ""}'),
  "a search resolves every action and the controlled native select to a visible option");
assert.ok(browser.includes('const confirmedName = confirmedWorld?.name ?? "this world"')
  && browser.includes("? selected?.world"),
  "destructive confirmation identifies its exact selected target");
assert.ok(browser.includes("form?.elements")
  && browser.includes('value="New World"')
  && browser.includes("<option>Survival</option><option>Creative</option>")
  && browser.includes("fields[0].value")
  && browser.includes("fields[1].value")
  && browser.includes('fields[2].selectedIndex ? "creative" : "survival"'),
  "native create fields preserve the default name and fail-closed Survival/Creative mode parsing");
const createFieldsSource = browser.slice(
  browser.indexOf("const CREATE_FIELDS"),
  browser.indexOf("function dateText"),
);
assert.equal(createFieldsSource.includes("${"), false,
  "the compact native create markup is a fixed authored literal with no injection seam");
assert.ok(browser.includes("dangerouslySetInnerHTML={{ __html: CREATE_FIELDS }}")
  && menuButton.includes("id?: string | number")
  && browser.includes("menuButton(text, undefined, disabled, 0, action)"),
  "delegated world actions retain native disabled buttons and fixed create controls");
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
assert.ok(browser.includes("requestDocumentPointerLockHandoff()"), "Play reuses its user gesture for pointer capture");
assert.ok(browser.includes("if (document.pointerLockElement) document.exitPointerLock()"),
  "the browser releases any title-screen pointer handoff while showing UI");
assert.ok(browser.includes("legacy.status !== \"none\""), "legacy choice is shown only when old data exists");
assert.ok(browser.includes("reset source separately."),
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
