import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  localWorldDeleteState,
  localWorldDialogRef,
} from "../client/singleplayer/localWorldBrowserIssue.ts";

const browser = readFileSync(new URL("../client/singleplayer/LocalWorldBrowser.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const save = readFileSync(new URL("../client/singleplayer/localSave.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("../client/singleplayer/localWorldRegistry.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = browser.indexOf(`  function ${name}`);
  const nextFunction = browser.indexOf("\n  function ", start + 1);
  const componentReturn = browser.indexOf("\n  return (", start + 1);
  const end = [nextFunction, componentReturn].filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return browser.slice(start, end);
}

assert.equal(browser.includes("lakebed/client"), false, "the world list stays entirely browser-local");
assert.equal(app.includes("lakebed/client"), false, "selecting a world cannot mount Lakebed transport");
assert.ok(browser.includes('aria-label="Local world browser"'));
assert.ok(browser.includes('aria-label="Search worlds"'));
assert.ok(browser.includes('aria-label="Local worlds"'));
assert.ok(browser.includes("const [modal, setModal] = useState<Modal>(0)"),
  "the create dialog is closed whenever the browser first opens");

const header = browser.slice(
  browser.indexOf('<div className="lc-local-world-header">'),
  browser.indexOf("</div>", browser.indexOf('<div className="lc-local-world-header">')) + 6,
);
assert.ok(header.indexOf('aria-label="Search worlds"') >= 0
  && header.indexOf('aria-label="Search worlds"') < header.indexOf("{CREATE_LABEL}"),
  "search is left of Create New World in the header");
assert.ok(browser.includes("grid-template-columns:minmax(0,1fr) minmax(240px,auto)")
  && browser.includes(".lc-local-world-header>.lc-menu-button{min-width:240px;white-space:nowrap}")
  && browser.includes("@media(max-width:560px)")
  && browser.includes(".lc-local-world-header{align-items:stretch;grid-template-columns:1fr}")
  && browser.includes(".lc-local-world-header>.lc-menu-button{min-width:0;width:100%}"),
  "Create New World stays on one line beside search and expands safely below 560px");
assert.ok(browser.includes(".lc-local-world-search input{background:#111;border:2px solid;")
  && browser.includes("height:46px")
  && browser.includes(".lc-local-world-search input:focus-visible{border-color:#fff;"),
  "search has an intentional, visible input surface and keyboard focus treatment");

const rowMarkup = browser.slice(browser.indexOf("<ul aria-label="), browser.indexOf("</ul>"));
assert.ok(rowMarkup.includes("<strong>{entry.world.name}</strong>")
  && rowMarkup.includes("<small>Last played {dateText(entry.world.lastPlayedAt)}</small>"),
  "world rows expose only their name and last-played metadata");
for (const removedMetadata of ["Last saved", "Game Mode", "Storage ", "entry.health", "entry.gameMode", "world.seed"]) {
  assert.equal(rowMarkup.includes(removedMetadata), false, `world rows omit ${removedMetadata}`);
}
assert.ok(rowMarkup.includes('className="lc-local-world-delete"')
  && rowMarkup.includes("aria-label={`Delete ${entry.world.name}`}")
  && browser.includes("grid-template-columns:minmax(0,1fr) auto"),
  "each row owns a right-aligned Delete control");
assert.ok(rowMarkup.includes("onDblClick={() => play(entry)}"),
  "double-clicking a world row plays that exact world");
assert.ok(rowMarkup.includes('if (event.key === "Enter")')
  && rowMarkup.includes("play(entry)"),
  "keyboard users can play the focused world with Enter");
assert.ok(browser.includes("overflow-x:hidden")
  && browser.includes("min-width:0")
  && browser.includes("text-overflow:ellipsis"),
  "the list and long names cannot create horizontal scrolling");
assert.ok(browser.includes("text-shadow:none")
  && browser.includes(".lc-local-world-browser *")
  && browser.includes(".lc-local-world-dialog *"),
  "the world browser and dialogs override the inherited offset text shadow");

for (const removed of [
  "Reset World",
  "Import Legacy",
  "Legacy World",
  "resetLocalWorldData",
  "resetLegacyLocalWorld",
  "inspectLegacyLocalWorld",
  "importLegacyLocalWorld",
]) {
  assert.equal(browser.includes(removed), false, `browser removes obsolete ${removed} code`);
  assert.equal(registry.includes(removed), false, `registry removes dead ${removed} support`);
}
assert.equal(registry.includes("migrateLegacy: true"), false,
  "the registry no longer contains an explicit legacy backfill path");

const deletePhrase = "yes, I want to delete this world";
assert.ok(browser.includes(`const DELETE_PHRASE = "${deletePhrase}"`));
assert.ok(browser.includes('aria-label="Delete confirmation phrase"')
  && browser.includes("deletePhrase === DELETE_PHRASE")
  && browser.includes("disabled={deleting && !deleteConfirmed}"),
  "destructive confirmation remains disabled until the exact phrase is entered");
const removeSource = functionSource("removeConfirmedWorld");
assert.ok(removeSource.indexOf("if (!deleteConfirmed) return") >= 0
  && removeSource.indexOf("if (!deleteConfirmed) return") < removeSource.indexOf("deleteLocalWorld(storage"),
  "the delete handler independently rejects an unmatched phrase");
assert.ok(browser.includes('role={deleting ? "alertdialog" : undefined}')
  && browser.includes("localWorldDialogRef(restoreFocusRef")
  && browser.includes('onClose={closeDialog}')
  && browser.includes('method="dialog"'),
  "native modal behavior provides inertness, focus trapping, Escape, and restoration");
assert.ok(browser.includes(".lc-local-world-dialog{background:transparent;border:0;box-sizing:border-box;height:100vh;height:100dvh;"
  + "margin:0;max-height:none;max-width:none;overflow-y:auto;"
  + "padding:clamp(16px,5vh,48px) 16px;width:100vw}")
  && browser.includes(".lc-local-world-dialog::backdrop{background:rgba(0,0,0,.72)}")
  && browser.includes(".lc-local-world-dialog .lc-username-menu{margin:auto;"),
  "the native dialog owns the full viewport, shades its backdrop, and centers both modal forms");
assert.ok(browser.includes('aria-label="World Name" autoFocus')
  && browser.includes('aria-label="Delete confirmation phrase"')
  && browser.indexOf('aria-label="Delete confirmation phrase"') < browser.indexOf("autoComplete=", browser.indexOf('aria-label="Delete confirmation phrase"')) + 200,
  "each dialog focuses its first useful, non-destructive field");
assert.equal(browser.includes("trapDialogFocus"), false,
  "the native dialog owns focus trapping");

assert.deepEqual(
  localWorldDeleteState(["delete:recovery_pending"]),
  ["!Deletion committed; cleanup pending.", true],
  "committed deletion recovery reports its unfinished namespace cleanup",
);
assert.deepEqual(
  localWorldDeleteState(["delete:invalid_transaction_pending"]),
  ["!Invalid deletion marker; worlds unchanged.", true],
  "a malformed pending marker does not claim that a deletion committed",
);
assert.deepEqual(localWorldDeleteState(["delete:invalid_transaction_cleared"]),
  ["!Invalid deletion ignored. Worlds remain available; orphaned data may remain.", false]);
assert.deepEqual(localWorldDeleteState(["delete:cleanup_completed"]),
  ["Deletion recovered; other worlds unchanged.", false]);
for (const issue of ["transaction:active", "delete:active", "delete:future_issue"]) {
  assert.deepEqual(localWorldDeleteState([issue]), ["", false],
    `${issue} does not impersonate a known delete recovery state`);
}

class FakeDialog {
  open = false;
  private readonly events: string[];
  constructor(events: string[]) {
    this.events = events;
  }
  close(): void {
    this.events.push("close");
    this.open = false;
  }
  showModal(): void {
    this.events.push("showModal");
    this.open = true;
  }
}

function focusTarget(events: string[], name: string, isConnected = true, disabled = false) {
  return { isConnected, disabled, focus: () => events.push(`${name}.focus`) };
}

for (const completion of ["Cancel", "successful Create"]) {
  const events: string[] = [];
  const dialog = new FakeDialog(events);
  const restoreRef = { current: focusTarget(events, "opener") };
  const lifecycle = localWorldDialogRef(restoreRef, () => focusTarget(events, "title"));
  lifecycle(dialog);
  lifecycle(null);
  assert.deepEqual(events, ["showModal", "close", "opener.focus"],
    `${completion} closes before restoring its valid opener`);
  assert.equal(dialog.open, false, `${completion} leaves no native modal open`);
  assert.equal(restoreRef.current, null, `${completion} clears its saved opener`);
}
for (const [condition, restore] of [
  ["deleted", { isConnected: false, disabled: false }],
  ["disabled", { isConnected: true, disabled: true }],
] as const) {
  const events: string[] = [];
  const restoreRef = { current: { ...restore, focus: () => events.push("opener.focus") } };
  const lifecycle = localWorldDialogRef(restoreRef, () => focusTarget(events, "title"));
  lifecycle(new FakeDialog(events));
  lifecycle(null);
  assert.deepEqual(events, ["showModal", "close", "title.focus"], `${condition} opener falls back to the title`);
}

assert.ok(
  browser.includes("localWorldDeleteState(registryLoad.issues)")
  && rowMarkup.includes("disabled={deleteBlocked || transactionReadOnly}"),
  "per-row delete controls retain pending-delete guards",
);
assert.ok(
  browser.includes("const transactionReadOnly = isLocalWorldRegistryTransactionReadOnly(registryLoad)")
  && browser.includes("Play and changes are disabled until recovery.")
  && browser.includes("Retry Storage"),
  "opaque transaction state is presented as retryable read-only storage");
const playSource = functionSource("play");
assert.ok(playSource.indexOf("transactionReadOnly || !canPlayLocalWorld(entry)") >= 0
  && playSource.indexOf("transactionReadOnly || !canPlayLocalWorld(entry)")
    < playSource.indexOf("touchLocalWorld(storage"),
  "Play's handler guard precedes its world-list mutation");
assert.ok(browser.includes("touchLocalWorld(storage, entry.world.id, Date.now(), entry.world)"),
  "Play records last-played against the exact activated registry record");
assert.ok(browser.includes("resolveLocalWorldPlay(storage, entry, result)")
  && registry.includes('touch.reason !== "world_touch_recovery_pending"')
  && registry.includes("touch.mutationStarted !== false")
  && registry.includes("const before = scanRegistryState(storage)")
  && registry.includes("const after = scanRegistryState(storage)")
  && registry.includes("after[2] !== before[2]")
  && registry.includes("pendingDeletesWorld"),
  "Play fallback requires two stable registry scans around snapshot revalidation");
assert.ok(browser.includes("requestDocumentPointerLockHandoff()"),
  "Play reuses its user gesture for pointer capture");
assert.ok(browser.includes("if (document.pointerLockElement) document.exitPointerLock()"),
  "the browser releases any title-screen pointer handoff while showing UI");

assert.ok(browser.includes("world.name.toLocaleLowerCase().includes"),
  "search filters only by normalized world name without mutating the registry");
assert.ok(browser.includes("filtered.find(({ world }) => world.id === selectedId) ?? filtered[0] ?? null"),
  "search resolves actions to a visible world");
assert.ok(browser.includes('name="world-title"')
  && browser.includes('defaultValue="New World"')
  && browser.includes('<option value="survival">Survival</option>')
  && browser.includes('<option value="creative">Creative</option>')
  && browser.includes('mode.value === "creative" ? "creative" : "survival"'),
  "native create fields retain fail-closed Survival/Creative parsing");
assert.ok(browser.includes("browserSinglePlayerStorage()") && browser.includes("storage: suppliedStorage"),
  "the browser consumes the guarded storage boundary and accepts the root's shared adapter");

assert.ok(app.includes("<LocalWorldBrowser"), "single-player enters the world browser before constructing gameplay");
assert.ok(app.includes("<SinglePlayerWorld"), "only an activated world mounts the voxel engine");
assert.ok(app.includes("saveSinglePlayerSnapshot(storage, snapshot, now, { worldId: world.id })"),
  "autosave/quit commits stay in the active world namespace");
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
assert.ok(registry.includes("type LocalWorldPendingTransaction")
  && registry.includes("saveRegistryState")
  && registry.includes('pending[0] ? "delete" : "create"')
  && registry.includes('completed = "cleanup_completed"'),
  "delete cleanup is recoverable from the pending tuple inside the registry commit point");
assert.ok(registry.includes("registryShare")
  && registry.includes("singlePlayerWorldStorageKeys(world.id)")
  && registry.includes("LOCAL_WORLD_NAMESPACE_BUDGET_CHARS"),
  "capacity accounting still protects the selected namespace");

console.log("local world browser cleanup, accessibility, and namespace tests passed");
