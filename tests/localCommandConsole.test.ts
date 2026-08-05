import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_LOCAL_GIVE_COUNT,
  canonicalLocalItemIds,
  giveLocalItem,
  parseLocalCommand,
  transitionLocalGameMode,
} from "../client/singleplayer/localCommands.ts";
import {
  MAX_HEALTH,
  MAX_HUNGER,
  countItem,
  createEmptyEquipment,
  createEmptyInventory,
  createStarterInventory,
} from "../shared/game.ts";
import {
  SINGLEPLAYER_SAVE_HEAD_KEY,
  SINGLEPLAYER_SAVE_SLOT_A_KEY,
  canonicalSinglePlayerJson,
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  serializeSinglePlayerSave,
  singlePlayerSaveChecksum,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";
import { stripClientDevelopmentSurfaces } from "../scripts/client-development-surface-transform.mjs";

assert.deepEqual(parseLocalCommand("/help"), { ok: true, command: { kind: "help" } });
assert.deepEqual(parseLocalCommand(" /GaMeMoDe creative "), {
  ok: true,
  command: { kind: "gamemode", mode: "creative" },
});
assert.deepEqual(parseLocalCommand("/give tnt 64"), {
  ok: true,
  command: { kind: "give", itemId: "tnt", count: 64 },
});
assert.deepEqual(parseLocalCommand("/give bow"), {
  ok: true,
  command: { kind: "give", itemId: "bow", count: 1 },
});
assert.deepEqual(parseLocalCommand("/locate cave"), { ok: true, command: { kind: "locate", feature: "cave" } });
assert.equal(parseLocalCommand("/locate village").ok, false);
assert.equal(parseLocalCommand("give dirt").ok, false, "slash syntax is mandatory and deterministic");
assert.equal(parseLocalCommand("/give not_an_item").ok, false, "the canonical item catalog rejects unknown IDs");
assert.equal(parseLocalCommand("/give dirt 1.5").ok, false);
assert.equal(parseLocalCommand("/give dirt 0").ok, false);
assert.equal(parseLocalCommand(`/give dirt ${MAX_LOCAL_GIVE_COUNT + 1}`).ok, false);
assert.equal(parseLocalCommand("/gamemode spectator").ok, false);
assert.equal(parseLocalCommand("/gamemode creative", { changeGameMode: false, giveItems: true, setTime: true }).ok, false);
assert.equal(parseLocalCommand("/give dirt", { changeGameMode: true, giveItems: false, setTime: true }).ok, false);
assert.ok(canonicalLocalItemIds().includes("tnt"));
assert.ok(canonicalLocalItemIds().includes("bow"));
assert.deepEqual([...canonicalLocalItemIds()].sort(), canonicalLocalItemIds(), "help catalog ordering is stable");

const empty = createEmptyInventory();
const tntGrant = giveLocalItem(empty, "tnt", 64);
assert.equal(tntGrant.ok, true);
if (!tntGrant.ok) throw new Error(tntGrant.message);
assert.equal(countItem(tntGrant.inventory, "tnt"), 64);
assert.equal(countItem(empty, "tnt"), 0, "grants do not mutate the caller's inventory");

const full = createEmptyInventory();
for (let index = 0; index < full.length; index += 1) full[index] = { itemId: "dirt", count: 64 };
const failedGrant = giveLocalItem(full, "tnt", 1);
assert.equal(failedGrant.ok, false);
assert.deepEqual(failedGrant.inventory, full, "capacity failure is atomic");

const starter = createStarterInventory();
const beforeTransition = structuredClone(starter);
const creative = transitionLocalGameMode({
  mode: "survival",
  health: 4,
  hunger: 2,
  inventory: starter,
  equipment: createEmptyEquipment(),
}, "creative");
assert.equal(creative.health, MAX_HEALTH);
assert.equal(creative.hunger, MAX_HUNGER);
assert.deepEqual(creative.inventory, beforeTransition);
const survival = transitionLocalGameMode(creative, "survival");
assert.equal(survival.health, MAX_HEALTH);
assert.equal(survival.hunger, MAX_HUNGER);
assert.deepEqual(survival.inventory, beforeTransition, "round-trip mode changes conserve every item");

class MemoryStorage implements SinglePlayerStorageAdapter {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const creativeSnapshot = createDefaultSinglePlayerSnapshot(127, 100);
creativeSnapshot.world.gameMode = "creative";
const storage = new MemoryStorage();
assert.equal(saveSinglePlayerSnapshot(storage, creativeSnapshot, 200).ok, true);
const reloaded = loadSinglePlayerSave(storage);
assert.equal(reloaded.status, "loaded");
if (reloaded.status !== "loaded") throw new Error(reloaded.status);
assert.equal(reloaded.snapshot.world.gameMode, "creative", "game mode survives save/reload");

const incompleteSnapshot = createDefaultSinglePlayerSnapshot(126, 99);
delete incompleteSnapshot.world.gameMode;
assert.deepEqual(serializeSinglePlayerSave(incompleteSnapshot, 1, 199), {
  ok: false,
  reason: "invalid_snapshot",
  path: "$.world",
}, "serialization rejects a current-format snapshot without its required game mode");
const validSerialized = serializeSinglePlayerSave(createDefaultSinglePlayerSnapshot(126, 99), 1, 199);
assert.equal(validSerialized.ok, true);
if (!validSerialized.ok) throw new Error(validSerialized.reason);
const incompleteEnvelope = JSON.parse(validSerialized.raw);
delete incompleteEnvelope.payload.world.gameMode;
const { checksum: _discardedChecksum, ...incompleteBody } = incompleteEnvelope;
incompleteEnvelope.checksum = singlePlayerSaveChecksum(incompleteBody);
const incompleteStorage = new MemoryStorage();
incompleteStorage.values.set(SINGLEPLAYER_SAVE_SLOT_A_KEY, canonicalSinglePlayerJson(incompleteEnvelope));
incompleteStorage.values.set(SINGLEPLAYER_SAVE_HEAD_KEY, JSON.stringify({ sequence: 1, slot: "a" }));
const incompleteReloaded = loadSinglePlayerSave(incompleteStorage);
assert.equal(incompleteReloaded.status, "corrupt",
  "loading rejects a checksummed current-format journal missing its required game mode");

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("../client/chat/ChatOverlay.tsx", import.meta.url), "utf8");
const engine = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(app.includes("localCommandShortcutDraft(event)"), "the shared layout-safe shortcut owns T, Enter, and slash opening");
assert.ok(app.includes('event.code === "ArrowUp" || event.code === "ArrowDown"'));
assert.ok(app.includes('surfaceLabel="Local command console"'));
assert.ok(app.includes('historyLabel="Command history"'));
assert.ok(app.includes('warningSender="[Error]"'));
assert.ok(app.includes("const worldModalOpen = containerOpen || sleepingBed !== null;"),
  "the command console does not freeze the live local simulation");
const uiModalDeclaration = app.match(/^\s*const uiModalOpen = [^\n]+;$/m)?.[0].trim();
assert.ok(uiModalDeclaration, "the UI/input blocker declaration remains explicit");
assert.ok(uiModalDeclaration.includes("worldModalOpen") && uiModalDeclaration.includes("commandOpen"),
  "the command console remains a pointer-safe UI blocker");
const visualLabModalTerm = "/* @lakecraft-development:modal:start */ || visualLabOpen"
  + "/* @lakecraft-development:modal:end */";
assert.equal(
  uiModalDeclaration.replace(visualLabModalTerm, ""),
  "const uiModalOpen = worldModalOpen || commandOpen;",
  "any Visual Lab UI blocker remains inside the correctly paired development-only marker span",
);
const ongoingPause = app.slice(
  app.indexOf("const paused = singlePlayerGameplayPaused", app.indexOf("engine.start();")),
  app.indexOf("if (deathScreenOpen) setOptionsOpen(false)"),
);
const ongoingPausePredicate = ongoingPause.slice(0, ongoingPause.indexOf("});") + 3);
assert.ok(ongoingPausePredicate.includes("worldModalOpen"),
  "world modals continue to freeze the simulation");
assert.equal(ongoingPausePredicate.includes("commandOpen"), false,
  "the command console blocks input without freezing the simulation");
assert.ok(
  stripClientDevelopmentSurfaces(app).includes("const uiModalOpen = worldModalOpen || commandOpen;"),
  "compact stripping removes the development-only Visual Lab blocker cleanly",
);
assert.ok(app.includes('canTakePlayerDamage: () => gameModeRef.current === "survival"'));
assert.ok(app.includes('if (gameModeRef.current === "creative") return 0'));
assert.ok(app.includes('(gameModeRef.current === "creative" || countItem(inventoryRef.current, "arrow") > 0)'),
  "Creative bows do not require or consume arrows");
assert.ok(app.includes('const nextInventory = creative ? inventoryRef.current : inventoryRef.current.map'),
  "Creative bone meal grows trees without consuming the selected stack");
assert.ok(chat.includes("senderForMessage"), "shared chat rendering supports local command labels without changing defaults");
assert.equal((engine.match(/options\.canTakePlayerDamage\?\.\(\) !== false/g) ?? []).length, 5,
  "mob, creeper, fall, TNT, and confirmed knockback all honor creative invulnerability before mutating state");

console.log("local command console tests passed");
