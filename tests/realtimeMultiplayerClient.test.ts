import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MULTIPLAYER_INVITATION_TOKENS_STORAGE_KEY,
  MULTIPLAYER_SERVERS_STORAGE_KEY,
  decodeRealtimeGameMode,
  loadMultiplayerInvitationTokens,
  loadSavedMultiplayerServers,
  multiplayerStatusUrl,
  normalizeMultiplayerEndpoint,
  saveMultiplayerInvitationToken,
  saveMultiplayerServers,
} from "../client/realtimeMultiplayer.ts";

assert.equal(decodeRealtimeGameMode("creative"), "creative");
assert.equal(decodeRealtimeGameMode("survival"), "survival");
assert.equal(decodeRealtimeGameMode("operator"), "survival", "unknown server roles fail closed to Survival");

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

const credentialStorage = new Map<string, string>();
assert.equal(saveMultiplayerInvitationToken({
  getItem: (key) => credentialStorage.get(key) ?? null,
  setItem: (key, value) => credentialStorage.set(key, value),
}, "https://fern-hollow.up.railway.app", "  private-invitation-token  "), true);
assert.deepEqual(loadMultiplayerInvitationTokens({
  getItem: (key) => credentialStorage.get(key) ?? null,
}), { "wss://fern-hollow.up.railway.app/ws": "private-invitation-token" });
assert.ok(credentialStorage.has(MULTIPLAYER_INVITATION_TOKENS_STORAGE_KEY));
assert.doesNotMatch(savedValue, /private-invitation-token/);
assert.equal(saveMultiplayerInvitationToken({
  getItem: () => null,
  setItem: () => assert.fail("short credentials must not be written"),
}, "safe.example", "too-short"), false);

const appSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
const statusProbe = appSource.slice(
  appSource.indexOf("void fetch(statusUrl"),
  appSource.indexOf("return () => controller.abort()", appSource.indexOf("void fetch(statusUrl")),
);
assert.ok(statusProbe.includes('body.ok !== true'));
assert.ok(statusProbe.includes('body.status !== "online"'));
assert.ok(statusProbe.includes("body.protocolVersion !== 1"));
assert.ok(appSource.includes("demoServerTokens[selected.endpoint] || persistedTokens[selected.endpoint]"),
  "saved invitation tokens survive authentication redirects and page reloads");

console.log("realtime multiplayer client helpers: ok");
