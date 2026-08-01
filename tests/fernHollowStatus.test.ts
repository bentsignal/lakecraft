import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FERN_HOLLOW_PLAYER_CAPACITY,
  fernHollowServerStatus,
} from "../shared/multiplayer.ts";
import { ACTIVE_PLAYER_WINDOW_MS } from "../shared/sleep.ts";

const now = 100_000;
const presence = (userId: string, heartbeatAt: number, online = true) => ({
  userId,
  heartbeatAt: String(heartbeatAt),
  online,
});

assert.deepEqual(fernHollowServerStatus([], now), {
  status: "online",
  onlinePlayers: 0,
  capacity: 20,
  sampledAt: now,
});

const status = fernHollowServerStatus([
  presence("alice", now - 1_000),
  presence("alice", now - 2_000),
  presence("bob", now - ACTIVE_PLAYER_WINDOW_MS),
  presence("charlie", now - ACTIVE_PLAYER_WINDOW_MS - 1),
  presence("future", now + 5_001),
  presence("offline", now - 1_000, false),
], now);
assert.equal(status.onlinePlayers, 2,
  "the server row counts unique online leases inside the shared 90-second authority window");

const superseded = fernHollowServerStatus([
  presence("alice", now - 1_000, false),
  presence("alice", now - 2_000, true),
], now);
assert.equal(superseded.onlinePlayers, 0, "a newer offline lease supersedes an older online duplicate");

const crowded = fernHollowServerStatus(
  Array.from({ length: FERN_HOLLOW_PLAYER_CAPACITY + 9 }, (_, index) => presence(`player-${index}`, now)),
  now,
);
assert.equal(crowded.onlinePlayers, FERN_HOLLOW_PLAYER_CAPACITY, "the public server row never exceeds its advertised capacity");
assert.equal(fernHollowServerStatus([], Number.NaN).sampledAt, 0, "invalid clocks fail to a deterministic empty sample");

const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
const query = server.slice(
  server.indexOf("fernHollowStatus: query(async"),
  server.indexOf("currentProfiles: query(async", server.indexOf("fernHollowStatus: query(async")),
);
assert.match(query, /newestByIndex\(ctx\.db\.playerPresence, "by_heartbeat"/);
assert.match(query, /gte\("heartbeatAt", String\(serverNow - ACTIVE_PLAYER_WINDOW_MS\)\)/);
assert.match(query, /take\(MAX_SLEEP_PARTICIPANTS\)/,
  "the reactive query performs one bounded indexed read rather than an unbounded presence scan");
assert.doesNotMatch(query, /insert\(|update\(|delete\(|setInterval|setTimeout/,
  "opening the server list adds no write or polling cadence");

const client = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.ok(client.indexOf("? <SinglePlayerApp") < client.indexOf(": <LakebedMultiplayerApp"),
  "single-player branches before the Lakebed auth/query application mounts");

const lobby = readFileSync(new URL("../client/lobby/LobbyScreen.tsx", import.meta.url), "utf8");
const serverBrowser = lobby.slice(lobby.indexOf("function ServerBrowser"), lobby.indexOf("export function LobbyScreen"));
assert.match(serverBrowser, /liveStatus\?\.onlinePlayers \?\? 0/,
  "the loading state cannot misreport the signed-in viewer as an authoritative online player");
assert.match(serverBrowser, /useQuery<FernHollowServerStatus>\("fernHollowStatus"\)/,
  "only the conditionally-mounted server browser subscribes to the status query");
assert.doesNotMatch(lobby.slice(lobby.indexOf("export function LobbyScreen")), /useQuery</,
  "the title screen does not spend a server-status subscription before Multiplayer is opened");

console.log("Fern Hollow reactive status and auth-boundary tests passed");
