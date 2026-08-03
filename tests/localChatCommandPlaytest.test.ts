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
import { consumeSinglePlayerCommandSurfaceEscape } from "../client/singleplayer/sessionState.ts";

const shortcut = (code: string, key: string, repeat = false) => localCommandShortcutDraft({ code, key, repeat });
assert.equal(shortcut("Slash", "/"), "/", "the physical slash key seeds a command");
assert.equal(shortcut("Slash", "?"), "/", "Shift+/ still seeds canonical slash rather than a question mark");
assert.equal(shortcut("IntlRo", "/"), "/", "layout-specific codes fall back to the produced slash key");
assert.equal(shortcut("KeyT", "t"), "", "T retains the ordinary empty-console shortcut");
assert.equal(shortcut("Enter", "Enter"), "", "Enter retains the ordinary empty-console shortcut");
assert.equal(shortcut("Slash", "/", true), null, "key repeat cannot reopen or rewrite the console draft");
assert.equal(shortcut("KeyQ", "q"), null);

type DispatchedKeyEvent = Event & { code: string; key: string; repeat: boolean };
const rapidKeys = new EventTarget();
const commandSurfaceOpenRef = { current: false };
let pendingRenderedOpen = false;
let renderedOpen = false;
let surfaceDepth = 0;
let maximumSurfaceDepth = 0;
let pauseOpenCount = 0;
let pointerCaptureNeeded = false;
rapidKeys.addEventListener("keydown", (rawEvent) => {
  const event = rawEvent as DispatchedKeyEvent;
  if (consumeSinglePlayerCommandSurfaceEscape(commandSurfaceOpenRef.current, event, () => {
    commandSurfaceOpenRef.current = false;
    pendingRenderedOpen = false;
    surfaceDepth -= 1;
  })) return;
  if (commandSurfaceOpenRef.current) return;
  const draft = localCommandShortcutDraft(event);
  if (draft !== null) {
    event.preventDefault();
    event.stopImmediatePropagation();
    commandSurfaceOpenRef.current = true;
    pendingRenderedOpen = true;
    surfaceDepth += 1;
    maximumSurfaceDepth = Math.max(maximumSurfaceDepth, surfaceDepth);
    return;
  }
  if (event.code === "Escape" && !event.repeat) {
    pauseOpenCount += 1;
    pointerCaptureNeeded = true;
  }
});
const dispatchRapidKey = (code: string, key: string, repeat = false): DispatchedKeyEvent => {
  const event = new Event("keydown", { cancelable: true }) as DispatchedKeyEvent;
  Object.defineProperties(event, {
    code: { value: code },
    key: { value: key },
    repeat: { value: repeat },
  });
  rapidKeys.dispatchEvent(event);
  return event;
};
for (let cycle = 0; cycle < 3; cycle += 1) {
  const opened = dispatchRapidKey("Slash", "/");
  assert.equal(opened.defaultPrevented, true, "the command shortcut is consumed synchronously");
  assert.equal(commandSurfaceOpenRef.current, true, "the command surface opens before a render commit");
  assert.equal(renderedOpen, false, "the regression keeps Preact's prior render deliberately stale");
  const closed = dispatchRapidKey("Escape", "Escape");
  assert.equal(closed.defaultPrevented, true, "the same-turn Escape belongs only to the command surface");
  assert.equal(commandSurfaceOpenRef.current, false, "Escape closes the synchronous surface before commit");
}
renderedOpen = pendingRenderedOpen;
assert.equal(renderedOpen, false, "rapid open-close cycles commit no chat surface");
assert.equal(surfaceDepth, 0);
assert.equal(maximumSurfaceDepth, 1, "rapid cycles never stack command surfaces");
assert.equal(pauseOpenCount, 0, "same-turn chat Escape never opens Game Menu");
assert.equal(pointerCaptureNeeded, false, "same-turn chat Escape never exposes Click to Play");

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
assert.ok(LOCAL_COMMAND_HELP.includes("/locate cave"));

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
const commandOpenBranch = app.slice(
  app.indexOf("consumeSinglePlayerCommandSurfaceEscape("),
  app.indexOf("if (optionsOpen)"),
);
assert.ok(commandOpenBranch.includes("commandSurfaceOpenRef.current"));
assert.ok(commandOpenBranch.includes("() => closeCommandConsoleFromEscape(performance.now())"),
  "the synchronous surface, not a render closure, owns Escape close");
assert.ok(commandOpenBranch.includes("if (commandSurfaceOpenRef.current)"),
  "other command input is also fenced before a Preact commit");
assert.ok(app.includes("const worldModalOpen = containerOpen || sleepingBed !== null;"),
  "chat is excluded from the true simulation-pause modal boundary");
assert.ok(app.includes("const uiModalOpen = worldModalOpen || commandOpen;"),
  "chat still hides gameplay UI and blocks pointer-session loss handling");
const ongoingPauseStart = app.indexOf("const paused = singlePlayerGameplayPaused", app.indexOf("engine.start();"));
const ongoingPausePredicate = app.slice(ongoingPauseStart, app.indexOf("});", ongoingPauseStart) + 3);
assert.equal(ongoingPausePredicate.includes("commandOpen"), false,
  "open chat never freezes world time, mobs, TNT, or the retained render loop");
assert.ok(app.includes("inventoryOpen || worldModalOpen || deathScreenOpen || commandOpen"),
  "chat hides the held viewmodel while pointer recapture leaves the paused pose visible");
const shortcutBranch = app.slice(app.indexOf("const commandShortcutDraft"), app.indexOf('if (event.code === "KeyQ"'));
assert.ok(shortcutBranch.includes("inventoryOpen || worldModalOpen || deathScreenOpen"), "higher-priority modals fence every chat shortcut");
assert.ok(shortcutBranch.indexOf("commandSurfaceOpenRef.current = true") < shortcutBranch.indexOf("setCommandOpen(true)"),
  "the opening ref is set before scheduling Preact state");
assert.ok(shortcutBranch.includes("setCommandDraft(commandShortcutDraft)"));
assert.ok(shortcutBranch.includes("releasePointerLockForUi()"));
const timeBranch = app.slice(app.indexOf('if (parsed.command.kind === "time")'), app.indexOf("const granted ="));
assert.ok(timeBranch.includes("engine.setDayNightClock"));
assert.ok(timeBranch.includes("markWorldDirty()"));
assert.equal(/useQuery|useMutation|client\.|fetch\(/.test(timeBranch), false, "local time execution adds zero Lakebed traffic");
const engineSource = readFileSync(new URL("../client/game/voxelEngine.ts", import.meta.url), "utf8");
assert.ok(app.includes("engineRef.current?.findNearestCave()"), "the cave command uses a bounded local engine scan");
const clockSetter = engineSource.slice(
  engineSource.indexOf("setDayNightClock(config"),
  engineSource.indexOf("setPaused(nextPaused)"),
);
assert.match(clockSetter, /worldTimeMs = Date\.now\(\) \+ serverTimeOffsetMs;[\s\S]{0,180}render\(now, 0, now\)/,
  "a successful /time command visibly renders its new clock phase while chat remains open");

console.log("local chat/command playtest regression tests passed");
