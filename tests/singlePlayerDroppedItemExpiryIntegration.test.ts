import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/singleplayer/SinglePlayerApp.tsx", import.meta.url), "utf8");

const loadStart = app.indexOf("function loadInitialLocalWorld");
const loadEnd = app.indexOf("export function SinglePlayerApp", loadStart);
const load = app.slice(loadStart, loadEnd);
assert.ok(load.includes("pruneExpiredLocalDroppedItems(snapshot.drops, now)"),
  "stale persisted drops leave the world before refs and the renderer initialize");
assert.ok(load.includes("snapshot: currentSnapshot") && load.includes("prunedDropCount: pruned.removed"),
  "load reports exact cleanup and retains the pruned snapshot");
assert.match(app, /saveCadenceRef = useRef\(initial\.current\.prunedDropCount > 0[\s\S]*?markSaveCadenceDirty/,
  "load-time expiry joins the existing crash-safe dirty-save cadence");

const pruneStart = app.indexOf("function pruneLocalDrops");
const pruneEnd = app.indexOf("function dropLocalSelected", pruneStart);
const prune = app.slice(pruneStart, pruneEnd);
assert.ok(prune.includes("pruneExpiredLocalDroppedItems(dropsRef.current, now)"));
assert.ok(prune.includes("dropsRef.current = pruned.drops"));
assert.ok(prune.includes("engineRef.current?.setDroppedItems(pruned.drops)"),
  "retained geometry reconciles immediately after expiry");
assert.ok(prune.includes("markWorldDirty()"), "the next save omits expired rows");
assert.equal(prune.includes("setInventory"), false, "expiry cannot grant or remove carried inventory");
assert.equal(prune.includes("setInterval"), false, "expiry adds no timer of its own");

const sampleStart = app.indexOf("const sample = () =>");
const sampleEnd = app.indexOf("const interval = window.setInterval(sample, 1_000)", sampleStart);
assert.ok(app.slice(sampleStart, sampleEnd).includes("pruneLocalDrops(Date.now())"),
  "stationary, paused, and death-screen worlds reuse the existing one-second sample");

for (const [label, startToken, endToken] of [
  ["container recovery", "function settleBrokenContainerContents", "function invalidateBrokenBed"],
  ["manual Q drop", "function dropLocalSelected", "function respawnLocally"],
  ["death settlement", "function respawnLocally", "useEffect(() =>"],
  ["mining", "canMineBlock: (block) =>", "acceptWorldEdits:"],
  ["mob loot", "onMobDrops: (event) =>", "onLocalCreeperExplosion:"],
] as const) {
  const start = app.indexOf(startToken);
  const end = app.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start && app.slice(start, end).includes("pruneLocalDrops()"),
    `${label} must reclaim stale capacity before its bounded acceptance check`);
}

assert.equal(app.includes("lakebed/client"), false, "offline expiry adds zero Lakebed traffic");

console.log("single-player dropped-item expiry integration tests passed");
