import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MULTIPLAYER_SERVERS_STORAGE_KEY,
  loadSavedMultiplayerServers,
  multiplayerStatusUrl,
  normalizeMultiplayerEndpoint,
  saveMultiplayerServers,
} from "../client/realtimeMultiplayer.ts";

assert.equal(
  normalizeMultiplayerEndpoint("https://fern-hollow.up.railway.app"),
  "wss://fern-hollow.up.railway.app/ws",
);
assert.equal(
  normalizeMultiplayerEndpoint("fern-hollow.up.railway.app/ws"),
  "wss://fern-hollow.up.railway.app/ws",
);
assert.equal(normalizeMultiplayerEndpoint("javascript:alert(1)"), null);
assert.equal(normalizeMultiplayerEndpoint("ftp://example.com/world"), null);
assert.equal(
  multiplayerStatusUrl("wss://fern-hollow.up.railway.app/ws"),
  "https://fern-hollow.up.railway.app/status",
);

const source = JSON.stringify([
  { id: "one", name: "Fern Hollow", endpoint: "https://fern-hollow.up.railway.app" },
  { id: "duplicate", name: "Duplicate", endpoint: "wss://fern-hollow.up.railway.app/ws" },
  { id: "bad", name: "Bad", endpoint: "file:///tmp/world" },
]);
assert.deepEqual(loadSavedMultiplayerServers({ getItem: () => source }), [{
  id: "one",
  name: "Fern Hollow",
  endpoint: "wss://fern-hollow.up.railway.app/ws",
}]);

let savedKey = "";
let savedValue = "";
saveMultiplayerServers({
  setItem(key, value) {
    savedKey = key;
    savedValue = value;
  },
}, [{ id: "one", name: "Fern Hollow", endpoint: "https://fern-hollow.up.railway.app" }]);
assert.equal(savedKey, MULTIPLAYER_SERVERS_STORAGE_KEY);
assert.deepEqual(JSON.parse(savedValue), [{
  id: "one",
  name: "Fern Hollow",
  endpoint: "wss://fern-hollow.up.railway.app/ws",
}]);

const appSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const statusProbe = appSource.slice(
  appSource.indexOf("void fetch(statusUrl"),
  appSource.indexOf("return () => controller.abort()", appSource.indexOf("void fetch(statusUrl")),
);
assert.ok(statusProbe.includes('body.ok !== true'));
assert.ok(statusProbe.includes('body.status !== "online"'));
assert.ok(statusProbe.includes("body.protocolVersion !== 1"));

console.log("realtime multiplayer client helpers: ok");
