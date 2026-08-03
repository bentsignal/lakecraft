import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { phaseAtTime } from "../client/game/dayNight.ts";
import { createMobSimulation, exportMobSimulationSnapshot } from "../client/game/mobs.ts";
import { VOXEL_RUNTIME_SNAPSHOT_VERSION } from "../client/game/types.ts";
import { chatPeekMessageFading, nextChatPeekExpiryDelay, visibleChatPeekMessages } from "../client/chat/chatPeek.ts";
import {
  LOCAL_COMMAND_HELP,
  LOCAL_COMMAND_PEEK_MS,
  LOCAL_TIME_PHASES,
  localCommandShortcutDraft,
  localTimeClockUpdate,
  parseLocalCommand,
} from "../client/singleplayer/localCommands.ts";
import {
  createDefaultSinglePlayerSnapshot,
  loadSinglePlayerSave,
  saveSinglePlayerSnapshot,
  type SinglePlayerStorageAdapter,
} from "../client/singleplayer/localSave.ts";

const shortcut = (code: string, key: string, repeat = false) => localCommandShortcutDraft({ code, key, repeat });
assert.equal(shortcut("Slash", "/"), "/", "the physical slash key seeds a command");
assert.equal(shortcut("Slash", "?"), "/", "Shift+/ still seeds canonical slash rather than a question mark");
assert.equal(shortcut("IntlRo", "/"), "/", "layout-specific codes fall back to the produced slash key");
assert.equal(shortcut("KeyT", "t"), "", "T retains the ordinary empty-console shortcut");
assert.equal(shortcut("Enter", "Enter"), "", "Enter retains the ordinary empty-console shortcut");
assert.equal(shortcut("Slash", "/", true), null, "key repeat cannot reopen or rewrite the console draft");
assert.equal(shortcut("KeyQ", "q"), null);

assert.deepEqual(parseLocalCommand("/time set day"), { ok: true, command: { kind: "time", time: "day" } });
assert.deepEqual(parseLocalCommand("/time set night"), { ok: true, command: { kind: "time", time: "night" } });
for (const invalid of ["/time", "/time day", "/time set", "/time set noon", "/time set night now"]) {
  const parsed = parseLocalCommand(invalid);
  assert.equal(parsed.ok, false, `${invalid} is rejected deterministically`);
  if (!parsed.ok) assert.equal(parsed.code, "usage");
}
const deniedTime = parseLocalCommand("/time set day", { changeGameMode: true, giveItems: true, setTime: false });
assert.equal(deniedTime.ok, false);
if (!deniedTime.ok) assert.equal(deniedTime.code, "permission");
assert.ok(LOCAL_COMMAND_HELP.includes("/time set <day|night>"));

const worldTimeMs = 1_750_000_123_456;
const clientNowMs = 1_750_000_000_000;
for (const time of ["day", "night"] as const) {
  const update = localTimeClockUpdate(worldTimeMs, clientNowMs, time);
  assert.deepEqual(update.config, { epochMs: worldTimeMs, epochPhase: LOCAL_TIME_PHASES[time] });
  assert.equal(update.serverTimeOffsetMs, worldTimeMs - clientNowMs);
  assert.equal(phaseAtTime(worldTimeMs, { cycleLengthMs: 480_000, ...update.config }), LOCAL_TIME_PHASES[time]);
}

const base = 10_000;
const messages = [0, 2_000, 5_000, 9_000].map((offset, index) => ({
  id: `${index}`,
  sentAt: base + offset,
}));
assert.deepEqual(
  visibleChatPeekMessages(messages, base + 9_999, LOCAL_COMMAND_PEEK_MS).map(({ id }) => id),
  ["1", "2", "3"],
  "the closed HUD remains capped to its newest three readable messages",
);
assert.deepEqual(
  visibleChatPeekMessages(messages, base + 12_000, LOCAL_COMMAND_PEEK_MS).map(({ id }) => id),
  ["2", "3"],
  "an entry disappears exactly when its bounded age is reached",
);
assert.equal(nextChatPeekExpiryDelay(messages, base + 12_000, LOCAL_COMMAND_PEEK_MS), 2_000, "the fake clock wakes at fade start before expiry");
assert.equal(chatPeekMessageFading(messages[2], base + 14_000, LOCAL_COMMAND_PEEK_MS), true);
assert.equal(chatPeekMessageFading(messages[2], base + 15_000, LOCAL_COMMAND_PEEK_MS), false);
assert.deepEqual(visibleChatPeekMessages(messages, base + 19_000, LOCAL_COMMAND_PEEK_MS), []);
assert.equal(nextChatPeekExpiryDelay(messages, base + 19_000, LOCAL_COMMAND_PEEK_MS), null);
assert.equal(messages.length, 4, "fading never deletes the open-console history");
assert.deepEqual(
  visibleChatPeekMessages([{ id: "iso", sentAt: new Date(base).toISOString() }], base + 1, LOCAL_COMMAND_PEEK_MS),
  [{ id: "iso", sentAt: new Date(base).toISOString() }],
  "ISO server timestamps remain compatible with the shared chat surface",
);

class MemoryStorage implements SinglePlayerStorageAdapter {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const snapshot = createDefaultSinglePlayerSnapshot(9001, clientNowMs);
const dayClock = localTimeClockUpdate(worldTimeMs, clientNowMs, "day");
snapshot.runtime = {
  version: VOXEL_RUNTIME_SNAPSHOT_VERSION,
  pose: { x: 0.5, y: 8.02, z: 0.5, yaw: 0, pitch: 0 },
  respawnPoint: { x: 0.5, y: 8.02, z: 0.5, yaw: 0, pitch: 0 },
  playerHealth: 20,
  worldTimeMs,
  dayNight: { cycleLengthMs: 480_000, ...dayClock.config },
  mobAccumulatorSeconds: 0,
  mobSimulation: exportMobSimulationSnapshot(createMobSimulation([])),
};
const storage = new MemoryStorage();
assert.equal(saveSinglePlayerSnapshot(storage, snapshot, clientNowMs).ok, true);
const loaded = loadSinglePlayerSave(storage);
assert.equal(loaded.status, "loaded");
if (loaded.status !== "loaded" || !loaded.snapshot.runtime) throw new Error("time-set runtime did not reload");
assert.equal(
  phaseAtTime(loaded.snapshot.runtime.worldTimeMs, loaded.snapshot.runtime.dayNight),
  LOCAL_TIME_PHASES.day,
  "the exact local time command epoch survives the checksummed save journal",
);

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");
const commandOpenBranch = app.slice(app.indexOf("if (commandOpen)"), app.indexOf("if (optionsOpen)"));
assert.ok(commandOpenBranch.includes('if (event.code === "Escape")'));
assert.ok(commandOpenBranch.includes("event.stopImmediatePropagation();"), "chat Escape is consumed before sibling handlers");
assert.ok(commandOpenBranch.indexOf("event.stopImmediatePropagation();") < commandOpenBranch.indexOf("closeCommandConsoleFromEscape"));
assert.ok(commandOpenBranch.includes("if (!event.repeat) closeCommandConsoleFromEscape(performance.now());"),
  "Escape repeat is consumed without repeated close or pointer-lock requests");
assert.ok(app.includes("const worldModalOpen = containerOpen || sleepingBed !== null;"),
  "chat is excluded from the true simulation-pause modal boundary");
assert.ok(app.includes("const uiModalOpen = worldModalOpen || commandOpen;"),
  "chat still hides gameplay UI and blocks pointer-session loss handling");
const ongoingPauseStart = app.indexOf("const paused = singlePlayerGameplayPaused", app.indexOf("engine.start();"));
const ongoingPausePredicate = app.slice(ongoingPauseStart, app.indexOf("});", ongoingPauseStart) + 3);
assert.equal(ongoingPausePredicate.includes("commandOpen"), false,
  "open chat never freezes world time, mobs, TNT, or the retained render loop");
assert.ok(app.includes("|| commandOpen || pointerCaptureNeeded"),
  "chat can still hide the held viewmodel without pausing simulation");
const shortcutBranch = app.slice(app.indexOf("const commandShortcutDraft"), app.indexOf('if (event.code === "KeyQ"'));
assert.ok(shortcutBranch.includes("inventoryOpen || worldModalOpen || deathScreenOpen"), "higher-priority modals fence every chat shortcut");
assert.ok(shortcutBranch.includes("setCommandDraft(commandShortcutDraft)"));
assert.ok(shortcutBranch.includes("releasePointerLockForUi()"));
const timeBranch = app.slice(app.indexOf('if (parsed.command.kind === "time")'), app.indexOf("const granted ="));
assert.ok(timeBranch.includes("engine.setDayNightClock"));
assert.ok(timeBranch.includes("markWorldDirty()"));
assert.equal(/useQuery|useMutation|client\.|fetch\(/.test(timeBranch), false, "local time execution adds zero Lakebed traffic");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
const clockSetter = engineSource.slice(
  engineSource.indexOf("setDayNightClock(config"),
  engineSource.indexOf("setPaused(nextPaused)"),
);
assert.match(clockSetter, /worldTimeMs = Date\.now\(\) \+ serverTimeOffsetMs;[\s\S]{0,180}render\(now, 0, now\)/,
  "a successful /time command visibly renders its new clock phase while chat remains open");

console.log("local chat/command playtest regression tests passed");
