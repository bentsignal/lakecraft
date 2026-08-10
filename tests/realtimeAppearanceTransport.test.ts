import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealtimeMultiplayerClient } from "../client/realtimeMultiplayer.ts";
import {
  encodePlayerSkinWirePixels,
  playerSkinWireId,
  PLAYER_SKIN_WIRE_BYTES,
} from "../client/game/playerSkin.ts";
import type { RemotePlayer } from "../client/game/types.ts";
import { createRemoteAvatarMotion } from "../client/game/avatar.ts";

type Timer = { callback: () => void; delay: number; interval: boolean };
const timers = new Map<number, Timer>();
let timerId = 0;
Object.assign(globalThis, { window: {
  setTimeout(callback: () => void, delay = 0) {
    const id = ++timerId; timers.set(id, { callback, delay, interval: false }); return id;
  },
  clearTimeout(id: number) { timers.delete(id); },
  setInterval(callback: () => void, delay = 0) {
    const id = ++timerId; timers.set(id, { callback, delay, interval: true }); return id;
  },
  clearInterval(id: number) { timers.delete(id); },
} });

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly endpoint: string;
  constructor(endpoint: string) { this.endpoint = endpoint; FakeWebSocket.instances.push(this); }
  send(payload: string) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(message: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) }); }
  disconnect() { this.readyState = 3; this.onclose?.(); }
}
Object.assign(globalThis, { WebSocket: FakeWebSocket });

const localPixels = Uint8Array.from({ length: PLAYER_SKIN_WIRE_BYTES }, (_, index) => index % 239);
const localId = await playerSkinWireId(localPixels);
const remotePixels = Uint8Array.from({ length: PLAYER_SKIN_WIRE_BYTES }, (_, index) => index % 197);
const remoteId = await playerSkinWireId(remotePixels);
const secondPixels = Uint8Array.from({ length: PLAYER_SKIN_WIRE_BYTES }, (_, index) => index % 181);
const secondId = await playerSkinWireId(secondPixels);
let armorHead = "diamond_helmet";
const projections: RemotePlayer[][] = [];
const client = new RealtimeMultiplayerClient({
  endpoint: "wss://appearance.test/ws",
  serverId: "server",
  demo: { token: "0123456789abcdef", userId: "alex", name: "Alex" },
  localUserId: "alex",
  localUsername: "Alex",
  getPose: () => ({ x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }),
  getSkin: async () => ({ id: localId, model: "slim", pixels: localPixels, source: null }),
  getArmor: () => ({ armorHead, armorChest: "iron_chestplate", armorLegs: "", armorFeet: "leather_boots" }),
  onPhase: () => {},
  onRemotePlayers: (players) => projections.push(players),
  onWorldEdits: () => {},
  onChatEvent: () => {},
  onGameMode: () => {},
});

client.start();
const socket = FakeWebSocket.instances[0]!;
socket.open();
socket.receive({ type: "hello", capabilities: ["appearance-v1"] });
await Promise.resolve();
socket.receive({ type: "welcome", resumeToken: "resume", player: { gameMode: "survival" } });
await Promise.resolve();
const published = socket.sent.find((message) => message.type === "appearance_set")!;
assert.deepEqual(published.appearance, {
  skinId: localId, skinModel: "slim", armorHead: "diamond_helmet",
  armorChest: "iron_chestplate", armorLegs: "", armorFeet: "leather_boots",
});
assert.equal(published.skinPixels, encodePlayerSkinWirePixels(localPixels),
  "the selected skin is published once as exact bounded pixels outside movement input");

socket.receive({
  type: "snapshot", self: { x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 },
  players: [{ id: "steve", name: "Steve", x: 2, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }],
});
socket.receive({
  type: "appearance_roster",
  players: [{ userId: "steve", skinId: remoteId, skinModel: "wide",
    armorHead: "iron_helmet", armorChest: "", armorLegs: "golden_leggings", armorFeet: "" }],
});
assert.deepEqual(socket.sent.findLast((message) => message.type === "appearance_request"), {
  v: 1, type: "appearance_request", userId: "steve", skinId: remoteId,
});
assert.equal(projections.at(-1)?.[0].skinPixels, null, "default fallback remains until the requested blob is verified");
socket.receive({
  type: "appearance_blob", userId: "steve", skinId: remoteId,
  skinPixels: encodePlayerSkinWirePixels(remotePixels),
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(projections.at(-1)?.[0].skinId, remoteId);
assert.equal(projections.at(-1)?.[0].armorHead, "iron_helmet");
assert.deepEqual(projections.at(-1)?.[0].skinPixels, remotePixels,
  "a hash-verified blob is merged into the existing pose without waiting for another snapshot");

socket.receive({
  type: "appearance_state",
  player: { userId: "steve", skinId: remoteId, skinModel: "wide",
    armorHead: "iron_chestplate", armorChest: "iron_helmet", armorLegs: "", armorFeet: "stone" },
});
assert.equal(projections.at(-1)?.[0].armorHead, "iron_chestplate",
  "wire projection remains bounded while the avatar's exact-slot sanitizer rejects malicious armor");
const maliciousMotion = createRemoteAvatarMotion(projections.at(-1)![0], 0);
assert.deepEqual(
  [maliciousMotion.armorHead, maliciousMotion.armorChest, maliciousMotion.armorFeet],
  [null, null, null],
  "cross-slot and unknown armor from a community server never reaches geometry",
);

socket.receive({
  type: "appearance_state",
  player: { userId: "sam", skinId: secondId, skinModel: "wide",
    armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
});
const requestPacing = [...timers.values()].find((timer) => !timer.interval && timer.delay === 250)!;
requestPacing.callback();
const requestTimeout = [...timers.values()].find((timer) => !timer.interval && timer.delay === 2_000);
assert.ok(requestTimeout, "every sequential blob request has a bounded untrusted-server timeout");
requestTimeout.callback();
assert.deepEqual(socket.sent.findLast((message) => message.type === "appearance_request"), {
  v: 1, type: "appearance_request", userId: "sam", skinId: secondId,
});
const wrongPixels = new Uint8Array(secondPixels); wrongPixels[0] ^= 255;
socket.receive({
  type: "appearance_blob", userId: "sam", skinId: secondId,
  skinPixels: encodePlayerSkinWirePixels(wrongPixels),
});
await new Promise((resolve) => setTimeout(resolve, 0));
socket.receive({
  type: "snapshot", self: { x: 0.5, y: 69.02, z: 0.5, yaw: 0, pitch: 0 },
  players: [{ id: "sam", name: "Sam", x: 3, y: 69.02, z: 0.5, yaw: 0, pitch: 0 }],
});
assert.equal(projections.at(-1)?.[0].skinPixels, null, "a blob whose pixels do not match its content id is never rendered");

armorHead = "leather_helmet";
const sampler = [...timers.values()].find((timer) => timer.interval && timer.delay === 50)!;
sampler.callback();
const armorUpdate = socket.sent.findLast((message) => message.type === "appearance_set")!;
assert.equal((armorUpdate.appearance as Record<string, unknown>).armorHead, "leather_helmet");
assert.equal(armorUpdate.skinPixels, undefined, "armor changes stay tiny and never resend the skin blob");

socket.disconnect();
const reconnectTimer = [...timers.values()].find((timer) => !timer.interval && timer.delay === 500)!;
reconnectTimer.callback();
const reconnected = FakeWebSocket.instances[1]!;
reconnected.open();
reconnected.receive({ type: "hello", capabilities: ["appearance-v1"] });
reconnected.receive({ type: "welcome", resumeToken: "rotated", player: { gameMode: "survival" } });
await Promise.resolve();
assert.equal(reconnected.sent.find((message) => message.type === "appearance_set")?.skinPixels,
  encodePlayerSkinWirePixels(localPixels), "reconnect republishes the full selected skin to a fresh server connection");

client.stop();

const legacyClient = new RealtimeMultiplayerClient({
  endpoint: "wss://legacy.test/ws", serverId: "legacy", localUserId: "alex", localUsername: "Alex",
  demo: { token: "0123456789abcdef", userId: "alex", name: "Alex" },
  getPose: () => ({ x: 0, y: 69.02, z: 0, yaw: 0, pitch: 0 }),
  getSkin: async () => ({ id: localId, model: "slim", pixels: localPixels, source: null }),
  onPhase: () => {}, onRemotePlayers: () => {}, onWorldEdits: () => {}, onChatEvent: () => {}, onGameMode: () => {},
});
legacyClient.start();
const legacy = FakeWebSocket.instances[2]!;
legacy.open();
legacy.receive({ type: "hello" });
legacy.receive({ type: "welcome", resumeToken: "legacy", player: { gameMode: "survival" } });
await Promise.resolve();
assert.equal(legacy.sent.some((message) => message.type === "appearance_set"), false,
  "a protocol-v1 server without the appearance capability retains the installed-default fallback");
legacyClient.stop();

const racePixels = Uint8Array.from({ length: PLAYER_SKIN_WIRE_BYTES }, (_, index) => index % 173);
const raceId = await playerSkinWireId(racePixels);
const nextPixels = Uint8Array.from({ length: PLAYER_SKIN_WIRE_BYTES }, (_, index) => index % 167);
const nextId = await playerSkinWireId(nextPixels);
const nativeCrypto = globalThis.crypto;
let releaseDigest: (() => void) | undefined;
let raceDigestCalls = 0;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
  ...nativeCrypto,
  subtle: {
    digest(algorithm: AlgorithmIdentifier, data: BufferSource) {
      raceDigestCalls += 1;
      return new Promise<ArrayBuffer>((resolve) => {
        releaseDigest = () => { void nativeCrypto.subtle.digest(algorithm, data).then(resolve); };
      });
    },
  },
} });
const raceProjections: RemotePlayer[][] = [];
const raceClient = new RealtimeMultiplayerClient({
  endpoint: "wss://race.test/ws", serverId: "race", localUserId: "alex", localUsername: "Alex",
  demo: { token: "0123456789abcdef", userId: "alex", name: "Alex" },
  getPose: () => ({ x: 0, y: 69.02, z: 0, yaw: 0, pitch: 0 }),
  onPhase: () => {}, onRemotePlayers: (players) => raceProjections.push(players),
  onWorldEdits: () => {}, onChatEvent: () => {}, onGameMode: () => {},
});
raceClient.start();
const raceSocket = FakeWebSocket.instances[3]!;
raceSocket.open();
raceSocket.receive({ type: "hello", capabilities: ["appearance-v1"] });
raceSocket.receive({ type: "welcome", resumeToken: "race", player: { gameMode: "survival" } });
raceSocket.receive({
  type: "snapshot", self: { x: 0, y: 69.02, z: 0, yaw: 0, pitch: 0 },
  players: [{ id: "next", name: "Next", x: 1, y: 69.02, z: 0, yaw: 0, pitch: 0 }],
});
raceSocket.receive({
  type: "appearance_roster",
  players: [
    { userId: "slow", skinId: raceId, skinModel: "wide", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
    { userId: "next", skinId: nextId, skinModel: "wide", armorHead: "", armorChest: "", armorLegs: "", armorFeet: "" },
  ],
});
for (let duplicate = 0; duplicate < 20; duplicate += 1) raceSocket.receive({
  type: "appearance_blob", userId: "slow", skinId: raceId,
  skinPixels: encodePlayerSkinWirePixels(racePixels),
});
await Promise.resolve();
assert.equal(raceDigestCalls, 1, "duplicate matching blobs cannot launch concurrent decode/hash work");
const slowTimeout = [...timers.values()].findLast((timer) => !timer.interval && timer.delay === 2_000)!;
slowTimeout.callback();
assert.deepEqual(raceSocket.sent.findLast((message) => message.type === "appearance_request"), {
  v: 1, type: "appearance_request", userId: "next", skinId: nextId,
});
Object.defineProperty(globalThis, "crypto", { configurable: true, value: nativeCrypto });
releaseDigest?.();
await new Promise((resolve) => setTimeout(resolve, 0));
raceSocket.receive({ type: "appearance_blob", userId: "next", skinId: nextId, skinPixels: encodePlayerSkinWirePixels(nextPixels) });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(raceProjections.at(-1)?.[0].skinPixels, nextPixels,
  "a slow hash completing after timeout cannot clear or overwrite the newer active request");
raceClient.stop();
const appSource = readFileSync(new URL("../client/index.tsx", import.meta.url), "utf8");
assert.match(appSource, /hydrateSelectedPlayerSkin\(window\.localStorage\)/);
assert.match(appSource, /engine\.setPlayerSkin\(skin\.source, skin\.model\)/,
  "the same persisted selection hydrates the local multiplayer player rig");
assert.match(appSource, /getSkin=\{selectedSkin\}[\s\S]{0,360}armorHead: equipmentRef\.current\.head\?\.itemId/,
  "the realtime transport reads the same selection and live canonical equipment refs");
const visualLabSource = readFileSync(new URL("../client/components/VisualLab.tsx", import.meta.url), "utf8");
assert.doesNotMatch(visualLabSource, /skin[^.]{0,80}never uploaded|does not bundle or upload the selected file/i);
assert.match(visualLabSource, /reduced 64×64 appearance is relayed transiently/,
  "skin privacy copy distinguishes the local original PNG from its realtime appearance reduction");
console.log("realtime selected-skin and armor transport: ok");
